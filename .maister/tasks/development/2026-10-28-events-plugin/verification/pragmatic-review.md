# Pragmatic Review: Events Plugin

## TL;DR
- Status: Appropriate. Complexity mostly fits a small-team app, with a few minor speculative bits. 0 critical, 3 warning, 7 info.
- The backend vertical (`app/events`, about 330 LOC plus migration 0070) is lean and follows the module, ACL, clock and outbox conventions without extra layers.
- The host plugin bridge additions (`uploadImage`, `done`, `usePluginMessageHandler`, `resolveExtensionPoints` extraction, `usePlugins`) are small and justified.
- Main simplification candidates: two different mechanisms for Polish 404/403 texts that the plugin flow almost cannot reach, a one-entry "rules table" for uploads, and the plugin parsing fields it never uses.
- No dead code of consequence. No double message-handler install (`PluginProvider` only wraps `/admin`).

## Key Decisions
- Not flagged (explicit user decisions): the `event_attendances` table with no readers or writers, the 1:1 `event_banners` table with a `status` column, and the new `add.event` extension point.
- Accepted as mandated by standards, not over-engineering: the `infrastructure/locations_acl.py` ACL, the business-key `__eq__`/`__hash__`, the per-module `_enum_column` copy (10 modules already do this), and `usePlugins` as a TanStack hook alongside the legacy `PluginProvider`, which serves only the admin tree.

## Open Questions / Risks
- `test_events.py` has 9 tests, which is just over the 2–8 per-feature guideline. Acceptable, but say so if the team wants the guideline followed strictly.
- The same validation rules and Polish texts live in 2–3 places: `service.py`, plugin `domain.ts`, and the host `UPLOAD_IMAGE_RULES` (5 MB and MIME types). This is unavoidable across a separately bundled plugin, but they can drift apart. A comment on each side is the cheapest guard (`domain.ts:6` already has one).

---

## 1. Complexity Assessment

| Area | LOC | Assessment |
|---|---|---|
| `src/backend/app/events/` (service/router/schemas/models/acl) | ~470 | Low–Medium, appropriate |
| `alembic/versions/0070_events.py` | 113 | Appropriate (3 tables, one by user decision) |
| Host plugin bridge (`PluginMessageHandler.ts` +~80, `usePluginMessageHandler.ts` 22, `resolveExtensionPoints.ts` 34 (moved), `usePlugins.ts` 32, `extensionPoints.ts` +2, `PluginFrame.tsx` +3) | ~170 net new | Low, appropriate |
| Host page (`pages/add/EventCreateView.tsx` 96, `eventCreateViewState.ts` 24) | 120 | Low. The view-state split follows the components standard. |
| Plugin `plugins/events/src` (domain 325, page 287, 5 components ~510, styles 499) | ~1620 | Medium. Mostly UI and a11y that the spec requires. Custom CSS is needed because the iframe cannot use the host's Tailwind. |

Project scale: an early-stage production app for a small team. Overall complexity is proportionate. There is no new infrastructure, no new backend dependency and no new abstraction layer.

## 2. Key Issues Found

### Warning

**W1. Two different mechanisms for user-facing 404/403 texts.** Evidence: `src/backend/app/events/service.py:52-61`, `src/backend/app/core/errors.py:58,136`.
- `EventNotFound` overwrites `self.args` after `super().__init__`, a hack that no other module uses.
- `NotEventAuthor` uses a new `public_message` class attribute that needs a shared change to `errors.py`.
- So two styles were added for the same need in the same file.
- In the plugin flow, banner upload happens right after the author creates the event, so 403/404 are practically unreachable from the UI. The only consumer is `bannerError` (`plugins/events/src/domain.ts:255-262`).
- Recommendation: use one style. Either give `EntityNotFoundException` the same optional `public_message` (and drop the `args` override), or drop both custom texts and let the generic envelopes stand. Effort: 15 min.

**W2. Single-entry "rules table" for plugin uploads.** Evidence: `src/frontend/src/plugins/PluginMessageHandler.ts:22-35,86-103`.
- `UploadImageRule` and `UPLOAD_IMAGE_RULES[]` with a `.find()` exist for one endpoint. This generalizes for future upload endpoints that nobody asked for (minimal-implementation standard).
- The host size and MIME checks are the security boundary, so they should stay.
- The `url.includes("..")` check at line 88 is redundant with the anchored regex. It is harmless, but it duplicates the throw message.
- Before/after:
  ```ts
  // before: interface + array + find
  // after
  const BANNER_UPLOAD_URL = /^\/api\/events\/<uuid>\/banner$/i;
  const BANNER_MAX_BYTES = 5 * 1024 * 1024;
  const BANNER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
  if (typeof url !== "string" || !BANNER_UPLOAD_URL.test(url)) throw ...
  ```
- Impact: about 8 fewer LOC and no speculative extension point. Effort: 10 min. Optional: an array is defensible if a second upload endpoint is near-term.

**W3. Plugin response parsing validates fields nobody reads.** Evidence: `plugins/events/src/domain.ts:45-59,210-232`.
- `toEvent` requires `created_at`/`updated_at` as strings, and `toBanner` requires `status`. None of these is used by any component (grep shows no consumers).
- So a harmless backend shape change (for example, dropping `updated_at` from the response) would turn a successful save into "Nie udało się zapisać wydarzenia", and the user would retry and create a duplicate event.
- Recommendation: parse only `id`, `name`, `description`, `starts_at`, `ends_at`, `location` and `url`. Drop the unused fields from `EventResponse`/`EventBannerResponse`. Impact: about 10 fewer LOC and a less brittle success path. Effort: 10 min.

### Info

**I1. `react-router-dom` for a single route.** Evidence: `plugins/events/src/main.tsx:3,13-17`, `plugins/events/package.json:15`. One `<Route path="/">` means the router does nothing. Rendering `<EventCreatePage />` directly removes a runtime dependency and 4 LOC. Other plugins (`box-size`, `warehouse`) have 3–4 routes, so copying their scaffold explains it. Effort: 5 min.

**I2. Duplicated `.then/.catch` response plumbing.** Evidence: `src/frontend/src/plugins/PluginMessageHandler.ts:260-292`. The new `uploadImage` branch was folded into the `pluginFetch` branch with a ternary, but the block is still an identical copy of the `handleApiMessage` branch below it. Recommendation: a small `respond(promise)` helper would remove about 15 LOC. The duplication is pre-existing and only grew slightly. Effort: 10 min.

**I3. Inline response type repeated three times.** Evidence: `src/frontend/src/plugin-sdk/host-app.ts:37-47`, `plugins/sdk.ts:52-56`. `{status; headers; body}` is written out again for `uploadImage`. A shared `HostFetchResponse` type alias would remove it. Cosmetic.

**I4. Portal and propagation-stopping span copied from the host's picker-in-form rule.** Evidence: `plugins/events/src/components/LocationSheet.tsx:81-83`. Inside the plugin every sheet button is already `type="button"`, so the portal plus `stopPropagation` span adds little. Keeping it matches the host a11y standard, so this is only a note. No action needed.

**I5. `ix_event_attendances_event_id` on an unused table.** Evidence: `src/backend/app/events/models.py:106`, `0070_events.py:239`. It is reasonable because the partial unique index does not cover withdrawn rows, and it mirrors `TermAttendance`. It is noted only because it adds a second index to a table with no readers yet. Keeping it is fine, given the user's decision about the table.

**I6. Decorative disabled button on the progress screen.** Evidence: `plugins/events/src/components/SaveProgress.tsx:44-48`. A permanently disabled "Zapisywanie…" button repeats the `role="status"` steps above it. It costs little, and if it comes from the mockup, keep it.

**I7. `FRAME_STYLE` magic height.** Evidence: `src/frontend/src/pages/add/EventCreateView.tsx:17-19`. `calc(100dvh - 240px)` hard-codes the chrome height. The comment explains it, but it breaks silently if the header or nav sizes change. Acceptable for now.

## 3. Developer Experience
- Positive: the backend service is linear and readable. Validation runs in Copy-table order with clear constants. The router is thin.
- Positive: `usePluginMessageHandler` with its latest-options ref is a small, correct hook, and it lets any page host a plugin flow without touching `PluginProvider`.
- Positive: moving `resolveExtensionPoints` out of `PluginContext.tsx` is a pure move that two callers now share. No new abstraction.
- Friction: the `build:sdk` script (`src/frontend/package.json`) embeds a `node -e` copy one-liner. It works, but it is hard to read. Moving it into a 5-line `scripts/copy-sdk.mjs` would be clearer. Low priority.
- Friction: the Polish copy is duplicated between `service.py` and `domain.ts` (see Open Questions).

## 4. Requirements Alignment
- The implementation matches the described scope: create an event (name, start, optional same-day end, optional saved location, description), an optional banner with retry or skip, a `done` handoff with a toast, and a fallback when the plugin is unavailable.
- No feature inflation found. There is no editing, listing or attendance API (attendances are deliberately schema-only).
- The `END_OTHER_DAY_MESSAGE` rule exists only on the backend. The plugin cannot produce a different day because the end reuses the start date. Server-only defense is fine.

## 5. Context Consistency
- Inconsistent error-message mechanism (W1).
- No unused private functions found in `app/events`. Every helper in `domain.ts` has a consumer. `usePlugins().refetch` is used only by tests, but the data-fetching standard's hook shape requires it.
- `PluginProvider` (legacy `useState`/`useEffect`) and `usePlugins` (TanStack) now both fetch `/plugins`, but in disjoint route trees (`/admin` versus the panel). Consolidating them is a separate refactor and is out of scope.
- No double `message` listener: `PluginProvider` is mounted only under `/admin` (`src/frontend/src/router.tsx:55-61,190-195`), so `/add/event` has exactly one handler.

## 6. Recommended Simplifications (Top 3)
1. **Unify or drop the custom 404/403 texts (W1).** Use one mechanism (`public_message` on the base exceptions) or none. That removes the `self.args` hack. About 5–10 LOC.
2. **Parse only consumed response fields in the plugin (W3).** Removes the brittle-success failure mode and about 10 LOC.
3. **Collapse `UPLOAD_IMAGE_RULES` to constants and drop `react-router-dom` from the plugin (W2, I1).** About 12 LOC and one runtime dependency removed.

## 7. Summary Statistics

| Metric | Current | After simplifications |
|---|---|---|
| Error-message override mechanisms | 2 | 1 (or 0) |
| Plugin runtime deps | 3 (react, react-dom, react-router-dom) | 2 |
| Speculative generic structures | 1 (`UploadImageRule[]`) | 0 |
| Estimated LOC removed | — | ~35–45 |

## 8. Conclusion
The feature is pragmatically built for its scale. There are no critical issues. The three warnings are small cleanups (about 35–45 min in total) that remove inconsistency and a brittle success path, not structural over-engineering. None of them blocks merging.
