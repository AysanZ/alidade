# Build context is the repository root: the studio depends on packages/*.
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.6.5 --activate
WORKDIR /repo

# Manifests first so the install layer survives source-only commits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json      packages/core/package.json
COPY packages/maplibre/package.json  packages/maplibre/package.json
COPY packages/three/package.json     packages/three/package.json
COPY apps/studio/package.json        apps/studio/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store \
 && pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

# maplibre-gl plus three exceeds the default heap.
ENV NODE_OPTIONS=--max-old-space-size=3072
RUN pnpm build

FROM nginx:1.27-alpine
COPY --from=build /repo/apps/studio/dist /usr/share/nginx/html
# A template, not conf.d: the entrypoint runs envsubst over it at startup.
COPY deploy/nginx/default.conf /etc/nginx/templates/default.conf.template
# Defaults for every variable the template substitutes. envsubst replaces an
# unset variable with nothing, so a compose file that predates one of these
# leaves nginx reading `client_max_body_size ;` and the container will not
# start — a stale file on the server taking the whole site down with it.
ENV ALIDADE_WRITE_TOKEN="" \
    ALIDADE_RASTER_BODY=512m \
    ALIDADE_UPLOAD_BODY=80m
RUN mkdir -p /var/cache/nginx/tiles
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz || exit 1
