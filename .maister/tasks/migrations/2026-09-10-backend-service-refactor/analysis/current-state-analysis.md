# Codebase Analysis Report — Backend Service Refactor (Phase 1: Current-State Analysis)

**Date**: 2026-09-10
**Task**: Split oversized backend files in `src/backend/app` into smaller cohesive modules, moving toward DDD / clean-architecture boundaries. Backend only, no behavior change intended.
**Migration type**: architecture
**Analyzer**: maister:codebase-analyzer (3 Explore agents: File Discovery, Code Analysis / service seams, Context Discovery / coupling + tests)

---

## Summary

The backend is a FastAPI microkernel with ~14 vertical slices following a flat `router/service/schemas/models` convention. Services are **functional** (module-level `async def` taking `db` as first arg — no service classes). Seven files exceed ~290 lines, led by `groups/service.py` (983) which is also the coupling hub (imports circulation, organizations, users, party, auth). Every large file already carries `# --- Title ---` comment banners that map almost 1:1 onto extractable modules, so the seams are pre-drawn. The **`footprint/` vertical is the only one already layered** (`domain/ engine/ archetype/ audit/ export/ ports.py facade.py stubs.py`) and is the de-facto in-repo template for the target structure.

The dominant refactor risk is **not behavior regression** — ~113 HTTP-level integration tests (TestContainers + real PostgreSQL 18) exercise groups/circulation/families/organizations/users well and never import service internals, so internal reshaping is invisible to them. The real risks are: (1) **import-graph breakage** from module-alias cross-slice imports (`from app.circulation import service as circulation_service`), which requires keeping re-exporting facades; (2) **three verticals with zero tests** — `plugin/`, `oauth2/`, `footprint/`; and (3) **transaction-ownership inconsistency** repo-wide (services self-commit ad hoc; 22 commits in groups, 15 in circulation), meaning extracted helpers must not absorb the commit boundary.

---

## Files Identified

### Primary Files (refactor targets, ranked)

**`groups/service.py`** (983 lines) — **highest priority, highest risk**
- 8 comment-delimited sections: Groups/Circle CRUD (l.72), GroupRole (l.149), Leadership 1:N (l.209), Membership N:N (l.313), Term/NeededItem (l.401), Pledge + Pledge→Reservation bridge (l.546), Public circle-view/RSVP (l.639, ~300 lines), Account-merge (l.946).
- Mixes: CRUD for 8 entities, authz/ownership policy (`_require_active_organizer`, `_require_needed_item_organizer`), ~20 inline `select`/`db.get` queries, cross-context service calls, `list[dict]` presenter functions, domain rules (leadership 1:N, GroupRole standing-capacity + end-cascade, pledge state machine, needed-item soft-delete guard, RSVP idempotency, slug policy), transaction orchestration, infra primitives (`blake2s`, `pg_advisory_xact_lock`).
- Cross-package public surface (must stay importable): `list_memberships_for_party`, `build_membership_responses`, `build_leadership_responses`, `list_active_leaderships_for_party`.

**`oauth2/router.py`** (722 lines) — **no `service.py` exists; logic lives in router + `stores.py`**
- DTOs + validation + 3 grant handlers as private funcs (`_authorization_code_grant` l.491, `_refresh_token_grant` l.553, `_token_exchange_grant` l.581), PKCE (`_verify_pkce`), token crypto (`_encode_oauth2_token`), 5 DCR `_validate_*` funcs, 3 near-identical form parsers.
- Endpoints: `/register` l.59, `/authorize` l.194, `/token` l.392, `/introspect` l.668.
- Already built from pure, individually-testable helpers; 3 grants mutually independent; `grant_type` dispatch is a clean seam.
- `validate_authorize_request` step 7 is dead code (unreachable behind `Depends(require_any())`).

**`circulation/service.py`** (569 lines)
- Sections: Identity resolution (l.68), Inventory/InventoryItem (l.83), Accounts (l.235), Reservation lifecycle + `InventoryBalance` state machine (l.304), double-entry posting `_post_circulation_transaction` (l.439).
- Contains a **cleanly separable accounting subdomain** (double-entry points ledger: `get_or_create_user_balance_account`, `_get_emission_account`, `get_account_balance`, `_next_transaction_number`, `_post_circulation_transaction`) — only inbound edges are `_post_circulation_transaction` (1 call) + `get_or_create_user_balance_account`.
- Cross-package public: `get_or_create_personal_inventory`, `register_item`, `create_lend_reservation`, `get_reservation` (all consumed by `groups/service.py` Pledge→Reservation bridge, lines ~611–631).

**`families/service.py`** (418 lines)
- No section comments; 15 functions: bootstrap (`bootstrap_family_for_party`, `create_family`, `create_own_family`), Family CRUD, guardian/member mgmt, queries/aggregates, temporal state machine (`make_primary_contact` = close row + open replacement).
- **Guardian-authz check duplicated verbatim** in `rename_family` and `remove_family_member` (~lines 166–179 and 197–210).
- Cross-package public: **NONE**. Entire module free to reorganize behind `families/router.py`.

**`groups/router.py`** (378 lines)
- ~30 routes for 6 resource families in one `APIRouter`; public (`get_public_circle`, `create_rsvp`, `merge_anonymous_profile`) mixed among EDIT/READ-gated CRUD.
- Principal→party resolution repeated in 6 handlers; `GroupResponse.model_validate` + `resolve_organizer_slug` enrichment duplicated 4x; `LeadershipResponse(**row)` unpacking repeated 5x.
- **RISK: route ordering** — `/api/groups/mine/attendances` and `/api/groups/public/...` must register before `/api/groups/{group_id}`.

**`core/auth_deps.py`** (323 lines)
- Token extraction (`_extract_token` — header/query/form triple fallback), principal resolution (`Principal`, `get_current_principal`, `OptionalPrincipal`), `require_any` factory, exception-handler wiring, **the full `AUTHORIZATION_MATRIX` as data + `resolve_requirement`** (~135 of 323 lines).
- The matrix has **ZERO callers inside `app/`** — exercised solely by `tests/test_authorization_matrix.py`. Fully detachable into `core/authorization_matrix.py`.
- `Principal` + `require_any` imported by **every business router**; `Principal` also flows into service signatures (`groups`, `circulation`, `users`) — so `core.auth_deps` is a dependency of the service layer, not just routers.

**`plugin/service.py`** (290 lines) — **cleanest seam, but ZERO tests**
- 3 services, comment-delimited: `PluginDescriptorService` l.26, `PluginDataService` l.115, `PluginObjectService` l.160, plus `_validate_manifest`.
- No cross-context calls (only `product.models.Product` + local `query_service`). `find_enabled_or_throw` is the single shared gate (7 call sites).
- Cross-package public: **NONE**.

### Related Files (context / supporting, not primary targets)

- `circulation/models.py` (271) — 7 `StrEnum`s + 6 ORM entities (only vertical with intra-aggregate `relationship()`).
- `groups/schemas.py` (258) — 30+ Pydantic models; **imports `app.circulation.models.ItemCondition`** (schema-layer cross-context enum import).
- `footprint/router.py` (250), `footprint/facade.py` (213) — already-layered reference vertical.
- `groups/models.py` (220), `users/service.py` (216), `circulation/router.py` (229).
- `core/errors.py` (134) — legacy flat-envelope error system; competes with `footprint/errors.py` RFC7807 (footprint-only).
- `db.py` (19), `main.py` (75) — `main.py` is the only composition root; imports **only routers** + exception-handler registrars, never a service.
- `party/service.py` (26) — fully decoupled leaf dependency (`create_party`, `deactivate_party`).

---

## Current Functionality

### Architecture as-is

- **Pattern**: microkernel / plugin-based; vertical slice per concept (plural package name), standard files `router/service/schemas/models`.
- **Services**: functional style — module-level `async def` taking `db: AsyncSession` first. No DI container. `main.py` is the sole composition root (3 exception-handler sets, 12 routers, `system_router` last).
- **Layering**: only `footprint/` is layered. `plugin/` and `product/` have a `query_service.py` (CQRS-ish read/write split). Everything else is flat.
- **Cross-context data refs**: 100% compliant with project standard — plain FK-id columns, never `relationship()` across a module boundary. All coupling is at the Python import / service-call layer.
- **Error handling**: two competing systems — legacy flat `ErrorResponse` envelope (`core/errors.py`, field-order-significant) vs RFC7807 `ProblemDetail` (`footprint/errors.py`, footprint-only). Bare `ValueError` is load-bearing control flow → 400 (raised in `plugin/service.py`).
- **Transactions**: services call `db.commit()`/`db.flush()` themselves; routers do not commit (1 exception: `oauth2/router.py:175`). Commit counts: groups 22, circulation 15, families 13, plugin 7, product 6, organizations 4, users 4, party 2.

### Highest-risk knots

1. **`groups.fulfill_pledge` / `sync_pledge_fulfillment` cross-context saga** — the worst knot. Spans 3 bounded contexts (groups, circulation, users/party), ~8 sequential `await`s, orchestrates a Pledge→Reservation bridge by calling `circulation.get_or_create_personal_inventory`, `register_item`, `create_lend_reservation`, `get_reservation`. No single transaction owner; failure mid-saga leaves partial state. **Recommend an explicit ACL module (`groups/integration/circulation_bridge.py`)** with a documented consistency boundary.

2. **`groups` public-view triplicated organizer resolution** — the organizer-slug resolution chain is implemented **three times**: `resolve_organizer_slug`, `_resolve_organizer`, and inline inside `get_public_circle_view` (~80-line god function). Consolidate into one resolver before splitting.

3. **`circulation` reservation state machine** — `create_reservation` / `create_lend_reservation` / `create_swap` / `confirm_reservation` / `cancel_reservation` / `fulfill_reservation` each poke `InventoryBalance.*` fields inline. **No single owner of transition rules.** `fulfill_reservation` is a ~45-line `if/elif/else` over reservation type. `confirm`/`cancel`/`fulfill` share an identical 5-line load-and-guard preamble (extract `_load_reservation_for_transition`). Also: `get_account_balance` sums entries in a Python loop **and calls `db.commit()` inside a getter** (side-effect in a read path).

4. **`oauth2` has no `service.py`** — 722-line router is the only home for grant logic, token crypto, DCR validation, and inline persistence (`select(RegisteredClient)` inline in 3 places). Extraction here is a *creation* task, not a *move*, and there are **zero tests** to catch regressions.

### Recurring smells (cross-cutting, feed the target structure)

| Smell | Where | Target |
|---|---|---|
| Every service reimplements `get_X`/`list_X`/inline `select`/`commit` | all 7 | per-vertical `repository.py` |
| `_require_*` authz helpers scattered, all raising `AccessDeniedException` | groups, families, circulation, organizations | per-vertical `authz.py` co-located with the mutations they guard |
| `build_*_responses` returning `list[dict]` | groups, families | per-vertical `presenters.py` |
| Defensive form-parsing duplicated 3x | `core/auth_deps.py`, `oauth2/router.py` (x3) | shared `core/http/form.py` |
| Transaction ownership decided ad hoc | repo-wide | documented convention: commit stays in the top-level router-called function |
| N+1 loops in `build_*_responses`, `list_group_memberships_for_family` | groups, families | repository eager-load |

---

## Dependencies & Coupling

### Cross-module coupling matrix (Python import / service-call layer)

| Vertical | Imports from | Imported by | Coupling |
|---|---|---|---|
| **groups** | circulation (service alias + `ReservationStatus`, `ItemCondition`), organizations (service alias), users (7 symbols + `UserProfile` + `EMAIL_PATTERN`/`normalize_email`), party (`create_party`, `PartyType`), auth (`User`) | groups/router (~40), families/service (`list_memberships_for_party`), families/router (`build_membership_responses`), users/router (`build_leadership_responses`, `list_active_leaderships_for_party`) | **HIGHEST — the hub** |
| circulation | product (`get_product` x3), auth (`User`) | circulation/router (~20), groups/service (4 symbols, Pledge bridge) | Low out / Medium in |
| families | groups (`list_memberships_for_party`, `Membership`, `MembershipResponse`), users (x3 + `UserProfile`), party | families/router (~25) only | Medium out / **none in** |
| users | auth (`Permission`, `User`, `user_permissions`), party, groups (router only) | groups, families, auth, organizations (scattered) | Medium |
| organizations | party, users (router only) | (light) | Low |
| auth | users (router only), core.security | users, groups, oauth2 | Low |
| **oauth2** | core.security, core.auth_deps, db, config only | main.py (router only) | **Fully decoupled from verticals** |
| **plugin** | product (`Product`) | plugin/router (15) only | Low / **none in** |
| **product** | none | circulation, plugin | **Fully decoupled — reference vertical** |
| **footprint** | none | main.py (router only) | **Fully decoupled + already modularized** |
| party | none | users, groups, families, organizations | Decoupled leaf |

- **No circular imports at module load.** DAG: `party ← users ← auth(router)/organizations/groups ← families`; `product ← circulation/plugin`; `circulation ← groups`.
- **Module-alias imports are the refactor hazard**: splitting `circulation`'s service requires either keeping a re-exporting `circulation/service.py` facade **or** updating ~7 call sites in `groups/service.py`. Same pattern for `groups`.
- **Schema-layer leakage**: `groups/schemas.py` imports `app.circulation.models.ItemCondition`; `users/router.py` and `families/router.py` both import `app.groups.schemas` response models + `groups.service` builder functions.

---

## Test Coverage

### Harness

- `tests/conftest.py`: session-scoped `PostgresContainer("postgres:18")` via testcontainers; `alembic upgrade head` once via subprocess; per-test `db_session` = outer transaction + SAVEPOINT rolled back (`join_transaction_mode="create_savepoint"`); `client` fixture wraps the real ASGI app (`httpx.ASGITransport` + `AsyncClient`) with `get_db` overridden.
- `pyproject.toml`: `asyncio_mode="auto"`, `testpaths=["tests"]`, no custom markers. Run: `uv run pytest` from `src/backend`.
- **Test style**: every test file drives the app through HTTP. `app.*` imports are **only** models + a few schemas for DB assertions. **ZERO tests import service internals.** Sole exception: `test_authorization_matrix.py` is a pure unit test of `resolve_requirement`.

### Test files (~113 functions, 15 files)

| File | ~Tests | File | ~Tests |
|---|---|---|---|
| test_groups.py | 23 | test_account_merge.py | 6 |
| test_families.py | 13 | test_lightweight_family_members.py | 6 |
| test_circulation.py | 11 | test_my_attendances.py | 6 |
| test_authorization_matrix.py | 9 (unit) | test_registration.py | 4 |
| test_organizations.py | 9 | test_login.py | 4 |
| test_public_term.py | 9 | test_product_resolution.py | 4 |
| test_rsvp.py | 7 | test_promotion.py | 2 |

**plugin: 0 · footprint: 0 · oauth2: 0**

### Coverage gaps

- **`plugin/`, `oauth2/`, `footprint/`: no test file at all.**
- No dedicated `test_users.py` (users exercised incidentally via groups/families/auth flows).
- `auth/` covered only by `test_login.py` (4 tests).

---

## Coding Patterns (target-structure inputs)

- **Naming**: plural package name per concept; standard files `router.py`/`service.py`/`schemas.py`/`models.py`. `from __future__ import annotations` everywhere.
- **Services**: module-level `async def`, `db` first arg, no classes, functional. `# --- Title ---` comment banners mark pre-drawn seams.
- **Cross-slice imports**: `from app.circulation import service as circulation_service` (module alias).
- **Type aliases**: `DbSession`, `ReadPrincipal`, `EditPrincipal` in routers.
- **Reference layout (`footprint/`)**: `domain/` (pure — `breakdown.py`, `enums.py`, `exceptions.py`), `engine/` (calculators), `archetype/`, `audit/`, `export/`, `ports.py` (facade protocol), `facade.py` (application entry), `stubs.py`.
- **Authz two-tier**: matrix-expressible rules in `AUTHORIZATION_MATRIX` (first-match-wins); ownership rules the matrix can't express are enforced **inside** each vertical's service raising `AccessDeniedException` — these **must stay co-located with the mutations they guard** through any split.

---

## Complexity Assessment

| Factor | Value | Level |
|---|---|---|
| File count in scope | 7 primary + ~10 related + N new modules | High |
| Largest file | 983 lines (`groups/service.py`) | High |
| Coupling (groups hub) | 5 upstream verticals, ~40 internal + 4 external call sites | High |
| Test coverage of targets | groups/circulation/families 🟢; plugin/oauth2/footprint 🔴 zero | Mixed |
| Behavior-change risk | none intended; tests are HTTP-level so blind to internal moves | Low (for covered verticals) |
| Import-graph risk | module-alias cross-slice imports; schema-layer leakage | Medium-High |

### Overall: Complex

Large surface, a genuine cross-context saga, an undecomposed 722-line OAuth2 router with no tests, and repo-wide transaction-ownership inconsistency. Mitigated by pre-drawn comment-banner seams, an in-repo target template (`footprint/`), strong HTTP test coverage for the 4 highest-traffic verticals, and a clean load-time import DAG.

---

## Per-Vertical Refactor-Safety Table

| Vertical | Big file(s) | Tests | External consumers | Safety | Notes |
|---|---|---|---|---|---|
| **product** | none | via circulation/plugin | circulation, plugin | 🟢 Safe | reference vertical, leave as-is |
| **party** | none | via dependents | 4 verticals | 🟢 Safe | decoupled leaf |
| **organizations** | service 164 | 9 HTTP | light | 🟢 Safe | small, low coupling |
| **circulation** | service 569 | 11 dedicated + more | groups (4 symbols) | 🟢 Safe behavior / 🟡 keep facade | extract `accounting/` subdomain behind a port; keep `service.py` re-exporting the 4 groups-consumed symbols |
| **groups** | service 983, router 378, schemas 258 | ~60+ (best covered) | families x2, users x1 | 🟢 Safe behavior / 🟡 care on imports | keep a re-exporting `groups/service.py` facade for the 4 cross-package symbols |
| **families** | service 418 | 19 HTTP | none | 🟢 Safe | entire module free to reorganize; extract dup guardian-authz |
| **users** | service 216 | no dedicated `test_users.py` | groups, families, auth, organizations | 🟡 Moderate | wide cross-package surface; keep exception classes + `get_profile_by_*` importable |
| **auth** | router 86 | test_login (4) | users, groups, oauth2 | 🟡 Moderate | thin; low churn expected |
| **core** | auth_deps 323 | test_authorization_matrix (9, unit) | every router + 3 services | 🟡 Moderate | matrix detachable freely; `Principal`/`require_any` load-bearing everywhere, move with shims |
| **plugin** | service 290 | **0** | none | 🔴 Unsafe | cleanest seam but no safety net — add HTTP characterization tests first, OR pure mechanical move with zero logic change |
| **footprint** | router 250, facade 213 | **0** | none | 🟠 Unsafe-in-tests | already modularized, least need to touch |
| **oauth2** | router 722 | **0** | none | 🟠 Caution — highest effort | no `service.py` at all; extraction is creation not move; add HTTP tests for all 3 grants + DCR + introspection before refactoring |

---

## Key Findings

### Strengths
- Comment-banner seams pre-mark nearly every extraction point.
- `footprint/` is a working in-repo target template.
- Cross-context DB coupling is already clean (FK-id only).
- No circular imports; clean load-time DAG.
- HTTP-level tests are refactor-agnostic for internal moves.
- `families`, `plugin` have zero external consumers → free to reorganize.

### Concerns
- `groups/service.py` is a 983-line god module and the coupling hub simultaneously.
- `groups.fulfill_pledge` saga has no consistency owner; spans 3 contexts.
- Organizer resolution triplicated in groups public-view.
- `circulation` reservation transitions have no single rule owner; `get_account_balance` commits inside a read.
- `oauth2/router.py` (722) has no service layer and zero tests.
- `plugin/`, `oauth2/`, `footprint/` — zero test coverage.
- Transaction ownership inconsistent repo-wide.
- Module-alias + schema-layer cross-slice imports mean naive splits break importers.
- Two competing error systems.

### Opportunities
- Introduce repo-wide conventions in the same pass: `repository.py`, `authz.py`, `presenters.py` per vertical; shared `core/http/form.py`.
- Extract `circulation/accounting/` behind a `ledger.post_circulation(...)` port.
- Kill dead code: `groups.end_group_role` (no callers), `validate_authorize_request` step 7 (unreachable), move `AUTHORIZATION_MATRIX` to a test-only location.
- Consolidate the triplicated organizer resolver and the duplicated guardian-authz check.
- Document the transaction-ownership convention as a new backend standard (candidate for `/maister:standards-update`).

---

## Impact Assessment

- **Primary changes**: `groups/{service,router,schemas}.py`, `oauth2/router.py`, `circulation/service.py`, `families/service.py`, `core/auth_deps.py`, `plugin/service.py` → decomposed into sub-modules.
- **Related changes**: `families/service.py`, `families/router.py`, `users/router.py`, `groups/router.py` (cross-slice importers) — avoidable if re-export facades are kept.
- **Test updates**: none required for covered verticals. **New tests required before touching** `plugin/`, `oauth2/`, and (if in scope) `footprint/`.
- **`main.py`**: unaffected as long as each vertical keeps exporting its `APIRouter` at a stable import path.

### Risk Level: Medium-High

Behavior-regression risk is **Low** for groups/circulation/families/organizations. Risk is elevated by: (1) import-graph fragility; (2) three zero-test verticals where `oauth2` also needs *new* structure; (3) the `fulfill_pledge` saga and `circulation` reservation state machine, where careless helper extraction could shift a commit boundary and change failure semantics.

---

## Recommended Target Structure (per vertical, modeled on `footprint/`)

```
<vertical>/
  router.py            # or router/ package by resource (groups)
  application/          # orchestration: former service.py sections, one file per aggregate
  domain/              # pure rules: state machines, invariants, policies (no db, no cross-context)
  repository.py        # all select/get/query building + eager loading
  authz.py             # _require_* helpers, co-located with guarded mutations
  presenters.py        # build_*_responses (replace list[dict] with typed models)
  integration/         # ACLs for cross-context calls (e.g. groups/integration/circulation_bridge.py)
  schemas.py  models.py
```

### Suggested sequencing (low-risk → high-risk)

1. **`plugin/`** — pure mechanical move (cleanest seams); write HTTP characterization tests first.
2. **`core/auth_deps.py`** — detach `AUTHORIZATION_MATRIX` + `resolve_requirement`; split token-extraction / principal / dependencies / exception-handlers; keep `Principal` and `require_any` re-exported.
3. **`families/`** — no external consumers; extract dup guardian-authz, `make_primary_contact` temporal logic, `repository.py`.
4. **`circulation/`** — extract `accounting/` behind a `ledger.post_circulation(...)` port; `reservation/state_machine.py` as single transition-rule owner; keep `service.py` re-exporting 4 groups-consumed symbols.
5. **`groups/`** — consolidate triplicated organizer resolver, delete `end_group_role`, split by section into `application/`, move Pledge→Reservation bridge to `integration/circulation_bridge.py`, keep `service.py` re-export facade, split `router.py` by resource preserving route order.
6. **`oauth2/`** — highest effort; write HTTP tests for 3 grants + DCR + introspection first; create `constants.py`, `tokens.py`, `client_repository.py`, and `registration/`/`authorization/`/`token/`/`introspection/` sub-packages; delete unreachable step 7.
7. **`footprint/`** — leave unless explicitly in scope.

### Cross-cutting (same migration)

- Establish and document the **transaction-ownership rule**: the top-level router-called function owns `commit()`; extracted helpers `flush()` at most.
- Add shared `core/http/form.py`, replace the 4 duplicated form parsers.
- Decide error-system direction (RFC7807 vs freeze legacy envelope) — likely a standards update.
- Preserve every module-alias import path via re-export facades; do not update cross-slice call sites in the same PR as the split.

---

## Open Questions for Phase 1 Clarification

1. Scope of verticals — all seven big files, or a prioritized subset this pass?
2. Are `oauth2/` and `plugin/` (zero tests) in scope, and if so is writing HTTP characterization tests first acceptable added scope?
3. How aggressive: pure file-splitting with re-export facades, or full DDD layering (`domain/`/`application/`/`repository.py`)?
4. Deliver as one big PR or incremental per-vertical PRs?
5. Adopt the transaction-ownership convention + repo-wide `repository.py`/`authz.py`/`presenters.py` scaffolding now, or defer to a follow-up?
