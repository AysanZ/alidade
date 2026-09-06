"""
The simulated feed, without a socket.

Everything worth testing about it is arithmetic on a clock: where a vehicle is
at a moment, whether the fleet stays where it was put, whether the frames it
emits are the shape the client parses. Those are tested by calling the
functions. The socket itself is a `while True` around them and needs a running
server to say anything about, so it is not tested here.
"""

import math

import pytest

from app.routers.live import EARTH_RADIUS_M, Vehicle, build_fleet, choose_quiet

TEHRAN = (51.39, 35.69)


def metres_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance, so a speed can be checked as a speed."""
    lon1, lat1 = a
    lon2, lat2 = b
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def test_a_fleet_is_the_size_it_was_asked_for():
    assert len(build_fleet(12, TEHRAN)) == 12
    assert build_fleet(0, TEHRAN) == []


def test_the_same_seed_gives_the_same_fleet():
    """
    A demo that is different on every restart cannot be described to anyone, and
    a bug report against it cannot be reproduced.
    """
    first = build_fleet(8, TEHRAN, seed=7)
    second = build_fleet(8, TEHRAN, seed=7)
    assert [v.at(30.0) for v in first] == [v.at(30.0) for v in second]


def test_every_id_is_its_own():
    fleet = build_fleet(50, TEHRAN)
    assert len({v.id for v in fleet}) == 50


@pytest.mark.parametrize("seconds", [0.0, 17.5, 600.0, 86_400.0])
def test_the_fleet_stays_in_the_city_it_was_put_in(seconds):
    """
    A random walk diffuses: after an hour the fleet is a smear across half a
    degree and nothing on the map looks like traffic. Every vehicle runs a
    closed loop, so a day of simulation is still the same city.
    """
    for vehicle in build_fleet(40, TEHRAN):
        lon, lat, _, _ = vehicle.at(seconds)
        assert metres_between((lon, lat), TEHRAN) < 20_000


def test_a_position_is_a_position():
    for vehicle in build_fleet(30, TEHRAN):
        lon, lat, heading, speed = vehicle.at(123.0)
        assert -180 <= lon <= 180
        assert -90 <= lat <= 90
        assert 0 <= heading < 360
        assert speed > 0


def test_a_vehicle_moves_at_the_speed_it_reports():
    """
    The heading and the speed have to describe the movement the positions
    actually make, or the whiskers on the map point somewhere the vehicle is not
    going. Checked over a second, which is the interval the feed sends at.
    """
    for vehicle in build_fleet(20, TEHRAN):
        here = vehicle.at(100.0)
        there = vehicle.at(101.0)
        travelled = metres_between((here[0], here[1]), (there[0], there[1]))
        # A chord across a circle is a little shorter than the arc, and the loops
        # are small enough that 10% covers it at every radius in the fleet.
        assert travelled == pytest.approx(here[3], rel=0.1)


def test_the_heading_points_the_way_it_is_going():
    for vehicle in build_fleet(20, TEHRAN):
        lon, lat, heading, _ = vehicle.at(100.0)
        ahead_lon, ahead_lat, _, _ = vehicle.at(101.0)
        travelled = math.degrees(
            math.atan2(
                (ahead_lon - lon) * math.cos(math.radians(lat)),
                ahead_lat - lat,
            )
        )
        gap = abs((travelled - heading + 180) % 360 - 180)
        assert gap < 5


def test_a_frame_is_the_shape_the_client_reads():
    frame = build_fleet(1, TEHRAN)[0].frame(10.0, 1_700_000_000_000)
    assert set(frame) >= {"id", "lon", "lat", "heading", "speed", "updated"}
    assert isinstance(frame["updated"], int)
    assert isinstance(frame["properties"], dict)


def test_going_quiet_is_possible_and_is_not_the_default():
    """
    Without a feed that sometimes stops, nothing on the map is ever stale: the
    grey state exists in the code and never on the screen, and the sweep that
    produces it is never exercised by the demo.
    """

    class Always:
        def random(self):
            return 0.0

    class Never:
        def random(self):
            return 1.0

    fleet = build_fleet(10, TEHRAN)
    choose_quiet(fleet, now=100.0, rng=Never(), chance=0.5, seconds=30.0)
    assert all(v.quiet_until == 0.0 for v in fleet)

    choose_quiet(fleet, now=100.0, rng=Always(), chance=0.5, seconds=30.0)
    assert all(v.quiet_until == 130.0 for v in fleet)


def test_a_vehicle_already_quiet_is_not_silenced_again():
    """Otherwise a vehicle that went quiet once would never report again."""

    class Always:
        def random(self):
            return 0.0

    vehicle = Vehicle(1, TEHRAN, __import__("random").Random(1))
    vehicle.quiet_until = 200.0
    choose_quiet([vehicle], now=100.0, rng=Always(), chance=1.0, seconds=30.0)
    assert vehicle.quiet_until == 200.0
