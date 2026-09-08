"""
Imagery, without GDAL or a database.

Everything here is arithmetic on a `gdalinfo` document or on a filename, which
is where the decisions that matter live: what the date is, whether the outline
is the real one, and which image the rule puts on top.
"""

from datetime import datetime, timezone

import pytest

from app.imagery import (
    bbox_of,
    captured_at,
    date_from_name,
    date_from_tags,
    describe,
    epsg_of,
    footprint_of,
    native_zoom,
    stored_name,
)


class TestDateFromName:
    def test_reads_a_sentinel_granule_instant(self):
        found = date_from_name("S2A_MSIL2A_20240712T071621_T39SVB.tif")
        assert found == datetime(2024, 7, 12, 7, 16, 21, tzinfo=timezone.utc)

    @pytest.mark.parametrize(
        "name",
        ["mehrabad_2024-07-12.tif", "mehrabad_2024_07_12.tif", "mehrabad_20240712.tif"],
    )
    def test_reads_the_ordinary_spellings(self, name):
        assert date_from_name(name).date() == datetime(2024, 7, 12).date()

    def test_finds_nothing_in_a_name_that_has_nothing(self):
        assert date_from_name("Kabul_International_Airport.tif") is None
        assert date_from_name("Turkey_39.tif") is None
        assert date_from_name("mehrabad.tif") is None

    def test_does_not_read_a_serial_number_as_a_date(self):
        """
        Eight digits are not necessarily a date. `run_12345678` would be the
        twelfth of March 1234, which is plausible-looking, ordered, and false —
        the worst kind of wrong, because nothing on the screen says so.
        """
        assert date_from_name("run_12345678.tif") is None
        assert date_from_name("scan_99999999.tif") is None

    def test_does_not_accept_an_impossible_day(self):
        assert date_from_name("tile_20241332.tif") is None

    def test_takes_the_first_instant_when_a_product_carries_two(self):
        # Sentinel-2 names carry the sensing time and then the processing time.
        found = date_from_name("S2A_MSIL2A_20240712T071621_N0510_T39SVB_20240712T094512.tif")
        assert found.hour == 7


class TestDateFromTags:
    def test_reads_the_tiff_spelling_with_colons(self):
        """TIFF writes the date with colons in it. That is the format, not a typo."""
        found = date_from_tags({"TIFFTAG_DATETIME": "2024:07:12 07:16:21"})
        assert found == datetime(2024, 7, 12, 7, 16, 21, tzinfo=timezone.utc)

    def test_reads_iso_from_anything_that_was_not_a_tiff_library(self):
        assert date_from_tags({"ACQUISITIONDATETIME": "2024-07-12T07:16:21"}).day == 12

    def test_finds_nothing_in_an_empty_bag(self):
        assert date_from_tags({}) is None
        assert date_from_tags({"TIFFTAG_SOFTWARE": "GDAL 3.6.2"}) is None


class TestCapturedAt:
    def test_prefers_the_file_over_its_name(self):
        when, whence = captured_at(
            {"TIFFTAG_DATETIME": "2024:07:12 07:16:21"}, "mehrabad_2019-01-01.tif"
        )
        assert whence == "tag"
        assert when.year == 2024

    def test_falls_back_to_the_name(self):
        when, whence = captured_at({}, "mehrabad_2024-07-12.tif")
        assert whence == "filename"
        assert when.month == 7

    def test_answers_nothing_rather_than_guessing(self):
        """
        Never the modification time. An upload date presented as a capture date
        is a wrong map that looks like a right one, and the whole feature rests
        on the dates being true.
        """
        assert captured_at({}, "Kabul_International_Airport.tif") == (None, None)


def info(**over) -> dict:
    """A gdalinfo document, with a rotated footprint by default."""
    base = {
        "size": [10980, 10980],
        "geoTransform": [51.0, 10.0, 0.0, 36.0, 0.0, -10.0],
        "bands": [{"type": "UInt16", "noDataValue": 0.0} for _ in range(4)],
        "coordinateSystem": {"projjson": {"id": {"authority": "EPSG", "code": 32639}}},
        "wgs84Extent": {
            "type": "Polygon",
            "coordinates": [
                [[51.10, 35.60], [51.52, 35.66], [51.46, 35.94], [51.04, 35.88], [51.10, 35.60]]
            ],
        },
        "metadata": {"": {"TIFFTAG_DATETIME": "2024:07:12 07:16:21"}},
    }
    base.update(over)
    return base


class TestDescribing:
    def test_reads_the_shape_of_what_arrived(self):
        facts = describe(info())
        assert (facts.width, facts.bands, facts.dtype) == (10980, 4, "UInt16")
        assert facts.epsg == 32639
        assert facts.nodata == 0.0
        assert facts.gsd == 10.0

    def test_flattens_the_metadata_groups_so_tags_can_be_found(self):
        facts = describe(info())
        assert facts.metadata["TIFFTAG_DATETIME"].startswith("2024")

    def test_refuses_a_file_with_no_bands(self):
        from app.imagery import ImageryError

        with pytest.raises(ImageryError):
            describe(info(bands=[]))

    def test_reads_no_epsg_rather_than_an_invented_one(self):
        assert epsg_of({"coordinateSystem": {}}) is None
        assert epsg_of(info(coordinateSystem={"projjson": {"id": {"authority": "IAU"}}})) is None


class TestFootprint:
    def test_keeps_the_real_outline_rather_than_its_box(self):
        """
        The whole reason the column is a polygon. This scene's corners are not
        aligned to north, so its bounding box is meaningfully larger than the
        scene and covers ground the file has no pixels for — and a registry that
        stored the box would report that it covers a view it does not reach.
        """
        footprint = footprint_of(info())
        ring = footprint["coordinates"][0]
        assert len({point[1] for point in ring[:4]}) == 4, "corners share no latitude"

        west, south, east, north = bbox_of(footprint)
        assert (west, south) == (51.04, 35.60)
        assert (east, north) == (51.52, 35.94)

    def test_falls_back_to_the_corners_when_there_is_no_extent(self):
        without = info()
        del without["wgs84Extent"]
        without["cornerCoordinates"] = {"lowerLeft": [51.0, 35.5], "upperRight": [51.6, 36.0]}
        assert bbox_of(footprint_of(without)) == (51.0, 35.5, 51.6, 36.0)

    def test_refuses_a_file_with_no_georeferencing_at_all(self):
        from app.imagery import ImageryError

        with pytest.raises(ImageryError):
            footprint_of({})


class TestNativeZoom:
    def test_matches_the_web_mercator_pixel_ladder(self):
        assert native_zoom(10) == 14
        assert native_zoom(0.5) == 19

    def test_stays_on_the_pyramid_for_nonsense(self):
        assert 0 <= native_zoom(0) <= 22
        assert 0 <= native_zoom(1e9) <= 22


def test_stored_name_is_chosen_by_the_server():
    assert stored_name("Kabul International Airport.tif", "a1b2c3") == (
        "kabul_international_airport_a1b2c3.tif"
    )


def test_stored_name_cannot_carry_a_path():
    """Nothing a client sent ever reaches the filesystem."""
    name = stored_name("../../etc/passwd.tif", "a1b2c3")
    assert "/" not in name and ".." not in name


def test_stored_name_survives_a_name_with_nothing_usable_in_it():
    assert stored_name("...tif", "a1b2c3").startswith("image_")


# ------------------------------------------------------------------ ordering


class Candidate:
    def __init__(self, id, captured_at=None, gsd=10.0, coverage=100.0):
        self.id = id
        self.captured_at = captured_at
        self.gsd = gsd
        self.coverage = coverage


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


CATALOGUE = [
    Candidate("apr23", at("2023-04-11T06:58:00")),
    Candidate("jul24", at("2024-07-19T07:16:00")),
    Candidate("may24", at("2024-05-02T07:11:00")),
    Candidate("drone", None, gsd=0.05, coverage=4.0),
]


class TestOrdering:
    """
    The same rules as `packages/core/imagery.ts`, asserted separately.

    Two implementations of one idea is a risk worth naming: the client sorts to
    say which images are contributing and the server sorts to decide which
    pixels to read, so if they disagree the panel highlights one image while the
    map draws another. These cases are the same cases the TypeScript tests use.
    """

    def order(self, rule, image=None, date=None):
        from app.routers.rasters import _order

        return [c.id for c in _order(CATALOGUE, rule, image, date)]

    def test_newest_first_and_undated_last(self):
        assert self.order("newest") == ["jul24", "may24", "apr23", "drone"]

    def test_closest_to_a_date_looks_both_ways(self):
        assert self.order("closest", date=at("2024-06-10T00:00:00"))[:2] == ["may24", "jul24"]

    def test_undated_stays_last_under_every_date_rule(self):
        assert self.order("newest")[-1] == "drone"
        assert self.order("closest", date=at("1999-01-01T00:00:00"))[-1] == "drone"

    def test_sharpest_puts_the_survey_over_the_satellite(self):
        assert self.order("sharpest")[0] == "drone"

    def test_lock_is_one_image_and_nothing_else(self):
        assert self.order("lock", image="may24") == ["may24"]
        assert self.order("lock", image="missing") == []

    def test_does_not_mutate_the_catalogue(self):
        before = [c.id for c in CATALOGUE]
        self.order("newest")
        self.order("sharpest")
        assert [c.id for c in CATALOGUE] == before
