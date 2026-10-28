# Spec Audit — Events plugin (wydarzenia) at /add/event

## TL;DR
Verdict: **pass-with-concerns** (⚠️ Mostly Compliant). The spec can be built against the current codebase. Every file, function, line reference and pattern it names exists and works the way the spec assumes (avatar flow, `process_upload`/`MAX_UPLOAD_BYTES`, `TermAttendance`, `locations_acl`/`get_owned_location`, `TextField`, matrix catch-all, clock guard, alembic head `0069`, plugin host/SDK files).
Counts: **critical 0 / high 1 / medium 4 / low 14**.
The one high finding: the spec never says how the dev `plugin-sdk.js` bundle (which carries the new `uploadImage`/`done`) gets rebuilt and served. The medium findings: submit is disabled, yet errors only appear after a submit attempt; banner errors are mapped to the location message or to English server text; a retry can race the timed-out upload still running; Polish copy is missing for a missing start or for the add-place form.

## Key Decisions
- The SDK bundle serving gap is classed **High**, not Critical. It does not stop code or tests from being written, but without it the success criterion "a user creates an event through the plugin" cannot be met at runtime. The codebase analysis already flagged it (`analysis/codebase-analysis.md:26`), and the spec does not address it.
- The disabled-submit vs "errors after submit attempt" conflict is **Medium**. The binding mockups do show the button disabled, but `accessibility.md:60` prescribes `aria-disabled` for buttons blocked by input. That conflict needs a decision, not just a fix.
- Deliberate user decisions are **not** findings: the `event_attendances` table with no readers, the unmoderated public banner, the 409 instead of 503/400, the plugin's own CSS instead of `plugin-ui.css`, and no plugin unit tests.
- The `uploadImage` allowlist is not tied to a plugin id, and the plugin can already call `getToken`/`pluginFetch` on any `/api/` path. The allowlist is therefore defence in depth, not a security boundary. It is recorded as informational.

## Open Questions / Risks
- How is `http://localhost:5173/assets/plugin-sdk.js` served in dev? `public/assets/` holds only `plugin-ui.css`. `build:sdk` writes to `dist/`, which `vite` dev does not serve. The committed copy at `src/resources/static/assets/plugin-sdk.js` is a stale legacy path.
- Should "Zapisz wydarzenie" use native `disabled` (mockup and spec) or `aria-disabled` plus a hint (accessibility standard)?
- What should the banner-failed screen show for a 403 or 404 from the banner endpoint? Today the server returns the English "Access denied" / "… not found".
- Are the date and time inputs on the "empty" form prefilled (the mockup shows 15.11.2026 14:00–18:00) or blank (the spec says "all fields empty")?

---

## Verified claims (evidence)

| Spec claim | Evidence | Result |
|---|---|---|
| Avatar flow at `users/service.py:152-195`, router `users/router.py:84-96` | `set_my_avatar` at service.py:152–195: storage None → `BusinessConflictException`, `asyncio.to_thread(process_upload)`, `with_for_update` on the previous row, put files, delete previous + flush + `_stage_avatar_files_delete`, rollback deletes the new files. Router reads `MAX_UPLOAD_BYTES + 1` | OK |
| `images.process_upload`, `INVALID_IMAGE_MESSAGE`, global 15 MB | `storage/images.py:15` `MAX_UPLOAD_BYTES = 15*1024*1024`, `:22` message, `:43` `process_upload` | OK |
| `large_key`/`thumb_key` = `/w1600.webp` / `/w400.webp` | `users/models.py:98-103` | OK |
| `TermAttendance` at `groups/models.py:255-281` | Class at 255; `party_id` FK `fk_term_attendances_party_id_parties`; `withdrawn_at DateTime()` nullable; `child_count` present | OK |
| `locations_acl` pattern + `get_owned_location` 404-then-403 | `groups/infrastructure/locations_acl.py` (re-exports `LocationRefResponse`, `get_location`, `location_ref_response`); `locations/service.py:98-108` | OK |
| `TextField`/`MESSAGES`/`check_text` (400/503) | `moderation/text_guard.py:23-59, 77`; `ModerationUnavailable` default Polish message (`core/errors.py:62-68`) | OK |
| Error envelope mapping | `core/errors.py`: ValueError → 400 `str(exc)`, EntityNotFound → 404, AccessDenied → 403 "Access denied", BusinessConflict → 409, RequestValidationError → 400 "Validation failed" + fieldErrors | OK |
| Matrix rows go before the catch-all | Catch-all `(None, r"^.*$", "AUTHENTICATED")` at `authorization_matrix.py:253`; no existing row matches `/api/events` | OK |
| Clock guard `_GUARDED_DIRS` | `tests/test_domain_clock_guard.py:27` (groups/application, groups/router) | OK, can be extended |
| Alembic head 0069 | `alembic/versions/0069_vinted_categories.py:46` `revision = "0069"` | OK |
| `get_profile_by_principal` cross-BC import precedent | Used directly in `groups/application/attendance.py:18`, `families/router.py:15` | OK |
| `ModerationStatus.APPROVED`, `_enum_column` per module | `moderation/status.py:10`; `_enum_column` duplicated per `models.py` (e.g. `users/models.py:25`) | OK (events needs its own copy) |
| Test fixtures | `conftest.py:118` `freeze_local_now`, `:164` `fake_storage` (tracks `public`), `:180` `get_storage` override; `test_my_profile.py:97` `_png`; `test_conversation_messages.py:46` `_restore_classifier`; `test_locations_migration.py` pattern | OK |
| Host plugin files | `extensionPoints.ts` (4 points), `PluginFrame.tsx` `CONTEXT_TYPE_PREFIX: Record<ExtensionPointType,…>` (adding the union member forces the new entry; good), `title="Plugin: {name}"`, `PluginContext.tsx:28` `resolveExtensionPoints` (unexported, skips disabled, sorts ascending), `PluginMessageHandler.ts` (prefix, source, origin checks; `filterChange` fire-and-forget precedent; `handlePluginFetch` raw fetch with `credentials:"omit"`, `X-Requested-With`, Bearer from `localStorage.auth_token`, safelisted headers) | OK |
| PluginProvider/handler admin-only | `router.tsx:55-62` `Layout` (with `PluginProvider`) used only under `/admin` (`router.tsx:~191`); panel routes use `PublicLayout`. `PluginFrame` is used only in `pages/admin/*` | OK, so "never mounted together" holds |
| SDK messaging | `plugin-sdk/messaging.ts` `sendMessageAndWait` (10 s), `sendFireAndForget`; payload posted raw (no JSON stringify), so a `File`/`Blob` survives structured clone and is re-created in the host realm (`instanceof Blob` holds) | OK |
| `GET /api/plugins` reachable for panel users | Matrix row 13 `("READ",)`; login token grants `["READ","EDIT"]` (`users/router.py:46`) | OK |
| Backend accepts `add.event` | `plugin/schemas.py:42` passes `manifest["extensionPoints"]` through unvalidated | OK |
| `EventCreateView` mock, `AppPage` mount, mock tests | `pages/add/EventCreateView.tsx` (mock); `AppPage.tsx:105`; `test/AppPage.test.tsx:3009-3036` describe "Dodaj › Wydarzenie (mock)", hub link assertion at :2969 | OK |
| Warehouse scaffold | package/vite (3001, strictPort)/tsconfig/index.html (`lang="en"`, loads sdk + plugin-ui.css)/manifest | OK |
| nginx 16 MB body limit | `src/frontend/nginx.conf:9` `client_max_body_size 16m` | OK |

---

## High

### H1. The plugin SDK bundle with `uploadImage`/`done` has no defined build or serve step
- **Spec reference:** Req 13 (SDK methods), Req 16 (`index.html` loads `http://localhost:5173/assets/plugin-sdk.js`), Success Criteria ("Through the plugin, a logged-in user creates an event").
- **Evidence:**
  - `src/frontend/vite.sdk.config.ts` builds `src/plugin-sdk/index.ts` into `dist/assets/plugin-sdk.js`.
  - `npm run dev` (`vite`) serves `public/` and `src/` only. `public/assets/` contains only `plugin-ui.css`.
  - The only tracked `plugin-sdk.js` is `src/resources/static/assets/plugin-sdk.js`, a legacy Java static path that lacks the new methods.
  - `analysis/codebase-analysis.md:26` already flags that "`plugin-sdk.js` only appears after `build:sdk`".
- **Category:** Missing requirement / unimplementable as written (at runtime).
- **Severity:** High. Without a rebuilt SDK being served, `hostApp.uploadImage` and `thisPlugin.done` are `undefined` inside the iframe. Unit tests still pass, but the end-to-end flow and the e2e/manual verification fail.
- **Recommendation:** Add a requirement that says how the dev SDK is produced and served. For example: `npm run build:sdk` followed by a copy into `public/assets/`, or a small Vite dev middleware or `publicDir` entry. Document it in `plugins/CLAUDE.md`, and state whether the stale `src/resources/static/assets/plugin-sdk.js` is updated or ignored.

## Medium

### M1. Disabled submit contradicts "errors show after … a submit is attempted" and the accessibility standard
- **Spec reference:** Req 18: "Errors show after a field is blurred or a submit is attempted … 'Zapisz wydarzenie' is disabled while the draft is invalid or a save is running."
- **Evidence:**
  - With a natively `disabled` button, a submit attempt is impossible, so errors on untouched fields never appear and the button gives no reason for being disabled.
  - `standards/frontend/accessibility.md:60`: "When an action is blocked only by missing input … use `aria-disabled="true"` instead of native `disabled` … Use native `disabled` only while busy" (reference `ItemCreatePage.tsx`).
  - `standards/global/validation.md` says "submit disabled while invalid", so the standards themselves disagree. The mockup `screen:event-form-empty` shows the button disabled.
- **Category:** Contradictory.
- **Severity:** Medium. It hurts keyboard and screen-reader users, and part of the error UX can never be reached.
- **Recommendation:** Use `aria-disabled="true"` plus a hint linked with `aria-describedby` and a handler guard. A guarded click marks every field as touched. Use native `disabled` only while saving. Alternatively, drop "or a submit is attempted" and accept the gap explicitly.

### M2. Banner-upload error messages: 403/404 map to the location copy, or show English server text
- **Spec reference:** Req 17: `errorMessage` maps 404/403 to "Wybrane miejsce jest niedostępne — wybierz inne."; returns the body `message` for 400/409/503. Req 20.3: the banner failure shows "plus the server message when there is one".
- **Evidence:**
  - Banner 403 comes from `AccessDeniedException` → `core/errors.py:132-133`, always the English "Access denied".
  - Banner 404 comes from `EntityNotFoundException` → `str(exc)`, also English.
  - If `errorMessage` is reused for the banner, 403/404 show a misleading location message. If the raw server message is shown instead, users see English.
- **Category:** Ambiguous / Polish-consistency gap.
- **Severity:** Medium. Users see wrong or English copy on a reachable path, for example a stale event id after "Dodaj kolejne", or a token change.
- **Recommendation:** Define `bannerErrorMessage(response)`: use the body `message` only for 400/409; map 401 → "Sesja wygasła — zaloguj się ponownie." and everything else to the generic banner failure line. Restrict `errorMessage` to `createEvent`.

### M3. A retry after the 10 s timeout can race the upload still running
- **Spec reference:** Key Decision "A retry after the 10 s SDK timeout therefore leaves no orphan files"; Req 4.7.
- **Evidence:**
  - The avatar template locks only the *previous* row (`users/service.py:164-170`, `select(...).with_for_update()`). On the first upload there is no previous row, so nothing is locked.
  - In the scenario the spec designs for, the first request is still processing on the server when the user presses "Spróbuj ponownie". Both requests then see no previous banner and both insert.
  - The second hits `uq_event_banners_event_id` → `IntegrityError` → 409 "Data integrity violation" (English, `core/errors.py:105-107`). Its files are deleted, but the plugin shows a failure even though a banner exists.
- **Category:** Incorrect assumption about existing code / concurrency.
- **Severity:** Medium. It is the exact retry path the spec relies on, and the outcome is a confusing English error.
- **Recommendation:** In `set_event_banner`, lock the **event** row (`db.get(Event, event_id, with_for_update=True)`, which also serves the 404/403 lookup) so concurrent uploads serialise and the later one cleanly replaces the earlier one. Add one test if feasible, or document the remaining risk.

### M4. Polish copy is missing for a missing start date or time and for the add-place form
- **Spec reference:** Req 17 `validateDraft` ("per-field Polish errors with the same copy as the backend"); Req 18 ("Początek: … both required"); Req 19 (inline form Nazwa, Adres → `POST /api/locations`).
- **Evidence:**
  - The backend has no Polish message for a missing `starts_at`: it is a required field, so Pydantic returns the English "Validation failed". The spec therefore defines no copy for an empty date or time.
  - `CreateLocationRequest` (`locations/schemas.py:60-68`) enforces `name` 1–255 and `formatted_address` 1–500 through Pydantic. Violations return 400 "Validation failed" with English `fieldErrors`, which the plugin would show verbatim.
  - The spec defines no client-side rules or copy for the add-place form, and no error state for a failed `POST /api/locations`.
- **Category:** Missing requirement.
- **Severity:** Medium. The implementer will invent copy, and the backend/plugin parity criterion cannot be checked for these fields.
- **Recommendation:** Add the copy explicitly, for example "Podaj datę i godzinę początku.", "Podaj nazwę miejsca.", "Podaj adres." and "Nie udało się dodać miejsca. Spróbuj ponownie.", with max-lengths of 255/500 on the inputs. State that the submit button in the add-place form is blocked until both fields are non-blank.

## Low

- **L1. Req 1 says "creates two tables" but lists three.** `spec.md:49` against the `event_attendances` bullet and the downgrade order on the same line. **Recommendation:** fix the wording.
- **L2. Where the 5 MB check runs is ambiguous.** Req 4 orders 404 → 403 → 409 → size. But the "router reads at most `EVENT_BANNER_MAX_BYTES + 1`" step implies the read happens before the service call, as in the avatar router at `users/router.py:93`. So `len(data) > MAX` must be checked inside the service, after the lookups, or the order is not met. **Recommendation:** say this explicitly.
- **L3. The events ACL does not list `LocationRefResponse` among its re-exports.** Req 5 lists `get_owned_location`, `get_location` and `location_ref_response`, but `EventResponse.location: LocationRefResponse | None` needs the type in `app/events/schemas.py`. Importing it from `app.locations.schemas` would break the "ACL is the only importer" rule (`models.md:143`). The groups ACL re-exports it (`groups/infrastructure/locations_acl.py:21-23`). **Recommendation:** add it to the re-exports.
- **L4. Polish copy drifts from existing messages.**
  - The 409 text is "Wysyłanie zdjęć jest wyłączone", while the avatar precedent is "Dodawanie zdjęć jest chwilowo niedostępne" (`users/service.py:128`). The spec cites "the avatar precedent" for the status code only.
  - The plugin's "Dodaj zdjęcie JPG, PNG lub WebP." differs from the backend's `INVALID_IMAGE_MESSAGE` "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP", and the hint says "JPEG".
  - **Recommendation:** align the wording, or confirm the difference is intentional.
- **L5. The host locations cache goes stale after the plugin creates a place.** The plugin calls `POST /api/locations` through `hostApp.fetch`, which bypasses `useMyLocations`/`LOCATIONS_KEY` invalidation (`hooks/useMyLocations.ts:24,43-46`, data-fetching standard: mutations invalidate the resource prefix). AppPage stays mounted, so "Moje miejsca" may not show the new place. **Recommendation:** in `onDone`, call `queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY] })`.
- **L6. Exporting `resolveExtensionPoints` from `PluginContext.tsx` will trip `react-refresh/only-export-components`.** The rule comes from `eslint.config.js` `reactRefresh.configs.vite`. A pure `eventCreateViewState.ts` would also import a React context module. **Recommendation:** move the resolver (and `ResolvedExtensionPoint`) to `plugins/resolveExtensionPoints.ts` and import it back into `PluginContext.tsx`.
- **L7. AppPage test prerequisites are not stated.** `test/AppPage.test.tsx` does not mock `../api/plugins` today (mocks at lines 27–152) and calls `vi.resetAllMocks()` per describe. The new tests need `vi.mock("../api/plugins")` with `getPlugins` stubbed per test. The `done` test also needs a `MessageEvent` whose `source` is the rendered iframe's `contentWindow` and whose `origin` is `http://localhost:3004`, following the pattern in `test/plugins.test.tsx:165-200`. **Recommendation:** note both in the Testing Approach.
- **L8. The test plan has coverage gaps.**
  - No backend test for a timezone-aware datetime (400 copy), for the moderation-unavailable 503, or for a blank description stored as null.
  - No host test for MIME rejection, which is bundled only implicitly with "non-Blob or oversized", or for `usePluginMessageHandler` removing its listener on unmount.
  - Nothing checks that the plugin's `domain.ts` copy matches the backend, although Success Criteria require "the same message inline".
  - **Recommendation:** add the aware-datetime and MIME cases at least, and consider one parity table shared or copied by both sides.
- **L9. Backend test volume exceeds the standard.** `test_events.py` plans up to 11 tests (6 create + 5 banner), while `backend-testing.md:59` says "2–8 focused tests per feature". This is acceptable if create and banner count as two features. Names follow `test_<operation>_<scenario>_<expected>` correctly. **Recommendation:** either note why the count is acceptable or merge cases.
- **L10. Several doc and scaffold details are inaccurate.**
  - The port list (Req 21) omits `3003`, used by `plugins/ai-description/manifest.json:4`.
  - The registration curl needs an `Authorization: Bearer <admin token>` header (`PUT /api/plugins/{id}/manifest` requires `PLUGIN_MANAGEMENT`/`ADMIN`, matrix row 20). Per the secrets rule, use a placeholder and never a value.
  - "Import the SDK through `../../sdk`" is correct only from `src/*.ts`. From `src/pages/*` it is `../../../sdk` (`warehouse/src/pages/WarehousePage.tsx:2`).
- **L11. The empty-form mockup does not match the spec.** `formularz-nowego-wydarzenia-pusty.html` shows Początek 15.11.2026 14:00 and Koniec 18:00, while the spec says "all fields empty". Requirements say the "UI defaults the end to the same day". **Recommendation:** state whether those values are defaults, placeholders, or blank.
- **L12. Traceability is incomplete.**
  - `event_attendances` is recorded as a user decision only in `orchestrator-state.yml:137`. `analysis/requirements.md` and `scope-clarifications.md` still describe 0070 as `events` plus `event_banners` only.
  - The clock-guard test name `test_groupsApplicationAndRouter_noHostClockCalls` becomes misleading once `app/events` is added.
  - **Recommendation:** update requirements.md and rename the test, for example `test_guardedPackages_noHostClockCalls`.
- **L13. The `EventAttendance` business key includes the mutable `withdrawn_at`.** The hash changes when a sign-up is withdrawn, which breaks set or identity-map semantics. `Event`'s key `(author_party_id, name, starts_at)` also has no uniqueness backing it. Nothing reads either today. **Recommendation:** key `EventAttendance` on `(event_id, party_id)`, or document the choice.
- **L14. Some date edge cases are unspecified.**
  - An event cannot end at midnight: end `00:00` on the same day is always `<= start`.
  - Naive Warsaw times in the DST gap or overlap (last Sunday of March/October) are accepted silently.
  - `starts_at` has no upper bound.
  - The confirmation format with no end time (`· 14:00`) and stored seconds or microseconds from non-plugin clients are not defined.
  - **Recommendation:** add one line accepting or defining each.

## Clarification needed
1. M1: native `disabled` (mockup) or `aria-disabled` plus a hint (accessibility standard) for "Zapisz wydarzenie"?
2. H1: which mechanism serves the rebuilt `plugin-sdk.js` on `:5173` in dev?
3. L11: are the start date/time and end time prefilled on an empty form? If so, with what (next full hour, +4 h)?
4. M2: which Polish copy should banner 403/404 and add-place errors show?

## Extra features (beyond requirements)
- The `event_attendances` table (user decision, logged in orchestrator state; see L12).
- The optional `PluginFrame` `title` prop and `usePlugins` hook. These are justified by the standards and are not scope creep.

## Recommendations (summary)
1. Add an SDK build-and-serve step for dev, and document it (H1).
2. Settle the disabled vs `aria-disabled` question and make the error-reveal rule consistent (M1).
3. Split `errorMessage` into create and banner variants with Polish fallbacks (M2), and add the missing copy for start and add-place validation (M4).
4. Lock the event row in `set_event_banner` (M3).
5. Re-export `LocationRefResponse` from the events ACL, and move `resolveExtensionPoints` to a `.ts` module (L3, L6).
6. Invalidate `LOCATIONS_KEY` on `done` (L5), and fill the listed test gaps (L7, L8).
