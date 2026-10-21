# Backend findings 2/3 — Membership creation and PRIVATE gating (SQ3)

**Category**: `codebase-backend` | **Root**: `src/backend/` | **Date**: 2026-10-21 | Confidence: High (full reads).

## 1. How a membership is created today

### `add_active_membership` — the only membership factory
`app/groups/application/memberships.py:28-40`:
```python
async def add_active_membership(db: AsyncSession, group_id: uuid.UUID, party_id: uuid.UUID) -> Membership:
    """Flushes (never commits) a new active `Membership` of `party_id` in
    `group_id`. The caller checks "already a member" and owns the commit."""
    role = await get_or_create_active_group_role(db, party_id, GroupRoleType.MEMBER)
    membership = Membership(
        from_role_id=cast(uuid.UUID, role.id),
        to_group_id=group_id,
        valid_from=clock.local_now().date(),
        valid_to=None,
    )
    db.add(membership)
    await db.flush()
    return membership
```
Contract (also pinned by `tests/test_add_active_membership.py:47-73`): creates/reuses the party's MEMBER `GroupRole` (`application/group_roles.get_or_create_active_group_role`, import l.25), `valid_from = clock.local_now().date()` (Warsaw domain clock, `time.md`), `valid_to = None`; **flush only** — the caller commits (l.64-73 test proves rollback discards it). Exported via `service.add_active_membership` (`service.py:__all__` l.113 area, "add_active_membership").

### Exact idiom to copy from the approve path
`app/groups/application/join_requests.py:207-208`:
```python
    if not await _is_active_member(db, group_id, join_request.requester_party_id):
        await add_active_membership(db, group_id, join_request.requester_party_id)
```
followed by the commit in `_decide_join_request` (l.196 `await db.commit()`). A join-by-code use case replaces the organizer decision with the code check and keeps this pair + `db.commit()`.

### Pre-conditions used by `create_join_request` that a redeem-code use case should keep
- Caller resolution: `_get_caller_party_id` (`join_requests.py:52-59`) → `get_profile_by_principal`, mapping `EntityNotFoundException` to `AuthenticationRequiredException` (401) — a token without a `UserProfile` is "not authenticated".
- Group must be PRIVATE and live: `_get_private_group` (l.71-75) → `get_group` (`circles.py:167-171`, 404 incl. soft-deleted) then `visibility != PRIVATE → EntityNotFoundException("Group", ...)` (404, never 403 — avoids revealing anything).
- Already has access: `_is_active_organizer(...) or _is_active_member(...)` → `BusinessConflictException("Masz już dostęp do tej grupy")` (409) (l.98-101).
- Organizer existence check l.103-105 (`"Ta grupa nie ma teraz organizatora"`) exists only because a notification recipient is needed; not required for code redemption unless a notification to the organizer is wanted.

### `_is_active_member`
`memberships.py:59-64`:
```python
async def _is_active_member(db, group_id, party_id) -> bool:
    memberships = await list_memberships_for_party(db, party_id)
    return any(m.to_group_id == group_id for m in memberships)
```
`list_memberships_for_party` (l.203-207) → `repository.list_member_role_ids_for_party` (`repository.py:253-264`: MEMBER `GroupRole`s of the party) → `list_active_memberships_for_role_ids` (l.267-279: `Membership.valid_to IS NULL` joined to `Group` with `Group.deleted_at IS NULL`). Note: it loads *all* of the party's memberships and filters in Python; cheap for this app's scale, but a code-redeem path calls it once.

### `_is_active_organizer` / `_require_active_organizer`
`app/groups/application/circles.py:356-366`: `_is_active_organizer` resolves `get_current_leadership` (l.340-341 → `repository.find_current_leadership`) then `_group_role_party_id(...) == party_id`; `_require_active_organizer` raises `AccessDeniedException` (403). Organizer-only endpoints (view/regenerate code) should use `_require_active_organizer` exactly as `update_group` does (`circles.py:246-247`).

### Membership model constraints
`app/groups/models.py:172-192`: `Membership(BaseEntity)` — `from_role_id` FK `group_roles.id`, `to_group_id` FK `groups.id`, `valid_from: date` NOT NULL, `valid_to: date | None`. Docstring l.173-177: N:N, "many simultaneously-active rows per from_role_id/to_group_id are allowed (no uniqueness constraint)" — so the application-level `_is_active_member` guard is the only duplicate protection; a code redeemed twice concurrently could create two active rows (acceptable today for approve; worth a note for the design).

## 2. PRIVATE gating branches

### `get_public_circle_view` — reduced response
`app/groups/application/public_view.py:200-259`. Signature l.200-206 takes `include_private_content: bool = False`. Branch l.244-259:
```python
    if group.visibility == GroupVisibility.PRIVATE and not include_private_content:
        # Reduced response for a PRIVATE group: name + organizer only, no
        # terms/needed-items/offers/guardian names ...
        return PublicCircleResponse(id=..., name=group.name, organizer_display_name=...,
            organizer_slug=organizer_slug, organization=public_organization,
            visibility=group.visibility, layout_mode=group.layout_mode, term=None, guardians=[])
```
Docstring l.221-224: reduced branch deliberately skips `term_id` validation "so an outsider cannot probe which Terms exist" (test `test_group_access.py:246` `privateOutsiderForeignTermId_keepsReduced200`). The raw `GET /api/groups/public/{id}` route (`router/circles.py:136-153`) always passes `include_private_content=False` — even a member gets the reduced body there (`test_group_access.py:53-67` `staysReducedForMember`). **KEEP unchanged.**

### `get_group_access` — the resolver the frontend gate consumes
`public_view.py:354-420`:
- l.375-380: optional principal → profile (`EntityNotFoundException` → anonymous).
- l.382-386: `is_organizer = _is_active_organizer(...)`; `is_member = is_organizer or _is_active_member(...)`.
- l.388-394: `get_public_circle_view(..., include_private_content=is_member or is_organizer)`.
- l.395-397: `is_attending` from the guardians list.
- l.399-409 (**the branch join-by-code replaces**):
```python
    join_request: JoinRequestSummary | None = None
    if group_response.visibility == GroupVisibility.PRIVATE:
        can_view_content = is_member or is_organizer
        if profile is not None and not can_view_content:
            latest = await repository.find_latest_join_request(db, profile.party_id, group_id)
            if latest is not None and latest.status in _GATE_JOIN_REQUEST_STATUSES:
                join_request = JoinRequestSummary(id=..., status=latest.status.value)
    else:
        can_view_content = True
```
- l.411-420: builds `GroupAccessDetails(is_member, is_organizer, can_view_content, join_request, is_attending)`.
Route: `router/circles.py:156-171`, `principal: OptionalPrincipal = None` (l.161), matrix row `GET ^/api/groups/public/[^/]+/access$` PUBLIC (`authorization_matrix.py:100`). After removal the PRIVATE branch reduces to `can_view_content = is_member or is_organizer`; the response may gain a field such as `can_join_with_code: bool` (true for a logged-in non-member of a PRIVATE group) if the frontend gate needs a server signal, but nothing else in the resolver changes.

### `create_rsvp` — PRIVATE RSVP guard
`public_view.py:454-464`:
```python
    if group.visibility == GroupVisibility.PRIVATE:
        if profile is None or profile.account_user_id is None:
            raise AccessDeniedException
        if not (await _is_active_organizer(db, group_id, profile.party_id)
                or await _is_active_member(db, group_id, profile.party_id)):
            raise AccessDeniedException
```
Returns 403 for anonymous/outsider (tests `test_group_privacy.py:68,87`). Comment l.455-457 ("membership itself is only ever granted by the organizer") needs rewording. **KEEP logic unchanged** — once a code creates a `Membership`, RSVP works through this branch with no edits (today's `test_group_access.py:366-391` proves approve → RSVP 201).

### `update_group` — where visibility flips
`circles.py:228-266`; `_require_active_organizer` l.246; `if data.visibility is not None: group.visibility = data.visibility` l.257-258; docstring l.238-241: switching visibility is unrestricted and independent of membership creation (`test_group_privacy.py:139-162`). Route `PATCH /api/groups/{group_id}` (`router/circles.py:281-288`, `EditPrincipal`), schema `UpdateGroupRequest.visibility: GroupVisibility | None` (`schemas.py:83`). `CreateOwnCircleRequest.visibility` (`schemas.py:99`) and `create_additional_circle(..., visibility=...)` (`circles.py:93-117`) set it at creation. **Design hook**: generating the first code when a group becomes/creates as PRIVATE would live in these two functions (or lazily on first organizer read).

### Organizer public page
`application/organizer_page.py` has no visibility logic; filtering happens in `repository._qualifying_owner_circles` (`repository.py:770-786`): `.where(Group.visibility == GroupVisibility.PUBLIC, Group.deleted_at.is_(None))` l.785 — PRIVATE circles never appear on `/api/groups/public/organizers/{slug}` (test `test_organizer_page.py:190-212`). **KEEP**; a join code does not change the organizer page.

### Other PRIVATE references
Grep `GroupVisibility.PRIVATE|visibility ==` over `app/`: only `join_requests.py:73`, `public_view.py:244,400,454`, `repository.py:785`. No other gate exists (members list, exchange summary, term item listings are gated by organizer/member checks, not by visibility).

## 3. Authorization-matrix rows relevant to the new endpoint

`app/core/authorization_matrix.py`:
- l.93 `GET ^/api/groups/public/[^/]+$` PUBLIC; l.100 `GET .../access$` PUBLIC; l.105 `POST .../rsvp$` PUBLIC; l.106 `POST ^/api/groups/public/merge$` PUBLIC.
- l.113-117 join-requests row → `"AUTHENTICATED"` (to be replaced).
- l.123 `PATCH|DELETE ^/api/groups/[^/]+$` EDIT (organizer-only check in service).
- l.134 blanket `GET ^/api/groups(/.*)?$` READ (#26); l.135 blanket `POST ^/api/groups(/.*)?$` EDIT (#27).
Implications: a `POST /api/groups/public/{id}/join` (or `/join-code/redeem`) row must sit above l.135 with requirement `"AUTHENTICATED"` and the route must use `Depends(require_any())` (`router/join_requests.py:24` alias) — GUEST accounts have no EDIT. Organizer-side `GET /api/groups/{id}/join-code` falls to READ row #26 and `POST /api/groups/{id}/join-code/regenerate` to EDIT row #27 with no new rows, exactly like the old approve/reject (`test_authorization_matrix.py:134-137` comment l.145-147).

## 4. Errors and envelopes available
`app/core/errors.py`: `EntityNotFoundException(entity_type, id)` → 404 (l.38-45, handler l.86-87); `BusinessConflictException` → 409 (l.48-50, l.90-93); `AccessDeniedException` → 403 "Access denied" (l.53-55, l.121-122); `IntegrityError` → 409 "Data integrity violation" (l.96-99); `StaleDataError` (optimistic lock on `updated_at`) → 409 Polish message (l.101-108); `RequestValidationError` → 400 with `field_errors` (l.111-118). There is no 429 handler or exception type — one would be new.

## 5. Test helpers worth reusing for new tests
- `tests/test_group_access.py:29-50` `_register`, `_create_circle(visibility=...)` (PATCH to PRIVATE), l.70-83 `_private_circle_with_outsider`, l.95-104 `_access` reader.
- `tests/test_add_active_membership.py:16-44` `_auth`, `_register` (returns `party_id`), `_create_circle_and_term`.
- `tests/conftest.py:117-127` `freeze_local_now` (patches `clock.local_now`) — needed for any code-expiry test; l.81 `count_queries`.
