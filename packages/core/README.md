# core

Internally this module is called **layersync**. It is a folder in this repository,
not a published package.

It knows nothing about MapLibre, the DOM, or WebGL. It takes two project documents
and returns the list of operations between them.

```
reconcile(prev, next) -> Op[]
```

Everything else here exists to serve that one function: the project types, the
compiler that turns a layer tree into engine layers, the symbology to paint
translation, the filter compiler, and the arithmetic that has to agree with itself
across the whole application — geodesic measurement, the sun's position, the sampling
of a track, and the imagery rules that decide which of several images a tile is drawn
from.

The rule for what belongs here is that it must be true without a renderer. `imagery.ts`
produces a tile template and an ordering; both are data, and neither knows that anything
will ever draw them.
