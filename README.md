# Alidade

An open-source Web-GIS platform. PostGIS vector tiles, OGC services, full symbology,
and a real-time asset layer.

This repository is at **phase 0**: a thin slice through the whole stack. One table in
PostGIS, one `ST_AsMVT` endpoint, one layer on the map, deployed.

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
| `apps/studio/` | React and MapLibre client |
| `deploy/` | Compose stack and Nginx |

`packages/core` and `packages/maplibre` arrive in phase 1, when the map starts being
described by a project document rather than a hand-written style.

## Licence

Apache-2.0.
