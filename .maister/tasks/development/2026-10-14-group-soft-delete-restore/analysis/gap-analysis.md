# Gap Analysis: Group (Circle) soft delete with admin restore

## Summary
- **Risk Level**: Medium-High. The write side is small, but the read side is broad, and two endpoints with no ownership check sit next to the new DELETE.
- **Estimated Effort**: Medium-High. About 12 repository predicates, about 6 guards, a split of `get_term`, 2 routes, 2-3 matrix rows, a migration, and frontend work in both the Tailwind panel and the Chakra admin.
- **Detected Characteristics**: has_reproducible_defect, modifies_existing_code, creates_new_entities (new columns/endpoints, no new table), involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: yes. The panel trash ends the Leadership without confirmation and leaves an orphaned public group.
- Modifies existing code: yes
- Creates new entities: partial. No new entity, but there are new columns (`deleted_at`, `deleted_by_party_id`), endpoints and UI.
- Involves data operations: yes (DELETE/RESTORE of Group, filtered READ everywhere)
- UI heavy: yes (panel confirm dialog, admin list filter and Restore)

## Gaps Identified

### Missing Features
- **Group soft-delete state**: `Group` has no `deleted_at` / `deleted_by_party_id` (models.py). Alembic head is `0055`, so `0056` is needed.
- **DELETE /api/groups/{id}**: no route. The matrix has no DELETE row for groups, so it falls through to the AUTHENTICATED catch-all (row 242).
- **POST /api/groups/{id}/restore**: no route. In the matrix it would resolve to the blanket POST EDIT row (133), so an ADMIN row is needed before it.
- **Admin view of deleted groups**: `list_groups_for_moderation` / `count_groups` have no deleted mode, `ModerationGroupResponse` has no `deleted_at` or deleted-by fields, and AdminGroupsPage is read-only.
- **Panel confirm dialog**: none. The trash button (`SpotkaniaView.tsx:181`) calls `handleRemoveGroup` directly.
- **"Upcoming terms with RSVPs" guard**: there is no query for it yet. The closest is active `TermAttendance` (`withdrawn_at IS NULL`) on a Term with `occurs_on >= clock.local_now()`.

### Incomplete Features
- **Group read isolation**: `repository.get_group` is a plain `db.get`. About 12 queries bypass it (codebase-analysis table rows 1-9) and 3 router GETs (`/{id}/leadership`, `/leaderships`, `/memberships`) have no guard.
- **Leadership ownership**: `remove_leadership` (circles.py:209, route leaderships.py:40) has no ownership check. This is fixed in this task (clarification 3).
- **`assign_leadership` ownership (NEW FINDING, not covered by clarifications)**: `POST /api/leaderships` (leaderships.py:27-37, EditPrincipal) lets any EDIT user assign **any party, including themselves**, as organizer of **any group**. Because `soft_delete_group` authorizes through `_require_active_organizer`, any logged-in user could take over a group and then delete it. The new DELETE turns this pre-existing hole into a working attack path. The frontend `assignLeadership` (api/groups.ts:134) has **no callers** in the app. Self-service organizer creation goes through `POST /api/groups/mine[/new]` instead.

### Behavioral Changes Needed
- Panel trash changes from `endLeadership` to confirm dialog → `DELETE /api/groups/{id}`. Leadership is preserved.
- Every group-reaching read changes from "always visible" to "404 / filtered when deleted". The exceptions are transaction confirm/cancel, withdrawals and the term-end scheduler (clarification 4).
- `POST /api/leaderships/{id}/end` changes from any EDIT user to the active organizer of that group or ADMIN.

## Defect Analysis

### Reproduction Data
- Steps: log in as an organizer → /panel → "Spotkania" → trash icon on a group tile.
- Expected: a confirmation, then the group disappears for everyone (no longer public, joinable or listed).
- Actual: there is no confirmation. `POST /api/leaderships/{id}/end` sets `valid_to=today`, and the toast says "Usunięto grupę". The group stays public, joinable and listed in GET /api/groups and in admin moderation as leaderless. Its terms and needed items stay readable.

### Root Cause Hypothesis
The UI treats "remove group" as "end my leadership", and the backend has no group-deletion concept. Separately, `remove_leadership` has no ownership check, so the frontend's idea of "my leadership" is the only safeguard.

### Regression Risk Areas
- The panel `load()` runs `Promise.all(getGroup)` (PanelDataContext.tsx:442/448-450). If `list_active_leaderships_for_role_ids` (repository.py:192) or `list_active_memberships_for_role_ids` (:235) is not filtered, the whole panel fails for the organizer and for every guest member of a deleted group.
- `get_own_circle` (circles.py:56) takes `leaderships[0]`. If unfiltered, it raises 404 and `POST /api/groups/mine` breaks. Once filtered, an organizer whose only group is deleted gets a **new** circle on the next `/mine` call. That is consistent with "nonexistent", but should be noted.
- Making `get_term` group-aware must not break `_resolve_transaction_reservations_for_action` (term_item_listings.py:962) or `term_end_scan`.
- Matrix test regression guards (test_authorization_matrix.py:59/75/150) still require GET `/api/groups/{id}` to resolve to READ.
- Data created by the old bug: groups orphaned by earlier panel "deletes" are leaderless and still public. They cannot be told apart from groups that are leaderless for other reasons (see decision I6).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (organizer delete) | Panel → Spotkania → trash (1 click, destructive, no confirm) | Same trash → confirm dialog → delete | Safer, same path |
| Reachability (admin restore) | none | /admin/groups → "Usunięte" filter → Restore | New, inside the existing admin page |
| Discoverability (delete) | 9/10 | 9/10 | 0 |
| Discoverability (restore) | n/a | 7/10 (standard filter toggle + row button) | n/a |
| Flow Integration | Destructive and misleading (group survives) | Matches what the user expects | Positive |
| Multi-persona | Organizer only. Guests are unaffected by the "delete" | Organizer deletes; guests and the public lose access; admin restores | Guests of a deleted group silently lose it from their panel (no notification; see I7) |

Persona side effect: an organizer whose last group is deleted will be shown as GUEST, because onboarding (`OnboardingPage.tsx:33`) and panel role detection both use active leaderships, which are now filtered. The same thing happens today after `endLeadership`, so this is not a regression. It should still be recorded as expected behavior (I3).

## Data Lifecycle Analysis

### Entity: Group (deletion state)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (soft-delete) | missing → new DELETE /api/groups/{id} | trash button exists, wired to the wrong call | SpotkaniaView tile | ❌ to build |
| READ deleted (admin) | missing → `deleted` flag on GET /api/groups/moderation | AdminGroupsPage exists, no filter | Admin nav exists | ❌ to build |
| READ deleted (organizer) | n/a by design (nonexistent) | n/a | n/a | intentional |
| UPDATE (restore) | missing → POST /api/groups/{id}/restore | missing (Restore button) | AdminGroupsPage | ❌ to build |
| Hard DELETE | out of scope (no retention) | - | - | intentional |

**Completeness after the planned scope**: 100%. All three lifecycle operations have backend, UI and access in the task scope. **Today**: 0%.
**Orphaned Operations**: none once the task scope is delivered. Planned in-scope pairs: delete has admin visibility, restore has a UI. One residue: the frontend `endLeadership` (api/groups.ts:138) and `assignLeadership` (:134) will have no UI callers after the fix. They are backend-only/admin-API operations, which is acceptable but noted.
**Touchpoints that must treat a deleted group as nonexistent**: public circle view and `/access`, OG previews, public organizer directory (`_qualifying_owner_circles`), GET /api/groups, GET /api/groups/{id}, `/{id}/leadership(s)` and `/memberships`, terms list/get, needed items, pledges/mine, attendances/mine, join-request inbox, admin terms moderation, panel (organizer + guest), onboarding role detection.
**Touchpoints that deliberately stay live**: transaction confirm/cancel, withdrawals, term_end_scan, circulation item-history group names (historic).

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **C1 – `POST /api/leaderships` lets anyone take over a group, and this task makes that exploitable for deletion**: any EDIT user can make themselves organizer of any group and then DELETE it.
   - Options: [A] Restrict `POST /api/leaderships` to ADMIN (matrix row + `require_any("ADMIN")`). There are no frontend callers, and self-service goes through `/groups/mine`. [B] Allow active organizer of that group or ADMIN, same rule as end. [C] Leave as is (out of scope).
   - Recommendation: **A**. It is a one-line route change plus a matrix row and a test, and it closes the takeover path together with clarification 3.
2. **C2 – The 409 block message cannot be acted on**: clarification 1 says "najpierw je odwołaj", but **terms cannot be cancelled or deleted** (terms router has only POST/PATCH). An organizer could not get out of the block before the term date passes.
   - Options: [A] Keep the block and reword the message to something actionable, e.g. "Grupa ma nadchodzące terminy z zapisami (najbliższy: {format_term_day}). Usunięcie będzie możliwe po ich zakończeniu lub gdy uczestnicy się wypiszą." [B] Expand scope: add term cancel/delete (DELETE /api/terms/{id} with its own cascade rules). [C] Drop the block and delete anyway.
   - Recommendation: **A**. B is a separate feature with its own data lifecycle (attendances, pledges, listings, reservations).

### Important (Should Decide)
1. **I1 – Admin list UX**: [A] Active/Deleted toggle on AdminGroupsPage (`role=group`, `aria-pressed`, page reset; template PhotoModerationPage). [B] Separate tab or route. [C] One list with a status column.
   - Default: **A**. It reuses the existing page and pagination, and the photo-moderation template already exists.
2. **I2 – Admin deleted-list API shape**: [A] `GET /api/groups/moderation?deleted=true` reusing `ModerationGroupResponse` plus nullable `deleted_at` and `deleted_by_name`, ordered by `deleted_at DESC`, with `count_groups(deleted)` kept consistent. [B] A new literal route `/api/groups/moderation/deleted` (route-ordering and matrix risk).
   - Default: **A**.
3. **I3 – GET /api/groups/{id} for the organizer of a deleted group**: [A] 404 for everyone except the restore path, which uses `find_group_including_deleted`. [B] Organizer can still read their deleted group.
   - Default: **A**. Requirement is "nonexistent everywhere", and there is no organizer-side restore.
4. **I4 – Panel behavior after delete**: [A] The group disappears after `load()` because the leadership/membership listings are filtered server-side. An organizer with no remaining groups is shown as GUEST, which matches today. Also switch `Promise.all(getGroup)` to tolerate a 404 (defense in depth). [B] Keep strict `Promise.all` and rely only on the server filter.
   - Default: **A**. A server filter is required anyway, and the tolerant client protects against one missed path breaking the whole panel.
5. **I5 – Definition of "upcoming terms with RSVPs" for the block**: [A] Any Term of the group with `occurs_on >= clock.local_now()` and at least one `TermAttendance` with `withdrawn_at IS NULL`. [B] Also count active pledges or pending/locked listings and reservations.
   - Default: **A**. It matches the clarification wording. Reservations are already protected by the confirm/cancel exception.
6. **I6 – Groups already orphaned by the old bug** (leaderless and public): [A] Leave them. Admins can see leaderless groups in the moderation list (organizer is null). [B] Data migration marking all leaderless groups deleted. This is risky because legitimately leaderless groups cannot be told apart.
   - Default: **A**.
7. **I7 – Notify guests or members when a group is deleted or restored**: [A] No notification (silent disappearance). [B] Send an in-app notification to active members via notifications_bridge.
   - Default: **A** (minimal implementation). Revisit as a follow-up.
8. **I8 – Can ADMIN also DELETE a group (moderation removal)?**: [A] No. DELETE is for the active organizer only, as specified. [B] Active organizer or ADMIN (the `deleted_by_party_id` field already supports it).
   - Default: **A**, keeping the specified scope. B costs little if moderators need it.
9. **I9 – Confirm before admin Restore**: [A] No confirm. Restore is non-destructive and the button shows per-row busy/error. [B] Chakra `ConfirmDialog`. Note: it does not call `useRegisterOpenSheet` (a standards gap).
   - Default: **A**.
10. **I10 – Where the confirm dialog lives and how it looks**: [A] Tailwind `alertdialog` opened by the SpotkaniaView trash, cloned from `UnsavedChangesDialog` (`useRegisterOpenSheet(true)`, initial focus on "Anuluj", Esc, focus trap, focus back to the trash button). It stays open with an inline `role=alert` error on 409/403, for example the RSVP-block message. [B] Move delete into the edit-grupa sheet.
    - Default: **A**. It keeps the existing affordance.
11. **I11 – Ending a leadership on a deleted group**: [A] Allowed (organizer or ADMIN), and the ownership check uses `leadership.to_group_id` without the deleted-group filter. [B] Return 404 when the group is deleted.
    - Default: **A**. It keeps the admin able to clean up, and the leadership stays independent from deletion.

## Recommendations
- Implement in this order: column + migration → `get_group` / `find_group_including_deleted` → **CRITICAL predicates #6/#7** → remaining predicates and guards → `get_term` split (group-aware vs `get_term_including_deleted_group` for confirm/cancel and term_end_scan) → service + routes + matrix → leadership ownership fixes (end + C1) → frontend.
- Use one shared predicate helper (`Group.deleted_at.is_(None)` join / `_live_group_ids`) to reduce the chance of a missed path. Write one test per read path in the table, setting `deleted_at` directly as done in test_groups.py:439.
- `deleted_by_party_id`: a plain FK-id UUID column, nullable, set and cleared together with `deleted_at`. Clear both on restore, or keep `deleted_by` for audit (decide in the spec; recommend clearing both for consistency).
- After the fix, `endLeadership` in the frontend is unused. Remove it from PanelDataContext imports and update the PanelPage.test mocks.
- Standards follow-up: models.md is stale ("soft delete not used"). Suggest a standards update for the soft-delete pattern (nullable `deleted_at`, getter 404, `find_*_including_deleted`, explicit per-query predicate).

## Risk Assessment
- **Complexity Risk**: Medium. Each change is simple, but they are numerous, and the `get_term` split has carve-outs.
- **Integration Risk**: High. Without filters #6/#7 both panels break, and one missed query means a deleted group leaks to the public.
- **Regression Risk**: Medium-High. Matrix first-match ordering, `/groups/mine` idempotency, confirm/cancel of locked reservations, the scheduler.
- **Security Risk**: Medium. The leadership assign/end holes are fixed (C1 + clarification 3), and the new DELETE depends on the leadership's integrity.
