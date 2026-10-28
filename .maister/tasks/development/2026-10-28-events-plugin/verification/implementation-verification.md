# Implementation Verification — Events plugin (wydarzenia)

## TL;DR
**⚠️ Passed with Issues (after fixes, cycle 2)** — 0 critical, 4 warnings left (3 optional refactors + step 6.5 → E2E), ~29 info. 5 warnings fixed and confirmed by re-review (clean). Full suite: backend **909/909**; frontend 1195 passed, 10 failures = 8 pre-existing (as at HEAD) + 2 flaky (focus timing). Plan 77/78 (98.7%). Still left: the real browser round trip — Phase 12 E2E.

## Open Questions / Risks
- The host↔plugin↔backend round trip has not been exercised live (stubbed SDK only) — Phase 12.
- Duplicate risk on retry is small now (60 s upload, create.unconfirmed message), but N2 remains: a 201 with an unparsable body → create.generic.
- Plugin prod hosting is manual — the plugin must be on a **separate origin** (the sandbox has `allow-same-origin`).
- Banners are not image-moderated (user decision).

## Executive summary
The feature is implemented per spec and the integration seams line up. In cycle 1, 9 warnings were found; the user chose to fix 1, 2, 3, 4, 8 — all confirmed in cycle 2, plus W4 (spec/code mismatch on the timeout) fixed in the spec. Remaining: optional refactors (5, 6, 7) and iframe height tuning in E2E.

## Implementation plan verification
77/78 steps `[x]` (98.7%); 6.5 `[~]` → E2E (completeness-reverify.md).

## Test suite (cycle 2, full)
Backend 909/909 (100%). Frontend 1205: 1195 passed / 10 failed (99.2%) — 8 pre-existing (auth, extension-points ×2, foundation, PendingActionsHost, PublicLayout ×2, TermPage; identical on a clean HEAD) + 2 flaky (OrganizerEditor, DeleteGroupDialog — pass in isolation; untouched files). Plugin build OK. No regressions (test-suite-results.md).

## Standards compliance
19/19 applicable followed.

## Documentation
architecture.md (app/events), INDEX.md, plugins/CLAUDE.md (dev setup, multi-line curl, 60 s) consistent with the code; no secret values. spec.md/spec.html updated for create.unconfirmed and 60 s.

## Optional reviews
| Check | Cycle 1 | Cycle 2 |
|---|---|---|
| Completeness | ⚠️ 0C/3W/8I | ⚠️ W2, W3 resolved; W4 found and fixed; W1 (6.5) → E2E |
| Code review | ⚠️ 0C/3W/13I | ✅ clean — 0C/0W/4I (N1–N4) |
| Pragmatic review | ✅ 0C/3W/7I | W3 resolved; W1, W2 remain (optional) |
| Production readiness | ⚠️ GO with mitigations, 78% | concern "orphaned file" resolved; rest unchanged (not re-run) |
| Reality check | ⚠️ ~90% | R1 mitigated; H1 (runtime) → E2E (not re-run) |

Pragmatic, production and reality were not re-run in cycle 2 — their remaining findings do not depend on the fixes.

## Issues requiring attention (after fixes)
| # | Severity | Description | Location | Status |
|---|---|---|---|---|
| 1 | warning | Orphaned large image when the thumb put fails | `app/events/service.py:175-199` | ✅ fixed |
| 2 | warning | `done` without payload validation / pluginId | `PluginMessageHandler.ts:241-249`, `EventCreateView.tsx` | ✅ fixed |
| 3 | warning | 10 s timeout → false error / duplicate | `plugin-sdk/messaging.ts`, `host-app.ts`, `domain.ts` | ✅ fixed (60 s + create.unconfirmed) |
| 4 | warning | Strict parsers on unread fields | `plugins/events/src/domain.ts` | ✅ fixed |
| 5 | warning | `FOR UPDATE` lock held through processing + S3 | `app/events/service.py` | open (optional, user decision) |
| 6 | warning | Two mechanisms for Polish messages | `app/events/service.py:52-61` | open (optional) |
| 7 | warning | One-entry `UPLOAD_IMAGE_RULES` table | `PluginMessageHandler.ts:22-35` | open (optional) |
| 8 | warning | Docs gaps | architecture.md, plugins/CLAUDE.md | ✅ fixed |
| 9 | warning | Step 6.5 iframe height | `EventCreateView.tsx:19` | → E2E |
| W4 | warning | Spec said 10 s for uploadImage | `spec.md` | ✅ fixed |
| N1 | info | No test that `done` from another plugin is ignored | `EventCreateView.tsx` | open |
| N2 | info | 201 with unparsable body → create.generic (retry = duplicate) | `domain.ts:289-292` | open |
| N3 | info | Bad `location` breaks the whole event parse | `domain.ts:214-215` | open |
| N4 | info | `filterChange` passes the raw payload (pre-existing) | `PluginMessageHandler.ts:235-238` | open |

Other info items from cycle 1 (FK indexes, `assert storage`, focus after "Spróbuj ponownie", `console.error`, react-router for a single route, global rate limiting/CSP/error tracking) — unchanged, see the individual reports.

## Fix & Re-Verification History
| Issue | Fix applied | Re-check |
|---|---|---|
| 1 Orphaned file | puts inside `try`, delete only stored keys, cleanup error logged and original re-raised; + test `test_uploadBanner_thumbPutFails_deletesStoredLargeKeepsOldBanner` | resolved — test passes (7/7 banner tests), code-review-reverify |
| 2 `done` payload | normalize to `{}`; `onDone` only for `view.point.pluginId`; + it.each 3 cases | resolved — 35/35 targeted tests |
| 3 Timeout | per-call `timeoutMs`, `uploadImage` 60 s; `createEventError(null)` → create.unconfirmed; + fake-timer test | resolved |
| 4 Parsers | `toEvent`/`toBanner` require only the fields they read | resolved |
| 8 Docs | architecture.md + INDEX.md + plugins/CLAUDE.md; curl restored manually (the shell collapsed `\` + newline) | resolved — no secrets |
| W4 Spec | spec.md/spec.html: 60 s, removed "per-message timeouts" from out-of-scope | resolved (cycle 2) |

## Recommendations
1. Phase 12 E2E: live round trip + 6.5 + error paths (unregistered plugin, storage off, 360 px).
2. Optional: N2/N3 (map an unparsable 201 to create.unconfirmed; location fallback to null), refactors 5–7.
3. Follow-ups: list/detail + sign-ups, banner moderation, prod plugin hosting on a separate origin, EntityId bug, `crossorigin` in box-size/warehouse, pre-existing and flaky frontend tests.

## Verification checklist
- [x] Completeness (cycle 1 + re-check)
- [x] Full test suite (cycle 2)
- [x] Code review (cycle 1 + re-review)
- [x] Pragmatic review (cycle 1)
- [x] Production readiness (cycle 1)
- [x] Reality check (cycle 1)
- [x] All reports on disk
