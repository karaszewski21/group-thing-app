# Work Log — Backend Service Decomposition

## 2026-09-10 — Implementation Started

**Total task groups**: 6 (TG0 baseline + TG1–TG4b)
**Total ordered steps**: 34
**New automated tests**: 0 (D2 — regression net = existing 113-test suite + ruff + mypy)
**Delivery**: incremental commits directly to `main` (user: not production)
**Executor note**: `TaskCreate`/`TaskUpdate` unavailable this session — progress tracked via
markdown checkboxes in `implementation-plan.md` + entries here.
**Execution mode**: sequential (not parallel waves) — every commit lands on `main` and the full
gate must pass before the next; shared single Docker Postgres container + single git working tree.

## Standards Reading Log

### Loaded per group

**TG1 (core/auth_deps)**: `standards/backend/security.md` (matrix rows + first-match order verbatim; `require_any` untouched), `standards/global/minimal-implementation.md`, `standards/global/conventions.md` + `coding-style.md`, `standards/global/error-handling.md` (discovered — typed exceptions preserved).

**TG2 (families)**: `standards/backend/security.md` (`_require_*` co-located), `standards/global/minimal-implementation.md` (layered split, no triad), `standards/backend/queries.md` + `models.md` (queries → repository.py, no commit/flush there), `standards/global/conventions.md` + `coding-style.md`.

**TG3 (circulation)**: `standards/global/minimal-implementation.md` (thin domain/, plain-function ledger port not Protocol, no authz.py), `standards/backend/security.md` (`_require_item_owner` / `_require_party_to_reservation` co-located), `standards/backend/queries.md` + `models.md` (eager-load options verbatim into repository.py; repos never commit/flush), `standards/global/conventions.md` + `coding-style.md`.

**TG4a (groups service)**: `standards/global/minimal-implementation.md` (thin domain/, minimal ACLs, no authz.py, delete dead code), `standards/backend/security.md` (`_require_*` co-located with guarded mutations), `standards/backend/queries.md` + `models.md`, `standards/global/conventions.md` + `coding-style.md`. Checked & N/A: `backend/plugin-auth.md`, `backend/jooq.md`.

**TG4b (groups router)**: `standards/backend/api.md` (REST route conventions unchanged), `standards/global/conventions.md` + `coding-style.md`, `project/architecture.md` (vertical exports `router` at stable path; `main.py` unchanged).

---

## 2026-09-10 — TG0 Baseline Capture — DONE (no commit)

- `git status --porcelain src/` → clean (the earlier crud-terms WIP was committed as `7048c80` before this session's work; a new `03ac31f` commits the planning artifacts).
- `uv run pytest -q` → **113 passed**, exit 0 (~40s).
- `uv run ruff check .` → 2 pre-existing E501 errors, both `app/organizations/models.py` (out of scope). None in core/families/circulation/groups.
- `uv run mypy .` → 4 pre-existing errors: `organizations/service.py:88` (oos); `groups/service.py:612`, `:618` (`int|None` vs `int` on the fulfill_pledge→circulation calls); `groups/service.py:904` (redundant cast). Gate = "no NEW findings vs these".
- **Pre-refactor `db.commit`/`db.flush` site counts** (for the D1 check): `circulation/service.py` = **15**, `groups/service.py` = **22**, `families/service.py` = **13**, `core/auth_deps.py` = **0**.
- Route snapshot: `verification/routes_before.txt` = **101 OpenAPI operations** (method + path + operationId + response codes). Captured via `app.openapi()` — NOT `app.routes` (this FastAPI version wraps includes in `_IncludedRouter` objects without a flat `.path`). TG4b diffs `routes_after.txt` against this.

Deferred-items tracker (to keep updated):
- [ ] D3 triplicated organizer-slug resolution + 500-vs-None divergence — moved as-is, not consolidated (TG4a)
- [x] `circulation/domain/balance_state_machine.py` extraction — **DEFERRED** (TG3). The `InventoryBalance`
      transition field-mutation cascades (`if reservation_type == LEND: balance.status = ...` in
      create_reservation/create_swap/confirm/cancel/fulfill) stay inline in `circulation/application/`.
      Behavior-risk refactor on D2-untested paths. Candidate follow-up.
- [x] `application/` module merges forced by import cycles — **TG4a**: `groups/application/circles.py`
      absorbed `leaderships.py` (genuine cycle: `assign_leadership` → `get_group`;
      `get_own_circle`/`update_group` → `list_active_leaderships_for_party`/`_require_active_organizer`).
      Merged per cross-cutting rule 3, no TYPE_CHECKING/local-import hacks. `group_roles.py` stayed separate.
- [ ] any behavior/perf/N+1 issue noticed in passing (log only) — none flagged TG1–4a

---

## 2026-09-10 — Implementation Complete

**Commits on `main`** (code): `5623352` TG1 · `617cb1a` TG2 · `0b695e2` TG3 · `e33cecf` TG4a · `0cefd98` TG4b
(+ interleaved `docs(refactor):` tracking commits).
**Final full gate**: `pytest` **113 passed** (49s) · `ruff check app` **2** (baseline, `models.py` only) · `mypy app` **4** (baseline set, 3 in-scope carried verbatim to new locations) · OpenAPI route dump **101 ops, byte-identical** to pre-refactor.
**File-size outcome** (was: service.py 983 / 569 / 418, router.py 378, auth_deps.py 323):
largest in-scope file now `groups/application/public_view.py` **290**; everything else ≤234.
`groups/schemas.py` (258) + `groups/models.py` (220) untouched (D8 / out of scope).
**Standards Reading Log**: complete for TG1–TG4b (see above).
**Deferred / follow-ups** (see tracker): D3 slug-resolver consolidation; `circulation/domain/balance_state_machine.py` extraction; standards-update candidate (the `repository.py` / `application/` / `infrastructure/*_acl.py` per-vertical pattern, now demonstrated 4×).
**Forced merges**: 1 — `groups/application/leaderships.py` → `circles.py` (real import cycle).
**No behavior/perf/N+1 issue applied**; none noted worth flagging beyond the deferred list.

---

## 2026-09-10 — TG4b groups router package — COMPLETE — commit `0cefd98`

**Steps**: 4b.1–4b.8 (4b.5 optional ordering-test skipped; runtime resolution verified via TestClient instead).
**Files**: deleted `groups/router.py`; created `groups/router/{__init__,circles,leaderships,memberships,terms,pledges}.py`. `main.py` + `groups/{service,schemas,models}.py` untouched.
**Handlers moved verbatim.** `circles.py` preserves top-to-bottom declaration order → `/mine/attendances`, `/public/*`, `PATCH /{group_id}` all before `GET /{group_id}`. `__init__.py` includes sub-routers circles→leaderships→memberships→terms→pledges with the load-bearing-order guard comment. No prefix (paths are absolute `/api/...` literals, matching the old file).
**Import-path change** (required, not behavior): `from . import service` → `from app.groups import service` (one level deeper).
**Gate**: `pytest` 113 (49.98s); `ruff check app` 2 baseline; `ruff format --check app/groups/router/` clean; `mypy app` 4 (unchanged from post-TG4a). **Route-dump diff empty — 101 ops identical** (`verification/routes_after.txt`).
**Non-verbatim**: `ruff format` collapsed 2 multi-line handler signatures in `terms.py` (old `router.py` was pre-existing format debt) — whitespace only, logic byte-identical.

---

## 2026-09-10 — TG4a groups service full DDD — COMPLETE — commit `e33cecf`

**Steps**: 4a.1–4a.6 done (gated after each internal sub-move).
**Files**: `groups/service.py` 983→facade (36 re-exports, `__all__`); new `domain/{__init__,organizer_slug}.py`, `application/{__init__,circles,group_roles,memberships,terms,pledges,pledge_fulfillment,public_view,account_merge}.py`, `infrastructure/{__init__,repository,circulation_bridge,organizations_acl,slug_resolver}.py`. `models.py`/`schemas.py`/`router.py` untouched.
**Sanctioned edit (d)**: `end_group_role` deleted — `grep -rn end_group_role app tests` = 0 before and after.
**Forced module merge (rule 3)**: `application/leaderships.py` folded into `application/circles.py` — real bidirectional import cycle (`assign_leadership`→`get_group`; circle fns→`_require_active_organizer`/`list_active_leaderships_for_party`). Logged; no hacks.
**D3**: `resolve_organizer_slug` → `infrastructure/slug_resolver.py` verbatim; `_resolve_organizer` → `public_view.py` verbatim; `get_public_circle_view`'s inline organizer-slug block left INLINE (not routed through either). 500-on-missing-profile (`get_public_circle_view`) vs `None` (`_resolve_organizer`) divergence preserved.
**ACLs**: `circulation_bridge.py` is the only groups module importing `app.circulation` (4 pass-throughs + `ReservationStatus` re-export); `organizations_acl.py` the only one importing `app.organizations`. grep-verified.
**Verbatim check**: 47 old top-level fns; all 46 relocated (`end_group_role` deleted). `_fallback_organizer_slug` in `domain/`.
**Gate**: `pytest` 113 (40.69s); `ruff check app` 2 baseline; `ruff format --check` clean on all new files; `mypy app` **exactly 4** — the 3 in-scope carried verbatim to new locations, NOT fixed: `pledge_fulfillment.py:43` + `:49` (arg-type `int|None`, was `service.py:612/618`), `public_view.py:251` (redundant-cast, was `service.py:904`).
**Commit/flush**: `application/*` = **21** = pre-refactor 22 − `end_group_role`'s deleted commit (D1 satisfied — every *surviving* commit/flush preserved in place, incl. `merge_anonymous_profile`'s `pg_advisory_xact_lock`). `domain/` + `repository.py` = 0. Plan grep-check note updated 22→21.
**Inline-query carve-outs**: `soft_delete_needed_item`'s pledge query + `create_rsvp`'s attendance lookup kept inline (routing to `repository` would force a new `cast()` — forbidden). Bodies byte-identical.
**Line counts**: all new modules ≤234 except `public_view.py` 290 (verbatim multi-para docstrings + 2 large inline-preserved fns; cohesive).
**ruff baseline correction**: the 2 pre-existing E501 are `groups/models.py:218` + `organizations/models.py:124` (earlier note misread one as `organizations/models.py:220`). Both in untouched `models.py`. Fixed in baseline.md.

---

## 2026-09-10 — TG3 circulation full DDD — COMPLETE — commit `0b695e2`

**Steps**: 3.1–3.6 done (implementer gated after each internal sub-move).
**Files**: `circulation/service.py` 569→facade (22 re-exports); new `domain/{__init__,constants,reservation_rules}.py`, `application/{__init__,identity,inventory,inventory_items,reservations,reservation_transitions,accounts}.py`, `infrastructure/{__init__,repository,ledger}.py`. `models.py`/`schemas.py`/`router.py` untouched.
**Sanctioned edit (b)**: `_load_reservation_for_transition` — dedups the confirm/cancel/fulfill item+holder lookup.
**Executor correction applied on review**: implementer's first cut folded `get_reservation` + `get_item` + `_current_holder_user_id` all into the helper, moving `get_item`/`_current_holder_user_id` *before* each caller's status guard — a benign but real reordering (re-cancel a CANCELLED reservation whose item was later soft-deleted would return 404 instead of 409). Reshaped so each caller does `get_reservation` → status guard → `_load_reservation_for_transition(reservation)` → `_require_party_to_reservation`, exactly matching the pre-refactor short-circuit order. Re-verified: `test_circulation` + `test_product_resolution` 15 pass, full suite 113 pass.
**`_post_circulation_transaction` → `post_circulation(db, *, giver_user_id, amount, description)`** — plain async fn, no Protocol; only place a `CirculationTransaction` is built; `db.flush()` inside verbatim.
**Verbatim check**: all 29 old top-level fns relocated (only `_post_circulation_transaction` renamed). `_current_holder_user_id` ordering (`reserved_at.desc(), id.desc()`) preserved in `repository.latest_fulfilled_reservation_for_item`.
**Gate**: `pytest` 113 (39.10s); `ruff check app` 2 baseline; `ruff format --check app/circulation/` clean; `mypy app` 4 baseline, same line numbers.
**Commit/flush**: `application/*` + `ledger.py` = **15** (= pre-refactor); `domain/` + `repository.py` = **0**.
**mypy note**: 2 new `cast(int, x.id)` added in `accounts.py` + `reservation_transitions._current_holder_user_id` — the established `Mapped[int]` `.id` idiom, not new logic.
**No forced module merges.**

---

## 2026-09-10 — TG2 families split — COMPLETE — commit `617cb1a`

**Steps**: 2.1–2.8 done. **Files**: created `repository.py` (5 fns, 0 commit/flush), `bootstrap.py` (3), `members.py` (2), `primary_contact.py` (1), `guardians.py` (4 fns + `_require_family_guardian`); `service.py` 418→47 lines (flat facade, `__all__`=14).
**Sanctioned edit (a)**: `_require_family_guardian(db, family_id: int, caller_party_id: int)` extracted from the byte-identical checks in `rename_family` + `remove_family_member`; both call sites now call it; last-guardian 409 stayed inline in `remove_family_member`.
**Consequential micro-edit**: in `remove_family_member`, `family = await get_family(...)` → `await get_family(...)` (assignment dropped — `family` became unused after the guardian subquery moved into the helper; call kept for its 404 side-effect). Behavior identical, covered by `test_families.py`.
**Formatting**: `create_own_family`'s 3-line signature collapsed to 1 line by `ruff format` (pre-existing `families/service.py` was not format-clean); body unchanged.
**Verbatim check**: all 15 old top-level functions found relocated; `_require_family_guardian` present.
**Gate**: `pytest` 113 passed (48.72s); `ruff check app` = 2 baseline; `mypy app` = 4 baseline (unchanged); `ruff format --check app/families/` clean.
**Commit/flush**: bootstrap 5 + guardians 4 + members 3 + primary_contact 1 + repository 0 = **13** (= pre-refactor).
**No forced module merges.** No new deferred items.
**Baseline correction**: `verification/baseline.md` "ruff format --check . clean" was wrong — 9 pre-existing files repo-wide would reformat (incl. `groups/service.py`, `groups/router.py` — both replaced in TG4a/b). Format gate is now per-TG-touched-files only. Corrected in baseline.md.

---

## 2026-09-10 — TG1 core/auth_deps split — COMPLETE — commit `5623352`

**Steps**: 1.1–1.9 all done.
**Files**: created `app/core/authorization_matrix.py`, `app/core/_auth/{__init__ (0 bytes),token,principal,dependencies,exception_handlers}.py`; modified `app/core/auth_deps.py` (323→41 lines, flat facade, `__all__` = 6 symbols, no matrix re-export); modified `tests/test_authorization_matrix.py` (import line → `app.core.authorization_matrix`).
**Verbatim checks**: matrix block (banner→EOF) `diff` empty, 155 lines each — byte-identical rows + evaluation order. All 10 moved auth symbols string-matched verbatim into destinations.
**Gate**: `pytest` 113 passed (48.66s); `ruff check app` = 2 baseline errors; `mypy app` = 4 baseline errors (unchanged — TG1 doesn't touch groups/organizations); `ruff format --check` clean on touched files.
**Grep**: 13 `from app.core.auth_deps import` hits all resolve via facade; exactly 1 `from app.core.authorization_matrix import` (the test); 0 matrix refs left in `auth_deps.py`.
**Notes**:
- Subagent used absolute imports (`from app.core._auth.token import ...`) not relative — matches codebase convention, ruff `I` clean.
- Baseline was captured with `ruff check app` / `mypy app` scope; `ruff check .` / `mypy .` also flag ~50 pre-existing findings in `tests/` — noise, not from this work. Gate is evaluated at `app` scope per `verification/baseline.md`.
- LF→CRLF git warnings on commit (repo `core.autocrlf=true`) — standing repo condition, applies to untouched files too. Not acted on.

---
