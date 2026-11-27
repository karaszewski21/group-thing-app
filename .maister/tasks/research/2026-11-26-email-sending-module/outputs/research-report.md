# Raport badawczy — moduł wysyłki e-maili w aj

**Typ badania:** mixed (literature + technical + requirements) · **Data:** 2026-11-26 · **Wykonawca:** research-synthesizer (maister) · **Ogólna pewność:** średnio-wysoka

## TL;DR
- Rekomendowany dostawca to **Mailgun z regionem EU** (`api.eu.mailgun.net`), jeśli dane muszą zostać w UE. Kosztuje $0 przy ≤100 maili dziennie, $15 przy 10k i $35 przy 50k miesięcznie. Webhooki są podpisane HMAC, jest API suppression. Alternatywa: **Resend**, jeśli wystarczy DPA z SCC/DPF (dane w USA).
- Moduł `app/email` warto wpiąć w **`notifications.service.create_notification(s)`**, a nie w istniejące zdarzenia outboxa. Do tego osobne kolejkowanie maili auth. Wysyłka idzie z własnej kolejki `email_messages` (unikalny klucz idempotencji) przez job z backoffem, za portem `EmailSender` z adapterem `httpx`. ADR-009 jest potwierdzony co do kierunku, ale zmienia się punkt wpięcia i model zgody.
- W MVP potrzebne są 3 maile transakcyjne, których dziś nie ma: **weryfikacja adresu, reset hasła i „hasło zmienione”**. Do tego 7 rodzajów bell: przejęcie rzeczy, propozycja, akceptacja i odrzucenie wymiany, potwierdzenie po terminie, anulowanie przez usunięcie wydarzenia, MATCH (najwyżej 1 dziennie na want). Zaraz po nich dwa nowe bell: zmiana terminu i anulowanie przez drugą stronę.
- Warunki wstępne: weryfikacja adresu, preferencje per kategoria, tabela suppression, `APP_PUBLIC_BASE_URL`, polityka prywatności, rekordy DNS SPF/DKIM/DMARC na subdomenie `mail.<domena>`.

## Key Decisions
- Dostawca: Mailgun EU, a przy miękkiej rezydencji Resend — Mailgun ma najwyższy wynik ważony (81/100), a dane wiadomości, logi i suppression są w regionie EU. Resend wygrywa DX-em (24 h `Idempotency-Key`, Svix), ale przechowuje metadane w USA.
- Punkt wpięcia: `notifications.service` (jedyny wspólny punkt wszystkich 13 rodzajów bell), plus ACL-e z `users`/`auth` dla maili bez bell — 9 z 13 rodzajów bell nie przechodzi przez outbox, więc handler na istniejących zdarzeniach (ADR-009) pominąłby większość.
- Własna kolejka `email_messages` + job `_run_email_send` zamiast handlera na wpisie `outbox_entries` — dispatcher ma 5 prób bez backoffu (~5 min do FAILED) i przy błędzie jednego handlera powtarza wszystkie, więc zdublowałby bell. Kolejka daje też opóźnienia, ciszę nocną i throttling.
- Zasada „najpierw bell”: każdy mail-powiadomienie ma swój `NotificationKind`. Nowe triggery (zmiana terminu, anulowanie przez drugą stronę) zaczynają się od nowego bell — jedna ścieżka, a luka znika też w aplikacji.
- Mail serwisowy bez zgody z PKE, z preferencją per kategoria i nagłówkami List-Unsubscribe — art. 398 PKE dotyczy tylko informacji handlowej, a podstawą jest art. 6(1)(b) RODO. To korekta „opt-in + `email_consent_at`” z ADR-009 (pewność średnia).
- HTTP API przez `httpx` bez SDK dostawcy, szablony Jinja2 (nowa zależność) w repo, nie u dostawcy — minimalne zależności, testowalność, polskie teksty pod code review, wymiana dostawcy to jeden adapter.
- Tokeny weryfikacji i resetu losowe, jednorazowe, hashowane w DB. Link wypisu podpisany osobnym `EMAIL_LINK_SIGNING_SECRET` — rotacja `JWT_SECRET` nie może psuć linków wypisu w starych mailach.

## Open Questions / Risks
- **Decyzja właściciela:** czy rezydencja danych w UE jest twarda (Mailgun EU, ewentualnie Brevo lub Scaleway przy wymogu dostawcy z UE), czy wystarczy DPA z SCC (Resend)?
- **Decyzja właściciela/prawnika:** domyślne włączenie kategorii powiadomień po weryfikacji adresu (rekomendacja) czy opt-in. Brak wytycznych UODO dla maili powiadomień, więc podstawa 6(1)(b) ma pewność średnią. Mail z MATCH to szara strefa. SUGGESTION/SIMILAR zostają tylko w aplikacji.
- Brak polityki prywatności i regulaminu (Google D14). Informacja z art. 13 RODO musi wskazać dostawcę jako procesora, a przy Resend także transfer do USA.
- Bell może trafić do party typu Organization, a ta nie ma adresu. Reguła wyboru odbiorcy jest nieustalona. Na razie pomijamy (SKIPPED).
- Reset hasła dla konta tylko-Google (`password_hash IS NULL`) to w praktyce „ustaw pierwsze hasło” (D4). Trzeba zdecydować produktowo.
- Darmowy plan Mailgun ma limit 100 dziennie. Większa grupa może go przekroczyć, wtedy trzeba przejść na Basic ($15). Na Mailgun możliwe są duplikaty przy awarii między 2xx a commitem (brak natywnej idempotencji).
- Ceny Brevo, Scaleway i MailerSend są niezweryfikowane lub sprzeczne. Brak niezależnego benchmarku deliverability z 2026 r. Przed startem trzeba zrobić test seed.

---

## Spis treści
1. [Podsumowanie wykonawcze](#1-podsumowanie-wykonawcze)
2. [Cele badania](#2-cele-badania)
3. [Metodologia](#3-metodologia)
4. [Ustalenia](#4-ustalenia)
5. [Rekomendacja dostawcy](#5-rekomendacja-dostawcy)
6. [Szkic modułu i integracji](#6-szkic-modułu-i-integracji)
7. [Tabela triggerów](#7-tabela-triggerów)
8. [Warunki wstępne](#8-warunki-wstępne)
9. [Preferencje i wypis](#9-preferencje-i-wypis)
10. [Checklista DNS i deliverability](#10-checklista-dns-i-deliverability)
11. [Rekomendacje i etapy](#11-rekomendacje-i-etapy)
12. [Analiza: wzorce, wnioski, SWOT](#12-analiza-wzorce-wnioski-swot)
13. [Wnioski i odpowiedź na pytanie](#13-wnioski-i-odpowiedź-na-pytanie)
14. [Załączniki](#14-załączniki)

---

## 1. Podsumowanie wykonawcze

**Co zbadano.** Jak dodać do aj (FastAPI + Next.js, docker compose na VPS) wysyłkę e-maili przez zewnętrznego dostawcę i które zdarzenia aplikacji powinny generować maile.

**Jak.** Pięć równoległych kierunków: (1) infrastruktura dostarczania w kodzie, czyli outbox, notifications, scheduler, config i użytkownicy; (2) inwentarz triggerów we wszystkich kontekstach; (3) macierz 11 dostawców; (4) praktyki deliverability, DNS, prawo PKE/RODO i inżynieria (idempotencja, szablony, digesty); (5) wcześniejsze decyzje (ADR-009, research Google) i powierzchnie frontendu. Kod czytano celowo z cytatami `file:line`, źródła zewnętrzne to oficjalne strony z datą dostępu 2026-11-26.

**Główne ustalenia.**
- Infrastruktura jest gotowa do wpięcia: outbox at-least-once, wzorzec portu `set_x()` w lifespanie, joby APScheduler, ACL-e z testem granic. Jedynym miejscem, przez które przechodzi każdy bell, jest jednak `notifications.service`, a nie outbox.
- Dispatcher outboxa nie nadaje się do wywołań HTTP do dostawcy: 5 prób co ~60 s bez backoffu, commit po błędzie i ponowne wywołanie wszystkich handlerów wpisu.
- Nie ma weryfikacji adresu, resetu hasła, zmiany e-maila ani preferencji. Adres jest nullable. Konta Google są jedyną populacją ze zweryfikowanym adresem.
- 13 rodzajów bell plus około 20 „cichych” zmian stanu bez bell. Część z nich (zmiana daty terminu, anulowanie transakcji przez drugą stronę) to luki ważne także w aplikacji.
- Przy twardej rezydencji w UE najlepiej wypada Mailgun EU. Przy miękkiej Resend.

**Wnioski.** Moduł da się zbudować bez zmian w domenach dla istniejących bell. Najpierw jednak trzeba zbudować flow auth (weryfikacja, reset), od których zależy cała reszta. Realny pierwszy etap to „maile konta”, drugi „powiadomienia o rezerwacjach”.

## 2. Cele badania

**Pytanie główne:** Jak wdrożyć moduł wysyłki e-maili w aj z użyciem zewnętrznego dostawcy i w jakich momentach aplikacji maile powinny być wysyłane?

**Pytania szczegółowe:**
1. Który dostawca (EU/RODO + DPA, cena, deliverability, API, webhooki, idempotencja)?
2. Jak wpiąć wysyłkę w outbox, notifications, joby, ACL-e, config i testy?
3. Które zdarzenia generują mail i jakiego typu (transakcyjny, powiadomienie, digest)?
4. Preferencje i wypis (RFC 8058/2369), szablony PL, daty Europe/Warsaw.
5. SPF/DKIM/DMARC, subdomena, warm-up, bounce i suppression.

**Zakres:** porównanie dostawców, wzorzec integracji, inwentarz triggerów, preferencje, szablony, DNS, bounce. **Poza zakresem:** implementacja, marketing i newslettery, SMS i push.

## 3. Metodologia

| Element | Opis |
|---|---|
| Typ | Mixed: technical (komponenty, przepływy), requirements (inwentarz zdarzeń → klasyfikacja), literature (macierz ważona) |
| Źródła kodu | `app/outbox/*`, `app/notifications/*`, `app/main.py`, `app/config.py`, `app/users/*`, `app/auth/*`, `app/families/*`, `app/groups/application/*`, `app/events/*`, `app/wants/*`, `src/matcher/*`, `app/messaging/*`, `app/points/*`, `app/moderation/*`, `docker-compose.yml`, `.env.example` (tylko nazwy), testy, frontend `features/account`, `features/auth`, `routing/*`, `proxy.ts`. Ponad 100 odwołań `file:line` |
| Źródła zewnętrzne | Ponad 90 unikalnych URL-i: cenniki i dokumentacja 11 dostawców, RFC 8058/2369/7489/9989/3463, wytyczne Gmail, Yahoo i Microsoft, PKE i UŚUDE (ISAP/Sejm), RODO (EUR-Lex), Jinja2, MJML, Python `email.policy`, Mailpit |
| Wcześniejsze decyzje | ADR-004/009/010 (handover, 2026-10-13), ADR-002/004/005 i lista D1–D14 (Google login, 2026-11-25), `architecture.md` |
| Framework | Macierz ważona dostawców (rezydencja 30, ops 20, webhooki i suppression 15, cena 15, API i idempotencja 10, deliverability 10), klasyfikacja T/P/D/X triggerów, analiza claim-by-claim ADR-009 |
| Pliki ustaleń | 10 plików w `analysis/findings/` |

## 4. Ustalenia

### F1. Outbox: at-least-once, retry per wpis, brak backoffu — kategoria: infrastruktura · pewność: **wysoka**
`outbox/dispatcher.py:20, 44-88`: `MAX_ATTEMPTS = 5`, claim `FOR UPDATE SKIP LOCKED`, batch 50, poll co 60 s (`scheduler.py:16`). Brak `next_attempt_at`, więc wpis trafia do FAILED po ~5 min. Handlery wpisu działają w jednym `try`. Błąd zwiększa `attempts` całego wpisu, a retry uruchamia **wszystkie** handlery od nowa. `db.commit()` jest wywoływane także po błędzie (bez rollbacku). Potwierdza to docstring `wants/application/bells_due.py:9-11`, który dlatego używa `begin_nested()`. `run_forever` nie ma try/except (`scheduler.py:28-36`). Brak purge `outbox_entries`.
**Implikacja:** handler mailowy obok handlera bell dublowałby bell przy każdym błędzie dostawcy. Awaria dostawcy >5 min = utracone maile.

### F2. `notifications.service` to jedyny wspólny punkt wszystkich bell — infrastruktura · **wysoka**
13 rodzajów `NotificationKind` (`notifications/models.py:37-65`) zapisuje się przez `create_notification` (ORM, `service.py:48-74`) albo `create_notifications` (bulk Core insert zwracający id, `:77-104`). Przez outbox idą tylko pledge ×2, `TERM_CONFIRMATION_NEEDED` i wants ×2. Pozostałe są synchroniczne (`term_item_listings.py:699…1116`, `terms.py:449`, `event_reservations.py:127`). Odbiorcą jest **party**, a nie adres e-mail. Tekst to gotowy polski komunikat ≤500 znaków z `link_path` względnym.
**Implikacja:** hook w obu funkcjach pokrywa wszystko bez zmian w domenach.

### F3. Brak flow konta i weryfikacji — użytkownicy · **wysoka**
`user_profiles.email` jest nullable (`users/models.py:62`), unikalny po `lower(email)` (migracja 0016) i nie ma flagi weryfikacji. Jedyny sygnał weryfikacji to `user_identities.email_verified` (konta Google, 403 przy niezweryfikowanym, `auth/service.py:127-128`). Nie ma resetu, zapomnianego hasła, zmiany hasła, zmiany e-maila ani weryfikacji (grep). Formularz rejestracji ma tylko e-mail i hasło, bez zgody i linku do polityki (`RegisterForm.tsx:7-30`). Logowanie nie ma linku „Nie pamiętasz hasła?”. Konto tylko-Google nie ma odzyskiwania (`architecture.md:541`).

### F4. Odbiorcy bez adresu — użytkownicy, rodziny · **wysoka**
Lekki członek rodziny: `email=None`, bez loginu (`families/members.py:36-44`). Opiekun dodany przez opiekuna może nie mieć adresu (`families/schemas.py:65-69`), a adres zapisuje się „jak wpisano”, bez normalizacji (`users/service.py:280-281`). Goście RSVP: `email IS NULL`. `is_primary_contact` może kiedyś kierować maile dziecka do opiekuna, ale żaden kod tego dziś nie robi.

### F5. Konfiguracja i wzorce adapterów — config · **wysoka**
`config.py:21-102`: `pydantic-settings`, opcjonalne `None` z właściwością `*_configured`, flagi bool domyślnie False, walidator „pusty placeholder = default”. Brak `EMAIL_*` i bazowego URL. `httpx` jest w runtime (`pyproject.toml:21`), Jinja2 nie ma. `docker-compose.yml` wymienia zmienne backendu jawnie (L31-46). Backend nie ma `restart:`. Nie ma Mailpit. Wzorzec portu: `storage/service.py:25-37`, `set_embedder`/`set_classifier` w lifespanie (`main.py:223-233, 266-267`).

### F6. ADR-009 aktualny co do kierunku, nieaktualny w dwóch przesłankach — wcześniejsze decyzje · **wysoka**
Pozostaje w mocy: port, adapter `httpx`, brak SDK i SMTP w produkcji, brak wysyłki w requeście, dedupe, tylko zweryfikowane adresy, podpisany wypis, nazwy ustawień. Nieaktualne: „bez zmian domeny przez handler na istniejących zdarzeniach” (F1, F2) oraz „adresy istnieją dla wszystkich stron” (F4). Żadna z faz 1–3 nie powstała, a zdarzenia handover, na które ADR-009 miał się wpiąć, nie istnieją.

### F7. Wiele zmian stanu bez bell — triggery · **wysoka**
Zmiana terminu lub wydarzenia (`terms.py:249-296`, `events/service.py:228`), confirm i cancel transakcji (`term_item_listings.py:1149-1206`), RSVP, płatności, zamknięcie obecności i punkty, role, członkostwo, moderacja, nowe wiadomości czatu, wygaśnięcie want. Wszystkie dzieją się bez powiadomienia drugiej strony. Szczególnie zmiana daty terminu po cichu przesuwa wszystkie odbiory.

### F8. Zwijanie bell MATCH i wyciszenie wants — triggery · **wysoka**
Najwyżej jeden nieprzeczytany `WANT_MATCH_FOUND` na want; poprzedni jest usuwany i zastępowany sumą (`match_notifications.py:162-170`). Okno matchera działa co 60 s. Mail per bell powtarzałby się, więc potrzebny jest throttling (1 dziennie na want). `WANT_EXPIRING` ignoruje `notifications_enabled` (`match_notifications.py:197-205`).

### F9. Dostawcy: rezydencja ≠ region wysyłki — zewnętrzne · **wysoka** (ceny: średnia)
Mailgun EU: „message data never leaves the region”. Resend eu-west-1 to tylko region wysyłki, a logi i metadane zostają w USA. Postmark nie ma regionu EU. SendGrid oferuje EU dopiero od Pro ($89.95+). Natywna idempotencja jest tylko w Resend (24 h) i Brevo (30 min). Podpisy webhooków: Mailgun HMAC-SHA256, Resend Svix. Postmark nie ma HMAC, a SES i Scaleway działają przez SNS.

### F10. Deliverability: reguły „wszystkich nadawców”, a DMARC i tak warto mieć — zewnętrzne · **wysoka**
aj jest daleko poniżej 5k dziennie, więc obowiązuje SPF lub DKIM, PTR, TLS i spam rate <0.3%. Status bulk w Gmailu jest jednak trwały, a wolumen subdomen sumuje się z domeną główną. Z `p=none` nie ma też wsparcia dostarczania od Google. One-click unsubscribe jest wymagany dla maili „subscribed”, transakcyjne są zwolnione. DMARC opisuje teraz RFC 9989 (maj 2026): `pct` wycofany na rzecz `t=y`, nowy tag `np`.

### F11. Prawo: art. 398 PKE tylko dla informacji handlowej — zewnętrzne · **średnia**
Art. 10 UŚUDE uchylony 10.11.2024 (Dz.U. 2024 poz. 1222, art. 26 pkt 3). Art. 398 PKE wymaga uprzedniej zgody na informację handlową i marketing bezpośredni. Mail serwisowy (konto, rezerwacje, czat, własny want) nie jest informacją handlową (interpretacja). Podstawa RODO to 6(1)(b), a dla opcjonalnych powiadomień 6(1)(b)/(f). Zgoda wpleciona w rejestrację byłaby niedobrowolna (art. 7(4)).

### F12. Inżynieria: idempotentny konsument, Jinja2 z autoescape, digest dla niepilnych — zewnętrzne · **wysoka** (wzorzec) / średnia (mapowanie)
Konsument outboxa musi być idempotentny (microservices.io). Jinja2 ma `autoescape=False` domyślnie, więc trzeba użyć `select_autoescape` z rozszerzeniem `html.j2` i `StrictUndefined`. MJML wymaga Node i nie jest uzasadniony przy 5–15 szablonach. Bezpieczeństwa i pilnych zdarzeń nie wolno batchować. Czat: opóźnienie 10–15 min i tylko wtedy, gdy nieprzeczytane. Cisza nocna 22:00–07:00 czasu warszawskiego.

### F13. Frontend: brak ekranu ustawień, reserved slugs i guardy — frontend · **wysoka**
`AccountView.tsx:124-135` „Ustawienia” zawiera tylko „Wyloguj się”. Jedyny przełącznik powiadomień to per-want `WantNotificationToggle.tsx:40` (`role="switch"`, wzór do powtórzenia). `settings` jest zarezerwowane na obu stosach bez strony, a test parytetu nie przechodzi na HEAD. Strony z maila (`/verify-email`, `/reset-password`, `/unsubscribe`) muszą trafić do obu list reserved slugs, ale **nie** do `PROTECTED_PREFIXES`. Nie mogą też używać `AuthGuard` ani guarda `LoginPage` w obecnej postaci.

### F14. Brak bazowego URL dla linków w mailach — config · **wysoka**
Jedyna logika bazowego URL to `resolve_base_url(request)` (`oauth2/metadata_router.py:32`), zależna od requestu i z błędem za nginx (D11). Handler w tle potrzebuje `APP_PUBLIC_BASE_URL`, bo `link_path` jest względny.

### Tabela zbiorcza
| # | Ustalenie | Kategoria | Pewność | Źródła |
|---|---|---|---|---|
| F1 | Outbox: 5 prób bez backoffu, powtórka wszystkich handlerów | infrastruktura | wysoka | 3 |
| F2 | `notifications.service` jako choke point | infrastruktura | wysoka | 3 |
| F3 | Brak weryfikacji, resetu, zmiany e-maila | użytkownicy | wysoka | 4 |
| F4 | Odbiorcy bez adresu | użytkownicy | wysoka | 3 |
| F5 | Config i wzorzec portu | config | wysoka | 2 |
| F6 | ADR-009 aktualny w kierunku, nie w przesłankach | decyzje | wysoka | 3 |
| F7 | Ciche zmiany stanu | triggery | wysoka | 1 (kod czytany bezpośrednio) |
| F8 | Zwijanie MATCH, wyciszenie | triggery | wysoka | 3 |
| F9 | Rezydencja ≠ region wysyłki | dostawcy | wysoka / ceny średnia | 2 |
| F10 | SPF/DKIM/DMARC, one-click | deliverability | wysoka | 2 |
| F11 | PKE art. 398 tylko marketing | prawo | średnia | 1 |
| F12 | Idempotencja, Jinja2, digesty | inżynieria | wysoka / średnia | 2 |
| F13 | Frontend: ustawienia, slugi, guardy | frontend | wysoka | 2 |
| F14 | Brak bazowego URL | config | wysoka | 2 |

## 5. Rekomendacja dostawcy

### 5.1 Założenia
1. Wolumen: od setek do ~10k maili miesięcznie na start, później do ~50k. Tylko maile transakcyjne i serwisowe, bez marketingu.
2. Odbiorcy w Polsce, RODO. aj jest administratorem, dostawca procesorem (art. 28).
3. Jeden operator, VPS z docker compose, minimum dodatkowej infrastruktury, sekrety tylko w `.env`.
4. Wysyłka asynchroniczna z kolejki at-least-once, więc dedupe po stronie aplikacji jest konieczne niezależnie od dostawcy.
5. **Domyślnie:** dane wiadomości i logi muszą być w UE. Kraj siedziby dostawcy jest drugorzędny.

### 5.2 Macierz (skrót; pełna wersja w `analysis/findings/external-providers-matrix.md`)
| Dostawca | Dane w UE | Darmowy plan | ~10k/mies. | ~50k/mies. | Idempotencja | Podpis webhooków | Tarcie przy starcie | Wynik /100 |
|---|---|---|---|---|---|---|---|---|
| **Mailgun EU** | ✅ wiadomości, logi i suppression w regionie | 100/dzień | $15 | $35 | ❌ | HMAC-SHA256 | średnie (karta przy własnej domenie) | **81** |
| Brevo | ✅ (OVH FR/DE, GCP BE; niepotwierdzona teza o ścieżce US) | 300/dzień | $0 przy ≤300/dzień | niezweryfikowane | ✅ 30 min | nie zweryfikowano | niskie | 80 |
| Resend | ❌ metadane i logi w USA (DPA + SCC + DPF) | 3000/mies., 100/dzień | $20 | $20 | ✅ 24 h | Svix | niskie | 76 (przy miękkiej rezydencji 1. miejsce) |
| Scaleway TEM | ✅✅ tylko fr-par, brak podprocesorów spoza UE | 300/mies. | ~€2.4 | ~€12.4 | ❌ | beta przez SNS | średnie | 72 |
| Mailjet | ✅ GCP Frankfurt/BE | 6000/mies., 200/dzień | ~$17 | niezweryfikowane | ❌ | nie zweryfikowano | niskie | 72 |
| MailerSend | ◐ „UE”, bez podanego kraju | 500/mies. | ~$14.5 | $35 (sprzeczne $25) | ❌ | „secret key” | niskie | 70 |
| EmailLabs (PL) | ✅ CEE | 9000/mies. (tylko testowe) | €29 | €29 (sprzeczne) | — | tylko PRO | średnie | 66 |
| Amazon SES eu-central-1 | ✅ zasoby regionalne | brak (kredyty AWS) | $1 | $5 | ❌ | SNS | **wysokie** (sandbox, do 96 h) | 65 |
| Postmark | ❌ | 100/mies. | $15 | $66–87 | ❌ | brak HMAC | średnie | 58 |
| SendGrid | ◐ tylko Pro+ | 60-dniowy trial | $19.95+ | niezweryfikowane | ❌ | podpisane | średnie | 52 |
| SMTP2GO | niezweryfikowane | 1000/mies. | $10 | ~$50 | ❌ | — | niskie | — |

Wyniki to ocena syntezy oparta na dowodach z macierzy, nie dane dostawców. Ceny według stron z 2026-11-26, bez VAT.

### 5.3 Rekomendacja: **Mailgun, region EU**
- **Dlaczego:** dane wiadomości, logi, suppression i domeny są związane z regionem EU. Jest oficjalne SDK, ale wystarczy `httpx` (POST form). Webhooki są podpisane HMAC-SHA256 z ochroną przed replay. Jest API suppression. Limit 80k wywołań na 10 s. Cena rośnie liniowo: $0, $15, $35.
- **Konfiguracja:** domenę trzeba utworzyć **w regionie EU**, bo nie da się jej potem przenieść. Subdomena `mail.<domena>`, DKIM, SPF include, MX dla bounce, DMARC. Webhooki `delivered`, `failed` (permanent) i `complained` prowadzą do `email_suppressions`.
- **Luki:** brak natywnej idempotencji (dedupe w aplikacji, §6.4). Logi u dostawcy trzymane są 1–5 dni, więc potrzebny jest własny log wysyłek. DPA i lista podprocesorów Sinch nie zostały pobrane. Spółka Mailgun Technologies jest amerykańską córką szwedzkiego Sinch, więc teoretycznie istnieje ekspozycja na CLOUD Act.

### 5.4 Alternatywa: **Resend** (gdy rezydencja jest miękka)
- **Warunek:** właściciel akceptuje przechowywanie metadanych i logów w USA na podstawie DPA z SCC 2021/914 i DPF. Polityka prywatności musi wtedy wskazać transfer do USA.
- **Zalety:** natywny `Idempotency-Key` (24 h) zamyka okno duplikatu między 2xx a commitem. Webhooki Svix z `email.bounced`, `complained`, `delivered` i `suppressed`. $20 do 50k. Samoobsługowa rejestracja. 10 żądań na sekundę.
- **Wady:** darmowy plan 100 dziennie, transfer poza UE.
- **Jeśli wymagany jest dostawca z UE i stack wyłącznie w UE:** Brevo (funkcje, idempotencja; najpierw sprawdzić listę podprocesorów i cennik) albo Scaleway TEM (najtańszy, suwerenny, ale webhooki w becie przez SNS, więc trzeba odpytywać statusy).

### 5.5 Odradzane
SES (sandbox, SNS i IAM to za dużo dla jednego operatora, warto wrócić do niego powyżej ~100k miesięcznie), SendGrid (EU dopiero od Pro z dedykowanym IP), Postmark (USA, brak HMAC, brak oficjalnego SDK Python).

## 6. Szkic modułu i integracji

### 6.1 Relacja do ADR-009
| Element ADR-009 | Werdykt | Uzasadnienie |
|---|---|---|
| Port `EmailSender` + adapter HTTP przez `httpx` (+ adapter log) | **Potwierdzony** | `httpx` w runtime, wzorzec `set_x()` (F5). Dochodzi adapter SMTP tylko dla dev/Mailpit |
| Brak wysyłki synchronicznej w requeście | **Potwierdzony** | Kolejka + job |
| „Dodatkowy handler na istniejących zdarzeniach outboxa, bez zmian domeny” | **Zmieniony** | 9/13 bell poza outboxem, a handler obok bell dubluje bell przy retry (F1, F2). Nowy punkt: `notifications.service` + ACL z `users`/`auth` |
| Dedupe `(outbox entry, recipient)` | **Zmieniony w formie** | Klucz `email_messages.idempotency_key`: `notification:<id>`, `auth:<token_id>`, `want_match:<want_id>:<data Warsaw>` |
| Tylko zweryfikowane adresy | **Potwierdzony + doprecyzowany** | Google = zweryfikowany przy rejestracji, hasło = wymaga flow, brak adresu = SKIPPED |
| Opt-in `email_reminders_enabled` default false + `email_consent_at` | **Zmieniony** | Mail serwisowy bez zgody PKE (F11). Preferencja per kategoria. Zgoda z wersją tekstu tylko dla przyszłego marketingu. Domyślny stan kategorii to decyzja właściciela |
| Podpisany wypis + `List-Unsubscribe` | **Potwierdzony + rozszerzony** | RFC 8058 one-click POST, tylko strumień powiadomień |
| Nazwy 7 ustawień | **Potwierdzone + uzupełnione** | §6.6 |
| „Moderation worker nie może przejąć zdarzeń email” | **Nieaktualne** | Maile nie idą przez `outbox_entries`. W wariancie z outboxem (§6.9) ryzyko wraca |

### 6.2 Struktura modułu (propozycja)
```
src/backend/app/email/
  models.py          # email_messages, email_suppressions, email_preferences
  service.py         # enqueue_for_notifications(), enqueue_transactional() — jedyne API dla innych modułów
  rules.py           # NotificationKind -> (kategoria, strumień, szablon, opóźnienie, throttling); stałe (backoff, limity)
  sending.py         # run_send_batch(): job wysyłki
  rendering.py       # Jinja2 Environment (autoescape html.j2, StrictUndefined)
  templates/         # base.html.j2, *.html.j2 + *.txt.j2 (PL)
  senders/           # base.py (Protocol EmailSender), mailgun.py, smtp.py (dev), log.py
  tokens.py          # podpis i weryfikacja tokenu wypisu (EMAIL_LINK_SIGNING_SECRET)
  router.py          # POST unsubscribe (PUBLIC), webhook dostawcy (PUBLIC + HMAC), GET/PUT preferencji
  infrastructure/
    users_acl.py     # party -> profil -> adres, weryfikacja, display_name (batch)
    notifications_acl.py  # read_at bell (dla strumieni opóźnionych)
```
Konsumenci: `notifications/infrastructure/email_acl.py`, `users/infrastructure/email_acl.py`, `auth/infrastructure/email_acl.py`. `app.email` importowany tylko przez `main.py` i te ACL-e. Dopisać `"email"` do `MODULES` w `tests/test_module_boundaries.py`, a `app/email` do `tests/test_domain_clock_guard.py`.

### 6.3 Punkt wpięcia i przepływ
1. **Powiadomienia:** `create_notification` i `create_notifications` po zapisaniu bell wywołują `email_acl.enqueue_for_notifications(db, [(notification_id, party_id, kind)])`. W tej samej transakcji powstaje jeden `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` na wiersz, bez zapytań o adres i preferencje (późne wiązanie). `rules.py` decyduje, czy dany `kind` w ogóle idzie mailem. Jeśli nie, nic nie jest wstawiane.
2. **Auth:** `users` lub `auth` tworzą token (hash w DB) i wywołują `email_acl.enqueue_transactional(db, template="verify_email", party_id, context={token}, key=f"auth:{token_id}")`. Surowy token jest w `payload` tylko do wysłania, po SENT lub FAILED pole jest zerowane.
3. **Job `_run_email_send`** (APScheduler, stała modułowa, np. co 1 min, `coalesce=True`, batch 50) wykonuje kolejno:
   - claim `PENDING AND send_after <= utcnow()` z `FOR UPDATE SKIP LOCKED`, oznaczenie `SENDING` i commit;
   - rozwiązanie odbiorcy przez `users_acl`: brak adresu, adres niezweryfikowany (dla P i D), suppression, wyłączona kategoria albo przekroczony `EMAIL_DAILY_CAP` dają `SKIPPED` z `skip_reason`;
   - dla strumieni opóźnionych (czat) sprawdzenie, czy bell jest nadal nieprzeczytany;
   - cisza nocna dla P i D (22:00–07:00 według `clock.local_now()`): przesunięcie `send_after` na 07:00;
   - render HTML + tekst, nagłówki strumienia, wywołanie `EmailSender.send()` z timeoutem;
   - zapis wyniku w nowej transakcji.
4. **Webhook dostawcy** `POST /api/email/webhooks/mailgun`: weryfikacja HMAC (`EMAIL_WEBHOOK_SIGNING_KEY`) i ochrona przed replay. Aktualizacja statusu po `provider_message_id` (idempotentnie). `failed/permanent` i `complained` trafiają do `email_suppressions`, a skarga na strumieniu powiadomień wyłącza dodatkowo kategorie użytkownika.

### 6.4 Idempotencja i dedupe
- `UNIQUE(idempotency_key)`. Klucze: `notification:<notification_id>`, `auth:<token_id>`, `want_match:<want_id>:<YYYY-MM-DD Warsaw>` (throttling 1 dziennie na want wynika wprost z konfliktu klucza), `digest:<party_id>:<okres>`.
- Okno duplikatu: crash między 2xx dostawcy a commitem zostawia `SENDING`. Rekord `SENDING` starszy niż ~10 min wraca do `PENDING` dla P i D (na Mailgun możliwy duplikat, akceptowalny), a dla T przechodzi w `FAILED` (użytkownik ponawia żądanie, unikamy dwóch linków resetu). U Resend i Brevo przekazujemy `Idempotency-Key = email_messages.id`.

### 6.5 Retry i obsługa błędów (spójne z `outbox/dispatcher.py` i standardem error-handling)
| Wynik | Akcja |
|---|---|
| 2xx | `SENT`, `provider_message_id`, `sent_at` |
| 4xx walidacji (poza 429) | `FAILED` bez retry, jedna linia WARNING bez adresu |
| 429 / 5xx / timeout / sieć | `PENDING`, `attempts += 1`, `send_after = now + backoff` (np. 1, 5, 15, 60, 240 min) |
| `attempts >= MAX` (np. 6) | `FAILED` + jedna linia ERROR `email message %s FAILED after %d attempts` (analogicznie do `grep "FAILED after"` z runbooków) |
| `40P01`/`40001` w jobie | WARNING i ponowienie w kolejnym przebiegu |
| inny wyjątek joba | `logger.exception` raz, bez re-raise, pętla działa dalej |
Nigdy nie logować adresów, tokenów ani treści (reguła z `auth/google.py:5`). Linia startowa lifespanu dostaje `EMAIL_ENABLED=…` obok flag moderacji i embeddings.

### 6.6 Konfiguracja (tylko nazwy)
Z ADR-009: `EMAIL_ENABLED`, `EMAIL_PROVIDER_API_URL` (dla Mailgun EU z domeną w ścieżce), `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_LINK_SIGNING_SECRET`, `APP_PUBLIC_BASE_URL`.
Proponowane uzupełnienia: `EMAIL_BACKEND` (`mailgun` | `smtp` | `log`), `EMAIL_REPLY_TO_ADDRESS` (monitorowana skrzynka, zalecenie Microsoftu), `EMAIL_WEBHOOK_SIGNING_KEY`, `EMAIL_DAILY_CAP` (warm-up), `EMAIL_SMTP_HOST` i `EMAIL_SMTP_PORT` (tylko dev/Mailpit).
Każdą nazwę dodać do `config.py` (z `email_configured`, walidatorem pustego placeholdera i bramką: bez konfiguracji `LogSender`, a endpointy resetu i weryfikacji zwracają 503 jak Google), do `.env.example` (puste placeholdery) oraz do `docker-compose.yml` (`backend.environment`). Wartości tylko w `.env`.

### 6.7 Zegar i szablony
- „Teraz” w regułach domeny (cisza nocna, data throttlingu, przypomnienia) tylko przez `clock.local_now()`. Znaczniki audytu (`created_at`, `sent_at`, `send_after`) w naiwnym UTC.
- Daty w treści przez `clock.format_term_when` i `format_term_day`. `lang="pl"`, UTF-8, temat ≤ ~60 znaków.
- Jinja2: `select_autoescape(enabled_extensions=("html","html.j2"), default_for_string=True)` i `StrictUndefined`. Pary `*.html.j2` + `*.txt.j2`. Jeden ręcznie napisany, tabelkowy `base.html.j2` z inline CSS. Jeden przycisk CTA z pełnym URL-em powtórzonym pod nim. Bez trackingu, bez bloków promocyjnych. Mail renderuje się z danych (party, kind, kontekst z ACL), a 500-znakowy tekst bell służy najwyżej jako fallback.

### 6.8 Testy
- `tests/fake_email.py`: `FakeEmailSender` zapisujący `(to, subject, text, html, headers)`, wpinany przez `set_sender()` w fixture (jak `FakeStorage` i `set_embedder`).
- Testy integracyjne (testcontainers, `db_session`) w `tests/test_email_*.py`, np.:
  - utworzenie bell powoduje `email_messages` PENDING;
  - duplikat klucza nie tworzy drugiego wiersza;
  - brak adresu, adres niezweryfikowany, suppression i wyłączona kategoria dają SKIPPED;
  - 5xx daje backoff, a po MAX `FAILED` z jedną linią ERROR;
  - webhook z poprawnym HMAC zapisuje suppression, z błędnym zwraca 401/403;
  - unsubscribe POST bez auth jest idempotentny i bez przekierowania;
  - żądanie resetu zawsze daje neutralne 202;
  - render z `StrictUndefined`, autoescape nazw rzeczy i polskie znaki;
  - `count_queries` w batchu wysyłki.
- Dev: Mailpit jako serwis compose z `profiles: ["dev"]` (`axllent/mailpit:<przypięta wersja>`, UI 8025, SMTP 1025 w sieci compose) z `EMAIL_BACKEND=smtp`. Nazwy zmiennych samego Mailpit są niezweryfikowane, ale domyślne porty wystarczają. Przed startem produkcji: test seed (mail-tester albo konta testowe Gmail i Outlook), w nagłówkach `spf=pass dkim=pass dmarc=pass`.

### 6.9 Wariant dopuszczalny: przez `outbox_entries`
Jeśli zespół woli, żeby całą asynchroniczność obsługiwał outbox: `notifications.service` stawia `outbox.append(event_type="email.notification_requested")`, a jedyny handler tego typu robi tylko `INSERT email_messages ON CONFLICT DO NOTHING` w `begin_nested()`. Wysyłka zostaje w jobie (bez HTTP w dispatcherze). Koszt: trzeci przeskok (+do 60 s opóźnienia), wzrost `outbox_entries` bez purge i ryzyko, że poller z filtrami przejmie typ `email.*`. Rekomendacja syntezy: wariant bezpośredni (§6.3), bo `email_messages` sam pełni rolę transactional outboxa. Pewność średnia, to ocena projektowa.

## 7. Tabela triggerów

**Typy:** **T** transakcyjny (zawsze wysyłany do adresu dostępnego dla konta, bez wypisu, bez List-Unsubscribe) · **P** powiadomienie serwisowe z preferencją per kategoria (List-Unsubscribe + link w stopce; wymaga zweryfikowanego adresu) · **D** digest lub zbiorczy (opt-in, domyślnie wyłączony) · **X** bez maila.
**Priorytety:** **MVP** · **MVP+** (wymaga najpierw nowego `NotificationKind`) · **Później** · **—**.

### 7.1 Auth i konto (bez bell)
| # | Zdarzenie | Miejsce w kodzie | Odbiorca | Bell | Typ | Priorytet | Uwagi |
|---|---|---|---|---|---|---|---|
| A1 | Weryfikacja adresu (po rejestracji i na żądanie) | nowe; po `users/service.py:328` (`register`) + nowy endpoint `POST /api/people/me/email-verification` | nowy użytkownik z hasłem | — | T | **MVP** | Warunek dla wszystkich P i D. Można połączyć z powitaniem (A4). Konta Google są już zweryfikowane |
| A2 | Reset hasła (żądanie) | nowe w `app/auth` | właściciel adresu | — | T | **MVP** | Neutralna odpowiedź. Token jednorazowy, ważny ~1 h. Dla `password_hash IS NULL` decyzja D4 |
| A3 | Hasło zmienione lub ustawione | nowe (po A2) | właściciel | — | T | **MVP** | Alert bezpieczeństwa |
| A4 | Powitanie | `users/service.py:328` | nowy użytkownik | — | T | MVP-opcjonalnie | Jeden mail z A1 |
| A5 | Powitanie po rejestracji Google | `auth/service.py:146` (`created=True`) | nowy użytkownik | — | T | Później | |
| A6 | Próba logowania Google na zarejestrowany adres (409) | `auth/service.py:136-137` | właściciel adresu | — | T | Później | Wymaga rate limitu (D12) |
| A7 | Zmiana adresu (stary + nowy) | nowe, flow nie istnieje | stary i nowy adres | — | T | Później | Gdy powstanie zmiana e-maila |
| A8 | Konto opiekuna założone przez innego opiekuna | `families/guardians.py:28-53` | nowy opiekun | — | T | Później | Docelowo zaproszenie z ustawieniem hasła zamiast hasła wpisanego przez kogoś innego |

### 7.2 Wszystkie istniejące `NotificationKind` (13)
| # | Zdarzenie | Miejsce w kodzie | Odbiorca | Bell | Typ | Priorytet | Uwagi |
|---|---|---|---|---|---|---|---|
| B1 | Ktoś bierze rzecz (GIFT) | `groups/application/term_item_listings.py:699-705` (`_take`, TERM/EVENT/PERSONAL) | właściciel rzeczy | `TERM_ITEM_LISTING_TAKEN` | P (Rezerwacje) | **MVP** | Właściciel musi przynieść lub wydać rzecz. Właściciel-Organization: SKIPPED (luka) |
| B2 | Potwierdzenie rezerwacji dla biorącego | `term_item_listings.py:706-712` | biorący (aktor) | `ITEM_RESERVED_FOR_PICKUP` | X | — / Później | Własna akcja. Ewentualnie jako przypomnienie o odbiorze |
| B3 | Propozycja wymiany | `term_item_listings.py:856-863` | właściciel ogłoszenia | `SWAP_PROPOSED` | P (Rezerwacje) | **MVP** | Wymaga decyzji, blokuje rzecz |
| B4 | Wymiana zaakceptowana | `term_item_listings.py:990-996` | proponujący | `SWAP_ACCEPTED` | P (Rezerwacje) | **MVP** | Zobowiązanie do przekazania |
| B5 | Wymiana odrzucona (ręcznie lub automatycznie) | `term_item_listings.py:1062-1068`, `:1015-1021` | proponujący | `SWAP_REJECTED` | P (Rezerwacje) | **MVP** | Zwalnia rzecz proponującego |
| B6 | Potwierdź po terminie lub wydarzeniu | `term_end_scan.py:142,197,274` → outbox → `notifications/outbox_listener.py:87-143` | biorący (GIFT) lub obie strony (SWAP) | `TERM_CONFIRMATION_NEEDED` | P (Rezerwacje) | **MVP** | Napędza confirm i punkty. Skan +2 h, cisza nocna przesuwa na 07:00 |
| B7 | Ktoś już rozstrzygnął | `term_item_listings.py:1116-1122` | klikający | `TERM_ALREADY_RESOLVED` | X | — | Reakcja na własne kliknięcie |
| B8 | Rezerwacja anulowana (usunięte wydarzenie) | `groups/application/event_reservations.py:122-158` ← `events/service.py:281` | obie strony | `RESERVATION_CANCELLED` | P (Rezerwacje) | **MVP** | Chroni przed zbędnym przyjazdem |
| B9 | Nowe dopasowanie MATCH | matcher `window.py:178` → `wants.bells_due` → `wants/application/bells_due.py:82` → `match_notifications.py:183-193` | szukający | `WANT_MATCH_FOUND` | P (Szukam) | **MVP** | Klucz `want_match:<want>:<dzień>`, czyli najwyżej 1 dziennie na want. Tylko MATCH, wyciszone wants pomijane. Szara strefa prawna (§9.4) |
| B10 | Want wygasa za 7 dni | matcher `window.py:52-55` → `match_notifications.py:196-203` | szukający | `WANT_EXPIRING` | P (Szukam) | Później | Raz na want. Decyzja: czy respektować `notifications_enabled` (bell go ignoruje) |
| B11 | Zgłoszenie przyniesienia potrzebnej rzeczy | `groups/application/pledges.py:94` → `outbox_listener.py:53-62` | organizator | `PLEDGE_CREATED` | D (Organizator) | Później | Częste, niepilne |
| B12 | Wycofanie zgłoszenia | `pledges.py:130` → `outbox_listener.py:65-74` | organizator | `PLEDGE_WITHDRAWN` | D (Organizator) | Później | |
| B13 | Potrzebna rzecz usunięta | `groups/application/terms.py:447-456` | zgłaszający | `NEEDED_ITEM_REMOVED` | P (Spotkania) | Później | Rzadkie. Oszczędza noszenia zbędnej rzeczy |

### 7.3 Zdarzenia bez bell (wymagają nowego emitu; zasada „najpierw bell”)
| # | Zdarzenie | Miejsce w kodzie | Odbiorca | Bell | Typ | Priorytet | Uwagi |
|---|---|---|---|---|---|---|---|
| C1 | Druga strona anulowała transakcję | `term_item_listings.py:1193-1206` (`cancel_transaction`) | druga strona | nowy (np. `TRANSACTION_CANCELLED`) | P (Rezerwacje) | **MVP+** | Dziś anulowany odbiór nie generuje żadnego powiadomienia |
| C2 | Zmiana daty lub miejsca terminu | `groups/application/terms.py:249-296` (`update_term`) | uczestnicy RSVP + strony rezerwacji | nowy (np. `TERM_RESCHEDULED`) | P (Spotkania) | **MVP+** | Zmiana daty przesuwa wszystkie odbiory bez powiadomienia |
| C3 | Zmiana czasu lub miejsca wydarzenia | `events/service.py:228` | uczestnicy + strony rezerwacji | nowy | P (Spotkania) | Później (MVP+, jeśli wydarzenia są używane) | Jak C2 |
| C4 | Przypomnienie dzień przed terminem lub wydarzeniem | nowy job (Warsaw) | uczestnicy, strony rezerwacji | nowy | P (Spotkania) | Później | Największa wartość po MVP (research handover: „wieczór przed”) |
| C5 | Druga strona potwierdziła (z przyznaniem punktów) | `term_item_listings.py:1149-1190`, `:1171` | druga strona | nowy | D | Później | Domknięcie, niska pilność |
| C6 | Nowa wiadomość czatu | `messaging/application/messages.py:89-139` | pozostali uczestnicy | brak (read markers) | P (Wiadomości), opóźniony | Później | 10–15 min opóźnienia, tylko gdy nieprzeczytane, 1 na rozmowę na kilka godzin. Najpierw ITEM 1:1, grupowe jako digest |
| C7 | Nowy termin w moim kręgu | `terms.py:56` | członkowie kręgu | — | D | Później | Opt-in. Uwaga: blisko „promocji”, sprawdzić |
| C8 | RSVP lub wypis (dla organizatora) | `public_view.py:408`, `attendance.py:49` | organizator | — | D (Organizator) | Później | |
| C9 | Oznaczenie płatności PAID | `attendance_points.py:149` | uczestnik | — | T (operacyjny) | Później | Potwierdzenie płatności za płatny termin |
| C10 | Zamknięcie obecności + punkty | `attendance_points.py:201,259`, job `:280` | obecni | — | D | Później | |
| C11 | Zapis lub wypis z wydarzenia (dla autora) | `events/service.py:383,413` | autor | — | D (Organizator) | Później | |
| C12 | Dołączenie kodem do prywatnego kręgu | `join_code.py:112-148` | organizator | — | D (Organizator) | Później | |
| C13 | Nadanie lub odebranie współorganizatorstwa | `circles.py:322,341` | osoba, której dotyczy | — | P | Później | |
| C14 | Koniec członkostwa lub usunięcie kręgu | `memberships.py:42`, `circles.py:208` | członkowie | — | P | Później | |
| C15 | Odrzucenie zdjęcia lub mediów przez moderację | `moderation/service.py:301-342`, `media/service.py:442` | autor | — | T (operacyjny) | Później | Najpierw bell |
| C16 | Want wygasł | matcher `window.py:48-50` | szukający | — | X | — | Pokryte przez B10 |
| C17 | SUGGESTION / SIMILAR | matcher (born seen) | szukający | — | X | — | Bliżej marketingu, zostaje tylko w aplikacji |
| C18 | Własne akcje (rejestracja, logowanie, założenie organizacji, kręgu lub wydarzenia, edycja profilu, kod dołączenia, config punktów) | `users/router.py:80,88`, `organizations/service.py:155`, `circles.py:77,110`, `events/service.py:145`, `join_code.py:104`, `points/router.py:41` | aktor | — | X | — | Synchroniczny feedback |
| C19 | Synchroniczna odmowa moderacji tekstu | np. `messages.py:115-121` | aktor | — | X | — | 400 w UI |

**Podsumowanie MVP:** A1–A3 (+A4) oraz B1, B3, B4, B5, B6, B8, B9. **MVP+:** C1, C2. Wszystkie 13 `NotificationKind` mają przypisaną decyzję (7 MVP, 2 później jako P, 2 digest później, 2 X: B2 i B7).

## 8. Warunki wstępne
| Warunek | Stan dziś | Co trzeba |
|---|---|---|
| Weryfikacja adresu | Brak. Google = zweryfikowany (`user_identities.email_verified`) | `user_profiles.email_verified_at` (backfill: konta z tożsamością Google `email_verified=true` i zgodnym adresem), tabela tokenów (hash, `expires_at`, `used_at`), endpointy żądania (rate limit) i potwierdzenia (PUBLIC POST), strona `/verify-email`, baner w panelu |
| Reset hasła | Brak (D10) | Tabela tokenów resetu, `POST /api/auth/password-reset` (neutralne 202), `.../confirm`, strona `/reset-password`, link „Nie pamiętasz hasła?” w `LoginForm`, pełne przeładowanie po zmianie sesji. Decyzja D4 dla kont tylko-Google |
| Preferencje i zgody | Brak (tylko `wants.notifications_enabled`) | `email_preferences(party_id, category, enabled, updated_at)` plus przełącznik „wszystkie”. Zgody z wersją tekstu tylko, jeśli pojawi się marketing |
| Token wypisu | Brak | Podpis HMAC/JWT (`EMAIL_LINK_SIGNING_SECRET`) z `party_id` + kategorią, bezterminowy lub długoterminowy, idempotentny |
| Adresy nullable i rodzinne | `email` nullable, dzieci i goście bez adresu, opiekunowie „jak wpisano” | Brak adresu = SKIPPED. Porównanie i wysyłka po `lower(email)`. Routing dzieci do `is_primary_contact` dopiero przy pierwszym triggerze o dziecku |
| Konta tylko-Google | `password_hash IS NULL`, brak odzyskiwania | Decyzja D4 przy resecie. Adres zweryfikowany, więc kwalifikują się do P od razu (ogłosić w aplikacji, nie mailem masowym) |
| Party Organization jako odbiorca | Niezweryfikowane | Reguła (np. założyciel lub liderzy) albo SKIPPED |
| Bazowy URL | Brak (D11) | `APP_PUBLIC_BASE_URL` |
| Polityka prywatności i regulamin | Brak (D14) | Strony + link przy rejestracji. Art. 13: dostawca jako procesor (i transfer US przy Resend), retencja logu wysyłek |
| DNS | Brak | §10 |
| Suppression i webhook | Brak | `email_suppressions` + endpoint webhooka |
| Retencja | Brak purge `outbox_entries` | Purge `email_messages` po ~90 dniach (job). Przy okazji purge `outbox_entries` |

## 9. Preferencje i wypis

### 9.1 Kategorie (propozycja)
| Kategoria | Rodzaje | Domyślnie po weryfikacji |
|---|---|---|
| Rezerwacje i wymiany | B1, B3–B6, B8, C1, C5 | włączona (rekomendacja; decyzja właściciela) |
| Spotkania i wydarzenia | B13, C2–C4 | włączona |
| Szukam | B9, B10 | włączona (plus istniejący przełącznik per want) |
| Wiadomości | C6 | włączona albo wyłączona, do decyzji |
| Podsumowania organizatora | B11, B12, C8, C11, C12 | wyłączona (opt-in) |
| Transakcyjne | A1–A8, C9, C15 | nie da się wyłączyć |

### 9.2 Mechanika wypisu
- Nagłówki tylko dla P i D: `List-Unsubscribe: <https://<app-domain>/api/email/unsubscribe/<signed-token>>` (mailto opcjonalny, wymaga routingu przychodzącego) oraz `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. DKIM musi obejmować oba nagłówki (sprawdzić w Mailpit i w teście seed).
- Backend: PUBLIC `POST /api/email/unsubscribe/{token}`, `application/x-www-form-urlencoded` lub `multipart/form-data`, bez cookies i auth. Odpowiedź 200 bez przekierowania, idempotentna, działa natychmiast (Gmail wymaga ≤48 h, Yahoo 2 dni). Nowy wiersz PUBLIC w `AUTHORIZATION_MATRIX` (precedens: wiersze 72/73). nginx i Next nie mogą zamieniać POST na redirect.
- Link w stopce prowadzi do strony Next.js `/unsubscribe?token=…` (layout `(public)`, bez `AuthGuard`). GET pokazuje tylko potwierdzenie, a przycisk wysyła POST (skanery linków robią prefetch GET). Opcja: „wyłącz tę kategorię” albo „wszystkie powiadomienia e-mail”.
- Panel: nowa strona `/settings` (layout `(panel)`, dopisana do `PROTECTED_PREFIXES`) z przełącznikami `role="switch"` jak `WantNotificationToggle`, stanem weryfikacji adresu i przyciskiem „Wyślij link weryfikacyjny”. Wiersz „Powiadomienia e-mail” w sekcji „Ustawienia” w `AccountView`. To naprawia też test parytetu `settings`.
- Reserved slugs: `verify-email`, `reset-password`, `unsubscribe` w `routing/reservedSlugs.ts` **i** `organizations/slugs.py`, w tej samej zmianie.
- Dane: hook TanStack Query w `src/hooks/` dla preferencji. Jednorazowe POST-y tokenów jako `useMutation` albo wyjątek imperatywny jak `getGoogleNonce`.

### 9.3 Suppression vs preferencje
Suppression (bounce lub skarga) dotyczy adresu i blokuje P i D. T próbujemy wysłać tylko na wyraźne żądanie użytkownika (reset), żeby nie odciąć odzyskiwania konta. Skarga na powiadomieniu wyłącza też kategorię. Suppression przetrwa purge logu wysyłek, a po usunięciu konta zostaje najwyżej hash.

### 9.4 Granice prawne (interpretacja, pewność średnia)
Szablony bez bloków promocyjnych. MATCH tylko dla własnego aktywnego wanta, z wypisem. SUGGESTION/SIMILAR, „nowe rzeczy w okolicy”, newslettery i re-engagement wymagają osobnej, niezaznaczonej zgody per kanał (art. 398 i 400 PKE) i są poza zakresem MVP. Bez checkboxa „zgoda na powiadomienia” przy rejestracji.

## 10. Checklista DNS i deliverability
Wartości to wyłącznie placeholdery. Prawdziwe pochodzą z panelu dostawcy.

| # | Host | Typ | Wartość (szablon) | Uwagi |
|---|---|---|---|---|
| 1 | `mail.<domena>` | TXT | `v=spf1 include:<provider-spf-include> ~all` | Jeden rekord SPF na nazwę, ≤10 lookupów. Przejście na `-all` po stabilizacji |
| 2 | `<selector>._domainkey.mail.<domena>` | TXT lub CNAME | `k=rsa; p=<provider-public-key>` | 2048 bit. `d=` własnej domeny, nie współdzielonej domeny dostawcy |
| 3 | `mail.<domena>` | MX | `<provider-mx-1>`, `<provider-mx-2>` (prio 10) | Wymagane przez Mailgun do obsługi bounce |
| 4 | `<tracking>.mail.<domena>` | CNAME | `<provider-tracking-host>` | Opcjonalny custom return-path. Tracking otwarć i kliknięć **wyłączony** |
| 5 | `_dmarc.mail.<domena>` | TXT | Faza A: `v=DMARC1; p=none; rua=mailto:<dmarc-reports-mailbox>; adkim=r; aspf=r` | ≥48 h po tym, jak SPF i DKIM przechodzą. Obserwacja ≥1 tydzień |
| 5b | jw. | TXT | Faza B: `v=DMARC1; p=quarantine; pct=25; t=y; rua=mailto:<…>` → `pct=100` | `pct` dla odbiorców według RFC 7489, `t=y` według RFC 9989. Co tydzień, jeśli raporty są czyste |
| 5c | jw. | TXT | Faza C: `v=DMARC1; p=reject; rua=mailto:<…>` | Stan docelowy (wsparcie dostarczania od Google) |
| 6 | `_dmarc.<domena>` | TXT | `v=DMARC1; p=none; sp=<…>; np=reject; rua=mailto:<…>` | Upewnić się, że rekord na apexie istnieje i jego `sp` nie podważa subdomeny |
| 7 | domena raportów | TXT | `<domena>._report._dmarc.<report-domain>` → `v=DMARC1` | Tylko gdy `rua` wskazuje inną domenę (albo darmowy agregator) |
| 8 | Google Postmaster Tools | TXT | `google-site-verification=<token>` | Spam rate <0.1%, nigdy ≥0.3% |
| 9 | PTR i TLS | — | po stronie dostawcy | Sprawdzić testem seed |

**Operacyjnie:**
- Mailgun: domenę zakładamy w regionie **EU**. `EMAIL_WEBHOOK_SIGNING_KEY` kopiujemy do `.env`, nigdy do repo ani raportów.
- `From: "<nazwa>" <powiadomienia@mail.<domena>>`, `Reply-To` na monitorowaną skrzynkę, `Auto-Submitted: auto-generated`, tag strumienia (`o:tag`), `List-Id` dla powiadomień.
- Warm-up: tydzień 1 tylko transakcyjne, potem kolejne kategorie P. Żadnego masowego „ogłaszamy maile”. `EMAIL_DAILY_CAP` około 100 dziennie na start (darmowy plan Mailgun).
- Weryfikacja przed startem: Mailpit (struktura, HTML, List-Unsubscribe), potem mail-tester oraz konta Gmail i Outlook (`spf=pass dkim=pass dmarc=pass`, `header.from=mail.<domena>`).

## 11. Rekomendacje i etapy
| # | Rekomendacja | Priorytet | Nakład | Uzasadnienie | Korzyści | Ryzyka |
|---|---|---|---|---|---|---|
| R1 | Decyzja właściciela: twarda czy miękka rezydencja, domena nadawcza, domyślny stan kategorii | P0 | niski | Zmienia wybór dostawcy i model preferencji | Odblokowuje resztę | Opóźnienie |
| R2 | Polityka prywatności i regulamin (D14), link przy rejestracji | P0 | niski–średni (poza kodem) | Art. 13 RODO, procesor | Zgodność | Wymaga prawnika |
| R3 | **Etap 1:** moduł `app/email` (kolejka, job, port, Mailgun + SMTP-dev + log + fake), DNS, webhook i suppression, A1–A3, strony `/verify-email` i `/reset-password`, `APP_PUBLIC_BASE_URL` | Wysoki | średni–wysoki | Zamyka ryzyko braku odzyskiwania konta, buduje warm-up na mailach transakcyjnych | Weryfikacja odblokowuje P i auto-linking Google (D8) | Okno duplikatu (Mailgun), D4 |
| R4 | **Etap 2:** `email_preferences`, `/settings`, wypis RFC 8058, hook w `notifications.service`, rodzaje B1, B3–B6, B8, B9 | Wysoki | średni | Główna wartość: domknięcie wymian bez zaglądania do aplikacji | Mniej niedoszłych odbiorów, więcej potwierdzeń i punktów | Zgodność prawna kategorii domyślnie włączonych |
| R5 | **Etap 3:** nowe bell C1, C2 (i C3) | Wysoki | niski–średni | Luki również w aplikacji | Oba kanały naraz | Ruchome terminy z wieloma odbiorcami (warm-up, limit) |
| R6 | Później: przypomnienie dzień przed (C4), czat z opóźnieniem (C6), digest organizatora, B10, B13, C9, C15 | Średni | średni | Zależne od pomiarów etapu 2 | | Spam, skargi |
| R7 | Purge `email_messages` (90 dni) i `outbox_entries`. Guard pętli `run_forever` | Średni | niski | Wzrost tabel, cicha śmierć pollera | Stabilność | — |
| R8 | Aktualizacja `architecture.md` („In-app notifications only”, L411/L480) i decision log (ADR-009 → nowy ADR) przy wdrożeniu. Zaproponować standard „mail tylko przez `app.email` + ACL, nigdy synchronicznie w requeście” | Niski | niski | Spójność dokumentacji | | — |

## 12. Analiza: wzorce, wnioski, SWOT

### 12.1 Wzorce
| Wzorzec | Typ | Występowanie | Ocena | Przykład |
|---|---|---|---|---|
| Port + `set_x()` w lifespanie | architektura (adapter) | 3 moduły | dojrzały | `storage/service.py:25-37` |
| Bramkowanie ustawieniem (`*_configured`, 503) | konfiguracja | Google, Spaces | dojrzały | `config.py:84-99` |
| Transactional outbox at-least-once | integracja | 5 typów zdarzeń | dojrzały, ale retry bez backoffu | `outbox/dispatcher.py` |
| Job + `SKIP LOCKED` + jedna linia logu | implementacja | 4 joby + matcher | dojrzały | `_run_attendance_close` |
| ACL per kontekst + test granic | organizacja | pages, search, wants, points | dojrzały | `tests/test_module_boundaries.py` |
| Gotowy tekst w bell, render w konsumencie | projekt | wszystkie bell | dojrzały | `outbox_listener.py:53-142` |
| Ciche zmiany stanu | luka | ~20 zdarzeń | niespójny | `update_term`, `cancel_transaction` |

### 12.2 Kluczowe wnioski (ważność)
1. **(krytyczny)** Hook w `notifications.service` daje pełne pokrycie bez zmian w domenach.
2. **(krytyczny)** Wywołania HTTP nie mogą działać w retry dispatchera. Potrzebna jest własna kolejka z backoffem.
3. **(wysoki)** Pierwsze maile to flow, których jeszcze nie ma (weryfikacja, reset), a nie istniejące bell.
4. **(wysoki)** „Najpierw bell” utrzymuje jedną ścieżkę i naprawia luki w aplikacji.
5. **(średni)** Prawo pozwala na powiadomienia bez zgody, ale granica serwis/marketing musi być pilnowana w szablonach.
6. **(średni)** Rezydencja danych to oś decyzji o dostawcy. Region wysyłki nie oznacza rezydencji.

### 12.3 SWOT
| Mocne strony | Słabe strony |
|---|---|
| Dojrzały outbox, wzorce portu i ACL-i, joby, zegar Warsaw, polskie teksty, `httpx` w zależnościach | Brak weryfikacji, resetu i preferencji. Adres nullable. Brak bazowego URL, polityki prywatności i ekranu ustawień. Retry dispatchera bez backoffu, brak purge |
| **Szanse** | **Zagrożenia** |
| Domknięcie wymian (confirm → punkty). Odzyskiwanie kont Google. Weryfikacja umożliwia auto-linking (D8). Przypomnienia (research handover) | Deliverability nowej subdomeny, limity darmowych planów, duplikaty na Mailgun, szara strefa MATCH, zmienność cenników, brak wytycznych UODO |

## 13. Wnioski i odpowiedź na pytanie

**Jak wdrożyć?** Nowy moduł `app/email` za portem `EmailSender` z adapterem HTTP przez `httpx` (Mailgun EU; przy miękkiej rezydencji Resend). Mail jest kolejkowany w tej samej transakcji co bell, w `notifications.service.create_notification(s)`, oraz bezpośrednio z flow auth. Wysyła go job z backoffem, idempotentnym kluczem i późnym sprawdzaniem adresu, weryfikacji, suppression i preferencji. Webhook dostawcy zasila suppression. Szablony Jinja2 PL (HTML + tekst) z datami z `clock`. Testy na `FakeEmailSender`, w dev Mailpit. Pewność: wysoka dla punktu wpięcia i wzorców, średnia dla kształtu kolejki i wyboru dostawcy (zależnego od decyzji o rezydencji).

**Kiedy wysyłać?** Zawsze maile konta: weryfikacja, reset, zmiana hasła. W MVP powiadomienia, które wymagają reakcji albo zmieniają zobowiązanie: przejęcie rzeczy, propozycja, akceptacja i odrzucenie wymiany, potwierdzenie po terminie, anulowanie, MATCH (najwyżej 1 dziennie na want). Zaraz po nich nowe bell dla zmiany terminu i anulowania przez drugą stronę. Później przypomnienia, czat z opóźnieniem i digesty. Nigdy: reakcje na własne akcje i treści o charakterze promocyjnym. Pewność: wysoka dla inwentarza, średnia dla priorytetów (ocena produktowa).

**Pewność ogólna: średnio-wysoka.** Kod: wysoka. Dostawcy: średnio-wysoka (ceny zmienne, część niezweryfikowana). Prawo: średnia.

## 14. Załączniki

### 14.1 Źródła
- **Ustalenia:** `analysis/findings/codebase-infra-outbox-notifications.md`, `codebase-infra-users-config.md`, `codebase-infra-adr009-fit.md`, `codebase-triggers-inventory.md`, `external-providers-matrix.md`, `external-providers-recommendation.md`, `external-practices-deliverability-dns.md`, `external-practices-compliance-engineering.md`, `prior-decisions-email-adrs.md`, `prior-decisions-frontend-surfaces.md`.
- **Wcześniejsze decyzje:** `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/decision-log.md` (ADR-004, 009, 010), `high-level-design.md`. `.maister/tasks/research/2026-11-25-google-login/outputs/decision-log.md` (ADR-002, 004, 005, D1–D14).
- **Dokumentacja projektu:** `.maister/docs/project/architecture.md` (L62, L411, L480, L534–541), `.maister/docs/INDEX.md` i standardy (error-handling, security, time, models, migrations, backend-testing, components, data-fetching).
- **Zewnętrzne (dostęp 2026-11-26):** cenniki i dokumentacja Mailgun, Resend, Postmark, SES, Brevo, MailerSend, Mailjet, Scaleway, SendGrid, SMTP2GO, EmailLabs. RFC 8058, 2369, 7489, 9989, 3463. support.google.com/a/answer/81126 i 14229414. senders.yahooinc.com. Microsoft Tech Community (5.05.2025). PKE art. 398 i UŚUDE (Dz.U. 2024 poz. 1513, 1222). RODO (EUR-Lex). Jinja2, MJML, Python `email.policy`, Mailpit (GitHub, Docker Hub). Pełne URL-e w plikach ustaleń.

### 14.2 Luki i niepewności
| Luka | Wpływ | Jak domknąć |
|---|---|---|
| Party Organization jako odbiorca | Właściciele rzeczy organizacji nie dostaną maila | Prześledzić `owner_party_id` i ustalić regułę |
| Brak wytycznych UODO i UKE | Pewność 6(1)(b) średnia | Konsultacja prawna. Przeczytać pismo UKE z 23.09.2025 |
| Ceny Brevo, Scaleway, MailerSend | Porównanie kosztów alternatyw | Sprawdzić w panelu przed wyborem |
| Deliverability bez benchmarku | Wybór na podstawie słabych danych | Test seed na własnej subdomenie |
| Zmienne Mailpit | Konfiguracja dev | Domyślne porty, weryfikacja przy implementacji |
| Soft-delete rzeczy lub grupy z otwartymi rezerwacjami | Możliwe ciche anulowania | Prześledzić przy C1 |
| `WANT_EXPIRING` ignoruje wyciszenie | Niespójność kanałów | Decyzja produktowa |
| Data odrzucania niezgodnej poczty przez Microsoft | Brak wpływu poniżej 5k dziennie | — |

### 14.3 Pewność per obszar
| Obszar | Pewność |
|---|---|
| Infrastruktura i punkt wpięcia | wysoka |
| Inwentarz triggerów | wysoka |
| Priorytety MVP | średnia (ocena produktowa) |
| Wybór dostawcy | średnio-wysoka (zależna od R1) |
| Ceny | średnia |
| DNS i nagłówki | wysoka |
| Prawo (PKE, RODO) | średnia |
| Kształt kolejki (`email_messages` + job) | średnia (ocena projektowa) |

### 14.4 Dane surowe
`analysis/findings/*.md`, `analysis/synthesis.md`, `planning/research-plan.md`, `planning/sources.md`.
