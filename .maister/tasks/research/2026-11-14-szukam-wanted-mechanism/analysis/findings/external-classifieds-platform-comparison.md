# External findings: wanted posts on classifieds and second-hand marketplaces

## TL;DR
- Two models exist. Open classifieds (OLX, Gumtree, Craigslist) tolerate or host wanted adverts as ordinary adverts in the same listing form; curated item marketplaces (Vinted, Wallapop, Facebook Marketplace) forbid them and offer saved searches with alerts instead.
- No platform in this set was found to match a wanted advert against listings. Wherever matching exists, it is a saved search owned by the seeker; a wanted advert is passive and waits for a seller to browse it and write.
- Wanted adverts where they exist are free text with a title, a category and a location; they inherit the advert lifecycle (OLX 30 days, Craigslist 7–45 days, renewal by hand).
- Observed weaknesses: wanted sections fill with trade buyers ("skup") and with misfiled for-sale adverts; saved-search alerts are reported as imprecise (OLX) or unreliable (Facebook).
- Limits that recur for the demand side: 50 saved searches (OLX, Gumtree AU), 90-day validity of an alert (Gumtree AU), daily digest as the default frequency (Gumtree UK, OLX as reported, Wallapop 2019).

## Key Decisions
- Sources opened on 2026-11-14 only — every row below carries the URL and a confidence level; nothing is stated from memory.
- OLX help-centre articles are marked medium at best — `pomoc.olx.pl` redirects article URLs to a login page, so their text was read only as search-engine excerpts, not on the page itself.
- Live category pages count as evidence of practice, not of policy — they show what users post and what the platform leaves online, not what the rules say.

## Open Questions / Risks
- OLX: no rule text allowing or forbidding "kupię"/"szukam" adverts in general was read. Only practice (over 1000 such adverts live) and one excerpted rule for animals were found. The full "Zasady zamieszczania ogłoszeń" and the Regulamin stayed behind the login redirect.
- Facebook: Help Centre pages render without body text to a fetcher. Whether Marketplace has any wanted listing type in some regions is contradicted between third-party sources; the saved-search alert settings were not read first-hand.
- Vinted: no official page describing saved-search alerts was found; the official notification list does not include them, third-party sources say they exist.
- Wallapop: the ban on "busco"/"compro" adverts comes from one 2022 blog; the official rules page that was opened does not mention it.
- Gumtree UK: advert lifetime and wanted-advert rules were not found on an official page; the UK help desk is a JavaScript application that did not render.
- Reasons for the absence of wanted posts are not stated by any platform; the reasons given below are inferences and marked as such.

## Comparison table

Access date for every source: 2026-11-14.

| Platform | Wanted posts | Fields | Where it lives, who sees it | Matching and alerts | How a seller responds | Expiry and renewal | Limits and moderation | Known problems |
|---|---|---|---|---|---|---|---|---|
| OLX (Poland) | Present in practice, no dedicated type | Same advert form as an offer; the wish is expressed in the title ("Kupię…", "Przyjmę…", "Poszukujemy…") | Mixed into normal categories and search results; public | None for wanted adverts. Seekers use "Obserwuj wyszukiwanie" with app and e-mail alerts | Normal advert contact (chat or phone) | 30 days, e-mail before expiry, extend or reactivate | 50 followed searches; advert limits per category; wanted adverts for animals forbidden | Trade buyers dominate "kupię"; alerts reported as imprecise |
| Vinted | Absent, and reportable | — | — | Saved search filters; follow a member; favourites. Search alerts unconfirmed officially | — | — | "Requests for an item" listed among rule-breaking listings | Forum (the only free-form space) closed January 2024 |
| Facebook Marketplace | Absent (medium confidence) | — | — | Notification when new listings match criteria (2021 report) | — | — | Commerce policy requires a product offered for sale | Alerts reported as sporadic |
| Facebook buy-and-sell groups | Present as a convention (ISO, "wanted", "szukam") | Free-form group post | Group members; rules set by each group's admins | None | Comment or private message | No expiry; sinks in the feed | Admin rules: items allowed, posts per week, bump frequency | Sellers must search the group by hand to find a seeker |
| Gumtree (UK) | Present as categories | Standard advert: title, category, location, description, optional price and photos | "Stuff Wanted" under For Sale with sub-categories; "Cars Wanted", "Property Wanted"; public, radius filter | None for wanted adverts. "Save search" alert, daily e-mail when there are new results | Normal advert reply | Unconfirmed for goods | Wrong-category adverts removed | For-sale adverts misfiled in Stuff Wanted |
| Gumtree (Australia) | Unconfirmed | — | — | Saved search: up to 50, valid 90 days, immediate/daily/weekly e-mail | — | — | Immediate alerts need a keyword | Wanted-advert posters targeted by scammers (rental) |
| Wallapop | Absent, reported as forbidden | — | — | Saved search with a bell; notification on a new matching listing | — | — | "compro…"/"busco…" adverts reported as against the rules | — |
| Craigslist | Present as the "wanted" category under for sale | Title, location, body; a normal free posting | Per-city category, public | None for wanted posts. Saved searches with e-mail "search alerts" | E-mail relay or contact in the posting | Free postings 7–45 days; renew to the top every 48–72 hours | "Overposted, cross-posted, nonlocal" content prohibited; community flagging | For-sale posts and dealers inside "wanted" |

## Findings per platform

### OLX (Poland)

**Finding 1: wanted adverts exist in practice as ordinary adverts; there is no wanted advert type or filter.**
Source: https://www.olx.pl/oferty/q-kupi%C4%99/ (live search results, opened 2026-11-14).
Evidence: the page reports "Znaleźliśmy ponad 1000 ogłoszeń"; 14 of the first 15 titles are buy requests, for example "KUPIĘ siano w kostkach", "Kupię okładkę albumu Budki Suflera…", "Kupię drzewo na pniu". Filters shown are category, price and specialisation only; "kupię" works as a search word.
Confidence: high for practice; low for policy (no rule text read).

**Finding 2: trade buyers dominate the "kupię" results.**
Source: same page.
Evidence: titles such as "Skup Aut Samochodow-Kupimy każde Auto", "KUPIĘ KAŻDĄ TOYOTĘ!!!" (the same advert repeated for Rzeszów and Warszawa), "SKUP Wiertła, frezy…". Roughly half of the first 15 are businesses buying in bulk.
Confidence: medium (one page of results, one day).

**Finding 3: requests to receive things appear inside the give-away category.**
Source: https://www.olx.pl/oddam-za-darmo/q-przyjm%C4%99/ (opened 2026-11-14).
Evidence: over 1000 results for "przyjmę" in "Oddam za darmo"; 4 of the first 15 are requests ("Przyjmę kury za darmo", "Przyję ziemię ogrodową", "Poszukujemy pieska z włosem...", "Przyjmiemy złom paletowy w każdej ilości"); the rest are offers matched on other words.
Context: Polish wording in use is "kupię", "przyjmę", "poszukuję/poszukujemy", "szukam"; "oddam" and "zamienię" mark the supply side.
Confidence: high for practice.

**Finding 4: wanted adverts for animals are forbidden.**
Source: https://pomoc.olx.pl/hc/pl/articles/211658685-Zasady-zamieszczania-og%C5%82osze%C5%84 — read as a search-engine excerpt only; the URL redirects to a login page.
Evidence (excerpt): "Niedozwolone jest zamieszczanie ogłoszeń, które dotyczą chęci przyjęcia za darmo lub kupna zwierzęcia."
Context: a category-specific ban implies wanted adverts are not banned in general, which agrees with Finding 1. This is an inference.
Confidence: medium for the rule; low for the inference.

**Finding 5: "Za darmo" and "Zamienię" are options in the advert form, not separate advert kinds.**
Source: https://pomoc.olx.pl/hc/pl/articles/211658765-Jak-doda%C4%87-og%C5%82oszenie- and the rules article above — search-engine excerpts only.
Evidence (excerpts): "ogłoszenia opisane jako „Za darmo” powinny dotyczyć faktycznego oddania przedmiotu za darmo. Jeśli spodziewana jest jakaś gratyfikacja materialna (słodycze, artykuły higieniczne itp.), ogłoszenie powinno być oznaczone jako „Zamienię”"; the two options "nie są dostępne w części podkategorii w Motoryzacji oraz Nieruchomościach".
Confidence: medium.

**Finding 6: the seeker's tool is the followed search, capped at 50, with an alert switch in settings.**
Source: https://pomoc.olx.pl/hc/pl/articles/360014660700-Obserwowane-wyszukiwania — search-engine excerpt only.
Evidence (as excerpted): set category and filters (phrase, location, price), press "Obserwuj wyszukiwanie"; at most 50 followed searches; alerts depend on the "Nowe ogłoszenia" option under Ustawienia → Powiadomienia; the list is under the heart icon, with "Wyczyść wszystkie obserwowane".
Confidence: medium.

**Finding 7: alerts arrive daily by app and e-mail, and are reported as imprecise.**
Source: https://bezprawnik.pl/zapisywanie-wyszukiwan-na-olx-i-vinted/ (news site, article dated 2026-07-13, one author's test).
Evidence: the author received daily alerts in the app and by e-mail for about a week; the alerts linked to unrelated adverts on similar topics, which she calls spam; over a dozen further searches gave mostly the same result.
Confidence: medium for the channel and frequency; low as a measure of quality (single test).

**Finding 8: an advert runs 30 days; the owner is e-mailed before expiry and can extend or reactivate.**
Source: https://blog.olx.pl/2018/10/22/houston-mamy-problem-czyli-emisja-a-promowanie-ogloszenia/ (official blog, 2018).
Evidence: an advert is "dodawane zawsze na 30 dni"; refresh and promotion "nie powodują przedłużenia emisji ogłoszenia"; before expiry OLX e-mails the owner, who can "przedłużyć lub po prostu ponownie aktywować".
Confidence: medium (first-party but eight years old).

**Finding 9: advert limits exist per category and renew after 30 days.**
Source: https://pomoc.olx.pl/olxplhelp/sfc/servlet.shepherd/document/download/069Wy00000HQYvVIAX ("Załącznik nr 3 - Limity ogłoszeń do 06.11.2025"; the PDF body was not readable, the title and the search excerpt were).
Evidence (excerpt): "Limit odnawia się po 30 Dniach liczonych od dnia publikacji ostatniego Ogłoszenia w ramach Limitu."
Confidence: low to medium; the per-category numbers were not read.

### Vinted

**Finding 10: a listing that asks for an item is a rule-breaking listing.**
Source: https://www.vinted.co.uk/help/288-guide-to-reporting (official help).
Evidence: members are asked to report "Listings not really selling an item, such as requests for an item or listings uploaded as a joke"; outcomes can include "removing the listing, sending a warning, or banning the member."
Confidence: high.

**Finding 11: the official substitutes are remembered search filters, following members and favourites.**
Source: https://www.vinted.com/help/35 (official help, "Finding items").
Evidence: "Your search filters will be saved and suggested to you on the next search."; following a member means "you'll be notified about new uploads and see members you follow in your feed."
Confidence: high.

**Finding 12: the official notification list has no saved-search alert.**
Source: https://www.vinted.co.uk/help/433-how-notifications-work (official help).
Evidence: the list is "Members you follow list new items", "The price of the item you've favourited was reduced", "The item you favourited was sold", "The item you've listed was favourited", "Someone starts following you", feedback, messages, news.
Counter-evidence: https://bezprawnik.pl/zapisywanie-wyszukiwan-na-olx-i-vinted/ (2026-07-13) says the app pushes notifications about new listings for a saved search and shows a count of new listings beside it; https://fripio.app/blog/recherche-sauvegardee-alertes-vinted-2026 (blog of a third-party tool vendor, 2026-06-14) says the same and names push and e-mail.
Confidence: medium that alerts exist in the app; the official description is unconfirmed.

**Finding 13: Vinted closed its forum, the only free-form space, because of moderation load.**
Source: https://ohn.haendlerbund.de/themen/marktplaetze/139209-vinted-schliesst-2024-online-forum (trade news, 2023-12-06).
Evidence: the forum closed on 8 January 2024 and old posts were deleted; Vinted said it had become increasingly hard to keep a safe and welcoming atmosphere.
Context: whether the forum held wanted threads is unconfirmed; the article does not say. Relevant as evidence that a marketplace of this size chose to remove free-text community content instead of moderating it.
Confidence: high for the closure; unconfirmed for wanted threads.

### Facebook Marketplace and buy-and-sell groups

**Finding 14: Marketplace has no wanted function; wanted posts live in groups.**
Source: https://www.moneysavingexpert.com/family/facebook-selling/ (consumer guide, updated 2026-10-23).
Evidence: in groups members can post "wanted" ads and sellers are advised to search the group for someone already looking; for Marketplace: "Facebook Marketplace doesn't offer this function, sadly."
Counter-evidence: search results listed third-party how-to pages (justanswer.com, fibredigital.com, famuse.co) claiming a "Wanted" option in the Sell flow; those pages were not opened and none is official.
Confidence: medium.

**Finding 15: commerce policy requires a product offered for sale.**
Source: https://www.facebook.com/policies_center/commerce (official, Polish rendering).
Evidence: rule "Brak przedmiotu na sprzedaż": "Treści komercyjne nie mogą promować aktualności, treści humorystycznych czy innych bez oferowania produktu na sprzedaż."
Context: the text does not name "in search of" posts. Third-party guides seen only in search results say such posts are removed under this rule; unconfirmed.
Confidence: high for the rule text; low for its application to wanted posts.

**Finding 16: group posting rules are set by admins, Marketplace rules by the platform.**
Source: https://www.moneysavingexpert.com/family/facebook-selling/.
Evidence: pinned group rules can restrict which items may be listed, how many listings per week, and how often an advert may be bumped; "There aren't the same rules on Facebook Marketplace as it's not run by admins."
Confidence: medium.

**Finding 17: Marketplace notifies buyers of new listings matching their criteria.**
Source: https://www.bandt.com.au/facebook-adds-new-features-to-marketplace-on-its-5th-birthday/ (trade press, 2021-10-15).
Evidence: "Users looking to buy certain items can now be notified when new listings are added that match their criteria."
Context: reliability complaints (sporadic, no lock-screen push) appeared only in search results from vendors of alert apps, who have an interest; unconfirmed.
Confidence: medium for existence; low for quality.

**Finding 18: Marketplace grew out of group activity.**
Source: https://about.fb.com/news/2016/10/introducing-marketplace-buy-and-sell-with-your-local-community/ (official).
Evidence: "This activity started in Facebook Groups and has grown substantially." The announcement mentions saving an item, not wanted posts or saved searches.
Confidence: high.

**Not found:** Polish group rules for "szukam" posts. One search returned nothing relevant; unconfirmed.

### Gumtree

**Finding 19: Gumtree UK keeps wanted adverts in dedicated categories.**
Source: https://www.gumtree.com/for-sale/stuff-wanted (live category, opened 2026-11-14).
Evidence: breadcrumb Home > For Sale > Stuff Wanted; 1,591 adverts UK-wide; sub-categories Miscellaneous 1121, Household 206, Computing & Phones 102, Audio & Vision 78, Sports & Leisure 43, Transport 41; radius filter 0–100 miles or UK-wide; a "Save search" control; sibling categories Freebies and Swap Shop; also "Cars & Vehicles > Wanted" and "Property > Property Wanted".
Confidence: high.

**Finding 20: the wanted category is small and polluted.**
Source: same page.
Evidence: 1,591 adverts for the whole UK; 70 % sit in "Miscellaneous"; of the first 10, two are for-sale adverts with prices ("Lakeland Heated Clothes Airer now £40", "Storz and Bickel Mighty Medic Vape £95"), one is a trade buyer ("CASH FOR PHONES WANTED…"), one advert appears twice ("Wanted tools", Buckley).
Confidence: medium (one snapshot).

**Finding 21: the posting guide assumes a seller; a wanted advert uses the same form.**
Source: https://www.gumtree.com/info/safety/p/selling/how-to-post-an-ad/ (official).
Evidence: step one is "Type in the name of what you're selling so we can suggest a category."; no offered/wanted selector is described. The Australian guide (https://help.gumtree.com.au/AU/articles/en_US/KB_Article/How-do-I-post-an-Ad-AU/) lists title, category, details, price (optional in some categories), photos, description, and no advert type.
Confidence: medium.

**Finding 22: saved searches in Australia are capped at 50, last 90 days and have three frequencies.**
Source: https://help.gumtree.com.au/articles/en_US/KB_Article/Creating-Search-Alerts-AU/?l=en_US&fs=RelatedArticle (official).
Evidence: up to 50 active Saved Searches; "Every Saved Search you create is valid for 90 days from the date of activation."; e-mails immediately, daily or weekly; immediate delivery requires a keyword in the search; each e-mail carries an unsubscribe option.
Confidence: high.

**Finding 23: UK alert e-mails go out daily only when there are new results, with a one-click deactivate link.**
Sources: https://www.gumtree.com/info/safety/p/my-account-settings/how-to-manage-gumtree-emails-and-notifications/ (official; "click here to deactivate this alert" at the bottom of each alert e-mail); https://help.gumtree.com/s/basics?amp=&article=Creating-Managing-Alerts2&cat=Searching_Replying (official, read as a search excerpt only; the page did not render).
Confidence: high for the deactivate link; medium for the daily frequency.

**Finding 24: wanted-advert posters are a scam target.**
Source: https://help.gumtree.com.au/AU/articles/en_US/KB_Article/Beware-of-requests-to-post-ads-on-behalf-of-strangers-AU/ — search excerpt only, page not opened.
Evidence (excerpt): people who post wanted rental adverts are approached by fake landlords asking them to post adverts on their behalf.
Confidence: low.

**Unconfirmed:** advert lifetime for goods in the UK; a ban on wanted adverts in Pets (appeared in a search summary without a readable source).

### Wallapop

**Finding 25: wanted adverts are reported as against the rules.**
Source: https://www.tuexpertoapps.com/2022/02/24/que-cosas-no-se-pueden-vender-en-wallapop/ (blog, 2022-02-24, cites Wallapop's "normas de convivencia" without a link).
Evidence: "Tampoco se pueden publicar anuncios de búsqueda como “compro…o busco…”"
Counter-check: https://about.wallapop.com/en/other-prohibited-conduct/ (official) lists five prohibited behaviours and none concerns wanted adverts.
Confidence: low to medium.

**Finding 26: the substitute is a saved search with an alert.**
Sources: https://es.wallapop.com/motor-y-accesorios/remolque (official category page: "te recomendamos usar la función de guardar búsquedas", "recibirás notificaciones instantáneas en cuanto alguien suba un anuncio que coincida con tus criterios"); https://www.elgrupoinformatico.com/tutoriales/como-activar-las-alertas-busqueda-wallapop-t74197.html (blog, 2019-06-27: "Guardar búsqueda" after filtering, list under "Mis búsquedas", a bell per search switches its alert); https://wwwhatsnew.com/?p=350226 (blog, 2019-06-27: a "notificación diaria", managed in "Alertas").
Context: the 2019 launch reports describe a daily notification, the current official page instant ones; frequency appears to have moved from daily to instant. No cap on saved searches was found.
Confidence: high for existence; medium for frequency.

### Craigslist

**Finding 27: "wanted" is a category of ordinary postings.**
Source: https://www.craigslist.org/search/area/newyork?cat=waa (live category, opened 2026-11-14).
Evidence: page "Wanted in New York City"; each row shows a title and a location only; titles include "ross fly reel wanted", "WANTED : COMIC BOOK ORIGINAL ART (hand drawn black and white art)", "SEEKING VINYL COLLECTIONS", "Looking for this 70 Barracuda Gran Coupe".
Confidence: high.

**Finding 28: for-sale posts leak into the wanted category.**
Source: same page.
Evidence: of the first 10, at least three are offers ("Pickup Trucks for Sale 4x4 Honda Acty…", "YARD ITEMS FOR SALE", "Funsicle 18' x 54" Pool and Supplies").
Confidence: medium (one snapshot).

**Finding 29: postings expire and are renewed by hand.**
Sources: https://www.craigslist.org/about/help/faqs/lifespan (official: paid postings 30 days, free postings 7 to 45 days); https://www.craigslist.org/about/help/posting/modify/renew (official: "Free postings can be placed at the top of the listings every 48-72 hours" by clicking "renew"; renewal applies to free postings only).
Context: the lifespan page does not say which figure applies to "wanted"; a renewal window limit of 30 days appeared only in a search summary of a forum thread, unconfirmed.
Confidence: high for the quoted rules.

**Finding 30: matching is a saved search with e-mail alerts, on the seeker's side only.**
Source: https://www.craigslist.org/about/help/account/features/searches (official).
Evidence: search alerts send an automated e-mail "when new postings match one of your saved searches."; "Saved searches cannot be edited; you must create a new one and delete the old one."
Confidence: high.

**Finding 31: anti-spam rule.**
Source: https://www.craigslist.org/about/prohibited (official).
Evidence: prohibited content includes "miscategorized, overposted, cross-posted, or nonlocal content."
Confidence: high.

## Sources that could not be read
- `https://pomoc.olx.pl/` and its article URLs — JavaScript application or redirect to `login.olx.pl`; not followed.
- `https://www.olx.pl/regulamin/` — 404.
- `https://help.gumtree.com/s/...` — JavaScript application, no body.
- `https://www.facebook.com/help/...` — title only, no body.
- `web.archive.org` — blocked for the fetch tool.
- `https://www.vinted.pl/help` — not opened; the UK and .com help pages were used.
