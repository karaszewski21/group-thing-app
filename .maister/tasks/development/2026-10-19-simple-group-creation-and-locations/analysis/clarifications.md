# Phase 1 Clarifications

Asked after codebase analysis found contradictions between the brief and the code.

## Q1. `/krag/` fallback vs. `k-<hash>` slugs
**Finding**: backend never returns null `organizer_slug`; groups without an Organization get a derived `k-<blake2s>` slug (`groups/domain/organizer_slug.py`). The slug segment is cosmetic; lookup is by group/term id.
**Decision**: Keep `k-<hash>` slugs. No backend slug change. Frontend keeps the `?? "krag"` guard. Acceptance criterion "link pod /krag/..." is reinterpreted as "public link works without an organization".

## Q2. Group creation endpoint and visibility default
**Finding**: `POST /api/groups/mine` is idempotent and ignores visibility; `POST /api/groups/mine/new` creates a new group and honours visibility. Backend server default PUBLIC is relied on by most backend tests.
**Decision**: The new stepper always calls `/mine/new`. The frontend sends `visibility` explicitly: PRIVATE when the user has no Organization (`organizationSlug === null`), PUBLIC otherwise; user can change it in the form. Backend default stays PUBLIC. `/mine` stays as-is (onboarding wizard still uses it).

## Q3. Notifications
**Finding**: notifications are plain text (message <=500 chars + link_path), no structured term data; adding place details means editing message builders and ~8 exact-text tests.
**Decision**: Skip notifications in this iteration. Location shown on public term page, panel term cards, SpotkaniaView group tiles, AdminTermsPage. Recorded as follow-up.

## Q4. Location module placement, moderation, Google loader
**Decision**: New bounded context `app/locations/` (models, schemas, service, router) mirroring `app/organizations/`; `app/groups` reads it only through `app/groups/infrastructure/locations_acl.py`. Location `name`/`notes` are NOT text-moderated (private to owner). Frontend: hand-written lazy Maps JS loader (`libraries=places`) injected on first user interaction, `@types/google.maps` as devDependency, no runtime npm package. Manual mode when `VITE_GOOGLE_MAPS_API_KEY` is absent.
