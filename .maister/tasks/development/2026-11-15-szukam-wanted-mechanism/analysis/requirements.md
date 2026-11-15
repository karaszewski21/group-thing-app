# Requirements: "Szukam" (wanted) mechanism

## TL;DR
- Build the private, seeker-owned want end to end: backend module `app/wants`, migration 0099, a 15-minute scan, two notification kinds, `/api/wants`, and the frontend `features/wanted` replacing the mock.
- Every product and architecture decision is already made: ADR-001–013 (research), P1–P13 accepted, 4 Phase 1 answers, 15 Phase 2 answers, 3 Phase 5 confirmations. The specification invents no new behaviour.
- Where the codebase analysis "Corrected" table (X1–X16) disagrees with the high-level design text, the correction wins.
- The 8 approved HTML mockups are binding for layout, Polish copy, field order and states.
- Release gate: the feature must not be deployed before the labelled Polish sample is scored (follow-up task); this task includes `EXPLAIN ANALYZE` only.

## Key Decisions
- No technical-clarification round in Phase 5 — the architecture was chosen by the user in the research workflow and refined in Phases 1–2; no open approach question remains.
- Entry points are exactly three: the `/add` tile, the "Konto" row, the empty-search prompt — confirmed by the user in Phase 5.
- Reuse patterns named by the codebase analysis only — the user named no other template.
- Mockup additions "Obojętnie" (offer mode null) and "Notatka dla siebie" are accepted as binding copy.

## Open Questions / Risks
- Thresholds 0.70 / 0.60 are starting values; unmeasured at the end of this task.
- Unrun checks to settle in implementation: a generated stored `tsquery` column on PostgreSQL 18 (fallback: application-written column) and `EXPLAIN (ANALYZE, BUFFERS)` of the match statement in both directions (decides the `item_listing_preferences.created_at` index).
- Pre-existing failing tests (24 Vitest, 5 typecheck, 2 backend per project memory) sit partly in files this task edits; a baseline run comes first.

## Initial description
Implement the szukam (wanted / in-search-of) mechanism designed in the research task `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism`: a private seeker-owned want in a new backend module `app/wants` (tables `wants`, `want_matches`, `want_scan_markers`), matched to listed items by one statement used at want creation and by a periodic scan, with grouped in-app notifications to the seeker, a 90-day lifecycle, and the frontend list, form and match list replacing the `/wanted` and `/add/hunting` mock.

## Sources, in order of precedence
1. User answers in this workflow: `analysis/clarifications.md` (Phase 1), `analysis/scope-clarifications.md` (Phase 2), the Phase 5 answers below.
2. `analysis/codebase-analysis.md`, table "Corrected" (X1–X16) and its Key Decisions.
3. `analysis/research-context/decision-log.md` (ADR-001–013) and `analysis/research-context/high-level-design.md`.
4. `analysis/gap-analysis.md` (integration points, specification rules).
5. `analysis/design-context/INDEX.md` and the mockups it lists (binding for UI).

## Questions and answers

### Phase 1 (see `clarifications.md`)
| Question | Answer |
|---|---|
| The 13 proposals P1–P13 | All accepted as written |
| Bell row for new matches | Delete the previous unread row, insert a new one with the summed count |
| Closing prompt trigger | After a personal or term/event take only |
| Measurement | `EXPLAIN ANALYZE` in scope; labelled sample later |

### Phase 2 (see `scope-clarifications.md`)
| Id | Answer |
|---|---|
| C1 notification switch | Toggle on `/wanted/:id`, saved at once |
| I1 "Tylko tu" | Stored as null; CHECK 1–100; API turns 0 into null |
| I2 "by me" flags | `reserved_by_me` and `proposed_by_me` (own EXISTS) |
| I3 counters | Only pairs passing the match-list filter |
| I4 stale bell rows | Delete the unread match row on withdraw and edit-reset; withdrawn want = 404 |
| I5 form entry | "Dodaj" on `/wanted` (also empty state), "Edytuj" on `/wanted/:id`; no inline add |
| I6 several wants | One prompt naming all; "Zamknij" closes all |
| I7 prompt on match page | Sheet only on the item page |
| I8 prefilled name | Shown as typed, inline error, submit blocked |
| I9 not-found | Own state linking to `/wanted` |
| I10 category clear | Label prop on the picker: "Dowolna kategoria" |
| I11 "Konto" tab | Prefix match for all account sub-views |
| I12 test baseline | Baseline first; no new failures |
| I13 release gate | No switch; do not deploy before the sample; rule in `architecture.md` |
| I14 old user guide | Correct the text, point to the new guide |

### Phase 5
| Question | Answer |
|---|---|
| User journey: only logged-in users, three entries (`/add` tile, "Konto" row, empty-search prompt; a guest goes through login or registration keeping the query), return through the bell and counters; no other entry in v1 | Confirmed |
| Code reuse: backend like `app/search` + `app/pages` with models like `app/events`, scan like `term_end_scan`; frontend hook like `useMyLocations`, form like `ItemCreateView`, chips and locality section extracted from `SearchFilters`, `ItemCard` with a "nowe" marker; any other template? | No other template |
| Visual assets: the 8 approved mockups are binding, including "Obojętnie" and "Notatka dla siebie"; no other assets | Confirmed |

## Functional requirements (summary)

### Want
- Fields: name (required, 3–80 code points after trim, at least one letter or digit), note (≤300, not matched, seeker only), category (any node, optional), offer mode (GIFT, SWAP or null = "Obojętnie"), locality (optional) with radius (null = "Tylko tu", else 1–100 km; only with a locality), notification switch (default on).
- Statuses: ACTIVE, FULFILLED, WITHDRAWN, EXPIRED; 90 days of validity; `closed_at` starts 30 days of retention; hard delete with matches after it.
- Cap: 30 active wants per user, counted in the write transaction, on create, resume and reopen → 409 with a Polish message.
- Text checks on write for name and note: contact-info rule, then classifier (`WANT_NAME`, `WANT_NOTE`); run before any database work; outage → 503.
- Actions: create, edit (only while ACTIVE; else 409), extend, close (FULFILLED / WITHDRAWN), resume (EXPIRED → ACTIVE), reopen (FULFILLED → ACTIVE). A withdrawn want and a foreign want are 404 with a Polish message.
- Editing name, category, offer mode, locality or radius deletes the want's matches and its unread match bell row and re-runs the forward match; editing the note or the switch does not.

### Matching
- One statement builder for forward (one want, at create / matching-field edit / resume / reopen; rows born seen, no notification, 3 s statement timeout → 503) and reverse (scan window over `item_listing_preferences.created_at`).
- Predicates: text always required — full text (`products.search_vector @@ name_query`) or trigram (`name_folded <% fold_pl(p.name)` as the indexable pre-filter AND `word_similarity(...) >=` 0.70 without a category / 0.60 with one, AND every word of ≤3 characters present as an exact token); category narrows to the node and its descendants; offer mode equality; locality equality or haversine radius over locality points; visibility PUBLIC or PRIVATE with a shared live PRIVATE group (through the widened groups predicate, `item_listing_preferences` joined unaliased); takeable = AVAILABLE, no pending proposal, live pickup place; not the seeker's own item; best 20 per want per run.
- Pairs stored once: unique `(want_id, item_id)`, `ON CONFLICT DO NOTHING`.

### Scan job
- Every 15 minutes on the existing scheduler; window = marker − 5 minutes overlap … now; first run starts one interval back.
- One transaction, one commit: sweep (expire; remind 7 days before the end, once per period, regardless of the switch; purge 30 days after closing) → reverse match → notifications → marker.
- Entry point takes `now` as a parameter; the job catches a lost marker race (`StaleDataError`), logs and rolls back; one log line per run; constant statement count.

### Notifications
- Kinds `WANT_MATCH_FOUND` and `WANT_EXPIRING`; recipient is the seeker's party.
- At most one unread match row per want: the previous unread row is deleted and a new one inserted with the summed count; one match → names the item and links to the item page; two or more → count and link to `/wanted/:id`.
- Written by the scan through a new batch writer in `app.notifications`; pointer and count kept on the want. Messages through `clock.fit_notification_message`.
- The want's unread match row is deleted on withdraw and on a match-resetting edit.

### API (`/api/wants`, login token only, rows copied from conversations)
- `GET /api/wants` (ACTIVE, EXPIRED, FULFILLED; `match_count`, `new_match_count` both through the match-list filter; optional `matched_item_id`), `POST`, `GET /{id}`, `PATCH /{id}`, `POST /{id}/extend`, `/close`, `/resume`, `GET /{id}/matches` (search-result-shaped cards plus `is_new`, `reserved`, `reserved_by_me`, `proposed_by_me`; available first), `POST /{id}/matches/seen` (reset counter; auto-extension in the last 30 days), `POST /{id}/matches/{item_id}/opened`.
- Errors: validation 400, contact details / classifier 400, cap and illegal transitions 409, timeout / moderation outage 503, foreign or withdrawn want 404.

### Frontend
- Routes `/wanted`, `/wanted/[id]`, `/wanted/[id]/edit`, `/add/wanted` (renamed from `/add/hunting`, no redirect); `wantPath`, `wantEditPath` builders.
- `features/wanted/` with list, form, match list, closing prompt, one `resolve…View()` per page; `api/wants.ts`; `hooks/useWants.ts` (token in the key) and `useWantMatches(id)`.
- Screens and states as in the mockups (`screen:wanted-list`, `screen:wanted-form`, `screen:wanted-form-errors`, `screen:wanted-matches`, `screen:wanted-matches-states`, `component:*`).
- Entry points: `/add` tile with a new-match count (prop from `AddView` only), "Konto" row with real counts, empty-search prompt forwarding `name`, `category`, `offer_type`, `locality`, `radius`.
- Closing prompt owned by `ItemPickupActions`, after a take only, after `TakeSuccessSheet` closes; `GET /api/wants?matched_item_id=`; closes every returned want.
- `BottomNav` prefix match for account sub-views; `CategoryTreePicker` clear-label prop; `ItemCard` "nowe" slot; `NotificationKind` union +2 (and removal of the stale member where its test is rewritten); `MOCK_WANTS`, `WantedView`, `HuntingCreateView` removed.

## Reusability opportunities
- Backend: `app/search` + `app/pages` layering and ACL shape; `app/events/models.py`; `term_end_scan.py` and `app/media/service.py:188-222`; `search.py` builders as column-form copies; `app/media/service.py:288-302` (count cap); `events/service.py` (Polish 404/409 subclasses); `messaging/router.py:33-37`.
- Frontend: `hooks/useMyLocations.ts`, `hooks/useEvent.ts`, `features/terms/termViewState.ts`, `features/items/ItemCreateView.tsx`, `features/places/PlaceEditView.tsx`, `ModalSheet`, `ConfirmDeleteDialog`, `ItemCard`, `CategoryTreePicker`, `LocalityCombobox`, the sections of `features/search/SearchFilters.tsx` to extract.

## Scope boundaries
**In scope**: everything above; migration 0099 with its round-trip test; boundary, clock-guard and matrix test updates; seed + `EXPLAIN ANALYZE` scripts kept in the task folder and the index decision; `architecture.md` (module section, package tree, 0099 runbook incl. deleting rows of the two kinds before a rollback, release gate), `INDEX.md`; text fix in the old search user guide.

**Out of scope**: the owner signal (1B), relay, group or public wants, abuse reporting; e-mail, push, digests, a notification settings screen; released reservations, item edits and visibility changes as matching signals; lemmatisation, embeddings; condition and photos on a want; a saved-search feature; automatic closing through a reservation origin; a feature switch; the labelled Polish sample and threshold tuning; needed items; the `PUT /api/products/{id}` ownership question; account deletion.

## Technical considerations
- Standards in `.maister/docs/standards/` apply (models, migrations, queries, security, time, API, components, accessibility, data fetching, both testing standards).
- All wants time columns are naive UTC via `datetime.utcnow()`; `app/wants` joins the domain-clock guard.
- `app/wants` joins `MODULES` in `tests/test_module_boundaries.py`; only `app/main.py` imports it; a `product_path` parity test pins the link copy.
- Statement counts of create, scan, list and match list are pinned by `count_queries` tests.
- Commands: `uv run python -m pytest|mypy|ruff` from `src/backend`; no commits without asking.
- Secrets: never print secret values.
