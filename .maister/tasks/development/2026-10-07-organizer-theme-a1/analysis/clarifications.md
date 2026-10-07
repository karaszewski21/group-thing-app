# Clarifications — Phase 1

Scope chosen from research: **A1 Motyw** only (A2, B, C, D, D2, E are separate tasks).

| # | Question | Answer |
|---|---|---|
| 1 | Hardcoded hexes on panel pages (HomeView, RzeczyView, WypozyczoneView, PanelPage, TermAttendeesPage, PanelDataContext) | **Out of scope for A1.** A1 tokenizes only term, product and organizer pages plus components shared with them (PhoneFrame, PanelNav, panelIcons, Avatar stays fixed). |
| 2 | Reserved slugs | Add **both `produkt` and `grupa`** to `RESERVED_SLUGS` (organization with that name gets `-2`). |

Carried over from research (user decisions, not re-asked):
- Product page: nested route `/:slug/produkt/:id[/edit]` in the public frame, login-required, organizer theme on the whole page; `/product/:id` keeps default palette for panel/notification entries.
- Any logged-in user may read any item by id — intended behavior.
- Default palette contrast fixes land in A1 (visual change accepted).
- Avatar palette fixed; platform chrome (account bar, notification bell) neutral; no dark mode; "przynosi" icon ink on teal.
