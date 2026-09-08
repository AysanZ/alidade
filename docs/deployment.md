# Deployment

Alidade in production on a single small VPS — 2 GB of RAM, 2 cores, 50 GB of
SSD — behind `aysan.dev`, sharing the box with a portfolio and whatever comes
next.

The server runs containers and nothing else. Both images are built by GitHub
Actions and pulled by tag, so the box needs no Node, no pnpm, and no checkout of
this repository. That is not tidiness: `vite build` on a bundle carrying
MapLibre and three.js peaks somewhere near 3 GB, which a 2 GB machine cannot
survive. Building elsewhere is what makes the small instance viable at all.

```
                     ┌──────────────── GitHub Actions ────────────────┐
                     │  ci.yml  →  deploy.yml                         │
                     │  builds alidade-api and alidade-web            │
                     │  pushes to ghcr.io, tagged with the commit     │
                     └──────────────────────┬─────────────────────────┘
                                            │ ssh: pull, up -d
                                            ▼
  :443 ──► caddy ──┬──► /srv/portfolio                     aysan.dev
                   └──► web (nginx + dist) ──► api ──► postgis
                        tile cache on disk     GDAL     no published port
```

Development is unchanged. `deploy/docker-compose.yml` still builds locally and
still publishes Postgres on 5433; everything below is a separate, additive
path that leaves it alone.

---

## What is in the repository

| Path | What it is |
|---|---|
| `apps/studio/Dockerfile` | Multi-stage build of the studio into an nginx image |
| `deploy/nginx/default.conf` | The config baked into that image — tile cache, rate limits, WebSocket upgrade |
| `deploy/docker-compose.prod.yml` | The production stack: prebuilt images, no published database port |
| `deploy/Caddyfile` | TLS termination and hostname routing |
| `deploy/.env.prod.example` | Template for `/opt/alidade/.env` |
| `.github/workflows/deploy.yml` | Build, push, deploy |
| `.dockerignore` | Keeps `node_modules` and `.git` out of the build context |

### The one code change this needed

`app/db.py` had `max_size=10` hardcoded into the connection pool. It now reads
`DB_POOL_MIN` and `DB_POOL_MAX` through `Settings`, and the production compose
file sets them to 1 and 5. Ten connections competing for two cores is slower
than five that are not, and Postgres is started with `max_connections=20`
shared with anything else that attaches.

Everything else worth tuning — the upload ceiling, the tile cache duration, the
fleet size — was already environment-driven through `pydantic-settings`, so it
is configured in `.env` without touching Python.

---

## 1 · GitHub

**Make the packages public.** After the first successful build, `alidade-api`
and `alidade-web` appear under your profile → Packages. Open each → Package
settings → Change visibility → Public. The server then pulls with no
credentials at all. Leave them private and you need a PAT with `read:packages`
on the box and a `docker login` in the deploy script — more moving parts for a
repository that is Apache-2.0 anyway.

**Add a deploy key.** On your laptop:

```bash
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/aysan_deploy -N ""
ssh-copy-id -i ~/.ssh/aysan_deploy.pub deploy@SERVER_IP
```

**Create the environment.** Settings → Environments → New environment →
`production`. Four environment secrets:

| Secret | Value |
|---|---|
| `SSH_HOST` | server IP |
| `SSH_USER` | `deploy` |
| `SSH_KEY` | all of `~/.ssh/aysan_deploy` — the private half, `BEGIN`/`END` lines included |
| `SSH_PORT` | `22`, or wherever you moved it |

An environment rather than plain repository secrets, because a required
reviewer can be added later and deploys become a button press. It costs nothing
now and is awkward to retrofit.

**Check workflow permissions.** Settings → Actions → General. The workflow asks
for `packages: write` explicitly, but an organisation-level read-only default
overrides that and the push fails with a 403.

---

## 2 · DNS

Three A records on `aysan.dev`, all pointing at the server:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `SERVER_IP` | 300 |
| A | `www` | `SERVER_IP` | 300 |
| A | `alidade` | `SERVER_IP` | 300 |
| AAAA | `@` | `SERVER_IPv6` | 300, if the VPS has one |

Keep the TTL low until it works, then raise it. Wait for propagation before the
first `up -d`: Caddy requests a certificate on the first request to each
hostname, and failed challenges count against a limit of five per week per
domain.

```bash
dig +short aysan.dev alidade.aysan.dev
```

> `.dev` is on the HSTS preload list. Browsers refuse plain HTTP to it before a
> request leaves the machine, so there is no "get it up on port 80 and add TLS
> later" for this domain — TLS has to work on the first day. Caddy is here
> rather than certbot for that reason: it obtains and renews without being
> asked, and it proxies a WebSocket upgrade without special configuration.

---

## 3 · Preparing the server

As root, once.

```bash
# A user that is not root.
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# Docker.
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
systemctl enable --now docker

# Swap. The margin for ogr2ogr on a 2 GB box: insurance against a spike, not a
# place to run from, which is what swappiness=10 says.
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
sysctl --system

# Firewall.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable

# Security updates without being asked.
apt-get update && apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades
```

Check the architecture **now**:

```bash
uname -m    # x86_64  → deploy.yml is correct as written
            # aarch64 → add linux/arm64 to `platforms:` in deploy.yml
```

An amd64 image on an ARM host builds cleanly in CI and fails at `docker compose
up` with `exec format error`, which is a confusing place to learn this.

---

## 4 · Laying out `/opt/alidade`

As `deploy`:

```bash
sudo mkdir -p /opt/alidade && sudo chown deploy:deploy /opt/alidade
cd /opt/alidade && mkdir -p portfolio init
```

Four things have to be here, because the compose file bind-mounts them:

```bash
# from a checkout on your laptop
scp deploy/docker-compose.prod.yml deploy@SERVER:/opt/alidade/
scp deploy/Caddyfile               deploy@SERVER:/opt/alidade/
scp deploy/.env.prod.example       deploy@SERVER:/opt/alidade/.env
scp data/init/01_schema.sql        deploy@SERVER:/opt/alidade/init/
```

`init/` is the one that bites. Postgres runs it exactly once, on a first-boot
empty volume. Miss it and the API starts, connects, and returns 500 on every
request, because there is no `layers` table and no PostGIS extension — and
fixing it afterwards means destroying the volume.

Then edit `/opt/alidade/.env`: `GHCR_OWNER`, `ACME_EMAIL`, and a real password.

```bash
openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo
chmod 600 /opt/alidade/.env
```

Put a holding page at `portfolio/index.html` so `aysan.dev` is not a 404 while
the real thing is being built.

---

## 5 · The first deploy

Push to `main`. `ci.yml` runs; on green, `deploy.yml` builds both images, pushes
them to GHCR tagged with the commit, and restarts the stack over SSH.

The first time, do it by hand so failures are legible:

```bash
cd /opt/alidade
docker compose --env-file .env -f docker-compose.prod.yml pull
docker compose --env-file .env -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy   # watch the certificate
```

Then check it:

```bash
curl -s  https://alidade.aysan.dev/api/health     # {"status":"ok", ...}
curl -I  https://aysan.dev
curl -sI https://alidade.aysan.dev/api/tiles/LAYER/6/40/25.mvt | grep X-Cache
#   MISS on the first request, HIT on the second. That header is the whole
#   point of the tile cache and the quickest confirmation it is working.
```

The database ships empty by design. Load layers through **Add data** in the
studio. Note that `data/seed.sh` assumes a published host port, which the
production compose file deliberately does not have:

```bash
docker compose -f docker-compose.prod.yml exec -T postgis \
  psql -U alidade -d alidade < layer.sql
```

---

## 6 · Rolling back

```bash
cd /opt/alidade
sed -i 's|^TAG=.*|TAG=PREVIOUS_SHA|' .env
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

Every image stays in GHCR under its commit SHA and the last week of them stay
on the server. A rollback is one line and about ten seconds.

---

## 7 · Maintenance

`crontab -e` as `deploy`:

```cron
# Images accumulate with every deploy, and 50 GB goes faster than it sounds.
0 4 * * 0  docker image prune -af --filter "until=168h" >/dev/null 2>&1

# Nightly dump, seven kept.
0 3 * * *  cd /opt/alidade && docker compose -f docker-compose.prod.yml exec -T postgis pg_dump -U alidade alidade | gzip > /opt/backups/alidade-$(date +\%u).sql.gz
```

```bash
sudo mkdir -p /opt/backups && sudo chown deploy:deploy /opt/backups
```

**Consider a nightly restore rather than only a backup.** This is a public demo
with no authentication: any visitor can upload a layer, and any visitor can
delete yours. Someone opening the demo to an empty table of contents is a worse
outcome than a demo that forgets overnight. Keep a clean dump, restore it at
04:00, and the problem stops being one.

---

## 8 · What the failures look like

| Symptom | Cause |
|---|---|
| Caddy loops on `obtaining certificate` | DNS has not propagated, or the provider blocks 80/443 upstream of ufw. `dig` first, then `nc -zv IP 80` from somewhere else. |
| `no such host: web` in Caddy's log | Caddy and web are not both on the `edge` network. |
| API calls fail in the browser, `curl` works | `CORS_ORIGINS` is not an exact match. `https://alidade.aysan.dev`, no trailing slash. |
| Live feed connects, then drops every 60 seconds | Something between Caddy and nginx is not passing the upgrade. Caddy does it by default; nginx needs the three `proxy_set_header` lines, which are in `default.conf` as shipped. |
| `exec format error` at `up` | amd64 image, ARM host. See §3. |
| Push to GHCR returns 403 | Workflow permissions are read-only at the organisation level. See §1. |
| Postgres keeps restarting | `mem_limit` too tight, or `init/` was absent when the volume was first created. `down -v` re-runs it and destroys the data. |

---

## 9 · Adding the next project to this box

1. Build its image in CI and push to `ghcr.io/OWNER/NAME`.
2. Add a service to `docker-compose.prod.yml` on the `edge` network, with no
   published ports and a `mem_limit`.
3. Add a block to the `Caddyfile` — there is a template at the bottom of it.
4. Add an A record for the subdomain.
5. `docker compose up -d`.

Alidade's stack sits at roughly 800 MB, and Caddy is shared and already counted.
That leaves about a gigabyte, which is comfortable for static sites and small
Go or Python services and tight for a second database. A second Postgres is the
signal to move up an instance size, and not before.
