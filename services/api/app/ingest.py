"""Import a file into PostGIS with ogr2ogr and describe what arrived."""

import asyncio
import json
import secrets
from dataclasses import dataclass
from pathlib import Path

from .config import settings
from .naming import check_identifier, table_name

# What ogr2ogr will read. Anything else is refused before it touches the disk.
EXTENSIONS = {".geojson", ".json", ".zip", ".gpkg", ".kml", ".gpx", ".shp"}


class IngestError(RuntimeError):
    pass


@dataclass
class Imported:
    table: str
    geometry_type: str
    source_crs: str
    feature_count: int
    fields: list[str]
    extent: dict[str, float]


async def run(*args: str) -> str:
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await process.communicate()
    if process.returncode != 0:
        raise IngestError(err.decode()[-800:] or "The import tool failed.")
    return out.decode()


def ogr_path(path: Path) -> str:
    """A zipped shapefile is read in place through GDAL's virtual file system."""
    return f"/vsizip/{path}" if path.suffix.lower() == ".zip" else str(path)


async def describe_source(path: Path) -> dict:
    raw = await run("ogrinfo", "-json", "-so", ogr_path(path))
    info = json.loads(raw)
    layers = info.get("layers") or []
    if not layers:
        raise IngestError("The file has no layers that GDAL can read.")
    return layers[0]


def crs_of(layer: dict) -> str:
    srs = (layer.get("geometryFields") or [{}])[0].get("coordinateSystem", {})
    wkt_id = srs.get("projjson", {}).get("id", {})
    authority, code = wkt_id.get("authority"), wkt_id.get("code")
    return f"{authority}:{code}" if authority and code else "unknown"


async def import_file(path: Path, original_name: str) -> Imported:
    if path.suffix.lower() not in EXTENSIONS:
        raise IngestError(f"Alidade cannot read {path.suffix} files.")

    source = await describe_source(path)
    table = check_identifier(table_name(original_name, secrets.token_hex(3)))

    await run(
        "ogr2ogr",
        "-f",
        "PostgreSQL",
        settings.ogr_dsn,
        ogr_path(path),
        "-nln",
        table,
        "-overwrite",
        "-t_srs",
        "EPSG:4326",
        "-nlt",
        "PROMOTE_TO_MULTI",
        "-lco",
        "GEOMETRY_NAME=geom",
        "-lco",
        "FID=fid",
        "-lco",
        "SPATIAL_INDEX=GIST",
    )

    return Imported(
        table=table,
        geometry_type=source.get("geometryFields", [{}])[0].get("type", "Unknown"),
        source_crs=crs_of(source),
        feature_count=int(source.get("featureCount") or 0),
        fields=[f["name"] for f in source.get("fields", [])],
        extent={},
    )
