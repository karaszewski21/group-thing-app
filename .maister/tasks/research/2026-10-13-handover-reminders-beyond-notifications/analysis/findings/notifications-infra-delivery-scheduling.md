# Notifications infra — delivery channels, scheduling, contact data, PWA readiness

Paths: backend `src/backend/`, frontend `src/frontend/`. Config checked by key NAMES only (values never read). Verified 2026-10-13.

## 1. Delivery channels inventory

| Channel | Present? | Evidence |
|---|---|---|
| In-app inbox (DB + bell) | **Yes, only channel** | `app/notifications/*`, `NotificationBell.tsx` |
| Email (SMTP/provider) | **No** | `pyproject.toml:6-22` deps: fastapi, uvicorn, sqlalchemy, asyncpg, alembic, pyjwt, bcrypt, pydantic(-settings), tenacity, python-multipart, apscheduler, boto3, pillow, httpx — no mail lib. grep `smtp|sendgrid|mailgun|postmark|resend|aiosmtplib|fastapi_mail` over `app/`, `pyproject.toml`, `.env.example`, `docker-compose.yml` → 0 hits. No email-verification flow either (grep `verify_email|email_verified` → 0). |
| Web Push (VAPID) | **No** | grep `vapid|pywebpush|webpush|push_subscription` → 0 hits; no subscription table. |
| SMS | **No** | grep `twilio|sms` → 0 hits. |
| Service worker / web manifest / PWA | **No** | `frontend/index.html` has only favicon + fonts, no `<link rel="manifest">`, no SW registration; `frontend/public/` = `assets/plugin-ui.css`, `favicon.svg`, `icons.svg` (no manifest, no PNG icons); `vite.config.ts` plugins = `react()`, `tailwindcss()` only; `package.json` has no `vite-plugin-pwa`/workbox. |
| Calendar export (.ics / Google link) | **No** | grep `.ics|text/calendar|VCALENDAR|calendar.google` in frontend `src/` → 0; no backend route. |
| Outbound HTTP client | available | `httpx>=0.27` in deps (could call an email API such as an HTTP transactional-mail provider without a new SDK). |

`.env.example` key names (values redacted): `JWT_SECRET, JWT_EXPIRATION_MS, CORS_ALLOWED_ORIGINS, FOOTPRINT_PROBLEM_BASE_URI, DATABASE_URL, FOOTPRINT_AUDIT_RETRY_*, SPACES_ENDPOINT_URL, SPACES_REGION, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET, SPACES_PUBLIC_BASE_URL, MODERATION_TEXT_ENABLED, MODERATION_TEXT_REJECT_THRESHOLD, MODERATION_MODELS_DIR, MODERATION_IMAGE_ENABLED`. **No SMTP/MAIL/VAPID/PUSH keys.** `app/config.py:23-51` settings fields match (no mail/push settings).

**Confidence**: High (95%).

## 2. Background processing available

### 2a. Outbox poller (`app/outbox/`)
- Table `outbox_entries` (`outbox/models.py:40-50`): `event_type`, `payload JSONB`, `status PENDING|PROCESSED|FAILED`, `attempts`, `last_error`, `processed_at`. **No `available_at`/`deliver_after` column** → the outbox cannot express "deliver at T-24h"; it dispatches as soon as polled. Migration `alembic/versions/0024_outbox_schema.py`.
- Producer: `outbox/service.py:22-38` `append()` stages row in caller's transaction (UUIDs → strings).
- Dispatcher `outbox/dispatcher.py:41-77`: claims up to 50 PENDING rows `ORDER BY created_at, id ... FOR UPDATE SKIP LOCKED` (`:22-38`), runs every registered handler, commits per entry; handler exception → `attempts += 1`, FAILED at `MAX_ATTEMPTS = 5` (`:17`, `:68-72`). Event types with no handler are marked PROCESSED (`:53-54`). Optional `event_types`/`exclude_event_types` filters to split pollers across processes (`:59-62`).
- Delivery semantics: at-least-once per handler set (a handler that succeeded before a later handler raised in the same entry will run again on retry) — a future email/push handler must be idempotent or own its own dedupe.
- Loop: `outbox/scheduler.py:21-36` `run_forever`, `DEFAULT_INTERVAL_SECONDS = 60` (`:16`) — note `main.py:80` docstring says "30s" (stale); actual latency up to ~60 s.

### 2b. APScheduler (`app/main.py`)
- `AsyncIOScheduler(job_defaults={"misfire_grace_time": None, "coalesce": True})` (`main.py:112-114`), interval jobs: term-end scan every **1 min** (`:64`, `:115-117`), media sweep every 15 min (`:65`, `:118`). Started in FastAPI lifespan alongside the outbox task (`:105-119`), shut down `wait=False` (`:123-126`).
- **In-memory job store** (no jobstore configured) → jobs are re-created each start; fine because jobs are stateless scans, state lives in DB markers.
- Only interval triggers are used; no per-entity `date` jobs (which would be lost on restart without a persistent jobstore).

### 2c. Process model
- `docker-compose.yml` backend: `alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8080` — **single uvicorn process, no `--workers`**, so exactly one scheduler + one outbox poller. Scaling to N workers/replicas would run N schedulers; correctness then relies on DB idempotency markers (term-end scan has them; see §3) and `SKIP LOCKED` (outbox has it).
- A separate moderation worker (VPS B / `../group-thing-ai`, per project memory) also runs an outbox poller — the reason for `exclude_event_types` (`dispatcher.py:59-62`).

**Confidence**: High (95%) for code; Medium (70%) for production topology (only local compose inspected).

## 3. Template for T-24h / T-2h reminders: the term-end scan

`app/groups/application/term_end_scan.py` is a working, tested blueprint for time-relative, idempotent emission:
- Bounded window query over `Term.occurs_on` (`:60-71`): `occurs_on BETWEEN now - 24h AND now` (`DEFAULT_WINDOW = timedelta(hours=24)` `:53`). Index `ix_terms_circle_group_id_occurs_on` exists (`groups/models.py:219-221`) — leading column is `circle_group_id`, so a pure `occurs_on` range scan isn't index-optimal (minor at current scale).
- Candidate reservations via ACL `circulation_bridge.list_active_hand_over_reservations_for_terms` — GIFT/LEND in PENDING/CONFIRMED with `term_id` (`:74-83`, module docstring `:7-14`); SWAPs from `ACCEPTED` proposals (`:132-172`).
- **Idempotency**: per-reservation marker row `GiveawayTermEndMarker(reservation_id UNIQUE, notified_at)` (`groups/models.py:396-409`), checked in bulk (`term_end_scan.py:86-102`) and staged with the outbox append in the **same transaction**, single commit at end (`:117-128`, `:175-198`); for swaps the marker is a column `SwapProposal.term_ended_notified_at` (`groups/models.py:393`, set `term_end_scan.py:170`). The UNIQUE constraint also protects against concurrent schedulers (second insert fails → whole scan txn rolls back, retried next minute).
- Robustness: missing profile → skip, not raise (`:104-116`).
- Emits outbox events → `notifications/outbox_listener.py` turns them into notifications for **both parties** (`:75-104`).

Implication for reminders: a `scan_for_upcoming_handovers` job could reuse this shape with window `occurs_on BETWEEN now+X-δ AND now+X` (or simply `now < occurs_on <= now + 24h` with a "reminded_24h" marker), a marker keyed by `(reservation_id, reminder_kind)` with a UNIQUE constraint, and new event types consumed by notification (and later email/push) handlers. Running every minute gives ≤1-2 min precision for T-2h.

**Timezone caveat (important for T-2h)**: `Term.occurs_on` is a naive LOCAL wall-clock datetime (`groups/models.py:228-231`) compared with server `datetime.now()` (`term_end_scan.py:63-67`; same in `term_item_listings.py:913`, `:944`). The backend image `python:3.12-slim` (`src/backend/Dockerfile:53`) sets no `TZ`, and compose sets none → container local time is UTC, while organizers presumably enter Polish time. That would shift every "now vs occurs_on" comparison by 1-2 h (CET/CEST). For term-end that's tolerable; for a T-2h reminder it could arrive at T-0/T-1h. **Confidence: Medium (65%)** — inferred from absence of TZ config; production host config not inspected. Worth verifying before building reminders.

## 4. Contact data — is email available?

- `UserProfile.email: String(255) | None` (`app/users/models.py:64`); `account_user_id` nullable (`:55-62`).
- **Every login-capable account has an email**: login looks up `UserProfile` by email (`app/auth/router.py:33-43`, `:59-70`); self-registration requires a valid email (`app/users/schemas.py:79-96`); merging an anonymous RSVP into an account sets `profile.email` (`app/groups/application/account_merge.py:50-55`).
- Profiles **without** email: anonymous RSVP guests (`groups/application/public_view.py:477-483`, `account_user_id=None, email=None`) and lightweight family members/children (`app/families/members.py:36-43`). Family/guardian creation accepts optional email (`app/families/schemas.py:62,69`; `families/guardians.py:33`).
- Handover parties (take/swap/lend) must be authenticated (`take`/`propose` resolve the caller via principal → `account_user_id`, e.g. `term_item_listings.py:514`, term-end scan resolves both sides by `giver_user_id`/`reserved_by_user_id` `:107-110`) → **in practice both handover parties always have an email**.
- **Email is unverified** (no verification flow) and there is **no notification-preference / opt-out / unsubscribe** field anywhere (no columns on `UserProfile`, `users/models.py:47-68`). Email delivery would need at minimum an opt-out (and EU/RODO consent consideration).

**Confidence**: High (90%).

## 5. Frontend build PWA readiness

- Vite 8 + React 19 + Tailwind 4 SPA (`frontend/package.json`); build `tsc -b && vite build && vite build -c vite.sdk.config.ts`.
- `index.html` is the built Vite entry; in docker the backend serves it via the SPA fallback (`docker-compose.yml` `frontend-build` copies `dist/index.html` into backend `/app/static`; `frontend/nginx.conf:29-38` `try_files $uri $uri/ @backend_fallback`). Static files placed in `public/` (e.g. `manifest.webmanifest`, `sw.js`, icons) would be served by nginx as real files at root scope → a root-scoped service worker is feasible without nginx changes; `index.html` needs a `<link rel="manifest">` (backend copy is the same file, so one edit suffices).
- Missing for installable PWA / iOS web push (iOS 16.4+ requires Home-Screen install): web manifest, PNG icons (192/512), service worker, `apple-touch-icon`. Adding `vite-plugin-pwa` (or a hand-written SW) is low effort; web push additionally needs VAPID keys, a `push_subscriptions` table, a backend sender (e.g. `pywebpush`, or hand-rolled over `httpx`), and a permission-prompt UX.
- HTTPS is required for SW/push in production (not verified here; local compose exposes plain HTTP on 5174/8080).

**Confidence**: High (90%) on what's missing; Medium on effort estimates.

## 6. Tests covering this infra
`src/backend/tests/test_notifications.py`, `test_outbox.py` (12 tests combined by `def test_` count), `test_term_end_scan.py` — the term-end scan test is the obvious template for a reminder-scan test.
