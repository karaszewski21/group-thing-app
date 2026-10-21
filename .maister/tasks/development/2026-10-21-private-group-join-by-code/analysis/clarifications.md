# Clarifications (Phase 1)

## TL;DR
On GroupDetailsPage, "Kopiuj link z kodem" links to the nearest upcoming term, loaded with `getTerms`. With no upcoming term, only "Kopiuj kod" is shown.
If the lazy code generation hits StaleDataError, the backend rolls back, re-reads the group and returns the code already saved, so the organizer never gets a 409.
The app has no production data: migration 0060 drops the join-request table and the GROUP_JOIN_* notifications without checking for PENDING requests (ADR-006 confirmed).

## Key Decisions
- "Kopiuj link z kodem" on GroupDetailsPage links to the nearest upcoming term from `getTerms(groupId)`, falling back to "Kopiuj kod" only — this settles the research open question.
- Lazy GET join-code catches StaleDataError, rolls back, re-reads the group and returns the stored code — a concurrent first view never shows the organizer an error.
- The join-request mechanism is deleted entirely, with no data migration — confirmed: the app has no production data.

## Q&A
1. **Q:** What should "Kopiuj link z kodem" on GroupDetailsPage point to? **A:** The nearest upcoming term (Recommended option).
2. **Q:** How should the lazy GET handle the optimistic-lock race? **A:** Catch the error, roll back and re-read (Recommended option).
3. **Q:** Does "no production data, drop everything" still hold? **A:** Yes, drop everything.
