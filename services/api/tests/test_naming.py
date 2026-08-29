"""Identifier handling. These run without a database or GDAL."""

import pytest

from app.naming import check_identifier, slug, table_name


def test_a_readable_name_survives():
    assert slug("Tehran Wards 1400.zip") == "tehran_wards_1400_zip"


def test_non_ascii_is_transliterated_away_rather_than_kept():
    assert slug("مناطق تهران") == ""
    assert table_name("مناطق تهران.zip", "8f3a2c") == "up_layer_8f3a2c"


def test_a_table_name_is_prefixed_and_suffixed():
    assert table_name("wards.geojson", "8f3a2c") == "up_wards_8f3a2c"


def test_punctuation_cannot_break_out_of_an_identifier():
    assert table_name('wards"; DROP TABLE layers; --.zip', "8f3a2c").startswith("up_wards_")
    assert '"' not in table_name('wards"; DROP TABLE layers; --.zip', "8f3a2c")


def test_a_bad_identifier_is_refused_rather_than_repaired():
    for bad in ["wards; DROP TABLE t", '"wards"', "1wards", "", "a" * 60]:
        with pytest.raises(ValueError):
            check_identifier(bad)


def test_reserved_names_are_refused():
    with pytest.raises(ValueError):
        check_identifier("layers")
