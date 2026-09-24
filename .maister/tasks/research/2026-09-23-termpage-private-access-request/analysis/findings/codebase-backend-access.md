# Findings — codebase-backend-access (SQ1 backend, SQ4, SQ5)

Kategoria: `codebase-backend-access`. Źródło: `src/backend/app` (ścieżki poniżej względem `src/backend/app/`, chyba że podano inaczej). Stan kodu: 2026-09-23, commit `995c827`.

> Plik pisany przyrostowo. Sekcje: 1. Stan obecny PRIVATE (SQ1) · 2. Modele i ograniczenia · 3. Autoryzacja (matrix) · 4. Mapa endpointów treści terminu i kontroli PRIVATE (SQ5) · 5. Powiadomienia · 6. Migracje · 7. Testy · 8. Czego brakuje dla prośby o dostęp (SQ4) · 9. Wyścigi/idempotencja · 10. Luki i pewność.

---

## 1. Stan obecny backendu dla PRIVATE (SQ1)

### 1.1 `GET /api/groups/public/{group_id}` — `get_public_circle_view`
- Router: `groups/router/circles.py:112-129` — brak zależności auth, brak `principal` (nawet opcjonalnego). Handler nie ma jak rozpoznać członka.
- Serwis: `groups/application/public_view.py:163-282`. Dla `group.visibility == PRIVATE` (`public_view.py:190-204`) zwraca zredukowaną odpowiedź: `id`, `name`, `organizer_display_name`, `organizer_slug`, `visibility`, `layout_mode`, `next_term=None`, `guardians=[]`. Komentarz (l.191-194): „an anonymous visitor ... gets 'this group is private' context ... nothing about its members or activity leaks”.
- Redukcja jest **bezwarunkowa** — funkcja nie przyjmuje `principal` (sygnatura `public_view.py:163-165`), więc członek i organizator też dostają `next_term=None`.
- Uwaga: przy `PRIVATE` parametr `term_id` jest całkowicie ignorowany (return w l.195 przed walidacją `term_id` w l.207-211) — nieistniejący / obcy `term_id` dla PRIVATE nie daje 404, tylko zredukowaną odpowiedź 200.

### 1.2 `GET /api/groups/public/{group_id}/access` — `get_group_access`
- Router: `groups/router/circles.py:132-143`, `principal: OptionalPrincipal = None` (token opcjonalny, zły token → brak principal, nigdy 401 — docstring l.136-142).
- Serwis: `public_view.py:285-336`.
  - `group_response = await get_public_circle_view(db, group_id, term_id)` (l.302) — czyli `group` w `/access` to **dokładnie ta sama zredukowana odpowiedź** dla PRIVATE, także dla członka/organizatora; docstring l.288-289: „a `PRIVATE` group's reduced shape is unaffected by the caller's `access`”.
  - `get_group(db, group_id)` wywoływane drugi raz (l.303) — `get_public_circle_view` już je pobrało (l.179).
  - `is_organizer = _is_active_organizer(...)` (l.314), `is_member = is_organizer or _is_active_member(...)` (l.315) — organizator jest raportowany jako członek.
  - `is_attending` liczone z `group_response.guardians` (l.316-318) → dla PRIVATE zawsze `False` (guardians=[]), nawet gdy członek ma RSVP.
  - PRIVATE: `can_view_content = is_member or is_organizer`, `can_join = not (is_member or is_organizer)` (l.320-322). Anonim → `can_join=True` (bo `is_member=False`) — flaga nie mówi „musisz się zalogować”, klient sam to rozstrzyga po tokenie.
  - PUBLIC: `can_view_content=True`, `can_join=False` (l.323-325).
- Schemat: `GroupAccessDetails` (`groups/schemas.py:293-306`) i `GroupAccessResponse` (`schemas.py:308-315`) — pola: `is_member`, `is_organizer`, `can_view_content`, `can_join`, `is_attending`. **Brak pola statusu prośby.**

### 1.3 `POST /api/groups/public/{group_id}/join` — `join_private_group` (dziś = natychmiastowe członkostwo)
- Router: `groups/router/circles.py:166-186`, `Depends(require_any())` = „tylko uwierzytelniony” (401 dla anonima, l.177-183), status 201.
- Serwis: `public_view.py:452-506`:
  - 404 gdy grupa nie jest PRIVATE (l.471-472).
  - Profil z principal, brak profilu → `AuthenticationRequiredException` (l.474-477).
  - Jeśli nie `_is_active_member` → `get_or_create_active_group_role(..., MEMBER)` + nowy `Membership(valid_from=today, valid_to=None)` + commit (l.479-489). **Brak jakiejkolwiek akceptacji organizatora — to jest „Dołącz” = natychmiastowy dostęp.**
  - W przeciwnym razie zwraca istniejące członkostwo (l.490-498) — idempotencja aplikacyjna (check-then-insert, bez blokady; patrz §9).
  - Nie sprawdza `_is_active_organizer` — organizator wywołujący `/join` dostanie dodatkowo `Membership` (l.479 sprawdza tylko członkostwo).
  - `guardian_name` jest ignorowane (w odpowiedzi `profile.display_name`, l.503), `child_count` tylko echo, nie jest zapisywane (docstring l.466-469).
- Request: `JoinGroupRequest` (`schemas.py:362`), response `JoinGroupResponse` (`schemas.py:367`).

### 1.4 RSVP dla PRIVATE — `create_rsvp`
- Router: `groups/router/circles.py:146-163`, PUBLIC + `OptionalPrincipal`.
- Serwis: `public_view.py:339-449`. PRIVATE (l.370-381): wymaga konta (`profile.account_user_id is not None`, l.375) i aktywnego organizatora lub członka (l.377-381), inaczej `AccessDeniedException` (403). PUBLIC: anonim tworzy nowy Party/UserProfile/Family (l.417-449).
- Idempotencja: tylko ścieżka zalogowana — istniejący `TermAttendance(term, party)` jest aktualizowany (l.388-398). Uwaga: zapytanie (l.390-393) **nie filtruje `withdrawn_at`** — ponowne RSVP po wycofaniu aktualizuje `child_count`, ale nie zeruje `withdrawn_at` (l.396-398) → wycofany uczestnik pozostaje wycofany mimo 201. (Do potwierdzenia w testach `test_attendance_withdrawal.py`.) Ścieżka anonimowa **nie jest idempotentna** — każdy POST tworzy nowy Party+Profile+Family+Attendance (l.417-440).

### 1.5 Tabela stanu → odpowiedź backendu (PRIVATE)

| Odwiedzający | `GET /public/{id}` | `GET /public/{id}/access` | `POST /join` | `POST /rsvp` |
|---|---|---|---|---|
| Anonim | 200 zredukowane (`public_view.py:190-204`) | `group` zredukowane; `is_member=F, is_organizer=F, can_view_content=F, can_join=T, is_attending=F` (l.320-322) | 401 (`router/circles.py:175`) | 403 (`public_view.py:375-376`) |
| Zalogowany nie-członek | jw. | jw. (`can_join=T`) | 201, tworzy `Membership` natychmiast (l.479-489) | 403 (l.377-381) |
| Członek | jw. — **nadal zredukowane** | `group` zredukowane; `is_member=T, can_view_content=T, can_join=F`, `is_attending=F` zawsze | 201 idempotentnie, zwraca istniejące (l.490-498) | 201 (l.387-415) |
| Organizator | jw. — **nadal zredukowane** | `is_organizer=T, is_member=T, can_view_content=T, can_join=F` | 201, **tworzy zbędne `Membership`** (l.479) | 201 |

Wniosek: `can_view_content=True` nie ma dziś żadnego pokrycia w danych — żaden publiczny endpoint nie zwraca treści terminu PRIVATE, nawet członkowi (pewność: wysoka, 95%).

---

## 2. Modele i ograniczenia bazy (baza pod SQ4)

### 2.1 `Membership` — brak statusu, brak unikalności
- `groups/models.py:149-170`: kolumny `from_role_id`, `to_group_id`, `valid_from`, `valid_to`. Docstring l.150-152: „many simultaneously-active rows per `from_role_id`/`to_group_id` are allowed (no uniqueness constraint, unlike `Leadership`)”.
- Migracja `alembic/versions/0009_party_bc_split.py:228-248` — tylko indeksy nieunikalne `ix_memberships_from_role_id`, `ix_memberships_to_group_id` (l.247-248). Dla porównania `Leadership` ma częściowy unikalny indeks `uq_leaderships_active_group ... WHERE valid_to IS NULL` (0009:220-226).
- „Aktywne członkostwo” = `valid_to IS NULL` w każdym zapytaniu: `repository.py:168-176` (`list_active_memberships_for_group`), `repository.py:193-201` (`list_active_memberships_for_role_ids`); `_is_active_member` (`application/memberships.py:58-63`) opiera się na tym drugim. Uwaga: `end_membership` z przyszłą datą `valid_to` od razu wyłącza członkostwo (brak porównania z dzisiejszą datą).
- Wniosek dla SQ4: dodanie statusu `PENDING` do `Membership` wymagałoby zmiany semantyki „aktywny” w co najmniej 3 zapytaniach repo + `exchange_summary._ordered_group_member_party_ids` + `formalize_group_from_term` (`memberships.py:143-147`) — każde przeoczone miejsce = przeciek dostępu. **Osobna encja prośby jest bezpieczniejsza** (pewność: wysoka).

### 2.2 `SwapProposal` — wzorzec encji ze statusem
- Enum: `SwapProposalStatus` PROPOSED/ACCEPTED/REJECTED (`models.py:55-58`).
- Encja: `models.py:299-336` — `BaseEntity` (id z sekwencji, `created_at`, `updated_at` = `version_id_col`), `proposer_party_id` z FK do `parties` (l.318-322), `status` przez `_enum_column(SwapProposalStatus, 20)` (l.333-335; helper `_enum_column` l.26-33: `native_enum=False`, string-backed).
- Migracja `alembic/versions/0031_swap_proposal.py:55-79`: `status String(20)`, FK, indeks nieunikalny na `proposer_party_id`. **Brak unikalności „jedna aktywna propozycja”** — wzorcem dla częściowego unikalnego indeksu jest `0023_pledges_single_active_claim.py:51-57` (`uq_pledges_active_needed_item ... WHERE status <> 'WITHDRAWN'`) + fail-fast check w serwisie (`application/pledges.py:67-69`).
- Rozstrzyganie: `accept_swap_proposal` / `reject_swap_proposal` (`application/term_item_listings.py:516-621`): check właściciela → `AccessDeniedException` (l.532-533, 592-593), check `status != PROPOSED` → `BusinessConflictException("Ta propozycja została już rozstrzygnięta")` (l.534-535, 594-595), zmiana statusu, powiadomienie przez `notifications_bridge.create_notification` (l.573-578, 613-618), jeden `commit`. Brak `SELECT ... FOR UPDATE`.
- Blokowanie optymistyczne: `BaseEntity.__mapper_args__` `version_id_col=updated_at` (`core/base_model.py:62-67`) — równoległy UPDATE tego samego wiersza da `StaleDataError`, którego **nie obsługuje** żaden handler (`core/errors.py:123-129` rejestruje tylko EntityNotFound/BusinessConflict/IntegrityError/Validation/AccessDenied/ValueError/Exception) → 500 (pewność: średnia-wysoka; nie testowane).

### 2.3 Pozostałe
- `GroupVisibility` docstring (`models.py:74-81`): „new members join exclusively via the group's own join-link (`join_private_group`)” — do aktualizacji przy wprowadzeniu akceptacji.
- `Group.visibility` String(10), `server_default="PUBLIC"` (`models.py:102-106`, migracja `0036_group_visibility.py:35-44`). Zmiana PRIVATE→PUBLIC przez `update_group` jest „intentionally unrestricted” (`application/circles.py:152-163`) — nic nie sprząta członkostw ani (przyszłych) próśb.
- `TermAttendance`: brak unikalności `(term_id, party_id)` — migracja `0014_term_attendances_schema.py:69-70` tylko indeksy nieunikalne; `withdrawn_at` (`models.py:262-264`, migracja 0029).

---

## 3. Autoryzacja — `core/authorization_matrix.py`

| Wiersz (linia) | Metoda + wzorzec | Wymaganie | Uwagi |
|---|---|---|---|
| l.81 | GET `^/api/groups/public/[^/]+$` | PUBLIC | widok publiczny |
| l.88 | GET `^/api/groups/public/[^/]+/access$` | PUBLIC | `/access` |
| l.93 | POST `^/api/groups/public/[^/]+/rsvp$` | PUBLIC | RSVP |
| l.101 | POST `^/api/groups/public/[^/]+/join$` | AUTHENTICATED | musi być przed blanket l.117 (komentarz l.95-100) |
| l.116 (#26) | GET `^/api/groups(/.*)?$` | READ/mcp:read | blanket |
| l.117 (#27) | POST `^/api/groups(/.*)?$` | EDIT/mcp:edit | blanket |
| l.134 (#31) | POST `^/api/memberships(/.*)?$` | EDIT | patrz §4.3 — obejście PRIVATE |
| l.207-208 (#60-61) | POST `^/api/swap-proposals/[^/]+/(accept|reject)$` | EDIT | wzorzec dla approve/reject pod osobnym prefiksem |
| l.214 | `^.*$` dowolna metoda | AUTHENTICATED | catch-all (np. DELETE na `/api/groups/...`) |

- Macierz jest referencją testowalną; egzekucja per-route przez `require_any(...)` (docstring l.1-8). Test `tests/test_circles_router.py:275-279` sprawdza `resolve_requirement("POST", "/api/groups/public/42/join") == "AUTHENTICATED"`.
- Każde konto rejestrowane dostaje `["READ", "EDIT"]` (`users/router.py:30-36`), więc „EDIT” ≈ „dowolny zalogowany użytkownik”.
- Konsekwencje dla nowych endpointów prośby:
  - `POST /api/groups/public/{id}/join-requests` (wnioskujący) — nowy wiersz AUTHENTICATED przed l.117 (analogicznie do l.101), albo zmiana semantyki istniejącego `/join` (wtedy wiersz l.101 bez zmian).
  - `GET /api/groups/{id}/join-requests` (organizator) — pokryte przez l.116 (READ), check organizatora w serwisie (`_require_active_organizer`, `application/circles.py:251-253`).
  - `POST /api/groups/{id}/join-requests/{rid}/approve|reject` — pokryte przez l.117 (EDIT); jeśli pod osobnym prefiksem `/api/group-join-requests/...` — potrzebne nowe wiersze jak #60-61 (bez nich catch-all AUTHENTICATED, l.214).
  - Wycofanie: `POST .../withdraw` (pokryte l.117) prostsze niż `DELETE` (spadłoby do catch-all l.214).

> Uwaga redakcyjna: od tego miejsca numeracja sekcji wg zlecenia kontynuacji (§4 Powiadomienia, §5 Prywatność treści, §6 Idempotencja/wyścigi, §7 Lista zmian, §8 Podsumowanie), nie wg spisu w nagłówku pliku. Odwołania „§4.3” i „§9” w §1–§3 odpowiadają odpowiednio §5.3 i §6 poniżej.

---

## 4. Powiadomienia

### 4.1 Model i kontrakt
- `NotificationKind` (`notifications/models.py:35-55`) — 10 wartości: `PLEDGE_CREATED`, `PLEDGE_WITHDRAWN`, `PLEDGE_ITEM_REGISTERED`, `NEEDED_ITEM_REMOVED`, `TERM_ITEM_LISTING_TAKEN`, `SWAP_PROPOSED`, `SWAP_ACCEPTED`, `SWAP_REJECTED`, `TERM_CONFIRMATION_NEEDED`, `TERM_ALREADY_RESOLVED`. **Nic związanego z dostępem do grupy.**
- `Notification` (`notifications/models.py:58-81`): `party_id` (FK do `parties`), `kind` przez `_enum_column(NotificationKind, 30)` (l.67-69; helper l.24-31: `native_enum=False`), `message` String(500) — w pełni wyrenderowany polski tekst (docstring l.1-8), `link_path` String(255) nullable (l.71-73), `read_at`, `proposal_id` — luźny wskaźnik (bez FK) na `SwapProposal.id`, „populated only for `SWAP_PROPOSED`” (l.75-81).
- Migracja `alembic/versions/0022_notifications_schema.py:55` — `kind` to zwykły `sa.String(length=30)` **bez CHECK constraint** → nowe wartości enuma **nie wymagają migracji** (o ile nazwa ≤ 30 znaków; np. `GROUP_JOIN_REQUESTED` = 20, `GROUP_JOIN_APPROVED` = 19, `GROUP_JOIN_REJECTED` = 19). Pewność: wysoka.
- Frontend: `NotificationKind` to union string (`frontend/src/api/notifications.ts:3-13`) — trzeba dopisać nowe wartości (brak `Record<NotificationKind, …>` wymuszającego wyczerpanie — grep bez trafień, więc kompilator nie wymusi).

### 4.2 Dwie ścieżki produkcji
1. **Synchroniczny most (ACL)** — `groups/infrastructure/notifications_bridge.py:18-34` → `notifications/service.py:30-52` `create_notification`: tylko `db.add(...)`, „no commit/flush” (l.39-43); trwałość razem z trailing `db.commit()` akcji źródłowej — atomowo. Używany przez SwapProposal (`term_item_listings.py:503-510, 573-578, 613-618`), take (`term_item_listings.py:405-410`), `terms.py:203-210` (NEEDED_ITEM_REMOVED, `link_path="/panel"`), `pledge_fulfillment.py:98-105`.
2. **Outbox** — `notifications/outbox_listener.py:27-47` rejestruje handlery na wire-stringi `groups.pledge_claimed`/`groups.pledge_withdrawn`/`groups.term_ended_*`; szablon wiadomości żyje po stronie notifications (docstring l.6-14). Asynchroniczne, luźniej sprzężone.
- Dla prośby o dostęp wystarczy **ścieżka 1 (most)** — jak SwapProposal: to prosty, atomowy efekt jednej komendy, a obecny docstring mostu (`notifications_bridge.py:1-6`) wprost przewiduje, że groups BC sam buduje polski tekst. Outbox byłby nadmiarowy (standard minimal-implementation).

### 4.3 SwapProposal jako szablon (create → approve/reject)
- **Create** (`term_item_listings.py:488-511`): `db.add(proposal)` → `await db.flush()` (l.499, żeby mieć `proposal.id` z sekwencji) → `resolve_organizer_slug` (l.502) → `create_notification(party_id=<odbiorca>, kind=SWAP_PROPOSED, message=f'„{display_name}" proponuje …', link_path=f"/{slug}/grupa/{group_id}/term/{term_id}", proposal_id=proposal.id)` (l.503-510) → `db.commit()` (l.511).
- **Accept/Reject** (`term_item_listings.py:569-579`, `609-619`): zmiana `status` → `create_notification(party_id=proposal.proposer_party_id, kind=SWAP_ACCEPTED|SWAP_REJECTED, message=…)` **bez `link_path`** → `commit`.
- Frontend globalny modal „pending actions” wyprowadza akcje z `kind` + `proposal_id` (`frontend/src/pages/panel/PanelDataContext.tsx:118-134`, `PendingSwapAction` l.128) i woła `acceptSwapProposal`/`rejectSwapProposal` bez nawigacji. Analogiczne „zatwierdź/odrzuć z dzwonka” dla prośby wymagałoby albo nowej kolumny (`join_request_id`), albo **reużycia** `proposal_id` jako ogólnego „action target id” — to drugie łamie jego docstring (`notifications/models.py:75-81`). Minimalny wariant: bez akcji w modalu, tylko `link_path` do miejsca, gdzie organizator zatwierdza.

### 4.4 Jakie rodzaje byłyby potrzebne
| Zdarzenie | Odbiorca (`party_id`) | Kind (propozycja) | `link_path` |
|---|---|---|---|
| Utworzenie prośby | organizator: `get_current_leadership(db, group_id)` (`application/circles.py:227`) → `_group_role_party_id(db, leadership.from_role_id)` (`circles.py:172`) — ten sam łańcuch co `slug_resolver.py:28-31` | `GROUP_JOIN_REQUESTED` | patrz niżej |
| Zatwierdzenie | wnioskujący (`requester_party_id`) | `GROUP_JOIN_APPROVED` | strona terminu (teraz ma dostęp) |
| Odrzucenie | wnioskujący | `GROUP_JOIN_REJECTED` | `None` (jak `SWAP_REJECTED`, l.613-618) |
| Wycofanie przez wnioskującego | — (opcjonalnie nic; minimalnie brak powiadomienia) | — | — |

- **`link_path` — ograniczenie tras frontu**: jedyna trasa per-grupa to `/:organizationSlug/grupa/:groupId/term/:termId` (`frontend/src/router.tsx:122`); **nie istnieje trasa samej grupy** (lista ścieżek `router.tsx:48-132`). Panel ma widoki `home|spotkania|rzeczy|podarki|profil|ustawienia|rodzina` (`frontend/src/pages/panel/PanelPage.tsx:66-72`) — brak widoku zarządzania członkami. Wniosek: albo encja prośby zapamiętuje `term_id`, z którego wysłano prośbę (link `/{slug}/grupa/{gid}/term/{tid}` identycznie jak `term_item_listings.py:508`), albo link do `/panel/spotkania`. `resolve_organizer_slug` (`groups/infrastructure/slug_resolver.py:17-35`) nigdy nie zwraca `None`, więc link zawsze da się zbudować.
- Parser `TERM_LINK_PATH_RE = /\/term\/(\d+)$/` (`PanelDataContext.tsx:151`) zakłada, że link kończy się `/term/<id>` — kolejny argument za linkiem do terminu.
- Pewność §4: wysoka (90%) co do mechaniki; wybór `link_path` to decyzja projektowa.

---

## 5. Prywatność treści terminu (SQ5)

### 5.1 Mapa endpoint → kontrola PRIVATE (dziś)
Legenda: „brak” = serwis nie sprawdza ani `Group.visibility`, ani członkostwa; wymagane jest tylko uprawnienie z macierzy (READ/EDIT = każde zarejestrowane konto, `users/router.py:30-36`, patrz §3).

| Endpoint | Router | Macierz | Kontrola w serwisie | Wynik dla zalogowanego nie-członka grupy PRIVATE |
|---|---|---|---|---|
| `GET /api/groups/public/{id}` | `router/circles.py:112-129` | PUBLIC (l.81) | bezwarunkowa redukcja PRIVATE (`public_view.py:190-204`) | brak treści — ale **członek też nie dostaje** (§1.1) |
| `GET /api/groups/public/{id}/access` | `router/circles.py:132-143` | PUBLIC (l.88) | `group` = ten sam zredukowany widok (`public_view.py:302`) | brak treści |
| `POST /api/groups/public/{id}/rsvp` | `router/circles.py:146-163` | PUBLIC (l.93) | członek/organizator wymagany (`public_view.py:370-381`) | 403 — **jedyna realna bramka PRIVATE po stronie treści** |
| `GET /api/groups/{id}` | `router/circles.py:295-300` | READ (#26, l.116) | brak (`application/circles.py:133` `get_group`) | 200: nazwa, visibility itd. (metadane, bez treści terminu) |
| `GET /api/groups/{id}/memberships` | `router/circles.py:355-361` | READ (#26) | brak | **200: lista członków (przeciek)** |
| `GET /api/groups/{id}/leadership(s)` | `router/circles.py:335-352` | READ (#26) | brak | 200: organizator |
| `GET /api/groups/{id}/exchange-summary`, `.../families/{fid}/exchange-offers` | `router/circles.py:303-332` | READ (#26) | członek lub organizator (`application/exchange_summary.py:79-92`) | 403 — chronione |
| `GET /api/terms?circle_group_id=` / `GET /api/terms/{id}` | `router/terms.py:41-52` | READ (#32, l.139) | brak (`application/terms.py:41-50`) | **200: daty i opisy terminów (przeciek)** |
| `GET /api/needed-items?term_id=` / `/{id}` | `router/terms.py:74-87` | READ (#34, l.142) | brak (`application/terms.py:108-138`) | **200: lista potrzebnych rzeczy (przeciek)** |
| `GET /api/pledges?needed_item_id=` | `router/pledges.py:39-44` | READ (#36, l.144) | brak (`application/pledges.py:95`) | **200 (przeciek)** |
| `POST /api/pledges` (createPledge) | `router/pledges.py:31-36` | EDIT (#37, l.145) | **brak** — tylko istnienie `needed_item` i „nikt inny nie zadeklarował” (`application/pledges.py:63-85`); ani członkostwa, ani RSVP, ani visibility | **201 — nie-członek może zadeklarować przyniesienie rzeczy w grupie PRIVATE (wyciek zapisu)** |
| `GET /api/term-item-listings/browse`, `/mine`, `/mine-as-taker`; `POST .../{id}/take`, `POST .../{id}/propose` | `router/term_item_listings.py:65-105` | READ/EDIT (#55-56, #59) | `_require_term_eligibility` (`application/attendance.py:35-47`): aktywne `TermAttendance` **albo** organizator; użycia `term_item_listings.py:278, 293, 314, 357, 366, 432, 439` | 403 — chronione **pośrednio**: attendance dla PRIVATE da się utworzyć tylko przez `create_rsvp`, które wymaga członkostwa |
| `GET /api/groups/{gid}/terms/{tid}/attendees`, `POST .../formalize` | `router/circles.py:189-223` | EDIT | `_require_active_organizer` (`application/memberships.py:100, 139`) | 403 |

Uwagi:
- Ochrona listings jest oparta na **attendance, nie członkostwie** (`attendance.py:38-41`). Luka: jeśli grupa była PUBLIC, ktoś zrobił RSVP, a organizator przełączył na PRIVATE (`application/circles.py:152-163`, bez sprzątania), ten ktoś zachowuje dostęp do wymiany jako nie-członek. Analogicznie po `end_membership` (`memberships.py:42-55`) pozostaje aktywne `TermAttendance`. Pewność: wysoka (wynika wprost z kodu), nietestowane.
- `list_public_term_item_listings` (`term_item_listings.py:324-346`) nie ma żadnej kontroli (z założenia „anonymous-safe”, docstring l.327-340), ale jest wołane tylko z gałęzi PUBLIC `get_public_circle_view` (`public_view.py:226`, po return PRIVATE w l.195) — OK dziś; po wprowadzeniu widoku członkowskiego gałąź nie-członka musi nadal wychodzić przed l.206.
- Wniosek: dzisiejsza „prywatność” PRIVATE jest egzekwowana tylko na dwóch publicznych endpointach (`/public/{id}`, `/access`), na RSVP i (pośrednio) na wymianie. Uwierzytelnione `/api/terms`, `/api/needed-items`, `/api/pledges`, `/api/groups/{id}/memberships` są otwarte dla każdego zalogowanego, kto zna/zgadnie id (id sekwencyjne z `BaseEntity`). Pewność: wysoka (95%) — każdy wiersz zweryfikowany w routerze i serwisie. **Poza zakresem minimalnej zmiany**, ale warto zgłosić jako osobny dług (priorytet: `POST /api/pledges`).

### 5.2 Co musi się zmienić, żeby zatwierdzony członek widział treść przez `/public/{id}` i `/access`
- Dziś front po zatwierdzeniu (refetch `/access`) dostanie `can_view_content=True`, ale `group.next_term=None`, `guardians=[]` (§1.1–1.2) — więc **sam refetch nie wystarczy**; konieczna zmiana backendu.
- Minimalna zmiana: `get_public_circle_view` (`public_view.py:163-165`) przyjmuje opcjonalne `include_private_content: bool = False`; warunek w `public_view.py:190` zmienia się na `group.visibility == PRIVATE and not include_private_content`. Pełna gałąź (l.206-282) jest już poprawna dla członka (walidacja `term_id`, needed items, pledges, listings, guardians).
- `get_group_access` (`public_view.py:285-336`) liczy już `is_member`/`is_organizer` (l.314-315) — wystarczy **przestawić kolejność**: najpierw rozwiązać profil i role, potem wywołać `get_public_circle_view(..., include_private_content=is_member or is_organizer)`. Efekty uboczne: `is_attending` (l.316-318) zacznie działać dla członków PRIVATE (dziś zawsze `False`), a zbędne drugie `get_group` (l.303) można usunąć; docstring l.288-289 do aktualizacji.
- `GET /api/groups/public/{id}` (`router/circles.py:112-129`) nie ma `principal` — opcje: (a) dodać `OptionalPrincipal` jak w `/access` (l.134) i ten sam warunek; (b) zostawić go zawsze zredukowanym dla PRIVATE i kazać frontowi dla PRIVATE czytać treść wyłącznie z `/access`. (b) jest mniejsza (zero zmian w tym routerze), (a) spójniejsza, jeśli front po akcjach refetchuje `/public/{id}`. Żadna nie wymaga zmian macierzy (wiersze l.81/l.88 zostają PUBLIC; kontrola w serwisie, zgodnie z `standards/backend/security.md`).
- Brak przecieku do nie-członków: flaga pochodzi wyłącznie z `_is_active_organizer`/`_is_active_member` na serwerze, a zły/brakujący token w `OptionalPrincipal` daje `principal=None` (docstring `router/circles.py:136-142`) → gałąź zredukowana. Prośba PENDING/REJECTED **nie** może dawać treści (warunek tylko na członkostwie).
- Semantyka `term_id` dla PRIVATE: dziś ignorowany (§1.1). Po zmianie członek z obcym `term_id` dostanie 404 (l.207-210) — pożądane; nie-członek nadal 200 zredukowane (brak wycieku istnienia terminu).

### 5.3 Weryfikacja: `POST /api/memberships` pozwala dowolnemu zalogowanemu dodać się do dowolnej grupy
- **Potwierdzone.** Router `groups/router/memberships.py:25-33`: `principal: EditPrincipal` (`require_any("EDIT","mcp:edit")`, l.19); macierz `POST ^/api/memberships(/.*)?$` → EDIT (`core/authorization_matrix.py:134`, #31); każde konto ma EDIT (`users/router.py:30-36`).
- Serwis `application/memberships.py:23-39`: pobiera profil wywołującego (l.26), sprawdza tylko istnienie grupy (`get_group`, l.27), tworzy rolę MEMBER i `Membership(to_group_id=data.group_id, valid_from=data.valid_from, valid_to=None)` (l.29-37). **Brak** `_require_active_organizer`, brak sprawdzenia `visibility`, brak kontroli duplikatu. `CreateMembershipRequest` = `{group_id, valid_from}` (`groups/schemas.py:129-131`) — ciało nie wskazuje innej osoby, więc to czyste „dodaj siebie”.
- Skutek: każdy zalogowany może `POST /api/memberships {"group_id": X, "valid_from": "…"}` stać się członkiem grupy PRIVATE X, omijając zarówno dzisiejsze `/join`, jak i przyszłą akceptację; potem `/access` zwróci `is_member=True`, a RSVP (`public_view.py:377-381`) przejdzie.
- Użycie: front ma `createMembership` (`frontend/src/api/groups.ts:153-155`), ale żaden komponent `.tsx` go nie wywołuje (grep `createMembership(` w `*.tsx` bez trafień); testy używają endpointu jako helpera fixture (`backend/tests/test_circles_router.py:60`, `backend/tests/test_exchange_summary.py:78, 313`).
- Rekomendacja (SQ4): wraz z prośbami zamknąć furtkę — usunąć endpoint (przepiąć fixture testów na serwis/insert i usunąć `createMembership` z frontu) albo wymagać `_require_active_organizer` + jawnego `party_id` dodawanego. Bez tego akceptacja jest dekoracyjna. Pewność: wysoka (100%).

---

## 6. Idempotencja i wyścigi

### 6.1 Stan dzisiejszych komend (ścieżki `src/backend/...`)
| Komenda | Ochrona przed duplikatem | Ochrona współbieżna | Ocena |
|---|---|---|---|
| `create_rsvp` (zalogowany) | check-then-insert: `SELECT TermAttendance WHERE term_id, party_id` → update albo insert (`app/groups/application/public_view.py:387-405`) | **brak** — `term_attendances` ma tylko indeksy nieunikalne (`alembic/versions/0014_term_attendances_schema.py:69-70`). Dwa równoległe POST-y → dwa wiersze; kolejny RSVP trafi w `scalar_one_or_none()` (l.395) → `MultipleResultsFound` → 500 (nieobsługiwany w `app/core/errors.py:123-129`) | Idempotentny sekwencyjnie, nie współbieżnie. Dodatkowo: zapytanie nie filtruje `withdrawn_at`, więc ponowne RSVP po wycofaniu nie przywraca obecności (§1.4); brak testu na ten scenariusz (w `tests/test_attendance_withdrawal.py` są tylko `…calledTwice_isIdempotent` l.96 i `…disappearsFromBrowse` l.113). Test sekwencyjnej idempotencji: `tests/test_rsvp.py:164`. |
| `create_rsvp` (anonim) | brak — każdy POST tworzy nowe Party/Profile/Family/Attendance (`public_view.py:417-440`) | — | Nieidempotentny (z założenia; dotyczy tylko PUBLIC). |
| `create_pledge` | fail-fast: `any(status != WITHDRAWN)` → `BusinessConflictException` (`app/groups/application/pledges.py:67-69`) | **tak** — częściowy unikalny indeks `uq_pledges_active_needed_item … WHERE status <> 'WITHDRAWN'` (`alembic/versions/0023_pledges_single_active_claim.py:51-57`); przegrany wyścig → `IntegrityError` → 409 „Data integrity violation” (`app/core/errors.py:82-83, 125`) | **Wzorzec do skopiowania** (check w serwisie dla ładnego komunikatu + indeks w bazie jako ostateczna bramka). |
| `take_item_listing` | check `balance.status != AVAILABLE` → 409 (`app/groups/application/term_item_listings.py:371-373`); w circulation drugi raz (`app/circulation/application/reservations.py:49-61`) | optymistyczna blokada na `InventoryBalance` (dziedziczy `BaseEntity`, `app/circulation/models.py:171`; `version_id_col=updated_at`, `app/core/base_model.py:62-67`): równoległy UPDATE `balance.status = RESERVED` (`reservations.py:83-85`) → drugi dostaje `StaleDataError` → **500** (nieobsłużony, `errors.py:123-129`), nie 409 | Chronione przed podwójnym wzięciem, ale błąd wyścigu wychodzi jako 500. Uwaga: `circulation.create_reservation` robi własny `db.commit()` (`reservations.py:87`) — powiadomienie `TERM_ITEM_LISTING_TAKEN` (`term_item_listings.py:405-412`) commitowane osobno, więc nie jest w pełni atomowe z rezerwacją. |
| `join_private_group` | check-then-insert na `_is_active_member` (`public_view.py:479-498`) | brak — `memberships` bez unikalności (§2.1) | Równoległe kliknięcia „Dołącz” → dwa aktywne `Membership` (nieszkodliwe dla odczytów `any(...)`, ale brudne). |
| `accept/reject_swap_proposal` | `status != PROPOSED` → 409 „już rozstrzygnięta” (`term_item_listings.py:534-535, 594-595`) | optymistyczna blokada na wierszu `swap_proposals` (BaseEntity) → drugi równoległy → 500 `StaleDataError` | Wzorzec rozstrzygania do skopiowania; ten sam problem 500 zamiast 409. |

Pewność §6.1: wysoka dla zachowań z kodu (90%); zachowanie `StaleDataError`→500 wyprowadzone z konfiguracji mapera i listy handlerów, nie potwierdzone testem (średnia-wysoka, 75%).

### 6.2 Wyścigi i przypadki brzegowe dla prośby o dostęp (projekt)
| Scenariusz | Ryzyko | Proponowana obsługa (minimalna, zgodna z istniejącymi wzorcami) |
|---|---|---|
| Podwójna prośba (dwuklik, dwie karty) | dwa PENDING dla tej samej pary (party, group) | Serwis: jeśli istnieje PENDING → zwróć istniejącą (idempotentnie 200/201, jak `join_private_group` l.490-498) zamiast 409 — prościej dla frontu. Baza: częściowy unikalny indeks `(requester_party_id, group_id) WHERE status = 'PENDING'` (wzorzec `0023…:51-57`); przegrany wyścig → `IntegrityError` → 409 (`errors.py:82-83`), front traktuje jak „już wysłano” i refetchuje `/access`. |
| Prośba, gdy już członek / organizator | zbędny rekord | Fail-fast: `_is_active_member` (`application/memberships.py:58-63`) lub `_is_active_organizer` (`application/circles.py:243`) → 409 `BusinessConflictException` (lub no-op). Naprawia też dzisiejszy defekt `/join` dla organizatora (§1.3). |
| Prośba do grupy PUBLIC | bez sensu | 404 jak `join_private_group` (`public_view.py:471-472`) — spójnie. |
| Ponowna prośba po REJECTED / WITHDRAWN | czy blokować? | Indeks obejmuje tylko PENDING, więc nowa prośba jest możliwa. Ewentualny „cooldown” to decyzja produktowa (poza minimum). |
| Wycofanie vs zatwierdzenie jednocześnie | oba czytają PENDING, oba zapisują status | Check `status != PENDING` → 409 „już rozstrzygnięta” (wzorzec `term_item_listings.py:534-535`); wiersz prośby ma `version_id_col` (BaseEntity) → drugi UPDATE dostaje `StaleDataError`. Bez handlera = 500. Opcje: (a) akceptować rzadkie 500 jak dziś w swapach; (b) `SELECT … FOR UPDATE` przy odczycie prośby (`with_for_update()`), co serializuje i daje czyste 409; (c) globalny handler `StaleDataError → 409` w `core/errors.py` (naprawia też take/swap). (c) jest najtańsze i najszersze. |
| Zatwierdzenie, gdy wnioskujący już jest członkiem (np. przez `POST /api/memberships`, §5.3, albo `formalize_group_from_term`) | duplikat `Membership` | W `approve`: jeśli `_is_active_member` → tylko ustaw status APPROVED, nie twórz drugiego `Membership` (idempotentnie). |
| Podwójne zatwierdzenie (dwuklik organizatora) | dwa `Membership` | Check statusu PENDING + blokada wiersza (jw.); drugi → 409. |
| Zatwierdzenie po zmianie grupy na PUBLIC | członkostwo w grupie publicznej — nieszkodliwe | `update_group` nie sprząta niczego (`application/circles.py:152-163`). Minimalnie: pozwolić zatwierdzić (członkostwo i tak nic nie psuje w PUBLIC; `formalize_group_from_term` robi to samo, `memberships.py:125-147`). Alternatywa: przy PRIVATE→PUBLIC oznaczać PENDING jako WITHDRAWN/EXPIRED — więcej kodu, niewymagane. `/access` dla PUBLIC i tak zwraca `can_view_content=True` (`public_view.py:323-325`), więc stan prośby dla PUBLIC można po prostu nie raportować. |
| Zmiana organizatora (nowe `Leadership`) w trakcie PENDING | kto może zatwierdzić? powiadomienie trafiło do starego organizatora | Autoryzacja approve/reject liczona **w momencie akcji** przez `_require_active_organizer(db, group_id, party_id)` (`application/circles.py:251-253`) — nowy organizator widzi i rozstrzyga istniejące prośby, stary traci możliwość. Nie zapisywać `organizer_party_id` na prośbie. Stare powiadomienie u byłego organizatora pozostaje (link doprowadzi do strony bez uprawnień) — akceptowalne. |
| Brak organizatora (`get_current_leadership` → `None`) | komu wysłać powiadomienie? | Pominąć powiadomienie (jak `get_public_circle_view` toleruje `None`, `public_view.py:182-186`); prośba czeka. |
| Członkostwo zakończone (`end_membership`) a stara prośba APPROVED | ponowna prośba | Indeks tylko na PENDING → nowa prośba możliwa. OK. |

Pewność §6.2: to projekt oparty o wzorce z kodu — średnia-wysoka (80%); decyzje (idempotentny create vs 409, cooldown) są produktowe.

---

## 7. Lista zmian backendu (SQ4)

Zasada: standard minimal-implementation — tylko to, co potrzebne do przepływu „zalogowany nie-członek wysyła prośbę → organizator zatwierdza/odrzuca → członek widzi treść w tym samym TermPage”. Ścieżki względem `src/backend/`.

### 7.1 Model danych — osobna encja (nie status na `Membership`)
- Uzasadnienie: §2.1 (dodanie PENDING do `Membership` zmienia semantykę „aktywny” w co najmniej 3 zapytaniach repo; przeoczenie = przeciek dostępu).
- `app/groups/models.py`: nowy enum obok `SwapProposalStatus` (l.55-58):
  `GroupJoinRequestStatus(StrEnum)`: `PENDING`, `APPROVED`, `REJECTED`, `WITHDRAWN`.
- Encja `GroupJoinRequest(BaseEntity)` wg wzorca `SwapProposal` (`models.py:299-336`): `__tablename__ = "group_join_requests"`, `__sequence_name__ = "group_join_request_seq"`; kolumny:
  - `group_id` BigInteger, FK → `groups.id` (ten sam BC, więc FK dozwolony),
  - `requester_party_id` BigInteger, FK → `parties.id` (jak `proposer_party_id`, `models.py:318-322`),
  - `term_id` BigInteger nullable, bez FK lub z FK → `terms.id` — tylko po to, żeby `link_path` powiadomień wskazywał termin, z którego wysłano prośbę (§4.4); można pominąć, jeśli link idzie do `/panel`,
  - `status` przez `_enum_column(GroupJoinRequestStatus, 20)` (helper `models.py:26-33`),
  - `created_at`/`updated_at` z `BaseEntity` (`updated_at` = `version_id_col`, `core/base_model.py:62-67`), więc nie potrzeba osobnego `decided_at`.
- Nie zapisywać `organizer_party_id` (zmiana organizatora, §6.2) ani `guardian_name`/`child_count` (dziś i tak nieużywane w `/join`, §1.3).
- Docstring `GroupVisibility` (`models.py:74-81`) do aktualizacji („join exclusively via join-link” → „via approved join request”).

### 7.2 Migracja
- Ostatnia migracja: `alembic/versions/0036_group_visibility.py` (`revision = "0036"`, `down_revision = "0035"`, l.28-29). **Następna: `0037_group_join_requests.py`, `down_revision = "0036"`.**
- Wzorzec tabeli z sekwencją: `alembic/versions/0031_swap_proposal.py:36-79` (`_create_sequence`, `_sequenced_id`, `_own_sequence`, `pk_…`, `fk_…_parties`, indeks nieunikalny).
- Częściowy unikalny indeks wg `alembic/versions/0023_pledges_single_active_claim.py:51-57`:
  `op.create_index("uq_group_join_requests_pending_requester_group", "group_join_requests", ["requester_party_id", "group_id"], unique=True, postgresql_where=sa.text("status = 'PENDING'"))`.
- Indeks nieunikalny `ix_group_join_requests_group_id` (lista próśb organizatora filtruje po grupie).
- Reversible downgrade (drop index, drop table, drop sequence) — zgodnie z `standards/backend/migrations.md`.
- `NotificationKind`: **bez migracji** (kolumna `String(30)` bez CHECK, `0022_notifications_schema.py:55`; §4.1).

### 7.3 Warstwa aplikacji (`app/groups/application/`, eksport przez fasadę `app/groups/service.py`)
Nowy moduł np. `application/join_requests.py` (albo rozbudowa `public_view.py`, gdzie dziś żyje `join_private_group`, l.452-506):
| Funkcja | Kto | Logika |
|---|---|---|
| `create_join_request(db, principal, group_id, term_id=None)` | zalogowany | 404 gdy grupa nie PRIVATE (jak `public_view.py:471-472`); profil z principal (brak → `AuthenticationRequiredException`, jak l.474-477); jeśli `_is_active_organizer`/`_is_active_member` → 409 lub no-op; jeśli istnieje PENDING → zwróć ją (idempotencja); inaczej insert PENDING, `flush`, powiadomienie `GROUP_JOIN_REQUESTED` do organizatora (jeśli jest), `commit` (wzorzec `term_item_listings.py:488-511`). |
| `withdraw_join_request(db, principal, request_id)` | wnioskujący | właściciel (`requester_party_id == profile.party_id`) inaczej `AccessDeniedException`; `status != PENDING` → `BusinessConflictException`; status WITHDRAWN; bez powiadomienia. |
| `list_pending_join_requests(db, principal, group_id)` | organizator | `_require_active_organizer` (`application/circles.py:251-253`); PENDING z nazwą wyświetlaną wnioskującego (reużyć `repository.list_profile_names_by_party_ids`, użyte w `public_view.py:262`). |
| `approve_join_request(db, principal, request_id)` | organizator | `_require_active_organizer` dla `request.group_id`; `status != PENDING` → 409 „Ta prośba została już rozstrzygnięta” (wzorzec `term_item_listings.py:534-535`); jeśli brak aktywnego członkostwa → `get_or_create_active_group_role(..., MEMBER)` + `Membership(valid_from=today, valid_to=None)` (dokładnie kod `public_view.py:479-489`); status APPROVED; powiadomienie `GROUP_JOIN_APPROVED` z `link_path` do terminu; `commit`. |
| `reject_join_request(db, principal, request_id)` | organizator | jw. bez członkostwa; status REJECTED; `GROUP_JOIN_REJECTED` bez `link_path` (jak `SWAP_REJECTED`, `term_item_listings.py:613-618`). |

- Los istniejącego `join_private_group` (`public_view.py:452-506`) i `POST /api/groups/public/{id}/join`: **usunąć** (lub zamienić jego ciało na `create_join_request`). Aplikacja jest pre-produkcyjna — bez shimów kompatybilności (pamięć projektu: public URL scheme / pre-prod churn). Testy `tests/test_circles_router.py:191-279` i `tests/test_group_privacy.py:216` trzeba przepisać.
- Zamknięcie furtki `POST /api/memberships` (§5.3): usunąć endpoint + `createMembership` z frontu (`frontend/src/api/groups.ts:153-155`, brak wywołań w UI), fixture'y testów (`tests/test_circles_router.py:60`, `tests/test_exchange_summary.py:78, 313`) przepiąć na serwis lub nowy przepływ approve; albo dodać `_require_active_organizer`. Bez tego akceptacja jest do obejścia.
- Treść dla członków (§5.2): `get_public_circle_view(..., include_private_content: bool = False)` + przestawienie `get_group_access` (profil/role przed widokiem).

### 7.4 Endpointy (router `app/groups/router/circles.py` lub nowy `router/join_requests.py` dołączony w `router/__init__.py`, kolejność rejestracji jest istotna — komentarz tamże)
| Metoda + ścieżka | Zależność | Wiersz macierzy |
|---|---|---|
| `POST /api/groups/public/{group_id}/join-requests` (body opcjonalnie `{term_id}`) → 201 `{id, status}` | `Depends(require_any())` (jak `/join`, `router/circles.py:175`) | **nowy** AUTHENTICATED przed blanket #27 (l.117) — jak `/join` (l.101); albo reużycie ścieżki `/join` bez zmian macierzy |
| `POST /api/groups/public/{group_id}/join-requests/{id}/withdraw` | `require_any()` | objęte nowym wierszem, jeśli wzorzec to `^/api/groups/public/[^/]+/join-requests(/.*)?$` |
| `GET /api/groups/{group_id}/join-requests` | `ReadPrincipal` | objęte blanket #26 (l.116); kontrola organizatora w serwisie |
| `POST /api/groups/{group_id}/join-requests/{id}/approve` / `/reject` | `EditPrincipal` | objęte blanket #27 (l.117); kontrola organizatora w serwisie |

- Test macierzy wg `tests/test_circles_router.py:275-279` (`resolve_requirement(...)`).
- Uwaga: każde konto ma READ+EDIT (`users/router.py:30-36`), więc wybór AUTHENTICATED vs EDIT jest praktycznie kosmetyczny; ważne, by nowe ścieżki `/public/...` nie spadły na blanket EDIT/READ niezgodnie z intencją — stąd wiersz przed l.117.

### 7.5 Pole w `/access`
- `GroupAccessDetails` (`app/groups/schemas.py:293-306`): dodać `join_request: JoinRequestSummary | None` gdzie `JoinRequestSummary = {id: int, status: GroupJoinRequestStatus}` — najnowsza prośba wywołującego dla tej grupy (PENDING, albo ostatnia REJECTED, żeby front pokazał „odrzucono”); `None` dla anonima, członka, organizatora i grup PUBLIC.
- `can_join` (`public_view.py:320-322`): dla PRIVATE `not (is_member or is_organizer) and join_request_pending is False` — albo zostawić, a front decyduje po `join_request.status`. Minimalnie: dodać tylko `join_request`, nie ruszać `can_join`.
- Po zatwierdzeniu: refetch `/access` zwraca `is_member=True`, `can_view_content=True` i — po zmianie z §5.2 — pełne `group.next_term`/`guardians`. Bez §5.2 front dostanie `can_view_content=True` bez danych.
- Frontowy typ: `frontend/src/api/…` (poza kategorią; do skoordynowania z `codebase-frontend-private`).

### 7.6 Powiadomienia
- `app/notifications/models.py:46-55`: dodać `GROUP_JOIN_REQUESTED`, `GROUP_JOIN_APPROVED`, `GROUP_JOIN_REJECTED` (≤ 30 znaków — istnieje test-wzorzec `tests/test_swap_proposal_model.py:119-130`), docstring enuma (l.36-44) uzupełnić o odbiorców.
- Frontend: union `NotificationKind` (`frontend/src/api/notifications.ts:3-13`).
- Produkcja przez `groups/infrastructure/notifications_bridge.py` (bez zmian w moście); `link_path` = `/{slug}/grupa/{group_id}/term/{term_id}` (slug z `slug_resolver.py:17-35`) albo `/panel`.
- Bez `proposal_id`/nowej kolumny — akcje „zatwierdź/odrzuć z dzwonka” to rozszerzenie poza minimum (§4.3).

### 7.7 Opcjonalne (poza minimum, zgłosić)
- Handler `StaleDataError → 409` w `app/core/errors.py:123-129` (naprawia 500 w wyścigach: join requests, swapy, take; §6).
- Kontrole PRIVATE dla `/api/terms`, `/api/needed-items`, `/api/pledges` (w tym zapis `POST /api/pledges`), `/api/groups/{id}/memberships` (§5.1).
- Unikalność `Membership` aktywnego per (rola, grupa) — dziś brak (§2.1).

### 7.8 Testy do dodania (`src/backend/tests/`, konwencja nazw `test_action_condition_expected`, gate `uv run pytest` w `src/backend`)
1. `create_join_request`: anonim → 401; grupa PUBLIC → 404; nie-członek → 201 PENDING + powiadomienie organizatora; drugi raz → ta sama prośba (brak duplikatu); członek/organizator → 409/no-op.
2. Indeks: dwa PENDING bezpośrednio w bazie → `IntegrityError` (wzorzec `tests/test_swap_proposal_model.py:98` dla unikalności).
3. `approve`: nie-organizator → 403; organizator → `Membership` utworzone, status APPROVED, powiadomienie `GROUP_JOIN_APPROVED` do wnioskującego; ponowne approve → 409; approve gdy już członek → brak drugiego `Membership`.
4. `reject` → REJECTED + powiadomienie, brak członkostwa; `withdraw` przez obcego → 403, po rozstrzygnięciu → 409.
5. `/access`: `join_request` null/PENDING/REJECTED odpowiednio; po approve `is_member=True`, `can_view_content=True`, **`group.next_term` wypełnione**; nie-członek i PENDING → `next_term is None` (regresja prywatności; rozszerzenie `tests/test_group_access.py:85-120`).
6. RSVP członka po approve → 201 (rozszerzenie `tests/test_group_privacy.py:65-100`).
7. `POST /api/memberships` zamknięty (404/403) — jeśli zdecydowano o zamknięciu.
8. Macierz: `resolve_requirement` dla nowych ścieżek (wzorzec `tests/test_circles_router.py:275-279`).
Plus aktualizacja/usunięcie testów `/join` (`tests/test_circles_router.py:191-279`, `tests/test_group_privacy.py:216`). Standard `standards/testing/backend-testing.md` sugeruje 2–8 testów na funkcję — powyższe mieści się w ~2 grupach po 6–8.

---

## 8. Podsumowanie, pewność, luki

### 8.1 Kluczowe wnioski
1. **Dziś nie ma prośby o dostęp** — `POST /api/groups/public/{id}/join` natychmiast tworzy `Membership` (`public_view.py:479-489`). Pewność 100%.
2. **Członek PRIVATE nie dostaje treści terminu z żadnego publicznego endpointu** — redukcja w `get_public_circle_view` jest bezwarunkowa (`public_view.py:190-204`), `/access` ją reużywa (l.302). Sam refetch `/access` po zatwierdzeniu nie wystarczy; potrzebny parametr `include_private_content` liczony z członkostwa (§5.2). Pewność 95%.
3. **Akceptację da się dziś ominąć** przez `POST /api/memberships` (każdy zalogowany dodaje siebie do dowolnej grupy, `application/memberships.py:23-39`, macierz l.134). Musi zostać zamknięte razem z wprowadzeniem próśb. Pewność 100%.
4. **Prywatność PRIVATE jest egzekwowana wąsko**: `/public/{id}`, `/access`, RSVP, pośrednio wymiana (`_require_term_eligibility` przez attendance). Otwarte dla każdego zalogowanego: `/api/terms`, `/api/needed-items`, `/api/pledges` (także zapis `POST /api/pledges`), `/api/groups/{id}/memberships` (§5.1). Pewność 95%. Poza minimum, ale do zgłoszenia.
5. **Wzorce do reużycia**: encja ze statusem = `SwapProposal` (`models.py:299-336`, migracja 0031); unikalność „jednej aktywnej” = częściowy indeks z 0023 + fail-fast w serwisie (`pledges.py:67-69`); rozstrzyganie = `accept/reject_swap_proposal` (`term_item_listings.py:516-621`); powiadomienia przez `notifications_bridge` bez migracji (kolumna `kind` bez CHECK).
6. **Zakres zmian backendu (minimum)**: 1 enum + 1 encja + migracja `0037` (tabela, sekwencja, częściowy unikalny indeks PENDING); 5 funkcji serwisu (create/withdraw/list/approve/reject); 4–5 endpointów (1 nowy wiersz macierzy AUTHENTICATED, reszta pod blanketami #26/#27); pole `join_request` w `GroupAccessDetails`; 3 nowe `NotificationKind`; zmiana `get_public_circle_view`/`get_group_access`; usunięcie `/join` i `POST /api/memberships`; ~8 testów.

### 8.2 Pewność ogólna
- Stan obecny (§1–§5): wysoka (90–100%), każdy punkt z cytatem z kodu.
- Zachowanie współbieżne (`StaleDataError` → 500, duplikaty `TermAttendance` → `MultipleResultsFound`): średnia-wysoka (75%) — wyprowadzone z kodu, nie potwierdzone testem.
- Projekt zmian (§6.2, §7): średnia-wysoka (80%) — oparty o istniejące wzorce, ale zawiera decyzje produktowe.

### 8.3 Luki / pytania otwarte
- Decyzje produktowe: idempotentne `create` (zwróć istniejącą) vs 409; czy po REJECTED można prosić ponownie (cooldown?); czy wnioskujący może wycofać prośbę (minimum: tak, prosty endpoint); czy organizator zatwierdza w TermPage, w panelu, czy z dzwonka (brak trasy grupy i brak widoku członków w panelu — `router.tsx:48-132`, `PanelPage.tsx:66-72`).
- `link_path` powiadomień: wymaga `term_id` na prośbie albo linku do `/panel` (§4.4).
- Czy `GET /api/groups/public/{id}` ma rozpoznawać członka (opcja a) czy treść dla PRIVATE czytać tylko z `/access` (opcja b) — zależy od frontu (kategoria `codebase-frontend-private`).
- Nieprzetestowane defekty poboczne zauważone przy okazji: ponowne RSVP po wycofaniu nie czyści `withdrawn_at` (`public_view.py:388-398`); `list_attendances_for_term` (`infrastructure/repository.py:318-324`) nie filtruje `withdrawn_at`, więc wycofani mogą trafiać do `guardians` w widoku publicznym (do weryfikacji); organizator wołający `/join` dostaje zbędny `Membership`; `circulation.create_reservation` commituje sam (`reservations.py:87`), przez co powiadomienie o wzięciu nie jest atomowe z rezerwacją.
- Nie sprawdzano: frontowego `useTermAccess`/`JoinPrivateGroupDialog` (inna kategoria), zachowania MCP (`mcp:read`/`mcp:edit`) dla nowych ścieżek.
