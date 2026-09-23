# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|---------------------------|--------|
| screen:krag-grupy-organizer-header | Group 5 (New `KragGrupyPage.tsx` "Dodaj stałych członków" Card) | ✅ |
| component:promote-members-card-collapsed | Group 5 (New `KragGrupyPage.tsx` "Dodaj stałych członków" Card) | ✅ |
| component:promote-members-checklist | Group 5 (New `KragGrupyPage.tsx` "Dodaj stałych członków" Card) | ✅ |
| component:promote-members-states | Group 5 (New `KragGrupyPage.tsx` "Dodaj stałych członków" Card) | ✅ |

## Uncovered Items

All screens covered. Note: `INDEX.md`'s own annotation confirms all four IDs describe a single new UI surface (one `kg-card` section on `KragGrupyPage.tsx`'s organizer view, shown as collapsed / expanded / state-variant mockups) — Group 5 implements that entire surface in one pass, so all four IDs are satisfied by the same task group by design, not by omission.

The logged-out join prompt added in Task Group 6 (`PublicKragGrupyView`'s `PRIVATE`-group card) is a separate, non-mockup-covered UI change required by spec Requirement 12 / Critical Decision 5 — it has no corresponding entry in `INDEX.md` and is intentionally outside this coverage matrix's scope (no binding mockup exists for it).
