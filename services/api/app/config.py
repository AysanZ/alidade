from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_user: str = "alidade"
    postgres_password: str = "change_me"
    postgres_db: str = "alidade"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    tile_cache_seconds: int = 300
    cors_origins: str = "http://localhost:5173"

    @property
    def dsn(self) -> str:
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
