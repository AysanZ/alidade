<div align="center">

# Alidade

**An open-source Web-GIS platform.**
PostGIS vector tiles, OGC services, full symbology, 3D models on the terrain, and a real-time asset layer.

[![ci](https://github.com/OWNER/alidade/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/alidade/actions/workflows/ci.yml)
[![licence](https://img.shields.io/badge/licence-Apache--2.0-blue.svg)](LICENSE)
[![no api keys](https://img.shields.io/badge/API%20keys-none-brightgreen.svg)](#no-keys)

<img src="docs/images/architecture.svg" alt="How Alidade is put together" width="900">

</div>

---

## What it is

The map is one JSON document. The core diffs two versions of it and emits a list of
operations; an adapter applies those operations to MapLibre. Editing the document
changes the map — and swapping the basemap does not destroy your layers.

That one decision is why undo is sixty whole documents deep, why a drawing survives
a basemap swap, and why the renderer can be replaced without touching the model.

```
packages/core        the arithmetic  ·  knows nothing about any renderer
packages/maplibre    the only folder that knows MapLibre exists
packages/three       the only folder that knows three.js exists
apps/studio          React client
services/api         FastAPI: ingest, vector tiles, WMS, live feed
```

## Features

| | |
|---|---|
| **Data in** | Drop a GeoJSON, zipped Shapefile, GeoPackage, KML or GPX — reprojected by ogr2ogr into PostGIS and served back as vector tiles in the same request. Or paste a link and GDAL reads it over HTTP. Or point at a WMS and pick a layer from GetCapabilities. |
| **Symbology** | Single, graduated and categorised, with markers, labels and per-layer scale ranges. |
| **Filters** | A filter is a structure, not a string, so one filter compiles two ways: a renderer expression and parameterised SQL. The inspector will show you the SQL. |
| **2D · 2.5D · 3D** | Three projections including a real globe, terrain and hillshade from open elevation tiles, and OSM building footprints raised to their real height. |
| **3D models** | glTF placed the way a surveyor states it — position, height, bearing, scale — standing on the terrain, lit by the real sun for a real instant, casting real shadows. |
| **Live assets** | Positions over a WebSocket as an ordinary row in the table of contents. Assets that go quiet are drawn hollow, not deleted. |
| **Drawing** | Geodesic measurement, buffers, snapping, vertex editing. Exports to GeoJSON, KML, GPX, CSV or WKT — and reads all of them back. |
| **Chrome** | Graticule, UTM and metric grids, overview map, scale bar in three unit systems, coordinate readout in DD, DMS or UTM, bookmarks. |

<!--
  Screenshots. Uncomment this block once docs/images/ has the files in it —
  docs/images/README.md says what to capture and how. Left commented so the
  README does not render four broken image icons in the meantime.

<table>
<tr>
<td width="50%"><img src="docs/images/symbology.png" alt="Symbology and the table of contents"><br><sub><b>Table of contents and symbology</b></sub></td>
<td width="50%"><img src="docs/images/globe.png" alt="Globe projection"><br><sub><b>A real globe, not a picture of one</b></sub></td>
</tr>
<tr>
<td><img src="docs/images/models.gif" alt="3D models on the terrain"><br><sub><b>glTF on the terrain, lit by the sun</b></sub></td>
<td><img src="docs/images/live.gif" alt="Live asset feed"><br><sub><b>A live fleet over a WebSocket</b></sub></td>
</tr>
</table>
-->

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

- Studio — <http://localhost:5173>
- API health — <http://localhost:8000/api/health>
- Live feed — `ws://localhost:8000/api/live/assets`, switched on from the **Live assets** row
- Postgres — host port **5433**, because 5432 is usually already taken

The database ships **empty**. There is no seeded demo layer: one cannot be deleted from
the studio, it comes back on every fresh volume, and it makes an install that has
nothing in it look like it already has data. Get data in through **Add data**, or load
straight into PostGIS:

```bash
./data/seed.sh wards.gpkg
```

<a name="no-keys"></a>
## No API keys

Nothing here needs one, and that is a constraint rather than a boast: a demo that dies
when someone's free tier changes is worse than a demo with fewer basemaps. The canvases
and the buildings are [OpenFreeMap](https://openfreemap.org), the imagery and terrain
styles are Esri, and the elevation is Mapzen terrarium.

## Tests

```bash
pnpm test        # 507 tests, Node only: no browser, no WebGL
pnpm typecheck
pnpm build
```

Core tests assert on the operation array the reconciler emits for a given pair of
project states, so slot ordering, classification and filter compilation are all tested
without rendering anything. Adapter tests use a fake renderer that records calls and
refuses the same things a real one refuses. Nothing in the suite touches a GPU.

`packages/core/tests/regressions.test.ts` holds one test per defect that has been
fixed, named after the symptom rather than the cause.

## Documentation

- **[Design notes](docs/design-notes.md)** — why each subsystem is built the way it is,
  at length: the document model, geodesic drawing, the sun, the live feed's contract.
- **[Raster time series](docs/rasters.md)** — GeoTIFF scenes, and picking between
  captures of the same place at different dates.
- **[Contributing](CONTRIBUTING.md)**

## Licence

Apache-2.0.
