# Code Review Report

**Date**: 2026-10-28
**Path**: uncommitted changes for the events plugin (`git diff HEAD` + untracked; `.maister/` ignored)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## TL;DR
- No critical issues. The postMessage bridge, the upload allowlist and the banner transaction ordering are sound.
- Main defect: the two `storage.put` calls (`app/events/service.py:172-173`) run outside the `try`, so a failed thumb put leaves the large file orphaned.
- The banner upload holds the event's `FOR UPDATE` lock and a DB transaction during Pillow processing and two S3 round trips.
- The host's `done` handler trusts the payload shape and ignores which plugin sent it.
- Everything else is info-level: hygiene, test gaps and copy edge cases the spec accepts.

## Key Decisions
- The spec's choices are treated as intended and not counted as defects: the 403/404 → "create.location" mapping, the fixed 10 s SDK timeout, and running the size check after the 404/403/409 checks. Where they have user-visible downsides, they are listed under Info.
- `getToken` handing the JWT to plugins is the existing documented contract (`standards/backend/plugin-auth.md`), so it is not a finding against this change. The new `uploadImage` path does not expose the token: the header is added host-side and response headers are filtered.

## Open Questions / Risks
- Mobile uploads near 5 MB will often hit the 10 s timeout while the server still stores the banner. The user sees "failed", and "Pomiń baner" then leaves a banner in place anyway. Is that acceptable for v1?
- Do future "my events" or location-delete flows need indexes on `events.author_party_id` / `events.location_id` now, or in a later revision?

## Summary
- **Critical**: 0 issues
- **Warnings**: 3 issues
- **Info**: 13 issues

## Critical Issues
None.

## Warnings

### W1. New banner files orphaned when the second `storage.put` fails
- **Location**: `src/backend/app/events/service.py:172-174`
- **Category**: best_practices / data hygiene, **fixable: true**
- **Description**: `storage.put(large)` and `storage.put(thumb)` run before the `try:`. If the thumb put fails (network error or Spaces 5xx), the exception propagates, the cleanup in `except` never runs, and `w1600.webp` stays in the public bucket with no DB row pointing at it. Nothing reclaims it later.
- **Recommendation**: move both puts inside the `try`. `storage.delete` is a quiet bulk delete, so deleting a key that was never written is harmless:
  ```python
  try:
      await storage.put(banner.large_key, processed.large, "image/webp", public=True)
      await storage.put(banner.thumb_key, processed.thumb, "image/webp", public=True)
      if previous is not None:
          ...
      db.add(banner)
      await db.commit()
  except Exception:
      await db.rollback()
      await storage.delete([banner.large_key, banner.thumb_key])
      raise
  ```
  Add a test that makes the fake storage's second `put` raise and checks that no `events/` keys remain (see I10).

### W2. Row lock and transaction held across CPU-bound processing and remote I/O
- **Location**: `src/backend/app/events/service.py:148-185`
- **Category**: performance, **fixable: false** (ordering/design trade-off)
- **Description**: `db.get(Event, ..., with_for_update=True)` opens the transaction and locks the event row first. The session then holds that lock, and its pooled connection, through `images.process_upload` (Pillow decode plus two WebP encodes of an image up to 50 MP, often hundreds of ms), and then through two sequential `put_object` calls to Spaces. Uploads for the same event are serialised by design, so that part is fine. The cost is that every in-flight upload keeps a pool connection idle-in-transaction for seconds. A non-author also takes the lock before the 403 check. Lock ordering itself is correct: the lock is taken before the previous-banner lookup.
- **Recommendation**: do the 404/403/409/size checks and `process_upload` first, without the lock: a plain `db.get`, then `await db.rollback()` or just no write. Then `SELECT … FOR UPDATE` the event, look up `previous`, and run the puts and commit. Optionally run the two puts concurrently with `asyncio.gather`. The 404→403→409→400 error order is unchanged.

### W3. Host `done` handler trusts the payload shape and the sender
- **Location**: `src/frontend/src/plugins/PluginMessageHandler.ts:242-245`, `src/frontend/src/pages/add/EventCreateView.tsx:21-24, 35-43`
- **Category**: security hygiene / robustness, **fixable: true**
- **Description**: `payload` comes straight from `event.data` and is typed `Record<string, unknown>`, but nothing checks it. A plugin that posts `{requestId, type: "done"}` with no payload (bypassing the SDK, which sends `payload ?? {}`) makes `savedToast` read `payload.name` of `undefined`. That throws an uncaught `TypeError` in the window message listener. `onDone` also ignores `pluginId`, so any registered iframe that passed the origin check could trigger the toast plus navigation, not only the resolved `add.event` plugin.
- **Recommendation**: in the handler, normalise with `const safePayload = isRecord(payload) ? payload : {}` for fire-and-forget types (this also hardens `filterChange`). In `EventCreateView`, act only when `pluginId === view.point.pluginId` (keep `view` in a ref or in the callback deps).

## Informational

| # | Location | Category | Fixable | Finding / suggestion |
|---|----------|----------|---------|----------------------|
| I1 | `src/backend/app/events/service.py:186-189` | best_practices | true | If `storage.delete` raises inside `except`, it replaces the original exception, and the original cause is lost from logs. Wrap the cleanup in its own `try/except` and log the failure (e.g. `logger.exception`) before re-raising the original. |
| I2 | `src/backend/app/events/router.py:63` (file line 252 in combined view: `assert storage is not None`) | best_practices | true | `assert` is stripped under `python -O`. Pass the non-None value back from the service, or use `if storage is None: raise RuntimeError(...)`. Low impact, because the service already refuses the request. |
| I3 | `src/backend/app/events/service.py:52-57` | quality | true | `EventNotFound` overwrites `self.args` after `super().__init__` to change `str(exc)`. It works because the handler uses `str(exc)`, but it is fragile. Use a `public_message`-style attribute, as done for `AccessDeniedException`, or override `__str__`. |
| I4 | `src/backend/alembic/versions/0070_events.py:181-196`, `app/events/models.py:36-49` | performance | true | `events.author_party_id` and `events.location_id` are FK columns without indexes. PostgreSQL does not index FKs automatically, so a future "my events" list or a location/party hard delete will seq-scan. Not needed for the current write-only endpoints. Add the indexes when the first reader lands (`standards/backend/migrations.md` → careful indexing). |
| I5 | `src/backend/app/events/models.py:51-59` | quality | false | Business-key `__eq__`/`__hash__` uses `created_at`, which is `None` until flush, so two transient Events by the same author compare equal. This is consistent with the project pattern; it is noted only because it is surprising. |
| I6 | `src/frontend/src/plugins/PluginMessageHandler.ts:88` | quality | true | The `url.includes("..")` check is redundant: the anchored UUID regex already rejects traversal, query strings and percent-encoding. It is harmless defence in depth. The checks themselves (allowlist regex, `instanceof Blob`, size ≤ 5 MB, MIME allowlist, no plugin-supplied headers, safelisted response headers, `credentials: "omit"`) are correct. MIME is client-asserted, but the backend re-validates by decoding with Pillow restricted to JPEG/PNG/WEBP, with decompression-bomb protection (`app/storage/images.py`). |
| I7 | `plugins/events/src/domain.ts:237-251` | validation / UX | true | Per spec, `createEventError` maps every 403/404 to "Wybrane miejsce jest niedostępne — wybierz inne." That message is misleading when the request had `location_id: null`: a 403 from a missing `EDIT` permission ("Access denied") or a 404 for a missing `UserProfile`. Consider mapping to `create.location` only when `request.location_id !== null`, and to `create.generic` otherwise. |
| I8 | `plugins/events/src/domain.ts:305-309`, `plugins/sdk.ts` (uploadImage doc) | performance / UX | false | The 10 s SDK timeout covers uploads up to 5 MB. On slow mobile links the client reports failure while the server stores the banner. This is documented in `plugins/CLAUDE.md` and spec non-goals, and a retry replaces the banner. A per-type timeout for `uploadImage` would remove most false failures. |
| I9 | `plugins/events/src/domain.ts:285-292` | best_practices | true | `console.error("Host call failed", err)` ships in production plugin code. Acceptable for a plugin with no logger; keep it or route it through a debug flag. |
| I10 | `src/backend/tests/test_event_banners.py` | testing | true | No test covers a storage `put` failure (the W1 path) or a commit failure after both puts. `test_uploadBanner_replaceFails_keepsOldBannerDeletesNewFiles` covers only the outbox-append failure. |
| I11 | `plugins/events/src/components/LocationSheet.tsx:436-445` | accessibility | true | Clicking "Spróbuj ponownie" unmounts the focused button (state → loading), so focus falls to `<body>` inside an `aria-modal` dialog. `trapFocus` recovers on the next Tab, but screen readers lose context. Move focus back to `dialogRef` when `places.kind` changes from `error`. |
| I12 | `src/frontend/src/pages/add/EventCreateView.tsx:19` | quality | true | `calc(100dvh - 240px)` is a magic number tied to host chrome heights. The comment explains it, but it will drift when the header or nav changes. Consider a CSS variable or flex layout. |
| I13 | `plugins/events/src/domain.ts:4` | best_practices | true | `const sdk = getSDK()` runs at module import, so a missing SDK script fails the whole bundle at import time instead of rendering an error state. Acceptable for a plugin, which cannot work without the SDK anyway; resolving it lazily inside `call()` would be gentler. |

### Verified OK (focus areas)
- **postMessage**: source is resolved via `iframeRegistry.findBySource`, origin is checked against the registered plugin URL, and replies go to `event.origin` only. The panel tree has no `PluginProvider`, so `/add/event` installs exactly one listener (`usePluginMessageHandler`) and messages are not handled twice. The listener is removed on unmount, and the latest options are read via a ref.
- **Token**: `uploadImage` adds `Authorization` host-side and never echoes it. Response headers are limited to the CORS-safelisted set.
- **Banner transaction**: `FOR UPDATE` is taken before the previous-banner lookup (`service.py:148` vs `:159`). Delete → flush → `OBJECTS_DELETE` outbox append (`{"keys": [...]}`) → insert → commit all happen in one transaction. Rollback plus deletion of the new files covers DB failures (but see W1). `expire_on_commit=False` (`app/db.py:15`), so reading `banner.large_key` after commit is safe.
- **Authorization**: router uses `require_any("EDIT", "mcp:edit")` for both routes. Matrix rows are added for `POST /api/events` and `POST /api/events/[^/]+/banner`, with no earlier catch-all shadowing, and are covered in `test_authorization_matrix.py`. The author check compares `event.author_party_id` with the caller's profile party. The author is never read from the body (`extra="forbid"`). The `public_message` hook keeps every other 403 at "Access denied".
- **Validation / Polish copy**: backend and plugin Copy-table texts match exactly (`service.py:38-49` vs `domain.ts:7-28`). Code-point length counting matches Python `len()`. Time is read only via `clock.local_now()`, and `app/events` was added to the clock guard test.
- **Queries**: no N+1. Create is profile (2) + owned location + insert + refresh; `_event_response`'s `db.get(Location)` hits the identity map. Banner is lock + profile (2) + previous + writes.
- **React**: the `BannerPicker` object URL is revoked in the effect cleanup, which is StrictMode-safe. The `LocationSheet` fetch uses an `active` flag. The focus trap mirrors `trapFocus.ts`, Esc respects `defaultPrevented`, and the portal wrapper stops click/key propagation into the form. All inner buttons are `type="button"`, and the trigger is a `<button>` with `aria-labelledby`.

## Metrics
- Max function length: ~120 lines of JSX in `EventCreatePage` (`plugins/events/src/pages/EventCreatePage.tsx:54-287`, a component with a view `switch`). The largest backend function is `set_event_banner` at 55 lines.
- Max nesting depth: 4 levels
- Potential vulnerabilities: 0 exploitable (1 robustness item: W3)
- N+1 query risks: 0

## Prioritized Recommendations
1. Move both `storage.put` calls inside the `try` in `set_event_banner` and add a put-failure test (W1, I10).
2. Validate the fire-and-forget payload shape and check `pluginId` in the `done` path (W3).
3. Do image processing (and optionally the 404/403 checks) before taking the `FOR UPDATE` lock; consider parallel puts (W2).
4. Narrow the `create.location` mapping to requests that actually carry a `location_id` (I7).
5. Housekeeping: I1, I2, I3, I11; add FK indexes when readers land (I4).

## Structured Result

```yaml
status: "issues_found"
report_path: "C:\\Users\\karas\\Desktop\\swaptime\\group-thing-app\\.maister\\tasks\\development\\2026-10-28-events-plugin\\verification\\code-review-report.md"
summary: { critical: 0, warning: 3, info: 13, files_analyzed: 38 }
issues:
  - { source: code_review, severity: warning, category: best_practices, location: "src/backend/app/events/service.py:172-174", fixable: true, description: "storage.put calls outside try; failed thumb put orphans the large file", suggestion: "Move both puts inside the try; add put-failure test" }
  - { source: code_review, severity: warning, category: performance, location: "src/backend/app/events/service.py:148-185", fixable: false, description: "FOR UPDATE lock/transaction held across Pillow processing and two S3 puts", suggestion: "Validate+process before locking; lock, look up previous, put, commit" }
  - { source: code_review, severity: warning, category: security, location: "src/frontend/src/plugins/PluginMessageHandler.ts:242-245; src/frontend/src/pages/add/EventCreateView.tsx:21-43", fixable: true, description: "done payload unvalidated (undefined crashes listener) and pluginId ignored", suggestion: "Normalise payload to {} if not a record; act only for view.point.pluginId" }
  - { source: code_review, severity: info, category: best_practices, location: "src/backend/app/events/service.py:186-189", fixable: true, description: "cleanup delete failure masks original exception", suggestion: "Guard cleanup in its own try and log" }
  - { source: code_review, severity: info, category: best_practices, location: "src/backend/app/events/router.py (assert storage is not None)", fixable: true, description: "assert used for runtime invariant", suggestion: "Explicit check or return storage-backed URL from service" }
  - { source: code_review, severity: info, category: quality, location: "src/backend/app/events/service.py:52-57", fixable: true, description: "EventNotFound overwrites self.args", suggestion: "Use public_message-style attribute or __str__" }
  - { source: code_review, severity: info, category: performance, location: "src/backend/alembic/versions/0070_events.py:181-196", fixable: true, description: "No indexes on events FK columns", suggestion: "Add when first reader lands" }
  - { source: code_review, severity: info, category: quality, location: "src/backend/app/events/models.py:51-59", fixable: false, description: "Business key with created_at None pre-flush", suggestion: "Project pattern; no action" }
  - { source: code_review, severity: info, category: quality, location: "src/frontend/src/plugins/PluginMessageHandler.ts:88", fixable: true, description: "Redundant '..' check (regex already strict)", suggestion: "Optional; harmless" }
  - { source: code_review, severity: info, category: best_practices, location: "plugins/events/src/domain.ts:237-251", fixable: true, description: "403/404 always mapped to location message even without location_id", suggestion: "Map to create.location only when location_id set" }
  - { source: code_review, severity: info, category: performance, location: "plugins/events/src/domain.ts:305-309", fixable: false, description: "10 s timeout for 5 MB uploads -> false failures on mobile", suggestion: "Per-type timeout for uploadImage (spec non-goal)" }
  - { source: code_review, severity: info, category: best_practices, location: "plugins/events/src/domain.ts:285-292", fixable: true, description: "console.error in production plugin", suggestion: "Keep or gate behind debug flag" }
  - { source: code_review, severity: info, category: best_practices, location: "src/backend/tests/test_event_banners.py", fixable: true, description: "No storage put/commit failure test", suggestion: "Add fake-storage put failure test" }
  - { source: code_review, severity: info, category: best_practices, location: "plugins/events/src/components/LocationSheet.tsx:436-445", fixable: true, description: "Focus lost to body on retry inside aria-modal sheet", suggestion: "Refocus dialogRef on error->loading" }
  - { source: code_review, severity: info, category: quality, location: "src/frontend/src/pages/add/EventCreateView.tsx:19", fixable: true, description: "Magic 240px frame offset", suggestion: "CSS variable / flex layout" }
  - { source: code_review, severity: info, category: best_practices, location: "plugins/events/src/domain.ts:4", fixable: true, description: "getSDK() at module import", suggestion: "Resolve lazily in call()" }
issue_counts: { critical: 0, warning: 3, info: 13 }
```
