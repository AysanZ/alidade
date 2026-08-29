from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_user: str = "alidade"
    postgres_password: str = "change_me"
    postgres_db: str = "alidade"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    tile_cache_seconds: int = 300
    cors_origins: str = "http://localhost:5173"
    max_upload_mb: int = 200

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
