# Spec Audit: Group (Circle) Soft Delete with Admin Restore

- **Spec**: `implementation/spec.md`
- **Audited against**: working tree on `feat/placeholders` (HEAD `46e63f1`), backend `src/backend/app`, frontend `src/frontend/src`
- **Date**: 2026-10-14
- **Verdict**: **PASS WITH CONCERNS** (Mostly Compliant / ready to plan after small clarifications)

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 8 |

## Summary

I checked the spec against the code myself. Almost every file and line it cites exists, and every function name is correct. Where a cited line has drifted, the drift is a few lines at most (see L7). The read-path classification is the strongest part of the spec. I grepped every caller of `circles.get_group`, `terms.get_term`, `repository.get_group`, `repository.get_term`, `list_active_leaderships_for_*`, `list_active_memberships_for_*`, `list_memberships_for_party` and `_is_active_member`, and every cross-module reader of the `groups` and `terms` tables: `circulation` Core `_groups`/`_terms`, `families/repository.py`, `users/router.py`, `system/router.py` OG previews, `term_end_scan.py` and `organizer_page.py`. Each one falls into a Table A or Table B row, either directly or through a getter it calls. I found no unclassified path that would leak a deleted group or 500 the panel.

All three changes to the authorization matrix are ordered correctly for first-match-wins (details below). The user decisions (organizer OR ADMIN delete, ADMIN-only assign, 404 for everyone, keep-live set, English admin and Polish panel copy, no restore confirm, no notifications) are reflected faithfully. No over-engineering was found. The B2 extension beyond technical-clarifications.md is justified by `components/pending/pendingActions.ts:142`, which really does resolve swap reservation ids from `/mine` and `/mine-as-taker`.

The concerns are about implementability, not completeness. There is an internal contradiction about an ADMIN without a profile. The `remove_leadership` signature is unspecified, and an existing test calls it directly. There are also a few minor gaps in wording and classification.

## Verification of key claims

### Authorization matrix (`app/core/authorization_matrix.py`)
- Line 122 holds `(_methods("PATCH"), r"^/api/groups/[^/]+$", EDIT)`. It comes after `/mine/attendances` (81), `/public/organizers` (88), `/public/{id}` (93), `/access` (100), `/rsvp` (105), `/merge` (106) and `/join-requests` (113-117), and before row 26 (132) and row 27 (133). Adding DELETE to this row is safe. No earlier row matches DELETE on `/api/groups/{id}`, and today DELETE falls through to the catch-all at line 242 (AUTHENTICATED), as the spec says.
- Line 126 holds `GET ^/api/groups/moderation$` ADMIN. A `POST ^/api/groups/[^/]+/restore$` ADMIN row placed right after it is matched before row 27 (POST EDIT). No earlier POST row (`/public/[^/]+/rsvp`, `/public/merge`, `/public/[^/]+/join-requests...`) matches `/{id}/restore`.
- Line 150 is row 30, `POST ^/api/leaderships(/.*)?$` EDIT. No earlier row matches `/api/leaderships`, so an ADMIN row inserted directly before row 30 is correct, and `/{id}/end` keeps resolving to EDIT.
- The existing guards in `tests/test_authorization_matrix.py` (lines 59, 75, 150, and the join-request table at 114-120) are not affected by these changes.

### Getters and line references (sample)
- `repository.py`: `list_groups` :62, `get_group` :67, `count_groups` :80, `list_groups_for_moderation` :84, `list_active_leaderships_for_role_ids` :192, `list_active_memberships_for_role_ids` :235, `get_term` :249, `count_terms` :260, `list_terms_for_moderation` :264, `list_my_pledges_joined` :351, `list_my_attendances_joined` :421, `list_pending_join_requests_for_groups` :649, `_qualifying_owner_circles` :674. All correct.
- `circles.py`: `get_group` :143, `assign_leadership` :190/193, `remove_leadership` :209, `_is_active_organizer`/`_require_active_organizer` :254-264. All correct.
- `terms.py` :34, :47, :54, :58, :148, :160, :171, :180, :197 and :222-265 are correct. `term_item_listings.py` :382, :391, :440, :468, :480, :531, :600, :715, :738, :784, :962 are correct. `public_view.py` :211, :246, :420, :423 are correct. `join_requests.py` :72, :94, :150, :174, :267, :277 are correct. `memberships.py` :123 and :187 are correct. `exchange_summary.py` :205 and :237 are correct. `term_end_scan.py` :64 and :207 are correct. `circulation/infrastructure/repository.py:454` is correct. `router/circles.py` :56, :319, :330, :339 are correct.
- Migration head is `0055` (`revision = "0055"`). `parties` is the table name. The FK naming convention (`fk_groups_party_id_parties`) matches the proposed `fk_groups_deleted_by_party_id_parties`.
- `clock.format_term_day` exists (`clock.py:58`). `freeze_local_now` exists (`tests/conftest.py:118`). The domain-clock guard forbids only `datetime.now(` and `date.today(`, so `datetime.utcnow()` is allowed.
- Frontend: `PanelDataContext.tsx:442` and `:448-450` (both `Promise.all(getGroup)`), `:609` (`handleRemoveGroup`), `SpotkaniaView.tsx:180` (trash), `UnsavedChangesDialog.tsx` (alertdialog + `useRegisterOpenSheet(true)`), `problem.ts` (`hasStatus`, `serverMessageOr`, `extractProblemMessage`), `useModerationPhotos.ts` (template), `PhotoModerationPage.tsx` (`STATUS_FILTERS`). All verified.
- `assignLeadership` (`api/groups.ts:134`) has no non-test callers. `endLeadership` (`:138`) is imported only by `PanelDataContext.tsx:22`. The spec's conditional removal is accurate.

### Completeness of read and mutation paths
Every entry point I found and its classification:
- **A1 (getter)**: GET/PATCH group, `get_own_circle`, `assign_leadership`, `create_term`, public view, `/access`, `/rsvp`, join requests (create via `_get_private_group`, plus approve, reject and list-by-group), formalize, exchange summary and family offers, take, accept swap, and the OG previews (`system/router.py:91-94` and `:106-109` catch `EntityNotFoundException`).
- **A6 (getter)**: Also covers `GET /api/groups/{id}/terms/{term_id}/attendees` (`list_term_attendees_for_formalization`) through `_require_term_in_group`, and `fulfill_pledge` through `pledge_fulfillment.py:50`.
- **A4/A5**: Callers are `users/router.py:136`, `families/repository.py:98`, `join_requests.py:267`, `get_own_circle`, and `_is_active_member` (`memberships.py:58`).
- **A10**: `organizer_page.py` reaches `list_upcoming_terms_for_groups`, `count_member_families_for_groups`, `list_needed_items_with_product_for_terms` and `_exchange_candidates` only with group or term ids derived from `_qualifying_owner_circles`, so one predicate covers them all. Confirmed.
- **B paths**: `_resolve_transaction_reservations_for_action` (:962), `/mine` and `/mine-as-taker` (:385 and :400), `term_end_scan` (no getter use, and `_list_eligible_lister_party_ids` uses the unfiltered `get_current_leadership`), withdrawals, `remove_leadership`, and `find_reservation_term` (`item_details.py:75`). None of these goes through the filtered getters, apart from B1 and B2, which the spec switches to `get_term_any`.

---

## Medium findings

### M1. ADMIN without a `UserProfile` contradicts the router flow (Incorrect/Ambiguous)
- **Spec**: Req 3 says "An ADMIN without a `UserProfile` gets `NULL`". Known Limitations repeats this. The data flow says "The router resolves the profile and the ADMIN flag", and req 13 says DELETE uses `get_profile_by_principal`.
- **Evidence**: `app/users/service.py:97-108`. `get_profile_by_principal` **raises** `EntityNotFoundException("UserProfile", ...)` when there is no profile, and the module has no non-raising variant (`grep '^async def (find|get)_profile'` finds only raising getters). The same applies to the ADMIN branch of `POST /api/leaderships/{id}/end` (req 7).
- **Impact**: A profile-less ADMIN would get a 404 instead of the 204 the spec promises, and could not end a leadership either. The seeded `admin` user has a profile (`alembic/versions/0010_seed_dev_user_profiles.py:39`), so this is an edge case, but the spec says two incompatible things.
- **Recommendation**: Either reuse the `try/except EntityNotFoundException: profile = None` precedent in `public_view.py:355-358` (in DELETE and end-leadership), or drop the "profile-less ADMIN → NULL" promise. If the first option is chosen, `soft_delete_group(..., actor_party_id: uuid.UUID | None, is_admin)` must accept `None`.

### M2. `remove_leadership` ownership check: signature and location unspecified; an existing direct-service test will break (Incomplete)
- **Spec**: Req 7 says 403 unless ADMIN or `_is_active_organizer(leadership.to_group_id)`, and "Route permission stays EDIT". It does not say whether the check goes in the service (security.md: "ownership checks live in the service", repeated in the spec's Standards Compliance) or in the router, or what the new signature is. Req 13 lists exports but not `remove_leadership`'s new parameters.
- **Evidence**: `app/groups/application/circles.py:209` is `remove_leadership(db, leadership_id, valid_to)`, and `router/leaderships.py:40-48` has no principal use. `tests/test_group_join_requests_router.py:352` calls `service.remove_leadership(db_session, leadership.id, date.today())` directly.
- **Impact**: Adding `caller_party_id` and `is_admin` to the service, which the standard implies, breaks that test. The spec's test list does not mention updating it.
- **Recommendation**: State the signature, for example `remove_leadership(db, leadership_id, valid_to, caller_party_id: uuid.UUID | None, is_admin: bool)`, and add "update `test_group_join_requests_router.py:352`" to the test plan. (`assign_leadership` is unchanged, so `test_group_join_requests_decisions.py:301` is fine.)

### M3. Delete-dialog copy: the date format differs from the user-approved wording (Ambiguous)
- **Spec**: Req 3 uses `clock.format_term_day(occurs_on)`, which renders "wt 21.10" (`clock.py:58-59`, weekday + DD.MM).
- **User decision**: `scope-clarifications.md` (and `requirements.md` Phase 2) gives "…na termin **DD.MM** są zapisy…", e.g. "na termin 21.10".
- **Assessment**: Using `format_term_day` follows the `time.md` standard ("user-facing dates via `clock.format_term_day`"), and the user's text was an example ("e.g."). The spec discloses the rendering, so this is a small, defensible deviation. Get one-line user confirmation, or pin the exact expected string in the 409 test so the copy is deliberate.

---

## Low findings

### L1. Unclassified keep-live paths (Incomplete, documentation only)
None of these leak data, but Table B should list them so that a future refactor does not route them through `get_term`:
- `sync_pledge_fulfillment` (`pledge_fulfillment.py:113`, `POST /api/pledges/{id}/sync`) is live because it uses no getter.
- `list_swap_proposals_for_my_item` (`term_item_listings.py:559`, GET swap-proposals for my item) is live, and the owner needs it to reach B4's `reject_swap_proposal`. That is the only way to release a proposer's self-locked item on a deleted group, because accept is blocked by A1/A6 (:715/:738) and `term_end_scan._scan_swaps` only handles ACCEPTED proposals (`term_end_scan.py:163-170`).
- `fulfill_pledge` is blocked through A6/A13, and it is listed. Say explicitly that this is intended: a CLAIMED pledge on a deleted group can then only be withdrawn.

### L2. "Visually hidden Actions header" vs "AdminTable unchanged" (Contradiction)
- Visual Design row `screen:admin-groups-deleted` asks for a visually hidden "Actions" header. The reuse table says `AdminTable` is "unchanged", and req 20 says an "Actions" column.
- `components/shared/AdminTable.tsx:11` types `columns: string[]` and renders each header as visible text keyed by its string. A visually hidden header is not possible without changing `AdminTable`.
- Recommendation: Accept a visible "Actions" header (simplest), or allow a small `AdminTable` change.

### L3. RSVP check-then-act race (Ambiguous)
`soft_delete_group` checks for active RSVPs and then stamps `deleted_at`. A concurrent `create_rsvp` (which touches only `term_attendances`, not the `Group` row) can commit in between and leave an RSVP on a deleted group. The spec discusses only the PATCH/DELETE version-id race. At this scale this is acceptable, but the spec should state that it is accepted (the B4 withdraw path and B1 keep the RSVP harmless).

### L4. Panel `load()` tolerance covers only `getGroup` (Incomplete)
Req 16 skips a 404 from `getGroup`, but the follow-up `getTerms(group.id)` and `getNeededItems(term.id)` (`PanelDataContext.tsx:455-466`) can still 404 if a group is deleted between the two calls. This race is narrow. Either note it in Known Limitations or let the helper cover the per-group term fetch too.

### L5. Admin principal and EDIT for DELETE (Ambiguous)
DELETE uses `EditPrincipal` (`require_any("EDIT","mcp:edit")`). An ADMIN can delete only if their token also carries EDIT. Registered accounts get `["READ","EDIT"]` (`users/router.py:46`), so this holds in practice. Still, the "organizer OR ADMIN" promise depends on it implicitly, so add one sentence to the spec.

### L6. Existing frontend assertions will change (Incomplete, test plan)
- `test/AdminGroupsPage.test.tsx:61` and `:73` assert `getGroupsForModeration` was called with `(1)` and `(2)`. With the new `(page, deleted)` signature these become `(1, false)` and `(2, false)`.
- The `vi.mock("../api/groups")` block in `test/PanelPage.test.tsx:68-82` needs `deleteGroup`, and `endLeadership` should be removed if the API function is removed.
- The spec says "existing tests are updated" in general terms. Naming these spots would help the planner.

### L7. Minor line drift in the spec's Table B (Low)
- `pledges.py`: `get_pledge` is at :90 (spec says :97), and `list_pledges` is at :97 (spec says :102). `end_membership` is at `memberships.py:42` (spec says :40). The function names are correct.

### L8. Test volume is above the 2-8 per group guideline (Standards note)
The backend test plan adds roughly 30 tests (delete/leadership ~8, read-path ~10, keep-live 4, moderation 6, matrix 4, migration 1). The breadth is justified by the read-isolation risk. To stay close to `backend-testing.md`, group the read-path assertions into a few parametrized or multi-assert tests, one per A-row group, as the spec already suggests.

---

## Clarification questions
1. **M1**: For an ADMIN without a `UserProfile`, should DELETE succeed with `deleted_by_party_id = NULL` (requires a non-raising profile lookup), or is ADMIN required to have a profile, so the NULL case is dropped from the spec?
2. **M2**: Confirm that the end-leadership ownership check goes in the service (`remove_leadership(..., caller_party_id, is_admin)`), and that updating `tests/test_group_join_requests_router.py:352` is in scope.
3. **M3**: Is "Grupy nie można usunąć — na termin **wt 21.10** są zapisy…" (with the weekday, from `format_term_day`) acceptable, or should it be exactly "21.10"?
4. **L2**: Visible "Actions" header (no `AdminTable` change), or a visually hidden header (small `AdminTable` change)?

## Extra features (not in the user decisions)
- B2 (`/mine` and `/mine-as-taker` switched to `get_term_any`): this is justified and disclosed in Known Limitations. It is required for B1 to be reachable from the UI (`pendingActions.ts:142`).
- `restoreGroup` focus management, moving focus to the "Deleted" filter button: this comes from the binding mockups, so it is in scope.

## Standards compliance
- **models.md**: Nullable `DateTime()` (same shape as `NeededItem.deleted_at`, `models.py:255`), a plain FK-id column with no relationship, and an explicit per-query predicate with no global filter. Compliant. The spec also correctly flags the stale "soft delete not used" text (`models.md:169-170`) as a separate standards update.
- **migrations.md**: Reversible, small, named FK, schema only. Compliant.
- **queries.md / jooq.md**: Bound params, the same predicate for count and list, and a single `MIN` RSVP query. Compliant.
- **security.md**: Matrix rows mirror the route dependencies, and there are ordering tests. Ownership is in the service except for the M2 gap.
- **time.md**: `utcnow()` for the audit stamp, `clock.local_now()` for "upcoming", `format_term_day` for the copy. Compliant.
- **accessibility.md / data-fetching.md / frontend-testing.md**: Alertdialog, trap, Esc, focus return with the `main[tabindex=-1]` fallback, `useRegisterOpenSheet(true)`, prefix-then-params key, awaited prefix invalidation, explicit vitest imports. Compliant.
- **minimal-implementation.md**: No speculative helpers or notifications, and dead API functions are removed only when unused. Compliant.

## Recommendations
1. Resolve M1 and M2 in the spec text before planning: define the profile lookup for ADMIN, the `remove_leadership` signature, and the existing test update.
2. Add L1's three paths to Table B, or to a short "no change, intentionally live or blocked" note.
3. Pin the 409 copy in a test (M3) and decide on the Actions header (L2).
4. Optionally note L3, L4 and L5 under Known Limitations.

No blocking issues. The spec is implementable as written once M1 and M2 are clarified.
