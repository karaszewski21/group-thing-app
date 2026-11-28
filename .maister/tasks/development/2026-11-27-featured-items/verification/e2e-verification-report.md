# E2E Verification Report

## TL;DR
Verdict: **GO WITH CAVEATS**. 8 of 8 scenarios executed; 7 pass and 1 passes with a minor issue. There are 0 Critical, 0 Major, 1 Minor and 0 Cosmetic findings.
Featuring, the cap and limit-0 toasts, the admin limit page, and the badge with featured-first ordering on the owner items, profile, product, event and term pages all work. The event's 3-item window pulls in the oldest listing when it is featured. Unlisting clears the mark, and search shows no badge.
The one finding: on narrow `ItemCard` tiles (owner items and profile grids), the right-corner „⭐ Wyróżnione” badge covers the left mode badge („Oddam” is cut off).

## Key Decisions
- The test data was seeded through the UI (registration, place, first item, event, circle, term, attendance) and through same-origin API calls from the logged-in page (3 more items and 1 draft, admin limit changes to 0 and back to 3). ADMIN was granted with the one psql insert the brief named. No other DB writes were made.
- A fourth scenario variant was added: after A was relisted (so it became the newest listing), Hulajnoga B (the oldest listing) was featured. This shows that featured-first, not age, puts an item into the event and term 3-item previews.
- The organization recent-items block was not exercised, because the e2e users have no organization. It uses the same `ItemCard` and `list_owner_listed_items_page` as the profile page, which was verified.

## Open Questions / Risks
- Minor: the `ItemCard` featured badge overlaps the mode badge on tiles about 175–190 px wide (the 2-column owner items grid on desktop and mobile). See §5.3.

## 1. Identifier
- **Task**: 2026-11-27-featured-items (Featured items „Wyróżnione rzeczy”)
- **Task path**: C:/Users/karas/Desktop/swaptime/gooo-the-best-items/.maister/tasks/development/2026-11-27-featured-items
- **Spec**: C:/Users/karas/Desktop/swaptime/gooo-the-best-items/.maister/tasks/development/2026-11-27-featured-items/implementation/spec.md
- **Date**: 2026-11-27
- **Git ref**: 3bb3591 + uncommitted worktree changes, branch `feature/gooo-the-best-items`
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5183 (Next dev in the worktree → backend http://127.0.0.1:8090, throwaway Postgres `gooo-featured-e2e-db`, migrations through 0111) |
| Browser | Playwright MCP Chromium (bundled) |
| Viewport | 1280×800 (desktop); 390×844 for one mobile check |
| Auth context | anonymous; `owner@e2e.test` (READ+EDIT); `guest@e2e.test` (READ+EDIT, event author); `admin@e2e.test` (+ADMIN) |
| Test data | Live, seeded during the run: owner items Rower A (GIFT), Hulajnoga B (SWAP), Kask C (GIFT), Lampka D (GIFT), Szkic E (draft); event „Kiermasz E2E” (guest author, owner attending); circle „Krąg E2E” + term 19.12 (owner organizer) |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 8 |
| Scenarios executed | 8 |
| Passed | 8 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 1 |
| Cosmetic issues | 0 |

Every user story and acceptance criterion exercised in the browser behaves as specified. The admin limit page validates (≤ 20 alert, Save disabled, verbatim 409 on a stale save) and its nav entry sits right after „Points”. In „Moje rzeczy” the toggle appears only on listed items, carries `aria-pressed` and a stable item-named `aria-label`, and shows the exact Polish 409 messages in the bottom ToastPill. Featured items lead and carry the badge on the owner items, profile, product, event and term pages, for both anonymous and logged-in viewers. Unlist/relist clears the mark, and search shows no badge. One scenario passes with a Minor layout issue: on narrow tiles the corner badge overlaps the mode badge.

## 4. Verification Scenarios

### 4.1 Admin settings page — ✅ Passed
- **User story / acceptance criterion**: Spec US4; Core Req 20–21 (Admin settings); Success criterion "An admin can change the limit… stale save returns the 409… Non-admins get 403".
- **Preconditions**: `admin@e2e.test` with ADMIN, fresh login; DB seed value 3.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/admin/settings` (1280 px) | Heading „Ustawienia”, subtitle, section „Wyróżnione rzeczy”, field „Limit wyróżnionych rzeczy” = 3, help text | All present, value „3”, help text verbatim | ✅ |
| 2 | Inspect nav | „Settings” right after „Points”, others unchanged | Products, Categories, Groups, Terms, Photos, Points, **Settings**, Plugins, Panel | ✅ |
| 3 | Inspect input | `type=text inputMode=numeric pattern=[0-9]*` | Exactly so | ✅ |
| 4 | Type 25 | Inline `role=alert` „… ≤ 20.”, `aria-invalid`, `aria-describedby`, Save disabled | Alert „Limit wyróżnionych rzeczy musi być liczbą całkowitą ≤ 20.”, `aria-invalid=true`, describedby = help + error ids, Save `disabled` | ✅ |
| 5 | Type 1, Save | Saved; GET returns 1 | „Zapisano ustawienia.”; `GET /api/admin/settings` → `{max_featured_items: 1}` | ✅ |
| 6 | Change the value through the API behind the page, then save from the page | Verbatim 409 message | Alert „Ustawienia zostały zmienione w międzyczasie. Odśwież stronę.” | ✅ |
| 7 | `GET /api/admin/settings` as owner (non-admin) | 403 | 403 | ✅ |

- **Issues observed**: _None observed._ (The unstyled Chakra input and button are pre-existing, also on `/admin/points`; see §7 Extra.)
- **Evidence**: `screenshots/01-admin-settings-default.png`, `screenshots/02-admin-settings-invalid-25.png`, `screenshots/03-admin-settings-saved-1.png`, `screenshots/22-admin-settings-stale-409.png`
- **Acceptance criteria checklist**:
  - [x] Page, copy, field and help text as specified
  - [x] Nav „Settings” after „Points”
  - [x] Inline validation with Save disabled
  - [x] Stale save → verbatim 409
  - [x] Non-admin 403

### 4.2 „Moje rzeczy” toggle, cap and limit 0 — ✅ Passed
- **User story / acceptance criterion**: US1, US2; Core Req 1–4, 16 („Moje rzeczy” chip), 17–18.
- **Preconditions**: Owner logged in; 4 listed items and 1 draft; limit 1 (from 4.1).

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/items` | Toggle only on listed items | „⭐ Wyróżnij” on A, B, C, D; none on draft „Szkic E” | ✅ |
| 2 | Inspect toggles | `type=button`, `aria-label` „Wyróżnij: {name}”, `aria-pressed=false` | As expected for all 4 | ✅ |
| 3 | Click „Wyróżnij: Rower A” | Pressed, ink tone, text „⭐ Wyróżnione”, chip „⭐ Wyróżnione” first in the chip row | `aria-pressed=true`, `bg-ink text-on-ink`, chip first (before „40 pkt”, „Publiczna”); list order unchanged | ✅ |
| 4 | Click „Wyróżnij: Hulajnoga B” (limit 1) | Toast „Możesz wyróżnić maksymalnie 1 rzecz.”, B stays off | Bottom ToastPill (`role=status`) with the exact text; B `aria-pressed=false` | ✅ |
| 5 | Admin sets limit 0; click B | Toast „Wyróżnianie rzeczy jest teraz wyłączone.” | Exact text in the ToastPill | ✅ |
| 6 | At limit 0, unfeature A | Allowed | A `aria-pressed=false` | ✅ |
| 7 | Admin restores 3; feature A again | Pressed | `aria-pressed=true` | ✅ |
| 8 | API: feature the draft; send `{featured: 1}` | 409 „Wystaw rzecz, aby ją wyróżnić.”; 400 | 409 with that message; 400 | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/04-my-items-before.png`, `screenshots/05-my-items-A-featured.png`, `screenshots/06-my-items-cap-toast.png`, `screenshots/07-my-items-disabled-toast.png`
- **Acceptance criteria checklist**:
  - [x] Toggle hidden on drafts and shown even at limit 0
  - [x] `aria-pressed` carries state, stable item-named label
  - [x] Cap 409 with N=1 singular copy
  - [x] Limit-0 409 copy
  - [x] Unfeature always allowed
  - [x] „Moje rzeczy” order unchanged

### 4.3 Owner items page and profile recent items — ⚠️ Passed with issues
- **User story / acceptance criterion**: US3; Core Req 11 (owner items, every tab), 15–16 (`ItemCard` corner badge).
- **Preconditions**: A featured; anonymous and owner views.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/<party-id>/items`, tab „Wszystkie” | A first with the right-corner „⭐ Wyróżnione” (`bg-ink text-on-ink`, ⭐ `aria-hidden`) | A first; badge `absolute … right-1.5 bg-ink text-on-ink`, ⭐ in `aria-hidden` span | ✅ |
| 2 | Tab „Chcę oddać” | Featured first in the tab | Rower A, Lampka D, Kask C | ✅ |
| 3 | Check the badge layout at 1280 px and 390 px | Mode and featured badges both readable | The featured badge covers the end of the „Oddam” mode badge („Oddar…”) | ⚠️ |
| 4 | Open profile `/<party-id>` recent items | A first with the badge | „Oddam / ⭐ Wyróżnione / Rower A” first | ✅ |
| 5 | Later, with B featured | B first in „Wszystkie” | Hulajnoga B (featured) first, then A (relisted), D, C | ✅ |

- **Issues observed**: §5.3 Minor-1 (badge overlap).
- **Evidence**: `screenshots/08-owner-items-featured-first.png`, `screenshots/09-owner-items-gift-tab-mobile.png`, `screenshots/10-profile-recent-items.png`
- **Acceptance criteria checklist**:
  - [x] Featured tiles first in every tab tested
  - [x] Right-corner ink badge, ⭐ aria-hidden
  - [x] Profile recent items featured first
  - [ ] Badge legible alongside the mode badge on narrow tiles

### 4.4 Product page pill — ✅ Passed
- **User story / acceptance criterion**: US3; Core Req 9 (`ItemActionsResponse.is_featured`), 16 (`ItemHeader` md pill before mode pills, every viewer).
- **Preconditions**: A featured.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Owner opens A's product page | „⭐ Wyróżnione” md pill before „Chcę oddać” | Pills in order: „⭐ Wyróżnione” (`px-2.5 py-1 text-xs bg-ink text-on-ink`, ⭐ aria-hidden), „Chcę oddać” | ✅ |
| 2 | Anonymous visitor | Same pill | Same order | ✅ |
| 3 | Other logged-in user (`guest@e2e.test`) | Same pill | Same order | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/11-product-owner-featured-pill.png`, `screenshots/14-product-anonymous-featured-pill.png`, `screenshots/15-product-other-user-featured-pill.png`
- **Acceptance criteria checklist**:
  - [x] md pill before mode pills
  - [x] Visible to owner, anonymous and another user

### 4.5 Event page 3-item preview — ✅ Passed
- **User story / acceptance criterion**: US3; Core Req 11 (event window `featured_at DESC NULLS LAST, created_at DESC, item_id`), 16.
- **Preconditions**: Event „Kiermasz E2E” created through `/add/event` by guest; owner joined via „＋ Zapisz się”; owner has 4 listed items.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Owner's preview with A featured (A the oldest listing) | A first with the pill, then the 2 newest | Rower A ⭐ Wyróżnione, Lampka D, Kask C („Pokaż więcej (4)”); B (2nd oldest) dropped | ✅ |
| 2 | Anonymous view | Same | Same | ✅ |
| 3 | After A was relisted and B (now the oldest listing) featured | B pulled into the window first | Hulajnoga B ⭐ Wyróżnione, Rower A, Lampka D | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/12-event-participant-preview.png`, `screenshots/20-event-B-featured-oldest-first.png`
- **Acceptance criteria checklist**:
  - [x] Featured item fills a preview slot even when it is the oldest
  - [x] Pill shown in the preview

### 4.6 Term page preview — ✅ Passed
- **User story / acceptance criterion**: US3; Core Req 11–12 (term SQL order + `buildAttendees` sort), 16.
- **Preconditions**: Public circle „Krąg E2E” created via `/groups/new` by the owner, term 19.12 10:00 via `/add/term`; the owner lists items there as organizer.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the term page with A featured | A first with the pill, rest newest first | Rower A ⭐ Wyróżnione, Lampka D, Kask C | ✅ |
| 2 | After A was relisted and B featured | B first | Hulajnoga B ⭐ Wyróżnione, Rower A, Lampka D | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/13-term-participant-preview.png`, `screenshots/21-term-B-featured-first.png`
- **Acceptance criteria checklist**:
  - [x] Featured first in the lister's 3-item preview
  - [x] Pill shown

### 4.7 Unlist and relist clears the mark — ✅ Passed
- **User story / acceptance criterion**: Core Req 7, 18 (`setItemMode` sets `is_featured` from the saved preference); Success criterion "Unlist … clear[s] the mark".
- **Preconditions**: A featured.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | In „Moje rzeczy”, click the pressed „Oddam” on A (unlist) | Toggle and chip disappear | No toggle, card shows only „Stan / 40 pkt” | ✅ |
| 2 | Click „Oddam” again (relist) | Toggle back and not pressed, no chip | `aria-pressed=false`, „⭐ Wyróżnij”, no chip; same after reload | ✅ |
| 3 | Visit owner items, profile, product, event, term | No badge anywhere | No „Wyróżnione” text on any of the 5 pages | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/18-my-items-A-unlisted.png`, `screenshots/19-my-items-A-relisted-not-featured.png`
- **Acceptance criteria checklist**:
  - [x] Unlist clears the mark
  - [x] Relist starts not featured, with no stale chip or toggle

### 4.8 Search shows no badge — ✅ Passed
- **User story / acceptance criterion**: Core Req 13, 16 ("Not on search cards"); Success criterion "nowhere in search".
- **Preconditions**: A featured; guest logged in.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `/search?q=Rower` | No badge; ordering unchanged | 4 results, no „Wyróżnione” | ✅ |
| 2 | `/search` (browse, newest first) | No badge; featured not promoted | D, C, B, A (A last, as the oldest); no badge | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/16-search-no-featured-badge.png`, `screenshots/17-search-browse-no-badge.png`
- **Acceptance criteria checklist**:
  - [x] No featured badge on search cards
  - [x] Search ordering unchanged

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**Minor-1: `ItemCard` featured badge covers the mode badge on narrow tiles**
- **Spec requirement**: Core Req 15: "`ItemCard` … renders the right-corner badge in the existing `CORNER_BADGE`/marker position"; mockup `screen:owner-items-featured-first` shows the mode pill and „⭐ Wyróżnione” side by side.
- **Expected**: Both the left mode badge („Oddam”/„Zamienię”) and the right „⭐ Wyróżnione” badge are fully legible.
- **Actual**: On the owner items 2-column grid (tile about 186 px wide at 1280 px, about 160 px at 390 px), the absolutely positioned right badge (about 106 px) overlaps the left mode badge, so „Oddam” reads „Oddar”.
- **Evidence**: `screenshots/08-owner-items-featured-first.png`, `screenshots/09-owner-items-gift-tab-mobile.png`
- **Root cause hypothesis**: Both badges are `absolute top-1.5` in opposite corners with no width limit. Their combined width is larger than the narrow photo area. The mockup used wider 3-column tiles, where the pills only just touch.
- **User impact**: The mode label of a featured item is partly hidden on owner, profile and (likely) organization tiles. The information is still there in the tab filter and on the product page.
- **Recommended fix**: On small tiles, show a star-only featured badge (with an `sr-only` „Wyróżnione”), or stack the featured badge below the mode badge, or cap its width with truncation below `md`.
- **Workaround**: None for the viewer. The mode is visible on the product page.

### 5.4 Cosmetic
_None observed._

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| network `/api/auth/google/nonce` | 503 Service Unavailable | on every login page view | Minor | None: Google sign-in is off in this env (no client ID), as designed |
| network `/api/organizations/mine` | 404 Not Found | several per page load | Minor | None: the users have no organization; pre-existing behaviour |
| network `/api/notifications/mine`, `/api/conversations/unread-count` | 401 | once, right after a session switch | Minor | None: requests from before login |
| network `/api/public/organizations/register` | 404 | once | Minor | None: `/register` is not a route (slug lookup) |
| network `/api/item-listing-preferences/{id}/featured`, `/api/admin/settings` | 409 / 400 / 403 | 1–2 each | Minor | Expected: deliberately provoked by the scenarios |

No JavaScript exceptions or React errors were logged. All errors are failed-resource lines, expected or caused by the environment.

## 7. Spec Alignment
- **Fully implemented**: featured PUT with 404/403/409/400 ordering where observable (draft 409, non-bool 400); cap and limit-0 409 copy; idempotent unfeature at limit 0; `is_featured` on the term, event, owner, my-items, preference and actions responses (seen via the UI); featured-first order on term (SQL + `buildAttendees`), event window, owner items (every tab tested) and profile; the badge on `ItemTileBadges`, `ItemCard`, `ItemHeader` and the „Moje rzeczy” chip; `FeaturedToggle` a11y contract; `setItemMode` clearing the flag; admin settings page, validation, 409, nav placement, ADMIN-only API.
- **Partially implemented**: `ItemCard` corner badge: it renders correctly but overlaps the mode badge on narrow tiles (§5.3 Minor-1).
- **Not implemented**: _None._
- **Extra (unspecified) behavior**:
  - An admin PUT that sends the same limit does not bump `updated_at`, so a second tab's later save with the earlier `updated_at` still succeeds (no 409). This is harmless, because nothing changed between the reads.
  - Pre-existing and not caused by this feature: the admin Chakra input and button render without borders or button styling in this dev env, the same on `/admin/points` (`screenshots/23-admin-points-baseline-styling.png`). „Panel” is highlighted in the admin nav together with the active entry.
  - Pre-existing: the preview's „Pokaż więcej (4)” shows `items_total`, not the remaining count.

## 8. Variances from Plan
- In scenario 2, the admin limit changes to 0 and back to 3 were made with the admin token through `PUT /api/admin/settings` from the browser context, not by clicking through `/admin/settings`. The UI save path itself was covered in 4.1.
- 3 of the 4 listed items and the draft were created through same-origin `POST /api/products/resolve` + `POST /api/inventory-items` from the logged-in page. The first item was created through `/add/product`. Photos were skipped (no storage), so there were no POINTS listings.
- The event place was created without a street address (the address combobox needs Google Places).
- The organization recent-items block was not exercised (no organization). It shares `ItemCard` and the owner query with the verified profile block.
- An extra variant was added (feature the oldest listing B after relisting A) to prove that featured-first drives the 3-slot previews.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| An owner can feature up to N listed items; the (N+1)-th attempt returns the 409 with N; at limit 0 every new featuring returns the "disabled" 409 | ✅ | 4.2 steps 3–5, `screenshots/06-my-items-cap-toast.png`, `screenshots/07-my-items-disabled-toast.png` |
| A race at the cap never yields more than N featured items | ❌ not tested | Concurrency is out of reach for browser E2E; left to the backend tests |
| On term, event, owner, profile and organization pages, featured items appear before all non-featured ones | ✅ (org not exercised) | 4.3, 4.5, 4.6; `screenshots/20-event-B-featured-oldest-first.png` |
| On the event and term previews they take the 3 slots | ✅ | B (oldest listing) pulled into both previews |
| The badge shows in every listed placement and nowhere in search or on wants cards | ✅ (wants cards not exercised) | 4.3, 4.4, 4.5, 4.6, 4.8 |
| An admin can change the limit on `/admin/settings`, a stale save returns the 409 message, non-admins get 403 | ✅ | 4.1 |
| Unlist and hand-over clear the mark; lowering the limit keeps the existing marks | ✅ unlist / limit-lowering (A stayed featured when the limit went from 3 to 1, then 0); hand-over not exercised | 4.2, 4.7 |
| Migrations, tests, lint baselines | n/a | Out of scope for browser verification |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: §5.3 Minor-1 (`ItemCard` badge overlap on narrow tiles).
- **Nice-to-have**: Cover the cap race and the hand-over clearing in backend tests, if they are not there yet (outside browser reach).

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (23 run screenshots + 7 rendered mockups `mock-*.png`)
- **Visual-fidelity report**: `verification/visual-fidelity.md` (+ `visual-fidelity.html`)
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ⚠️ GO WITH CAVEATS. Every specified behaviour that a browser can reach works end to end, for anonymous, owner, other-user and admin viewers: featuring, the cap and disabled states, admin configuration, featured-first ordering with the badge, clearing on unlist, and no badge in search. The only finding is a Minor layout overlap of the corner badge on narrow tiles. Recommendation: merge, then fix the badge overlap in a small follow-up (or before merge if the owner considers the hidden mode label visible enough to matter).
