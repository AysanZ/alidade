import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from .. import registry
from ..config import settings
from ..ingest import EXTENSIONS, IngestError, import_file, import_url
from ..db import pool
from ..naming import check_identifier, slug
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


@router.get("/{layer_id}/features")
async def features(
    layer_id: str, limit: int = 100, offset: int = 0, order: str | None = None
) -> dict:
    """Attributes only. Geometry is what the tile endpoint is for."""
    layer = await registry.get(layer_id)
    if layer is None:
        raise HTTPException(404, f"No layer named {layer_id}.")

    attributes = [c for c in layer.fields if c != layer.geometry_column]
    if not attributes:
        return {"fields": [], "rows": [], "total": 0}

    columns = ", ".join(check_identifier(c) for c in attributes)
    sort = check_identifier(order) if order else attributes[0]
    limit = max(1, min(limit, 1000))

    async with pool().acquire() as conn:
        total = await conn.fetchval(f"SELECT count(*) FROM {layer.table}")
        rows = await conn.fetch(
            f"SELECT {columns} FROM {layer.table} ORDER BY {sort} LIMIT $1 OFFSET $2",
            limit,
            max(0, offset),
        )

    return {
        "fields": attributes,
        "rows": [{k: jsonable(v) for k, v in dict(row).items()} for row in rows],
        "total": total,
    }


def jsonable(value):
    """Dates and decimals do not survive JSON on their own."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


# Declared last on purpose: a wildcard above the fixed paths swallows them, and a
# POST to a path this route matches answers 405 rather than 404.
@router.get("/{layer_id}")
async def get_layer(layer_id: str) -> dict:
    layer = await registry.get(layer_id)
    if layer is None:
        raise HTTPException(404, f"No layer named {layer_id}.")
    return layer.as_dict()
