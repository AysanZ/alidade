import asyncpg
from fastapi import APIRouter, HTTPException, Response

from .. import registry
from ..config import settings
from ..db import pool
from ..naming import check_identifier

router = APIRouter(prefix="/api/tiles", tags=["tiles"])

# The tile is built inside the database: nothing but the encoded MVT crosses the wire.
# The internal columns are prefixed with underscores, which `check_identifier`
# refuses for a user column, so a table with a field called `shape` or `bounds`
# cannot collide with them.
#
# Web mercator has no answer past about 85.05° of latitude, so a geometry that
# reaches a pole cannot be projected into it and ST_Transform raises rather than
# guessing. Natural Earth is full of these — the antimeridian seams run from pole
# to pole, and Antarctica is a polygon whose southern edge is exactly -90 — and
# the z0 tile is the one that selects them, so the world tile failed while every
# other tile worked. Anything that strays outside the band is cut down to it
# first. The bounding box test in the CASE keeps that cost off the other 99% of
# rows, because ST_Intersection on every feature of every tile is not free.
TILE_SQL = """
WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS __mercator,
           ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS __lonlat
),
clipped AS (
    SELECT {columns},
           CASE
               WHEN ST_YMax(t.{geom}) > 85.05112878 OR ST_YMin(t.{geom}) < -85.05112878
               THEN ST_CollectionExtract(
                        ST_Intersection(
                            t.{geom},
                            ST_MakeEnvelope(-180, -85.05112878, 180, 85.05112878, 4326)
                        ),
                        ST_Dimension(t.{geom}) + 1
                    )
               ELSE t.{geom}
           END AS __shape
    FROM {table} AS t, bounds
    WHERE t.{geom} && bounds.__lonlat
),
tile AS (
    SELECT {plain},
           ST_AsMVTGeom(
               ST_Transform(__shape, 3857),
               bounds.__mercator,
               4096, 64, true
           ) AS geom
    FROM clipped, bounds
    WHERE __shape IS NOT NULL AND NOT ST_IsEmpty(__shape)
)
SELECT ST_AsMVT(tile, $4, 4096, 'geom') FROM tile WHERE geom IS NOT NULL;
"""


@router.get("/{layer_id}/{z}/{x}/{y}.mvt")
async def tile(layer_id: str, z: int, x: int, y: int) -> Response:
    layer = await registry.get(layer_id)
    if layer is None:
        raise HTTPException(404, f"No layer named {layer_id}.")
    if not 0 <= z <= 22 or not 0 <= x < 2**z or not 0 <= y < 2**z:
        raise HTTPException(400, "Tile coordinates are outside the pyramid.")

    # Identifiers come from the registry, never from the request. Values are bound.
    attributes = [c for c in layer.fields if c != layer.geometry_column]
    checked = [check_identifier(c) for c in attributes]
    columns = ", ".join(f"t.{c}" for c in checked) or "t.fid"
    plain = ", ".join(checked) or "fid"
    sql = TILE_SQL.format(
        table=layer.table, geom=layer.geometry_column, columns=columns, plain=plain
    )

    try:
        async with pool().acquire() as conn:
            data = await conn.fetchval(sql, z, x, y, layer_id)
    except asyncpg.PostgresError as error:
        # A tile that cannot be built is a property of this layer's data, not a
        # crash. Saying which layer and why beats a bare 500 in the console.
        raise HTTPException(
            422, f"Tile {z}/{x}/{y} of {layer_id} could not be built: {error}"
        ) from error

    return Response(
        content=bytes(data or b""),
        media_type="application/vnd.mapbox-vector-tile",
        headers={"Cache-Control": f"public, max-age={settings.tile_cache_seconds}"},
    )
