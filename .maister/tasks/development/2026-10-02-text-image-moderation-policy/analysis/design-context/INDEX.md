# Design Context Index: text + image moderation policy

Stable IDs for the implementation-planner's `Visual References`. Sources are relative to the task directory.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:organization-page | screen | analysis/design-context/ascii/ui-mockups.md#organization-page | OrganizationPage: org-name 400/503 server message in the existing danger box (was "400 Bad Request") |
| screen:onboarding-wizard | screen | analysis/design-context/ascii/ui-mockups.md#onboarding-wizard | Organizer onboarding steps 1-3 (org name, group name, term description): server message in the wizard danger box; step does not advance |
| screen:panel-add-group-modal | screen | analysis/design-context/ascii/ui-mockups.md#panel-add-group-modal | "Dodaj nową grupę" modal: group-name rejection via the panel toast (option B: inline E2 error) |
| screen:panel-edit-group-modal | screen | analysis/design-context/ascii/ui-mockups.md#panel-edit-group-modal | "Edytuj grupę" modal: existing inline editGroupError now shows the server message |
| screen:panel-add-term-modal | screen | analysis/design-context/ascii/ui-mockups.md#panel-add-term-modal | "Dodaj termin zajęć" modal: term description / needed-item name rejection via toast; duplicate-term hazard noted |
| screen:first-term-stepper-organizer | screen | analysis/design-context/ascii/ui-mockups.md#first-term-stepper-organizer | "Dodaj pierwszy termin" sheet: term-description rejection in the inline formError |
| screen:edit-term-dialog | screen | analysis/design-context/ascii/ui-mockups.md#edit-term-dialog | "Edytuj termin": formError for the term description, itemsError for needed-item name edit/add; row editor stays open on error |
| screen:item-edit-page | screen | analysis/design-context/ascii/ui-mockups.md#item-edit-page | Item edit field editors (reference only): name/description rejection already shown via serverMessageOr (E3 role="alert") |
| screen:admin-product-form | screen | analysis/design-context/ascii/ui-mockups.md#admin-product-form | Admin ProductFormPage: product name/description rejection in the Chakra error box (English fallback kept) |
| screen:item-detail-page | screen | analysis/design-context/ascii/ui-mockups.md#item-detail-page | ItemDetailPage owner view with the text-moderation banner removed; description always visible |
| screen:admin-moderation-queue | screen | analysis/design-context/ascii/ui-mockups.md#admin-moderation-queue | Admin ContentModerationQueue: status tabs kept, text cards removed, ShieldGemma scores, "No model score" for failed-AI NEEDS_REVIEW |
| component:moderation-badge | component | analysis/design-context/ascii/ui-mockups.md#item-gallery | ModerationBadge pill: W moderacji / Do sprawdzenia / Odrzucone (unchanged, reused) |
| component:item-gallery | component | analysis/design-context/ascii/ui-mockups.md#item-gallery | View gallery with the current-slide badge for PENDING / NEEDS_REVIEW / REJECTED photos (owner only) |
| component:item-gallery-editor | component | analysis/design-context/ascii/ui-mockups.md#item-gallery-editor | Edit-mode photo rows with per-row badges; REJECTED does not count toward the limit |
| component:pending-photo-polling | component | analysis/design-context/ascii/ui-mockups.md#pending-photo-polling | useItemDetail refetchInterval 10 s while owner has a PENDING photo; stops when none remain |
| component:server-message-or | component | analysis/design-context/ascii/ui-mockups.md#gap-503 | serverMessageOr: the single error-text change point for 7 forms; proposed 503 pass-through |
| component:moderation-message-catalogue | component | analysis/design-context/ascii/ui-mockups.md#message-catalogue | Polish 400/503 messages per field, rendered verbatim from the server |
