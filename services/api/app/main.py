import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import close_pool, open_pool, pool
from .routers import layers, services, tiles


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="Alidade API", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)
app.include_router(tiles.router)
app.include_router(layers.router)
app.include_router(services.router)

logger = logging.getLogger(__name__)


@app.exception_handler(ValueError)
async def unusable_name(request: Request, error: ValueError) -> JSONResponse:
    """
    A name the server will not put in a query is a fact about the data, not a
    crash. It used to reach the client as a bare 500 with the reason only in the
    container log, which is the least useful place for it.
    """
    logger.warning("%s refused: %s", request.url.path, error)
    return JSONResponse(status_code=422, content={"detail": str(error)})


@app.get("/api/health")
async def health() -> dict:
    async with pool().acquire() as conn:
        version = await conn.fetchval("SELECT postgis_version()")
        wards = await conn.fetchval("SELECT count(*) FROM wards_1400")
        registered = await conn.fetchval("SELECT count(*) FROM layers")
    return {"status": "ok", "postgis": version, "wards": wards, "layers": registered}
