# Implementation Plan: Backend Service Decomposition (DDD / Clean-Architecture Boundaries)

**Task type**: architecture migration — strict mechanical decomposition, zero behavior change
**Source of truth**: `implementation/spec.md` (authoritative — per-vertical target file trees, move-map tables,
facade contents, ACL module contents, per-step verification commands, behavior-preservation checklists all
live there). This plan turns the spec's "Step Sequence & Ordering" table into task groups + ordered steps and
attaches the repeatable regression gate. **It does not re-derive the design — cite the spec section, do not
recopy move-map rows.**

**Repo root**: `C:\Users\karas\Desktop\group-thing-app`
**Backend root** (all `uv`/`grep` commands run here): `C:\Users\karas\Desktop\group-thing-app\src\backend`
**Delivery**: incremental commits directly to `main` (user confirmed: not production). One focused commit per
task group; TG3 and TG4a may be several sub-commits. Rollback = `git revert <sha>` (no schema/data changes).

---

## Overview

| Metric | Value |
|---|---|
| Task groups | 6 (TG0 baseline + TG1–TG4b = the 5 spec steps) |
| Total ordered steps | 34 |
| New automated tests | 0 (D2 — `scope_expanded: false`; regression net = existing suite + `ruff` + `mypy`) |
| Existing regression suite | 113 pytest (Docker + TestContainers Postgres 18) |
| Estimated commits | 5 minimum (one per TG1–TG4b), up to ~13 with the recommended TG3/TG4a sub-commits |
| Files in `src/` created | ~30 new modules (structural containers — no new logic) |
| Files in `src/` deleted | `app/groups/router.py` (→ package), `groups.end_group_role` (dead code) |

### Dependency chain

```
TG0 ──┬──> TG1  (core/auth_deps)      ─┐
      ├──> TG2  (families)             ├─ mutually independent, disjoint file trees, any order / interleave
      └──> TG3  (circulation)         ─┘
                    │
                    └──> TG4a (groups service) ──> TG4b (groups router package)
```

### Parallelism

- **TG1, TG2, TG3 are mutually independent** — they touch `app/core/` vs `app/families/` vs `app/circulation/`
  respectively (fully disjoint). Safe to execute or interleave in any order after TG0.
- **TG3 must precede TG4a** — `groups` consumes the `circulation` facade via `infrastructure/circulation_bridge.py`,
  and the shared D1 commit-boundary discipline is settled on the smaller body (circulation) first.
- **TG4a must precede TG4b** — the `router/` package calls the `groups/service.py` facade created in TG4a.
- Because every commit lands on `main` and the full gate must pass before the next, **actual execution is
  sequential**; "parallel-safe" means the grouping/ordering of TG1–TG3 is free, not that they run concurrently.

---

## Global Regression Gate (run verbatim after EVERY commit — including every sub-commit)

```
cd src/backend
uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy .
```

Pass criteria — measured against `verification/baseline.md`, **"no NEW findings vs baseline", NOT "zero findings"**:

| Check | Baseline | Gate requirement |
|---|---|---|
| `uv run pytest` | `113 passed`, exit 0 | still exactly `113 passed`, exit 0 — no drop, no new errors |
| `uv run ruff check .` | 2 errors, both `app/organizations/models.py` (E501) — out of scope | still exactly those 2; **zero** new findings in `core/` `families/` `circulation/` `groups/` |
| `uv run ruff format --check .` | clean | clean |
| `uv run mypy .` | 4 errors: `organizations/service.py:88` (oos); `groups/service.py:612` + `:618` (`int\|None` vs `int` on the `fulfill_pledge`→circulation calls); `groups/service.py:904` (redundant cast) | still exactly those 4 — **line numbers may shift** as `groups/service.py` code moves into new modules; the *set* must not grow. The 3 in-scope errors move **verbatim** into `groups/infrastructure/circulation_bridge.py` (612/618) and the account-merge/attendances area (904), carrying their errors — **do NOT "fix" them** |

**A commit that reddens pytest, adds a ruff finding, or grows the mypy error set is fixed or `git revert`ed
before proceeding — never left on `main`.** Detection signals and dependency-aware revert order:
`analysis/rollback-plan.md`.

---

## Cross-cutting rules (apply in every task group)

1. **Verbatim relocation only.** Every function/constant/class moves byte-for-byte (whitespace + import
   lines aside). Verify each moved body with `git show <sha>` diff review before running the gate. The **only**
   permitted non-move edits are the 5 sanctioned ones (spec "Sanctioned non-pure-move edits" table, rows a–e):
   | Row | Vertical | Edit |
   |---|---|---|
   | a | families | extract `_require_family_guardian(db, family_id, caller_party_id)` from the 2 byte-identical guardian checks |
   | b | circulation | extract `_load_reservation_for_transition(db, reservation_id)` — the shared 3-line load-and-context preamble (status guards stay in each caller) |
   | c | core | relocate the authorization matrix (`Requirement`, `MatrixEntry`, `_methods`, `_RawEntry`, `_RAW_MATRIX`, `AUTHORIZATION_MATRIX`, `resolve_requirement`, `import re`) verbatim to `app/core/authorization_matrix.py`; update the 1 test import |
   | d | groups | delete `end_group_role` after re-verifying 0 callers by grep |
   | e | groups | replace `groups/router.py` with `groups/router/` package assembled in explicit registration order |
   Everything else is a pure move.
2. **Transaction ownership (D1).** "Full DDD" = the layer **structure**, NOT single-transaction-per-use-case.
   Every existing `db.commit()` / `db.flush()` stays exactly where it is today, in whichever `application/`
   module the function lands in (trailing commit in `fulfill_pledge`; commits *inside* `register_item` and
   `create_reservation`; `get_account_balance`'s commit-in-a-getter; `merge_anonymous_profile`'s
   `pg_advisory_xact_lock`; every `await db.flush()`). **`domain/` and `infrastructure/repository.py` NEVER
   commit or flush** — grep-verified per vertical.
3. **Import-cycle guidance (spec §4a).** `application/` modules import each other; the expected dependency
   direction is acyclic. **If a genuine cycle appears, MERGE the two offending modules** — do NOT add
   `TYPE_CHECKING` hacks or function-local imports. Record any forced merge in `implementation/work-log.md`.
4. **Every new module**: `from __future__ import annotations` first line after the docstring; full
   annotations; functional style (module-level `async def`, `db: AsyncSession` first arg, no service classes);
   empty (0-byte) `__init__.py` per subpackage (matching `app/footprint/`); `ruff` (E,F,I,UP,B,SIM) +
   `ruff format` (double-quote) clean; `mypy --strict` clean. Preserve every `cast(int, ...)` verbatim —
   they are mypy-strict load-bearing, do not "clean up".
5. **`models.py` and `schemas.py` never move and are never edited** in any vertical (cross-slice / test
   import targets). `groups/schemas.py` keeps `from app.circulation.models import ItemCondition` (D8).
6. **Deferred items — record in `implementation/work-log.md` as follow-ups (do NOT implement):**
   - D3 triplicated organizer-slug resolution + its 500-vs-`None` divergence — moved as-is, not consolidated.
   - `circulation/domain/balance_state_machine.py` extraction (target-state-plan §3) — deferred under D2;
     the `InventoryBalance` transition field-mutation cascades stay inline in their `application/` functions.
   - Any `application/` module merges forced by import cycles (rule 3).
   - Any behavior / performance / N+1 issue noticed in passing — log only, do not fix.
   - Standards-evolution note: the `repository.py` / `application/` / `infrastructure/*_acl.py` split is a
     repeatable per-vertical pattern — candidate for `/maister:standards-update` after this refactor.
7. **Standards** (`.maister/docs/standards/`, indexed in `.maister/docs/INDEX.md`) — see "Standards
   Compliance" section of the spec; key ones: `global/minimal-implementation.md` (thin `domain/`, plain-function
   ledger port, no `authz.py`, minimal ACLs), `backend/security.md` (`_require_*` checks co-located with the
   mutation they guard; matrix rows + first-match order verbatim), `backend/models.md` + `backend/queries.md`
   (eager-load options move verbatim into `repository.py`; repos never commit/flush).

---

## Implementation Steps

### Task Group 0: Baseline Capture

**Objective**: prove the pre-refactor state matches `verification/baseline.md` and capture the route dump
that TG4b diffs against. **No commit.**

**Dependencies**: None
**Files to Modify**: None (writes only to the task folder / scratch — never `src/`)

- [x] 0.0 Capture and confirm baseline
  - [x] 0.1 `git status --porcelain src/` → confirm **clean** (no `src/` changes staged or unstaged).
        The work-tree may show only `.maister/` task files modified.
  - [x] 0.2 `cd src/backend && uv run pytest -q` → confirm `113 passed`, exit 0. Record the exact pass
        count and duration in `implementation/work-log.md`.
  - [x] 0.3 `uv run ruff check .` and `uv run ruff format --check .` → confirm exactly the 2 baseline
        E501 errors in `app/organizations/models.py`, nothing in `core/ families/ circulation/ groups/`.
  - [x] 0.4 `uv run mypy .` → confirm exactly the 4 baseline errors (`organizations/service.py:88`;
        `groups/service.py:612`, `:618`, `:904`).
  - [x] 0.5 Capture the route dump (spec §4b command) to a **stable path outside `src/`**:
        ```
        cd src/backend
        uv run python -c "from app.main import app; [print(f'{sorted(r.methods)} {r.path} -> {r.name}') for r in app.routes if hasattr(r,'methods')]" > ../../.maister/tasks/migrations/2026-09-10-backend-service-refactor/verification/routes_before.txt
        ```
        (Windows/Git-Bash: forward slashes ok; the spec shows `/tmp/routes_before.txt` — use the task
        `verification/` folder instead so it survives and is diffable in TG4b.)
  - [x] 0.6 Record in `work-log.md`: baseline pass count + pre-refactor `db.commit`/`db.flush` counts:
        `circulation/service.py` = **15**, `groups/service.py` = **22**, `families/service.py` = **13**,
        `core/auth_deps.py` = **0** (re-counted with `grep -c`).

**Acceptance Criteria**: ✅ ALL MET
- `git status src/` clean; `113 passed`; ruff = 2 baseline errors; mypy = 4 baseline errors.
- `verification/routes_before.txt` exists = 101 OpenAPI operations.
- `work-log.md` records baseline pass count + per-vertical commit/flush counts.

> **Note**: route snapshot uses `app.openapi()` (method/path/operationId/response-codes), not
> `app.routes` — this FastAPI version wraps `include_router` results in `_IncludedRouter` objects
> with no flat `.path`. TG4b compares `routes_after.txt` (same command) against `routes_before.txt`.

---

### Task Group 1: `core/auth_deps` split + `authorization_matrix.py`

**Objective**: layered split of `app/core/auth_deps.py` (323 lines) into `app/core/_auth/` sibling modules
behind a flat `app/core/auth_deps.py` re-export facade; relocate the authorization matrix to the new
`app/core/authorization_matrix.py` (edit c). Per spec **"Vertical 1"**.

**Dependencies**: TG0 (parallel-safe with TG2, TG3 — disjoint files)
**Files to Modify**:
- `app/core/auth_deps.py` (gutted → flat facade)
- `app/core/_auth/__init__.py` (new, empty), `app/core/_auth/token.py` (new),
  `app/core/_auth/principal.py` (new), `app/core/_auth/dependencies.py` (new),
  `app/core/_auth/exception_handlers.py` (new)
- `app/core/authorization_matrix.py` (new)
- `tests/test_authorization_matrix.py` (1 import line)

**Steps** — follow spec "Vertical 1 → Move-map" table exactly:

- [x] 1.0 Split `core/auth_deps` per spec Vertical 1 — DONE, commit `5623352`
  - [x] 1.1 Create `app/core/_auth/` with empty `__init__.py`. Create `authorization_matrix.py` and move
        the matrix symbols + `import re` verbatim into it (move-map row 5; exact rows, exact evaluation
        order). Move the matrix-related docstring paragraph.
  - [x] 1.2 Move `_BEARER_PREFIX`, `_extract_token` → `_auth/token.py` (verbatim; preserve form/query/header
        fallback order).
  - [x] 1.3 Move `Principal`, `AuthenticationRequiredException`, `get_current_principal`, `OptionalPrincipal`
        → `_auth/principal.py`.
  - [x] 1.4 Move `require_any` → `_auth/dependencies.py` (imports `Principal`,
        `AuthenticationRequiredException` from `.principal`; `AccessDeniedException` from `app.core.errors`).
  - [x] 1.5 Move `_unauthorized_envelope`, `authentication_required_handler`,
        `register_auth_exception_handlers` → `_auth/exception_handlers.py` (preserve 401 envelope field order
        + values).
  - [x] 1.6 Rewrite `app/core/auth_deps.py` as the flat facade — exact contents in spec "Facade contents
        (`app/core/auth_deps.py`)": re-export the 6 preserved symbols with `__all__`; **no re-export of
        matrix symbols** (D6). Keep the non-matrix docstring text.
  - [x] 1.7 Update the single import in `tests/test_authorization_matrix.py` to pull `resolve_requirement`
        (+ any matrix symbols it uses) from `app.core.authorization_matrix`.
  - [x] 1.8 `git show` diff review — every moved body identical; run the global regression gate.
  - [x] 1.9 Spec grep checks:
        ```
        grep -rn "from app.core.auth_deps import" app tests           # every hit still valid via facade
        grep -rn "from app.core.authorization_matrix import" tests     # exactly 1 (test_authorization_matrix.py)
        grep -rn "resolve_requirement\|AUTHORIZATION_MATRIX" app/core/auth_deps.py   # 0 hits
        ```

**Verification block**: global gate + the 3 grep checks above.

**Acceptance Criteria** = spec "Vertical 1 → Behavior-preservation checklist" (all 6 boxes):
- `Principal`, `require_any`, `OptionalPrincipal`, `get_current_principal`, `AuthenticationRequiredException`,
  `register_auth_exception_handlers` all importable from `app.core.auth_deps`.
- matrix symbols importable from `app.core.authorization_matrix`; `test_authorization_matrix.py` green.
- `_RAW_MATRIX` rows byte-identical, same order (diff the tuple).
- `_extract_token` fallback order unchanged; 401 envelope field order + values unchanged.
- `test_login.py`, `test_authorization_matrix.py`, `test_registration.py` green.
- Global gate green (113 / 2 ruff / 4 mypy).

**Suggested commit**: `refactor(core): split auth_deps into _auth/ modules, relocate authorization matrix`
**Rollback**: `git revert <sha>` — nothing depends on the internal split (facade path unchanged).

---

### Task Group 2: `families` split behind flat facade

**Objective**: layered split of `app/families/service.py` (418 lines) into cohesive sibling modules behind a
flat `families/service.py` re-export facade; dedup the verbatim guardian-authz check into
`_require_family_guardian` (edit a). Per spec **"Vertical 2"**. No `domain/application/infrastructure` triad —
depth is flat-layered here.

**Dependencies**: TG0 (parallel-safe with TG1, TG3 — disjoint files)
**Files to Modify**:
- `app/families/service.py` (gutted → flat facade)
- `app/families/bootstrap.py`, `app/families/repository.py`, `app/families/guardians.py`,
  `app/families/members.py`, `app/families/primary_contact.py` (all new)
- **NOT** `app/families/{models,schemas,router}.py` — untouched

**Steps** — follow spec "Vertical 2 → Move-map" table (17 rows) exactly:

- [x] 2.0 Split `families` per spec Vertical 2
  - [x] 2.1 Create `repository.py` — move `get_family`, `list_families_for_guardian_party`,
        `count_active_child_members`, `list_guardian_memberships`, `list_group_memberships_for_family`
        verbatim (no commit/flush). Keep the cross-slice `list_memberships_for_party` import from
        `app.groups.service` inside `list_group_memberships_for_family` (one-directional read, no ACL this pass).
  - [x] 2.2 Create `bootstrap.py` — move `bootstrap_family_for_party`, `create_family`, `create_own_family`
        (latter two keep their `db.commit()`).
  - [x] 2.3 Create `members.py` — move `create_lightweight_family_member` (flush only),
        `create_lightweight_members_batch` (keeps `db.commit()`).
  - [x] 2.4 Create `primary_contact.py` — move `make_primary_contact` (keeps `db.commit()`; close-row /
        open-replacement temporal logic verbatim).
  - [x] 2.5 Create `guardians.py` — move `add_guardian`, `build_guardian_responses`, `rename_family`,
        `remove_family_member`. Then **edit (a)**: extract `_require_family_guardian(db, family_id, caller_party_id)`
        as the *verbatim body* of the deduped check (the `select(FamilyRole.id).join(FamilyMembership...)`
        + `if guardian is None: raise AccessDeniedException("You do not guard this Family")`); call it from
        both `rename_family` and `remove_family_member` passing the id (one site passed `family_id`, the other
        `cast(int, family.id)` — same value). Last-guardian 409 guard stays inline in `remove_family_member`.
  - [x] 2.6 Rewrite `families/service.py` as the flat facade — re-export the 13 router-consumed symbols +
        `bootstrap_family_for_party`, `__all__` listing all; keep the "ownership checks live here" docstring note.
        Exact list in spec "Facade contents (`app/families/service.py`)".
  - [x] 2.7 `git show` diff review; run the global regression gate.
  - [x] 2.8 Spec grep checks:
        ```
        grep -rn "from app.families.service import\|from app.families import service\|from . import service" app tests
        grep -c "_require_family_guardian" app/families/guardians.py     # 3  (1 def + 2 calls)
        grep -rn "You do not guard this Family" app/families/            # exactly 1 (inside the helper)
        ```

**Verification block**: global gate + the 3 grep checks above.

**Acceptance Criteria** = spec "Vertical 2 → Behavior-preservation checklist" (6 boxes):
- All 13 router symbols + `bootstrap_family_for_party` importable from `app.families.service`.
- `_require_family_guardian` raises `AccessDeniedException("You do not guard this Family")` — same message + type.
- `rename_family` / `remove_family_member` behavior identical (guardian required; last-active-guardian 409 kept).
- `make_primary_contact` no-op-when-already-primary path + close/demote/replace path unchanged, single `db.commit()`.
- `create_lightweight_family_member` flushes only; batch owns the commit.
- `test_families.py` (13), `test_lightweight_family_members.py` (6), `test_my_attendances.py` (6),
  `test_account_merge.py` (6) green. Global gate green.

**Suggested commit**: `refactor(families): split service into cohesive modules behind facade`
**Rollback**: `git revert <sha>` — no other step touches `families`.

---

### Task Group 3: `circulation` full DDD behind flat facade

**Objective**: `app/circulation/service.py` (569 lines) → `domain/` + `application/` + `infrastructure/`
layers behind a flat `circulation/service.py` facade; extract the accounting subdomain to
`infrastructure/ledger.py` (`_post_circulation_transaction` → `post_circulation`); dedup the
reservation-transition preamble into `_load_reservation_for_transition` (edit b). Per spec **"Vertical 3"**.

**Dependencies**: TG0. **Must precede TG4a.**
**Files to Modify**:
- `app/circulation/service.py` (gutted → flat facade)
- `app/circulation/domain/{__init__,constants,reservation_rules}.py` (new)
- `app/circulation/application/{__init__,identity,inventory,inventory_items,reservations,reservation_transitions,accounts}.py` (new)
- `app/circulation/infrastructure/{__init__,repository,ledger}.py` (new)
- **NOT** `app/circulation/{models,schemas,router}.py` — untouched

**Recommended internal sub-commit sequence** (gate + `git show` review after each — finer rollback granularity):

- [x] 3.0 Split `circulation` per spec Vertical 3
  - [x] 3.1 **Sub-commit (i)** — `infrastructure/repository.py`: collect verbatim every `select()` / `db.get()`
        currently in `circulation/service.py` (Inventory lookups; InventoryItem get/list incl. `deleted_at`
        filter; InventoryBalance by item; Account by code; CirculationEntry by account; CirculationTransaction
        with the `selectinload(...).joinedload(...)` options verbatim; Reservation get/list;
        `_current_holder_user_id`'s fulfilled-history query with ordering `reserved_at.desc(), id.desc()`).
        Each → a named `async def` returning ORM object(s). **No commit/flush.** Keep `EntityNotFoundException`
        raises where they are today (in the `application/` getter wrappers, not the repo). Gate.
  - [x] 3.2 **Sub-commit (ii)** — `infrastructure/ledger.py`: move `get_or_create_user_balance_account`
        (`db.flush()`), `_get_emission_account`, and `_post_circulation_transaction` renamed to
        `post_circulation(db, *, giver_user_id, amount, description) -> CirculationTransaction` (body identical,
        `db.flush()` inside verbatim; plain async function, **no `Protocol`** — D7). Move the accounting
        docstring paragraph here; leave a short pointer on the facade. Gate.
  - [x] 3.3 **Sub-commit (iii)** — `domain/`: `constants.py` (`_EMISSION_ACCOUNT_CODE`, `_DEFAULT_LEND_DAYS`,
        `_POSTED_AMOUNT`); `reservation_rules.py` (`_require_party_to_reservation`, `_next_transaction_number`
        — both already module-level pure). **Nothing else** — the `InventoryBalance` transition cascades stay
        inline in `application/` (D2, deferred `balance_state_machine.py`). Gate.
  - [x] 3.4 **Sub-commit (iv)** — `application/` split, one module per use-case cluster per the spec Move-map:
        `identity.py` (`get_user_id_by_principal`); `inventory.py` (`create_inventory` commit,
        `get_inventory`/`list_inventories` → repo, `get_or_create_personal_inventory` **flush not commit**);
        `inventory_items.py` (`register_item` **flush then commit, both inside verbatim**, `get_item`/`list_items`/
        `get_item_balance`, `_require_item_owner` co-located, `update_item` commit, `soft_delete_item` commit);
        `reservations.py` (`create_reservation` **commit inside verbatim**, eligibility `required_status` expr
        + balance mutations inline; `create_lend_reservation` delegates; `create_swap` flush+commit verbatim,
        balance mutations inline; `get_reservation`/`list_reservations` → repo);
        `reservation_transitions.py` (`_current_holder_user_id`; **edit (b)** `_load_reservation_for_transition`
        = the shared `reservation = await get_reservation(...)` / `item = await get_item(...)` /
        `holder_user_id = await _current_holder_user_id(...)` preamble, returns `(reservation, item, holder_user_id)`,
        no commit/flush — **per-type status guard stays in each caller**; `confirm_reservation`,
        `cancel_reservation`, `fulfill_reservation` each keep their `db.commit()`, balance mutations inline,
        `fulfill` calls `ledger.post_circulation(db, giver_user_id=holder_user_id, amount=_POSTED_AMOUNT, description=description)`);
        `accounts.py` (`get_account_balance` **keeps `db.commit()` in the getter — do NOT fix**,
        `get_transaction`/`list_transactions_for_account` with eager-load options verbatim). Gate.
  - [x] 3.5 **Sub-commit (v)** — rewrite `circulation/service.py` as the flat facade: re-export the 20
        router-consumed symbols + the 4 groups-consumed (`get_or_create_personal_inventory`, `register_item`,
        `create_lend_reservation`, `get_reservation` — overlap the 20), `__all__` listing all. Delete the old
        service body. Short docstring pointer to `ledger.py`. Gate + `git show` full-body diff review.
  - [x] 3.6 Spec grep + D1 checks:
        ```
        grep -rn "from app.circulation import service\|from app.circulation.service import" app tests
        grep -rn "get_or_create_personal_inventory\|create_lend_reservation" app/groups   # still resolves via circulation_service
        grep -n "db.commit\|db.flush" app/circulation/application/*.py app/circulation/infrastructure/ledger.py
        #   → count + call-sites MUST equal the pre-refactor circulation/service.py count recorded in TG0.6
        grep -rn "db.commit\|db.flush" app/circulation/infrastructure/repository.py app/circulation/domain/   # 0
        ```

**Verification block**: global gate after every sub-commit + the grep/D1 checks + manual `git show` body-diff
confirmation that every moved function is identical.

**Acceptance Criteria** = spec "Vertical 3 → Behavior-preservation checklist" (8 boxes), notably:
- All 20 router symbols + 4 groups symbols importable from `app.circulation.service`.
- `db.commit()`/`db.flush()` count + call-sites identical to pre-refactor; `domain/` + `repository.py` = zero.
- `post_circulation` signature `(db, *, giver_user_id, amount, description)`; body identical to old
  `_post_circulation_transaction`; still the ONLY place a `CirculationTransaction` is created.
- `_current_holder_user_id` query ordering (`reserved_at.desc(), id.desc()`) + LEND-recipient-vs-owner branch unchanged.
- `_require_party_to_reservation` still raises `AccessDeniedException` for the non-party actor.
- `fulfill_reservation` per-type (LEND/RETURN/SWAP+GIFT) balance mutations byte-identical; `_DEFAULT_LEND_DAYS`
  fallback unchanged. `_load_reservation_for_transition` returns `(reservation, item, holder_user_id)`; each
  caller's status guard unchanged.
- `test_circulation.py` (11), `test_product_resolution.py` (4) green. Global gate green.

**Suggested commit(s)**: `refactor(circulation): domain/application/infrastructure layers behind service facade`
(or 5 sub-commits `refactor(circulation): extract infrastructure/repository`, `... ledger.post_circulation`,
`... domain/ constants + pure rules`, `... application/ use-case split`, `... service facade + drop old body`).
**Rollback**: `git revert <sha>` (newest-first if sub-commits). If TG4a already landed, revert TG4a's commits
first (its `circulation_bridge.py` depends on this facade) — see `rollback-plan.md`.

---

### Task Group 4a: `groups` service full DDD behind flat facade

**Objective**: `app/groups/service.py` (983 lines) → `domain/` + `application/` + `infrastructure/` layers
behind a flat `groups/service.py` facade (~35 re-exports); route all cross-context calls through
`infrastructure/*_acl.py`; move `resolve_organizer_slug` verbatim to `infrastructure/slug_resolver.py` (D3);
delete dead `end_group_role` (edit d). Per spec **"Vertical 4a"**.

**Dependencies**: TG3 (consumes the circulation facade + shared D1 pattern). **Must precede TG4b.**
**Files to Modify**:
- `app/groups/service.py` (gutted → flat facade)
- `app/groups/domain/{__init__,organizer_slug}.py` (new)
- `app/groups/application/{__init__,circles,group_roles,leaderships,memberships,terms,pledges,pledge_fulfillment,public_view,account_merge}.py` (new)
- `app/groups/infrastructure/{__init__,repository,circulation_bridge,organizations_acl,slug_resolver}.py` (new)
- **NOT** `app/groups/{models,schemas,router.py}` — untouched in this TG (router is TG4b)

**Recommended internal sub-commit sequence** (gate + `git show` review after each):

- [x] 4a.0 Split `groups` service per spec Vertical 4a
  - [x] 4a.1 **Sub-commit (i)** — `infrastructure/repository.py`: move verbatim all ~20 inline `select()` /
        `db.get()` for Group / GroupRole / Leadership / Membership / Term / NeededItem / Pledge /
        TermAttendance / UserProfile-join into named `async def`. **No commit/flush.** Gate.
  - [x] 4a.2 **Sub-commit (ii)** — ACL + slug modules (spec "ACL module contents"):
        `infrastructure/circulation_bridge.py` — the **only** groups module importing `app.circulation`;
        thin pass-throughs for `get_or_create_personal_inventory`, `register_item`, `create_lend_reservation`,
        `get_reservation` (import string `from app.circulation import service as circulation_service`
        unchanged); also re-export `ReservationStatus` from `app.circulation.models` so `pledge_fulfillment`
        reads `circulation_bridge.ReservationStatus`. **The mypy `int|None` errors on the
        `get_or_create_personal_inventory` / `create_lend_reservation` calls (baseline `groups/service.py:612`,
        `:618`) move here verbatim — carry the errors, do NOT add casts or fix signatures.**
        `infrastructure/organizations_acl.py` — the **only** groups module importing `app.organizations`;
        wraps `get_own_organization`.
        `infrastructure/slug_resolver.py` — `resolve_organizer_slug` moved verbatim (D3; uses
        `organizations_acl`). Gate.
  - [x] 4a.3 **Sub-commit (iii)** — `domain/organizer_slug.py`: move `_fallback_organizer_slug` (pure blake2s,
        `digest_size=6`, `"k-"` prefix). **Nothing else in `domain/`** — leadership-1:N, GroupRole
        standing-capacity, pledge state transitions, RSVP idempotency all stay inline (D2, minimal-implementation).
        Gate.
  - [x] 4a.4 **Sub-commit (iv)** — `application/` split per spec Move-map:
        `circles.py` (`create_circle`, `get_own_circle`, `create_own_circle`, `list_groups`, `get_group`,
        `update_group`); `group_roles.py` (`get_or_create_active_group_role`, flush); `leaderships.py`
        (`_group_role_party_id`, `assign_leadership`, `remove_leadership`, `build_leadership_responses`,
        `get_current_leadership`, `list_leaderships`, `list_active_leaderships_for_party`,
        `_require_active_organizer` — this module is imported by `circles`/`terms`/`pledge_fulfillment`);
        `memberships.py` (`create_membership`, `end_membership`, `list_memberships_for_circle`,
        `list_memberships_for_party`, `build_membership_responses`); `terms.py` (`create_term`, `get_term`,
        `list_terms`, `update_term`, `create_needed_item`, `get_needed_item`, `list_needed_items`,
        `_require_needed_item_organizer`, `update_needed_item`, `_withdraw_pledge_row`, `soft_delete_needed_item`);
        `pledges.py` (`create_pledge`, `get_pledge`, `list_pledges`, `_require_pledging_party`, `withdraw_pledge`);
        `pledge_fulfillment.py` (`fulfill_pledge`, `sync_pledge_fulfillment` — cross-context via
        `circulation_bridge`; **each keeps its single trailing `db.commit()`** — D1; mid-saga commits inside
        `register_item`/`create_reservation` live in circulation, untouched);
        `public_view.py` (`get_public_circle_view`, `list_my_attendances`, `list_attendances_for_term`,
        `_resolve_organizer`, `create_rsvp` — flush+commit; **`get_public_circle_view`'s inline slug/organizer
        block stays inline — do NOT route through `slug_resolver` or `_resolve_organizer`; keep the
        500-on-missing-profile behavior; `_resolve_organizer` keeps `None`-on-missing-profile** — D3);
        `account_merge.py` (`merge_anonymous_profile` — `pg_advisory_xact_lock` + `db.commit()` verbatim,
        advisory-lock line in the same position before the duplicate-email check; carries baseline mypy
        `groups/service.py:904` redundant-cast error verbatim).
        **Delete `end_group_role`** (edit d) — first `grep -rn "end_group_role" app tests` must return only
        its own definition. **Import-cycle rule 3 applies** — if `application/` modules form a cycle, merge
        the two and log it. Gate.
  - [x] 4a.5 **Sub-commit (v)** — rewrite `groups/service.py` as the flat facade: `__all__` = union of the
        router-consumed set (~34) and the cross-package set (`list_memberships_for_party`,
        `build_membership_responses`, `build_leadership_responses`, `list_active_leaderships_for_party` —
        consumed by `families/` + `users/`). Exact lists in spec "Facade contents (`app/groups/service.py`)".
        Keep the authz-lives-here docstring note. Delete the old service body. Gate + full `git show` body-diff review.
  - [x] 4a.6 Spec grep + D1 checks:
        ```
        grep -rn "from app.groups.service import\|from app.groups import service\|from . import service" app tests
        grep -rn "import app.circulation\|from app.circulation" app/groups
        #   → ONLY app/groups/infrastructure/circulation_bridge.py  (+ groups/schemas.py ItemCondition, pre-existing D8)
        grep -rn "import app.organizations\|from app.organizations" app/groups
        #   → ONLY app/groups/infrastructure/organizations_acl.py
        grep -rn "end_group_role" app tests                        # 0 hits
        grep -rn "db.commit\|db.flush" app/groups/infrastructure/repository.py app/groups/domain/   # 0
        grep -n  "db.commit\|db.flush" app/groups/application/*.py
        #   → total = 21 (pre-refactor 22 minus end_group_role deleted commit) - VERIFIED
        ```

**Verification block**: global gate after every sub-commit + the grep/D1 checks + manual `git show` body-diff review.

**Acceptance Criteria** = spec "Vertical 4a → Behavior-preservation checklist" (10 boxes), notably:
- All ~35 facade symbols importable from `app.groups.service`; the 4 cross-package symbols verified against
  `families/` + `users/` imports.
- `end_group_role` gone; grep clean; suite still green (proves it was dead).
- Only `circulation_bridge.py` imports `app.circulation`; only `organizations_acl.py` imports `app.organizations`.
- `db.commit()`/`db.flush()` count + locations identical to pre-refactor (the ~19 sites listed in the spec
  checklist); `domain/` + `repository.py` = zero.
- `fulfill_pledge` saga call order unchanged: `get_or_create_personal_inventory` → `register_item` →
  `create_lend_reservation` → set `resolved_reservation_id` → `db.commit()`.
- `get_public_circle_view` still 500s on organizer with no `UserProfile`; `_resolve_organizer` still returns `None`.
- `resolve_organizer_slug` never returns `None`; `_fallback_organizer_slug` blake2s `digest_size=6` / `"k-"` prefix.
- `merge_anonymous_profile` advisory-lock line verbatim + same position.
- `test_groups.py` (23), `test_rsvp.py` (7), `test_public_term.py` (9), `test_account_merge.py` (6),
  `test_my_attendances.py` (6), `test_promotion.py` (2) green. Global gate green (mypy still exactly 4,
  line numbers shifted).

**Suggested commit(s)**: `refactor(groups): domain/application/infrastructure layers, ACL modules, drop dead end_group_role`
(or 5 sub-commits mirroring TG3).
**Rollback**: `git revert <sha>` (newest-first if sub-commits). If TG4b landed, revert TG4b first.

---

### Task Group 4b: `groups/router/` package

**Objective**: replace the single `app/groups/router.py` with a `groups/router/` package split by resource
(edit e), preserving route registration order and the exported `router` object at `app.groups.router`. Per
spec **"Vertical 4b"**.

**Dependencies**: TG4a (calls the `groups/service.py` facade)
**Files to Modify**:
- delete `app/groups/router.py`
- `app/groups/router/__init__.py`, `app/groups/router/circles.py`, `app/groups/router/leaderships.py`,
  `app/groups/router/memberships.py`, `app/groups/router/terms.py`, `app/groups/router/pledges.py` (all new)
- **NOT** `main.py` (`from app.groups.router import router as groups_router` line 34 must keep resolving to
  the same object), **NOT** `groups/{service,schemas,models}.py`

**Steps**:

- [x] 4b.0 Split `groups/router` per spec Vertical 4b
  - [x] 4b.1 Create each sub-module (`circles.py`, `leaderships.py`, `memberships.py`, `terms.py`,
        `pledges.py`) with its own `router = APIRouter(tags=["groups"])` + the 3 local aliases (`DbSession`,
        `ReadPrincipal`, `EditPrincipal`), then move its handlers **verbatim** — same `service.X` calls, same
        `response_model`, `status_code`, `Depends`. Resource → module mapping in spec "Vertical 4b → Target
        file tree".
  - [x] 4b.2 **Within `circles.py`, preserve the current top-to-bottom handler declaration order verbatim** —
        this is where `/api/groups/mine/attendances`, `/api/groups/public/{id}`, `POST .../rsvp`,
        `POST .../public/merge`, and `PATCH /api/groups/{group_id}` are declared **before**
        `GET /api/groups/{group_id}` (FastAPI matches in registration order).
  - [x] 4b.3 Create `router/__init__.py` exactly per spec: `router = APIRouter()` then
        `router.include_router(circles.router)` → `leaderships` → `memberships` → `terms` → `pledges`, in that
        order, with the load-bearing-order guard comment. Expose `router` so `from app.groups.router import router`
        resolves.
  - [x] 4b.4 Delete `app/groups/router.py`.
  - [x] 4b.5 (Optional, D5 — add only if cheap) `tests/test_groups_route_order.py` asserting the app resolves
        `GET /api/groups/mine/attendances` → `list_my_attendances` (not `get_group`) and
        `GET /api/groups/public/1` → the public-view handler.
  - [x] 4b.6 Run the global regression gate.
  - [x] 4b.7 **Route-dump diff** (the critical check for this TG):
        ```
        cd src/backend
        uv run python -c "from app.main import app; [print(f'{sorted(r.methods)} {r.path} -> {r.name}') for r in app.routes if hasattr(r,'methods')]" > ../../.maister/tasks/migrations/2026-09-10-backend-service-refactor/verification/routes_after.txt
        diff ../../.maister/tasks/migrations/2026-09-10-backend-service-refactor/verification/routes_before.txt \
             ../../.maister/tasks/migrations/2026-09-10-backend-service-refactor/verification/routes_after.txt
        #   → expect: NO differences
        ```
  - [x] 4b.8 `grep -rn "from app.groups.router import\|from app.groups import router" app main.py` → unchanged.

**Verification block**: global gate + **empty `diff routes_before.txt routes_after.txt`** + the import grep.

**Acceptance Criteria** = spec "Vertical 4b → Behavior-preservation checklist" (5 boxes):
- Full route dump (method + path + name) byte-identical to `routes_before.txt`.
- `/api/groups/mine/attendances`, `/api/groups/public/{id}`, `.../public/{id}/rsvp`, `.../public/merge`
  resolve to their own handlers, not `get_group` / `create_circle`.
- `PATCH /api/groups/{id}` and `GET /api/groups/{id}` both resolve correctly.
- `app.groups.router.router` is the object `main.py` line 34 includes; `main.py` unchanged.
- `test_groups.py`, `test_rsvp.py`, `test_public_term.py` green. Global gate green.

**Suggested commit**: `refactor(groups): split router into router/ package by resource`
**Rollback**: `git revert <sha>` — restores the flat `router.py`, keeps the TG4a service split.

---

## Execution Order

1. **TG0** — Baseline capture (6 steps, no commit) — depends on: nothing
2. **TG1** — `core/auth_deps` split (9 steps, 1 commit) — depends on: TG0
3. **TG2** — `families` split (8 steps, 1 commit) — depends on: TG0 *(free to swap with TG1)*
4. **TG3** — `circulation` full DDD (6 steps, 1–5 commits) — depends on: TG0 *(free to run before TG1/TG2)*
5. **TG4a** — `groups` service full DDD (6 steps, 1–5 commits) — depends on: TG3
6. **TG4b** — `groups/router/` package (8 steps, 1 commit) — depends on: TG4a

TG1 / TG2 / TG3 are mutually order-free (disjoint file trees). TG4a and TG4b are strictly last, in that order.

---

## Standards Compliance

Follow `.maister/docs/standards/` (indexed in `.maister/docs/INDEX.md`):

- `global/minimal-implementation.md` — `domain/` stays thin (only already-pure code moves); `ledger.post_circulation`
  is a plain function, not a `Protocol` (D7); no `authz.py` split (`_require_*` checks co-located with their
  mutation); ACL modules are minimal pass-throughs; dead `end_group_role` deleted.
- `backend/security.md` — every `_require_*` ownership check stays co-located with the guarded mutation in
  `application/`; `AUTHORIZATION_MATRIX` rows + first-match evaluation order relocated verbatim; `require_any`
  dependency pattern untouched.
- `backend/models.md` / `backend/queries.md` — `selectinload`/`joinedload` eager-load options move verbatim
  into `infrastructure/repository.py`; no implicit lazy-load introduced; `lazy="raise"` contract preserved;
  repositories never commit/flush.
- `global/conventions.md` / `coding-style.md` — structure modeled on `app/footprint/`; `from __future__ import
  annotations` everywhere; functional services; empty `__init__.py`; `ruff` + `ruff format` + `mypy --strict` clean.
- `backend/migrations.md` — N/A (zero schema / Alembic changes).
- `project/architecture.md` — microkernel vertical-slice layout preserved; each vertical still exports `router`
  at a stable path; `main.py` composition root unchanged.

---

## Notes

- **Mechanical decomposition, not TDD.** No new tests are written (D2). Each task group's "test step" is:
  run the **global regression gate** + the spec's per-vertical grep / D1 / route-dump checks + a manual
  `git show` body-diff review. Acceptance = the spec's per-vertical behavior-preservation checklist.
- **Run incrementally.** The gate runs the full 113-test suite after *every* commit (including sub-commits) —
  this suite is the entire regression net, so it is never scoped down.
- **Verbatim moves.** Preserve every `cast(int, ...)`, every `db.commit()`/`db.flush()` position, every query
  ordering, every error type + message. The 3 in-scope baseline mypy errors move with their code and are
  **carried, not fixed**.
- **Import cycles → merge, don't hack.** Merge the two offending `application/` modules and log it in
  `work-log.md`. No `TYPE_CHECKING` / local-import workarounds.
- **Deferred, log to `work-log.md`:** D3 slug divergence left in place; `balance_state_machine.py` extraction
  deferred; any forced module merges; any behavior/perf issue noticed-but-not-fixed.
- **Task-item tracking**: the `TaskCreate`/`TaskUpdate` tools were not available in this planning session, so
  no structured task items were created. If group-level tracking is wanted, create one item per TG0–TG4b with
  dependencies TG0→{TG1,TG2,TG3}, TG3→TG4a, TG4a→TG4b. Markdown checkboxes above are the resume source of truth.
