# Reality Check: Product-page reservations, physical location, reserved items on lists, item visibility

Assessed 2026-11-01 against the working tree on `feat/product-page-reservations` (base `bf55353`, 126 files changed, all uncommitted).

## TL;DR
- **Status: ⚠️ Issues Found. Functionally complete, with no critical gaps.** Every item of the user's request is implemented end to end, both server-side and in the UI:
  - reservations happen only on the product page, through 3 actions;
  - tiles show only the intent badge and link to the product page;
  - items can be PUBLIC or PRIVATE;
  - owners set a physical location on "Moje rzeczy";
  - the product page lists the owner's terms and events;
  - reserved items stay listed, with the reserver's name shown to logged-in viewers only;
  - the address is never sent.
- **Independent test runs pass:**
  - backend: 7 new or rewritten feature files, 70 passed;
  - frontend: 7 product, Moje rzeczy and tile files, 102 passed.
  - The full suites reported in the work log were not re-run.
- **The pre-implementation critical issue (C1) is resolved.** The spec audit found that a personal GIFT could never be confirmed. Its receiver can now confirm on the product page (`party_reservation.can_confirm`), and both the API test and the UI component exist.
- **The remaining gaps are about verification, not function:**
  - the app has not been run in a browser;
  - there is no `visual-fidelity.md`;
  - nothing is committed: the 3 migrations and every new file are untracked.

## Key Decisions
- I treated the deliberate spec choices as correct, not as gaps, because the user approved them:
  - the reserver's name is visible to every logged-in user;
  - a pending swap proposal counts as "zarezerwowana" and blocks the item;
  - a PRIVATE setting is lost when its preference row is deleted (C2);
  - there is no database discriminator for personal reservations (L7).
- The minor visual deviations recorded in the work log do not block:
  - owner names are not declined;
  - the anonymous gate uses links;
  - the visibility toggle sits on its own row;
  - non-parties see the "odbiór na terminie" copy on term reservations.

## Open Questions
- Has anyone walked the 3 flows in a real browser against a real backend? The flows are personal GIFT take → chat opens → receiver confirms; personal SWAP propose → owner accepts on the product page → both confirm; and a PRIVATE item seen by a stranger. No e2e or visual-fidelity evidence exists.
- Is a CDN or nginx cache actually in front of `/api/groups/public/*`? The headers are now correct (`private, no-store` + `Vary: Authorization`). Production proxy config was not checked.

## Risks
- **Uncommitted work.** About 156 working-tree entries are uncommitted, including the untracked migrations `0074`–`0076`, `item_visibility.py`, `reserved_by.py`, `item_reservations.py` and all the new UI files. A stray `git checkout`/`clean` would lose the whole feature.
- **Deploy order.** `0074`–`0076` are guarded downgrades. Once users create personal reservations or PRIVATE listings, rolling back needs the runbook in `architecture.md`.
- **Known pre-existing race**, out of scope: two concurrent proposals offering the *same* item are not locked.

---

## Reality vs Claims

| Original user ask | Claimed | Reality (evidence) |
|---|---|---|
| Reservation only on the product page | Old term and event take/propose routes removed; unified `POST /api/items/{id}/take\|propose` | **True.** `app/groups/router/item_reservations.py`. A grep over `src/` and `plugins/` finds no frontend or backend caller of the old routes, and `event_item_listings.py` is deleted. `test_removedTakeProposeRoutes_returns404or405` exists. |
| Tiles show only the intent and link to the product page | `ItemTileBadges` + stretched link; take buttons removed from the term page | **True.** `ItemTileBadges` is used by `ParticipantItemsPreview` and `ExchangeItemCard`'s `ItemCard`, which in turn is used by `RecentItemsBlock` and `OwnerItemsPage`. The labels are "Chcę oddać" / "Chcę się zamienić". |
| PUBLIC/PRIVATE visibility | `ItemVisibility` on the preference (0076), 9 gates | **True.** The test `item_visibility.py` passes. It covers 404s for a stranger, 404 for an RSVP-only non-member, PRIVATE items hidden on events, public terms, the organizer page and the owner page, and 409 for a PRIVATE take in an event or public-circle context. |
| Physical location on "Moje rzeczy", pickup not tied to a term | 0075 `inventories.location_id`, `GET\|PUT /api/inventories/mine/location`, `InventoryLocationCard` | **True.** The card is rendered at `MyItemsView.tsx:286`. Taking personal pickup without an owner location returns 409 (tested). |
| Address never shared | Viewer-shaped `ItemLocationResponse` | **True.** `item_actions.py:246-256`: anonymous viewers get `null`, others get the name only, and only the owner gets `formatted_address`. `InventoryResponse` still has no `location_id`. The sheet copy says "nie udostępniamy adresu w aplikacji". |
| Product page lists terms/events where the owner takes part | `/actions.contexts` (at most 5, viewer-filtered in SQL) | **True.** The rendered heading is "Terminy i wydarzenia, na których bywa <owner>". The statement count is tested as constant. |
| 3 actions: "Odbiorę osobiście", "Wybieram termin", chat | `ChooseActions` + `PersonalPickupSheet` + `ChooseContextSheet` + chat | **True.** When blocked, an action uses `aria-disabled` with a hint. After a personal take, the ITEM chat opens (`ItemContextActions.tsx:66-77`). |
| Reserved items stay listed, name shown to logged-in viewers only | `listed_items_with_product_select`, `ReservedByResponse` | **True.** `test_reservedBy_perViewer_anonymousNullLoggedInNameRecipientByMe` passes, as do the cache-header tests. |
| Personal reservation can be settled | `party_reservation` flags + `PartyReservationActions` | **True.** The receiver confirms a GIFT, the giver can only cancel, the owner accepts or rejects a proposal in the `own` view, and paired swaps let both parties confirm or cancel. All of this is tested in `test_party_reservation_actions.py` and `test_personal_pickup.py`. |

## Critical Gaps
None found.

## Quality Gaps

### High
**H1. No runtime or browser verification of the new flows.**
- **Claim:** implementation complete, all tests green.
- **Reality:** the evidence is unit and integration tests only (httpx ASGI on the backend, jsdom on the frontend). There is no `verification/visual-fidelity.md`, no e2e run, and the app was never launched.
- **Gap:** the cross-page handoffs are exercised only with mocks:
  - after a take, the chat opens via `useOpenAndNavigate`;
  - the SWAP picker leads to the chat;
  - notification links lead to `/product/{id}`, where the party buttons are.
- **Impact:** a wiring bug such as a stale query, a wrong redirect or the chat rate limit would surface only in production. This is a medium likelihood of a minor bug, not of broken core logic.

### Medium
**M1. All work is uncommitted.**
- **Claim:** none.
- **Reality:** `git status` shows the new migrations and modules untracked.
- **Impact:** the feature could be lost, and there is no reviewable diff unit.

**M2. Settling on the product page does not refresh the "Moje rzeczy" provider data directly.**
- **Claim:** spec R8.6 says the page invalidates `my-inventory-items`.
- **Reality:** that query key does not exist. The "Moje rzeczy" data lives in `AppDataContext`, which is not React Query. `PartyReservationActions.SETTLE_INVALIDATED_KEYS` does not include it.
- **Impact:** low. `AppDataContext` reloads silently whenever the user navigates back onto a panel route (`AppDataContext.tsx:334-342`), so the user only sees stale data if both are visible at once. Noted for accuracy.

### Low
**L1. Visual deviations from the mockups.** These are listed in the work log (G7/G12/G15) and are cosmetic.

**L2. ruff.** There is one new E501 on a comment line in `authorization_matrix.py:248`.

**L3. Stale build artifact.** `app/groups/router/__pycache__/event_item_listings.cpython-314.pyc` is left over. It is harmless.

## Integration Points
- **Migrations:** the chain `0073 → 0074 → 0075 → 0076` is linear with a single head. Each migration has a downgrade/upgrade test, and the guarded downgrades are documented.
- **Authorization:** the new routes need EDIT. `/actions` and the public lists take an `OptionalPrincipal`.
- **Messaging:** a PRIVATE item blocks *new* ITEM conversations for strangers, but existing ones stay accessible (tested).
- **Notifications:** every reservation notification links to `/product/{item_id}`. `SWAP_PROPOSED` now links the owner to the listing item, where accept and reject live. This closes the G5 open issue.
- **Term-end scan:** it ignores personal reservations (tested), so no reminders are sent, as the user decided.
- **Event delete:** cancelling first leaves no orphaned "personal" rows (tested; this is the accepted risk L7).
- **Cache:** personalised public routes send `private, no-store` + `Vary: Authorization`, and anonymous requests get `public, s-maxage=60` (tested).

## Functional Completeness
About 95%. All user-facing requirements are implemented and covered by passing tests. The missing 5% is runtime confirmation in a real browser, plus committing the work.

## Pragmatic Action Plan

| # | Action | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Commit the branch, including untracked migrations and new files | `git status` is clean, apart from the task folder if desired | High | 10 min |
| 2 | Manual or Playwright smoke run against a local backend | Personal GIFT: take → chat opens → receiver sees "Potwierdzam przekazanie" → confirm → the item leaves the lists. Personal SWAP: propose → owner accepts on the product page → both confirm. PRIVATE item: a stranger gets 404 and the item is hidden on the organizer and event pages. Anonymous: the "Zarezerwowana" badge shows with no name, and there is no location block | High | 45–60 min |
| 3 | Check the production proxy/CDN for `/api/groups/public/*`, so it honours `Cache-Control: private` / `Vary` | Config reviewed, or no shared cache confirmed | Medium | 15 min |
| 4 | Optional: fix the E501 and delete the stray `.pyc` | ruff count is back to the baseline of 50 | Low | 5 min |

## Completion Verdict
**⚠️ Complete, with verification gaps.** The implementation solves the user's stated problem end to end at the API and component level. There are no critical or functional gaps, and the pre-implementation critical issue is fixed and tested. Before deploying, commit the work and run a short real-browser smoke test of the personal pickup, swap and PRIVATE flows.
