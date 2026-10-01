# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (14 IDs). Mockup file: `analysis/design-context/ascii/ui-mockups.md`.

| Screen/Component ID | Mockup section (lines) | Covered By Task Group(s) | Status |
|---------------------|------------------------|--------------------------|--------|
| screen:item-detail-view | Mockup 1 (89-165) | Group 6 (`ItemDetailPage.tsx`, `ItemBackButton.tsx`, `ItemReadOnlyParts.tsx`); data from Group 2 (`/details`, `/history`) and Group 5 (hooks) | Covered |
| screen:item-detail-edit | Mockup 5 (246-282) | Group 6 (`ItemEditPage.tsx`, standalone page with the owner/deleted guard; `EditableField` private to it; replace navigation for "Gotowe" / "Wróć do podglądu"); mutations from Group 3 and Group 5 (`useItemEditing`) | Covered |
| screen:item-detail-states | Mockup 9 (359-406) | Group 6 (`ItemLoadStates.tsx`; notFound = 404 or 400); deleted → 200 contract from Group 2 | Covered |
| screen:item-detail-non-owner | Mockup 10 (407-426) | Group 6; `is_owner` and privacy labels from Group 2 | Covered |
| component:item-gallery | Mockup 2 (166-187) | Group 6 (`ItemGallery.tsx`, view only); `product_photos` table from Group 1 | Covered |
| component:item-status-card | Mockup 3 (188-212) | Group 6 (`ItemTimeline.tsx`); status derivation from Group 2 | Covered |
| component:item-history-list | Mockup 4 (213-245) | Group 6 (`ItemTimeline.tsx`); history payload from Group 2 | Covered |
| component:item-edit-name-category | Mockup 6 (283-306) | Group 6 (`ItemFieldEditors.tsx`, used by `ItemEditPage.tsx`; includes the rename hint that photos and description belong to the product); markup moved from RzeczyView, whose copy Group 7 deletes | Covered |
| component:item-edit-condition-description | Mockup 7 (307-325) | Group 6 (`ItemFieldEditors.tsx`); `PATCH …/description` from Group 3 | Covered |
| component:item-gallery-editor | Mockup 8 (326-358) | Group 6 (`ItemGalleryEditor.tsx`, limit `MAX_PRODUCT_PHOTOS` from `itemPageShared.ts`); product photo endpoints from Group 3 | Covered |
| component:rzeczy-card-item-links | Mockup 11 (427-449) | Group 7 (RzeczyView, `EyeIcon`) | Covered |
| component:wypozyczone-row-view-link | Mockup 12 (450-472) | Group 7 (WypozyczoneView `LoanRow`) | Covered |
| component:term-listing-title-link | Mockup 13 (473-498) | Group 7 (PublicTermView `toListingRow`); route + AuthGuard from Group 6 | Covered |
| component:notification-item-reserved | Mockup 14 (499-521) | Group 7 (TS `NotificationKind` union); backend producer and `/product/{id}` link from Group 4 | Covered |

## Uncovered Items

All screens covered (14 of 14).

## Spec overrides applied to the mockups
- `screen:item-detail-edit` and `screen:item-detail-non-owner`: the mockups say `?mode=edit`. The spec overrides this with the `/product/:id/edit` route (Q1). Group 6 implements it as the standalone `ItemEditPage`, separate from `ItemDetailPage`; there is no shared mode shell.
- `component:item-status-card`: the spec adds the `PROPOSED_SWAP` and `RETURNING` variants to the mockup's set. Both are covered by Group 2 (derivation) and Group 6 (copy).
- `component:notification-item-reserved`: no NotificationBell change, only the union is extended (spec).
