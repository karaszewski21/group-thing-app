# Specification: Backend Service Decomposition (DDD / Clean-Architecture Boundaries)

**Task type**: architecture migration — strict mechanical decomposition, zero behavior change
**Date**: 2026-09-10
**In scope**: `src/backend/app/core/auth_deps.py` (+ new `authorization_matrix.py`), `app/families/`, `app/circulation/`, `app/groups/`
**Delivery**: incremental commits directly to `main`, one focused commit per step; `uv run pytest` + `ruff check` + `mypy` green after every commit.

---

## Goal

Break four oversized backend modules (`groups/service.py` 983 lines, `circulation/service.py` 569, `families/service.py` 418, `core/auth_deps.py` 323) into small cohesive modules with explicit domain / application / infrastructure boundaries, modeled on the in-repo `app/footprint/` layered template — **without changing a single observable behavior, HTTP contract, import path, or database commit boundary.**

This is a **pure structural refactor**. Every function moves verbatim. The only non-move edits permitted are the five listed in "Sanctioned non-pure-move edits" below, each independently behavior-preserving and verifiable against the existing ~113-test suite.

---

## Task Characteristics

| Field | Value |
|---|---|
| `has_reproducible_defect` | false — no bug, no failing test |
| `modifies_existing_code` | true — 4 verticals restructured in place |
| `creates_new_entities` | false — ~30 new *modules* are structural containers, no new DB entities / aggregates / migrations |
| `involves_data_operations` | false — no schema change, no Alembic revision, no data migration |
| `ui_heavy` | false — backend only |

**Change type**: refactor-based (internal structure changes; observable behavior preserved).
**Compatibility**: strict — every public import path, route, response shape, and `db.commit()`/`db.flush()` boundary preserved bit-for-bit.

---

## Scope

### In scope

1. `core/auth_deps.py` → layered split into cohesive sibling modules behind a flat `auth_deps.py` re-export facade; relocate the authorization matrix to a new `app/core/authorization_matrix.py`.
2. `families/` → layered split into cohesive sibling modules behind a flat `families/service.py` re-export facade; dedup the verbatim guardian-authz check.
3. `circulation/` → `domain/` + `application/` + `infrastructure/` layers behind a flat `circulation/service.py` re-export facade; extract the accounting subdomain to `infrastructure/ledger.py`; dedup the reservation-transition load-and-guard preamble.
4. `groups/` service → `domain/` + `application/` + `infrastructure/` layers behind a flat `groups/service.py` re-export facade; cross-context calls routed through `infrastructure/*_acl.py`; delete dead `end_group_role`.
5. `groups/router.py` → `groups/router/` package split by resource, preserving route registration order and the exported `router` object path.
6. `tests/test_authorization_matrix.py` — one import line updated (matrix relocation).

### Explicitly NOT in scope

- `oauth2/`, `plugin/` (deferred — zero tests; oauth2 needs new structure not a move), `footprint/` (already layered), and every other vertical (`users`, `auth`, `organizations`, `product`, `party`) internal structure.
- `src/frontend/` — no changes.
- Any DB schema / Alembic / data work.
- **Consolidating the triplicated organizer-slug resolution** (D3) — move all three copies as-is; keep `get_public_circle_view`'s inline block inline; keep the 500-vs-`None` edge divergence. Consolidation is a deliberate behavior change → logged as a follow-up.
- Extracting the reservation `InventoryBalance` transition field-mutation logic into a pure `domain/` state machine (target-state-plan §3's `balance_state_machine.py`) — **deferred**. Under D2 (mechanical-move discipline, no logic changes on the untested reservation paths) this is a behavior-risk refactor on code with no automated guard. `domain/` for circulation holds only genuinely pure, already-standalone pieces this pass. Logged as a follow-up.
- New "transaction-ownership" standard doc; shared `core/http/form.py`; error-system convergence.
- Any behavior fix, performance fix, or N+1 fix noticed in passing — log to work-log only, do not apply.
- Characterization tests for the reservation lifecycle / ledger / pledge-fulfill saga (D2 — `scope_expanded: false`).
- No dead-code removal beyond `groups.end_group_role`.

---

## Assumptions

1. **Baseline is clean.** `git status` for `src/` is clean and `uv run pytest` from `src/backend` is green before step 1 (the work-tree currently shows only `.maister/` task files modified). Step 0 is: confirm the baseline suite green and record the pass count.
2. **Docker + TestContainers available** for the integration suite (confirmed in requirements).
3. **`families/` has zero external consumers.** Verified: only `families/router.py` imports `families/service` symbols (`app.users.service.register` no longer calls `bootstrap_family_for_party`). The facade only needs to satisfy `families/router.py`.
4. **`groups.end_group_role` has zero callers.** Verified in Phase 2 — only its own definition matches in `app/` and `tests/`. To be re-verified with grep immediately before deletion.
5. **HTTP-level tests never import service internals** (sole exception: `test_authorization_matrix.py`, a unit test of `resolve_requirement`). Internal module reshaping is invisible to the suite as long as facades preserve import paths.
6. **`main.py` is unaffected** — it imports only each vertical's `router` object and `register_auth_exception_handlers`, all preserved at their current paths. `include_router` order unchanged.
7. **`mypy --strict` currently passes** on these modules; every new module carries `from __future__ import annotations` and full annotations.
8. **Route ordering in FastAPI is registration order.** `groups/router/__init__.py` must `include_router` / register the sub-routers so that `/api/groups/mine/...` and `/api/groups/public/...` and `PATCH /api/groups/{group_id}` are registered before `GET /api/groups/{group_id}`.
9. Delivery is per-step commits on `main` (not PRs); rollback is `git revert <sha>` (no data/schema changes).

---

## Reusability Analysis

### Existing code to leverage (templates — do not modify)

| Reference | Location | What it provides / how to leverage |
|---|---|---|
| `footprint/` layered vertical | `app/footprint/{domain/,engine/,archetype/,audit/,export/,ports.py,facade.py}` | The in-repo target shape. `domain/` = pure rules (`breakdown.py`, `enums.py`, `exceptions.py`, no `db`); `engine/` = calculators; `facade.py` = application entry; `ports.py` = boundary protocol. **Empty `__init__.py` per subpackage** (verified 0 bytes). Adopt the folder convention; name the use-case layer `application/` (not `engine/`/`facade`) per D4/D7. |
| `plugin/query_service.py` + `product/query_service.py` | `app/plugin/`, `app/product/` | Existing in-repo precedent for splitting a read/query concern out of `service.py` into a sibling module while keeping the flat package. Precedent that a vertical can have more than the canonical `router/service/schemas/models` files. The `infrastructure/repository.py` extraction follows the same spirit. |
| Functional-service style | every vertical | Module-level `async def`, `db: AsyncSession` first arg, **no service classes**, `# --- Title ---` banners marking seams. Every new module keeps this style. |
| Router type aliases | `DbSession`, `ReadPrincipal`, `EditPrincipal` in each `router.py` | `groups/router/` sub-modules each re-declare these three aliases locally (they are 1-liners; a shared module is out of scope). |
| Re-export facade pattern | (new, but mirrors `footprint/facade.py` role) | Flat `service.py` / `auth_deps.py` module that does `from .application.x import (...)` / `from .layer import (...)` and defines `__all__`. |
| `cast(int, ...)` id-narrowing idiom | pervasive | Preserve verbatim on every move — do not "clean up" casts (mypy-strict load-bearing). |

### New modules required (and why a move, not new code)

~30 new modules are created. **None contains new logic** — each is a container for functions that already exist in the four target files. New code is limited to:
- module docstrings and `__all__` lists,
- the flat re-export facades (mechanical `from ... import ...` aggregation),
- `groups/router/__init__.py` router assembly (mechanical — replaces the single `APIRouter` with sub-router registration in explicit order),
- three `groups/infrastructure/*_acl.py` thin wrapper modules (each function is a 1-line pass-through to the existing cross-vertical `service` call — the wrapper exists so `application/` never imports `app.circulation` / `app.organizations` directly),
- two deduped helpers (`_require_family_guardian`, `_load_reservation_for_transition`) — each is the *verbatim* body of an existing duplicated block, factored to one definition.

### Sanctioned non-pure-move edits (the ONLY deviations from verbatim relocation)

| # | Vertical | Edit | Behavior-preservation argument |
|---|---|---|---|
| a | families | Extract `_require_family_guardian(db, family_id, caller_party_id)` from the two byte-identical guardian checks in `rename_family` (lines ~166–179) and `remove_family_member` (lines ~197–210). | Both copies are the same `select(FamilyRole.id).join(FamilyMembership...).where(party_id, GUARDIAN, to_family_id, valid_to IS NULL)` + `if guardian is None: raise AccessDeniedException("You do not guard this Family")`. One copy uses `family_id`, the other `cast(int, family.id)` — same value. Factor to one function taking the id; call sites unchanged in effect. Verified by `test_families.py` guardian-authz tests. |
| b | circulation | Extract `_load_reservation_for_transition(db, reservation_id)` — the identical 3-line load-and-status-context preamble shared by `confirm_reservation` / `cancel_reservation` / `fulfill_reservation` (`reservation = await get_reservation(...)`; `item = await get_item(db, reservation.item_id)`; `holder_user_id = await _current_holder_user_id(db, item)`). | The per-transition *status guard* (`if reservation.status != PENDING` etc.) differs and stays in each caller. Only the common load lines factor out. No commit/flush in the helper. Returns `(reservation, item, holder_user_id)`. |
| c | core | Relocate `Requirement`, `MatrixEntry`, `_methods`, `_RawEntry`, `_RAW_MATRIX`, `AUTHORIZATION_MATRIX`, `resolve_requirement` verbatim to new `app/core/authorization_matrix.py` (exact rows, exact evaluation order). Update the one test import. | Zero `app/` callers of the matrix (only the test). No re-export shim in the `auth_deps` facade (D6). `re` import moves with it. |
| d | groups | Delete `end_group_role` (lines ~177–206) after re-verifying 0 callers. | Dead code. Grep `end_group_role` across `app/` + `tests/` must return only the definition. |
| e | groups | Replace single `groups/router.py` with `groups/router/` package; `__init__.py` assembles `router` from sub-routers in explicit registration order. | Route paths, methods, `response_model`, `status_code`, and dependencies unchanged per handler. Registration order preserved (guard comment + optional ordering test). `main.py` imports the same `router` object from the same `app.groups.router` path. |

---

## Architecture Approach

### Convention applied to all four verticals

- **`domain/`** — pure rules only: constants, pure predicates / value functions that are *already standalone* in the source. No `db`, no cross-context imports, no ORM queries. Kept deliberately thin this pass (D2 forbids extracting inline logic on untested paths).
- **`application/`** — former `service.py` orchestration, one module per aggregate / use-case cluster. **Keeps every existing `db.commit()` / `db.flush()` call exactly where it is today** (D1). Calls `infrastructure/` for queries and cross-context, `domain/` for pure rules.
- **`infrastructure/repository.py`** — every `select()` / `db.get()` / query construction + eager-loading option, relocated verbatim into named functions. **Never commits or flushes.**
- **`infrastructure/*_acl.py`** — the only modules importing another vertical's `service`. Thin pass-through wrappers.
- **`_require_*` ownership checks** stay co-located with the mutation they guard (moved into the same `application/` module, not a separate `authz.py`) — per `standards/backend/security.md` and `standards/global/minimal-implementation.md`.
- **Flat `service.py` / `auth_deps.py` facade** at the historical import path — re-exports every symbol currently importable there, with `__all__`. Facade is a **module**, not a `service/__init__.py` package (D4).
- **`models.py` and `schemas.py` stay at their current paths, untouched** — both are cross-slice / test import targets. `groups/schemas.py` keeps `from app.circulation.models import ItemCondition` (D8).
- Every new module: `from __future__ import annotations`, functional style, `ruff` (E,F,I,UP,B,SIM) + `ruff format` double-quote clean, `mypy --strict` clean, empty `__init__.py` per subpackage (matching `footprint/`).

### Transaction ownership (D1 — critical)

"Full DDD" here means the **layer structure**, NOT single-transaction-per-use-case. Preserve verbatim, in the `application/` module the function lands in:
- the trailing `db.commit()` in `fulfill_pledge`,
- the `db.commit()` *inside* `register_item` and *inside* `create_reservation`,
- `get_account_balance`'s `db.commit()` in a getter (line 265),
- `merge_anonymous_profile`'s `pg_advisory_xact_lock` (line 968),
- every `await db.flush()` where it currently sits.

`domain/` and `infrastructure/repository.py` **never** commit or flush.

---

## Vertical 1 — `core/auth_deps` (layered split behind flat facade)

### Target file tree

```
app/core/
  authorization_matrix.py     # NEW — relocated matrix (edit c)
  auth_deps.py                # FLAT FACADE — re-exports the 6 preserved symbols
  auth_deps/
    __init__.py               # empty
    token.py                  # _BEARER_PREFIX, _extract_token
    principal.py              # Principal, AuthenticationRequiredException,
                              #   get_current_principal, OptionalPrincipal
    dependencies.py           # require_any
    exception_handlers.py     # _unauthorized_envelope, authentication_required_handler,
                              #   register_auth_exception_handlers
```

> Note: `auth_deps.py` (flat facade module) and `auth_deps/` (package dir) cannot co-exist in Python. Resolve by making the facade `auth_deps/__init__.py` OR by naming the split package `_auth/` and keeping `auth_deps.py` flat. **Decision: split package is `app/core/_auth/` (private), facade stays `app/core/auth_deps.py` flat** — matches D4 ("flat facade module with flat siblings" reading) and keeps the public name a module. Final tree:

```
app/core/
  authorization_matrix.py     # NEW
  auth_deps.py                # FLAT FACADE
  _auth/
    __init__.py               # empty
    token.py
    principal.py
    dependencies.py
    exception_handlers.py
```

### Move-map

| Source (`core/auth_deps.py`) | Target |
|---|---|
| `_BEARER_PREFIX`, `_extract_token` | `_auth/token.py` |
| `Principal`, `AuthenticationRequiredException`, `get_current_principal`, `OptionalPrincipal` | `_auth/principal.py` |
| `require_any` | `_auth/dependencies.py` (imports `Principal`, `AuthenticationRequiredException` from `.principal`; `AccessDeniedException` from `app.core.errors`) |
| `_unauthorized_envelope`, `authentication_required_handler`, `register_auth_exception_handlers` | `_auth/exception_handlers.py` (imports `AuthenticationRequiredException` from `.principal`, `ErrorResponse` from `app.core.errors`) |
| `Requirement`, `MatrixEntry`, `_methods`, `_RawEntry`, `_RAW_MATRIX`, `AUTHORIZATION_MATRIX`, `resolve_requirement`, `import re` | `core/authorization_matrix.py` (NEW) |
| module docstring | split: matrix-related paragraph → `authorization_matrix.py`; the rest → `auth_deps.py` facade |

### Facade contents (`app/core/auth_deps.py`)

```
from app.core._auth.principal import (
    AuthenticationRequiredException, OptionalPrincipal, Principal, get_current_principal,
)
from app.core._auth.dependencies import require_any
from app.core._auth.exception_handlers import register_auth_exception_handlers

__all__ = [
    "Principal", "require_any", "OptionalPrincipal", "get_current_principal",
    "AuthenticationRequiredException", "register_auth_exception_handlers",
]
```
No re-export of matrix symbols (D6).

### Untouched

`app.config.settings`, `app.core.security.decode_token`, `app.core.errors` — unchanged. `main.py` line 29 (`from app.core.auth_deps import register_auth_exception_handlers`) — unchanged, satisfied by facade. Every business router's `from app.core.auth_deps import Principal, require_any` — unchanged. `users/service.py:14` `from app.core.auth_deps import Principal` — unchanged.

### Verification after this step

```
cd src/backend
uv run pytest              # expect: same pass count as baseline, 0 new failures
uv run ruff check .        # expect: no new findings
uv run ruff format --check .
uv run mypy .              # expect: clean (same as baseline)
```
Grep checks (all must return the import line, proving the path still resolves):
```
grep -rn "from app.core.auth_deps import" app tests    # every hit still valid via facade
grep -rn "from app.core.authorization_matrix import" tests   # exactly 1 (test_authorization_matrix.py)
grep -rn "resolve_requirement\|AUTHORIZATION_MATRIX" app/core/auth_deps.py   # 0 hits
```

### Behavior-preservation checklist

- [ ] `Principal`, `require_any`, `OptionalPrincipal`, `get_current_principal`, `AuthenticationRequiredException`, `register_auth_exception_handlers` all importable from `app.core.auth_deps`.
- [ ] `resolve_requirement` + matrix symbols importable from `app.core.authorization_matrix`; `test_authorization_matrix.py` updated and green.
- [ ] `_RAW_MATRIX` rows byte-identical, same order (diff the tuple).
- [ ] `_extract_token` form/query/header fallback order unchanged.
- [ ] 401 envelope (`_unauthorized_envelope`) field order + values unchanged.
- [ ] `test_login.py`, `test_authorization_matrix.py`, `test_registration.py` green.

---

## Vertical 2 — `families` (layered split behind flat facade)

### Target file tree

```
app/families/
  service.py            # FLAT FACADE — re-exports all 13 router-consumed symbols
  bootstrap.py          # bootstrap_family_for_party, create_family, create_own_family
  repository.py         # get_family, list_families_for_guardian_party, count_active_child_members,
                        #   list_guardian_memberships, list_group_memberships_for_family
  guardians.py          # add_guardian, build_guardian_responses, rename_family,
                        #   remove_family_member, _require_family_guardian (NEW — edit a)
  members.py            # create_lightweight_family_member, create_lightweight_members_batch
  primary_contact.py    # make_primary_contact
  models.py schemas.py router.py   # unchanged
```

No `domain/`/`application/`/`infrastructure/` triad (depth = layered per Q2).

### Move-map

| Source (`families/service.py`) | Target | Notes |
|---|---|---|
| `bootstrap_family_for_party` | `bootstrap.py` | verbatim |
| `create_family` | `bootstrap.py` | keeps its `db.commit()` |
| `create_own_family` | `bootstrap.py` | keeps its `db.commit()` |
| `get_family` | `repository.py` | `db.get` — no commit |
| `list_families_for_guardian_party` | `repository.py` | |
| `count_active_child_members` | `repository.py` | aggregate query |
| `list_guardian_memberships` | `repository.py` | |
| `list_group_memberships_for_family` | `repository.py` | calls `list_memberships_for_party` from `app.groups.service` — keep that cross-slice import here (it is a read, one-directional; not worth an ACL this pass) |
| `add_guardian` | `guardians.py` | keeps `db.commit()` |
| `build_guardian_responses` | `guardians.py` | |
| `rename_family` | `guardians.py` | keeps `db.commit()`; guardian check → `_require_family_guardian` |
| `remove_family_member` | `guardians.py` | keeps `db.commit()`; guardian check → `_require_family_guardian`; last-guardian 409 guard stays inline |
| `_require_family_guardian` (NEW) | `guardians.py` | edit (a) — verbatim body of the deduped check, takes `family_id: int` |
| `create_lightweight_family_member` | `members.py` | flush only |
| `create_lightweight_members_batch` | `members.py` | keeps `db.commit()` |
| `make_primary_contact` | `primary_contact.py` | keeps `db.commit()`; close-row/open-replacement temporal logic verbatim |

`repository.py` imports needed by `bootstrap.py`/`guardians.py`/`members.py`: `get_family`, `list_families_for_guardian_party` (used by `create_own_family`, `create_lightweight_members_batch`). Watch for a cycle: `bootstrap.py` needs `repository.list_families_for_guardian_party`; `repository.py` needs nothing from `bootstrap.py` → DAG, fine.

### Facade contents (`app/families/service.py`)

Re-export exactly (router-consumed): `create_family`, `list_guardian_memberships`, `build_guardian_responses`, `list_families_for_guardian_party`, `count_active_child_members`, `create_own_family`, `rename_family`, `create_lightweight_members_batch`, `add_guardian`, `make_primary_contact`, `get_family`, `remove_family_member`, `list_group_memberships_for_family`. Plus `bootstrap_family_for_party` (keep exported — historically public, cheap to preserve). `__all__` lists all of them. Keep the module docstring's "ownership checks live here" note.

### Untouched

`families/router.py` — `from . import service` + `from app.groups.service import build_membership_responses` + `from app.groups.schemas import MembershipResponse` unchanged. `families/models.py`, `families/schemas.py` unchanged. `test_families.py`, `test_lightweight_family_members.py`, `test_my_attendances.py` — import only `app.families.models` → unchanged.

### Verification after this step

```
cd src/backend
uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy .
```
Grep:
```
grep -rn "from app.families.service import\|from app.families import service\|from . import service" app tests
# families/router.py hit still valid via facade
grep -c "_require_family_guardian" app/families/guardians.py    # 3  (1 def + 2 calls)
grep -rn "You do not guard this Family" app/families/           # exactly 1 (inside the helper)
```

### Behavior-preservation checklist

- [ ] All 13 router symbols + `bootstrap_family_for_party` importable from `app.families.service`.
- [ ] `_require_family_guardian` raises `AccessDeniedException("You do not guard this Family")` — same message, same type.
- [ ] `rename_family` / `remove_family_member` behavior identical (guardian required; last-active-guardian 409 preserved in `remove_family_member`).
- [ ] `make_primary_contact` still: no-op when already primary+open; else close current primary + add demoted row + close new + add replacement, all dated today, single `db.commit()`.
- [ ] `create_lightweight_family_member` still flushes (no commit); batch owns the commit.
- [ ] `test_families.py` (13), `test_lightweight_family_members.py` (6), `test_my_attendances.py` (6), `test_account_merge.py` (6) green.

---

## Vertical 3 — `circulation` (full DDD behind flat facade)

### Target file tree

```
app/circulation/
  router.py                         # unchanged surface
  service.py                        # FLAT FACADE
  models.py  schemas.py             # unchanged
  domain/
    __init__.py                     # empty
    constants.py                    # _EMISSION_ACCOUNT_CODE, _DEFAULT_LEND_DAYS, _POSTED_AMOUNT
    reservation_rules.py            # _require_party_to_reservation (pure), _next_transaction_number (pure)
  application/
    __init__.py                     # empty
    identity.py                     # get_user_id_by_principal
    inventory.py                    # create_inventory, get_inventory, list_inventories,
                                    #   get_or_create_personal_inventory
    inventory_items.py              # register_item, get_item, list_items, get_item_balance,
                                    #   _require_item_owner, update_item, soft_delete_item
    reservations.py                 # create_reservation, create_lend_reservation, create_swap,
                                    #   list_reservations, get_reservation
    reservation_transitions.py      # confirm_reservation, cancel_reservation, fulfill_reservation,
                                    #   _current_holder_user_id, _load_reservation_for_transition (NEW — edit b)
    accounts.py                     # get_account_balance, get_transaction, list_transactions_for_account
  infrastructure/
    __init__.py                     # empty
    repository.py                   # every select()/db.get() for Inventory/Item/Balance/
                                    #   Reservation/Transaction/Account/Entry
    ledger.py                       # post_circulation(db, *, giver_user_id, amount, description)
                                    #   + get_or_create_user_balance_account, _get_emission_account
```

### Scope note on `domain/`

Per D2, the `InventoryBalance` transition field-mutation blocks (the `if reservation_type == LEND: balance.status = ...` cascades in `create_reservation`, `create_swap`, `confirm/cancel/fulfill_reservation`) **stay inline** in their `application/` functions — extracting them is a behavior-risk refactor on untested code and is deferred. `domain/` this pass gets only the two functions that are *already* module-level pure helpers plus the constants.

### Move-map

| Source (`circulation/service.py`) | Target | Commit/flush preserved |
|---|---|---|
| `_EMISSION_ACCOUNT_CODE`, `_DEFAULT_LEND_DAYS`, `_POSTED_AMOUNT` | `domain/constants.py` | n/a |
| `_require_party_to_reservation` | `domain/reservation_rules.py` | n/a (pure) |
| `_next_transaction_number` | `domain/reservation_rules.py` | n/a (pure) |
| `get_user_id_by_principal` | `application/identity.py` | — |
| `create_inventory` | `application/inventory.py` | `db.commit()` |
| `get_inventory` | `application/inventory.py` → delegates query to `repository` | — |
| `list_inventories` | `application/inventory.py` / `repository` | — |
| `get_or_create_personal_inventory` | `application/inventory.py` | `db.flush()` (NOT commit) |
| `register_item` | `application/inventory_items.py` | **`db.flush()` then `db.commit()` — both inside, verbatim** |
| `get_item`, `list_items`, `get_item_balance` | `application/inventory_items.py` / `repository` | — |
| `_require_item_owner` | `application/inventory_items.py` | co-located with update/delete |
| `update_item` | `application/inventory_items.py` | `db.commit()` |
| `soft_delete_item` | `application/inventory_items.py` | `db.commit()` |
| `get_or_create_user_balance_account` | `infrastructure/ledger.py` | `db.flush()` |
| `_get_emission_account` | `infrastructure/ledger.py` | — |
| `get_account_balance` | `application/accounts.py` | **`db.commit()` in the getter — verbatim, do NOT "fix"** (calls `ledger.get_or_create_user_balance_account`) |
| `get_transaction`, `list_transactions_for_account` | `application/accounts.py` / `repository` (eager-load options verbatim) | — |
| `create_reservation` | `application/reservations.py` | **`db.commit()` inside — verbatim**; eligibility `required_status` expr + balance mutations stay inline |
| `create_lend_reservation` | `application/reservations.py` | delegates to `create_reservation` |
| `create_swap` | `application/reservations.py` | `db.flush()` + `db.commit()` verbatim; balance mutations inline |
| `get_reservation`, `list_reservations` | `application/reservations.py` / `repository` | — |
| `_current_holder_user_id` | `application/reservation_transitions.py` (query → `repository`) | — |
| `_load_reservation_for_transition` (NEW) | `application/reservation_transitions.py` | edit (b) — no commit/flush |
| `confirm_reservation`, `cancel_reservation`, `fulfill_reservation` | `application/reservation_transitions.py` | each keeps its `db.commit()`; per-type status guard + balance mutations inline; `fulfill` calls `ledger.post_circulation(...)` |
| `_post_circulation_transaction` | becomes `infrastructure/ledger.post_circulation` (rename of the private fn to the documented public port name) | `db.flush()` inside — verbatim |

**`post_circulation` port**: `infrastructure/ledger.py` exposes `async def post_circulation(db, *, giver_user_id, amount, description) -> CirculationTransaction` — this is exactly today's `_post_circulation_transaction` signature and body, just renamed and relocated. Plain async function, **no `Protocol` class** (D7). `fulfill_reservation` calls `ledger.post_circulation(db, giver_user_id=holder_user_id, amount=_POSTED_AMOUNT, description=description)` — same args as today.

### Repository module

`infrastructure/repository.py` collects, verbatim, every `select()` / `db.get()` currently in `circulation/service.py`: the `Inventory` lookups, `InventoryItem` get/list (including the `deleted_at` filter), `InventoryBalance` by item, `Account` by code, `CirculationEntry` by account, `CirculationTransaction` with `selectinload(...).joinedload(...)` options (verbatim), `Reservation` get/list, `_current_holder_user_id`'s fulfilled-history query (verbatim ordering `reserved_at.desc(), id.desc()`). Each becomes a named `async def` returning the ORM object(s). **No commit/flush.** `EntityNotFoundException` raising can stay in the `application/` getter wrappers OR move with the query — keep it wherever it is today to minimize diff (getters like `get_item` raise; keep the raise in `application/inventory_items.get_item`, repository just runs the query).

### Facade contents (`app/circulation/service.py`)

Re-export (router-consumed): `get_user_id_by_principal`, `create_inventory`, `list_inventories`, `get_inventory`, `register_item`, `list_items`, `get_item`, `update_item`, `soft_delete_item`, `get_item_balance`, `create_reservation`, `create_swap`, `list_reservations`, `get_reservation`, `confirm_reservation`, `cancel_reservation`, `fulfill_reservation`, `get_account_balance`, `list_transactions_for_account`, `get_transaction`.
Plus groups-consumed (already in the list): `get_or_create_personal_inventory`, `register_item`, `create_lend_reservation`, `get_reservation`.
`__all__` lists all. Keep the module docstring (posting rule / holder-credit explanation) on the facade or move to `infrastructure/ledger.py` — prefer `ledger.py` for the accounting paragraph, keep a short pointer on the facade.

### Untouched

`circulation/router.py` — `from . import service` unchanged; all `service.X` calls resolve via facade. `circulation/models.py`, `circulation/schemas.py` unchanged. `groups/service.py`'s `from app.circulation import service as circulation_service` unchanged (facade). `groups/schemas.py`'s `from app.circulation.models import ItemCondition` unchanged (D8). `test_circulation.py` imports `app.circulation.models` only → unchanged. `product_service.get_product` calls (3 sites in `inventory_items.py` / `reservation_transitions.py`) stay as direct `from app.product import service as product_service` imports — clean one-directional functional dep, no ACL this pass.

### Verification after this step

```
cd src/backend
uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy .
```
Grep:
```
grep -rn "from app.circulation import service\|from app.circulation.service import" app tests
# groups/service.py + circulation/router.py hits still valid
grep -rn "get_or_create_personal_inventory\|create_lend_reservation" app/groups   # still resolves via circulation_service
grep -n "db.commit\|db.flush" app/circulation/application/*.py app/circulation/infrastructure/ledger.py
# count + locations MUST match the pre-refactor count in service.py (15 commits per Phase 1);
# repository.py: 0 hits
grep -rn "db.commit\|db.flush" app/circulation/infrastructure/repository.py app/circulation/domain/   # 0
```
Manual diff check: `git show` the commit and confirm every moved function body is identical (whitespace/import aside).

### Behavior-preservation checklist

- [ ] All 20 router symbols + 4 groups symbols importable from `app.circulation.service`.
- [ ] `db.commit()`/`db.flush()` count and call-sites identical to pre-refactor (`register_item`: flush+commit; `create_reservation`: commit; `create_swap`: flush+commit; `get_account_balance`: commit; `get_or_create_personal_inventory`: flush only; `confirm/cancel/fulfill`: commit each).
- [ ] `domain/` + `infrastructure/repository.py` contain zero commit/flush.
- [ ] `post_circulation` signature = `(db, *, giver_user_id, amount, description)`; body identical to old `_post_circulation_transaction`; still the ONLY place a `CirculationTransaction` is created.
- [ ] `_current_holder_user_id` fulfilled-history query ordering unchanged (`reserved_at.desc(), id.desc()`), LEND-recipient-vs-owner branch unchanged.
- [ ] `_require_party_to_reservation` still raises `AccessDeniedException` when actor is neither `reserved_by_user_id` nor holder.
- [ ] `fulfill_reservation` per-type branch (LEND / RETURN / SWAP+GIFT) balance mutations byte-identical; `_DEFAULT_LEND_DAYS` fallback unchanged.
- [ ] `_load_reservation_for_transition` returns `(reservation, item, holder_user_id)`; each caller's own status guard unchanged.
- [ ] `test_circulation.py` (11), `test_product_resolution.py` (4) green.

---

## Vertical 4a — `groups` service (full DDD behind flat facade)

### Target file tree

```
app/groups/
  service.py                        # FLAT FACADE (~35 re-exports)
  models.py  schemas.py             # unchanged
  domain/
    __init__.py                     # empty
    organizer_slug.py               # _fallback_organizer_slug (pure blake2s)
  application/
    __init__.py                     # empty
    circles.py                      # create_circle, get_own_circle, create_own_circle,
                                    #   list_groups, get_group, update_group
    group_roles.py                  # get_or_create_active_group_role
    leaderships.py                  # assign_leadership, remove_leadership, get_current_leadership,
                                    #   list_leaderships, list_active_leaderships_for_party,
                                    #   build_leadership_responses, _group_role_party_id,
                                    #   _require_active_organizer
    memberships.py                  # create_membership, end_membership, list_memberships_for_circle,
                                    #   list_memberships_for_party, build_membership_responses
    terms.py                        # create_term, get_term, list_terms, update_term,
                                    #   create_needed_item, get_needed_item, list_needed_items,
                                    #   update_needed_item, soft_delete_needed_item,
                                    #   _require_needed_item_organizer, _withdraw_pledge_row
    pledges.py                      # create_pledge, get_pledge, list_pledges, withdraw_pledge,
                                    #   _require_pledging_party
    pledge_fulfillment.py           # fulfill_pledge, sync_pledge_fulfillment
    public_view.py                  # get_public_circle_view, list_my_attendances,
                                    #   list_attendances_for_term, _resolve_organizer
    account_merge.py                # merge_anonymous_profile
  infrastructure/
    __init__.py                     # empty
    repository.py                   # every select()/db.get() for Group/GroupRole/Leadership/
                                    #   Membership/Term/NeededItem/Pledge/TermAttendance/UserProfile-join
    circulation_bridge.py           # ACL — wraps get_or_create_personal_inventory, register_item,
                                    #   create_lend_reservation, get_reservation
    organizations_acl.py            # wraps organizations_service.get_own_organization
    slug_resolver.py                # resolve_organizer_slug (moved verbatim — D3)
```

### Scope notes

- **D3**: `resolve_organizer_slug` → `infrastructure/slug_resolver.py` verbatim (it does a cross-context read via `organizations_acl`). `_resolve_organizer` → `application/public_view.py` (it is attendances-specific). `get_public_circle_view`'s **inline** slug/organizer block stays inline in `public_view.py` — do NOT route it through `slug_resolver` or `_resolve_organizer`. Keep the 500-on-missing-profile behavior in `get_public_circle_view` and the `None`-on-missing-profile behavior in `_resolve_organizer`.
- **domain/** is deliberately one file: only `_fallback_organizer_slug` is a standalone pure function. The leadership-1:N rule, GroupRole standing-capacity rule, pledge state transitions, RSVP idempotency — all inline in their `application/` functions; not extracted (D2, minimal-implementation).
- `_group_role_party_id` and `_require_active_organizer` are used by `circles`, `leaderships`, `terms`, `pledge_fulfillment`. Put them in `leaderships.py` and import where needed. Watch for cycles (see below).

### Move-map (by current section)

| Source section / function | Target |
|---|---|
| `create_circle`, `get_own_circle`, `create_own_circle`, `list_groups`, `get_group`, `update_group` | `application/circles.py` |
| `get_or_create_active_group_role` | `application/group_roles.py` |
| `end_group_role` | **DELETED** (edit d) |
| `_group_role_party_id`, `assign_leadership`, `remove_leadership`, `build_leadership_responses`, `get_current_leadership`, `list_leaderships`, `list_active_leaderships_for_party`, `_require_active_organizer` | `application/leaderships.py` |
| `create_membership`, `end_membership`, `list_memberships_for_circle`, `list_memberships_for_party`, `build_membership_responses` | `application/memberships.py` |
| `create_term`, `get_term`, `list_terms`, `update_term`, `create_needed_item`, `get_needed_item`, `list_needed_items`, `_require_needed_item_organizer`, `update_needed_item`, `_withdraw_pledge_row`, `soft_delete_needed_item` | `application/terms.py` |
| `create_pledge`, `get_pledge`, `list_pledges`, `_require_pledging_party`, `withdraw_pledge` | `application/pledges.py` |
| `fulfill_pledge`, `sync_pledge_fulfillment` | `application/pledge_fulfillment.py` — cross-context calls go through `infrastructure/circulation_bridge`; keeps the single trailing `db.commit()` in each (D1) |
| `list_attendances_for_term`, `_fallback_organizer_slug`, `_resolve_organizer`, `list_my_attendances`, `get_public_circle_view`, `create_rsvp` | `_fallback_organizer_slug` → `domain/organizer_slug.py`; the rest → `application/public_view.py` (`create_rsvp` keeps its `db.flush()` + `db.commit()`) |
| `resolve_organizer_slug` | `infrastructure/slug_resolver.py` |
| `merge_anonymous_profile` | `application/account_merge.py` — keeps `pg_advisory_xact_lock` + `db.commit()` verbatim |
| all inline `select()` / `db.get()` (~20) | `infrastructure/repository.py`, verbatim named functions |

### ACL module contents

`infrastructure/circulation_bridge.py` — the only groups module importing `app.circulation`:
```
from app.circulation import service as circulation_service   # unchanged import string

async def get_or_create_personal_inventory(db, owner_user_id): return await circulation_service.get_or_create_personal_inventory(db, owner_user_id)
async def register_item(db, inventory_id, product_id, condition): return await circulation_service.register_item(db, inventory_id, product_id, condition)
async def create_lend_reservation(db, *, item_id, reserved_by_user_id): return await circulation_service.create_lend_reservation(db, item_id=item_id, reserved_by_user_id=reserved_by_user_id)
async def get_reservation(db, reservation_id): return await circulation_service.get_reservation(db, reservation_id)
```
Also expose `ReservationStatus` (re-import from `app.circulation.models`) so `pledge_fulfillment.py` reads `circulation_bridge.ReservationStatus` instead of importing circulation models directly. `sync_pledge_fulfillment`'s `reservation.status == ReservationStatus.FULFILLED` check unchanged.

`infrastructure/organizations_acl.py`:
```
from app.organizations import service as organizations_service

async def get_own_organization(db, party_id): return await organizations_service.get_own_organization(db, party_id)
```
Used by `slug_resolver.py` and `application/public_view.py`'s `_resolve_organizer`.

### Facade contents (`app/groups/service.py`)

Re-export (router/ + cross-package). Router-consumed: `create_circle`, `resolve_organizer_slug`, `create_own_circle`, `list_groups`, `get_public_circle_view`, `create_rsvp`, `merge_anonymous_profile`, `list_my_attendances`, `update_group`, `get_group`, `get_current_leadership`, `build_leadership_responses`, `list_leaderships`, `list_memberships_for_circle`, `build_membership_responses`, `assign_leadership`, `remove_leadership`, `create_membership`, `end_membership`, `create_term`, `list_terms`, `get_term`, `update_term`, `create_needed_item`, `list_needed_items`, `get_needed_item`, `update_needed_item`, `soft_delete_needed_item`, `create_pledge`, `list_pledges`, `get_pledge`, `withdraw_pledge`, `fulfill_pledge`, `sync_pledge_fulfillment`.
Cross-package (must stay importable — some overlap the above): `list_memberships_for_party`, `build_membership_responses`, `build_leadership_responses`, `list_active_leaderships_for_party`.
`__all__` = union of both sets. Keep the module docstring's authz-lives-here note.

### Import-cycle guard

`application/` modules import each other (e.g. `circles` → `group_roles` + `leaderships`; `terms` → `leaderships` (`_require_active_organizer`, `get_term` used by `pledge_fulfillment`); `pledge_fulfillment` → `pledges` + `terms` + `leaderships` + `circulation_bridge`). Expected dependency direction is acyclic: `group_roles` ← `leaderships` ← `circles`/`memberships`/`terms` ← `pledges` ← `pledge_fulfillment`; `public_view` depends on `leaderships` + `terms` + `slug_resolver`. **If a genuine cycle appears, merge the two offending modules rather than adding `TYPE_CHECKING` hacks or local imports** — record the merge in the work-log. The facade itself imports every `application/` module; that is fine (leaf).

### Untouched

`groups/models.py`, `groups/schemas.py` (incl. the `ItemCondition` import, D8). `groups/router.py` in *this* step (4a) still works against the facade — it does `from . import service` and `service.X`. `families/service.py` + `families/router.py` + `users/router.py` `from app.groups.service import ...` unchanged. `test_groups.py`, `test_rsvp.py`, `test_public_term.py`, `test_account_merge.py`, `test_promotion.py`, `test_my_attendances.py` — import `app.groups.models` / `app.groups.schemas` only → unchanged.

### Verification after this step

```
cd src/backend
uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy .
```
Grep:
```
grep -rn "from app.groups.service import\|from app.groups import service\|from . import service" app tests
grep -rn "import app.circulation\|from app.circulation" app/groups
# ONLY app/groups/infrastructure/circulation_bridge.py  (+ groups/schemas.py's ItemCondition — pre-existing, D8)
grep -rn "import app.organizations\|from app.organizations" app/groups
# ONLY app/groups/infrastructure/organizations_acl.py
grep -rn "end_group_role" app tests                       # 0 hits
grep -rn "db.commit\|db.flush" app/groups/infrastructure/repository.py app/groups/domain/   # 0
grep -n "db.commit\|db.flush" app/groups/application/*.py
# total count MUST equal pre-refactor groups/service.py commit/flush count (22 commits per Phase 1)
```

### Behavior-preservation checklist

- [ ] All ~35 facade symbols importable from `app.groups.service`; the 4 cross-package symbols verified against `families/` + `users/` imports.
- [ ] `end_group_role` gone; grep clean; suite still green (proves it was dead).
- [ ] Only `circulation_bridge.py` imports `app.circulation`; only `organizations_acl.py` imports `app.organizations`.
- [ ] `db.commit()`/`db.flush()` count + locations identical to pre-refactor (`create_circle`, `create_own_circle`, `update_group`, `assign_leadership`, `remove_leadership`, `create_membership`, `end_membership`, `create_term`, `update_term`, `create_needed_item`, `update_needed_item`, `soft_delete_needed_item`, `create_pledge`, `withdraw_pledge`, `fulfill_pledge` (trailing), `sync_pledge_fulfillment` (conditional), `create_rsvp` (flush+commit), `merge_anonymous_profile` (advisory-lock + commit), `get_or_create_active_group_role` (flush)).
- [ ] `fulfill_pledge` saga call order unchanged: `get_or_create_personal_inventory` → `register_item` → `create_lend_reservation` → set `resolved_reservation_id` → `db.commit()`. Mid-saga commits *inside* `register_item`/`create_reservation` still happen (they live in circulation, unchanged).
- [ ] `get_public_circle_view` still 500s when the organizer party has no `UserProfile` (unguarded `get_profile_by_party` inline — D3); `_resolve_organizer` still returns `None` for the same case.
- [ ] `resolve_organizer_slug` never returns `None`; `_fallback_organizer_slug` blake2s digest_size=6, `"k-"` prefix unchanged.
- [ ] `merge_anonymous_profile` advisory-lock line (`select(func.pg_advisory_xact_lock(func.hashtext(email)))`) verbatim, same position (before the duplicate-email check).
- [ ] `test_groups.py` (23), `test_rsvp.py` (7), `test_public_term.py` (9), `test_account_merge.py` (6), `test_my_attendances.py` (6), `test_promotion.py` (2) green.

---

## Vertical 4b — `groups/router/` package

### Target file tree

```
app/groups/router/
  __init__.py           # assembles `router = APIRouter(tags=["groups"])`, registers sub-routers
                        #   in explicit order with a route-ordering guard comment
  circles.py            # /api/groups, /api/groups/mine, GET /api/groups,
                        #   GET /api/groups/public/{id}, POST /api/groups/public/{id}/rsvp,
                        #   POST /api/groups/public/merge, GET /api/groups/mine/attendances,
                        #   PATCH /api/groups/{group_id}, GET /api/groups/{group_id},
                        #   GET /api/groups/{group_id}/leadership, /leaderships, /memberships
  leaderships.py        # POST /api/leaderships, POST /api/leaderships/{id}/end
  memberships.py        # POST /api/memberships, POST /api/memberships/{id}/end
  terms.py             # /api/terms*, /api/needed-items*
  pledges.py           # /api/pledges*
```

### Approach

- Each sub-module defines its own `router = APIRouter(tags=["groups"])` and the three local aliases (`DbSession`, `ReadPrincipal`, `EditPrincipal`), then declares its handlers **verbatim** (bodies unchanged — same `service.X` calls, same `response_model`, `status_code`, `Depends`).
- `__init__.py`:
  ```
  from fastapi import APIRouter
  from . import circles, leaderships, memberships, terms, pledges
  router = APIRouter()
  # Registration order is load-bearing: circles.py's routes must be included first so that
  # /api/groups/mine/attendances and /api/groups/public/{id} and PATCH /api/groups/{id}
  # register before GET /api/groups/{group_id} (FastAPI matches in registration order).
  router.include_router(circles.router)
  router.include_router(leaderships.router)
  router.include_router(memberships.router)
  router.include_router(terms.router)
  router.include_router(pledges.router)
  ```
- **Within `circles.py`, preserve the current top-to-bottom route declaration order verbatim** — this is where the `/mine` + `/public` + `PATCH {id}` before `GET {id}` ordering lives.
- `app.groups.router` must still expose `router` (the `__init__.py` does). `main.py`'s `from app.groups.router import router` (or `from app.groups import router`) — verify which form `main.py` uses and keep it resolving to the same object.

### Optional guard test

A tiny `tests/test_groups_route_order.py` asserting the app resolves `GET /api/groups/mine/attendances` to `list_my_attendances` (not `get_group`) and `GET /api/groups/public/1` to `get_public_circle`. **Optional** (D5) — add only if cheap; not required by D2.

### Untouched

`groups/service.py` facade (from 4a), `groups/schemas.py`, `groups/models.py`. `main.py` `include_router` order.

### Verification after this step

```
cd src/backend
uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy .
```
Route dump check (before vs after must be identical):
```
uv run python -c "from app.main import app; [print(f'{sorted(r.methods)} {r.path} -> {r.name}') for r in app.routes if hasattr(r,'methods')]" > /tmp/routes_after.txt
diff /tmp/routes_before.txt /tmp/routes_after.txt      # expect: no differences (capture _before.txt at step 0)
```
Grep:
```
grep -rn "from app.groups.router import\|from app.groups import router" app main.py   # unchanged
```

### Behavior-preservation checklist

- [ ] Full route dump (method + path + name + `response_model` + status_code + dependencies) byte-identical to baseline.
- [ ] `/api/groups/mine/attendances`, `/api/groups/public/{id}`, `/api/groups/public/{id}/rsvp`, `/api/groups/public/merge` resolve to their own handlers, not `get_group`/`create_circle`.
- [ ] `PATCH /api/groups/{id}` and `GET /api/groups/{id}` both resolve correctly.
- [ ] `app.groups.router.router` is the object `main.py` includes; `main.py` unchanged.
- [ ] `test_groups.py`, `test_rsvp.py`, `test_public_term.py` green (they exercise every route).

---

## Step Sequence & Ordering

| Step | Work | Depends on | Commit message (suggested) |
|---|---|---|---|
| 0 | Confirm baseline: `uv run pytest` green, record pass count; capture `routes_before.txt` | — | (no commit) |
| 1 | `core/auth_deps` split + `authorization_matrix.py` + test import update | 0 | `refactor(core): split auth_deps into _auth/ modules, relocate authorization matrix` |
| 2 | `families` split + `_require_family_guardian` dedup + facade | 0 (parallel with 1) | `refactor(families): split service into cohesive modules behind facade` |
| 3 | `circulation` full DDD + `ledger.post_circulation` + `_load_reservation_for_transition` + facade | 0 | `refactor(circulation): domain/application/infrastructure layers behind service facade` |
| 4a | `groups` service full DDD + ACL modules + `slug_resolver` + delete `end_group_role` + facade | 3 | `refactor(groups): domain/application/infrastructure layers, ACL modules, drop dead end_group_role` |
| 4b | `groups/router/` package split by resource | 4a | `refactor(groups): split router into router/ package by resource` |

Steps 1 and 2 touch disjoint files (`core/` vs `families/`) — safe to do in either order / interleaved. Step 3 before 4a (groups consumes the circulation facade; shared D1 pattern settled on the smaller body first). `families` (step 2) imports `app.groups.service` symbols — since step 4a only *adds* a facade at the same path with the same symbols, no `families` rebase needed; still, do 2 before 4a.

Optionally split step 3 and 4a internally, committing + running the suite after each sub-move: (i) `infrastructure/repository.py` extraction; (ii) `infrastructure/*_acl.py` + `slug_resolver`; (iii) `domain/` extraction; (iv) `application/` split; (v) facade + delete old body. More commits = finer rollback granularity.

---

## Global Regression Gate (run after EVERY commit)

```
cd src/backend
uv run pytest                    # ~113 tests, TestContainers + Docker Postgres 18 — must be green
uv run ruff check .              # no new findings vs baseline
uv run ruff format --check .     # clean
uv run mypy .                    # clean (strict) vs baseline
```
A commit that reddens the suite, adds a ruff finding, or breaks mypy is **reverted or fixed before proceeding** — never left on `main`.

---

## Standards Compliance

| Standard | How this spec complies |
|---|---|
| `standards/global/minimal-implementation.md` | No speculative abstraction: `domain/` layers stay thin (only already-pure code moves); `ledger` port is a plain function not a `Protocol` (D7); no `authz.py` split (checks stay co-located); ACL modules are minimal pass-throughs; dead `end_group_role` deleted. |
| `standards/backend/security.md` | `_require_*` ownership checks (`_require_active_organizer`, `_require_needed_item_organizer`, `_require_pledging_party`, `_require_item_owner`, `_require_family_guardian`, `_require_party_to_reservation`) stay co-located with the mutations they guard in `application/`. `AUTHORIZATION_MATRIX` relocated verbatim — exact rows, exact first-match evaluation order. `require_any` dependency pattern untouched. |
| `standards/backend/models.md` / `queries.md` | Eager-loading options (`selectinload`/`joinedload`) move verbatim into `infrastructure/repository.py`; no implicit lazy-load introduced; `lazy="raise"` contract preserved. Repositories never commit/flush. |
| `standards/global/conventions.md` / `coding-style.md` | Predictable structure modeled on `footprint/`; `from __future__ import annotations` everywhere; functional services; empty `__init__.py`; `ruff` + `ruff format` + `mypy --strict` clean. |
| `standards/backend/migrations.md` | N/A — zero schema / Alembic changes. |
| `project/architecture.md` | Microkernel vertical-slice layout preserved; each vertical still exports `router` at a stable path; `main.py` composition root unchanged. |

Standards-evolution note (suggest to user, do not apply): after this refactor, `repository.py` / `application/` / `infrastructure/*_acl.py` become a repeatable per-vertical pattern worth documenting as a backend standard — candidate for `/maister:standards-update`.

---

## Success Criteria

1. `uv run pytest` from `src/backend` green (same pass count as baseline) after every one of the 5 commits.
2. `ruff check` + `ruff format --check` + `mypy --strict` clean after every commit.
3. Full FastAPI route dump (method, path, name, `response_model`, `status_code`, dependencies) byte-identical before and after.
4. Every preserved import path in the target-state-plan "Preserved Surfaces Checklist" still resolves (grep-verified per step).
5. `db.commit()` / `db.flush()` call count and call-sites unchanged per vertical; `domain/` and `repository.py` contain none.
6. No file in scope exceeds ~250 lines after the split (soft target; `footprint/` modules are 130–250).
7. Only `groups/infrastructure/circulation_bridge.py` imports `app.circulation`; only `groups/infrastructure/organizations_acl.py` imports `app.organizations` (plus the pre-existing `groups/schemas.py` `ItemCondition` import, D8).
8. `end_group_role` removed; grep-clean; suite still green.
9. `git log` shows one focused commit per step; each independently `git revert`-able.
10. Work-log records: the D3 divergence left in place, the deferred `balance_state_machine.py` extraction, any `application/` module merges forced by import cycles, and any behavior/perf issues noticed-but-not-fixed.

---

## Known Limitations

- **No automated guard for the highest-risk paths** (D2): reservation confirm/cancel/fulfill/swap, `_current_holder_user_id`, double-entry posting, `get_account_balance`, `POST /api/pledges/{id}/fulfill` + `/sync`. Mitigation = strict verbatim moves + `mypy --strict` + `ruff` + full suite after every commit + the per-vertical behavior-preservation checklists + manual `git show` diff review of each moved body.
- **`groups/domain/` and `circulation/domain/` are thin** — the inline state-machine / policy logic is not extracted this pass. This is a deliberate D2 trade-off; the folders exist for structure and future extraction.
- **The triplicated organizer-slug resolution and its 500-vs-`None` divergence persist** (D3) — three copies, moved as-is.
