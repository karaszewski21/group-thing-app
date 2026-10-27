# Clarifications (Phase 1)

## TL;DR
Full Vinted category tree (cascading picker, leaf assignment) replaces the flat "Typ" list everywhere, including admin category management. Existing 5 categories/products can be remapped or cleared freely (dev data). "Wersja robocza" = save without listing mode. "Oddam"/"Zamienię" at creation store a pending intent that the backend activates after photo moderation approval.

## Key Decisions
- Tree depth: full Vinted tree, chosen level by level with search; item assigned to a leaf — user choice "Full tree".
- Existing categories: data doesn't matter (dev environment) — migration may clear/remap freely.
- Draft: "Wersja robocza" = item saved without a listing mode (no `item_listing_preferences` row); no new DB column.
- Moderation conflict: backend remembers the chosen mode as pending intent and enables it automatically once photos are approved.
- Picker scope: everywhere — add item, item edit, needed items, term edit, AND admin category management rebuilt for the tree.

## Open Questions / Risks
- Source of Vinted tree data: must be compiled (no data in repo); accuracy vs. live Vinted catalog to be confirmed.
- Uncommitted work reported in AddView.tsx, router.tsx, appHelpers.ts, AppPage.tsx and untracked EventCreateView.tsx — overlap risk.

## Q&A
1. Tree depth? → Full tree (Recommended)
2. Old 5 categories? → Data doesn't matter
3. Meaning of "Wersja robocza"? → Saved without a mode (Recommended)
4. Oddam/Zamienię with photos under moderation? → Remember intent (Recommended)
5. Picker scope? → Everywhere incl. admin
