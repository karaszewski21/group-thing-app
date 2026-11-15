# External findings: stale wants, expiry and renewal, notification consent and control

## TL;DR
- Documented expiry practice in gift networks is a fixed 90-day automatic removal for offers and wants alike; marketplaces add a "confirm it is still current" reminder before removal. No source gives a tested optimal period for wants.
- The reminder-then-remove sequence (ask, remind once, close) is the common shape; extensions are short (about a month) so the question is asked again.
- Notification permission should be requested at the moment the benefit is obvious. Posting a want is such a moment ("tell me when someone has this"); asking on first load risks a permanent browser block.
- Users need in-app controls per notification type and frequency; most never change defaults, so the defaults decide the experience.
- In Poland, messages that count as commercial information or direct marketing need prior consent per channel; whether match alerts count is unconfirmed.

## Key Decisions
- Give every want an expiry by default — supported by the 90-day practice of two gift networks and by GDPR storage limitation (see the abuse-privacy file).
- Ask for push permission in the wanted flow with a custom prompt before the browser prompt — web.dev and NN/g both say to ask in context and that a block cannot be undone from the page.
- Set conservative notification defaults and combine bursts — NN/g: most users do not customise, and bursts make an app "seem needy".
- Keep match alerts strictly about the user's own want — it keeps them on the service side of the Polish consent rule; any promotional content in them would need separate consent.

## Open Questions / Risks
- "Still looking?" check-ins for wants specifically: no source found. The pattern is transferred from "still available?" prompts for listings.
- Auto-closing a want on fulfilment: no source describes it for wants; gift networks rely on the poster marking the post.
- The right expiry length for wants (30, 60 or 90 days) is not supported by data.
- Apple's guidance page on managing notifications could not be read (page body not returned); platform guidance here rests on web.dev and NN/g.
- The Polish consent rule's application to in-app, email and push match alerts was not confirmed with a regulator source.

All URLs below were opened on 2026-11-14 unless marked "unconfirmed".

---

## 1. Stale content: expiry, renewal, check-ins, closing

### Finding 1.1: Fixed 90-day automatic expiry for offers and wants
**Sources**:
- https://freecycle.helpscoutdocs.com/article/287-settings (Freecycle moderator tools FAQ)
- https://trashnothing.com/help (Trash Nothing help)
**Source type**: First-party help pages (cited as examples of a pattern)
**Evidence**: "Post expiration is now set at 90 days for all Town groups, for both Offer and Wanted posts." "posts are automatically removed from the listings after 90 days."
**Context**: Both networks use one period for both post types and remove silently. Neither page describes a reminder before expiry.
**Confidence**: High.

### Finding 1.2: Renewal by reposting, with a longer interval for requests
**Source**: https://trashnothing.com/help
**Evidence**: "With most groups, you can repost Offers after a few days and Requests after a couple weeks." A post with no replies after a day or two "should" be reposted "to encourage more replies."
**Context**: In a feed model renewal means bumping the post, which doubles as a spam risk and is therefore rate-limited. In a matching model a want does not need bumping to stay effective; renewal only needs to confirm that the need still exists.
**Confidence**: High for the rule; medium for the inference.

### Finding 1.3: Poster-driven closing
**Source**: https://trashnothing.com/help
**Evidence**: The poster marks an offer as gifted, which "will remove your Offer post from the group listings"; a promised status "will help other people know that your Offer has been promised." The help page does not mention marking a request as received.
**Context**: Closing depends on the poster remembering. Where the platform records the handover itself (a reservation completed in response to a want), it can close the want without asking; no source documents this, it is an inference.
**Confidence**: High for the documented behaviour; low for the inference.

### Finding 1.4: Reminder-then-remove sequences on marketplaces (unconfirmed)
**Source**: Search results on 2026-11-14 for seller help pages (Hanna Andersson resale help, Whiskybase marketplace support, Mobius Materials documentation) — pages not opened.
**Evidence (search snippets only)**: an email after 30 days asking the seller to confirm the listing, a second reminder, then removal after a final notice; extensions keeping a listing active for one more month before the next reminder; the stated reason that buyers can trust that listed stock still exists.
**Confidence**: Low — unconfirmed, snippet level only.

### Finding 1.5: Storage limitation as the legal reason for expiry
**Source**: https://gdpr-info.eu/art-5-gdpr/
**Evidence**: Data must be kept in identifiable form "for no longer than is necessary".
**Confidence**: High for the text. See `external-ux-trust-abuse-privacy.md`, finding 3.3.

---

## 2. Notification consent and control

### Finding 2.1: Ask when the benefit is obvious; never on page load
**Source**: https://web.dev/articles/push-notifications-permissions-ux (Matt Gaunt, web.dev; date not shown on the page)
**Source type**: Browser-vendor developer guidance
**Evidence**: "Ask users to subscribe to push at a time when the benefit is obvious." "The worst thing you can do is to show the permission dialog to users as soon as they land on your site." "if the user blocks the permission request, your web app can't ask for permission again"; changing it later is "not easy, obvious or fun for the user." Recommended patterns: value proposition, double permission (custom dialog first), a settings panel, a passive toggle.
**Context**: The step right after saving a want is a clear value moment: "notify me when a matching item appears". A custom prompt there protects the one-shot browser permission.
**Confidence**: High.

### Finding 2.2: Explain content first, avoid bursts, give in-app controls
**Source**: https://www.nngroup.com/articles/push-notification/ (Alita Kendrick, "Five Mistakes in Designing Mobile Push Notifications", Nielsen Norman Group, 18 November 2018)
**Source type**: UX research organisation, article drawing on its usability studies
**Evidence**: Do not request permission at first launch; users often decline without reading. Say what notifications will contain before asking. Avoid bursts; combine when more than five would go out at once. Let users edit preferences inside the app, including frequency caps or importance levels. Most users do not customise settings, so defaults matter. Hiding the off switch is described as deceptive. Cited background: an average of 56 notifications per day per mobile user in 2016 (Pielot, Vradi, Park, 2018).
**Context**: For wants this means: one line stating what a match alert contains; a per-want mute as well as a global switch; several matches for one want arriving as one notification. Owners who receive "someone is looking for what you listed" did not ask for it, so that type especially needs its own off switch and a conservative default.
**Confidence**: High for the guidance; medium for the application.

### Finding 2.3: Digest and alert controls are a user-side expectation in gift networks
**Source**: https://trashnothing.com/help
**Evidence**: Digest frequency is set under "Notifications > New Post Digests"; "You can setup search alerts to get notified about specific posts"; push works only in supported browsers and the apps.
**Context**: Frequency choice (immediate versus digest) is exposed to the user as a setting. Mechanics of batching belong to the matching-and-alerts gatherer.
**Confidence**: High.

### Finding 2.4: Polish consent rule for commercial messages, per channel
**Source**: https://www.prawo.pl/biznes/zgody-marketingowe-i-kontakty-handlowe-co-mowi-prawo-komunikacji-elektronicznej,530981.html (Joanna Worona-Vlugt, Prawo.pl, 21 January 2025)
**Source type**: Legal press commentary; the act and regulator guidance were not read
**Evidence**: Under Article 398 of the Electronic Communications Law (in force from 10 November 2024) "zakazane jest używanie do celów przesyłania informacji handlowej, w tym marketingu bezpośredniego" of the listed channels without prior consent; the article names automated calling systems, email, electronic messengers and SMS, and end-user devices. Consent must meet the GDPR standard, be separate per channel and be withdrawable at any time. Penalties are imposed by the President of UKE: up to 3% of revenue or PLN 1,000,000, whichever is higher. Push is not named in the article.
**Context**: A match alert the seeker explicitly asked for is arguably a service message, not marketing, but the boundary is disputed in Polish case law (search results mentioned a non-final 2026 administrative court ruling; not opened). Alerts to owners about strangers' wants are less clearly "requested". Recording consent per channel and per notification type keeps both cases safe.
**Confidence**: Medium for the rule; low for its application to match alerts — unconfirmed.
