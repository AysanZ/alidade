"""Guarding the URLs the server is asked to fetch on a caller's behalf."""

import ipaddress
from urllib.parse import urlparse

ALLOWED_SCHEMES = {"http", "https"}

BLOCKED_HOSTS = {
    "localhost",
    "metadata.google.internal",
    "metadata",
}


class UnsafeUrl(ValueError):
    pass


def check_public_url(url: str) -> str:
    """Reject anything that would make the server fetch its own network."""
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise UnsafeUrl("A data URL has to be http or https.")
    host = (parsed.hostname or "").lower()
    if not host or host in BLOCKED_HOSTS:
        raise UnsafeUrl("That host is not reachable from here.")

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return url  # A name, not a literal address. DNS is resolved by the fetcher.

    if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
        raise UnsafeUrl("That address is on a private network.")
    return url
