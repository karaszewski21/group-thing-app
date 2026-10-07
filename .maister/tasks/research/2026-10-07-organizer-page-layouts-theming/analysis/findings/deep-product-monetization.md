# Deep dive — product-page organizer context + paid custom layouts model

Category: `deep-product-monetization`. Builds on `outputs/research-report.md` §7, §10, §15 and on
`external-saas-patterns-and-proposal.md`, `external-saas-platforms.md` and
`codebase-backend-current-state.md`. Paths are relative to `src/frontend/src/` (FE) or `src/backend/` (BE).
Confidence is noted on each item.

---

# PART A — Which organizer context applies on `/product/:id`

## A1. Every entry point into `/product/:id` (grep of the whole FE plus the BE `link_path` producers)

| # | Entry point | Source | Is term/organizer context available at the link site? |
|---|---|---|---|
| 1 | Public/member term page, listing row title link | FE `pages/krag/PublicTermView.tsx:67-73` (`to={`/product/${listing.item_id}`}`) | **Yes.** `group.id`, `term.id` and the `organizationSlug` route param are in scope. `PublicCircleResponse.organizer_slug` is in the response. |
| 2 | Panel "Moje rzeczy" (view, edit) | FE `pages/panel/views/RzeczyView.tsx:351` (view), `:312,:358` (edit), `:228` (`/product/new`) | No. The user's own inventory is not tied to any term. |
| 3 | Panel "Wypożyczone" (eye icon) | FE `pages/panel/views/WypozyczoneView.tsx:135` | Not on the link. A lend has a term in its history, but the link carries none. |
| 4 | Notification bell → `navigate(n.link_path)` | FE `components/shared/NotificationBell.tsx:19`. BE producers: `app/groups/application/term_item_listings.py:522,529,652,720,743,785,837,942`, `app/groups/application/pledge_fulfillment.py:105` (all `link_path=f"/product/{id}"`) | **Yes, server-side.** At every one of these producers a `term` (or `reservation.term_id`) is in scope. The link just doesn't include it. |
| 5 | Global pending-actions modal (SWAP_PROPOSED) | FE `pages/panel/PanelDataContext.tsx:110-128,742-753` (uses `n.link_path`) | Same as #4. |
| 6 | Post-create redirect | FE `pages/product/ItemCreatePage.tsx:38` | No. |
| 7 | Edit page back links / redirect | FE `pages/product/ItemEditPage.tsx:38,46,107` | Inherits whatever query the detail page had (currently none). |
| 8 | "Wróć" button | FE `pages/product/ItemBackButton.tsx:10-13`: `navigate(-1)`, or `/panel/rzeczy` on direct open | Back-navigation is history-based. No term context is reconstructed. |

Route: `router.tsx:114-117`, `<AuthGuard><ItemDetailPage/></AuthGuard>`. The page sits in panel chrome (`PhoneFrame` plus `PanelNavBar`, `ItemDetailPage.tsx:28-41`). **High.**

Notable fact: anonymous visitors of a PUBLIC term page see listing links (`list_public_term_item_listings`, BE `term_item_listings.py:437-459`, "so a visitor without an account can still see what's on offer"). Clicking one hits `AuthGuard`, so the anonymous visitor goes to login first. That is the only cross-over from the public organizer surface into the product page. **High.**

## A2. What the product page loads

- FE `api/items.ts:26-56`: `ItemDetailsResponse {id, product_id, name, category_id, category_name, condition, description, photos, product_photo_url, is_owner, deleted_at, status}` plus a separate `/history` call. The response has **no group, term or organizer field.**
- BE `app/circulation/application/item_details.py:45-108`: `get_item_details(db, item_id, principal, storage)` does:
  - load the row and photos;
  - find the viewer;
  - find the owning inventory (`home_owner`) and the holder;
  - load the balance;
  - only while the item is RESERVED or IN_TRANSIT, load the newest active reservation and its `term_occurs_on`.

  It has **no access check beyond "authenticated"**. Any logged-in user can read any item by UUID (matrix row 40, `authorization_matrix.py:166`). **High.**
- Privacy is handled by labels, not access control. `app/circulation/domain/item_privacy.py:44-60` shows a counterparty as "Ty", by name (only to a participant) or as "inna rodzina". History entries carry no ids (`ItemHistoryEntryResponse`, `app/circulation/schemas.py:198-207`). Unapproved photos are visible to the owner only (`item_details.py:103`). **High.**

## A3. The item → family → circle → organizer relation is many-to-many over time

- An item belongs to a **user** (inventory owner), not to a family or circle (`item_details.py:58-63`; `app/circulation/models.py:227` "always resolves to a `User`, never a `Group`/Family").
- `ItemListingPreference` is "not scoped to any Term". Visibility per term is derived at read time from the owner's `TermAttendance` (`app/groups/models.py:313-345`, `284-310`). The same item can appear on the terms of several organizers in parallel.
- Term → circle → organizer is a clean chain: `Term.circle_group_id` (`app/groups/models.py:215-222`) → active `Leadership` → party → `Organization`. This is already implemented as `resolve_organizer_slug(db, group_id)` (`app/groups/infrastructure/slug_resolver.py:19-37`), with fallback `k-<hash>` when the organizer has no Organization (`app/groups/domain/organizer_slug.py:10-20`).
- `Reservation.term_id` exists only while a reservation is in flight (`item_details.py:67-75`). After completion, history keeps only `term_occurs_on` (a date, no id).

**Conclusion (High):** "the organizer of an item" is undefined. Only "the organizer of the term through which the user reached the item" is defined.

## A4. Options evaluated

| Option | Mechanics | Evidence for | Evidence against | Verdict |
|---|---|---|---|---|
| **a. `?org=<slug>`** | Term page link appends `?org=${organizationSlug}`. Product page calls existing `usePublicOrganization(slug)` → `GET /api/organizations/public/{slug}` (PUBLIC, matrix row 48). | Zero backend change. The slug is already in scope at `PublicTermView.tsx` (route param plus `organizer_slug`). It survives refresh and share. | `k-…` slugs 404, so the default palette shows (acceptable). A user can type any slug, which changes only colors on an authenticated page. Adds a second request on the product page, with a flash of default colors unless the query is cached from the term page (same React Query key, so usually warm). | **Recommended MVP.** |
| **b. `?term=<termId>` resolved server-side** | Product page sends `term` to the backend (new optional param on `/details`, or a separate `GET /api/groups/terms/{id}/branding`) → term → circle → `resolve_organizer_slug`-like → theme. | Authoritative. Also enables a "← back to term" link and later "this item on this term" context. All BE notification producers (#4) have `term.id` in scope, so `link_path=f"/product/{id}?term={term.id}"` is trivial. | New endpoint or param. Putting it on `/details` crosses the `circulation` → `groups` boundary (ACL needed), so prefer a separate groups endpoint. Private-circle term ids would also need a branding read that does not leak (branding is not member data, consistent with the reduced PRIVATE response that already carries `organizer_slug`, `public_view.py:199-212`). | **Good v2.** Pick it if "back to term" or notification theming is wanted. |
| c. Nested route `/:slug/grupa/:g/term/:t/product/:id` or `/:slug/product/:id` | Router change. | Consistent with the term URL. | Panel and notification entries (#2-#7) have no slug. Requires two routes or `RESERVED_SLUGS` changes (`app/organizations/slugs.py:18-47` synced by hand with `router.tsx`). Duplicates the edit and back flows. | Not recommended. |
| d. Backend derives the organizer from the item (listing / needed-item / term link) | Infer from `ItemListingPreference` + owner attendance, pledge → needed item → term, or reservation term. | — | Ambiguous: one item can be listed in several organizers' terms at once (A3). A reservation term exists only in flight. A needed-item link exists only for pledged items. The result would differ between visits. | Rejected. |
| e. Sticky "last visited organizer" (localStorage or context) | Remember the last organizer page or term seen. | No URL change. | Wrong colors on panel-originated views (an item from "Moje rzeczy" painted in an unrelated organizer's colors). Stale across tabs. Not shareable. Per-viewer storage only (artifact standards: storage is for conveniences). It is surprising state. | Rejected. |
| f. No theming on the product page | Keep the default palette. | Zero work. Product page sits in panel chrome (`PhoneFrame` + `PanelNavBar`), which is the user's own space, not the organizer's. | Fails the stated requirement "palette also on the product page". | Fallback for panel and notification entries in any case. |

**Recommendation (Medium-High):**
1. MVP: **(a)**. `?org=` only from the term page. Panel, notification and create entries keep the default palette. Theme only the content area. `PanelNavBar` and `PhoneFrame` stay neutral, because they are the user's own chrome. This is an open product decision, report §15.3.
2. Write `?org=` from **the server response's `organizer_slug`**, not just the URL param. The URL slug is "cosmetic, never validated" (`router.tsx` comment, `organizer_slug.py:16-18`).
3. Upgrade to **(b)** only when one of these is wanted: a "back to term" CTA, theming for notification links, or a public product page (A5).
4. Make `ItemEditPage` and `ItemBackButton` preserve `location.search` so the context does not drop on the view → edit → view round trip. This is a small, real need if (a) is adopted.

## A5. Should the product page become public? (privacy)

What a public `/details` + `/history` would expose to anyone holding an item UUID:
- name, description, condition, category, approved photos;
- current status, e.g. "LENT until DD.MM", "RESERVED for term DD.MM" (counterparty labelled "inna rodzina" for anonymous users, since `viewer=None`, `item_privacy.py:55`);
- the full movement history with dates, which reveals a family's exchange and attendance rhythm;
- deleted items (readable with status DELETED).

Item UUIDs are already exposed publicly via PUBLIC-circle term listings (`PublicItemListingResponse.item_id`, `app/groups/schemas.py:264-276`).

Risks:
- Photos of items can incidentally show home interiors or children. Moderation targets NSFW, not PII; see the MEMORY note on Bielik-Guard/NSFW.
- History and due dates reveal when a family is or isn't in possession of goods.
- Items belonging to PRIVATE-circle members would become readable by anyone who obtains a link.
- A related existing gap: any **authenticated** user can already read any item by UUID, without a circle scope (A2).

**Recommendation (Medium):** keep `/product/:id` authenticated for this feature. If a public item view is wanted later, build a **separate, narrow read model** with these rules:
- reachable only as `?term=<id>` for an item currently AVAILABLE-listed on a PUBLIC circle's term (same eligibility as `list_public_term_item_listings`);
- exposes only the fields already public on the term page, plus approved photos and description;
- no history, no status details, no deleted items.

That is option (b) plus a new PUBLIC matrix row ahead of row 40. It is a separate task with a privacy review.

---

# PART B — Paid custom layouts: model, data, lifecycle, build-now vs later

## B1. Market evidence (pricing and models)

| Product | Model | Price | What is gated | Source |
|---|---|---|---|---|
| Shopify Theme Store | **One-time per-store license** per theme, free updates | $140–400; median ≈ $315 | the whole theme | https://help.shopify.com/en/manual/online-store/themes/managing-themes/updating-themes (updates free). Secondary pricing stats: https://shopthemedetector.com/shopify-statistics/theme-pricing, https://tevello.com/blogs/shopify-guides/are-shopify-themes-a-one-time-purchase-understanding-licensing-and-value. Medium-High |
| Linktree | Subscription tiers | Starter $6–8, Pro $12–15, Premium $30–35 /mo | premium themes (lightning badge), colors, fonts, footer removal | https://recurdash.com/subscription-pricing/linktree (secondary); feature list https://linktr.ee/help/en/articles/5434140-an-overview-of-paid-features-available-on-linktree. Medium |
| Carrd | Annual subscription tiers | Pro Lite / Standard / Plus ≈ $9 / $19 / $49 per **year** | Pro templates, domains, forms | https://nocode.mba/articles/carrd-pricing (secondary). Medium |
| Calendly | Subscription per seat | Standard $10–12, Teams $16–20 /user/mo | branding removal; booking-page colors on embed | https://www.zoho.com/bookings/explore/calendly-pricing-plans.html (secondary). Medium |
| Luma | Free plus Luma Plus subscription | $59/mo | fees, send limits, seats. Themes are **free** | https://help.luma.com/p/luma-plus-overview. Medium |
| **Bookero (PL)** booking SaaS | Monthly subscription tiers | Basic 19.90 / Standard 49.90 / Premium 89.90 PLN **net** /mo (+23% VAT); −5% for 6 months, −10% for 12 months; 14-day trial | footer hidden only in Premium | https://www.bookero.pl/cennik. High |
| SimplyBook.me (EU) | Subscription tiers | from €11.90 / ~€25 / ~€50 /mo | — | https://simplybook.me/pricing (via search). Medium |

Patterns (High):
1. Platforms where the user's whole business lives on the page (Linktree, Carrd, Calendly, Bookero) **bundle look-and-feel into a subscription tier**.
2. **Per-item one-time licenses** exist where there is a **marketplace of many third-party designs and high-value stores** (Shopify).
3. Event-first platforms (Luma) give theming away free and charge for operational features.

The prior business-model research (`.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/`) **explicitly excluded payments and billing** (`planning/research-brief.md:37`, `outputs/research-report.md:89`). It contains **no pricing hints**. Gap: High confidence that nothing is there.

**Recommendation (Medium):**
- **One subscription plan** ("Organizator Pro", order of magnitude 19–29 PLN net per month or a yearly equivalent). This anchors below Bookero Standard and is comparable to Linktree Pro/Calendly Standard. It unlocks all premium layouts and probably the "custom color" picker.
- **Not** per-layout one-time purchases. With 5 free layouts plus a handful of premium ones and no third-party designers, a per-item store adds catalog, checkout and refund complexity for little revenue.
- A **bespoke custom layout** is a **service**: a one-off fee, written by us as code in the layout registry and keyed to one organization. Squarespace and Shopify both treat bespoke design as an expert or agency service, not a catalog SKU. It is entitled with `source=service`. Decide whether it requires an active subscription to stay rendered; recommendation: yes. The pricing number is a business decision; no PL benchmark was found (gap).

Polish/EU constraints relevant to the model (Medium; confirm with a lawyer):
- **14-day withdrawal right** for distance contracts (ustawa o prawach konsumenta, art. 27). For digital content and services it is lost only with express consent to immediate performance and acknowledgement of losing the right (art. 38 ust. 1 pkt 13; EU CRD art. 16(m)). Source: https://standardyprawa.pl/akt/51/art/9883, https://cms.law/en/ita/publication/right-of-withdrawal-and-new-obligations-for-businesses-implementation-of-the-omnibus-directive.
- Since **2021-01-01 a sole trader (JDG) buying outside their professional profile has consumer-like protections** (incl. withdrawal). Organizers are often JDG or private persons, so treat them as consumers by default. Source: https://poradnikprzedsiebiorcy.pl/-odstapienie-od-umowy-w-terminie-14-dni-prawo-przedsiebiorcy.
- Prices are shown gross to consumers (23% VAT).
- Payments: **Stripe Billing supports recurring BLIK** (changelog 2026-04-22, PLN only; https://docs.stripe.com/changelog/dahlia/2026-04-22/stripe-billing-blik-recurring-payments). Przelewy24 also offers recurring BLIK (https://www.przelewy24.pl/en/news/what-are-recurring-blik-payments).

## B2. Entitlement data model

Reference: **Stripe Entitlements** maps `Feature.lookup_key` to products and fires `entitlements.active_entitlement_summary.updated` on subscribe, upgrade, downgrade and cancel. Stripe "recommend[s] you persist these entitlements internally for faster resolution" (https://docs.stripe.com/billing/entitlements.md?dashboard-or-api=api). High. So our own table is the source our code reads, regardless of the billing provider.

Proposed (when the first paid item ships, **not now**):

```
organization_entitlements
  id              BIGINT (BaseEntity sequence)   -- per standards/backend/models.md
  organization_id UUID/BIGINT FK organizations.id
  kind            VARCHAR(20)   -- 'LAYOUT' | 'FEATURE'   (string-backed enum, never ordinal)
  key             VARCHAR(64)   -- 'layout:showcase', 'feature:custom_palette', 'layout:custom:<slug>'
                                --   or a plan key 'plan:pro' that the code expands to keys
  source          VARCHAR(20)   -- 'ADMIN' | 'SUBSCRIPTION' | 'PURCHASE' | 'SERVICE'
  valid_from      TIMESTAMP NOT NULL
  valid_to        TIMESTAMP NULL   -- NULL = perpetual (PURCHASE/SERVICE/ADMIN grant)
  external_ref    VARCHAR(255) NULL -- e.g. Stripe subscription id, for reconciliation
  created_at/updated_at
  INDEX (organization_id, key), partial index on valid_to IS NULL OR valid_to > now() not needed at this scale
```

Design notes:
- `valid_from` / `valid_to` mirrors the existing temporal shape of `Leadership` and `Membership` (`app/groups/models.py:139-180`). High.
- Prefer one row per **plan** (`key='plan:pro'`) with a code-side map `PLAN_FEATURES = {"plan:pro": {"layout:showcase", ...}}` over one row per layout. Adding a premium layout to the plan then needs no data backfill. This mirrors Stripe's product↔feature mapping. Medium.
- Free layouts need **no rows**. The `tier` lives in the code registry (`free | premium`).
- Grace periods are expressed by **setting `valid_to = period_end + grace`** when a subscription lapses. No separate state machine is needed. A webhook or admin action only moves `valid_to`.

## B3. Downgrade / grace-period behaviour — what is documented

| Platform | Documented behaviour | Confidence |
|---|---|---|
| Linktree (official) | "Your plan will update at the end of your billing cycle, allowing you to enjoy the paid features until then"; then "you'll lose access to your paid features". What happens to an applied premium theme: **not documented**. https://linktr.ee/help/en/articles/5434081-how-do-i-cancel-my-linktree-plan | High (cycle end) / gap (theme) |
| Carrd | Pro remains active until the current billing period ends. The site stays online and data is preserved; Pro-only capabilities (e.g. new custom domains) stop. https://orbitmoney.io/cancel/carrd (secondary). Official `/docs/pro/features` is silent (fetched). | Medium-Low |
| Squarespace | Plan expiry takes the site **offline** after a short grace (secondary sources cite 15 days after payment due). Content is kept for reactivation (~30 days before deletion). https://www.websitebuilderinsider.com/what-happens-when-squarespace-expires/, https://recurdash.com/guides/how-to-cancel-squarespace. Official article 404 at fetch time. | Low-Medium |
| Shopify themes | Perpetual license; no downgrade concept. Updates keep editor settings, layouts and content (https://help.shopify.com/en/manual/online-store/themes/managing-themes/updating-themes). | High |
| Stripe dunning | Recommended Smart Retries default "8 tries within 2 weeks". Afterwards the subscription can be cancelled, marked unpaid or left past_due. https://docs.stripe.com/billing/revenue-recovery/smart-retries | High |

**Recommended policy (Medium, design judgement; same as report §10, now with evidence):**
1. Cancel means entitled until the end of the paid period (the Linktree and Carrd norm).
2. Failed payment means entitled during dunning (≈ 14 days, matching Stripe's default) via `valid_to = period_end + 14d`.
3. After expiry, the **public page renders the free fallback layout (`CLASSIC`) with the organizer's palette**. Unlike Squarespace, we never take the page offline, because term pages and RSVPs depend on it. The **stored `page_layout` and settings are kept**, so renewing restores the page instantly.
4. The panel shows a banner "Twój układ premium jest nieaktywny". The editor shows the premium layout as selected but locked.
5. A custom palette (if paid) falls back to the nearest curated preset or the default palette, and the stored seed is kept.

## B4. Preview-before-buy

- Shopify: up to 19 paid themes can be tried in the full editor, customizations are kept on purchase, and the theme can't be published until bought (https://help.shopify.com/manual/online-store/themes/adding-themes, cited in `external-saas-platforms.md` §1.4). Carrd: 7-day Pro trial with no card (https://carrd.com/docs/pro/trial). High.
- For us: the editor already needs a **client-side draft** (live preview before "Zapisz", report §9). Preview-before-buy is the same draft with "Zapisz" replaced by "Odblokuj". **No server draft storage is needed.** A time-boxed trial can later be an entitlement row with `source=ADMIN`/`TRIAL` and `valid_to=now+7d`, with no extra mechanism. Medium-High.

## B5. Versioning when organizers have customized a layout

- Shopify separates **code (theme version)** from **values (`settings_data.json`, template JSON)**. Updates overwrite code and keep values. New features that need a newer architecture are not applied to old themes (official updating-themes article). High.
- For us:
  - Layouts are React components in a code registry, so "version" means a deploy.
  - Per-layout settings are tiny (2–4 toggles, report §8). Layout code must **tolerate missing or unknown keys** (defaults on read).
  - For a breaking redesign, **add a new key** (`showcase2`) rather than mutating the meaning of stored settings. This is Shopify's "new architecture is a new theme" approach.
  - A schema-version field is only needed once a stored-settings migration is required. Until then it is speculative (see B6).
- Bespoke custom layouts are code owned by us and pinned per org (`custom:<slug>`), so they change only when we change them.

## B6. Build NOW vs LATER (checked against `.maister/docs/standards/global/minimal-implementation.md`: "No Future Stubs", "No Speculative Abstractions", "Build What You Need")

**NOW.** Each item is needed by the 5 free layouts themselves, or costs the same now as later while avoiding rework:

| Item | Why it is not speculative |
|---|---|
| `organizations.page_layout VARCHAR(32) NOT NULL DEFAULT 'CLASSIC'` validated against a code allowlist (Pydantic `Literal`/StrEnum in schema), **no native DB enum and no CHECK listing the values** | The 5 layouts need storage. A VARCHAR plus a code allowlist means adding `custom:<slug>` or premium keys later needs no ALTER TYPE or constraint migration. Precedent: `groups.layout_mode` uses `native_enum=False` (`app/groups/models.py:108-112`, migration `0035`). |
| A distinct name (`page_layout`, not `layout_mode`) | Avoids a collision with `PublicCircleResponse.layout_mode` (`codebase-backend-current-state.md` §6). |
| FE layout registry `key → component` with unknown-key → `CLASSIC` fallback | Needed to switch between 5 layouts. The one-line fallback also protects against a stale response during a deploy. |
| Content (bio, logo, cover, links) stored **outside** layout settings; layout and palette kept as **orthogonal** fields | Shopify preset rule (`external-saas-patterns-and-proposal.md` §D). Switching layouts must not lose content today, and premium fallback relies on the same property later. |
| The public organization response returns the layout key from **one server-side place** (service → schema) | Today it just echoes the stored value. Later `effective_layout(org)` wraps that single call site, so there is no FE change. |
| `?org=` handling on the product page (Part A) | Needed for the palette requirement. |

**LATER** (with the first paid layout or billing). Building these now would be future stubs:
- `organization_entitlements` table, entitlement service and admin grant UI.
- `tier` in the registry and the "Premium" badge.
- The `GET /api/organizations/layouts` catalog endpoint.
- `effective_layout()` resolver plus the panel banner.
- Locked-save "Odblokuj" CTA in the editor (the draft preview itself is built NOW for the editor).
- Settings `schema_version`.
- A `page_layouts` table for bespoke layouts. May never be needed if bespoke layouts stay as code registry entries `custom:<slug>`.
- Stripe/P24 integration, webhooks, dunning-driven `valid_to`.

Re-confirming report §10: each LATER item is **purely additive** (new table, new registry field, wrapper around one resolver call). None of them requires changing a column type, a URL scheme or stored data written by the NOW design. Medium-High.

## B7. Gaps / uncertainties

- No official documentation from Linktree, Carrd or Squarespace on what happens to an *applied premium theme* after downgrade. The policy in B3 is design judgement. Low-Medium.
- No Polish benchmark for the price of a bespoke page-layout service. No PL organizer tool found that sells layouts separately.
- Pricing figures for Linktree, Carrd, Calendly and Shopify-theme statistics come from secondary aggregators. Bookero comes from the official page.
- Legal points (withdrawal, JDG-as-consumer) are summarized from secondary legal commentary and need confirmation by counsel before a checkout ships.
- The prior business-model research contains no pricing input (payments were out of scope).
