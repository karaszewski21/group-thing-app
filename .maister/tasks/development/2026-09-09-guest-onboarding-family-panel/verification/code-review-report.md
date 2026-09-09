# Code Review Report — Guest Onboarding / Family Panel / RSVP fix

Date: 2026-09-09
Scope: task diff (backend groups/families/auth, frontend CreateFamilyDialog + RsvpDialogLoggedIn)
**Status: ⚠️ Issues found — 0 critical, 4 warnings, 6 info. All priority security items verified sound.**

## Priority-focus security verification — ALL PASS

1. **Public `create_rsvp` with optional bearer token** — `get_current_principal` (`app/core/auth_deps.py:90-116`) never raises: `_extract_token` swallows the multipart `AssertionError`; `decode_token` wrapped in `except jwt.PyJWTError`; non-string `sub` / missing claims → `None`. Invalid/expired/malformed token → `None` → anonymous path. Cannot 401 or 500.
2. **Attached path mints no Party/UserProfile** — logged-in branch only `select`s or `db.add()`s a `TermAttendance` against `profile.party_id`. `create_party` / `UserProfile(...)` reachable only when `profile is None or profile.account_user_id is None`.
3. **No guardian-name spoofing** — body `guardian_name` ignored for logged-in callers; response uses `profile.display_name`.
4. **Idempotency lookup fully parameterized** — SQLAlchemy bind params, no splicing.
5. **No IDOR** — caller party always `profile.party_id` from principal, never body.
6. **AUTHORIZATION_MATRIX rows + order** — rsvp unchanged/PUBLIC; `POST ^/api/families/mine$`→EDIT and `PATCH ^/api/families/[^/]+$`→EDIT before blanket families rows; `GET ^/api/groups/mine/attendances$`→READ before public-groups + blanket groups rows. Route registration order correct in both routers (`/mine` before `/{id}`).
7. **`rename_family` guardian check sound** — requires an open (`valid_to IS NULL`) `FamilyMembership` in this family whose `FamilyRole` is `party_id == caller` AND `role_type == GUARDIAN`. Non-guardian / child / other-family guardian / former guardian → 403. `create_own_family` idempotent, never renames.
8. **Frontend** — no secrets, no `dangerouslySetInnerHTML`, all interpolation React-escaped, no XSS. `RsvpDialogLoggedIn` never touches localStorage. Error handling present in both new components.

## Warnings

| # | Location | Issue |
|---|---|---|
| W1 | `app/families/router.py` `list_my_families` + the two `mine` write handlers | N+1: `count_active_child_members` called once per family row. Aggregate query itself is clean. Low impact (usually 1 family/guardian) but violates `queries.md`. Fix: one grouped `select(...to_family_id, func.count()).group_by(...)` over the id set. |
| W2 | `app/groups/service.py` `list_my_attendances` | Redundant leadership resolution — `_resolve_organizer_display_name` and `resolve_organizer_slug` each independently call `get_current_leadership` + `_group_role_party_id`, so those run twice per circle. Bounded by distinct circles (1–3). A single `_resolve_organizer(db, group_id) -> (name, slug, party_id)` helper would halve it. |
| W3 | `resolve_organizer_slug` on `GET /api/groups/{id}` | 3+ queries for a cosmetic slug on a hot path. **Likely pre-existing** (get_group already resolved the slug before this task); this task did not add the call. Consider caching the slug on the group. Out of scope here. |
| W4 | `list_groups` (`GET /api/groups`) | `organizer_slug` stays `null` from the list endpoint while `GET /api/groups/{id}` populates it. **Pre-existing** — not introduced by this task. Document as single-fetch-only or batch-populate later. |

## Info

| # | Location | Note |
|---|---|---|
| I1 | `create_rsvp` | A valid JWT for a not-yet-merged anonymous profile (`account_user_id is None`) skips the attach branch and mints a second anonymous profile. Likely unreachable (merge always sets `account_user_id`). Add a comment for auditability. |
| I2 | `TermAttendance(term_id, party_id)` | Idempotency relies on `.scalar_one_or_none()` with no DB unique constraint. Concurrent double-submit or legacy dupes → `MultipleResultsFound` → 500. A partial unique index would make the guarantee real — needs a migration (spec said none), so **follow-up**. |
| I3 | `app/groups/service.py` `_resolve_organizer_display_name` → `get_profile_by_party` | Can raise `EntityNotFoundException` if an organizer party has no `UserProfile` → whole `list_my_attendances` 500s instead of degrading to `organizer_display_name = None`. Wrap in try/except (like `create_rsvp` does for `get_profile_by_principal`). **New code — worth fixing.** |
| I4 | `RsvpDialogLoggedIn.tsx:164` | Hardcoded error color `#B4443A` instead of a token. Cosmetic. |
| I5 | `CreateFamilyDialog.tsx:144` | Draft member list uses array index as React key. Removing a member mid-list can cause input/state mismatch. Use a stable per-draft id. **Minor bug — worth fixing.** |
| I6 | `RsvpDialogLoggedIn` | `child_count === 0` with a real family shows the "add family" banner. Probably intended (0 children = nothing to prefill); add a one-line comment. |

## Metrics
Longest new function ~70 lines (`create_rsvp` both branches); max nesting 3; new injection surface 0; new public-route auth regressions 0.

## Prioritized recommendations
1. **I3** — guard `get_profile_by_party` in `_resolve_organizer_display_name` (prevents a 500 on the new panel endpoint).
2. **W1** — batch `count_active_child_members` (clear `queries.md` violation, cheap fix).
3. **I5** — stable React key for draft members.
4. W2 — merge duplicated organizer resolution into one helper.
5. I2 — `TermAttendance` unique index (needs migration — follow-up task).
6. I1, I4, I6 — comments / token cleanup.
