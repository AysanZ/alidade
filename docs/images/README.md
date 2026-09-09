# Images

What the README and the design notes point at. Nothing in the application reads this
folder.

| File | What it is |
|---|---|
| `architecture.svg` | How the pieces fit: studio, core, adapters, API. Hand-written SVG, edited as text |
| `imagery.svg` | How an imagery layer chooses what to draw: the catalogue, the footprints over the view, the rule, the tile |
| `hero.jpg` | Terrain from SRTM under a night sky, scene pane open |
| `studio.png` | A fresh install: the table of contents with nothing in it, and the suggestions that say what to do about that |
| `basemaps.jpg` | The basemap gallery |
| `globe.jpg` | The globe projection, zoomed out |
| `buildings.png` | OpenStreetMap footprints raised to their real height |
| `models.png` | The model catalogue, and a van placed on a street |
| `approach.png` | An airliner on final, banking into the turn |
| `live.png` | The live asset layer, with the feed's own panel |

JPEG for the photographic ones — imagery and terrain basemaps — and PNG for the ones
that are mostly flat colour and text, where JPEG rings around the type. Everything is
1600 px wide, which is twice the width the README renders them at, so they stay sharp on
a dense screen without the repository carrying full-resolution screenshots.

## Diagrams before screenshots

Where a diagram will do, draw one. A screenshot goes stale the first time the palette
changes and is a claim about somebody's data; a schematic is honest about being a
schematic and still answers the only question that matters, which is what the thing
does. That is why imagery is a diagram here and not a picture of the panel — the
interesting part of it is the rule, and the rule is not visible in a photograph of some
ground.

The same argument is made in the application itself, in `Showcase.tsx`, and for the same
reason.

## Capturing

Use a browser window with no bookmarks bar, no extensions and no personal tabs, and zoom
the page to 100%. Prefer a dark basemap for the 3D shots; the models read better on one.

**Look at what is in the frame before committing it.** A screenshot carries the filenames
in your catalogue, the names of your layers, whatever the map is centred on and whatever
the panel happens to be showing. All of that is published with the picture and none of it
is easy to take back once it is in the history of a public repository. When the subject
of the shot is a feature rather than a place, draw the feature instead.

## Recording, if a GIF is ever wanted

GitHub will not play a `.gif` over about 10 MB and will not autoplay `.mp4` in a table
cell. Record at the size you mean to show — scaling a GIF down afterwards is what makes
the text in it unreadable.

```bash
# Record a region, then convert with a shared palette so the colours survive.
ffmpeg -i capture.mov -vf "fps=15,scale=800:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i capture.mov -i palette.png \
       -lavfi "fps=15,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" \
       docs/images/live.gif
```
