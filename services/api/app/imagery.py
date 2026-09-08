"""
What a GeoTIFF is, and what to do with it before it can be served.

Three jobs, kept apart because only the first two can be tested without GDAL on
the machine: work out when the image was taken, describe what arrived, and
convert it to a Cloud-Optimised GeoTIFF in web mercator.

The conversion is done once, at import, rather than warping per tile. That is
the difference between a tile that renders in milliseconds and one that renders
in a second, and it is the reason the overviews exist at all: a zoomed-out
request should read a small pyramid level, not the full raster.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

# What GDAL will read as imagery. Anything else is refused before it is copied.
EXTENSIONS = {".tif", ".tiff", ".jp2"}


class ImageryError(RuntimeError):
    pass


# ------------------------------------------------------------------ the date

# Where a date hides in a filename, most specific first.
#
# Sentinel-2 puts the instant in the granule name (`..._20240712T071621_...`),
# Landsat puts the date in its scene id, and a great many exported files are
# simply called `something_2024-07-12.tif`. Eight bare digits are last because
# they are the most likely to be something else entirely.
_PATTERNS = [
    re.compile(r"(?P<y>\d{4})(?P<m>\d{2})(?P<d>\d{2})T(?P<H>\d{2})(?P<M>\d{2})(?P<S>\d{2})"),
    re.compile(r"(?P<y>\d{4})-(?P<m>\d{2})-(?P<d>\d{2})"),
    re.compile(r"(?P<y>\d{4})_(?P<m>\d{2})_(?P<d>\d{2})"),
    re.compile(r"(?<!\d)(?P<y>\d{4})(?P<m>\d{2})(?P<d>\d{2})(?!\d)"),
]

# What GDAL surfaces for an acquisition instant, in the order worth believing.
_TAGS = ["TIFFTAG_DATETIME", "ACQUISITIONDATETIME", "ACQUISITION_DATE", "DATE_ACQUIRED"]


def _build(year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0):
    """
    A datetime, or nothing, without raising.

    The year range is the whole check that stops `run_12345678.tif` becoming the
    twelfth of March 1234. It is deliberately generous — a scanned sheet from
    1908 is a real thing somebody will load — and it is still enough, because
    the numbers that turn up in filenames by accident are serial numbers and
    those are not in this range with a valid month and day attached.
    """
    if not 1850 <= year <= 2100:
        return None
    try:
        return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    except ValueError:
        return None


def date_from_name(name: str) -> datetime | None:
    """The first plausible date in a filename, or nothing."""
    stem = Path(name).name
    for pattern in _PATTERNS:
        for found in pattern.finditer(stem):
            parts = found.groupdict()
            built = _build(
                int(parts["y"]),
                int(parts["m"]),
                int(parts["d"]),
                int(parts.get("H") or 0),
                int(parts.get("M") or 0),
                int(parts.get("S") or 0),
            )
            if built is not None:
                return built
    return None


def date_from_tags(metadata: dict) -> datetime | None:
    """
    An acquisition instant out of the file's own metadata.

    TIFF writes it as `YYYY:MM:DD HH:MM:SS`, with colons in the date, which is
    the format's own choice and not a typo. ISO turns up too, from anything that
    was not written by a TIFF library.
    """
    for tag in _TAGS:
        raw = metadata.get(tag)
        if not raw:
            continue
        text = str(raw).strip()
        for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(text.replace("Z", ""), fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        found = date_from_name(text)
        if found:
            return found
    return None


def captured_at(metadata: dict, filename: str) -> tuple[datetime | None, str | None]:
    """
    When the image was taken, and where that came from.

    The file's own tags first, then its name, then nothing.

    Never the file's modification time. An upload date presented as a capture
    date is a wrong map that looks like a right one: every date would be
    plausible, ordered and false, and nothing on the screen would say so. An
    image whose date is unknown says it is unknown, sorts last, and asks.
    """
    tagged = date_from_tags(metadata)
    if tagged is not None:
        return tagged, "tag"
    named = date_from_name(filename)
    if named is not None:
        return named, "filename"
    return None, None


# ------------------------------------------------------------------ describing


@dataclass
class Described:
    width: int
    height: int
    bands: int
    dtype: str
    nodata: float | None
    epsg: int | None
    """Metres on the ground per pixel, after the warp to web mercator."""
    gsd: float
    """The real outline in lon/lat, as a GeoJSON polygon."""
    footprint: dict
    bbox: tuple[float, float, float, float]
    metadata: dict


def epsg_of(info: dict) -> int | None:
    identifier = (
        info.get("coordinateSystem", {}).get("projjson", {}).get("id", {})
    )
    if str(identifier.get("authority", "")).upper() == "EPSG":
        try:
            return int(identifier["code"])
        except (KeyError, TypeError, ValueError):
            return None
    return None


def footprint_of(info: dict) -> dict:
    """
    The image's real outline, not its bounding box.

    `gdalinfo -json` reports `wgs84Extent` as a polygon of the four corners
    reprojected, which for anything not aligned to north is a rotated
    quadrilateral. Its bounding box is meaningfully larger and covers ground the
    file has no pixels for, so a registry that stores the box will tell someone
    an image covers their view when it does not.
    """
    extent = info.get("wgs84Extent")
    if extent and extent.get("coordinates"):
        return extent
    corners = info.get("cornerCoordinates") or {}
    lower, upper = corners.get("lowerLeft"), corners.get("upperRight")
    if not (lower and upper):
        raise ImageryError("The file has no georeferencing that GDAL could read.")
    west, south, east, north = lower[0], lower[1], upper[0], upper[1]

    # `cornerCoordinates` are in the file's own CRS, and after the warp that is
    # web mercator — metres, not degrees. Storing those as a lon/lat footprint
    # gives a bounding box millions of units across, which is why an airfield
    # would frame to half a continent instead of to a runway. Better to refuse:
    # a file whose extent cannot be read is a file to fix, not to place wrongly.
    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise ImageryError(
            "GDAL reported no lon/lat extent for this file, and its corners are "
            "not degrees. Check that it has a CRS: gdalinfo -json <file>."
        )
    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise ImageryError("The file's latitudes are outside ±90°, so its CRS is not what it claims.")
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


def bbox_of(footprint: dict) -> tuple[float, float, float, float]:
    ring = footprint["coordinates"][0]
    lons = [point[0] for point in ring]
    lats = [point[1] for point in ring]
    return (min(lons), min(lats), max(lons), max(lats))


def native_zoom(gsd: float) -> int:
    """
    The zoom at which one screen pixel is one image pixel.

    Web mercator is about 156543 metres per pixel at zoom 0, so ten metres is
    native at about 14 and five centimetres at about 21. This becomes the
    source's `maxzoom`: past the detail the data holds, the renderer should
    stretch the last real tile rather than ask for pixels nobody photographed.
    """
    if gsd <= 0:
        return 22
    return max(0, min(22, math.ceil(math.log2(156543.03392 / gsd))))


def describe(info: dict) -> Described:
    """Turn a `gdalinfo -json` document into the facts the registry keeps."""
    bands = info.get("bands") or []
    if not bands:
        raise ImageryError("The file has no raster bands.")

    size = info.get("size") or [0, 0]
    transform = info.get("geoTransform") or [0, 1, 0, 0, 0, -1]
    footprint = footprint_of(info)

    metadata = {}
    for group in (info.get("metadata") or {}).values():
        if isinstance(group, dict):
            metadata.update(group)

    return Described(
        width=int(size[0]),
        height=int(size[1]),
        bands=len(bands),
        dtype=str(bands[0].get("type", "Byte")),
        nodata=bands[0].get("noDataValue"),
        epsg=epsg_of(info),
        gsd=abs(float(transform[1])),
        footprint=footprint,
        bbox=bbox_of(footprint),
        metadata=metadata,
    )


# ------------------------------------------------------------------ converting


async def run(*args: str) -> str:
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await process.communicate()
    if process.returncode != 0:
        raise ImageryError(err.decode()[-800:] or "GDAL failed.")
    return out.decode()


async def gdalinfo(path: str | Path) -> dict:
    return json.loads(await run("gdalinfo", "-json", str(path)))


async def to_cog(source: Path, destination: Path) -> None:
    """
    Reproject to web mercator and write a Cloud-Optimised GeoTIFF.

    One file per image rather than a folder of thousands of pictures, and the
    band selection and the stretch stay decisions the viewer makes rather than
    decisions frozen here. Baking a pyramid would squash a 16-bit multiband
    scene to 8-bit RGB before anything could be asked of it, which for satellite
    imagery is the wrong trade: "show me the near infrared" and "restretch that,
    it is all white" are the two commonest things anyone says.
    """
    await run(
        "gdalwarp",
        "-t_srs", "EPSG:3857",
        "-r", "bilinear",
        "-of", "COG",
        "-co", "COMPRESS=DEFLATE",
        "-co", "BLOCKSIZE=512",
        "-co", "OVERVIEWS=AUTO",
        "-co", "NUM_THREADS=ALL_CPUS",
        "-multi",
        str(source),
        str(destination),
    )


def stored_name(original: str, token: str) -> str:
    """A name the server chose. Nothing a client sent ever reaches the filesystem."""
    stem = re.sub(r"[^a-z0-9]+", "_", Path(original).stem.lower()).strip("_") or "image"
    return f"{stem[:48]}_{token}.tif"
