# Specification: Events plugin (wydarzenia) at /add/event

## TL;DR
- `/add/event` stops being a host-side mock. It becomes the host `SubPageHeader` "Nowe wydarzenie" plus a `PluginFrame` for whichever enabled plugin declares the new extension point `add.event`. When no such plugin exists, the page shows a Polish fallback.
- The new `plugins/events` app (Vite + React 19, port 3004) renders the form: banner, name, start, optional same-day end, location, description. It calls a new host-native backend module `app/events` through `hostApp.fetch`.
- The backend module adds migration 0070 with three tables: `events`, `event_banners` (1:1) and `event_attendances` (a table only, with no endpoints and no UI). It adds two routes, `POST /api/events` and `POST /api/events/{id}/banner`. Every user-facing error is in Polish.
- The SDK gets two new messages: `uploadImage` (the host builds the FormData, the path is allowlisted, the limit is 5 MB) and `done` (the host navigates to `/add` and shows a toast). In dev, `build:sdk` also writes the SDK bundle to `public/assets` so port 5173 serves it.
- The feature only creates events. Nothing lists or shows them, and banners are not moderated. Revised after the spec audit (see Audit Resolutions).

## Key Decisions
- **Plugin lookup in the panel uses a TanStack `usePlugins()` hook plus `resolveExtensionPoints`, not `PluginProvider`.**
  - `resolveExtensionPoints` moves to a plain `.ts` module, `plugins/resolveExtensionPoints.ts`, so the React Fast Refresh lint rule passes.
  - The panel follows the data-fetching standard. `PluginProvider`, which uses legacy `useState` fetching, stays admin-only.
- **A new `usePluginMessageHandler(options)` hook installs the postMessage handler only while `EventCreateView` is mounted.** The admin and panel route trees never mount together, so two handlers never run at once.
- **`done` is honoured only by a handler created with an `onDone` option.** The admin handler ignores it silently. This avoids a generic navigate or open-redirect primitive.
- **`uploadImage` returns the same `{status, headers, body}` envelope as `pluginFetch`.**
  - It uses the same raw-fetch rules as `pluginFetch`: Bearer token, `X-Requested-With: PluginFetch`, `credentials: "omit"`.
  - Upload rules live in a host-side table. The only rule is `/api/events/{uuid}/banner`: 5 MB, JPEG/PNG/WebP.
  - The table is defence in depth, not a security boundary: a plugin can already reach any `/api/` path through `pluginFetch`.
- **Every user-facing error from `app/events` is Polish.** The Pydantic schema checks only the shape of the request; all fields are optional at that level. The service raises:
  - `ValueError` for domain rules, which becomes a 400 with the Polish text in `message`.
  - `EventNotFound(EntityNotFoundException)` for a missing event: 404 "Nie znaleziono wydarzenia."
  - `NotEventAuthor(AccessDeniedException)` for someone else's event: 403 "Możesz dodać baner tylko do swojego wydarzenia."
  - The 403 relies on a new optional `public_message` attribute on `AccessDeniedException`. Every existing 403 keeps "Access denied".
- **The plugin maps errors per call.** It has three mappers: `createEventError`, `bannerError` and `locationError`. No 403/404 mapping is shared between calls.
- **Submit is blocked with `aria-disabled`, not `disabled`, while the form is invalid.**
  - The button carries `aria-disabled="true"` and `aria-describedby` pointing at a visible hint.
  - A click on the blocked button reveals every field error.
  - Native `disabled` is used only while a save is running. This is the user's decision, following `pages/product/ItemCreatePage.tsx` and `accessibility.md`.
- **The empty form starts with blank date and time fields.** The end shares the start's date. The pre-filled dates in the `event-form-empty` mockup are illustrative only.
- **The banner upload locks the `events` row `FOR UPDATE` before checking for a previous banner.**
  - Concurrent uploads, such as a retry while a timed-out upload is still running, then run one after another. The later upload cleanly replaces the earlier one.
  - An old banner is replaced by deleting its row, flushing the delete, and staging an outbox `OBJECTS_DELETE` for its files.
- **The storage-disabled response uses the existing avatar wording and status.**
  - With storage unconfigured, the banner upload returns 409 "Dodawanie zdjęć jest chwilowo niedostępne" (`BusinessConflictException`). The event itself stays saved.
  - The invalid-image text reuses `INVALID_IMAGE_MESSAGE` on both sides.
- **Banners are not moderated.** They are always `APPROVED` and stored `public=True`, whatever `MODERATION_IMAGE_ENABLED` says. This is the user's decision; the `status` column is ready for the moderation follow-up.
- **Dates are naive Warsaw wall-clock times.**
  - Seconds are truncated to the minute.
  - No DST adjustment is made.
  - The start must fall between now and two years ahead.
  - The end must be later than the start and on the same calendar day, so the latest possible end is 23:59 and midnight is not allowed.
- **`EventResponse` has no `banner` key and no author id.** On create the banner is always null, so neither has a reader.
- **The iframe has a fixed viewport-relative height and the plugin scrolls inside it.** This keeps the plugin's bottom sheet visible. There is no resize message.
- **`event_attendances` is created now, as a schema only, by user decision.**
  - It is modelled on `TermAttendance` (`app/groups/models.py:255-281`).
  - `party_id` is a plain FK-id column with a real foreign key to `parties.id`, the same as `events.author_party_id`. There is no `relationship()`.
  - There is deliberately no `child_count`.
  - A partial unique index allows one active sign-up per party per event.
  - The business key is `(event_id, party_id, created_at)`. All three values are immutable, unlike `withdrawn_at`.
- **The SDK bundle for dev is written in two places.**
  - `npm run build:sdk` writes `dist/assets/plugin-sdk.js` as before, and then copies it to `src/frontend/public/assets/plugin-sdk.js`.
  - The copy in `public/assets` is git-ignored. The Vite dev server on port 5173 serves it at `/assets/plugin-sdk.js`.
  - The old Java-era copy at `src/resources/static/assets/plugin-sdk.js` is left untouched.
- **The plugin has no unit tests.** There is no plugin test infrastructure. Its validation sits in a pure `domain.ts` whose wording is copied from the Copy table below. The plugin is verified by `tsc -b && vite build` plus an end-to-end or manual pass.

## Open Questions / Risks
- **SDK timeout.**
  - Per-call timeout (verification fix, cycle 1): `uploadImage` waits 60 s, every other call keeps 10 s. A create that times out shows create.unconfirmed instead of create.generic, so the user does not blindly retry into a duplicate.
  - "Spróbuj ponownie" then replaces the banner safely, because uploads are serialised on the event-row lock.
- **No production story for plugins.**
  - The manifest URL and the `plugin-sdk.js` URL are localhost, and registration is a manual curl with an admin token.
  - In production, `/add/event` shows the fallback until someone hosts and registers the plugin.
- **Unmoderated public banner.**
  - This is the first user image without moderation, and there is no admin path to delete it.
  - Follow-up needed: `ModerationSubjectType` plus the `group-thing-ai` cron.
- **Unused table, a deliberate deviation from `minimal-implementation.md`.** `event_attendances` has no readers or writers until the sign-ups follow-up. This was the user's explicit choice.
- **Write-only data.** Nothing displays events or banners yet. A list/detail follow-up is needed.
- **Iframe height offset.** The `calc(100dvh - …)` offset depends on the PhoneFrame chrome. Tune it during implementation so the panel itself does not scroll as well.
- **Browser time vs Warsaw time.** The plugin's "start in the past" and "two-year" checks use the browser's local time. The server decides, using Warsaw time.
- **A Polish message can be duplicated between the plugin and the backend.** Both copy the Copy table. Verification compares the two by hand; there is no shared module.

## Goal
A logged-in user can create a one-off event from `/add` → "Wydarzenie". The host backend persists it through a plugin form in an iframe, and the user returns to the hub with a confirmation toast.

## User Stories
- As a logged-in user, I want to create a one-off event (name, start, optional end, place, description) so that I can plan a picnic or a birthday.
- As a logged-in user, I want to add an optional banner image so that my event is recognisable.
- As a logged-in user, I want to pick one of my saved places, or quickly add a new one, without leaving the form.
- As a logged-in user, I want clear Polish errors when I enter a past start, an end before the start, or a too-short name, so that I can fix the form before saving.
- As a logged-in user, I want to keep my saved event when the banner upload fails, and be able to retry or skip it.
- As a user on an environment where the events plugin is missing or disabled, I want a clear message and a way back instead of a blank page.

## Copy table (single source for backend and plugin)
| Key | Polish text | Where |
|---|---|---|
| name.blank | Podaj nazwę wydarzenia. | backend 400 + plugin |
| name.length | Nazwa musi mieć od 3 do 120 znaków. | backend 400 + plugin |
| start.missing | Podaj datę i godzinę początku. | backend 400 + plugin |
| start.past | Początek nie może być w przeszłości. | backend 400 + plugin |
| start.tooFar | Początek może być najwyżej 2 lata od dziś. | backend 400 + plugin |
| end.notAfter | Koniec musi być później niż początek. | backend 400 + plugin |
| end.otherDay | Koniec musi przypadać tego samego dnia co początek. | backend 400 (the plugin cannot produce it) |
| datetime.aware | Podaj datę i godzinę bez strefy czasowej. | backend 400 |
| description.length | Opis może mieć najwyżej 2000 znaków. | backend 400 + plugin |
| moderation | `MESSAGES[EVENT_NAME]` "Nazwa wydarzenia narusza zasady społeczności. Zmień ją i spróbuj ponownie." / `MESSAGES[EVENT_DESCRIPTION]` "Opis wydarzenia narusza zasady społeczności. Zmień go i spróbuj ponownie." | backend 400 |
| banner.notFound | Nie znaleziono wydarzenia. | backend 404 |
| banner.notAuthor | Możesz dodać baner tylko do swojego wydarzenia. | backend 403 |
| banner.disabled | Dodawanie zdjęć jest chwilowo niedostępne | backend 409 (same text as `AVATAR_UPLOAD_DISABLED_MESSAGE`) |
| banner.tooLarge | Baner jest za duży (maks. 5 MB) | backend 400 + plugin |
| banner.invalid | Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP | backend 400 (`INVALID_IMAGE_MESSAGE`) + plugin |
| banner.hint | JPG, PNG lub WebP, do 5 MB | plugin (the mockup's "JPEG" is corrected) |
| banner.failed | Nie udało się wysłać banera. Wydarzenie jest zapisane bez banera. | plugin |
| submit.hint | Uzupełnij nazwę oraz datę i godzinę początku, aby zapisać. | plugin (`aria-describedby` target) |
| create.location | Wybrane miejsce jest niedostępne — wybierz inne. | plugin, `createEvent` 403/404 only |
| session | Sesja wygasła — zaloguj się ponownie. | plugin, any 401 |
| create.generic | Nie udało się zapisać wydarzenia. Spróbuj ponownie. | plugin |
| create.unconfirmed | Nie udało się potwierdzić zapisu — wydarzenie mogło zostać zapisane. Odczekaj chwilę przed ponowną próbą. | plugin, `createEvent` rejected call / timeout (no HTTP status), or a 201 whose body cannot be parsed |
| place.name | Podaj nazwę miejsca. | plugin |
| place.address | Podaj adres miejsca. | plugin |
| place.invalid | Uzupełnij nazwę i adres miejsca. | plugin, `POST /api/locations` 400 |
| place.generic | Nie udało się dodać miejsca. Spróbuj ponownie. | plugin |
| places.load | Nie udało się wczytać miejsc. | plugin |
| unavailable | Plugin wydarzeń jest niedostępny / Dodawanie wydarzeń jest chwilowo wyłączone. Spróbuj później. | host |
| toast | Wydarzenie „{name}” zapisane (fallback: Wydarzenie zapisane) | host |

## Core Requirements

### Backend: `app/events`
1. **Migration `0070_events`** (`down_revision = "0069"`) creates three tables.
   - `downgrade()` drops them in reverse dependency order: first the indexes of `event_attendances`, then `event_attendances`, then `event_banners`, then `events`.
   - `events`:
     - `id` UUID `pk_events`, server default `gen_random_uuid()`
     - `author_party_id` UUID NOT NULL, FK `fk_events_author_party_id_parties` → `parties.id`
     - `name` VARCHAR(120) NOT NULL
     - `description` VARCHAR(2000) NULL
     - `starts_at` TIMESTAMP (naive) NOT NULL
     - `ends_at` TIMESTAMP NULL
     - `location_id` UUID NULL, FK `fk_events_location_id_locations` → `locations.id`
     - `created_at`, `updated_at` (BaseEntity)
   - `event_banners`:
     - `id` UUID `pk_event_banners`
     - `event_id` UUID NOT NULL, FK `fk_event_banners_event_id_events`, unique `uq_event_banners_event_id`
     - `storage_key` VARCHAR(200) NOT NULL
     - `size_bytes` INTEGER NOT NULL
     - `content_sha256` VARCHAR(64) NOT NULL
     - `status` VARCHAR(20) NOT NULL (string-backed `ModerationStatus`)
     - `created_at`, `updated_at`
   - `event_attendances` (schema only: no service, router or UI in this task):
     - `id` UUID `pk_event_attendances`, server default `gen_random_uuid()`
     - `event_id` UUID NOT NULL, FK `fk_event_attendances_event_id_events` → `events.id`, index `ix_event_attendances_event_id`
     - `party_id` UUID NOT NULL, FK `fk_event_attendances_party_id_parties` → `parties.id`. A plain FK-id column, consistent with `events.author_party_id`.
     - `withdrawn_at` TIMESTAMP (naive UTC) NULL. NULL means the sign-up is active.
     - `created_at`, `updated_at`
     - Partial unique index `uq_event_attendances_event_id_party_id` on `(event_id, party_id)` `WHERE withdrawn_at IS NULL`: one active sign-up per party per event.
     - Deliberately no `child_count` (unlike `TermAttendance`) and no `capacity`.
   - No other indexes on `events` or `event_banners`, because no read query exists yet.
2. **Models** in `app/events/models.py`:
   - `Event(BaseEntity)`, `EventBanner(BaseEntity)` and `EventAttendance(BaseEntity)`.
   - No `relationship()` anywhere. The module gets its own copy of `_enum_column`.
   - Business-key `__eq__`/`__hash__` use immutable columns only:
     - `Event` on `(author_party_id, created_at)`. No natural unique key exists; name and start may repeat.
     - `EventBanner` on `storage_key`.
     - `EventAttendance` on `(event_id, party_id, created_at)`. `(event_id, party_id)` alone repeats across withdrawn and later sign-ups, and `withdrawn_at` changes.
   - `EventBanner.large_key` = `{storage_key}/w1600.webp`, `thumb_key` = `{storage_key}/w400.webp`.
   - Nothing reads or writes `EventAttendance` in this task.
3. **`POST /api/events`** creates an event.
   - Requires `EDIT` or `mcp:edit`.
   - Returns 201 with `EventResponse`.
   - The author is the caller's party (`get_profile_by_principal(...).party_id`). It is never a field in the body.
   - Request model `CreateEventRequest` (`extra="forbid"`; every field optional at the schema level, so a missing field reaches the service). Validation happens in the service, in table order, and the first failing rule wins:

   | Field | Rule (copy key → 400) |
   |---|---|
   | `starts_at` naive datetime | Missing → start.missing. Timezone-aware → datetime.aware. Seconds and microseconds are truncated. Earlier than `clock.local_now()` truncated to the minute → start.past. Later than `clock.local_now() + timedelta(days=730)` → start.tooFar. |
   | `ends_at` naive datetime or null | Timezone-aware → datetime.aware. Truncated to the minute. Not later than `starts_at` → end.notAfter. Its `.date()` differs from that of `starts_at` → end.otherDay. So the latest possible end is 23:59, and midnight is not allowed. |
   | `name` str | Trimmed. Blank or missing → name.blank. Outside 3–120 characters after trimming → name.length. |
   | `description` str or null | Trimmed. A blank value is stored as null. Over 2000 characters → description.length. |
   | `location_id` UUID or null | Checked with `locations_acl.get_owned_location`, as for a Term. Missing or soft-deleted → 404; someone else's → 403. These stay English server-side, and the plugin maps them. |

   - DST: naive wall-clock values are stored exactly as entered. A time inside a DST gap or overlap is accepted with no adjustment.
   - Text moderation runs after these rules and before the insert: `check_text(TextField.EVENT_NAME, name)`, then `check_text(TextField.EVENT_DESCRIPTION, description)`. A rejected text returns 400 with its `MESSAGES` text. An unavailable classifier returns 503 with the existing Polish `ModerationUnavailable` text.
   - Wrong JSON types still produce the existing 400 "Validation failed" envelope. That is a client bug, not a user path.
   - `EventResponse` has exactly these keys: `id`, `name`, `description`, `starts_at`, `ends_at`, `location` (`LocationRefResponse | null`), `created_at`, `updated_at`.
4. **`POST /api/events/{event_id}/banner`** uploads the banner.
   - Multipart request with one field, `file`.
   - Requires `EDIT` or `mcp:edit`.
   - Returns 200 with `EventBannerResponse {url, status}`. `url` is the public URL of the `w1600` image.
   - The router reads at most `EVENT_BANNER_MAX_BYTES + 1` bytes (5 MB + 1) and passes the bytes to `set_event_banner(db, principal, event_id, data, storage)`. The service then runs, in this order:
     1. `db.get(Event, event_id, with_for_update=True)`. A missing event raises `EventNotFound` → 404 banner.notFound.
     2. The caller is not the author → `NotEventAuthor` → 403 banner.notAuthor.
     3. `storage is None` → 409 banner.disabled.
     4. `len(data) > EVENT_BANNER_MAX_BYTES` → 400 banner.tooLarge. This check sits in the service, after steps 1–3.
     5. `images.process_upload` runs in a thread. A file that is not an image → 400 `INVALID_IMAGE_MESSAGE`.
     6. Look up the previous banner. The event-row lock makes concurrent uploads run one after another.
     7. Store the large and thumb images under `events/{event_id}/{banner_id}` with `public=True`, `status=APPROVED`.
     8. If a previous banner exists: delete it, flush, and stage `OBJECTS_DELETE` for its keys.
     9. Commit. On any failure, roll back and delete the newly stored files (the avatar pattern).
5. **`app/events/infrastructure/locations_acl.py`** is the only events module that imports `app.locations`.
   - It re-exports `LocationRefResponse`, `get_owned_location`, `get_location` and `location_ref_response`.
   - It never imports `..schemas`. `app/events/schemas.py` takes `LocationRefResponse` from the ACL.
6. **Errors and moderation fields.**
   - In `app/core/errors.py`, `AccessDeniedException` gains an optional `public_message: str | None = None`. `access_denied_handler` uses it when it is set and falls back to "Access denied", so existing 403s do not change.
   - `app/events/service.py` defines `EventNotFound(EntityNotFoundException)` (message banner.notFound) and `NotEventAuthor(AccessDeniedException)` (`public_message` banner.notAuthor).
   - `app/moderation/text_guard.py` gains `TextField.EVENT_NAME` and `TextField.EVENT_DESCRIPTION`, with their `MESSAGES` from the Copy table.
7. **Authorization.**
   - Add two `AUTHORIZATION_MATRIX` rows before the catch-all: `POST ^/api/events$` and `POST ^/api/events/[^/]+/banner$`, both `("EDIT", "mcp:edit")`.
   - Register the router with `app.include_router(events_router)` in `main.py`.

### Host frontend
8. **Extension point.**
   - Add `ADD_EVENT = "add.event"` to `plugins/extensionPoints.ts`, which widens `ExtensionPointType`.
   - `PluginFrame` maps it with `CONTEXT_TYPE_PREFIX[ADD_EVENT] = "RENDER"`.
   - `api/plugins.ts` needs no edit; its type follows the union.
9. **Resolver module.**
   - Move `resolveExtensionPoints` and `ResolvedExtensionPoint` out of `PluginContext.tsx` into a new `plugins/resolveExtensionPoints.ts`. Behaviour does not change: disabled plugins are skipped and results are sorted by ascending priority.
   - `PluginContext.tsx` and `PluginFilterBar.tsx` import from the new module.
10. **`hooks/usePlugins.ts`** (new) is a TanStack hook over `getPlugins()`.
    - Its query key starts with the prefix constant `PLUGINS_KEY = "plugins"`.
    - It returns `{ data: PluginResponse[]` with a stable empty fallback, `loading`, `error: string | null`, `refetch }`.
11. **`plugins/usePluginMessageHandler.ts`** (new) adds the `createMessageHandler(iframeRegistry, options)` listener on mount and removes it on unmount. It keeps the latest `options` in a ref, so the listener is installed only once.
12. **`PluginMessageHandler.ts`** gains two message types. Both run after the existing prefix, source and origin checks. Existing types do not change.
    - `done` is fire-and-forget: it calls `options.onDone?.(pluginId, payload)` and sends no response. Without `onDone` it is ignored silently.
    - `uploadImage` takes the payload `{ url: string, file: Blob }`. It responds with an error when any of these holds:
      - `url` is not a string, contains `..`, or matches no entry in `UPLOAD_IMAGE_RULES`.
      - `file` is not a `Blob`.
      - The file is larger than the rule's `maxBytes`.
      - The file type is not among the rule's `mimeTypes`.

      The one rule matches `^/api/events/<uuid>/banner$` (case-insensitive), with a 5 × 1024 × 1024 byte limit and the types `image/jpeg`, `image/png` and `image/webp`. A request that passes is sent like this:
      - The body is a `FormData` with one field, `file`.
      - It is sent with raw `fetch` (`POST`, `credentials: "omit"`). The headers are `X-Requested-With: PluginFetch` and the Bearer token; `Content-Type` is not set.
      - The response is `{ status, headers (safelisted), body: text }`.
13. **SDK** (`src/plugin-sdk/`).
    - `hostApp.uploadImage(url: string, file: Blob)` uses `sendMessageAndWait("uploadImage", { url, file })` and returns the `pluginFetch` shape. It passes a 60 s timeout (`sendMessageAndWait` takes an optional `timeoutMs`, default 10 s).
    - `thisPlugin.done(payload?: { name?: string })` uses `sendFireAndForget("done", payload ?? {})`.
    - Both are mirrored in `plugins/sdk.ts`.
    - **Dev serving:** the `build:sdk` script becomes `vite build -c vite.sdk.config.ts` followed by a cross-platform Node copy (`fs.copyFileSync`) of `dist/assets/plugin-sdk.js` to `public/assets/plugin-sdk.js`. Add `public/assets/plugin-sdk.js` to `src/frontend/.gitignore`. The Vite dev server on 5173 serves it at `/assets/plugin-sdk.js`. The production build is unchanged and keeps writing to `dist/assets`.
14. **`pages/add/eventCreateViewState.ts`** (new) holds the pure `resolveEventCreateView({ loading, error, plugins })`. It returns:
    - `{ kind: "loading" }`.
    - `{ kind: "unavailable" }` when the fetch failed, or no enabled plugin declares `add.event`.
    - `{ kind: "ready", point }` with the first point by priority.
15. **`EventCreateView.tsx` is rewritten.** It always renders `SubPageHeader` with `title="Nowe wydarzenie"`, `backTo={viewPath("add")}` and `backLabel="Wróć do dodawania"`, then switches on `view.kind`:
    - `loading`: a `role="status"` "Wczytywanie…".
    - `unavailable` (screen:event-plugin-unavailable): a card with "🎈" (`aria-hidden`), the unavailable copy, and a link "Wróć do dodawania".
    - `ready`: a `PluginFrame` with:
      - `pluginId`, `pluginName` and `pluginUrl` taken from `point`
      - `contextType={ADD_EVENT}`
      - `path={point.path ?? "/"}`
      - `title="Formularz nowego wydarzenia"`. This is a new optional `title` prop on `PluginFrame`; the default stays `Plugin: {name}`.
      - `style.height: calc(100dvh - <chrome offset>)` and `minHeight: 560px`

    The view also mounts `usePluginMessageHandler({ onDone })`. `onDone`:
    - trims the payload `name` and caps it at 120 characters;
    - calls `showToast` with the toast copy;
    - calls `void queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY] })` through `useQueryClient()`, because the plugin may have created a place with `hostApp.fetch`, which bypasses the host's hook invalidation;
    - calls `navigate(viewPath("add"))`.

### Plugin `plugins/events`
16. **Scaffold.** Copy the warehouse structure without its code smells:
    - `package.json`: name `events-plugin`, `"type": "module"`, the same dependency versions as warehouse.
    - `vite.config.ts`: port 3004, `strictPort`.
    - `tsconfig.json` and `src/vite-env.d.ts`.
    - `index.html`: `lang="pl"`. It loads `http://localhost:5173/assets/plugin-sdk.js` and not `plugin-ui.css`.
    - `src/styles.css`: mirrors the host tokens from `src/frontend/src/index.css`, with system font fallbacks and no external font loads.
    - `src/main.tsx`: a single route, `/` → `pages/EventCreatePage.tsx`.
    - `manifest.json`: name "Wydarzenia", version "1.0.0", url `http://localhost:3004`, description "Tworzenie jednorazowych wydarzeń", and `extensionPoints: [{ "type": "add.event", "label": "Wydarzenie", "path": "/", "priority": 10 }]`.
    - SDK imports: `../../sdk` from `src/*.ts(x)`, and `../../../sdk` from `src/pages/*` and `src/components/*`. Call `getSDK()` once per module.
17. **`src/domain.ts`** (pure):
    - Types: `EventDraft`, `EventResponse`, `LocationResponse`, `EventBannerResponse`.
    - `validateDraft(draft, now)` returns per-field errors using the Copy table (name, start.missing/past/tooFar, end.notAfter, description) plus the banner checks banner.invalid and banner.tooLarge.
    - `validatePlace({name, address})` returns place.name / place.address when a field is blank after trimming. The inputs cap length with `maxLength` 255 and 500.
    - `toRequest(draft)` builds naive `YYYY-MM-DDTHH:mm:00` strings. `ends_at` uses the start date with the end time.
    - Error mappers, one per call:
      - `createEventError(res)`: 400/409/503 → the body `message`; 403/404 → create.location; 401 → session; a rejected call or timeout (no status), or a 201 whose body cannot be parsed → create.unconfirmed; otherwise → create.generic. A malformed `location` in the 201 body degrades to `location: null` instead of failing the parse.
      - `bannerError(res | rejection)`: 400/403/404/409 → the body `message`, which is now always Polish; 401 → session; otherwise, including a timeout → no extra line, banner.failed only.
      - `locationError(res)`: 400 → place.invalid; 401 → session; otherwise → place.generic.
    - API helpers wrap `hostApp.fetch` and `hostApp.uploadImage`: `createEvent`, `uploadBanner`, `listMyLocations` (`GET /api/locations/mine`) and `createLocation` (`POST /api/locations`, `source: "MANUAL"`).
18. **Form** (screens `event-form-empty`, `event-form-filled`, `event-form-errors`). The fields follow the mockup order:
    - Banner (optional):
      - A "+ Dodaj baner" drop zone with the banner.hint text.
      - The file input has `accept="image/jpeg,image/png,image/webp"`.
      - The preview uses `URL.createObjectURL`; the URL is revoked when the file is replaced or the component unmounts.
      - "Zmień" and "Usuń" chips.
    - Nazwa: `maxLength=120`.
    - Początek: a date input and a time input, both **blank on an empty form**.
    - Koniec: a time input that is blank by default, labelled "opcjonalnie, tego samego dnia". It always uses the start date.
    - Lokalizacja: a row button.
    - Opis: `maxLength=2000` and a "N / 2000" counter.
    - Each field shows its error after it is blurred. The error is inline with `role="alert"`, and the field gets `aria-invalid` and `aria-describedby`.
    - **"Zapisz wydarzenie"** is a focusable `aria-disabled="true"` button while the draft is invalid, with `aria-describedby` pointing at a visible submit.hint paragraph. Clicking it marks every field as touched, which reveals all the errors, and then returns without saving. While a save runs, the button is natively `disabled`.
19. **Location sheet** (screen `event-location-picker`):
    - It is a `role="dialog"` with `aria-modal`, the heading "Lokalizacja" and a ✕ close button. It traps Tab and Shift+Tab, Esc closes it, and focus returns to the trigger. Every button has `type="button"`.
    - It lists `GET /api/locations/mine`. While loading it shows `role="status"`. On error it shows places.load and a "Spróbuj ponownie" button.
    - "+ Dodaj nowe miejsce" opens an inline form with Nazwa (`maxLength=255`) and Adres (`maxLength=500`):
      - Field errors follow `validatePlace`.
      - The "Dodaj miejsce" button follows the same `aria-disabled` pattern as the main submit.
      - On submit it calls `POST /api/locations` with `{name, formatted_address, source: "MANUAL"}`. Success (201 or 200) selects the new place and closes the sheet. Failure shows `locationError` with `role="alert"`, and the form keeps its input.
    - "Bez lokalizacji" clears the chosen place.
20. **Save flow** (screens `event-saving`, `event-saved`, `event-banner-failed`):
    1. **Saving**: "Zapisujemy „{name}”…", then the steps "✓ Wydarzenie zapisane" and "Wysyłanie banera…", with the note "Nie zamykaj tej strony."
    2. **Create**: `createEvent` runs. On anything other than a parseable 201, the plugin goes back to the form, keeps the draft, and shows `createEventError` as a form-level `role="alert"`.
    3. **Banner upload** (only when a banner was chosen): on a non-200 response or a rejected call, the plugin shows `bannerFailed`. That screen shows banner.failed plus the `bannerError` line when there is one, and two actions:
       - "Spróbuj ponownie" uploads again, replacing any banner already stored.
       - "Pomiń baner" goes to `saved`.
    4. **Saved**: a `role="status"` card with:
       - "Wydarzenie zapisane" and the event name.
       - The date line from `Intl.DateTimeFormat("pl-PL")`, e.g. "niedziela, 15 listopada · 14:00–18:00", or "· 14:00" when there is no end.
       - The location name and address, when set.
       - "Dodaj kolejne", which resets to the empty form.
       - "Wróć do dodawania", which calls `thisPlugin.done({ name })`.
21. **Docs** (`plugins/CLAUDE.md`):
    - The `add.event` extension point section.
    - `hostApp.uploadImage`: allowlist, 5 MB limit, response shape, and the 60 s timeout caveat.
    - `thisPlugin.done`: only panel hosts honour it.
    - The dev SDK step: run `npm run build:sdk` in `src/frontend` before starting a plugin, and again after any SDK change.
    - Ports: 3001 warehouse, 3002 box-size, 3003 ai-description, 3004 events.
    - The registration curl, with `-H "Authorization: Bearer <admin-token>"` as a placeholder only (PLUGIN_MANAGEMENT or ADMIN).
    - Import paths: `../../sdk` vs `../../../sdk`.
    - A note that panel-hosted plugins use their own CSS mirroring the host tokens.
    - An "Events Plugin" reference entry.
22. **Requirements trace.** `analysis/requirements.md` Key Decisions records `event_attendances` (done).

### Tests
23. Backend and host tests as listed in the Testing Approach. They replace the mock `/add/event` tests in `AppPage.test.tsx`.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups. Fidelity: high (rendered HTML on host tokens). Corrections against the mockups:
- `event-form-empty` shows pre-filled dates; they are illustrative, and the real empty form has blank date and time fields.
- The banner hint says "JPG", not "JPEG".
- The disabled-looking submit is rendered with `aria-disabled` and a visible hint below it.

| ID | Mockup | Rendered by | Key elements → requirements |
|---|---|---|---|
| screen:event-form-empty | `mockups/formularz-nowego-wydarzenia-pusty.html` | plugin, under the host header | Intro text, banner drop zone, blank fields, `aria-disabled` submit + hint (Req 18) |
| screen:event-form-filled | `mockups/formularz-wype-niony-z-banerem.html` | plugin | Banner preview with Zmień/Usuń, date + time, end time, location row, counter "49 / 2000" (Req 18) |
| screen:event-form-errors | `mockups/b-dy-walidacji.html` | plugin | Inline name.blank / start.past / end.notAfter (Req 3, 17, 18) |
| screen:event-location-picker | `mockups/wyb-r-lokalizacji.html` | plugin sheet | "Lokalizacja" ✕, my places, "+ Dodaj nowe miejsce", "Bez lokalizacji" (Req 19) |
| screen:event-saving | `mockups/zapisywanie-wydarzenia.html` | plugin | Two-step progress, "Nie zamykaj tej strony.", natively disabled "Zapisywanie…" (Req 20) |
| screen:event-saved | `mockups/potwierdzenie-zapisu.html` | plugin | Confirmation from the POST response; "Dodaj kolejne" / "Wróć do dodawania" sends `done` (Req 13, 20) |
| screen:event-banner-failed | `mockups/b-d-wysy-ania-banera.html` | plugin | Saved card + banner.failed; "Spróbuj ponownie" / "Pomiń baner" (Req 4, 20) |
| screen:event-plugin-unavailable | `mockups/plugin-niedost-pny.html` | host | 🎈, unavailable copy, "Wróć do dodawania" (Req 14, 15) |
| screen:add-hub-toast | `mockups/hub-dodawania-z-toastem.html` | host | `/add` hub with the toast "Wydarzenie „Piknik w parku” zapisane" (Req 12, 15) |
| component:banner-picker | `mockups/formularz-wype-niony-z-banerem.html` | plugin | Drop zone or preview, change/remove chips, banner.hint (Req 18) |
| component:location-field | `mockups/wyb-r-lokalizacji.html` | plugin | Row button opening the sheet, `type="button"` (Req 18, 19) |

Layout guidance:
- Inputs are `h-12 rounded-2xl`, with a 1.5px border in `line`, a `paper` background, and a focus ring in `focus-ring` + `primary-soft`.
- Buttons are `primary` pills.
- The confirmation card is `rounded-[28px] bg-primary-soft`.
- Bricolage Grotesque for serif titles, Figtree for body text.
- Mobile-first, a 16px gutter, no horizontal scroll.

## Reusable Components

### Existing Code to Leverage
| What | Where | How |
|---|---|---|
| Avatar upload flow | `src/backend/app/users/service.py:152-195`, `users/router.py:84-96` | Template for `set_event_banner` (the event-row lock is added), bounded read, rollback deletes the new files |
| Disabled-upload wording | `users/service.py:128` `AVATAR_UPLOAD_DISABLED_MESSAGE` | Same text for banner.disabled |
| Image pipeline | `app/storage/images.py` (`process_upload`, `INVALID_IMAGE_MESSAGE`) | Unchanged. The 5 MB check runs before it; the global 15 MB limit stays |
| Storage, outbox | `app/storage/service.py`, `app/storage/outbox_listener.py` (`OBJECTS_DELETE`), `app/outbox/service.append` | Banner files and deletes of replaced files |
| Location ACL | `app/groups/infrastructure/locations_acl.py`, `app/locations/service.get_own_location` | Pattern for `app/events/infrastructure/locations_acl.py`, including the `LocationRefResponse` re-export |
| Attendance shape | `app/groups/models.py:255-281` `TermAttendance` | Model for `EventAttendance` (no `child_count`) |
| Profile → party | `app/users/service.get_profile_by_principal` | Author party id |
| Text moderation | `app/moderation/text_guard.py` | Two new fields |
| Domain clock | `app/core/clock.local_now()` | Start-time checks |
| Error envelope | `app/core/errors.py` | ValueError → 400, subclassed 404/403, 409; additive `public_message` |
| Authorization | `app/core/authorization_matrix.py` | Two rows |
| Test fixtures | `tests/conftest.py` (`client`, `db_session`, `fake_storage`, `freeze_local_now`), `test_my_profile.py::_png`, `test_conversation_messages.py` classifier fakes, `test_locations_migration.py` | Backend tests |
| Plugin host | `plugins/PluginFrame.tsx`, `iframeRegistry.ts`, `PluginMessageHandler.ts` | Extended, not forked |
| `aria-disabled` pattern | `pages/product/ItemCreatePage.tsx` (`actionState`, `MISSING_FIELDS_HINT_ID`) | Submit and add-place buttons in the plugin |
| Locations cache key | `hooks/useMyLocations.ts` `LOCATIONS_KEY` | Invalidated in `onDone` |
| Message handler tests | `src/test/plugins.test.tsx:156-200` (MessageEvent with `source`/`origin`) | Pattern for the new handler and AppPage tests |
| Panel chrome, toast | `SubPageHeader`, `useAppData().showToast`, `viewPath` | Host view |
| Copy and classes | the current `pages/add/EventCreateView.tsx` | Ported into the plugin |
| Plugin scaffold | `plugins/warehouse/*`, `plugins/sdk.ts` | Template for the structure |

### New Components Required
- **`app/events`** (`models`, `schemas`, `service`, `router`, `infrastructure/locations_acl`) and migration 0070. Events need an owner and text moderation, and they are a separate concept from Term. `plugin_objects` has neither an owner nor moderation.
- **`plugins/resolveExtensionPoints.ts`**. React Fast Refresh forbids a `.tsx` context module from exporting non-component functions, and the pure view-state module must not import a React context.
- **`hooks/usePlugins.ts`**. The data-fetching standard requires it, and `PluginProvider` is admin-scoped.
- **`plugins/usePluginMessageHandler.ts`**. The panel needs the message handler without `PluginProvider`.
- **`pages/add/eventCreateViewState.ts`**. Required by the view-state standard.
- **`plugins/events/*`**. The task requires an iframe plugin. Host components such as `LocationAddForm` and `trapFocus` cannot cross the iframe boundary.

## Technical Approach
- **Data flow.**
  1. `/add` → `/add/event`.
  2. `usePlugins` → `resolveEventCreateView` → `PluginFrame` loads `http://localhost:3004/#RENDER{…}`.
  3. `hostApp.fetch POST /api/events` creates the event.
  4. `hostApp.uploadImage` sends the banner; the host checks the rule, builds the FormData and calls `/banner`.
  5. `thisPlugin.done` → the host shows the toast, invalidates locations and navigates to `/add`.
- **Same-origin API.** Every call goes through the host origin's `/api`: the Vite proxy in dev, nginx in production (16 MB body limit). No CORS change is needed.
- **Dates.** Naive Europe/Warsaw wall-clock times from end to end, truncated to the minute, with no DST adjustment.
- **`create_event` steps.**
  1. Load the profile.
  2. Validate in Copy-table order and normalise.
  3. Run the location ACL check when `location_id` is set.
  4. Run `check_text` on the name, then the description.
  5. Insert and commit.
  6. Load the location for the response.
- **Concurrency.** `set_event_banner` takes the event row `FOR UPDATE`, so a second upload waits, then sees the first upload's banner and replaces it. `uq_event_banners_event_id` stays as a backstop.
- **Compatibility.**
  - Existing message types, `PluginProvider` behaviour, the admin routes and the product-detail frames do not change.
  - The `AccessDeniedException` change is additive: every existing raise keeps "Access denied".
  - In prod, `build:sdk` still writes to `dist/assets`.

## Implementation Guidance

### Testing Approach
- 2–8 focused tests per implementation step group. Test verification runs only the new tests, not the entire suite.
- **Backend `tests/test_events.py`** — event creation, 8 tests:
  1. `test_createEvent_validWithOwnLocation_returns201ExactKeys`: exact key set, blank description → null, seconds truncated.
  2. `test_createEvent_missingOrAwareStart_returns400`: parametrised over start.missing and datetime.aware.
  3. `test_createEvent_startPastOrTooFar_returns400`: uses `freeze_local_now`.
  4. `test_createEvent_endNotAfterStartOrOtherDay_returns400`: parametrised over equal times, earlier time, and an end of 00:00 on the next day.
  5. `test_createEvent_nameOrDescriptionOutOfBounds_returns400`: blank, 2 and 121 characters; 2001-character description.
  6. `test_createEvent_foreignOrMissingLocation_returns403Or404`.
  7. `test_createEvent_rejectedText_returns400`: fake rejecting classifier, restored afterwards.
  8. `test_createEvent_classifierUnavailable_returns503`.
- **Backend `tests/test_event_banners.py`** — banner upload, 5 tests:
  1. `test_uploadBanner_author_returns200StoresPublicFiles`.
  2. `test_uploadBanner_replace_keepsOneRowStagesOutboxDelete`.
  3. `test_uploadBanner_nonAuthorOrMissing_returns403Or404Polish`.
  4. `test_uploadBanner_tooLargeOrNotImage_returns400`.
  5. `test_uploadBanner_storageDisabled_returns409`.
  - The savepoint fixture cannot reproduce two concurrent requests, so the row lock is checked in code review, not by a test.
- **Backend `tests/test_events_migration.py`** — 1–2 tests: downgrade to 0069 drops all three tables, then upgrade to head restores them, their named constraints, and the predicate of `uq_event_attendances_event_id_party_id`.
- **Backend: other test files.**
  - Add the two rows to `tests/test_authorization_matrix.py`.
  - In `tests/test_domain_clock_guard.py`, add `app/events` to `_GUARDED_DIRS` and rename the test to `test_guardedPackages_noHostClockCalls`.
- **Frontend** — Vitest under `src/test/`, explicit vitest imports, typed fixtures:
  - `eventCreateViewState.test.ts`: an `it.each` table over loading, fetch error, no plugins, disabled plugin, enabled plugin without `add.event`, ready, and lowest-priority-wins.
  - `plugins.test.tsx`, 7 additions:
    1. `uploadImage` happy path: FormData field `file`, Bearer, `X-Requested-With`, `pluginFetch` shape.
    2. A path that is not allowlisted → error.
    3. `it.each` over non-Blob, oversized, and disallowed MIME type (`image/gif`) → error.
    4. `done` calls `onDone` and sends no response.
    5. `done` without `onDone` → no response and no throw.
    6. `PluginFrame` with `add.event` → `RENDER` prefix.
    7. `usePluginMessageHandler` removes its listener on unmount.
  - `plugin-sdk.test.ts`, 2 additions: `hostApp.uploadImage` posts `{url, file}`; `thisPlugin.done` is fire-and-forget.
  - `AppPage.test.tsx`, up to 4 tests. Replace the "Dodaj › Wydarzenie (mock)" describe; add `vi.mock("../api/plugins")` and stub `getPlugins` per test.
    1. The hub link points to `/add/event`.
    2. With a plugin that has `add.event` enabled, the iframe "Formularz nowego wydarzenia" renders under "Nowe wydarzenie".
    3. No plugin, or a disabled one → the fallback and its back link.
    4. A `done` `MessageEvent` with `source` = the iframe's `contentWindow` and `origin` = `http://localhost:3004` → the `/add` hub plus the toast "Wydarzenie „Piknik w parku” zapisane".
- **Plugin:** `npm run build` (`tsc -b && vite build`) must pass. Behaviour, including that the copy matches the Copy table, is checked by end-to-end or manual verification against the mockups.
- **Commands:**
  - Backend: `uv run python -m pytest|mypy|ruff`, from `src/backend`.
  - Frontend: `npm test` and `tsc -p tsconfig.app.json`, from `src/frontend`.

### Standards Compliance
- `standards/backend/models.md`:
  - BaseEntity UUID primary keys, string-backed enum columns.
  - No `relationship()`.
  - Business-key equality on immutable columns only.
  - Cross-context access through one `infrastructure/locations_acl.py` that re-exports `LocationRefResponse`, and the owner's 404-before-403 check.
- `standards/backend/migrations.md`:
  - One revision, 0070.
  - Named `pk_`/`fk_`/`ix_`/`uq_` constraints, `gen_random_uuid()` defaults, a partial unique index.
  - `downgrade()` drops in reverse order, and a downgrade-then-upgrade test covers it.
- `standards/backend/security.md`: `Depends(require_any("EDIT", "mcp:edit"))`, and matrix rows verified by tests.
- `standards/backend/time.md`: `clock.local_now()` through the module attribute, naive Warsaw times, clock-guard coverage. `withdrawn_at` is naive UTC.
- `standards/backend/api.md`: plural `/api/events`, sub-resource `/banner`, 201 on create.
- `standards/global/error-handling.md` and `validation.md`:
  - Specific Polish messages, with the server as the authority.
  - Inline client feedback.
  - Submit is blocked while invalid, here through `aria-disabled` so the hint can be reached.
- `standards/global/minimal-implementation.md`: create-only, no `banner` key, no resize protocol. One deliberate exception: `event_attendances`, created ahead of its follow-up by user decision.
- `standards/backend/plugin-auth.md`: the host injects the JWT.
- `standards/frontend/data-fetching.md`:
  - The `usePlugins` hook uses a prefix key.
  - `onDone` invalidates the `LOCATIONS_KEY` prefix after the plugin may have created a place.
- `standards/frontend/components.md`: `resolveEventCreateView` lives in `*ViewState.ts` and is table-tested.
- `standards/frontend/accessibility.md`:
  - Labels; `role="alert"` with `aria-invalid` and `aria-describedby`.
  - `aria-disabled` plus a hint for blocked actions, native `disabled` only while busy.
  - The modal sheet traps focus, closes on Esc and returns focus; buttons have `type="button"`; the iframe has a Polish title.
- `standards/frontend/css.md` and `responsive.md`: tokens mirrored from the host, mobile-first.
- `standards/testing/backend-testing.md`:
  - 8 + 5 + 2 tests across three features.
  - Exact key sets, `freeze_local_now`, and the `test_<operation>_<scenario>_<expected>` naming.
- `standards/testing/frontend-testing.md`: `vi.mock` for API modules, `createQueryWrapper`.
- CLAUDE.md secrets rule: the docs and curl use only `<admin-token>` placeholders; no SPACES or JWT values.

## Out of Scope
- An event list, detail page, Meetings feed or organizer-page display.
- Event sign-ups: join/leave endpoints, UI and capacity. Only the `event_attendances` table is created now.
- Editing or deleting events or banners, and admin removal.
- Banner moderation: `ModerationSubjectType`, and the `group-thing-ai` cron and grants.
- Hosting and registering plugins in production: a service, an nginx route, a seed migration, configurable URLs.
- Updating the legacy `src/resources/static/assets/plugin-sdk.js`.
- The EntityId `int` → `UUID` bug at `app/plugin/router.py:39`.
- An iframe resize protocol and a generic `navigate` message.
- Google Places search in the plugin's location form.
- Plugin unit-test infrastructure.
- Restyling `plugin-ui.css`.

## Success Criteria
- **Event created end to end.** After `npm run build:sdk`, a logged-in user creates an event through the plugin with every optional field filled. `events` then holds the caller's `author_party_id` and naive Warsaw times. A chosen banner gives one `APPROVED` row in `event_banners` and two public WebP files.
- **Validation copy matches.** Every rule in Req 3 returns a 400 with the exact Copy-table text. The plugin shows the same text inline before submitting. Clicking the `aria-disabled` submit reveals every field error.
- **Banner endpoint errors.** It returns 404 "Nie znaleziono wydarzenia.", 403 "Możesz dodać baner tylko do swojego wydarzenia.", 409 for storage disabled, and 400 for too large or invalid, in that order. A second upload leaves exactly one banner row and stages one outbox delete.
- **Fallback and compatibility.** Without the plugin, or with it disabled, `/add/event` shows the Polish fallback. Admin plugin pages and product frames behave as before. Existing 403 responses still say "Access denied".
- **`done` and `uploadImage`.** `done` returns the user to `/add` with the toast and invalidates the locations cache. Hosts without `onDone` ignore `done`. `uploadImage` refuses any path, size or MIME type outside its rule.
- **Migration.** 0070 creates and drops all three tables cleanly. `event_attendances` enforces one active sign-up per party per event.
- **Checks pass.**
  - All new tests pass.
  - ruff and mypy stay at or below the HEAD baseline.
  - The frontend `tsc` and lint pass.
  - `plugins/events` builds.
  - `plugins/CLAUDE.md` documents `add.event`, `uploadImage`, `done`, the SDK build step, all four ports, and the placeholder registration curl.

## Audit Resolutions
| Finding | Resolution |
|---|---|
| H1 SDK build/serve | `build:sdk` also copies the bundle to `public/assets/plugin-sdk.js` (git-ignored); 5173 serves it; step documented in `plugins/CLAUDE.md`; legacy copy out of scope (Req 13, 21) |
| M1 disabled vs aria-disabled | User decision: `aria-disabled` + `aria-describedby` hint; a click reveals all errors; native `disabled` only while saving (Req 18, 19) |
| M2 banner error copy | The backend returns Polish 404/403 (`EventNotFound`, `NotEventAuthor`, `public_message`); the plugin has one error mapper per call (Req 4, 6, 17) |
| M3 retry race | The event row is locked `FOR UPDATE` before the previous-banner lookup; the unique constraint stays as a backstop (Req 4, Technical Approach) |
| M4 missing copy | start.missing is raised in the service (fields optional in the schema); add-place rules, `maxLength`, place.* copy and the `locationError` mapping are defined (Copy table, Req 3, 17, 19) |
| L1 table count | Req 1 says "creates three tables" |
| L2 5 MB ordering | The size check runs in the service after the 404/403/409 checks (Req 4.4) |
| L3 ACL re-export | `LocationRefResponse` is re-exported by the events ACL (Req 5) |
| L4 wording drift | banner.disabled uses the avatar text; banner.invalid uses `INVALID_IMAGE_MESSAGE`; the hint says "JPG" (Copy table) |
| L5 stale locations cache | `onDone` invalidates `[LOCATIONS_KEY]` (Req 15) |
| L6 react-refresh export | The resolver moves to `plugins/resolveExtensionPoints.ts` (Req 9) |
| L7 AppPage test prerequisites | `vi.mock("../api/plugins")`; MessageEvent `source`/`origin` spelled out (Testing Approach) |
| L8 test gaps | Added: aware datetime, missing start, classifier 503, blank description → null, MIME rejection, listener removal on unmount; copy parity checked by e2e against the Copy table |
| L9 test volume | Split into `test_events.py` (8) and `test_event_banners.py` (5), each within 2–8 |
| L10 docs details | Ports include 3003; the curl has a placeholder admin Bearer header; `../../sdk` vs `../../../sdk` import paths (Req 16, 21) |
| L11 empty-form prefill | User decision: blank date and time; the end shares the start's date; the mockup prefill is illustrative (Req 18, Visual Design) |
| L12 traceability, clock-guard name | `event_attendances` added to `analysis/requirements.md`; the test is renamed `test_guardedPackages_noHostClockCalls` |
| L13 business keys | `EventAttendance` on `(event_id, party_id, created_at)`; `Event` on `(author_party_id, created_at)`; immutable columns only (Req 2) |
| L14 date edge cases | End must be after the start and on the same day (an end of 00:00 is not allowed; the latest end is 23:59); naive wall clock, no DST adjustment; start ≤ now + 730 days (start.tooFar); seconds truncated; confirmation format without an end defined (Req 3, 20) |
