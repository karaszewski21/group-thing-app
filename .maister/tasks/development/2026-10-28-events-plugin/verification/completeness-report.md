# Implementation Completeness Report: Events plugin (wydarzenia) at /add/event

## TL;DR
- **Status: passed_with_issues.** 0 critical, 3 warnings, 8 info.
- **Plan:** 66 of 67 steps are `[x]` (98.5%). Step 6.5 (tuning the iframe height offset) is `[~]`, deferred to E2E. Spot checks found code for every task group.
- **Standards:** 19 of 21 indexed standards apply, and the code follows all 19. The gaps are minor: one spec deviation in rollback-on-failure and a few small style points.
- **Docs:** the work-log is thorough and the spec matches the code, including all 28 Copy-table rows and all 18 Audit Resolutions. Visual coverage is 11/11. One gap: `.maister/docs/project/architecture.md` has no section for the new `app/events` bounded context.

## Key Decisions
- Step 6.5 counts as "nearly complete", not a defect. The code uses an estimated `calc(100dvh - 240px)` (`src/frontend/src/pages/add/EventCreateView.tsx:19`), and the work-log records the deferral.
- The Group 9 scope extension is accepted as logged: `crossorigin` on the SDK `<script>` in `plugins/events/index.html:7` and `plugins/CLAUDE.md`, plus the `.loc .ph` style in `plugins/events/src/styles.css:249`.
- I did not rerun the test suites. The counts come from the work-log (backend 908 passed; frontend 1192 passed, 8 failures that also occur on HEAD, 1 flaky test).

## Open Questions / Risks
- If the thumb `storage.put` fails during a banner upload, the large file is orphaned (`app/events/service.py:172-173` runs before the `try`). This is a spec deviation, and the work-log already lists it as a follow-up.
- The plugin has only been checked through Playwright with a stubbed SDK. It has not yet been run end to end against the real host, SDK and backend; the E2E phase is still pending.

---

## 1. Plan Completion

| Metric | Value |
|---|---|
| Total steps | 67 (sub-steps across 11 groups: 6+9+5+8+6+6+6+7+5+4+5) |
| Completed `[x]` | 66 |
| Deferred `[~]` | 1: 6.5 (iframe height offset, deferred to E2E Phase 12) |
| Completion | 98.5% |
| Status | Nearly complete |

### Spot checks (code evidence)

| Group | Step(s) checked | Evidence |
|---|---|---|
| 1 Database | 1.2–1.4 | `src/backend/alembic/versions/0070_events.py`: three tables with every named constraint (`pk_*`, `fk_events_author_party_id_parties`, `fk_events_location_id_locations`, `uq_event_banners_event_id`, `ix_event_attendances_event_id`, partial `uq_event_attendances_event_id_party_id` `WHERE withdrawn_at IS NULL`). `downgrade()` drops in reverse order. `app/events/models.py`: models on BaseEntity, no `relationship()`, business keys as specified, `large_key`/`thumb_key`. |
| 2 Create API | 2.3, 2.4, 2.7, 2.8 | `app/core/errors.py`: `public_message` attribute; the handler falls back to "Access denied". `text_guard.py`: `EVENT_NAME`/`EVENT_DESCRIPTION` with the Copy-table texts. `service.py:create_event` validates in Copy-table order, then runs the ACL check, then `check_text` twice. `router.py` uses `require_any("EDIT","mcp:edit")` and returns 201. Two matrix rows added (`authorization_matrix.py:201-204`). Router registered (`main.py`). |
| 3 Banner API | 3.2, 3.3 | `service.py:set_event_banner` runs `with_for_update=True` → 404 → 403 → 409 → size check → `process_upload` in a thread → previous lookup → put → delete + flush + `OBJECTS_DELETE` → commit or rollback. The router does a bounded `file.read(MAX+1)`. |
| 4 Host infra | 4.2–4.7 | `extensionPoints.ts` `ADD_EVENT`. New `resolveExtensionPoints.ts`, with `PluginContext`/`PluginFilterBar` re-pointed to it. `PluginFrame` adds the `RENDER` prefix and a `title` prop. `PluginMessageHandler.ts` adds `UPLOAD_IMAGE_RULES` (uuid regex, 5 MB, 3 MIME types) and `done` → `onDone`. New `usePluginMessageHandler.ts` (ref pattern) and `hooks/usePlugins.ts` (`PLUGINS_KEY`, stable `NO_PLUGINS`). |
| 5 SDK | 5.2–5.5 | `host-app.ts` `uploadImage`, `this-plugin.ts` `done`, both mirrored in `plugins/sdk.ts`. `package.json` `build:sdk` copies the bundle with Node. `.gitignore` entry confirmed: `git status --ignored` lists `src/frontend/public/assets/plugin-sdk.js` as ignored. |
| 6 Host view | 6.2–6.4 | `eventCreateViewState.ts` is a pure resolver. `EventCreateView.tsx` switches on `view.kind`. `onDone` trims the name to 120 characters, shows the toast, invalidates `[LOCATIONS_KEY]` and navigates. 6.5 uses an estimated 240px offset. |
| 7 Plugin scaffold | 7.2–7.5 | `plugins/events/{package.json, vite.config.ts (3004, strictPort), tsconfig.json, index.html (lang=pl, SDK script, no plugin-ui.css), manifest.json}` match the spec exactly. `domain.ts` has the `MESSAGES` constants, `validateDraft`/`validatePlace`/`toRequest`, three mappers and four API helpers. |
| 8 Form + sheet | 8.3–8.5 | `BannerPicker.tsx` creates and revokes object URLs and uses `accept` with the MIME list. `EventCreatePage.tsx` has the `aria-disabled` submit with hint and the touch-all guard. `LocationSheet.tsx` has `role=dialog`, `aria-modal`, focus trap, Esc, a portal wrapped in a stop-propagation span, and every button is `type="button"`. `LocationField.tsx` returns focus to the trigger. |
| 9 Save flow | 9.2–9.4 | A discriminated `SaveState` union with `form`/`saving`/`bannerFailed`/`saved`. `SaveProgress`, `SavedCard` (`Intl.DateTimeFormat("pl-PL")`, built from the POST response) and `BannerFailed` (retry/skip). |
| 10 Docs | 10.2 | `plugins/CLAUDE.md` +55/−7. Every checklist item is present (see section 3). |
| 11 Test review | 11.3 | `tests/test_events.py` gains `test_createEvent_authorInBody_returns400NoEvent`. `tests/test_event_banners.py` gains `test_uploadBanner_replaceFails_keepsOldBannerDeletesNewFiles`. Frontend: `usePlugins` error test, `done` from a wrong origin, upload failure. |

**Spot-check issues:** none beyond the deferred step 6.5.

---

## 2. Standards Compliance

### Applicability reasoning

| Standard | Applies? | Reasoning | Followed? |
|---|---|---|---|
| global/error-handling.md | Yes | New exception types and Polish user messages | Yes. Typed `EventNotFound`/`NotEventAuthor`, centralized handlers, plugin error mappers |
| global/validation.md | Yes | Server and client validation of the event form | Yes. The server is authoritative; specific Polish errors; allowlist rules; `aria-disabled` submit. The integer-input rule does not apply (no integer inputs) |
| global/conventions.md | Yes | New module, docs, `.gitignore` | Mostly. `plugins/CLAUDE.md` is updated, but `architecture.md` is not (W2) |
| global/coding-style.md | Yes | All code | Yes |
| global/commenting.md | Yes | All code | Yes. Comments are sparse and explain why; no change-log comments |
| global/minimal-implementation.md | Yes | Scope | Yes, with one documented exception: `event_attendances` was a user decision |
| backend/api.md | Yes | Two new routes | Yes. Plural `/api/events`, `/banner` sub-resource, 201 on create |
| backend/models.md | Yes | Three new entities and the ACL | Yes. BaseEntity UUID, string enum via `_enum_column`, no `relationship()`, business keys on immutable columns, single `infrastructure/locations_acl.py` that does not import `..schemas` |
| backend/queries.md | Yes | Banner lookup, row lock | Yes. Bound parameters, `FOR UPDATE`, no N+1 (single-row reads) |
| backend/jooq.md | No | No filter-DSL query services touched | n/a |
| backend/migrations.md | Yes | 0070 | Yes. Named constraints, `gen_random_uuid()`, partial unique index, reverse-order downgrade, downgrade/upgrade test |
| backend/security.md | Yes | Matrix rows and route dependencies | Yes. `Depends(require_any("EDIT","mcp:edit"))`, matrix rows before the catch-all, verified in `test_authorization_matrix.py` |
| backend/plugin-auth.md | Yes | SDK and host-injected JWT | Yes. The host injects the Bearer token; `credentials: "omit"` |
| backend/time.md | Yes | Start/end validation | Yes. `clock.local_now()` via the module attribute; `app/events` added to the clock guard; tests use `freeze_local_now` |
| frontend/css.md | Yes | Host view and plugin CSS | Yes. Host uses Tailwind tokens; the plugin mirrors the tokens and loads no external fonts |
| frontend/components.md | Yes | View state | Yes. `resolveEventCreateView` lives in `*ViewState.ts`, is table-tested, and the page only `switch`es |
| frontend/accessibility.md | Yes | Form, sheet, iframe title | Yes. Labels, `role=alert` with `aria-invalid`/`aria-describedby`, `aria-disabled` plus a hint, focus trap, Esc ignoring `defaultPrevented`, focus return, `type="button"`, portal with a stop-propagation span, `{" "}` outside the `sr-only` span |
| frontend/responsive.md | Yes | Phone-width layout | Mostly. 16px gutter and `overflow-x: hidden`, but the iframe height is untuned (W1) |
| frontend/data-fetching.md | Yes | `usePlugins` and locations invalidation | Yes. Prefix key, stable empty fallback, app-shaped return. `onDone` uses `void invalidateQueries`, as the spec specifies (I3) |
| testing/backend-testing.md | Yes | New backend tests | Yes. Real Postgres fixtures, exact key sets (`EVENT_KEYS`, `{"url","status"}`), camelCase `test_<op>_<scenario>_<expected>` names. Counts are slightly over 2–8 (I4) |
| testing/frontend-testing.md | Yes | New frontend tests | Yes. Explicit `vitest` imports, `vi.mock("../api/plugins")`, `vi.mocked`, typed fixture factories with no `as` casts in `eventCreateViewState.test.ts` |

Totals: 21 checked, 19 applicable, 19 followed (2 of them with minor gaps).

### Gaps
- **W3 (spec Req 4.9, error-handling):** `app/events/service.py:172-173`. Both `storage.put` calls run before the `try:`. If the thumb put fails, the large file just stored is never deleted, but the spec says "On any failure, roll back and delete the newly stored files". This mirrors the avatar pattern, and the work-log lists it as a follow-up.
- **I1 (spec Req 16):** `plugins/events/src/pages/EventCreatePage.tsx:157` calls `getSDK()` inside a click handler rather than once at module level, as `domain.ts:4` does.
- **I2:** The add-place hint in `LocationSheet.tsx` (`PLACE_HINT_ID`) reuses `MESSAGES.placeInvalid`. The Copy table assigns that text to the `POST /api/locations` 400 response. The wording fits; this is a key-reuse note only.

---

## 3. Documentation Completeness

| Artifact | Status | Notes |
|---|---|---|
| implementation-plan.md | Intact | 66 `[x]`, 1 `[~]` with its reason inline |
| work-log.md | Complete | Timestamped entries for start, each of the 11 groups, each wave and completion. Each group lists the standards applied, tests, files and notes. Records the step 6.5 deferral, the Group 9 scope extension and the full-suite results |
| spec alignment | Aligned | See below |
| visual-coverage.md | Complete | 11/11 items mapped. The work-log records per-screen visual status (warnings for the empty-form height and the saving-screen variant) |
| plugins/CLAUDE.md | Complete | `add.event` section, `uploadImage` (allowlist, 5 MB, envelope, 10 s caveat), `done` (panel hosts only), `build:sdk` step, ports 3001–3004, `<admin-token>` curl, `../../sdk` vs `../../../sdk`, panel-plugin CSS exception, "Events Plugin" entry. No secrets |
| analysis/requirements.md | Complete | Line 10 records `event_attendances` (Req 22) |
| Project docs (`architecture.md`) | Gap | No `app/events` section (W2) |
| User documentation | Not required | The spec asks for none |

### Spec alignment
- **Copy table:** all 20 plugin keys match character for character between `plugins/events/src/domain.ts` `MESSAGES` and the spec. The backend constants in `app/events/service.py` and the `text_guard.MESSAGES` entries match too. banner.disabled reuses `AVATAR_UPLOAD_DISABLED_MESSAGE` and banner.invalid reuses `INVALID_IMAGE_MESSAGE`, as specified. The host fallback and toast copy in `EventCreateView.tsx` match.
- **Audit Resolutions H1, M1–M4 and L1–L14:** each one is reflected in the code:
  - `build:sdk` copy plus `.gitignore` entry (H1)
  - `aria-disabled` (M1)
  - `public_message` and the three mappers (M2)
  - `FOR UPDATE` (M3)
  - start.missing raised in the service, with `validatePlace`/`maxLength` 255/500 (M4)
  - the size check after the 404/403/409 checks (L2)
  - the `LocationRefResponse` re-export (L3)
  - `[LOCATIONS_KEY]` invalidation (L5)
  - the resolver module (L6)
  - the renamed clock-guard test (L12)
  - business keys (L13)
  - the end-time rules: same day, after the start, truncated (L14)
- **Deviations, all logged:**
  - `SaveProgress` adds a pre-POST "Zapisywanie wydarzenia…" phase, and the mockup's fake progress bar is omitted (I5).
  - `listMyLocations` maps 401 to the session copy, which fills a spec gap.

---

## Issues

| # | Severity | Source | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| W1 | warning | plan_completion | Step 6.5 not done: the iframe height offset is an untuned estimate, so the panel may scroll twice at phone width | `src/frontend/src/pages/add/EventCreateView.tsx:19` | true | Tune it in the E2E phase at 360px inside PhoneFrame, then tick 6.5 |
| W2 | warning | documentation | `architecture.md` does not describe the new `app/events` bounded context (routes, migration 0070, locations ACL, banner storage/outbox, unmoderated banners) | `.maister/docs/project/architecture.md` | true | Add a short "Events (`app/events/`)" section like the Locations section at line 127; update the INDEX.md summary |
| W3 | warning | standards | Rollback misses a partial store: the large file is orphaned if the thumb put fails (spec Req 4.9) | `src/backend/app/events/service.py:172-173` | true | Move both `put` calls inside the `try`, or track the stored keys and delete them on failure; already a work-log follow-up |
| I1 | info | standards | `getSDK()` is called in a click handler, not once per module (Req 16) | `plugins/events/src/pages/EventCreatePage.tsx:157` | true | Hoist `const sdk = getSDK()` to module scope |
| I2 | info | standards | The add-place hint reuses the place.invalid copy key | `plugins/events/src/components/LocationSheet.tsx` (PlaceAddForm) | true | Leave it, or add a dedicated hint key to the Copy table |
| I3 | info | standards | `onDone` uses `void invalidateQueries` rather than awaiting it (data-fetching); the spec makes this explicit because navigation follows | `EventCreateView.tsx` `onDone` | false | None; spec-sanctioned |
| I4 | info | standards | `test_events.py` has 9 test functions and `test_event_banners.py` has 6, slightly above the 2–8 guideline (Group 11 additions within its allowance of up to 10) | `src/backend/tests/` | false | None |
| I5 | info | documentation | The saving screen differs from the mockup: an extra "creating" phase, no progress bar. Logged as ⚠ in the work-log | `plugins/events/src/components/SaveProgress.tsx` | false | Confirm in visual/E2E review |
| I6 | info | documentation | The registration curl in `plugins/CLAUDE.md` lost its line continuations: it is one line with runs of spaces. It still works but reads oddly | `plugins/CLAUDE.md:408` | true | Restore the `\` continuations or put it on one clean line |
| I7 | info | documentation | The work-log follow-up ".playwright-mcp/ not git-ignored" looks stale: `git status --ignored` shows the root `.playwright-mcp/` as already ignored | `work-log.md:123,145` | true | Re-check and drop or correct the follow-up |
| I8 | info | documentation | Two standards suggestions are still waiting for the user: `tsBuildInfoFile` placement and a shared focus-trap helper for panel plugins | `work-log.md:67,110` | false | Raise them with the user via `/maister:standards-update` |

## Issue Counts
- critical: 0
- warning: 3
- info: 8
