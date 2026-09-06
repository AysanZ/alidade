"""
A feed of things that move, and a simulator to drive it.

The endpoint is the contract; the simulator is one implementation of it that
happens to be built in, so the studio has something to connect to on a laptop
with no fleet attached. Point `ALIDADE_LIVE_SOURCE` at nothing else and this is
what answers. Replace it with a reader for a real AVL feed, an MQTT bridge or a
table in PostGIS and the client does not change, because what the client knows
is the message shape and not where it came from.

The messages are the three a feed of positions needs:

    {"type": "snapshot", "assets": [...]}   everything, and anything absent is gone
    {"type": "update",   "assets": [...]}   a patch, which is what most frames are
    {"type": "remove",   "ids": [...]}      the thing a patch cannot say on its own

An asset is `{id, lon, lat, heading?, speed?, label?, updated?, properties?}`.
`updated` is epoch milliseconds and is the feed's own clock: a client that is
told when a position was true can say how old it is, and one that is only told
that a message arrived cannot.
"""

import asyncio
import contextlib
import logging
import math
import random
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/live", tags=["live"])

# The earth, for turning metres into degrees. The same authalic mean radius the
# TypeScript side measures with, so a simulated speed reads back as that speed.
EARTH_RADIUS_M = 6371008.8


class Vehicle:
    """
    One simulated asset, walking a closed loop around a centre.

    A loop rather than a random walk on purpose: a random walk diffuses, so
    after ten minutes the fleet is a smear across half a degree and nothing
    looks like traffic. A loop keeps every vehicle in the city it started in,
    which is what makes clustering, staleness and framing worth looking at.
    """

    def __init__(self, index: int, centre: tuple[float, float], rng: random.Random) -> None:
        self.id = f"unit-{index:03d}"
        self.label = f"Unit {index:03d}"
        self.kind = rng.choice(["van", "truck", "car", "bike"])
        self.centre = centre
        # Radius in metres, and where on the ring it starts. Spread over a
        # range so the fleet is not one wheel of vehicles turning together.
        self.radius = rng.uniform(600, 9000)
        self.phase = rng.uniform(0, 2 * math.pi)
        # Metres per second, and which way round. A negative rate is a vehicle
        # going the other way, which is one line instead of a second code path.
        self.rate = rng.uniform(4, 22) * rng.choice([1, -1])
        # A slight ellipse and a rotation, so the loops are not concentric
        # circles around one point, which reads as a diagram rather than a city.
        self.squash = rng.uniform(0.45, 1.0)
        self.tilt = rng.uniform(0, math.pi)
        self.quiet_until = 0.0

    def at(self, seconds: float) -> tuple[float, float, float, float]:
        """Position, heading and speed at a moment. lon, lat, degrees, m/s."""
        angle = self.phase + (self.rate * seconds) / max(self.radius, 1.0)
        east, north = self._offset(angle)

        lat = self.centre[1] + math.degrees(north / EARTH_RADIUS_M)
        lon = self.centre[0] + math.degrees(
            east / (EARTH_RADIUS_M * math.cos(math.radians(self.centre[1])))
        )

        # Heading and speed both come from where it will be a second later,
        # rather than from the tangent by hand and from `rate` respectively.
        #
        # `rate` is not the speed. The angle advances at a constant rate but the
        # loop is an ellipse, so the ground speed varies between `rate` and
        # `rate * squash` around the ring — a vehicle reporting 22 km/h while
        # covering the ground at 10 is a feed that lies, and the studio draws the
        # heading whisker at a length taken from that number. One delta answers
        # both questions and cannot disagree with the positions it came from.
        ahead = self.phase + (self.rate * (seconds + 1)) / max(self.radius, 1.0)
        east_ahead, north_ahead = self._offset(ahead)
        de = east_ahead - east
        dn = north_ahead - north
        heading = (math.degrees(math.atan2(de, dn)) + 360) % 360
        speed = math.hypot(de, dn)

        return lon, lat, heading, speed

    def _offset(self, angle: float) -> tuple[float, float]:
        """Metres east and north of the centre, at a point on the loop."""
        x = self.radius * math.cos(angle)
        y = self.radius * self.squash * math.sin(angle)
        return (
            x * math.cos(self.tilt) - y * math.sin(self.tilt),
            x * math.sin(self.tilt) + y * math.cos(self.tilt),
        )

    def frame(self, seconds: float, now_ms: int) -> dict:
        lon, lat, heading, speed = self.at(seconds)
        return {
            "id": self.id,
            "label": self.label,
            "lon": round(lon, 6),
            "lat": round(lat, 6),
            "heading": round(heading, 1),
            "speed": round(speed, 2),
            "updated": now_ms,
            "properties": {"kind": self.kind},
        }


def build_fleet(
    count: int, centre: tuple[float, float], seed: int | None = None
) -> list[Vehicle]:
    """
    A fleet. Seeded, so the same settings give the same fleet every time.

    A demo that is different on every restart is a demo you cannot describe to
    somebody else, and a bug report against it is not reproducible.
    """
    rng = random.Random(seed if seed is not None else 20260101)
    return [Vehicle(i + 1, centre, rng) for i in range(count)]


def choose_quiet(
    fleet: list[Vehicle], now: float, rng: random.Random, chance: float, seconds: float
) -> None:
    """
    Let some of the fleet stop reporting, now and then.

    This is not decoration. A feed where every asset reports on time forever
    exercises none of the behaviour that matters — nothing ever goes stale, the
    sweep never fires, the grey state is never seen — so the simulator would be
    testing the happy path and hiding the rest. Roughly one vehicle in this
    many goes quiet for a while and then comes back.
    """
    for vehicle in fleet:
        if vehicle.quiet_until > now:
            continue
        if rng.random() < chance:
            vehicle.quiet_until = now + seconds


@router.websocket("/assets")
async def assets(socket: WebSocket) -> None:
    """
    Positions, until the client goes away.

    A snapshot on connect and patches after it, which is what lets a client that
    joined late be correct immediately and cheap thereafter. The patch carries
    only the vehicles that reported in that tick, so a fleet with half of it
    quiet sends half the bytes — and the client, seeing nothing about the other
    half, draws them as going stale rather than as having moved.
    """
    await socket.accept()

    started = time.monotonic()
    rng = random.Random()
    fleet = build_fleet(
        settings.live_fleet_size,
        (settings.live_centre_lon, settings.live_centre_lat),
    )
    logger.info("live feed opened: %d simulated assets", len(fleet))

    try:
        await socket.send_json(
            {
                "type": "snapshot",
                "assets": [v.frame(0.0, int(time.time() * 1000)) for v in fleet],
            }
        )

        while True:
            await asyncio.sleep(settings.live_interval_seconds)
            now = time.monotonic()
            elapsed = now - started
            now_ms = int(time.time() * 1000)

            choose_quiet(
                fleet,
                now,
                rng,
                settings.live_quiet_chance,
                settings.live_quiet_seconds,
            )
            reporting = [v for v in fleet if v.quiet_until <= now]
            if not reporting:
                continue
            await socket.send_json(
                {
                    "type": "update",
                    "assets": [v.frame(elapsed, now_ms) for v in reporting],
                }
            )
    except WebSocketDisconnect:
        logger.info("live feed closed by the client")
    except (RuntimeError, ConnectionError) as error:
        # A socket that died mid-send raises on the next write. It is the normal
        # way a browser tab closing reaches us, and not something to traceback.
        logger.info("live feed ended: %s", error)
    finally:
        with contextlib.suppress(RuntimeError):
            await socket.close()
