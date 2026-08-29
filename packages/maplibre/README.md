# maplibre

The only place in the repository that knows MapLibre exists.

It takes the operations the core emits and calls the engine. Nothing here decides
anything: if a decision is being made in this folder, it is in the wrong folder.

## A note on the MapLibre version

`setFog`, `setSky` and `setProjection` are optional on the renderer interface and
called with `?.`. MapLibre 4 does not implement all of them, so those environment
operations are emitted, ignored by the engine, and start working the day the
dependency moves to a version that has them. Nothing else has to change.
