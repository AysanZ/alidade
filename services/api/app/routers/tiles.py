from fastapi import APIRouter, HTTPException, Response

from ..config import settings
from ..db import pool

router = APIRouter(prefix="/api/tiles", tags=["tiles"])

# One layer for now. Phase 3 replaces this with a registry read from the project.
LAYERS = {
    "wards": {
        "table": "wards_1400",
        "columns": ["ward_id", "name", "pop_2024", "area_km2", "density"],
    }
}

# The tile is built inside the database: nothing but the encoded MVT crosses the wire.
TILE_SQL = """
WITH bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS mercator,
           ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS lonlat
),
tile AS (
    SELECT {columns},
           ST_AsMVTGeom(
               ST_Transform(t.geom, 3857),
               bounds.mercator,
               4096, 64, true
           ) AS geom
    FROM {table} AS t, bounds
    WHERE t.geom && bounds.lonlat
)
SELECT ST_AsMVT(tile, $4, 4096, 'geom') FROM tile;
"""


@router.get("/{layer}/{z}/{x}/{y}.mvt")
async def tile(layer: str, z: int, x: int, y: int) -> Response:
    spec = LAYERS.get(layer)
    if spec is None:
        raise HTTPException(404, f"No layer named {layer}.")
    if not 0 <= z <= 22 or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
        raise HTTPException(400, "Tile coordinates are outside the pyramid.")

    # Identifiers come from LAYERS, never from the request. Values are always bound.
    sql = TILE_SQL.format(
        table=spec["table"],
        columns=", ".join(f"t.{c}" for c in spec["columns"]),
    )

    async with pool().acquire() as conn:
        data = await conn.fetchval(sql, z, x, y, layer)

    return Response(
        content=bytes(data or b""),
        media_type="application/vnd.mapbox-vector-tile",
        headers={"Cache-Control": f"public, max-age={settings.tile_cache_seconds}"},
    )
