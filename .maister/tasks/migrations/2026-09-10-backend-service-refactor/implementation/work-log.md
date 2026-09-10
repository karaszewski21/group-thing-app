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

---

## 2026-09-10 — TG0 Baseline Capture — DONE (no commit)

- `git status --porcelain src/` → clean (the earlier crud-terms WIP was committed as `7048c80` before this session's work; a new `03ac31f` commits the planning artifacts).
- `uv run pytest -q` → **113 passed**, exit 0 (~40s).
- `uv run ruff check .` → 2 pre-existing E501 errors, both `app/organizations/models.py` (out of scope). None in core/families/circulation/groups.
- `uv run mypy .` → 4 pre-existing errors: `organizations/service.py:88` (oos); `groups/service.py:612`, `:618` (`int|None` vs `int` on the fulfill_pledge→circulation calls); `groups/service.py:904` (redundant cast). Gate = "no NEW findings vs these".
- **Pre-refactor `db.commit`/`db.flush` site counts** (for the D1 check): `circulation/service.py` = **15**, `groups/service.py` = **22**, `families/service.py` = **13**, `core/auth_deps.py` = **0**.
- Route snapshot: `verification/routes_before.txt` = **101 OpenAPI operations** (method + path + operationId + response codes). Captured via `app.openapi()` — NOT `app.routes` (this FastAPI version wraps includes in `_IncludedRouter` objects without a flat `.path`). TG4b diffs `routes_after.txt` against this.

Deferred-items tracker (to keep updated):
- [ ] D3 triplicated organizer-slug resolution + 500-vs-None divergence — moved as-is, not consolidated
- [ ] `circulation/domain/balance_state_machine.py` extraction — deferred under D2
- [ ] any `application/` module merges forced by import cycles
- [ ] any behavior/perf/N+1 issue noticed in passing (log only)

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
