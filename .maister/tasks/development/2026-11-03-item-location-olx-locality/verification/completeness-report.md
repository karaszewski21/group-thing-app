# Completeness Report: Mandatory item location + OLX-style locality (TERYT)

## TL;DR
- Status: **passed**. Critical 0, warning 0, info 6.
- Plan: all 99 sub-steps and 14 group headers are checked (113 `[x]`, 0 `[ ]`). The spot checks found code for every one of the 14 groups. Group 11b, a follow-up outside the plan, is in the work log.
- Standards: compliant. 19 standards are applicable and all 19 are followed; the 2 frontend standards that don't apply are listed. The only ruff findings in touched files are 7 E501 errors, and all 7 are on lines committed before this task.
- Docs: complete. `architecture.md`, `models.md`, `migrations.md` and `INDEX.md` are updated, and the visual coverage is 7 of 7. One small gap: `spec.md` still says 422 where the code returns 400 (a documented deviation).

## Key Decisions
- **400 instead of 422 is not counted as a gap.** `app/core/errors.py`'s `validation_error_handler` maps request-validation errors to 400 across the whole project. The deviation is in the work log (Group 3 and Group 4 entries) and in the `architecture.md` runbook (line 391: "creates items without `location_id` (400)"). The tests assert 400 (`tests/test_localities.py:113-114`, `tests/test_item_location.py:88,124`).
- **Lint and type findings were checked against git blame.** All 7 E501 findings in touched backend files are on committed lines (`inventory_items.py:171,213`, `repository.py:176,394`, `circulation/router.py:168`, `term_item_listings.py:359,988`). `scripts/`, `app/locations`, the migrations 0078–0080 and the new tests are ruff-clean.
- **Today's baseline replaces the spec's frontend baseline.** The spec says "12 failures" and "typecheck clean". `verification/test-suite-results.md` shows 21 failures and 4 typecheck errors (TS6133 in `ThreadPage.tsx`), and every one of them also fails on clean HEAD. They are not regressions.

## Open Questions / Risks
- The owner still needs to confirm the TERYT/PRG reuse terms (work log, Group 1 and Group 13 entries).
- The implementers suggested several standards (binding `CAST(:x AS text[])` arrays, a role=status overflow line, a `leaving` ref guard, `flushSync` in test stand-ins, exact Vary assertions under GZip, a shared `panelDataMock`). They are collected for the user and not yet added.

---

## 1. Plan Completion

| Metric | Value |
|---|---|
| Checkboxes `[x]` | 113 (14 group headers + 99 steps) |
| Checkboxes `[ ]` | 0 |
| Completion | 100% |
| Status | Complete |

### Code spot checks (by group)
| Group | Evidence |
|---|---|
| 1 Dictionary & seed | `alembic/versions/0078_localities.py`, `0079_seed_localities.py` (`unnest` at :59, `TRUNCATE` downgrade at :133), `alembic/data/localities_pl.csv.gz`, `locality_postal_codes_pl.csv.gz`, `localities_pl.README.md`, `scripts/build_localities.py`, `app/locations/localities.py` (`fold_polish` with an explicit ł/Ł map at :18–23) |
| 2 Schema 0080 | `0080_item_location_locality.py`: `SET LOCAL lock_timeout` (:62, :105), `ck_locations_address_fields` (:78), `ix_inventory_items_location_id` (:93), reverse-order downgrade (:106–132) |
| 3 Search & Locations API | `models.py`: `Locality`, `String(7)` PK, `relationship(lazy="raise")` :113, `label` property :124. `service.py`: `load_location`/`load_locations_by_ids` with `joinedload` + `populate_existing` :33–48. `localities.py:93` `startswith(..., autoescape=True)`, SQL `.limit`. `router.py:72` PUT (PATCH removed). Matrix `^/api/localities$` READ (`authorization_matrix.py:209`). |
| 4 Circulation | `InventoryItem.location_id` FK and partial index (`circulation/models.py:194–235`); `Inventory` no longer has `location_id`; `CreateInventoryItemRequest.location_id: uuid` (schemas :99); explicit null rejected (:124); `ledger.py:195-196` clears for GIFT/SWAP only; `locations_acl.get_owned_location` built on `load_location`; `repository.find_item_live_location_id` :148; `test_inventory_location.py` deleted |
| 5 Privacy/pickup/guard | `ItemLocationResponse {locality, formatted_address, deleted_at}` (`groups/schemas.py:813`); `reservation_context.py:284-285` with the new 409 text; listing guard `term_item_listings.py:204-205` only when `existing is None`; `circulation_bridge.get_item_live_location_id` :240; `ItemDetailsResponse.location_id` owner + live only (`item_details.py:103`); `InventoryItemResponse` has no `location_id`; `set_personalised_cache_headers` still in `groups/router/item_actions.py:29` and `circulation/router.py:201` |
| 6 Helpers | `tests/conftest.py:163 locality_ids`, `:176 create_location`; 27 test files use `create_location(`; `tests/test_location_helpers.py` |
| 7 FE contract | `api/localities.ts`, `hooks/useLocalitySearch.ts` (`LOCALITIES_KEY`, 300 ms), `utils/locationLabel.ts` (`localityDetail`, `localityMapsQuery`, `termPlaceMapsUrl`), `test/fixtures/locations.ts`; `useMyInventoryLocation.ts` and `InventoryLocationCard.tsx` are gone |
| 8 Place form | `LocalityCombobox.tsx` (`aria-controls` only while open :140, `aria-activedescendant` :141, `stopPropagation` :83, overflow line :183, `LOCALITY_PICK_ERROR`); `LocationAddForm` address placeholder "Najpierw wybierz miejscowość" (:293) and its hint (:35); `PlaceCreateView` `replace: true` (:31) and toast (:41); `PlacesView` footer note (:113) |
| 9 Picker | `LocationPicker.tsx` has `required`, `errorText="Wybierz lokalizację"`, `onAddClick`, a `Link replace` (:131) and the empty state with helper (:113, :140); no `addMode` anywhere in `src/` |
| 10 Item create/edit | `AppDataContext` holds `itemDraft`/`itemPhotos`/`itemEdit` (:174–176); `ItemCreateView` uses `item-create-place` and the hint text (:111, :124); `ItemEditForm` has the banner (:120) and `ITEM_LOCATION_HELPER`; `useItemDetail.saveLocation` awaits `ITEM_ACTIONS_KEY` invalidation and reloads my-items (:155–161) |
| 11 Term/stepper/hosts | `termEdit` slice (:181), `firstTermDraft` and `closeStepperForPlace` (:747, :772), `features/terms/termDraft.ts`, `hooks/useFirstTermStepper.ts`; tests `plus_thenSavedPlace_reopens…`, `plus_thenCancel_reopens…`, `close_afterReopen_staysClosed…` |
| 11b (outside the plan) | `ItemEditView.tsx` and `EventEditView.tsx` re-seed fix, with `test/EventEditView.test.tsx` (new). Recorded in the work log at 19:34:20Z. |
| 12 Item page & display | `ItemContextActions.tsx` card: "Lokalizacja przedmiotu" :361, "(usunięte)" :377, Maps :387, "Widoczne tylko dla Ciebie" :420, "Zmień lokalizację" :426, pickup unavailable :429 |
| 13 Docs & removal audit | All docs present (section 3). A re-check found 0 hits in `src/` for `find_personal_inventory_live_location_id`, `SetInventoryLocationRequest`, `GoogleAddressNotEditable`, `inventories/mine/location`, `addMode` and `notes` in the location types. |
| 14 Gap tests | Personal SWAP clear→DRAFT→409→200 in `test_item_location.py`; ssrSafety owner card; cancelled-pick draft test in `ItemCreateView.test.tsx` |

No spot-check issues found.

## 2. Standards Compliance

| Standard | Applies? | Reasoning / evidence |
|---|---|---|
| global/error-handling.md | Yes | Typed `BusinessConflictException`/`EntityNotFoundException` with Polish messages (`term_item_listings.py:205`, `reservation_context.py:285`). Followed. |
| global/validation.md | Yes | Server: `extra=forbid` bodies, `limit` 1–20, explicit null rejected. Client: inline `role="alert"` errors "Wybierz lokalizację" and "Wybierz miejscowość z listy" with `aria-invalid`. Followed. |
| global/conventions.md | Yes | New `scripts/` directory documented; fixture README; docs updated. Followed. |
| global/coding-style.md | Yes | ruff clean on new code; the 7 E501 hits are on committed lines. Followed. |
| global/commenting.md | Yes | Docstrings explain why (`localities.py:17`, `ItemDetailsResponse` comment); no change-log comments seen. Followed. |
| global/minimal-implementation.md | Yes | Inline picker mode, inventory location, dedup and `GoogleAddressNotEditable` removed; no speculative districts or coordinates. Followed. |
| backend/api.md | Yes | Plural `/api/localities`; PUT for full replacement. Followed. |
| backend/models.md | Yes | String-PK carve-out documented; `lazy="raise"` + named loaders; ACL delegation (3 `locations_acl.py`); safe-by-default `location_id` (not in `InventoryItemResponse`). Followed. |
| backend/queries.md | Yes | Bound parameters, `joinedload`, batched `load_locations_by_ids`; the 2-statement search is asserted with `count_queries` (`test_localities.py:13`). Followed. |
| backend/jooq.md | Yes (partly) | Escaped prefix LIKE via `autoescape`, SQL-level LIMIT, explicit ordering. The filter-DSL services themselves are untouched. Followed. |
| backend/migrations.md | Yes | `pk_/fk_/ix_/ck_` names, `lock_timeout` in 0080 (0078 only creates new tables), reverse-order downgrade, round-trip tests restore head, separate schema (0078) and data (0079) revisions. Followed. |
| backend/security.md | Yes | Matrix rows: localities READ, PUT for locations, inventory-location row removed; personalised cache headers kept. Followed. |
| backend/time.md | Yes (checked) | No "now" reads added; audit timestamps unchanged. Followed. |
| backend/plugin-auth.md | No | No plugin or SDK surface touched. |
| frontend/components.md | Yes | Routing facade only (`Link replace`, `useAppNavigate`); drafts in `AppDataContext`; ssrSafety owner-card case added. Followed. |
| frontend/accessibility.md | Yes | Inline combobox rules (Esc closes only the listbox, `aria-controls` only while open, `aria-activedescendant`); `aria-invalid`/`aria-describedby`. Followed. |
| frontend/data-fetching.md | Yes | `useLocalitySearch` with a prefix key; `create`/`update`/`remove` passed as props; awaited invalidation of `ITEM_ACTIONS_KEY`/`ITEM_DETAILS_KEY`. Followed. |
| frontend/css.md | Yes | Existing tokens and classes; danger tokens for the banner (themeTokenUsage test passes). Followed. |
| frontend/responsive.md | No (marginal) | No new layout breakpoints; the existing mobile-first classes are reused. |
| testing/backend-testing.md | Yes | Exact key sets, `create_location`/`locality_ids` called per test, downgrade tests restore head, camelCase test names. Followed. |
| testing/frontend-testing.md | Yes | Typed factories in `test/fixtures/locations.ts` with no casts in the touched tests; `renderWithRoute`/`getTestRouter`. Followed. |

Checked 21, applicable 19, followed 19. No gaps.

## 3. Documentation Completeness

| Artifact | Status | Evidence |
|---|---|---|
| implementation-plan.md | Complete | 113/113 checked; file intact |
| work-log.md | Complete | Dated entries for all 14 groups plus 11b, per-group standards logs, files modified, and a final "Implementation Complete" entry (21:12:45Z). The "Loaded Per Group" placeholder "(Entries added as groups execute)" was left in place (cosmetic; each group's log follows it). |
| Spec alignment | Aligned | Req. 1–37 and Audit H1, H2, M1–M6, L1–L8 are reflected in code or tests (see the section 1 table; H1 test `ItemEditView.test.tsx:254`; M5 stepper tests; L1 `InventoryItemResponse` without `location_id`; L5 autoescape and ł; M2 PUT reload). One gap: the spec text still says 422 in Req. 5, Req. 15, Success Criteria and Testing, while the implementation returns 400 by project convention. |
| architecture.md | Complete | Locations BC rewrite (:142–167), item location, pickup changes (:215–218), 0078–0080 runbook (:391) |
| standards/backend/models.md | Complete | Locality carve-out (:81, :90, :185, :226), loader-backed relationship (:106–108) |
| standards/backend/migrations.md | Complete | Fixture, `unnest` and `TRUNCATE` precedent (:60–67, :94) |
| INDEX.md | Complete | Summaries refreshed for architecture, models and migrations |
| Visual coverage | Complete | `implementation/visual-coverage.md` maps all 7 IDs in `analysis/design-context/INDEX.md` (5 screens + 2 components) to Groups 8–12 |
| User docs | Not required | The spec asks for none |

## Issues

| # | Severity | Source | Location | Description | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | info | documentation | `implementation/spec.md` Req. 5, Req. 15, Success Criteria, Testing Approach | The spec says 422 for validation errors; the code and tests use 400 (project-wide `validation_error_handler`). The deviation is documented in the work log and the architecture runbook, but not in the spec. | true | Add a one-line note under Audit resolutions, or amend the codes |
| 2 | info | plan_completion | `implementation/implementation-plan.md` | Group 11b (the draft re-seed fix in `ItemEditView`/`EventEditView`) is recorded only in the work log, not in the plan. | true | Optionally add an "11b (follow-up)" note to the plan |
| 3 | info | documentation | `implementation/spec.md` Success Criteria / Risks | The baseline says 12 vitest failures and "typecheck clean". The current HEAD baseline is 21 failures and 4 TS6133 errors (`ThreadPage.tsx`), all pre-existing. | true | Update the baseline numbers in the verification summary |
| 4 | info | standards | `app/circulation/application/inventory_items.py:171,213`, `infrastructure/repository.py:176,394`, `circulation/router.py:168`, `groups/application/term_item_listings.py:359,988` | 7 ruff E501 findings in files this task touched, all on lines committed before it (git blame) | true | Leave as is, or clean up in a separate pass |
| 5 | info | documentation | `implementation/work-log.md` "Standards Reading Log / Loaded Per Group" | The placeholder line "(Entries added as groups execute)" was never removed | true | Remove the placeholder |
| 6 | info | standards | work-log notes (Groups 1, 8, 10, 11, 11b, 6) | Standards suggested during implementation are still waiting for user approval (not added, as intended). The TERYT reuse terms still need owner confirmation. | false | Present them to the user; on approval run `/maister:standards-update` |

Issue counts: critical 0, warning 0, info 6.
