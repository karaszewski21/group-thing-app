# Migration Requirements — Backend Service Refactor

Date: 2026-09-10
Type: architecture migration (structural decomposition, no behavior change)

## Initial description (user, verbatim, PL)

> refaktor codu. prosze od refaktor kótry podzieli duże pliki np. sewisy na miejsze pliki.
> Tam gdzie to możliwe to podejsć DDD oraz clean architekture. skup się tylko na app backend.
> Tak zrobił się za duzy spaggeti kode

Translation: split large files (especially services) into smaller ones; apply DDD / clean
architecture where possible; backend app only; it became too much spaghetti.

## Scope

**In:** `src/backend/app/groups`, `src/backend/app/circulation`, `src/backend/app/families`,
`src/backend/app/core/auth_deps.py` (+ new `src/backend/app/core/authorization_matrix.py`).

**Out:** `oauth2/`, `plugin/` (deferred — zero tests, oauth2 needs new structure); `footprint/`
(already layered); all other verticals; `src/frontend`; any DB schema / Alembic work.

## Functional requirements (all behavior-preserving)

1. `groups` and `circulation` restructured into `domain/` + `application/` + `infrastructure/`
   layers with a flat `service.py` re-export facade (per target-state-plan.md §3, §4).
2. `families` and `core/auth_deps` split into cohesive sibling modules behind a flat re-export
   facade (per target-state-plan.md §1, §2).
3. `AUTHORIZATION_MATRIX` (+ `resolve_requirement` and its supporting types) moved verbatim to
   `app/core/authorization_matrix.py`; `tests/test_authorization_matrix.py` import updated.
4. `groups/router.py` becomes a `groups/router/` package split by resource, preserving route
   registration order and the exported `router` object path.
5. Dead `groups.end_group_role` deleted (0 callers verified in Phase 2).
6. Two small dedups: `_require_family_guardian` (families), `_load_reservation_for_transition`
   (circulation). Both must be pure behavior-preserving extractions.
7. `circulation` accounting subdomain extracted to `infrastructure/ledger.py` exposing
   `post_circulation(db, *, giver_user_id, amount, description)` as a plain async function.
8. `groups` cross-context calls (circulation ×3, organizations ×1) routed through
   `infrastructure/*_acl.py` modules — the only groups modules importing another vertical's service.

## Non-functional / constraints

- **No behavior change.** No HTTP route, method, `response_model`, status code, error envelope,
  or JSON shape changes. `main.py` `include_router` order unchanged.
- **Commit boundaries preserved verbatim** (D1). `domain/` and repositories never commit/flush.
- **Mechanical-move discipline** (D2): no logic changes, no "while I'm here" fixes, no
  simplifications on the untested reservation/ledger/saga paths. Only edits 3–6 above and the
  facade/ACL wiring are non-pure-moves, and each must be behavior-preserving.
- **Import paths preserved** via re-export facades — see Preserved Surfaces Checklist in
  target-state-plan.md. No cross-slice call-site rewrites.
- `groups/schemas.py` keeps `from app.circulation.models import ItemCondition` (D8).
- Style: `from __future__ import annotations`, functional services (module-level `async def`,
  `db` first arg, no classes), `ruff` (E,F,I,UP,B,SIM) + `ruff format` (double quotes),
  `mypy --strict` clean. Match `footprint/` conventions (empty `__init__.py`, `Mapped[...]`).

## Existing code / patterns to reference

- `app/footprint/` — the in-repo layered template (`domain/`, `engine/`, `ports.py`, `facade.py`).
- `app/plugin/query_service.py`, `app/product/query_service.py` — existing read/write split precedent.
- `standards/backend/security.md` — authz co-location rule (`_require_*` stays with the mutation).
- `standards/global/minimal-implementation.md` — no speculative abstraction (hence ledger port is a
  plain function, not a Protocol).

## Delivery & verification

- **Git:** commit directly to `main`, incrementally — one focused commit per logical step
  (user: "to nie jest produkcja, wszystko na main"). No feature branches, no PRs.
  Rollback = `git revert <sha>` (no data/schema changes).
- **Session scope:** full refactor, all 4 verticals, this session.
- **Regression gate:** `uv run pytest` from `src/backend` (TestContainers + Docker Postgres 18,
  ~113 tests) — Docker confirmed available. Run the full suite after every commit; a commit that
  reddens the suite is reverted/fixed before proceeding. Also `ruff check` + `mypy` per step.
- **Ordering:** (1) baseline green suite → (2) `core/auth_deps` ∥ (3) `families` →
  (4) `circulation` → (5) `groups` service split → (6) `groups` router package.

## Out of scope (explicitly)

- Consolidating the triplicated organizer-slug resolver (D3 — follow-up).
- Transaction-ownership standard doc; shared `core/http/form.py`; error-system convergence.
- Any behavior fix, performance fix, or N+1 fix noticed in passing (log to work-log only).
- Characterization tests for reservation/ledger/saga (D2).
- `users`, `auth`, `organizations`, `product`, `party` internal structure.
