"""Application configuration, read from environment variables.

Per requirements.md R3: no real secret value is recoverable from this repo
(no `application.properties` ever existed for the Java service), so nothing
here carries a hardcoded secret default. `JWT_SECRET` and `DATABASE_URL` are
required — constructing `Settings()` raises `pydantic.ValidationError`
immediately (a loud startup failure) if either is missing, rather than
silently falling back to a default. The remaining vars are operational
tuning knobs (not secrets) and keep the same defaults documented in
`.env.example`/`docker-compose.yml`.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Required — no default (see module docstring).
    jwt_secret: str
    database_url: str

    # Operational tuning knobs — defaults match `.env.example`.
    jwt_expiration_ms: int = 3_600_000
    cors_allowed_origins: str = "http://localhost:5173"
    footprint_problem_base_uri: str = "https://aj.example.com/problems/"
    footprint_audit_retry_max_attempts: int = 3
    footprint_audit_retry_delay_ms: int = 200
    footprint_audit_retry_multiplier: float = 2.0

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        """`CORS_ALLOWED_ORIGINS` as a parsed, trimmed list."""
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


settings = Settings()
