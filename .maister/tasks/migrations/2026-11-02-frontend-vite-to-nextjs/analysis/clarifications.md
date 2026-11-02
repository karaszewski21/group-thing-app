# Phase 1 Clarifications

## TL;DR
Migrate the working tree as is (uncommitted owner/meetings work included). Auth: the backend learns to read the JWT from a cookie (CSRF must be handled). Public pages: server-side `generateMetadata` + organizer palette, views stay `'use client'` with TanStack Query. Scope also covers deploy (Docker/nginx/compose), retiring backend OG injection + SPA catch-all, plugins/port 5173, and standards docs.

## Key Decisions
- Baseline = current working tree, same branch — user chose "Migruj working tree"; the other folder `2026-11-02-vite-to-nextjs-frontend` is not resumed.
- Auth = backend reads cookie (`_extract_token` gains cookie support, CSRF protection required) — user chose "Backend czyta cookie" over a mirror cookie or a BFF.
- SSR depth = metadata + palette on the server, client views — user chose the recommended "Metadata SSR, widoki klienckie".
- Out-of-frontend scope = deploy, backend OG + catch-all removal (+ RESERVED_SLUGS update), plugins/port 5173 kept, standards docs — user selected all four.

## Open Questions / Risks
- Cookie auth on the backend needs a CSRF strategy (SameSite=Lax/Strict + Bearer still accepted; mutating requests with cookie-only auth need a check) and `Vary` adjustments in `cache_headers.py`.
- Plugins' `getToken` contract must still return the JWT (cookie must be readable by JS, or the token stays in localStorage too).
- Next.js version not asked: assume Next 16 (`proxy.ts`) unless the gap analysis finds a blocker; confirm in Phase 3.

## Q&A (verbatim answers)
1. Baseline → "Migruj working tree"
2. Auth → "Backend czyta cookie"
3. SSR scope → "Metadata SSR, widoki klienckie (Recommended)"
4. Outside frontend → "Deploy (Docker/nginx/compose), Backend OG + catch-all, Pluginy i port 5173, Dokumentacja standardów"
