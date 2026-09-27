# Codebase findings — Frontend UX of the LEND lifecycle (category `codebase-frontend-ux`)

Scope: `src/frontend/src` — panel ("Wypożyczone", "Moje rzeczy", Home, global pending-actions modal,
notification bell), Term page LEND take flow, API clients, tests. All paths relative to
`src/frontend/src/` unless stated otherwise.

## 0. Note on the "uncommitted" changes

`git status` at gathering time shows **no uncommitted FE changes** — the change described in the brief
(`getMyInventoryItems` replacing `getInventoryItems` + `getMyItemListingPreferences`) is already
committed in `acd3b4c` ("add", 2026-09-25). `git show acd3b4c` confirms:

- `api/inventories.ts:34-37` adds `MyInventoryItemResponse extends InventoryItemResponse { listing_mode: ReservationType | null }`, and `:77-81` adds `getMyInventoryItems()` → `GET /inventory-items/mine`, docstring: *"only items the logged-in user currently owns — an item given or swapped away drops out, one received shows up with no mode"*.
- `api/itemListingPreferences.ts`: `getMyItemListingPreferences()` removed.
- `pages/panel/PanelDataContext.tsx:472-483`: `setItems(await getMyInventoryItems())` and item modes seeded from `listing_mode`; the old separate preferences fetch deleted.
- `pages/krag/hooks/useItemTake.ts:10-21`: `fetchMySwapItems` reduced to `getMyInventoryItems().filter(listing_mode === "SWAP")` + per-item balance AVAILABLE filter.
- `test/PanelPage.test.tsx`: mocks switched to `getMyInventoryItems`, new test "seeds each item's mode toggle from its listing_mode" (commit diff, around line 1755).

**Backend behaviour behind `/inventory-items/mine` (load-bearing for LEND):**
`src/backend/app/groups/application/term_item_listings.py:137-168` lists items of the caller's PERSONAL
inventory via `circulation_bridge.list_items_with_product_name(db, inventory.id)`, which resolves to
`src/backend/app/circulation/infrastructure/repository.py:83-90`:
```python
.where(
    InventoryItem.inventory_id == inventory_id,
    InventoryItem.deleted_at.is_(None),
)
```
It filters on the **current** `inventory_id`, not on `home_inventory_id`. Since a fulfilled LEND moves the
item to the borrower's VIRTUAL inventory (`reservation_transitions.py:104` sets
`item.home_inventory_id = item.inventory_id` before the move), **a lent-out item disappears from the
owner's "Moje rzeczy" completely** once the LEND is fulfilled. Confidence: High (code read end-to-end).

---

## 1. Borrower side — "Wypożyczone" section

### 1.1 Navigation and entry points
- Bottom tab "Wypożyczone" is the `podarki` view key: `pages/panel/PanelNav.tsx:9` (`{ key: "podarki", label: "Wypożyczone" }`); routed at `pages/panel/PanelPage.tsx:69` (`view === "podarki" && <WypozyczoneView />`).
- Home card "Rzeczy wypożyczone — Rzeczy, które wypożyczyłeś od innych" showing only a count `borrowedItems.length` and "Zobacz →": `pages/panel/views/HomeView.tsx:270-289`. No due-date/overdue hint on Home.

### 1.2 How `borrowedItems` is loaded
`pages/panel/PanelDataContext.tsx:485-516` inside `load()`:
- Finds the caller's `VIRTUAL` inventory among `getInventories(me.account_user_id)` (`:489`).
- `getInventoryItems(virtualInventory.id)` (`:491`), then per item in parallel: `getInventoryItemBalance(item.id)` + `getInventory(item.home_inventory_id)` then `getProfileByAccountUserId(lenderInventory.owner_user_id)` (`:494-503`) — a 3-requests-per-item fan-out (N+1 shape), inside the hand-rolled `useState`/`load()` provider rather than TanStack Query hooks (the `data-fetching.md` standard says TanStack hooks in `src/hooks/`).
- Row shape `BorrowedItem { itemId, productName, lenderUserId, lenderName, dueDate }` — `pages/panel/panelHelpers.ts:35-41`. `dueDate` = `balance.due_date` (`PanelDataContext.tsx:509`). No reservation id, no term id, no lent_at, no status, no condition-at-handover.
- Comment at `PanelDataContext.tsx:485-488` / `panelHelpers.ts:31-34` states GIFT/SWAP items land in PERSONAL, so VIRTUAL == "on loan".
- A borrower sees an item here **only after fulfill** (item physically moved to VIRTUAL). Between take (`PENDING`) and post-term confirm there is **no borrower-side view** of the pending loan at all (items stay in the owner's PERSONAL inventory; the only borrower surfaces are the toast "Wzięto! Szczegóły w Twoim panelu" `pages/krag/hooks/useItemTake.ts:82` — which promises details the panel does not show — and the post-term `TERM_CONFIRMATION_NEEDED` modal, §4).

### 1.3 The view
`pages/panel/views/WypozyczoneView.tsx:4-46`:
- Header "Wypożyczone — rzeczy od innych, które masz teraz u siebie" (`:10-13`); empty state "Nie masz teraz nic pożyczonego." (`:16-20`).
- Per row: product name, "Od: {lenderName}" (`:28`), optional "Oddaj do: {date}" via `new Date(b.dueDate).toLocaleDateString("pl-PL")` (`:29-33`) — bypasses the mandated `utils/dayjs.ts` (standard `data-fetching.md`). No overdue styling, no "X dni" countdown, no reminder.
- Single action button "Oddaję" (`:35-41`, aria-label `Oddaję {productName}`) → `returnBorrowedItem(itemId)`. No confirm dialog, no busy/disabled state (double-click can fire twice), no "extend", no "message lender", no "report damaged/lost".
- The view does **not render `itemError`**; errors from `returnBorrowedItem` go to `itemError`, which is rendered only in `RzeczyView.tsx:385-387` — so a failed return shows its error on a different tab ("Moje rzeczy"), invisible on "Wypożyczone".

### 1.4 `returnBorrowedItem` — the one-shot RETURN
`pages/panel/PanelDataContext.tsx:1354-1380`:
```ts
const reservation = await createReservation({
  item_id: itemId,
  reservation_type: "RETURN",
  reserved_by_user_id: borrowed.lenderUserId,
});
await confirmReservation(reservation.id);
await fulfillReservation(reservation.id);
setBorrowedItems((prev) => prev.filter((b) => b.itemId !== itemId));
showToast("Oddano");
```
- Borrower alone creates + confirms + fulfills in three sequential raw calls (`api/reservations.ts:50-68`); comment `:1361-1367` justifies it by the holder-may-confirm rule — "no separate approval from the lender is needed".
- No `term_id` (does not use `confirmTransaction`/`cancelTransaction` term-gated endpoints, `api/reservations.ts:87-106`), no time/place of hand-back, no lender acknowledgement of receipt, no condition check.
- Non-atomic from the client: if `confirmReservation` or `fulfillReservation` fails after `createReservation` succeeded, a dangling PENDING/CONFIRMED RETURN reservation remains; the catch only sets `itemError` (`:1376-1378`) and there is no retry/cleanup path.
- Only local state is patched (`setBorrowedItems` filter), no `load({ silent: true })` — unlike every sibling mutation in the same file (e.g. `withdrawMyPledge` `:647`, `confirmPendingAction` `:836`).
- Silently no-ops when `lenderUserId == null` (`:1358`, e.g. item with no `home_inventory_id`) — button does nothing, no message.
- No notification is triggered to the owner from the FE side (and no FE notification kind for returns exists, §5).

## 2. Owner side — "Moje rzeczy" (RzeczyView)

`pages/panel/views/RzeczyView.tsx`:
- Items = `items` from `getMyInventoryItems()` (see §0) — current PERSONAL inventory only.
- Per-item balances fetched locally: `getInventoryItemBalances(items.map(id))` (`:62-75`), a `Promise.all` fan-out over `GET /inventory-items/{id}/balance` (`api/inventories.ts:118-125`).
- Lock semantics: `ACTIVE_LOCK_BALANCE_STATUSES = ["RESERVED", "IN_TRANSIT"]` (`api/inventories.ts:104`), comment `:97-103`: *"Deliberately excludes LENT/RETURNED — an already-lent item isn't 'pending', it's a settled state with its own 'Wypożyczone' view."* — but "Wypożyczone" is the **borrower's** view; the owner has no such view.
- Badge labels `lockBadgeLabel` (`RzeczyView.tsx:27-31`): `RESERVED` → "czeka na potwierdzenie", `IN_TRANSIT` → "zablokowane"; `LENT`/`RETURNED`/`AVAILABLE` → no badge (docstring `:17-26`).
- Mode toggles (Wypożyczę/Oddam/Zamienię) disabled while locked (`:317-333`, `disabled={locked}`); defence-in-depth re-check in `setItemMode` (`PanelDataContext.tsx:1029-1046`).
- Post-term fallback buttons (Bug #4c) shown when `locked && termHasEnded(it.id)` (`:350-369`): "Odebrał" → `confirmTransaction(reservationId, {term_id})` (`:139-153`) and "Anuluj wymianę" → `cancelTransaction` (`:155-169`). Term resolution via `getReservation` + `getTerm` per locked reservation (`:83-128`). `reservation_id` on the balance is set only for RESERVED/IN_TRANSIT (`api/inventories.ts:54-57`).
- Delete (trash) button is **not** disabled for locked items (`:375-381`).

### Owner's lifecycle view of a LENT item (derived)
| Phase | Owner "Moje rzeczy" | Evidence |
|---|---|---|
| Listed, LEND mode | Row, "Wypożyczę" toggle pressed | `RzeczyView.tsx:317-333`, `PanelDataContext.tsx:473-483` |
| Taken (PENDING) | Badge "czeka na potwierdzenie", toggles disabled | `RzeczyView.tsx:28` |
| Confirmed, before term end | Badge "zablokowane" | `RzeczyView.tsx:29` |
| Term ended, not yet confirmed | "zablokowane" + "Odebrał" + "Anuluj wymianę" (label says *wymiana* even for LEND) | `RzeczyView.tsx:350-368`; test with `reservation_type: "LEND"` `test/PanelPage.test.tsx:2563` |
| Fulfilled → item on loan (LENT, in borrower's VIRTUAL) | **Row disappears.** Item count drops; Home "Wypożyczyć" counter drops (`PanelDataContext.tsx:1048-1055` counts only `items`) | §0 repository filter |
| Returned (borrower pressed "Oddaję") | Row re-appears (AVAILABLE, preference kept → re-listed on Terms) with no signal that it came back | `returnBorrowedItem`; public listing filter `term_item_listings.py:378` |

Consequence: the owner has **no UI anywhere** showing "lent to X, due D, overdue", no "request return", no "confirm I got it back", no "extend". The label "Odebrał" is phrased from the giver's perspective ("[he] picked it up"), which works for handover but there is no mirror "Oddał mi" for the return.

## 3. Term page — LEND take flow

- `pages/krag/TermPage.tsx:11-48` → `PublicTermView` (`pages/krag/PublicTermView.tsx`). Listing rows built by `toListingRow` (`:59-90`): each `offered_types` entry filtered by `LISTABLE_RESERVATION_TYPES = ["LEND","SWAP","GIFT"]` (`components/termLabels.ts:5`) becomes a button labelled from `TAKE_ACTION_LABELS` — `LEND: "Pożycz"` (`termLabels.ts:8-13`).
- `useItemTake.performTake` (`hooks/useItemTake.ts:72-89`): for LEND a single immediate `takeTermItemListing(itemId, { term_id, reservation_type: "LEND" })` (`api/termItemListings.ts:31-35,55-60`) — **no dialog** to choose/see loan length, due date, conditions or pickup; success toast "Wzięto! Szczegóły w Twoim panelu" (`:82`) — same wording as GIFT.
- Public listings come from `PublicItemListingResponse` with *no status/taken fields* (`api/groups.ts:169-178`); backend only lists items whose balance is AVAILABLE (`src/backend/app/groups/application/term_item_listings.py:378`), so a lent item silently vanishes from the Term page and re-appears after return.
- The Term page has no per-viewer section for "what I borrowed/lent at this Term" and no confirm/cancel actions (the old `confirmActionFor` in TermPage was removed in refactor `c1dce04`; only a stale reference remains in the comment `PanelDataContext.tsx:173-177`).
- AuthGate copy: "Żeby wziąć, pożyczyć albo zamienić się rzeczą, musisz mieć konto…" (`PublicTermView.tsx:160-166`).
- `TAKE_ACTION_LABELS.RETURN = "Zwrot"` exists (`termLabels.ts:12`) but RETURN is explicitly not listable (`:3-4`) — unused in UI.

## 4. Global pending-actions modal & notifications

- `NotificationKind` union (`api/notifications.ts:3-16`): PLEDGE_*, NEEDED_ITEM_REMOVED, TERM_ITEM_LISTING_TAKEN, SWAP_PROPOSED/ACCEPTED/REJECTED, TERM_CONFIRMATION_NEEDED, TERM_ALREADY_RESOLVED, GROUP_JOIN_*. **No LEND/RETURN kinds** (no RETURN_REQUESTED, LOAN_DUE_SOON, LOAN_OVERDUE, LOAN_RETURNED, LOAN_EXTENDED…). Backend enum matches (`src/backend/app/notifications/models.py:35-55`); its docstring says TERM_CONFIRMATION_NEEDED goes to "a party with a locked leg (swap or giveaway)" — LEND not mentioned (backend gatherer to verify).
- Notification bell renders only `n.message` + unread dot; click marks read and navigates to `link_path` (`pages/panel/PanelHeader.tsx:87-107`, `PanelDataContext.tsx:656-665`). Kinds are not visually differentiated.
- Pending actions are derived from **unread** notifications of kinds SWAP_PROPOSED and TERM_CONFIRMATION_NEEDED + server pending join requests (`PanelDataContext.tsx:683-722`); types `PendingSwapAction`/`PendingConfirmAction`/`PendingJoinRequestAction` (`:128-161`). termId parsed from `link_path` with `/\/term\/(\d+)$/` (`:165-171`).
- `GlobalPendingActionsModal` (`PanelDataContext.tsx:1540-1641`): TERM_CONFIRMATION_NEEDED shows title "Potwierdź transakcję", the message, "Potwierdź" + "Później" (`:1557,1576-1593`) — no cancel option here (cancel exists only on the owner's RzeczyView tile). Race-loss shows "Transakcja została już rozstrzygnięta przez drugą stronę." (`:1563-1574`).
- `resolvePendingReservationId(termId, myPartyId)` (`PanelDataContext.tsx:194-230`): taker side first via `getMyTakenTermItemListings` (`api/termItemListings.ts:49-53`), then owner side, where GIFT **and LEND** resolve to the owner's own reservation (`:221-227`). So for LEND both borrower and owner can confirm the post-term handover from the modal; after confirm → `load({ silent: true })` (`:836`). Returns the *first* active reservation for the term — with several loans in the same Term the prompt is ambiguous (message text is the only disambiguation).
- Nothing in the modal ever relates to the **return** leg.

## 5. Pledge → LEND to organizer (FE surface)

- `api/pledges.ts:35-36`: `registered` = "a concrete item + LEND reservation are opened". Home "Zadeklarowane rzeczy" shows statuses "Zadeklarowane" / "Zarejestrowane" / "Zrealizowane ✓" and "Rezygnuję" only for CLAIMED & !registered (`pages/panel/views/HomeView.tsx:193-236`).
- After fulfilment the pledger's item leaves their PERSONAL inventory (same §0 filter) and the pledger sees only "Zrealizowane ✓" — no "u organizatora, wróci po…". Per the brief the item goes to the organizer's VIRTUAL inventory, so it would show in the **organizer's** "Wypożyczone" with the same "Oddaję" one-shot return (inferred from `PanelDataContext.tsx:485-516`; not tested; Confidence Medium).

## 6. Test coverage (src/test)

| Area | Covered? | Evidence |
|---|---|---|
| Term page "Pożycz" calls `takeTermItemListing(..., "LEND")` | Yes | `test/TermPage.test.tsx:259-272`, button presence `:183` |
| Owner lock badges RESERVED/IN_TRANSIT, toggle disable | Yes | `test/RzeczyViewCategory.test.tsx:191-320` |
| "Odebrał"/"Anuluj wymianę" post-term (mock uses LEND reservation) | Yes | `test/RzeczyViewCategory.test.tsx:322-449` (`mockReservation` `reservation_type: "LEND"` `:81-93`); `test/PanelPage.test.tsx:2540-2620` |
| Global TERM_CONFIRMATION_NEEDED confirm + silent reload | Yes (generic) | `test/PanelPage.test.tsx` ~2208-2238 (commit diff) |
| Mode seeding from `listing_mode` | Yes | `test/PanelPage.test.tsx` ~1755 (commit diff) |
| "Wypożyczone" view render, lender name, due date | **No** | grep for `Wypożyczone`/`Oddaję`/`borrowedItems`/`pożyczonego` in `src/test` → 0 hits |
| `returnBorrowedItem` (RETURN create/confirm/fulfill) | **No** | same grep; `RETURN` absent from tests |
| Owner view of fulfilled/LENT item | **No** | — |
| NotificationKind parity test is stale (lists 10 kinds; union has 13) | Stale | `test/RzeczyViewCategory.test.tsx:451-467` vs `api/notifications.ts:3-16` |

## 7. UX gaps for the lend lifecycle (FE)

1. **Owner loses sight of a lent item** — fulfilled LEND removes it from "Moje rzeczy" (`repository.py:86-88` filters `inventory_id`); no "Pożyczone innym" / "u kogo" list, no LENT badge (explicitly excluded, `api/inventories.ts:97-104`). Home counters drop too (`PanelDataContext.tsx:1048-1055`).
2. **Borrower sees nothing before fulfilment** — pending/confirmed LEND (before term end + confirm) has no borrower view; toast promises "Szczegóły w Twoim panelu" (`useItemTake.ts:82`) that don't exist; borrower cannot cancel a pending LEND take from UI (cancel only on owner tile, `RzeczyView.tsx:360-367`).
3. **Return is unilateral and instant** (`PanelDataContext.tsx:1368-1375`) — no return intent vs. physical hand-back split, no owner receipt confirmation, no Term/place/date for the return, no condition check, no dispute path; item re-appears as AVAILABLE and is re-listed on Terms (`term_item_listings.py:378`) even though the owner may not have it yet.
4. **No owner-initiated return request (recall)**, no extension request/approval, no messaging — neither API client functions (`api/reservations.ts` has only create/confirm/cancel/fulfill/confirmTransaction/cancelTransaction) nor UI.
5. **Due date is display-only** — shown only on borrower row if set (`WypozyczoneView.tsx:29-33`), not shown to owner, not chosen at take time (`useItemTake.ts:80`), no overdue state/colour, no reminders, no notification kinds for due/overdue/returned (`api/notifications.ts:3-16`).
6. **Error/robustness issues in the return button** — error rendered on another tab (`itemError` only in `RzeczyView.tsx:385-387`), no busy state/double-submit guard (`WypozyczoneView.tsx:35-41`), non-atomic 3-call sequence can leave a dangling RETURN reservation, silent no-op when lender unknown (`PanelDataContext.tsx:1358`), no `load({silent:true})` after success.
7. **Labels are exchange-centric** — "Anuluj wymianę" and "Potwierdź transakcję" used for LEND (`RzeczyView.tsx:366`, `PanelDataContext.tsx:1557`); "Odebrał" has no return-leg counterpart.
8. **Pending-actions modal ambiguity** — one reservation per term resolved (`PanelDataContext.tsx:194-230`); only notifications-based SWAP/confirm prompts; no return prompts; no cancel in modal.
9. **Pledge-LEND** — pledger sees "Zrealizowane ✓" with no "on loan to organizer / comes back" state (`HomeView.tsx:203-208`); organizer gets the same one-shot "Oddaję".
10. **Standards drift in touched code** — hand-rolled `useState`+`load()` fetching and per-item fan-outs instead of TanStack Query hooks, and `Date.toLocaleDateString` instead of `utils/dayjs.ts` (`WypozyczoneView.tsx:31`), both against `standards/frontend/data-fetching.md`. A new lend-lifecycle UI would be the natural moment to introduce `src/hooks/useLoans`-style hooks.
11. **Zero tests** for "Wypożyczone"/`returnBorrowedItem`; NotificationKind parity test stale (§6).

## 8. Owner vs borrower — what each sees today

| Moment | Owner (lender) | Borrower |
|---|---|---|
| Takes "Pożycz" on Term | Notification TERM_ITEM_LISTING_TAKEN (message only); tile badge "czeka na potwierdzenie" | Toast "Wzięto!…"; nothing in panel |
| Before term end | "zablokowane" badge | nothing |
| After term end | modal "Potwierdź transakcję" + tile "Odebrał"/"Anuluj wymianę" | modal "Potwierdź transakcję" (via taker-side resolution) |
| On loan | **nothing** (item gone from list) | "Wypożyczone" row: name, "Od: X", optional "Oddaj do: D", "Oddaję" |
| Borrower presses "Oddaję" | item silently back in "Moje rzeczy" as AVAILABLE; no notification kind | row removed, toast "Oddano" |

## Confidence
- §0–§4, §6: **High** — direct code reads with line citations.
- Owner-side notification on take (TERM_ITEM_LISTING_TAKEN) and whether TERM_CONFIRMATION_NEEDED is emitted for LEND: **Medium** — FE handles it; emission is backend (see backend findings).
- §5 organizer-side pledge LEND appearing in "Wypożyczone": **Medium** — inferred from brief + load logic, not tested.
