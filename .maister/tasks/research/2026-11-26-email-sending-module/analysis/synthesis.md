# Synteza — moduł wysyłki e-maili w aj

## TL;DR
- Kierunek ADR-009 (port `EmailSender`, adapter `httpx`, brak wysyłki w requeście, tylko zweryfikowane adresy, dedupe, podpisany wypis) **potwierdzony**. **Zmieniony** punkt wpięcia: nie handler na istniejących zdarzeniach outboxa, tylko `notifications.service.create_notification(s)` (jedyne miejsce, przez które przechodzi każdy bell) plus osobne kolejkowanie maili auth z `users`/`auth`.
- Kolejka wysyłki powinna być własną tabelą modułu (`email_messages`, unikalny klucz idempotencji) z osobnym jobem wysyłki (backoff, `send_after` dla opóźnień, ciszy nocnej i throttlingu). Dispatcher outboxa ma 5 prób bez backoffu (~5 min) i powtarza wszystkie handlery wpisu, więc nie nadaje się do wywołań HTTP do dostawcy.
- Dostawca: **Mailgun EU**, jeśli przechowywanie danych w UE jest twardym wymogiem. **Resend**, jeśli wystarczy DPA + SCC/DPF. Decyzję o rezydencji danych musi podjąć właściciel.
- Najpierw trzeba zbudować: weryfikację adresu, reset hasła, preferencje i tabelę suppression. Dziś żadna z tych rzeczy nie istnieje. W MVP 3 maile auth i 7 rodzajów bell (cykl rezerwacji, potwierdzenie po terminie, MATCH z throttlingiem).

## Key Decisions
- Punkt wpięcia: `notifications.service` jako choke point — 9 z 13 rodzajów bell zapisuje się synchronicznie, nie przez outbox (`codebase-infra-outbox-notifications` §6).
- Własna kolejka `email_messages` + job wysyłki zamiast handlera na wpisie outboxa — wyjaśnienie w §4, Insight 2.
- Zasada „najpierw bell”: nowy trigger e-mail (zmiana terminu, anulowanie przez drugą stronę) to najpierw nowy `NotificationKind`. Wtedy mail obsługuje się sam, a luka jest też w aplikacji.
- Powiadomienia serwisowe dostają per-kategorię preferencję wyłączania i nagłówki List-Unsubscribe, bez zgody z PKE. Marketing i SUGGESTION/SIMILAR są poza zakresem. To korekta ADR-009, który zakładał opt-in z `email_consent_at`.

## Open Questions / Risks
- Twardy czy miękki wymóg rezydencji danych w UE — od tego zależy wybór dostawcy.
- Domyślne włączenie powiadomień serwisowych: prawnie opt-out wystarczy (pewność średnia, brak wytycznych UODO), ale decyzja produktowa należy do właściciela.
- Bell może trafić do party typu Organization, a ta nie ma e-maila. Reguła rozwiązania odbiorcy nie jest ustalona.
- Brakuje polityki prywatności i regulaminu (Google D14). Informacja z art. 13 RODO musi wskazywać dostawcę jako procesora.

---

## 1. Pytanie badawcze
Jak wdrożyć moduł wysyłki e-maili w aj (FastAPI + Next.js, VPS, docker compose) z użyciem zewnętrznego dostawcy i w jakich momentach aplikacji maile powinny być wysyłane?

## 2. Podsumowanie wykonawcze
Infrastruktura do wpięcia maila jest dojrzała, ale nie tam, gdzie zakładał ADR-009. Outbox (`app/outbox/`) jest generyczny i działa co najmniej raz (at-least-once). Większość bell (9 z 13 rodzajów) powstaje jednak synchronicznie w transakcji requestu, przez `groups/infrastructure/notifications_bridge.py`. Wspólnym punktem dla wszystkich jest `notifications.service`: rekord ma tam odbiorcę (party), gotowy polski tekst ≤500 znaków i `link_path`. To czyni ten serwis naturalnym miejscem, w którym moduł e-mail może dowiedzieć się o każdym powiadomieniu, bez zmian w domenach.

Po stronie odbiorców brakuje podstaw. `user_profiles.email` jest nullable i nieweryfikowany. Członkowie rodziny i goście RSVP nie mają adresu. Jedynym sygnałem weryfikacji jest `user_identities.email_verified` kont Google. Nie ma resetu hasła, zmiany e-maila ani preferencji. Na froncie nie ma widoku ustawień ani linku do polityki prywatności. Pierwsze maile muszą więc być transakcyjne (weryfikacja, reset), a dopiero potem powiadomienia.

Zewnętrznie: przy twardej rezydencji danych w UE najlepiej wypada Mailgun EU (81/100): dane wiadomości, logi i suppression są związane z regionem, webhooki podpisane HMAC, koszt $0/$15/$35 przy 100 dziennie/10k/50k. Przy miękkiej rezydencji wygrywa Resend: idempotency key, webhooki Svix, $20 do 50k. Wymogi deliverability przy tej skali to „wszyscy nadawcy”, ale SPF, DKIM i DMARC z alignmentem na subdomenie warto mieć od początku. Prawnie mail serwisowy nie jest informacją handlową z art. 398 PKE, więc nie wymaga zgody (interpretacja, pewność średnia).

## 3. Analiza krzyżowa źródeł

### 3.1 Ustalenia potwierdzone wieloma źródłami (pewność wysoka)
| Ustalenie | Źródła |
|---|---|
| Dispatcher: 5 prób, brak backoffu, commit po błędzie, powtórzenie wszystkich handlerów wpisu | `codebase-infra-outbox-notifications` §2, `codebase-infra-adr009-fit` §2, docstring `wants/application/bells_due.py:9-11` |
| 13 `NotificationKind`, wszystkie zapisywane przez `create_notification(s)` | `codebase-infra-outbox-notifications` §6, `codebase-triggers-inventory` §1 |
| Brak weryfikacji, resetu, zmiany e-maila i hasła | `codebase-infra-users-config` §2, `codebase-triggers-inventory` TL;DR, `prior-decisions-email-adrs` §2 (D8, D10), `prior-decisions-frontend-surfaces` §2 |
| ADR-009 Phase 1–3 niezbudowane, fałszywe przełączniki usunięte | `prior-decisions-email-adrs` §1, `prior-decisions-frontend-surfaces` §1, `codebase-infra-adr009-fit` |
| `httpx` jest zależnością, Jinja2 nie | `codebase-infra-users-config` §4, `prior-decisions-email-adrs` (ADR-009) |
| One-click unsubscribe tylko dla maili „subscribed/marketing”, transakcyjne zwolnione | `external-practices-deliverability-dns` 1.1/1.2, `external-practices-compliance-engineering` tabela §2 |
| GET musi być bez efektów ubocznych (skanery linków), więc landing page robi POST | `prior-decisions-frontend-surfaces` (ryzyka), `external-practices-deliverability-dns` 4.1, standard security (cookie tylko na GET/HEAD) |
| Brak natywnej idempotencji u Mailgun, więc dedupe musi być w aplikacji | `external-providers-matrix` §2, `external-providers-recommendation`, `external-practices-compliance-engineering` §5 |

### 3.2 Sprzeczności i ich rozstrzygnięcie
1. **ADR-009 („handler na istniejących wire strings, bez zmian domeny”) vs kod.** Tylko 4 rodzaje bell przechodzą przez outbox. Handler obok handlera bell przy błędzie dostawcy dubluje bell (`outbox_listener.py:53-74` nie ma dedupe). **Rozstrzygnięcie:** wpięcie w `notifications.service`, osobny tor maila. Pewność wysoka.
2. **ADR-009 „opt-in default false + `email_consent_at`” vs analiza prawna (6(1)(b)/(f), PKE tylko dla informacji handlowej).** ADR-009 zakładał zgodę, bo dotyczył przypomnień i był konserwatywny. Analiza prawna pokazuje, że zgoda nie jest wymagana dla maili serwisowych, a łączenie jej z rejestracją mogłoby naruszać art. 7(4). **Rozstrzygnięcie:** preferencja per kategoria (wyłączanie), bez zgody PKE. Stan domyślny dla kategorii N to decyzja właściciela. Rekomendacja: włączone po weryfikacji adresu, digesty wyłączone. Pewność średnia.
3. **„Klucz wywiedziony z `JWT_SECRET`” (precedens `aj_google_nonce`) vs ADR-009 `EMAIL_LINK_SIGNING_SECRET`.** Link wypisu żyje w skrzynkach miesiącami. Rotacja `JWT_SECRET` po wycieku zepsułaby wszystkie linki wypisu, a Gmail i Yahoo wymagają, żeby działały. **Rozstrzygnięcie:** osobny sekret (ADR-009). Tokeny weryfikacji i resetu jako losowe, jednorazowe i hashowane w DB (projekt HLD handover), nie JWT. Pewność średnio-wysoka.
4. **Microsoft: data odrzucania niezgodnej poczty.** Microsoft mówi „TBA”, blog Mailgun twierdzi, że już obowiązuje. Dotyczy tylko >5k dziennie, więc nie wpływa na aj. Nierozstrzygnięte, bez znaczenia dla MVP.
5. **Brevo vs Mailgun (80 vs 81 pkt).** Remis w granicach błędu oceny. Rozstrzyga niezweryfikowany cennik Brevo i nierozstrzygnięta teza o amerykańskiej ścieżce transakcyjnej, więc wybrany jest Mailgun.
6. **Kolejność wpięcia: outbox (gatherer infra) vs dwuetapowy send-log (gatherer compliance).** Oba źródła zgodnie chcą odseparowania wywołania HTTP od retry dispatchera. **Synteza:** sam rekord `email_messages` zapisany w transakcji domeny jest transactional outboxem dla maila. Dodatkowy wpis w `outbox_entries` to zbędny trzeci przeskok. Wariant z outboxem zostaje jako dopuszczalna alternatywa (§9.2 raportu). Pewność średnia, bo to ocena projektowa.

### 3.3 Ocena jakości dowodów
- **Wysoka:** kod (cytaty `file:line`), RFC 8058/2369, wytyczne Gmail i Yahoo, dokumentacja Resend, Mailgun, SES i Postmark, tekst art. 398 PKE i uchylenie art. 10 UŚUDE.
- **Średnia:** ceny Scaleway, MailerSend i Mailjet (sprzeczne fragmenty), rezydencja Brevo, przypisanie podstaw prawnych do konkretnych strumieni maili aj, praktyki warm-upu i digestów (źródła vendorów).
- **Niska:** reputacja deliverability (jedyna liczba z 2026 jest z drugiej ręki od konkurenta), nazwy zmiennych środowiskowych Mailpit (niezweryfikowane), ceny Brevo.

## 4. Wzorce i tematy
| Wzorzec | Opis | Dowód | Występowanie | Ocena |
|---|---|---|---|---|
| Port + `set_x()` w lifespanie | Opcjonalny adapter wpinany przy starcie, `None`/fake, gdy brak konfiguracji | `storage/service.py:25-37`, `text_guard.set_classifier`, `embeddings_service.set_embedder` (`main.py:223-233`) | 3 moduły | Dojrzały. Wzór dla `EmailSender` |
| Bramkowanie integracji ustawieniem | Feature wyłączony bez ustawienia (503/brak przycisku), właściwość `*_configured` | `config.py:84-99`, `architecture.md:534` | Google, Spaces | Dojrzały. Wzór dla `EMAIL_ENABLED` |
| Idempotentny `register()` listenera | Sprawdzenie stanu rejestru przed dopisaniem handlera | `notifications/outbox_listener.py:41-50` | 5 listenerów | Dojrzały |
| Savepoint w handlerze | `db.begin_nested()`, żeby retry startował czysto | `bells_due.py:85` | 1 | Dojrzały, ale niewymuszony |
| ACL per kontekst | `infrastructure/<other>_acl.py`, test granic modułów | `tests/test_module_boundaries.py`, `wants/infrastructure/outbox_acl.py` | pages, search, wants, points | Dojrzały. `app/email` powinien dołączyć |
| Job APScheduler + `SKIP LOCKED` + jedna linia logu | Batch, konflikty jako WARNING, inne błędy `logger.exception` | `_run_attendance_close` (`main.py:93-100`), matcher | 4 joby + matcher | Dojrzały. Wzór dla `_run_email_send` |
| Gotowy polski tekst w konsumencie | Bell przechowuje wyrenderowany tekst. Szablony per kanał w konsumencie | `notifications/models.py:3-5`, ADR-004 handover | wszystkie bell | Mail renderuje własny szablon z danych, nie z 500-znakowego tekstu |
| Zwijanie bell | Jeden nieprzeczytany MATCH na want, poprzedni usuwany | `match_notifications.py:162-170` | wants | Mail wymaga własnego throttlingu |
| Luka „cicha zmiana” | Zmiany wpływające na drugą stronę bez bell | `terms.py:249-296`, `events/service.py:228`, `term_item_listings.py:1149-1206` | ~20 zdarzeń | Luka produktowa, nie tylko mailowa |

## 5. Kluczowe wnioski

**Insight 1 — choke point istnieje i jest jeden** (pewność wysoka). Każdy bell przechodzi przez `create_notification` (ORM) albo `create_notifications` (bulk Core insert, zwraca id). Wpięcie wymaga dopisania w obu funkcjach wywołania `email_acl.enqueue_for_notifications(db, ids…)`. Domeny (groups, wants, events) zostają bez zmian. Implikacja: wszystkie 13 rodzajów jest od razu pokryte, a o tym, czy dany rodzaj idzie mailem, decyduje tabela reguł w module e-mail.

**Insight 2 — retry dispatchera nie pasuje do wywołań HTTP** (pewność wysoka dla faktów, średnia dla wniosku). Dispatcher ma 5 prób co ~60 s bez backoffu. Awaria dostawcy dłuższa niż ~5 min oznacza FAILED. Błąd jednego handlera powtarza wszystkie handlery wpisu. `run_forever` nie ma try/except. Własna tabela `email_messages` z `status`, `attempts`, `send_after` i osobnym jobem daje backoff, opóźnienia (czat 10–15 min, cisza nocna 22–07), throttling MATCH 1/dzień/want i późne wiązanie preferencji (wypis w czasie opóźnienia blokuje wysyłkę).

**Insight 3 — „najpierw bell”** (pewność średnio-wysoka). Zdarzenia wysokiej wagi bez bell (zmiana daty lub miejsca terminu, anulowanie transakcji przez drugą stronę) to luki również w aplikacji. Dodanie `NotificationKind` (np. `TERM_RESCHEDULED`, `RESERVATION_CANCELLED` dla anulowania przez drugą stronę) rozwiązuje oba kanały naraz i trzyma jedną ścieżkę dla maila. Jedyne maile bez bell to auth i bezpieczeństwo.

**Insight 4 — dwie populacje adresów plus brak adresu** (pewność wysoka). Konta Google mają adres zweryfikowany przy rejestracji (403 przy niezweryfikowanym). Konta z hasłem mają adres niezweryfikowany. Dzieci, goście RSVP i część opiekunów nie mają adresu. „Brak adresu” lub „niezweryfikowany” oznacza status SKIPPED, nie błąd. Po wdrożeniu konta Google mogłyby od razu dostawać powiadomienia, więc trzeba to ogłosić w aplikacji, a nie mailem masowym (warm-up).

**Insight 5 — reset hasła zamyka zaakceptowane ryzyko** (pewność wysoka). Konto tylko-Google nie ma dziś odzyskiwania (`architecture.md:541`). Reset mailem dla konta z `password_hash IS NULL` jest w praktyce „ustaw pierwsze hasło” (Google D4). Decyzja produktowa: pozwolić czy odpowiadać neutralnie. Odpowiedź API musi być zawsze neutralna, żeby nie zdradzać, czy konto istnieje.

**Insight 6 — prawo: serwis bez zgody, marketing ze zgodą** (pewność średnia). Art. 398 PKE (od 10.11.2024) wymaga zgody tylko na informację handlową. Maile serwisowe opierają się na art. 6(1)(b) RODO. SUGGESTION/SIMILAR i „nowe rzeczy w okolicy” są bliżej marketingu, więc zostają w aplikacji. Szablony nie mogą zawierać bloków promocyjnych.

**Insight 7 — deliverability to głównie DNS i dyscyplina strumieni** (pewność wysoka). Subdomena `mail.<domena>`, DKIM 2048 z `d=` własnej domeny, custom return-path, DMARC `none → quarantine → reject`. List-Unsubscribe tylko na strumieniu powiadomień. Bez trackingu otwarć i kliknięć. Dzienny limit w aplikacji w pierwszych tygodniach.

## 6. Relacje i zależności
```
domena (groups/wants/events) ──► notifications.service.create_notification(s)
                                        │ (ta sama transakcja)
                                        ▼
                     notifications/infrastructure/email_acl.py ─► app.email.service.enqueue_*
                                        │                         INSERT email_messages ON CONFLICT DO NOTHING
users/auth (verify/reset) ─► users/infrastructure/email_acl.py ──┘
                                        ▼
            APScheduler _run_email_send (co 1 min, SKIP LOCKED, send_after <= now)
              ├─ email/infrastructure/users_acl.py: party → profil → email, verified
              ├─ preferencje + email_suppressions + dzienny limit + cisza nocna (clock.local_now)
              ├─ render Jinja2 (html + txt), nagłówki per strumień
              └─ EmailSender (MailgunSender | SmtpSender[dev/Mailpit] | LogSender | Fake[test])
                                        ▼
            dostawca ─► webhook POST /api/email/webhooks/<provider> (HMAC) ─► status + email_suppressions
mail ─► link ─► Next.js /unsubscribe | /verify-email | /reset-password ─► POST backend (PUBLIC)
```
Integracje: `APP_PUBLIC_BASE_URL` (linki bezwzględne, D11), macierz autoryzacji (nowe wiersze PUBLIC POST), reserved slugs na obu stosach, `PROTECTED_PREFIXES` (strony mailowe poza nim), test granic modułów, test zegara.

## 7. Luki i niepewności
- Rozwiązanie odbiorcy dla party Organization (właściciel rzeczy organizacji). Niezweryfikowane.
- Brak wytycznych UODO i UKE dla maili powiadomień. Pismo UKE z 23.09.2025 nieprzeczytane.
- Maile do dzieci i opiekunów: routing przez `is_primary_contact` to propozycja, nie zachowanie kodu.
- Ceny Brevo, Scaleway i MailerSend niepewne. Brak niezależnego benchmarku deliverability 2026.
- Nazwy zmiennych Mailpit niezweryfikowane (padł DNS dokumentacji).
- Nie prześledzono do końca soft-delete rzeczy lub grupy z otwartymi rezerwacjami.
- `WANT_EXPIRING` ignoruje `wants.notifications_enabled`. Trzeba zdecydować, czy mail ma respektować wyciszenie.

## 8. Synteza wg frameworku (mixed)
- **Komponenty (technical):** opisane w §4–6. Nowy moduł `app/email` z: `models.py` (`email_messages`, `email_suppressions`, `email_preferences`, tokeny), `service.py` (enqueue), `sending.py` (job), `templates/`, `senders/`, `router.py` (wypis, webhook), `infrastructure/*_acl.py`.
- **Wymagania (requirements):** jawne (brief) to dostawca, triggery, preferencje, DNS. Niejawne: weryfikacja adresu, reset hasła, polityka prywatności, bazowy URL, retencja logu wysyłek. Ograniczenia: RODO, VPS, jeden operator, sekrety w `.env`.
- **Literatura:** macierz dostawców (§ raport 6), praktyki DNS i nagłówków, prawo PKE/RODO, idempotencja outboxa, digesty.

## 9. Wnioski
**Główne:**
1. Moduł `app/email` wpinany w `notifications.service` i w nowe flow auth, z własną kolejką i jobem wysyłki, za portem `EmailSender` (adapter HTTP przez `httpx`). Pewność wysoka dla wpięcia, średnia dla kształtu kolejki.
2. Dostawca: Mailgun EU (twarda rezydencja) albo Resend (miękka). Pewność średnio-wysoka, zależna od decyzji właściciela.
3. MVP mailowe: weryfikacja, reset, potwierdzenie zmiany hasła oraz 7 rodzajów bell (`TERM_ITEM_LISTING_TAKEN`, `SWAP_PROPOSED`, `SWAP_ACCEPTED`, `SWAP_REJECTED`, `TERM_CONFIRMATION_NEEDED`, `RESERVATION_CANCELLED`, `WANT_MATCH_FOUND` z throttlingiem). Zaraz potem dwa nowe bell (zmiana terminu, anulowanie przez drugą stronę).

**Drugorzędne:** potrzebny purge `outbox_entries` i `email_messages` (90 dni). Dziś brak purge outboxa. Test parytetu reserved slugs już nie przechodzi przez `settings` (naprawi go strona `/settings` z preferencjami). Polityka prywatności to warunek wstępny.

**Rekomendacje:** w raporcie §11.
