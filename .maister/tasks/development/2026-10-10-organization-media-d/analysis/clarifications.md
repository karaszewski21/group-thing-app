# Clarifications — Phase 1 (2026-10-10)

| # | Question | Answer |
|---|---|---|
| 1 | Scope | **Logo + okładka + galeria** (D + D2 gallery block). `og:image` from cover is **out of scope** (later). |
| 2 | Where the owner manages photos | **New "Zdjęcia" tab in the appearance editor sheet** (next to Układ / Kolory, opened by the top settings icon). Photo mutations save immediately — not part of the draft / Zapisz flow. |
| 3 | Migration number vs task C | **D takes 0054**; task C takes the next free number. Update notes in B spec / HLD / workflow summary accordingly. |
| 4 | Gallery limit and new logo/cover behaviour | User answered: **"3 zdjęcia"** → gallery max **3** photos. Behaviour for replacing logo/cover not contradicted → keep recommended default (assumption, confirm in Phase 2/5): last approved logo/cover stays public until the new one is approved; one pending upload per slot; gallery has no duplicates (sha256) and up/down reorder. |

## Carried technical points (to resolve in gap analysis / spec)
- Moderation subject map instead of hard-coded 2-way dispatch (backend + admin FE discriminator).
- Whether to move `app/product/images.py` to a shared module.
- Cleanup of REJECTED / superseded files; takedown vs 1-year immutable cache.
- Reorder verb PATCH (matrix row 50 has no PUT).
