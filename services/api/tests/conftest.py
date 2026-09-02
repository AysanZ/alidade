"""
The database tests bring their own data.

They used to lean on the seeded demo wards, which meant the test suite and every
fresh install shared one fixture: the demo could not be removed without breaking
the tests, and the tests could not describe an awkward geometry without putting
it in front of users. The fixture now lives here, is created before the tests and
dropped after them, and is free to be as odd as a test needs.
"""

import asyncio

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

LAYER_ID = "fixture"
TABLE = "test_fixture_areas"

# Two areas, chosen for what they exercise rather than for what they mean:
#
# - a box over Tehran, so there is a mid-zoom tile that certainly has data in it
#   (z10/658/403) and plenty that certainly do not;
# - a box whose southern edge is exactly -90, because web mercator has no answer
#   at a pole and the z0 tile is the one that selects it. That is the geometry
#   that used to make the world tile answer 500 while every other tile worked.
CREATE = f"""
DROP TABLE IF EXISTS {TABLE};
CREATE TABLE {TABLE} (
    id       text PRIMARY KEY,
    name     text NOT NULL,
    value    integer,
    geom     geometry(MultiPolygon, 4326) NOT NULL
);
INSERT INTO {TABLE} (id, name, value, geom) VALUES
    ('a', 'Tehran box', 42,
     ST_Multi(ST_MakeEnvelope(51.20, 35.60, 51.60, 35.83, 4326))),
    ('b', 'South polar box', NULL,
     ST_Multi(ST_MakeEnvelope(-180, -90, -170, -80, 4326)));
CREATE INDEX ON {TABLE} USING gist (geom);

INSERT INTO layers
    (id, title, table_name, geometry_type, source_crs, feature_count, fields, extent)
VALUES (
    '{LAYER_ID}', 'Test fixture', '{TABLE}', 'MultiPolygon', 'EPSG:4326', 2,
    '["id","name","value"]'::jsonb,
    '{{"west":-180,"south":-90,"east":51.6,"north":35.83}}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET table_name = excluded.table_name;
"""

DROP = f"""
DELETE FROM layers WHERE id = '{LAYER_ID}';
DROP TABLE IF EXISTS {TABLE};
"""


async def _run(sql: str) -> None:
    conn = await asyncpg.connect(settings.dsn)
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


# Deliberately not autouse: the unit job runs the parsing and URL tests with no
# database anywhere, and a fixture that connects on collection would fail them
# all for a reason that has nothing to do with what they test. Only a test that
# asks for `client` gets the table.
@pytest.fixture(scope="session")
def fixture_layer():
    asyncio.run(_run(CREATE))
    yield LAYER_ID
    asyncio.run(_run(DROP))


@pytest.fixture(scope="module")
def client(fixture_layer):
    with TestClient(app) as c:
        yield c
