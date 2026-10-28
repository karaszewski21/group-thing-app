# Completeness Re-verification (cycle 2): Events plugin

## TL;DR
- **Status: passed_with_issues.** 0 critical, 2 warnings (W1 still deferred, plus a new spec drift on the SDK timeout), 2 info.
- **W2 and W3 are resolved.** `architecture.md` now has an accurate `## Events (app/events/)` section and INDEX.md mentions it. In `set_event_banner`, both `put` calls now run inside the `try`, only keys that were actually stored are deleted, and a regression test covers it.
- **The spec matches the code** for the `create.unconfirmed` Copy row (exact text) and for the `createEventError` mapper. The docs are consistent with the code and contain no secret values. The work-log records the cycle-1 fixes.
- **New warning W4:** `spec.md` still says the `uploadImage` timeout "stays 10 s" and lists per-message timeouts as out of scope. The code (and `plugins/CLAUDE.md`) now uses 60 s per call.

## Key Decisions
- W1 (step 6.5, iframe height) is deferred to E2E as instructed. It is not counted as a new defect.
- W4 is a warning, not critical. It is a documentation drift in the spec; behaviour and developer docs agree with each other.
- I did not rerun the test suites. The cycle-2 counts come from `verification/test-suite-results.md`.

## Open Questions / Risks
- Should spec.md be patched for the 60 s upload timeout (Req 13, Req 21, Open Questions "SDK timeout", Out of scope)? This is a quick, fixable edit.

---

## 1. Plan Completion

| Metric | Value |
|---|---|
| Numbered steps | 78 |
| `[x]` | 77 |
| `[~]` | 1 (6.5, deferred to E2E, line 232) |
| `[ ]` | 0 |
| Completion | 98.7%, nearly complete |

Info I9: the cycle-1 report gave 67 total steps. A recount of numbered `- [x|~] N.N` lines gives 78, with no duplicate step numbers. The verdict does not change.

## 2. Previously Reported Warnings

### W2: architecture.md missing app/events (resolved)
- `.maister/docs/project/architecture.md:137-144` adds `## Events (app/events/)`: migration 0070, the three tables, both routes, the `EDIT`/`mcp:edit` matrix requirement, the ACL boundary, banner storage, no moderation yet, and the UI plugin on `add.event`.
- The package tree (lines 210-212) lists `events/` reaching `app.locations` only through `events/infrastructure/locations_acl.py`.
- These claims were checked against the code:
  - Key names `w1600.webp` and `w400.webp`: `app/events/models.py:83-88`
  - Matrix rows: `app/core/authorization_matrix.py:201-204`
  - `app.locations` is imported only in `app/events/infrastructure/locations_acl.py:15-17`
  - `FOR UPDATE` lock and outbox entry: `app/events/service.py:151, 185-189`
- `.maister/docs/INDEX.md:23` summarises the events bounded context in the Architecture entry.

### W3: orphaned file vs spec Req 4.9 (resolved)
- In `src/backend/app/events/service.py:175-199`, both `storage.put` calls sit inside the `try`, and each key is appended to `stored` only after its put succeeds.
- On failure the code rolls back, then deletes only `stored`. A failure during that cleanup is logged with `logger.exception`, and the original error is re-raised.
- The test `test_uploadBanner_thumbPutFails_deletesStoredLargeKeepsOldBanner` (`tests/test_event_banners.py:207`) asserts that the old banner row is kept and that storage holds only the old keys.

### W1: step 6.5 (still deferred)
- No change: `EventCreateView.tsx` still uses the estimated 240px offset. The step is tracked for E2E.

## 3. Spec ↔ Code Alignment (cycle-1 changes)

| Item | Spec | Code | Match |
|---|---|---|---|
| Copy row `create.unconfirmed` | `spec.md:108` "Nie udało się potwierdzić zapisu — wydarzenie mogło zostać zapisane. Odczekaj chwilę przed ponowną próbą." | `plugins/events/src/domain.ts:23` `MESSAGES.createUnconfirmed`, same text | Yes, character for character |
| `createEventError` mapping | `spec.md:265`: 400/409/503 → body message; 403/404 → create.location; 401 → session; rejected call or timeout → create.unconfirmed; otherwise → create.generic | `domain.ts:228-243`: `!res` → createUnconfirmed; 400/409/503 → `bodyMessage` ?? generic; 401 → session; 403/404 → createLocation; default → generic. `call()` returns `null` on rejection (`domain.ts` ~280-283) | Yes |
| `uploadImage` timeout | `spec.md:58-59` "The 10 s limit stays"; `:225` "The timeout stays 10 s"; `:304` "10 s timeout caveat"; `:486` "per-message SDK timeouts" out of scope | `src/frontend/src/plugin-sdk/host-app.ts:6,46` `UPLOAD_TIMEOUT_MS = 60_000` passed per call; `messaging.ts:24` takes a per-call `timeoutMs` parameter; `plugins/sdk.ts:50` and `plugins/CLAUDE.md:285,396` say 60 s | **No (W4)** |

## 4. Docs Consistency and Secrets

- **`plugins/CLAUDE.md`:**
  - The registration curl is multi-line again, with `\` continuations (I6 resolved).
  - It names the `<admin-token>` placeholder and explains how to obtain one. It points to the docstring of `0002_seed_dev_users.py` for the dev password rather than printing it. Both `0002` and `0043_restore_admin_permission.py` exist.
  - It covers `npm install` and plugin id `events` for the events plugin.
  - Its symptoms text matches the host copy: "Plugin wydarzeń jest niedostępny" at `EventCreateView.tsx:75`.
  - The timeout text (60 s upload, 10 s otherwise) matches the code.
- **Secret scan:** I grepped the diffs of `.maister/docs/` and `plugins/CLAUDE.md` for `eyJ`, `Bearer`, token, key, secret and password. There are only placeholders and references, with no secret values. The sample SQL `admin@localhost` is a placeholder email, not a credential.

## 5. Work-log

- The `2026-10-28T13:50:09Z - Verification fixes (cycle 1)` entry (`work-log.md:147-156`) lists fixes 1, 2, 3, 4 and 8, each with its test evidence, plus the items not changed (5, 6, 7, 9).
- Info I10: the earlier follow-up lists still name "orphan large image if thumb put fails" (`work-log.md:136,145`). That item is now fixed, but the cycle-1 entry does not explicitly close it. Stale "`.playwright-mcp/` gitignore" item (I7) also remains. Neither affects the result.

## 6. Standards (delta only)

The cycle-1 changes touch error-handling, backend-testing, frontend-testing, plugin-auth (the SDK) and conventions (docs). The cycle-1 applicability table still holds. The new code follows these standards:
- Typed re-raise with logged cleanup.
- camelCase test name with exact assertions.
- Docs updated in the same change.

The only new gap is the spec drift (W4).

---

## Issues

| # | Severity | Source | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| W1 | warning | plan_completion | Step 6.5 (iframe height offset) is still deferred to E2E | `src/frontend/src/pages/add/EventCreateView.tsx` | true | Tune at 360px in E2E, then tick 6.5 |
| W4 | warning | documentation | The spec still says the uploadImage timeout is 10 s and lists per-message timeouts as out of scope. The code uses a per-call 60 s timeout | `implementation/spec.md:58-59, 225, 304, 486` | true | Update those lines to "60 s for uploadImage (per-call timeout), 10 s for other calls" and drop the out-of-scope bullet |
| I9 | info | plan_completion | The cycle-1 report undercounted the plan (67 vs 78 numbered steps) | `implementation/implementation-plan.md` | true | None needed |
| I10 | info | documentation | The work-log follow-up lists still name the fixed orphan-file item and the stale `.playwright-mcp/` item | `implementation/work-log.md:136,145` | true | Mark them closed in the next work-log entry |

## Issue Counts
- critical: 0
- warning: 2
- info: 2
