# Target-State Plan — Backend Service Refactor (Phase 2: Gap Analysis)

**Date**: 2026-09-10
**Migration type**: architecture (structural decomposition; no behavior change)
**In scope**: `groups`, `circulation`, `families`, `core/auth_deps`
**Deferred**: `oauth2/`, `plugin/`
**Reference template**: `app/footprint/` (`domain/ engine/ archetype/ audit/ export/ ports.py facade.py`)

---

## Summary

| Factor | Value |
|---|---|
| Migration type | architecture / structural refactor |
| Risk level (overall) | Medium-High |
| Effort estimate | High (groups) + Medium (circulation) + Low-Medium (families, auth_deps) |
| New DB entities | none |
| New Alembic migrations | none |
| Schema / wire-format changes | none intended |
| New Python modules | ~30–40 across 4 verticals |
| Cross-slice call-site rewrites | none (re-export facades absorb every split) |
| Test files needing edits | 1 (`tests/test_authorization_matrix.py`, one import line) — decision D6 |

The seams are pre-drawn by `# --- Title ---` banners and `footprint/` is a working in-repo target. The dominant risks are **not** behaviour regression for the well-covered CRUD surface, but:

1. **Coverage blind spot** — the circulation reservation state machine, double-entry posting, and the `fulfill_pledge` cross-context saga have effectively **zero** HTTP test coverage, yet they are exactly where `domain/` + `application/` + `infrastructure/ledger` abstractions get layered in (decision D2).
2. **Transaction-ownership vs "full DDD"** — the reservation/pledge paths commit at multiple points today (including *inside* `register_item` and `create_reservation`). A textbook one-transaction-per-use-case `application/` layer would shift those boundaries = behaviour change in partial-failure semantics (decision D1).
3. **groups triplicated organizer-slug resolution** diverges at the edges (unguarded `get_profile_by_party` in `get_public_circle_view` → 500; guarded in `_resolve_organizer` → `None`); consolidating is behaviour-affecting (decision D3).
4. Import-graph fragility (module-alias cross-slice imports, `groups/schemas.py` → `app.circulation.models.ItemCondition`) — mitigated by facades.

---

## Task Characteristics (detected)

| Field | Value | Note |
|---|---|---|
| `has_reproducible_defect` | **false** | pure refactor, no bug report, no failing test |
| `modifies_existing_code` | **true** | 4 verticals restructured in place |
| `creates_new_entities` | **false** | no DB entities, no new domain aggregates. ~30–40 new *modules* are created, but these are structural containers for code that already exists, not new "entities" in the DDD-model sense |
| `involves_data_operations` | **false** | no data migration, no schema change, no Alembic revision, no CRUD-lifecycle change |
| `ui_heavy` | **false** | backend only; no `src/frontend` changes |

Active analysis modules: **Existing Feature Analysis** (change type, compatibility) only. Defect / Data-lifecycle / UI modules not applicable.

**Change type**: `refactor-based` (internal structure changes, observable behaviour preserved).
**Compatibility requirements**: `strict` — every public import path, every route, every HTTP response shape, and every existing `db.commit()` boundary must be preserved bit-for-bit. `uv run pytest` (from `src/backend`, ~113 tests) is the gate.

---

## Target State — per vertical

### Convention applied to all four

- New pure/rule code → `domain/` (no `db`, no cross-context imports).
- Former `service.py` orchestration → `application/` (one module per aggregate / use-case cluster; **keeps its current commit points** — see D1).
- All `select()` / `db.get()` / query building + eager loading → `infrastructure/repository.py`.
- Cross-context service calls → `infrastructure/*_acl.py` (the only modules importing another vertical's `service`).
- `_require_*` ownership checks stay **co-located with the mutation they guard** (moved into the same `application/` module, not a separate `authz.py` — that would violate the "structural only, minimal" constraint and the security standard's co-location rule).
- Re-export **facade** at the historical import path so cross-slice importers and tests never change.
- `models.py` and `schemas.py` stay at their current paths untouched (both are cross-slice / test import targets).

---

### 1. `core/auth_deps` — layered split behind facade (depth: layered)

**Current** (`core/auth_deps.py`, 323 lines): token extraction · `Principal` / `get_current_principal` / `OptionalPrincipal` · `require_any` · 401 handler wiring · the entire 25-entry `AUTHORIZATION_MATRIX` + `resolve_requirement` (~155 lines, **zero callers in `app/`**, only `tests/test_authorization_matrix.py`).

**Target**

```
core/
  authorization_matrix.py     # NEW (cleanup #1): Requirement, MatrixEntry, _methods, _RawEntry,
                              #   _RAW_MATRIX, AUTHORIZATION_MATRIX, resolve_requirement — moved verbatim
  auth_deps.py                # FACADE — re-exports: Principal, require_any, OptionalPrincipal,
                              #   get_current_principal, AuthenticationRequiredException,
                              #   register_auth_exception_handlers
  auth_deps/  (alt: flat modules — see D4)
    token.py                  # _BEARER_PREFIX, _extract_token
    principal.py              # Principal, AuthenticationRequiredException, get_current_principal, OptionalPrincipal
    dependencies.py           # require_any
    exception_handlers.py     # _unauthorized_envelope, authentication_required_handler,
                              #   register_auth_exception_handlers
```

**Gaps (create / move)**
- CREATE `core/authorization_matrix.py`; MOVE the matrix block (lines ~169–323) into it verbatim.
- SPLIT the remaining ~168 lines into 4 cohesive modules (token / principal / dependencies / exception_handlers).
- CONVERT `core/auth_deps.py` into a facade (module or `__init__.py` package — D4).
- EDIT `tests/test_authorization_matrix.py` line 12: `from app.core.auth_deps import resolve_requirement` → `from app.core.authorization_matrix import resolve_requirement` (D6).
- `main.py` imports `register_auth_exception_handlers` from `app.core.auth_deps` — preserved by the facade, no change.

**Risk: Low.** Pure move; matrix has a dedicated unit test; `Principal` / `require_any` load-bearing everywhere but the facade keeps every path.

---

### 2. `families` — layered split behind facade (depth: layered)

**Current** (`families/service.py`, 418 lines, 15 functions, no section banners). Cross-package importers: **none** — only `families/router.py` (`build_membership_responses` it imports is from *groups*, not families). Fully free to reorganize.

**Target**

```
families/
  service.py            # FACADE — re-exports everything families/router.py imports
  bootstrap.py          # bootstrap_family_for_party, create_family, create_own_family
  repository.py         # get_family, list_families_for_guardian_party, count_active_child_members,
                        #   list_guardian_memberships, list_group_memberships_for_family
  guardians.py          # add_guardian, build_guardian_responses, rename_family, remove_family_member,
                        #   _require_family_guardian  (NEW — dedup of the verbatim guardian check in
                        #   rename_family + remove_family_member, lines 166–179 / 197–210)
  members.py            # create_lightweight_family_member, create_lightweight_members_batch
  primary_contact.py    # make_primary_contact  (the close-row / open-replacement temporal state machine —
                        #   the clarification explicitly flags this as warranting its own module)
  models.py schemas.py  # unchanged
```

No mandated `domain/`/`application/`/`infrastructure/` triad (depth = layered). `primary_contact.py` and the `_require_family_guardian` extraction are the only non-mechanical touches.

**Gaps (create / move)**
- CREATE 5 sibling modules; MOVE each function group per the map above.
- EXTRACT `_require_family_guardian(db, family_id, caller_party_id)` from the two verbatim copies.
- CONVERT `families/service.py` → facade.
- `families/router.py` keeps `from . import service` + `from app.groups.service import build_membership_responses` unchanged.

**Risk: Low-Medium.** 13 direct `test_families` + 6 `test_lightweight_family_members` + 6 `test_my_attendances`-adjacent. `make_primary_contact` (demote-current + promote-new, 2 new rows) is the one place to move with care. No external consumers.

---

### 3. `circulation` — full DDD / clean architecture (depth: full-ddd)

**Current** (`circulation/service.py`, 569 lines). Cross-package public surface (consumed by `groups/service.py` Pledge bridge): `get_or_create_personal_inventory`, `register_item`, `create_lend_reservation`, `get_reservation`.

**Target**

```
circulation/
  router.py                          # unchanged surface (already thin); handler bodies may move to application/
  service.py                         # FACADE — re-exports the 4 groups-consumed symbols + anything router imports
  models.py  schemas.py              # unchanged — models.py stays the ORM + enum home (ItemCondition etc.
                                     #   stay importable by groups/schemas.py and tests)
  domain/
    balance_state_machine.py         # PURE: (BalanceStatus, ReservationType, transition) -> next status +
                                     #   the field mutations each transition implies (the create/confirm/
                                     #   cancel/fulfill if-elif-else logic, lifted out of the awaits)
    reservation_policy.py            # PURE: start-status eligibility per ReservationType (RETURN<-LENT, else
                                     #   AVAILABLE); _require_party_to_reservation predicate; swap "both AVAILABLE"
    constants.py                     # _DEFAULT_LEND_DAYS, _EMISSION_ACCOUNT_CODE, _POSTED_AMOUNT
  application/
    identity.py                      # get_user_id_by_principal
    inventory.py                     # create_inventory, get_inventory, list_inventories,
                                     #   get_or_create_personal_inventory
    inventory_items.py               # register_item, get_item, list_items, get_item_balance,
                                     #   _require_item_owner, update_item, soft_delete_item
    reservations.py                  # create_reservation, create_lend_reservation, create_swap,
                                     #   list_reservations, get_reservation
    reservation_transitions.py       # confirm_reservation, cancel_reservation, fulfill_reservation
                                     #   + _load_reservation_for_transition (NEW — dedup of the identical
                                     #   5-line load-and-guard preamble); calls domain state machine + ledger
    accounts.py                      # get_account_balance, get_transaction, list_transactions_for_account
                                     #   NOTE: get_account_balance's db.commit() inside a getter (line 265)
                                     #   is EXISTING behavior — move verbatim, do NOT "fix"
  infrastructure/
    repository.py                    # every select()/db.get() for Inventory/Item/Balance/Reservation/Transaction
    ledger.py                        # post_circulation(db, *, giver_user_id, amount, description) = the port;
                                     #   get_or_create_user_balance_account, _get_emission_account,
                                     #   _next_transaction_number, _post_circulation_transaction
                                     #   (accounting subdomain — only inbound edges: 1 call from fulfill,
                                     #   1 from get_account_balance)
```

`ledger.post_circulation` is the "port" as a plain module boundary — no `Protocol` class (functional style, no DI; a Protocol here is over-engineering per the minimal-implementation standard) — see D7. `product_service.get_product` calls (3 sites) stay as direct imports (already a clean one-directional functional dep matching the standard); an ACL wrapper is not worth it this pass.

**Gaps (create / move)**
- CREATE `domain/` (3 modules), `application/` (6 modules), `infrastructure/` (2 modules).
- MOVE every `select()`/`db.get()` into `infrastructure/repository.py`; `application/` calls the repo, not the ORM directly.
- EXTRACT the balance-transition field logic into `domain/balance_state_machine.py`; `application/` applies the returned mutation set.
- EXTRACT `_load_reservation_for_transition`.
- SPLIT the accounting subdomain into `infrastructure/ledger.py` behind `post_circulation(...)`.
- CONVERT `circulation/service.py` → facade re-exporting the 4 symbols.
- `groups/service.py` keeps `from app.circulation import service as circulation_service` unchanged.

**Risk: Medium-High.** `test_circulation.py` (11 tests) covers inventory-item PATCH/DELETE + one `createReservation` 404 — the **reservation lifecycle (confirm/cancel/fulfill/swap), `_current_holder_user_id`, and all double-entry posting are untested** (D2). `get_account_balance` commit-in-getter is a landmine for repository extraction.

---

### 4. `groups` — full DDD / clean architecture (depth: full-ddd)

**Current**: `service.py` 983 · `router.py` 378 · `schemas.py` 258. The coupling hub (imports circulation, organizations, users, party, auth). Cross-package public surface: `list_memberships_for_party`, `build_membership_responses`, `build_leadership_responses`, `list_active_leaderships_for_party` (consumed by `families/service.py`, `families/router.py`, `users/router.py`).

**Target**

```
groups/
  router/                            # router/ package by resource — DECISION D5
    __init__.py                      # assembles `router` APIRouter; sub-router include order preserved,
                                     #   with an explicit comment on the /mine + /public before /{group_id} rule
    circles.py                       # /api/groups (+ /mine, /public/{id}, /public/{id}/rsvp, /public/merge,
                                     #   /mine/attendances, PATCH /{group_id}, GET /{group_id}[/leadership...])
                                     #   route order within the file preserved verbatim
    leaderships.py                   # /api/leaderships*
    memberships.py                   # /api/memberships*
    terms.py                         # /api/terms*, /api/needed-items*
    pledges.py                       # /api/pledges*
  service.py                         # FACADE — re-exports the 4 cross-package symbols + everything router/ uses
  models.py                          # unchanged
  schemas.py                         # unchanged path (imported by families/router, users/router, test_groups:522);
                                     #   keeps `from app.circulation.models import ItemCondition` — D8
  domain/
    leadership_policy.py             # strictly-1:N rule; _require_active_organizer predicate shape
    group_role.py                    # standing-capacity reuse rule (get_or_create_active_group_role invariant)
    pledge_state_machine.py          # OPEN/CLAIMED/WITHDRAWN/FULFILLED transitions; soft-delete guard
                                     #   (blocked if any FULFILLED or resolved_reservation_id set)
    rsvp_policy.py                    # RSVP idempotency per (party, term); term-belongs-to-circle guard
    organizer_slug.py                # _fallback_organizer_slug (pure blake2s) + slug-shape policy
  application/
    circles.py                       # create_circle, get_own_circle, create_own_circle, list_groups,
                                     #   get_group, update_group
    group_roles.py                   # get_or_create_active_group_role
    leaderships.py                   # assign_leadership, remove_leadership, get_current_leadership,
                                     #   list_leaderships, list_active_leaderships_for_party,
                                     #   _group_role_party_id, _require_active_organizer
    memberships.py                   # create_membership, end_membership, list_memberships_for_circle,
                                     #   list_memberships_for_party
    terms.py                         # create/get/list/update_term, create/get/list/update_needed_item,
                                     #   _require_needed_item_organizer, _withdraw_pledge_row,
                                     #   soft_delete_needed_item
    pledges.py                       # create_pledge, get_pledge, list_pledges, _require_pledging_party,
                                     #   withdraw_pledge
    pledge_fulfillment.py            # fulfill_pledge, sync_pledge_fulfillment — the cross-context saga;
                                     #   keeps its current single trailing commit (D1), calls circulation_bridge
    public_view.py                   # get_public_circle_view, list_my_attendances, list_attendances_for_term
    account_merge.py                 # merge_anonymous_profile (keeps pg_advisory_xact_lock verbatim)
    presenters.py                    # build_leadership_responses, build_membership_responses
                                     #   (still return list[dict]; router keeps LeadershipResponse(**row))
  infrastructure/
    repository.py                    # every select()/db.get() for Group/GroupRole/Leadership/Membership/
                                     #   Term/NeededItem/Pledge/TermAttendance/UserProfile-join
    circulation_bridge.py            # ACL — the ONLY module importing app.circulation: wraps
                                     #   get_or_create_personal_inventory, register_item,
                                     #   create_lend_reservation, get_reservation
    organizations_acl.py             # wraps organizations_service.get_own_organization
    slug_resolver.py                 # resolve_organizer_slug + _resolve_organizer — see D3 (move-as-is
                                     #   this pass, do NOT consolidate with get_public_circle_view's inline copy)
```

**Cleanup #2**: DELETE `end_group_role` (lines 177–206) — verified **zero callers** in `app/` and `tests/` (only its own definition matches).

**Gaps (create / move)**
- CREATE `domain/` (5), `application/` (10), `infrastructure/` (4), `router/` (6).
- MOVE ~20 inline queries into `infrastructure/repository.py`.
- MOVE the 3 circulation calls + 1 organizations call behind ACL modules; `application/` imports the ACL, never `app.circulation` / `app.organizations` directly.
- DELETE `end_group_role`.
- CONVERT `groups/service.py` → facade; SPLIT `groups/router.py` → `router/` package preserving registration order.
- `families/service.py`, `families/router.py`, `users/router.py` keep their `from app.groups.service import ...` unchanged (facade).

**Risk: High.** 983-line hub · 5 upstream deps · cross-context saga with **mid-saga commits** (inside `register_item`, `create_reservation`) and no consistency owner · triplicated resolver with divergent edge behaviour · route-ordering constraint · 4 cross-package symbols · schema-layer leak · `fulfill_pledge` / `sync_pledge_fulfillment` **untested end-to-end** (`test_groups` exercises pledge *status* transitions via `deleteNeededItem` only, never the fulfill→reservation→sync path).

---

## Gap List (consolidated)

| # | Vertical | Gap | Kind | Risk |
|---|---|---|---|---|
| G1 | core | `core/authorization_matrix.py` does not exist | create + move | Low |
| G2 | core | `auth_deps.py` is one 323-line module | split (4 modules) + facade | Low |
| G3 | core | 1 test imports `resolve_requirement` from `auth_deps` | edit test import (D6) | Low |
| G4 | families | no module boundaries; guardian-authz duplicated verbatim | split (5 modules) + dedup + facade | Low-Med |
| G5 | families | `make_primary_contact` temporal logic buried | extract to `primary_contact.py` | Low-Med |
| G6 | circulation | no `domain/`/`application/`/`infrastructure/` | create ~11 modules | Med-High |
| G7 | circulation | balance transitions inline in 4 functions, no owner | extract `domain/balance_state_machine.py` | Med-High |
| G8 | circulation | accounting subdomain mixed into service | extract `infrastructure/ledger.py` + `post_circulation` port | Med |
| G9 | circulation | confirm/cancel/fulfill share load-and-guard preamble | extract `_load_reservation_for_transition` | Low |
| G10 | circulation | `service.py` must re-export 4 groups-consumed symbols | facade | Med (import graph) |
| G11 | circulation | reservation lifecycle + ledger + `_current_holder_user_id` untested | write characterization tests (D2) | High if skipped |
| G12 | groups | 983-line hub, 8 sections, ~20 inline queries | full DDD split (~25 modules) | High |
| G13 | groups | `end_group_role` dead code | delete (cleanup #2) | Low |
| G14 | groups | triplicated organizer-slug resolution, divergent edges | move-as-is into `slug_resolver.py` (D3) | Med |
| G15 | groups | `fulfill_pledge` saga: 3 bounded contexts, mid-saga commits, no owner | ACL module + keep commit points verbatim (D1) | High |
| G16 | groups | `router.py` 30 routes, route-order-sensitive | `router/` package (D5) preserving order | Med |
| G17 | groups | `service.py` must re-export 4 cross-package symbols | facade | Med (import graph) |
| G18 | groups | `schemas.py` imports `app.circulation.models.ItemCondition` | leave as accepted debt (D8) | Low |
| G19 | groups | `fulfill_pledge` / `sync_pledge_fulfillment` untested end-to-end | write characterization tests (D2) | High if skipped |

---

## Recommended Migration Strategy

**Delivery**: incremental per-vertical PRs (4–5 PRs). Confirm at planning (D9).

**Ordering (low → high risk)** and **parallelism**:

```
Track A (independent):   auth_deps split ─────────────┐
Track B (independent):   families split ──────────────┤
Track C (sequential):    [D2 char-tests] → circulation → groups
                                                       └──> final: verify full suite green
```

| Step | Vertical | Depends on | Rollback point |
|---|---|---|---|
| 0 | **D2 characterization tests** for reservation lifecycle + ledger + pledge-fulfill/sync (added scope, ~8–12 HTTP tests) | — | merge as its own PR; green suite |
| 1 | **`core/auth_deps`** — matrix relocation + 4-module split + facade | — (parallel with 2) | PR merged, suite green |
| 2 | **`families`** — 5-module split + guardian dedup + `primary_contact.py` + facade | — (parallel with 1) | PR merged, suite green |
| 3 | **`circulation`** — full DDD; settles the D1 transaction-ownership pattern on the smaller body first | step 0 | PR merged, suite green |
| 4 | **`groups`** — full DDD; may be **2 PRs**: (4a) `service.py` → domain/application/infrastructure + facade + delete `end_group_role`; (4b) `router.py` → `router/` package | steps 0, 3 (shares D1 pattern + circulation facade) | after 4a suite green; after 4b suite green |

**Within step 4a**, commit in this order, running `uv run pytest` after each: (i) delete `end_group_role`; (ii) `infrastructure/repository.py` extraction; (iii) `infrastructure/*_acl.py` + `slug_resolver.py`; (iv) `domain/` extraction; (v) `application/` split; (vi) `service.py` facade + delete old body.

**Rollback**: every numbered step is a standalone revertible PR; the pre-work test PR (step 0) stays regardless. No data/schema changes means rollback is a pure `git revert`.

**Parallelization**: steps 1 and 2 touch disjoint files (`core/` vs `families/`) — safe in parallel. Step 3 must precede step 4 (shared transaction-ownership decision + groups consumes the circulation facade). `families` also imports `app.groups.service` symbols, so if step 4 lands first the `families` PR would need a rebase — prefer 2 before 4, or accept a trivial rebase.

---

## Decisions Needed

### Critical

- **D1 — Transaction-ownership semantics under "full DDD".**
  `fulfill_pledge` and the reservation lifecycle commit at multiple points today (a trailing `db.commit()` in `fulfill_pledge`, **plus** `db.commit()` *inside* `register_item` and `create_reservation`). Textbook clean architecture (one transaction per use case, repositories `flush()` only) would move/merge those boundaries → behaviour change in partial-failure semantics, on near-untested code.
  - Options: **(A)** `application/` modules preserve every existing commit point verbatim; "transaction ownership" is documented in docstrings, not enforced; `domain/` and `infrastructure/repository.py` never commit. **(B)** `application/` becomes sole committer; repos flush only (shifts boundaries).
  - **Recommendation: A.** Only A satisfies "no behaviour change"; the clarification already says extracted helpers must not absorb the commit boundary. Confirm the team accepts that "full DDD" here means the layer *structure*, not single-transaction-per-use-case.

- **D2 — Missing test coverage for the highest-risk targets.**
  `test_circulation.py` covers inventory-item PATCH/DELETE and one `createReservation` 404. The reservation state machine (confirm/cancel/fulfill/swap), `_current_holder_user_id`, all double-entry posting, `get_account_balance`, and `POST /api/pledges/{id}/fulfill` + `/sync` have **no** HTTP coverage. The Phase 1 "groups/circulation/families well covered" assessment holds at file granularity but not for these paths.
  - Options: **(A)** write ~8–12 HTTP characterization tests (reservation create→confirm→fulfill, cancel, swap, balance/transaction assertions after fulfill, pledge fulfill→sync happy path) as step 0 before refactoring circulation + groups — added scope. **(B)** proceed on mechanical-move discipline alone.
  - **Recommendation: A.** This is the primary regression net for the two riskiest verticals; its absence is the single biggest threat to "no behaviour change".

- **D3 — groups triplicated organizer-slug resolution: consolidate or move as-is?**
  `resolve_organizer_slug`, `_resolve_organizer`, and the inline block in `get_public_circle_view` diverge: `get_public_circle_view` calls `get_profile_by_party` **unguarded** (500 on a missing organizer profile), `_resolve_organizer` catches `EntityNotFoundException` and returns `None`.
  - Options: **(A)** consolidate into one resolver, explicitly choosing the graceful path — changes the public-view edge case from 500 to 200-with-null. **(B)** move all three into `infrastructure/slug_resolver.py` unchanged; keep `get_public_circle_view`'s inline copy inline; accept the duplication this pass.
  - **Recommendation: B.** Consolidation is a behaviour-affecting change that belongs in its own follow-up, not a "structural only" pass.

### Important

- **D4 — Facade shape: flat `service.py` module vs `service/__init__.py` package** (applies to groups, circulation, and the `core/auth_deps` split).
  - **Recommendation:** flat `service.py` facade module sitting alongside the `domain/` / `application/` / `infrastructure/` subpackages; for core, keep `core/auth_deps.py` as a flat facade module with flat siblings (`core/auth_token.py`, …) **or** turn it into `core/auth_deps/__init__.py`. Prefer whichever the team finds more readable — pick one and apply uniformly.

- **D5 — `groups/router.py` → `router/` package by resource?**
  Route registration order (`/api/groups/mine/...`, `/api/groups/public/...`, `PATCH /{group_id}` before `GET /{group_id}`) must be preserved.
  - Options: **(A)** `router/` package, `__init__.py` assembles sub-routers in explicit order + in-file order comment (matches the depth decision's "router/ package by resource"). **(B)** keep single `router.py`, just thin the handler bodies into `application/`.
  - **Recommendation: A**, with a regression comment (or a tiny test asserting `/mine/attendances` resolves before `/{group_id}`).

- **D6 — `AUTHORIZATION_MATRIX` new location + the one test import.**
  - Options: **(A)** new module `app/core/authorization_matrix.py`; update `tests/test_authorization_matrix.py` line 12 to import `resolve_requirement` from it (test-only, 1 line). **(B)** new module + keep a re-export of `resolve_requirement` in the `auth_deps` facade so the test is untouched.
  - **Recommendation: A** — the matrix is genuinely detached (zero `app/` callers); a re-export shim would imply a coupling that no longer exists.

- **D7 — circulation `ledger` as plain module boundary vs `Protocol` port; `application/` vs `use_cases/` naming.**
  - **Recommendation:** `infrastructure/ledger.py` exposing `post_circulation(db, *, giver_user_id, amount, description)` as a plain function = the port; no `Protocol` class (functional style, no DI, no alternate impl — a Protocol is over-engineering per the minimal-implementation standard). Name the layer `application/` (matches `decisions.depth` text in `orchestrator-state.yml`).

- **D8 — `groups/schemas.py` → `app.circulation.models.ItemCondition` cross-context import.**
  - **Recommendation:** leave as accepted debt this pass. `ItemCondition` values are stable, it is one import, and mirroring it locally risks OpenAPI enum churn and exceeds "structural only". Note in the work log as a candidate for a later linguistic-boundary cleanup.

- **D9 — Confirm delivery as incremental per-vertical PRs** (4–5 PRs: char-tests, auth_deps, families, circulation, groups[×1–2]). Already the recommended default in `orchestrator-state.yml`; confirm at Phase 4 planning.

---

## Preserved Surfaces Checklist (compatibility = strict)

- **Import paths**: `app.core.auth_deps.{Principal, require_any, OptionalPrincipal, get_current_principal, AuthenticationRequiredException, register_auth_exception_handlers}`; `app.groups.service.{list_memberships_for_party, build_membership_responses, build_leadership_responses, list_active_leaderships_for_party}`; `app.circulation.service.{get_or_create_personal_inventory, register_item, create_lend_reservation, get_reservation}`; `app.groups.schemas.*`; `app.circulation.models.*`; each vertical's `router` object.
- **Routes**: every path + method + `response_model` in `groups/router.py`, `circulation/router.py`, `families/router.py` unchanged; `groups` route registration order unchanged; `main.py` `include_router` order unchanged.
- **Commit boundaries**: every existing `db.commit()` / `db.flush()` stays where it is (D1) — including `get_account_balance`'s commit-in-a-getter and `merge_anonymous_profile`'s `pg_advisory_xact_lock`.
- **`AUTHORIZATION_MATRIX`**: 50 rows, exact evaluation order, verbatim.
- **Gate**: `uv run pytest` from `src/backend` stays green at every rollback point.
