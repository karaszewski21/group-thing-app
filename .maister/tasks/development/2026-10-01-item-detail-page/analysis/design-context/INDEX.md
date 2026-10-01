# Design Context Index

Stable IDs for the implementation-planner's `Visual References`.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:item-detail-view | screen | analysis/design-context/ascii/ui-mockups.md#item-page-view | `/product/:id` view mode (owner): PhoneFrame, back link, gallery, name, category and condition meta, Opis, Aktualny status, Historia, owner-only "Edytuj" |
| screen:item-detail-edit | screen | analysis/design-context/ascii/ui-mockups.md#item-page-edit | `/product/:id?mode=edit` owner edit mode: per-field rows with pencil icons, "Gotowe" exit |
| screen:item-detail-states | screen | analysis/design-context/ascii/ui-mockups.md#item-page-states | Loading, not found, error + retry, deleted ("Rzecz usunięta" banner, read-only), empty history |
| screen:item-detail-non-owner | screen | analysis/design-context/ascii/ui-mockups.md#item-page-non-owner | Non-owner view: no edit controls, `?mode=edit` ignored, third-party privacy labels |
| component:item-gallery | component | analysis/design-context/ascii/ui-mockups.md#item-gallery | Gallery view: main 4:3 image + thumbnail strip, Product.photo_url fallback, PhotoPlaceholder |
| component:item-status-card | component | analysis/design-context/ascii/ui-mockups.md#item-status-block | "Aktualny status": Dostępna / Zarezerwowana / W drodze / Pożyczona do / Usunięta, with counterparty label |
| component:item-history-list | component | analysis/design-context/ascii/ui-mockups.md#item-history | "Historia" timeline: date tile, movement type, server-built privacy-labelled description, term date as plain text |
| component:item-edit-name-category | component | analysis/design-context/ascii/ui-mockups.md#item-edit-name-category | Inline name input + category select, Zapisz/Anuluj (re-point to catalog product via resolveProduct) |
| component:item-edit-condition-description | component | analysis/design-context/ascii/ui-mockups.md#item-edit-condition | Inline condition select and description textarea (plugin_data), Zapisz/Anuluj |
| component:item-gallery-editor | component | analysis/design-context/ascii/ui-mockups.md#item-edit-gallery | Gallery editor: URL add with validation error, remove, move up/down, 10-photo limit |
| component:rzeczy-card-item-links | component | analysis/design-context/ascii/ui-mockups.md#rzeczy-card-icons | RzeczyView card right rail: view (Eye) + edit (Pencil) links above the existing trash |
| component:wypozyczone-row-view-link | component | analysis/design-context/ascii/ui-mockups.md#wypozyczone-row-icon | WypozyczoneView LoanRow view-icon link (both tabs) |
| component:term-listing-title-link | component | analysis/design-context/ascii/ui-mockups.md#term-listing-link | PublicTermView toListingRow title as Link to /product/:id with underline + "›", anonymous → login returnTo |
| component:notification-item-reserved | component | analysis/design-context/ascii/ui-mockups.md#notification-reserved | NotificationBell entry for ITEM_RESERVED_FOR_PICKUP → /product/:id |
