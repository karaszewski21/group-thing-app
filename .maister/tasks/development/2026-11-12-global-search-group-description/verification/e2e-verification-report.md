# E2E Verification Report

## TL;DR
- **Verdict: GO WITH CAVEATS.** All 11 scenarios executed in the browser; 11 passed (2 of them with minor issues), 0 failed, 0 blocked.
- Guest and logged-in `/search`, mode/scope switching, filters (including the guest Kategoria tree), the other-mode line, the empty state with „Dodaj do listy „szukam””, the reserved label, URL state and back navigation all behave as the spec says.
- The group description works end to end: textarea with `n / 500` counter, inline error and disabled submit above 500, verbatim server rejection, edit prefill, full text in the terms header, and search hits on description-only words with the card clamped to 2 lines.
- No Critical or Major findings. 2 Minor (rapid back-to-back filter changes drop the first filter; an inverted date range is sent to the server, which returns 400) and 3 Cosmetic.

## Key Decisions
- Logged in with a throwaway account registered through the UI (`/login?mode=register`). No credentials from `.env` were used, and none are recorded here.
- Seed data created through the UI: two groups (`E2E Grupa opisowa`, person-run, and `E2E Klub Planszówek`, org-run PUBLIC) and an organization (`E2E Pracownia Wyszukiwania 18547`). The org was needed for the terms-page header scenario.
- The accepted deviations listed by the orchestrator are reported in §7 and §8, and are not counted as failures.

## Open Questions / Risks
- Minor: two filter changes in the same tick (0 ms apart) lose the first one. This cannot be reproduced at 100 ms or more, so real users are unlikely to hit it (§5.3 M1).
- Minor: the meetings date filter does not check the range on the client. When Od > Do it still sends the request, which gets a 400 and logs a console error. The server message is shown verbatim (§5.3 M2).
- „Moje grupy” item results with real matches, and the ordering of description-only vs name-matched groups, could not be set up in dev data with a fresh account. They are covered by the backend tests (§8).

## 1. Identifier
- **Task**: 2026-11-12-global-search-group-description
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-12-global-search-group-description
- **Spec**: implementation/spec.md (including "Verification amendments (fix cycles)")
- **Date**: 2026-11-13
- **Git ref**: b8c45e0 (main, uncommitted working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Next dev; `/api` proxied to the backend on :8080; dev DB at 0096) |
| Browser | Playwright MCP Chromium |
| Viewport | 430×900 (mobile-first panel) |
| Auth context | anonymous guest; a freshly registered test user (later founder of a test organization) |
| Test data | live dev DB plus records created through the UI |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 11 |
| Scenarios executed | 11 |
| Passed | 11 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 2 |
| Cosmetic issues | 3 |

Guests can use `/search` without a login redirect. They see no scope control and always search Wszędzie, and the Kategoria tree works for them. Logged-in users get the Moje grupy / Wszędzie toggle, defaulting to Moje grupy. Every result kind (item, term, event, group, organization) links to an existing page, and back navigation restores the query, mode, scope and results. The group description round-trips through create, edit, the terms header and search. The only defects are two Minor edge cases in the filter controls and three Cosmetic points.

## 4. Verification Scenarios

### 4.1 Guest access, hint under 2 characters, debounce — ✅ Passed
- **User story / acceptance criterion**: Spec E.18–E.20 (guest branch, ≥2 chars, 300 ms debounce); screen:search-guest, screen:search-hint
- **Preconditions**: anonymous browser context

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/search` | no redirect; „Zaloguj się” link; no scope toggle | page renders; „Zaloguj się” → `/login?returnTo=%2Fsearch`; 0 radios | ✅ |
| 2 | Type `k` | hint, no request | „Wpisz co najmniej 2 znaki, żeby zacząć szukać.”; 0 `/api/public/search` requests | ✅ |
| 3 | Type `ar` (now `kar`) | one debounced request | exactly 1 request `q=kar&mode=items&scope=all`; „68 przedmiotów dla „kar”” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-guest-search-initial.png`, `screenshots/02-guest-one-char-hint.png`, `screenshots/03-guest-items-results.png`
- **Acceptance criteria checklist**:
  - [x] `/search` public, not in `PROTECTED_PREFIXES`
  - [x] scope control hidden for guests; request uses `scope=all`
  - [x] no request below 2 characters

### 4.2 Guest item results, „Pokaż więcej”, Stan / tryb filters — ⚠️ Passed with issues
- **User story / acceptance criterion**: Spec E.19, E.21; screen:search-items
- **Preconditions**: guest, `q=kar`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click „Pokaż więcej” | next page appended | 20 → 40 product cards | ✅ |
| 2 | Stan: Dobry, wait, click „Oddam” | both filters in URL and request | `condition=GOOD&offer_type=GIFT`; 38 → 25 results | ✅ |
| 3 | Stan: Dobry and „Oddam” in the same tick (0 ms) | both filters kept | only `offer_type=GIFT` kept | ⚠️ |

- **Issues observed**: §5.3 M1
- **Evidence**: `screenshots/04-guest-items-filtered.png`
- **Acceptance criteria checklist**:
  - [x] infinite query with „Pokaż więcej”
  - [x] Stan and Oddam/Zamienię filters narrow results and live in the URL

### 4.3 Mode switch and other-mode line — ✅ Passed
- **User story / acceptance criterion**: Spec E.20, OtherModeLine; component:other-mode-line
- **Preconditions**: guest; `q=kar` with filters, then `q=gra`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | With filters set, click tab Spotkania | `q` kept, filters cleared | URL `?q=kar&mode=events`, input still `kar` | ✅ |
| 2 | Items `q=gra` (0 results) | highlighted other-mode line | „6 spotkań pasuje do „gra” →” shown in a highlighted block under the empty card | ✅ |
| 3 | Click the line | switches to Spotkania, `q` kept, total = count | `?q=gra&mode=events`, „6 spotkań dla „gra”” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/05-guest-meetings.png`, `screenshots/06-guest-items-other-mode-line.png`, `screenshots/07-guest-meetings-gra.png`
- **Acceptance criteria checklist**:
  - [x] mode switch keeps `q`, clears filters
  - [x] `other_mode_count` equals the total after switching

### 4.4 Guest Kategoria picker — ✅ Passed
- **User story / acceptance criterion**: Spec 17a / Q2 (`GET /api/categories` PUBLIC)
- **Preconditions**: guest, `q=kar`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click the Kategoria trigger | tree sheet opens | dialog „Wybierz kategorię” with root categories; anonymous `GET /api/categories` → 200 | ✅ |
| 2 | Dzieci → „Wybierz „Dzieci”” | filter applied | URL `category=<uuid>`, trigger shows „Dzieci”, list re-queried (0 for `kar`; API check `zab` + Dzieci = 126) | ✅ |
| 3 | Empty-state copy (guest, scope all) | scope-neutral copy + link | „Nikt tego jeszcze nie oddaje” + „Dodaj do listy „szukam”” → `/add/hunting?name=kar` | ✅ |

- **Issues observed**: §5.4 C1 (duplicated accessible name)
- **Evidence**: `screenshots/10-guest-category-picker.png`, `screenshots/11-guest-category-applied.png`
- **Acceptance criteria checklist**:
  - [x] the Kategoria filter works for guests

### 4.5 Spotkania date filters — ⚠️ Passed with issues
- **User story / acceptance criterion**: Spec E.21; amendment "date_from/date_to also narrow groups"
- **Preconditions**: guest, `q=gra&mode=events` (6 results)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Do = 2026-11-14 | only items up to 14 Nov; groups only when the next term is in the window | 3 results (group whose next term is 14 Nov, the 14 Nov term, the organization); URL `date_to=2026-11-14` | ✅ |
| 2 | API check: group without terms + `date_to` | group excluded | `q=kangurzyca&date_to=2026-12-31` → 0; without dates → 1 | ✅ |
| 3 | Od = 2026-11-15 (> Do) | understandable error | „Data końcowa nie może być wcześniejsza niż początkowa” shown; request sent and returned 400 (console error) | ⚠️ |

- **Issues observed**: §5.3 M2
- **Evidence**: `screenshots/08-guest-meetings-date-filter.png`, `screenshots/09-guest-meetings-inverted-dates.png`
- **Acceptance criteria checklist**:
  - [x] Od/Do narrow terms, events and groups
  - [x] invalid range produces a Polish message (server-side)

### 4.6 Logged-in scope toggle, empty items, „szukam” prefill — ✅ Passed
- **User story / acceptance criterion**: Spec E.20, E.24; screen:search-empty-items
- **Preconditions**: freshly registered user (no groups at this point)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/search` | radiogroup Moje grupy (checked) / Wszędzie; no „Zaloguj się” | `Moje grupy:true`, `Wszędzie:false`; no login link | ✅ |
| 2 | Type `kar` | request `scope=mine`; empty card in scope-mine copy | `scope=mine`; „Nikt w Twoich grupach tego nie oddaje … Możesz też szukać wszędzie.” | ✅ |
| 3 | Click „Dodaj do listy „szukam”” | `/add/hunting?name=kar`, name prefilled | URL matches; „Czego szukasz?” = `kar` | ✅ |
| 4 | Back, choose Wszędzie | `scope=all` in URL, results | `?q=kar&scope=all`, 68 results | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/12-user-items-mine-empty.png`, `screenshots/13-user-hunting-prefilled.png`, `screenshots/14-user-items-wszedzie.png`
- **Acceptance criteria checklist**:
  - [x] scope toggle shown for logged-in users, default Moje grupy
  - [x] empty-items link prefills the hunting form

### 4.7 Result cards by kind and the reserved label — ✅ Passed
- **User story / acceptance criterion**: SearchResultCard (spec frontend table); component:search-result-row
- **Preconditions**: logged in, scope Wszędzie; `q=gra` (meetings), `q=gniotka` (a reserved item)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click the Wydarzenie card | event page | `/rodzinny-grajdolek/event/…` „Mikołajki” | ✅ |
| 2 | Click the Termin card | term page | `/rodzinny-grajdolek/group/…/term/…` | ✅ |
| 3 | Click the Grupa card (org-run PUBLIC) | group terms page | `/rodzinny-grajdolek/group/…/terms` | ✅ |
| 4 | Click the Organizacja card | `/slug` | `/rodzinny-grajdolek` | ✅ |
| 5 | Reserved item (logged in) | dimmed + „Zarezerwowana do <dd MMM>” | image `opacity-60`, badge „Zarezerwowana do sob 14 lis” | ✅ |
| 6 | Same item as guest | „Zarezerwowana” without a date (amendment) | „Zarezerwowana” | ✅ |
| 7 | Click the product card | product page | `/4e80…/product/2d13…` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/15-user-reserved-gniotka.png`, `screenshots/27-guest-reserved-no-date.png`, `screenshots/16-card-event.png`, `screenshots/16-card-group-terms.png`, `screenshots/16-card-organization.png`
- **Acceptance criteria checklist**:
  - [x] every kind links to an existing page
  - [x] reserved items dimmed, with a date for logged-in users only

### 4.8 Group form „Opis” (create, validation, edit, moderation) — ✅ Passed
- **User story / acceptance criterion**: Spec A.2–A.4, A.6; screen:group-form-description
- **Preconditions**: logged in, `/groups/new`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Inspect the form | Opis textarea between name and visibility, `0 / 500`, hint | order Nazwa → Opis → Widoczność; `#add-group-description` with `aria-describedby` counter + hint | ✅ |
| 2 | 520 characters | `520 / 500`, inline alert, `aria-invalid`, submit disabled | „Opis może mieć najwyżej 500 znaków.”, `aria-invalid=true`, „Dodaj grupę” disabled | ✅ |
| 3 | 500 characters with surrounding whitespace | counts after trim; valid | `500 / 500`, submit enabled | ✅ |
| 4 | Save a 94-character description | 201 with `description` | `POST /api/groups/mine/new` 201, `description` echoed | ✅ |
| 5 | Open `/groups/<id>/edit` | prefilled | `#edit-group-description` holds the saved text, `94 / 500` | ✅ |
| 6 | Save an email + phone number | 400, verbatim banner, no write | 400; banner „Nazwa i opis nie mogą zawierać danych kontaktowych (…)” | ✅ |
| 7 | Save a valid edit | 200 | PATCH 200, new description returned | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/18-group-form-desc-too-long.png`, `screenshots/19-group-form-desc-valid.png`, `screenshots/20-group-created.png`, `screenshots/21-group-edit-prefilled.png`, `screenshots/22-group-edit-contact-info-rejected.png`
- **Acceptance criteria checklist**:
  - [x] counter n/500 counts code points after trim
  - [x] >500 → inline error + disabled submit
  - [x] server rejection shown verbatim
  - [x] edit prefills from `GroupResponse.description`

### 4.9 Group terms header with and without a description — ✅ Passed
- **User story / acceptance criterion**: Spec A.5–A.6; screen:group-terms-header
- **Preconditions**: test user founded an organization, then created the org-run PUBLIC group „E2E Klub Planszówek” with a description

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/<org-slug>/group/<id>/terms` | full description under the group name | the full text appears in a `<p>` with `white-space: pre-line`, no clamp | ✅ |
| 2 | Open an existing group without a description (`rodzinny-grajdolek/…/terms`) | looks as it does today | no description block; hero shows name, nearest term, counts | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/23-group-terms-header-with-description.png`, `screenshots/24-group-terms-header-no-description.png`
- **Acceptance criteria checklist**:
  - [x] full description in the terms header
  - [x] unchanged without a description

### 4.10 Search finds a group by a description-only word — ✅ Passed
- **User story / acceptance criterion**: Spec A.6, search group card, R9
- **Preconditions**: „E2E Klub Planszówek” description contains „kangurzyca” (the name does not)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Logged in, Spotkania, Moje grupy | group found, „moja grupa” pill | 1 result, GRUPA + „moja grupa”, description clamped (`-webkit-line-clamp: 2`) | ✅ |
| 2 | Wszędzie | same group | 1 result | ✅ |
| 3 | Guest | PUBLIC group visible | 1 result, no pill | ✅ |
| 4 | Person-run group without an upcoming term (`żyrafkowo`) | omitted (R9) | 0 results in both scopes | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/25-user-meetings-desc-match-mine.png`, `screenshots/25-user-meetings-desc-match-all.png`, `screenshots/26-guest-meetings-desc-match.png`
- **Acceptance criteria checklist**:
  - [x] description is searchable
  - [x] card clamps the description to 2 lines
  - [x] person-run group without an upcoming term omitted

### 4.11 URL state and back navigation — ✅ Passed
- **User story / acceptance criterion**: Spec useSearchUrlState ("Back from a card restores the results")
- **Preconditions**: logged in, `?q=gra&mode=events&scope=all`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Change q, mode, scope and filters | all reflected in the URL | `q`, `mode=events`, `scope=all`, `condition`, `offer_type`, `category`, `date_from`, `date_to` observed in URLs | ✅ |
| 2 | Open each card kind, then Back | query, tab, scope and results restored | for 4 kinds: URL restored, input `gra`, tab Spotkania, Wszędzie checked, „6 spotkań dla „gra”” | ✅ |
| 3 | Product card, then Back | restored | `?q=gniotka&scope=all` | ✅ |

- **Issues observed**: §5.4 C3 (a guest URL keeps `scope=mine`)
- **Evidence**: `screenshots/17-user-back-restored.png`
- **Acceptance criteria checklist**:
  - [x] q/mode/scope in the URL
  - [x] back restores the results

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**M1 — Two filter changes in the same tick lose the first one**
- **Spec requirement**: useSearchUrlState reads and writes all filters through `useAppSearchParams` (spec frontend table).
- **Expected**: Stan: Dobry then „Oddam” → `condition=GOOD&offer_type=GIFT`.
- **Actual**: when the second change follows within ~0 ms, the URL ends with only `offer_type=GIFT`. At a 100 ms or 300 ms gap both are kept.
- **Evidence**: `screenshots/04-guest-items-filtered.png` (captured after the race: Stan reset to „każdy”)
- **Root cause hypothesis**: each setter builds the next query string from the `searchParams` snapshot of the last render, so a second write before the re-render overwrites the first (stale-closure merge).
- **User impact**: very low. Humans rarely change two controls within one frame, but automation or quick double input can drop a filter.
- **Recommended fix**: build the next params from `window.location.search` (or a functional updater) at write time.
- **Workaround**: change filters one at a time (any realistic pace works).

**M2 — Inverted date range is sent to the server**
- **Spec requirement**: `standards/global/validation.md` (client-side feedback, early input checking); spec E.21 meetings Od/Do.
- **Expected**: Od > Do is flagged inline without a failing request.
- **Actual**: a request with `date_from=2026-11-15&date_to=2026-11-14` is sent and returns 400 (console error). The server message „Data końcowa nie może być wcześniejsza niż początkowa” is rendered in place of the results.
- **Evidence**: `screenshots/09-guest-meetings-inverted-dates.png`
- **Root cause hypothesis**: SearchFilters does not validate the range before writing it to the URL; the hook queries unconditionally.
- **User impact**: low. The message is clear, but a red console error appears and a request is spent against the rate limit.
- **Recommended fix**: disable the query (or show an inline `role="alert"`) when `date_from > date_to`, and set the inputs' `min`/`max`.
- **Workaround**: correct either date.

### 5.4 Cosmetic
**C1 — Kategoria trigger has a duplicated accessible name**
- **Spec requirement**: accessibility.md (picker trigger `aria-labelledby` on a visible `<span id>`).
- **Expected**: the button is announced as "Kategoria" (or "Kategoria: Dzieci").
- **Actual**: the accessibility tree shows the button as „Kategoria Kategoria”.
- **Evidence**: `screenshots/01-guest-search-initial.png`
- **Root cause hypothesis**: `aria-labelledby` lists both the external label span and the button's own value span, which both read "Kategoria" when nothing is selected.
- **User impact**: screen readers repeat the word.
- **Recommended fix**: show the placeholder value as "Wszystkie", or reference only the label.
- **Workaround**: none needed.

**C2 — Guest „Zaloguj się” sits in its own row above the search field**
- **Spec requirement**: screen:search-guest mockup ("Zaloguj się" header).
- **Expected**: link in the header row.
- **Actual**: a right-aligned link in a separate row under the app header icons.
- **Evidence**: `screenshots/03-guest-items-results.png`
- **Root cause hypothesis**: the PanelGate anonymous branch reuses the panel chrome, which has no slot for the link in the header.
- **User impact**: none functional; it takes a little vertical space.
- **Recommended fix**: optional; move the link into the top bar if the design owner wants it there.
- **Workaround**: n/a

**C3 — Guest URL keeps `scope=mine`**
- **Spec requirement**: useSearchUrlState: "Guests drop `scope`."
- **Expected**: `?q=kar&scope=mine` opened by a guest is normalised (scope dropped).
- **Actual**: the URL stays `?q=kar&scope=mine`. The results are Wszędzie, because the server forces `all` for guests.
- **Evidence**: observed URL in the guest context (no screenshot; the page is the same as `screenshots/03-guest-items-results.png`)
- **Root cause hypothesis**: the guest branch ignores `scope` when reading but does not rewrite the URL.
- **User impact**: none (results are correct); a shared link carries a stale parameter.
- **Recommended fix**: optional; drop `scope` with `replace` for guests.
- **Workaround**: n/a

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `GET /api/public/search?…date_from=2026-11-15&date_to=2026-11-14` | 400 Bad Request | once (M2) | Minor | message shown, no crash |
| `GET /api/organizations/mine` | 404 Not Found | on every panel page load for a user without an organization | Cosmetic (pre-existing, outside this task) | none; expected "no org" probe |

No JavaScript exceptions or React warnings were logged during any scenario.

## 7. Spec Alignment
- **Fully implemented**: public `/search` with the PanelGate guest branch; hint and minimum of 2 characters; 300 ms debounce; infinite query with „Pokaż więcej”; mode tablist and scope radiogroup (hidden for guests); per-mode filters, with filters cleared on mode switch; guest Kategoria via PUBLIC `GET /api/categories`; other-mode line (highlighted when the list is empty); empty-items cards (scope-mine and scope-neutral copy) with the `/add/hunting?name=<q>` prefill; result cards for 5 kinds with correct links; reserved label with a date (logged in) or without one (guest); "moja grupa" pill; group description in the create and edit forms (counter, inline error, disabled submit, verbatim server banner, prefill); full description in the terms header; description search with a 2-line clamp; R9 omission of person-run groups without a term; date filters narrowing groups; URL state and back restore.
- **Partially implemented**: guest scope normalisation in the URL (C3); client-side date-range validation (M2).
- **Not implemented**: _None._
- **Extra (unspecified) behavior**: the Od input shows today's date as its default value without writing `date_from` to the URL (consistent with the "Od (default dziś)" spec note).
- **Accepted deviations (reported, not failed)**: Kategoria is a full-width picker trigger, not a chip; Stan is a `<select>`; Od/Do are native date inputs; guests see the date filters; item intent pills read „Chcę oddać / Chcę się zamienić”, and the filter buttons read „Oddam / Zamienię”.

## 8. Variances from Plan
- „Moje grupy” item results with real matches were not exercised. The new test account shares no group with other item owners, so Moje grupy item searches were empty; the scope=mine request and the empty-state copy were verified instead. Visibility rules R1–R12 are covered by the backend `test_visible_to.py`.
- Meetings ordering (a description-only group below a name-matched group, Q4) was not set up in the UI. It needs two org-run groups with upcoming terms, and terms could not be scheduled quickly with the fresh account. It is covered by a backend acceptance test.
- The moderation path was exercised with the contact-info rule (`ensure_no_contact_info`), not with a `check_text` model rejection. Both use the same banner.
- Test records were left in the dev DB: the account `e2e-search-…@example.com`, the organization „E2E Pracownia Wyszukiwania 18547” and the groups „E2E Grupa opisowa” and „E2E Klub Planszówek”.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| "`/search` works for guests and logged-in users and matches the 7 binding mockups." | ✅ | §4.1–4.7, 4.11; visual-fidelity ✓7 / ⚠3 / ✗0 |
| "The group description is editable (≤500) and displayed on the two surfaces only." | ✅ | §4.8–4.10 (terms header and search card) |
| "A guest sees only PUBLIC items, events, PUBLIC groups and organizations … `scope=mine` is forced to `all`." | ✅ | guest requests always `scope=all` (§4.1, C3) |
| "A guest loads the category tree … the search `category` filter works for a guest." | ✅ | §4.4 |
| "A person-run group without an upcoming term is omitted." | ✅ | §4.10 step 4 |
| "`other_mode_count` equals the `total` after switching, in both directions." | ✅ | §4.3 (6 → 6; 68 → 68) |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: §5.3 M2 (client-side date-range check); §5.3 M1 (build URL updates from the current location).
- **Nice-to-have**: §5.4 C1, §5.4 C2, §5.4 C3.

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (30 implementation screenshots plus 7 rendered mockups `mockup-*.png`)
- **Visual-fidelity report**: `verification/visual-fidelity.md` (+ `visual-fidelity.html`)
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ⚠️ GO WITH CAVEATS. Every scenario passed in a live browser for both guest and logged-in users, and the group description works on every surface the spec names. The remaining findings are two Minor input-handling edge cases and three Cosmetic points, none of which block a user. Recommendation: merge, and fix M1 and M2 in a follow-up.
