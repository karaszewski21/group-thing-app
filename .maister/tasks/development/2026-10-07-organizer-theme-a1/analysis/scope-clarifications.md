# Scope Clarifications — Phase 2 (decision gate)

## Critical
| ID | Decision | Choice |
|---|---|---|
| scope-orphan-organizer-theme | No color UI until A2 → A1 theme dormant for real organizers | **A: accept**, keep A1 scope; verify with API-seeded colors (PATCH /api/organizations/{id}); record as known gap in spec |
| legacy-token-aliases | Legacy Tailwind tokens (mint, mint-soft, lime-soft, sage…) used by panel | **B: keep legacy tokens at today's static values**; switch only in-scope files to new role utilities (bg-primary, text-primary-fg, on-primary…); panel untouched (RzeczyViewCategory.test.tsx:345,475 stay green); verify by grep |

## Important
| ID | Decision | Choice |
|---|---|---|
| backend-org-sourcing | How get_public_circle_view obtains Organization | **A**: inside the existing inline organizer block call organizations_acl.get_own_organization(organizer_party_id) once; derive slug (same fallback hash rules) and theme from it, replacing resolve_organizer_slug call there; no extra query; keep test_public_term.py:315 green; D3 preserved |
| public-route-signal | How item pages know organizer route | **A**: layout route `/:organizationSlug/produkt` (AuthGuard + usePublicOrganization + OrganizerThemeScope + public frame + Outlet); `useItemRoutes()` reads useParams().organizationSlug for base path / back fallback `/${slug}`; split ItemDetailPage/ItemEditPage into frame + content |
| ts-organizer-theme-type | TS type | **Required `organizer_theme: OrganizerTheme \| null`**; update fixtures TermPage.test.tsx:40, termAccess.test.ts:5; term→product link falls back to `/product/${id}` when organizer_slug is null |
| product-theme-loading | Product page while org loads | **Neutral loader** until org query settles (parallel with item fetch); 404 / `k-…` / error → default palette, never an error page |
| public-product-frame | Frame | **Tokenized PhoneFrame without PanelNavBar** |
| palette-preset-field | palette_preset in A1 | **Include, always null** (ADR-007 stable contract) |
| accent-only-org | Org with only accent_color | **Default palette** (theme requires primary_color) — PublicOrganizationPage stops showing lone accent |
| dead-css-cleanup | .kg-stage, .kg-app, kg-modal-overlay | **Delete** dead rules and unused class name |
| edit-page-panel-link | "Moje rzeczy →" on organizer route edit page | **Keep** |

## Resolved without user input (gap analysis)
- Danger color: `#b23b3b` wins; AccountMergeForm.tsx:89 and KragStage --danger change from #B4443A.
- Global `*{box-sizing}` in KragStage removed (Tailwind preflight + Chakra reset cover it).
- PublicOrganizationPage inline --color-mint/--color-lime override and DEFAULT_PRIMARY/ACCENT replaced by OrganizerThemeScope.
- orgPalette accepts upper/lower-case #RRGGBB.
- produkt/grupa in RESERVED_SLUGS affect only new slugs; no migration.

## Ordering constraint
Remove KragStage :root only after all var(--ink|ink-soft|mint|teal|paper|cream) consumers migrate: GroupVisualization (10 sites), PrivateGroupGate:12/169, AccountMergeForm:58/63/77, RequestAccessDialog:107/122/123/133.
