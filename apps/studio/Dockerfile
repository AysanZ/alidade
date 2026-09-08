# apps/studio/Dockerfile
#
# Build context is the REPOSITORY ROOT, not apps/studio. The studio depends on
# three workspace packages through `workspace:*`, and vite.config.ts aliases
# straight at packages/*/src/index.ts, so a context rooted at apps/studio
# cannot see any of them. The compose file and the workflow both pass
# `context: .` with `dockerfile: apps/studio/Dockerfile` for this reason.

# ---------------------------------------------------------------- build stage
FROM node:22-alpine AS build

# pnpm-workspace.yaml uses `onlyBuiltDependencies`, which pnpm 10 reads from
# there rather than from package.json. If this build ever fails on esbuild's
# install script, drop to 9.15.4 — that is what .github/workflows/ci.yml pins.
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate

WORKDIR /repo

# Manifests and the lockfile first, on their own layer. Docker reuses the
# install layer on every push that does not touch a dependency, which is the
# difference between a 40-second build and a four-minute one.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json      packages/core/package.json
COPY packages/maplibre/package.json  packages/maplibre/package.json
COPY packages/three/package.json     packages/three/package.json
COPY apps/studio/package.json        apps/studio/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store \
 && pnpm install --frozen-lockfile

# Now the sources. Everything above this line is cached across most commits.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

# maplibre-gl and three together push the bundler past the default heap.
ENV NODE_OPTIONS=--max-old-space-size=3072
RUN pnpm build

# --------------------------------------------------------------- serve stage
FROM nginx:1.27-alpine

# Built assets and the server config are baked into the image. Nothing is
# bind-mounted from the host at runtime, so `docker compose pull` is the whole
# of a deployment and the server never needs a checkout of this repository.
COPY --from=build /repo/apps/studio/dist /usr/share/nginx/html
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf

# proxy_cache_path lives in default.conf and writes here.
RUN mkdir -p /var/cache/nginx/tiles

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz || exit 1
