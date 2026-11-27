# Codebase infra — recipients (users/auth/families), config, compose, tests

## TL;DR
- The address lives on `user_profiles.email`, which is nullable, unique on `lower(email)` (partial), and stored normalised (trim + lower) for self-registered accounts. There is no verified flag on the profile. Only `user_identities.email_verified` exists, and only for Google accounts. These do not exist: email verification, password reset, password change, email change.
- Recipients are parties. Lightweight family members (children) have `email=None` and no login. Guardians added by another guardian may have no email. An email handler must resolve party → profile → email, and treat "no address" as a skip, not as an error.
- Config follows the `pydantic-settings` pattern with an optional `None` default, a derived `*_configured` property and a gate on both stacks (Spaces, Google). No `EMAIL_*` or base-URL setting exists. `httpx` is already a runtime dependency. Jinja2 is not.
- Compose has `postgres`, `backend`, `matcher`, `web` and `frontend` (nginx). There is no mail catcher. The backend has no restart policy.
- Test pattern to copy: `FakeStorage` injected through a dependency override, a `registry.clear()` autouse fixture, and direct `dispatch_pending(db_session)` calls.

## Key Decisions
- Treat Google sign-ups (`user_identities.email_verified=true`, enforced at creation) as already verified. Password accounts need a verification flow before non-auth mail. Rationale: `auth/service.py:127-128`, `auth/models.py:91-92`.
- Model the email sender as a `Protocol` port with a `get_x()` / `set_x()` accessor, mirroring `storage/service.py:25-37, 126-129` (`ObjectStorage | None` while unconfigured), and a fake in `tests/`.

## Open Questions / Risks
- Party types: some bell recipients may be an Organization party (for example the listing `owner_party_id` of an organization-owned item, `term_item_listings.py:699-704`). Organizations have no profile email, so resolution to the owning person is unclear. This was not verified and needs a check by the triggers gatherer or synthesis.
- Family-created profiles store the email "as typed" (`users/service.py:280-281`), while login compares an exact lowercase match (`auth/router.py:82-84`). An email module should compare and send by `lower(email)`.
- With no password reset, Google-only accounts (NULL `password_hash`) have no recovery path (documented as an accepted risk in INDEX/architecture). Reset-by-email would be the first auth email.

---

## 1. Where the address lives

**`user_profiles`**, `src/backend/app/users/models.py:45-74`:
```python
account_user_id: Mapped[uuid.UUID | None] = ...  # None for a lightweight family member (L53-60)
display_name: Mapped[str] = mapped_column(String(255), nullable=False)
email: Mapped[str | None] = mapped_column(String(255), nullable=True)   # L62
```
- Partial unique index: `CREATE UNIQUE INDEX uq_user_profiles_email_lower ON user_profiles (lower(email)) WHERE email IS NOT NULL` (`alembic/versions/0016_unique_user_profile_email.py:32-40`). The docstring there says anonymous RSVP profiles have `email IS NULL`.
- Normalisation: `normalize_email = value.strip().lower()` (`users/schemas.py:26-35`), applied in `RegisterRequest` (`users/schemas.py:133-141`) and `LoginRequest` (`auth/router.py:64-73`).
- `is_email_registered` compares case-insensitively (`users/service.py:279-288`).
- No `email_verified_at`, consent, locale or preference columns exist on `UserProfile` (full column list at L45-74).

**`users` (auth)**, `src/backend/app/auth/models.py:50-54`: `username String(50) unique`, `password_hash String(72)` **nullable**. A NULL hash means a Google-created account (migration 0108; docstring L5-6).

**`user_identities`**, `src/backend/app/auth/models.py:71-92`: `provider` (only `GOOGLE`, L57-58), `subject`, `email` (a snapshot "never used to find the account", L72-74), `email_verified bool NOT NULL`. The value is refreshed on each login (`auth/service.py:72-75`).
**Confidence**: High.

## 2. Account flows (and gaps)

- Password registration: `users/service.py:328-354` → `bootstrap_person_account` (L291-315), which creates the login, `Party(PERSON)`, the profile with email, the USER role and a solo Family. It flushes, and `register` commits (L351). No verification step and no welcome hook exist.
- Google sign-up: `auth/service.py:119-140`. An unverified email is rejected with 403 (L127-128), a registered email with 409 (L129-130), and otherwise `_bootstrap_google_account` (L98-114) creates the account with `password=None` and a `UserIdentity(email_verified=claims.email_verified)`. `email_verified` comes from `claims.get("email_verified") is True` (`auth/google.py:238-245`). The Google module docstring says "Never log the credential, the cookie, the nonce or the email" (`auth/google.py:5`). That rule should carry over to email logging.
- Login: `auth/router.py:80-105`. A profile without `account_user_id` or a NULL hash fails like a wrong password.
- **None of these exist**: password reset, forgot password, email verification, email change, password change. A grep for `reset|forgot|verify_email|change_password|email_change` found no auth or user flow. The only mutating routes are `auth/router.py:80` (login), `:168` (google nonce), `:179` (google), and in `users/router.py` POST L42 (register), PATCH `/api/people/me` L80 (name and bio only, `users/service.py:120-133`), PATCH `/me/appearance` L88, and the media routes L99/L118/L126.
**Confidence**: High.

## 3. Families: recipients without an address

- Lightweight member: `families/members.py:24-62`. It creates a `UserProfile(account_user_id=None, email=None, ...)` (L36-44) with a `FamilyRole` (GUARDIAN or CHILD) and a membership with `is_primary_contact=False`.
- Guardian added by a guardian: `families/guardians.py:28-50` → `create_account_and_profile(db, data.username, data.password, data.display_name, data.email)`. Here `AddGuardianRequest.email` is `str | None` (`families/schemas.py:65-69`), and so is `CreateFamilyRequest.email` (L62). Such a guardian may have a login but no email, and the email is not normalised through `RegisterRequest`.
- Primary contact: `families/models.py:1-9, 79-98`. `FamilyMembership.is_primary_contact` (at most one active per Family) is "the identity bridge into `app.inventory`". It could route mail for a child to the primary-contact guardian, but no code does that today (`is_primary_contact` is referenced only inside `app/families`).
- `GuardianResponse.email` is exposed to co-guardians (`families/schemas.py:114-123`, `guardians.py:71`).
**Confidence**: High (code). The routing of child mail to a guardian is a design proposal, not existing behaviour.

## 4. Configuration pattern

**Source**: `src/backend/app/config.py:21-102`
- `Settings(BaseSettings)` with `env_file=".env"` and `extra="ignore"` (L22). Required values have no default (`jwt_secret`, `database_url`, L25-26).
- Optional integrations are `None` by default plus a derived property: `photo_storage_configured` = all six `SPACES_*` set (L35-41, L84-95), and `google_login_configured = bool(self.google_client_id)` (L97-99) with a whitespace-strip validator (L73-77). Feature flags are bools defaulting to False (`moderation_text_enabled`, `embeddings_enabled`, L46-55). `auth_cookie_secure` has an "empty placeholder = default" validator (L66-71), which is the pattern for any `EMAIL_*` bool copied from `.env.example` as empty.
- No `EMAIL_*`, `SMTP_*`, `APP_PUBLIC_BASE_URL` or link-signing secret exists. `JWT_SECRET` already backs a derived purpose key for the Google nonce cookie (INDEX security standard: "an HS256 JWT under a purpose key derived from `JWT_SECRET`"). The same derivation could sign unsubscribe and verify tokens instead of a new secret, which is a design option.

**`.env.example` variable names** (names only): `JWT_SECRET`, `JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `DATABASE_URL`, `FOOTPRINT_AUDIT_RETRY_MAX_ATTEMPTS`, `FOOTPRINT_AUDIT_RETRY_DELAY_MS`, `FOOTPRINT_AUDIT_RETRY_MULTIPLIER`, `SPACES_ENDPOINT_URL`, `SPACES_REGION`, `SPACES_BUCKET`, `SPACES_KEY`, `SPACES_SECRET`, `SPACES_PUBLIC_BASE_URL`, `MODERATION_TEXT_ENABLED`, `MODERATION_TEXT_REJECT_THRESHOLD`, `MODERATION_MODELS_DIR`, `MODERATION_IMAGE_ENABLED`, `EMBEDDINGS_ENABLED`, `EMBEDDINGS_MODEL_DIR`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `AUTH_COOKIE_SECURE`. No email-related names.

**Dependencies**: `src/backend/pyproject.toml:6-23`. `httpx>=0.27` is a runtime dependency (L21), already used for Google JWKS with an explicit timeout (`auth/google.py:21, 143`), and `apscheduler>=3.10,<4` (L18). **Jinja2 is not a dependency.** `markupsafe` is only transitive through `mako` (Alembic) (`uv.lock:1025-1031`). Templating would need either a new dependency (`jinja2`) or plain Python f-strings / `string.Template` with `html.escape`.
**Confidence**: High.

## 5. Docker compose

**Source**: `docker-compose.yml`
- Services: `postgres` (L2, `pgvector/pgvector:0.8.7-pg18-trixie`), `backend` (L18-50), `matcher` (L58-68, `restart: unless-stopped` L60, only `DATABASE_URL`), `web` (L70), `frontend` nginx (L87-92, port 5174).
- `backend.environment` lists every variable explicitly by `${NAME…}` interpolation (L31-46). New `EMAIL_*` variables must be added there too, not only to `.env.example`. The backend has **no `restart:` policy** (L18-50; also noted in INDEX for the embeddings runbook). The backend command runs `alembic upgrade head` before uvicorn (L28).
- No mail catcher (Mailpit) service exists. A dev-only one would be a new service or a compose profile.
**Confidence**: High.

## 6. Test infrastructure for an email handler

- Outbox tests: `tests/test_outbox.py:21-25` uses an autouse `_clean_registry` fixture (`registry.clear()` before and after), and tests call `dispatch_pending(db_session)` directly (L52, L67, L84, L101). They assert `MAX_ATTEMPTS` → FAILED and one ERROR log (L92-123).
- Notification tests: `tests/test_notifications.py:11, 29, 40` say each test "must explicitly run the poller (`dispatch_pending`)". Filtered dispatch is used in `tests/test_product_embeddings.py:181` (`dispatch_pending(db_session, event_types=[EMBEDDINGS_REQUESTED])`).
- Fake adapter pattern: `tests/fake_storage.py` (an in-memory `FakeStorage` recording calls), the `fake_storage` fixture (`tests/conftest.py:235`), and the `client` fixture overriding `get_db` and `get_storage` (`conftest.py:289-307`). A `FakeEmailSender` recording `(to, subject, text, html, headers)` fits the same way, either as a dependency override or as a module-level `set_sender()` like `embeddings_service.set_embedder` (`main.py:233, 267`).
- Boundary guard: `tests/test_module_boundaries.py:1-20`, `MODULES = ("pages", "search", "wants")`. A new `app/email` could be added to this guard so that it is imported only by `main.py` and its consumer ACLs (as `app.points` is, per the docstring L4-6).
**Confidence**: High.
