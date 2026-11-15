# Codebase (frontend): needed-items UI and reusable pieces for a real "Szukam"

## TL;DR
- Needed items in the UI are an organizer's per-term bring-list: name + optional refinement, tied to a `term_id`, answered by a single-claim pledge ("Ja to przyniosę") from a participant. They are never matched to listed items and have no category, location or offer type.
- They share only the `{name, description}` shape with the mock want. Every other trait (owner, scope, response, lifecycle) differs, so the frontend gives no reason to merge them; the form component is too thin to be worth sharing.
- Ready to reuse as they are: `CategoryTreePicker`, `LocalityCombobox` plus the radius chips pattern, `ItemCard`/`SearchResultCard`, `ModalSheet`, `ConfirmDeleteDialog`, the notification bell (renders any kind by `message` + `link_path`), and the item page take/propose flow.
- New on the frontend: an `api/wants.ts` + `hooks/useWants.ts` pair, a new `NotificationKind` member, and — if the filters should carry over — a richer link from the empty search state.

## Key Decisions
- Reuse verdicts below are "as is / extend / new" per the plan's analysis framework (`planning/research-plan.md:57`).
- Needed items are reported as a separate concept on UI evidence only; the backend side of that statement belongs to gatherer 2.

## Open Questions / Risks
- `LocalityCombobox` + radius chips live inside `SearchFilters.tsx` as a private `LocationSection`; reusing the pair in a want form means extracting it or duplicating it.
- `CategoryTreePicker` selects leaves only in `leaf` mode; a want for a broad category ("kurtki dziecięce") would need `mode="any"`, today used only by the admin parent picker.
- The bell shows plain text rows; a "3 new matches" digest row works, but a richer row (thumbnail, several items) does not exist.
- `derivePendingActions` turns two notification kinds into blocking sheets; a match notification must stay out of that list or it would interrupt the user.
- No per-user notification settings screen exists in "Konto"; mute or frequency controls would be new UI.

## Part A — Needed-items UI

### A1. Data shape: name + description, bound to a term
**Source**: `src/frontend/src/api/terms.ts:46-61`, `:142-145`
**Evidence**:
```ts
export interface NeededItemResponse {
  id: string; term_id: string; name: string; description: string | null;
  /** An active (non-withdrawn) pledge exists — "ktoś przyniesie". */
  claimed: boolean; created_at: string; updated_at: string;
}
export interface CreateNeededItemRequest { term_id: string; name: string; description?: string; }
```
Endpoints used: `GET /needed-items?term_id=…` (batched, 100 term ids per request, `terms.ts:116-132`), `GET/POST/PATCH/DELETE /needed-items[/{id}]` (`terms.ts:134-156`). The public term page gets a variant with the claimer: `PublicNeededItemResponse {id, name, description, claimed, claimed_by_name, claimed_by_party_id}` (`src/frontend/src/api/groups.ts:160-168`).
**Confidence**: high.

### A2. Who creates them: the organizer, inside term forms
**Source**: `src/frontend/src/features/terms/AddTermView.tsx:111-123`, `src/frontend/src/features/panel/AppDataContext.tsx:196-198,386-403,435`, `src/frontend/src/features/terms/TermEditForm.tsx:55-82,120-179`
**Evidence**: on `/add/term` the organizer builds a draft list with `NeededItemQuickAddForm` and `addDraftNeededItem`; the list is sent with `createNeededItem` after the term is created (`AppDataContext.tsx:435`). On the term edit form each need can be edited (`updateNeededItem`), removed (`deleteNeededItem`, no confirmation) or added (`createNeededItem`), with server messages shown through `serverMessageOr`.
**Confidence**: high.

### A3. `NeededItemQuickAddForm` — two plain inputs
**Source**: `src/frontend/src/components/shared/NeededItemQuickAddForm.tsx:18-46`, `src/frontend/src/utils/neededItemQuickAdd.ts:5-12`
**Evidence**: "Nazwa" (placeholder "np. Termos") and "Doprecyzowanie (opcjonalnie)" (placeholder "np. rozmiar 1/2"); purely presentational, `value`/`onChange`/`disabled`; no `maxLength`, no validation, no category. Single consumer: `AddTermView.tsx:118`. `TermEditForm` has its own near-copy, `NeededItemFields` (`TermEditForm.tsx:55-82`).
**Context**: the want form already has the same two fields with limits (`HuntingCreateView.tsx:68-92`); sharing this component would save nothing.
**Reuse verdict**: not worth reusing.
**Confidence**: high.

### A4. `useNeededItems` — batched read keyed by term ids
**Source**: `src/frontend/src/hooks/useNeededItems.ts:16-50`
**Evidence**: `queryKey: [NEEDED_ITEMS_KEY, ids]` with sorted, de-duplicated ids, `placeholderData: keepPreviousData`, returns `ReadonlyMap<termId, NeededItemResponse[]>` with a module-level empty fallback, `refetch` invalidates the whole prefix. Consumers: `TermEditView.tsx:26`, `useOrganizedMeetings.ts:23`, `useAttendingMeetings.ts:47`.
**Context**: it is the house pattern a `useWants` hook would follow (prefix key constant, stable empty fallback, `loading`/`error`/`refetch` shape) per `.maister/docs/standards/frontend/data-fetching.md`; the hook itself is term-shaped and not reusable.
**Reuse verdict**: pattern only.
**Confidence**: high.

### A5. Response flow: pledge, single claim, participants only
**Source**: `src/frontend/src/features/terms/hooks/useNeededItemPledge.ts:9-38`, `src/frontend/src/features/terms/blocks/TermNeededItems.tsx:16-49,57-111`, `src/frontend/src/api/pledges.ts:3-45`
**Evidence**:
```ts
await createPledge(neededItemId);
setPledgedItemIds((prev) => [...prev, neededItemId]);
showToast("Zgłoszono — szczegóły w Twoim panelu");
...
const conflict = err instanceof ApiError && err.status === 409;   // someone else pledged first
```
- Row states: unclaimed → button "Ja to przyniosę"; claimed → pill "Przynosi: Ty | <name> | inna rodzina" (`TermNeededItems.tsx:34-46`).
- Gates: anonymous → `AuthSheet`; logged in but not taking part → `SignUpToPledgeSheet`; the organizer gets no button (`TermNeededItems.tsx:52-56,72-79`).
- `PledgeStatus` is `OPEN | CLAIMED | WITHDRAWN | FULFILLED` (`pledges.ts:3`); "my pledges" come from `GET /pledges/mine` with term and group context (`pledges.ts:15-25`, `src/frontend/src/hooks/useMyPledges.ts:21-54`), and are shown on the attendee's term cards with a withdraw action (`src/frontend/src/features/meetings/TermCards.tsx:203-233`).
- A pledge does not reference an inventory item in the request (`createPledge(neededItemId)` sends only `needed_item_id`, `pledges.ts:39-41`).
**Context**: this is the nearest existing "I have this" flow. It differs from a want response: one claimer, tied to a meeting date, limited to that term's participants, no link to a listed item and no take/propose.
**Confidence**: high.

### A6. Needed items versus the mock want (UI evidence)

| Trait | Needed item | Mock want |
|---|---|---|
| Author | term organizer (`AddTermView.tsx:111-123`) | any logged-in user (`paths.ts:138-139`) |
| Scope | one term (`terms.ts:48`) | the user's account (`AccountView.tsx:42-46`) |
| Audience | visitors of the term page (`TermNeededItems.tsx:57-70`) | the seeker only (`WantedView.tsx`) |
| Response | pledge by a participant (`useNeededItemPledge.ts:14-20`) | system match count + promised notification (`WantedView.tsx:82-90`) |
| Fulfilment | bring it to the meeting | take or swap a listed item (not built) |
| Lifetime | ends with the term | open-ended |
| Fields | name, description | name, (description), modes, matches |

**Confidence**: high for each cell; the "keep separate" reading is medium (a product decision informed by this).

## Part B — Reusable pieces

### B1. Category picker — `CategoryTreePicker`
**Source**: `src/frontend/src/components/shared/CategoryTreePicker.tsx:28-46,67-91`
**Evidence**: props `labelledBy`, `value: string | null`, `onChange(id | null)`, `mode?: "leaf" | "any"` (default `leaf`), `allowRoot`, `placeholder`, `disabled`, `aria-invalid`, `aria-describedby`; a trigger button plus a portaled search and drill-down `ModalSheet`; reads `useCategories` once. Used in the item form (`src/frontend/src/components/shared/ItemQuickAddForm.tsx:59-66`, leaf mode), item edit (`features/product/ItemEditForm.tsx:181`) and admin (`features/admin/CategoryFormPage.tsx:113-117`, `mode="any"`).
**Reuse verdict**: as is. An optional category on a want needs only `value={null}` handling, which exists; a non-leaf pick needs `mode="any"`.
**Confidence**: high.

### B2. Locality + radius — `LocalityCombobox`, `LocationSection`, `lastLocality`
**Source**: `src/frontend/src/components/shared/LocalityCombobox.tsx:27-43`, `src/frontend/src/features/search/SearchFilters.tsx:138-214`, `src/frontend/src/features/search/useSearchUrlState.ts:12`, `src/frontend/src/features/search/lastLocality.ts:1-27`
**Evidence**: `LocalityCombobox({ idPrefix, value: Locality | null, onChange, invalid?, required? })` searches the TERYT dictionary by name or postal code (`useLocalitySearch`, 8 results, min 2 chars). `LocationSection` (not exported) adds: "Ostatnio: <name>" chip from localStorage, `MajorTownPicker` (voivodeship select + town chips, `SearchFilters.tsx:95-136`), and radius chips "Tylko tu / +10 km / +25 km / +50 km" from `SEARCH_RADII_KM = [10, 25, 50]`. The filter stores `locality` (SIMC id) and `radius` (km or `null`) (`src/frontend/src/api/search.ts:14-24`).
**Context**: items use a saved place via `LocationPicker` (`features/items/ItemCreateView.tsx:106-115`), a different component; a want needs only a locality and a radius, which is exactly the search filter's shape.
**Reuse verdict**: `LocalityCombobox` as is; `LocationSection` + `MajorTownPicker` need extracting from `SearchFilters.tsx` (extend).
**Confidence**: high.

### B3. Other item-side filters already modelled — condition and offer type
**Source**: `src/frontend/src/features/search/SearchFilters.tsx:383-422`, `src/frontend/src/api/search.ts:16-24`
**Evidence**: "Stan" chips from `CONDITION_LABELS`; "Oddam / zamienię" chips mapping `ITEM_MODES` through `ITEM_MODE_TO_RESERVATION_TYPE` to `offer_type` `GIFT`/`SWAP`. `SearchFilters` (the type) is `{category, condition, offer_type, date_from, date_to, locality, radius}`.
**Context**: the item half of this type (`category`, `condition`, `offer_type`, `locality`, `radius`) plus `q` is a ready description of "what I am looking for". A want stored in that shape could be opened as a search URL through `useSearchUrlState`, and the empty state (which now forwards only `q`, `SearchView.tsx:274`) could forward all of it.
**Reuse verdict**: chip groups are private to `ItemFilterSheet` (extend/extract); the type is reusable as is.
**Confidence**: high for the code; medium for the fit.

### B4. Result cards — `SearchResultCard` → `ItemCard`
**Source**: `src/frontend/src/features/search/SearchResultCard.tsx:25-38`, `src/frontend/src/components/shared/ItemCard.tsx:9-50`, `src/frontend/src/api/search.ts:40-51`
**Evidence**: a product result renders `ItemCard({ href, name, condition, thumbUrl, mode, reservation, reservedCaption })`; `ProductSearchResult` carries `id, title, subtitle, href, meta {mode, condition, thumb_url, reserved, reserved_until}`. `ItemCard` "shows nothing about who listed it".
**Context**: a "matches for this want" list can render the same DTO with the same card and no new component, if the backend returns `ProductSearchResult`-shaped rows.
**Reuse verdict**: as is.
**Confidence**: high.

### B5. Notifications — bell renders any kind; kind union must grow
**Source**: `src/frontend/src/api/notifications.ts:3-37`, `src/frontend/src/hooks/useNotifications.ts:22-83`, `src/frontend/src/components/shared/NotificationBell.tsx:12-21,62-80`, `src/frontend/src/components/layout/pending/pendingActions.ts:55-77`
**Evidence**:
```tsx
function openNotification(n: NotificationResponse) {
  setOpen(false);
  if (n.read_at === null) markRead(n.id);
  if (n.link_path) navigate(n.link_path);
}
```
- The bell lists `n.message` and follows `n.link_path`; it never switches on `kind`. A new kind needs no bell change.
- `NotificationKind` is a closed union of 12 members with no match-related one; a new member must be added for type safety.
- Reference fields are `proposal_id` and `reservation_id` only; there is no item or want pointer, so the target must be encoded in `link_path`.
- `derivePendingActions` reacts only to `SWAP_PROPOSED` and `TERM_CONFIRMATION_NEEDED`; other kinds yield no blocking sheet, so a match kind stays informational by default.
- One list from `GET /notifications/mine`, no pagination, grouping or per-kind filter in the client; unread badge caps at "9+" (`NotificationBell.tsx:34`).
- The notification list exists only as the header dropdown; there is no notifications page and no settings UI.
**Reuse verdict**: bell and hook as is; union extended; grouping/digest and preferences new.
**Confidence**: high.

### B6. Item page actions — where a match leads
**Source**: `src/frontend/src/api/itemActions.ts:50-82`, `src/frontend/src/features/product/useItemTake.ts:21-27,45-141`; components `features/product/ChooseContextSheet.tsx`, `PersonalPickupSheet.tsx`, `SwapProposeDialog.tsx`, `TakeSuccessSheet.tsx`, `PartyReservationActions.tsx`, `blocks/ItemPickupActions.tsx`
**Evidence**: `GET /public/items/{id}/actions` returns `mode`, `available`, `reservation`, `owner`, `viewer` (`ANONYMOUS | OWN | OTHER`), viewer-shaped `location`, up to 5 `contexts` and `personal_pickup_available`. `useItemTake.take(itemId, mode, target)` with `TakeTarget = { kind: "PERSONAL" } | TakeContext` calls `takeItem` (GIFT) or opens the swap picker and `proposeItemSwap` (SWAP).
**Context**: a seeker who opens a matched item lands on a page that already offers reserve/propose; no want-specific action is needed there. The reverse direction — an owner offering their item to a seeker — has no existing flow: every reservation starts from the receiver.
**Reuse verdict**: as is for seeker → item; owner → seeker is new.
**Confidence**: high.

### B7. Supply-side form as the counterpart
**Source**: `src/frontend/src/features/items/ItemCreateView.tsx:26-32,60-68,96-153`, `src/frontend/src/components/shared/ItemQuickAddForm.tsx:25-82`
**Evidence**: an item collects photos, "Nazwa" (required), "Stan", "Kategoria" (required leaf), "Opis" (max `PRODUCT_DESCRIPTION_MAX`), "Lokalizacja" (required saved place), then one of three actions: "Oddam" (GIFT), "Zamienię" (SWAP), "Wersja robocza". Blocked actions use `aria-disabled` + an sr-only hint, per the accessibility standard. The draft lives in `AppDataContext` (`itemDraft`).
**Context**: these are the attributes a want can be matched on (name, category, condition, offer mode, locality of the place). `ItemCreateView` has no hook after a successful create where "this matches N wants" could be shown; it navigates straight to the new item page (`ItemCreateView.tsx:89`) and can pass navigation state (`ItemCreatedState`), which is the existing channel for a post-create message.
**Confidence**: high.

### B8. Shared building blocks and conventions that apply
**Source**: `src/frontend/src/components/shared/appComponents.tsx:274` (`ListCard`), `components/shared/ModalSheet.tsx:16`, `components/shared/ConfirmDeleteDialog.tsx:25`, `src/frontend/src/features/auth/useAccountGate` (used at `useNeededItemPledge.ts:10`, `useItemTake.ts:53`); standards `.maister/docs/standards/frontend/components.md`, `data-fetching.md`, `accessibility.md`
**Evidence / constraints for a real implementation**:
- Fetching through `src/api/*.ts` + a hook in `src/hooks/` with a prefix key constant, `await invalidateQueries` on the prefix after mutations, `extractProblemMessage` errors verbatim (the hooks in A4, B5 follow this).
- A page with several screens (loading, error, empty, list) derives one view state in a pure `resolve…View()` and switches on `view.kind`, as `/search` does (`src/frontend/src/features/search/searchViewState.ts:43-56`). `WantedView` today has only two branches inline (`WantedView.tsx:48`).
- Delete in a Tailwind page goes through `ConfirmDeleteDialog`; the mock deletes on one click (`WantedView.tsx:75`).
- Router access only through `routing/navigation` (`HuntingCreateView.tsx:2` already complies).
- Anonymous-action gating uses `useAccountGate` + `AuthSheet` (`TermNeededItems.tsx:84-89`), available if wants ever get a public "mam to" button.
**Reuse verdict**: as is.
**Confidence**: high.

## Reuse map (summary)

| Piece | File | Verdict |
|---|---|---|
| Routes `/wanted`, `/add/hunting`, gate, reserved slug | `routing/paths.ts`, `routing/reservedSlugs.ts`, `app/(site)/(panel)/…` | as is |
| `WantedView`, `HuntingCreateView` | `features/search/`, `features/add/` | rewrite on real data |
| Wants API client + hook | — | new |
| Category picker | `components/shared/CategoryTreePicker.tsx` | as is |
| Locality combobox | `components/shared/LocalityCombobox.tsx` | as is |
| Radius chips, last locality, major towns | `features/search/SearchFilters.tsx`, `lastLocality.ts` | extract |
| Condition / offer-type chips | `features/search/SearchFilters.tsx` | extract |
| Item tile for matches | `components/shared/ItemCard.tsx` | as is |
| Notification bell + hook | `components/shared/NotificationBell.tsx`, `hooks/useNotifications.ts` | as is |
| `NotificationKind` union | `api/notifications.ts` | extend |
| Notification preferences / digest UI | — | new |
| Take / propose from a matched item | `features/product/useItemTake.ts` | as is |
| Owner offers an item to a seeker | — | new |
| Needed-item form and pledge flow | `components/shared/NeededItemQuickAddForm.tsx`, `features/terms/…` | not reused |
| Empty-search prompt | `features/search/SearchView.tsx:260-281` | extend (carry filters) |
