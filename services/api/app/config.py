from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_user: str = "alidade"
    postgres_password: str = "change_me"
    postgres_db: str = "alidade"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    tile_cache_seconds: int = 300
    # Connections held against Postgres. Ten of them competing for two
    # cores is slower than five that are not, and `max_connections` on the
    # server is 20, shared with psql and anything else that attaches.
    db_pool_min: int = 1
    db_pool_max: int = 10
    cors_origins: str = "http://localhost:5173"
    max_upload_mb: int = 200
    # Where uploaded 3D models are kept. A volume in the compose stack.
    models_dir: str = "./models"

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
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
