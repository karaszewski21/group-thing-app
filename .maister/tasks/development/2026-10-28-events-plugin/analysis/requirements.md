# Requirements — Events plugin (wydarzenia)

## TL;DR
Logged-in users create a one-off event (optional banner ≤5 MB, name 3–120, start date+time, optional same-day end time, optional location from Locations, optional description ≤2000) in the `plugins/events` iframe on `/add/event`. Data goes to a new host-native `app/events` module (`events` + `event_banners`), with text moderation of the name/description. Create-only; after saving: confirmation → `done` → `/add` + toast.

## Key Decisions
- Backend: `app/events` (models/schemas/service/router), migration 0070 (`events`, `event_banners` 1:1), `POST /api/events`, `POST /api/events/{id}/banner` (multipart, ≤5 MB, owner-only), AUTHORIZATION_MATRIX rows, `include_router` in main.py.
- `events`: id, author_party_id (the logged-in user), name, description, starts_at, ends_at (nullable), location_id (nullable, via `infrastructure/locations_acl.py`), created_at/updated_at. Naive Warsaw datetimes; start ≥ `clock.local_now()`; ends_at > starts_at and the same day as starts_at.
- `event_banners`: event_id unique FK, storage_key, status column (for future moderation; now APPROVED/public), sha; pattern: ProfileAvatar (`users/service.py:152-195`); replacing deletes the old files via the outbox.
- `event_attendances` (user decision, added after Phase 5): created in migration 0070 as a schema only, with no endpoints and no UI. Modelled on TermAttendance: event_id FK, party_id FK → parties.id, withdrawn_at (naive UTC, NULL = active), partial unique index (event_id, party_id) WHERE withdrawn_at IS NULL, no child_count/capacity. Sign-ups (join/leave, UI, capacity) are a follow-up.
- Text moderation: new `TextField.EVENT_NAME`, `TextField.EVENT_DESCRIPTION` + `check_text` (400/503).
- Events are public; author = the logged-in user. Any logged-in user (EDIT) can create.
- Frontend host: new extension point `add.event` (ExtensionPointType, CONTEXT_TYPE_PREFIX, PluginContext resolver, api/plugins.ts); plugin provider/message handler available for the panel; `EventCreateView` renders the host `SubPageHeader` + `PluginFrame` (fixed min-height) or the Polish fallback "Plugin wydarzeń jest niedostępny".
- New SDK messages: `uploadImage` (File/Blob via postMessage, host builds FormData; path allowlist `/api/events/{uuid}/banner`; 10 s timeout unchanged) and `done` (fire-and-forget → host `navigate(viewPath('add'))` + toast). Changes in `plugin-sdk/*`, `plugins/sdk.ts`, `PluginMessageHandler.ts`.
- Plugin `plugins/events` (Vite + React 19, port 3004, copy of warehouse): one route for `add.event`, form per mockups, own CSS mirroring host tokens, location sheet (GET/POST `/api/locations` via `hostApp.fetch`, simplified "add place" form), flow POST event → uploadImage → confirmation; retry/skip on banner failure.
- Registration: manual curl PUT manifest (plugins/CLAUDE.md updated).
- Tests: backend `tests/test_events.py` (+ migration test, authorization matrix), frontend host tests (iframe/fallback/done/uploadImage), replace the mock tests in `AppPage.test.tsx`.

## Q&A
### Phase 1
- Storage → app/events module. Banner → SDK uploadImage. Scope → create only. Banner moderation → none for now.
### Phase 2
- After save: confirmation + follow-up. Order: event then banner. Registration: manual + fallback. Banner optional.
- Plugin lookup: extension point add.event. Height: fixed min-height. Navigation: `done` message.
- Dates: starts_at + optional ends_at. Permissions: any logged-in user. Styling: own CSS with host tokens.
- Location: from the Locations module. Banner storage: event_banners 1:1. Limit 5 MB, timeout stays 10 s.
- EntityId bug: follow-up. Text moderation: name + description.
### Phase 5
- Journey: "+" → /add → "Wydarzenie" tile → /add/event; AuthGuard as today. ✔
- Visibility: public, author = user. ✔
- New location in the plugin: simplified form (name + address as text) via POST /api/locations, without Places. ✔
- Limits: name 3–120, description ≤2000; mock tests replaced with host + backend tests. ✔

## Similar features / reuse
- `plugins/warehouse` (structure, manifest, index.html with SDK), `plugins/box-size` (form with save/error).
- `pages/admin/PluginPageRoute.tsx`, `plugins/PluginFrame.tsx`, `PluginContext.tsx`, `PluginMessageHandler.ts`, `iframeRegistry.ts`.
- `users/router.py:84-96` + `users/service.py:152-195` (avatar upload), `organizations/media.py` (COVER), `storage/images.py::process_upload`, `storage/outbox_listener.py`.
- `app/groups` Term — only the date convention (`clock.local_now()`, naive Warsaw); `infrastructure/*_acl.py` pattern for Locations.
- Copy from `pages/add/EventCreateView.tsx`; `SubPageHeader`.

## Visual assets
- `analysis/design-context/INDEX.md` — 9 screens (binding).

## Scope boundaries
- IN: create event + banner, plugin, host plumbing (add.event, uploadImage, done), fallback, tests.
- OUT: list/detail of events, editing/deleting, banner moderation, prod plugin hosting, EntityId bug fix, iframe resize.

## Technical considerations
- `get_storage()` None → banner upload returns a Polish 503/400 "Wysyłanie zdjęć jest wyłączone"; the event stays saved.
- 10 s SDK timeout at 5 MB — risk of a false error; the plugin shows retry.
- CORS not needed (everything goes through the host proxy).
- Plugin SDK URL hardcoded to localhost:5173 — same as the other plugins.
