# Phase 1 Clarifications

| # | Question | Answer |
|---|---|---|
| 0 | Which research phase(s) to implement? | Phase 0 only (quick wins, no schema change) |
| 1 | Test clock control | Monkeypatch helper: `local_now()` in `app/core/clock.py`, tests monkeypatch it; no new time-mocking dependency. Test helpers move from `utcnow()` to `local_now()`. |
| 2 | Swap term-end scan not scoped to the swap's own Term | Fix now (scope by `proposer_reservation.term_id`) + regression test |
| 3 | Term data (hour, group) for item page and swap-accept | Backend enrichment: additive response fields (term_id + group_name on ItemStatusResponse; term occurs_on + group_name on swap-accept response and SWAP_ACCEPTED copy). No DB change. |
| 4 | `public_view.py:251` `date.today()` | Include — all Term-time comparisons go through the domain clock |
