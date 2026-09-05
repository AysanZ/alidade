# @alidade/three

The only folder that knows three.js exists.

`ThreeModelHost` implements the adapter's `ModelHost`: it is handed models as
placements — a position, a height, a bearing, a scale — and draws them into the
map as a custom layer that shares the map's camera and depth buffer. Files are
fetched once per URL and cloned per placement. Draco-compressed files are
decoded with a decoder fetched on first use.

`frame.ts` is the arithmetic: the map's mercator matrix with a metric frame
folded into it, re-anchored at the map centre every frame so a mesh's
coordinates stay small and single precision on the GPU stays exact at
building scale.

Tests cover the matrices and run in Node. Nothing here is exercised against a
GPU by the test suite; that is what the studio is for.
