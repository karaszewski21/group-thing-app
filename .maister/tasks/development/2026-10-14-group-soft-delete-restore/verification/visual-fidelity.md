# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md (mockups: analysis/design-context/ascii/ui-mockups.md)
**Captured**: verification/screenshots/

## Summary
- Total screens compared: 9
- Match (✓): 8
- Minor deviation (⚠): 1
- Substantive drift (✗): 0

## Per-Screen Comparison

### component:delete-group-trigger (⚠ Minor Deviation)
- Mockup: ascii/ui-mockups.md#delete-group-trigger
- Screenshot: verification/screenshots/01-panel-two-groups.png
- Layout: tile with layout icon and pencil + trash pill buttons, unchanged ✓
- aria-label "Usuń grupę {name}" unchanged, `aria-haspopup="dialog"` present ✓
- Deviation: the focus-return anchor works after cancel or Esc, but **not** after closing the dialog following a failed attempt. A non-silent `load()` remounts the tile and focus falls back to `main` (see the E2E report, Minor-1)
- Recommendation: `load({ silent: true })` in `closeDeleteDialog`

### component:delete-group-dialog (✓ Match)
- Mockup: ascii/ui-mockups.md#delete-group-dialog
- Screenshot: verification/screenshots/02-delete-dialog-open.png
- Layout: centered card `max-w-[340px] rounded-[24px] bg-paper p-5` over the scrim ✓
- Order: title "Usunąć grupę „E2E Alfa”?" → body copy (exact, "napisz do nas" is plain text) → [Anuluj][Usuń grupę] side by side ✓
- Styles: Anuluj cream/outlined, Usuń grupę danger fill ✓
- Behavior: alertdialog, aria-modal, initial focus Anuluj, Tab trap, Esc and scrim cancel ✓

### component:delete-group-dialog-busy (✓ Match)
- Mockup: ascii/ui-mockups.md#delete-group-dialog-busy
- Screenshot: verification/screenshots/03-delete-dialog-busy.png
- Label "Usuwanie…" in place, both buttons disabled, `aria-busy="true"` on the danger button, focus on the dialog container, Esc ignored ✓

### component:delete-group-dialog-error (✓ Match)
- Mockup: ascii/ui-mockups.md#delete-group-dialog-error
- Screenshot: verification/screenshots/05-delete-409-inline-error.png
- Inline `p role="alert"` between the body and the buttons, `text-sm font-semibold text-danger` (the mockup allows the text-only variant) ✓
- The 409 server message is verbatim with the date "śr 21.10"; the dialog stays open and focus returns to Anuluj ✓
- Note: the generic fallback copy was not exercised at runtime (it is covered by unit tests)

### screen:panel-spotkania-after-delete (✓ Match)
- Mockup: ascii/ui-mockups.md#panel-spotkania-after-delete (5a)
- Screenshot: verification/screenshots/04-after-delete-toast.png
- Tile removed, "Grupy · 1", remaining tile reflowed, toast "Usunięto grupę" at the bottom, no skeleton flash ✓

### screen:admin-groups (✓ Match)
- Mockup: ascii/ui-mockups.md#admin-groups-active
- Screenshot: verification/screenshots/07-admin-groups-active.png
- Header + subtitle, then the [Active (solid)] [Deleted (outline)] toggle above the table, `role=group` "Group status", `aria-pressed` ✓
- Active table columns unchanged (Name / Organizer / Members / Terms / Created), footer "Showing N of M circles" ✓

### screen:admin-groups-deleted (✓ Match)
- Mockup: ascii/ui-mockups.md#admin-groups-deleted
- Screenshot: verification/screenshots/08-admin-groups-deleted.png
- Columns Name / Organizer / Members / Terms / Created / Deleted at / Deleted by / Actions (visible "Actions" header, per audit resolution L2) ✓
- Deleted at "14.10.2026 16:46" (DD.MM.YYYY HH:mm, local time); Deleted by shows the name ✓
- Footer "Showing 1 of 1 deleted circle" ✓

### component:admin-group-restore-button (✓ Match)
- Mockup: ascii/ui-mockups.md#admin-groups-deleted
- Screenshots: verification/screenshots/09-admin-restore-busy.png, verification/screenshots/14-admin-restore-error.png
- Small green outline "Restore", `aria-label="Restore {name}"`, busy "Restoring…" (disabled), inline `role=alert` error in the cell with the button re-enabled; on success the row leaves and focus moves to the "Deleted" filter ✓

### screen:admin-groups-deleted-empty (✓ Match)
- Mockup: ascii/ui-mockups.md#admin-groups-deleted-empty
- Screenshot: verification/screenshots/10-admin-deleted-empty-after-restore.png
- The toggle stays visible above the empty state "No deleted circles"; "Loading..." was shown while the request was delayed ✓
