# Scope Clarifications (Phase 2)

Date: 2026-10-14

## Critical decisions
| id | Decision |
|----|----------|
| leadership-assign-takeover | POST /api/leaderships restricted to **ADMIN only** (closes take-over-then-delete path). |
| rsvp-block-message-unactionable | Keep the 409 block; **reword the message** (terms cannot be cancelled), e.g. "Grupy nie można usunąć — na termin 21.10 są zapisy. Spróbuj po tym terminie albo gdy uczestnicy się wypiszą." (nearest blocking date). |

## Important decisions
| id | Decision |
|----|----------|
| admin-list-ux | Active/Deleted toggle on AdminGroupsPage (PhotoModerationPage pattern). |
| admin-deleted-list-shape | `?deleted=true` on GET /api/groups/moderation; ModerationGroupResponse gains nullable `deleted_at` + `deleted_by_name`; sorted deleted_at DESC; count consistent. |
| restore-confirm | No confirm on Restore; per-row busy/error state. |
| organizer-get-deleted | **404 for everyone**; only restore (and admin list) use an including-deleted getter. |
| admin-can-delete | **Organizer OR ADMIN** may DELETE; `deleted_by_party_id` records the actor. |
| end-leadership-on-deleted | Allowed for the group's active organizer or ADMIN (restored group may then be leaderless). |
| panel-hide-behavior | Group disappears via server-filtered listings; organizer with no groups left sees guest-like panel (as today); client tolerates a 404 from getGroup instead of failing whole load. |
| delete-dialog-placement | Tailwind alertdialog opened from the SpotkaniaView trash (clone UnsavedChangesDialog), inline 409 error, focus returns to trash button. |
| rsvp-definition | Upcoming term (occurs_on >= clock.local_now()) with ≥1 TermAttendance where withdrawn_at IS NULL. |
| legacy-orphans | Leave as is (no data migration). |
| member-notification | No notifications on delete/restore. |

scope_expanded: false (leadership assign ADMIN-only is a small security addition alongside the /end ownership fix).
