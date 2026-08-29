from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


@app.get("/api/health")
async def health() -> dict:
    async with pool().acquire() as conn:
        version = await conn.fetchval("SELECT postgis_version()")
        wards = await conn.fetchval("SELECT count(*) FROM wards_1400")
        registered = await conn.fetchval("SELECT count(*) FROM layers")
    return {"status": "ok", "postgis": version, "wards": wards, "layers": registered}
