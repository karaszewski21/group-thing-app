# User-proposed target structure (verbatim from the request)

Request: "migracja fronted na next je. Bez regresji, to mvp, brak produkcji"
(Migrate the frontend to Next.js. No regressions. It is an MVP, there is no production.)

```
src/frontend/
├─ next.config.ts
├─ vite.sdk.config.ts            ← osobny build SDK → public/assets/plugin-sdk.js
├─ public/
│  └─ assets/plugin-sdk.js
└─ src/
   ├─ middleware.ts              ← "/" + cookie → rewrite na /home; ochrona tras panelu i admina
   ├─ app/
   │  ├─ layout.tsx              ← <html>, <Providers>, <PluginHost>
   │  ├─ providers.tsx           ← "use client": QueryClient, Chakra, Auth
   │  ├─ not-found.tsx
   │  ├─ (public)/               ← SSR + generateMetadata, bez logowania
   │  │  ├─ layout.tsx           ← górny pasek publiczny
   │  │  ├─ page.tsx             ← landing (gość)
   │  │  ├─ login/page.tsx
   │  │  └─ [slug]/
   │  │     ├─ layout.tsx        ← pobiera właściciela, paleta jako zmienne CSS, metadane
   │  │     ├─ page.tsx          ← strona główna org (wg page_layout) / profil osoby (UUID)
   │  │     ├─ items/page.tsx    ← lista produktów właściciela
   │  │     ├─ meetings/page.tsx
   │  │     ├─ terms/page.tsx
   │  │     ├─ product/[id]/page.tsx              ← strona produktu (edycja przez ?edit=1)
   │  │     ├─ event/[eventId]/page.tsx
   │  │     └─ group/[groupId]/term/[termId]/page.tsx
   │  ├─ (panel)/                ← "use client", AuthGuard, AppShell + AppDataProvider
   │  │  ├─ layout.tsx           ← trzyma dane panelu między sekcjami
   │  │  ├─ home/page.tsx        ← cel rewrite'u "/" dla zalogowanego
   │  │  ├─ items/ meetings/ wanted/ search/ profile/ account/ settings/
   │  │  ├─ add/{page, product, term, event, hunting}
   │  │  ├─ groups/{page, new, [groupId]/{page, edit}}
   │  │  ├─ places/{page, new, [locationId]/edit}
   │  │  ├─ family/{page, new, edit, members/{new, [familyMembershipId]/edit}}
   │  │  ├─ events/[eventId]/edit
   │  │  ├─ terms/[termId]/{page ← lista uczestników (organizator), edit}
   │  │  └─ messages/{page, [conversationId]}
   │  ├─ (standalone)/           ← zalogowany, bez AppShell
   │  │  ├─ layout.tsx
   │  │  ├─ onboarding/page.tsx
   │  │  ├─ organization/page.tsx   ← kolory + page_layout organizatora
   │  │  └─ oauth2/authorize/page.tsx
   │  └─ admin/                  ← "use client", AuthGuard + rola admin
   │     ├─ layout.tsx           ← Sidebar admina
   │     ├─ page.tsx             ← redirect do products
   │     ├─ products/{page, new, [id]/{page, edit}}
   │     ├─ categories/{page, new, [id]/edit}
   │     ├─ groups/ terms/ photos/
   │     └─ plugins/{page, new, [pluginId]/{detail, edit, [...path] ← pełnoekranowy plugin}}
   ├─ features/                  ← dawne src/pages/*: widoki, hooki, stan
   │  ├─ events/ terms/ items/ meetings/ groups/ places/ family/ messages/
   │  ├─ account/ auth/ landing/ admin/
   │  └─ owner-page/{OwnerPage.tsx, layouts/ (circles, classic, exchange, links, schedule)}
   ├─ components/{layout/ (AppShell, Header, BottomNav, Sidebar, MobileDrawer), shared/}
   ├─ plugins/
   │  ├─ host/ ("use client"): PluginHost.tsx, iframeRegistry.ts, permissions.ts,
   │  │        handlers/{data.ts, fetch.ts, ui.ts, admin-only.ts}
   │  ├─ slots/: PluginSlot.tsx, PluginFrame.tsx, PluginFilterBar.tsx
   │  ├─ extensionPoints.ts, resolveExtensionPoints.ts
   │  └─ server.ts               ← włączone pluginy pobierane na serwerze
   ├─ plugin-sdk/                ← bez zmian (kontrakt z pluginami)
   ├─ api/{client.ts, server.ts (anonimowo albo z ciasteczkiem), queryClient.ts, events.ts, items.ts, …}
   ├─ auth/                      ← AuthContext, AuthGuard, session (ciasteczko)
   ├─ theme/{system.ts (Chakra), palettes.ts (palette_preset → zmienne CSS, SSR)}
   ├─ routing/{paths.ts, reservedSlugs.ts (+ test: zgodność z app/(panel) i backendem)}
   ├─ hooks/  lib/  utils/
   └─ test/
```
