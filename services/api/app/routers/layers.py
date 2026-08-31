import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from .. import registry
from ..config import settings
from ..ingest import EXTENSIONS, IngestError, import_file, import_url
from ..db import pool
from ..naming import check_identifier, is_usable_column, quote_column, slug
from ..net import UnsafeUrl

router = APIRouter(prefix="/api/layers", tags=["layers"])


class FromUrl(BaseModel):
    url: str
    name: str | None = None


async def _register(name: str, imported) -> dict:
    layer = await registry.register(
        layer_id=slug(Path(name).stem) or imported.table,
        title=Path(name).stem,
        table=imported.table,
        geometry_type=imported.geometry_type,
        source_crs=imported.source_crs,
        fields=imported.fields,
    )
    return layer.as_dict()


@router.get("")
async def list_layers() -> dict:
    return {"layers": [layer.as_dict() for layer in await registry.all_layers()]}


@router.post("/from-url")
async def add_from_url(body: FromUrl) -> dict:
    """Import a link. GDAL reads it over HTTP, so nothing is downloaded twice."""
    name = body.name or Path(body.url.split("?")[0]).name or "layer"
    try:
        imported = await import_url(body.url, name)
    except UnsafeUrl as error:
        raise HTTPException(400, str(error)) from error
    except IngestError as error:
        raise HTTPException(422, str(error)) from error
    return await _register(name, imported)


@router.post("/upload")
async def upload(file: UploadFile) -> dict:
    """Import a file and serve it as vector tiles from the same request."""
    name = file.filename or "layer"
    suffix = Path(name).suffix.lower()
    if suffix not in EXTENSIONS:
        raise HTTPException(
            400, f"Alidade reads {', '.join(sorted(EXTENSIONS))}, not {suffix or 'that'}."
        )

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / f"upload{suffix}"
        with path.open("wb") as target:
            shutil.copyfileobj(file.file, target)

        size_mb = path.stat().st_size / 1_048_576
        if size_mb > settings.max_upload_mb:
            raise HTTPException(
                413, f"That file is {size_mb:.0f} MB and the limit is {settings.max_upload_mb} MB."
            )

        try:
            imported = await import_file(path, name)
        except IngestError as error:
            raise HTTPException(422, str(error)) from error

    return await _register(name, imported)


# Which column identifies a row, worked out once per layer and remembered.
_KEYS: dict[str, str | None] = {}


async def key_column(layer) -> str | None:
    """
    A column whose value picks out exactly one feature.

    Highlighting used to match on whatever field happened to be first, which for
    Natural Earth is `scalerank` — so hovering one country lit up every country
    that shared its rank. A key has to be unique or it is not a key. Tested
    rather than assumed, because nothing in a shapefile promises one exists.
    """
    if layer.id in _KEYS:
        return _KEYS[layer.id]

    attributes = [
        c for c in layer.fields if c != layer.geometry_column and is_usable_column(c)
    ]
    found: str | None = None
    async with pool().acquire() as conn:
        total = await conn.fetchval(f"SELECT count(*) FROM {layer.table}")
        for candidate in attributes:
            distinct = await conn.fetchval(
                f"SELECT count(DISTINCT {quote_column(candidate)}) FROM {layer.table}"
            )
            if distinct == total and total > 0:
                found = candidate
                break

    _KEYS[layer.id] = found
    return found


@router.get("/{layer_id}/features")
async def features(
    layer_id: str,
    limit: int = 100,
    offset: int = 0,
    order: str | None = None,
    descending: bool = False,
    search: str | None = None,
) -> dict:
    """
    Attributes, plus the bounding box of each row.

    Geometry is still the tile endpoint's job, but a table you cannot click to
    fly to is a spreadsheet, so each row carries the four numbers needed to aim
    the camera and nothing more.
    """
    layer = await registry.get(layer_id)
    if layer is None:
        raise HTTPException(404, f"No layer named {layer_id}.")

    attributes = [
        c for c in layer.fields if c != layer.geometry_column and is_usable_column(c)
    ]
    if not attributes:
        return {"fields": [], "rows": [], "total": 0, "key": None}

    columns = ", ".join(quote_column(c) for c in attributes)
    geom = check_identifier(layer.geometry_column)
    sort = quote_column(order) if order else quote_column(attributes[0])
    direction = "DESC" if descending else "ASC"
    limit = max(1, min(limit, 1000))

    # Free text over every column, cast to text. Slow on a big table and honest
    # about it: this is a table browser, not a search index.
    haystack = " || ' ' || ".join(
        f"coalesce({quote_column(c)}::text, '')" for c in attributes
    )
    pattern = f"%{search}%" if search else None

    async with pool().acquire() as conn:
        if pattern is None:
            total = await conn.fetchval(f"SELECT count(*) FROM {layer.table}")
            rows = await conn.fetch(
                f"""
                SELECT {columns},
                       ST_XMin({geom}) AS __west, ST_YMin({geom}) AS __south,
                       ST_XMax({geom}) AS __east, ST_YMax({geom}) AS __north
                FROM {layer.table}
                ORDER BY {sort} {direction}
                LIMIT $1 OFFSET $2
                """,
                limit,
                max(0, offset),
            )
        else:
            total = await conn.fetchval(
                f"SELECT count(*) FROM {layer.table} WHERE {haystack} ILIKE $1", pattern
            )
            rows = await conn.fetch(
                f"""
                SELECT {columns},
                       ST_XMin({geom}) AS __west, ST_YMin({geom}) AS __south,
                       ST_XMax({geom}) AS __east, ST_YMax({geom}) AS __north
                FROM {layer.table}
                WHERE {haystack} ILIKE $3
                ORDER BY {sort} {direction}
                LIMIT $1 OFFSET $2
                """,
                limit,
                max(0, offset),
                pattern,
            )

    out = []
    for row in rows:
        record = dict(row)
        bounds = {
            "west": record.pop("__west"),
            "south": record.pop("__south"),
            "east": record.pop("__east"),
            "north": record.pop("__north"),
        }
        out.append(
            {
                "values": {k: jsonable(v) for k, v in record.items()},
                "bounds": None if bounds["west"] is None else {k: float(v) for k, v in bounds.items()},
            }
        )

    return {
        "fields": attributes,
        "rows": out,
        "total": total,
        # The column that identifies a row, or nothing if this table has none.
        "key": await key_column(layer),
    }


def jsonable(value):
    """Dates and decimals do not survive JSON on their own."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


@router.get("/{layer_id}/stats")
async def stats(layer_id: str, field: str) -> dict:
    """
    What one column actually contains.

    Classifying without this is guessing. Breaks of 25, 50 and 75 over a column
    that runs 0 to 10 put every feature in the first class, so the map goes one
    flat colour and the classification looks broken rather than wrong. The range
    and the distinct values are the two things a classifier needs, and only the
    database knows them.
    """
    layer = await registry.get(layer_id)
    if layer is None:
        raise HTTPException(404, f"No layer named {layer_id}.")
    if field not in layer.fields:
        raise HTTPException(400, f"{layer_id} has no column called {field}.")

    # The quoted form goes into SQL; the raw name is what a lookup compares against.
    column = quote_column(field)

    async with pool().acquire() as conn:
        kind = await conn.fetchval(
            """
            SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
            """,
            layer.table,
            field,
        )
        numeric = kind in {
            "smallint", "integer", "bigint", "numeric", "real",
            "double precision", "decimal",
        }

        low = high = None
        if numeric:
            extremes = await conn.fetchrow(
                f"SELECT min({column}) AS low, max({column}) AS high FROM {layer.table}"
            )
            low = None if extremes["low"] is None else float(extremes["low"])
            high = None if extremes["high"] is None else float(extremes["high"])

        # Capped, because a classification with two thousand categories is not a
        # classification and the legend it produces is unreadable.
        rows = await conn.fetch(
            f"""
            SELECT {column}::text AS value, count(*)::int AS n
            FROM {layer.table}
            WHERE {column} IS NOT NULL
            GROUP BY 1
            ORDER BY n DESC
            LIMIT 60
            """
        )
        distinct = await conn.fetchval(
            f"SELECT count(DISTINCT {column})::int FROM {layer.table}"
        )

    return {
        "field": field,
        "type": kind,
        "numeric": numeric,
        "min": low,
        "max": high,
        "distinct": distinct,
        "values": [{"value": r["value"], "count": r["n"]} for r in rows],
    }


# Declared last on purpose: a wildcard above the fixed paths swallows them, and a
# POST to a path this route matches answers 405 rather than 404.
@router.get("/{layer_id}")
async def get_layer(layer_id: str) -> dict:
    layer = await registry.get(layer_id)
    if layer is None:
        raise HTTPException(404, f"No layer named {layer_id}.")
    return {**layer.as_dict(), "key": await key_column(layer)}
