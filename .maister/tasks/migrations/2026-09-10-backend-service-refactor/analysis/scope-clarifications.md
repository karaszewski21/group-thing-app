# Phase 2 Scope Clarifications (Decision Gate)

Date: 2026-09-10

## D1 — Transaction-ownership semantics under "full DDD"
**Decision: Preserve every existing commit point verbatim.**
- `application/` modules keep each current `db.commit()` / `db.flush()` exactly where it is today
  (including the trailing commit in `fulfill_pledge`, the commits *inside* `register_item` and
  `create_reservation`, `get_account_balance`'s commit-in-a-getter, and
  `merge_anonymous_profile`'s `pg_advisory_xact_lock`).
- `domain/` and `infrastructure/repository.py` must **never** commit or flush.
- "Full DDD" here means the layer **structure** (domain / application / infrastructure), **not**
  single-transaction-per-use-case. No transaction-ownership standard doc.

## D2 — Missing test coverage for reservation lifecycle / ledger / pledge-fulfill saga
**Decision: Proceed on mechanical-move discipline only. NO new characterization tests.**
- `scope_expanded: false` — no added test task group.
- Consequence / hard rule for implementation: circulation and groups are refactored as
  **strict code-moves with zero logic changes**. No "while I'm here" fixes, no simplifications,
  no behavior tweaks on the untested paths.
- Regression net = `mypy --strict` + `ruff` + `uv run pytest` (existing ~113 tests) after **every**
  commit, plus careful review. Accept that reservation confirm/cancel/fulfill/swap,
  `_current_holder_user_id`, double-entry posting, `get_account_balance`, and
  `POST /api/pledges/{id}/fulfill` + `/sync` have no dedicated automated guard.

## D3 — groups triplicated organizer-slug resolution
**Decision: Move all three into `infrastructure/slug_resolver.py` unchanged; keep the divergence.**
- Relocate `resolve_organizer_slug` and `_resolve_organizer` verbatim.
- Leave `get_public_circle_view`'s inline resolution block inline (do NOT call the new resolver from it).
- Accept the duplication and the 500-vs-`None` edge divergence this pass.
- Consolidation is a deliberate behavior change → logged as a follow-up, not done here.

## D4 + D7 — Facade shape, ledger port, layer naming
**Decision: accepted defaults.**
- Facade = flat `service.py` module sitting alongside `domain/` / `application/` / `infrastructure/`
  subpackages (NOT `service/__init__.py`). Same for `core/auth_deps.py` (flat facade module).
- `infrastructure/ledger.py` exposes `post_circulation(db, *, giver_user_id, amount, description)`
  as a plain async function — **no `Protocol` class** (functional style, no DI, no alternate impl).
- Use-case layer folder is named `application/`.

## D5 — groups router
**Decision: `groups/router.py` → `router/` package by resource.**
- `router/circles.py`, `router/leaderships.py`, `router/memberships.py`, `router/terms.py`
  (terms + needed-items), `router/pledges.py`.
- `router/__init__.py` assembles the `router` APIRouter, including sub-routers in an explicit order.
- Preserve route registration order: `/api/groups/mine/...` and `/api/groups/public/...` before
  `/api/groups/{group_id}`; `PATCH /{group_id}` before `GET /{group_id}` where that ordering
  exists today. Add a guard comment in `__init__.py` (a tiny ordering test is optional).
- `main.py` `include_router` call for groups stays at the same import path / same object.

## D6 — AUTHORIZATION_MATRIX relocation
**Decision: new module `app/core/authorization_matrix.py`; update the one test import.**
- Move `Requirement`, `MatrixEntry`, `_methods`, `_RawEntry`, `_RAW_MATRIX`, `AUTHORIZATION_MATRIX`,
  `resolve_requirement` verbatim (exact rows, exact evaluation order).
- Edit `tests/test_authorization_matrix.py` to import `resolve_requirement` (and any matrix symbols
  it uses) from `app.core.authorization_matrix`.
- **No** re-export shim in the `auth_deps` facade for matrix symbols (zero `app/` callers).

## D8 — groups/schemas.py cross-context import
**Decision: leave `from app.circulation.models import ItemCondition` as-is.**
- Logged as a candidate for a later linguistic-boundary / ACL cleanup.

## D9 — Delivery
**Recommended: incremental per-vertical PRs** (auth_deps, families, circulation, groups[×1–2]).
Confirm at Phase 4 planning. No separate char-test PR (D2).

---

## Net effect on constraints

The combination of D1 (preserve commits) + D2 (no new tests) + D3 (move-not-consolidate) +
"structural only" makes this a **strict mechanical decomposition**:
- Zero behavior changes anywhere.
- Only non-move edits allowed: (a) `_require_family_guardian` dedup in families,
  (b) `_load_reservation_for_transition` preamble dedup in circulation,
  (c) `AUTHORIZATION_MATRIX` relocation, (d) delete `groups.end_group_role` (verified 0 callers),
  (e) the `router/` package assembly for groups.
- Every one of (a)–(e) must be behavior-preserving and independently verifiable via the existing suite.
