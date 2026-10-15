# Requirements: Group soft delete with admin restore

## Initial description
Panel trash "Usuń grupę" (SpotkaniaView.tsx ~181 → PanelDataContext.tsx:609 handleRemoveGroup) calls POST /api/leaderships/{id}/end without confirmation; the group stays public and joinable without a leader. Replace with a real soft delete that admins can undo ("ktoś usunie, ale będzie chciał przywrócić — przez support admina").

## Q&A (all rounds)
Pre-workflow: soft delete (no hard delete, no retention); delete does NOT end Leadership; group transfer/sale is future, separate Leadership operation (out of scope).
Phase 1 (analysis/clarifications.md): block delete when upcoming term has active RSVPs (409); store deleted_by_party_id; fix /leaderships/{id}/end ownership hole; reservations confirm/cancel allowed on deleted group; withdrawals allowed; restore of live group → 409; term_end_scan keeps processing.
Phase 2 (analysis/scope-clarifications.md): POST /api/leaderships ADMIN-only; 409 copy reworded with nearest blocking date ("Grupy nie można usunąć — na termin DD.MM są zapisy. Spróbuj po tym terminie albo gdy uczestnicy się wypiszą."); admin Active/Deleted toggle via `?deleted=true` on GET /api/groups/moderation (+deleted_at, deleted_by_name, sorted deleted_at DESC, consistent count); restore without confirm; deleted group 404 for everyone incl. organizer; organizer OR ADMIN can DELETE; end leadership allowed on deleted group for active organizer or ADMIN; panel tolerates 404 from getGroup; Tailwind confirm from trash with inline 409; RSVP = upcoming term (occurs_on >= clock.local_now()) with ≥1 TermAttendance withdrawn_at IS NULL; no legacy-orphan migration; no notifications.
Phase 4: admin copy in **English** (consistent with existing admin pages); panel copy Polish.
Phase 5A (analysis/technical-clarifications.md): central get_group + explicit predicates; split get_term / get_term_any.
Phase 5B (confirmed assumptions):
- User journey: Organizer Panel → Spotkania → trash → dialog → group disappears. Admin /admin/groups → Deleted → Restore. Participant opening a deleted group link gets "Nie znaleziono".
- Reuse: soft_delete_needed_item (backend pattern), UnsavedChangesDialog (dialog), useModerationPhotos + PhotoModerationCard (restore), test_groups_moderation helpers; no new libraries.
- Visual assets: only Phase 4 ASCII mockups (binding): analysis/design-context/ascii/ui-mockups.md, INDEX.md.
- "Napisz do nas" is plain text; no contact link/form.

## Similar features identified
- NeededItem soft delete: app/groups/application/terms.py:222-265, router/terms.py:130-133, tests test_groups.py ~200-290.
- Item soft delete: app/circulation/application/inventory_items.py:253-277, find_item_including_deleted :94.
- ADMIN mutation: app/moderation/router.py; ModerationPrincipal router/circles.py:56.
- Admin UI with filter + per-row action: PhotoModerationPage.tsx, PhotoModerationCard.tsx, hooks/useModerationPhotos.ts.
- Panel alertdialog: pages/organizer/editor/UnsavedChangesDialog.tsx.

## Functional requirements summary
1. Migration 0056: groups.deleted_at TIMESTAMP NULL, groups.deleted_by_party_id UUID NULL (FK parties.id), reversible.
2. DELETE /api/groups/{id} → 204; allowed for active organizer or ADMIN; 409 when an upcoming term has active RSVPs (message with nearest date); sets deleted_at=utcnow, deleted_by_party_id; Leadership untouched; deleting deleted → 404.
3. POST /api/groups/{id}/restore (ADMIN) → 204 (or GroupResponse); 404 unknown; 409 when not deleted; clears deleted_at and deleted_by_party_id.
4. GET /api/groups/moderation?deleted=true (ADMIN): deleted only, deleted_at + deleted_by_name, sorted deleted_at DESC; default excludes deleted; counts consistent.
5. Deleted group hidden everywhere (full read-path table in codebase-analysis.md / gap-analysis.md), incl. leaderships/memberships listings, organizer public directory, my attendances/pledges, AdminTerms list+count, terms/needed-items reads, group sub-resources.
6. Mutations blocked on deleted group (via get_group/get_term), except: reservation confirm/cancel, withdrawals, end leadership (organizer/ADMIN), term_end_scan.
7. POST /api/leaderships → ADMIN only; POST /api/leaderships/{id}/end → active organizer of that group or ADMIN (403 otherwise).
8. Auth matrix rows + tests: DELETE /api/groups/{id}, POST restore ADMIN, POST /api/leaderships ADMIN (respect first-match order).
9. Frontend panel: DeleteGroupDialog (Tailwind alertdialog, useRegisterOpenSheet, focus mgmt), deleteGroup API, handleRemoveGroup → DELETE, toast, load(); load() tolerates single getGroup 404.
10. Frontend admin: Active/Deleted toggle, useModerationGroups(page, deleted) + restore mutation invalidating prefix, Deleted columns + Restore per row with busy/error (English).
11. Tests: backend (red tests in tests/test_group_soft_delete.py must pass; read-path hiding; matrix; admin list/restore; leadership ownership) and frontend (dialog, admin toggle/restore, panel delete).

## Reusability opportunities
_require_active_organizer, BusinessConflictException, EntityNotFoundException, get_profile_by_principal, ModerationPrincipal, AdminTable, Pagination, EmptyState, dayjs util, serverMessageOr, extractProblemMessage, useRegisterOpenSheet, trapFocus.

## Scope boundaries
In: above. Out: hard delete/retention, group transfer/sale, term cancellation, notifications, legacy orphan cleanup, Chakra ConfirmDialog useRegisterOpenSheet gap, models.md standard refresh (suggest separately).

## Technical considerations
- Audit timestamps naive UTC `datetime.utcnow()`; RSVP "upcoming" uses `clock.local_now()` vs Term.occurs_on (time.md).
- BaseEntity updated_at is version_id_col — soft delete bumps it.
- Route order in router/circles.py (literal segments before /{group_id}); matrix first-match-wins.
- Panel load() Promise.all(getGroup) must not crash on single 404.
