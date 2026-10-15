# E2E Verification Report

## 1. Identifier
- **Task**: 2026-10-14-group-soft-delete-restore
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-14-group-soft-delete-restore
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-14-group-soft-delete-restore\implementation\spec.md
- **Date**: 2026-10-14
- **Git ref**: 46e63f1 (feat/placeholders, uncommitted working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5174 (docker frontend, `/api` proxied to backend on :8080) |
| Browser | Chromium (Playwright MCP, plugin maister) |
| Viewport | 1920×842 (default desktop) |
| Auth context | Organizer `e2e.softdel.1014a@example.com` (ORGANIZER, registered via UI); Admin `e2e.softdel.admin1014a@example.com` (registered via API, ADMIN granted via psql) |
| Test data | Live local DB, migration 0056 applied. Groups "E2E Alfa" (50485fc7-…) and "E2E Beta" (f9e92bd5-…); Beta term 21.10.2026 17:00 with one anonymous RSVP (API); Alfa term 28.10.2026 inserted via psql while Alfa was deleted (to obtain a public term URL) |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 6 |
| Scenarios executed | 6 |
| Passed | 6 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 1 |
| Cosmetic issues | 0 |

Every acceptance path in the requested scenarios works end to end. The confirmation dialog opens with focus on "Anuluj" and traps Tab. Esc and a scrim click cancel without deleting anything. A confirmed delete shows the busy state, then the toast "Usunięto grupę", removes the tile and updates the count without the full skeleton. The 409 RSVP block is shown inline and verbatim. A deleted group's public term URL renders "Nie znaleziono". The admin Active/Deleted toggle, the Deleted columns, Restore (busy and error states) and the reappearance in the panel and on the public URL all work. One minor issue: after a failed delete attempt, closing the dialog calls a non-silent `load()`. That flashes the full "Wczytywanie…" skeleton, remounts the tiles and drops focus to `main` instead of returning it to the trash button that still exists.

## 4. Verification Scenarios

### 4.1 Organizer opens the dialog, cancels with Esc, then deletes — ✅ Passed
- **User story / acceptance criterion**: Story 1; Req 15, 17, 18; Visual Design `component:delete-group-trigger`, `component:delete-group-dialog`, `component:delete-group-dialog-busy`, `screen:panel-spotkania-after-delete`
- **Preconditions**: New organizer registered via UI (onboarding created "E2E Alfa"); "E2E Beta" added via "+ Dodaj grupę"; panel `/panel/spotkania` shows "Grupy · 2"

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Inspect trash button | aria-label "Usuń grupę E2E Alfa", `aria-haspopup="dialog"` | Both present | ✅ |
| 2 | Click trash | alertdialog, aria-modal, title „…”?, body copy, focus on Anuluj | `role=alertdialog`, `aria-modal="true"`, title "Usunąć grupę „E2E Alfa”?", body exact, active element "Anuluj", card `max-w-[340px] rounded-[24px] bg-paper p-5` | ✅ |
| 3 | Tab, Tab | Focus cycles inside the dialog | Back on "Anuluj" (trapped) | ✅ |
| 4 | Esc | Dialog closes, focus returns to trash, nothing deleted | Closed; focus on "Usuń grupę E2E Alfa"; DB `deleted_at` still NULL for both groups | ✅ |
| 5 | Reopen, click "Usuń grupę" (DELETE delayed 2.5 s) | Busy: "Usuwanie…", both disabled, `aria-busy`, focus on dialog | Exactly that; focus moved to dialog container | ✅ |
| 6 | Esc while busy | Ignored | Dialog stayed open | ✅ |
| 7 | Wait for completion | Toast "Usunięto grupę", tile gone, "Grupy · 1", no full skeleton, focus on `main[tabindex=-1]` | Toast shown, tiles ["E2E Beta"], "Grupy · 1", skeleton observer count 0, focus MAIN#-1 | ✅ |
| 8 | DB check | `deleted_at` set, `deleted_by_party_id` = organizer | `deleted_at` 2026-10-14 14:46:13 UTC, deleted-by profile = organizer email | ✅ |
| 9 | Later rerun: scrim click (5,5) | Cancels | Dialog closed | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-panel-two-groups.png`, `screenshots/02-delete-dialog-open.png`, `screenshots/03-delete-dialog-busy.png`, `screenshots/04-after-delete-toast.png`
- **Acceptance criteria checklist**:
  - [x] Trash asks for confirmation (alertdialog, initial focus Anuluj, Tab trap)
  - [x] Esc / scrim cancel without deleting
  - [x] Busy state per mockup
  - [x] Toast, tile removed, count updated, no skeleton flash

### 4.2 Delete blocked by an upcoming term with an RSVP (409) — ⚠️ Passed with issues
- **User story / acceptance criterion**: Story 2; Req 3 (409 message); Visual Design `component:delete-group-dialog-error`
- **Preconditions**: "E2E Beta" has a term on 21.10.2026 17:00 with one active anonymous RSVP

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Trash → "Usuń grupę" | 409, inline `role=alert` with the nearest date, dialog open, no toast | Alert "Grupy nie można usunąć — na termin śr 21.10 są zapisy. Spróbuj po tym terminie albo gdy uczestnicy się wypiszą.", class `mt-3 text-sm font-semibold text-danger`, dialog open, no `role=status` | ✅ |
| 2 | After the error | Buttons re-enabled, focus on Anuluj | Both enabled; active element "Anuluj" | ✅ |
| 3 | Click Anuluj (after the failed attempt) | Dialog closes, `load()` refreshes, focus returns to the opener (trash still exists) | Dialog closes and the data refreshes, but the full "Wczytywanie…" skeleton flashes (observer count 1), tiles remount, focus lands on `main[tabindex=-1]` | ⚠️ |
| 4 | Cancel without a prior attempt (control) | Focus returns to trash | Focus on "Usuń grupę E2E Beta" | ✅ |

- **Issues observed**: §5.3 Minor-1
- **Evidence**: `screenshots/05-delete-409-inline-error.png`
- **Acceptance criteria checklist**:
  - [x] 409 message verbatim with the nearest date (`format_term_day` → "śr 21.10")
  - [x] Dialog stays open, no toast
  - [ ] Closing after a failure keeps focus on the opener and avoids the skeleton (minor deviation)

### 4.3 Deleted group's public link → "Nie znaleziono" — ✅ Passed
- **User story / acceptance criterion**: Story 3; Table A1/A6
- **Preconditions**: "E2E Alfa" soft-deleted; a term row for it exists

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `GET /api/groups/public/{alfa}` | 404 | 404 "Group with id … not found" (Beta control → 200) | ✅ |
| 2 | Open `/e2e-softdel-org/grupa/{alfa}/term/{term}` | "Nie znaleziono" | `main` = "Nie znaleziono" (`/access` → 404) | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/06-deleted-group-public-not-found.png`
- **Acceptance criteria checklist**:
  - [x] Public link answers "not found"

### 4.4 Admin Active/Deleted toggle and Restore — ✅ Passed
- **User story / acceptance criterion**: Story 4; Req 5, 19, 20; Visual Design `screen:admin-groups`, `screen:admin-groups-deleted`, `component:admin-group-restore-button`, `screen:admin-groups-deleted-empty`
- **Preconditions**: Admin logged in via `/login`; Alfa deleted

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/admin/groups` | Toggle `role=group` "Group status", Active pressed; Active table unchanged, no Alfa | Active:true / Deleted:false; headers Name/Organizer/Members/Terms/Created; Alfa absent, Beta present; "Showing 16 of 16 circles" | ✅ |
| 2 | Click Deleted (request delayed 1.5 s) | No rows from the previous view while loading | 0 rows, "Loading...", no Beta; Deleted aria-pressed=true | ✅ |
| 3 | Deleted view loaded | Columns + Deleted at (local DD.MM.YYYY HH:mm) / Deleted by / Actions | Headers …/Deleted at/Deleted by/Actions; Alfa: "14.10.2026 16:46" (14:46 UTC → Warsaw), "E2E Softdel 1014A", Restore; footer "Showing 1 of 1 deleted circle" | ✅ |
| 4 | Restore (delayed 1.5 s) | "Restoring…", disabled | "Restoring…", disabled | ✅ |
| 5 | After restore | Row leaves Deleted, empty state, focus on Deleted filter | "No deleted circles"; focus on "Deleted" (aria-pressed=true) | ✅ |
| 6 | Switch to Active | Alfa listed | Alfa row present | ✅ |
| 7 | Extra: restore with a stubbed 409 | Inline `role=alert` with the server message, button re-enabled | Alert "Grupa nie jest usunięta", button "Restore" enabled; real restore afterwards succeeded | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-admin-groups-active.png`, `screenshots/08-admin-groups-deleted.png`, `screenshots/09-admin-restore-busy.png`, `screenshots/10-admin-deleted-empty-after-restore.png`, `screenshots/11-admin-active-after-restore.png`, `screenshots/14-admin-restore-error.png`
- **Acceptance criteria checklist**:
  - [x] Toggle with aria-pressed, no stale rows
  - [x] Deleted at / Deleted by / Actions
  - [x] One-click restore with busy state; row moves to Active
  - [x] Inline restore error

### 4.5 Organizer panel and public URL after restore — ✅ Passed
- **User story / acceptance criterion**: Story 4 / Success Criteria ("reappears in Active and on its public URL")
- **Preconditions**: Alfa restored by the admin; organizer logs in again

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Organizer `/panel/spotkania` | Alfa tile back, "Grupy · 2" | Tiles ["E2E Beta","E2E Alfa"], "Grupy · 2" | ✅ |
| 2 | Public term URL of Alfa | Page renders | Title "E2E Alfa", term "Środa, 28 października 2026 godz. 17:00" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/12-panel-after-restore.png`, `screenshots/13-public-term-after-restore.png`
- **Acceptance criteria checklist**:
  - [x] Group visible in the panel again
  - [x] Public URL works again

### 4.6 Console check across all scenarios — ✅ Passed
- **User story / acceptance criterion**: Agent guideline (no unexpected console errors)
- **Preconditions**: Whole session

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Collect console errors and warnings | Only expected HTTP-status resource errors | 5 resource errors in total (see §6), all expected or caused by the tester; no JS exceptions, no warnings | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: inline in §6
- **Acceptance criteria checklist**:
  - [x] No uncaught JS errors

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**Minor-1: closing the dialog after a failed delete flashes the full skeleton and loses the opener focus**
- **Spec requirement**: Req 18 ("On close it returns focus to the opener … If an attempt failed and the dialog is then closed, call `load()`"); accessibility.md (focus returned to the opener); scenario expectation "panel does not flash the full skeleton"
- **Expected**: After a 409, Anuluj/Esc closes the dialog, the panel refreshes quietly and focus returns to the "Usuń grupę E2E Beta" button, which still exists.
- **Actual**: `SpotkaniaView.closeDeleteDialog` calls `void load()` without `{ silent: true }`. The panel briefly shows the full "Wczytywanie…" screen, the tiles remount (the old trash node becomes disconnected), and `DeleteGroupDialog` falls back to `main[tabindex=-1]`.
- **Evidence**: `screenshots/05-delete-409-inline-error.png` (pre-close state); runtime probe: skeleton observer count 1, `oldConnected: false`, active element MAIN#-1 (control without a prior attempt: focus correctly on the trash button)
- **Root cause hypothesis**: `src/frontend/src/pages/panel/views/SpotkaniaView.tsx` `closeDeleteDialog()` → `void load()` should be `void load({ silent: true })`. `handleRemoveGroup` already uses the silent form.
- **User impact**: A brief full-page flicker, and keyboard/screen-reader users lose their place after a blocked delete.
- **Recommended fix**: Use `load({ silent: true })` in `closeDeleteDialog`. The tile then stays mounted and the opener-focus logic works.
- **Workaround**: None needed functionally; the user re-navigates with Tab.

### 5.4 Cosmetic
_None observed._

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `/api/groups/mine` | 400 Bad Request | 1 | Minor | Caused by the tester (a manual fetch without a body); not app behavior |
| `/api/groups/f9e92bd5-…` (DELETE) | 409 Conflict | 2 | Minor | Expected (scenario 2 RSVP block); handled inline |
| `/api/groups/public/50485fc7-…/access` | 404 Not Found | 1 | Minor | Expected (deleted group → "Nie znaleziono") |
| `/api/organizations/mine` | 404 Not Found | 2 | Minor | The admin account has no organization; pre-existing, unrelated to this feature |
| `/api/groups/50485fc7-…/restore` | 409 Conflict | 1 | Minor | Stubbed by the tester via a route to test the error UI |

No JavaScript exceptions or console warnings were recorded.

## 7. Spec Alignment
- **Fully implemented**: confirmed delete dialog (copy, alertdialog, aria-modal, initial focus, Tab trap, Esc and scrim cancel, busy state, Esc ignored while busy, focus to the dialog container while busy); `aria-haspopup` on the trash button; DELETE 204 with `deleted_at` + `deleted_by_party_id`; 409 nearest-term message via `format_term_day`; success toast, tile removal, count update with a silent refresh; public view 404 → "Nie znaleziono"; admin toggle (`role=group`, `aria-pressed`, no stale rows), Deleted columns, local-time "Deleted at", "Deleted by" name, per-row Restore with busy/error, "No deleted circles" empty state, deleted footer copy, focus to the Deleted filter after restore; restore makes the group reappear in Active, in the organizer panel and on its public URL
- **Partially implemented**: focus return and a quiet refresh after closing the dialog following a failed attempt (Minor-1)
- **Not implemented**: _None observed._
- **Extra (unspecified) behavior**: _None observed._

## 8. Variances from Plan
- The Beta term and its RSVP were created through the API from inside the page (`POST /api/terms`, `POST /api/groups/public/{id}/rsvp`), not through the UI.
- The admin user was registered via `POST /api/auth/register` and granted ADMIN via psql, as instructed.
- To get a real public term URL for the deleted group, a term row for "E2E Alfa" was inserted via psql while the group was deleted (the API correctly refuses to create one).
- Busy states were made observable by delaying DELETE/restore with Playwright request routing. The restore error path was exercised with a stubbed 409 response, because a real 409 needs a race between two tabs.
- The extra checks (scrim cancel, restore error) deleted and restored "E2E Alfa" a second time; final state: both groups live.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| The organizer panel and the guest panel both load after one of their groups is deleted | ✅ | Organizer panel reloaded fine after the delete (`screenshots/04-after-delete-toast.png`); the guest panel was not exercised |
| An admin can see the deleted group (date and actor) under Deleted and restore it in one click; it reappears in Active and on its public URL | ✅ | `screenshots/08-admin-groups-deleted.png`, `screenshots/11-admin-active-after-restore.png`, `screenshots/13-public-term-after-restore.png` |
| Every A-row path returns 404 or omits the group after a delete (UI-reachable subset) | ✅ | Panel listing omits it; public view 404 (`screenshots/06-deleted-group-public-not-found.png`); admin Active list omits it |
| The 409 names the nearest blocking term | ✅ | "…na termin śr 21.10 są zapisy…" (`screenshots/05-delete-409-inline-error.png`) |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: §5.3 Minor-1 (use `load({ silent: true })` in `SpotkaniaView.closeDeleteDialog`)
- **Nice-to-have**: _None._

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (14 files)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
⚠️ GO WITH CAVEATS. All six scenarios pass end to end: confirmed soft delete, the inline 409 block, the "not found" public link, the admin Deleted view with one-click restore, and the group reappearing for the organizer. The only finding is a minor focus and flicker regression when the dialog is closed after a failed attempt, which is a one-line fix. Recommendation: fix then merge (merging as is is acceptable).
