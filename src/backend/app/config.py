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

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Required — no default (see module docstring).
    jwt_secret: str
    database_url: str

    # Operational tuning knobs — defaults match `.env.example`.
    jwt_expiration_ms: int = 3_600_000
    cors_allowed_origins: str = "http://localhost:5173"

    # Photo storage (DigitalOcean Spaces or any S3-compatible store). Optional:
    # photo upload is disabled until all of these are set, so tests and local
    # runs work without a bucket.
    spaces_endpoint_url: str | None = None
    spaces_region: str | None = None
    spaces_bucket: str | None = None
    spaces_key: str | None = None
    spaces_secret: str | None = None
    # Public (CDN) base URL of the bucket, e.g. https://<bucket>.fra1.cdn.digitaloceanspaces.com
    spaces_public_base_url: str | None = None

    # Independent switches: text is checked synchronously in the API (Bielik-Guard
    # loaded at startup). Photos: true = uploads stay PENDING until VPS B's cron
    # decides; enable only together with MODERATION_CRON_ENABLED on VPS B.
    moderation_text_enabled: bool = False
    moderation_image_enabled: bool = False
    # Exported ONNX models (`<dir>/text`).
    moderation_models_dir: str = "/models"
    # Any Bielik-Guard category score >= this -> the write is rejected (400).
    moderation_text_reject_threshold: float = 0.8
    # Removed `MODERATION_ENABLED`; read only so startup can warn that it is ignored.
    legacy_moderation_enabled: str | None = Field(
        default=None, validation_alias="MODERATION_ENABLED"
    )

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        """`CORS_ALLOWED_ORIGINS` as a parsed, trimmed list."""
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @property
    def photo_storage_configured(self) -> bool:
        return all(
            (
                self.spaces_endpoint_url,
                self.spaces_region,
                self.spaces_bucket,
                self.spaces_key,
                self.spaces_secret,
                self.spaces_public_base_url,
            )
        )


settings = Settings()
