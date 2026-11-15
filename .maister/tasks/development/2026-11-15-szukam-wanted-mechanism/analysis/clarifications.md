# Clarifications (Phase 1)

## TL;DR
- All 13 proposals of the high-level design (P1–P13) are accepted as written.
- The bell row for new matches is replaced by delete-unread-then-insert, not by an in-place update.
- The closing prompt appears after a take only, not after a swap proposal.
- `EXPLAIN ANALYZE` on seeded data is in scope; the labelled Polish sample is a follow-up before release.

## Key Decisions
- Accept P1–P13 — the code analysis found no obstacle to any of them; thresholds 0.70 / 0.60 stay starting values.
- Delete the want's previous unread match row and insert a new one with the summed count — an in-place update breaks the "`created_at` is set once" rule of `BaseEntity` and can collide with `mark_read`.
- Closing prompt after a personal or term/event take only — a swap proposal is not an agreement and can be rejected.
- Measure the match statement with `EXPLAIN ANALYZE` in this task and decide on the `item_listing_preferences.created_at` index from it — the labelled sample of Polish pairs is a separate task.

## Open Questions / Risks
- Thresholds stay unmeasured at the end of this task; release should wait for the labelled sample.
- Still open from the code analysis, to settle in gap analysis or the specification: "Tylko tu" stored as null or radius 0; the "proposed by me" flag; the not-found link target of `/wanted/:id`; a clear control for the category picker; the "Konto" tab highlight on sub-routes.

## Questions and answers

| # | Question | Answer |
|---|---|---|
| 1 | How to handle the 13 proposals P1–P13 of the high-level design? | Accept all 13. |
| 2 | Bell row for new matches: update in place or delete and insert? | Delete unread + insert new. |
| 3 | When does the "Zamknij poszukiwanie / Szukam dalej" prompt appear? | After a take only (personal or term/event). |
| 4 | Is the measurement plan part of this task? | `EXPLAIN ANALYZE` in scope, labelled sample later. |

## Accepted proposals (from `research-context/high-level-design.md`, "Proposals to confirm")

| # | Proposal |
|---|---|
| P1 | Module `app/wants`; tables `wants`, `want_matches`, `want_scan_markers`; API prefix `/api/wants`; frontend folder `features/wanted`. |
| P2 | Scan interval 15 minutes; overlap 5 minutes. |
| P3 | Thresholds 0.70 without a category and 0.60 with one; full text over name and description. |
| P4 | Takeable = `AVAILABLE`, no pending proposal, live pickup place; shared terms and events are not checked. |
| P5 | Notification pointer and count kept on the want; rows written by the scan, not through the outbox. |
| P6 | Kind names `WANT_MATCH_FOUND` and `WANT_EXPIRING`. |
| P7 | The reminder is sent even when the per-want switch is off. |
| P8 | Automatic extension on opening the match list in the last 30 days: on. |
| P9 | Withdrawn wants are hidden from the list during retention. |
| P10 | Editing a matching field deletes the want's matches and re-runs the forward query. |
| P11 | `/api/wants` accepts the login token only, not the OAuth `mcp:*` scopes (copy the conversations rows, not the notifications rows). |
| P12 | No redirect from `/add/hunting` to `/add/wanted`. |
| P13 | `wants` joins the guarded modules in `tests/test_module_boundaries.py`. |
