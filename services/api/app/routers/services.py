import httpx
from fastapi import APIRouter, HTTPException

from ..capabilities import parse
from ..net import UnsafeUrl, check_public_url

router = APIRouter(prefix="/api/services", tags=["services"])


@router.get("/wms/capabilities")
async def wms_capabilities(url: str, version: str = "1.3.0") -> dict:
    try:
        check_public_url(url)
    except UnsafeUrl as error:
        raise HTTPException(400, str(error)) from error

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
