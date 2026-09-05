"""
The model store, with no database anywhere.

Everything here runs against a temporary directory: the endpoints touch the
filesystem and nothing else, so they belong with the unit job.
"""

import struct

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.routers.models import looks_like_gltf, stored_name


def glb(payload: bytes = b"{}") -> bytes:
    """The smallest thing that starts the way a binary glTF does."""
    return b"glTF" + struct.pack("<II", 2, 12 + len(payload)) + payload


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "models_dir", str(tmp_path))
    # Not entered as a context manager: that would run the lifespan, which opens
    # a database pool these tests have no use for and no database to open on.
    return TestClient(app, raise_server_exceptions=True)


def test_a_file_is_known_by_its_first_bytes_and_not_its_name():
    assert looks_like_gltf(glb()[:16], ".glb")
    assert not looks_like_gltf(b"PK\x03\x04 a zip in disguise", ".glb")
    assert looks_like_gltf(b'  {"asset": {}}', ".gltf")
    assert not looks_like_gltf(b"<svg", ".gltf")


def test_a_stored_name_is_a_slug_and_a_hash_and_nothing_the_client_chose():
    # Directories fall away, punctuation becomes underscores, the hash is ours.
    name = stored_name("../../etc/Water Tower (v2).glb", "deadbeefcafe", ".glb")
    assert name == "water_tower_v2_deadbeef.glb"
    assert stored_name("....glb", "0123456789", ".glb") == "model_01234567.glb"
    assert stored_name("نقشه.glb", "abcdef0123", ".glb") == "model_abcdef01.glb"


def test_upload_then_fetch(client):
    response = client.post("/api/models", files={"file": ("Water Tower.glb", glb(), "model/gltf-binary")})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Water Tower"
    assert body["url"].startswith("/api/models/water_tower_")
    assert body["bytes"] == len(glb())

    fetched = client.get(body["url"])
    assert fetched.status_code == 200
    assert fetched.headers["content-type"].startswith("model/gltf-binary")
    assert fetched.content == glb()
    assert "immutable" in fetched.headers["cache-control"]

    listed = client.get("/api/models").json()["models"]
    assert [m["url"] for m in listed] == [body["url"]]


def test_the_same_file_twice_is_one_file(client):
    a = client.post("/api/models", files={"file": ("a.glb", glb(), "model/gltf-binary")}).json()
    b = client.post("/api/models", files={"file": ("a.glb", glb(), "model/gltf-binary")}).json()
    assert a["url"] == b["url"]
    assert len(client.get("/api/models").json()["models"]) == 1


def test_a_zip_called_glb_is_refused(client):
    response = client.post("/api/models", files={"file": ("x.glb", b"PK\x03\x04junk", "model/gltf-binary")})
    assert response.status_code == 422
    assert "binary glTF" in response.json()["detail"]


def test_other_extensions_are_refused(client):
    response = client.post("/api/models", files={"file": ("x.obj", b"v 0 0 0", "text/plain")})
    assert response.status_code == 400


def test_paths_are_not_walked(client):
    assert client.get("/api/models/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/api/models/nothing_00000000.glb").status_code == 404
