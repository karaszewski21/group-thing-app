# Phase 1 Clarifications

Date: 2026-10-08

## Q1. Validation status code for PATCH /api/organizations/{id}
Research/HLD assumed 422; backend global `validation_error_handler` (`app/core/errors.py:111-118`) returns 400 + `fieldErrors` for all validation, and existing tests assert 400.

**Decision:** 400, consistent with the rest of the API. Spec replaces every "422" from research with 400 (null `name`/`page_layout`, unknown keys, keys outside allowlists, moderation rejection keeps its existing 400).

## Q2. Fate of `/organization` page
**Decision:** unchanged. Stays the create + rename path; the appearance editor lives only on `/:slug?edit=1`. `OrganizationPage.test.tsx` "no color pickers" assertion stays.

## Already decided by research (not re-asked)
- Preset precedence: choosing a preset stores `palette_preset=<key>` AND `primary_color`/`accent_color` = preset base colors; unknown preset degrades to generator from stored hex (HLD l.271); resolve order preset > generator > default.
- DELETE added to authorization matrix row 50 in A2 (solution-exploration X3/P3 → A2).
- "Moja organizacja" (AccountMenu) and HomeView hint link to `/${slug}?edit=1` (fallback `/organization` when no org).
