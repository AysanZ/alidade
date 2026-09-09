# Imagery

Satellite and aerial imagery arrives as a pile of `.tif` files. Each one covers a
patch of ground and was taken at an instant. Several of them cover the *same* patch
of ground at *different* instants, and the whole point of holding them together is
being able to move between them.

Three jobs, then:

1. Put each file on the map where it actually belongs, rather than where its filename
   suggests.
2. Say which of the overlapping files the pixels under the cursor should come from.
3. Let that answer change — by date, by resolution, by hand — without the layer
   flickering or the user hunting a list.

<img src="images/imagery.svg" alt="How an imagery layer decides what to draw" width="900">

---

## One noun, not two

The first design had two: a **scene** was one file, and a **series** was a named
collection of scenes over the same ground with a clock attached — one row in the table
of contents and a time slider in the inspector.

What shipped has only the file. There is a **catalogue** of images and there is a
**rule** that says which of them to draw, and a series turned out to be a special case
of the rule rather than a thing of its own.

The argument against the series survived; it just moved. Two scenes overlapping is not
evidence they belong together — a Sentinel-2 tile and a drone orthophoto over the same
city are the same ground and emphatically not the same series — so somebody would have
had to declare the grouping, and declaring it is work done at import to answer a
question that is only asked at view time. `newest` and `closest to a date` answer it
without anyone declaring anything, and they go on answering it when a fifth file turns
up next month that nobody remembered to add to the group.

What was lost with the series is the shared stretch: two dates of the same field, each
stretched to its own percentiles, differ in brightness because the stretch differs and
the user reads that as the ground having changed. The rendering is therefore a property
of the *layer* and not of the image — one stretch, one band combination, for everything
the layer draws — which is the same protection by another route.

---

## The catalogue

One table, in `data/init/02_imagery.sql`. One row per GeoTIFF; the pixels live on a
volume, the way uploaded `.glb` models already do.

Column names follow [STAC](https://stacspec.org) wherever STAC has a name for the
thing — `gsd`, `proj:epsg`, `eo:cloud_cover` — so the search endpoint can answer with an
ItemCollection without translating on the way out, and anything that speaks STAC can
read the catalogue without being told about Alidade. Inventing `pixel_size` and
`source_crs` would have cost nothing that day and the whole interoperability story
later.

Two columns carry most of the design.

**`footprint` is a polygon, not a bounding box.** A satellite scene is a rotated
quadrilateral with nodata in its corners, and its box claims ground the file has no
pixels for. A registry that stores a box will tell somebody an image covers their view
when it does not, will sort it above one that really does, and will draw its outline in
the wrong place. Everything else here — coverage, `centre` sorting, which images a tile
is built from — is a lie without it.

**`captured_at` may be null, and that is legal rather than broken.** STAC allows a null
`datetime` for an item with no meaningful single instant, and a great many exported
GeoTIFFs carry no acquisition tag at all. An undated image is drawn, listed and searched
like any other. It sorts last under every date rule rather than being dropped, because a
list that silently omits it makes the count in the panel a number nobody can reconcile
with what is on the screen.

`captured_from` records *where* the date came from — `tag`, `filename` or `user` — so a
date somebody typed is never indistinguishable from one the file stated.

---

## Where the date comes from

Look in this order, and stop at the first that answers:

1. `TIFFTAG_DATETIME` in the file's metadata.
2. `ACQUISITIONDATETIME`, `ACQUISITION_DATE`, `DATE_ACQUIRED` — what GDAL surfaces for
   several satellite drivers.
3. The filename. Sentinel-2 puts the instant in the granule name
   (`S2A_MSIL2A_20240712T071621_T39SVB`), Landsat puts the date in its scene id, and a
   great many exported files are simply called `something_2024-07-12.tif`. Four
   patterns catch most of it, most specific first; eight bare digits are tried last
   because they are the most likely to be something else entirely.
4. Ask the user.

The year has to be plausible before a filename match is believed, which is the whole
check that stops `run_12345678.tif` becoming the twelfth of March 1234. It is
deliberately generous — a scanned sheet from 1908 is a real thing somebody will load —
and it is still enough, because the numbers that turn up in filenames by accident are
serial numbers, and serial numbers are not in that range with a valid month and day
attached.

**Never the file's modification time.** An upload date presented as a capture date is a
wrong map that looks like a right one: the dates will be in a plausible order, the
sorting will work, and every one of them will be a lie about when the ground was
photographed. An image whose date is unknown says so and asks. That is worse to look at
and better to trust.

---

## Import: a COG, not a pyramid

A `.tif` cannot be handed to MapLibre; something has to turn it into tiles. There were
two honest ways and the choice mattered.

Baking a pyramid at upload with `gdal2tiles.py --xyz` needs no new dependency —
`gdal-bin` is already in the API image — and produces a folder of PNGs any static server
can hand out. But it bakes in one rendering: a 16-bit multiband scene has to be squashed
to 8-bit RGB *before* the pyramid is written, so which bands and which stretch is
decided once, by whoever uploaded it, permanently. For satellite imagery, where "show me
the near infrared" and "restretch that, it is all white" are the two commonest things
anyone says, that is the wrong trade.

So: one Cloud-Optimised GeoTIFF per image, and tiles rendered on demand by
[`rio-tiler`](https://cogeotiff.github.io/rio-tiler/). One file instead of thousands.
Band selection, stretch and colour become query parameters rather than decisions frozen
at import. The cost is a dependency — `rio-tiler` pulls `rasterio`, which carries its own
GDAL build and adds a little under a hundred megabytes to the image — and it is the
price of the imagery being interrogable rather than merely visible.

```
gdalwarp -t_srs EPSG:3857 -r bilinear -of COG \
         -co COMPRESS=DEFLATE -co BLOCKSIZE=512 -co OVERVIEWS=AUTO \
         -co NUM_THREADS=ALL_CPUS -multi \
         upload.tif  stored.tif
```

Reprojecting to web mercator once at import rather than warping per tile is the
difference between a tile that renders in milliseconds and one that renders in a second.
The overviews are what make a zoomed-out request read a small pyramid level instead of
the full raster.

`gdalinfo -json` is run **twice, on purpose**. The original is described first, because
that is where the acquisition tags are: `gdalwarp` writes a new file and does not carry
every vendor tag across it. The warped file is described second, because the footprint
and the ground sample distance have to be the ones the tiler will actually read. The
declared CRS is taken from the original — after the warp everything is 3857 and
`proj:epsg` would say so for every image in the catalogue, which is true and useless.

Conversion is synchronous today. That is honest for a first cut and wrong for a
gigabyte: `gdalwarp` on an 800 MB scene takes tens of seconds and a request held open
that long times out behind Nginx. The row carries a `state` column — `converting`,
`ready`, `failed` — so moving this onto a background task is a change to one function
and to nothing else.

---

## The rule: sort the candidates, then resolve the pixels

Two independent settings, and the vocabulary is Esri's, because a mosaic dataset has
been answering this question for thirty years and there is nothing to gain from new
names.

**Sort** decides the order of the images that cover the tile:

| | |
|---|---|
| `newest` | Most recent first. The default. |
| `closest` | By how far each date is from a target date. A far better question than "the newest" when you are looking at a particular week. |
| `sharpest` | Finest ground sample distance first: a 5 cm survey over a 10 m tile. |
| `centre` | Best covering of the current view first, so you are not shown the corner of a scene when a better-placed one exists. |
| `lock` | This image and nothing else. |

Locking is one rule among several rather than the only way to see anything. With four
images each covering part of the view, drawing only the chosen one means looking at a
mostly empty map and hunting the list for whichever file happens to reach the corner in
question.

**Overlap** decides what happens where the sorted images cover the same pixel: `first`,
`blend`, `mean`, `max`. Today `blend` and `mean` both reach `rio-tiler`'s `MeanMethod`
and `max` reaches `HighestMethod`; a real feathered blend across a seamline is not
implemented, and the setting is kept distinct so that when it is, no document has to
change.

At most `MAX_MOSAIC_ASSETS` images — six by default — are read for any one tile. Reading
a hundred COGs for one tile is not a mosaic, it is a timeout, and past a handful the
ones underneath are never seen anyway.

A tile outside every footprint answers **204, not 404**. It is not an error: an image
covers a patch and the renderer asks for the whole viewport, so every tile of sky around
the scene would be a red line in the console — and the first thing anybody does with a
console full of red is conclude the feature is broken.

Every tile carries an `X-Alidade-Images` header naming the images it was actually built
from, which is invaluable the moment the map shows something nobody expected and the
question is which file did it.

---

## Rendering

Three modes, one of which is the reason any of this was worth building.

- **`rgb`** — three bands, `bidx=4&bidx=3&bidx=2` for a true-colour composite of a
  sensor whose bands are in that order, or `8,4,3` for false colour.
- **`single`** — one band and a named colour ramp.
- **`expression`** — arithmetic on the bands. `(b8-b4)/(b8+b4)` is NDVI. NDWI, a burn
  index and a ratio nobody has thought of yet are one string each and cost nothing on
  disk; the alternative is a derived raster per index per date, which is how a folder of
  four files becomes a folder of forty.

There is deliberately **no default band selection**. Naming 1, 2, 3 looks sensible and
is not: a catalogue is rarely all one sensor, and asking a single-band elevation raster
for its second and third bands is an error rather than a plain-looking picture. Sending
nothing lets the reader use whatever the file declares, which is right for every file,
and the panel is there for when it is not.

Something must map 16-bit values into a byte. If no `rescale` is given and the data is
not already `uint8`, the tiler stretches by the tile's own statistics — because doing
nothing draws a Sentinel band as a white rectangle, and a white rectangle reads as a
broken tile rather than as a missing setting.

A colour ramp only means anything over one band of numbers. This was a real defect
worth keeping written down: the ramp used to be sent whenever one was set, whatever the
mode, so choosing a ramp in expression mode and switching back to RGB went on sending
it, the tiler refused to map a ramp over three bands, every tile came back an error, the
imagery vanished — and putting the ramp back did not bring it back, because the ramp was
never the thing that was wrong. A setting that is inert in the current mode must not be
transmitted. The server ignores it as well, from the other side, so neither half can
make the layer disappear on its own.

There is no tile `buffer`. `rio-tiler`'s `buffer` adds its pixels to the output rather
than cropping them away, so `buffer=0.5` returns a 257×257 tile for a source declaring
256, which the renderer scales to fit and puts every tile very slightly out of register
with its neighbours. Killing the resampling seam at tile edges is worth doing, but not
by lying about the tile size.

---

## The document

What a project stores is the rule and the rendering — never the catalogue:

```ts
export interface ImagerySettings {
  /** Where the catalogue and the tiler are. Relative, so one document works everywhere. */
  endpoint?: string;
  rule: MosaicRule;
  overlap: Overlap;
  render: ImageryRender;
}
```

This is the live layer's rule again: the address and the settings are the map, and what
happens to be at that address is not. A project reopened next month should show what is
in the registry then, rather than a frozen list of filenames half of which have since
been deleted.

The tile template is derived from the settings at compile time and never authored. The
query is built as ordered pairs rather than from an object so that two equal settings
produce character-identical URLs: the reconciler compares tile templates as strings, and
a template whose parameters shuffled between renders would look like a changed source on
every edit and rebuild the layer for nothing.

`maxzoom` on the source is the finest image's own resolution expressed as a zoom. Past
the detail the data holds, the renderer should stretch the last real tile rather than ask
the server for pixels nobody photographed.

### Two implementations of one sort

The client sorts to say which images are contributing and to draw the footprints; the
server sorts to decide which pixels to read. They are the same rules, deliberately in
the same words, in `packages/core/src/imagery.ts` and in `_order` in
`services/api/app/routers/rasters.py`.

That is a risk worth naming rather than hiding: if the two ever disagree, the panel
highlights one image while the map draws another, and nothing on screen says which is
wrong. The alternative — the server telling the client what it chose, per tile — costs a
round trip before anything can be drawn. Both sides have tests over the same fixtures,
and a change to one is a change to both.

---

## The endpoints

```
POST   /api/rasters                      upload a .tif, .tiff or .jp2
GET    /api/rasters                      the whole catalogue, as STAC
GET    /api/rasters/search               ?bbox=&datetime=&intersects=  → ItemCollection
GET    /api/rasters/{id}                 one image, as a STAC Item
PATCH  /api/rasters/{id}                 title, date, sensor, cloud, note
DELETE /api/rasters/{id}                 the row and the file
GET    /api/rasters/{id}/asset           the COG itself
GET    /api/rasters/{id}/preview.png     a thumbnail, for the browser cards
GET    /api/rasters/{id}/tilejson.json   bounds, zooms and attribution from the server
GET    /api/rasters/tiles/{z}/{x}/{y}.png    a mosaicked tile, under the rule
GET    /api/rasters/point/{lon},{lat}    the pixel values under a click
```

`/search` takes STAC's own vocabulary, including its half-open intervals: `../2024-01-01`
and `2024-01-01/..` are the specification's way of saying "up to" and "from", so they are
what this accepts. It is the sidebar's query on every map move *and* a STAC API search,
which costs nothing extra and means `pystac`, a STAC browser or QGIS's STAC plugin can
read the catalogue as it is.

`/point` is the raster counterpart of clicking a feature: it answers with the values
under the cursor, from whichever image the rule puts on top, so the imagery can be asked
a question rather than only looked at.

Edits never touch the file. A PATCH is kept in the registry and the `.tif` stays byte for
byte what was uploaded, so what the file said and what the user said remain two facts
rather than one overwritten one.

---

## The interface

**Add data → Imagery.** Drop `.tif` files. Each is converted and indexed, and what came
out of it — extent, date, where the date came from, bands, size, resolution — is shown
*before* anything is added to the map. That order matters: a file whose date could not
be found is something to notice now, while the person still remembers what the file was,
rather than three weeks later when it sorts last and nobody knows why.

**One row in the table of contents**, however many files are behind it, with the usual
eye, opacity and inspector.

**The browser lives in the sidebar, not along the bottom.** It is the contents of the
imagery layer and the sidebar is where a layer's contents belong — and it gives the
pictures a column instead of a strip. A horizontal row of thumbnails shows six at a time
and hides the rest behind a scroll nobody discovers; two columns down the side show a
dozen at once, which is the number that makes a gap in a date range visible at all. Each
thumbnail is a real read of the image. The first version derived a colour from the
filename, and it was useless: every card looked like every other card, so the strip told
you how many images there were and nothing else.

It asks about **this view** or about **everything**, or about an area you draw, because
those are different questions and the count means something different for each.

**The table is the other half.** Every field of every image, sortable, nothing behind a
hover: the footprint table of a mosaic dataset by another name, and the half a GIS user
actually works with once there are a hundred images.

**The inspector is split down the middle, and labelled.** The mosaic rule and the
rendering belong to the layer; the title, the date, the sensor and the note belong to
one image. Blurring the two is exactly where somebody sets a stretch for a single date
and cannot work out why every other date changed with it.

---

## The parts that bit

**A bounding box cannot be checked against anything.** Rows written before the registry
validated its own footprints hold web mercator metres, because `gdalinfo` reports corner
coordinates in the file's own CRS and the file had been warped to 3857 by then. Framing
such a row put the image in the middle of a continent — centred correctly, at a zoom
that showed nothing. Two repairs: those boxes are recognised and inverted on read, since
the numbers are right and only the units are wrong; and framing now uses width × gsd,
which is a fact about the file that cannot be wrong in a way the file agrees with. The
first attempt believed the box unless it was more than eight times too wide, which let
merely somewhat-wrong boxes through — and somewhat too wide is still two zoom levels out.

**Coverage is an estimate on the client and exact on the server.** The exact answer is
the area of the union of the footprints clipped to the view, which only PostGIS can work
out, and it is what the server reports per image. The panel combines those single
figures for a set, assuming each image is as likely to fall on a gap as on ground
already covered, and says so rather than presenting arithmetic as measurement.

---

## What is not done

Roughly in the order it is worth doing, and argued at length in
[prior art](imagery-prior-art.md):

- **Background conversion**, with a progress endpoint. The `state` column is already
  there for it. This is the one that stops being cosmetic the first time somebody
  uploads a real scene.
- **TileJSON on the layer**, so bounds, zoom range and attribution come from the server
  that knows them instead of being copied into the document at import and going stale.
  The endpoint exists; the source does not read it yet.
- **A real blend** across a seamline, rather than the mean.
- **Edge buffering**, cropped properly, to kill the faint grid of resampling seams.
- **Pins** — a camera position, an image and a set of rendering settings, saved
  together and shareable. `Bookmark` already exists and is half of it.
- **Compare**, by swipe and by opacity. Both: a slow crossfade shows a small change over
  a wide area that a hard edge cuts straight through.
- **Timelapse export**, which is the demonstration that makes the feature obvious.
- **WMTS output**, after which QGIS and ArcGIS can read Alidade's imagery.
- **`cog://` for pasted links**, so a public COG can be registered without copying a
  gigabyte first.
