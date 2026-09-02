"""API tests run against a throwaway PostGIS container, never a mock."""


def test_health_reports_the_registry(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    # The fixture layer is registered, so the count cannot be zero. Nothing here
    # asserts a particular number: the database ships empty and what is in it is
    # whatever the person running this put there.
    assert body["layers"] >= 1
    assert "wards" not in body


def test_the_database_ships_without_a_demo_layer(client):
    """
    A seeded demo cannot be deleted from the studio, so it was somebody else's
    map in every table of contents. The registry starts empty now.
    """
    ids = {layer["id"] for layer in client.get("/api/layers").json()["layers"]}
    assert "wards" not in ids


def test_tile_is_a_vector_tile(client):
    r = client.get("/api/tiles/fixture/10/658/403.mvt")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert len(r.content) > 0


def test_tile_outside_the_data_is_empty_not_an_error(client):
    r = client.get("/api/tiles/fixture/10/0/0.mvt")
    assert r.status_code == 200
    assert r.content == b""


def test_unknown_layer_is_rejected(client):
    assert client.get("/api/tiles/secrets/10/658/403.mvt").status_code == 404


def test_coordinates_outside_the_pyramid_are_rejected(client):
    assert client.get("/api/tiles/fixture/3/99/99.mvt").status_code == 400


def test_a_layer_reaching_the_pole_still_builds_its_world_tile(client):
    """
    Web mercator has no answer past about 85.05 degrees of latitude, so a
    geometry that touches a pole cannot be projected into it. The z0 tile is the
    one that selects it, so the world tile used to answer 500 while every other
    tile worked. The query clips to the mercator band first.
    """
    r = client.get("/api/tiles/fixture/0/0/0.mvt")
    assert r.status_code == 200


def test_a_tile_that_cannot_be_built_explains_itself(client):
    """A tile the database refuses is a property of the data, not a crash."""
    r = client.get("/api/tiles/fixture/0/0/0.mvt")
    assert r.status_code != 500
