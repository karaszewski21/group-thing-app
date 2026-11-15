# External: wanted posts on gift and swap platforms — patterns and failure modes

## TL;DR
- The shared model is "a want is a post": same form and feed as an offer, free text plus optional photo and coarse location, answered by a person, closed by the seeker.
- Automatic want-to-item matching with two-sided notification is not offered by any of the five platforms; the nearest proven pieces are keyword or tag alerts on new posts. A matching feature would be new ground relative to this group, not a copied pattern.
- The documented controls against the known problems are: a long fixed expiry (90 days), a frequency cap on wanted posts and slower reposting than offers, a specificity rule, a ban on money and contact details in the text, and a declared resale flag.
- Two opposite cultures exist: Freecycle ("wanted sparingly", capped) and Buy Nothing (asks unlimited and encouraged). Both reject "give before you ask" rules.
- Reported failures are begging and expensive requests, wants left open after being met, inconsistent volunteer moderation, and slow pre-approval.

## Key Decisions
- Patterns are listed only when at least one first-party page documents them — forum complaints are used for failure modes, not for patterns.
- "Absent on all five" is reported as a finding about matching — success criterion 2 asks for proven patterns, and the lack of one matters for the recommendation.

## Open Questions / Risks
- No platform publishes numbers on how often wanted posts are fulfilled, so none of the patterns has measured effectiveness.
- The absence of automatic matching may reflect product age and volunteer-run models rather than a judgement that matching does not work; no platform states a reason.
- Evidence on complaints is anecdotal (a 2007 forum thread, Trustpilot reviews, one magazine article).
- Details of the sources, access dates and confidence per platform are in `external-gift-platforms-comparison.md`; all pages were read on 2026-11-14 through a text-extraction tool.

---

## Patterns

### P1: A want is a peer of an offer, not a separate subsystem
**Sources**: Freecycle post form https://freecycle.helpscoutdocs.com/article/30-make-a-post ; Trash Nothing API http://trashnothing.com/api/v1.4/trashnothing-openapi.yaml ; Buy Nothing https://help.buynothingproject.org/article/65-how-to-start-posting-in-buynothing ; Bunz (2016) https://theeyeopener.com/2016/04/app-of-the-week-bunz/
**Evidence**: Freecycle and Trash Nothing use one post entity with a type (offer / wanted). Buy Nothing has Give / Ask / Gratitude in one composer. Bunz had item / ISO in one create menu. Freecycle does not allow changing the type after publishing.
**Confidence**: High.

### P2: Minimal fields — title, free text, optional photo, coarse location
**Sources**: as P1 ; Olio https://help.olioapp.com/en/articles/12240702-wanted
**Evidence**: No platform asks for condition on a want. Category is optional (Buy Nothing) or a preset tag (Freecycle). Location is deliberately coarse: neighbourhood or postal code on Freecycle, a map point on Trash Nothing, a radius toggle on Buy Nothing. Photos are optional everywhere; Olio and Buy Nothing say a photo raises response, and Olio accepts a representative image from the internet.
**Context**: The brief's richer list (category, condition, offer type, radius, expiry, photos) goes beyond what these platforms collect; only optional category, photo and radius have precedent here.
**Confidence**: High.

### P3: Visibility follows the offer's audience, with the seeker named
**Sources**: Freecycle form ; Trash Nothing help https://trashnothing.com/help ; Buy Nothing posting article
**Evidence**: Freecycle: town group or the member's Friends Circle. Trash Nothing: group or public. Buy Nothing: app-wide, radius, or one private community, chosen per post. No platform offers an anonymous want.
**Confidence**: High for the three; Olio and current Bunz not documented.

### P4: Private reply is the default; public comment is the gift-culture variant
**Sources**: Freecycle form ("All replies come through Freecycle's private messaging system") ; Trash Nothing help ("All messages you send in reply to posts ... are private") ; Buy Nothing guidelines https://docs.buynothingproject.org/guidelines
**Evidence**: Freecycle and Trash Nothing route every answer into private messages. Buy Nothing uses comments or "express interest" on the post and discourages private pressure; it also forbids piling onto someone else's Ask.
**Context**: None has a structured "I have this" action that links a concrete listed item to the want.
**Confidence**: High.

### P5: Seeker-driven closure with explicit outcome states
**Sources**: Freecycle https://freecycle.helpscoutdocs.com/article/123-manage-post ; Trash Nothing API ; Buy Nothing https://help.buynothingproject.org/article/86-do-i-need-to-mark-my-post-as-gifted-can-i-delete-it-instead
**Evidence**: Freecycle: "Mark as received" or "Cancel post"; after marking, new replies stop and existing threads stay usable for one week. Trash Nothing wanted outcomes: satisfied, withdrawn, expired. Buy Nothing: "Fulfilled", post kept visible as a record and filterable.
**Confidence**: High.

### P6: Long fixed expiry, no reopening, repost as a new post
**Sources**: Freecycle https://freecycle.helpscoutdocs.com/article/287-settings and https://freecycle.helpscoutdocs.com/article/306-cant-find-my-post ; Trash Nothing https://trashnothing.com/help and https://trashnothing.com/help/how-do-i-repost
**Evidence**: 90 days on both, the same for offers and wanted posts. Freecycle removes related messages at expiry and requires a new post to relist. Trash Nothing pre-fills a new post from the old one and keeps a 90-day repost count that listings can filter on.
**Context**: Olio's 1–28 day poster-chosen duration is documented for offered listings only. No platform documents a renewal reminder.
**Confidence**: High for Freecycle and Trash Nothing.

### P7: Throttle wants, never condition them on giving
**Sources**: Freecycle https://www.freecycle.org/pages/ModManual/LocalDecisions and https://faq.freecycle.org/Training2.0 ; Trash Nothing https://trashnothing.com/help/what-are-the-rules-and-guidelines ; Buy Nothing guidelines
**Evidence**: Freecycle allows a per-member weekly cap on wanted posts and forbids offer-first, offer/wanted balance and day-of-week rules. Trash Nothing groups typically allow reposting offers after a few days and requests after about two weeks. Buy Nothing sets no cap and removes only identical content that floods the feed.
**Context**: The asymmetry (offers unthrottled, wants throttled) is stated by Freecycle itself in a 2026 public reply (review site, medium confidence).
**Confidence**: High.

### P8: Specificity rule
**Sources**: Olio wanted article ; Freecycle FAQ https://freecycle.org/pages/MemberFAQ
**Evidence**: Olio removes requests such as "Any clothes", "Anything unwanted", "Surprise me". Freecycle asks members to avoid overly general requests.
**Confidence**: High.

### P9: Text hygiene — no money, no contact details, declared resale
**Sources**: Freecycle form and guidelines https://freecycle.org/pages/guidelines ; Trash Nothing rules and API ; Olio wanted article ; Buy Nothing guidelines
**Evidence**: Freecycle bans phone numbers, emails, street addresses and links in the post, and any money. Trash Nothing bans requests for money and stores a `reselling` flag on wanted posts. Olio bans asking for or offering cash. Buy Nothing bans money requests and fundraisers and requires resale intent to be stated with the request. Freecycle warns, then removes, members who answer a want with an offer to sell.
**Confidence**: High.

### P10: Alerts are a separate standing query, not derived from the want
**Sources**: Trash Nothing https://trashnothing.com/help/how-do-i-create-a-search-alert ; Freecycle https://freecycle.helpscoutdocs.com/article/97-alerts ; Bunz App Store release notes https://apps.apple.com/ca/app/bunz/id1068061556
**Evidence**: Trash Nothing: save a 1–3 keyword search as an alert for Offers and/or Requests, delivered by email, push or both. Freecycle: follow a post tag, see a counter of new matching posts. Bunz: saved searches. In all three the seeker sets the alert up separately from any wanted post.
**Context**: This is the overlap with the excluded "saved searches" feature. It is also the only evidence in this category of new-item notifications to a seeker, and of a giver being told about new wants (a Trash Nothing alert on Requests).
**Confidence**: High for Trash Nothing and Freecycle; medium for Bunz.

### P11: Moderation by volunteers with pre-approval for a subset
**Sources**: Freecycle form and moderator manual ; Trash Nothing rules
**Evidence**: Freecycle: new members can be put on moderation, hotwords trigger review, edits to a moderated post are re-queued; the network "discourages moderation of all posts" (public reply, review site). Trash Nothing: group moderators set rules; members report posts and members.
**Confidence**: High for Freecycle; medium for Trash Nothing.

---

## Features absent on all five platforms

| Feature | Evidence of absence | Substitute | Stated reason |
|---|---|---|---|
| Automatic matching of a want to listed items | Not mentioned on any help, policy or API page read | Seeker searches before posting (Freecycle FAQ); givers browse the wanted feed | None stated |
| Notification to the owner of a matching item | Not mentioned anywhere | Giver saves an alert on Requests (Trash Nothing) | None stated |
| Structured "I have this" answer linking an item | Not mentioned anywhere | Private message, or comment / "interested" | None stated |
| Offer-before-ask or ratio rule | Explicitly forbidden on Freecycle; not found elsewhere | Weekly cap, slower reposts | Freecycle does not explain the ban on the pages read |
| Anonymous want | Not found | — | None stated |
| Renewal reminder before expiry | Not documented | Manual repost | None stated |

**Confidence**: Medium — absence is inferred from documentation, not from using the apps.

---

## Failure modes

### X1: Begging and requests for expensive goods
**Source**: https://forums.moneysavingexpert.com/discussion/502487/freecycle-nusiance/p8 (forum, 2007) ; https://freecycle.org/pages/MemberFAQ ; https://faq.freecycle.org/Moderator_Manual:Notices
**Evidence**: Members describe wanted adverts as "simply begging" and list requests for cars, laptops and game consoles. The official FAQ notes that some groups restrict wanted posts for expensive items. The moderator manual keeps a stock response for "over the top" emotional requests while stating that posters need not justify a want.
**Platform response**: "sparingly" guideline, weekly caps, local limits on expensive items.
**Confidence**: Medium.

### X2: Stale wants
**Source**: https://ca.trustpilot.com/review/www.freecycle.org (review, 2025-06-09)
**Evidence**: A reviewer reports that seekers had not updated their wanted posts after finding the item elsewhere.
**Platform response**: fixed 90-day expiry, a one-tap "received" action, outcome filters. No reminder is documented.
**Confidence**: Low to medium — one anecdote, but the expiry rule exists on two platforms.

### X3: Feed overwhelmed by repeated wants
**Source**: Freecycle replies on Trustpilot (2025-11-18, 2026-08-18) ; Buy Nothing guidelines
**Evidence**: "Local groups sometimes limit how often one may repeat Wanted posts so that the group isn't overwhelmed." Buy Nothing removes identical content that floods the feed.
**Platform response**: repost intervals (about two weeks for requests on Trash Nothing), weekly caps.
**Confidence**: Medium.

### X4: Wants answered with sales offers; resellers harvesting gifts
**Source**: Freecycle FAQ and moderator manual ; MoneySavingExpert thread ; Trash Nothing rules
**Evidence**: The FAQ says: "Do NOT contact folks in response to a want they posted and offer to sell them something!" Forum members complain of people collecting items to resell.
**Platform response**: warning then removal; mandatory resale disclosure; `reselling` flag on Trash Nothing wanted posts.
**Confidence**: High for the rule; medium for prevalence.

### X5: Inconsistent or slow volunteer moderation
**Source**: https://www.checkbook.org/washington-area/buy-nothing (magazine) ; Trustpilot reviews of Freecycle (2025)
**Evidence**: Buy Nothing moderators "don't apply rules consistently from group to group"; allowed request types were deleted. Freecycle posts waited one to two days for approval.
**Confidence**: Medium.

### X6: Unseen and unmet asks in large groups
**Source**: search snippet of a Buy Nothing Project blog post (https://buynothingproject.org/tpost/m0xaij9ff1-what-we-learned-after-8-years-in-faceboo returned 404)
**Evidence**: Attributed to the founders: groups above about 1,000 members drifted into chaos where many Asks and Gives went unseen and unmet.
**Platform response**: self-chosen radius and a searchable feed in the app; paid boosting.
**Confidence**: Low — page not opened.

### X7: Loss of stored wants in a redesign
**Source**: https://apps.apple.com/ca/app/bunz/id1068061556 (user reviews, October 2022)
**Evidence**: Two reviews say the redesign "lost all ISO lists".
**Confidence**: Low — two anecdotes; of marginal relevance.
