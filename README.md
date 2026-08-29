# Alidade

An open-source Web-GIS platform. PostGIS vector tiles, OGC services, full symbology,
and a real-time asset layer.

This repository is at **phase 1**. The map is described by a single project object.
The core diffs two versions of it and emits a list of operations; the adapter applies
those operations to MapLibre. Editing the project changes the map, and swapping the
basemap does not destroy the layers.

## Run it

```bash
cp .env.example .env
docker compose -f deploy/docker-compose.yml up -d --build
cd apps/studio && pnpm install && pnpm dev
```

- Studio: <http://localhost:5173>
- API health: <http://localhost:8000/api/health>
- A tile: <http://localhost:8000/api/tiles/wards/11/1462/818.mvt>

The database runs everything in `data/init/` on first start, which
creates 42 demo wards over Dushanbe. To load your own data instead:

```bash
./data/seed.sh wards.gpkg
```

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
pnpm test        # 34 tests, Node only: no browser, no WebGL
pnpm typecheck
```

Core tests assert on the operation array the reconciler emits for a given pair of
project states, so slot ordering, bundle expansion, classification and filter
compilation are all tested without rendering anything. Adapter tests use a fake
renderer that records calls.

## Licence

Apache-2.0.
