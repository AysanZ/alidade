# Alidade

An open-source Web-GIS platform. PostGIS vector tiles, OGC services, full symbology,
and a real-time asset layer.

This repository is at **phase 3**. The map is described by a single project object.
The core diffs two versions of it and emits a list of operations; the adapter applies
those operations to MapLibre. Editing the project changes the map, and swapping the
basemap does not destroy the layers.

Working now: a table of contents grouped by slot, a basemap gallery on open tiles,
2D, 2.5D and 3D views, three projections including a real globe, terrain and
hillshade from open elevation tiles, a graticule, UTM and metric reference grids,
an overview map, drawing and geodesic measurement with buffers, camera bookmarks,
a scale bar in three unit systems, and a coordinate readout in decimal degrees,
DMS or UTM.

Drawings and measurements are ordinary parts of the project document, so they
survive a basemap swap, appear in the operation log, and export to GeoJSON, KML,
GPX, CSV or WKT. Files in any of those formats can be read back in; the format is
worked out from the content rather than the extension.

Shapes are traced point by point, or spanned: a rectangle between two opposite
corners, a circle from its centre out to its edge. Both produce ordinary polygons
— GeoJSON has no circle and neither does KML or PostGIS — built geodesically, so
a circle is the same size on the ground all the way round and is drawn as an
ellipse away from the equator, which is correct. While one is being spanned it
reports its radius or its sides and its area, and nothing reaches the document
until the second click.

A finished shape can be picked up and carried. Moving one rotates it about the
sphere rather than shifting its degrees, so every distance inside it survives the
trip: a parcel measured, moved and measured again gives the same number. Shifting
degrees would have one dragged from the tropics to the Arctic arrive covering
half the ground it left with.

The drawing tools snap. A vertex always wins over a segment inside the tolerance,
the tolerance is stated in pixels and converted against the current scale so it
means the same thing at every zoom, and the position that is stored is the
snapped one rather than the pointer's — a snap that moves the highlight and not
the vertex is a lie about where the point went. While a shape is being made there
is a rubber band to the cursor, the closing edge of a ring is previewed, and the
segment length, bearing, running total and area are reported beside the pointer.
Backspace takes back the last point, a double click finishes, Escape cancels.
Finished shapes can be edited: drag a square to move a vertex, drag the circle at
the middle of a segment to add one, Alt-click to remove. A ring will not go below
three points and a line will not go below two.

None of that live feedback is in the document. The rubber band is a function of
where the mouse is, and the mouse is not part of the map: it is drawn as an
overlay above the canvas, so it costs no operations and cannot be undone into.

### Projections

`Mercator` is the flat web map. `Globe` is MapLibre's own name for a projection
that is a sphere when zoomed out and quietly becomes mercator on the way in,
which is the right default and a confusing thing to pick at street level, because
nothing on the screen changes. `Sphere` is `vertical-perspective`: round at every
zoom. Choosing either of the round ones from close in takes the camera out to
where the choice is visible.

Data goes in three ways. Upload a GeoJSON, zipped Shapefile, GeoPackage, KML or GPX
and it is reprojected by ogr2ogr, written to PostGIS and served back as vector tiles
in the same request. Paste a link and GDAL reads it over HTTP without it ever
touching your disk. Or point Alidade at a WMS and pick a layer, style and format
from what the server advertises in GetCapabilities.

Nothing here needs an API key. The basemaps are CARTO and Esri tiles and the
elevation is Mapzen terrarium, so it stays up without a billing account.

The database ships empty. There is no seeded demo layer: one cannot be deleted
from the studio, it comes back on every fresh volume, and it makes an install
that has nothing in it look like it already has data.

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
psql postgresql://alidade:change_me@localhost:5433/alidade -c 'select id, title from layers;'
```

- Studio: <http://localhost:5173>
- API health: <http://localhost:8000/api/health>
- A tile, once you have loaded something: <http://localhost:8000/api/tiles/{layer}/{z}/{x}/{y}.mvt>

The database runs everything in `data/init/` on first start, which creates the
PostGIS extension and the layer registry and stops there. Get data in by dropping
a file on the **Add data** dialog, pasting a link, or pointing at a WMS. To load
straight into PostGIS instead:

```bash
./data/seed.sh wards.gpkg
```

Earlier versions seeded 42 demo wards over Tehran. `data/init/` only runs on a
brand new volume, so a database created before that changed still has them:

```bash
psql postgresql://alidade:change_me@localhost:5433/alidade -f data/drop-demo.sql
```

## What is here

| Path | Contents |
|---|---|
| `data/init/` | Schema and layer registry, run once on first start |
| `data/seed.sh` | ogr2ogr loader, for data you would rather not upload |
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
pnpm test        # 278 tests, Node only: no browser, no WebGL
pnpm typecheck   # every package and the studio
pnpm build
```

Core tests assert on the operation array the reconciler emits for a given pair of
project states, so slot ordering, bundle expansion, classification and filter
compilation are all tested without rendering anything. Adapter tests use a fake
renderer that records calls, and refuse the same things a real one refuses:
adding a layer before its source, removing a source something is still reading.

`packages/core/tests/regressions.test.ts` holds one test per defect that has been
fixed, named after the symptom rather than the cause.

## Licence

Apache-2.0.
