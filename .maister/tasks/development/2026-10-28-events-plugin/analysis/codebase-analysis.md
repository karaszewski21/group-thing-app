# Codebase Analysis Report

**Date**: 2026-10-28
**Task**: Events (wydarzenia) plugin hosted in an iframe at `/add/event`
**Description**: Create an "events" (wydarzenia) plugin. The page /add/event must host the plugin in an iframe, like other plugins (e.g. warehouse). Simple events: banner image, name, start date, optional end time, description. Must be separate from Term.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Pattern Mining)

---

## TL;DR
`/add/event` is a mock host form (`EventCreateView.tsx`, no backend). Plugins today are reachable only under `/admin` (the `PluginProvider` and postMessage handler are mounted only in the admin Layout). Copying the warehouse plugin pattern gives you storage (`plugin_objects` JSONB), but the **banner image** has no path: the SDK can't send files, there is no generic upload route, and every user image has to go through moderation. Events have no group, attendance or RSVPs, so they are a separate concept from Term. The real choice is between a pure plugin (JSONB) and a plugin UI on top of a small host-native `app/events` context.

## Key Decisions
- **Build a new `plugins/events` (Vite+React19, port 3004) by copying warehouse** — this is the only existing recipe (plugins/CLAUDE.md). There is no scaffolding.
- **Replace the body of `EventCreateView` with a `PluginFrame` modeled on `PluginPageRoute`**, inside the panel `SubPageHeader` chrome. Mount the plugin message handler (or `PluginProvider`) for the panel route, since it is admin-only today.
- **Do not reuse Term** (`app/groups/models.py:189`). Do reuse its date conventions: naive Warsaw wall-clock, `clock.local_now()` for past-date checks.
- **Banner upload must go through the host and be moderated.** Model it on `OrganizationMedia` COVER (`organizations/media.py`) or ProfileAvatar. Never store base64 in JSONB.
- **Storage option B (host-native `app/events` context, with the plugin calling `/api/events` via `hostApp.fetch`) fits better than option A (pure `plugin_objects`).** B gives an owner column, `check_text` moderation, date sorting/filtering, and a natural FK to a moderated banner row. This needs confirmation from the user.

## Open Questions / Risks
- **Storage model (A vs B)**: `plugin_objects` has no owner column, so any EDIT principal (every regular user) can list, overwrite or delete every event. It also has no text moderation and no sorting or date filters.
- **Banner transport**: either (a) add a new SDK message that posts a File/Blob via structured clone, with the host building the FormData and calling the upload route, or (b) the iframe calls the API directly with `getToken()`, which needs CORS for the plugin origin (`CORS_ALLOWED_ORIGINS`). (a) is the safer choice.
- **Moderation**: a new `ModerationSubjectType` plus an admin-queue union branch (`moderation/service.py:97-154`) is needed. The VPS B ShieldGemma cron (separate repo `group-thing-ai`) needs grants/REQUIRED_PRIVILEGES for the new table. That is cross-repo work. Without it, this would be the first unmoderated user image.
- **No resize, navigate or close protocol** between iframe and host. A plugin form can't size itself or go back to the hub after saving. The message handler rejects unknown types (`PluginMessageHandler.ts:153-154`).
- **Existing bug**: `app/plugin/router.py:39` declares `EntityId = Annotated[int | None, ...]` while the model and service use `uuid.UUID`, so a UUID `entityId` returns 422. Fix it if you use the objects listing.
- **Dev/deploy friction**: plugin `index.html` hardcodes `http://localhost:5173/assets/plugin-sdk.js`. `plugin-sdk.js` only appears after `build:sdk`. Plugins are not Docker services and are registered manually (curl PUT manifest). There is no seed migration. The deployed URL and registration story for events is undefined.
- **Should the plugin also own listing/display of events** (a feed or detail page)? The task only says create. That affects the extension points and whether `ExtensionPointType` (a closed union of 4) needs a new slot such as `add.event`.
- **Styling mismatch**: `plugin-ui.css` `tc-*` classes use the old TomorrowCommerce slate/blue palette, which is foreign to the host's Tailwind tokens. An iframe page will look inconsistent unless restyled.

---

## Summary

The host already has an iframe plugin system: `PluginFrame`, an origin-checked postMessage handler with token and `/api/`-only fetch proxying, and a generic `plugin_objects` JSONB store. But it is wired only into `/admin`, and it supports only string-body fetches. `/add/event` is currently a host-rendered mock with reusable Polish copy. The work splits into: (1) host plumbing to embed a plugin in the panel at `/add/event`; (2) the `plugins/events` app; (3) a persistence plus moderated banner-upload path, which is the hardest and riskiest part.

---

## Files Identified

### Primary Files

**src/frontend/src/pages/add/EventCreateView.tsx** (171 lines)
- Mock event form (name, date, time, place, description; "MOCK: the backend has no events yet").
- Will be replaced by a PluginFrame host. Its Polish copy and validation text are reusable inside the plugin.

**src/frontend/src/pages/home/AppPage.tsx** (125 lines)
- Line ~105 renders `{view === "add/event" && <EventCreateView />}`. Panel views have no PluginProvider.

**src/frontend/src/router.tsx** (220 lines)
- `PANEL_VIEWS` (lines 39-53, `add/event` at 51). Admin Layout with PluginProvider at 55-62.

**src/frontend/src/plugins/PluginFrame.tsx** (77 lines)
- Iframe host. Context goes through `iframe.name` and the hash with RENDER/PRODUCT_DETAIL prefixes. Sandbox: scripts, same-origin, forms, popups, modals, downloads. `src` is set once. Inline `contextData` re-runs the registration effect, so memoise it.

**src/frontend/src/plugins/PluginContext.tsx** (113 lines)
- `PluginProvider`: GET /api/plugins, resolves extension points (28-48), installs the global message handler. Admin-only today.

**src/frontend/src/plugins/PluginMessageHandler.ts** (236 lines)
- Prefix, source and origin checks (162-179). `pluginFetch` (43-95): `/api/` only, no `..`, credentials omitted, Bearer + `X-Requested-With: PluginFetch` injected, string body, `response.text()`. `getToken` at 190. This is where new message types go (upload, resize, navigate).

**src/frontend/src/pages/admin/PluginPageRoute.tsx** (39 lines)
- Reference for a full-page plugin render (`/admin/plugins/:pluginId/*`, minH `calc(100vh-120px)`).

**plugins/warehouse/** (template; `src/pages/WarehousePage.tsx` 239 lines)
- index.html, manifest.json, package.json, tsconfig.json, vite.config.ts (port 3001, strictPort), src/main.tsx (routes = manifest paths), domain.ts. Uses `objects.list/save("warehouse", crypto.randomUUID(), …)`.

**plugins/sdk.ts** (102 lines), **plugins/CLAUDE.md** (396 lines)
- Browser SDK types/getSDK. Import it via `../../sdk`; never copy it. CLAUDE.md is the authoritative plugin guide (manual manifest registration).

**src/backend/app/plugin/router.py** (198 lines), **service.py** (305 lines), **models.py** (88 lines)
- `PluginDescriptor` (string PK, manifest JSONB) and `PluginObject` (unique plugin_id/object_type/object_id, data JSONB, loose entity_type/entity_id). Objects CRUD needs READ/EDIT. A disabled plugin returns 404 (service 96-102). EntityId int bug at router:39. Text moderation only for the shared-description key (service 149-157).

**src/backend/app/organizations/media.py** (550 lines)
- COVER slot media with moderation and outbox deletes. The best model for a banner.

### Related Files

- **src/frontend/src/utils/appHelpers.ts** (189 lines): `View` union including `add/event`.
- **src/frontend/src/pages/add/AddView.tsx** (89 lines): hub tile "Wydarzenie — Jednorazowe: piknik, urodziny".
- **src/frontend/src/plugins/extensionPoints.ts** (10 lines): closed union of 4 types (menu.main, product.detail.tabs, product.list.filters, product.detail.info).
- **src/frontend/src/api/plugins.ts**: plugin API types. **src/frontend/src/api/client.ts:101**: `api.upload(path, FormData)`.
- **src/frontend/src/plugin-sdk/** and **vite.sdk.config.ts**: SDK bundle (context.ts `parseContextString` keeps only `productId` and drops other keys; messaging.ts 10 s timeout, `aj.plugin.` prefix; host-app.ts; this-plugin.ts).
- **src/frontend/src/components/shared/appComponents.tsx** (SubPageHeader, Field, HintCard, ModalSheet), **uiStyles.ts** (BTN_PRIMARY, FIELD, ERROR_TEXT, CARD), **utils/dayjs.ts**.
- **src/frontend/src/pages/product/ItemGalleryEditor.tsx**, **pages/profile/ProfileView.tsx**: image upload UI patterns.
- **src/frontend/src/pages/product/ProductDetailPage.tsx:181**: hard-coded 60px plugin frame height (evidence that there is no resize protocol).
- **src/backend/app/storage/service.py**, **storage/images.py** (70 lines), **storage/outbox_listener.py**: ObjectStorage/SpacesStorage (`get_storage()` returns None unless the SPACES_* env vars are set), `process_upload` (JPEG/PNG/WebP, 15MB, 50MP guard, EXIF strip, WebP 1600/400, sha256), OBJECTS_DELETE outbox.
- **src/backend/app/users/router.py:84-96, users/service.py:152-195**: avatar upload. The cleanest small template (`avatars/{profile.id}/{id}`). users/service.py:64 grants regular users READ+EDIT.
- **src/backend/app/moderation/** (models.py:22-26 `ModerationSubjectType`; service.py 97-154 admin queue; text_guard.check_text; rules.py).
- **src/backend/app/groups/models.py:189, groups/router/terms.py**: Term. Do not reuse.
- **src/backend/app/main.py** (routers 152-167, CORS default at 138), **app/core/authorization_matrix.py** + **tests/test_authorization_matrix.py**.
- **src/backend/alembic/versions/0069_vinted_categories.py**: latest revision (next is 0070).
- **src/backend/app/organizations/slugs.py**: RESERVED_SLUGS already includes "add".
- **nginx.conf** (/api/ proxy 16MB, no CSP/frame-src), **vite.config.ts** (5173, proxy /api to 8080), **docker-compose.yml** (no plugin services; MODERATION_IMAGE_ENABLED).

---

## Current Functionality

`/add/event` renders the host-native mock `EventCreateView`, which saves nothing and shows "Wydarzenie zapisane". There is no events backend.

Plugin flow (warehouse):
1. `manifest.json` is PUT manually to `/api/plugins/{id}/manifest` (PLUGIN_MANAGEMENT or ADMIN).
2. In `/admin`, `PluginProvider` lists plugins and resolves extension points. The Sidebar shows menu items, which lead to `PluginPageRoute`, which renders `PluginFrame`.
3. The plugin page loads the host `plugin-sdk.js` and `plugin-ui.css`.
4. It parses its context from `window.name` or the hash, then talks over postMessage (`getToken`, `pluginFetch`, `objects.*`).
5. The host handler validates origin and source, and takes `pluginId` from the registry (not from the payload).

### Key Components/Functions
- **PluginFrame**: iframe and context injection.
- **createMessageHandler / iframeRegistry**: postMessage bridge. Handles filterChange, getToken, pluginFetch and API types; rejects unknown types.
- **this-plugin `objects.list/save/remove`**: wraps `/api/plugins/{id}/objects/{type}/{objectId}`.
- **query_service DSL**: `filter=jsonPath:op:value` (eq/gt/lt/exists/bool), single-level path, no sorting, limit 1000.
- **process_upload / ObjectStorage.put**: image pipeline. Presigned GET only.
- **check_text(TextField.X, new, current)**: text moderation (400 reject, 503 unavailable).
- **clock.local_now()**: Warsaw "now" for past-date validation.

### Data Flow
Plugin iframe → postMessage → host handler (adds Bearer) → `/api/plugins/events/objects/event/{uuid}` (option A) or `/api/events` (option B) → PostgreSQL. The banner would go: iframe File → postMessage (structured clone) → host FormData → upload route → `process_upload` → Spaces + moderation row (PENDING until the VPS B cron decides).

---

## Dependencies

### Imports (What This Depends On)
- Plugin SDK (`plugins/sdk.ts`, `plugin-sdk.js` bundle): host messaging.
- `app/plugin` objects API or a new `app/events` API: persistence.
- `app/storage` + `app/moderation`: banner and text safety.
- `app/core/clock`: dates. `authorization_matrix`: route permissions.
- Plugin deps: react ^19.2.4, react-router-dom ^7.13.2, vite ^8, typescript ~5.9.3.

### Consumers (What Depends On This)
- **AppPage.tsx**: renders the add/event view.
- **router.tsx / appHelpers.ts**: route and View union.
- **AddView.tsx**: hub tile link.
- **AppPage.test.tsx** (~2969, 3015-3036): asserts the mock form ("Zapisz wydarzenie", "Wydarzenie zapisane"). Must be rewritten.
- **Plugin infra consumers** (admin Layout, ProductDetailPage, Sidebar): affected if PluginProvider or the handler is moved or extended.

**Consumer Count**: about 6 files
**Impact Scope**: Medium. The view swap is local, but changes to the plugin host and message handler touch shared admin and product-detail plugin rendering.

---

## Test Coverage

### Test Files
- **src/frontend/src/test/AppPage.test.tsx**: /add/event mock form cases (to replace).
- **src/frontend/src/test/plugins.test.tsx, plugin-sdk.test.ts, plugin-sdk-auth.test.ts, extension-points.test.tsx**: host plugin infra.
- **src/backend/tests/test_plugin_admin_gating.py**: manifest/admin gating.
- **src/backend/tests/test_authorization_matrix.py**: matrix rows (new `/api/events` rows if B).
- Plugins: only ai-description has tests (jest). Warehouse and box-size have none.

### Coverage Assessment
- **Test count**: not enumerated by the agents. The plugin infra has dedicated suites.
- **Gaps**: no tests for the objects API with UUID `entityId` (which hides the router:39 bug); no Vite-plugin test setup to copy; no tests exist for upload via postMessage, panel-hosted plugins, or resize/navigate messages, because those are new.

---

## Coding Patterns

### Naming Conventions
- **Plugins**: `plugins/<kebab-id>/`, package `<id>-plugin`, `"type": "module"`, id `^[a-zA-Z0-9_-]+$`, manifest url port matches the vite strictPort.
- **Components**: PascalCase `*View.tsx` / `*Page.tsx`. Hooks in `src/hooks/` wrapping `src/api/*.ts` (TanStack Query).
- **Backend**: `app/<context>/{models,schemas,service,router}.py`. Larger contexts add `application/` + `infrastructure/*_acl.py`.
- **Tests**: `tests/test_<feature>.py`; frontend `src/test/*.test.tsx`.

### Architecture Patterns
- **Style**: functional React; plugins are standalone SPAs with routes = manifest paths, a `tc-plugin` root, and try/catch around every SDK call.
- **State Management**: host uses TanStack Query; plugins use local state.
- **Backend**: SQLAlchemy 2.0 `BaseEntity` (UUID id, optimistic locking), Alembic with named constraints, `Depends(require_any(...))` authorization, user-facing text in Polish.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~10-15 files touched/created (new plugin ~8 files + host 4-6, + backend if B) | High |
| Dependencies | plugin SDK, plugin API, storage, moderation, clock, authz | Medium-High |
| Consumers | ~6 | Medium |
| Test Coverage | Host plugin infra covered; plugins/uploads-via-iframe untested | Medium |

### Overall: Complex

The form itself is simple. The complexity comes from three new cross-cutting capabilities: a plugin host outside admin, file transport over postMessage, and moderated banner storage. That last one may need cross-repo VPS B changes.

---

## Key Findings

### Strengths
- A working, origin-checked iframe and postMessage infrastructure and a JSONB object store already exist.
- Mature image pipeline (`process_upload`) and moderated media precedents (OrganizationMedia COVER, avatars).
- Polish copy and validation messages already exist in the mock view.

### Concerns
- The plugin host is admin-only.
- `plugin_objects` has no ownership and no text moderation.
- The SDK has no binary or upload support.
- There is no iframe resize or navigation protocol.
- The EntityId type bug.
- SDK URLs are hardcoded to localhost:5173.
- Plugin styling uses an outdated palette.
- Warehouse code smells that shouldn't be copied: getSDK per handler, sequential save loop, unchecked casts, inline styles. Leftover junk not to copy: `ai-description/.env`, tsbuildinfo, `.playwright-mcp`.

### Opportunities
- Add generic host messages (`resize`, `navigate`/`done`, `uploadImage`) once, so every future plugin benefits.
- Move or extend `PluginProvider` to the panel layout, which makes plugins first-class outside admin.
- Fix the EntityId bug along the way.

---

## Impact Assessment

- **Primary changes**:
  - New `plugins/events/*`
  - `EventCreateView.tsx` (becomes a PluginFrame host) or `AppPage.tsx:105`
  - `PluginMessageHandler.ts` (new messages)
  - `PluginContext.tsx` / `router.tsx` (provider scope)
  - `plugin-sdk/*` (upload, resize, navigate APIs)
- **Related changes**: `extensionPoints.ts` (if a new slot is added), `plugins/sdk.ts` types, `plugins/CLAUDE.md` docs, `app/plugin/router.py:39`.
  - Option B additionally needs: `app/events/*`, migration 0070, `main.py`, `authorization_matrix.py`, moderation subject type + queue.
  - Cross-repo: `group-thing-ai` grants.
  - CORS only if direct calls from the iframe are chosen.
- **Test updates**:
  - Rewrite the AppPage.test.tsx /add/event cases.
  - Extend plugins.test.tsx and plugin-sdk tests for the new messages.
  - Backend tests for the events API/upload and matrix rows (B), or for UUID `entityId` (A).

### Risk Level: Medium-High

- Shared plugin host code is modified.
- A new user-image ingestion path carries a moderation/safety risk.
- There is no ownership model if the pure-plugin storage is chosen.
- Cross-repo moderation dependency.
- Manual plugin registration and deployment.

---

## Recommendations

**Creating new capability (with modification of shared plugin infra):**

1. **Host embedding**:
   - Replace the `EventCreateView` body with `SubPageHeader` + memoised `PluginFrame` (pattern from `PluginPageRoute`).
   - Resolve the events plugin by id through a `PluginProvider` mounted for the panel, or by a lightweight lookup plus a handler installed for panel routes.
   - Show a Polish fallback when the plugin is missing or disabled (404).
2. **Plugin app**:
   - Copy warehouse into `plugins/events` (port 3004, package `events-plugin`), importing `../../sdk`.
   - Single create route with fields: name (required), start date and time (required, not in the past via Warsaw-local comparison), optional end time (must be after the start), description, banner.
   - Reuse the mock's Polish copy. Avoid the warehouse smells listed above.
3. **Persistence (recommended B)**:
   - A small `app/events` context: `events` table with BaseEntity, `author_id`, name, `starts_at` / `ends_at` naive Warsaw, description checked via `check_text`, `banner_media_id` FK.
   - `/api/events` routes plus matrix rows and tests.
   - The plugin calls it via `hostApp.fetch`.
   - If A is chosen instead: `objects.save("event", uuid, {...})`, fix EntityId, and accept the lack of ownership and moderation (document it as a known gap).
4. **Banner**:
   - Add an SDK message (e.g. `uploadImage`) that posts a File/Blob.
   - The host builds the FormData and calls `api.upload` to a new endpoint modeled on avatar/OrganizationMedia COVER (`process_upload`, `events/{id}/…` key, outbox delete on replace).
   - Add a new `ModerationSubjectType` and an admin-queue branch.
   - Coordinate the VPS B grants in `group-thing-ai`.
   - If image moderation is out of scope, hide banners until they are approved.
5. **UX glue**: add `resize` (or a fixed min-height like PluginPageRoute) and `navigate`/`done` messages, so that after saving the host can route back to the hub or the event.
6. **Testing**:
   - Host: Vitest for the new message types and the /add/event frame render.
   - Backend: pytest for events CRUD, ownership, dates and the upload, 2-8 tests per feature per the standards.
7. Never put SPACES_* or JWT_SECRET values in plugin code or `.env` copies; reference the env var names only.

---

## Next Steps

Invoke the gap-analyzer with this report. Bring the A-vs-B storage decision, the banner transport and moderation scope, and whether the plugin also covers listing/display of events to the user as clarification questions before writing the specification.
