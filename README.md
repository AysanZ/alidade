# Alidade

An open-source Web-GIS platform. PostGIS vector tiles, OGC services, full symbology,
3D models on the terrain, and a real-time asset layer.

This repository is at **phase 3**. The map is described by a single project object.
The core diffs two versions of it and emits a list of operations; the adapter applies
those operations to MapLibre. Editing the project changes the map, and swapping the
basemap does not destroy the layers.

Working now: a table of contents grouped by slot, a basemap gallery on open tiles,
2D, 2.5D and 3D views, three projections including a real globe, terrain and
hillshade from open elevation tiles, glTF models placed on the map and standing on
the terrain, a graticule, UTM and metric reference grids, an overview map, drawing
and geodesic measurement with buffers, camera bookmarks, a scale bar in three unit
systems, and a coordinate readout in decimal degrees, DMS or UTM.

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

### 3D buildings

Building footprints raised to their real height, from open vector tiles with no
key: OpenFreeMap's planet in the OpenMapTiles schema, heights out of
OpenStreetMap. It sits in the environment beside terrain and hillshade rather
than in the table of contents, because it is one layer whatever city it is over
and there is nothing about it to reorder.

The fields are named in the document rather than assumed, so the same switch
works against a plain OSM extract (`height`, `min_height`) or against footprints
you loaded into PostGIS yourself. A footprint nobody has surveyed is drawn at a
default height instead of being dropped: a gap in a street reads as a bug, and a
low block reads as a low block. Colour runs from the wall colour up to the roof
colour over the first eighty metres, which separates the towers from the terrace
without inventing a classification nobody asked for, and the whole thing fades
in over the half zoom above 14, because a city that appears between two frames
looks like a fault.

The extrusions go under the model scene and over your data, and share its depth
buffer, so a lorry parked behind a tower is behind it. Under terrain they stand
on the hill they are on. `3D` in the Scene pane turns them on with the camera;
`2.5D` does not, because a tilted map is a different and much cheaper request.

### 3D models

A glTF model is placed the way a surveyor would state it: a position, a height
above the ground, a bearing, a scale. That placement is part of the project
document — forty bytes, not the mesh — so it is saved, exported, undone and
replayed across a basemap swap like anything else, and two placements of the
same file share one download. The file itself is fetched by the renderer the way
a tile is, from a link, from the studio's own catalogue of openly licensed
samples, or from the API, which keeps an uploaded `.glb` under a name it chose
and serves it back with a URL the project can hold.

The models are drawn by three.js into a MapLibre custom layer that shares the
map's camera and depth buffer, so a lorry stands behind the building in front
of it and under the place name above it. With terrain on, a model sits on the
hill it is on: the ground height under it is read from the terrain and added to
its own. The scene is re-anchored at the map centre on every frame, and the
map's projection matrix is composed with that change of frame in double
precision before the GPU sees it, which is what keeps a building-sized object
from twitching at street zoom — the standard example does the multiplication
where single precision cannot hold it.

Click a model to select it; the inspector has the numbers, and **Place on map**
moves it with a click. Size can be set in metres once the file has arrived and
its real extent is known, because "make it twelve metres tall" is what someone
placing a building means. Day and Night in the Scene pane light the models
along with the buildings. Under a globe projection the scene is not drawn — a
mesh in mercator would float beside the sphere — and the pane says so.

`packages/core` holds the arithmetic and knows nothing of meshes;
`packages/three` is the only folder that knows three.js exists, and it is given
placements, never documents. The adapter sees the scene as one custom layer with
a place in the draw order — over the data, under the labels — and the models in
it as operations of their own.

### The document

Every edit goes through one reconciler, so undo is a stack of whole documents
rather than a stack of inverse operations: the reconciler already knows how to
get from any document to any other, and writing an inverse for every operation
means getting one of them wrong and quietly corrupting the map. Ctrl+Z and
Ctrl+Shift+Z, sixty steps deep, and an edit that changed nothing is not a step.

The map is written to the browser a moment after every change — it is forty
kilobytes of JSON with no geometry in it — so a refresh is not a loss. **Export**
is the copy that outlives the browser; **Open** reads one back, as a history step
like any other.

### Filters

A filter is a structure, not a string, so one filter compiles two ways: to a
renderer expression that hides features on the map, and to parameterised SQL for
the server. The inspector builds them as a list of rules, and will show you the
SQL, placeholders included. A value that reads as a number is stored as one,
because `"5" > "10"` is true as text and false as arithmetic.

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

Nothing here needs an API key, and that is a constraint rather than a boast: a
demo that dies when someone's free tier changes is worse than a demo with fewer
basemaps. The canvases and the buildings are OpenFreeMap, the imagery and the
terrain styles are Esri, and the elevation is Mapzen terrarium.

The two canvas basemaps are drawn from vector tiles by `packages/core/basemap.ts`
rather than fetched as pictures, which is what lets them stay sharp at zoom 19:
the tiles stop at 14 and are overzoomed with the geometry intact. Compiling the
basemap here instead of handing MapLibre a foreign style URL keeps the one
property the whole application is arranged around — the user's data underneath
the place names — a fact rather than a guess about which of someone else's two
hundred layers to insert before.

Every raster basemap states the deepest zoom its service actually caches. That
is not a limit on the map: past it the renderer stretches the last real tile,
which is blurry and continuous. Leaving it off is what is not continuous,
because a tile service past its cache does not have to answer 404 and Esri does
not — it answers with an image reading "Map data not yet available", which the
renderer draws, having no way to know it was handed a placard rather than a map.

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
| `packages/three/` | The only folder that knows three.js exists: the 3D model host |

`packages/core` is internally named **layersync**. It is a folder in this repository,
not a published package.

## Tests

```bash
pnpm install
pnpm test        # 359 tests, Node only: no browser, no WebGL
pnpm typecheck   # every package and the studio
pnpm build
```

Core tests assert on the operation array the reconciler emits for a given pair of
project states, so slot ordering, bundle expansion, classification and filter
compilation are all tested without rendering anything. Adapter tests use a fake
renderer that records calls, and refuse the same things a real one refuses:
adding a layer before its source, removing a source something is still reading.
The 3D host is tested the same way, through a fake that records what it was
handed; the matrices that put a metric scene onto a mercator map are tested
against the mercator arithmetic directly. Nothing in the suite touches a GPU.

`packages/core/tests/regressions.test.ts` holds one test per defect that has been
fixed, named after the symptom rather than the cause.

## Licence

Apache-2.0.
