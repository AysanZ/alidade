"""API tests run against a throwaway PostGIS container, never a mock."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_reports_the_seeded_wards(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["wards"] == 42


def test_tile_is_a_vector_tile(client):
    r = client.get("/api/tiles/wards/11/1462/818.mvt")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert len(r.content) > 0


def test_tile_outside_the_data_is_empty_not_an_error(client):
    r = client.get("/api/tiles/wards/11/0/0.mvt")
    assert r.status_code == 200
    assert r.content == b""


def test_unknown_layer_is_rejected(client):
    assert client.get("/api/tiles/secrets/11/1462/818.mvt").status_code == 404


def test_coordinates_outside_the_pyramid_are_rejected(client):
    assert client.get("/api/tiles/wards/3/99/99.mvt").status_code == 400
