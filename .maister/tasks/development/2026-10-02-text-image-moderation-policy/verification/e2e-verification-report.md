# E2E Verification Report

## 1. Identifier
- **Task**: 2026-10-02-text-image-moderation-policy (Text + image moderation policy: sync text reject, async ShieldGemma photos)
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-02-text-image-moderation-policy
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-02-text-image-moderation-policy\implementation\spec.md
- **Date**: 2026-10-05
- **Git ref**: 14f1924 (main, uncommitted working tree with the feature changes; images rebuilt 2026-10-05 09:39 CEST)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5174 (nginx, proxies /api to backend :8080) |
| Browser | Playwright MCP, Chromium (headless) |
| Viewport | 1920×842 (default MCP viewport) |
| Auth context | `e2e.org1@example.com` (ORGANIZER), `e2e.org2@example.com` (ORGANIZER, later granted ADMIN via `user_permissions` insert) |
| Test data | Live dev DB (docker compose postgres); users, orgs, groups, terms, items registered through the UI during the run |

Backend: `runtime-dev` image, `MODERATION_TEXT_ENABLED=false`, `MODERATION_IMAGE_ENABLED=false`, no worker, no VPS B. Migrations 0047 and 0048 ran on startup (backend log).

**Method for org/group/term forms**: those fields have no synchronous server rule that returns a 400 without `fieldErrors`, and the model is off, so a real moderation 400/503 cannot happen. Playwright `page.route` returned one-off 400/503 envelopes with the exact catalogue messages (`{status, error, message, fieldErrors: null}`), and then a real request was let through to confirm the save. Product forms and needed-item names used the **real** synchronous contact-info 400 (`ensure_no_contact_info`). Product forms also got one-off mocked 503 and moderation-400 envelopes.

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 14 |
| Scenarios executed | 14 |
| Passed | 13 |
| Failed | 1 |
| Blocked | 0 |
| Pass rate | 93% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 2 |
| Cosmetic issues | 0 |

All seven affected forms save normally with both flags off. Each form shows the server's 400 and 503 messages word for word in its existing error slot, which carries `role="alert"`, and keeps the user's input. The add-group and add-term modals show the error inline, not as a toast, and clear it when the modal is reopened. The EditTermDialog row editor stays open on error. `handleAddTerm` sends no `POST /terms` when an item name is rejected, and a retry after a term rejection creates exactly one term and reuses the already-resolved product. With image moderation off, an uploaded photo is APPROVED at once with no badge and no polling. A simulated PENDING photo polls every 10 s and stops once it is approved. The admin queue lists photos only. The one runtime failure: the startup INFO line with both moderation flags never reaches the API container logs (Req. 1). There is also one pre-existing, unrelated bug in the needed-item category select.

## 4. Verification Scenarios

### 4.1 OnboardingWizard: local validation and server 400/503 per step — ✅ Passed
- **User story / acceptance criterion**: Req. 23 (OnboardingWizard ApiError branching), Req. 27, `screen:onboarding-wizard`, revision H1
- **Preconditions**: New ORGANIZER `e2e.org1@example.com` registered via UI, on `/onboarding`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "Dalej →" with empty org name | Local message "Nazwa organizacji jest wymagana" | `role=alert`: "Nazwa organizacji jest wymagana" | ✅ |
| 2 | Org name filled, `POST /organizations/mine` → 400 (org catalogue msg) | Message shown, stays on step 1, input kept | Exact message, "Krok 1 z 3", value kept | ✅ |
| 3 | Same, → 503 | 503 catalogue message shown | "Moderacja jest chwilowo niedostępna — spróbuj za chwilę." | ✅ |
| 4 | Real submit | Advances to step 2 | "Krok 2 z 3" | ✅ |
| 5 | Group name, `POST /groups/mine` → 400 | Group message, stays on step 2 | Exact message, input kept | ✅ |
| 6 | Real submit | Advances to step 3 | "Krok 3 z 3" | ✅ |
| 7 | Term date + description, `POST /terms` → 400 | Term message, stays on step 3 | Exact message, description kept | ✅ |
| 8 | Real submit | Wizard finishes | Redirected to `/panel`, term listed | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-onboarding-local-required-error.png`, `screenshots/02-onboarding-org-server-400.png`, `screenshots/03-onboarding-org-server-503.png`, `screenshots/04-onboarding-group-server-400.png`, `screenshots/05-onboarding-term-server-400.png`
- **Acceptance criteria checklist**:
  - [x] Local step errors still shown verbatim
  - [x] ApiError 400/503 shows the server message
  - [x] Wizard stays on the step; input preserved
  - [x] Normal save works with flags off

### 4.2 OrganizationPage: rename with server 400/503 — ✅ Passed
- **User story / acceptance criterion**: Req. 23, Req. 27, `screen:organization-page`
- **Preconditions**: `e2e.org1` owns "Testowa Organizacja E2E"; `/organization`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Rename + Zapisz (real) | 200, "Zapisano." | PATCH 200, "Zapisano." | ✅ |
| 2 | Rename, `PATCH /organizations/{id}` → 400 | E1 box shows org message, input kept | Exact message in `role=alert`, value kept | ✅ |
| 3 | → 503 | 503 message | Exact 503 message | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/06-organization-page-server-400.png`, `screenshots/07-organization-page-server-503.png`, `screenshots/08-organization-page-saved.png`
- **Acceptance criteria checklist**:
  - [x] E1 box shows the 400/503 server message (not "400 Bad Request")
  - [x] Input value kept; `role="alert"`

### 4.3 Panel add-group modal: inline error (Option B) — ✅ Passed
- **User story / acceptance criterion**: Req. 23 (`handleAddGroup`), Req. 26, `screen:panel-add-group-modal`
- **Preconditions**: `e2e.org1`, `/panel/spotkania`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Name "Druga grupa E2E", `POST /groups/mine/new` → 400 | Inline error above "Dodaj grupę"; modal open; input kept; no failure toast | Exact message in `role=alert`, rendered above the button (bounding box checked), modal open, value kept, no toast | ✅ |
| 2 | Close modal (✕), reopen | Error cleared | No alert; typed value still present | ✅ |
| 3 | Real submit | 201, modal closes, group listed | 201, modal closed, "Druga grupa E2E" listed | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/09-add-group-modal-inline-400.png`, `screenshots/10-add-group-modal-reopened-cleared.png`, `screenshots/11-add-group-success.png`
- **Acceptance criteria checklist**:
  - [x] Inline E2 error above submit, no failure toast
  - [x] Error cleared when the modal opens again
  - [x] Success path unchanged

### 4.4 Panel edit-group modal — ✅ Passed
- **User story / acceptance criterion**: Req. 23 (`saveEditGroup`), Req. 27, `screen:panel-edit-group-modal`
- **Preconditions**: `e2e.org1`, group "Grupa E2E"

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Rename, `PATCH /groups/{id}` → 400 | Message in modal, modal open, input kept | Exact message, `role=alert`, open, value kept | ✅ |
| 2 | → 503 | 503 message | Exact 503 message | ✅ |
| 3 | Real submit | 200, modal closes, name updated | 200, closed, "Grupa E2E zmieniona" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/12-edit-group-modal-server-400.png`, `screenshots/13-edit-group-modal-server-503.png`, `screenshots/14-edit-group-saved.png`
- **Acceptance criteria checklist**:
  - [x] `editGroupError` shows the server message with `role="alert"`

### 4.5 Panel add-term modal: item resolve before term, no duplicates — ⚠️ Passed with issues
- **User story / acceptance criterion**: Req. 23 (`handleAddTerm`), Req. 25, Req. 26, `screen:panel-add-term-modal`
- **Preconditions**: `e2e.org1`, two groups, `/panel/spotkania`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Draft item with default "Typ" (unchanged), submit | Item resolved | `POST /products/resolve` 400 `fieldErrors.category_id` (empty) → generic "Nie udało się dodać terminu" (pre-existing bug, see §5.3 #2) | ⚠️ |
| 2 | Draft item "Bęben zadzwoń 600 700 800" (Typ = Inne), submit | Real contact-info 400 inline; **no** `POST /terms` | Only `POST /products/resolve` 400 sent; message shown inline; modal open; description kept | ✅ |
| 3 | Item "Tamburyn E2E", `POST /terms` → 400 (term catalogue msg) | Term message inline | resolve 200 (product b4135ddd…), terms 400, exact message | ✅ |
| 4 | Retry (real) | One term, product reused, needed item created | resolve 200 (**same** id b4135ddd…), terms 201, needed-items 201; modal closed | ✅ |
| 5 | DB check | 1 term, 1 product, no phone-number product | `terms` 1 row, `products` "tamburyn e2e" 1 row, 0 rows matching "600 700 800" | ✅ |

- **Issues observed**: §5.3 #2 (pre-existing category default bug; not introduced by this feature)
- **Evidence**: `screenshots/15-add-term-modal-item-name-400-real.png`, `screenshots/16-add-term-modal-term-desc-400.png`, `screenshots/17-add-term-retry-success.png`
- **Acceptance criteria checklist**:
  - [x] Rejected item name leaves no term behind
  - [x] Retry creates no duplicate term or product
  - [x] Inline E2 error above "Dodaj termin"

### 4.6 EditTermDialog: formError, saveEdit row kept open, addItem — ✅ Passed
- **User story / acceptance criterion**: Req. 23, Req. 24, Req. 27, `screen:edit-term-dialog`
- **Preconditions**: `e2e.org1`, term "Termin z rzeczą E2E" with 1 needed item

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Edit description, `PATCH /terms/{id}` → 400 | `formError` shows term message, value kept | Exact message, `role=alert`, value kept | ✅ |
| 2 | → 503 | 503 message | Exact 503 message | ✅ |
| 3 | Real save | 200 "Zapisano" | 200, "Zapisano" | ✅ |
| 4 | Row edit: name "Tamburyn kontakt jan@example.com", Zapisz | Real 400 in `itemsError`; **row editor stays open** with the typed name | resolve 400; message in `role=alert`; editor visible with the typed value | ✅ |
| 5 | Fix name, Zapisz | Saved, editor closes | resolve 200 + PATCH needed-items 200; row "Tamburyn duży E2E" | ✅ |
| 6 | Add item "Grzechotka www.sklep.pl" | Real 400 in `itemsError`, form kept | resolve 400, message shown, add form still open with value | ✅ |
| 7 | Fix name, Dodaj | Created | resolve 200 + needed-items 201; listed | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/18-edit-term-dialog-formError-400.png`, `screenshots/19-edit-term-saved.png`, `screenshots/20-edit-term-saveEdit-400-row-open.png`, `screenshots/21-edit-term-saveEdit-ok.png`, `screenshots/22-edit-term-addItem-400.png`, `screenshots/23-edit-term-addItem-ok.png`
- **Acceptance criteria checklist**:
  - [x] `formError` for the term description
  - [x] `itemsError` for needed-item edit/add
  - [x] Row editor stays open on error
  - [x] `role="alert"` on both

### 4.7 FirstTermStepperOrganizer — ✅ Passed
- **User story / acceptance criterion**: Req. 23, Req. 27, `screen:first-term-stepper-organizer`
- **Preconditions**: New ORGANIZER `e2e.org2` with exactly one group and zero terms (term step skipped in onboarding); panel CTA "Dodaj termin →"

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Date + description, `POST /terms` → 400 | Term message, dialog open, input kept | Exact message, `role=alert`, value kept | ✅ |
| 2 | → 503 | 503 message | Exact 503 message | ✅ |
| 3 | Real submit | 201, done screen | 201, "Termin dodany!…" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/24-first-term-stepper-400.png`, `screenshots/25-first-term-stepper-success.png`
- **Acceptance criteria checklist**:
  - [x] E2 `formError` shows the server message; `role="alert"`

### 4.8 Item add / item edit pages (real contact-info 400, mocked 503) — ✅ Passed
- **User story / acceptance criterion**: `screen:item-edit-page` (E3 via `serverMessageOr`, benefits from 503 pass-through), Req. 22
- **Preconditions**: `e2e.org2`, `/product/new`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Name "Rowerek tel 501 234 567" | Real contact-info 400 shown | resolve 400, message in `role=alert` | ✅ |
| 2 | Name "Rowerek biegowy E2E" | Item created | resolve 200, inventory-items 201, redirect to `/product/{id}` | ✅ |
| 3 | Edit description "…pisz na whatsapp" | Real 400 shown, editor open | PATCH description 400, message shown | ✅ |
| 4 | Clean description, PATCH → 503 (mock) | 503 message | Exact 503 message | ✅ |
| 5 | Real save | 200 | 200, description shown | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/26-add-item-page-contact-400.png`, `screenshots/27-item-edit-description-contact-400.png`, `screenshots/28-item-edit-description-503.png`
- **Acceptance criteria checklist**:
  - [x] Server 400/503 message shown in E3 slot
  - [x] Save works with flags off

### 4.9 Admin ProductFormPage (create + edit) — ✅ Passed
- **User story / acceptance criterion**: Req. 23, Req. 27, `screen:admin-product-form`
- **Preconditions**: `e2e.org2` with ADMIN; `/admin/products/new`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Description "Kontakt: kowalski@example.com", Save | Real 400 in E5 Chakra box | POST /products 400; message in `role=alert` | ✅ |
| 2 | Clean description, POST → 503 (mock) | 503 message | Exact 503 message | ✅ |
| 3 | POST → 400 product-name catalogue msg (mock) | Message verbatim | "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie." | ✅ |
| 4 | Real save | 201, redirect to list | 201, `/admin/products` | ✅ |
| 5 | Edit: name "Hulajnoga tel. 600123456" | Real 400 (PUT), input kept | PUT 400, message shown, value kept | ✅ |
| 6 | Clean name, save | 200 | PUT 200; response has no `text_status` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/35-admin-product-form-contact-400.png`, `screenshots/36-admin-product-form-503.png`, `screenshots/37-admin-product-form-saved.png`, `screenshots/38-admin-product-edit-contact-400.png`
- **Acceptance criteria checklist**:
  - [x] E5 box shows the server message; `role="alert"`

### 4.10 Photo upload with image moderation off — ✅ Passed
- **User story / acceptance criterion**: Req. 10, Req. 28, Req. 29, `screen:item-detail-page`
- **Preconditions**: `e2e.org2` owns "Rowerek biegowy E2E"; `MODERATION_IMAGE_ENABLED=false`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Upload PNG in "Edytuj zdjęcia" | 201 with `status: APPROVED` | `POST /products/{id}/photos` 201, `"status":"APPROVED"`, public CDN URL | ✅ |
| 2 | Look for badges | None | No "W moderacji / Do sprawdzenia / Odrzucone" | ✅ |
| 3 | Item detail page, watch 25 s | No polling | 0 `/details` requests in 25 s; image loaded | ✅ |
| 4 | Owner text banner | Removed | No text-moderation banner; description shown | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/29-item-edit-photo-uploaded.png`, `screenshots/30-item-detail-photo-approved-no-badge.png`
- **Acceptance criteria checklist**:
  - [x] Photo visible immediately (APPROVED)
  - [x] No stuck badge; no polling when nothing is pending

### 4.11 Pending-photo polling (simulated PENDING via response interception) — ✅ Passed
- **User story / acceptance criterion**: Req. 28, `component:pending-photo-polling`, success criterion "badge updates within ~10 s"
- **Preconditions**: Same item; `/details` response rewritten in-browser so the photo status reads PENDING, then APPROVED

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Load page with PENDING | "W moderacji" badge for the owner | Badge shown | ✅ |
| 2 | Observe requests | Refetch every 10 s | `/details` at t = 0, 10, 20 s | ✅ |
| 3 | Switch to APPROVED | Badge clears on the next poll; polling stops | Badge gone; no further `/details` requests over 30 s (repeated run: 0, 10, 20 then none) | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/31-item-detail-simulated-pending-badge.png`, `screenshots/32-item-detail-badge-cleared-after-poll.png`
- **Acceptance criteria checklist**:
  - [x] 10 s `refetchInterval` while the owner has a PENDING photo
  - [x] Stops when none remain

### 4.12 Admin moderation queue: photos only — ✅ Passed
- **User story / acceptance criterion**: Req. 7, Req. 8, Req. 29, `screen:admin-moderation-queue`
- **Preconditions**: `e2e.org2` + ADMIN (DB insert, re-login); the dev DB already held 2 PENDING photos (2026-10-02)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/admin/moderation` | Heading, status tabs kept | "Photo review" with Needs review / Pending (not scored yet) / Rejected | ✅ |
| 2 | Pending tab | Photo cards only, "No model score" | 2 cards "PHOTO · Rower / Traktor · No model score", Approve/Reject | ✅ |
| 3 | Queue API payloads | Only `subject_type: PHOTO`, no `description` | All entries PHOTO; keys lack `description` | ✅ |
| 4 | `POST /moderation/decisions` with `subject_type: PRODUCT_TEXT` | 400 validation error | 400 "Input should be … PHOTO" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/33-admin-moderation-needs-review-empty.png`, `screenshots/34-admin-moderation-pending-photos.png`
- **Acceptance criteria checklist**:
  - [x] Text cards removed; photos only
  - [x] "No model score" for unscored photos
  - [x] PRODUCT_TEXT decision rejected (400)

### 4.13 Description visible to non-owners, `text_status` removed — ✅ Passed
- **User story / acceptance criterion**: Req. 7 (item details, schemas)
- **Preconditions**: `e2e.org1` (not the owner) calls the item details of `e2e.org2`'s item

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | GET `/inventory-items/{id}/details` as non-owner | Description returned, no `text_status` | 200, description present, no `text_status` key | ✅ |
| 2 | GET `/products/{id}` | No `text_status` | Keys: id, name, description, photo_url, sku, category_id, plugin_data, created_at, updated_at | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: API responses captured in-run (no visual state). The owner view is in `screenshots/30-item-detail-photo-approved-no-badge.png`
- **Acceptance criteria checklist**:
  - [x] Description returned to every viewer

### 4.14 API startup log states both moderation flags — ❌ Failed
- **User story / acceptance criterion**: Req. 1 ("At startup the API logs one INFO line stating both flags")
- **Preconditions**: Backend container freshly started by `docker compose up`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `docker compose logs backend` | Line `MODERATION_TEXT_ENABLED=False MODERATION_IMAGE_ENABLED=False` | Absent. Only the uvicorn lines (`Started server process`, `Application startup complete`) and alembic lines appear | ❌ |

- **Issues observed**: §5.3 #1
- **Evidence**: Container log (see §6); code at `src/backend/app/main.py:74-78`; no `logging.basicConfig`/`dictConfig` in `app/` except `moderation/worker.py:85`
- **Acceptance criteria checklist**:
  - [ ] Effective flags visible in API startup logs

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**#1 Startup flag log line is not emitted by the API process**
- **Spec requirement**: Req. 1: "At startup the API logs one INFO line stating both flags … so a deploy that omits a flag is visible in the logs." Known Limitations relies on it: "The startup log line (Req. 1) makes the effective flags visible."
- **Expected**: An INFO line `MODERATION_TEXT_ENABLED=… MODERATION_IMAGE_ENABLED=…` in the backend container logs.
- **Actual**: The line is missing. `logger.info(...)` in `app/main.py` lifespan goes to the `app.main` logger. Uvicorn configures only its own loggers, and the root logger stays at the default WARNING, so the record is dropped. A WARNING (e.g. the legacy `MODERATION_ENABLED` notice) would still show through Python's last-resort handler.
- **Evidence**: `docker compose logs backend` shows only uvicorn/alembic INFO lines. `grep basicConfig|dictConfig` in `src/backend/app` matches only `moderation/worker.py:85`.
- **Root cause hypothesis**: The API process has no logging configuration for `app.*` loggers. A unit test with `caplog` would pass while the runtime prints nothing.
- **User impact**: None for end users. Operators cannot see the effective flags, which defeats the stated mitigation for `MODERATION_TEXT_ENABLED` defaulting to false in the production image.
- **Recommended fix**: Configure logging for the API: `logging.basicConfig(level=logging.INFO)` at app import, a uvicorn `--log-config`, or attach the line to the `uvicorn.error` logger. Alternatively, log the flags at WARNING when text moderation is off.
- **Workaround**: Inspect the container env (`docker compose exec backend env | grep MODERATION`).

**#2 (pre-existing, not introduced by this feature) Needed-item "Typ" select submits an empty category by default**
- **Spec requirement**: Not part of this spec. It affects the `handleAddTerm` path that Req. 25 exercises.
- **Expected**: The visibly selected default category ("Elektronika") is submitted.
- **Actual**: If the user does not touch "Typ", `POST /api/products/resolve` sends `category_id: ""`. The server returns 400 `Validation failed` with `fieldErrors.category_id`, and the modal shows the generic fallback "Nie udało się dodać terminu". `NeededItemQuickAddForm.tsx` renders a controlled `<select value={value.category_id}>` with no empty option, so the browser shows the first option while the state stays `""`. The file is unchanged in this working tree.
- **Evidence**: `screenshots/15-add-term-modal-item-name-400-real.png` (this screenshot was overwritten by the follow-up step; the first attempt's network capture: `400 /api/products/resolve {"message":"Validation failed","fieldErrors":{"category_id":"Input should be a valid UUID … found 0"}}`)
- **Root cause hypothesis**: The draft initial state has `category_id: ""` and is not seeded with `categories[0].id` once categories load.
- **User impact**: An organizer adding a needed item without touching "Typ" cannot create the term and gets a non-specific error.
- **Recommended fix**: Seed `category_id` with the first category when categories load, or add a disabled "Wybierz typ…" placeholder option plus client-side required validation. Handle this as a separate bugfix.
- **Workaround**: Explicitly pick a value in "Typ" before adding the item.

### 5.4 Cosmetic
_None observed._

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| Browser network (various `/api/...`) | `Failed to load resource: the server responded with a status of 400/503` | 26 | Minor | Expected. Every entry is a deliberately triggered 400 (real contact-info rule or mocked) or a mocked 503 |
| backend container log | `MODERATION_TEXT_ENABLED=… MODERATION_IMAGE_ENABLED=…` INFO line not present | 1 (at startup) | Minor | See §5.3 #1 |

No JavaScript exceptions, React warnings or unexpected 5xx were observed. The only other console entries were Chromium VERBOSE autocomplete hints on `/register` and `/login`.

## 7. Spec Alignment
- **Fully implemented**:
  - Req. 22: `serverMessageOr` passes 503 `message` through (verified in every form)
  - Req. 23: all seven forms show server 400/503 messages in their existing slots with the fallbacks unchanged. OnboardingWizard keeps local step errors
  - Req. 24: EditTermDialog `saveEdit` keeps the row editor open on error
  - Req. 25: `handleAddTerm` resolves products before `createTerm`; no orphan term; retry reuses the product; no duplicates (verified in DB)
  - Req. 26: add-group/add-term inline errors above the submit button, no failure toast, cleared on reopen
  - Req. 27: `role="alert"` on every error element exercised
  - Req. 28: 10 s polling only while an owner photo is PENDING; stops after APPROVED; no polling otherwise
  - Req. 29: no `text_status` in the FE/API; owner banner removed; queue is photos only; heading "Photo review"
  - Req. 7/8: description returned to non-owners; PRODUCT_TEXT decision rejected with 400; queue entries lack `description`
  - Req. 10: with `MODERATION_IMAGE_ENABLED=false` the upload is APPROVED and public immediately
  - Req. 9: migrations 0047 and 0048 applied on startup (backend log)
- **Partially implemented**:
  - Req. 1: classifier load is not exercised (flag off). The startup flags log line is coded but not emitted at runtime (§5.3 #1)
- **Not implemented**:
  - _None observed._ (Items not verifiable in this environment are listed in §8.)
- **Extra (unspecified) behavior**:
  - _None observed._

## 8. Variances from Plan
- **Moderation 400/503 for org/group/term were simulated.** The text model is not loaded (`runtime-dev`, `MODERATION_TEXT_ENABLED=false`), and these fields have no synchronous rule that returns a 400 without `fieldErrors`. Their 400/503 responses were injected per request with `page.route` using the exact catalogue strings. This checks the FE error path and copy, not the backend guard.
- **Product and needed-item paths used the real contact-info 400.** Their 503 and moderation-400 were also injected.
- **PENDING photo polling was simulated** by rewriting the `/details` response in the browser (real backend data, photo `status` overridden). Image moderation is off and no worker or VPS B runs.
- **Not verifiable in this environment**:
  - a real Bielik-Guard rejection (score ≥ 0.8) and nothing persisted;
  - a real 503 from a missing or failing classifier, and fail-fast startup when enabled;
  - the worker loop (claim, VPS B call, finalize), retries and backoff, the NEEDS_REVIEW-after-5-failures path, the lost-lease guard, and the worker's exit-when-disabled;
  - real ShieldGemma category scores and model id in the admin queue;
  - photo badge transitions driven by real moderation;
  - Dockerfile production image contents.

  These are covered only by the backend test suite and code review.
- **No queue decisions were taken.** The two PENDING photos ("Rower", "Traktor") belong to pre-existing dev data, so Approve/Reject were not clicked to avoid changing it.
- **Unexplained navigation, not reproduced.** In one long-running intercepted polling run, the page was on `/panel/rzeczy` at the end, after both screenshots had been captured on the item page. Two later runs of the same sequence (with navigation tracking) stayed on the item page. The cause is not reproducible and is not recorded as a finding.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| "All 7 forms display the server's 400/503 message in their existing slot, and OnboardingWizard's local validation messages are unchanged" | ✅ | §4.1–4.4, 4.6–4.9 |
| "the add-group/add-term modals show it inline" | ✅ | `screenshots/09-add-group-modal-inline-400.png`, `screenshots/16-add-term-modal-term-desc-400.png` |
| "EditTermDialog keeps the edited row" | ✅ | `screenshots/20-edit-term-saveEdit-400-row-open.png` |
| "`handleAddTerm` creates no term when an item name is rejected" | ✅ | §4.5 step 2 (only `/products/resolve` sent); DB count 1 after retry |
| "An owner's PENDING photo badge updates within ~10 s of the decision without a reload; polling stops when no PENDING photos remain" | ✅ | §4.11 (simulated status), `screenshots/32-item-detail-badge-cleared-after-poll.png` |
| "With text moderation enabled … each of the 4 field types returns 400 with its exact catalogue message … nothing is persisted" | ❌ | Not verifiable (model off); FE rendering of each catalogue message verified via injected responses |
| "A PENDING photo is decided from VPS B scores … NEEDS_REVIEW after the 5th failed attempt, showing 'No model score'" | ❌ | Not verifiable (no worker/VPS B). "No model score" rendering verified for unscored PENDING photos (`screenshots/34-admin-moderation-pending-photos.png`) |
| "`docker compose up` (dev) builds without `HF_TOKEN`" | ✅ | Stack running from `runtime-dev` image built 2026-10-05 09:39 |
| Req. 1 startup INFO line with both flags | ❌ | §5.3 #1 |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: §5.3 #1 (configure API logging so the startup flags line is emitted)
- **Nice-to-have**: §5.3 #2 (pre-existing needed-item category default bug; track as a separate bugfix)

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (38 files)
- **Visual-fidelity report**: _Not generated (no design_context_path)._ Only ASCII mockups exist; layout was checked informally against `analysis/design-context/ascii/ui-mockups.md` (inline E2 placement above the submit button, E1/E5 boxes) and matched.
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ⚠️ GO WITH CAVEATS. Every user-facing behavior that can be verified in the dev environment works as specified: the seven forms with verbatim server messages and `role="alert"`, inline modal errors, the row editor kept open, duplicate-free term creation, immediate photo approval with moderation off, correct 10 s polling, and a photos-only admin queue. The only runtime deviation is the missing startup flags log line, an operator-observability gap with a trivial fix. The model, worker and VPS B paths could not be exercised here and rest on the backend test suite. Recommended next step: fix-then-merge (§5.3 #1 is small); merging as is is acceptable if the log fix follows promptly.
