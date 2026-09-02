#!/usr/bin/env bash
# Load a dataset straight into PostGIS, outside the studio.
#   ./data/seed.sh wards.gpkg wards
#
# The table is created, not registered: the API's `layers` table is what the
# studio reads, so use Add data if you want the layer to appear on its own.
set -euo pipefail

FILE="${1:?usage: seed.sh <file> [table]}"
TABLE="${2:-$(basename "${FILE%%.*}" | tr '[:upper:] ' '[:lower:]_')}"
: "${POSTGRES_USER:=alidade}" "${POSTGRES_PASSWORD:=change_me}" "${POSTGRES_DB:=alidade}"
: "${POSTGRES_HOST:=localhost}" "${POSTGRES_PORT:=5432}"

ogr2ogr -f PostgreSQL \
  "PG:host=$POSTGRES_HOST port=$POSTGRES_PORT dbname=$POSTGRES_DB user=$POSTGRES_USER password=$POSTGRES_PASSWORD" \
  "$FILE" \
  -nln "$TABLE" -overwrite \
  -t_srs EPSG:4326 \
  -nlt PROMOTE_TO_MULTI \
  -lco GEOMETRY_NAME=geom -lco SPATIAL_INDEX=GIST

echo "Loaded $FILE into $TABLE, reprojected to EPSG:4326."
