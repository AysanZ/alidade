# maplibre

The only place in the repository that knows MapLibre exists.

It takes the operations the core emits and calls the engine. Nothing here decides
anything: if a decision is being made in this folder, it is in the wrong folder.

## A note on the MapLibre version

`setFog`, `setSky` and `setProjection` are optional on the renderer interface and
called with `?.`. They were emitted and quietly ignored under MapLibre 4; moving
to 5 turned them on without a change to the core, which is the point of the
operations being data.
