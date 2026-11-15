# External UX findings: wanted-post form, empty-search entry point, "I have this" response

## TL;DR
- Published guidance supports a short wanted form: every field costs completion, so ask for the name of the thing first and defer or infer the rest (NN/g EAS, Baymard field-count research). No study measured wanted-post forms directly.
- Neither Baymard nor NN/g lists "tell us what you are looking for" among no-results recovery paths; they require a clear statement, the query kept editable, and alternative routes. A wanted prompt is therefore an addition beside those paths, not a replacement.
- The strongest product evidence for a low-effort owner response is the request-first model (Peerby): the request is pushed to nearby people who answer directly. Its numbers are company claims.
- Social-psychology research says seekers underestimate how willing others are to help, and that direct requests work better than hints; this supports prompting people to post a want and addressing owners directly.

## Key Decisions
- Treat field count, not step count, as the cost driver of the wanted form — Baymard found field count affects usability far more than steps.
- Prefill the wanted form from the failed search query — NN/g's "automate" step and the no-results guideline to keep the original query both point to carrying the query over.
- Keep search-recovery paths on the empty result and add the wanted prompt beside them — both Baymard and NN/g treat a page with one way out as a dead end.
- Mark all claims about one-tap owner responses as medium or low confidence — only vendor claims and help-centre descriptions were found, no measured comparison.

## Open Questions / Risks
- No source compares free-text and structured wanted forms on completion or on match quality. The trade-off (structure helps matching and filtering, costs completion) is inferred from general form research.
- No source measures "offer an existing listing" against "create a new listing" against "send a message" as owner responses.
- No guidance was found on showing match counts to a seeker, or on mobile-specific patterns for wanted posts.
- Baymard's detailed no-results guidelines are behind a paywall; only the public article was read.

All URLs below were opened on 2026-11-14 unless marked "unconfirmed".

---

## 1. Wanted-post form: minimal versus structured

### Finding 1.1: Remove, then infer, then simplify fields
**Source**: https://www.nngroup.com/articles/eas-framework-simplify-forms/ (Huei-Hsin Wang, Nielsen Norman Group, 7 March 2025)
**Source type**: UX research organisation, guidance article (no statistics in the article)
**Evidence**: The EAS framework is "Eliminate, Automate, Simplify". Eliminate: remove questions that are nonessential, nonurgent or irrelevant ("Every question is a withdrawal"); defer nonurgent questions; use conditional logic. Automate: prefill from existing data and let the user edit; infer values instead of asking (city from postcode). Simplify: careful defaults, because users rarely change them.
**Context**: Applied to a wanted post: the item name is essential; category can be inferred or suggested from the name; locality can default to the user's last or profile locality; expiry can be a default, not a question. The article does not discuss free text versus structured inputs.
**Confidence**: High that this is NN/g's guidance; medium for the application to wanted posts (inferred).

### Finding 1.2: Field count matters more than step count
**Source**: https://baymard.com/blog/checkout-flow-average-form-fields (Edward Scott, Baymard Institute, 26 June 2024)
**Source type**: UX research organisation, benchmark and usability testing
**Evidence**: "the number of form fields in a checkout impacts overall usability far more than the number of steps." Average checkout in 2024 had 11.3 form fields; "most sites need only 8 form fields in total"; 17% of users have abandoned a checkout because it was too long or complicated.
**Context**: The data is about checkout, not listing or request forms. It supports a general rule: count the fields the user must consider. Splitting a long wanted form into steps would not remove the cost.
**Confidence**: High for the checkout finding; low to medium for transfer to a wanted form.

### Finding 1.3: Structured fields on requests exist to serve the responder's filters
**Source**: https://sharetribe.com/help/en/articles/10108488-reverse-marketplace-introduction (Sharetribe help centre, undated)
**Source type**: Product documentation of a marketplace-building platform
**Evidence**: In a reverse marketplace "customers post their needs or requests to the marketplace"; "Categories and certain fields can be used by providers to filter requests." The documentation advises building categories that make sense to both sides.
**Context**: The reason to add structure to a want is the other side's browsing and filtering (and, here, matching). If matching and owner notification do the work, fewer structured fields are needed from the seeker.
**Confidence**: Medium (one vendor's documentation, service marketplaces).

### Finding 1.4: No direct evidence on free text versus structured wanted forms
**Evidence**: Searches on 2026-11-14 for comparative studies returned only vendor blogs with unsourced figures (for example "each field reduces completion by about 7%"), which are not cited here.
**Confidence**: The gap itself is high confidence.

---

## 2. Empty or poor search results as an entry point

### Finding 2.1: A no-results page must state the result, keep the query and offer ways forward
**Source**: https://www.nngroup.com/articles/search-no-results-serp/ (Kathryn Whitenton, Nielsen Norman Group, 5 January 2014)
**Source type**: UX research organisation, guidance article with eyetracking observation
**Evidence**: Three guidelines: clearly explain that there are no matching results; offer starting points for moving forward (restate the query, keep it in an editable search box, suggest similar queries, spelling corrections, advice on modifying the query); do not mock the user. "all too often, No Results pages are dead ends that don't offer any suggestions about what to do next." On one tested page nobody fixated on the small "no matches" text.
**Context**: The article does not mention letting the user submit a request or be notified later. A wanted prompt must not hide the plain "nothing found" statement.
**Confidence**: High.

### Finding 2.2: Five recovery strategies; about half of sites fail
**Source**: https://baymard.com/blog/no-results-page (Baymard Institute, published 4 February 2019, updated 18 February 2025)
**Source type**: UX research organisation, benchmark and usability testing
**Evidence**: "nearly 50% of sites fail to provide users with effective ways to recover from a search that yields no results." Strategies: related categories; alternative searches (apply automatically when there is only one); personalised recommendations; contact details for support; popular products and categories. "Simply put, search tips aren't enough on their own." Users in testing rarely read or applied search tips.
**Context**: Requesting an item and "notify me" are not among Baymard's public strategies. The closest is the human-contact route (strategy 4). A wanted prompt is an extra path that turns failed demand into a stored want; the published guidance neither recommends nor rejects it.
**Confidence**: High for the guidance; the absence of the pattern in these two sources is confirmed, its effectiveness is unconfirmed.

### Finding 2.3: Carry the query into the wanted form
**Source**: Findings 1.1 and 2.1 combined
**Context**: NN/g says to keep the original query editable; EAS says to prefill from data the system already has. A link from the empty result to a wanted form with the query filled in satisfies both. This is an inference, not a tested pattern.
**Confidence**: Medium (inferred).

---

## 3. Encouraging people to ask

### Finding 3.1: People underestimate others' willingness to help by about half
**Source**: https://www.gsb.stanford.edu/insights/francis-flynn-if-you-want-something-ask-it (Stanford GSB summary, 1 July 2008, of Flynn and Lake, Journal of Personality and Social Psychology 95(1), 2008)
**Source type**: University summary of peer-reviewed research (the PubMed abstract page could not be opened; paper not read in full)
**Evidence**: Participants "overestimated by about 50 percent the number of people they needed to ask" to get a request granted, in campus and fundraising field studies. Askers thought indirect hints would work better; potential helpers said they were more likely to help when asked directly.
**Context**: Seekers will under-post wants unless prompted; a system that addresses a specific owner with a specific request ("someone is looking for X, you have one listed") is closer to a direct request than a general feed of wants. Studies used small favours among strangers, so transfer is partial.
**Confidence**: Medium.

### Finding 3.2: Gift communities codify requests as a normal post type
**Source**: https://ar5iv.labs.arxiv.org/html/2211.09043 (Herdağdelen, Adamic, State, "Community gifting groups on Facebook", Journal of Quantitative Description, 2023)
**Source type**: Peer-reviewed quantitative study on de-identified group data
**Evidence**: Posts are "limited to three primary types: offers, requests, and expressions of gratitude"; admins sometimes run "wish-list Wednesday" posts to prompt requests. The largest strongly connected component covers a median 0.57 of members versus 0.15 in reference groups, read as "evidence for the norms of generalized reciprocity". The authors state "we haven't quantified the prevalence of asking posts versus offering posts."
**Context**: Scheduled or prompted asking is a known community device. The study did not measure request fulfilment.
**Confidence**: High for the description, none for ask-to-give ratios.

### Finding 3.3: Gifts outnumber asks in observed gift groups (unconfirmed)
**Source**: QUT article by Taylor and Street, https://www.qut.edu.au/news/realfocus/exploring-the-extraordinary-potential-and-avoiding-the-pitfalls-of-your-local-buy-nothing-group — returned HTTP 403; claim seen only in search snippets. The project page https://www.madelinetaylor.com.au/buynothingresearch was opened and confirms only the method (a small pilot observing two groups plus member interviews).
**Evidence**: Snippet: groups have more "gifts" than "asks", read by the authors as reluctance to rely on others.
**Confidence**: Low — unconfirmed.

---

## 4. The "I have this" response flow

### Finding 4.1: Request-first with pushed requests and direct answers
**Sources**:
- https://techcrunch.com/?p=885310 (Darrell Etherington, TechCrunch, 29 September 2013)
- https://www.sharetribe.com/academy/rinse-and-repeat-an-interview-with-daan-weddepohl (Sharetribe Academy interview, 11 February 2016, updated 15 March 2024)
**Source type**: Tech press and a product-founder interview
**Evidence**: On Peerby "users post requests for items that they need from their surrounding community"; the model works because "you aren't dependent on having to find what you're looking for before you request it." The company claimed "over 80 percent of its requests are fulfilled by Peerby members within 30 minutes of their posting." The founder: it is "the first platform that starts with a request and creates supply by asking around"; "Sharing a vacuum cleaner is not an intent."
**Context**: Owners do not list items in advance; the request reaches them and they answer. The fulfilment figure is a 2013 company claim for lending, not giving. That neighbours answer "in a single touch" from a push notification appeared only in a search snippet (the newcities.org page returned HTTP 502) — unconfirmed.
**Confidence**: Medium for the model; low for the numbers and the one-touch detail.

### Finding 4.2: Offer tied to the request, then accept or decline
**Source**: https://sharetribe.com/help/en/articles/10108488-reverse-marketplace-introduction
**Source type**: Product documentation
**Evidence**: A provider finds the request and submits an offer tied to that listing; the customer is notified, reviews it in the inbox and can accept, reject or counter; both sides can exchange messages. Caveat stated: customers must "be patient to receive bids, deliberate, and decide."
**Context**: The structured response (an offer object linked to the want) gives the seeker a list of answers to choose from, and gives the platform a signal for closing the want. A plain message gives neither.
**Confidence**: Medium (service marketplaces, one vendor).

### Finding 4.3: In gift communities the answer to a request is a reply or message
**Sources**: https://trashnothing.com/help ; https://wiki.ilovefreegle.org/Best_Practice_Notes
**Source type**: Platform help centre; volunteer-network moderator guidance (cited as examples of a pattern)
**Evidence**: Trash Nothing's help has no separate response flow for requests; replies go through messages. Freegle's notes say some members prefer answering a request to posting an offer, and that requests prompt people to offer things they have unused.
**Context**: The common baseline is "message the seeker". It suits owners who have not listed the item. For owners who already have a matching listing, pointing the seeker at that listing reuses the existing take or propose flow; no source measured this, it is an inference from 4.2.
**Confidence**: Medium for the baseline; low for the inference.
