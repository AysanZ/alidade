# Contributing

## Getting set up

```bash
cp .env.example .env
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
pnpm install        # from the repository root, not from apps/studio
pnpm dev
```

```bash
pnpm test        # Node only: no browser, no WebGL
pnpm typecheck
```

## Where things go

| If you are changing… | It belongs in |
|---|---|
| The project model, the reconciler, symbology, filters, geodesy | `packages/core` |
| Anything that calls a MapLibre method | `packages/maplibre` |
| Anything that imports three.js | `packages/three` |
| UI | `apps/studio` |
| Ingest, tiles, OGC services, the live feed | `services/api` |

`packages/core` must not import a renderer, and `packages/three` is handed placements
rather than documents. If a change makes either of those false, the change is in the
wrong package.

## Tests

Core tests assert on the operation array the reconciler emits for a given pair of
project states. Adapter tests use a fake renderer that records calls. Neither touches
a GPU, and a pull request that needs one to run will not be merged.

Prefer asserting a fact over asserting an output. The sun tests check that noon
altitude at the equinox is the complement of the latitude, not that the function
returns 51.3 — a table of expected numbers passes just as happily with east and west
swapped.

A fix for a defect gets a test in `packages/core/tests/regressions.test.ts`, named
after the symptom rather than the cause: someone reading it a year from now knows what
went wrong on screen, and does not need to know what was wrong in the code.

## Style

Comments say *why*, not *what*. The code already says what it does.

Commit messages are imperative and describe the change, not the file touched.
