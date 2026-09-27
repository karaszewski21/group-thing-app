# External Findings — Loan Lifecycle After Hand-over (C1–C4)

Category: `external` · Gathered: 2026-09-25 · Tools: WebSearch, WebFetch

Confidence scale: **High** = primary source fetched and quoted; **Medium** = primary source seen only via search snippet, or a single secondary source; **Low** = inferred.

Access notes: myTurn support pages (403), Fat Llama help (402 / DNS failure) and Peerby help (DNS failure) could not be fetched. Claims about them rest on search-result snippets of their official pages and are marked Medium. The Lend Engine user-guide PDF could not be parsed, so its claims come from the Lend Engine feature pages.

---

## C1. Library of Things / tool and toy libraries

### C1.1 Library of Things (London, UK), a kiosk-based rental
Source: https://www.libraryofthings.co.uk/terms-of-borrowing (fetched) — **High**
- **Due date is fixed at booking.** Things go back "to the Library of Things kiosk that you borrowed it from by closing time on the stated Return Date."
- **Borrower extends it themselves, with two guards.** The return date can be changed in the account only if "There are no reservations made by another Member starting on or before your new proposed Return Date" and "The Thing is not already overdue."
- **Late fee, then an automatic "non-return".** The late fee is 1.5x the daily cost per day. If the item is not back within 24 hours of the return date "without prior agreement", it is treated as a non-return and the full replacement cost is charged.
- **Condition is checked at pick-up.** Members inspect the item when they collect it and must report damage or missing parts straight away. Otherwise they may be held responsible for it. "Reasonable use" wear is not charged. There is also a cleaning fee for items returned dirty.
- **Disputes are handled by talking.** Library of Things "will work with you to try and find a solution."

### C1.2 Leila Leihladen (Berlin), a community lending shop
Source: http://leila-berlin.de/leihregeln/ (fetched) — **High**
- **Loan period is agreed per item.** "Die Ausleihzeit hängt von der Sache ab und wird gemeinsam mit dem Leila-Teammitglied vereinbart" (the loan length depends on the item and is agreed with a team member). Members are asked to return things as soon as they are done.
- **Two extensions allowed.** "Du kannst die Leihe zweimal verlängern."
- **Condition rule.** Items must come back "sauber, funktionsfähig, vollständig" (clean, working, complete).
- **Damaged or lost.** The borrower pays for repair or the deposit is kept. If the item is lost, the borrower either forfeits the deposit or replaces it "durch einen vergleichbaren" (with a comparable item). Replacing in kind is a no-money option.
- **Very lenient on lateness.** Fees start only after 30 days (0.50 EUR/day). Deposits apply only to valuable items. Established members may have the deposit waived based on their borrowing history.

### C1.3 Berkeley Tool Lending Library (public library)
Source: https://www.berkeleypubliclibrary.org/locations/tool-lending-library/borrowing-tools (fetched) — **High**; https://www.berkeleyside.org/2022/09/08/berkeley-public-library-end-late-fees-tool — **Medium** (press)
- **Loan and renewals.** The standard loan is 7 days, with "up to 2 consecutive renewals … dependent upon the reserve status of the item." Renewals are refused if someone is waiting for the tool.
- **Overdue handling.** An overdue notice is sent first, then the case escalates. Accounts with billed items are **blocked from further borrowing**.
- **No fines since 2022.** Berkeley stopped charging late fines in October 2022. It now blocks borrowing until the item is returned. This is a soft sanction that costs no money.
- **Condition rule.** Return "in the same condition, normal wear and tear excepted". Stop using and return any tool "in a state of disrepair".

### C1.4 Toronto Tool Library
Source: https://torontotoollibrary.com/loan-durations/ (search snippet) — **Medium**
- Loans last up to 7 days, and late fees are charged per day after that.

### C1.5 Toy libraries (closest to our children's-items domain)
Sources: Riverside PL, Cape Cod Toy Library, Rochester PL, via search snippets — **Medium**
- https://www.riversideca.gov/library/library-services/youth-services/toy-lending-library — 2-week loan, renewable up to 3 times.
- https://www.capecodtoylibrary.org/toy-lending-library — 2 weeks plus one 2-week renewal (the page returned 404 when fetched, so this is from the snippet only).
- https://roccitylibrary.org/division/toy-library/ — 3-week loan. Toys are "checked for completeness and sanitized upon return". Checking every piece at return is standard for toys.

### C1.6 Lend Engine (software for libraries of things and toy libraries)
Sources: https://www.lend-engine.com/features/loan-management-software (fetched) — **High**; https://www.lend-engine.com/automation (search snippet) — **Medium**
- **Check-in per item, with prompts.** Staff "check in one item on a loan at a time (completing any workflow prompts required)". Prompts can ask about condition.
- **Damage routes the item to repair.** Damaged items or items that need cleaning are assigned "to a technician or 'repair' location". A damaged item goes into a separate state or location instead of becoming available again.
- **Extensions.** Outstanding items "can be extended as long as there isn't an upcoming reservation". Member self-extension is a separate setting.
- **Reminders.** A reservation reminder goes out the day before collection. Overdue emails are sent X days after the due date and can repeat "every X days until an item is returned".
- **Overdue fee is only suggested.** At check-in the system *suggests* a fee and staff decide whether to take it.

### C1.7 myTurn (lending-library software)
Sources: https://support.myturn.com/hc/en-us/articles/214580817-Automated-Email-Reminders, https://support.myturn.com/hc/en-us/articles/360047210031-Loan-Rental-Configuration, https://support.myturn.com/hc/en-us/articles/206389387-Item-Check-In-Check-Out (search snippets only, 403 on fetch) — **Medium**
- **Reminders.** A due reminder goes out "the day before an item is due". Overdue reminders then run "once per week".
- **Renewal as its own action.** A renewal "looks like a check in and check out, but will also mark the action as a renewal". Staff can override the due date.
- **Self-renewal guard.** Self-renewal is offered only after a minimum percentage of the loan period has passed, "to prevent a user from immediately renewing a new loan".
- **Maintenance.** A 2022 release added maintenance and ticketing for items (https://myturn.com/2022/09/maintenance-tracking-and-ticketing-updates-late-summer-2022-myturn-release/).

---

## C2. Peer-to-peer lending and rental platforms

### C2.1 Hygglo (Nordic/UK P2P rental)
Source: https://help.hygglo.info/en/articles/10837672-how-hygglo-works-when-you-rent (fetched) — **High**
- **Joint inspection at pick-up.** Both parties inspect the item together at pick-up and **confirm the return time**.
- **Late borrower must tell the lender.** "Return the item at the agreed time and place". If delayed, inform the lender immediately.
- **The owner closes the loan.** "**The rental period ends when the lender confirms that the item has been returned.**"
- **An extension is a new booking.** The renter taps "Extend rental" and "An extension creates a separate new booking with its own order number, chat, and handover."
- **Reviews** are left after completion.

Source: http://help.hygglo.info/en/articles/10587214-how-to-provide-great-service-and-understand-security-protection (fetched) — **High**
- "Once it is marked as returned, the rental is completed". The return mark is final and closes the refund path.

Source: http://help.hygglo.info/en/articles/10494232-how-to-submit-a-claim-on-the-insurance-or-guarantee (fetched) — **High**
- **Damage claims.** Report "as soon as possible", with photos or videos and a description. The claim is decided by a third party (the insurer or the Resolutions Team).

Source: https://help.hygglo.info/en/articles/10751302-lender-responsibilities-and-liability (search snippet) — **Medium**
- Lenders are advised to take photos or videos of the item's condition before and after the rental.

### C2.2 Fat Llama (UK/US P2P rental)
Sources: https://fatllama.crisp.help/en/article/about-the-owner-guarantee-129lu8x/, https://fatllama.crisp.help/en/article/report-a-late-return-case-1t55i3q/ (search snippets only) — **Medium**
- **Damage window.** Damage must be reported with photos or video **within 24 hours of the rental ending**.
- **Evidence before the rental.** The owner guarantee requires timestamped photos taken at most 24 hours before the rental starts.
- **Late return** is its own case type, with a dedicated "Report a 'Late Return' case" flow. A case manager is assigned.

### C2.3 Olio (free UK sharing app with a Borrow section)
Source: https://help.olioapp.com/en/articles/12240533-how-does-lending-and-borrowing-work-on-olio (fetched) — **High**
- **No money, and the app does not track the loan.** Users agree the loan period "via messaging in the app before you hand the item over" and agree a return date and time before lending.
- **What the app does not do.** It does not track returns and does not complete the transaction. It has no enforcement.
- **Non-return and damage.** If the item is not returned, the user contacts support. For damage, the lender may "request that the borrower fixes or replaces the item". Borrowers are advised to photograph the item at pick-up. Users are told to "only lend low value, non-sentimental items".
- **Trust gating.** Lenders can restrict borrowing to "4★+ rating, … shared with 5+ Olioers, … live within 2km".

### C2.4 Buy Nothing Project (gift economy)
Source: https://docs.buynothingproject.org/howto (fetched) — **High**
- **Lender-set rules.** Lending uses posts tagged `#lendinglibrary` "with any rules you choose". Borrowers comment with "the dates they'd like to pick up and return".
- **No lifecycle support.** There are no rules for non-return or damage. The system relies entirely on honour and gratitude.

### C2.5 Peerby (Dutch neighbour lending)
Sources: https://sharingcitiesalliance.knowledgeowl.com/help/goods-sharing-platform-peerby, https://fi.co/insight/peerby-s-app-lets-you-borrow-just-about-anything (secondary sources) — **Medium/Low**
- Free lending between neighbours works by request broadcast plus chat, with details agreed privately. Peerby later added paid rental and a guarantee. We found no primary source for Peerby's return or dispute flow; its help site could not be reached.

---

## C3. Public-library ILS (Koha)

Sources: https://koha-community.org/manual/latest/en/html/circulation.html (fetched) — **High**; renewal-rule details via ByWater Solutions (https://bywatersolutions.com/education/monday-minutes-circulation-rules, https://help.bywatersolutions.com/portal/en/kb/articles/changing-circulation-rules) — **Medium**; https://koha-community.org/manual/latest/en/html/cron_jobs.html and https://perldoc.koha-community.org/misc/cronjobs/longoverdue.html — **Medium/High**; recalls via https://koha-community.org/manual/22.05/en/html/circulation.html and https://bywatersolutions.com/education/item-recalls-in-koha — **Medium**

- **Renewal rules.** Each rule sets "Renewals allowed" (a count), "Renewal period", "No renewal before" (how early you may renew) and "No automatic renewal after".
- **Holds block renewal.** "The checkouts will not be automatically renewed if there is a hold on the item." A hold also blocks manual renewal unless staff override it.
- **Automatic renewal** runs as a cron job and uses the same limits.
- **Unseen renewals.** Koha records whether the item was physically present at renewal. This separates remote renewals from in-person ones.
- **Overdue notices** fire on day-offset triggers (e.g. day 7, 14, 30) set in "Overdue notice/status triggers".
- **Long overdue becomes lost.** The `longoverdue.pl` cron marks items *Lost* after N days overdue (`DefaultLongOverdueDays`). It can optionally charge a fee. This is a derived, time-based escalation.
- **Claims returned.** When a patron says they returned an item that the system still shows as out, staff mark it "Claimed returned". The item stays in the patron's checkouts, its lost status is updated, and a fee is optional (`ClaimReturnedChargeFee`). A warning appears after N claims (`ClaimReturnedWarningThreshold`). The claim is resolved later with a documented reason. This state covers "I gave it back / I never got it" disagreements.
- **Recall.** Another patron can recall an item that is checked out. The current borrower's **due date is shortened** by the "recall due date interval" and they are notified. A recall expires if it is not picked up within `RecallsMaxPickUpDelay`.
- **Check-in** can prompt staff to transfer the item back to its home library, confirm holds, or deal with lost or damaged flags.

---

## C4. Modelling patterns

### C4.1 Loan as an explicit state machine with actors (Sharetribe)
Sources: https://www.sharetribe.com/docs/concepts/transactions/transaction-process/ (fetched) — **High**; https://www.sharetribe.com/help/en/articles/9106928-how-calendar-booking-transactions-work (fetched) — **High**; https://www.sharetribe.com/help/en/articles/9106937-how-purchase-transactions-work (fetched) — **High**; https://github.com/sharetribe/example-processes — **Medium**
- **States and transitions, each with an actor.** Each transition is triggered by exactly one actor: customer, provider, operator, or **system (time-based)**.
- **Default booking process.** request → accepted/declined/expired → (auto) delivered **48 h after booking end** → review window of **7 days**, with reviews published when both are in or the window closes → reviewed. Cancellation is possible only between accepted and completed.
- **Purchase process (two-sided confirmation).** Provider marks *delivered*, then customer marks *received*. It is **auto-received 14 days after delivered** if the customer does nothing. **Dispute** is possible only between delivered and received. A disputed transaction auto-cancels after 60 days. An inactive one auto-cancels after 14 days.
- **Rental variant.** Sharetribe's documented customization lets the **provider manually mark the booking completed and the goods returned in good condition**, recommended for high-value rentals.

### C4.2 Derived escalation instead of stored flags
- Koha, Lend Engine and myTurn all compute *overdue* from `due_date < now and not returned`. Stored escalation (*lost*) happens only through a scheduled job after N days (Koha longoverdue). Sources as above — **High** for Koha, **Medium** for the others.

### C4.3 Condition captured at both ends
- Condition is recorded at pick-up (Hygglo joint inspection, Library of Things, Olio photos, Fat Llama timestamped photos) and at return (Lend Engine check-in prompts, toy-library completeness check). Damage has a short reporting window after return (Fat Llama 24 h, Hygglo "as soon as possible"). **High/Medium.**

### C4.4 Extension approaches
| Approach | Examples |
|---|---|
| Borrower self-service, blocked if someone else is waiting or already overdue | Library of Things, Lend Engine, Koha holds rule |
| Counted limit | Leila 2, Berkeley 2, Riverside 3, Koha "Renewals allowed" |
| Minimum-elapsed guard | myTurn %, Koha "No renewal before" |
| Extension as a new booking | Hygglo |

### C4.5 Soft vs hard overdue sanctions
| Level | What happens | Examples |
|---|---|---|
| Soft | Reminder the day before, then repeating overdue reminders | myTurn weekly, Lend Engine every X days |
| Medium | Block further borrowing until returned | Berkeley, fine-free since 2022 |
| Hard | Fees, then "non-return" or lost with a replacement charge | Library of Things after 24 h, Koha lost after N days |

Community and gift platforms (Olio, Buy Nothing, Leila) stay soft or rely on replacement in kind.

---

## Pattern comparison table

| Concern | LoT London | Leila | Berkeley TLL | Lend Engine / myTurn | Koha | Hygglo | Fat Llama | Olio / Buy Nothing | Sharetribe |
|---|---|---|---|---|---|---|---|---|---|
| Loan period | fixed at booking | agreed per item | 7 d | configurable | per rule | agreed dates | agreed dates | agreed in chat | booking dates |
| Extension | self-service, blocked by next reservation or overdue | 2x | 2x, blocked by reserves | self or staff, blocked by reservation; myTurn min-% | count + no-renew-before; holds block | new booking | – | ad hoc chat | custom |
| Reminders | fee emails | – | overdue notice | day-before + repeating overdue | trigger offsets | – | – | none | notifications per transition |
| Overdue | fee, non-return after 24 h | fee after 30 d | borrowing blocked | suggested fee | notices, lost after N d | inform lender | late-return case | support contact | system auto-transitions |
| Owner recall | – | – | – | – | Recall shortens due date | – | – | chat | custom transition |
| Return confirmation | kiosk check-in | staff | staff | staff check-in per item + prompts | staff check-in | **lender confirms** | – | none | provider marks returned (variant); customer "received" + auto after 14 d |
| Condition check | at pick-up by member | clean/working/complete | same condition | check-in prompts, repair location | damaged/lost statuses | joint inspection at pick-up; photos | photos ≤24 h before | photos at pick-up | – |
| Damage / lost | repair or replacement, cleaning fee | deposit or replace in kind | pay damage/replacement | repair queue | lost status, fee | claim to insurer | claim ≤24 h | fix or replace (request) | dispute |
| Disagreement | negotiate | – | collections | – | **Claimed returned** | Resolutions team | case manager | support | **dispute state**, operator resolves |
| Trust | membership | tenure waives deposit | block privileges | – | claim-returned threshold | reviews | verification | ratings gate (4★, 5 shares, 2 km) | reviews after completion |

---

## Applicability to our context (small trust-based parent group, hand-over at recurring Terms, no money)

1. **The owner should confirm the return and close the loan** (Hygglo "rental ends when the lender confirms", Sharetribe provider-marks-returned variant, every library's staff check-in). Today the borrower returns an item alone in one step, which is the opposite of all surveyed systems. Recommended pattern: the borrower declares "returned / ready to return", then the owner confirms receipt. If the owner does nothing, the system auto-confirms after a grace period (Sharetribe auto-received 14 d). The grace period stops a loan from hanging open forever when the owner forgets. **High confidence.**
2. **Tie the due date to the Krąg cadence.** Hand-over happens at Terms, so the natural default due date is "next Term" or "N Terms later". This matches the fixed-period norm of 1–3 weeks (toy libraries 2–3 weeks, tool libraries 7 days) and the "agreed per item" norm (Leila, Olio). Pre-fill the next Term and let the parties adjust it. **Medium** (inference from sources).
3. **Keep overdue derived, soft and non-monetary.** Compute overdue from `due_date` (as Koha, Lend Engine and myTurn do) instead of storing it. Sanctions should be reminders (day before or the Term before, then repeating every Term) and perhaps a Berkeley-style block on new borrowing. Fees and deposits do not apply. **High.**
4. **Extension: borrower asks, owner approves, blocked if someone else is waiting.** The block mirrors Library of Things, Lend Engine and Koha holds. A small community has no staff, so owner approval takes their place. Libraries let members self-extend only because staff policy sits behind the system. Optionally cap the count (Leila and Berkeley allow 2). Hygglo's "extension = new booking" is too heavy for us. A plain due-date change plus an event is enough. **Medium.**
5. **Owner recall = Koha Recall.** A recall shortens the due date, typically to the next Term, and notifies the borrower. This is legitimate in a gift economy where the owner keeps ownership. **Medium.**
6. **"Claimed returned" / disagreement state.** When the borrower says they gave it back and the owner says they didn't get it, a Koha-style *claimed returned* state is cheap and fits a no-money group. The item stays assigned to the borrower until resolved, and the organizer can see the case. A full Sharetribe-style operator dispute is overkill. **Medium.**
7. **Lost or damaged outcome without money.** The surveyed options are: replace with a comparable item (Leila), the lender "requests fix or replace" (Olio), or write the item off with a *lost* status (Koha). A small parent group could offer lost → owner accepts write-off, or replace in kind. Both keep a record in the ledger. **Medium.**
8. **Condition note at both hand-overs is optional but useful.** An optional photo or note at hand-over and at return is common (Olio, Hygglo, Fat Llama). Toy libraries show that checking completeness (all pieces) is the key check for children's items. It should stay optional to match the group's high-trust nature. **Medium.**
9. **Reputation.** Gating by rating (Olio) or tenure (Leila deposit waiver) is used on open platforms. A closed Krąg of known parents probably needs only visibility, e.g. borrowing history and a count of returns claimed or overdue (like Koha's claim threshold). Ratings are likely unnecessary. **Low/Medium** (judgement).
10. **Actor model.** Adopt Sharetribe's framing. Every transition has exactly one actor (borrower, owner, organizer as "operator", or system/scheduler), and time-based transitions (reminders, auto-confirm, overdue escalation) go through the existing APScheduler job. **High** (the pattern is well documented).

## Sources count
Fetched primary sources: 12. Snippet or secondary: ~10. Platform types covered: libraries of things / tool libraries / toy libraries, library software (Lend Engine, myTurn), public ILS (Koha), P2P rental (Hygglo, Fat Llama), free community sharing (Olio, Buy Nothing, Peerby), marketplace engine (Sharetribe).
