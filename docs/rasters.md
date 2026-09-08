# Raster time series

Satellite imagery arrives as a pile of `.tif` files. Each one covers a patch of ground
and was taken at an instant. Several of them cover the *same* patch of ground at
*different* instants, and the whole point of holding them together is being able to
move between the dates.

This is what Alidade needs to do with them:

1. Put each file on the map where it actually belongs, rather than where its filename
   suggests.
2. Recognise that several files are the same place at different times.
3. Let the user move between those times without the layer flickering.

---

## The shape: a scene, and a series

Two nouns, and the distinction is the whole feature.

A **scene** is one file: one extent, one instant, one set of bands. It is the thing
that exists on disk.

A **series** is a named collection of scenes over the same ground. It is the thing
that exists on the map — one row in the table of contents, one entry in the legend,
one opacity slider — with a clock attached.

A series is not inferred. Two scenes overlapping is not evidence they belong together:
a Sentinel-2 tile and a drone orthophoto over the same city are the same ground and
emphatically not the same series, and a map that merges them will show the user a
"time slider" that jumps between two different sensors at two different resolutions.
The user says which scenes are a series, or the upload does, and nothing guesses.

A scene with no series is still a scene, and draws on its own. That is the common case
on the first day.

---

## Serving: COG, not a tile pyramid

A `.tif` cannot be given to MapLibre. Something has to turn it into tiles.

There are two honest ways, and the choice matters:

**Bake a pyramid on upload** with `gdal2tiles.py --xyz`. Zero new dependencies —
`gdal-bin` is already in the API image — and the output is a folder of PNGs that any
static file server can hand out. But it bakes in one rendering. A 16-bit multiband
scene has to be squashed to 8-bit RGB *before* the pyramid is written, so the choice of
which bands and which stretch is made once, by whoever uploaded it, permanently. For
satellite imagery, where "show me NIR" and "restretch that, it is all white" are the
two most common things anyone says, this is the wrong trade.

**Store a Cloud-Optimised GeoTIFF and render tiles on demand** with
[`rio-tiler`](https://cogeotiff.github.io/rio-tiler/). One file per scene instead of
thousands. Band selection, rescaling and colour maps become query parameters rather
than decisions frozen at import. This is what TiTiler does, and what Alidade should do.

The cost is a dependency: `rio-tiler` pulls `rasterio`, which carries its own GDAL
build and adds a little under a hundred megabytes to the image. That is the price of
the imagery being interrogable rather than merely visible, and it is worth it.

### Import

```
gdalwarp -t_srs EPSG:3857 -r bilinear -of COG \
         -co COMPRESS=DEFLATE -co BLOCKSIZE=512 -co OVERVIEWS=AUTO \
         upload.tif  scene.tif
```

Reprojecting to web mercator at import rather than warping per tile is the difference
between a tile that renders in milliseconds and one that renders in a second. The
overviews are what make a zoomed-out request read a small pyramid level instead of the
full raster.

`gdalinfo -json` on the result gives the extent, the band count, the data type, the
nodata value and the native resolution in one call, and everything the registry needs
comes from there rather than from the request.

### The endpoint

```python
# services/api/app/routers/rasters.py
from rio_tiler.io import Reader

@router.get("/{scene_id}/{z}/{x}/{y}.png")
async def raster_tile(scene_id: str, z: int, x: int, y: int,
                      bands: str | None = None, rescale: str | None = None,
                      colormap: str | None = None) -> Response:
    scene = await rasters.get(scene_id)          # path comes from the registry
    if scene is None:
        raise HTTPException(404, f"No scene named {scene_id}.")

    indexes = [int(b) for b in bands.split(",")] if bands else None
    with Reader(scene.path) as src:
        image = src.tile(x, y, z, indexes=indexes, tilesize=256)

    return Response(
        image.render(img_format="PNG", **render_options(scene, rescale, colormap)),
        media_type="image/png",
        headers={"Cache-Control": f"public, max-age={settings.tile_cache_seconds}"},
    )
```

It sits beside `/api/tiles/{layer}/{z}/{x}/{y}.mvt` and answers the same shape of
question. The client does not care that one is built by PostGIS and the other by
rasterio.

**A tile outside the scene's extent is a 204, not a 404.** `rio-tiler` raises
`TileOutsideBounds`, and it is not an error: a scene covers a patch and the renderer
asks for the whole viewport. A 404 puts a red line in the console for every tile of
sky around the image, and the first thing anybody does with a console full of red is
assume the feature is broken.

### Rescaling

A 16-bit Sentinel band drawn with an 8-bit stretch is white. `gdalinfo -stats`, or
`rio-tiler`'s own statistics, gives the 2nd and 98th percentile per band at import
time, and that pair is stored on the scene and used as the default rescale. It is a
default and not a rule — the query parameter overrides it — but it is the difference
between an image that appears and an image the user has to know to fix.

**Every scene in a series is stretched by the series, not by itself.** Two dates of
the same field, each stretched to its own percentiles, differ in brightness because
the stretch differs, and the user reads that as the ground having changed. The series
holds one rescale, computed across its scenes, so moving through time shows what moved.

---

## Where the date comes from

This is the part that quietly decides whether the feature is trustworthy.

Look in this order, and stop at the first that answers:

1. `TIFFTAG_DATETIME` in the file's metadata.
2. `ACQUISITIONDATETIME`, which is what GDAL surfaces for several satellite drivers.
3. The filename. Sentinel-2 products carry the instant in the granule name
   (`T39SVB_20240712T071621`), Landsat carries the date in its scene id, and a great
   many exported files are called `something_2024-07-12.tif`. A small set of patterns
   catches most of it.
4. Ask the user.

**Never the file's modification time.** An upload date presented as a capture date is
a wrong map that looks like a right one: the times will be in a plausible order, the
slider will move, and every date on it will be a lie about when the ground was
photographed. A scene whose date is unknown says so, sorts last, and asks. That is
worse to look at and better to trust.

---

## The document

A series in the project document is small, because the imagery is not in it:

```ts
/**
 * Captures of one patch of ground, and which of them is showing.
 *
 * The scenes are a manifest, not the data: an id, an instant and an extent each,
 * so a project with two years of weekly imagery is still a few kilobytes. What is
 * drawn is one scene at a time, named by `showing`.
 */
export interface RasterSeriesSource {
  type: "raster-series";
  /** The series in the registry, which is where the scenes actually live. */
  series: string;
  scenes: { id: string; captured: string | null; extent: GridBounds }[];
  /** The scene currently drawn. One of `scenes[].id`. */
  showing: string;
  /** Band indexes, 1-based, as GDAL numbers them. Absent means the file's own. */
  bands?: number[];
  /** Per-band [min, max] for the 8-bit stretch. Shared by every scene. */
  rescale?: [number, number][];
  colormap?: string;
  tileSize?: number;
  attribution?: string;
}
```

`showing` is in the document and the clock is not — the same rule the tracks and the
live layer already follow. Which date the user chose is a fact about the map worth
saving and exporting; a slider being dragged is not.

The compiler turns a `raster-series` into an ordinary `raster` engine layer whose
tiles point at the scene named by `showing`. Nothing downstream of the compiler knows
this layer has a time axis, which is the point.

---

## Changing time without a flicker

Here is the operation that makes the feature work rather than merely exist.

Changing which scene is drawn changes the source's tile template. Today the reconciler
has no way to express that, so a changed source is a `source.remove` followed by a
`source.add` — which takes down every layer reading it and puts it back. Dragged
across twenty dates, that is twenty teardowns, and what the user sees is the image
blinking out to nothing between every step.

`source.data` already exists for exactly this reason on the geojson side: new data for
a source that is otherwise unchanged, so a moving grid does not re-add its source on
every pan. Rasters need the same operation:

```ts
| { t: "source.tiles"; id: string; tiles: string[] }
```

which the adapter applies with MapLibre's own `setTiles`:

```ts
case "source.tiles": {
  const source = renderer.getSource(op.id);
  if (source && "setTiles" in source) source.setTiles(op.tiles);
  break;
}
```

The renderer keeps the old tiles on screen until the new ones have decoded, so moving
through the dates cross-fades rather than blinks. The reconciler emits this whenever
two raster sources differ only in `tiles`, and falls back to remove-and-add when
anything else about them changed — because a source whose tile *size* changed is a
different source and pretending otherwise draws it wrong.

Write the regression test first, in `packages/core/tests/regressions.test.ts`, named
after the symptom: `changing scene does not take the source down`.

---

## The registry

Two tables, in a new `data/init/02_rasters.sql`. Scenes are files, so the row holds a
path and the file lives on a volume, exactly as uploaded 3D models already do.

```sql
CREATE TABLE IF NOT EXISTS raster_series (
    id         text PRIMARY KEY,
    title      text NOT NULL,
    rescale    jsonb,          -- per-band [min, max], shared by every scene
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rasters (
    id           text PRIMARY KEY,
    series_id    text REFERENCES raster_series(id) ON DELETE CASCADE,
    title        text NOT NULL,
    path         text NOT NULL,        -- server-chosen, never from a request
    captured_at  timestamptz,          -- NULL means unknown, and says so
    extent       jsonb NOT NULL,       -- west/south/east/north, EPSG:4326
    source_crs   text,
    bands        integer,
    dtype        text,
    nodata       double precision,
    native_zoom  integer,              -- the zoom at which one pixel is one pixel
    statistics   jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rasters_series_time
    ON rasters (series_id, captured_at NULLS LAST);
```

`native_zoom` becomes the source's `maxzoom`, for the reason the existing
`RasterSource.maxzoom` comment already gives: past the resolution the data actually
has, the renderer should stretch the last real tile rather than ask for detail that
was never photographed.

## The endpoints

```
POST   /api/rasters                     upload a .tif, optionally into a series
GET    /api/rasters                     every scene, grouped by series
GET    /api/rasters/{id}                one scene: extent, date, bands, statistics
DELETE /api/rasters/{id}
GET    /api/rasters/{id}/{z}/{x}/{y}.png    a tile
POST   /api/rasters/series              make a series from scenes already uploaded
GET    /api/rasters/series/{id}         the scenes, in time order
```

Upload accepts several files in one request, because a series is a folder and asking
someone to upload sixty scenes one at a time is asking them not to use the feature.
Conversion runs as a background task with a progress endpoint: a 400 MB scene takes
tens of seconds to warp and a request that holds the browser open for it will time out
behind Nginx.

## The UI

A new **Imagery** tab in **Add data**, beside File, Link and WMS. Drop `.tif` files;
the dialog shows what it read out of each one — extent, date, bands, size — *before*
anything is added to the map, because a file whose date came out blank is a thing the
user needs to fix now rather than discover on the slider later.

When two or more scenes are dropped together the dialog offers to make them a series,
with the name pre-filled from the common part of the filenames.

A series in the table of contents is one row. Selecting it puts a **Captures** strip
in the inspector: the dates, in order, as a row of ticks with the current one marked.
Click a tick, or step with the arrow keys, or play through them. Ticks are spaced by
*date* and not by index, so a gap in the record looks like a gap — six scenes in June
and one in November is what the data is, and evenly spacing them draws a lie.

The date being shown belongs on the map, not only in the panel. A capture date in the
corner, beside the scale bar, is what makes a screenshot of the map self-describing.

---

## Steps

1. **`source.tiles`.** The op, the adapter case, the reconciler rule, the regression
   test. Nothing user-visible, and everything else depends on it.
2. **One scene.** Schema, upload, COG conversion, `gdalinfo` into the registry, the
   tile endpoint, a `raster` source in the document. A single `.tif` on the map at the
   right coordinates. Ship this on its own; it is most of the value.
3. **Dates.** The extraction chain, the unknown-date state, the scene inspector.
4. **Series.** The second table, grouping at upload, the shared rescale, the
   `raster-series` source, the captures strip.
5. **Bands and stretch.** Band selection and rescale in the inspector, which is the
   thing COG was chosen for.
6. **Identify.** Click the imagery, get the pixel value under the cursor — the raster
   counterpart of what WMS `GetFeatureInfo` already does.
