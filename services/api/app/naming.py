"""Turning a file name into a table name, safely.

Nothing a caller sends ever reaches a query as an identifier. A name is slugged,
checked against a pattern, and only then written to the registry; the tile endpoint
reads identifiers back out of the registry rather than out of the request.
"""

import re
import unicodedata

IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]{0,50}$")

# What a column may be called. Wider than what we are willing to *name* a table:
# a table name is ours to choose, a column name arrives with the data. PostgreSQL
# allows 63 bytes and mixed case, and GDAL will happily hand back `ISO_A2` or a
# name that starts with an underscore. Still nothing but letters, digits and
# underscores, so the result cannot carry a quote, a space or a semicolon.
COLUMN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")

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


def quote_column(name: str) -> str:
    """
    A column name, safe to format into SQL.

    `check_identifier` was doing this job and refusing anything it had not been
    written for: uppercase, a leading underscore, or more than fifty one
    characters. Natural Earth has all three, so importing one of those files
    registered fine and then answered 500 on the first query that named its
    columns. The pattern is still restrictive enough that the result cannot carry
    a quote or a space; quoting on top means PostgreSQL takes it literally,
    uppercase and all.
    """
    if not COLUMN.match(name):
        raise ValueError(f"Not a usable column name: {name!r}")
    escaped = name.replace('"', '""')
    return f'"{escaped}"'


def is_usable_column(name: str) -> bool:
    return bool(COLUMN.match(name))
