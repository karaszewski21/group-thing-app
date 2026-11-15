# Scope clarifications (Phase 2)

## TL;DR
- All 15 decisions of the gap analysis are answered by the user: 14 follow the recommended option, one differs (the "Konto" tab highlight covers every deeper account sub-page, not only `/wanted/...`).
- The per-want notification switch is a toggle on the match list page `/wanted/:id`.
- No feature switch: the release gate "do not deploy before the labelled sample is scored" is written into `architecture.md`.
- Scope grows by one small item outside wants: the bottom navigation highlight for `/places/...` and other deeper account pages.

## Key Decisions
- Notification switch as a toggle on `/wanted/:id`, saved at once with PATCH — a want is muted where its alerts are seen; a switch-only PATCH does not re-run matching.
- "Tylko tu" is stored as null; the CHECK allows 1–100 and the API turns 0 into null — one representation, as search sends it.
- Match cards carry `reserved_by_me` and `proposed_by_me`, the second from an own EXISTS in the same statement — `with_pending_proposer` exposes only the oldest proposer.
- Counters count only pairs that pass the same read-time filter as the match list — a badge must agree with the list it opens.
- The want's unread match row is deleted on withdraw and on an edit that resets matches; other rows stay; a withdrawn want is a 404.
- "Dodaj" link on `/wanted` (also in its empty state) and "Edytuj" on `/wanted/:id`; no inline quick add — one form (ADR-013).
- One closing prompt naming every active want matched by the taken item; "Zamknij" closes all — a closed want can be reopened for 30 days.
- The closing sheet appears only on the item page after a take; the match page keeps the caption and its "Znalezione" action.
- A prefilled name outside 3–80 characters is shown as typed with an inline error and a blocked submit — no silent change of the user's text.
- `/wanted/:id` has its own not-found state linking to `/wanted`.
- `CategoryTreePicker` gets a label prop for the clear option; the want form uses "Dowolna kategoria".
- The "Konto" tab is highlighted on every deeper account sub-page (`/wanted/...`, `/places/...` and the others), by prefix — the user chose consistency over the narrower change.
- Test baseline first; no new failures; old failures are fixed only where this task rewrites the failing test.
- No feature switch; do not deploy until the labelled sample is scored; the gate is written in `architecture.md`.
- The old search user guide gets its text corrected and a pointer to the new guide; its screenshot is replaced only if this workflow produces user documentation.

## Open Questions / Risks
- The "Konto" prefix match changes pages outside this task (`/places/new`, `/places/:id/edit`, …); their tests need a look.
- A feature that must not be deployed before a follow-up task relies on a written rule, not on code.
- A deleted category sets `wants.category_id` to null and silently moves the want to the strict threshold (kept as a risk, not a decision).
- `wants.seeker_party_id` has no ON DELETE rule; a future account-deletion feature must handle wants.

## Decisions

| # | Id | Question | Answer | Recommended? |
|---|---|---|---|---|
| C1 | scope-orphan-want-notification-switch | Where is the per-want notification switch shown? | Toggle on the match list page `/wanted/:id` | yes |
| I1 | radius-only-here | "Tylko tu" as null or radius 0? | null; CHECK 1–100; API turns 0 into null | yes |
| I2 | reserved-proposed-by-me | "By me" flags on match cards | Both flags; `proposed_by_me` from an own EXISTS | yes |
| I3 | match-count-meaning | What do the counters count? | Only pairs passing the match-list filter | yes |
| I4 | stale-bell-rows | Bell rows of withdrawn, purged or edit-reset wants | Delete the unread match row on withdraw and edit-reset; withdrawn want = 404 | yes |
| I5 | form-entry-links | Entry to the form from the list and the match page | "Dodaj" and "Edytuj" links; no inline add | yes |
| I6 | closing-prompt-several-wants | Several wants matched by the taken item | One prompt naming all; "Zamknij" closes all | yes |
| I7 | closing-prompt-on-match-list | Prompt on `/wanted/:id` too? | Sheet only on the item page | yes |
| I8 | prefilled-name-out-of-range | Prefilled name outside 3–80 | Prefill as typed, inline error, submit blocked | yes |
| I9 | want-not-found-target | Not-found link target of `/wanted/:id` | Own not-found state linking to `/wanted` | yes |
| I10 | category-clear-control | Clearing the category | Label prop on the picker, "Dowolna kategoria" | yes |
| I11 | konto-tab-highlight | "Konto" tab on deeper pages | Prefix match for all account sub-views | **no** (recommended: `/wanted/` only) |
| I12 | test-baseline | Pre-existing failing tests | Baseline first; no new failures | yes |
| I13 | release-gate | Unmeasured thresholds at deploy | No switch; do not deploy before the sample; rule in `architecture.md` | yes |
| I14 | old-search-user-guide | Old user guide calling the list a demo | Correct the text and point to the new guide | yes |

## Specification rules noted by the gap analysis (not decisions)
- Reject a name with no letters or digits: it can never match.
- Editing a want that is not `ACTIVE` answers 409.
- The seed and `EXPLAIN` scripts stay in the task folder.
