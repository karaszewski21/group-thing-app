# Findings — docs-decisions: LEND lifecycle (reference design, standards, prior task decisions)

Category: `docs-decisions` (prefix `docs`). Gathered 2026-09-25.
Paths are relative to the repo root `C:\Users\karas\Desktop\group-thing-app`. Abbreviations:
- **INV** = `docs/system-wypozyczalni-inventory-accounting.md`
- **T14** = `.maister/tasks/development/2026-09-14-lending-exchange-mechanism/`
- **T16** = `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/`
- **T17** = `.maister/tasks/development/2026-09-17-fix-giveaway-exchange/`
- **T20** = `.maister/tasks/development/2026-09-20-fix-item-reservation-confirm-flow/`
- **R02** = `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/`
- **R23** = `.maister/tasks/research/2026-09-23-termpage-state-machine/`

Code verification is out of scope for this category. Where a document disagrees with another
document, or with code that another document describes, the item is **flagged for the codebase
gatherers**.

---

## 1. Reference design (INV): what it says about LEND and RETURN

### 1.1 Data model relevant to lending
| Element | Documented shape | Source |
|---|---|---|
| `Inventory.type` | `personal, pickup_point, virtual`. **No meaning is given for `virtual`**, and no example uses it. | INV:10-14 |
| `InventoryItem` | `inventoryId`, `productId`, `condition` (new, like_new, good, fair, poor), `addedAt`. No `homeInventoryId`. | INV:16-21 |
| `InventoryBalance` | `status` (available, reserved, in_transit, lent, returned), plus `reservedAt`, `lentAt`, `returnedAt`, `dueDate` | INV:23-30 |
| `Reservation` | "koszyk", always the first step. `type` (lend, return, swap, gift), `reservedBy` = the person who will **receive** the item, `expiresAt`, `status` (pending, confirmed, cancelled, fulfilled), `notes` | INV:32-42 |
| Rule | "Każda zmiana posiadania — wypożyczenie, zwrot, zamiana, oddanie — zaczyna się od `Reservation`… Dopiero gdy któraś ze stron zaakceptuje odbiór (`status: fulfilled`), powstaje `CirculationTransaction`." | INV:33 |
| Points | Points go to the person who **currently hands the item on** (the current holder), not to `reservedBy`. Every item is worth 1 pt. | INV:59 |

### 1.2 LEND flow (KROK 2–4)
- **KROK 2, reservation:** `type='lend'`, `reservedBy`=borrower, `expiresAt`=2026-09-12, status `pending`. Balance goes `available → reserved`, `reservedAt` is set, **and `dueDate` = expiresAt (09-12)**. No points transaction. (INV:96-130, dueDate at INV:118)
- **KROK 3, owner confirms:** reservation `pending → confirmed`, balance `reserved → in_transit`. The **owner** (User 1) is the one who confirms. (INV:134-153)
- **KROK 4, borrower picks up:** reservation `→ fulfilled`, balance `in_transit → lent`, `lentAt` is set, **`dueDate` = lentAt + 14 days** ("14 dni na zwrot", INV:166). The owner gets 1 pt (Dt 100-100 owner / Ct 900-100). (INV:157-205)
- Resulting state: the item **stays in the owner's inventory** ("Magazyn Ani → … InventoryBalance: status = lent (u Piotra)", INV:207-213). Section 4 says the same: "`type: lend/return` = tymczasowa zmiana posiadania (właściciel bez zmian)" (INV:505).

### 1.3 RETURN flow (KROK 5)
- This is a **separate `Reservation`** (`RES-001-RETURN`), `type='return'`, **`reservedBy` = the owner** (who receives the item back), `expiresAt=null`. In the example it is constructed **directly as `'fulfilled'`**. (INV:224-235)
- Balance goes `lent → returned → available`, and all dates are cleared (`reservedAt`, `lentAt`, `returnedAt`, `dueDate` = null). (INV:237-246)
- The **borrower** gets 1 pt, posted as "osobne zdarzenie, nie 'storno' wypożyczenia" (INV:248). A full lend+return cycle therefore issues 2 pts: "nagradza zarówno użyczenie, jak i rzetelny zwrot" (INV:301).
- §3 summary table: "Odbiór — zwrot | fulfilled | return | returned → available | pożyczkobiorca (zwracający) | TAK (1x, osobna transakcja, nie storno)" (INV:487).

### 1.4 Stated general rules
- "Niezależnie od typu (`lend`, `return`, `swap`, `gift`) rezerwacja **zawsze** przechodzi przez `pending` → `confirmed`" (INV:479, table rows INV:484-485 list `return` explicitly).
- Balance status flow: `available → reserved → in_transit → lent → returned → available` (INV:511-516). `returned` is described as a transient state ("w trakcie przywracania do available", INV:525).
- Benefits table: "Czysty DDD — InventoryBalance = Value Object (status, daty), Reservation = Entity (historia)" (INV:502), and "Pełna historia/Audyt" through Reservation plus CirculationTransaction (INV:501, 504).

### 1.5 What INV does NOT cover (lifecycle gaps at the design level)
INV has no mention of: return intent initiated by the borrower as a request, a return request from the owner, extension or renewal, reminders, overdue (whether stored or derived), confirmation of receipt by the owner as its own step, damage or loss, disputes, write-off, cancelling a LEND after hand-over, or where and when the physical return happens (INV has no concept of Terms at all, as T14 `analysis/clarifications.md:4` confirms: "no mention of Terms/Circles/attendance anywhere in that spec"). The only lifecycle-adjacent fields are `dueDate`, `returnedAt` and `InventoryItem.condition`. Condition could support a condition check at return, but INV never uses it that way. **Confidence: High** (the full document was read, 560 lines).

### 1.6 Internal inconsistencies inside INV
1. **RETURN skips pending/confirmed** in the KROK 5 example (created as `'fulfilled'`, INV:233), which contradicts §3 "zawsze przechodzi przez pending → confirmed" (INV:479, 485). The example is a shortcut. The rule is explicit.
2. **`dueDate` has two meanings.** At reservation time it equals `expiresAt` (reservation hold expiry, INV:118). At fulfilment it is the loan due date (INV:166). This matters because code reportedly derives `due_date` from `expires_at` (sources.md, `reservations.py` l.99). → flag for codebase-backend.
3. **"reversal" vs "not storno".** INV insists RETURN is a separate event, not a reversal (INV:248, 487). Later task docs describe RETURN as something that "reverses a specific prior LEND" (T20 `implementation/spec.md:82`). This is a semantic tension in wording only, but it shapes how the ledger and history get modelled.

---

## 2. Documented design vs the implemented direction (flags for codebase gatherers)

| # | INV says | Later docs / code (as described in task docs) | Evidence | Flag |
|---|---|---|---|---|
| D1 | LEND keeps the item in the owner's inventory ("właściciel bez zmian", `inventoryId` unchanged) | The code moves the item into the borrower's **VIRTUAL** inventory and keeps the owner's inventory in `home_inventory_id`. `_current_holder_user_id` "now derives holder via `home_inventory_id`/VIRTUAL inventory instead of reservation history — a bugfix, keep it" | INV:207-213, 505; T16 `analysis/codebase-analysis.md:25, 28, 170, 212` | **Deliberate deviation from INV, never recorded as a decision in any spec.** The only record is "in-flight WIP… leave untouched" (T16 `analysis/clarifications.md:38-44`; T16 `implementation/spec.md:367-370`). No task doc defines what VIRTUAL means. |
| D2 | Confirmation is done by the owner (KROK 3), then pickup/fulfil | The Term flow collapses confirm+fulfil into one "first-to-confirm-wins" action by either party, allowed only after `term.occurs_on` | T16 `analysis/clarifications.md:12-17`; T16 `implementation/spec.md:37-46, 240-250`; T20 `analysis/scope-clarifications.md:109` | Accepted deviation. LEND is treated exactly like GIFT here. |
| D3 | Balance `reserved → in_transit` on confirm | T20 describes a lock as `RESERVED`/`IN_TRANSIT` (`ACTIVE_LOCK_BALANCE_STATUSES`); whether IN_TRANSIT is ever reached in the Term flow is not stated | T20 `analysis/requirements.md:56`; T20 `implementation/spec.md:14` | Codebase-backend should verify. |
| D4 | RETURN goes through pending → confirmed → fulfilled | FE `returnBorrowedItem` performs RETURN create+confirm+fulfil in one step, done by the borrower alone (research-brief). T20 confirms it is "a real, reachable creation path with no Term context at all" | INV:479; T20 `implementation/spec.md:82` | Contradicts both the INV rule and T14 decision #9 / scope decision 5 ("No shortcuts — all reservation types (LEND/RETURN/SWAP/GIFT)… go through the full… state machine", T14 `analysis/requirements.md:21`, `analysis/scope-clarifications.md:101-102`). |
| D5 | Due date = lentAt + 14 days | Code constant `_DEFAULT_LEND_DAYS = 14` (sources.md) | INV:166 | Consistent in intent. Codebase-backend should confirm which date is used (see §1.6-2). |
| D6 | Points: owner on LEND, borrower on RETURN, 1 pt each | T14 codebase analysis: "`fulfill_reservation`… Always posts a flat `Decimal("1")`" for every type | INV:486-487; T14 `analysis/codebase-analysis.md:130` | Codebase-backend should verify that the RETURN posting goes to the returner (the holder in the VIRTUAL inventory). |
| D7 | Reservation has no Term (INV has no Terms) | T14 decided "no `term_id` column added there [circulation]" (out of scope). **T20 reversed this**: `Reservation.term_id` NOT NULL, migration 0034 | T14 `analysis/requirements.md:49`, `analysis/scope-clarifications.md:85-87`; T20 `analysis/clarifications.md:77-81`, `analysis/requirements.md:13, 24-25`, `implementation/work-log.md:48` | **Decision reversal.** Circulation now carries a Term id (as a plain FK), although T16's "circulation stays Term-independent (no new columns…)" constraint is stated in T16 `implementation/implementation-plan.md:269`. Any new LEND work must decide which rule currently holds. |
| D8 | LEND = temporary, owner unchanged | T17 describes the GIFT/LEND taker's post-term confirm as making "the item's ownership actually transfer to me" | T17 `implementation/spec.md:5, 14-19` | Conceptual conflation of LEND with GIFT in the documentation. Codebase-backend should check that LEND fulfilment goes to VIRTUAL, not a permanent transfer. |

---

## 3. Explicit prior decisions that constrain the LEND lifecycle

### 3.1 From T14 (lending/exchange mechanism, 2026-09-14)
- Listings are Term-scoped (`TermItemListing` in `app.groups`). Only attendees of the same Term can browse or take. (T14 `analysis/requirements.md:11-18`; `analysis/scope-clarifications.md:85-87`)
- The lister chooses offered types from `{LEND, SWAP, GIFT}`. "**RETURN is a lifecycle transition, never a listing-time choice**". (T14 `analysis/requirements.md:24, 33`; `implementation/spec.md:136, 193`)
- Reuse the existing Reservation → CirculationTransaction pipeline, "no parallel mechanism". (T14 `analysis/clarifications.md:69-71`)
- No shortcuts for any type, **RETURN included**. (T14 `analysis/requirements.md:21`; `analysis/scope-clarifications.md:101-102`)
- Only **PERSONAL**-inventory items owned by the caller can be listed (`inventory_type == PERSONAL`), and the item's balance must be `AVAILABLE`. As a consequence, **a borrowed item (sitting in the VIRTUAL inventory) cannot be re-listed or sub-lent**, provided the rule is still in force. (T14 `implementation/spec.md:98`) → verify in code.
- `TermItemListing` has no owned status. Its status is derived by re-fetching. (T14 `implementation/spec.md:108`; `implementation/work-log.md:110` "derived-only")
- A cross-module reference must be a plain id (loose FK, following the `Pledge.resolved_reservation_id` precedent). (T14 `analysis/requirements.md:37, 53`)

### 3.2 From T16 (giveaway/exchange rework, 2026-09-16)
- **Lock immediately, confirm after the term.** "Chcę wziąć" creates a PENDING Reservation (GIFT/LEND) and locks the item. Confirmation is available only once `term.occurs_on` has passed. Either party may confirm, the first confirmer wins, and "that single action confirms + fulfills". (T16 `implementation/spec.md:37-46`; `analysis/clarifications.md:12-25`)
- The losing side of the race gets a Notification (D4). (T16 `analysis/scope-clarifications.md:92-95`)
- **Term-end detection by an APScheduler periodic worker.** It emits events into the outbox exactly once, with an idempotency marker. It lives in `app.groups` and reaches circulation only through the bridge. APScheduler was a deliberate exception to the minimal-dependencies rule. (T16 `analysis/scope-clarifications.md:78-90`; `analysis/technical-clarifications.md:115-137`; `implementation/spec.md:251-259`) → **This is the documented precedent for time-based scans such as due-date reminders and overdue checks.**
- **Channels: in-app notifications only.** "Push/email/SMS notification channels — in-app notification inbox only". (T16 `analysis/requirements.md:275-276`; `implementation/spec.md:371-372`)
- Post-term actions (accept/reject, confirm) are shown as a **global modal on any page**. "Moje rzeczy" shows only a passive status badge. (T16 `analysis/requirements.md:212-223`)
- There is one unified Term page for logged-in and guest users. Guests see every button but are sent to login when they click one ("To jest całe klu biznesu"). (T16 `analysis/requirements.md:191-211`)
- The confirm authorization for the race is a new rule scoped to `app.groups`. `_require_holder_to_confirm` (used by the Pledge flow) must stay unmodified. (T16 `analysis/scope-clarifications.md:104-107`; `implementation/implementation-plan.md:63, 269`)
- The "borrowed items" WIP (`home_inventory_id` migration 0030, `WypozyczoneView.tsx` with a single "Oddaję" action, the people-router `by-account-user-id` endpoint) was declared a separate feature and left untouched. **No task ever specified it.** (T16 `analysis/clarifications.md:38-44`; `analysis/codebase-analysis.md:71, 75`)
- Implementation note: `_resolve_transaction_holder_user_id` resolves a stable holder from ItemListingPreference/SwapProposal, because the dynamic holder lookup "breaks on the SECOND (losing) caller once fulfill already moved ownership". (T16 `implementation/implementation-plan.md:86`) This is relevant because a LEND fulfilment moves the item to VIRTUAL, which changes the dynamic holder.

### 3.3 From T17 (fix giveaway/exchange, 2026-09-17)
- Both the GIFT/LEND owner and the taker must be able to resolve their pending reservation id after the term, independently of the availability-filtered browse. (T17 `implementation/spec.md:31-37`; `analysis/gap-analysis.md:39-42, 99-100`)
- `TERM_CONFIRMATION_NEEDED` is the global-modal notification for GIFT/LEND/SWAP. (T17 `implementation/spec.md:78`; `analysis/design-context/ascii/ui-mockups.md:14, 36, 164-217`)

### 3.4 From T20 (fix confirm flow, 2026-09-20)
- `Reservation.term_id` is **NOT NULL** and persisted when the reservation is created (migration 0034, with backfill). (T20 `analysis/clarifications.md:77-81`; `implementation/work-log.md:48`)
- **RETURN's `term_id` is derived on the server from the most recent FULFILLED LEND of the item** (`_resolve_return_term_id`). The rationale given: "a return belongs to the same term-scoped exchange as the loan it reverses… avoids inventing a sentinel/fake term". `CreateReservationRequest.term_id` is optional only for RETURN. (T20 `implementation/spec.md:82`; `implementation/work-log.md:48`)
  - **Implication:** the RETURN is bound to a Term that is already past, so any term-end gate is trivially satisfied. The documented design therefore treats return as **ad hoc, not bound to a future Term**. Whether the return *should* happen at the next Term is not decided anywhere. It is an open question (B3).
  - If a LENT balance has no FULFILLED LEND, the system raises a typed 409 (`test_createReservation_returnWithLentBalanceButNoFulfilledLend_raisesBusinessConflict`). (T20 `implementation/work-log.md:109`)
- **Cancel after the term = "Anuluj wymianę"** (`POST /api/reservations/{id}/cancel-transaction`). It has the same gating as confirm (term ended, race participant, already-resolved guard). It releases the item to AVAILABLE, and cancelling a SWAP cancels both legs. It is described as "a clean release, not an accusation or audit trail". (T20 `analysis/clarifications.md:83-92`; `analysis/requirements.md:16-19`; `analysis/scope-clarifications.md:107-109`; `implementation/spec.md:134`)
- **Explicitly out of scope:** "dispute/moderation workflow, auto-expiry of unconfirmed reservations, and any UI/logic distinguishing 'the other side lied' from 'we both forgot'". (T20 `analysis/clarifications.md:92`; `analysis/requirements.md:69`) → **Disputes, lost and damaged items were consciously deferred, not forgotten.** The current LEND research is the first place they are in scope.
- The "Odebrał"/"Anuluj wymianę" buttons on the locked tile appear only after the term has ended. Before that, the tile shows only a lock badge and the toggles are disabled. (T20 `analysis/requirements.md:39-40, 56, 62`)
- `InventoryBalanceResponse.reservation_id` is populated for RESERVED/IN_TRANSIT. (T20 `analysis/scope-clarifications.md:113`; `implementation/work-log.md:90`) **Open question:** is it also populated for LENT? Owner and borrower both need the LEND reservation (and later the RETURN) id. → verify in code.
- `set_item_listing_preference` reassigns `owner_party_id` after an ownership transfer. The existing test `test_setPreference_whileItemLentOut_stillSucceeds` shows that **a preference can be set or kept while the item is LENT** (the LEND keeps the preference). (T20 `analysis/codebase-analysis.md:96, 142`)

### 3.5 From R02 (party archetype / Pledge, 2026-09-02)
- A Pledge becomes a Reservation only once a concrete InventoryItem exists. The Reservation is **`gift` or `lend`**, "zależnie od tego, czy rodzina oddaje przedmiot na stałe… czy tylko użycza go na czas zajęć — to **osobna decyzja produktowa, nie rozstrzygana w tym badaniu**". `reservedBy` = the organizer, as a User. (R02 `outputs/research-report.md:603-612`)
- "Zachowanie `Pledge` przy `Reservation.status=cancelled` pozostaje nieudokumentowane". (R02 `outputs/decision-log.md:120-121`)
- → The **Pledge→LEND to the organizer** (auto-confirm, per the brief) has no documented return semantics. B8 remains fully open. "Użycza go na czas zajęć" suggests the item returns after the Term.

### 3.6 From R23 (TermPage state machine, 2026-09-23)
- The only LEND reference is the TermPage UI state `takingIds` ("LEND/GIFT w toku (S11)") and the recommendation to decouple take (LEND/GIFT) from the swap picker. (R23 `outputs/research-report.md:329`; `analysis/synthesis.md:106`) R23 contains no post-lend decisions.

### 3.7 R-business-model (2026-09-22)
- Grep for wypoż/pożycz/lend/zwrot/obieg returned **no matches**, so it contains no LEND-specific decisions.

---

## 4. Standards and project docs relevant to the LEND design

| Standard | Rule relevant to LEND lifecycle | Source |
|---|---|---|
| models.md, enums | `enum.StrEnum` stored as a String column, never ordinal. New Reservation or Balance statuses (e.g. RETURN_REQUESTED, OVERDUE, LOST) are therefore string values. | `.maister/docs/standards/backend/models.md:115-117` |
| models.md, simplicity | Prefer plain columns or JSONB over new mapped classes. Create an entity only when "you need identity, lifecycle, or complex relationships". This bears on whether a "Loan" gets its own aggregate or stays a LEND+RETURN reservation pair (B9). | `models.md:9` |
| models.md, cross-module | Pass raw ids across bounded contexts. No `relationship()` crossing module boundaries. | `models.md:140-152` |
| models.md, locking | `updated_at` is the `version_id_col` (optimistic lock, `StaleDataError`). This is relevant to races such as owner recall versus borrower return. | `models.md:91-102` |
| models.md, lazy | `lazy="raise"` plus explicit eager loads. | `models.md:124, 188` |
| minimal-implementation | Build only what will be called. No future stubs or speculative abstractions. This argues for a minimal state set and against pre-building dispute or escalation machinery. | `.maister/docs/standards/global/minimal-implementation.md:1-22` |
| migrations.md | Every migration is reversible. Keep migrations small and focused. Keep schema and data migrations in separate revisions. | `.maister/docs/standards/backend/migrations.md:8-9, 11, 23-24` |
| security.md | Enforce per route with `require_any(...)`, consistent with `AUTHORIZATION_MATRIX`. | `.maister/docs/standards/backend/security.md:27` |
| data-fetching.md (FE) | TanStack Query hooks in `src/hooks/`. No `useState`+`useEffect` fetching. Mutations `await invalidateQueries` on the resource prefix. | `.maister/docs/standards/frontend/data-fetching.md:5, 13, 22-29` |
| DDD layering (memory) | groups/circulation use domain/application/infrastructure layers behind a flat `service.py` facade. Only the ACL/bridge imports across verticals. `circulation/domain/balance_state_machine.py` extraction is a **known deferred follow-up**, which is a natural place for the LEND lifecycle transitions. | `C:\Users\karas\.claude\projects\C--Users-karas-Desktop-group-thing-app\memory\project_backend_ddd_refactor.md` (Structure + deferred follow-ups paragraphs) |

**Documentation drift (flag):**
- There is **no "derived-not-stored" standard** in `.maister/docs/standards/`. A grep for "derived" finds only a frontend `isStale` example (`data-fetching.md:43`). The brief's constraint "derived-not-stored" therefore has no written standard behind it. The closest precedents are T14's derived listing status (T14 `implementation/spec.md:108`) and the "InventoryBalance = Value Object" line (INV:502). Consider proposing a standard.
- `.maister/docs/project/architecture.md:60-95` lists only the auth/oauth2/category/product/plugin/footprint/system verticals and `alembic/versions/0001_initial_schema.py`. **It does not mention `circulation`, `groups`, `notifications`, `outbox`, or APScheduler.** The project architecture doc is stale relative to the lending domain.
- `security.md:27` says `AUTHORIZATION_MATRIX` is in `app/core/auth_deps.py`. The DDD refactor memory says it moved to `app/core/authorization_matrix.py`.
- `.maister/docs/standards/testing/backend-testing.md` (as indexed in INDEX.md) still describes Java-era MockMvc/@Transactional. The real gate is `uv run pytest` (memory).

---

## 5. Stated intents vs open questions (mapped to the plan's B-questions)

| Sub-question | Already decided / stated intent (with source) | Still open |
|---|---|---|
| **B1** state set | Reservation statuses: pending/confirmed/cancelled/fulfilled. Balance: available/reserved/in_transit/lent/returned (INV:41, 26). RETURN is a separate Reservation (INV:224-235). Listing status is derived (T14 spec:108). | Whether to add RETURN_REQUESTED, OVERDUE, LOST, DISPUTED. Overdue as stored or derived (now > due_date). INV has no such states. |
| **B2** initiator/confirmer | INV: the owner confirms the LEND (KROK 3). RETURN `reservedBy`=owner and points go to the returner (INV:229, 487). Term flow: either party, first wins (T16). | Whether the owner must confirm receipt of the return. Today the borrower does it alone (D4), which contradicts the no-shortcuts decision. |
| **B3** where the return happens | RETURN's term_id is derived from the original LEND's term (T20 spec:82), so the design is implicitly ad hoc and not tied to a future Term. | Whether the return should be tied to the next Term of the same Circle, with confirmation after that Term ends. Not decided anywhere. |
| **B4** extension / due date | Default of 14 days (INV:166). | Extension, approval, limits, and whether the due date follows Term cadence: **not documented anywhere**. |
| **B5** reminders/overdue | Infrastructure precedent: APScheduler scan plus outbox, once and idempotent (T16 D3). Channel: in-app only (T16). | Timing, escalation, and new `NotificationKind` values. |
| **B6** disputes/lost/damaged | Explicitly deferred in T20 (clarifications.md:92). "Anuluj wymianę" = clean release, not an accusation. `InventoryItem.condition` exists (INV:20). | Everything: who raises a dispute, the outcome (write-off?), what happens to the balance, and ledger treatment (INV forbids "storno" wording for returns, and says nothing about reversals for loss). |
| **B7** cancellation | Pre-handover: "Anuluj wymianę" after the term, either party, releases to AVAILABLE (T20). Before the term ends: lock only, no buttons (T20 req:39-40). | Cancelling a PENDING LEND before the term (taker changes their mind). After hand-over, cancellation cannot exist and becomes a return (no doc states this). |
| **B8** Pledge→LEND | The Pledge can become gift **or** lend, "osobna decyzja produktowa" (R02 report:607-609). | Whether and when the organizer returns the item. Undocumented. |
| **B9** aggregate | INV: Reservation = Entity, Balance = VO (INV:502). "Jeden model rezerwacji dla wszystkiego" (INV:499). models.md:9 says create an entity only when identity or lifecycle is needed. | A new "Loan" aggregate versus the LEND+RETURN pair. INV's "one reservation model" principle points towards the pair. The richer lifecycle (extension, recall, dispute) may meet models.md's "lifecycle" criterion for a new entity. |

---

## 6. Rejected alternatives recorded in prior docs (relevant precedents)
- Adding a `term_id` to circulation models was **rejected in T14** (scope-clarifications.md:85-87) and **then adopted in T20** (clarifications.md:77-81). The frontend-only re-resolution of term_id from notifications was rejected as fragile (T20 clarifications.md:81).
- Auto-confirm on take on behalf of the giver was **rejected** (T16 clarifications.md:12). Unilateral actions that skip the counterparty are against the documented direction. This is a strong precedent against today's one-step borrower-only RETURN.
- The GIFT fast path (immediate fulfilment) was **rejected** (T14 scope-clarifications.md:101-102).
- A zero-dependency asyncio loop was **rejected** in favour of APScheduler (T16 technical-clarifications.md:124-127).
- A new shared invalidation/event-emitter primitive in the FE was **rejected** in favour of a route-focus reload (T20 scope-clarifications.md:119).
- A Reservation with a nullable itemId was **rejected**, and a Pledge `Relationship` was **rejected**, in favour of a `Pledge` entity (R02 decision-log.md:89-111).

---

## 7. Confidence
- INV content and its internal inconsistencies: **High (95%)**. The full document was read.
- Prior task decisions (T14, T16, T17, T20, R02): **High (90%)**. Taken from requirements, clarifications and spec files with line citations. Work-logs and plans were grep-sampled, not fully read.
- Contradictions D1–D8 between the docs and the code as described: **Medium (70%)**. They rest on task-doc descriptions of the code, not on direct code reading. Codebase gatherers must confirm them.
- Absence claims (no extension, overdue or dispute decisions anywhere; no VIRTUAL definition; no derived-not-stored standard): **High (85%)**. Based on keyword greps across `.maister/tasks` and `.maister/docs`.
