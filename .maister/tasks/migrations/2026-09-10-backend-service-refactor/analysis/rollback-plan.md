# Rollback Plan — Backend Service Decomposition

**Date**: 2026-09-10
**Migration type**: architecture / structural refactor
**Delivery**: incremental commits directly to `main` (no PRs, no feature branches).

---

## Why rollback is trivial here

- **No database schema changes** — zero Alembic revisions created or run.
- **No data migrations** — no rows read, transformed, or written by migration code.
- **No wire-format / API contract changes** — routes, response models, status codes, error envelopes unchanged.
- **No config / infra changes** — `main.py`, environment, dependencies untouched.
- **No external state** — nothing published, no caches primed, no third-party calls.

Therefore **rollback = pure `git` operation**. Reverting a commit fully restores the prior code state; the database, running app, and clients need nothing done to them. There is no "down migration", no data repair, no cache flush.

---

## Commit map (one focused commit per step)

| Step | Scope | Files touched |
|---|---|---|
| 1 | `core/auth_deps` split + `authorization_matrix.py` | `app/core/auth_deps.py`, `app/core/_auth/*`, `app/core/authorization_matrix.py`, `tests/test_authorization_matrix.py` |
| 2 | `families` split + guardian dedup + facade | `app/families/{service,bootstrap,repository,guardians,members,primary_contact}.py` |
| 3 | `circulation` full DDD + `ledger` + facade | `app/circulation/{service}.py`, `app/circulation/{domain,application,infrastructure}/*` |
| 4a | `groups` service full DDD + ACLs + delete `end_group_role` + facade | `app/groups/{service}.py`, `app/groups/{domain,application,infrastructure}/*` |
| 4b | `groups/router/` package | `app/groups/router/*` (replaces `app/groups/router.py`) |

Steps 3 and 4a may each be committed as several sub-commits (repository extraction / ACL / domain / application / facade) — see spec §"Step Sequence". Each sub-commit is independently revertible in reverse order.

---

## How to detect a bad step

Run the full gate after **every** commit, from `src/backend`:

```
uv run pytest                    # ~113 integration tests (Docker + TestContainers Postgres 18)
uv run ruff check .
uv run ruff format --check .
uv run mypy .
```

Plus the per-step grep / route-dump checks in `implementation/spec.md`.

A step is **bad** if any of these occur:

| Signal | Meaning | Typical cause |
|---|---|---|
| `pytest` pass count drops / any test errors | behavior regression OR import break | a moved function body was altered; a facade missing a symbol; a commit boundary shifted |
| `ImportError` / `ModuleNotFoundError` at collection time | facade incomplete or circular import | facade not re-exporting a symbol an old path needs; two `application/` modules import each other cyclically |
| `mypy` new errors | annotation lost in the move, or `cast(...)` dropped | editing instead of moving verbatim |
| `ruff` new findings (E/F/I/UP/B/SIM) | unused import, unsorted imports, unused symbol | leftover imports in the gutted source file, or facade `__all__` mismatch |
| route dump diff non-empty (step 4b) | route registration order or a route definition changed | sub-router include order wrong in `router/__init__.py` |
| `db.commit`/`db.flush` count differs from baseline per vertical | a commit boundary moved (D1 violation) | helper extraction absorbed a commit; a move dropped/added a flush |
| grep shows `app.circulation` / `app.organizations` imported outside the ACL modules (groups) | ACL boundary violated | `application/` module imports the vertical directly |

---

## Rollback procedure

### Single bad step, caught immediately (nothing committed on top)

```
cd C:\Users\karas\Desktop\group-thing-app
git revert --no-edit <bad_sha>
cd src/backend && uv run pytest && uv run ruff check . && uv run mypy .
```
`git revert` creates a new commit undoing the change — history stays linear and forward-only, which is correct for `main`. Do **not** `git reset --hard` on `main` (it rewrites shared history).

If the bad step was the most recent commit and it is easier to fix forward than revert-and-redo, fix forward with a follow-up commit — either is acceptable since there is no external state. Prefer `git revert` when the step is large or the fix is unclear.

### Bad step discovered after later steps landed on top

Because each step is a self-contained commit, revert just the offending one:

```
git revert --no-edit <bad_sha>
```

Conflicts are possible only where a later step edited the same lines (e.g. reverting step 4a after 4b landed — 4b's `router/` package calls the facade that 4a created). Resolution:

1. `git revert --no-edit <step_4a_sha>` → Git reports conflicts in the facade / any file 4b also touched.
2. Since steps 4a and 4b together form the `groups` refactor, the clean rollback is **both**: `git revert --no-edit <step_4b_sha> <step_4a_sha>` (revert 4b first, then 4a), restoring the pre-`groups` state (flat `service.py` + flat `router.py`).
3. Run the gate. `groups` is back to baseline; steps 1–3 remain in place and green.

The same "revert the whole vertical's commits, newest first" rule applies if step 3 (`circulation`) is bad after step 4a landed — revert 4a then 3, because 4a's `circulation_bridge.py` depends on the step-3 facade. Reverting 3 alone would break 4a.

### Dependency-aware revert order

| If bad step is… | Revert these, newest-first |
|---|---|
| 1 (`auth_deps`) | just 1 — nothing depends on its internal split (facade path unchanged) |
| 2 (`families`) | just 2 — no other step touches `families` |
| 3 (`circulation`) | 4b, 4a, 3 if 4a/4b landed (groups ACL + bridge depend on the circulation facade); else just 3 |
| 4a (`groups` service) | 4b, 4a if 4b landed; else just 4a |
| 4b (`groups` router) | just 4b — restores flat `router.py`, keeps the 4a service split |

After any revert: **full gate green** is the exit criterion. The database is untouched throughout — no `alembic downgrade`, no data step, no restart required beyond the normal app reload.

---

## Post-rollback state

- Code: back to the last-known-green commit for the affected vertical(s); other verticals keep their completed refactor.
- Database: unchanged (never modified by this migration).
- Tests: full suite green.
- Follow-up: re-attempt the reverted step with the fix identified from the failure signal, as a fresh commit.
