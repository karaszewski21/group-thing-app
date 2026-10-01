# Clarifications (Phase 1)

## Codebase corrections to the original brief
- The family panel route is `/panel/rodzina` ("Mój dom"), not `/panel/rodzic`. The user accepted `/panel/rodzina` and no alias is needed.
- The term-page prompt is an inline banner in `RsvpDialogLoggedIn`. It currently links to bare `/panel`.
- Point 2 ("when adding a child, add me as guardian") is really a display bug. The backend already makes the caller GUARDIAN and primary contact. `GuardianResponse` has no `role_type`, so `RodzinaView` labels every non-self member, children included, as "(opiekun)".

## Q&A
1. **Child age storage:** store the **birth year** and compute age dynamically (answer: "Rok urodzenia"). The field applies only to CHILD members.
2. **Organizer info (point 4):** the user's words were "Proponuję listę w panelu, na termin i może nową stronę szczegółów terminu, tylko dostępną dla organizatora".
   - This means an attendee list in the organizer's panel, per term: who signed up, the child count and the children's ages.
   - It can live on a **new organizer-only term details page**.
   - No notification was requested.
3. **Which children's ages to show:** all CHILD members of the attendee's family, taken from the family profile. The RSVP model stays aggregate `child_count` (no per-child signup).
4. **"Wróć do terminu" button:** the banner links to `/panel/rodzina?returnTo=<term path>`. The button sits at the bottom of the family view and is visible only when `returnTo` is present and valid (a relative path starting with `/`). `returnTo` must be kept through the create-family dialog flow. There is no `/panel/rodzic` alias.
