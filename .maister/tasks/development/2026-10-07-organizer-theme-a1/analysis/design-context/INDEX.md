# Design Context Index — A1 „Motyw”

Stabilne identyfikatory ekranów/komponentów dla `Visual References` w planie implementacji.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| nav:product-entry-points | navigation | analysis/design-context/ascii/ui-mockups.md#mapa-nawigacji | Mapa wejść: link przedmiotu na terminie → `/:slug/produkt/:id`; panel/powiadomienia → `/product/:id`; `organizer_slug` null → `/product/:id`; fallbacki „Wróć” |
| screen:term-page-themed | screen | analysis/design-context/ascii/ui-mockups.md#term-page-themed | `PublicTermView` w `OrganizerThemeScope` (TermPage): wizualizacja, znaczniki udostępnia/przynosi, TermCard, potrzebne rzeczy, uczestnicy, linki produktu, TermFooter CTA; porównanie domyślna vs bordo; elementy stałe |
| screen:private-group-gate-themed | screen | analysis/design-context/ascii/ui-mockups.md#private-group-gate-themed | `PrivateGroupGate` z motywem + `RequestAccessDialog` (scrim stały, arkusz w drzewie zakresu) |
| screen:organizer-product-page | screen | analysis/design-context/ascii/ui-mockups.md#organizer-product-page | `/:slug/produkt/:id`: PublicLayout (neutralny) + tokenizowany PhoneFrame bez PanelNavBar, ItemDetailContent z motywem, Edytuj → `/:slug/produkt/:id/edit`, pigułka AVAILABLE primary-soft/primary-fg |
| screen:organizer-product-edit | screen | analysis/design-context/ascii/ui-mockups.md#organizer-product-edit | `/:slug/produkt/:id/edit`: prefiks-świadome „Wróć do podglądu”/„Gotowe”, „Moje rzeczy →” zostaje na `/panel/rzeczy` |
| state:organizer-product-loading | state | analysis/design-context/ascii/ui-mockups.md#organizer-product-loading | Neutralny loader w palecie domyślnej podczas `usePublicOrganization` (równolegle z item); 404/błąd/`k-…` → paleta domyślna; item 404 w motywie; anonim → login z returnTo |
| screen:panel-product-page | screen | analysis/design-context/ascii/ui-mockups.md#panel-product-page | `/product/:id` bez zmian (PhoneFrame + PanelNavBar, paleta domyślna) + tabela różnic vs trasa organizatora |
| screen:public-organization-page | screen | analysis/design-context/ascii/ui-mockups.md#public-organization-page | `PublicOrganizationPage` w `OrganizerThemeScope` (badge accent-soft/accent-fg), loading/404 w palecie domyślnej, migracja na `usePublicOrganization` |
| component:organizer-theme-scope | component | analysis/design-context/ascii/ui-mockups.md#organizer-theme-scope | Element zakresu: 13 zmiennych `--color-*` inline, bez transform/filter/contain |
| component:item-routes | component | analysis/design-context/ascii/ui-mockups.md#item-routes | `useItemRoutes()`: base / editPath / viewPath / backFallback z `useParams().organizationSlug` |
| component:organizer-item-layout | component | analysis/design-context/ascii/ui-mockups.md#organizer-item-layout | Layout route `OrganizerItemPage`: org query → loader lub scope → PhoneFrame → Outlet |
| component:themed-primary-button | component | analysis/design-context/ascii/ui-mockups.md#themed-cta | TermFooter / `.kg-btn-primary` / `PRIMARY_BTN` na `bg-primary text-on-primary` |
| component:exchange-markers | component | analysis/design-context/ascii/ui-mockups.md#brings-marker | Znaczniki awatara i legenda: udostępnia = primary/on-primary; przynosi = teal + ikona ink (stałe) |
| component:item-status-pill | component | analysis/design-context/ascii/ui-mockups.md#available-pill | Pigułki statusu w ItemTimeline: AVAILABLE primary-soft/primary-fg, w toku accent-soft, LENT/DELETED stałe |
| component:org-badge | component | analysis/design-context/ascii/ui-mockups.md#org-badge | Badge „Organizacja” na accent-soft/accent-fg |
