# Phase 1 Clarifications

## TL;DR
Public event page lives only at `/<organizer-slug>/event/<eventId>` (slug cosmetic, UUID as id); the old `/events/:eventId` public route is removed without redirect. Sign-up for logged-in users and guests (Term-style), participants' items read-only, chat as a button opening an EVENT thread in Messages.

## Key Decisions
- Routing: `/<organizer-slug>/event/<eventId>` (cosmetic slug like Term, UUID id) — old `/events/:eventId` page route removed, no redirect (user: "jak rekomendowane ale bez przekierowania ze starego, stary usunąć")
- Sign-up: logged-in (one click) + guests (name → anonymous profile, later attachable to an account) — like Term
- Items: read-only list of participants' (and author's) shared items; click → item page; no take/swap
- Chat: "Czat wydarzenia" button (author + signed-up logged-in users) → thread in Messages; new EVENT conversation kind

## Open Questions / Risks
- Does `/events/:eventId/edit` (author edit route) stay, or move under the slug prefix? Only the public page route was explicitly removed.
- All existing links built with `eventPath()` (EventCard copy-link, post-create navigation) must switch to the slug form — needs organizer slug available in list/create responses.

## Q&A
1. **Routing** — Q: links shape? A: Recommended (slug + id) but no redirect from the old one; remove the old one.
2. **Sign-up** — A: Logged in + guests (Recommended).
3. **Items** — A: Read-only (Recommended).
4. **Chat** — A: Button → thread (Recommended).
