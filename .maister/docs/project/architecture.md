# System Architecture

## Overview

**aj** is a plugin-based microkernel platform. The backend (`src/backend/`) was migrated from a Java/Spring Boot scaffold to Python/FastAPI + SQLAlchemy + Alembic (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/` for the full migration record). The system is no longer pre-alpha scaffolding — it has real business logic across four verticals (category, product, plugin, footprint) plus a full hand-rolled OAuth2 authorization server, is runnable end-to-end via `docker-compose up`, and passed a 53/53-check integration verification pass with the fully wired application (no regressions across any prior module's acceptance criteria).

## Architecture Pattern

**Pattern**: Microkernel (Plugin-Based) — plugins are frontend iframes (`plugins/`) that talk to the host API via a browser SDK (`postMessage`/`hostApp.getToken()`) and a server-side SDK (`createServerSDK`), not a server-side plugin-loading framework. See `standards/backend/plugin-auth.md`.

**Current state**: A single FastAPI application (`app/main.py`) exposing category, product, plugin, footprint, auth, and OAuth2 routers behind one centralized authorization dependency layer. No server-side plugin-loading mechanism exists yet — that remains a future decision (see `project/tech-stack.md`'s "Architectural Decisions Pending").

## System Structure

### Application Core
- **Location**: `src/backend/app/`
- **Purpose**: FastAPI application bootstrap, cross-cutting infrastructure, and per-vertical routers
- **Key Files**: `app/main.py` (entry point — instantiates `FastAPI()`, wires CORS, registers every exception handler, includes every router with `system_router` registered last so its SPA-fallback catch-all doesn't shadow more specific routes)

### Configuration
- **Location**: `src/backend/app/config.py`
- **Purpose**: Environment-variable-backed settings (`pydantic_settings.BaseSettings`). `JWT_SECRET` and `DATABASE_URL` are required with no default (fail-loud `ValidationError` on startup if missing); the remaining vars (`JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `FOOTPRINT_AUDIT_RETRY_*`, `SPACES_*`, `MODERATION_*`) are operational tuning knobs with defaults matching `.env.example`/`docker-compose.yml`
- **Key Files**: `.env.example`, `docker-compose.yml`, `Dockerfile`

### Database Layer
- **Location**: `src/backend/alembic/`
- **Purpose**: Alembic database migrations
- **Technology**: PostgreSQL 18 via SQLAlchemy 2.0 (async, `asyncpg` driver)
- **Status**: One migration (`alembic/versions/0001_initial_schema.py`) reconstructs the entire schema, since no Liquibase changelog was ever populated in the Java source. Includes 6 explicitly-reconstructed FK/constraint items that existed nowhere as DDL in the original repo (see the migration's `work-log.md`, Group 2 entry, for the full checklist).

### Test Infrastructure
- **Status**: No automated pytest/TestContainers-python suite exists yet (deliberately deferred — see `project/tech-stack.md` and the migration's `spec.md` "Out of Scope"). Each vertical was verified during migration via live-uvicorn + real-Postgres manual verification scripts, not committed as a formal suite. `standards/testing/backend-testing.md` remains the target strategy for that follow-up work.

## Data Flow

```
Client Request → FastAPI Router → Auth Dependency (require_any) → Service Layer → SQLAlchemy (ORM or Core) → PostgreSQL
```

Each route enforces its own requirement through `Depends(require_any(...))` (no dependency for PUBLIC routes). `AUTHORIZATION_MATRIX` in `app/core/authorization_matrix.py` is a reference table of those requirements, verified by `tests/test_authorization_matrix.py`; nothing applies it centrally at request time (see `standards/backend/security.md`).

Plugin iframes reach the same routers via the host's browser SDK, which attaches the same JWT the router-level auth dependency validates — there is no separate plugin-specific auth path on the server side (see `standards/backend/plugin-auth.md`).

## Domain clock (Europe/Warsaw)

`Term.occurs_on` is a naive Europe/Warsaw wall clock (unlike the naive-UTC audit columns such as `created_at`). `app/core/clock.py` is the only definition of "now" for Term logic: `clock.local_now()` converts the current UTC instant to Warsaw time through `zoneinfo`, so it never depends on the host or container `TZ`. Call sites use `clock.local_now()` (module attribute access) so the opt-in `freeze_local_now` test fixture reaches all of them. The same module holds the Polish short date formatters and the notification-length cap.

Ops: the `lifespan` startup calls `clock.check_timezone()` before the outbox poller and APScheduler start. It fails with an "install tzdata" error if the zone cannot load, and otherwise logs one line, `Europe/Warsaw (CET|CEST)`. Setting `TZ=Europe/Warsaw` in compose is optional and no code relies on it.

## Photo Upload and Content Moderation

```
POST /api/products/{id}/photos (multipart) → Pillow sanitize → Spaces (private)
      → one transaction under the product FOR UPDATE lock:
          product_photos(PENDING) → COMMIT (listings are left untouched)
                                   ↓ (shared Postgres, polled)
VPS B moderation-cron (group-thing-ai, python -m app.moderation_cron, every 30 s)
      → claim PENDING (FOR UPDATE SKIP LOCKED) → Spaces get → ShieldGemma-2 in-process
      → APPROVED (files public-read, CDN)
      | NEEDS_REVIEW → /api/moderation (ADMIN)   (files private)
      | REJECTED                                 (files private)
      + one moderation_decisions row (source AI, automated)

PUT /api/item-listing-preferences/{item_id} (mode ≠ null) → listed whatever the photo status
```

Two independent flags, both default `false`: `MODERATION_TEXT_ENABLED` (API) and `MODERATION_IMAGE_ENABLED` (API). The API logs both at startup. The old `MODERATION_ENABLED` is ignored (unknown env vars are dropped), so a stale `.env` that still sets it gets photos approved on upload. `MODERATION_IMAGE_ENABLED=true` must be paired with `MODERATION_CRON_ENABLED=true` on VPS B: with the app flag on and the cron off, photos stay PENDING and are hidden from non-owners, although their items can still be listed (an admin can still decide them in the queue); with the app flag off, uploads are APPROVED at once and the cron has nothing to do.

**Text: synchronous and reject-only, in the API process.**
- `app/moderation/text_guard.py` `check_text(field, new, current=None)` runs Bielik-Guard-0.1B (ONNX, 1 intra-op thread) via `asyncio.to_thread` before the write.
- Checked fields: organization name, group name, term description, product name, the shared product description, and a needed item's name and description (checked as product name/description). This includes the resolve/create branch and the `plugin_data` PUT.
- A value is scored only when it changes (normalised comparison with `current`), so untouched legacy text is never re-checked.
- Any category score ≥ `MODERATION_TEXT_REJECT_THRESHOLD` (default 0.8) → 400 with a Polish message and no scores. Model unavailable → 503 (fail-closed).
- With the flag on, the API lifespan loads the model from `MODERATION_MODELS_DIR` (`<dir>/text`), and startup fails if that is impossible.
- No text status is stored and no text goes through the queue: products have no `text_status`/`text_moderated_hash` (migration 0047 marks leftover `moderation.text_requested` events PROCESSED and moves PENDING photos whose event already FAILED to NEEDS_REVIEW; 0048 drops the columns). Old `PRODUCT_TEXT` decisions remain only as audit rows.
- The synchronous contact-info regex rules (`rules.py`, 400) are unchanged.

**Photos: asynchronous, decided by the cron on VPS B.**
- The decision logic lives only in `group-thing-ai` (`app/photo_moderation.py`, `app/moderation_cron.py`; see its README "Photo moderation cron"). The `moderation-cron` compose service (profile `shield`, switched by `MODERATION_CRON_ENABLED`) reads PENDING `product_photos` straight from the shared Postgres and scores them with ShieldGemma-2 in-process. The app sends nothing to VPS B for moderation.
- Every `MODERATION_CRON_INTERVAL_S` (30) it processes up to `MODERATION_CRON_BATCH` (5) photos, oldest first, one at a time. A tick is skipped while the shield is unhealthy, so an outage uses up no attempts.
- Per category: `sexual`/`violence`/`dangerous` score ≥ `MODERATION_IMAGE_REVIEW_THRESHOLD` (0.5) → NEEDS_REVIEW, ≥ `MODERATION_IMAGE_REJECT_THRESHOLD` (0.9) → REJECTED; `weapons` is review-only. The most severe outcome wins. The cron reads these thresholds from its own `.env.cron`; the app has no image thresholds.
- APPROVED makes both files (`w1600`, `w400`) public before the status write. Every other outcome makes both files private first, every time, because an earlier attempt may have left them public.
- **Retry state** is on the photo row (migration 0049): `moderation_attempts` (INTEGER NOT NULL, default 0) and `moderation_retry_at` (naive UTC TIMESTAMP), plus the partial index `ix_product_photos_pending_created_at` on `(created_at, id) WHERE status = 'PENDING'`. Only VPS B writes them.
  - The claim increments `moderation_attempts` and sets a lease in `moderation_retry_at`. The finalize is guarded with `WHERE status = 'PENDING' AND moderation_attempts = :claimed`, so an admin decision or a delete during scoring wins and the cron's result is discarded.
  - A failed attempt is retried after timeout + 30 s·2^(n-1), measured from the failure. After 5 attempts the photo goes to NEEDS_REVIEW with the note "AI unavailable after 5 attempts" and a null-score decision (shown as "No model score" in the admin queue).
  - Every B update sets `updated_at` explicitly, because it is the ORM's optimistic-lock token. A concurrent app update of the same photo (e.g. reorder) can rarely fail with the existing 409 `StaleDataError` response.
- VPS A runs no photo worker: `add_product_photo` writes no outbox event for moderation, and the app has no VPS B client or `MODERATION_AI_*` settings. `MODERATION_IMAGE_ENABLED` is the app's only photo-moderation switch (true = uploads stay PENDING until the cron decides). Leftover `moderation.photo_requested` outbox rows from the old worker are marked PROCESSED by the API poller (no handler).

**Listing is not gated by photo moderation (`app/groups/application/term_item_listings.py`).**
- An item can be listed (Oddam/Zamienię) while its product has a PENDING or NEEDS_REVIEW photo. A new pending photo (`add_product_photo`) or re-pointing an item to another product (`update_item`) leaves existing listings untouched; neither takes a groups hook any more. The earlier publish gate, withdraw on upload/re-point and the one-time `withdraw_unmoderated_listings` cleanup script were removed. Non-owners still see only APPROVED photos, so a listed item may show no photo until moderation finishes.
- **UI flag**: `GET /api/inventory-items/mine` still returns `photos_moderation_pending` per item (one batched `product_ids_with_unmoderated_photos` query). It is informational only.
- **`listing_status` lockstep**: `inventory_items.listing_status` (DRAFT/ACTIVE) mirrors the `item_listing_preferences` row: ACTIVE exactly when a preference exists. `register_item` sets it (optionally creating the preference through the router-injected `on_registered` hook); `set_item_listing_preference` (under an item `FOR UPDATE` lock) and `confirm_transaction` change it only through the flush-only `circulation_bridge.set_item_listing_status`, in the same commit as the preference write. Every listing read stays preference-driven.
- **Taken-list fallback**: when an active reservation's preference was cleared by its owner, `list_my_active_taken_term_item_listings` builds a transient `ItemListingPreference` (never added to the session) from the reservation, so the taker still sees the item and can confirm it.
- **Category tree**: `categories` is a tree (`parent_id`, nullable `external_id`) seeded from the Polish Vinted snapshot `alembic/data/vinted_categories_pl.json`. Products may only use leaf categories (`require_leaf_category` in `app/category/service.py`: 404 unknown, 409 non-leaf); admins add, rename, reorder siblings and delete nodes, but cannot reparent them.
- **Needed items** are plain names (`needed_items.name` plus an optional `description`); since `0068` they no longer point at a product.

**VPS B depends on these columns and privileges.** The least-privilege role `gt_moderation_cron` is created by `group-thing-ai/scripts/moderation_db_role.sql` (column-level grants only). The cron's startup self-check verifies the same list (`REQUIRED_PRIVILEGES` in `group-thing-ai/app/photo_store.py`) and exits non-zero if a column or grant is missing. A migration that renames, drops or retypes any of these columns needs a matching change in both files:
- `product_photos` SELECT: `id, storage_key, content_sha256, status, moderation_attempts, moderation_retry_at, created_at, updated_at`
- `product_photos` UPDATE: `status, moderation_attempts, moderation_retry_at, updated_at`
- `moderation_decisions` INSERT: `id, subject_type, subject_id, content_hash, source, automated, model_id, scores, thresholds, outcome, note, created_at, updated_at`

The cron connects over the VPC with `?ssl=require` (`pg_hba.conf`: `hostssl aj gt_moderation_cron <VPS_B_VPC_IP>/32 scram-sha-256`; the firewall allows 5432 only from VPS B). Its DB and Spaces credentials live only in `.env.cron` on VPS B, which the B `api` service does not load.

**Shared pieces.**
- `app/storage/` — `ObjectStorage` protocol + `SpacesStorage` (boto3); `get_storage()` returns `None` while the `SPACES_*` settings are unset (upload disabled). `storage.objects_delete` outbox events delete files after their rows are gone.
- `app/moderation/` — `ModerationStatus` (PENDING/APPROVED/NEEDS_REVIEW/REJECTED) per photo; append-only `moderation_decisions` audit log (automated rows are written by VPS B); ADMIN queue/decisions router (photos only), which sets the file ACLs on every decision.
- Non-owners see only APPROVED photos.

**Images and deployment.**
- The production API image is the default (last) Dockerfile stage `runtime`. It contains the `ml` uv group and Bielik-Guard, which is exported to ONNX at build time from the gated HF repo, so it needs the secret: `docker build --secret id=hf_token,env=HF_TOKEN src/backend`. Expect about +0.6–0.8 GB RSS per uvicorn process.
- `runtime-dev` (used by compose) has no model and needs no secret, so text moderation is off in dev.
- 0048 is not zero-downtime: any API or worker process from before it fails on every product query once the columns are dropped. Rolling back past 0048: first run `alembic downgrade 0046` **with the new image** (restores the columns; 0047's data changes are not reverted), then deploy the old image.

**Cutover to the VPS B cron.** The app ships as **one combined release**: migration 0049, the taken-list fallback and the UI flag, together with the removal of the old `moderation-worker`. The `group-thing-ai` README ("Cutover") lists the same steps with the full smoke check.
1. **Network and role prepared.** Add the `pg_hba` entry, the VPC listen address with TLS and the firewall rule, and have `moderation_db_role.sql` and a generated password ready. No SQL yet: the script grants columns that only exist after 0049.
2. **VPS B, cron off.** Check that Docker Compose is 2.24 or newer (`docker compose version`); the compose file needs it. Put `.env.cron` in place with `MODERATION_CRON_ENABLED=false` and deploy; a disabled cron exits 0. Check that the B `api` container has no `DATABASE_URL`/`SPACES_*`.
3. **VPS A, app release.** Keep `MODERATION_IMAGE_ENABLED=false` and deploy with `docker compose up -d --remove-orphans`. Migration 0049 runs and `--remove-orphans` removes the old `moderation-worker` container. `--remove-orphans` removes **every** running container that is not defined in the deployed compose file, so first make sure everything that must keep running on VPS A is in that file. **Then** run `moderation_db_role.sql` as the DB owner.
4. **Cleanup.** No longer needed: the cleanup script was removed together with the listing gate.
5. **Enable the cron.** Set `MODERATION_CRON_ENABLED=true` and recreate `moderation-cron`. Its self-check (config, TLS, columns, per-column privileges) must pass.
6. **Smoke test with real Spaces and ShieldGemma.** Re-queue a benign and a borderline test photo as PENDING. The benign one must end APPROVED with public files, the borderline one NEEDS_REVIEW/REJECTED with private files, and each must have one new `moderation_decisions` row.
7. **Only then** set `MODERATION_IMAGE_ENABLED=true` on VPS A and recreate the backend.

**Moderation gap.** From step 3 until step 7 nothing moderates photos: the worker is gone and the cron is either off or only being verified. This is deliberate and safe, because with `MODERATION_IMAGE_ENABLED=false` new uploads are auto-approved, the same as before the release. Keep the gap short.

Rollback: set `MODERATION_IMAGE_ENABLED=false` on VPS A (uploads are auto-approved again) and/or `MODERATION_CRON_ENABLED=false` on VPS B. Migration 0049 is additive, so there is no need to downgrade it. Nothing withdraws listings any more, so there is nothing to restore. If you redeploy an older app image that still contains the old `moderation-worker`, **first** disable the cron (`MODERATION_CRON_ENABLED=false` and recreate, or stop `moderation-cron`) so the two never moderate photos at the same time.

## Locations (`app/locations/`)

`app/locations/` is its own bounded context: a person's saved meeting places (`Location`), owned by their PERSON party (`profile.party_id`), reused across the groups (Circles) and Terms they lead. Routes: `GET /api/locations/mine`, `POST /api/locations` (idempotent: an existing active row with the same `google_place_id` returns 200 with that row), `PATCH`/`DELETE /api/locations/{id}` (owner only, soft delete). Migration `0057_locations`; `0058_group_term_location_capacity` adds `location_id`/`capacity` to groups and terms.

- **Boundary**: `app/groups/infrastructure/locations_acl.py` is the only `app.groups` module that imports `app.locations`. It validates newly assigned ids against the caller's own active places and batch-loads referenced rows (one `IN` query, soft-deleted rows included so old groups and terms still render). It must not import `app.groups.schemas` (import cycle). Groups and terms store only a plain `location_id` FK.
- **Read shape**: READ-level group/term embeds (`GroupResponse.default_location`, `TermResponse.location`) use the narrow `LocationRefResponse` (no `owner_party_id`, no coordinates). Unchanged ids are not re-validated on PATCH, and the group's own default is never ownership-checked (it may be soft-deleted).
- **CSP**: none is configured today; if a Content-Security-Policy is introduced, allow `script-src https://maps.googleapis.com` and `connect-src https://places.googleapis.com https://maps.googleapis.com` or the picker falls back to manual entry.
- **Inheritance**: `create_term` copies the group's default place and capacity **by value**; later changes to the group default never touch existing terms.
- **Google Places caching**: the backend never calls Google. The browser looks places up via Places API (New) (`importLibrary("places")`, session tokens, `src/frontend/src/lib/googleMaps.ts`) and posts the result. `google_place_id` may be stored indefinitely; `formatted_address`, `lat` and `lng` are cached Google data subject to Google's caching limits, and refreshing them is out of scope (`updated_at` is the cache timestamp). Without `VITE_GOOGLE_MAPS_API_KEY` (a frontend build arg, never committed) the picker falls back to MANUAL places typed by hand.

## Messaging (`app/messaging/`)

`app/messaging/` is its own bounded context: private text chats between logged-in users. Tables `conversations`, `messages` and `conversation_reads` (migration `0061_messaging`). Routes live under `/api/conversations`: the inbox (`GET ""`), `GET /unread-count`, get-or-create `POST /item`, `/group` and `/term`, `GET /{id}`, `GET`/`POST /{id}/messages` and `POST /{id}/read`. Authorization matrix rows 53-54 accept only the login `READ`/`EDIT` permissions, not the OAuth `mcp:read`/`mcp:edit` scopes.

- **Kinds**:
  - `ITEM` is a 1:1 chat between someone asking about an item and its current owner. Asking about your own item returns 409.
  - `GROUP` is for the organizer and the active members of a PRIVATE group. It is read-only while the group is PUBLIC.
  - `TERM` is for the organizer and the non-withdrawn attendees of a term.
  - GROUP and TERM chats are read-only once their group is soft-deleted.
- **Access computed per request**: no participant table is stored. Every call resolves the caller's right to read or write from current group, term and item state, in `application/access.py`. The inbox uses the same audience, and the `/{id}` routes return 404 before 403. Foreign contexts are reached only through `infrastructure/{groups,circulation,users}_acl.py`.
- **Read markers**: `conversation_reads` holds one `last_read_at` per party and conversation. `POST /{id}/read` takes a `message_id` and only moves the marker forward. Sending upserts the sender's own marker, and read-only chats can still be marked read. The unread badge counts messages, not conversations.
- **Send ordering**: moderation runs first, outside the lock. The send then takes `SELECT … FOR UPDATE` on the conversation row and stamps `created_at = max(utcnow, last_message_at + 1 µs)`, so commit order equals cursor order. An `after=` poll from the last server-fetched id never skips a row. Sending moves the sender's own marker to their message, so a message that crossed it is shown in the open thread but never counted as unread.
- **Keyset cursor**: `GET /{id}/messages` pages by message id on `(created_at, id)`, 50 per page with `has_more`. `before=` loads older history and `after=` polls for new messages. Both cursors at once, or a cursor from another conversation, return 400.
- **Polling, no push**: the frontend polls. The 💬 badge (`useUnreadMessages`) and the inbox (`useConversations`) poll every 20 s, and an open thread (`useThread`) polls `after=` every 5 s into one cached query. None of them polls in the background.
- **Moderation**: each body goes through `app/moderation/text_guard.check_text(TextField.MESSAGE_BODY, …)`. A rejection returns 400 and writes no row. If the guard is unavailable the send returns 503, and the composer keeps the text.
- **Rate limits**: `application/send_limiter.py` is an in-memory sliding window, like `join_code_limiter`. It allows 30 messages per minute and 20 new ITEM conversations per hour per party, and returns 429 with `Retry-After` when exceeded. Its state is **per uvicorn worker** and resets on restart, so the limits multiply if the app ever runs several workers.

## External Integrations
- **PostgreSQL 18**: Primary datastore, run via `docker-compose.yml`
- **Google Maps JavaScript API / Places API (New)**: browser-only, loaded on demand by the location picker when `VITE_GOOGLE_MAPS_API_KEY` is set at build time; see "Locations" above
- **DigitalOcean Spaces** (S3 API) + CDN: user-uploaded product photos
- **VPS B AI service** (`group-thing-ai`): its `moderation-cron` connects to this Postgres as `gt_moderation_cron` and to Spaces to moderate photos (see above). The app makes no calls to VPS B (its `POST /v1/moderate/image` endpoint stays there for dev/manual checks)
- No other external API integrations exist (the backend itself calls neither Google nor VPS B). The footprint domain's `app/footprint/ports.py`/`stubs.py` define ports for an emission-factor/product-attribute adapter that remains stubbed (out of scope for this migration)

## Database Schema
- **Migration tool**: Alembic
- **Location**: `alembic/versions/`
- **Status**: Schema defined and complete for all 8 tables (`categories`, `users`, `user_permissions`, `oauth2_registered_client`, `plugins`, `products`, `plugin_objects`, `footprint_audit_log`) via `0001_initial_schema.py`. Two entities deliberately do NOT use the shared `BaseEntity` sequence/`created_at`/`updated_at` pattern: `PluginDescriptor` (`plugins` table — string PK, plugin-supplied slug) and `RegisteredClient` (`oauth2_registered_client` table — UUID PK). `footprint_audit_log` has no `updated_at` (audit rows are append-only). `user_permissions` has no PK of its own (matches JPA `@ElementCollection` semantics — child rows have no independent identity).

## Configuration
- **Main config**: `app/config.py` (`Settings`, a `pydantic_settings.BaseSettings` subclass)
- **Pattern**: Environment-variable-based configuration, loaded from `.env` (see `.env.example`) with `extra="ignore"`
- **Profiles**: Not configured — a single settings object, no per-environment profile switching yet

## Package Structure

The real `app/` tree (from `find src/backend/app -type f -name '*.py'`, confirmed against Groups 1-13's actual output):

```
app/
├── main.py                      (FastAPI app instantiation, CORS, router + handler wiring)
├── config.py                    (Settings — env-var-backed configuration)
├── db.py                        (async engine/session factory, get_db dependency)
├── core/                        (cross-cutting infrastructure)
│   ├── base_model.py            (Base, BaseEntity mapped-superclass mixin)
│   ├── errors.py                (typed exceptions, legacy-envelope handlers)
│   ├── security.py              (JWT encode/decode, password hashing)
│   ├── auth_deps.py             (Principal, require_any())
│   ├── authorization_matrix.py  (AUTHORIZATION_MATRIX reference table, verified by tests)
│   └── filter_dsl.py            (shared regex/operator-allowlist constants only —
│                                  NOT a shared parser; see standards/backend/jooq.md)
├── auth/                        (login vertical: User model, POST /api/auth/login)
├── oauth2/                      (full hand-rolled OAuth2 authorization server:
│   │                             DCR, /oauth2/authorize, /oauth2/token [3 grants],
│   │                             /oauth2/introspect, well-known metadata, client-info)
│   ├── models.py, errors.py, stores.py, client_auth.py, router.py, metadata_router.py
├── category/                    (category vertical: models, schemas, service, router)
├── product/                     (product vertical, incl. its own 4-part filter-DSL
│                                  query_service.py)
├── plugin/                      (plugin descriptor/data/object vertical, incl. its own
│                                  3-part filter-DSL query_service.py)
├── locations/                   (saved meeting places BC: models, schemas, service, router;
│                                 reached from app.groups only via
│                                 groups/infrastructure/locations_acl.py)
├── footprint/                   (emissions-footprint domain — the largest vertical)
│   ├── archetype/                (calculator/component/validity/applicability model)
│   ├── domain/                   (breakdown, enums, exceptions — discriminated unions)
│   ├── engine/                   (breakdown_scaler, tree_builder, rounding_policy)
│   ├── audit/                    (audit-log persistence task, retry/backoff via tenacity)
│   ├── export/                   (CSV flattener)
│   ├── ports.py, stubs.py, facade.py, router.py, schemas.py, errors.py
└── system/                      (health check, SPA-fallback catch-all — registered LAST)

alembic/
├── env.py
└── versions/0001_initial_schema.py
```

Five spot-checked directories, confirmed 1:1 against the real tree above: `app/core/`, `app/oauth2/`, `app/footprint/domain/`, `app/footprint/audit/`, `alembic/versions/`.

## Deployment Architecture
- `docker-compose.yml` (repo root) brings up three services via `docker-compose up`: Postgres 18, the FastAPI backend (port 8080, build context `src/backend/`), and the frontend app shell (port 5173, build context repo root) — the full plugin-architecture stack (host app + backend + DB) in one command. `.env.example` lives at the repo root alongside it (moved from `src/backend/.env.example`) since that's where docker-compose looks for a `.env` file by default
- **Frontend service**: `src/frontend/Dockerfile` is a two-stage build (Node builds the Vite SPA to `dist/`, then an nginx:alpine image serves it) driven from the **repo root** as build context — not `src/frontend/` — because `src/frontend`'s test suite imports the sibling `plugins/server-sdk.ts` by relative path, so that file must be present in the build context too (see `.dockerignore` at the repo root, which scopes that context down to just `src/frontend/` + `plugins/server-sdk.ts`). nginx reverse-proxies `/api/*` and `/oauth2/*` to the `backend` service and falls back to `index.html` for all other paths (client-side routing)
- `src/frontend/vite.config.ts`'s dev-proxy (`npm run dev`, port 5173) now proxies both `/api` and `/oauth2` to `localhost:8080` — the OAuth2 authorize page does a real browser form-POST to `/oauth2/authorize`, not just `fetch()` calls under `/api`
- Individual plugin apps (`plugins/warehouse`, `plugins/box-size`, `plugins/ai-description`) are **not** part of `docker-compose.yml` — they remain standalone dev-server processes per `plugins/CLAUDE.md`'s documented workflow, registered with the host via `PUT /api/plugins/{pluginId}/manifest`
- `backend` builds the model-free `runtime-dev` target with `MODERATION_TEXT_ENABLED` fixed to `"false"`. There is no photo worker service: photo moderation runs only in VPS B's `moderation-cron`, so a local stack with `MODERATION_IMAGE_ENABLED=true` keeps photos PENDING unless that cron is running
- nginx allows request bodies up to 16 MB on `/api/` (photo uploads; the backend caps a photo at 15 MB)
- No CI/CD yet

### Cutover / rollback for the category-tree release (migrations 0064–0069)
The backend runs `alembic upgrade head` on every start (`docker-compose.yml` `backend` command), so deploying the image applies 0064–0069 at once. 0067 and 0069 delete data irreversibly: every needed item and pledge (0067), and every legacy product, inventory item, reservation, swap proposal, item conversation and ledger row (0069). 0068 drops `needed_items.product_id`, so the old and new backend cannot run side by side.

1. Take a `pg_dump -Fc` of the database and verify it (`pg_restore --list` succeeds, dump is non-empty). Keep it off the database host.
2. Confirm the target environment's Spaces bucket and prefix belong to that environment (check that the variables are set and compare the bucket/prefix names only; never print the keys). 0069 queues deletes of every wiped product photo, so a wrong bucket deletes another environment's files.
3. If product photos must survive a rollback, copy the bucket's product photo prefix now (see **Rollback**).
4. Stop the VPS B moderation cron (`MODERATION_CRON_ENABLED=false` or stop the `moderation-cron` service).
5. Deploy frontend and backend together; expect a short downtime while the backend migrates.
6. Verify: 9 root categories and 2286 categories in total (`SELECT count(*) FROM categories [WHERE parent_id IS NULL]`), `alembic_version` = `0069`, and `GET /api/categories` returns the tree.
7. Verify the photo deletes: `SELECT status, count(*) FROM outbox_entries WHERE event_type = 'storage.objects_delete' GROUP BY status` reaches only `PROCESSED`. `FAILED` entries are expected only where Spaces is not configured (e.g. a local stack); anywhere else, find the cause in the backend log.
8. Start the moderation cron again.
9. Smoke test: register an item with a mode; an 11th GIFT listing → 409; registering on a non-leaf category → 409; add a needed item by name.

**If 0069 fails**: each migration commits on its own, so 0064–0068 stay applied, `alembic_version` stays at `0068` and the backend crash-loops on start. Check `SELECT version_num FROM alembic_version`, read the error in the backend log, fix the cause (e.g. a missing category fixture in the image) and restart the backend, which re-runs 0069. If the cause cannot be fixed quickly, restore the dump as below.

**Rollback**: `pg_restore` the dump into an empty database, then deploy the previous image. The previous image cannot start on a database at 0069, and the downgrades of 0067–0069 do not bring data back (0069's refuses while any product exists), so restoring the dump is the only rollback. After 0069 the outbox deletes the wiped photos' files from Spaces (`storage.objects_delete`), so the restored photo rows point at files that are gone unless the product photo prefix was copied before the deploy (step 3); copy it back before starting the previous image.

---
*Based on the completed Java-to-Python migration (`.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`), 2026-09-01*
