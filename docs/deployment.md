# Deployment

Alidade on a 2 GB / 2 core / 50 GB VPS, sharing the box with a portfolio and
other projects under `aysanz.dev`.

Images are built by GitHub Actions and pulled by tag. The server never builds:
`vite build` on a bundle carrying MapLibre and three.js peaks near 3 GB, which
this machine cannot survive.

```
                   ┌─────────── GitHub Actions ───────────┐
                   │  ci.yml → deploy.yml                 │
                   │  pushes to ghcr.io/aysanz, by commit │
                   └──────────────────┬───────────────────┘
                                      │ ssh: pull, up -d
                                      ▼
  :443 ─► /opt/edge  caddy ─┬─► /srv/portfolio          aysanz.dev
                            ├─► /srv/sites/nili         nili.aysanz.dev
                            └─► alidade-web-1 ─► api ─► postgis
                                                 GDAL   no published port
```

Caddy is a separate stack because it owns 80 and 443. Restarting Alidade must
not take the other sites down with it.

`deploy/docker-compose.yml` is unchanged and still builds locally.

## Layout

```
/opt/edge/                 the only stack that publishes ports
  Caddyfile                routing for every hostname
  docker-compose.yml
  .env                     ACME_EMAIL
  portfolio/               static
  sites/nili/              static
  sites/nili-storybook/    static

/opt/alidade/
  docker-compose.prod.yml
  .env
  init/                    *.sql, run once on an empty volume
```

Static projects need no container. Only Alidade has one, because it has a
database and an API.

## Repository

| Path | What it is |
|---|---|
| `apps/studio/Dockerfile` | Multi-stage build of the studio into an nginx image |
| `deploy/nginx/default.conf` | Baked into that image: tile cache, rate limits, WebSocket upgrade |
| `deploy/docker-compose.prod.yml` | Production stack, no published ports |
| `deploy/.env.prod.example` | Template for `/opt/alidade/.env` |
| `.github/workflows/deploy.yml` | Build, push, deploy |
| `.dockerignore` | Keeps `node_modules` and `.git` out of the build context |

The Caddyfile is not here. It routes every project on the box, so it lives in
the edge stack.

### Code changes this needed

`app/db.py` had `max_size=10` hardcoded. It now reads `DB_POOL_MIN` and
`DB_POOL_MAX`, set to 1 and 5 in production; Postgres runs with
`max_connections=20`.

`services/api/pytest.ini` puts `services/api` on `sys.path`. Without it a bare
`pytest` cannot import `app` from `conftest.py`.

## 1 · GitHub

Make both packages public: profile → Packages → `alidade-api` and
`alidade-web` → Package settings → Change visibility → Public. The server then
pulls without credentials.

Settings → Environments → New environment → `production`, with four secrets:

| Secret | Value |
|---|---|
| `SSH_HOST` | `185.110.190.42` |
| `SSH_USER` | `deploy` |
| `SSH_KEY` | the private half of the deploy key, `BEGIN`/`END` lines included |
| `SSH_PORT` | `22` |

Check Settings → Actions → General allows `packages: write`. An org-level
read-only default overrides the workflow and the push fails with 403.

## 2 · DNS

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `185.110.190.42` | 300 |
| A | `www` | `185.110.190.42` | 300 |
| A | `alidade` | `185.110.190.42` | 300 |
| A | `*` | `185.110.190.42` | 300 |

Proxy off — DNS only. A CDN in front breaks the HTTP-01 challenge, because
Let's Encrypt has to reach port 80 on this server.

The wildcard means a new project needs a Caddyfile block and nothing else.

`.dev` is HSTS-preloaded: browsers refuse plain HTTP before a request leaves
the machine. TLS has to work on day one, which is why Caddy is here rather than
certbot.

## 3 · Server

Debian 13, x86_64. Done once, as root:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo,docker deploy
mkdir -p /home/deploy/.ssh && chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh

curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl --system

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable

mkdir -p /opt/edge/portfolio /opt/edge/sites /opt/alidade/init
chown -R deploy:deploy /opt/edge /opt/alidade
```

Confirm `uname -m` is `x86_64`. On ARM, add `linux/arm64` to `platforms:` in
`deploy.yml` — an amd64 image builds fine in CI and fails at `up` with
`exec format error`.

## 4 · Files onto the server

```bash
# edge
scp Caddyfile docker-compose.yml deploy@SERVER:/opt/edge/

# alidade
scp deploy/docker-compose.prod.yml deploy@SERVER:/opt/alidade/
scp deploy/.env.prod.example       deploy@SERVER:/opt/alidade/.env
scp data/init/*.sql                deploy@SERVER:/opt/alidade/init/
```

`init/` is the one that bites. Postgres runs everything in there once, in
filename order, on a first-boot empty volume, and never again. `01_schema.sql`
creates the layer registry and the PostGIS extension, `02_imagery.sql` the
raster catalogue. Miss either and the API starts, connects, and 500s on every
request; fixing it afterwards means destroying the volume.

Fill in `/opt/alidade/.env` — `GHCR_OWNER=aysanz`, `CORS_ORIGINS`, and a real
password:

```bash
openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo
chmod 600 /opt/alidade/.env /opt/edge/.env
```

## 5 · First run

Edge first: it creates the `edge` network that Alidade attaches to.

```bash
cd /opt/edge
docker compose --env-file .env up -d
docker compose logs -f caddy        # watch the certificate

cd /opt/alidade
docker compose --env-file .env -f docker-compose.prod.yml pull
docker compose --env-file .env -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Check:

```bash
curl -s  https://alidade.aysanz.dev/api/health     # {"status":"ok", ...}
curl -I  https://aysanz.dev
curl -sI https://alidade.aysanz.dev/api/tiles/LAYER/6/40/25.mvt | grep X-Cache
#   MISS then HIT. That header is the tile cache working.
```

The database ships empty. Load layers through **Add data**. `data/seed.sh`
assumes a published host port, which production does not have:

```bash
docker compose -f docker-compose.prod.yml exec -T postgis \
  psql -U alidade -d alidade < layer.sql
```

## 6 · Rollback

```bash
cd /opt/alidade
sed -i 's|^TAG=.*|TAG=PREVIOUS_SHA|' .env
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

Images stay in GHCR under their commit SHA; a week of them stay on the server.

## 7 · Maintenance

```cron
0 4 * * 0  docker image prune -af --filter "until=168h" >/dev/null 2>&1
0 3 * * *  cd /opt/alidade && docker compose -f docker-compose.prod.yml exec -T postgis pg_dump -U alidade alidade | gzip > /opt/backups/alidade-$(date +\%u).sql.gz
```

Consider restoring that dump nightly rather than only keeping it. The demo has
no authentication: any visitor can upload a layer and delete yours. A demo that
forgets overnight beats one that greets a recruiter with an empty map.

## 8 · Failures

| Symptom | Cause |
|---|---|
| Caddy loops on `obtaining certificate` | DNS not propagated, CDN proxy left on, or the provider blocks 80/443 upstream of ufw |
| `no such host: alidade-web-1` | Alidade is not on the `edge` network, or the edge stack was started second |
| `network edge declared as external, but could not be found` | Start `/opt/edge` first |
| API calls fail in the browser, `curl` works | `CORS_ORIGINS` is not an exact match — `https://alidade.aysanz.dev`, no trailing slash |
| Live feed drops every 60 seconds | The upgrade is not reaching the API. Caddy does it by default; nginx needs the three `proxy_set_header` lines, which ship in `default.conf` |
| `exec format error` at `up` | amd64 image, ARM host |
| Postgres restarting | `mem_limit` too tight, or `init/` was empty when the volume was created. `down -v` re-runs it and destroys the data |

## 9 · Next project

Static: drop the build in `/opt/edge/sites/NAME`, add a Caddyfile block, reload
Caddy. Containerised: build in CI, add a service on the `edge` network with no
published ports and a `mem_limit`, add the block.

Alidade sits near 800 MB and Caddy is shared. That leaves about a gigabyte —
comfortable for static sites and small services, tight for a second database.
