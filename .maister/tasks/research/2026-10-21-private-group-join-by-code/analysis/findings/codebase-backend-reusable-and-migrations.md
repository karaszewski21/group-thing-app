# Backend findings 3/3 — Reusable precedents, data-model constraints, migration notes (SQ5-technical, SQ6)

**Category**: `codebase-backend` | **Root**: `src/backend/` | **Date**: 2026-10-21 | Confidence: High unless marked.

## 1. Existing precedents a join-code design can reuse

| Need | Precedent | Evidence |
|------|-----------|----------|
| Cryptographic random token | `secrets.token_urlsafe(32)` — "256-bit URL-safe base64 code, no padding" | `app/oauth2/stores.py:58-61` (`AuthorizationCodeStore.generate_code`), `:131-132` (`RefreshTokenStore._generate_token`). Only `secrets` usage in `app/`. For a short human-typed code the same module's `secrets.choice` over a custom alphabet is the natural sibling (not used anywhere yet). |
| Non-secret deterministic slug | `hashlib.blake2s(seed, digest_size=6).hexdigest()` prefixed `k-` | `app/groups/domain/organizer_slug.py:11-21`; docstring l.17-19 explicitly says "Not a secret ... a plain digest, no pepper, is enough" — i.e. the opposite requirement from a join code; do not derive the code from ids. |
| Unique-value retry loop | `_generate_unique_slug`: loop `while candidate in RESERVED_SLUGS or await _slug_taken(db, candidate)` | `app/organizations/service.py:36-48`. Same loop shape works for "generate code, retry on collision" if the code column is unique. |
| Unique string column | `Organization.slug = mapped_column(String(255), nullable=False, unique=True)`; `User.username` unique | `app/organizations/models.py:93`, `app/auth/models.py:49` |
| Partial unique index (soft-delete aware) | `uq_locations_owner_party_id_google_place_id ... postgresql_where="google_place_id IS NOT NULL AND deleted_at IS NULL"` | `alembic/versions/0057_locations.py:63`; also `0023:56` (`status <> 'WITHDRAWN'`), `0049:44`/`0051:64`/`0054:86` (`status = 'PENDING'`), `0037:81-87` (the index being removed). Pattern for `uq_groups_join_code WHERE join_code IS NOT NULL` (and optionally `AND deleted_at IS NULL`). |
| Race-safe insert under a unique index | `async with db.begin_nested(): db.add(...); await db.flush()` + `except IntegrityError` → re-read winner | `app/groups/application/join_requests.py:118-126` (cites `circulation.application.inventory._get_or_create_inventory`). Needed if a regenerate loop could collide. |
| Hashing secrets at rest | bcrypt `hash_password`/`verify_password`; HMAC key decode | `app/core/security.py:20-25,28`; PKCE `hashlib.sha256(code_verifier)` `app/oauth2/router.py:477`. If the code is stored hashed, sha256 (fast, code has enough entropy) rather than bcrypt is the precedent-consistent choice; note that a hashed code cannot be shown back to the organizer, which conflicts with "podgląd/kopiowanie" UX unless shown once. |
| Domain clock for expiry | `clock.local_now()` (naive Warsaw) and `clock.utc_to_local`; audit columns use `datetime.utcnow()` | `app/core/clock.py:37-43`; `app/core/base_model.py:25-38`; `join_requests.py:134` compares `datetime.utcnow() - timedelta(hours=24)` against `updated_at` (naive UTC audit column) — the precedent for comparing against audit timestamps. A `join_code_expires_at` column must pick one convention and the standard (`time.md`) says business "now" is `clock.local_now()`, audit timestamps are naive UTC. `tests/conftest.py:117-127` `freeze_local_now` only patches `clock.local_now`, so an expiry compared with `clock.local_now()` is testable; one compared with `datetime.utcnow()` is not (the router test l.226 instead rewrites rows with raw SQL `interval '25 hours'`). |
| Organizer-only guard | `_require_active_organizer(db, group_id, party_id)` → 403 | `app/groups/application/circles.py:364-366`; used by `update_group` l.246 |
| Authenticated-only dependency | `require_any()` with no args ("any authenticated principal") | `app/core/auth_deps.py:10-13`; alias `AuthenticatedPrincipal` `router/join_requests.py:24` |
| Optional principal (anonymous-friendly) | `OptionalPrincipal` | `router/circles.py:161,179`; `auth_deps.py:26` |
| Query-count budget test | `count_queries(engine)` | `tests/conftest.py:81` |
| Scheduled jobs (for expiry cleanup, if any) | `apscheduler` dependency; `term_end_scan` job | `pyproject.toml:17`; `app/groups/application/term_end_scan.py` |

## 2. Data-model constraints for a `join_code`

### `BaseEntity` rules (`app/core/base_model.py:41-68`)
- `id`: UUID PK, Python default `uuid.uuid4`, `server_default=gen_random_uuid()` (l.49-56). No sequences (0041 removed them).
- `created_at`: naive UTC via `_initial_timestamp` (`datetime.utcnow()`, l.25-28).
- `updated_at`: naive UTC, **also the optimistic-lock `version_id_col`** (`__mapper_args__` l.63-68, `_version_timestamp` l.31-38). Consequences: (a) every UPDATE to `Group` bumps `updated_at` and a concurrent stale write raises `StaleDataError` → 409 (`errors.py:101-108`); (b) `updated_at` cannot be used as "code issued at" because any other group edit (rename, layout) also changes it — a separate `join_code_rotated_at`/`expires_at` column is required if rotation time matters.
- `DateTime()` columns are timezone-naive everywhere (`models.py:117` `deleted_at`, `Term.occurs_on` l.244 comment).

### Option A — column(s) on `groups` (`app/groups/models.py:96-129`)
- Existing columns: `party_id`, `name`, `layout_mode` (String(10) enum, server_default `CIRCLE`), `visibility` (String(10), server_default `PUBLIC`, l.112-116), `deleted_at`, `deleted_by_party_id`, `default_location_id`, `default_capacity`.
- Adding `join_code: Mapped[str | None] = mapped_column(String(N), nullable=True)` follows `migrations.md`'s "additive nullable column, no backfill" rule (same as `0056:30-33` and `0058:31-40`). Uniqueness via a partial unique index `uq_groups_join_code` declared in the migration (precedent `0057:63`), since PUBLIC groups would hold NULL.
- Lookup: `repository.get_group_by_join_code(code)` must also filter `Group.deleted_at.is_(None)` (every live-group query does — e.g. `repository.py:273-279`, `:785`).
- Read path: `GroupResponse` (`schemas.py:36-45`) is the organizer-facing shape (`party_id, name, organizer_slug, layout_mode, visibility, default_location, default_capacity, created_at, updated_at`) and is returned by `GET /api/groups/{id}` (`router/circles.py:303-307`, READ row). Exposing the code there would leak it to any READ principal that knows the id — `get_group` route has no organizer check (`circles.py:303-307`); a dedicated organizer-only endpoint is safer. `PublicCircleResponse` (`schemas.py:337-352`) must never carry the code.

### Option B — separate table (e.g. `group_join_codes(BaseEntity)`)
- Shape would mirror `GroupJoinRequest` (`models.py:195-223`): `group_id` FK `fk_group_join_codes_group_id_groups`, code column, optional `expires_at`, `revoked_at`. Enables history/rotation and per-code attempt counters without touching `groups.updated_at` (so an attempt counter write would not trigger a `StaleDataError` on concurrent organizer edits — relevant because `Group` is version-locked).
- Groups BC declares no `relationship()` (`models.py:11-13`): load via FK-id queries only.

### Enum columns
`_enum_column(enum_cls, length)` helper (`models.py:28-35`) — string-backed, `native_enum=False`. Any new status enum must fit its declared length.

## 3. Migration notes for the removal revision (0059)

Chain today: `0055 → 0056 (group soft delete) → 0057 (locations) → 0058 (group/term location+capacity, head)` (`0056:23-24`, `0057:24-25`, `0058:24-25`). New file `alembic/versions/0059_<name>.py` with `down_revision = "0058"`.

### Dependency / order facts
1. `0038` depends on `0037` (`0038:23-24`), and `notifications.join_request_id` is a **loose pointer with no FK constraint** (`0038:29-33`; `notifications/models.py:84-96` "no FK"). So there is no DB-level FK from `notifications` to `group_join_requests`; the drop order is a convention (column before table) rather than a constraint requirement — but the row delete `DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'` (`0038:39`) **is required** before deploying code without those enum members (`notifications/models.py:76-78` string enum would fail to coerce unknown kinds).
2. `group_join_requests` has three real FKs (`groups`, `parties`, `terms`; `0037:58-72`, re-created as UUID in `0041:163-170`) and two indexes (`0037:75-87`). `op.drop_table` drops its own FKs/indexes; nothing else references the table (grep over `alembic/` shows only 0037/0038/0041).
3. `0041` is irreversible (`0041:416-421` raises `NotImplementedError`) and its `PK_TABLES`/`FK_COLUMNS`/`FK_CONSTRAINTS`/`DELETE_ORDER` lists still name `group_join_requests` and `notifications.join_request_id` (`0041:56,107-109,127,163-170,275,305`). Leave 0041 untouched: it only runs on upgrade from <0041, where the table still exists.
4. Suggested `upgrade()` order for 0059: (a) `DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'`; (b) `op.drop_column("notifications", "join_request_id")`; (c) `op.drop_index("uq_group_join_requests_pending_requester_group")`, `op.drop_index("ix_group_join_requests_group_id")` (optional, drop_table handles them) then `op.drop_table("group_join_requests")`; (d) additive `groups.join_code` (+ partial unique index) **or** per `migrations.md` put the new column in a separate revision (0060) from the drop — the standard says additive nullable columns go "in a separate revision from new tables"; a drop+add in one revision is a judgment call for the synthesizer.
5. `downgrade()` must recreate in reverse: `group_join_requests` with the **post-0041 UUID shape** (`id UUID PK default gen_random_uuid()`, `group_id/requester_party_id UUID NOT NULL`, `term_id UUID NULL`, `status String(20)`, `created_at/updated_at TIMESTAMP NOT NULL`, `pk_group_join_requests`, the three `fk_group_join_requests_*` names, `ix_group_join_requests_group_id`, partial `uq_group_join_requests_pending_requester_group WHERE status = 'PENDING'`), then `notifications.join_request_id UUID NULL`. Data is not restorable (acceptable — same stance as 0041's docstring, pre-production).
6. Existing PENDING rows: the drop discards them. If product wants to honour them, a data step before the drop could `INSERT` memberships for PENDING requesters — but `add_active_membership` needs a MEMBER `GroupRole` (`memberships.py:31`), which is non-trivial in raw SQL; the realistic options are "drop silently" or "notify organizers before deploy" (decision for the report).

### Migration test pattern to copy
- `tests/test_group_soft_delete_migration.py:1-75`: subprocess `alembic downgrade <prev>` / `upgrade head` with `DATABASE_URL` from the testcontainer (`_alembic` l.22-31), `inspect` for columns/FKs (l.34-44), two tests: upgrade asserts (l.46) and `downgrade0056_dropsFkAndColumns` (l.64) that always upgrades back to head.
- `tests/test_locations_migration.py:1-4,57`: when two revisions interact, downgrade to the revision *before both* (`0056`) so "0058's downgrade must run before 0057 drops the table" — the same consideration applies if 0059 (drop) and 0060 (join_code) are separate: test downgrades to 0058.
- `standards/backend/migrations.md` names these two files as the per-migration pytest precedent.

## 4. Where the organizer-side endpoints would live
- Application: a new `app/groups/application/join_code.py` (sibling of `circles.py`/`memberships.py`), re-exported through `app/groups/service.py` `__all__` (the routers only import `from app.groups import service`, `router/join_requests.py:14`).
- Router: `app/groups/router/<new>.py` registered in `router/__init__.py:30-40` after `circles.router` (so `GET /api/groups/{group_id}` at `circles.py:303` does not swallow `/api/groups/{id}/join-code`; FastAPI matches in registration order, and `circles.router` registers before the per-resource routers — a literal sub-path under `/api/groups/{group_id}/...` is fine because `{group_id}$` does not match extra segments, same as today's `/api/groups/{group_id}/join-requests`).
- Repository: `app/groups/infrastructure/repository.py` (section headers per entity, e.g. l.686).
- Tests: flat `tests/test_group_join_code*.py` (naming `test_<operation>_<scenario>_<expected>` as in `tests/test_group_join_requests_router.py:69-366`).

## 5. Open technical questions surfaced by the code
1. Where to generate the first code: in `create_additional_circle` (`circles.py:93-117`) / `update_group` (l.257-258) when visibility becomes PRIVATE, or lazily on first organizer read. Today visibility flips carry no side effects (`test_group_privacy.py:139-162` asserts no memberships are minted; a code would be a new side effect to test).
2. Whether a PUBLIC→PRIVATE→PUBLIC flip clears the code (nullable column semantics).
3. Attempt counting without Redis: a column on `groups` would bump `updated_at` (version col, `base_model.py:66`) on every failed attempt and could 409 an organizer's concurrent save — favours a separate table or a session-scoped `UPDATE ... WHERE` via Core that bypasses the ORM version check.
4. `GroupAccessDetails` (`schemas.py:365-370`) is asserted with exact key sets in `test_group_access.py:62-69,80-87,101-108`; any new field changes four tests plus the frontend type.
