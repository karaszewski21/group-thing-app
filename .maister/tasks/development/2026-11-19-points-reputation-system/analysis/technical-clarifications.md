# Technical Clarifications (Phase 5A)

## TL;DR
A new `app/points` bounded context owns the point tables and the single flush-only posting function. groups calls it through `groups/infrastructure/points_acl.py` before `fulfill_exchange` commits, so the award lands in the same commit as the item movement. The balance is always `SUM(amount)` over the ledger entries; there is no projection column.

## Key Decisions
- Module boundary: `app/points` plus a consumer ACL `groups/infrastructure/points_acl.py`, user choice. A boundary test asserts that points never imports groups, events or inventory; points reaches other contexts only through its own `infrastructure/*_acl.py`. The outbox-event alternative was rejected because it would break the "same commit" rule.
- Balance: read as `SUM(point_entries.amount)` per account, with an index on `account_id`. Writes lock the `point_accounts` row first, using `SELECT … FOR UPDATE` in the style of `media/service._lock_owner`. User choice.
- Reputation (from Phase 2): the sum of GIVE_FREE entries on the giver's account. It is never stored separately.
