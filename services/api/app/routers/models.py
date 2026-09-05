"""
Model files, kept on disk and served back.

A 3D model is not data the way a Shapefile is: nothing is reprojected, nothing
goes into PostGIS, and the renderer wants the bytes exactly as they were
exported. So this is a file store with two rules. A file is checked to be
glTF before it is kept, by its magic number and not by its name, because a
renamed zip does not become a model. And it is stored under a name the server
chose — a slug of the original and a short hash of the content — so the same
file uploaded twice is one file, and nothing a client sent is ever used as a
path.
"""

import hashlib
import re
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..config import settings
from ..naming import slug

router = APIRouter(prefix="/api/models", tags=["models"])

# Binary glTF opens with the ASCII bytes `glTF`; a JSON glTF is a JSON object.
GLB_MAGIC = b"glTF"
STORED = re.compile(r"^[a-z0-9_]+_[0-9a-f]{8}\.(glb|gltf)$")
MEDIA = {".glb": "model/gltf-binary", ".gltf": "model/gltf+json"}


def looks_like_gltf(head: bytes, suffix: str) -> bool:
    if suffix == ".glb":
        return head.startswith(GLB_MAGIC)
    return head.lstrip().startswith(b"{")


def stored_name(filename: str, digest: str, suffix: str) -> str:
    stem = slug(Path(filename).stem) or "model"
    return f"{stem}_{digest[:8]}{suffix}"


def models_dir() -> Path:
    directory = Path(settings.models_dir)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


@router.post("")
async def upload(file: UploadFile) -> dict:
    """Keep a glTF file and answer with the URL the project should hold."""
    name = file.filename or "model.glb"
    suffix = Path(name).suffix.lower()
    if suffix not in MEDIA:
        raise HTTPException(400, f"A model is a .glb or .gltf file, not {suffix or 'that'}.")

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / f"upload{suffix}"
        digest = hashlib.sha256()
        with path.open("wb") as target:
            while chunk := file.file.read(1_048_576):
                digest.update(chunk)
                target.write(chunk)

        size_mb = path.stat().st_size / 1_048_576
        if size_mb > settings.max_upload_mb:
            raise HTTPException(
                413, f"That file is {size_mb:.0f} MB and the limit is {settings.max_upload_mb} MB."
            )
        with path.open("rb") as check:
            if not looks_like_gltf(check.read(16), suffix):
                raise HTTPException(
                    422,
                    f"{name} does not start the way a {suffix} file does. Export it again as binary glTF.",
                )

        final = stored_name(name, digest.hexdigest(), suffix)
        destination = models_dir() / final
        if not destination.exists():
            shutil.move(str(path), destination)

    return {
        "id": final,
        "name": Path(name).stem,
        "url": f"/api/models/{final}",
        "bytes": destination.stat().st_size,
    }


@router.get("")
async def list_models() -> dict:
    """What is on the server, for a catalogue of one's own uploads."""
    files = sorted(p for p in models_dir().iterdir() if STORED.match(p.name))
    return {
        "models": [
            {"id": p.name, "name": p.stem.rsplit("_", 1)[0], "url": f"/api/models/{p.name}", "bytes": p.stat().st_size}
            for p in files
        ]
    }


@router.get("/{stored}")
async def serve(stored: str) -> FileResponse:
    """
    The file, with the media type a loader wants and headers that let a studio
    on another origin read it. The name is checked against the pattern the
    server itself writes, so `..` never reaches the filesystem.
    """
    if not STORED.match(stored):
        raise HTTPException(404, "No such model.")
    path = models_dir() / stored
    if not path.is_file():
        raise HTTPException(404, "No such model.")
    return FileResponse(
        path,
        media_type=MEDIA[path.suffix],
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
