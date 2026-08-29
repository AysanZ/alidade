# Alidade

An open-source Web-GIS platform. PostGIS vector tiles, OGC services, full symbology,
and a real-time asset layer.

This repository is at **phase 3**. The map is described by a single project object.
The core diffs two versions of it and emits a list of operations; the adapter applies
those operations to MapLibre. Editing the project changes the map, and swapping the
basemap does not destroy the layers.

Working now: a table of contents grouped by slot, a basemap gallery on open tiles,
2D, 2.5D and 3D views, terrain and hillshade from open elevation tiles, a graticule,
a scale bar in three unit systems, and a coordinate readout in decimal degrees, DMS
or UTM.

Data goes in three ways. Upload a GeoJSON, zipped Shapefile, GeoPackage, KML or GPX
and it is reprojected by ogr2ogr, written to PostGIS and served back as vector tiles
in the same request. Paste a link and GDAL reads it over HTTP without it ever
touching your disk. Or point Alidade at a WMS and pick a layer, style and format
from what the server advertises in GetCapabilities.

Nothing here needs an API key. The basemaps are CARTO and Esri tiles and the
elevation is Mapzen terrarium, so the demo stays up without a billing account.

## Run it

```bash
cp .env.example .env

# --env-file matters: compose looks for .env next to the compose file, not here.
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build

# Install from the repository root. The studio depends on two workspace packages,
# so installing inside apps/studio cannot see them.
pnpm install
pnpm dev
```

Postgres is published on host port **5433**, because 5432 is usually already taken:

```bash
psql postgresql://alidade:change_me@localhost:5433/alidade -c 'select count(*) from wards_1400;'
```

- Studio: <http://localhost:5173>
- API health: <http://localhost:8000/api/health>
- A tile: <http://localhost:8000/api/tiles/wards/10/658/403.mvt>

The database runs everything in `data/init/` on first start, which
creates 42 demo wards over Tehran. To load your own data instead:

```bash
./data/seed.sh wards.gpkg
```

Or drop a file on the **Add data** dialog, which does the same thing over HTTP.

## What is here

| Path | Contents |
|---|---|
| `data/init/` | Schema and seed dataset, run once on first start |
| `data/seed.sh` | ogr2ogr loader for real data |
| `services/api/` | FastAPI: tiles today, ingest and features next |
| `apps/studio/` | React client |
| `deploy/` | Compose stack and Nginx |

| `packages/core/` | Project model, reconciler, symbology, filter compiler |
| `packages/maplibre/` | The only folder that knows MapLibre exists |

`packages/core` is internally named **layersync**. It is a folder in this repository,
not a published package.

## Tests

```bash
pnpm install
pnpm test        # 76 tests, Node only: no browser, no WebGL
pnpm typecheck
```

Core tests assert on the operation array the reconciler emits for a given pair of
project states, so slot ordering, bundle expansion, classification and filter
compilation are all tested without rendering anything. Adapter tests use a fake
renderer that records calls.

## Licence

Apache-2.0.
