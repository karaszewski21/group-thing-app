# Phase 1 Clarifications

Date: 2026-09-10

## Q1 — Vertical scope
**Answer: Exclude oauth2 + plugin.**
In scope this pass: `groups`, `circulation`, `families`, `core/auth_deps`.
`oauth2/` (722-line router, no `service.py`, zero tests) and `plugin/` (zero tests) are
deferred to a separate follow-up pass.

## Q2 — Restructuring depth (per-vertical)
**Answer: tiered.**

- **`circulation` + `groups` → full DDD / clean architecture:**
  - `domain/` — pure rules (entities/value objects, state machines, invariants, policies; no DB, no cross-context imports)
  - `application/` — use cases (one module per use case / aggregate operation), orchestration + transaction ownership
  - `infrastructure/` — repositories (all `select`/`get`/query building + eager loading), adapters, cross-context ACLs
  - thin `router.py` (or `router/` package by resource for groups)
  - re-export facade at the old `service.py` path for cross-slice importers

- **`families` + `core/auth_deps` → layered architecture with file-splitting behind a facade:**
  - split the big file into cohesive modules along existing seams
  - keep a re-export facade (`families/service.py` / `core/auth_deps.py`) so import paths stay stable
  - lighter than full DDD — no mandated `domain/`/`application/`/`infrastructure/` triad unless a piece
    clearly warrants it (e.g. `families` `make_primary_contact` temporal logic, guardian-authz dedupe)

## Q3 — Test safety for zero-test verticals
**Answer: N/A** — oauth2 and plugin are excluded from scope.
The in-scope verticals (groups, circulation, families) are well covered by HTTP-level
TestContainers integration tests; `core/auth_deps` matrix has a dedicated unit test.

## Q4 — Conventions / cleanup bundled into this pass
**Answer: purely structural, PLUS these two specific cleanups only:**

1. **Relocate `AUTHORIZATION_MATRIX`** (+ `resolve_requirement`, `MatrixEntry`, `_RAW_MATRIX`, etc.)
   out of `core/auth_deps.py` into its own module as part of the `auth_deps` split
   (~135 lines, zero callers in `app/`, exercised only by `tests/test_authorization_matrix.py`).
2. **Remove `groups.end_group_role`** after verifying it has no callers.

**NOT in scope this pass:**
- No new "transaction-ownership" standard document (but the refactor must still not shift
  commit boundaries into extracted helpers — that is just doing the extraction correctly).
- No shared `core/http/form.py` (only 1 in-scope copy once oauth2 is excluded).
- No error-system convergence work.
- No other dead-code hunting beyond `end_group_role`.

## Derived constraints (from analysis, carried into all phases)
- No behavior change. HTTP-level test suite (`uv run pytest` from `src/backend`) must stay green.
- Preserve every cross-slice import path via re-export facades; do not rewrite cross-slice
  call sites in the same change as a split.
- Keep each vertical's `APIRouter` exported at a stable import path (`main.py` must not change
  beyond router include ordering if a `router/` package is introduced).
- `groups/router.py` route registration order must be preserved (`/mine/...`, `/public/...`
  before `/{group_id}`).
- Keep ownership/authorization checks (`_require_*` raising `AccessDeniedException`)
  co-located with the mutations they guard.
- `groups` cross-package public surface to keep importable: `list_memberships_for_party`,
  `build_membership_responses`, `build_leadership_responses`, `list_active_leaderships_for_party`.
- `circulation` cross-package public surface to keep importable: `get_or_create_personal_inventory`,
  `register_item`, `create_lend_reservation`, `get_reservation`.
- `core/auth_deps` must keep re-exporting `Principal`, `require_any`, `OptionalPrincipal`,
  `get_current_principal`, `AuthenticationRequiredException`, `register_auth_exception_handlers`.
