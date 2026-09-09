# Deployment

Alidade on a small VPS — two cores, 2 GB of memory, 50 GB of disk — behind a reverse
proxy it may well be sharing with other things.

Images are built by GitHub Actions and pulled by tag. **The server never builds**:
`vite build` on a bundle carrying MapLibre and three.js peaks near 3 GB, which a machine
this size cannot survive.

```
GitHub Actions  ci.yml → deploy.yml  ─►  ghcr.io/<owner>, tagged by commit
                       │ ssh: pull, up -d
                       ▼
:443 ─► caddy ─► web ─► api ─► postgis
        own stack       GDAL   no published port
```

The proxy is a stack of its own because it owns 80 and 443. Restarting Alidade must not
take anything else on the box down with it, and a certificate renewal must not wait on
Alidade coming back up.

`deploy/docker-compose.yml` is the development stack and is unchanged: it still builds
locally and publishes ports. Everything below uses `deploy/docker-compose.prod.yml`,
which publishes nothing.

## What is in the repository

| Path | What it is |
|---|---|
| `apps/studio/Dockerfile` | Multi-stage build of the studio into an nginx image |
| `deploy/nginx/default.conf` | Baked into that image: tile cache, rate limits, the write guard, WebSocket upgrade |
| `deploy/docker-compose.prod.yml` | Production stack, no published ports |
| `deploy/.env.prod.example` | Template for the server's `.env` |
| `.github/workflows/deploy.yml` | Build, push, deploy |
| `.dockerignore` | Keeps `node_modules` and `.git` out of the build context |

The proxy's own configuration is not here. It routes whatever else is on the box, so it
belongs with the proxy rather than with this project.

Two settings exist because of this deployment and are worth knowing about: `DB_POOL_MIN`
and `DB_POOL_MAX`, which used to be a hardcoded pool of ten and are 1 and 5 here against
a Postgres running `max_connections=20`; and `services/api/pytest.ini`, which puts
`services/api` on `sys.path` so a bare `pytest` can import `app`.

## 1 · The server

Anything current with Docker on it. Done once, as root:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo,docker deploy
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh

curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 2 GB is not enough for a container to warp a large GeoTIFF without swap.
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl --system

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable
```

Confirm `uname -m`. On ARM, add `linux/arm64` to `platforms:` in `deploy.yml` — an amd64
image builds perfectly well in CI and fails at `up` with `exec format error`.

The paths below are `/opt/proxy` and `/opt/alidade`. They are arbitrary; use whatever
you like and keep the two stacks apart.

## 2 · GitHub

Make both packages public — profile → Packages → `alidade-api` and `alidade-web` →
Package settings → Change visibility → Public — so the server pulls without credentials.

Settings → Environments → New environment → `production`, with four secrets:

| Secret | Value |
|---|---|
| `SSH_HOST` | the server's address |
| `SSH_USER` | the deploy user |
| `SSH_KEY` | the private half of the deploy key, `BEGIN`/`END` lines included |
| `SSH_PORT` | usually `22` |

Check Settings → Actions → General allows `packages: write`. An org-level read-only
default overrides the workflow and the push fails with 403.

## 3 · DNS and TLS

An `A` record for the hostname Alidade will answer on, pointed at the server, with a
short TTL while you are setting it up. **Proxy off — DNS only.** A CDN in front breaks
the HTTP-01 challenge, because the certificate authority has to reach port 80 on this
machine.

If the domain is on the HSTS preload list — every `.dev` is — browsers refuse plain HTTP
before the request leaves the machine, so TLS has to work on day one. That is the
argument for a proxy that obtains certificates itself rather than a certbot cron.

## 4 · Files onto the server

```bash
scp deploy/docker-compose.prod.yml  deploy@SERVER:/opt/alidade/
scp deploy/.env.prod.example        deploy@SERVER:/opt/alidade/.env
scp data/init/*.sql                 deploy@SERVER:/opt/alidade/init/
```

**`init/` is the one that bites.** Postgres runs everything in there once, in filename
order, on a first-boot empty volume, and never again. `01_schema.sql` creates the layer
registry and the PostGIS extension; `02_imagery.sql` creates the imagery catalogue. Miss
either and the API starts, connects, and 500s on every request — and fixing it
afterwards means destroying the volume.

Fill in the `.env`: `GHCR_OWNER`, `CORS_ORIGINS` and a real database password. The
password is `:?`-required in the compose file, so `up` refuses to start without it rather
than starting with a default nobody meant.

```bash
openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo   # POSTGRES_PASSWORD
chmod 600 /opt/alidade/.env
```

`WRITE_TOKEN`, `PROTECTED_LAYERS`, `MAX_RASTER_MB` and `RASTER_BODY` decide what a
visitor may do; the next section is about choosing them.

## 5 · What a visitor is allowed to do

nginx refuses any POST, PUT, PATCH or DELETE that does not carry
`X-Alidade-Write: $WRITE_TOKEN` — **unless `WRITE_TOKEN` is empty**, in which case the
empty header every request already has matches it and every write is allowed. An open
instance and a locked one are the same configuration and one environment variable.

Open is the right setting for a demo, and it needs three things beside it or the box
does not survive contact with an audience.

**Ceilings, not refusals.** `MAX_RASTER_MB` and `RASTER_BODY` default to 512 rather than
to the 4 GB the format allows, and `MAX_UPLOAD_MB` to 64. One person uploading four
scenes at the old ceiling fills a 50 GB disk, and a full disk takes Postgres down with
it. Writes are rate limited to six a minute per address, which is generous for a person
and useless for a script.

The two limits are set a little apart on purpose: nginx's body limit sits just above the
API's file limit, so a file that is only somewhat too large reaches the API and is told
its own size and the ceiling — `That file is 71 MB and the limit is 64 MB` — rather than
being cut off by a number nobody can see. When nginx does refuse, it answers JSON rather
than its HTML page, so the studio shows a sentence instead of a status code.

**`PROTECTED_LAYERS`**, if you curated a map you want a visitor to arrive at. Delete is
open, so anything not named here can be removed by anyone. Leave it empty for an
instance that starts blank and is meant to be played with.

**A nightly reset**, because everything else visitors leave behind is temporary:

```cron
0 4 * * *  cd /opt/alidade && docker compose -f docker-compose.prod.yml exec -T postgis \
             psql -U alidade -d alidade < /opt/alidade/reset-demo.sql
```

```cron
5 4 * * *  cd /opt/alidade && docker compose -f docker-compose.prod.yml exec -T api \
             sh -c 'rm -f /srv/rasters/*.tif'
```

`data/reset-demo.sql` drops every layer that is not on a keep list you edit, table and
registry row together, and clears the imagery catalogue; the second line removes the
files the first line stopped pointing at. Curate two or three layers, style them,
**Save**, and the map a visitor arrives at is the one you meant.

With a token set, send it on writes:

```bash
curl -H "X-Alidade-Write: $WRITE_TOKEN" -F file=@wards.gpkg \
     https://HOST/api/layers/upload

curl -H "X-Alidade-Write: $WRITE_TOKEN" -F file=@scene.tif \
     https://HOST/api/rasters
```

or go in behind nginx altogether with `psql` through the compose stack.

The studio never sends the token, and should not: a token in a bundle is not a secret.
So a token set is an instance nobody writes to from the browser, which is what a private
deployment wants and what a demo does not. There is no third state, and the honest
version of one is authentication rather than a header the client also knows.

## 6 · First run

The proxy stack first: it creates the shared network Alidade attaches to.

```bash
cd /opt/alidade
docker compose --env-file .env -f docker-compose.prod.yml pull
docker compose --env-file .env -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Check:

```bash
curl -s  https://HOST/api/health                              # {"status":"ok", ...}
curl -sI https://HOST/api/tiles/LAYER/6/40/25.mvt | grep X-Cache
#   MISS then HIT. That header is the tile cache working.
```

The database ships empty. `data/seed.sh` assumes a published host port, which production
does not have, so load through the API or straight into the container:

```bash
docker compose -f docker-compose.prod.yml exec -T postgis \
  psql -U alidade -d alidade < layer.sql
```

## 7 · Imagery, on a box this size

Three things are different about imagery and all three bite on a small server.

**Disk.** One converted scene is a couple of hundred megabytes and lives on the `rasters`
volume, not in Postgres. Fifty of them is a full 50 GB disk, and a full disk takes
Postgres down with it. `docker system df -v` shows the volume; watch it.

**Time.** Conversion is synchronous — `gdalwarp` on a gigabyte takes minutes — which is
why `POST /api/rasters` has its own nginx block with a 1800 s timeout, an 8 GB body limit
and request buffering off. Without buffering off, nginx spools the whole upload to disk
before the API sees a byte, and that spool is what fills `/var` inside the web container.

**Memory.** rasterio holds a decompressed window per image and the tile endpoint may read
up to `MAX_MOSAIC_ASSETS` of them at once. The API's 768 MB limit is comfortable for six
8-bit RGB scenes and tight for six 16-bit multiband ones; lower `MAX_MOSAIC_ASSETS`
before raising the limit, because the images under the top two are rarely seen anyway.

Imagery tiles are cached like vector tiles, and 204s — a tile outside every footprint —
are cached for a minute rather than a week, because that answer changes the moment
somebody uploads.

## 8 · Rollback

```bash
cd /opt/alidade
sed -i 's|^TAG=.*|TAG=PREVIOUS_SHA|' .env
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

Images stay in the registry under their commit SHA, and a week of them stay on the
server.

**The workflow deploys images and nothing else.** `docker-compose.prod.yml`, the `.env`
and `init/` were put there by hand and stay as you left them, so a commit that adds an
environment variable is a commit that needs one `scp` as well. The image carries
defaults for everything the nginx template substitutes, which turns that mistake from an
outage into a setting that quietly stayed at its default — but the `scp` is still the
thing that makes it take effect.

## 9 · Maintenance

```cron
0 4 * * 0  docker image prune -af --filter "until=168h" >/dev/null 2>&1
0 3 * * *  cd /opt/alidade && docker compose -f docker-compose.prod.yml exec -T postgis \
             pg_dump -U alidade alidade | gzip > BACKUPS/alidade-$(date +\%u).sql.gz
```

**That dump is not a backup of everything.** `pg_dump` has the registry and the vector
data; it does not have the uploaded `.glb` files or the converted imagery, which are
files on the `models` and `rasters` volumes. Restoring the database alone leaves a
catalogue of images whose pixels are gone — rows pointing at nothing, which is worse than
an empty catalogue, because the map then shows a layer that draws nothing and says why
only in the API log.

```cron
0 3 * * 1  docker run --rm -v alidade_rasters:/v:ro -v BACKUPS:/b alpine \
             tar czf /b/rasters.tar.gz -C /v .
```

Weekly rather than nightly, because it is large and it changes rarely.

## 10 · Failures

| Symptom | Cause |
|---|---|
| The proxy loops on obtaining a certificate | DNS not propagated, a CDN proxy left on, or the provider blocking 80/443 upstream of the firewall |
| `no such host` for the web container | Alidade is not on the shared network, or the proxy stack was started second |
| `network ... declared as external, but could not be found` | Start the proxy stack first |
| API calls fail in the browser, `curl` works | `CORS_ORIGINS` is not an exact match — scheme, host, no trailing slash |
| Live feed drops every 60 seconds | The upgrade is not reaching the API. Caddy does it by default; nginx needs the three `proxy_set_header` lines, which ship in `default.conf` |
| `exec format error` at `up` | amd64 image, ARM host |
| Every write returns 403 | `WRITE_TOKEN` is set. Send `X-Alidade-Write`, or empty the variable to open the instance |
| Deleting one particular layer returns 403 | It is in `PROTECTED_LAYERS` |
| A GeoTIFF upload dies at the same size every time | `client_max_body_size`, `MAX_RASTER_MB`, or the disk. The first is refused before the API sees it, so look in the web container's log rather than the API's |
| Imagery draws nothing and the tiles are 503 | The API image was built without `rio-tiler` |
| `web` restarts, `nginx: [emerg] ... invalid value` in its log | A variable the nginx template substitutes is not in the container's environment, so envsubst left a blank. Copy the current `docker-compose.prod.yml` up: the deploy workflow pulls images and never touches that file |
| Postgres restarting | `mem_limit` too tight, or `init/` was empty when the volume was created. `down -v` re-runs it and destroys the data |

## 11 · What it costs

The three containers sit near 800 MB together under their limits, and the proxy is
shared with whatever else is on the box. On a 2 GB machine that leaves room for static
sites and small services, and not much room for a second database.
