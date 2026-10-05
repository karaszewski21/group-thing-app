# Scope clarifications (Phase 2 decision gate)

## Critical (decided by user)
1. **text-status-fate: A.** Drop `products.text_status` and `text_moderated_hash`. Remove every reader (item-details description hiding, listing 409 gate, schemas, FE banner, admin text queue), the worker text handler and the TEXT_MODERATION_REQUESTED event type. Keep `ModerationSubjectType.PRODUCT_TEXT` for old audit rows.
2. **text-data-migration: simple.** Production never ran with MODERATION_ENABLED=true. A data revision 0047 marks leftover `moderation.text_requested` outbox rows PROCESSED. A schema revision 0048 drops the columns.
3. **photo-ai-unavailable: A.** The photo stays PENDING and is retried with backoff. After the last failure it moves to NEEDS_REVIEW.
4. **text-moderation-failure: A.** Fail-closed for all 4 text fields: a ModerationUnavailable error returns 503, and API startup fails when text moderation is on but the model cannot load.

## Important (UNRESOLVED — the user selected none of the default bundles; to be discussed in Phase 5 Part A)
- Thresholds: text reject 0.8 single; ShieldGemma per-category (sexual/violence/dangerous review 0.5, reject 0.9; weapons review-only).
- Errors & FE: score product name/description separately, normalised change detection, 400 {message} naming the field, serverMessageOr in 7 forms, ~10 s polling while a photo is PENDING.
- Config: MODERATION_TEXT_ENABLED / MODERATION_IMAGE_ENABLED + MODERATION_AI_URL/TOKEN/TIMEOUT_SECONDS=120; slim worker (no ONNX, httpx, batch 1); remove Falconsai.
- API image: Bielik-Guard baked into the API image (HF secret at build), +0.6–0.8 GB RAM; text moderation off in dev compose.

## Routing
UI-heavy → user chose to continue to Phase 4 (UI mockups).

## Phase 4 UI review (user-selected fixes, all IN scope)
- `serverMessageOr` passes through 503 messages, not only 400/409 (api/problem.ts:62-74).
- `handleAddTerm` (PanelDataContext.tsx:867-895) validates/resolves all item names BEFORE creating the term, so no duplicate terms after a rejection.
- EditTermDialog `saveEdit` (:228) keeps the row open on error; the user's text is not lost.
- The add-group and add-term modals show an inline error (pattern from "Edytuj grupę", PanelModals.tsx:264) instead of the 2.2 s toast; `role="alert"` on error elements.
