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
RUN mkdir -p /var/cache/nginx/tiles
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz || exit 1
