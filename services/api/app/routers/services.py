from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException

from ..capabilities import parse

router = APIRouter(prefix="/api/services", tags=["services"])

# The server fetches a URL the user typed, so keep the door narrow.
ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_HOSTS = {"169.254.169.254", "metadata.google.internal"}


@router.get("/wms/capabilities")
async def wms_capabilities(url: str, version: str = "1.3.0") -> dict:
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.hostname:
        raise HTTPException(400, "A WMS URL has to be http or https.")
    if parsed.hostname in BLOCKED_HOSTS:
        raise HTTPException(400, "That host is not reachable from here.")

    params = {"service": "WMS", "request": "GetCapabilities", "version": version}
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(url.split("?")[0], params=params)
            response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(502, f"The server did not answer: {error}") from error

    try:
        described = parse(response.text)
    except Exception as error:  # noqa: BLE001 - any malformed document lands here
        raise HTTPException(422, "That did not look like a capabilities document.") from error

    described["url"] = url.split("?")[0]
    return described
