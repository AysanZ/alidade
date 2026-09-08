"""
Imagery: the catalogue, and the tiles it makes.

The tile endpoint is the counterpart of `/api/tiles/{layer}/{z}/{x}/{y}.mvt`.
One is built by PostGIS and the other by rasterio, and the client does not care
which: both answer the same shape of question and both come back as bytes with a
cache header on them.
"""

from __future__ import annotations

import logging
import secrets
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import rasters
from ..config import settings
from ..imagery import (
    EXTENSIONS,
    ImageryError,
    captured_at,
    describe,
    gdalinfo,
    native_zoom,
    stored_name,
    to_cog,
)
from ..naming import slug

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rasters", tags=["imagery"])


def rasters_dir() -> Path:
    directory = Path(settings.rasters_dir)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def path_of(raster) -> Path:
    return rasters_dir() / raster.stored


# ------------------------------------------------------------------ catalogue


class Edit(BaseModel):
    """
    What a person is allowed to change.

    None of it touches the file. Edits are kept in the registry and the `.tif`
    stays byte for byte the file that was uploaded, so what the file said and
    what the user said are two facts rather than one overwritten one.
    """

    title: str | None = None
    captured_at: datetime | None = None
    sensor: str | None = None
    note: str | None = None
    cloud_cover: float | None = None
    # Explicitly clear the date rather than leaving it alone, which `None` means.
    clear_date: bool = False


def _bbox(value: str | None):
    if not value:
        return None
    try:
        west, south, east, north = (float(p) for p in value.split(","))
    except ValueError as error:
        raise HTTPException(422, "bbox is four comma-separated numbers.") from error
    if west >= east or south >= north:
        raise HTTPException(422, "bbox must be west,south,east,north.")
    return (west, south, east, north)


def _window(value: str | None):
    """
    A STAC datetime window: an instant, or a closed or half-open interval.

    `../2024-01-01` and `2024-01-01/..` are the specification's own way of saying
    "up to" and "from", so they are what this accepts.
    """
    if not value:
        return None, None

    def one(text: str):
        text = text.strip()
        if not text or text == "..":
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as error:
            raise HTTPException(422, f"{text} is not an ISO 8601 instant.") from error

    if "/" in value:
        start, end = value.split("/", 1)
        return one(start), one(end)
    instant = one(value)
    return instant, instant


@router.get("/search")
async def search(
    bbox: str | None = None,
    datetime_: str | None = Query(None, alias="datetime"),
    limit: int = 200,
) -> dict:
    """
    Every image matching a box and a date window, as a STAC ItemCollection.

    This is the strip's query on every map move, and it is also a STAC API
    search, which costs nothing extra and means `pystac`, a STAC browser or
    QGIS's STAC plugin can read the catalogue without being told about Alidade.
    """
    start, end = _window(datetime_)
    found = await rasters.search(bbox=_bbox(bbox), start=start, end=end, limit=limit)
    return {
        "type": "FeatureCollection",
        "features": [r.as_item() for r in found],
        "numberReturned": len(found),
        "links": [],
    }


@router.get("")
async def list_rasters() -> dict:
    return await search()


@router.post("")
async def upload(file: UploadFile) -> dict:
    """
    Take a GeoTIFF, convert it once, and register where it is and what it is of.

    The conversion is synchronous, which is honest for a first cut and wrong for
    a gigabyte: `gdalwarp` on an 800 MB scene takes tens of seconds and a request
    held open for that long times out behind Nginx. The row carries a `state`
    column so that moving this onto a background task is a change to this
    function and to nothing else.
    """
    name = file.filename or "image.tif"
    suffix = Path(name).suffix.lower()
    if suffix not in EXTENSIONS:
        raise HTTPException(
            400, f"Alidade reads {', '.join(sorted(EXTENSIONS))}, not {suffix or 'that'}."
        )

    token = secrets.token_hex(3)
    final_name = stored_name(name, token)
    destination = rasters_dir() / final_name

    with tempfile.TemporaryDirectory() as directory:
        raw = Path(directory) / f"upload{suffix}"
        with raw.open("wb") as target:
            shutil.copyfileobj(file.file, target)

        size_mb = raw.stat().st_size / 1_048_576
        if size_mb > settings.max_raster_mb:
            raise HTTPException(
                413, f"That file is {size_mb:.0f} MB and the limit is {settings.max_raster_mb} MB."
            )

        try:
            # Described before the warp, because that is where the acquisition
            # tags are: gdalwarp writes a new file and does not carry every
            # vendor tag across it.
            original = await gdalinfo(raw)
            facts = describe(original)
            when, whence = captured_at(facts.metadata, name)

            await to_cog(raw, destination)
            warped = describe(await gdalinfo(destination))
        except ImageryError as error:
            destination.unlink(missing_ok=True)
            raise HTTPException(422, str(error)) from error

    # The footprint and the ground sample distance come from the warped file,
    # because that is what the tiler will read; the CRS and the date come from
    # the original, because that is what the file was.
    warped.epsg = facts.epsg
    raster = await rasters.register(
        raster_id=f"{slug(Path(name).stem) or 'image'}_{token}",
        title=Path(name).stem,
        file=name,
        stored=final_name,
        footprint=warped.footprint,
        described=warped,
        captured_at=when,
        captured_from=whence,
        bytes_on_disk=destination.stat().st_size,
    )
    return raster.as_item()


@router.get("/{raster_id}")
async def get_raster(raster_id: str) -> dict:
    raster = await rasters.get(raster_id)
    if raster is None:
        raise HTTPException(404, f"No image named {raster_id}.")
    return raster.as_item()


@router.patch("/{raster_id}")
async def edit(raster_id: str, body: Edit) -> dict:
    if await rasters.get(raster_id) is None:
        raise HTTPException(404, f"No image named {raster_id}.")

    changes = body.model_dump(exclude_unset=True, exclude={"clear_date"})
    if body.clear_date:
        changes["captured_at"] = None
    updated = await rasters.update(raster_id, changes)
    assert updated is not None
    return updated.as_item()


@router.delete("/{raster_id}")
async def delete(raster_id: str) -> dict:
    stored = await rasters.remove(raster_id)
    if stored is None:
        raise HTTPException(404, f"No image named {raster_id}.")
    (rasters_dir() / stored).unlink(missing_ok=True)
    return {"removed": raster_id}


@router.get("/{raster_id}/asset")
async def asset(raster_id: str) -> FileResponse:
    """The COG itself, for anything that would rather read it directly."""
    raster = await rasters.get(raster_id)
    if raster is None or not path_of(raster).is_file():
        raise HTTPException(404, f"No image named {raster_id}.")
    return FileResponse(
        path_of(raster),
        media_type="image/tiff; application=geotiff; profile=cloud-optimized",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ------------------------------------------------------------------ the tiler


def _rescale(values: list[str] | None):
    if not values:
        return None
    out = []
    for pair in values:
        try:
            low, high = (float(p) for p in pair.split(","))
        except ValueError as error:
            raise HTTPException(422, f"rescale is min,max, not {pair!r}.") from error
        out.append((low, high))
    return out


PIXEL_SELECTION = {"first": "first", "blend": "mean", "mean": "mean", "max": "highest"}


def _order(candidates, rule: str, image: str | None, date: datetime | None):
    """
    The candidates in the order the rule puts them.

    The same rules as `packages/core/imagery.ts`, and deliberately the same
    words. Two implementations of one idea is a risk worth naming: the client
    sorts to say which images are contributing, the server sorts to decide which
    pixels to read, and if they disagree the panel highlights one image while the
    map draws another.
    """
    if rule == "lock":
        return [c for c in candidates if c.id == image]

    dated = [c for c in candidates if c.captured_at is not None]
    undated = [c for c in candidates if c.captured_at is None]

    if rule == "sharpest":
        return sorted(candidates, key=lambda c: c.gsd)
    if rule == "centre":
        return sorted(candidates, key=lambda c: -(c.coverage or 0))
    if rule == "closest" and date is not None:
        dated.sort(key=lambda c: abs(c.captured_at - date))
    else:
        dated.sort(key=lambda c: c.captured_at, reverse=True)
    # Undated images sort last rather than being dropped, on both sides.
    return dated + undated


@router.get("/tiles/{z}/{x}/{y}.png")
async def tile(
    z: int,
    x: int,
    y: int,
    rule: str = "newest",
    image: str | None = None,
    date: datetime | None = None,
    overlap: str = "first",
    bidx: list[int] | None = Query(None),
    expression: str | None = None,
    rescale: list[str] | None = Query(None),
    colormap_name: str | None = None,
    resampling: str = "nearest",
    nodata: float | None = None,
) -> Response:
    """
    One tile, from whichever images the rule chooses for the ground under it.

    A tile outside every footprint answers 204 and not 404. It is not an error:
    an image covers a patch and the renderer asks for the whole viewport, so
    every tile of sky around the scene would be a red line in the console — and
    the first thing anybody does with a console full of red is conclude the
    feature is broken.
    """
    try:
        from rio_tiler.errors import TileOutsideBounds
        from rio_tiler.io import Reader
        from rio_tiler.mosaic import mosaic_reader
        from rio_tiler.mosaic.methods import defaults as selection
    except ImportError as error:  # pragma: no cover - the image always has it
        raise HTTPException(
            503, "This server was built without rio-tiler, so it cannot draw imagery."
        ) from error

    if not 0 <= z <= 22 or not 0 <= x < 2**z or not 0 <= y < 2**z:
        raise HTTPException(400, "Tile coordinates are outside the pyramid.")

    import morecantile

    tms = morecantile.tms.get("WebMercatorQuad")
    bounds = tms.bounds(morecantile.Tile(x, y, z))
    candidates = await rasters.covering((bounds.left, bounds.bottom, bounds.right, bounds.top))
    chosen = _order(candidates, rule, image, date)
    if not chosen:
        return Response(status_code=204)
    # A ceiling, because reading a hundred COGs for one tile is not a mosaic, it
    # is a timeout, and past a handful the ones underneath are never seen.
    chosen = chosen[: settings.max_mosaic_assets]

    paths = [str(path_of(c)) for c in chosen]

    def read(path: str, *_args, **_kwargs):
        with Reader(path) as src:
            return src.tile(
                x,
                y,
                z,
                tilesize=256,
                indexes=bidx or None,
                expression=expression,
                nodata=nodata,
                resampling_method=resampling,
                # A couple of pixels past the edge, cropped after resampling.
                # Without it every tile boundary carries a faint seam, and a
                # regular grid over the whole image reads as a rendering bug
                # because it is one.
                buffer=0.5,
            )

    method = getattr(
        selection,
        {"first": "FirstMethod", "mean": "MeanMethod", "highest": "HighestMethod"}[
            PIXEL_SELECTION.get(overlap, "first")
        ],
    )

    try:
        img, _used = mosaic_reader(paths, read, pixel_selection=method())
    except TileOutsideBounds:
        return Response(status_code=204)
    except Exception as error:  # noqa: BLE001 - a bad file is data, not a crash
        logger.warning("imagery tile %s/%s/%s failed: %s", z, x, y, error)
        raise HTTPException(422, f"Tile {z}/{x}/{y} could not be built: {error}") from error

    ranges = _rescale(rescale)
    if ranges:
        img.rescale(in_range=ranges)
    elif img.array.dtype != "uint8":
        # Something has to map 16-bit values into a byte. Doing nothing draws a
        # Sentinel band as a white rectangle, which reads as a broken tile rather
        # than as a missing setting.
        stats = img.statistics()
        img.rescale(in_range=[(s.min, s.max) for s in stats.values()])

    colormap = None
    if colormap_name:
        from rio_tiler.colormap import cmap

        try:
            colormap = cmap.get(colormap_name)
        except Exception:  # noqa: BLE001 - an unknown ramp is not fatal
            colormap = None

    return Response(
        content=img.render(img_format="PNG", colormap=colormap),
        media_type="image/png",
        headers={
            "Cache-Control": f"public, max-age={settings.tile_cache_seconds}",
            # Which images this tile actually came from. Invaluable when the map
            # shows something nobody expected and the question is which file.
            "X-Alidade-Images": ",".join(c.id for c in chosen),
        },
    )


@router.get("/point/{lon},{lat}")
async def point(lon: float, lat: float, rule: str = "newest", image: str | None = None) -> dict:
    """
    The band values under a position.

    The raster counterpart of WMS GetFeatureInfo, and the difference between
    imagery you can look at and imagery you can ask questions of.
    """
    from rio_tiler.io import Reader

    span = 1e-6
    candidates = await rasters.covering((lon - span, lat - span, lon + span, lat + span))
    chosen = _order(candidates, rule, image, None)
    if not chosen:
        raise HTTPException(404, "No image covers that position.")

    top = chosen[0]
    with Reader(str(path_of(top))) as src:
        values = src.point(lon, lat)

    return {
        "image": top.id,
        "title": top.title,
        "datetime": top.captured_at.isoformat() if top.captured_at else None,
        "bands": [float(v) for v in values.array.tolist()],
        "band_names": list(values.band_names),
    }


@router.get("/{raster_id}/tilejson.json")
async def tilejson(raster_id: str) -> dict:
    """
    One image as a TileJSON document.

    Handed to the client instead of a template built by hand, so the bounds and
    the zoom range come from the server that knows them rather than being copied
    into the project at import and going stale.
    """
    raster = await rasters.get(raster_id)
    if raster is None:
        raise HTTPException(404, f"No image named {raster_id}.")
    return {
        "tilejson": "2.2.0",
        "name": raster.title,
        "tiles": [f"/api/rasters/tiles/{{z}}/{{x}}/{{y}}.png?rule=lock&image={raster.id}"],
        "bounds": list(raster.bbox),
        "minzoom": 0,
        "maxzoom": native_zoom(raster.gsd),
    }
