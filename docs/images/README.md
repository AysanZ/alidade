# Screenshots

The README expects these six files. Nothing else in the repository reads this folder.

| File | What to capture | Notes |
|---|---|---|
| `hero.png` | The studio with a layer loaded, table of contents open, 2.5D tilt | 1600×900. This is the first thing anyone sees. |
| `symbology.png` | The Appearance pane mid-classification, legend visible | 800×600 |
| `globe.png` | `Sphere` projection, zoomed out, terrain on | 800×600 |
| `models.gif` | The time slider moved so a tower's shadow swings | ≤ 8 s, ≤ 5 MB |
| `live.gif` | **Fly a landing**, or the fleet moving with a stale asset going hollow | ≤ 10 s, ≤ 8 MB |
| `raster.gif` | Stepping through the captures strip of a series | Once the imagery feature lands |

## Recording

GitHub will not play a `.gif` over about 10 MB and will not autoplay `.mp4` in a
table cell, so GIFs it is. Record at the size you mean to show — scaling a GIF down
afterwards is what makes the text in it unreadable.

```bash
# Record a region, then convert with a shared palette so the colours survive.
ffmpeg -i capture.mov -vf "fps=15,scale=800:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i capture.mov -i palette.png \
       -lavfi "fps=15,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" \
       docs/images/live.gif
```

Use a browser window with no bookmarks bar, no extensions and no personal tabs, and
zoom the page to 100%. Prefer a dark basemap for the 3D shots; the models read better.
