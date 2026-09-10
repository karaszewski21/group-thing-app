# Standards Compliance Checklist — verification

Task: single-claim pledges + in-app `notifications` module.
Plan: `C:\Users\karas\.claude\plans\sparkling-conjuring-lerdorf.md`
Verified: 2026-09-10, after implementation.

## `standards/backend/models.md`

| Item | Verdict | Evidence |
|---|---|---|
| `Notification.party_id` is a bare FK-id column — no cross-module `relationship()` | ✅ PASS | `app/notifications/models.py` — `party_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("parties.id", name="fk_notifications_party_id_parties"), nullable=False)`. No `relationship()` anywhere in the vertical. |
| `NotificationKind` is a `String`-backed `enum.StrEnum` via a local `_enum_column` (duplicated per vertical, not shared) | ✅ PASS | `models.py:23-31` — the `_enum_column` helper copied verbatim from `app/groups/models.py`; `kind` column is `_enum_column(NotificationKind, 30)` → `VARCHAR(30)`, no native PG type. |
| `Notification` extends `BaseEntity`; `__sequence_name__ = "notification_seq"`; `updated_at` never set manually | ✅ PASS | `class Notification(BaseEntity)`, `__sequence_name__ = "notification_seq"`. `mark_read` sets only `read_at`; `updated_at` handled by the `version_id_generator`. |
| `pledges` single-active-claim enforced by a **partial unique index** declared in the migration, not inferred from the model | ✅ PASS | `0023_pledges_single_active_claim.py` — `op.create_index("uq_pledges_active_needed_item", "pledges", ["needed_item_id"], unique=True, postgresql_where=sa.text("status <> 'WITHDRAWN'"))`. No model change. |
| every `needed_items` / joined pledge read keeps the `deleted_at IS NULL` filter (incl. `list_my_pledges_joined`) | ✅ PASS | `repository.list_my_pledges_joined` — `.where(..., NeededItem.deleted_at.is_(None))`. `_notify_organizer_about_pledge` uses `repository.get_needed_item` (which the app-layer `get_needed_item` 404s on soft-deleted) and returns silently if `None`. |

## `standards/backend/migrations.md`

| Item | Verdict | Evidence |
|---|---|---|
| `0022` = notifications schema only; `0023` = single-claim (data-prep `UPDATE` + partial unique index, one logical change, `0013` precedent) | ✅ PASS | `0022` is pure DDL (create sequence + table + index). `0023` is one concern ("enforce single active claim"): the dedup `UPDATE` is a precondition for the index it creates — same shape as `0013` (add-column + backfill + not-null + unique in one file). |
| `notification_seq` via `op.execute("CREATE SEQUENCE …")` + `ALTER SEQUENCE … OWNED BY`, never `IDENTITY`/`SERIAL` | ✅ PASS | `0022` copies `_create_sequence` / `_own_sequence` / `_sequenced_id` from `0012`. |
| every `downgrade()` reverses its `upgrade()`; round-trips cleanly | ✅ PASS | `0022` downgrade: `ALTER SEQUENCE … OWNED BY NONE` → `drop_table` → `DROP SEQUENCE`. `0023` downgrade: `drop_index`. Verified on scratch DB: `upgrade head` (notifications table + `notification_seq` + `uq_pledges_active_needed_item` present) → `downgrade 0021` (all gone) → `upgrade head` clean. (`downgrade base` fails at revision 0012 on `organization_membership_seq` — a **pre-existing** repo bug, unrelated to this chain.) |
| names `pk_notifications` / `fk_notifications_party_id_parties` / `ix_notifications_party_id` / `uq_pledges_active_needed_item`; docstrings carry Revision/Revises/Create Date | ✅ PASS | Exact names in `0022`/`0023`. Both docstrings carry the three header lines. |

## `standards/backend/api.md`

| Item | Verdict | Evidence |
|---|---|---|
| plural nouns (`/api/notifications`, `/api/pledges/mine`), nesting ≤ 3, query-less collection reads | ✅ PASS | `APIRouter(prefix="/api/notifications")`; routes `/mine`, `/unread-count`, `/{id}/read`, `/read-all` — max depth 2. `GET /api/pledges/mine` — depth 2. |
| status codes 200/201/204/403/404/409 as mapped | ✅ PASS | `mark_read`/`mark_all_read` → 204; `mark_read` other party → 403; unknown notification → 404; `create_pledge` dedup → 409; `list`/`unread-count`/`mine` → 200. Covered by `test_notifications.py` + `test_groups.py`. |

## `standards/backend/security.md`

| Item | Verdict | Evidence |
|---|---|---|
| two `AUTHORIZATION_MATRIX` rows for `/api/notifications` added **before** the row-25 catch-all, matching the routes' `require_any(...)` | ✅ PASS | `authorization_matrix.py` rows 51-52: `GET ^/api/notifications(/.*)?$` → `("READ","mcp:read")`, `POST ^/api/notifications(/.*)?$` → `("EDIT","mcp:edit")`, immediately before the catch-all. Router declares `ReadPrincipal`/`EditPrincipal` matching. |
| recipient-ownership ("only my notifications") enforced in `service.mark_read` via `AccessDeniedException`, not the matrix | ✅ PASS | `service.mark_read` — `if notification.party_id != party_id: raise AccessDeniedException`. `test_markRead_otherPartysNotification_returns403`. |
| `test_authorization_matrix.py` gets `resolve_requirement` assertions for the new paths | ✅ PASS | `+test_resolveRequirement_pledgesMine_resolvesToRead`, `+..._notificationsMine_resolvesToRead`, `+..._notificationsMarkRead_resolvesToEdit`. |

## `standards/backend/queries.md`

| Item | Verdict | Evidence |
|---|---|---|
| `list_for_party` / `list_my_pledges_joined` are explicit `select().where().order_by()` with SQL-level `LIMIT`, no in-Python sort/slice, no N+1 | ✅ PASS | `notifications/repository.py::list_for_party` — `.order_by(created_at.desc()).limit(50)`. `list_my_pledges_joined` — single 4-join `select`, `.order_by(Term.occurs_on, Pledge.id)`; slug resolved once per DISTINCT group (bounded loop, `list_my_attendances` precedent). |
| `ix_notifications_party_id` covers the recipient filter | ✅ PASS | Created in `0022`; every notification query filters `party_id ==`. |

## `standards/global/error-handling.md`

| Item | Verdict | Evidence |
|---|---|---|
| `BusinessConflictException` (409) / `AccessDeniedException` (403) / `EntityNotFoundException` (404) reused — no generic raises | ✅ PASS | `create_pledge` → `BusinessConflictException(...)`; `mark_read` → `AccessDeniedException` / `EntityNotFoundException`. No bare `raise Exception` / `HTTPException` in the new code. |
| single-claim check runs before any write in `create_pledge` | ✅ PASS | `pledges.py::create_pledge` — `repository.list_pledges_for_needed_item` + `any(status != WITHDRAWN)` 409 fires before `db.add(pledge)`. |
| a missing circle organizer makes notification creation a silent no-op, never a 500 on the pledge | ✅ PASS | `_notify_organizer_about_pledge` — `if needed_item is None / term is None / leadership is None: return`. `soft_delete_needed_item` guards `if affected_party_ids`. `notifications_service.create_notification` only `db.add()`s (no commit), so a flush failure would surface on the caller's own commit, not mid-notification. |
| 409 message is user-facing Polish | ✅ PASS | `"Ktoś już zadeklarował przyniesienie tej rzeczy"`. |
| no try/except in routers — 409/403/404 handled at the boundary | ✅ PASS | `notifications/router.py` + the pledge/needed-item router diffs add no try/except; all handled by `app/core/errors.py`. |

## `standards/global/minimal-implementation.md`

| Item | Verdict | Evidence |
|---|---|---|
| `notifications` vertical ships only what's called | ✅ PASS | `service.py` `__all__` = `create_notification` (5 callers across groups), `list_my_notifications` / `count_unread` / `mark_read` / `mark_all_read` (router only). No `NotificationChannel` enum, no scheduler, no delivery abstraction. `repository.get` is used by `mark_read`. |
| the `# TODO: notify pledger` comment in `terms.py:158` is replaced by a real call, not left | ✅ PASS | `_withdraw_pledge_row` (and its TODO) deleted; `soft_delete_needed_item` now stages a `NEEDED_ITEM_REMOVED` notification per affected pledger. `test_deleteNeededItem_claimedPledge_transitionsToWithdrawn` asserts it. |
| no `setInterval` poll added | ✅ PASS | `unreadCount` in `PanelDataContext` is `notifications.filter(n => n.read_at === null).length` — derived from the load-time list; refreshed by `load({ silent: true })` after actions. `grep setInterval src/` → none. |

## `standards/frontend/components.md` + `standards/testing/frontend-testing.md`

| Item | Verdict | Evidence |
|---|---|---|
| the header bell + dropdown is a section of `PanelHeader` reusing the existing `menuOpen` overlay pattern — not a new monolith | ✅ PASS | `PanelHeader.tsx` — the bell dropdown copies the `menuOpen` overlay+panel structure (fixed backdrop button + `role="menu"` panel); state (`notifOpen`, `openNotification`, `markAllRead`) lives in `PanelDataContext`. |
| `api/notifications.ts` mocked at module level with `vi.mock` factory; tests in `src/test/` | ⚠️ PARTIAL | Mocked with `vi.mock("../api/notifications", () => ({...}))` in `src/test/PanelPage.test.tsx`. **Deviation**: no standalone `src/test/notifications.test.tsx` — the bell only exists inside the panel shell (no isolated render path), so the 5 bell tests + 3 "Zadeklarowane rzeczy" tests live in `PanelPage.test.tsx` next to the shared `mockGuestDefaults()` surface, per the "all mocks in one file" convention. |

## Gate results

- `uv run pytest` (src/backend) → **136 passed** (was 124 baseline; +12: 5 `test_notifications` + 3 `test_authorization_matrix` + 3 `test_groups` + 1 `test_pledge_fulfillment`).
- `uv run mypy app` → **4 errors** = exact baseline.
- `uv run mypy .` → **19 errors in 9 files** = exact baseline (no test-file regression).
- `uv run ruff check app` → **1 error** (pre-existing `organizations/models.py` E501) = baseline.
- `uv run ruff format --check` on all new/touched files → clean.
- Migration round-trip verified on scratch DB (`0021 ↔ 0023`).
- `npx vitest run` (src/frontend) → **201 passed / 2 failed** — the 2 failures (`auth.test.tsx`, `extension-points.test.tsx`) are the pre-existing known-fail set; +9 new.
- `npx tsc -b --noEmit` → 4 errors, all in `src/test/auth.test.tsx` (baseline).
- `npm run lint` → 21 problems (19 errors + 2 warnings) = exact baseline.
- Manual E2E: guest pledge → 201 + organizer `PLEDGE_CREATED` notification (unread-count 1, link to term page); second claim → 409 "Ktoś już zadeklarował…"; panel "Zadeklarowane rzeczy" lists the pledge with a working "Rezygnuję"; bell dropdown renders ("Brak powiadomień" for a user with none).
