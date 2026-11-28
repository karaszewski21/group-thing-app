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

import re
from typing import Any, Literal

from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# A plain-http base URL is accepted only for a local host, with an optional
# port and path; `http://localhost.evil.tld` is not local.
_LOCAL_BASE_URL = re.compile(r"http://(localhost|127\.0\.0\.1)(:\d{1,5})?(/.*)?")


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
    # Name embeddings for the SIMILAR want tier; independent of moderation.
    embeddings_enabled: bool = False
    # Exported int8 ONNX embed model with its `model_id.txt`.
    embeddings_model_dir: str = "/models/embed"
    # Google sign-in stays off (both routes 503) until the OAuth Web client ID
    # is set; an empty or whitespace-only value counts as unset.
    google_client_id: str | None = None
    # `Secure` on the auth-flow cookie; false only over plain http (dev, Safari).
    auth_cookie_secure: bool = True
    # Removed `MODERATION_ENABLED`; read only so startup can warn that it is ignored.
    legacy_moderation_enabled: str | None = Field(
        default=None, validation_alias="MODERATION_ENABLED"
    )

    # E-mail (`app/email`). `EMAIL_ENABLED` gates everything; bell mail also
    # needs `EMAIL_NOTIFICATIONS_ENABLED`. Startup fails while enabled and
    # `email_configuration_errors` is non-empty.
    email_enabled: bool = False
    email_notifications_enabled: bool = False
    email_backend: Literal["mailgun", "smtp", "log"] = "log"
    email_provider_api_url: str | None = None
    email_provider_api_key: str | None = None
    email_from_address: str | None = None
    email_from_name: str = "Gooo"
    email_reply_to_address: str | None = None
    email_link_signing_secret: str | None = None
    email_webhook_signing_key: str | None = None
    # Mails sent per Warsaw day (both streams); only bell mail is held back.
    email_daily_cap: int = Field(default=100, ge=0)
    # SMTP backend: Mailpit only (no auth, no TLS).
    email_smtp_host: str | None = None
    email_smtp_port: int = 1025
    # Origin used in mail links, without a trailing slash.
    app_public_base_url: str | None = None

    @field_validator("auth_cookie_secure", mode="before")
    @classmethod
    def _empty_cookie_secure_is_default(cls, value: Any) -> Any:
        """An empty `AUTH_COOKIE_SECURE=` placeholder copied from `.env.example`
        keeps the secure default instead of failing startup."""
        return True if value == "" else value

    @field_validator("google_client_id", mode="before")
    @classmethod
    def _strip_google_client_id(cls, value: Any) -> Any:
        """A whitespace-only `GOOGLE_CLIENT_ID` counts as unset."""
        return value.strip() if isinstance(value, str) else value

    @field_validator(
        "email_enabled",
        "email_notifications_enabled",
        "email_backend",
        "email_provider_api_url",
        "email_provider_api_key",
        "email_from_address",
        "email_from_name",
        "email_reply_to_address",
        "email_link_signing_secret",
        "email_webhook_signing_key",
        "email_daily_cap",
        "email_smtp_host",
        "email_smtp_port",
        "app_public_base_url",
        mode="before",
    )
    @classmethod
    def _blank_email_setting_is_unset(cls, value: Any, info: ValidationInfo) -> Any:
        """An empty or whitespace-only placeholder counts as unset: `None` for
        optional values, the default for the rest (flags, cap, port, name)."""
        if isinstance(value, str) and not value.strip() and info.field_name:
            return cls.model_fields[info.field_name].default
        return value

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

    @property
    def google_login_configured(self) -> bool:
        return bool(self.google_client_id)

    @property
    def email_configuration_errors(self) -> list[str]:
        """Names (never values) of the e-mail variables that are missing or
        invalid while `EMAIL_ENABLED=true`; empty while it is off."""
        if not self.email_enabled:
            return []
        errors: list[str] = []
        if not self.email_from_address:
            errors.append("EMAIL_FROM_ADDRESS")
        if not self.email_link_signing_secret or len(self.email_link_signing_secret) < 32:
            errors.append("EMAIL_LINK_SIGNING_SECRET")
        base_url = self.app_public_base_url or ""
        if not (base_url.startswith("https://") or _LOCAL_BASE_URL.fullmatch(base_url)):
            errors.append("APP_PUBLIC_BASE_URL")
        if self.email_backend == "mailgun":
            if not (self.email_provider_api_url or "").startswith("https://"):
                errors.append("EMAIL_PROVIDER_API_URL")
            if not self.email_provider_api_key:
                errors.append("EMAIL_PROVIDER_API_KEY")
            if not self.email_webhook_signing_key:
                errors.append("EMAIL_WEBHOOK_SIGNING_KEY")
        elif self.email_backend == "smtp" and not self.email_smtp_host:
            errors.append("EMAIL_SMTP_HOST")
        return errors


settings = Settings()
