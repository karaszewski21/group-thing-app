# Design Context Index

Task: A2 "Układ i edytor" (`2026-10-07-organizer-layout-editor-a2`). Paths are relative to `analysis/design-context/`.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:org-public-classic | screen | ascii/ui-mockups.md#org-public-classic | Public `/:slug` in CLASSIC: hero:color · Udostępnij · about (owner ghost, primary slot) · footer; visitor vs owner side by side |
| screen:org-public-links | screen | ascii/ui-mockups.md#org-public-links | Public `/:slug` in LINKS "Wizytówka": centered hero · link-stack ("Udostępnij stronę", primary) · about:short ghost · footer |
| component:ghost-block | component | ascii/ui-mockups.md#ghost-block | Owner-only, non-interactive dashed placeholder "Opis — wkrótce"; never rendered for visitors |
| component:edit-appearance-button | component | ascii/ui-mockups.md#edit-appearance-button | Owner-only fixed bottom pill "Edytuj wygląd" (bg-ink), sets `?edit=1`, hidden while the sheet is open |
| screen:org-edit-sheet-layout | screen | ascii/ui-mockups.md#org-edit-sheet-layout | Non-modal EditorSheet over the live preview, "Układ" tab: CLASSIC/LINKS cards with SVG thumbnails, "Polecany" badge, footer Anuluj/Zapisz states |
| screen:org-edit-sheet-colors | screen | ascii/ui-mockups.md#org-edit-sheet-colors | "Kolory" tab: preset radiogrid (Mięta (domyślna) first, "Własny" last), mini previews, "Przywróć domyślne" |
| component:custom-color-picker | component | ascii/ui-mockups.md#custom-color-picker | "Własny" picker: required primary (color + hex input), optional accent (Automatyczny/Własny), contrast-adjustment hint, hex validation |
| component:preview-cards | component | ascii/ui-mockups.md#preview-cards | TermPreviewCard + ProductPreviewCard in the draft palette (static, non-interactive) |
| component:save-error | component | ascii/ui-mockups.md#save-error | Save error area (role=alert) with Polish messages for 400/403/409/network |
| component:unsaved-confirm | component | ascii/ui-mockups.md#unsaved-confirm | In-scope Tailwind alertdialog "Odrzucić zmiany?" (Wróć do edycji / Odrzuć), on X while dirty and useBlocker |
| flow:editor-entry | flow | ascii/ui-mockups.md#editor-entry-flow | Entry points → `?edit=1` → owner check → sheet open/ignored; close and exit paths |
| component:account-menu-entry | component | ascii/ui-mockups.md#account-menu-entry | AccountMenu "Moja organizacja" → `/${slug}?edit=1` (fallback `/organization`) |
| component:home-hint | component | ascii/ui-mockups.md#home-hint | HomeView HintCard: copy "Wybierz układ i kolory swojej strony — zobaczą je odwiedzający.", ctaTo `/${slug}?edit=1` |
