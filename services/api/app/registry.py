"""Reading and writing the layer registry."""

from dataclasses import dataclass

from .db import pool
from .naming import check_identifier


@dataclass
class Layer:
    id: str
    title: str
    table: str
    geometry_column: str
    geometry_type: str | None
    source_crs: str | None
    feature_count: int | None
    fields: list[str]
    extent: dict | None

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "table": self.table,
            "geometryType": self.geometry_type,
            "sourceCrs": self.source_crs,
            "featureCount": self.feature_count,
            "fields": self.fields,
            "extent": self.extent,
        }


def _row_to_layer(row) -> Layer:
    import json

    fields = row["fields"]
    return Layer(
        id=row["id"],
        title=row["title"],
        table=check_identifier(row["table_name"]),
        geometry_column=check_identifier(row["geometry_column"]),
        geometry_type=row["geometry_type"],
        source_crs=row["source_crs"],
        feature_count=row["feature_count"],
        fields=json.loads(fields) if isinstance(fields, str) else list(fields or []),
        extent=json.loads(row["extent"]) if isinstance(row["extent"], str) else row["extent"],
    )


async def all_layers() -> list[Layer]:
    async with pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM layers ORDER BY created_at")
    return [_row_to_layer(r) for r in rows]


async def get(layer_id: str) -> Layer | None:
    async with pool().acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM layers WHERE id = $1", layer_id)
    return _row_to_layer(row) if row else None


# Columns ogr2ogr adds for its own bookkeeping, which nobody wants in a popup.
INTERNAL = {"geom", "fid", "ogc_fid", "gid", "wkb_geometry"}


async def columns_of(table: str) -> list[str]:
    """The column names as PostGIS spells them after ogr2ogr laundered them."""
    table = check_identifier(table)
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
            """,
            table,
        )
    return [r["column_name"] for r in rows if r["column_name"] not in INTERNAL]


async def geometry_type_of(table: str) -> str | None:
    table = check_identifier(table)
    async with pool().acquire() as conn:
        return await conn.fetchval(
            "SELECT type FROM geometry_columns WHERE f_table_name = $1 LIMIT 1", table
        )


async def register(
    layer_id: str,
    title: str,
    table: str,
    geometry_type: str,
    source_crs: str,
    fields: list[str] | None = None,
) -> Layer:
    import json

    table = check_identifier(table)
    # Read the shape of what actually landed, rather than what the file promised.
    fields = await columns_of(table)
    geometry_type = await geometry_type_of(table) or geometry_type

    async with pool().acquire() as conn:
        # Count and extent come from the table itself, not from what the file claimed.
        stats = await conn.fetchrow(
            f"""
            SELECT count(*)::int AS n,
                   jsonb_build_object(
                       'west',  min(ST_XMin(geom)), 'south', min(ST_YMin(geom)),
                       'east',  max(ST_XMax(geom)), 'north', max(ST_YMax(geom))
                   ) AS extent
            FROM {table}
            """
        )
        await conn.execute(
            """
            INSERT INTO layers
                (id, title, table_name, geometry_type, source_crs, feature_count, fields, extent)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
            ON CONFLICT (id) DO UPDATE SET
                title = excluded.title, table_name = excluded.table_name,
                feature_count = excluded.feature_count, fields = excluded.fields,
                extent = excluded.extent
            """,
            layer_id,
            title,
            table,
            geometry_type,
            source_crs,
            stats["n"],
            json.dumps(fields),
            json.dumps(dict(stats["extent"])) if isinstance(stats["extent"], dict) else stats["extent"],
        )
    layer = await get(layer_id)
    assert layer is not None
    return layer
