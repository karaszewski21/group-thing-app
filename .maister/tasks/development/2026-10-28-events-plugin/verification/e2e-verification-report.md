# E2E Verification Report

## TL;DR
- **Verdict: NO-GO.** With the real backend, `/add/event` always shows the fallback "Plugin wydarzeń jest niedostępny", even when the events plugin is registered and enabled.
- Cause: `GET /api/plugins` returns `extension_points` (snake_case), but the host reads `plugin.extensionPoints`. This mismatch predates the task, but it makes the feature unreachable.
- With a test-only Playwright route shim that adds `extensionPoints`, the feature works end to end. Results: 9 of 10 scenarios passed (4 of them with issues), 1 failed. The issues are 1 Critical, 0 Major, 2 Minor and 1 Cosmetic.
- iframe height: the host's page-chrome offset is **246 px** on phones, not 240. The 560 px `minHeight` also forces a host scroll on viewports shorter than 806 px. Recommended value: `height: calc(100dvh - 250px)`, `minHeight: 400px` (details in §4.7).

## Key Decisions
- The test continued past the Critical bug by rewriting the `/api/plugins` response inside Playwright (`page.route`). No source code was changed. Every result after §4.1 depends on this shim (see §8).
- Storage was **disabled** in this environment (avatar and banner both return 409). So scenario B covered the banner-failed path (409 "Dodawanie zdjęć jest chwilowo niedostępne" → "Pomiń baner"). The happy path with a thumbnail was not reachable.

## Open Questions / Risks
- **Critical**: the plugin-list response shape (`extension_points` vs `extensionPoints`) breaks every plugin extension point in the host, not only `add.event`. The host's own tests stub `getPlugins` with camelCase, so they do not catch it.
- The dev DB holds a second registration with id `Events` (capitalised) besides `events`. Both are enabled with priority 10, and the host picks `Events` because it is listed first. This is data, not code; consider deleting it.
- The banner happy path (two public WebP files, thumbnail on the confirmation card) was **not** verified at runtime, because Spaces is not configured on this backend.

## 1. Identifier
- **Task**: 2026-10-28-events-plugin (Events plugin at /add/event)
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-28-events-plugin
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-28-events-plugin\implementation\spec.md
- **Date**: 2026-10-28
- **Git ref**: 364c05c (main, uncommitted working-tree changes of this task)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Vite, proxies /api → 8080); plugin http://localhost:3004; backend http://localhost:8080 |
| Browser | Playwright MCP (Chromium) |
| Viewport | 360×800 (main), 390×844 (sheet/height), 1280×800 (desktop); probes at 480/639/640/767/768 widths |
| Auth context | Newly registered GUEST user (READ, EDIT) `e2e-events-1793198641@example.test`; a second test user with `PLUGIN_MANAGEMENT` was used for plugin registration and toggling |
| Test data | Live local dev DB (Postgres 18 container); migration applied 0069 → 0070 during preflight; storage **disabled** (409 mode) |

**Preflight results**
1. Backend freshness: all three ports answered 200. `POST /api/events` without auth returned **401**, so the route exists on 8080 and no restart was needed. The DB, however, was still at **0069**: the `events` tables were missing. `alembic upgrade head` was run (0069 → 0070) and the three tables now exist.
2. SDK: `http://localhost:5173/assets/plugin-sdk.js` contains `uploadImage`, so no rebuild was needed.
3. Plugin registration: `GET /api/plugins/events` returned 404 at first. The dev `admin` account's documented seed password was rejected (it has been changed). A second test user was therefore given `PLUGIN_MANAGEMENT` through SQL, and `PUT /api/plugins/events/manifest` returned 200.
4. Storage mode: **disabled**. `POST /api/people/me/avatar` and the banner upload both return 409.

## 3. Executive Summary
**Verdict**: ❌ NO-GO

| Metric | Count |
|---|---|
| Scenarios planned | 10 |
| Scenarios executed | 10 |
| Passed | 9 |
| Failed | 1 |
| Blocked | 0 |
| Pass rate | 90% |
| Critical issues | 1 |
| Major issues | 0 |
| Minor issues | 2 |
| Cosmetic issues | 1 |

Scenario counts: of the 9 that passed, 5 passed cleanly and 4 passed with issues (⚠️).

The plugin itself works well, and so do the host's `done` and `uploadImage` handling. The form, Polish validation, the `aria-disabled` submit pattern, the location sheet (focus trap, Esc, focus return, inline add-place), the two-step saving screen, the banner-failed screen with retry and skip, the confirmation card built from the POST response, and the `done` → `/add` toast all behave as specified. The headline problem is the host's plugin discovery. The host reads `extensionPoints` from `/api/plugins`, but the FastAPI backend returns `extension_points`. A real user therefore never sees the iframe and always gets the "niedostępny" fallback. Two smaller layout issues remain. The iframe height leaves a 6 px host scroll on phones and a 70 px host scroll on wide screens. A stale banner error stays visible after an invalid file is rejected.

## 4. Verification Scenarios

### 4.1 Plugin discovery on /add/event with the real backend — ❌ Failed
- **User story / acceptance criterion**: Goal; Req 14–15; Success Criteria "Event created end to end"
- **Preconditions**: Logged-in GUEST user. Plugin `events` registered and enabled (and the pre-existing `Events` also enabled). No shim.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Home → "Dodaj nowe" (+) | `/add` hub with an "Wydarzenie" tile | Hub shown with tile → `/add/event` | ✅ |
| 2 | Click "Wydarzenie" | Host header "Nowe wydarzenie" + iframe "Formularz nowego wydarzenia" | Header + fallback "Plugin wydarzeń jest niedostępny" | ❌ |
| 3 | `fetch('/api/plugins')` in the page | Items expose `extensionPoints` | Keys: `id,name,version,url,description,enabled,extension_points` | ❌ |

- **Issues observed**: §5.1 C1
- **Evidence**: `screenshots/01-add-hub.png`, `screenshots/00-bug-fallback-with-enabled-plugin.png`
- **Acceptance criteria checklist**:
  - [x] Hub link points to `/add/event`
  - [ ] An enabled plugin with `add.event` renders the iframe

### 4.2 A — Happy path without banner (360×800, shim active) — ⚠️ Passed with issues
- **User story / acceptance criterion**: User stories 1 and 3; Req 15, 18, 19, 20; screens event-form-empty / event-saved / add-hub-toast
- **Preconditions**: Shim active. No banner. A new place was added in the sheet.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/add/event` | Header "Nowe wydarzenie", iframe titled "Formularz nowego wydarzenia", blank date/time fields | As expected; the iframe `src` is `http://localhost:3004/#RENDER{…}`; all inputs blank | ✅ |
| 2 | Inspect submit | `aria-disabled="true"`, `aria-describedby` → visible submit.hint | `aria-disabled="true"`, `event-submit-hint` = "Uzupełnij nazwę oraz datę i godzinę początku, aby zapisać.", native `disabled=false` | ✅ |
| 3 | Fill name "Piknik testowy E2E", 2026-11-15 14:00, end 18:00, description | Counter updates, no errors | "50 / 2000", no field errors | ✅ |
| 4 | Location → "+ Dodaj nowe miejsce" → Nazwa/Adres → "Dodaj miejsce" | `POST /api/locations` 201, place selected, sheet closes, focus back on trigger | 201; row shows "Park Skaryszewski E2E / al. Waszyngtona… / Zmień ›"; focus on `#event-location-button` | ✅ |
| 5 | "Zapisz wydarzenie" | `POST /api/events` with naive `YYYY-MM-DDTHH:mm:00` strings | Body `starts_at:"2026-11-15T14:00:00"`, `ends_at:"2026-11-15T18:00:00"`, `location_id`; 201 | ✅ |
| 6 | Confirmation | `role="status"` card from the POST response | "Wydarzenie zapisane / Piknik testowy E2E / niedziela, 15 listopada · 14:00–18:00 / Park Skaryszewski E2E, al. Waszyngtona, 03-902 Warszawa" | ✅ |
| 7 | "Wróć do dodawania" | `/add` + toast "Wydarzenie „…” zapisane" | URL `/add`; `role="status"` toast "Wydarzenie „Piknik testowy E2E” zapisane" | ✅ |
| 8 | DB check | Row with the caller's `author_party_id`, naive times | `events` b0a099e8…: 2026-11-15 14:00/18:00, author = the test user's party b8de5d9a…, location d436c69a… | ✅ |

- **Issues observed**: The scenario only works with the shim (§5.1 C1). A stale banner error from scenario C stayed visible during this flow (§5.3 m2).
- **Evidence**: `screenshots/02-event-form-empty.png`, `screenshots/10-form-filled-location.png`, `screenshots/12-form-filled-before-submit.png`, `screenshots/13-event-saved.png`, `screenshots/14-add-hub-toast.png`
- **Acceptance criteria checklist**:
  - [x] Event persisted with the caller's party and naive Warsaw times
  - [x] Confirmation uses POST data
  - [x] `done` → `/add` + toast

### 4.3 B — With banner, storage disabled (409 path) — ✅ Passed
- **User story / acceptance criterion**: User stories 2 and 5; Req 4, 12, 20.3; screens event-saving / event-banner-failed
- **Preconditions**: Shim active. Spaces not configured. Banner JPG 58 KB; later a PNG 3 KB.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Choose `banner.jpg` | Preview + "Zmień"/"Usuń" chips | `img[src^=blob:]` preview; buttons "Zmień baner", "Usuń baner" | ✅ |
| 2 | Save (requests delayed 2.5 s to capture the steps) | "Zapisujemy „{name}”…", step list, "Nie zamykaj tej strony.", natively disabled "Zapisywanie…" | Step 1 "Zapisywanie wydarzenia… / Wysyłanie banera"; step 2 "✓ Wydarzenie zapisane / Wysyłanie banera…"; button `disabled` "Zapisywanie…" | ✅ |
| 3 | Banner upload request | multipart `file`, Bearer, `X-Requested-With: PluginFetch` | `multipart/form-data; boundary=…`, `X-Requested-With: PluginFetch`, Bearer present | ✅ |
| 4 | Response 409 | banner-failed screen with banner.failed + 409 detail | "Nie udało się wysłać banera. Wydarzenie jest zapisane bez banera." + "Dodawanie zdjęć jest chwilowo niedostępne"; "Spróbuj ponownie" / "Pomiń baner" | ✅ |
| 5 | "Spróbuj ponownie" | Re-upload to the same event | Second `POST …/7f25009f…/banner` → 409; same screen | ✅ |
| 6 | "Pomiń baner" | Saved card | "Wydarzenie zapisane / Urodziny z banerem E2E / piątek, 20 listopada · 16:30" (no end → "· 16:30") | ✅ |
| 7 | "Dodaj kolejne" | Empty form | All inputs empty, location reset | ✅ |

- **Issues observed**: _None observed._ The thumbnail happy path was not reachable (see §8).
- **Evidence**: `screenshots/15-form-with-banner.png`, `screenshots/19-saving-step1.png`, `screenshots/20-saving-step2-banner.png`, `screenshots/17-banner-failed.png`, `screenshots/18-skip-banner-saved.png`
- **Acceptance criteria checklist**:
  - [x] Event stays saved when the banner fails; retry and skip work
  - [ ] Banner stored as APPROVED + two WebP files (not verifiable: storage disabled)

### 4.4 C — Validation — ⚠️ Passed with issues
- **User story / acceptance criterion**: User story 4; Req 17, 18; screen event-form-errors; Copy table
- **Preconditions**: Shim active, empty form.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click the blocked submit (forced click; Playwright treats `aria-disabled` as not enabled) | All field errors revealed, no save | "Podaj nazwę wydarzenia.", "Podaj datę i godzinę początku."; `aria-invalid` on name, date and time with `aria-describedby` → `event-name-error` / `event-start-error`; no POST | ✅ |
| 2 | Name "ab", start 2026-10-27 10:00, end 09:00, then blur | name.length, start.past, end.notAfter | "Nazwa musi mieć od 3 do 120 znaków.", "Początek nie może być w przeszłości.", "Koniec musi być później niż początek."; submit `aria-disabled` | ✅ |
| 3 | End equal to start (10:00/10:00) | end.notAfter | "Koniec musi być później niż początek." | ✅ |
| 4 | Clear the end | Valid; submit enabled | No errors; `aria-disabled` removed | ✅ |
| 5 | Start 2029-01-10 | start.tooFar | "Początek może być najwyżej 2 lata od dziś." | ✅ |
| 6 | Banner GIF | banner.invalid | "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP"; file not kept | ✅ |
| 7 | Banner 5.86 MB PNG | banner.tooLarge | "Baner jest za duży (maks. 5 MB)"; file not kept | ✅ |
| 8 | Continue to a valid draft without a banner | Banner error clears | The "Baner jest za duży" alert stays visible through submit | ⚠️ |

- **Issues observed**: §5.3 m2
- **Evidence**: `screenshots/03-blocked-submit-errors.png`, `screenshots/04-validation-errors.png`, `screenshots/05-banner-gif-rejected.png`, `screenshots/06-banner-too-large.png`, `screenshots/12-form-filled-before-submit.png`
- **Acceptance criteria checklist**:
  - [x] Clicking the `aria-disabled` submit reveals every field error
  - [x] Plugin copy matches the Copy table for name, start, end and banner
  - [ ] Banner error state resets when no invalid file is held

### 4.5 Location sheet accessibility and add-place validation — ✅ Passed
- **User story / acceptance criterion**: User story 3; Req 19; screen event-location-picker
- **Preconditions**: Shim active, form partly filled.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the sheet | `role="dialog"` `aria-modal`, "Lokalizacja", ✕, all buttons `type="button"` | `aria-modal="true"`; buttons ✕ / "+ Dodaj nowe miejsce" / "Bez lokalizacji", all `type=button`; focus moves into the dialog | ✅ |
| 2 | "+ Dodaj nowe miejsce" → forced click on blocked "Dodaj miejsce" | `aria-disabled` + hint; place.name / place.address | `aria-disabled="true"`, hint "Uzupełnij nazwę i adres miejsca."; errors "Podaj nazwę miejsca.", "Podaj adres miejsca."; `maxLength` 255/500 | ✅ |
| 3 | Reopen with a saved place; Tab ×6, Shift+Tab | Focus stays in the sheet | Cycle ✕ → place → "+ Dodaj nowe miejsce" → "Bez lokalizacji" → ✕ …; never left the dialog | ✅ |
| 4 | Esc | Closes; focus returns to the trigger; selection kept | Dialog gone; focus `#event-location-button`; place still selected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-location-sheet.png`, `screenshots/09-add-place-errors.png`, `screenshots/11-location-sheet-list.png`
- **Acceptance criteria checklist**:
  - [x] Focus trap, Esc, focus return
  - [x] Inline add-place with `aria-disabled` pattern and place.* copy

### 4.6 D — Plugin disabled fallback — ✅ Passed
- **User story / acceptance criterion**: User story 6; Req 14–15; screen event-plugin-unavailable
- **Preconditions**: `PATCH /api/plugins/{events,Events}/enabled {"enabled":false}` (200). `GET /api/plugins` for the user returned `[]`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/add/event` | Host card 🎈 + unavailable copy, no iframe | "🎈 / Plugin wydarzeń jest niedostępny / Dodawanie wydarzeń jest chwilowo wyłączone. Spróbuj później."; 0 iframes | ✅ |
| 2 | "Wróć do dodawania" | `/add` | href `/add`; navigated to `/add` | ✅ |
| 3 | Re-enable both registrations | 200 | 200 / 200; both enabled again | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/21-plugin-unavailable.png`
- **Acceptance criteria checklist**:
  - [x] Polish fallback with a back link when the plugin is disabled

### 4.7 E — Step 6.5 iframe height at 360×800 and 390×844 with the sheet open — ⚠️ Passed with issues
- **User story / acceptance criterion**: Key Decision "fixed viewport-relative height"; Open Question "Iframe height offset"; Req 15 (`style.height`)
- **Preconditions**: Shim active. Location sheet open. Current `FRAME_STYLE` = `height: calc(100dvh - 240px); min-height: 560px`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | 360×800, sheet open | Only the iframe scrolls; sheet and submit not clipped | iframe top 150.8 → bottom 710.8 (h 560, set by minHeight). Bottom nav top 729.2; wrapper `padding-bottom` 24 px. Host `scrollHeight` 806 vs 800 → **6 px host scroll** (`scrollY` 5.6 observed). Inside: frame `innerHeight` 560, doc 857, the plugin scrolls; dialog spans 368–560, fully visible | ⚠️ |
| 2 | 390×844, sheet open | Same | iframe h 604 (calc), host `scrollHeight` 850 vs 844 → **6 px host scroll**; sheet fully visible above the FAB | ⚠️ |
| 3 | Live-test offsets (DOM style only, restored afterwards) | `scrollHeight == innerHeight` | `calc(100dvh-246px)` + `minHeight:480px` → 844/844 and 800/800. `-250px` → 800/800, iframe bottom 700.8 (FAB top ≈708, nav 729). At 360×640, minHeight 480 still overflows (726/640) | ✅ |

- **Measured chrome**: iframe top 150.8 px + wrapper bottom padding 24 px + bottom nav 70.8 px = **245.6 px ≈ 246 px** (phones, width < 640). The FAB's top edge sits about 21 px above the nav (top ≈ 708 at 800 high).
- **Recommended FRAME_STYLE** (src/frontend/src/pages/add/EventCreateView.tsx):
  - Phone, preferred: `{ height: "calc(100dvh - 250px)", minHeight: "400px" }`. 246 is the exact chrome; the extra 4 px absorbs sub-pixel rounding and keeps the iframe bottom about 7 px clear of the FAB. The `minHeight` must drop below 560: with 560, any viewport under 806 px tall will scroll the host.
  - For widths ≥ 640 px the chrome grows (see §4.8): `iframe top` 182.8 → 278 px needed at 639/640×900, and **310 px** needed at 1280×800. If one inline value must cover every width, use `calc(100dvh - 312px)`; it costs about 62 px of empty space on phones. Otherwise, move the height to responsive classes, e.g. `h-[calc(100dvh-250px)] sm:h-[calc(100dvh-282px)] lg:h-[calc(100dvh-314px)] min-h-[400px]`. The `lg` boundary was inferred from the 1280 px measurement and should be confirmed.
- **Issues observed**: §5.3 m1
- **Evidence**: `screenshots/07-location-sheet.png`, `screenshots/08-sheet-390x844.png`, `screenshots/11-location-sheet-list.png`
- **Acceptance criteria checklist**:
  - [x] Sheet and its buttons fully visible inside the iframe
  - [ ] Host panel does not scroll as well

### 4.8 Desktop width (1280×800) — ⚠️ Passed with issues
- **User story / acceptance criterion**: Layout guidance (mobile-first, no horizontal scroll); Req 15
- **Preconditions**: Shim active, empty form.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/add/event` at 1280×800 | Form renders, no horizontal scroll | Form renders at full width (iframe 1116 px wide); host `scrollWidth` 1265 < 1280; plugin `scrollWidth` = `clientWidth` (1101) | ✅ |
| 2 | Vertical fit | No host scroll | iframe top 182.8, bottom 742.8 > nav top 729.2 → about **13 px of iframe under the bottom nav**, host `scrollHeight` 870 vs 800 (**70 px host scroll**) | ⚠️ |

- **Issues observed**: §5.3 m1
- **Evidence**: `screenshots/22-desktop-form.png`
- **Acceptance criteria checklist**:
  - [x] No horizontal scroll
  - [ ] No double vertical scroll

### 4.9 Backend error paths and copy (API) — ✅ Passed
- **User story / acceptance criterion**: Req 3, 4, 6; Success Criteria "Banner endpoint errors" and "Existing 403 responses still say Access denied"
- **Preconditions**: curl with the test users' tokens (not printed).

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `POST /api/events` `{}` | 400 start.missing | 400 "Podaj datę i godzinę początku." | ✅ |
| 2 | `starts_at` with an offset | 400 datetime.aware | 400 "Podaj datę i godzinę bez strefy czasowej." | ✅ |
| 3 | `ends_at` next day 00:00 | 400 end.otherDay | 400 "Koniec musi przypadać tego samego dnia co początek." | ✅ |
| 4 | Banner on another user's event | 403 banner.notAuthor | 403 "Możesz dodać baner tylko do swojego wydarzenia." | ✅ |
| 5 | Banner on a missing event | 404 banner.notFound | 404 "Nie znaleziono wydarzenia." | ✅ |
| 6 | Banner as author, storage off | 409 banner.disabled | 409 "Dodawanie zdjęć jest chwilowo niedostępne" | ✅ |
| 7 | `PATCH /api/plugins/events/enabled` as a plain user | 403 "Access denied" (unchanged) | 403 "Access denied" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: inline (curl output, §4.9 table). No screenshot, because these are API-only checks.
- **Acceptance criteria checklist**:
  - [x] Polish 404/403/409 for the banner endpoint, in that order
  - [x] Existing 403 keeps "Access denied"

### 4.10 F — Console on both origins — ✅ Passed
- **User story / acceptance criterion**: Orchestrator scenario F
- **Preconditions**: All scenarios above.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Collect console errors and warnings (host + iframe) | No feature errors | Only expected 409 resource errors on `/banner`, the pre-existing `/api/organizations/mine` 404, the iframe sandbox warning, and a favicon 404 from the test helper; no errors from origin 3004 | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: §6
- **Acceptance criteria checklist**:
  - [x] No feature console errors

## 5. Discrepancies

### 5.1 Critical
**C1 — Host never finds the `add.event` extension point (`extension_points` vs `extensionPoints`)**
- **Spec requirement**: Req 14 "`{ kind: "ready", point }` with the first point by priority"; Success Criteria "a logged-in user creates an event through the plugin".
- **Expected**: With `events` registered and enabled, `/add/event` renders the iframe "Formularz nowego wydarzenia".
- **Actual**: The fallback "Plugin wydarzeń jest niedostępny" is shown. `GET /api/plugins` returns 200, but each item carries `extension_points`. `resolveExtensionPoints` iterates `plugin?.extensionPoints ?? []`, so it gets an empty list.
- **Evidence**: `screenshots/00-bug-fallback-with-enabled-plugin.png`; in-page fetch keys `id,name,version,url,description,enabled,extension_points`
- **Root cause hypothesis**: `src/backend/app/plugin/schemas.py` `PluginResponse.extension_points` has no camelCase serialization alias; it has been this way since the migration (commits 1117c3b/23a5dd8). `src/frontend/src/api/plugins.ts` `PluginResponse.extensionPoints` expects camelCase. The bug predates this task, but the feature depends on it. Unit tests (`AppPage.test.tsx`, `eventCreateViewState.test.ts`) stub camelCase fixtures, so they miss it. The same breakage likely affects the admin plugin pages and product-detail frames (`PluginContext`, `ProductDetailPage`).
- **User impact**: The feature is unreachable for every user. They always see the "unavailable" fallback.
- **Recommended fix**: Pick one side and align it everywhere. Either add `serialization_alias="extensionPoints"` (or a camel alias generator plus `response_model_by_alias`) on the plugin response model, or map `extension_points` → `extensionPoints` in `api/plugins.ts` `getPlugins`/`getPlugin`. Then add one integration-shaped test that uses the real response shape.
- **Workaround**: None for users. For testing, rewrite the `/api/plugins` response, as was done here.

### 5.2 Major
_None observed._

### 5.3 Minor
**m1 — iframe height offset leaves a second (host) scroll; on wide screens the iframe bottom sits under the bottom nav**
- **Spec requirement**: Open Question "Iframe height offset … Tune it during implementation so the panel itself does not scroll as well"; Key Decision "fixed viewport-relative height and the plugin scrolls inside it".
- **Expected**: Only the iframe scrolls; host `scrollHeight == innerHeight`.
- **Actual**: 360×800 and 390×844: 6 px host scroll (chrome is 246 px, not 240; at 800 high the 560 px `minHeight` also applies). 1280×800: 70 px host scroll, and about 13 px of the iframe sits under the bottom nav.
- **Evidence**: `screenshots/08-sheet-390x844.png`, `screenshots/22-desktop-form.png`, measurements in §4.7–4.8
- **Root cause hypothesis**: `FRAME_STYLE` uses `calc(100dvh - 240px)` with `minHeight: 560px`. The real chrome is 246 px on phones and 278–310 px at ≥640 px widths, where the layout adds padding.
- **User impact**: Double scroll. On desktop, the last ~13 px of the plugin (for example the submit's bottom edge when scrolled to the end) is hidden until the host page is scrolled.
- **Recommended fix**: `{ height: "calc(100dvh - 250px)", minHeight: "400px" }` for phones. Use responsive classes or `calc(100dvh - 312px)` to cover wider layouts (see §4.7).
- **Workaround**: Scroll the host page by the few pixels it overflows.

**m2 — Stale banner validation error after a rejected file**
- **Spec requirement**: Req 17 `validateDraft` banner checks; Req 18 "Each field shows its error"; validation standard (errors reflect the current input).
- **Expected**: After a GIF or >5 MB file is rejected and not kept, the error clears once the banner field holds no invalid file (or at least on the next valid action). The submit stays enabled.
- **Actual**: "Baner jest za duży (maks. 5 MB)" stays visible under the empty drop zone while the rest of the form is valid and submittable, and through a successful submit. The submit is not blocked (`aria-disabled` is absent), so the alert contradicts the button state.
- **Evidence**: `screenshots/06-banner-too-large.png`, `screenshots/12-form-filled-before-submit.png`
- **Root cause hypothesis**: The rejected-file error is kept in separate component state and is only reset when a valid file is chosen, not when the rejected file is discarded.
- **User impact**: Confusing. The user may think the event will fail, or that a file is attached.
- **Recommended fix**: Clear the banner error on the next interaction, or show it as a transient message tied to the rejected selection. Alternatively, keep it only while an invalid file is the selected banner.
- **Workaround**: Choose a valid banner (the error then clears), or ignore the message.

### 5.4 Cosmetic
**c1 — Saving screen has no progress bar**
- **Spec requirement**: screen:event-saving mockup (`zapisywanie-wydarzenia.html`).
- **Expected**: Two-step card with a progress bar under the steps.
- **Actual**: The two steps, the note and the disabled "Zapisywanie…" match, but there is no progress bar.
- **Evidence**: `screenshots/20-saving-step2-banner.png`, `screenshots/mockup-zapisywanie-wydarzenia.png`
- **Root cause hypothesis**: Deliberately omitted (upload progress is not observable through `uploadImage`).
- **User impact**: None functionally; a slightly plainer look.
- **Recommended fix**: Optional. Accept the deviation, or add an indeterminate bar.
- **Workaround**: None needed.

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `http://localhost:5173/api/events/{id}/banner` | 409 (Conflict) resource error | 4 (one per upload attempt) | Minor | Expected in storage-disabled mode; the UI handles it |
| `http://localhost:5173/api/organizations/mine` | 404 (Not Found) | Every panel load | Minor | Pre-existing, unrelated to this task (GUEST without an organization) |
| `react-dom_client.js:6805` | "An iframe which has both allow-scripts and allow-same-origin … can escape its sandboxing." | Each PluginFrame mount | Minor | Pre-existing PluginFrame sandbox setting; not introduced by this task |
| `http://127.0.0.1:8765/favicon.ico` | 404 | 1 | Cosmetic | Test helper server only; ignore |

No console errors from the plugin origin (`http://localhost:3004`).

## 7. Spec Alignment
- **Fully implemented**:
  - Backend `POST /api/events` validation copy (start.missing, datetime.aware, end.otherDay; plus past, tooFar, notAfter and name/description through the plugin) and 201 `EventResponse` with exactly the specified keys
  - Banner endpoint 404 → 403 → 409 order with Polish copy; `public_message` 403; existing 403 "Access denied"
  - Migration 0070 (three tables created in the dev DB)
  - `uploadImage` host handling (FormData `file`, Bearer, `X-Requested-With: PluginFetch`, `pluginFetch` envelope); `done` → toast + `/add`
  - `EventCreateView`: SubPageHeader, iframe title, `RENDER` context prefix, fallback card with 🎈 and back link
  - Plugin form: blank date and time, field order, `maxLength`s, counter, `accept`, blob preview with Zmień/Usuń, `aria-disabled` submit + hint, reveal-all-errors on click, `aria-invalid`/`aria-describedby`, `role="alert"`
  - Location sheet: dialog, focus trap, Esc, focus return, inline add-place (201 → selected), "Bez lokalizacji"
  - Saving steps, banner-failed retry/skip, saved card with the `pl-PL` date line, "Dodaj kolejne" reset
- **Partially implemented**:
  - Plugin discovery in the panel: correct logic, but it reads a key the backend does not send (C1)
  - iframe height tuning (m1)
  - Banner error state (m2)
- **Not implemented**:
  - _None observed._ The banner success path is unverified because storage is disabled, not because it is missing.
- **Extra (unspecified) behavior**:
  - The add-place hint text reuses place.invalid "Uzupełnij nazwę i adres miejsca." as the `aria-describedby` hint. This is acceptable but not in the Copy table as a hint.

## 8. Variances from Plan
- **Route shim**: from §4.2 onward, Playwright `page.route` rewrote `GET /api/plugins` to add `extensionPoints` = `extension_points`. Without it, no plugin scenario can run (C1). No source file was modified.
- **Storage disabled**: the banner success path (thumbnail on the confirmation, two WebP files, `event_banners` row) was not exercised. Only the 409 path was.
- **Migration**: the dev DB was at 0069; `alembic upgrade head` was applied (→ 0070) during preflight.
- **Admin account**: the seeded `admin` password no longer works. A test user `e2e-plugadmin-1793198729@example.test` was given `PLUGIN_MANAGEMENT` through SQL to register and toggle the plugin.
- **Duplicate registration**: a pre-existing plugin row `Events` (same manifest) was also enabled and was the one the host chose. Scenario D disabled both, and both were re-enabled afterwards.
- **Saving screen capture**: requests were delayed 2.5 s with `page.route` so that the transient steps could be photographed.
- **Auth injection**: the JWT was put into `localStorage.auth_token` from a file through a short-lived local helper server, so no token was printed; it was not entered through the login form.
- **Data created in the local dev DB**: users `e2e-events-1793198641@example.test` (party b8de5d9a-1fdc-48ca-8e54-84a0147c7e4c) and `e2e-plugadmin-1793198729@example.test` (+PLUGIN_MANAGEMENT); plugin registration `events`; location d436c69a-6b8e-4ab8-b69b-c533d4ec61dd "Park Skaryszewski E2E"; events b0a099e8-7163-4901-9da5-3634ae761e5e, 7f25009f-ac85-4c96-a0ad-a078242f1c5c, e91aa41b-76c1-4044-980d-f146e20de6da; no `event_banners` rows.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| "Event created end to end … `events` then holds the caller's `author_party_id` and naive Warsaw times." | ❌ | Works only with the shim (§4.2); without it the user cannot reach the form (C1) |
| "A chosen banner gives one `APPROVED` row in `event_banners` and two public WebP files." | ❌ | Not verifiable: storage disabled (409); 0 banner rows |
| "Validation copy matches … The plugin shows the same text inline before submitting. Clicking the `aria-disabled` submit reveals every field error." | ✅ | §4.4, §4.9 |
| "Banner endpoint errors … 404, 403, 409 … and 400 for too large or invalid, in that order." | ✅ | §4.9 (404/403/409 verified; 400 too-large/invalid covered client-side in §4.4) |
| "Without the plugin, or with it disabled, `/add/event` shows the Polish fallback … Existing 403 responses still say 'Access denied'." | ✅ | §4.6, §4.9 step 7 |
| "`done` returns the user to `/add` with the toast … `uploadImage` refuses any path, size or MIME type outside its rule." | ✅ | §4.2 step 7, §4.3 step 3 (refusal paths covered by the plugin's own pre-checks; host refusal is unit-tested, not exercised here) |
| "Migration. 0070 creates and drops all three tables cleanly." | ✅ | Upgrade 0069 → 0070 created `events`, `event_banners`, `event_attendances` (downgrade not exercised) |

## 10. Recommendations
- **Must fix before merge**: §5.1 C1 (plugin list key shape)
- **Should fix soon**: §5.3 m1 (FRAME_STYLE → `calc(100dvh - 250px)` / `minHeight: 400px`, plus a wide-screen offset), §5.3 m2 (stale banner error)
- **Nice-to-have**: §5.4 c1 (progress bar); delete the stray `Events` plugin row in dev; re-run scenario B with Spaces configured to verify the thumbnail path

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (31 files: 22 runtime captures + 9 rendered mockups `mockup-*.png`)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ❌ NO-GO. The events plugin, the backend module and the host's `done`/`uploadImage` plumbing behave as specified when the plugin is discovered. In the real stack, however, the host reads `extensionPoints` while the backend sends `extension_points`, so every user lands on the "niedostępny" fallback. Fix the response shape (C1), then re-run scenario A without the shim. Fix-then-merge, ideally together with the FRAME_STYLE adjustment (m1) and the stale banner error (m2).

---

## Addendum — 2026-10-28T15:48:10Z — fixes after E2E (verdict updated)

**Updated verdict: GO (for the local/dev environment), conditional on the plugin hosting follow-up for prod.**

| Finding | Fix | Re-check |
|---|---|---|
| C1 (critical) `extension_points` vs `extensionPoints` | mapping at the boundary `src/frontend/src/api/plugins.ts` (`PluginWire` + `toPlugin()` in getPlugins/getPlugin/uploadManifest/setPluginEnabled); test `src/test/pluginsApi.test.ts` with the real backend shape | ✅ live: `/add/event` renders the iframe http://localhost:3004/ with no shim |
| m1 / step 6.5 iframe height | wrapper `h-[calc(100dvh-250px)] min-h-[400px] min-[520px]:h-[calc(100dvh-314px)]` (PhoneFrame breakpoint 520 px) | ✅ scrollHeight = innerHeight at 360×800, 390×844, 519/520×800, 640×900, 1280×800; residual overflow only on very short screens (min-height 400 px) |
| m2 stale banner error | `BannerPicker` clears the error on blur outside the picker / valid file / "Usuń" | ✅ live at 390×844 |
| N2 / N3 parser | 201 unparsable → create.unconfirmed; bad `location` → null | ✅ build + spec updated |
| c1 no progress bar | not changed (deliberate — no real progress data) | — |

Tests: 172 passed (new pluginsApi.test.ts passes), 2 pre-existing failures in extension-points.test.tsx (outdated fixtures: "Krąg grupy", plugin filter iframes — unrelated to C1, the file mocks api/plugins). tsc + eslint clean; plugin build OK.
Additional data in the dev DB: GUEST user e2e-fix-1793202317342@example.test. Note: the dev DB has a second enabled registration `Events` (capital E) — worth removing.
