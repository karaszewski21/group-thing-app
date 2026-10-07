# Deep dive — the 5 organizer-page layout presets (+ SHOWCASE), block library, registry contract

Category: `deep-layouts` · Date: 2026-10-07 · Builds on `outputs/research-report.md` §8/§10, `analysis/synthesis.md` C4, `external-saas-patterns-and-proposal.md` E, `docs-ux-mockups-and-content-blocks.md` M2–M4.

Paths: frontend relative to `src/frontend/src/`, backend relative to `src/backend/app/`, prototypes relative to the repo root.

---

## 0. Ground truth this spec is built on (what the data model can and cannot feed)

| Fact | Evidence | Consequence for layouts |
|---|---|---|
| Organizer page today = one name card; payload `{slug,name,primary_color,accent_color}` | `pages/PublicOrganizationPage.tsx:64-85`, `api/organizations.ts:14-19` | Every block beyond `name` needs new data (see §2 "exists today") |
| `Organization` columns: `party_id, name, slug, primary_color, accent_color` only | `organizations/models.py:53-89` | tagline/bio/logo/cover/location/contact/gallery do not exist |
| `Group` = `party_id, name, layout_mode, visibility` — **no description, no schedule text, no capacity, no image** | `groups/models.py:97-117` | Circle cards can show name + next term + counts only; "harmonogram"/"wolne miejsca" are NOT available |
| `Term` = `circle_group_id, occurs_on (date+time), description(2000)` — **no title, no place, no capacity** | `groups/models.py:215-229` | Prototype line "16:30 · Sala nr 2 · zostały 2 miejsca" (`ProfilMobilny.tsx:325`) is only partly backable: time yes, place/seats no. Term title = circle name |
| Public term payload already exposes `needed_items` and `item_listings` (product_name, condition, offered_types LEND/SWAP/GIFT, lister_display_name) for PUBLIC circles | `api/groups.ts:156-206`; `groups/models.py:313-345` (modes LEND/GIFT/SWAP) | Exchange blocks are aggregatable from already-public data — no new privacy exposure |
| Next term is picked server-side ("next upcoming, else most recent") | `groups/application/public_view.py:180,224-225` | Same rule usable for "next term" links/cards |
| `GroupVisibility` PUBLIC / PRIVATE; PRIVATE returns reduced payload | `groups/models.py:83-95`; report §5.5 | Public organizer page must, by default, list PUBLIC circles only |
| Existing exchange-summary endpoint is per-group, members-only, and returns per-family booleans, not counts | `groups/router/circles.py:281-293`, `groups/schemas.py:645-660` | Not reusable for a public page; organizer-level counts need a new query |
| Catalog product photo exists (`product_photo_url`) on item details | `circulation/schemas.py:178-194` | An item-board block can show photos if the public listing DTO gets `product_photo_url` |
| ACL direction today is groups → organizations only | `groups/infrastructure/organizations_acl.py:1-19` | The organizer page read model needs the reverse (organization → owner party → leaderships → groups), exposed by a groups-side query function |
| Term page and prototype live in a 430px phone column; at ≥520px a bezel/stage appears | `KragStage.tsx:16,91`; `ProfilMobilny.tsx:33-36,253-261` | MVP desktop = same centered column (consistency with term page); wide layouts are an enhancement |

Personas come from the four target use cases of the prior research (`.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/planning/research-brief.md`): (1) ad-hoc music classes — Kasia, sessions via shared link, later a standing group; (2) family gatherings — fixed known members; (3) teacher's class — fixed members; (4) football coach's team — players + parents. That report concluded 2–4 are fully served by the current model and are membership-centric (`outputs/research-report.md:342-367` of that task). Important for layouts: personas 2–4 are typically **PRIVATE** circles, so their public organizer page has little public schedule/exchange data — layouts must look good almost empty.

---

## 1. Shared rendering principles

1. **Layout = ordered list of block slots (block id + variant) + a frame.** Blocks are pure components taking a slice of one `OrganizerPageData` object; they never fetch. (Report §8; `docs-ux-mockups-and-content-blocks.md` M4.)
2. **Every block declares `isEmpty(data)`.** The renderer drops empty blocks for visitors. For the owner in edit mode, empty blocks render a dashed "ghost" with a CTA ("Dodaj opis", "Dodaj termin") — this turns empty layouts into an onboarding checklist and closes the HomeView promise "Dodaj opis, kolory i logo" (`views/HomeView.tsx:77-86`).
3. **Each layout has one "primary block".** If the primary block is empty, the layout renders a layout-specific empty state in its place (never a blank page), plus the always-available `link-stack` fallback (share + next-term link when present).
4. **Tokens only** (`--color-*`), no hex. The prototype's hard-coded hexes (`#12604D`, `#56701F`, `#245F61`, `#33430E` — `ProfilMobilny.tsx:269-334`) become `primary-strong`/`accent-strong`/`teal-strong` tokens.
5. **Semantic exchange colors**: Oddam (GIFT) = primary-soft, Wymienię (SWAP) = accent-soft, Wypożyczę (LEND) = teal-soft — exactly the prototype mapping (`ProfilMobilny.tsx:330-334`); teal stays fixed (report §5.3, R5).
6. **Same header contract everywhere**: share button always present (prototype `:358-361` copies the URL, toast "Link do profilu skopiowany"); back button only when `history.length > 1`, since the page is usually a landing page from Instagram/WhatsApp.
7. **Labels**: map `offered_types` → "Oddam/Wymienię/Wypożyczę" for counts and "Weź na stałe/Zamień/Pożycz" for actions (`pages/krag/components/termLabels.ts:5-13`) — do not invent a third vocabulary.

---

## 2. Shared block library

"Exists today" means: Y = renderable now from an existing public payload; P = data exists in the DB but there is no public endpoint/aggregation (needs D4 read model); N = data does not exist (needs new columns/tables, D5).

| Block id | Variants | Data required (`OrganizerPageData` slice) | Source / endpoint (proposed) | Exists today | Empty rule (visitor) |
|---|---|---|---|---|---|
| `hero` | `cover` (330px photo + shade, prototype `:45-72`), `color` (primary gradient, no photo), `compact` (64px band: avatar + name + share), `centered` (avatar 96px, name, tagline, stacked) | `name`, `tagline?`, `logoUrl?`, `coverUrl?`, `slug` | `GET /api/organizations/public/{slug}` (+ D5 fields) | Y for name; N for tagline/logo/cover | Never empty (name always). `cover` without coverUrl → auto-degrades to `color` |
| `share` | inline (in hero bar) | `slug` | client only | Y | never empty |
| `stats` | `tiles3` (prototype `:393-406`) | `location?`, `familiesCount`, `galleryCount?` | page read model (D4) + D5 | P (familiesCount derivable from TermAttendance/Membership), N (location, gallery) | Show only tiles with values; <2 tiles → hide block |
| `about` | `full` (2 paragraphs), `short` (clamp 3 lines + "Więcej") | `bio?` | D5 column `organizations.bio` (text moderation like name) | N | hide |
| `upcoming-terms` | `list` (date badge + circle name + time, prototype `:422-428`), `compact` (3 rows, no description) | `upcomingTerms[]: {termId, groupId, groupName, occursOn, description?, attendeeCount?}` | D4 read model (PUBLIC circles, next N) | P | hide (CLASSIC) / empty state (SCHEDULE) |
| `agenda` | `by-day` (sticky day headers, filter chips by circle), `week-strip` (7-day chips + list) | same as `upcoming-terms` but larger window (e.g. 6 weeks / ≤30 terms) + `circles[]` for chips | D4 read model | P | primary-block empty state "Brak zaplanowanych zajęć" |
| `next-term-cta` | `card` (big tappable card: date, time, circle name, "Zapisz się ›"), `button` | first of `upcomingTerms` | D4 (or today: none) | P | hide |
| `circles-grid` | `cards` (1 col mobile; name, next term, families count, visibility badge), `featured` (single circle: large card + mini visualization) | `circles[]: {groupId, name, layoutMode, visibility, nextTerm?, familiesCount}` | D4 read model | P | primary-block empty state |
| `circle-visual` | `mini` (read-only, 240px, no interactions) | for one PUBLIC circle: `guardians[]`, `layoutMode`, `organizerName` | existing `GET /api/groups/public/{id}?term_id=` (`groups/router/circles.py:112`) — or embedded in D4 for the featured circle | Y (data), N (a compact read-only variant of `GroupVisualization`) | hide when circle PRIVATE or 0 guardians |
| `exchange-counts` | `tiles3` (prototype `:430-441`) | `exchange: {gift, swap, lend}` over upcoming terms of PUBLIC circles | D4 aggregation over `item_listings` | P | hide when all three are 0 |
| `exchange-board` | `grid2` (photo cards), `list` (rows) ; tabs Wszystko/Oddam/Wymienię/Wypożyczę | `listings[]: {itemId, productName, condition, offeredTypes, listerDisplayName, productPhotoUrl?, termId, groupId, occursOn}` | D4 aggregation of `PublicItemListingResponse` across next terms + new `product_photo_url` | P (photo N on public DTO) | primary-block empty state "Na najbliższych zajęciach nikt jeszcze nic nie udostępnia" |
| `needed-items` | `list` (unclaimed first, "Ja to przyniosę" deep-links to term page) | `neededItems[]: {termId, groupId, productName, claimed}` for next term(s) | D4 aggregation of `PublicNeededItemResponse` | P | hide |
| `link-stack` | `buttons` (full-width pill buttons, 56px) | computed: next term link, "Wszystkie terminy" (anchor/sheet), "Wymiana rzeczy" (anchor), share, `contactUrl?` | computed client-side from D4 | P (contact N) | never empty (share always) |
| `gallery` | `strip` (horizontal thumbs, prototype `.mv-thumbs` `:75-91`), `grid2` (`GaleriaZdjec.tsx:37-63`) | `gallery[]: {url, alt}` | N — new org-photo table; Spaces + photo moderation infra exists for products | N | hide |
| `testimonials` | `cards` (prototype CSS `.mv-quote` `:179-190`, unused) | `testimonials[]` | N | N | hide (paid SHOWCASE only) |
| `empty-state` | `visitor`, `owner` | layout-specific copy | static | Y | n/a |
| `footer` | `minimal` ("Strona utworzona w …") | none | static | Y | never empty |

Notes:
- The prototype CSS also contains unused `.mv-tabs`, `.mv-group`, `.mv-slot` ("wolne miejsca" pill), `.mv-quote`, `.mv-bottom` (sticky price + CTA) (`ProfilMobilny.tsx:135-220`). They show the author had considered a tabbed profile, group cards with seat pills, testimonials and a sticky CTA bar — they directly seed `circles-grid`, `testimonials` and the sticky `next-term-cta` used below.
- `slot`/"zostały 2 miejsca" needs a `Group.capacity` or `Term.capacity` column that does not exist — **exclude from MVP**; the variant shows `attendeeCount` ("zapisanych: 8") instead, which is derivable.

### 2.1 Proposed data contract (one payload, all layouts)

```ts
// returned by GET /api/organizations/public/{slug}/page  (new PUBLIC matrix row placed before row 49)
interface OrganizerPageData {
  organization: {
    slug: string; name: string;
    tagline: string | null; bio: string | null;          // D5
    logoUrl: string | null; coverUrl: string | null;     // D5 (later)
    location: string | null; contactUrl: string | null;  // D5 (later)
    theme: { primary: string | null; accent: string | null };
    pageLayout: string;                                   // effective layout (server-resolved)
  };
  circles: CircleSummary[];          // PUBLIC only (decision: PRIVATE listed as "zamknięta"? see §6 Q3)
  upcomingTerms: TermSummary[];      // next 6 weeks, max 30, PUBLIC circles
  exchange: { gift: number; swap: number; lend: number };
  listings: ListingSummary[];        // max 24, next terms only
  neededItems: NeededSummary[];      // next term per circle, unclaimed first
  familiesCount: number;
  gallery: { url: string; alt: string }[];   // [] until gallery ships
}
```

Backend source: organization row (organizations module) + a new groups-side query function (e.g. `groups.public_api.organizer_page_read_model(owner_party_id, now)`) composed in the organizations router; the owner party comes from `OrganizationRole OWNER` (`organizations/models.py:~50,92+`). Whether the window/limits are fixed or layout-dependent: **fixed server-side** (one cacheable payload, layout switching in the editor needs no refetch).

---

## 3. The layouts

Mockups are ~44 monospace columns ≈ 360px. `[ ]` = button, `( )` = avatar, `###` = photo.

### 3.1 `CLASSIC` — "Klasyczny" (default + fallback)

**Persona / use case:** Kasia, music classes for 0–6 (use case 1) — the literal prototype (`ProfilMobilny.tsx:5`, "Muzyczna Wioska — profil prowadzącej"). Also a dance/art studio, a small sports academy that wants a "proper profile". The organizer who has (or will have) a cover photo and a bio.

**Blocks (order):**
1. `hero:cover` (→ `hero:color` without cover)
2. `stats:tiles3`
3. `about:full`
4. `upcoming-terms:list` (max 5)
5. `exchange-counts:tiles3`
6. `gallery:strip` (only when gallery exists)
7. `footer`

**Missing data:** no cover → `hero:color` 220px primary gradient with avatar initials; no bio → section dropped (stats move up under hero); 0 upcoming terms → drop; owner sees ghost "Dodaj pierwszy termin". With **only a name** (today's reality), CLASSIC = colored hero + share + footer — acceptable but sparse; the editor should nudge to add tagline/bio.

```
+------------------------------------------+
|[< Wroc]                             [^>] |
|##########################################|
|######## cover photo / primary grad ######|
|##########################################|
| (O) Rodzinny grajdolek                   |
| Zajecia umuzykalniajace 0-6 · Jezyce     |
+-/--------------------------------------\-+  sheet, radius 26, -22px overlap
| +------------+ +-----------+ +---------+ |
| |[pin]Miejsce| |[pp]Rodziny| |[img]Gal.| |
| | Jezyce     | | 32        | | Zobacz >| |
| +------------+ +-----------+ +---------+ |
|                                          |
| Zaczelam od jednej grupy w salce na      |
| Jezycach, bo szukalam zajec dla ...      |
|                                          |
| Najblizsze terminy                       |
| +----+ Muzyczne Maluchy                  |
| | 27 | 16:30 · zapisanych: 8           > |
| |sie |                                   |
| +----+ - - - - - - - - - - - - - - - - - |
| +----+ Rytmy i grzechotki                |
| | 30 | 10:00                           > |
| +----+                                   |
|                                          |
| Wymiana rzeczy                           |
| +----------+ +----------+ +----------+   |
| |[gift]  3 | |[swap]  4 | |[bskt]  0 |   |
| | Oddam    | | Wymienie | | Wypozycze|   |
| +----------+ +----------+ +----------+   |
+------------------------------------------+
```

**Desktop:** MVP — same 430px column on the stage background with bezel at ≥520px (prototype `:253-261`, `KragStage.tsx:91`). Enhancement (≥1024px): 2 columns — left sticky card (hero:compact + stats + about), right (terms, exchange, gallery grid); cover becomes a 240px full-width banner.

### 3.2 `SCHEDULE` — "Plan zajęć" (proposed rename from "Grafik")

**Persona / use case:** high-frequency recurring activity where the visitor's only question is "kiedy?": football coach with 2–3 trainings/week (use case 4, when the team circle is PUBLIC or for an academy's open trainings), a studio with several weekly slots, a teacher with weekly open consultations. "Grafik" in Polish connotes a work-shift roster; parents search for "plan zajęć"/"kalendarz".

**Blocks:**
1. `hero:compact` (avatar + name + tagline one line + share)
2. `next-term-cta:card` (sticky? no — inline at top; a sticky bottom bar variant reuses `.mv-bottom` `:205-210`)
3. `agenda:by-day` (**primary**; filter chips by circle when ≥2 circles)
4. `about:short`
5. `exchange-counts:tiles3`
6. `footer`

**Missing data:** 0 terms → primary empty state "Organizator nie zaplanował jeszcze zajęć" (mirrors `TermCard.tsx:245` copy) + `link-stack` (share); owner sees "Dodaj termin". Only 1 circle → chips hidden. Only 1 term in window → agenda shows one day header; still clearer than CLASSIC because the date is the hero. Term `description` shown as a 1-line subtitle when present.

```
+------------------------------------------+
| (O) Akademia Orlik            [^>]       |
|     Treningi dla rocznikow 2015-2019     |
+------------------------------------------+
| +--------------------------------------+ |
| | NAJBLIZSZE              wt 14 paz    | |
| | Orliki 2017   17:00                  | |
| |                      [ Zapisz sie > ]| |
| +--------------------------------------+ |
|                                          |
| (Wszystkie) (2015) (2017) (2019) ->      |  filter chips
|                                          |
| == wtorek, 14 pazdziernika ============= |
|  17:00  Orliki 2017       zapis.: 12   > |
|  18:15  Mlodziki 2015     zapis.:  9   > |
| == czwartek, 16 pazdziernika =========== |
|  17:00  Orliki 2017                    > |
|  17:00  Skrzaty 2019                   > |
| == sobota, 18 pazdziernika ============= |
|  10:00  Turniej rodzinny               > |
|          "Zabierzcie stroje i wode"      |
|            [ Pokaz kolejne tygodnie ]    |
|                                          |
| O nas: Trenujemy od 2012 roku na ...     |
|                                 Wiecej v |
| Wymiana: 2 Oddam · 5 Wymienie · 1 Pozycz.|
+------------------------------------------+
```

**Desktop:** enhancement — agenda gets a left rail with a month mini-calendar (Luma calendar pattern, `external-saas-patterns-and-proposal.md` E #2) and chips become a vertical filter; MVP same column.

### 3.3 `CIRCLES` — "Grupy" (UI label; key stays `CIRCLES`)

**Persona / use case:** organizer with several groups/age bands — teacher with classes 1a/2b (use case 3), music studio "Maluchy 0–2 / Przedszkolaki 3–6", football academy by roczniki. **With exactly one circle** it switches to the `featured` variant — this is the natural page for a **coach's single team or a teacher's single class** (use cases 3–4): it shows "who we are" through the existing mini visualization (circle/pitch/table from `Group.layout_mode`, mockups `ux-grup/*.png`), which is the product's most distinctive visual.

**Blocks:**
1. `hero:color` (or `cover`)
2. `circles-grid:cards` (**primary**) — ≥2 circles; or `circles-grid:featured` + `circle-visual:mini` — exactly 1 circle
3. `about:short`
4. `exchange-counts:tiles3`
5. `footer`

Card content: circle name, next term (date/time) or "Brak terminu", `familiesCount` ("12 rodzin"), visibility badge; tap → next term page `/:slug/grupa/:groupId/term/:termId`. No "harmonogram"/"wolne miejsca" (no data, §0).

**Missing data:** 0 PUBLIC circles → empty state "Grupy tego organizatora są zamknięte" + share (and, if product decides to list PRIVATE circles, a "Poproś o dołączenie" path via existing `GroupJoinRequest`, `groups/models.py:183-213` — open question Q3). PRIVATE featured circle → no `circle-visual` (guardians are not public for PRIVATE, report §5.5).

```
 >= 2 circles                                1 circle (featured)
+------------------------------------------+ +------------------------------------------+
| ######## primary gradient ######## [^>]  | | ######## primary gradient ######## [^>]  |
| (O) Szkola Muzyczna Nutka                | | (O) Trenerka Ola · Orliki 2017           |
|     3 grupy · Poznan                     | +------------------------------------------+
+------------------------------------------+ | +--------------------------------------+ |
| Nasze grupy                              | | |        o   o   o                      | |
| +--------------------------------------+ | | |     o   (Ola)    o    mini pitch/     | |
| | Maluchy 0-2                 12 rodzin| | | |        o   o   o      circle (ro)     | |
| | nast.: sr 15 paz, 9:30             > | | | +--------------------------------------+ |
| +--------------------------------------+ | | | Orliki 2017              14 rodzin    | |
| +--------------------------------------+ | | | nast.: wt 14 paz, 17:00               | |
| | Przedszkolaki 3-6            9 rodzin| | | |              [ Zobacz trening > ]    | |
| | nast.: czw 16 paz, 16:30           > | | | +--------------------------------------+ |
| +--------------------------------------+ | | O nas: ...                               |
| +--------------------------------------+ | | Wymiana: 3 · 1 · 0                       |
| | Rytmika szkolna  [zamknieta]         | | +------------------------------------------+
| | Brak terminu                         | |
| +--------------------------------------+ |
| O nas: ...                       Wiecej v|
+------------------------------------------+
```

**Desktop:** enhancement — 2–3 column card grid (Shopify collection grid, `external-saas-patterns-and-proposal.md` E #3); featured variant puts the visualization left, details right.

### 3.4 `LINKS` — "Wizytówka" (link-in-bio)

**Persona / use case:** solo/small organizer whose traffic comes from Instagram bio, WhatsApp/Messenger groups; Kasia at the **ad-hoc start** (use case 1, nothing but a name and one link); the **family-gatherings host** (use case 2 — circle is PRIVATE, the page just needs to look nice and point to the event). The only layout that is fully satisfying with today's data.

**Blocks:**
1. `hero:centered` (avatar/initials 96px, name, tagline)
2. `link-stack:buttons` (**primary**): "Najbliższe zajęcia — wt 14.10, 17:00" · "Wszystkie terminy (5)" (opens a bottom sheet with `upcoming-terms:compact`) · "Wymiana rzeczy (7)" (sheet with `exchange-counts` + link to the next term) · "Kontakt" (when `contactUrl`) · "Udostępnij"
3. `about:short` (2 lines)
4. `footer`

**Missing data:** buttons whose target is empty are omitted; with a name only → centered avatar + name + "Udostępnij" — still looks intentional (Linktree pattern, `external-saas-patterns-and-proposal.md` E #4).

```
+------------------------------------------+
|         background: cream + primary      |
|            soft radial tint              |
|                 ( OK )                   |
|           Rodzinny grajdolek             |
|        Muzyka dla 0-6 · Jezyce           |
|                                          |
| +--------------------------------------+ |
| |  Najblizsze zajecia · wt 14.10 17:00 | |  primary, solid
| +--------------------------------------+ |
| +--------------------------------------+ |
| |  Wszystkie terminy (5)               | |  paper, outlined
| +--------------------------------------+ |
| +--------------------------------------+ |
| |  Wymiana rzeczy (7)                  | |
| +--------------------------------------+ |
| +--------------------------------------+ |
| |  Kontakt                             | |  (only if contactUrl)
| +--------------------------------------+ |
| +--------------------------------------+ |
| |  Udostepnij strone                   | |
| +--------------------------------------+ |
|   Malutkie grupy, rodzic siedzi na       |
|   podlodze razem z dzieckiem.            |
|                                          |
|           domena.pl/grajdolek            |
+------------------------------------------+
```

**Desktop:** stays a centered column (max ~480px) at all widths — that is the archetype; no wide variant planned.

### 3.5 `EXCHANGE` — "Wymiana" (redefined as an item board)

**Persona / use case:** parents' community / neighborhood or kindergarten-group swap of toys, books, clothes; extended-family "hand-me-downs" (use case 2 when the circle is PUBLIC or for a family that runs an open swap day); an organizer who uses the app primarily as the exchange mechanism (product differentiator, `docs-ux-standards-and-docs.md` D2).

**Critical change vs. the report:** the report's EXCHANGE was "needed items + counts first, then terms, then bio" (report §8). That is CLASSIC reordered (§4). It is redefined here as a **catalog-first board of concrete items with photos** (Shopify product grid / marketplace pattern), which is structurally different and uses data that is already public per term.

**Blocks:**
1. `hero:compact`
2. `exchange-counts:tiles3` acting as **filter tabs** (tap "Wymienię 4" filters the board)
3. `exchange-board:grid2` (**primary**): photo (product photo), product name, condition, mode pills, "od: Rodzina Nowaków", "odbiór: wt 14.10" → tap opens term page anchored at the lister (`attendeeElementId`, `termSectionTypes.ts:347-349`); taking happens on the term page (auth gates stay there)
4. `needed-items:list` — "Na najbliższe zajęcia potrzebne:" with "Ja to przyniosę ›" → term page
5. `upcoming-terms:compact` (3)
6. `about:short`
7. `footer`

**Missing data:** board empty (nobody attending an upcoming term has a listing mode) → empty state "Na najbliższych zajęciach nikt jeszcze nic nie udostępnia" + "Jak to działa?" explainer (3 steps: set mode in "Moje rzeczy" → sign up for a term → item appears) + `needed-items` if any; no photo → category-colored placeholder tile with initial; no upcoming terms at all → board is necessarily empty (listings are derived from `TermAttendance`, `groups/models.py:313-330`) → page shows explainer + share.

```
+------------------------------------------+
| (O) Wymianka Sołacz            [^>]      |
|     Zabawki, ksiazki, ubranka 0-6        |
+------------------------------------------+
| +----------+ +----------+ +----------+   |
| |*Oddam  3*| | Wymienie 4| | Pozycze 1|   |  tabs (selected = filled)
| +----------+ +----------+ +----------+   |
| +-----------------+ +-----------------+  |
| |#################| |#################|  |
| |#####photo#######| |#####photo#######|  |
| |#################| |#################|  |
| | Pucio - ksiazka | | Kask rowerowy   |  |
| | b. dobry        | | dobry           |  |
| | [Oddam]         | | [Oddam][Wym.]   |  |
| | Nowakowie·wt 14 | | Kowalscy·wt 14  |  |
| +-----------------+ +-----------------+  |
| +-----------------+ +-----------------+  |
| | ... 2 more ...  | |                 |  |
|            [ Pokaz wszystkie (12) ]      |
|                                          |
| Potrzebne na wt 14.10                    |
|  - Koc piknikowy        Ja przyniose >   |
|  - Owoce                Ja przyniose >   |
| Najblizsze spotkania: wt 14 · sb 18 ...  |
+------------------------------------------+
```

**Desktop:** enhancement — 3–4 column grid with tabs as a left filter column.

### 3.6 `SHOWCASE` — "Magazyn" (paid candidate, not in MVP)

**Persona:** brand-heavy clubs/studios (sports academy, dance school) wanting an editorial page. **Blocks:** `hero:cover` full-bleed 70vh with headline + primary CTA (next term) → `about:full` with inline photos → `gallery:grid2` → `circles-grid:cards` (featured) → `testimonials:cards` → `stats` (familiesCount, terms held) → contact. **Blocked by data:** gallery (N), testimonials (N), cover (N). Degrades poorly without photos — which is precisely why it should be paid and only purchasable once cover + ≥4 gallery photos exist (registry `minData`, §5). Report §8 / synthesis C4 agree.

---

## 4. Critical evaluation — are the 5 sufficiently distinct?

Distinctness is judged on four axes: (A) primary block, (B) page structure/frame, (C) hero treatment, (D) behavior with **today-realistic data** (name + maybe 1 public circle with 1 weekly term, few listings).

| Layout | A primary | B structure | C hero | D with sparse data |
|---|---|---|---|---|
| CLASSIC | bio + terms (profile) | long single column, sheet over cover | cover/color 330px | colored hero + nothing → looks like LINKS without buttons |
| SCHEDULE | agenda by day | compact header + timeline | compact band | 1–2 agenda rows → converges with CLASSIC minus bio |
| CIRCLES | circle cards / featured circle + visualization | card grid / feature card | color/cover | 1 circle → featured visual: **still distinct** (thanks to featured variant) |
| LINKS | button stack | centered column | centered avatar | **fully distinct and good-looking** |
| EXCHANGE (report version) | counts + needed items | same as CLASSIC, reordered | compact | ≈ CLASSIC with sections swapped — **not distinct** |
| EXCHANGE (redefined) | photo item board | catalog grid + filter tabs | compact | empty board + explainer — distinct but often empty early on |

Pairwise similarity (higher = more alike, judgment): CLASSIC–EXCHANGE(report) **high** · CLASSIC–SCHEDULE **medium** (high under sparse data) · SCHEDULE–CIRCLES **medium** for 1-circle organizers without the featured variant · LINKS vs all **low** · EXCHANGE(redefined) vs all **low**.

Findings:
1. **The report's EXCHANGE fails the distinctness test** — it is CLASSIC with section order changed. Redefining it as an item board (§3.5) fixes this, at the cost of the listing aggregation + `product_photo_url` on the public DTO. Confidence: Medium-High.
2. **Distinctness of SCHEDULE/CIRCLES/EXCHANGE is data-dependent.** In the PoC, most organizers have 1 circle, few terms, few listings. Mitigations: (a) CIRCLES' `featured` variant for 1 circle; (b) the editor shows each thumbnail **rendered with the organizer's own data** (live mini-preview) or at least marks "Najlepszy, gdy masz kilka grup / dużo terminów / aktywną wymianę"; (c) a "Polecany" badge computed from data (≥2 circles → CIRCLES; ≥4 terms in 2 weeks → SCHEDULE; ≥4 listings → EXCHANGE; name only → LINKS). Confidence: Medium.
3. **Personas 2–4 (family, teacher's class, team) are mostly PRIVATE**, so the public-data-heavy layouts (SCHEDULE, EXCHANGE) serve them poorly; LINKS and CIRCLES:featured serve them best. This argues that the visualization-centric "team/class" angle should be explicit (done via CIRCLES:featured). Confidence: Medium.
4. **Personas are covered**: Kasia → CLASSIC (later) / LINKS (start); coach → SCHEDULE (academy) / CIRCLES:featured (one team); teacher → CIRCLES; family host → LINKS; swap community → EXCHANGE. No persona is left without a natural pick.

### 4.1 Alternatives considered

| Alt | Set | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A (recommended)** | CLASSIC, SCHEDULE, CIRCLES (+featured), LINKS, EXCHANGE (item board) | keeps the user-agreed keys; each has a distinct primary block and structure; featured variant covers team/class | EXCHANGE board needs aggregation + photo field; SCHEDULE thin under sparse data | adopt |
| B | replace EXCHANGE with `TEAM` ("Drużyna/Klasa": visualization-first for a single circle) | strongest visual differentiation; fits use cases 3–4 | loses the exchange-first page (product differentiator); duplicates CIRCLES:featured | reject (fold into CIRCLES:featured) |
| C | merge SCHEDULE into CIRCLES (agenda as a tab), add SHOWCASE as free once gallery exists | fewer, richer layouts | SHOWCASE unusable before gallery ships; loses a paid candidate | defer; reconsider when gallery exists |
| D | 3 structural layouts (CLASSIC, LINKS, AGENDA) × hero-style setting (cover/color/compact) = "5 looks" | least code | needs per-layout settings (JSONB `theme_settings`) in MVP — contradicts phased storage decision (report §6.2) and "easy editor" | reject for MVP |
| E | ship CLASSIC + LINKS first, the other three after D4 read model | matches report risk R7 phasing; both work on near-zero data | the "choose 1 of 5" promise arrives later | adopt as **delivery order**, not as a different set |

Minor naming recommendations: "Grafik" → "Plan zajęć"; "Kręgi" → "Grupy" in the layout picker (the visitor-facing word; `krąg` stays internal/brand); keep "Układ strony" (vs "Szablon wizualizacji" for `layout_mode`, report R8).

---

## 5. Layout registry contract

Goal: a future paid/custom layout is "just a new registry entry" — either a declarative block list (no new component) or, for bespoke designs, an optional `Component`. The declarative part is JSON-serializable so that a later DB-stored "layout as data" (report §10 `page_layouts` table, Shopify JSON templates) uses the **same shape**.

```ts
// src/features/organizerPage/layouts/types.ts  (location illustrative)
export type BlockId =
  | "hero" | "share" | "stats" | "about" | "upcoming-terms" | "agenda"
  | "next-term-cta" | "circles-grid" | "circle-visual" | "exchange-counts"
  | "exchange-board" | "needed-items" | "link-stack" | "gallery"
  | "testimonials" | "empty-state" | "footer";

/** Data keys a block reads; used for empty-checks, "Polecany" scoring and minData gating. */
export type DataKey =
  | "tagline" | "bio" | "logo" | "cover" | "location" | "contact"
  | "circles" | "upcomingTerms" | "exchange" | "listings" | "neededItems"
  | "familiesCount" | "gallery" | "testimonials";

export interface BlockSlot {
  block: BlockId;
  variant?: string;                       // validated against BLOCKS[block].variants
  props?: Record<string, string | number | boolean>; // JSON-only, e.g. { limit: 5 }
  primary?: true;                         // exactly one per layout; drives empty state
  when?: { minCircles?: number; maxCircles?: number }; // e.g. featured vs cards
}

export interface PageLayoutDefinition {
  key: string;                            // "CLASSIC" | ... | "custom:<uuid>" — matches organizations.page_layout VARCHAR(40)
  version: number;                        // bump on breaking change of blocks/settings
  tier: "free" | "paid";
  label: string;                          // "Klasyczny"
  description: string;                    // "Dla kogo" line in the picker
  thumbnail: { src: string; alt: string }; // static SVG wireframe, src/assets/layouts/<key>.svg
  frame: "column" | "centered";           // outer container; desktop behavior hook
  blocks: BlockSlot[];                    // declarative, JSON-serializable
  minData?: DataKey[];                    // cannot be published without these (e.g. SHOWCASE: cover, gallery)
  recommendWhen?: (d: OrganizerPageData) => boolean; // code-only; omitted for DB-stored layouts
  Component?: React.ComponentType<LayoutProps>;      // optional escape hatch for bespoke paid designs
}

export interface LayoutProps {
  data: OrganizerPageData;
  mode: "visitor" | "owner-edit";
}

export const LAYOUT_REGISTRY: Record<string, PageLayoutDefinition> = { CLASSIC, SCHEDULE, CIRCLES, LINKS, EXCHANGE };
export const FALLBACK_LAYOUT = "CLASSIC";

export function resolveLayout(key: string | null | undefined): PageLayoutDefinition {
  return (key && LAYOUT_REGISTRY[key]) || LAYOUT_REGISTRY[FALLBACK_LAYOUT];
}
```

Example entry:

```ts
export const SCHEDULE: PageLayoutDefinition = {
  key: "SCHEDULE", version: 1, tier: "free",
  label: "Plan zajęć", description: "Gdy prowadzisz zajęcia kilka razy w tygodniu",
  thumbnail: { src: scheduleSvg, alt: "Układ: plan zajęć" }, frame: "column",
  blocks: [
    { block: "hero", variant: "compact" },
    { block: "next-term-cta", variant: "card" },
    { block: "agenda", variant: "by-day", primary: true },
    { block: "about", variant: "short" },
    { block: "exchange-counts", variant: "tiles3" },
    { block: "footer" },
  ],
  recommendWhen: (d) => d.upcomingTerms.filter(inNext14Days).length >= 4,
};
```

Rendering: one generic `<LayoutRenderer def data mode>` maps slots → `BLOCKS[id].Component`, applies `when`, drops slots whose `BLOCKS[id].isEmpty(data)` is true (visitor mode), injects the layout's empty state when the `primary` slot is empty, and uses `def.Component` instead when present.

Block catalog contract (code-only):

```ts
export interface BlockDefinition<V extends string = string> {
  id: BlockId;
  variants: readonly V[];
  reads: DataKey[];
  isEmpty: (d: OrganizerPageData) => boolean;
  Component: React.ComponentType<{ data: OrganizerPageData; variant: V; mode: LayoutProps["mode"]; props?: BlockSlot["props"] }>;
}
```

Backend mirror (source of truth for tier/allowlist, no rendering): `organizations/page_layouts.py` → `PAGE_LAYOUTS: dict[str, LayoutMeta(tier, version, min_data)]`; `UpdateOrganizationRequest.page_layout` validated against its keys; `effective_layout(org, entitlements)` returns the stored key or `CLASSIC` (report §10). A frontend test asserts the two key sets are equal (prevents drift). `tier`, `minData` and entitlements are only *enforced* when the first paid entry exists (report §10; `minimal-implementation.md`) — but the fields are cheap and used by free layouts' picker metadata, so they are not stubs except `tier`, which can be added with the first paid layout.

Why this satisfies "future paid custom = new registry entry":
- **Paid preset** (e.g. SHOWCASE): add an entry with `tier: "paid"`, `minData: ["cover","gallery"]`, using existing blocks → zero new rendering code except any new block.
- **Bespoke custom layout for one organizer**: entry key `custom:<uuid>`, `blocks` stored as JSON in `page_layouts` and validated against `BlockId`/variants; the frontend registry is extended at runtime from the catalog endpoint. The organizer's `page_layout VARCHAR(40)` already fits the key (report §6.2).
- **Bespoke design needing new visuals**: same entry with a `Component` (shipped in code) — still a registry entry.

---

## 6. Open questions specific to layouts

1. Accept the redefinition of `EXCHANGE` as an item board (needs aggregation + `product_photo_url` on public listings)?
2. Accept the `CIRCLES:featured` variant (read-only mini `GroupVisualization`) as the "team/class" answer instead of a separate TEAM layout?
3. Should PRIVATE circles appear on the public page as "zamknięta — poproś o dołączenie" cards (uses existing join-request flow) or be fully hidden? (privacy; report R9)
4. Read-model window: 6 weeks / 30 terms / 24 listings fixed server-side — acceptable?
5. Desktop: ship MVP in the 430px phone column (consistent with term page) and add wide variants later?
6. Picker thumbnails: static SVG wireframes (cheap) vs live mini-renders with the organizer's data (better at showing distinctness; same `LayoutRenderer`, scaled)? Recommendation: static SVG in the picker + the page itself updating live under the bottom sheet (report §9.2).
7. Delivery order: CLASSIC + LINKS first (work on near-zero data), then SCHEDULE/CIRCLES/EXCHANGE after the D4 read model (alt E).

## 7. Confidence

| Item | Confidence |
|---|---|
| Data availability per block (§0, §2) | High (code-verified) |
| Block library and variants | Medium-High |
| Personas ↔ layouts mapping | Medium (inferred from prior use cases; not user-validated) |
| Distinctness verdict (report EXCHANGE ≈ CLASSIC) | Medium-High |
| Registry contract shape | Medium-High (follows Shopify definition/data split; untested) |
| Desktop behavior | Medium (MVP column is conservative; wide variants are design opinion) |
