# Requirements

## Initial description
Moderation policy for VPS A (group-thing-app):
| Field | When | Mode |
|---|---|---|
| Organization name | create + name update | sync |
| Group name | group create + name update | sync |
| Term description | term create/update, when present | sync |
| Product name + description | create/update | sync |
| Product photo | upload | async (outbox → worker → VPS B ShieldGemma), FE badge "W moderacji" |
A field is moderated only when its value changes. Adding a term to an existing group never re-moderates the group name.

## Q&A (all rounds)
- Phase 1 (`clarifications.md`): text model in the API process, inline; text is reject-only (400), no admin review; images via ShieldGemma on VPS B only (Falconsai removed); no extra scope (needed-items, blocklist, audit of sync text are OUT).
- Phase 2 (`scope-clarifications.md`): drop products.text_status + text_moderated_hash and all readers; simple migrations 0047 (data: mark text outbox rows PROCESSED) + 0048 (schema drop); photo AI unavailable → retry with backoff, then NEEDS_REVIEW; fail-closed 503 for all 4 text fields, and startup fails if the model can't load while enabled.
- Phase 4 UI fixes (in scope): 503 passthrough in serverMessageOr; handleAddTerm resolves item names before creating the term; EditTermDialog keeps the row open on error; inline errors in the add-group/add-term modals + role="alert".
- Phase 5 (`technical-clarifications.md`): text reject threshold 0.8; ShieldGemma per-category thresholds (weapons review-only); split flags + AI URL/token/timeout; slim httpx worker with batch 1; model baked into the API image; product name/description scored separately, only on change, with normalised comparison.

## User journey
An organizer creates an organization and a group (onboarding wizard or panel), adds terms and items. A text violation shows immediately as a message in the form's existing error slot ("Nazwa grupy narusza zasady…"), with no scores. The user fixes it and retries; nothing is persisted on rejection. A photo upload shows the "W moderacji" badge, and the item-details query polls every ~10 s while an owner photo is PENDING. Afterwards the badge disappears (APPROVED) or shows "Do sprawdzenia" / "Odrzucone". The admin queue handles photos only.

## Reuse
- `moderation/rules.py ensure_no_contact_info` is the existing sync ValueError → 400 pattern.
- The outbox + `moderation/worker.py` + the `moderate_photo` flow (PENDING re-check with_for_update, `_record` audit, `_set_photo_files_public`).
- `OnnxTextClassifier` (moved/usable from the API), the `classifiers.py` Protocols for fakes in tests.
- FE: `ModerationBadge`, `ItemGallery` badge, `api/problem.ts serverMessageOr`, the "Edytuj grupę" inline error pattern (PanelModals.tsx:264).

## Visual assets
ASCII mockups only: `analysis/design-context/ascii/ui-mockups.md`, index `analysis/design-context/INDEX.md` (17 IDs). Binding.

## Scope boundaries
IN: the 4 sync text sites (org, group, term, product incl. resolve, shared description, plugin_data replace); the photo worker switching to VPS B; removal of text_status and its readers; migrations; config; Docker; FE error surfacing in 7 forms + the 4 UI fixes; photo polling; admin queue photos-only; docs (.env.example, architecture.md, tech-stack.md).
OUT: needed-items description moderation, short-name blocklist, audit rows for sync text decisions, any changes to VPS B (group-thing-ai).

## Technical considerations
Error envelope 400 `{message}` via a ValueError subclass (no fieldErrors). New 503 handler for ModerationUnavailable. Inference via asyncio.to_thread. Retry/backoff for outbox photo events (currently 5 attempts, 5 s poll, no backoff). The worker must not hold row locks during 20–90 s VPS B calls. Tests use fake classifiers / a fake VPS B.
