# Code Review Report (re-review after Phase 11 verification fixes)

**Date**: 2026-10-14
**Path**: group soft-delete/restore feature (`git diff` + untracked), focus on verification-fix changes
**Scope**: all
**Status**: Issues Found (no critical, no warnings) — info only

## Summary
- **Critical**: 0
- **Warnings**: 0 (previous W1, W2 resolved)
- **Info**: 5 new/updated + carried-over items from the previous review

Checks run by the reviewer: frontend vitest (useModerationGroups, AdminGroupsPage, RzeczyViewCategory, DeleteGroupDialog) 39/39 passed; `tsc -p tsconfig.app.json` clean; backend `test_group_soft_delete_keep_live.py` + `test_group_soft_delete_service.py` 13 passed; ruff on changed backend files reports nothing on added lines (circles.py:65/271/330/346, reservations.py:5 I001 etc. are not in changed hunks).

## Previous findings — status

| ID | Status | Evidence |
|----|--------|----------|
| W1 keepPreviousData across Active/Deleted | Resolved | `hooks/useModerationGroups.ts:33` `placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === deleted ? prev : undefined)`; key `[MODERATION_GROUPS_KEY, deleted, page]`; hook + page tests added and passing |
| W2 non-silent reload unmounting dialog | Resolved | `PanelDataContext.tsx:629` `await load({ silent: true })`; `load` catches internally (sets `error`), so a reload failure cannot surface as a false "delete failed" in the dialog |
| I1 naive-UTC deleted_at shown as local | Resolved | `DeletedGroupRow.tsx:36` `dayjs.utc(group.deleted_at).local()`; `utc` plugin is registered in `src/utils/dayjs.ts`; backend `deleted_at` is naive UTC (serialized without offset) so `dayjs.utc` parses it correctly |
| H1 RzeczyView getTerm 404 on deleted group | Resolved | `GET /api/reservations/{id}` returns `term_occurs_on` via keep-live `find_reservation_term` (no `deleted_at` filter, `circulation/infrastructure/repository.py:454`); `RzeczyView.tsx:120` uses `Promise.allSettled`; keep-live test `test_group_soft_delete_keep_live.py:259` |
| Logs | Done | `circles.py` soft_delete/restore log ids only after commit — no PII |
| Exports | Done | `groups/service.py` exports `restore_group`, `soft_delete_group` (both used by router) |

## New-change analysis (focus files)

### Backend — `ReservationDetailResponse` on `GET /api/reservations/{id}`
- `circulation/schemas.py:109-114`, `router.py:250-259`, `service.py:55/81`, `application/reservations.py:172-174`.
- **Authorization**: unchanged — same `ReadPrincipal` (matrix row 42, `READ`/`mcp:read`). The added field is the Term date only, which the same principal can already read via `GET /api/terms/{id}` while the group is live, and which `item_details.py:75` already exposes the same keep-live way. No authorization regression.
- **N+1**: one additional single-row, PK-indexed query per request (`terms JOIN groups` by `terms.id`). Not N+1. Bound parameters only.
- **Keep-live correctness**: `find_reservation_term` deliberately has no `deleted_at` predicate; inner join on `groups` is safe because `terms.circle_group_id` is a non-null FK. `reservation.term_id` is non-null (`circulation/models.py:263`), so the `None` branch occurs only if the term row is gone.
- Response is additive (superset of `ReservationResponse`); existing consumers unaffected.

### Frontend
- `RzeczyView.tsx:120-131`: `allSettled` + per-reservation `term_occurs_on`; a failed fetch leaves that item at `hasEnded: false` (fallback buttons hidden) without hiding others. Timezone handling (`new Date(naive Warsaw)`) is identical to the previous `getTerm`-based code and to `TermPage`. Fewer requests than before (no second `getTerm` fan-out).
- `api/reservations.ts:37-46`: `ReservationDetailResponse` with optional `term_occurs_on` — consistent with the existing optional `term_id` rationale.
- `PanelDataContext.tsx:440-480`: `unlessGone` tolerates 404 per group / per group's terms; non-404 errors still propagate to `load`'s catch. `getGroupTerms` refactor is behaviour-preserving.

## Informational

1. **I-N1 Rejected reservation fetches are silently dropped** — `src/frontend/src/pages/panel/views/RzeczyView.tsx:124`. A non-404 failure (network/5xx) leaves the item without the "term ended" fallback actions and with no signal to the user or console. Acceptable degradation; optionally retry on the next silent `load` (already happens when `lockedReservationIds` changes) or log in dev. fixable: true. suggestion: leave as is, or `console.warn` in dev on `rejected`.
2. **I-N2 `restore_group` log does not record who restored** — `src/backend/app/groups/application/circles.py:205-219`. The delete log records `actor_party_id`; the restore log records the original deleter but not the restoring ADMIN, so the audit trail for restore is incomplete. fixable: true. suggestion: pass `principal.name`/profile party id from `router/circles.py` restore route into `restore_group` (or log it in the router) as `actor`.
3. **I-N3 One needed-items 404 drops the whole group's terms** — `src/frontend/src/pages/panel/PanelDataContext.tsx:478`. `unlessGone(getGroupTerms(group))` wraps both `getTerms` and every `getNeededItems`; a 404 on a single term's needed items (term removed concurrently) hides all terms of that group until the next load. Race-only, low impact. fixable: true. suggestion: wrap `getNeededItems(term.id)` in `unlessGone(...) ?? []` instead, or accept.
4. **I-N4 Detail response built via dump/re-validate** — `src/backend/app/circulation/router.py:256-259`. `ReservationDetailResponse(**ReservationResponse.model_validate(r).model_dump(), term_occurs_on=...)` validates twice; harmless at this scale. fixable: true. suggestion: optional — `ReservationDetailResponse.model_validate({**ReservationResponse.model_validate(r).__dict__, ...})` or leave.
5. **I-N5 Term date of a soft-deleted group remains readable via reservation id** — `src/backend/app/circulation/router.py:255`. Intentional (keep-live requirement H1) and requires knowing the reservation UUID; any READ principal can read reservations (consistent with "items readable by any logged-in user"). Noted for completeness only. fixable: false.

### Carried over from previous review (not in fix scope, unchanged)
- I2 `repository.get_term` duplicate term lookups (single indexed queries, not N+1).
- I3 404-before-403 in `soft_delete_group` reveals existence (UUIDs, negligible).
- I4 Re-ending an already ended leadership is possible (`circles.py:279-299`) — consider 409 when `valid_to` set.
- I5 `DELETE /api/groups/{id}` reachable with `mcp:edit` scope (PATCH precedent) — confirm intent.
- I6 Outer join `UserProfile` on non-unique `party_id` could duplicate moderation rows.
- I7 ruff E501 `tests/test_group_soft_delete.py:32,37` (37 is in the protected red test).
- I8 Restoring the last row on page N>1 shows an empty page (`AdminGroupsPage.tsx`).
- Accepted product decision (item 7): restore may leave an organizer leading two groups — documented in `documentation/rollback-and-release-notes.md`.

## Whole-feature sanity check
Re-read the full diff (routers `circles.py`/`leaderships.py`, `authorization_matrix.py`, `AdminGroupsPage.tsx`, `SpotkaniaView.tsx`, `DeleteGroupDialog.tsx`, `DeletedGroupRow.tsx`). Nothing new found: DELETE/restore routes guarded (`EditPrincipal` + service-level organizer/ADMIN check; restore `ModerationPrincipal`), `assign_leadership` now ADMIN-only, `remove_leadership` organizer/ADMIN check, leadership/membership list routes 404 for deleted groups, dialog follows modal a11y standard (trapFocus, Esc with `defaultPrevented`, focus return with `main` fallback, `useRegisterOpenSheet`). No secrets, no injection, no raw SQL splicing.

## Metrics
- Max function length (changed code): `load()` in PanelDataContext ~155 lines (pre-existing; fix made it slightly flatter)
- Max nesting depth (changed code): 4
- Potential vulnerabilities: 0
- N+1 query risks: 0 (backend); frontend per-locked-item `getReservation` fan-out is pre-existing and now smaller

## Prioritized Recommendations
1. (Optional) Record the restoring ADMIN in the restore log (I-N2) for audit symmetry.
2. (Optional) Narrow `unlessGone` to per-term needed items (I-N3).
3. Remaining items are cosmetic or accepted; feature is ready from a code-review standpoint.
