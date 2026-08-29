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
translation, and the filter compiler.
