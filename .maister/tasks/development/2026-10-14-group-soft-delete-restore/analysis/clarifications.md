# Clarifications (Phase 1)

Date: 2026-10-14

| # | Question | Answer |
|---|----------|--------|
| 1 | Upcoming terms with RSVPs when organizer deletes the group | **Block deletion** — 409 BusinessConflictException ("Grupa ma nadchodzące terminy z zapisami — najpierw je odwołaj"). |
| 2 | Record who deleted the group | **Yes** — `deleted_by_party_id` column next to `deleted_at`; admin list shows "Usunięta <data> przez <imię>". |
| 3 | Pre-existing hole: POST /api/leaderships/{id}/end has no ownership check | **Fix in this task** — only the active organizer of that group (or ADMIN) may end it; add test. |
| 4a | Locked reservations on a deleted group | **Can be confirmed/cancelled** (confirm/cancel transaction must still find terms of deleted groups). |
| 4b | Withdrawals on a deleted group | **Allowed** (withdraw attendance, pledge, join request). |
| 4c | Restore of a non-deleted group | **409**. |
| 4d | Term-end scheduler (term_end_scan) | **Keeps processing** terms of deleted groups (reservations are real). |

Previously decided (conversation before workflow):
- No retention / hard delete for now.
- Delete does NOT end Leadership (restore = clear deleted_at; future group transfer/sale is a separate Leadership operation, out of scope).
- Panel trash opens a confirmation dialog before DELETE.
