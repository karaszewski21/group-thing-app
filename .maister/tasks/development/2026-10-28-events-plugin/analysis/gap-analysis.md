# Gap Analysis: Events (wydarzenia) plugin at /add/event

## TL;DR
Nothing about events exists today. There is no backend, no table, no plugin, and no host-side plugin support outside `/admin`. `/add/event` is a mock that saves nothing. The work needs three new pieces:
1. A host-native `app/events` module (table, `POST /api/events`, banner upload).
2. A new `plugins/events` iframe app.
3. Host plumbing so the panel can embed a plugin: lookup by id, the message handler outside admin, and new `uploadImage` + `navigate` messages (plus a resize or fixed-height decision).

Risk is medium-high: shared plugin infrastructure changes, a first unmoderated user image, and no deployment story for plugin URLs. Data is CREATE-only (an orphan operation, which the user accepted).

## Key Decisions
- **Characteristics: creates_new_entities + modifies_existing_code + involves_data_operations + ui_heavy; no defect.** The EntityId bug is on a path this task does not use.
- **Change type: additive for the backend, modificative for the host.** `EventCreateView`, `PluginMessageHandler` and the SDK change. Admin plugin behaviour must stay byte-compatible (moderate compatibility).
- **Binding clarifications are taken as fixed:** `app/events` storage, an `uploadImage` SDK message, create-only scope, no banner moderation.

## Open Questions / Risks
- **Orphan data.** Events are written but nobody can ever see them: no list, detail or Meetings feed. The banner is a public Spaces object that nothing references.
- **No production story for plugin hosting.** The manifest `url` and `index.html` hardcode `localhost` (`plugins/warehouse/index.html`). There is no docker/nginx service for plugins and no seed row in `plugin_descriptors` in any migration. In prod, `/add/event` would show "plugin not found" unless someone registers it by hand.
- **The SDK 10 s timeout** (`plugin-sdk/messaging.ts` `TIMEOUT_MS = 10_000`) applies to every message. A 15 MB banner through `process_upload` + Spaces `put` can exceed it, so the plugin reports a failure even though the upload succeeded.
- **Banner ordering problem.** The banner is uploaded before the event exists, which leaves abandoned uploads as orphaned objects. Sending them in one request isn't possible with the string-only `pluginFetch`.
- **Spaces may be unconfigured locally.** `get_storage()` returns None without SPACES_*. A *required* banner would make event creation impossible in such environments.
- **Unmoderated public image.** The banner is the first user image that skips moderation. This was a conscious decision. A follow-up is needed (ModerationSubjectType + group-thing-ai grants).

## Summary
- **Risk Level**: Medium-High
- **Estimated Effort**: Medium-High (about 20 files: backend module + migration 0070 + matrix + tests; new plugin app of about 8 files; host handler/SDK/view + tests)
- **Detected Characteristics**: creates_new_entities, modifies_existing_code, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (`EventCreateView.tsx`, `PluginMessageHandler.ts`, `plugin-sdk/host-app.ts`, `plugins/sdk.ts`, `AppPage.test.tsx`, `authorization_matrix.py`, `main.py`, `text_guard.py`)
- Creates new entities: yes (`events` table, `app/events`, `plugins/events`)
- Involves data operations: yes (CREATE event, CREATE banner image)
- UI heavy: yes (new iframe form inside the phone-frame panel)

## Gaps Identified

### Missing Features
- **Events backend.** No `app/events` and no table (latest revision `0069_vinted_categories.py`, so the next one is 0070). `main.py:152-167` has no events router, and the authz matrix has no `/api/events` rows.
- **Text moderation field.** `TextField` (`app/moderation/text_guard.py:23-32`) has no `EVENT_NAME` / `EVENT_DESCRIPTION`. These need to be added, along with their Polish `MESSAGES`.
- **Banner upload endpoint.** None exists. Templates: avatar (`users/router.py:84-96`, `users/service.py:152-195`) and the org COVER (`organizations/media.py:350`).
- **`uploadImage` SDK message.** `handleApiMessage` throws `Unknown message type` for anything new (`PluginMessageHandler.ts:153-154`). `hostApp` (`plugin-sdk/host-app.ts`) has no upload. `pluginFetch` body is `string` only (line 48).
- **Navigate / done message.** The plugin cannot send the host back to `/add` after saving. No `navigate` type exists.
- **Resize message.** None exists. Existing pages use a fixed height: `PluginPageRoute` uses `minH calc(100vh-120px)`, and `ProductDetailPage:181` uses 60px.
- **Panel plugin host.** `PluginProvider` and the global message handler are mounted only in the `/admin` `Layout` (`router.tsx:55-62,194`). Panel views (`PANEL_VIEWS`, `add/event` at line 51) render in `AppPage` without them.
- **`plugins/events` app.** It doesn't exist (plugins present: ai-description, box-size, warehouse).

### Incomplete Features
- **`EventCreateView`** currently renders a host-native mock form with fields name/date/time/place. It must become a `SubPageHeader` + `PluginFrame` host. Its copy ("Nowe wydarzenie", "Wróć do dodawania", the past-date error) is reusable inside the plugin.
- **`PluginFrame` `contextType`** is the closed `ExtensionPointType` union of 4 values (`extensionPoints.ts`). An events page would reuse `MENU_MAIN` ("RENDER" prefix) unless a new type is added.

### Behavioral Changes Needed
- `/add/event`: from a mock "Wydarzenie zapisane" screen that stores nothing, to a real save followed by a return to `/add` (toast or confirmation).
- `AppPage.test.tsx:3009-3036` ("Dodaj › Wydarzenie (mock)") asserts the mock. It must be rewritten to assert the iframe host and its fallback.
- **The mock has a `place` field that the task's field list omits.** A scope decision is needed (see Important).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | `/add` hub tile "Wydarzenie" leads to `/add/event` (`AddView.tsx`) | Same path, iframe body | ✅ unchanged |
| Discoverability | 9/10 (hub tile) | 9/10 | 0 |
| Flow Integration | Mock confirmation, "Dodaj kolejne" | Save, then back to `/add`. Needs a `navigate` message; otherwise the user is stuck on the filled form. | ⚠️ depends on a new message |
| After-save visibility | none (mock) | none (no list/detail) | ❌ orphan, user accepted |
| Persona | any logged-in user | any logged-in user (EDIT) | ✅ if EDIT is used |
| Visual consistency | host Tailwind tokens (`src/index.css`: primary #1b8168, ink, paper) | `plugin-ui.css` `tc-*` slate/blue palette (`public/assets/plugin-ui.css`) | ❌ unless restyled |

## Data Lifecycle Analysis

### Entity: Event

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | missing (new `POST /api/events`) | missing (new plugin form) | `/add` tile exists | ❌ to build |
| READ | none | none | none | ❌ out of scope |
| UPDATE | none | none | none | ❌ out of scope |
| DELETE | none (and no admin delete) | none | none | ❌ out of scope |

### Entity: Event banner (image)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | missing (new upload endpoint) | missing (file input in plugin + `uploadImage`) | in form | ❌ to build |
| READ | the URL could be returned in the create response | none | none | ❌ |
| DELETE | none (outbox `OBJECTS_DELETE` exists for reuse) | none | none | ❌ (abandoned uploads leak) |

**Completeness**: 25% after this task (CREATE only).
**Orphaned Operations**: CREATE without READ (events and banners). There is also no admin removal path for an unmoderated public image.
**Missing Touchpoints**:
- the Meetings feed (`view === "meetings"`), where mock copy says "nie trafia jeszcze do Spotkań"
- the public organizer page
- the admin moderation queue (banner)

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **scope-orphan-event: events and banners are write-only.** Nobody can see a saved event.
   - Options: [A] keep create-only (already chosen) and show the saved data on a confirmation screen from the POST response, with a follow-up task; [B] add a minimal `GET /api/events/{id}` and a detail view; [C] add a list in Meetings.
   - Recommendation: A. It honours clarification 3. The API returns the created event so the host or plugin can confirm. Record a follow-up.
2. **banner-upload-flow: ordering of upload and create.**
   - Options: [A] create the event as JSON via `hostApp.fetch`, then `uploadImage` to `POST /api/events/{id}/banner`. Partial failure leaves an event without a banner, and the plugin shows a retry. [B] upload first to `POST /api/events/banners` and get back `banner_id`, then create with `banner_id`. Abandoned uploads become orphan Spaces objects, which need an owner check plus a sweep. [C] a single multipart `POST /api/events` via a generic `uploadForm` message carrying fields + file.
   - Recommendation: A. Owner and id are known, the storage key is `events/{event_id}/{uuid}` like avatars, nothing is orphaned, and it is the simplest to test.
3. **plugin-registration: how the events plugin row and URL exist in each environment.**
   - Options: [A] manual curl `PUT /api/plugins/events/manifest` (current practice, documented in `plugins/CLAUDE.md:43`); [B] a seed data migration 0071 inserting a `plugin_descriptors` row (URL comes from config, not hardcoded); [C] a startup upsert from env `EVENTS_PLUGIN_URL`.
   - Recommendation: A for this task, plus a clear Polish fallback on `/add/event` when the plugin is missing or disabled. Flag prod hosting (no service or nginx route for :3004) as a known gap. Without one of B or C, the feature does not work in prod.
4. **banner-required: is the banner mandatory?**
   - Options: [A] optional; [B] required.
   - Recommendation: A. Uploads are refused when Spaces is unconfigured (`BusinessConflictException` in the avatar pattern), and under option A of decision 2 the banner comes after create anyway.

### Important (Should Decide)
1. **plugin-locate: how `/add/event` finds the plugin.**
   - Options: [A] by fixed plugin id `events` (a new TanStack hook `usePlugin("events")` over `GET /api/plugins/events`, guarded by READ); [B] a new extension point `add.event` resolved via `PluginProvider` mounted for the panel.
   - Default: A. It is minimal, and B widens the closed union and `PluginFrame` prefix map. The message handler then needs installing for the panel: a small `usePluginMessageHandler()` used by the host view, sharing `iframeRegistry`, so `PluginProvider` (legacy useState fetching) is not wrapped around the whole panel.
2. **iframe-height.**
   - Options: [A] fixed min-height in the panel (like `PluginPageRoute`); [B] a new fire-and-forget `resize` message.
   - Default: B. The phone-frame panel scrolls, and a fixed-height iframe creates a nested scroll and clipped validation errors. Clamp the height host-side.
3. **navigate-after-save.**
   - Options: [A] a generic `navigate {to}` message, host-side allowlisted to in-app paths; [B] an event-specific `done` message the host maps to `viewPath("add")` plus a toast.
   - Default: B. It is the narrowest surface and gives no open-redirect primitive.
4. **date-model: what the start and end fields mean.**
   - Options: [A] `starts_at` naive Warsaw datetime (date + time required), `ends_at` optional datetime on any day ≥ start; [B] start date + optional start time, end time-only on the same day; [C] start date (all-day) + optional end time.
   - Default: A with the UI showing an end *time* defaulting to the same day. Validation: start not in the past via `clock.local_now()`, end > start, 400 in Polish. Storing a full `ends_at` avoids midnight-crossing bugs.
5. **who-can-create.**
   - Options: [A] any logged-in user (`EDIT`, plus `mcp:edit` like the avatar row); [B] organizers only.
   - Default: A. It matches the "Dodaj" hub, where every tile is open to regular users.
6. **plugin-styling.**
   - Options: [A] the events plugin ships its own CSS mirroring host tokens (colors from `src/index.css`, rounded-2xl inputs, pill buttons); [B] use `plugin-ui.css` `tc-*` as is; [C] restyle `plugin-ui.css` globally.
   - Default: A. B looks foreign inside the panel, and C would restyle the admin plugins too.
7. **place-field.** The mock has "Miejsce" but the task list omits it.
   - Options: [A] drop it; [B] keep it as free text.
   - Default: A, per task scope.
8. **banner-storage.**
   - Options: [A] columns on `events` (`banner_key`, `banner_sha256`); [B] an `event_banners` table (1:1, avatar-like, `status` column ready for the later moderation follow-up).
   - Default: B. The moderation follow-up then only adds a `ModerationSubjectType` without reshaping `events`. Choose A if minimalism wins.
9. **upload-timeout.**
   - Options: [A] a per-message timeout in the SDK (e.g. 60 s for `uploadImage`); [B] keep 10 s.
   - Default: A.
10. **entityid-bug** (`app/plugin/router.py:39`, `int` vs `uuid.UUID`).
    - Options: [A] fix it here with a test; [B] separate follow-up.
    - Default: B. This task does not touch `plugin_objects`, per the minimal-implementation standard.
11. **text-moderation-fields.**
    - Options: [A] add `EVENT_NAME` + `EVENT_DESCRIPTION`; [B] description only (as clarified).
    - Default: A. The name is also public user text, and the cost is negligible.

## Recommendations
- **Backend:**
  - `app/events/{models,schemas,service,router}.py`. `Event(BaseEntity)`: `author_profile_id` FK, `name` (≤120), `description` (≤2000, nullable), `starts_at` / `ends_at` `DateTime()` naive Warsaw.
  - Migration 0070 with named constraints and a downgrade test.
  - Matrix rows: `POST /api/events` and `POST /api/events/{id}/banner` require EDIT, with owner-only access for the banner (404-before-403).
  - `check_text` on name and description.
  - Tests: `tests/test_events.py` (create, past start → 400, end ≤ start → 400, banner upload owner/non-owner, exact key set).
- **Host:**
  - `EventCreateView` becomes a memoised `PluginFrame` plus loading / not-found / disabled states in Polish, with a Polish iframe `title`.
  - Install the handler for the panel.
  - Handler: `uploadImage` (validate that `payload.file` is a `Blob`, that the path is an allowlisted `/api/events/{uuid}/banner`, size ≤ 15 MB; build FormData; `api.upload`), `done`, `resize`.
  - SDK: `hostApp.uploadImage` and the new messages, plus `plugins/sdk.ts` types.
  - Vitest for each new message: origin rejection, non-Blob rejection, path allowlist.
- **Plugin:** copy warehouse to `plugins/events` (port 3004, `events-plugin`, imports `../../sdk`). Avoid warehouse smells: no getSDK per handler, no unchecked casts. Accessible form with `aria-invalid` / `aria-describedby` and `role="alert"`. Update `plugins/CLAUDE.md` with the new messages.

## Risk Assessment
- **Complexity Risk**: Medium. Each piece is small, but there are three layers and two runtimes.
- **Integration Risk**: High. A new cross-frame File transport, the handler moving outside admin, unregistered plugins in prod, and the SDK timeout.
- **Regression Risk**: Medium. `PluginMessageHandler` is shared by the admin and product-detail plugins. Keep the existing types untouched and extend the tests (`plugins.test.tsx`, `plugin-sdk*.test.ts`).
- **Safety Risk**: Medium. An unmoderated public banner. Mitigate with a follow-up, and keep an admin delete path in mind.
