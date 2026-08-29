import pytest

from app.net import UnsafeUrl, check_public_url


def test_a_public_https_url_passes():
    url = "https://example.com/data/places.geojson"
    assert check_public_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/data.zip",
        "http://localhost:8000/api/health",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/internal",
        "http://192.168.1.1/",
        "not a url at all",
    ],
)
def test_anything_pointing_inwards_is_refused(url):
    with pytest.raises(UnsafeUrl):
        check_public_url(url)
