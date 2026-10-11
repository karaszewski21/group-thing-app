# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md (ASCII mockups in analysis/design-context/ascii/ui-mockups.md)
**Captured**: verification/screenshots/

## Summary
- Total screens compared: 7
- Match (✓): 5
- Minor deviation (⚠): 2
- Substantive drift (✗): 0
- Not compared (blocked: no media could be uploaded because of a local Spaces TLS failure; no admin login): 9 IDs. These are `screen:layout-classic-media`, `screen:layout-circles-media`, `screen:layout-schedule-media`, `screen:layout-exchange-media`, `screen:layout-links-media`, `component:gallery-block`, `component:media-status-badge`, `screen:admin-moderation-org-media` and `component:moderation-card-org`. For all five layout screens, only the gallery position (directly after `about`) was confirmed, through the owner ghost.

## Per-Screen Comparison

### screen:owner-media-empty (✓ Match)
- Mockup: analysis/design-context/ascii/ui-mockups.md#owner-empty
- Screenshot: verification/screenshots/01-visitor-rodzinny-grajdolek.png (visitor), verification/screenshots/02-owner-ghost-gallery.png (owner)
- Visitor: initials on the primary band, no gallery block, terms follow directly. ✓
- Owner: gear bar, unchanged hero, about ghost, then the gallery ghost, then "Najbliższe terminy". ✓

### component:ghost-gallery (✓ Match)
- Mockup: #owner-empty
- Screenshot: verification/screenshots/02-owner-ghost-gallery.png
- Title "Galeria", eye icon, body copy exact, CTA "Dodaj zdjęcia →" pointing to `?edit=1&tab=zdjecia` (replace navigation). ✓

### screen:editor-photos-tab (⚠ Minor Deviation)
- Mockup: #editor-photos-tab
- Screenshot: verification/screenshots/04-photos-tab-empty.png, verification/screenshots/07-schedule-draft-photos-tab.png
- Header "Wygląd strony" + X, three pills with Zdjęcia active, intro line, Logo / Okładka / Galeria sections, counter on the right, hints under the picker, footer Anuluj/Zapisz unchanged. ✓
- Deviation: the Okładka note reads "Widoczna u góry strony w każdym układzie." instead of "Widoczna w układach Klasyczny i Grupy.", and the optional "W wybranym układzie ({label}) okładka nie jest widoczna." line does not appear on SCHEDULE.
- Impact: the copy matches the implemented behaviour (the cover now renders in every hero variant), but the mockup and spec R26 do not match it.
- Recommendation: confirm the change and update the mockup and spec.

### component:photos-tab (✓ Match)
- Mockup: #editor-photos-tab
- Screenshot: verification/screenshots/05-logo-uploaded.png, verification/screenshots/06-logo-upload-500-fallback.png
- Each section has its own `aria-busy` (true during the upload) and its own `role="alert"` line under the section that failed. ✓ Polling was not observable (no pending rows).

### component:photo-slot (✓ Match, states S1/S2/S7 only)
- Mockup: #photo-slot
- Screenshot: verification/screenshots/04-photos-tab-empty.png, verification/screenshots/06-logo-upload-500-fallback.png
- S1: dashed round initials thumb "OB" for the logo, a dashed 16:9 placeholder for the cover, the copy, and "+ Dodaj logo" / "+ Dodaj okładkę". ✓
- S2: "Wysyłanie…" without a percentage, section busy. ✓
- S7: "Nie udało się wysłać zdjęcia. Spróbuj ponownie." in danger text under the slot. ✓
- S3-S6: not reachable (blocked).

### component:gallery-editor (✓ Match, state G1 only)
- Mockup: #gallery-editor
- Screenshot: verification/screenshots/04-photos-tab-empty.png
- "Galeria" heading, "0/3" counter on the right, "Brak zdjęć.", "+ Dodaj zdjęcie" (44px), two hint lines. ✓ G2-G6 not reachable.

### component:hero-media (⚠ Minor Deviation, code-read only, not rendered)
- Mockup: #hero-media
- Screenshot: verification/screenshots/02-owner-ghost-gallery.png (no-media fallback only)
- The fallback (initials on the `bg-primary` band) matches. ✓
- Deviation (seen in the source, not on screen): `HeroBlock.tsx` also renders the cover in the `compact` variant (thin strip) and the `centered` variant (card over the cover). The mockup and R22 say "cover only in `cover`" and "Compact hero … no cover".
- Recommendation: confirm with the design owner and update the mockups, or revert.

---

## Iteration 2 (2026-10-11)

Uploads now work locally. Moderation is on, so every row stayed PENDING. Nothing reached APPROVED, and no admin login is available.

### Summary (Iteration 2)
- Previously blocked IDs re-checked: 9
- Match (✓): 1 (`component:media-status-badge`)
- Minor deviation (⚠): 0
- Substantive drift (✗): 0
- Still blocked: 8. These are `screen:layout-classic-media`, `screen:layout-circles-media`, `screen:layout-schedule-media`, `screen:layout-exchange-media`, `screen:layout-links-media` and `component:gallery-block`, all needing APPROVED media, plus `screen:admin-moderation-org-media` and `component:moderation-card-org`, which need an admin login.
- Re-assessed from Iteration 1: `screen:editor-photos-tab` ⚠ → ✓ (the spec now says "Widoczna u góry strony w każdym układzie."; UI matches). `component:hero-media` ⚠ → ✓ as to spec (cover-in-every-variant is now the approved behaviour; rendering itself still not observed). `component:photo-slot` and `component:gallery-editor` gained states S3 and G2/G3/G5/G6.
- Running totals (Iteration 1 + 2): 8 IDs compared, 8 ✓, 0 ⚠, 0 ✗, 8 blocked.

### component:media-status-badge (✓ Match)
- Mockup: analysis/design-context/ascii/ui-mockups.md#badge
- Screenshot: verification/screenshots/i2-01-photos-tab-all-pending.png
- PENDING → pill "W weryfikacji" in the cream/ink-soft style, small extrabold text, next to the logo/cover status and on every gallery row. ✓ REJECTED ("Odrzucone") and APPROVED ("Na stronie", no badge) not reachable.

### component:photo-slot (✓ Match, now S1/S2/S3/S7)
- Screenshot: verification/screenshots/i2-01-photos-tab-all-pending.png, verification/screenshots/i2-07-cleanup-empty.png
- S3: round 48px logo thumb / 16:9 cover thumb, badge, "Odwiedzający zobaczą je po sprawdzeniu.", primary "Zmień logo"/"Zmień okładkę" and secondary "Anuluj". ✓ Matches Mockup "S3 first upload, pending".
- S7: server duplicate message and client invalid-file message in the section `role="alert"`. ✓

### component:gallery-editor (✓ Match, now G1/G2/G3/G6)
- Screenshot: verification/screenshots/i2-01-photos-tab-all-pending.png (G3), verification/screenshots/i2-03-gallery-after-delete.png (G2), verification/screenshots/i2-04-gallery-duplicate-409.png (G6)
- G3: counter "3/3", three rows "Zdjęcie N (W weryfikacji) ˄ ˅ 🗑", ˄ greyed on row 1 and ˅ on row 3, dimmed "+ Dodaj zdjęcie" with "Osiągnięto limit 3 zdjęć.". ✓
- G2: "2/3", picker re-enabled, hints restored. ✓
- G6: "To zdjęcie jest już w galerii." under the section. ✓
- G4 (rejected rows below a divider) not reachable.

### Layout screens with media and component:gallery-block (Blocked)
- Visitor and owner views with only PENDING media match `screen:owner-media-empty` (initials, no gallery for visitors; ghost for the owner): verification/screenshots/i2-05-visitor-pending-nothing-new.png, verification/screenshots/i2-06-owner-pending-page-unchanged.png. The media-bearing variants of the 5 layout screens and the gallery block were not reachable.
