# Standards Compliance Checklist — verification

Task: `NeededItem` → `Product` FK + fulfill-pledge with an owned item.
Plan: `C:\Users\karas\.claude\plans\sparkling-conjuring-lerdorf.md`
Verified: 2026-09-10, after implementation.

## `standards/backend/models.md`

| Item | Verdict | Evidence |
|---|---|---|
| `NeededItem.product_id` is a bare FK-id column — no cross-module `relationship()` | ✅ PASS | `app/groups/models.py` — `product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id", ...), nullable=False)`. No `relationship()`. |
| Product name/category for the response loaded via an explicit join scoped to that one query in `repository.py` | ✅ PASS | `repository.get_needed_item_with_product` / `list_needed_items_with_product_for_term` — `select(NeededItem, Product.name, Product.category).join(Product, ...)`. Mirrors the existing `UserProfile` join precedent. |
| FK + NOT-NULL declared explicitly in the migrations, not inferred from the model | ✅ PASS | `0018` `create_foreign_key` + `0020` `alter_column ... nullable=False`. |
| `NeededItemCategory` StrEnum deleted; `ProductCategory` reused as a `String`-backed enum | ✅ PASS | `class NeededItemCategory` removed from `models.py`; `schemas.py` imports `from app.product.models import ProductCategory`. |
| `deleted_at IS NULL` filter kept in every `needed_items` read incl. the new joined readers | ✅ PASS | `list_needed_items_with_product_for_term` has `.where(..., NeededItem.deleted_at.is_(None))`. `get_needed_item_with_product` is single-row; the app layer (`get_needed_item_view`) rejects `row[0].deleted_at is not None` with a 404 — same pattern as the pre-existing ORM `get_needed_item`. |

## `standards/backend/migrations.md`

| Item | Verdict | Evidence |
|---|---|---|
| One logical change per revision — `0018` add / `0019` backfill / `0020` drop | ✅ PASS | Three files, one concern each. |
| Schema DDL and data `UPDATE` in separate revisions | ✅ PASS | `0018`/`0020` are DDL only; `0019` is `op.execute` data only, no DDL. |
| Every `downgrade()` reverses its `upgrade()`; round-trips cleanly | ✅ PASS | `0018` drops index→FK→column; `0019` re-nulls `product_id`; `0020` recreates `category` + backfills + re-tightens. Round-trip (`upgrade head` → `downgrade 0017` → `upgrade head` → `downgrade 0016`) verified on scratch DB seeded with all 4 legacy categories. (`downgrade base` fails at revision 0013 — a pre-existing repo bug unrelated to this chain.) |
| Additive nullable column first, NOT-NULL + drop later | ✅ PASS | `0018` `nullable=True`; `0020` `nullable=False`. |
| Synthetic products via `nextval('product_seq')`, never IDENTITY/SERIAL | ✅ PASS | `0019` `SELECT nextval('product_seq'), ...`. |
| Names `fk_needed_items_product_id_products` / `ix_needed_items_product_id`; docstrings carry Revision/Revises/Create Date | ✅ PASS | Exact names in `0018`. All three docstrings have the three header lines. |

## `standards/backend/api.md`

| Item | Verdict | Evidence |
|---|---|---|
| URLs unchanged, plural nouns, nesting ≤ 3 | ✅ PASS | `/api/needed-items`, `/api/pledges/{id}/fulfill` — byte-identical routes; `git diff` on `router/terms.py` / `router/pledges.py` shows no path or decorator change. |
| Status codes 200/201/400/403/404/409 as mapped | ✅ PASS | 404 unknown product (`product_bridge` → `EntityNotFoundException`), 400 fulfil-mode `ValueError`, 403 not-owner/non-pledger (`AccessDeniedException`), 409 owned item not AVAILABLE (`BusinessConflictException`). Covered by `test_pledge_fulfillment.py` + `test_groups.py`. |

## `standards/global/validation.md`

| Item | Verdict | Evidence |
|---|---|---|
| `product_id` existence + "exactly one fulfil mode" validated server-side | ✅ PASS | `product_bridge.get_product` in `create_needed_item` / `update_needed_item`; `FulfillPledgeRequest._exactly_one_mode` `@model_validator`. |
| `description` capped at `max_length=500`, matching the column | ✅ PASS | `CreateNeededItemRequest` / `UpdateNeededItemRequest` — `Field(default=None, max_length=500)`; column is `String(500)`. |
| Fulfil-mode check is an allowlist of the two valid shapes | ✅ PASS | `_exactly_one_mode` accepts only `{inventory_item_id}` xor `{condition (+product_id?)}`; everything else raises. |

## `standards/global/error-handling.md`

| Item | Verdict | Evidence |
|---|---|---|
| Reuse `EntityNotFoundException` / `AccessDeniedException` / `BusinessConflictException` / `ValueError` — no generic raises | ✅ PASS | `pledge_fulfillment.py` + `product_bridge.py` + `schemas.py` — no bare `raise Exception` / `HTTPException`. |
| No try/except in routers — handled at the boundary | ✅ PASS | `router/terms.py` / `router/pledges.py` diffs add no try/except. |
| All precondition checks before any write | ✅ PASS | `fulfill_pledge`: pledger → need → term → leadership → organizer → (owned: item/inventory/ownership/balance \| new: product) all precede `register_item` / `create_lend_reservation` / the single trailing `db.commit()`. |
| 409/403 messages are user-facing Polish, no internal detail | ✅ PASS | `"Nie można użyć tej rzeczy — jest zarezerwowana lub wypożyczona"`; validator messages in Polish. `AccessDeniedException` raised bare (generic 403 envelope). |

## `standards/global/minimal-implementation.md`

| Item | Verdict | Evidence |
|---|---|---|
| Delete: old app-level `list_needed_items`, the 3 `NEEDED_ITEM_LABELS` copies, `ProductPicker.tsx` + `productPicker.ts`, `useKragGrupy.addProduct` | ✅ PASS | `git status`: `D ProductPicker.tsx`, `D productPicker.ts`. `list_needed_items` (app) gone from `terms.py`. `NEEDED_ITEM_LABELS` removed from `panelHelpers.ts`, `organizerSteps.tsx`, `EditTermDialog.tsx`. `addProduct`/`createProduct` removed from `useKragGrupy.ts`. |
| `product_bridge.py` has an immediate caller | ✅ PASS | `application/terms.py` imports and calls `product_bridge.get_product` twice. |
| No `GIFT`/tri-state persistence and no vocab-unification pulled in | ✅ PASS | No `offer_mode` / `itemModes` model change; `wypożyczę/oddam/zamienię` untouched. |

## Gate results

- `uv run pytest -q` (src/backend) → **124 passed**, exit 0 (was 113 pre-Part-3 baseline; +11 from `test_pledge_fulfillment.py` and new `test_groups.py` cases).
- `uv run mypy app` → **4 errors** = exact baseline (line numbers shifted; the 2 `int | None` fulfil-bridge errors carried verbatim per baseline.md instruction).
- `uv run mypy .` → **19 errors** = exact baseline (verified via `git stash` — no test-file regression).
- `uv run ruff check app` → **1 error** (`organization_memberships` E501) — improvement over the 2-error baseline (`ruff format` fixed `groups/models.py:218`).
- `uv run ruff format --check` on the 13 Part-3 backend files → all formatted.
- `alembic heads` → single head `0020`; clean 0017→0020 chain.
- `npx vitest run` (src/frontend) → **189 passed / 2 failed** — the 2 failures (`auth.test.tsx`, `extension-points.test.tsx`) are the pre-existing known-fail set, untouched by this change; +7 from `NeededItemQuickAddForm.test.tsx` + `KragGrupyPage.test.tsx`.
- `npx tsc -b --noEmit` → 4 errors, all in `src/test/auth.test.tsx` (pre-existing baseline).
- `npm run lint` → 21 problems (19 errors + 2 warnings) = exact baseline.
