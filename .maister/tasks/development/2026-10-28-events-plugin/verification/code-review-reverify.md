# Code Review Re-verification (cycle 2)

**Date**: 2026-10-28
**Path**: events plugin verification fixes (cycle 1)
**Scope**: changed areas only (all categories)
**Status**: ✅ Clean (all targeted findings resolved; 0 critical, 0 warning, 4 info)

## TL;DR
- All 5 targeted findings are resolved: code-review W1, W3 and I8 (plus I1 and I10, fixed as a side effect), pragmatic W3, and doc item 8.
- No new critical issues or warnings. There are 4 new or residual info items, all low-risk follow-ups.
- Targeted tests re-run: `test_event_banners.py` 7/7, `plugin-sdk.test.ts` + `plugins.test.tsx` 35/35.
- The docs contain no secrets: the token is a `<admin-token>` placeholder, the password is only pointed to (in the migration docstring) and never copied, and `admin@localhost` is a placeholder.

## Key Decisions
- Accepted the fix for the `pluginId` gate in `EventCreateView` without a dedicated test (see N1). The logic is a one-line guard, and the message-handler tests cover the sender/origin side.

## Open Questions / Risks
- A `201` response with a body the plugin cannot parse still shows the "Spróbuj ponownie" message (`createGeneric`). Users could then create duplicate events (N2). This is unlikely now that parsing is lenient.

## Original findings

| Finding | Verdict | Evidence |
|---|---|---|
| CR W1: new banner files orphaned when the 2nd `put` fails | Resolved | `src/backend/app/events/service.py:175-199`: both `put` calls are inside `try`, `stored` collects keys only after each `put` succeeds, the `except` block deletes only `stored`. Test `test_uploadBanner_thumbPutFails_deletesStoredLargeKeepsOldBanner` (`tests/test_event_banners.py:207`) asserts that the old banner row stays and that only the old keys remain in storage. It passes. |
| CR I1 (side effect): a cleanup failure masks the original error | Resolved | `service.py:195-199`: an inner `try/except` around `logger.exception`, then a bare `raise` of the original error. |
| CR I10 (side effect): no test for a `put` failure | Resolved | Same new test as W1. A commit failure after both puts is still untested. It goes through the same `except` path, so this is acceptable. |
| CR W3: `done` trusts the payload shape and the sender | Resolved | `PluginMessageHandler.ts:241-249` turns a non-record payload into `{}` (null, array and string all fall back). `EventCreateView.tsx` `onDone` returns early when `pluginId !== readyPluginId` (`view.point.pluginId` when ready, otherwise null), and `readyPluginId` is in the `useCallback` deps. The `it.each` in `plugins.test.tsx:503-523` covers missing, null and string payloads. The origin check is tested at `:468`. |
| CR I8: 10 s timeout on uploads | Resolved | `messaging.ts`: `timeoutMs` parameter with a 10 s default. `host-app.ts`: `uploadImage` passes `UPLOAD_TIMEOUT_MS = 60_000`. `plugins/sdk.ts` and `plugins/CLAUDE.md` document 60 s versus 10 s. A fake-timer test in `plugin-sdk.test.ts` checks that the call has not rejected at 10 s and has rejected by about 60 s. `createEventError(null)` now returns `MESSAGES.createUnconfirmed` (`plugins/events/src/domain.ts:228-229`). |
| PR W3: parsing validates fields nobody reads | Resolved | `toEvent` (`domain.ts:208-217`) reads only `id`, `name`, `starts_at`, `ends_at` (default null) and `location` (default null). `toBanner` reads only `url`. `EventResponse` and `EventBannerResponse` are trimmed to match. `SavedCard.tsx` reads exactly these fields. |
| Item 8: docs | Resolved | `architecture.md` has a new `## Events (app/events/)` section plus a tree entry, and it describes the new cleanup semantics accurately. The `INDEX.md` architecture line is updated. `plugins/CLAUDE.md` adds the build:sdk step, a multi-line curl with an `Authorization: Bearer <admin-token>` placeholder, the `events` plugin id and port 3004, npm install, failure symptoms, and `add.event`/`uploadImage`/`done` docs. **No secret values are present**: the dev password is only referenced ("password in that migration's docstring"), and the token is a placeholder with the warning "Never commit or paste a real token". |

## Critical Issues
None.

## Warnings
None.

## Informational (new or residual)

| # | Location | Category | Fixable | Finding / suggestion |
|---|---|---|---|---|
| N1 | `src/frontend/src/pages/add/EventCreateView.tsx` (`onDone` guard `pluginId !== readyPluginId`) | testing | true | No test checks that a `done` message from a different registered plugin iframe is ignored by the page. The `AppPage.test.tsx:3083-3111` tests only send from the events plugin. Add one row in which a second plugin posts `done` and the toast and navigation do not happen. |
| N2 | `plugins/events/src/domain.ts:289-292` | UX / robustness | true | When `status === 201` but `toEvent` returns null (unparseable body, or a malformed `location`), `createEventError(res)` falls to the `default` branch and shows `createGeneric` ("Spróbuj ponownie"). The event does exist, so a retry creates a duplicate. Map a 201 that fails to parse to `MESSAGES.createUnconfirmed`. |
| N3 | `plugins/events/src/domain.ts:214-215` | robustness | true | A `location` that is present but malformed rejects the whole event (`return null`), which then leads to N2. Since `location` is optional for display, degrading to `location: null` would be gentler. |
| N4 | `src/frontend/src/plugins/PluginMessageHandler.ts:235-238` | security hygiene | true | Pre-existing, not a regression. `filterChange` still passes the raw `payload` to `onFilterChange`. The original W3 recommendation suggested the same normalization there. Apply the same `isRecord ? payload : {}` guard for consistency. |

## Metrics
- Max function length in changed code: `set_event_banner` about 62 lines (unchanged length class; acceptable)
- Max nesting depth: 3
- Potential vulnerabilities: 0
- N+1 query risks: 0

## Prioritized Recommendations
1. N2 + N3: treat a 201 with an unparseable body as `createUnconfirmed`, and degrade a malformed `location` to null (about 5 LOC).
2. N1: add the cross-plugin `done` test row.
3. N4: normalize the `filterChange` payload as well.
