# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (17 IDs). Mockups: `analysis/design-context/ascii/ui-mockups.md`.

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:organization-page | Group 8 (FE error surfacing: core + forms) | ✅ |
| screen:onboarding-wizard | Group 8 (FE error surfacing: core + forms) | ✅ |
| screen:panel-add-group-modal | Group 9 (FE Panel modals) | ✅ |
| screen:panel-edit-group-modal | Group 9 (FE Panel modals) | ✅ |
| screen:panel-add-term-modal | Group 9 (FE Panel modals) | ✅ |
| screen:first-term-stepper-organizer | Group 8 (FE error surfacing: core + forms) | ✅ |
| screen:edit-term-dialog | Group 8 (FE error surfacing: core + forms) | ✅ |
| screen:item-edit-page | Group 8 (reference only: no code change, covered by the serverMessageOr 503 pass-through and its test) | ✅ |
| screen:admin-product-form | Group 8 (FE error surfacing: core + forms) | ✅ |
| screen:item-detail-page | Group 10 (FE text-status removal, polling, queue) | ✅ |
| screen:admin-moderation-queue | Group 10 (FE queue photos-only); backend data from Group 3 (queue photos-only) and Group 6 (ShieldGemma scores, null-score NEEDS_REVIEW) | ✅ |
| component:moderation-badge | Group 10 (reused unchanged, verified via ItemDetailPage/useItemDetail tests) | ✅ |
| component:item-gallery | Group 10 (badge refreshed by polling, no component change) | ✅ |
| component:item-gallery-editor | Group 10 (doc comment only; badges refreshed by polling) | ✅ |
| component:pending-photo-polling | Group 10 (useItemDetail refetchInterval) | ✅ |
| component:server-message-or | Group 8 (503 pass-through in api/problem.ts) | ✅ |
| component:moderation-message-catalogue | Group 2 (backend source of the strings), Group 8 and Group 9 (rendered verbatim) | ✅ |

## Uncovered Items

All screens covered (17/17).

Notes:
- `screen:item-edit-page`, `component:moderation-badge`, `component:item-gallery` and `component:item-gallery-editor` are reference or reuse-unchanged items in the spec. Their groups verify the behaviour; they do not change the components.
