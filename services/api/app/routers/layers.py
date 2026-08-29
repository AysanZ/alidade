import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile

from .. import registry
from ..config import settings
from ..ingest import EXTENSIONS, IngestError, import_file
from ..naming import slug

router = APIRouter(prefix="/api/layers", tags=["layers"])


@router.get("")
async def list_layers() -> dict:
    return {"layers": [layer.as_dict() for layer in await registry.all_layers()]}


@router.get("/{layer_id}")
async def get_layer(layer_id: str) -> dict:
    layer = await registry.get(layer_id)
    if layer is None:
        raise HTTPException(404, f"No layer named {layer_id}.")
    return layer.as_dict()


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
            raise HTTPException(413, f"That file is {size_mb:.0f} MB and the limit is {settings.max_upload_mb} MB.")

        try:
            imported = await import_file(path, name)
        except IngestError as error:
            raise HTTPException(422, str(error)) from error

    layer_id = slug(Path(name).stem) or imported.table
    layer = await registry.register(
        layer_id=layer_id,
        title=Path(name).stem,
        table=imported.table,
        geometry_type=imported.geometry_type,
        source_crs=imported.source_crs,
        fields=imported.fields,
    )
    return layer.as_dict()
