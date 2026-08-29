from fastapi import APIRouter, HTTPException, Response

from .. import registry
from ..config import settings
from ..db import pool
from ..naming import check_identifier

router = APIRouter(prefix="/api/tiles", tags=["tiles"])

# The tile is built inside the database: nothing but the encoded MVT crosses the wire.
TILE_SQL = """
WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS mercator,
           ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS lonlat
),
tile AS (
    SELECT {columns},
           ST_AsMVTGeom(
               ST_Transform(t.{geom}, 3857),
               bounds.mercator,
               4096, 64, true
           ) AS geom
    FROM {table} AS t, bounds
    WHERE t.{geom} && bounds.lonlat
)
SELECT ST_AsMVT(tile, $4, 4096, 'geom') FROM tile;
"""


@router.get("/{layer_id}/{z}/{x}/{y}.mvt")
async def tile(layer_id: str, z: int, x: int, y: int) -> Response:
    layer = await registry.get(layer_id)
    if layer is None:
        raise HTTPException(404, f"No layer named {layer_id}.")
    if not 0 <= z <= 22 or not 0 <= x < 2**z or not 0 <= y < 2**z:
        raise HTTPException(400, "Tile coordinates are outside the pyramid.")

    # Identifiers come from the registry, never from the request. Values are bound.
    columns = ", ".join(f"t.{check_identifier(c)}" for c in layer.fields) or "t.*"
    sql = TILE_SQL.format(table=layer.table, geom=layer.geometry_column, columns=columns)

    async with pool().acquire() as conn:
        data = await conn.fetchval(sql, z, x, y, layer_id)

    return Response(
        content=bytes(data or b""),
        media_type="application/vnd.mapbox-vector-tile",
        headers={"Cache-Control": f"public, max-age={settings.tile_cache_seconds}"},
    )
