# Contributing

## Getting set up

```bash
cp .env.example .env
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
pnpm install        # from the repository root, not from apps/studio
pnpm dev
```

```bash
pnpm test        # 585 tests, Node only: no browser, no WebGL
pnpm typecheck
```

The API has its own suite. Most of it needs nothing but Python — the parsing, the
naming rules, the live feed and every imagery decision that is arithmetic on a
`gdalinfo` document — and the rest wants the compose stack up, because it asks PostGIS
real questions:

```bash
pip install -r services/api/requirements.txt pytest
cd services/api && pytest                      # all of it, with a database
cd services/api && pytest tests/test_imagery.py tests/test_naming.py   # without one
```

CI runs both halves separately for that reason, so a change that needs a database
cannot quietly become a change that needs one everywhere.

## Where things go

| If you are changing… | It belongs in |
|---|---|
| The project model, the reconciler, symbology, filters, geodesy | `packages/core` |
| Anything that calls a MapLibre method | `packages/maplibre` |
| Anything that imports three.js | `packages/three` |
| UI | `apps/studio` |
| Ingest, tiles, imagery, WMS, the live feed | `services/api` |

`packages/core` must not import a renderer, and `packages/three` is handed placements
rather than documents. If a change makes either of those false, the change is in the
wrong package.

Two things are deliberately implemented twice, and a change to one is a change to both:
the imagery sorting rules, in `packages/core/src/imagery.ts` and in `_order` in
`services/api/app/routers/rasters.py`; and the schema in `data/init/`, which Postgres
runs once on an empty volume and never again — a migration that only exists as an
`ALTER` somebody ran by hand is a schema no fresh install will ever have.

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

## Documentation

The docs are arguments, not feature lists: each one says why a subsystem is the shape
it is, including the alternatives that were rejected and the defects that changed
somebody's mind. A change that alters a decision should alter the paragraph that
explains it — [design notes](docs/design-notes.md) for the subsystems,
[imagery](docs/imagery.md) for the raster half, [deployment](docs/deployment.md) for
anything that only fails once it is live.

Screenshots live in `docs/images/` and there is a note there about what to check before
committing one. Where a diagram will do, draw one: a schematic does not go stale when
the palette changes and does not publish whatever happened to be on your map.

## Style

Comments say *why*, not *what*. The code already says what it does.

Commit messages are imperative and describe the change, not the file touched.
