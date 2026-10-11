# Design Context Index

Task: D — organization photos (logo, cover, gallery up to 3). Paths are relative to the task directory.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:layout-classic-media | screen | analysis/design-context/ascii/ui-mockups.md#layout-classic | `/:slug` CLASSIC visitor: cover hero with logo, gallery:grid after `about` (before upcoming-terms) |
| screen:layout-circles-media | screen | analysis/design-context/ascii/ui-mockups.md#layout-circles | `/:slug` CIRCLES visitor: cover hero with logo, gallery after `about` (2-photo grid) |
| screen:layout-schedule-media | screen | analysis/design-context/ascii/ui-mockups.md#layout-schedule | `/:slug` SCHEDULE visitor: compact hero with 56px logo (no cover), gallery after `about` |
| screen:layout-exchange-media | screen | analysis/design-context/ascii/ui-mockups.md#layout-exchange | `/:slug` EXCHANGE visitor: compact hero with logo, gallery after `about` (1-photo 4:3) |
| screen:layout-links-media | screen | analysis/design-context/ascii/ui-mockups.md#layout-links | `/:slug` LINKS visitor: centered hero with 80px logo, gallery after `about` |
| screen:owner-media-empty | screen | analysis/design-context/ascii/ui-mockups.md#owner-empty | No approved media: visitor (initials, no gallery) vs owner (gallery ghost with "Dodaj zdjęcia →") |
| screen:editor-photos-tab | screen | analysis/design-context/ascii/ui-mockups.md#editor-photos-tab | EditorSheet third tab "Zdjęcia": Logo / Okładka (layout note) / Galeria; immediate save outside the draft |
| screen:admin-moderation-org-media | screen | analysis/design-context/ascii/ui-mockups.md#admin-card | Admin photo moderation queue entry for organization media |
| component:hero-media | component | analysis/design-context/ascii/ui-mockups.md#hero-media | HeroBlock: logo replaces initials in cover/compact/centered; cover image + scrim in `cover`, bg-primary fallback |
| component:gallery-block | component | analysis/design-context/ascii/ui-mockups.md#gallery-block | GalleryBlock `grid`: APPROVED only, 3/2/1-column SafeImage tiles, hidden for visitors when empty |
| component:ghost-gallery | component | analysis/design-context/ascii/ui-mockups.md#owner-empty | GhostBlock `gallery` copy; CTA link `?edit=1&tab=zdjecia` opens the editor on the Zdjęcia tab |
| component:photos-tab | component | analysis/design-context/ascii/ui-mockups.md#editor-photos-tab | PhotosTab.tsx: sections, "Zdjęcia zapisują się od razu.", per-section busy + role=alert, 10 s polling while pending |
| component:photo-slot | component | analysis/design-context/ascii/ui-mockups.md#photo-slot | Logo/Okładka slot states S1-S7: empty, uploading, pending, approved, approved+pending, rejected, errors |
| component:gallery-editor | component | analysis/design-context/ascii/ui-mockups.md#gallery-editor | Galeria section G1-G6: counter N/3, up/down reorder, delete, limit 3/3, rejected rows below divider, 409 errors |
| component:media-status-badge | component | analysis/design-context/ascii/ui-mockups.md#badge | ModerationBadge with an org labels map: "W weryfikacji" (PENDING/NEEDS_REVIEW), "Odrzucone" |
| component:moderation-card-org | component | analysis/design-context/ascii/ui-mockups.md#admin-card | PhotoModerationCard title "Organization · {name} · {kind}" (Logo/Cover/Gallery) |
