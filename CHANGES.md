# What changed

## Third round

`pnpm test` runs 222 tests in Node, with no browser and no WebGL.

### 1. The badge is gone

The default marker was a pin: a coloured badge with the glyph inside it,
standing above the place it names. Asking for an emoji on a point and getting
that is a decoration nobody asked for.

A marker is now the glyph, where the point is — `shape: "none"`, `anchor: "on"`.
The pin, circle and square are still in the list for whoever wants one, but
"Just the glyph" is first and is what you get.

### 2. Emoji were being sliced off at the edges

A bare glyph was drawn at 0.95 of a canvas exactly `size` across. An emoji is not
`size` wide: the pictures in a colour emoji font run to about 1.17em, and the
dark outline a bare glyph is given adds more. Every one of them lost its edges.

The canvas is now 1.4× the glyph, so **Size: 22 px** means a 22px glyph rather
than a 22px box with a glyph crammed into it.

### 3. A better set of glyphs

The old list was twenty-four, picked for variety. The new one is eighty, grouped
the way somebody looking for one would scan: plain marks, then places, then
transport, then utilities and hazards, then land and water. Everything in it is
something people put on maps.

It is long enough to scroll rather than own the panel, and a test holds it to
whole rows of eight, no duplicates, and nothing whose code points cannot survive
being written into an image name and read back.

### 4. Glyphs sat wedged in the corner of their cells

A `button` carries the browser's own padding — `1px 6px` — which left about 14px
of content box for a 15px glyph. Flex centring on a box with no padding of its
own puts the picture where the selection ring is.

### 5. The colour picker did nothing, most of the time

A colour emoji ignores `fillStyle` and paints itself, so a colour control under
one is a control that does nothing. It is now shown only when it has an effect:
for a badge, whose background it sets, and for a plain character like an arrow or
a tick, which does take the colour it is given.

### 6. Attribute table columns are centred

Header and cell together, so a column reads as one column. The number columns
keep their monospaced face and gain `tabular-nums`, so the digits still line up
under each other now that they are no longer flush right.

---

## Second round

Six things, and finding the cause of one of them turned up a seventh that had
never been reported.

`pnpm test` covers everything below.

### 1. `circle-color[1]: Expected one argument.`

The categorized colour expression was written as

```ts
["match", ["to-string", ["get", sym.field], ""], ...]
```

reading the `""` as a default for a missing value, the way `coalesce` takes one.
`to-string` takes exactly one argument. The renderer therefore rejected the
whole paint property, the layer **kept the colours it already had**, and the only
sign of it was one line in the corner of the map. Switching a layer to Categories
looked like it did nothing.

A missing property is a `match` that hits nothing, which is what `fallbackColor`
already answers, so the argument is simply gone.

### 2. The one that was never reported

Reading an expression and believing it is correct is how the above got shipped,
so `packages/core/tests/expressions.test.ts` now runs the **real parser from the
real MapLibre style specification** over every paint value, layout value, label
template and filter the compiler can produce.

It failed on the first run, on something nobody had mentioned:

```ts
default: return [node.op, ["get", node.field], node.value];
```

The document spells equality `=`, because that is what a person writing a filter
types. Expressions spell it `==` and reject `=` as an unknown operator — and a
rejected operator fails the *entire* filter, so `setFilter` threw and the layer
went on showing every feature. **The commonest filter anybody writes did
nothing.** SQL still gets `=`, which is what SQL wants.

### 3. A marker floated over its own dot

A pin standing above a blue circle is two things where there is one. On a point
layer the marker is now the point: the circle is not drawn at all. A line or an
area cannot be replaced by an icon, so there the marker is still drawn in
addition, at the middle of each feature.

The legend follows: on a marked point layer the classification draws nothing, so
its colours are no longer listed under it.

### 4. Markers vanished when you changed their colour or size

Both are part of the name of the image a marker asks for, and registration lived
in an effect — which runs *after* the edit it is reacting to has already reached
the renderer. For one frame every marker pointed at an image that did not exist.
They came back on the next zoom, when the renderer looked again and the effect
had long since run, which is why it looked like a rendering glitch.

The name carries everything the picture is made of, so `parseMarkerId` reads it
back and `styleimagemissing` answers the renderer the instant it asks. The race
cannot be lost now, whatever order anything happens in. The eager registration
stays as a fast path, minus its `isStyleLoaded()` guard — that is false for a
moment after every basemap swap, so the registration that mattered was the one
being skipped.

### 5. The marker palette hung out of the panel

`repeat(8, 1fr)` means `repeat(8, minmax(auto, 1fr))`, and a grid item's
automatic minimum is its own content. Eight emoji wider than the panel pushed the
whole grid out through the right-hand edge. The tracks now have a zero minimum
and auto-fill, so the palette fits any panel width.

### 6. The error toast was 620px whatever was in it

`inset-inline: 60px` with `max-width: 620px` is a fixed-width box: a short
message sat in the middle of a wide empty panel. It is now as wide as its text,
up to what the map can spare, and long unbroken renderer messages wrap instead of
overflowing.

### 7. Placeholders were larger than the text that replaced them

`button` was given `font: inherit`. `input`, `select` and `textarea` were not, so
they fell back to the browser's own font — Arial at 13.33px — and a placeholder
came out visibly bigger than the value typed over it. Form controls now inherit
the document font, and `::placeholder` inherits from the control.

---

## First round

Four things were reported: markers landed in two different places depending on
which one you picked, line layers could not be hovered or identified, hovering
one point lit up several, and a green area appeared over the Pacific that nobody
had drawn. The last one turned out to have nothing to do with drawing.

Everything below is covered by a test.

## Fixes

### 1. A marker replaced the point instead of marking it

`bundleFor` treated a marker as a `Symbology` kind:

```ts
else if (layer.symbology.kind === "marker") ids.push(`${layer.id}:marker`);
```

Choosing a marker therefore deleted the layer's own drawing and put an icon
where it had been — the point stopped being a point and became the emoji, and
the layer's colours and classification went with it. Where the icon then landed
was decided by its shape:

```ts
"icon-anchor": marker.shape === "pin" ? "bottom" : "center",
```

so a pin stood above the spot and an emoji sat on top of it. One control, two
different maps, depending on a choice that was supposed to be about appearance.
Markers were also offered for point layers only.

A marker is now a decoration on the layer (`LayerNode.marker`) rather than a
classification of it:

- it is drawn **over** the layer's own symbol, so the point stays a point
- `anchor` is an explicit choice — above the feature or on it — and means the
  same thing for every shape. A badge is lifted 4px clear of what is underneath;
  a pin already ends in a point, so its bottom edge is the spot
- it works on lines and areas, where the renderer puts one at the middle of each
  feature, with an option to repeat it along a line
- a graduated layer can carry one and stay graduated

Documents written against the old shape still load: `normalise` translates them
on the way into the compiler, and the point they used to hide comes back.

### 2. A line layer could not be hovered or identified

Hit testing asked `queryRenderedFeatures` about a single pixel. That is a fair
question for a country and an impossible one for a 0.8px coastline, so line
layers were decoration — the pointer never found them and the identify popup
never opened on one.

The exact query runs first, so a click between two touching polygons still lands
on the one under the cursor. Only when it finds nothing does a four-pixel box run
as a fallback.

### 3. Hovering one airport ringed every airport

The highlight matched on one column, and when the server had not found a key
column it fell back to the first field. For Natural Earth that is `scalerank`,
which every feature shares with dozens of others, so pointing at one airport
selected all of them — which is what the yellow rings scattered across the
Pacific in the report were.

A `Selection` now carries `where`: further columns that all have to match.
Pointing at a feature takes its identity from the feature itself — up to a dozen
of its own attributes — so the highlight is the thing being pointed at and
nothing else. Everything is compared as text, because a vector tile hands back
`3` where the database held `3.0`.

### 4. A green wedge the size of the Pacific

This was reported as something the drawing tools created. They did not: drawing
caused a recompile, and the recompile is when the layer appeared.

The shape was `ne_50m_geographic_lines` — a table of lines — being drawn as an
area. `ogr2ogr` leaves a column typed plain `GEOMETRY` behind whenever the source
file held more than one shape, `geometry_columns.type` then reports `GEOMETRY`,
and the client's fallback for anything it did not recognise was:

```ts
return GEOMETRY[(reported ?? "").trim().toLowerCase()] ?? "polygon";
```

A renderer asked to fill a line closes it into a ring first. Every coastline
became an area the size of the ocean it borders.

Fixed in three places, because one was not enough:

- **The server now knows.** When the declared type is the useless kind,
  `geometry_type_of` samples `ST_GeometryType` over the rows and reports the
  commonest shape.
- **Re-importing now helps.** `ON CONFLICT DO UPDATE` did not update
  `geometry_type` or `source_crs`, so a layer registered once with a bad type
  kept it for ever — re-importing the file fixed the table and changed nothing
  the studio could see.
- **The guess is safer.** `geometryOf` understands `ST_` prefixes and `Z`/`M`
  suffixes, and when the table will not say it guesses a line. Drawing an area as
  a line is the same map with the fill missing. Filling a line is a continent.

Detection can still be wrong, so **Drawn as** in the inspector lets you say what
a layer is without re-importing it.

---

## Earlier

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


---

# Fifth round

## Hover picked the wrong features

Highlighting matched on whatever column happened to come first. For Natural Earth
that is `scalerank`, which every country shares with dozens of others, so
hovering one country lit up all of them.

A key has to be unique or it is not a key. The server now works out which column
is — `count(DISTINCT col) = count(*)`, tested rather than assumed, cached per
layer — and returns it as `key` from `/api/layers/{id}` and `/features`. Layers
carry it in `metadata.key`. A table with no unique column falls back to the first
field and behaves as before, which is the honest outcome rather than a wrong one.

## The identify panel opened in the wrong place

It was positioned with `clientX`/`clientY`, which are relative to the window, but
placed inside the map container, which starts after the rail and the sidebar. So
it appeared about 320 pixels right and 40 down from the feature. It now uses
`e.point`, which is what the container's coordinates are, and flips to the other
side of the cursor when there is no room.

## The overview flashed black on every hover

Its basemap effect depended on the basemap object, and every edit to the project
produces a fresh one because the manager deep-clones on update. Hovering the map
edits the project once per feature, so the overview tore down and rebuilt its
layers continuously. It now depends on the id, background and tile URLs — what it
actually draws, rather than the identity of the object holding it.

## 500 when importing some Natural Earth files

`check_identifier` only accepted `^[a-z][a-z0-9_]{0,50}$`. Natural Earth breaks
that three ways: uppercase names, leading underscores, and names over fifty one
characters. A file with one of those registered fine and then answered 500 on the
first query that named its columns — with the reason only in the container log.

Column names now go through `quote_column`, which validates against a wider but
still injection-proof pattern and double-quotes the result, so PostgreSQL takes
it literally. A name that still cannot be used answers 422 saying which one, via
a `ValueError` handler on the app.

Table names are unchanged: a table name is ours to choose, a column name arrives
with the data.

## Enabling globe threw the camera into orbit

It eased to zoom 2.2. Now 4, which is still perfectly round and still shows you
roughly where you were.

## The table of contents

Rebuilt. It was eleven-pixel rows with a swatch the size of a full stop and an
add button that was a bare `+` in a corner.

- 34px rows, a real swatch, and a second line saying what the layer is —
  geometry, how many classes and on which field, whether it is filtered
- a full-width **Add layer** button
- drag and drop reordering, within a list; dragging between groups is a different
  gesture and pretending a plain drop does it would move layers nowhere anyone
  asked for
- open and closed eye icons rather than `◉` and `○`
- slot headings say what they mean on hover and count what is in them

## Markers

Point layers can be drawn as an emoji or glyph on a pin, circle, square, or on
its own, with a colour and a size.

Vector tiles carry no emoji and the map's glyph set has none, so `text-field`
comes out blank — the glyph is rasterised to a canvas by the browser, which does
have emoji fonts, and registered with `addImage`. The image is named after the
symbology, so two layers using the same pin share one image and changing the
glyph asks for a different name rather than mutating one already being drawn.

## Open data tab

Sixteen Natural Earth datasets — boundaries, places, physical, transport,
reference — importable with one click through the ordinary from-url route.
Nothing is special-cased; each lands in PostGIS and comes back as vector tiles.

## On using turf for the zoom

Turf computes a bounding box from geometry. The bounding boxes here come from
PostGIS (`ST_XMin` and friends, and per-row in the features endpoint), which is
the same number computed by the database that holds the data, without shipping
the geometry to the browser to measure it.

What turf does not do is work out a camera position, and that is the part that
was wrong. It now lives in `packages/core/src/frame.ts` with eighteen tests,
including one asserting that the flat and round centres of a worldwide extent
differ by more than five degrees — which was the bug.
