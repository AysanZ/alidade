"""Turning a file name into a table name, safely.

Nothing a caller sends ever reaches a query as an identifier. A name is slugged,
checked against a pattern, and only then written to the registry; the tile endpoint
reads identifiers back out of the registry rather than out of the request.
"""

import re
import unicodedata

IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]{0,50}$")

RESERVED = {"layers", "spatial_ref_sys", "geometry_columns", "user", "table", "select"}


def slug(text: str) -> str:
    """A lowercase ASCII fragment, or an empty string if nothing survives."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_text).strip("_").lower()
    return re.sub(r"_+", "_", cleaned)[:40]


def table_name(filename: str, suffix: str) -> str:
    """`Tehran Wards.zip` becomes `up_tehran_wards_8f3a2c`."""
    stem = slug(filename.rsplit(".", 1)[0]) or "layer"
    name = f"up_{stem}_{suffix}"[:50]
    if not IDENTIFIER.match(name):
        raise ValueError(f"Refusing to use {name!r} as a table name.")
    return name


def check_identifier(name: str) -> str:
    """Last line of defence before an identifier is formatted into SQL."""
    if not IDENTIFIER.match(name) or name in RESERVED:
        raise ValueError(f"Not a usable identifier: {name!r}")
    return name
