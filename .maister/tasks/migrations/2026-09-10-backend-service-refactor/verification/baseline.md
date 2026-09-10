# Pre-refactor Baseline (2026-09-10)

Captured before any code changes. This is the regression reference — the refactor must not
worsen any of these.

## Test suite

`uv run pytest -q` from `src/backend`:

```
113 passed, 2178 warnings in 39.48s   (exit 0)
```

Warnings are all the pre-existing `datetime.utcnow()` DeprecationWarning — not in scope.

## ruff check

`uv run ruff check app` → **2 errors (pre-existing, out of scope):**
- `app/organizations/models.py:220` area — E501 line too long
- `app/organizations/models.py:124:101` — E501 line too long (103 > 100)

No ruff-check findings in `groups/`, `circulation/`, `families/`, `core/`.

## ruff format  (CORRECTED 2026-09-10 after TG2 — the earlier "clean" note was wrong)

`uv run ruff format --check app` → **9 files would be reformatted (all pre-existing):**
`app/footprint/engine/breakdown_scaler.py`, `app/groups/models.py`, `app/groups/router.py`,
`app/groups/service.py`, `app/oauth2/models.py`, `app/organizations/models.py`,
`app/organizations/router.py`, `app/product/query_service.py`, `app/product/router.py`.

**Gate rule for format**: check ONLY the files a task group creates/rewrites — those must be
`ruff format`-clean. Do NOT run `ruff format --check app` as a pass/fail gate; the 9 pre-existing
files are not this refactor's problem. Note `groups/service.py` + `groups/router.py` are in that
list but get fully replaced in TG4a/TG4b, so the count drops to 7 after those (an improvement,
never touch `groups/models.py`).

## mypy

`uv run mypy app` → **4 errors (pre-existing):**
- `app/organizations/service.py:88` — Redundant cast to "int" (out of scope)
- `app/groups/service.py:612` — Arg 2 to `get_or_create_personal_inventory` has type `int | None`; expected `int` **(IN SCOPE — fulfill_pledge → circulation bridge; must be carried verbatim into the ACL module, not "fixed")**
- `app/groups/service.py:618` — Arg `reserved_by_user_id` to `create_lend_reservation` has type `int | None`; expected `int` **(IN SCOPE — same; carry verbatim)**
- `app/groups/service.py:904` — Redundant cast to "int" **(IN SCOPE — in the account-merge / attendances area; carry verbatim)**

`Found 4 errors in 2 files (checked 92 source files)`

## Regression gate definition

After every commit:
1. `uv run pytest -q` → still `113 passed`, exit 0.
2. `uv run ruff check app` → still exactly 2 errors, both in `organizations/models.py`.
3. `uv run mypy app` → still exactly 4 errors (the same 4; line numbers may shift as `groups/service.py`
   code moves into new modules — the *set* of errors must not grow).
4. `git grep` spot-checks that preserved import paths still resolve (see spec per-vertical checks).

A commit that fails any of 1–4 is fixed or `git revert`ed before proceeding.
