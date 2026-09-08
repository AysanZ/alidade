#!/usr/bin/env bash
# deploy/reset-demo.sh — restore the demo to its clean state.
#
# The demo takes uploads from anyone, so layers and models accumulate. This puts
# the database back to /opt/alidade/seed.sql.gz and empties the model volume.
#
# Make the seed once, after loading the layers you want visitors to see:
#   cd /opt/alidade
#   docker compose -f docker-compose.prod.yml exec -T postgis \
#     pg_dump -U alidade alidade | gzip > seed.sql.gz
#
# Then, as deploy:  0 4 * * *  /opt/alidade/reset-demo.sh >> /var/log/alidade-reset.log 2>&1

set -euo pipefail

DIR=/opt/alidade
SEED="$DIR/seed.sql.gz"
CP="docker compose -f $DIR/docker-compose.prod.yml"

cd "$DIR"

if [ ! -s "$SEED" ]; then
  echo "$(date -Is) no seed at $SEED, refusing to wipe" >&2
  exit 1
fi

echo "$(date -Is) reset starting"

# Dropping the schema takes the visitors' tables, the layer registry and the
# PostGIS extension with it. The dump puts all three back, which is why the
# extension has to be in the dump — it is, pg_dump emits CREATE EXTENSION.
$CP exec -T postgis psql -U alidade -d alidade -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO alidade;
GRANT ALL ON SCHEMA public TO public;
SQL

gunzip -c "$SEED" | $CP exec -T postgis psql -U alidade -d alidade -v ON_ERROR_STOP=1 >/dev/null

# Uploaded glTF are files, not rows, so the dump does not cover them.
$CP exec -T api sh -c 'rm -rf /srv/models/* /srv/models/.[!.]* 2>/dev/null || true'

# The API holds pooled connections to tables that no longer exist.
$CP restart api web >/dev/null

echo "$(date -Is) reset done"
