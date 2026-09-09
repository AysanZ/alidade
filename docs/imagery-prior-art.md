# Prior art

Imagery in a web GIS is a solved problem with a mature vocabulary, and most of what the
browser needed already had a name, a specification and a reference implementation. This
is what the field does, which parts of it were taken, and what is still outstanding.

Most of the first half of this document has since been built — footprints, coverage,
STAC field names, band maths, the sorting rules and the search endpoint. [The imagery
notes](imagery.md) describe what exists; this describes where it came from and what it
was weighed against. The table at the end says which is which.

---

## TiTiler — the same stack, already built

[TiTiler](https://developmentseed.org/titiler/) is Development Seed's dynamic tile
server: FastAPI plus rasterio and GDAL. That is the API Alidade already is. It is worth
reading its endpoint list as a specification rather than as a product, because every
query parameter on it is a design decision somebody has already argued about.

The core route is
`/cog/tiles/{tileMatrixSetId}/{z}/{x}/{y}[.{format}]`, and the parameters that matter:

| Parameter | What it is for |
|---|---|
| `bidx` | Which bands, repeatable — `bidx=8&bidx=4&bidx=3` is a false-colour composite |
| `expression` | Band maths — `expression=(b8-b4)/(b8+b4)` is NDVI, with no new file |
| `rescale` | `min,max` per band, repeatable, so each band stretches on its own |
| `colormap_name` | A named ramp for single-band output |
| `nodata` | Override what the file claims |
| `resampling` | And `reproject` separately, for the warp kernel |
| `buffer`, `padding` | Extra pixels each side, to kill resampling seams at tile edges |
| `algorithm` | Server-side operations such as hillshade |
| `unscale` | Apply the dataset's own scale and offset |

Alongside the tiles: `/cog/info`, `/cog/statistics`, `/cog/point`, `/cog/bbox/...` for a
clipped export, `/cog/validate`, WMTS, and `/cog/tilejson.json`.

**What to take.**

*`expression` is the big one.* It is the difference between imagery you can look at and
imagery you can ask questions of. NDVI, NDWI, a burn index and a band ratio nobody has
thought of yet are all one query parameter, and none of them costs a single byte on
disk. Precomputing an index raster per index per date is the alternative, and it is how
a folder of four files becomes a folder of forty.

*`buffer`/`padding` is the detail nobody predicts.* Resampling a tile independently of
its neighbours leaves a visible seam on every tile boundary — a faint grid over the
whole image that looks like a rendering bug because it is one. Reading a couple of
pixels past the edge and cropping fixes it. Worth writing down before the first bug
report rather than after.

*TileJSON rather than a hand-built template.* `VectorSource` in `types/project.ts`
already takes a `url` to a TileJSON document instead of a `tiles` array, with a comment
explaining why. Raster wants the same: the bounds, the min and max zoom and the
attribution then come from the server that actually knows them, rather than being
copied into the document at import and going stale.

---

## STAC — the metadata model, and it already agrees with us

[STAC](https://stacspec.org/en/about/stac-spec/) is the specification for cataloguing
exactly this: an **Item** is a GeoJSON Feature with an `id`, a `bbox`, a `geometry`, a
`properties` bag and a dictionary of `assets`; a **Collection** groups Items and
declares a spatial and temporal extent.

Three things in it are directly relevant.

**A null date is legal.** `datetime` is the required searchable timestamp, but the spec
allows it to be `null` where there is no meaningful single instant, in which case
`start_datetime` and `end_datetime` carry the interval instead. The undated `.tif` is
not a broken case that needs fixing before the file is usable — the standard has a
representation for it. That is worth knowing, because it means the design in the mockup
is the conventional one and not a workaround.

**Use its field names.** `gsd` for ground sample distance, `proj:epsg` for the source
CRS, `eo:cloud_cover` for cloud percentage, `eo:bands` with `name` and `common_name`
per band. Inventing `pixel_size` and `source_crs` costs nothing today and costs the
whole interoperability story later.

**The search is the strip's query.** A STAC API's `/search` takes `bbox`, `datetime`
and `collections` and returns matching Items. That is precisely the request the bottom
strip makes on every map move. Building the registry to answer that shape means the
strip and an external catalogue are the same client code.

**What to take.** Make the raster registry emit STAC. `GET /api/rasters/search?bbox=…`
returning an ItemCollection is barely more work than returning a bespoke JSON array,
and the payoff is real: QGIS's STAC plugin, `pystac`, `stac-browser` and TiTiler's own
STAC endpoints all read it without being told about Alidade, and pointing Alidade at
Earth Search or the Planetary Computer becomes the same code path as reading its own
catalogue.

---

## ArcGIS mosaic datasets — the mature answer to overlap

Esri's mosaic dataset is thirty years of argument about what to do when many rasters
cover the same ground, and the vocabulary is worth borrowing wholesale.

A mosaic dataset holds a **footprint** per raster and resolves a view through two
independent settings:

**Mosaic method** — how the candidate images are *sorted*:

- *By Attribute* — sort by a field's distance from a base value. With a date field and
  a base date, that is "closest to July 2024", which is a far better question than
  "the newest".
- *Closest to Center* — the image whose centre is nearest the middle of the display
  wins, which avoids showing someone the corner of a scene when a better-centred one
  exists.
- *North-West*, *Closest to Nadir*, *Closest to Viewpoint*, *Seamline*.
- *Lock Raster* — show these specific ones and ignore every other rule.
- *None* — table order.

Sorting runs on `ZOrder` first, then pixel size, then the chosen method.

**Mosaic operator** — how overlapping *pixels* resolve once sorted: First, Last, Min,
Max, Mean, Blend, Sum.

**What was taken.** The mockup had Lock Raster and nothing else: the user picks one file
and sees one file. That is a reasonable default and it is not enough. When four images
each cover part of the view, picking one means looking at a mostly empty map, and the
user has to hunt the list for the one that happens to cover the corner they care about.

So *newest*, *closest to a date*, *sharpest* and *closest to centre* sit beside *lock*,
and the map shows the best available imagery everywhere at once; picking one image is
now a way to override that rather than the only way to see anything. Two controls, both
named by somebody else, and the pixel operator alongside them.

The other thing to take is the **footprint**. A satellite scene is a rotated
quadrilateral with nodata in the corners; its bounding box is meaningfully larger than
the scene and includes ground the file has no pixels for. A registry that stores a bbox
will tell the user an image covers their view when it does not.

---

## MosaicJSON — the implementation of the above

[MosaicJSON](https://developmentseed.org/cogeo-mosaic/) is Development Seed's spec for
the same idea, described by its authors as a GDAL VRT but indexed by web mercator
quadkeys. The document is essentially `tiles: { quadkey: [asset urls] }`, where each
quadkey is at the mosaic's minzoom and the parent tile is computed for anything deeper.
`cogeo-mosaic` builds one `from_urls` or `from_features`, and takes STAC Items as
features directly.

The companion piece is `rio-tiler`'s pixel selection — first, highest, lowest, mean,
median, stdev — which is the mosaic operator by another name.

**What to take.** If the sorting rules above get built, this is what they should be
built on rather than a hand-rolled index. It also gives the answer to "how does one
tile endpoint serve a hundred scenes" for free.

---

## The MapLibre side

**[maplibre-cog-protocol](https://github.com/geomatico/maplibre-cog-protocol)** adds a
`cog://` URL protocol to MapLibre. A COG is read straight from cloud storage with HTTP
range requests, decoded in the browser with geotiff.js, and drawn as an ordinary raster
source — no tile server at all. It handles RGB, greyscale, paletted, CMYK, YCbCr and
CIELab by reading the file's own `PhotometricInterpretation`, does DEMs as hillshade or
3D terrain, applies ColorBrewer and CARTOColors ramps to single-band rasters, and takes
a custom per-pixel colouring function with access to every band.

**[maplibre-gl-raster](https://github.com/opengeos/maplibre-gl-raster)** goes further:
a deck.gl GPU pipeline, client-side mosaics, and — interestingly — three interchangeable
backends behind one settings panel, so the same controls drive browser rendering, a WASM
tiler, or a remote TiTiler.

**What to take.** Not the architecture — for an 800 MB local file, converting once to a
COG on the server and serving tiles is right, and pushing that file through a browser is
not. But two things:

The **Link** tab should accept a COG URL and register it without downloading anything,
the way the existing Link tab already does for vector data through `/vsicurl/`. Someone
pasting a link to a public COG should not wait for a gigabyte to copy.

And the **per-pixel colour function** is the client-side twin of TiTiler's `expression`.
Between them they make the point: the interesting question for imagery is never "show me
the file", it is "show me this arithmetic on the file".

---

## EO Browser — the interaction vocabulary

The Sentinel Hub [EO Browser](https://www.sentinel-hub.com/explore/eobrowser/), now
continued as the Copernicus Browser, is the most-used imagery browser on the open web,
and its feature list is a good specification for what people expect.

**Pins.** A pin saves a location together with the scene and the visualisation settings,
takes a description, and can be shared as a link or exported as JSON. The compare panel
is then built from pins rather than from whatever happens to be selected.

This is better than the mockup's compare button, and it composes with the rest of
Alidade: a pin is a bookmark that also remembers which image and which band combination,
and `Bookmark` already exists in the document as a named camera position.

**Compare by split *or* opacity.** Both, chosen by the user. The mockup has the split
and should also have the blend — a slow crossfade shows a small change over a wide area
that a hard edge cuts straight through.

**Effects.** Per-channel gain, plus contrast and gamma, live.

**Filters that matter.** Date range, cloud cover, and — from the same family of tools —
sun elevation, and *only show images that fully cover the area of interest*. Each result
reports what percentage of the area it actually covers.

That coverage figure was the single most useful thing on this list, and it is why the
registry stores a footprint. "9 images here" is ambiguous between nine images of this
ground and nine that clip one corner of the view, and those are completely different
answers.

**Timelapse.** Pick a date range and a frequency, and the tool assembles the available
scenes into an animation to download.

---

## Where each of these ended up

| | | State |
|---|---|---|
| **1** | Footprint geometry per image, not a bbox | **Done.** A `geometry(Polygon, 4326)` with a GIST index. Everything else depended on it |
| **2** | Coverage % of the current view, on every card | **Done.** Exact on the server against the real footprint, estimated on the client for a set |
| **3** | STAC field names and a nullable `datetime` | **Done.** The registry stores them and `/search` answers an ItemCollection |
| **4** | `expression` for band maths | **Done.** NDVI and every other index, with no new files |
| **5** | TileJSON for raster sources | **Half.** The endpoint answers; the source still carries a `tiles` array |
| **6** | Opacity blend beside the swipe | Not started. Neither half of compare exists yet |
| **7** | `bbox`/`datetime` search endpoint returning STAC | **Done.** It is the sidebar's own query on every map move |
| **8** | Sorting rules — closest to date, sharpest, closest to centre | **Done**, with `lock` and the pixel operator beside them |
| **9** | Pins: scene + visualisation + view, shareable | Not started. `Bookmark` is the camera half of it |
| **10** | MosaicJSON behind the sorting rules | Not started, and correctly so: the rules are answered from PostGIS today, and a quadkey index is worth it only once the catalogue is large enough to hurt |
| **11** | WMTS output | Not started |
| **12** | Timelapse export | Not started |
| **13** | `cog://` for pasted links | Not started. The Link tab still reads vector data only |

One to four were the ones that changed the data model, which is why they were done
first and why they were worth arguing about at this length. What is left can arrive in
any order.

Two things on this list turned out differently in the building, and both are argued in
[the imagery notes](imagery.md): the *series* was dropped in favour of the rule, and
`buffer`/`padding` was tried and reverted, because `rio-tiler` adds those pixels to the
output rather than cropping them away and the tiles came back 257 across.
