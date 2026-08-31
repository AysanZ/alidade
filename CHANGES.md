# What changed

Two things were reported: layers did not appear when they were added, and picking
Globe did not produce a globe. The first turned out to be five separate defects
that happened to share a symptom. The second was one defect and a
misunderstanding of what MapLibre means by "globe".

Everything below is covered by a test. `pnpm test` runs 137 of them in Node, with
no browser and no WebGL.

## Fixes

### 1. A batch of operations stopped at the first failure

`packages/maplibre/src/apply.ts` was one `switch` inside one `for`, with no
`try`. Any operation that threw — a source that was already there after a style
swap, a layer whose data had gone, a paint key the engine did not know — threw
out of the loop, and **every remaining operation in that batch was dropped
without a word**. Importing a layer emits a `source.add` and then a `layer.add`,
so anything that failed first took the new layer with it, silently.

Each operation now runs on its own and reports through `onWarning`. The
operations were also made idempotent, because replaying against a style that was
not as empty as expected is normal, not exceptional:

- `source.add` on a source that exists updates it instead of throwing
- `layer.add` over an existing layer replaces it
- `layer.add` under a layer that is not there yet falls back to the top
- removing something that is not there is a no-op

### 2. Importing the same file twice produced a layer that was never drawn

`AddData` used the registry id as the id of the tree node. Two imports of the
same file name gave two nodes with one id, which compiled to two engine layers
with one id. The reconciler cannot tell them apart, so it emitted a useless
`layer.move` and no `layer.add` at all — the layer appeared in the table of
contents and nothing was drawn.

The node now gets a free id from `uniqueId`, and `source-layer` keeps pointing at
the registry id, which is what names the layer inside the vector tile.
`compile` also drops duplicates as a backstop, so a malformed project cannot
reach the renderer.

### 3. An empty group crashed the whole Layers panel

`LayerTree` read the slot of a group as `slotOf(node.children[0]!)`. On a group
with no children that is `slotOf(undefined)`, which throws
`Cannot read properties of undefined`. Removing the last layer from a group is
how you get an empty group, so this was reachable in one click.

### 4. Removing a layer could pull the elevation source out from under hillshade

`removeNode` dropped any source no layer referenced, sparing only
`environment.terrain?.source`. Hillshade reads the same source and was not
spared, so removing the last layer while hillshade was on tried to remove a
source a layer was still using. The renderer threw, and before fix 1 that killed
the rest of the batch too.

### 5. Changing a layer's source did nothing

`reconcile` diffed paint, layout, filter and zoom, but a renderer cannot move a
layer onto a different source or change what kind of layer it is. Those changes
fell through the diff and were skipped: the layer went on drawing the data it was
built with. A layer whose `type`, `source` or `source-layer` changed is now
rebuilt.

### 6. Strict mode built two maps

In development React mounts, unmounts and mounts again. The first map's `load`
handler could still fire after `remove()` and hand the application a manager
bound to a map that was no longer on the screen. There is now a cancellation
flag.

### 7. Globe never looked like a globe

The code was right and the name was misleading. In MapLibre 5 `globe` is
shorthand for a projection that interpolates from a sphere to mercator between
about zoom 10 and 12. The demo project opens at zoom 10.6 over Tehran, so
`setProjection({type:"globe"})` did exactly what it was asked and changed nothing
visible. `gita_globe` worked because `mapInitializer.js` opens at zoom 2.2.

Three things were done about it:

- `vertical-perspective` was added as a third choice, labelled **Sphere**, which
  is round at every zoom
- choosing either round projection from close in eases the camera out to zoom 2.2
- `atmosphere-blend` was added to the sky, faded out by zoom 7, which is what
  draws the halo. Without it a sphere sits in a flat void and still looks broken
- the panel says so when Globe is on and the zoom is too high for it to show

### 8. A grid or graticule refresh tore down its own layers

Any change to a geojson source removed and re-added it, taking every layer
reading it down as well. There is a new `source.data` operation for a geojson
source whose data changed but whose definition did not.

### 9. `formatDistance(940)` printed "94 m"

The trailing-zero strip was not anchored to the decimal point, so it ate the zero
off whole numbers. Found by a test, not in the field.

## Brought over from gita_globe

Rewritten against the project-document model rather than copied, so each one is
part of the saved project, appears in the operation log, survives a basemap swap,
and is testable in Node.

| From gita | Here |
|---|---|
| `measureTools.js` (turf) | `packages/core/src/measure.ts` — geodesic distance, area and bearing, no dependency |
| `drawManager.js`, `drawPanel.js` | `packages/core/src/annotate.ts` + `DrawPanel` + `useDrawing` |
| `createBuffer` (turf) | `bufferGeoJSON` — geodesic, a disc per vertex and a rectangle per segment |
| `exportDataTools.js`, `importExportManager.js` | `packages/core/src/exchange.ts` — GeoJSON, KML, GPX, CSV, WKT, both ways |
| `gridTools.js` | `packages/core/src/grids.ts` — UTM zones and bands, metric square grid |
| `statusBar.js` minimap | `components/Minimap.tsx` |
| `cameraTools.js` | Bookmarks in the Scene panel |
| `lightingTools.js` | Day and night lighting in the Scene panel |
| `navigationTools.js` | Zoom and pan locks in the map controls |
| `presentationModel.js` | Presentation mode |
| `exportMapTools.js` (commented out there) | `apps/studio/src/export.ts` — PNG with title, scale bar, north arrow and date |

Measuring is drawing that reports a number, so it is the same tool underneath and
lands in the same list: a measurement you can rename, keep and export is more
useful than one that vanishes when the panel closes.

### Deliberately not brought over

- **Satellite orbits** (`orbitLayer.js`, `satelliteLayerManager.js`, TLE
  propagation). A big, self-contained feature that needs `satellite.js` and has
  nothing to do with the reported bugs. It would slot in as its own package.
- **MGRS 100 km squares.** The UTM zone and band framework is here and correct.
  Real MGRS needs the Norway and Svalbard exceptions and per-zone 100 km lettering;
  gita's version drew a plain grid and called it MGRS, which is worse than not
  having it.
- **`printLayoutTools.js`** — every card in it says "coming soon".
- **`portal.js`, `presentationModel.js` slideshow, `stylePanel.js`** — these
  overlap with the Inspector and Project panels that already exist here, and
  merging them properly is a design decision rather than a port.

## Things worth knowing

- `Chrome.grids`, `MapProject.annotations` and `MapProject.bookmarks` are all
  optional or defaulted, so a project written before this still loads.
- The metric grid is built for a patch of world and rebuilt when the view leaves
  it, decided by `gridKey`. Panning inside the patch emits nothing.
- Buffers are left as overlapping parts rather than dissolved. The union is the
  same region either way, and dissolving would cost a polygon clipper for
  something nobody can see.


---

# Second round

## The globe went half off the screen when a worldwide layer was added

`fitBounds` was doing the framing. It frames on the mercator y axis, which is the
right axis for a flat map and the wrong one for a sphere: the centre of a box
from 41° south to 78° north lands about six degrees north of the middle of the
data, and a globe draws that offset as half a planet hanging off the top of the
viewport. Natural Earth's populated places spans nearly the whole world, so it
hit this exactly. An extent reaching past ±85° has no mercator y at all, so those
produced a centre that was not merely wrong but undefined.

The arithmetic moved into `packages/core/src/frame.ts`, where the projection is
part of the question:

- a round projection centres on the geographic middle, a flat one on the
  projected middle
- latitudes are clamped to the mercator limit before anything is computed
- zoom is capped at 5.5 for a round projection, because MapLibre's `globe` stops
  being a sphere on the way in
- an extent crossing the antimeridian, a single point, and a degenerate extent
  all have defined answers
- framing something worldwide levels the camera, since a tilted one cannot frame it

Fourteen tests in `frame.test.ts`, including one that asserts the flat and round
centres differ by more than five degrees — which is the bug, written down.

## The attribute table fell off the screen

That dataset has 38 columns. The table could only grow sideways, so the pager and
the close button ended up somewhere past the edge with no way back. Rewritten:

- the header row and the row-number column stay put while the rest scrolls
- a **Columns** button turns fields off, with a "show fewer" that keeps the first six
- the panel is draggable taller by its top edge
- a search box over every column, debounced, done in SQL
- sorting toggles direction instead of only ever ascending
- long values get an ellipsis rather than a column three screens wide

## Features you can hover, click and fly to

`/api/layers/{id}/features` now returns each row's bounding box alongside its
attributes, plus which column to match on. In the table:

- hovering a row highlights that feature on the map, quietly
- clicking selects it properly and flies the camera to it
- the highlight is a `selection` on the project, compiled to an overlay layer
  above the layer it highlights

It matches on an attribute value rather than a renderer feature id on purpose:
the demo table is keyed on text and an uploaded one on an integer, and a vector
tile only carries a feature id when the key happens to be an integer. Matching on
a column works for both.

## A real appearance editor

The inspector could nudge the break values of a graduated layer and nothing else,
so an imported layer arrived flat and stayed flat. `components/Appearance.tsx`
now does single colour, graduated, categorized and extruded; ramp choice with
resampling to any class count; per-break colour and value; category colours;
stroke colour, width and dashes; and labels with a field, size, colour and
overlap setting. The slot a layer draws in is a dropdown rather than a read-only
label.

## New layers no longer arrive the same colour

`packages/core/src/palette.ts` hands out the next colour nothing else on the map
is wearing, from a ten colour set chosen to stay apart on a dark canvas and to
avoid red beside green.

## The application is no longer one specific map

It opened with a Tehran density map hard-coded into it, title and all, which made
a general tool look like one map that happened to let you add layers.

- the project starts empty and named "Untitled map"
- the name in the title bar is an input, not a label
- an empty table of contents says what to do next and offers **Add data**
- the seeded demo layer is a button, not an assumption, so an empty database is
  not a broken first run and a full one is not stuck with someone else's map


---

# Third round

## The black screen

`Cannot read properties of undefined (reading 'scalerank')` in `AttributeTable`.
This one was mine. I changed the features endpoint to nest attributes under
`values` and changed the table to read them there, in the same commit — but the
studio hot-reloads and the API container does not, so against an API that had not
been rebuilt every row was the old flat shape, `row.values` was `undefined`, and
the throw happened inside a `map` during render. React unmounts the whole tree
when a render throws, which is why the map went with it.

Rebuilding the container fixed it, and that is not good enough. Two changes:

- `normaliseFeaturePage` in `api.ts` accepts either shape, and a null body, and
  an array, and a string. Six tests in `apps/studio/tests/api.test.ts`.
- `ErrorBoundary` wraps the application, so a component that throws shows what
  happened and a way back instead of a black screen — and says to rebuild the
  API container, because that is what this class of error usually means.

A client and an API that disagree about a shape is a normal state of affairs
during development. It should never be fatal.

## 500 on the world tile

`AJAXError: Internal Server Error (500): /api/tiles/ne_10m_admin_0_seams/0/0/0.mvt`

Web mercator has no answer past about 85.05° of latitude, so `ST_Transform`
raises rather than guessing when a geometry reaches a pole. Natural Earth is full
of these — the admin_0 seams are lines running from pole to pole, and Antarctica
is a polygon whose southern edge is exactly −90. The z0 tile is the one whose
bounding box selects them, which is why that one tile failed and every other tile
worked.

`TILE_SQL` now clips anything straying outside the band before projecting it. The
bounding box test in the `CASE` keeps `ST_Intersection` off the other 99% of
rows, `ST_CollectionExtract` handles the mixed-dimension result an intersection
can produce, and the internal column names are prefixed with underscores, which
`check_identifier` refuses for a user column, so a table with a field called
`shape` cannot collide with them.

The endpoint also catches `asyncpg.PostgresError` and answers 422 naming the
layer and the reason, rather than a bare 500 with nothing in it.

## The first run asks the database instead of guessing

The project name stays in the header and stays editable, and Save and Share stay
as they are.

But opening with a hard-coded Tehran layer was wrong, and so was replacing it
with a hard-coded button offering that same layer — both were guesses about
somebody else's data. The `layers` table is a registry and `GET /api/layers`
reads it out, so `components/Catalogue.tsx` asks:

- an empty table of contents lists what is already in the database, with feature
  counts and CRS, and adds one on click
- it is also the first tab of **Add data**, alongside File, Link and WMS
- a layer already on the map is shown greyed rather than hidden
- if the API does not answer it says so and gives the compose command, which an
  empty black map could not — a healthy backend with no layers and a dead backend
  looked identical

The seeded demo layer appears there on its own, because it is in the registry.
Nothing about it is hard-coded any more.

The placing logic moved to `apps/studio/src/layers.ts` so the catalogue and the
import dialog share one path rather than two that drift.


---

# Fourth round

## Symbology only worked for "Single"

Reproduced in Node against the style validator rather than guessed at:

```
=== categorized ===
style errors: 1
  - layers[1].paint.fill-color: Expected at least 4 arguments, but found only 2.
```

`match` needs at least one label and output pair. A classification you have just
switched to has no entries yet, so it compiled to `["match", input, fallback]`,
the renderer rejected it, `setPaintProperty` threw, and the layer kept the colour
it already had. An empty classification is a normal intermediate state, not an
error; it now compiles to the fallback colour. Same for a graduated layer with no
breaks.

Graduated was worse in a different way. It was valid and it was useless: the
default breaks were 25, 50 and 75 over `scalerank`, which runs 0 to 10, so every
feature landed in the first class and the map went one flat colour. Classifying
without knowing what is in the column is guessing.

New endpoint `GET /api/layers/{id}/stats?field=` returns the column's type, range,
distinct count and commonest values. The appearance panel reads it and:

- fills a fresh classification from the real range or the real values
- says what the column contains, so the numbers are not a mystery
- refuses to graduate a text column and says why, instead of drawing nothing
- has a **Classify from the data** button, and offers the 24 commonest values
  when a column has more categories than a legend can hold
- `to-number` now carries a fallback, so a stray non-numeric value cannot throw

## The globe shrank when a worldwide layer was added

Framing pulled the camera out until the whole extent fitted, which for a global
layer means shrinking the planet to show data that was already on the screen.

- automatic framing after an import only moves the camera when it would help
  (`needsFraming`); an explicit "Zoom to layer" always moves
- round projections have a zoom floor, so a sphere fills the viewport instead of
  sitting in the middle of a black rectangle

## Presentation mode did nothing

Hiding the panels was not enough. `.middle` is a grid with fixed columns, so
`display: none` on the children left four tracks exactly where they were and the
map never grew. The tracks collapse now, and Escape leaves the mode.

## Hover and identify on the map

- hovering a feature highlights it and the cursor becomes a pointer
- clicking opens a panel with its attributes, a **Zoom here** and a
  **Find in table**
- **Find in table** opens the attribute table, searches for that feature, marks
  the row and scrolls it into view — it will usually be on a page you are not on,
  so paging to it was never going to work
- hovering the map and hovering a table row light up the same feature, because
  both go through the same `selection` on the project

## Legend

`chrome.legend` has been in the schema since the beginning and had never drawn
anything. It reads the classifications: bands with their ranges for a graduated
layer, entries for a categorized one.

## Smaller

- the tile clip uses `ST_ClipByBox2D(ST_MakeValid(...))` rather than
  `ST_Intersection`. It is a box clip rather than a full overlay, so it is faster
  and much harder to make raise — Natural Earth polygons are frequently
  self-intersecting, and a clip of an invalid polygon is a TopologyException.
  A column name the checker refuses now answers 422 naming it, and every tile
  failure is logged server-side.
- `schema 3` is gone from the title bar.
- catalogue entries in the 272px sidebar truncate instead of running off the end.
