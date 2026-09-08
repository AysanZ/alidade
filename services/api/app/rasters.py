"""
Reading and writing the imagery catalogue.

The search is the interesting part. Every question the studio asks of this is
some version of "which images cover the ground I am looking at, and how much of
it does each one reach", and that second half is what makes the first half mean
anything: nine images of this ground and nine that clip one corner of the view
are completely different answers, and a bare count cannot tell them apart.

Coverage is computed against the footprint, in an equal-area projection, because
the fraction of a view that a rotated quadrilateral covers is not the fraction
its bounding box covers, and areas measured in degrees are wrong by the cosine
of the latitude.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime

from .db import pool


@dataclass
class Raster:
    id: str
    title: str
    file: str
    stored: str
    captured_at: datetime | None
    captured_from: str | None
    footprint: dict
    bbox: tuple[float, float, float, float]
    gsd: float
    epsg: int | None
    cloud_cover: float | None
    bands: int
    dtype: str
    nodata: float | None
    width: int | None
    height: int | None
    bytes: int | None
    sensor: str | None
    note: str | None
    state: str
    error: str | None
    coverage: float | None = field(default=None)

    def as_item(self) -> dict:
        """
        The row as a STAC Item.

        A GeoJSON Feature with the footprint as its geometry and the searchable
        instant in `properties.datetime`, which is allowed to be null. Nothing
        here is invented: `gsd`, `proj:epsg` and `eo:cloud_cover` are the
        specification's own names, so a client that already speaks STAC needs no
        translation and neither does this.
        """
        properties: dict = {
            "datetime": self.captured_at.isoformat() if self.captured_at else None,
            "title": self.title,
            "gsd": self.gsd,
            "proj:epsg": self.epsg,
            "eo:cloud_cover": self.cloud_cover,
            # Ours, prefixed, because they are not the specification's.
            "alidade:datetime_from": self.captured_from,
            "alidade:bands": self.bands,
            "alidade:dtype": self.dtype,
            "alidade:nodata": self.nodata,
            "alidade:width": self.width,
            "alidade:height": self.height,
            "alidade:bytes": self.bytes,
            "alidade:sensor": self.sensor,
            "alidade:note": self.note,
            "alidade:file": self.file,
            "alidade:state": self.state,
            "alidade:error": self.error,
        }
        if self.coverage is not None:
            properties["alidade:coverage"] = round(self.coverage, 1)

        return {
            "type": "Feature",
            "stac_version": "1.0.0",
            "id": self.id,
            "collection": "imagery",
            "bbox": list(self.bbox),
            "geometry": self.footprint,
            "properties": properties,
            "assets": {
                "image": {
                    "href": f"/api/rasters/{self.id}/asset",
                    "type": "image/tiff; application=geotiff; profile=cloud-optimized",
                    "roles": ["data"],
                }
            },
            "links": [{"rel": "self", "href": f"/api/rasters/{self.id}"}],
        }


def _row(record) -> Raster:
    footprint = record["footprint"]
    footprint = json.loads(footprint) if isinstance(footprint, str) else footprint
    ring = footprint["coordinates"][0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return Raster(
        id=record["id"],
        title=record["title"],
        file=record["file"],
        stored=record["stored"],
        captured_at=record["captured_at"],
        captured_from=record["captured_from"],
        footprint=footprint,
        bbox=(min(lons), min(lats), max(lons), max(lats)),
        gsd=float(record["gsd"]),
        epsg=record["epsg"],
        cloud_cover=record["cloud_cover"],
        bands=record["bands"],
        dtype=record["dtype"],
        nodata=record["nodata"],
        width=record["width"],
        height=record["height"],
        bytes=record["bytes"],
        sensor=record["sensor"],
        note=record["note"],
        state=record["state"],
        error=record["error"],
        coverage=record["coverage"] if "coverage" in record.keys() else None,
    )


COLUMNS = """
    id, title, file, stored, captured_at, captured_from,
    ST_AsGeoJSON(footprint)::json AS footprint,
    gsd, epsg, cloud_cover, bands, dtype, nodata, width, height, bytes,
    sensor, note, state, error
"""


async def get(raster_id: str) -> Raster | None:
    async with pool().acquire() as conn:
        row = await conn.fetchrow(f"SELECT {COLUMNS} FROM rasters WHERE id = $1", raster_id)
    return _row(row) if row else None


async def search(
    bbox: tuple[float, float, float, float] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 200,
) -> list[Raster]:
    """
    Every image matching a box and a date window, newest first.

    The date window deliberately does not exclude undated images. A search for
    "2024" that silently drops the file whose acquisition tag was missing is a
    search that hides exactly the images somebody needs to go and fix.
    """
    limit = max(1, min(limit, 1000))

    if bbox is None:
        sql = f"""
            SELECT {COLUMNS}, NULL::double precision AS coverage
            FROM rasters
            WHERE ($1::timestamptz IS NULL OR captured_at IS NULL OR captured_at >= $1)
              AND ($2::timestamptz IS NULL OR captured_at IS NULL OR captured_at <= $2)
            ORDER BY captured_at DESC NULLS LAST
            LIMIT $3
        """
        async with pool().acquire() as conn:
            rows = await conn.fetch(sql, start, end, limit)
        return [_row(r) for r in rows]

    # Areas in an equal-area projection rather than in degrees. A square degree
    # near Tehran is about three quarters the ground of one at the equator, so a
    # ratio taken in degrees is wrong by the cosine of the latitude — and the
    # figure is being shown to the user as a percentage of their screen.
    sql = f"""
        WITH view AS (
            SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS box
        )
        SELECT {COLUMNS},
               100.0 * ST_Area(ST_Transform(ST_Intersection(footprint, view.box), 6933))
                     / NULLIF(ST_Area(ST_Transform(view.box, 6933)), 0) AS coverage
        FROM rasters, view
        WHERE footprint && view.box
          AND ST_Intersects(footprint, view.box)
          AND ($5::timestamptz IS NULL OR captured_at IS NULL OR captured_at >= $5)
          AND ($6::timestamptz IS NULL OR captured_at IS NULL OR captured_at <= $6)
        ORDER BY captured_at DESC NULLS LAST
        LIMIT $7
    """
    async with pool().acquire() as conn:
        rows = await conn.fetch(sql, *bbox, start, end, limit)
    return [_row(r) for r in rows]


async def covering(bbox: tuple[float, float, float, float]) -> list[Raster]:
    """Ready images whose footprint meets a box. What the tiler asks."""
    return [r for r in await search(bbox=bbox, limit=500) if r.state == "ready"]


async def register(
    raster_id: str,
    title: str,
    file: str,
    stored: str,
    footprint: dict,
    described,
    captured_at: datetime | None,
    captured_from: str | None,
    bytes_on_disk: int,
) -> Raster:
    async with pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO rasters
                (id, title, file, stored, captured_at, captured_from, footprint,
                 gsd, epsg, cloud_cover, bands, dtype, nodata, width, height,
                 bytes, state)
            VALUES ($1,$2,$3,$4,$5,$6, ST_GeomFromGeoJSON($7),
                    $8,$9,NULL,$10,$11,$12,$13,$14,$15,'ready')
            ON CONFLICT (id) DO UPDATE SET
                title = excluded.title, stored = excluded.stored,
                footprint = excluded.footprint, gsd = excluded.gsd,
                epsg = excluded.epsg, bands = excluded.bands,
                dtype = excluded.dtype, nodata = excluded.nodata,
                width = excluded.width, height = excluded.height,
                bytes = excluded.bytes, state = 'ready', error = NULL
            """,
            raster_id, title, file, stored, captured_at, captured_from,
            json.dumps(footprint), described.gsd, described.epsg,
            described.bands, described.dtype, described.nodata,
            described.width, described.height, bytes_on_disk,
        )
    found = await get(raster_id)
    assert found is not None
    return found


# Only these can be edited, and none of them touches the pixels. The .tif stays
# byte for byte the file that was uploaded; what the file said is kept in
# `captured_from` beside what the user said.
EDITABLE = {"title", "captured_at", "sensor", "note", "cloud_cover"}


async def update(raster_id: str, changes: dict) -> Raster | None:
    fields = {k: v for k, v in changes.items() if k in EDITABLE}
    if not fields:
        return await get(raster_id)

    # A date the user supplies is marked as theirs, so that the panel can go on
    # telling the truth about where every date came from.
    sets, values = [], []
    for n, (key, value) in enumerate(fields.items(), start=2):
        sets.append(f"{key} = ${n}")
        values.append(value)
    if "captured_at" in fields:
        sets.append(
            "captured_from = CASE WHEN $%d::timestamptz IS NULL THEN NULL ELSE 'user' END"
            % (list(fields).index("captured_at") + 2)
        )

    async with pool().acquire() as conn:
        await conn.execute(
            f"UPDATE rasters SET {', '.join(sets)} WHERE id = $1", raster_id, *values
        )
    return await get(raster_id)


async def remove(raster_id: str) -> str | None:
    async with pool().acquire() as conn:
        return await conn.fetchval(
            "DELETE FROM rasters WHERE id = $1 RETURNING stored", raster_id
        )
