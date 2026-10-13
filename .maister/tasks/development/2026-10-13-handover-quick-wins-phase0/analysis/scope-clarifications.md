# Scope Clarifications (Phase 2 decision gate)

All decisions: user chose the recommended option.

## Critical
| # | Decision | Choice |
|---|---|---|
| C1 | Item page privacy for group_name / term_id / calendar button | Only the reservation's two parties (`reserved_by_user_id` / `giver_user_id`); null for everyone else |
| C2 | Taker loses confirm prompt (bell click / mark-all / snooze) | Accept gap until Phase 1 agenda; document in spec |

## Important
| # | Decision | Choice |
|---|---|---|
| I1 | Join requests in app-wide modal | Move to `usePendingJoinRequests` TanStack hook; shown app-wide; same 08:00 snooze |
| I2 | Snooze granularity | Per action id; ✕ = "Później"; "Rozumiem"/"Zobacz w Moje rzeczy" still mark read |
| I3 | Panel refresh after modal action | Host invalidates queries + emits `onResolved`; PanelDataProvider subscribes → `load({silent:true})` |
| I4 | Clock for "next local 08:00" | Browser-local via dayjs |
| I5 | Notification date format | Short: "śr 15.10 o 16:30 — Grupa" via one backend formatter in `app/core`; scan payload carries item name, raw occurs_on, group name; listener formats |
| I6 | Swap term-end question | "Czy zamiana „A” ↔ „B” doszła do skutku?" + date + group; generic fallback for old payloads |
| I7 | ICS details | 1 h event; UID per (term_id, item_id); VALARMs `-P1D` and `-PT2H` |
| I8 | accept_swap_proposal Term gate | Add `local_now()` "Termin już się odbył" gate + test |
| I9 | TZ check | Fail-fast startup check that `ZoneInfo("Europe/Warsaw")` loads (log zone name only) + ops note; compose TZ optional |
| I10 | Settings after removing toggles | Remove "Powiadomienia" card (optionally one honest line about in-app notifications); keep "Widoczny profil publiczny" toggle unchanged |
| I11 | Clock regression guard | Replace source-inspection test with frozen-clock behavioral test + grep test rejecting `datetime.now(` / `date.today(` in `app/groups/application` |

Scope expanded: no (decisions refine Phase 0; swap-scan fix + accept gate are small additions agreed in Phase 1/2).
