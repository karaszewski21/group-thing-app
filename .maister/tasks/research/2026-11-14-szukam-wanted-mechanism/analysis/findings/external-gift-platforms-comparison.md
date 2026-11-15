# External: wanted posts on gift and swap platforms — per-platform comparison

## TL;DR
- All five platforms have a wanted post type as a peer of the offer post (Freecycle "Wanted", Trash Nothing "Wanted/Request", Olio "Wanted", Buy Nothing "Ask", Bunz "ISO"), made in the same form as an offer: title, free-text description, optional photo, coarse location.
- None of them matches wants to offers automatically. The demand-side signal is a separate, opt-in alert on new posts: Trash Nothing keyword search alerts (email/push), Freecycle tag alerts (in-site counter), Bunz saved searches. Givers find wants by browsing the feed.
- Givers answer by private message (Freecycle, Trash Nothing, Olio, Bunz) or by comment/"interested" (Buy Nothing); the seeker closes the want by hand ("Mark as received", "Fulfilled").
- Expiry is fixed and long where documented: 90 days on Freecycle and Trash Nothing. An expired post cannot be reopened; reposting creates a new post, and groups throttle wanted reposts harder than offer reposts.
- Bunz was still running on 2026-08-31 with about 200 daily users and an announced shutdown date of 2026-09-01; its state after that date is unconfirmed.

## Key Decisions
- Treat help-centre and policy pages as the source of record; forum, review and press sources are marked as such — third-party descriptions of these products go stale.
- Record "not documented" separately from "absent" — several help centres do not describe expiry or visibility of wanted posts, which is not evidence that the rule does not exist.
- Bunz facts are split into "2016 app" and "2024–2026 app" — the product was rebuilt at least twice and the official FAQ could not be opened.

## Open Questions / Risks
- All pages were read through a fetch tool that returns extracted text, not the raw page. Short quoted phrases below are as returned by that tool; exact wording should be re-checked before being quoted in a report.
- `https://bunz.com/faq` and `https://bunz.com/other/the-anti-end-p1885917` returned HTTP 403. Bunz FAQ statements come from search-result snippets only (low confidence).
- Olio: no first-party page found for the wanted listing's fields, duration, visibility radius or response flow. Only the content policy is documented.
- Buy Nothing: no first-party statement on Ask expiry or on notifications to nearby members.
- Freecycle: whether a tag alert sends email or push is not stated; per-group weekly wanted limits are local and not published centrally.
- Whether Bunz operates after 2026-09-01 is unconfirmed.

All URLs below were opened on 2026-11-14 unless marked "search snippet".

---

## Comparison table

| | Freecycle | Trash Nothing | Olio | Buy Nothing (app) | Bunz |
|---|---|---|---|---|---|
| Wanted post type | Yes, "Wanted" (plus "Borrow" in Friends Circle only) | Yes, "wanted", shown as "Requests" | Yes, "Wanted" section, non-food only | Yes, "Ask" | Yes, "ISO" (In Search Of) |
| Fields | Type, town, title, general location, description, up to 3 photos, optional preset tags | Title, content, photos, map point, expiration, optional "reselling" flag | Not documented; policy requires a specific item and recommends a representative photo | Optional photo, title, description, optional category, location, visibility toggle, optional private community | 2016: images, title, description, "what you want in return", location. Current: not confirmed |
| Who sees it | Members of the town group (or own Friends Circle) | Group members; some posts public | Not documented (app is locality-based) | App-wide, or within a radius, or one private community | App users nearby (not confirmed for current app) |
| How givers respond | Private message or email reply | Private message | "People can respond at their own discretion" (channel not documented) | Comment or "express interest"; seeker then messages | Like, comment, or chat ("make offer" in 2016) |
| Matching wants to offers | Absent | Absent | Absent (not documented) | Absent | Absent |
| Alerts | Tag alerts on new posts, shown as an in-site counter | Keyword search alerts for Offers and/or Requests by email, push or both; digests | Not documented for wanted | Not documented | Saved searches (2025 release notes) |
| Expiry | 90 days, fixed for all town groups | 90 days | General listings 1–28 days; wanted not documented | Not documented | Not documented; visibility decays, reposting costs BTZ |
| Renewal | Expired post cannot be reopened; make a new post | "Repost" button pre-fills a new post; repost count kept for 90 days | Not documented | Reposting encouraged if unanswered; subscribers can boost | Repost for BTZ |
| Closing | "Mark as received" or "Cancel post" | Outcome: satisfied / withdrawn / expired | Not documented | Status "Fulfilled", post stays visible | Hide/delete ISO |
| Limits | "Used sparingly"; moderators may cap wanted posts per member per week | Group-specific; typically offers can be reposted after a few days, requests after about two weeks | Vague requests removed; repeated misuse leads to warning or suspension | None: "as much ... as often as they'd like"; identical flooding removed | "No spamming" rule; details not confirmed |
| Offer-before-ask rule | Explicitly forbidden to require | Not found | Not found | Not found | Not applicable (barter) |

---

## Freecycle

### Finding F1: "Wanted" is a first-class post type, created in the same form as "Offer"
**Source**: https://freecycle.helpscoutdocs.com/article/30-make-a-post (official help centre)
**Evidence**: The form asks for group (Town Group or Friends Circle), post type ("Offer" or "Wanted"; "Lend" and "Borrow" only in Friends Circle), town, a short title, a general location (neighbourhood, cross street or postal code — no street or email addresses), a description (no phone numbers, emails, addresses, URLs), up to 3 photos (jpg, jpeg, png) and optional pre-assigned tags. The post type cannot be changed after publishing (https://freecycle.helpscoutdocs.com/article/123-manage-post).
**Context**: A want carries no structured category, condition or radius — only free text plus optional preset tags. Contact details are banned from the text.
**Confidence**: High — first-party, two pages agree.

### Finding F2: Visibility is the local group; replies are private
**Source**: https://freecycle.helpscoutdocs.com/article/30-make-a-post ; https://freecycle.org/pages/MemberFAQ (official)
**Evidence**: Posts go to the member's Town Group or their Friends Circle. "All replies come through Freecycle's private messaging system"; the FAQ adds that replies can be made "either online or by email".
**Confidence**: High.

### Finding F3: No matching; alerts are tag-based and shown in the site
**Source**: https://freecycle.helpscoutdocs.com/article/97-alerts (official, last updated 2021-01-12) ; https://freecycle.org/pages/MemberFAQ
**Evidence**: An alert is created by choosing a post tag to follow; it applies to new posts in the member's towns and Friends Circle; the Alerts icon shows the number of new matching posts at login. The article does not say that email or push is sent. The FAQ instead advises members who want many items to set email delivery to "One for each post", and to use "Search Posts" before posting an Offer or Wanted.
**Context**: The platform relies on the seeker searching first and on givers reading the feed or digest. A want is not linked to later offers.
**Confidence**: High for the tag alert; medium that no email/push exists for alerts (not stated either way).

### Finding F4: Fixed 90-day expiry; no reopening
**Source**: https://freecycle.helpscoutdocs.com/article/287-settings (official moderator FAQ) ; https://freecycle.helpscoutdocs.com/article/306-cant-find-my-post (official)
**Evidence**: "Post expiration is now set at 90 days for all Town groups, for both Offer and Wanted posts." Member page: "Posts Expire 90 days after they are made"; related messages are removed at the same time; to relist "you will need to make a new post".
**Confidence**: High.

### Finding F5: Seeker closes the want; replies stop
**Source**: https://freecycle.org/pages/MemberFAQ ; https://freecycle.helpscoutdocs.com/article/123-manage-post
**Evidence**: "If you posted a WANTED and you've got what you wanted, under Manage Post, select "MARK AS RECEIVED."" The post is then removed from most pages, other members can no longer reply, and the poster can keep messaging earlier repliers for one week. "Cancel Post" removes it immediately.
**Confidence**: High.

### Finding F6: Rules — sparingly, capped per week, but never conditional on giving
**Source**: https://freecycle.org/pages/guidelines (official) ; https://www.freecycle.org/pages/ModManual/LocalDecisions (official moderator manual) ; https://faq.freecycle.org/Training2.0 (official moderator orientation)
**Evidence**: Guidelines: "WANTED POSTS ARE TO BE USED SPARINGLY." Moderator manual: "Moderators may not forbid Wanted posts or require members to post an offer post before a wanted post. However, moderators may limit the number of Wanted posts by a member each week." Orientation lists as not allowed: "Restricting Wanted posts to a specific day or time", "requiring that Wanted posts be balanced with Offers", "requiring that the first post be an Offer post".
**Context**: The network deliberately rejects ratio rules and offer-first rules, and keeps only a frequency cap. Freecycle's reply on Trustpilot (2026-08-18, review site) states the asymmetry: moderators may not limit how often people gift, but may limit how often they post wanted adverts.
**Confidence**: High (three first-party pages); the Trustpilot reply is medium (https://ca.trustpilot.com/review/www.freecycle.org).

### Finding F7: Moderation — pre-approval for some posts, hotwords, re-approval on edit
**Source**: https://freecycle.helpscoutdocs.com/article/30-make-a-post ; https://www.freecycle.org/pages/ModManual/LocalDecisions ; https://faq.freecycle.org/Moderator_Manual:Notices
**Evidence**: Some posts show "Pending Approval" until a volunteer moderator checks them; an edited post that needed approval is re-queued. Moderators can put new members on moderation and set hotwords that trigger moderation. Manual: "Posters do not have to justify any Wanted requests made", yet "some posts are over the top"; answering a Wanted post with an offer to sell earns a warning, then removal. Resale intent "must be announced up front ... in the original Wanted post".
**Confidence**: High.

### Finding F8: Reported problems
**Source**: https://forums.moneysavingexpert.com/discussion/502487/freecycle-nusiance/p8 (forum, posts from 2007) ; https://ca.trustpilot.com/review/www.freecycle.org (review site, unverified accounts)
**Evidence**: Forum members call many wanted adverts "simply begging" and describe "a ridiculous amount of desperate requests for a car/laptop/pc/boat" and "requests for expensive items". Trustpilot: a 2025-06-09 review says seekers "had not updated their original 'Wanted' post" after finding the item elsewhere (stale wants); a 2025-11-18 review reports wanted posts deleted without notice, answered by Freecycle with "Local groups sometimes limit how often one may repeat Wanted posts so that the group isn't overwhelmed"; several reviews complain of posts stuck awaiting approval for one to two days. The member FAQ notes that some groups restrict wanted posts for expensive items and asks members to avoid overly general requests.
**Confidence**: Medium — anecdotal, old forum data, but consistent with the rules the platform wrote in response.

---

## Trash Nothing

### Finding T1: "wanted" is one of three post types; shown to users as "Requests"
**Source**: http://trashnothing.com/api/v1.4/trashnothing-openapi.yaml (official API description) ; https://trashnothing.com/help/how-do-i-create-a-search-alert (official)
**Evidence**: Post `type` is "One of: offer, wanted, admin". Post fields: title, content, date, photos, latitude/longitude ("may be null if a post hasn't been mapped"), `expiration`, `outcome`, `repost_count`, `reselling`, `footer` (group-added text such as rule reminders). `reselling` exists for wanted posts only: whether the item is requested in order to resell it. The alert dialog names the post types "Offers and/or Requests".
**Context**: The only wanted-specific structured field is the resale declaration; everything else is free text plus a map point.
**Confidence**: High.

### Finding T2: Explicit outcome states
**Source**: http://trashnothing.com/api/v1.4/trashnothing-openapi.yaml
**Evidence**: Offer outcomes: satisfied, withdrawn, promised, expired. Wanted outcomes: satisfied, withdrawn, expired. Default listings return only posts that are none of these.
**Context**: A clean lifecycle model: open, satisfied, withdrawn, expired; "promised" exists only on the offer side.
**Confidence**: High.

### Finding T3: 90-day expiry, repost as a new pre-filled post, repost count tracked
**Source**: https://trashnothing.com/help (official help index, article "I replied to a few posts but I never got any responses?") ; https://trashnothing.com/help/how-do-i-repost ; API description
**Evidence**: "posts are automatically removed from the listings after 90 days". "Repost" on the post page "will automatically fill in the new post form". `repost_count` is the number of reposts in the last 90 days, zero meaning not a repost; listings can exclude reposts (`include_reposts=0`).
**Confidence**: High.

### Finding T4: Wanted reposts are throttled more than offers
**Source**: https://trashnothing.com/help/what-are-the-rules-and-guidelines (official)
**Evidence**: Rules on repost frequency vary by group; "most groups, you can repost Offers after a few days and Requests after a couple weeks". Only free, legal, family-friendly items may be offered or requested; buying, selling, trading, bartering and requests for money are banned; many groups ban requests to borrow; anyone planning to resell must say so in posts and messages.
**Confidence**: High.

### Finding T5: No matching; keyword search alerts over both post types
**Source**: https://trashnothing.com/help/how-do-i-create-a-search-alert ; https://trashnothing.com/help/can-i-get-every-post-sent-by-email (official)
**Evidence**: Search with 1–3 keywords, press "Save Alert", choose Offers and/or Requests; delivery by email, push or both under Notifications > Search Alerts. There is no option to receive every post by email; the alternatives are push for new-post digests, a changed digest frequency, or a search alert. No limit on the number of alerts is stated.
**Context**: The alert is the seeker's standing query against future offers, kept separate from the wanted post. A giver can equally save an alert on Requests, which is the only "tell me when someone wants X" path.
**Confidence**: High for the mechanism; the absence of want-to-offer matching is inferred from the help index (medium).

### Finding T6: Visibility and replies
**Source**: https://trashnothing.com/help (article "Are messages public?") ; https://trashnothing.com/help/how-do-i-change-which-posts-i-see ; API description
**Evidence**: "All messages you send in reply to posts ... are private." Members can restrict the feed to "Only show posts that are near me" with a chosen distance. Posts have a `source` of groups, trashnothing (public) or open_archive_groups.
**Confidence**: High.

### Finding T7: Moderation
**Source**: https://trashnothing.com/help/what-are-the-rules-and-guidelines ; help index
**Evidence**: Volunteer moderators set group rules; members report posts, messages or members; feedback on members exists as a separate help topic.
**Confidence**: Medium — the pre-approval process is not described on the pages read.

---

## Olio

### Finding O1: "Wanted" is a separate section for specific non-food requests
**Source**: https://help.olioapp.com/en/articles/12240702-wanted and https://help.olioapp.com/article/23-wanted (official help centre, same article)
**Evidence**: ""Wanted" is where you can ask for something specific that might be available for free or to borrow locally." Allowed: specific non-food items to receive free, borrow (the lender may ask for a cash deposit) or buy second-hand; a photo from the internet is recommended so others can see what is wanted. Not allowed: food including pet food; non-specific requests such as "Any clothes", "Anything unwanted", "Surprise me"; asking for or offering cash; services; items on the prohibited list.
**Context**: The clearest written specificity rule among the five platforms, and the only one that states a stock photo is acceptable for a want.
**Confidence**: High.

### Finding O2: Enforcement by removal, then warning or suspension
**Source**: same article
**Evidence**: Listings that do not meet the criteria may be removed; repeated misuse "could lead to a warning or even account suspension". A pre-posting checklist asks: specific non-food item, representative photo, reasonable to give/lend/resell, respectful wording. Posting requires a verified account (https://help.olioapp.com/article/187-unable-to-request-or-post-a-listing).
**Confidence**: High.

### Finding O3: Fields, duration, visibility and response flow of a wanted listing are not documented
**Source**: https://help.olioapp.com/en/articles/12158761-how-do-i-add-edit-and-remove-my-listings ; https://olio.helpscoutdocs.com/article/226-10-steps-to-create-the-perfect-olio-listing (official)
**Evidence**: Both pages describe only Free (food / non-food) and Sell listings: up to 10 photos, title, description, quantity, pick-up times, map location, "list for" duration of "until midnight", 1–8 hours or 1–28 days, with automatic unlisting when unrequested. Neither mentions Wanted. A search snippet (not opened) says a wanted listing is added via "+" then "wanted" and that "people can respond at their own discretion".
**Context**: Offered listings on Olio are short-lived (28 days at most) with the duration chosen by the poster. Whether the same picker applies to wanted listings is unconfirmed.
**Confidence**: High that it is undocumented; low for any statement about the wanted listing's duration.

### Finding O4: Matching and alerts — absent in the documentation
**Evidence**: No help page read mentions matching wanted listings to offers or alerts tied to a wanted listing. A search snippet mentions a "Watchlist" feature for tracking listings (Olio blog, not opened).
**Confidence**: Low — absence of evidence only.

---

## Buy Nothing

### Finding B1: "Ask" is one of three post types (Give, Ask, Gratitude)
**Source**: https://help.buynothingproject.org/article/65-how-to-start-posting-in-buynothing (official help centre)
**Evidence**: Ask fields: optional photo ("usually get much more interest"), clear title (example "Size 5 Diapers"), description, optional category (Furniture, Kids, Books ...), location, a visibility toggle (app-wide or limited to a maximum radius from the post location), and an optional private community. Pickup location and the Flash/Simmer badges are Give-only. No duration field.
**Confidence**: High.

### Finding B2: Seeker chooses the audience per post
**Source**: same page ; https://help.buynothingproject.org/article/41-what-are-the-benefits-of-a-buy-nothing-subscription ; https://help.buynothingproject.org/article/39-what-are-the-differences-between-the-buy-nothing-app-and-facebook-groups
**Evidence**: A post is visible app-wide, within a radius, or only to a selected private community. In the app members "choose your own sharing radius", unlike Facebook groups whose boundaries admins set. Paying subscribers get a 10-mile or 50-mile viewing radius, up to five saved locations, private communities and the ability to boost any post, including Asks, to the top of the feed.
**Confidence**: High.

### Finding B3: Response by comment or "interested", then message; status "Fulfilled"
**Source**: https://help.buynothingproject.org/article/65-how-to-start-posting-in-buynothing ; https://help.buynothingproject.org/article/86-do-i-need-to-mark-my-post-as-gifted-can-i-delete-it-instead
**Evidence**: Neighbours comment or express interest; the poster opens the list of interested people and messages one. After the hand-over the poster changes the post status and selects the other party. Completed posts stay visible as "Gifted" or "Fulfilled" and can be filtered out; deleting is discouraged because it "removes valuable information".
**Context**: The response is public by design; the guidelines say pressuring givers by private message can get a member blocked (https://docs.buynothingproject.org/guidelines).
**Confidence**: High; the pairing of "Fulfilled" with Ask is inferred from the page (medium).

### Finding B4: No limits on asking; narrative encouraged; only identical flooding is punished
**Source**: https://docs.buynothingproject.org/guidelines (official community guidelines) ; https://buynothingproject.org/10-rules (official)
**Evidence**: "Participants may offer and request as much as they'd like, as often as they'd like." Members are told to make an ask engaging with a photo, a story or a joke, and if unanswered to "post your request again, with a genuine bit of your personality in your wording". "Repeated posting of identical content that floods the feed" can lead to removal. "Don't pile onto another person's Ask post"; "Post your own Ask instead". Banned: requests for money or fundraisers, "requests for items you'd like to buy or rent", barter or trade, paid employment. Resale intent must be disclosed when requesting. Local groups may add their own rules.
**Context**: The opposite stance to Freecycle's "sparingly": asking is treated as equal to giving.
**Confidence**: High.

### Finding B5: Matching and alerts — absent; expiry — not documented
**Evidence**: None of the six official pages read mentions matching Asks to Gives, keyword alerts, or an expiry period. The subscription page lists bookmarks and boosting but no alerts.
**Confidence**: Medium for absence of matching; expiry unconfirmed.

### Finding B6: Reported problems
**Source**: https://www.checkbook.org/washington-area/buy-nothing (consumer magazine article) ; search snippet of a Buy Nothing blog post (page returned 404)
**Evidence**: The article reports that volunteer moderators "don't apply rules consistently from group to group": requests for advice were deleted in one group although the rules allow them, and a member was removed for "opposing the mission". A search snippet attributes to the founders the observation that groups above about 1,000 members drift into chaos where many Asks and Gives go unseen and unmet (page not opened — low confidence).
**Confidence**: Medium for inconsistent moderation; low for the group-size claim.

---

## Bunz

### Finding Z1: Status — operating at very small scale as of 2026-08-31; later state unconfirmed
**Source**: https://betakit.com/the-problem-is-me-bunz-owner-brings-in-gen-z-pranksters-to-save-dying-platform/ (trade press, dated 2026-08-31) ; https://www.newswire.ca/news-releases/after-ten-years-bunz-owner-seeks-a-simple-answer-continue-or-end-it-839389936.html (company press release, 2026-06-11) ; https://en.wikipedia.org/wiki/Bunz_Trading_Zone
**Evidence**: The owner announced a shutdown on 2026-09-01 unless the platform reached 1,000 daily active users in one city; usage was under 200 signed-in daily users in May 2026, mostly in Toronto, against a past peak of more than 120,000 members. On 2026-08-31 the platform was still running and the owner was bringing in new co-founders. History: Facebook group from 2013, app from 2016, BTZ token in 2018, layoffs and frozen wallets in 2019, after which more than 40 independent community groups renamed themselves. The app was relaunched in 2025 as a cashless barter app with three rules: "no cash, no discrimination, and no spamming".
**Context**: Bunz is no longer the product described in most third-party coverage. Its patterns are historical evidence, not a current benchmark.
**Confidence**: High up to 2026-08-31; the outcome after the deadline is unconfirmed (two searches found no later reporting; bunz.com returned 403).

### Finding Z2: ISO was a post type and a feed section in the 2016 app
**Source**: https://theeyeopener.com/2016/04/app-of-the-week-bunz/ (student newspaper, 2016)
**Evidence**: The main screen had four sections: "all", "items", "attention" and "ISO". The create menu offered "attention", "item" and "ISO". A post had images, a title, a description, what the poster wants in return, and location, and appeared on the poster's profile. Others could like, comment, or tap "make offer" to open a chat.
**Context**: Two demand signals existed side by side: the ISO post, and the "what you want in return" field on every item post. In a barter product the second one is the usual place to state wants.
**Confidence**: Medium — one secondary source, ten years old.

### Finding Z3: ISO list on the profile; reposting to stay visible
**Source**: https://apps.apple.com/ca/app/bunz/id1068061556 (App Store listing: release notes and user reviews)
**Evidence**: Release notes 5.0.1/5.0.2 (2022) mention "your new profile, ISO list, searches"; 5.0.3 and 5.0.4 added deleting and hiding/unhiding of posts and ISOs; 4.8.0 (2021) added "a reposting option for your item posts"; 6.1.0 (2024) added push notifications; 6.1.2/6.1.3 (2025) mention saved searches. Two user reviews from October 2022 complain that the redesign "lost all ISO lists". A search snippet of the official FAQ (page not opened) says BTZ can be spent to repost items or ISO posts "and keep them visible longer".
**Context**: Wants lived on the user's profile as a list, and visibility was time-decayed with a paid bump. No source describes automatic matching of ISO posts to items.
**Confidence**: Medium for the ISO list and saved searches (first-party release notes, summarised); low for the BTZ repost rule (snippet only).

### Finding Z4: Matching, expiry, limits, moderation of ISO posts — not confirmed
**Evidence**: No opened source states an expiry period, a posting limit or a moderation process for ISO posts.
**Confidence**: Low — unconfirmed.
