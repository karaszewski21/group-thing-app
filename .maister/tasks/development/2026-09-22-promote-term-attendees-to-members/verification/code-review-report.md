# Code Review Report — Promote Term Attendees to Members

**Date**: 2026-09-22
**Scope**: all files changed by this task (backend + frontend + tests)
**Status**: Issues Found (1 Critical, 2 Warnings, 3 Info)

## Summary
- Critical: 1
- Warning: 2
- Info: 3

---

## Critical

### C1 — `formalize_group_from_term` is not idempotent against already-active members; a duplicate submit creates a duplicate `Membership` row.
File: `src/backend/app/groups/application/memberships.py:139-152`

```python
attendances = await repository.list_active_attendances_for_term(db, term_id)
eligible_party_ids = {a.party_id for a in attendances if a.term_id == term_id}
selected_party_ids = eligible_party_ids & set(party_ids)

for party_id in selected_party_ids:
    role = await get_or_create_active_group_role(db, party_id, GroupRoleType.MEMBER)
    db.add(Membership(from_role_id=cast(int, role.id), to_group_id=group_id, valid_from=date.today(), valid_to=None))
```

`eligible_party_ids` is derived purely from `TermAttendance` (still-attending), never cross-referenced against `repository.list_active_memberships_for_group`. `Membership` has no uniqueness constraint (`app/groups/models.py:149-170`: "N:N... no uniqueness constraint, unlike `Leadership`"), so calling this twice with an overlapping `party_ids` selection (double-click submit, or a retry after a network timeout where the first request actually succeeded) inserts a second `Membership` row for the same `(party, group)`. The function's own docstring claims "Idempotent per selected attendee," which is false for this case — it's only idempotent against a *stale* selection (a party who withdrew attendance), not against a party who is already a member.

Independently confirmed (matches the implementers' own flagged finding in `work-log.md`). Directly exploitable via both new UI surfaces this task ships: submit buttons are only disabled while a request is busy — a client-side timeout that resets `busy` while the server-side commit still lands leaves the door open for a legitimate duplicate submit. `already_member` protection only exists after a successful refetch.

**Fix**: subtract already-active-member party_ids from `selected_party_ids` before the loop, mirroring `list_term_attendees_for_formalization`'s existing `already_member` computation (lines 107-110):
```python
active_memberships = await repository.list_active_memberships_for_group(db, group_id)
already_member_party_ids = {await _group_role_party_id(db, m.from_role_id) for m in active_memberships}
selected_party_ids = (eligible_party_ids & set(party_ids)) - already_member_party_ids
```
Recommend restoring the drafted-then-removed `test_formalizeGroupFromTerm_idempotent_skipsStaleSelection` test alongside the fix — see `test_group_privacy.py:249-253`'s comment documenting that this test was written, confirmed the bug, then deliberately removed rather than left red.

---

## Warnings

### W1 — Success-copy pluralization inconsistency between the two new/reworked UI surfaces (confirmed, non-blocking but user-visible)
- `EditTermDialog.tsx:427-429`: `` `Dodano ${formalizedCount} osób jako stałych członków grupy.` `` — always "osób" (genitive plural), grammatically wrong for N=1 ("Dodano 1 osób" is incorrect Polish; should be "Dodano 1 osobę").
- `KragGrupyPage.tsx:941-945` correctly pluralizes: `standingMembersPromotedCount === 1 ? "osobę" : "osób"`.

Both surfaces implement the same spec'd copy template (spec.md Core Requirement 7), but diverge in correctness. spec.md's Success Criteria explicitly calls for "consistent... copy on both surfaces" — recommend a one-line fix to `EditTermDialog.tsx` to match `KragGrupyPage.tsx`'s pluralization logic.

### W2 — `formalize_group_from_term`'s per-party-id sequential loop is an N+1 pattern for a batch operation
`memberships.py:143-152` does one `get_or_create_active_group_role` DB round-trip per selected attendee inside a `for` loop. Not new to this task (loop shape predates this change); batch sizes are bounded by one term's attendee list (organizer-facing, not user-facing at scale) — low severity, flagged per `standards/backend/queries.md`'s N+1-avoidance standard. Not blocking.

---

## Informational

### I1 — Function-local import pattern is correctly scoped and necessary
`users/service.py:230-236`, `public_view.py:367-373`. Verified: `app/families/bootstrap.py:13` imports `create_account_and_profile` from `app.users.service` at module level, and `create_account_and_profile` is defined at `users/service.py:61`, before `register()` at line 204 — a top-level import of `app.families.service` in `users/service.py` would trigger loading `app.families.bootstrap` while `app.users.service` is still mid-import: a genuine circular-import risk. The deferred import is real cycle-breaking, each site carries an explanatory comment per `standards/global/commenting.md`. No issue.

### I2 — `authorization_matrix.py`'s new `join_private_group` row is correctly positioned, no security regression
The new `"AUTHENTICATED"` row is declared before row 27's blanket `POST ^/api/groups(/.*)?$` → EDIT rule in `_RAW_MATRIX`'s tuple order; `resolve_requirement` is first-match-wins. Router-side `join_private_group` uses `Depends(require_any())` (zero args → "just authenticated"), matching the row's semantics. Closes the gap the implementers flagged (row 27 would otherwise have silently required EDIT permission, stricter than intended, mismatching the route's actual dependency). No other row was widened. No regression found.

### I3 — `create_rsvp`'s `PRIVATE`-group branch is unaffected and correctly still excludes anonymous callers
`public_view.py:310-321` unchanged; independent of `join_private_group`'s new authentication requirement. Consistent with spec's "verification-only" note.

---

## Metrics
- Files reviewed: 10 backend + 3 frontend, plus targeted test file reads
- Critical correctness bugs: 1 (confirmed independently)
- Security regressions found: 0
- Copy/consistency issues: 1

## Prioritized Recommendations
1. Fix C1 before shipping to any environment where double-submits are plausible — reachable via normal (non-malicious) usage on both new UI surfaces. Restore the drafted regression test.
2. Fix W1 — trivial, ~1 line, closes a stated success-criteria gap.
3. W2 — optional/low-priority.

## Structured Result
```yaml
status: "issues_found"
summary:
  critical: 1
  warning: 2
  info: 3
  files_analyzed: 13
issues:
  - source: "code_review"
    severity: "critical"
    category: "quality"
    description: "formalize_group_from_term is not idempotent against already-active members; a duplicate submit creates a duplicate Membership row despite the docstring claiming idempotency."
    location: "src/backend/app/groups/application/memberships.py:139-152"
    fixable: true
    suggestion: "Subtract already-active-member party_ids from selected_party_ids before the mutation loop; restore test_formalizeGroupFromTerm_idempotent_skipsStaleSelection."
  - source: "code_review"
    severity: "warning"
    category: "quality"
    description: "EditTermDialog.tsx's success copy always uses 'osób' (never pluralizes for N=1); KragGrupyPage.tsx correctly pluralizes."
    location: "src/frontend/src/components/panel/EditTermDialog.tsx:427-429"
    fixable: true
    suggestion: "Mirror KragGrupyPage.tsx:941-945's conditional pluralization."
  - source: "code_review"
    severity: "warning"
    category: "performance"
    description: "formalize_group_from_term issues one DB round-trip per selected party_id inside a sequential loop (N+1 for a batch operation)."
    location: "src/backend/app/groups/application/memberships.py:143-152"
    fixable: false
    suggestion: "Low priority given bounded, organizer-facing batch sizes."
issue_counts:
  critical: 1
  warning: 2
  info: 0
```
