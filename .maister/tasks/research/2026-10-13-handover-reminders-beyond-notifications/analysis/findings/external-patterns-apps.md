# External Patterns: How Comparable Apps Keep Handovers From Being Forgotten

Category: external-ux-patterns (instance 4). All sources accessed 2026-10-13.
Confidence key: High = official help/docs page fetched or quoted; Medium = official page via search snippet only, or several consistent secondary sources; Low = single secondary or anecdotal source.

---

## 1. Olio (P2P food/item sharing; closest analogue to "give away")

### 1.1 Pickup confirmation is an explicit step before anything else
- Requesters get a message once the lister confirms, e.g. "Jane has just confirmed that you're collecting 'Sandwich'". Olio tells requesters to "wait for a confirmation message" and not to leave until they have "the exact time and location of the pickup".
- Source: https://help.olioapp.com/en/articles/12158799-how-do-i-know-when-a-listing-is-confirmed-for-pickup-on-olio
- Confidence: High (fetched).
- Relevance: Olio ties the handover to a specific time and place. Our app already has this anchor in `Term.occurs_on`.

### 1.2 Ratings and suspension work as the no-show deterrent
- People can rate each other only after the lister confirms the collection. Raters are told to consider how "punctual the pick-up was". A no-show can also be rated: "letting a 'no-show' leave a rating too keeps the system fair."
- Ratings are anonymous. The average shows after 3 ratings. After 10 ratings the highest and lowest are dropped.
- Sanction: "3 low ratings (below 3 stars) within one month, and your average for that month is also below 3 stars → account suspended for 30 days". Ratings are reset after a suspension.
- Source: https://help.olioapp.com/article/134-ratings-explained
- Confidence: High (fetched).
- Olio's help pages describe no automatic reminder for individual P2P listing pickups. Coordination is left to users: "If … you cannot make the pick-up, or are running late (even by 5 minutes) please message the other user" (https://help.olioapp.com/article/106-top-tips-to-be-a-great-requester). Confidence: Medium (search snippet).

### 1.3 Olio Volunteer Hub ("Food Waste Heroes") has the most complete reminder loop found in this research
These are scheduled collections from stores. Structurally they match our case: a known time slot, a committed person, and others relying on that person showing up.
- **T-10h reminder with Yes/No buttons:** "Yes, I can go" / "No, I can't make it". Answering Yes informs the squad. Answering No releases the slot only if the collection is more than 1 hour away. The user can answer once, up until the start time. If the user claimed the slot less than 10 hours before the start, no reminder is sent.
- No response followed by a missed slot counts as a "missed collection", and slots may be removed.
- Source: https://help.olioapp.com/en/articles/12333210-collection-reminder-messages (Confidence: High, fetched)
- **Post-event check:** 1.5 hours after the slot, if nothing has been listed, a bot asks "Yes, there was food" / "No food on arrival" / "I didn't go". The user has 24 hours to answer before the collection is recorded as missed. Consequences: future slots are removed, a Missed Collection goes on the record, the user cannot claim new slots for 24 hours, and repeated misses or false answers can lead to suspension. The squad captain sees all of this, and the system records misses automatically.
- Source: https://help.olioapp.com/article/638-missed-collection-process-update (Confidence: High, fetched)
- **Pattern takeaway:** pre-event reminder with a one-tap commitment, then a post-event "did it happen?" prompt with a deadline, then an automatic strike. This maps almost directly onto our Term-based handover combined with the existing `term_end_scan` / `TERM_CONFIRMATION_NEEDED`.

---

## 2. Too Good To Go (time-window pickup)
- The pickup window is printed on the in-app receipt. Once the window opens, the receipt shows "Swipe to redeem", and staff must see the user swipe. This is a lightweight in-person handover confirmation with no code entry.
  - https://www.toogoodtogo.com/en-us/how-to-collect-too-good-to-go ; https://toogoodtogo.com/blog/how-do-use-too-good-to-go (Confidence: High/Medium)
- A third-party design critique says the pickup button stays disabled, with a countdown, until the window opens: https://ixd.prattsi.org/2026/02/design-critique-too-good-to-go-mobile-app/ (Confidence: Low–Medium)
- Cancelling at least 2 hours before the slot gives a full refund. No refund is given for arriving late or not showing up ("the food may have had to be thrown away"). The cost of a no-show is the money already paid. https://toogoodtogo.com/blog/how-do-use-too-good-to-go (Confidence: Medium)
- Official help pages mention push notifications mainly for sell-outs and new bags. A "pickup starts soon" push is claimed only by a third-party APK page (https://tgtg.fileplanet.com/apk). Confidence for the reminder: Low. **Gap:** unverified.
- Takeaway: a cancellation cutoff (T-2h) combined with a visible window and a confirmation gesture at handover. Unlike our app, TGTG deters no-shows mainly through prepayment, which a free group-sharing app does not have.

---

## 3. Vinted (shipping-first, plus pickup points)
- Sellers must ship within 5 working days and can ask the buyer for an extension: https://www.vinted.fr/help/482-shipping-an-item (Confidence: Medium)
- Buyer confirmation: after "Delivered" there is a 2-day window to "Mark as received" or open a claim. If the buyer does nothing, the order auto-completes after 2 days. Sellers cannot mark it as received for the buyer. https://www.vinted.co.uk/help/1522 , https://www.vinted.com/help/1522 (Confidence: Medium–High)
- At a pickup point, the carrier sends a pick-up code by SMS and email. Uncollected parcels go back to the seller: https://www.vinted.co.uk/help/1601 . The carrier (InPost) allows 3 days and sends a reminder when 1 day is left: https://inpost.co.uk/blog/tips-for-shipping-on-vinted (Confidence: Medium)
- **Gap:** no documentation found for a Vinted in-person handover code.
- Takeaway: confirmation that times out into a default outcome (auto-complete), plus a "1 day left" reminder.

## 4. OLX (Poland)
- With Przesyłka OLX, the platform holds the payment until the buyer collects and confirms. Claims must be filed within 24 hours and returns answered within 48 hours. https://spidersweb.pl/2024/07/przesylka-olx-jak-dziala.html , https://android.com.pl/tech/527696-jak-kupowac-na-olx-allegro-oszustwa/ (Confidence: Medium, press articles)
- **Gap:** no official OLX material found on reminders or confirmation for in-person pickup ("odbiór osobisty"). It appears to be left to chat between the parties.

## 5. Buy Nothing / Trash Nothing / Freecycle (free gifting, closest culturally)
- Trash Nothing's no-show advice: don't pick the first responder, choose based on communication, feedback score and membership length, and require repliers to propose a specific pickup date and time. Ask for a phone number "so you can send pickup reminders and check in if someone is running late". A "Fair Chance Policy" checkbox and feedback scores are shown next to profiles. **No built-in reminders.** https://trashnothing.com/help/how-do-i-prevent-no-shows (Confidence: High, fetched)
- Buy Nothing porch-pickup etiquette: label bags with each recipient's name, and describe access to the door. https://home.buynothingproject.org/frontdoor (Confidence: Medium)
- Community norm: give one second chance within 1–2 days, then pass the item to the next person in line. https://trashnothing.com/beta/blog/13/pick-up-tips (Confidence: Medium)
- Takeaway: free-gifting communities rely on reputation, specific times and backup recipients, and use manual reminders. This leaves room for an app to automate what users currently do by hand.

## 6. Library of Things / tool libraries / public libraries (lending analogue)
- Lindfield Library of Things (Lend Engine) collects items during opening hours and charges £1 per item per day for late returns: https://sharehh.lend-engine.com/how-it-works-6 (Confidence: Medium)
- An ITU case study on tool loaning recommends email reminders sent a day before the due date and names myTurn as a platform: https://www.itu.int/en/publications/Documents/tsb/2020-U4SSC-Case-study-Re-use-of-consumer-goods-and-tools-loaning/files/basic-html/page16.html (Confidence: Medium)
- A myTurn-based library sends an email confirmation on reservation, a "ready for pickup" email, and asks for pickup within 7 days: https://krl.org/book-group-kits (Confidence: Medium)
- Public library reminder cadences:
  - Indianapolis PL: 3 days before, on the due date, and 5 days after. https://www.indypl.org/blog/for-adults/email-notices
  - Toronto PL: 2 days before. https://torontopubliclibrary.ca/using-the-library/help/notification-options/email-notification.jsp
  - Cambridge Divinity: 3 days before and on the morning of the due date. https://www.divinity.cam.ac.uk/library/howto/borrowing/notifications
  - Kent: opt-in, 3 days before. https://www.kent.gov.uk/leisure-and-community/libraries/join-and-borrow-library-items/renew-a-book
  - Confidence: Medium (search snippets)
- Takeaway: the lending norm is **email** reminders, usually several (before, on the day, overdue). The overdue reminder matters for our LEND/RETURN flow.
- Peer lending apps found while searching for Peerby:
  - LoanedOut: both sides scan a QR code at lending and at return, plus WhatsApp reminders and "Mark as returned".
  - The Give-Back Log: return dates, overdue flags, one-tap reminder messages.
  - Sources: https://mwm.ai/apps/the-give-back-log/6767269640 and related listings in the search. Confidence: Low (app-store aggregator listings).
  - **Gap:** no Peerby-specific documentation found.

## 7. Meetup (recurring group meetings; closest analogue to "Term")
- Standard reminders:
  - 7-day and 1-day reminders by email, to members who haven't been active recently.
  - A **day-of reminder sent only as a push notification, and only to members who RSVP'd Yes**.
  - Reminders are skipped if an announcement went out in the last 24 hours.
  - The 1-day reminder requires at least 2 RSVPs in groups older than 30 days.
  - Several upcoming events can be merged into one notification.
- Source: https://help.meetup.com/hc/en-us/articles/39792225676813-Announcing-your-events (Confidence: Medium. The page returned 403 to the fetch, so the content comes from the search engine snippet.)
- Takeaway: different channels at different horizons (email far out, push on the day), batching into one digest, and suppression rules to avoid over-notifying.

## 8. Eventbrite
- Automatic attendee emails include a "48-hour reminder", sent 2 days before each event; organizers can delete it. Attendees also get "Changes to an event" emails when date, time or location changes, and a "Liked events" reminder 2 days before. https://www.eventbrite.com/help/en-us/articles/748624/what-emails-will-attendees-automatically-receive/ (Confidence: High, fetched)
- In-person events get one reminder at 48 hours. Online events get three: 48 hours, 2 hours and 10 minutes before. https://eventbrite.com/help/en-us/articles/748624 (Confidence: Medium, search snippet of the same article)
- The reminder email is brief: event name, date and time in a large font, and a map. https://www.eventbrite.com/blog/event-reminder-email/ (Confidence: Medium)
- **Gap:** no confirmation found that Eventbrite reminders include an add-to-calendar link or .ics.

## 9. Calendly (appointment scheduling)
- Recommends an email reminder 24 hours before a meeting and a text reminder 30 minutes before. Reminder timing is configurable per workflow. SMS is available only on paid plans. https://calendly.com/blog/guide-calendly-reminders.html , https://calendly.com/blog/workflows (Confidence: Medium)

## 10. Airbnb (time-anchored physical handover of a space)
- Self check-in details (door or lockbox code) are emailed and sent as a message 48 hours before arrival. Hosts are advised to send their own reminder 24–48 hours before. https://www.airbnb.com/help/article/41 ; https://airbnb.com/resources/hosting-homes/a/simplifying-communication-650 (Confidence: Medium)
- Takeaway: the "what you need for the handover" information is released just before the event, as an actionable message, not only at booking time.

## 11. BlaBlaCar
- No official no-show policy page was retrieved. Only Trustpilot complaints and a travel blog turned up, which mention refunds after a no-show and a contact-form process. Confidence: Low. **Gap.** (https://uk.trustpilot.com/review/blablacar.com?page=7 , https://imperfectidealist.com/pros-and-cons-of-blablacar/)

## 12. Handover-code patterns (delivery and rentals)
- Uber Direct / Uber Eats PIN: an optional 4-digit code. The courier gets it from the customer and enters it before the delivery can be completed. If the customer is absent, the courier goes to "I need help". https://developer.uber.com/docs/deliveries/guides/pincode (Confidence: High, official dev docs via snippet). The consumer side shows "Confirm delivery with PIN ####", often the last 4 digits of the customer's phone number: https://www.ridesharingdriver.com/delivery-signature-pin/ (Confidence: Medium)
- Rentals (Fat Llama, Outdoorsy): photos at handover and return are a condition for damage claims. https://www.macfilos.com/2019/03/26/a-close-encounter-with-a-fat-llama/ , https://Outdoorsy.co/help/what-photos-do-i-need-to-take-during-a-key-exchange (Confidence: Medium/Low)
- Takeaway: confirming with a code proves the two parties met. One side shows the code and the other side enters it, so a single tap cannot confirm the handover by itself.

---

## Cross-app pattern catalogue (summary)

| Pattern | Seen in | Fit for group Term handovers |
|---|---|---|
| Pre-event reminder (T-48h / T-24h / T-10h / day-of) | Eventbrite 48h; Meetup 7d/1d/day-of push; Olio FWH T-10h; Calendly 24h + 30min; Airbnb 48h | High. Term has date and time. |
| Reminder with one-tap "Yes I'll come / No I can't" | Olio FWH | High. Doubles as a commitment device and frees the item early. |
| Cancellation cutoff before slot | TGTG T-2h; Olio FWH "No" only if >1h away | Medium. Lets the item go to the next person. |
| Multi-channel by horizon (email early, push day-of) | Meetup | High once a channel beyond in-app exists. |
| Batching into a single digest | Meetup (combines events) | High. One Term usually involves several items, so one "bring list" message per Term. |
| Visible pickup window / countdown, action enabled only in window | TGTG | Medium. "Confirm handover" enabled only on the Term day. |
| In-person confirmation gesture or code | TGTG swipe; Uber PIN; LoanedOut QR; Vinted pickup code | Medium. A simple both-sides tap is likely enough among group members. |
| Post-event "did it happen?" with deadline and auto-default | Olio FWH (1.5h then 24h); Vinted auto-complete after 2 days | High. Extends the existing `TERM_CONFIRMATION_NEEDED`. |
| Reputation / strikes / suspension | Olio ratings (3 low in a month = 30 days); Olio FWH missed collections; Trash Nothing feedback | Medium. Must be soft in small trusted groups. |
| Change notifications | Eventbrite "Changes to an event" | High. Notify when a Term's date or time changes. |
| Overdue reminders for loans | Public libraries (due, +N days) | High for LEND/RETURN. |
| Handover info released just before event | Airbnb 48h | Medium. |
