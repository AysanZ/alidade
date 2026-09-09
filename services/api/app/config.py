from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_user: str = "alidade"
    postgres_password: str = "change_me"
    postgres_db: str = "alidade"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    tile_cache_seconds: int = 300
    # Kept below the server's max_connections.
    db_pool_min: int = 1
    db_pool_max: int = 10
    cors_origins: str = "http://localhost:5173"
    max_upload_mb: int = 200
    # Layers a delete request will not touch. On a public instance this is what
    # keeps the map you curated from being cleared by the first visitor who
    # finds the button.
    protected_layers: str = ""
    # Where uploaded 3D models are kept. A volume in the compose stack.
    models_dir: str = "./models"
    # Where converted imagery is kept. A volume too: these are files, not rows,
    # and a COG of one satellite scene is a couple of hundred megabytes.
    rasters_dir: str = "./rasters"
    # Imagery is bigger than vector data by an order of magnitude, so it gets its
    # own ceiling rather than sharing the upload limit with a Shapefile.
    max_raster_mb: int = 4096
    # How many images one tile may be built from. Reading a hundred COGs for one
    # tile is not a mosaic, it is a timeout, and past a handful the ones
    # underneath are never seen anyway.
    max_mosaic_assets: int = 6

    # The built-in live feed. Simulated, so the studio has something to connect
    # to without a fleet attached; replace the endpoint's source and the client
    # does not change. Tehran by default because that is where the sample data
    # in data/seed.sh is, and a demo feed on the other side of the world from
    # the demo layers is a demo of nothing.
    live_fleet_size: int = 60
    live_centre_lon: float = 51.39
    live_centre_lat: float = 35.69
    # Seconds between frames. One is fast enough to look live and slow enough
    # that a fleet of a few hundred is a few hundred messages a second, not
    # tens of thousands.
    live_interval_seconds: float = 1.0
    # How often a reporting vehicle goes quiet, per vehicle per frame, and for
    # how long. Without this nothing on the map is ever stale and the state
    # exists in the code and never on the screen.
    live_quiet_chance: float = 0.004
    live_quiet_seconds: float = 45.0

    @property
    def dsn(self) -> str:
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def ogr_dsn(self) -> str:
        """What ogr2ogr expects, which is not a URL."""
        return (
            f"PG:host={self.postgres_host} port={self.postgres_port} "
            f"dbname={self.postgres_db} user={self.postgres_user} "
            f"password={self.postgres_password}"
        )

    @property
    def protected(self) -> set[str]:
        return {p.strip() for p in self.protected_layers.split(",") if p.strip()}

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
