# Eksploracja rozwiązań — moduł wysyłki e-maili w aj

## TL;DR
- 8 obszarów decyzyjnych, 32 alternatywy (po 4 na obszar). Siedem tematów, w których badanie daje już jasną odpowiedź (port i adapter, tokeny, sekret wypisu, strony z maila, bazowy URL, DNS, brak wysyłki w requeście), opisano tylko jako ustalone założenia (§1.3).
- Rekomendowany zestaw: **Mailgun EU** (Resend przy miękkiej rezydencji) · **hook w `notifications.service` + własna kolejka `email_messages` w tej samej transakcji + job `_run_email_send`** · **opt-out per kategoria, domyślnie włączone po weryfikacji** · **weryfikacja jako warunek dla P/D, backfill kont Google, baner zamiast masowej wysyłki** · **Organization = SKIPPED w MVP, reset dla kont tylko-Google jako „ustaw hasło”** · **Jinja2 w repo** · **natychmiast + klucze throttlingu + cisza nocna, bez digestów w MVP** · **webhook tylko dla twardych bounce i skarg**.
- Pewność ogólna: średnio-wysoka. Najsłabsze ogniwa to rezydencja danych (decyzja właściciela) i domyślny stan kategorii (prawo, pewność średnia).

## Key Decisions
- Dostawca: Mailgun EU, a Resend tylko przy świadomie miękkiej rezydencji — dane wiadomości, logi i suppression Mailgun EU zostają w regionie. Brak natywnej idempotencji kompensuje klucz w `email_messages` (raport §5.3, F9).
- Punkt wpięcia: bezpośredni INSERT do `email_messages` w `create_notification(s)`, bez przeskoku przez `outbox_entries` — rekord kolejki zapisany w transakcji domeny sam jest transactional outboxem. Dispatcher nie ma backoffu i powtarza wszystkie handlery wpisu (F1, F2).
- Zgoda i preferencje: mail serwisowy bez zgody z PKE, opt-out per kategoria, domyślnie włączone po weryfikacji adresu (poza podsumowaniami organizatora) — art. 398 PKE dotyczy informacji handlowej, a zgoda wpleciona w rejestrację byłaby niedobrowolna (F11).
- Weryfikacja: wymagana dla P i D, backfill `email_verified_at` z tożsamości Google, istniejące konta z hasłem zachęcane banerem w panelu — bez masowej wysyłki na start (warm-up, F10).
- Odbiorca Organization: SKIPPED z `skip_reason` w MVP — reguła „założyciel/liderzy” wymaga osobnej decyzji produktowej i prześledzenia `owner_party_id`.
- Reset dla konta tylko-Google: pozwolić ustawić pierwsze hasło linkiem z maila — zamyka zaakceptowane ryzyko braku odzyskiwania. Kontrola nad skrzynką i tak daje dziś kontrolę nad kontem Google (Insight 5).
- Szablony: Jinja2 (`select_autoescape`, `StrictUndefined`) w repo, pary `html.j2`/`txt.j2` — teksty PL przechodzą code review, a zmiana dostawcy to tylko nowy adapter (F12).
- Batching: wysyłka natychmiastowa z kluczami throttlingu (`want_match:<want>:<dzień>`) i ciszą nocną 22–07, bez digestów w MVP — wszystkie rodzaje z MVP wymagają reakcji albo zmieniają zobowiązanie, a `send_after` zostawia drogę do koalescencji później.
- Webhooki w MVP: tylko `failed`/permanent i `complained` (HMAC) zasilające `email_suppressions`, bez śledzenia `delivered` — to minimum potrzebne do ochrony reputacji. Status dostarczenia nie zmienia żadnej decyzji w aplikacji.

## Open Questions / Risks
- Twarda czy miękka rezydencja danych w UE (R1). Od niej zależy wybór Mailgun EU lub Resend. Przy wymogu „dostawca z UE” w grę wchodzą Brevo albo Scaleway, z niezweryfikowanymi cenami i webhookami.
- Domyślne włączenie kategorii (zwłaszcza „Szukam”/MATCH, szara strefa prawna). Jeśli prawnik oceni MATCH jako bliższe marketingowi, kategoria „Szukam” przechodzi na opt-in (alternatywa 3D).
- Okno duplikatu na Mailgun (crash między 2xx a commitem). Akceptowane dla P, a dla T zamieniane na FAILED. Jeśli okaże się nieakceptowalne, to argument za Resend (`Idempotency-Key`).
- Darmowy limit Mailgun 100 dziennie. `EMAIL_DAILY_CAP` może przy większej grupie zacząć odrzucać (SKIPPED) powiadomienia. Wtedy plan Basic ($15).
- Rzeczy należące do Organization (`owner_party_id`) nie dostaną maila o przejęciu lub propozycji. To realna luka, jeśli organizacje wystawiają dużo rzeczy.
- Polityka prywatności (D14) jest warunkiem wstępnym każdego wariantu. Przy Resend musi wskazać transfer do USA.
- `WANT_EXPIRING` ignoruje `wants.notifications_enabled`. Mail powinien respektować wyciszenie (rekomendacja), ale to rozjazd z bell.

---

## 1. Przeformułowanie problemu

### 1.1 Pytanie badawcze
Jak wdrożyć moduł wysyłki e-maili w aj (FastAPI + Next.js) z użyciem zewnętrznego dostawcy i w jakich momentach aplikacji maile powinny być wysyłane?

### 1.2 Pytania „Jak moglibyśmy…” (HMW)
| # | HMW | Obszar | Źródło w badaniu |
|---|---|---|---|
| H1 | Jak moglibyśmy wybrać dostawcę, który spełnia RODO i nie dokłada pracy jednemu operatorowi? | D1 | F9, raport §5 |
| H2 | Jak moglibyśmy dowiedzieć się o każdym powiadomieniu bez zmian w domenach i bez dublowania bell przy awarii dostawcy? | D2 | F1, F2, Insight 1–2 |
| H3 | Jak moglibyśmy wysyłać powiadomienia, które ludzie chcą dostawać, zgodnie z PKE/RODO i bez zgody wymuszonej przy rejestracji? | D3 | F11, raport §9 |
| H4 | Jak moglibyśmy mieć pewne adresy, nie blokując istniejących użytkowników i nie psując reputacji nowej subdomeny? | D4 | F3, F10, Insight 4 |
| H5 | Jak moglibyśmy ustalić adresata, gdy party nie ma adresu (Organization, dziecko) albo nie ma hasła (konto tylko-Google)? | D5 | F4, Insight 5 |
| H6 | Jak moglibyśmy utrzymywać polskie szablony bezpiecznie (escaping), testowalnie i niezależnie od dostawcy? | D6 | F12 |
| H7 | Jak moglibyśmy nie zasypać ludzi mailami (MATCH co 60 s, noc), nie opóźniając rzeczy pilnych? | D7 | F8, F12 |
| H8 | Jak moglibyśmy chronić reputację nadawcy (bounce, skargi) najmniejszym możliwym kodem? | D8 | F10, raport §6.3 pkt 4 |

### 1.3 Obszary scalone lub pominięte (odpowiedź wynika już z badania)
| Temat | Ustalenie przyjęte jako założenie | Dlaczego bez alternatyw |
|---|---|---|
| Port i adapter | `EmailSender` (Protocol) + `set_sender()` w lifespanie; adapter HTTP przez `httpx`, bez SDK; `SmtpSender` tylko dla dev (Mailpit), `LogSender`, `FakeEmailSender` w testach | Trzy działające precedensy (`storage`, `text_guard`, `embeddings`). ADR-009 potwierdzony (F5, F6) |
| Tokeny weryfikacji i resetu | Losowe, jednorazowe, hashowane w DB, z `expires_at`/`used_at`. Nie JWT | Raport §3.2 pkt 3. JWT nie da się unieważnić (accepted risk Google) |
| Token wypisu | Podpis HMAC osobnym `EMAIL_LINK_SIGNING_SECRET`, nie kluczem wywiedzionym z `JWT_SECRET` | Rotacja `JWT_SECRET` zepsułaby linki w starych mailach |
| Wysyłka w requeście | Nigdy | ADR-009 i standard (R8) |
| Strony z maila | `/verify-email`, `/reset-password`, `/unsubscribe` w obu listach reserved slugs, poza `PROTECTED_PREFIXES`; GET bez efektów ubocznych, akcja przez POST | F13, skanery linków |
| Bazowy URL | `APP_PUBLIC_BASE_URL` | F14. Job w tle nie ma requestu |
| DNS | Subdomena `mail.<domena>`, SPF + DKIM 2048 + DMARC `none → quarantine → reject`, bez trackingu | Raport §10, pewność wysoka |

---

## 2. Obszary decyzyjne i alternatywy

Skala ocen: **wysoka / średnia / niska**. Przy „Ryzyku” wysoka = źle, przy pozostałych perspektywach wysoka = dobrze.

### D1. Dostawca

**Alternatywa 1A — Mailgun (region EU)**
- **Opis:** HTTP API `api.eu.mailgun.net` (POST form przez `httpx`). Domena założona w regionie EU, webhooki HMAC-SHA256, API suppression. Plan $0 (100 dziennie), $15 (10k), $35 (50k).
- **Mocne strony:** wiadomości, logi i suppression nie opuszczają regionu; najwyższy wynik ważony (81/100); dojrzałe webhooki z ochroną przed replay; liniowy cennik.
- **Słabe strony:** brak natywnej idempotencji, więc okno duplikatu po stronie aplikacji; logi u dostawcy tylko 1–5 dni; karta przy własnej domenie; spółka-matka Sinch, a Mailgun Technologies jest spółką z USA (teoretyczny CLOUD Act); DPA nieprzeczytane.
- **Najlepsza, gdy:** rezydencja w UE jest twardym wymogiem, a kraj siedziby dostawcy jest drugorzędny.
- **Dowody:** raport §5.2–5.3, F9, `external-providers-matrix.md`.

**Alternatywa 1B — Resend**
- **Opis:** HTTP API z Bearer, `Idempotency-Key` (24 h), webhooki Svix. Wysyłka może iść z eu-west-1, ale metadane i logi są w USA (DPA + SCC + DPF). $20 do 50k.
- **Mocne strony:** natywna idempotencja zamyka okno duplikatu; najlepszy DX; samoobsługowa rejestracja; jeden płaski plan do 50k.
- **Słabe strony:** transfer poza UE, który polityka prywatności musi opisać; darmowy plan 100 dziennie/3000 miesięcznie; zależność od DPF (ryzyko unieważnienia jak Privacy Shield).
- **Najlepsza, gdy:** właściciel akceptuje miękką rezydencję i ceni prostotę wdrożenia.
- **Dowody:** raport §5.4, F9.

**Alternatywa 1C — Brevo**
- **Opis:** dostawca z UE (FR), infrastruktura OVH/GCP w UE, idempotencja 30 min, 300 maili dziennie za darmo.
- **Mocne strony:** dostawca europejski; najwyższy darmowy limit dzienny; natywna idempotencja.
- **Słabe strony:** cennik powyżej darmowego planu niezweryfikowany; podpis webhooków niezweryfikowany; niepotwierdzona teza o amerykańskiej ścieżce transakcyjnej; platforma nastawiona na marketing (ryzyko mieszania strumieni).
- **Najlepsza, gdy:** wymagany jest dostawca z siedzibą w UE i darmowy limit ma znaczenie, a weryfikacja podprocesorów wypadnie pozytywnie.
- **Dowody:** raport §5.2 (80/100), §3.2 pkt 5.

**Alternatywa 1D — Scaleway Transactional Email**
- **Opis:** suwerenny dostawca z UE, tylko region fr-par, bez podprocesorów spoza UE. Około €2.4 przy 10k i €12.4 przy 50k.
- **Mocne strony:** najsilniejsza rezydencja; najtańszy przy wzroście.
- **Słabe strony:** webhooki w becie przez SNS, więc w praktyce trzeba odpytywać statusy; darmowe 300 miesięcznie; brak idempotencji; mniejszy ekosystem.
- **Najlepsza, gdy:** suwerenność jest wymogiem prawnym lub wizerunkowym, a operator akceptuje odpytywanie zamiast webhooków.
- **Dowody:** raport §5.2 (72/100), §5.4.

| Perspektywa | 1A Mailgun EU | 1B Resend | 1C Brevo | 1D Scaleway |
|---|---|---|---|---|
| Wykonalność techniczna | wysoka (HTTP form, HMAC) | wysoka (najprostsze API) | średnia (niezweryfikowane webhooki) | średnia (SNS/odpytywanie) |
| Wpływ na użytkownika | wysoki (EU) | średni (transfer US w polityce) | wysoki | wysoki |
| Prostota | średnia (dedupe w aplikacji) | wysoka | średnia | niska |
| Ryzyko | niskie–średnie (duplikaty) | średnie (DPF, transfer) | średnie (niewiadome ceny i ścieżki) | średnie (beta webhooków) |
| Skalowalność | wysoka (liniowy cennik) | wysoka (płasko do 50k) | niezweryfikowana | wysoka (najtańszy) |

**Rekomendacja D1:** **1A Mailgun EU**, warunkowo. Przy miękkiej rezydencji 1B. Adapter za portem sprawia, że zmiana później kosztuje jeden plik plus DNS. **Co odwróciłoby decyzję:** właściciel uznaje SCC/DPF za wystarczające → 1B; wymagany dostawca z siedzibą w UE → 1C po weryfikacji podprocesorów i cennika; okno duplikatu okazuje się nieakceptowalne → 1B.

---

### D2. Punkt wpięcia i kształt kolejki

**Alternatywa 2A — Hook w `notifications.service` + bezpośredni INSERT do `email_messages` + job wysyłki**
- **Opis:** `create_notification(s)` po zapisie bell wywołuje `notifications/infrastructure/email_acl.enqueue_for_notifications(...)`, a ta robi `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` w tej samej transakcji. Maile auth kolejkuje ACL z `users`/`auth`. Job `_run_email_send` (co ~1 min, `SKIP LOCKED`) rozwiązuje odbiorcę, sprawdza preferencje i suppression (późne wiązanie), renderuje i wysyła z backoffem.
- **Mocne strony:** pokrywa wszystkie 13 rodzajów bez zmian w domenach; dwa przeskoki zamiast trzech; backoff, `send_after` (cisza nocna, opóźnienia), throttling przez klucz; awaria dostawcy nie dotyka bell.
- **Słabe strony:** nowa tabela i job; moduł e-mail jest wywoływany synchronicznie z `notifications` (to tylko INSERT, ale błąd schematu zepsułby zapis bell); okno duplikatu na Mailgun.
- **Najlepsza, gdy:** chcemy pełnego pokrycia i kontroli nad czasem wysyłki przy minimum przeskoków.
- **Dowody:** Insight 1–2, raport §6.3–6.5, synteza §3.2 pkt 6.

**Alternatywa 2B — Hook w `notifications.service` → wpis `outbox_entries` → handler robi INSERT do `email_messages` → job wysyłki**
- **Opis:** jak 2A, ale `notifications.service` stawia `outbox.append("email.notification_requested")`, a jedyny handler tego typu w `begin_nested()` wstawia `email_messages`. HTTP dalej tylko w jobie.
- **Mocne strony:** jedna ścieżka asynchroniczności (outbox); `notifications` nie zna tabel modułu e-mail; błąd w module e-mail nie blokuje bell.
- **Słabe strony:** trzeci przeskok (+do 60 s); wzrost `outbox_entries` bez purge; ryzyko, że poller z filtrami przejmie `email.*`; dispatcher bez try/except w `run_forever`; więcej kodu bez nowej funkcji.
- **Najlepsza, gdy:** zespół twardo chce, żeby cała asynchroniczność szła przez outbox, albo zapis bell musi być odporny na awarie modułu e-mail.
- **Dowody:** raport §6.9, F1.

**Alternatywa 2C — Handler outboxa wywołujący dostawcę (oryginał ADR-009)**
- **Opis:** dodatkowy handler na istniejących typach zdarzeń outboxa wysyła mail bezpośrednio przez HTTP, dedupe `(outbox entry, recipient)`.
- **Mocne strony:** najmniej nowych tabel; zgodność z pierwotnym ADR.
- **Słabe strony:** pokrywa tylko 4 z 13 rodzajów (9 bell jest synchronicznych); błąd dostawcy dubluje bell, bo dispatcher powtarza wszystkie handlery wpisu; FAILED po ~5 min awarii; brak opóźnień i ciszy nocnej.
- **Najlepsza, gdy:** wszystkie bell przechodziłyby przez outbox, a dispatcher miałby backoff i izolację handlerów. Dziś żaden z tych warunków nie jest spełniony.
- **Dowody:** F1, F2, F6, synteza §3.2 pkt 1.

**Alternatywa 2D — Sweeper czytający tabelę `notifications` (bez hooka)**
- **Opis:** job co minutę czyta wiersze `notifications` nowsze niż znacznik (wzór okna matchera, `want_scan_markers`) i wstawia `email_messages`. Moduł `notifications` się nie zmienia, maile auth kolejkowane osobno.
- **Mocne strony:** zero zmian w `notifications.service`; naturalna koalescencja (zwinięte bell MATCH znikają przed skanem); luźne powiązanie.
- **Słabe strony:** znacznik i porządek po `created_at` wymagają ostrożności (wyścigi commitów, overlap jak w matcherze); usunięte lub zwinięte bell mogą zniknąć przed skanem, także te, które powinny pójść mailem; trzeci mechanizm przy outboxie i jobach; trudniejsze testy.
- **Najlepsza, gdy:** `notifications.service` jest nietykalny albo zależy nam na koalescencji bez kluczy.
- **Dowody:** wzór okna i znacznika z matchera (`architecture.md`, wants), `match_notifications.py:162-170` (zwijanie), Insight 1.

| Perspektywa | 2A bezpośrednio | 2B przez outbox | 2C handler HTTP | 2D sweeper |
|---|---|---|---|---|
| Wykonalność techniczna | wysoka (wzorce gotowe) | wysoka | wysoka, ale niepełna | średnia (znacznik, wyścigi) |
| Wpływ na użytkownika | wysoki (pełne pokrycie, cisza nocna) | wysoki (+do 60 s) | niski (4/13, duplikaty bell) | średni (możliwe pominięcia) |
| Prostota | wysoka (2 przeskoki) | średnia (3 przeskoki) | wysoka lokalnie, niska systemowo | średnia |
| Ryzyko | niskie (okno duplikatu) | niskie–średnie (filtry pollera, brak purge) | wysokie | średnie |
| Skalowalność | wysoka (batch, `SKIP LOCKED`) | średnia (wzrost outboxa) | niska | średnia |

**Rekomendacja D2:** **2A**. INSERT w `email_acl` ograniczyć do jednego zapytania bez odczytu adresu i preferencji, i pokryć testem, żeby ryzyko „błąd e-mail psuje bell” było praktycznie zerowe. **Co odwróciłoby decyzję:** wymóg, żeby zapis bell był odporny na każdą awarię modułu e-mail → 2B; zakaz zmian w `notifications.service` → 2D.

---

### D3. Model zgody i preferencji

**Alternatywa 3A — Opt-out per kategoria, domyślnie włączone po weryfikacji**
- **Opis:** `email_preferences(party_id, category, enabled)` z przełącznikiem „wszystkie”. Kategorie: Rezerwacje i wymiany, Spotkania i wydarzenia, Szukam, Wiadomości (później), Podsumowania organizatora (domyślnie wyłączone), Transakcyjne (bez wyłączania). Brak wiersza = domyślna wartość kategorii. List-Unsubscribe (RFC 8058) na P i D.
- **Mocne strony:** maile dochodzą do ludzi, którzy z nich korzystają (domknięcie wymian → punkty); zgodne z 6(1)(b) RODO i art. 398 PKE w interpretacji badania; brak wymuszonej zgody przy rejestracji (art. 7(4)); prosty model.
- **Słabe strony:** pewność prawna średnia (brak wytycznych UODO); MATCH to szara strefa; ryzyko skarg, jeśli ktoś zapomniał podać adres przy rejestracji.
- **Najlepsza, gdy:** priorytetem jest wartość kanału, a prawnik akceptuje kwalifikację „serwisowe”.
- **Dowody:** F11, raport §9.1–9.4, synteza §3.2 pkt 2.

**Alternatywa 3B — Opt-in per kategoria, domyślnie wyłączone (ADR-009)**
- **Opis:** każda kategoria P domyślnie wyłączona, włączenie w `/settings` zapisuje `email_consent_at` (i wersję tekstu).
- **Mocne strony:** najniższe ryzyko prawne; zero skarg na start; łagodny warm-up z naturalnie małym wolumenem.
- **Słabe strony:** większość ludzi nigdy nie włączy, więc kanał nie spełni celu (domknięcie wymian); traktuje mail serwisowy jak marketing; więcej UI (prośba o włączenie, banery).
- **Najlepsza, gdy:** prawnik oceni powiadomienia jako wymagające zgody albo właściciel chce maksymalnej ostrożności.
- **Dowody:** ADR-009 (`prior-decisions-email-adrs.md`), raport §6.1.

**Alternatywa 3C — Jeden globalny przełącznik (wszystko albo nic) + istniejący per-want**
- **Opis:** jedna flaga „Powiadomienia e-mail” (domyślnie włączona po weryfikacji) i istniejące `wants.notifications_enabled`. Bez kategorii.
- **Mocne strony:** najmniej kodu i UI; jedno pole, jeden token wypisu.
- **Słabe strony:** kto ma dość MATCH, traci też maile o rezerwacjach; wypis jednym kliknięciem wyłącza wszystko, co szkodzi wartości kanału; trudno później dodać kategorie bez migracji preferencji.
- **Najlepsza, gdy:** MVP zawiera tylko jedną kategorię (np. same rezerwacje).
- **Dowody:** standard minimal-implementation, `WantNotificationToggle.tsx:40` (F13).

**Alternatywa 3D — Hybryda: domyślnie włączone tylko kategorie wymagające reakcji**
- **Opis:** jak 3A, ale domyślnie włączone są tylko Rezerwacje i Spotkania (zobowiązania). Szukam i Wiadomości są opt-in z jawnym przełącznikiem (bez `email_consent_at`, chyba że prawnik tego wymaga).
- **Mocne strony:** szara strefa (MATCH) poza domyślną wysyłką; kluczowa wartość (wymiany) zachowana; mniejszy wolumen na start.
- **Słabe strony:** MATCH, czyli wartość „Szukam”, dociera tylko do zainteresowanych; dwa rodzaje domyślnych wartości komplikują komunikację w UI.
- **Najlepsza, gdy:** prawnik ma wątpliwości co do MATCH, ale nie co do rezerwacji.
- **Dowody:** raport §9.4 (MATCH szara strefa), external-practices-compliance-engineering tabela.

| Perspektywa | 3A opt-out | 3B opt-in | 3C globalny | 3D hybryda |
|---|---|---|---|---|
| Wykonalność techniczna | wysoka | wysoka | wysoka | wysoka |
| Wpływ na użytkownika | wysoki | niski (mało kto włączy) | średni (wypis wszystkiego) | wysoki–średni |
| Prostota | średnia | średnia (+zgody) | wysoka | średnia |
| Ryzyko | średnie (prawo) | niskie | średnie (prawo + utrata kanału) | niskie–średnie |
| Skalowalność | wysoka (nowe kategorie) | wysoka | niska | wysoka |

**Rekomendacja D3:** **3A**, z gotowością przejścia na **3D** wyłącznie dla kategorii „Szukam”. Zmiana jest tania (stała domyślna w `rules.py`). **Co odwróciłoby decyzję:** opinia prawna, że powiadomienia wymagają zgody → 3B; MATCH oceniony jako marketing → 3D.

---

### D4. Weryfikacja adresu jako warunek i wdrożenie dla istniejących kont

**Alternatywa 4A — Weryfikacja wymagana dla P/D, backfill Google, baner w panelu**
- **Opis:** `user_profiles.email_verified_at`, backfill dla kont z tożsamością Google `email_verified=true` i zgodnym adresem (`lower`). Konta z hasłem: mail weryfikacyjny przy rejestracji (A1) i baner „Potwierdź adres, żeby dostawać powiadomienia” z przyciskiem w panelu i w `/settings`. T (reset) idzie na adres konta niezależnie od weryfikacji.
- **Mocne strony:** nikt nie jest blokowany; wolumen rośnie organicznie (warm-up); zgodne z ADR-009 „tylko zweryfikowane”; odblokowuje auto-linking Google (D8).
- **Słabe strony:** część istniejących kont z hasłem nigdy nie zweryfikuje adresu i nie dostanie powiadomień; konta Google zaczynają dostawać maile bez akcji (trzeba ogłosić w aplikacji).
- **Najlepsza, gdy:** jest istniejąca baza użytkowników, a nowa subdomena wymaga warm-upu.
- **Dowody:** Insight 4, raport §8, F10 (warm-up).

**Alternatywa 4B — Twarda bramka: konto nieaktywne do weryfikacji**
- **Opis:** po rejestracji hasłem dostęp do panelu dopiero po kliknięciu linku. Istniejące konta z hasłem muszą zweryfikować adres przy następnym logowaniu.
- **Mocne strony:** 100% zweryfikowanych adresów; mniej fałszywych kont.
- **Słabe strony:** tarcie przy rejestracji i blokada istniejących użytkowników; zależność logowania od dostarczalności maila (awaria dostawcy blokuje rejestrację); duża zmiana poza zakresem pytania (kontrola dostępu); dotyka `AuthGuard`, proxy i sesji.
- **Najlepsza, gdy:** spam-konta są realnym problemem albo adres jest potrzebny do działania usługi.
- **Dowody:** F3, F13 (guardy), standard components (pełne przeładowanie po zmianie sesji).

**Alternatywa 4C — Jednorazowa kampania weryfikacyjna do wszystkich istniejących kont**
- **Opis:** jak 4A, ale w dniu startu job wysyła mail weryfikacyjny do każdego konta z hasłem i adresem.
- **Mocne strony:** szybko podnosi odsetek zweryfikowanych; nie trzeba czekać, aż użytkownik zobaczy baner.
- **Słabe strony:** masowa wysyłka z zimnej subdomeny, czyli klasyczny błąd warm-upu (F10); adresy wpisane „jak wpisano” (rodziny) mogą bounce'ować; darmowy limit 100 dziennie wymusza rozłożenie na dni; mail niezamówiony przez użytkownika.
- **Najlepsza, gdy:** baza jest mała (dziesiątki kont) i adresy są dobrej jakości.
- **Dowody:** raport §10 („żadnego masowego ogłaszamy maile”), F4.

**Alternatywa 4D — Bez osobnej weryfikacji: pierwszy mail serwisowy jako weryfikacja „w locie”**
- **Opis:** P idą na niezweryfikowane adresy. Każdy mail zawiera link „to mój adres”, a twardy bounce lub skarga oznacza adres jako zły.
- **Mocne strony:** najszybciej daje wartość; najmniej flow do zbudowania.
- **Słabe strony:** wysyłka na cudze adresy (literówki, podszywanie), czyli RODO i skargi; łamie ADR-009 i blokuje D8 (auto-linking wymaga prawdziwej weryfikacji); suppression jako jedyny sygnał psuje reputację.
- **Najlepsza, gdy:** nigdy w tym projekcie. Opisana dla porównania, bo to typowy skrót.
- **Dowody:** ADR-005 Google (`prior-decisions-email-adrs.md:73`), F3.

| Perspektywa | 4A baner | 4B twarda bramka | 4C kampania | 4D w locie |
|---|---|---|---|---|
| Wykonalność techniczna | wysoka | średnia (guardy, sesja) | wysoka | wysoka |
| Wpływ na użytkownika | wysoki (bez blokad) | niski (tarcie, blokada) | średni | średni (ryzyko maili do obcych) |
| Prostota | wysoka | niska | średnia | wysoka |
| Ryzyko | niskie | wysokie | średnie–wysokie (reputacja) | wysokie |
| Skalowalność | wysoka | średnia | niska (limity) | niska |

**Rekomendacja D4:** **4A**. **Co odwróciłoby decyzję:** pojawienie się spam-kont → 4B tylko dla nowych rejestracji; bardzo mała baza z dobrymi adresami → jednorazowe 4C rozłożone na tydzień, po fazie maili transakcyjnych.

---

### D5. Rozwiązanie odbiorcy (Organization, rodzina, konto tylko-Google)

Obszar ma trzy niezależne podpytania. Alternatywy dotyczą głównie Organization, a dwa pozostałe mają krótkie warianty.

**Alternatywa 5A — SKIPPED dla wszystkiego bez własnego zweryfikowanego adresu (MVP)**
- **Opis:** odbiorca = party bella. Person z adresem zweryfikowanym idzie mailem, a Organization, dziecko bez adresu, gość RSVP i adres niezweryfikowany dają `SKIPPED` z `skip_reason` (`no_address`, `unverified`, `organization`). Bell zostaje.
- **Mocne strony:** zero nowych reguł; nigdy nie wysyła do niewłaściwej osoby; `skip_reason` pozwala zmierzyć, jak duża jest luka Organization, zanim powstanie reguła.
- **Słabe strony:** właściciele rzeczy organizacji nie dostają maili o przejęciu lub propozycji.
- **Najlepsza, gdy:** udział rzeczy organizacji jest mały albo nieznany.
- **Dowody:** F4, raport §8 (wiersz Organization), `codebase-infra-users-config.md:15`.

**Alternatywa 5B — Organization → aktywni liderzy organizacji**
- **Opis:** dla party Organization ACL zwraca zweryfikowane adresy aktywnych liderów (klucz idempotencji `notification:<id>:<party_lidera>`).
- **Mocne strony:** zamyka lukę; odpowiada temu, kto faktycznie wydaje rzeczy.
- **Słabe strony:** reguła liderstwa organizacji nie jest prześledzona (gatherer tego nie zweryfikował); fan-out mnoży wolumen; wymaga decyzji, czy lider może wyłączyć maile organizacji osobno.
- **Najlepsza, gdy:** organizacje mają wielu współprowadzących i dużo rzeczy.
- **Dowody:** luka w raporcie §14.2. Wzór reguły membership w `groups/infrastructure/membership.py`.

**Alternatywa 5C — Organization → założyciel**
- **Opis:** jeden odbiorca, założyciel organizacji.
- **Mocne strony:** prosta reguła 1:1, bez fan-outu.
- **Słabe strony:** założyciel może już nie prowadzić organizacji; trzeba sprawdzić, czy „założyciel” jest trwale zapisany.
- **Najlepsza, gdy:** organizacje to w praktyce jednoosobowe profile.
- **Dowody:** `organizations/service.py:155` (`create_own_organization`).

**Alternatywa 5D — Organization dostaje własny adres kontaktowy**
- **Opis:** nowe pole adresu (z weryfikacją) w profilu organizacji.
- **Mocne strony:** czytelne, oddzielone od osób; działa jak skrzynka zespołu.
- **Słabe strony:** nowe pole, flow weryfikacji i UI w edytorze; rozszerza zakres; dwa źródła adresu.
- **Najlepsza, gdy:** organizacje są instytucjami (szkoła, fundacja) z adresem biura.
- **Dowody:** brak w kodzie. Wniosek z F4.

**Podpytanie: rodzina (dzieci bez adresu).** Warianty: (i) SKIPPED; (ii) przekierowanie do opiekuna `is_primary_contact`. **Rekomendacja:** (i) w MVP. Żaden trigger z MVP nie trafia do dziecka jako strony rezerwacji w sposób, który dziś byłby zrozumiały. (ii) przy pierwszym triggerze o dziecku (raport §8).

**Podpytanie: reset hasła dla konta tylko-Google (`password_hash IS NULL`).** Warianty: (i) pozwolić ustawić pierwsze hasło linkiem z maila (D4); (ii) neutralna odpowiedź bez maila; (iii) mail informacyjny „logujesz się przez Google”, bez linku do ustawienia hasła. **Rekomendacja:** (i), z tekstem maila, który wspomina o logowaniu przez Google. Odpowiedź API zawsze neutralna (202). Uzasadnienie: kontrola nad skrzynką i tak daje dziś kontrolę nad kontem Google, a (i) zamyka zaakceptowane ryzyko braku odzyskiwania. **Co odwróciłoby decyzję:** właściciel chce, żeby konta Google pozostały wyłącznie Google (np. dla polityki bezpieczeństwa) → (iii).

| Perspektywa | 5A SKIPPED | 5B liderzy | 5C założyciel | 5D adres org. |
|---|---|---|---|---|
| Wykonalność techniczna | wysoka | średnia (reguła nieprześledzona) | średnia | średnia |
| Wpływ na użytkownika | średni (luka) | wysoki | średni | wysoki |
| Prostota | wysoka | niska (fan-out) | wysoka | niska |
| Ryzyko | niskie | średnie (mail do byłych liderów) | średnie (nieaktualny założyciel) | średnie (zakres) |
| Skalowalność | wysoka | średnia | wysoka | wysoka |

**Rekomendacja D5:** **5A** w MVP, z pomiarem `skip_reason='organization'`. Po pomiarze decyzja między 5B i 5C (osobne zadanie). **Co odwróciłoby decyzję:** organizacje wystawiają znaczną część rzeczy już na starcie → 5B w etapie 2.

---

### D6. Szablony

**Alternatywa 6A — Jinja2 w repo, ręcznie napisany `base.html.j2`**
- **Opis:** nowa zależność `jinja2`; `select_autoescape(("html", "html.j2"))`, `StrictUndefined`; pary `*.html.j2` + `*.txt.j2`; jeden tabelkowy layout z inline CSS; daty przez `clock.format_term_when`.
- **Mocne strony:** escaping nazw rzeczy; teksty PL w code review i testach (`StrictUndefined` łapie brakujące zmienne); niezależność od dostawcy; dojrzała biblioteka.
- **Słabe strony:** nowa zależność; responsywny HTML pisany ręcznie wymaga testów w klientach.
- **Najlepsza, gdy:** 5–15 szablonów, jeden zespół, potrzebne podglądy w Mailpit.
- **Dowody:** F12, raport §6.7.

**Alternatywa 6B — Szablony u dostawcy (Mailgun/Resend templates)**
- **Opis:** aplikacja wysyła nazwę szablonu i zmienne, treść edytowana w panelu dostawcy.
- **Mocne strony:** zero zależności; edycja tekstu bez wdrożenia.
- **Słabe strony:** treść poza repo i code review; vendor lock-in (migracja = przepisanie szablonów); trudne testy; escaping i formaty dat zależne od dostawcy; dwa źródła prawdy.
- **Najlepsza, gdy:** treści zmienia osoba nietechniczna, często i bez wdrożeń.
- **Dowody:** F12, ADR-009 (szablony w repo).

**Alternatywa 6C — MJML (prekompilowany do Jinja2)**
- **Opis:** layout w MJML kompilowany narzędziem Node do HTML z placeholderami Jinja2 i commitowany.
- **Mocne strony:** najlepsza responsywność w trudnych klientach (Outlook).
- **Słabe strony:** krok budowania w Node dla backendu albo ręczny proces; porty Pythona nieoficjalne; nieuzasadnione przy kilku szablonach.
- **Najlepsza, gdy:** szablonów jest kilkadziesiąt i są graficznie złożone.
- **Dowody:** `external-practices-compliance-engineering.md` §4.2.

**Alternatywa 6D — Stdlib (`string.Template` + ręczne `html.escape`)**
- **Opis:** bez nowej zależności, szablony jako pliki z placeholderami `$name`.
- **Mocne strony:** zero zależności (standard minimal dependencies).
- **Słabe strony:** escaping ręczny, więc łatwo o błąd XSS-like w HTML maila; brak pętli i warunków (listy rzeczy, digest później); brak `StrictUndefined`.
- **Najlepsza, gdy:** 2–3 szablony bez list i warunków.
- **Dowody:** F12 (autoescape), standard conventions.

| Perspektywa | 6A Jinja2 | 6B u dostawcy | 6C MJML | 6D stdlib |
|---|---|---|---|---|
| Wykonalność techniczna | wysoka | wysoka | średnia | wysoka |
| Wpływ na użytkownika | wysoki | wysoki | wysoki | średni |
| Prostota | wysoka | średnia (dwa źródła) | niska | średnia (ręczny escaping) |
| Ryzyko | niskie | średnie (lock-in) | średnie | średnie (escaping) |
| Skalowalność | wysoka | średnia | wysoka | niska |

**Rekomendacja D6:** **6A**. **Co odwróciłoby decyzję:** potrzeba edycji treści przez osobę nietechniczną bez wdrożeń → 6B tylko dla treści, z layoutem w repo.

---

### D7. Batching, digesty i czas wysyłki

**Alternatywa 7A — Natychmiast + klucze throttlingu + cisza nocna; bez digestów w MVP**
- **Opis:** każdy kwalifikowany bell = jeden mail. MATCH dławiony kluczem `want_match:<want_id>:<dzień Warsaw>` (najwyżej 1 dziennie na want). P/D w ciszy nocnej 22:00–07:00 dostają `send_after = 07:00`. T zawsze natychmiast. `EMAIL_DAILY_CAP` dla warm-upu.
- **Mocne strony:** najmniej kodu; rodzaje z MVP są pilne lub zmieniają zobowiązanie (F12: nie batchować pilnych); throttling „za darmo” z klucza unikalności; `send_after` zostawia drogę do koalescencji później.
- **Słabe strony:** aktywny wymieniacz może dostać kilka maili dziennie (przejęcia kilku rzeczy); MATCH dla wielu wantów to kilka maili.
- **Najlepsza, gdy:** wolumen na osobę jest niski, a zdarzenia wymagają reakcji.
- **Dowody:** raport §6.4, F8, F12.

**Alternatywa 7B — Dzienny digest dla wszystkich P**
- **Opis:** jeden mail dziennie na osobę ze wszystkimi niewysłanymi powiadomieniami (rano, Warsaw).
- **Mocne strony:** najmniej maili; najmniejsze ryzyko skarg.
- **Słabe strony:** propozycja wymiany lub przejęcie dzień przed terminem trafia za późno; B6 (potwierdź po terminie) traci sens; nowy szablon zbiorczy i job digestu.
- **Najlepsza, gdy:** zdarzenia są informacyjne, a nie wymagające reakcji.
- **Dowody:** F12 (digest tylko dla „ważnych, ale niepilnych”).

**Alternatywa 7C — Okno koalescencji per osoba (np. 10 min)**
- **Opis:** pierwszy mail P dla osoby dostaje `send_after = now + 10 min`. Kolejne w oknie dołączają do tego samego maila, a przed wysyłką sprawdzany jest `read_at` bell (przeczytane w aplikacji = pomiń).
- **Mocne strony:** mniej maili przy seriach zdarzeń; nie wysyła o tym, co już widziano w aplikacji; dobry fundament pod czat (C6).
- **Słabe strony:** szablon zbiorczy i logika łączenia już w MVP; 10 min opóźnienia dla każdego P; potrzebny `notifications_acl` do `read_at`.
- **Najlepsza, gdy:** użytkownicy są aktywni w aplikacji i dostają serie zdarzeń.
- **Dowody:** F12 (okna 5–15 min, „tylko gdy nieprzeczytane”), raport §6.2 (`notifications_acl.py`).

**Alternatywa 7D — Digest tylko dla MATCH (dzienny, przez wszystkie wanty)**
- **Opis:** rezerwacje natychmiast (jak 7A), a MATCH zbierany w jeden dzienny mail „Nowe dopasowania” dla wszystkich wantów osoby.
- **Mocne strony:** rozwiązuje najczęstszy strumień (matcher co 60 s) jednym mailem; reszta pilna bez opóźnień.
- **Słabe strony:** szablon zbiorczy i job digestu już w MVP; MATCH traci „świeżość” (rzecz może zniknąć do rana).
- **Najlepsza, gdy:** ludzie mają wiele aktywnych wantów (limit 30).
- **Dowody:** `external-practices-compliance-engineering.md` §6 (MATCH: per want dziennie albo dzienny digest).

| Perspektywa | 7A natychmiast + klucze | 7B dzienny digest | 7C okno 10 min | 7D digest MATCH |
|---|---|---|---|---|
| Wykonalność techniczna | wysoka | średnia | średnia | średnia |
| Wpływ na użytkownika | wysoki (pilne na czas) | niski (spóźnione) | wysoki–średni | wysoki |
| Prostota | wysoka | średnia | niska | średnia |
| Ryzyko | niskie–średnie (seria maili) | średnie (przegapione terminy) | niskie | niskie |
| Skalowalność | średnia | wysoka | wysoka | wysoka |

**Rekomendacja D7:** **7A**. Po pomiarze wolumenu w etapie 2 rozważyć 7D (gdy ludzie mają wiele wantów) albo 7C (przy czacie). **Co odwróciłoby decyzję:** pomiar pokaże >3 maile dziennie na aktywną osobę albo skargi na strumieniu powiadomień → 7C; mediana aktywnych wantów na osobę >3 → 7D.

---

### D8. Webhooki, bounce i suppression w MVP

**Alternatywa 8A — Pełny webhook (`delivered`, `failed`, `complained`) + status w `email_messages`**
- **Opis:** `POST /api/email/webhooks/mailgun` z HMAC i ochroną przed replay. Aktualizuje status po `provider_message_id` (DELIVERED/BOUNCED/COMPLAINED). Bounce i skarga zasilają `email_suppressions`, skarga wyłącza też kategorię.
- **Mocne strony:** pełna widoczność dostarczania we własnym logu (logi Mailgun trzymane 1–5 dni); diagnoza „nie dostałem maila”.
- **Słabe strony:** dużo zdarzeń `delivered` (jeden na mail) bez wpływu na decyzje aplikacji; więcej kodu i testów.
- **Najlepsza, gdy:** wsparcie użytkowników często musi diagnozować dostarczenie.
- **Dowody:** raport §6.3 pkt 4, §5.3.

**Alternatywa 8B — Webhook tylko dla `failed`/permanent i `complained`**
- **Opis:** ten sam endpoint i HMAC, ale subskrybowane są tylko twarde bounce i skargi. Efekt: wiersz w `email_suppressions`, a przy skardze wyłączenie kategorii. `email_messages` kończy na SENT.
- **Mocne strony:** minimum chroniące reputację (spam rate <0.3%, nieistniejące adresy); mały ruch webhooków; zgodne z minimal-implementation.
- **Słabe strony:** brak statusu „dostarczono” we własnym logu (diagnoza w panelu dostawcy, tylko 1–5 dni).
- **Najlepsza, gdy:** jeden operator, mały wolumen, priorytetem jest reputacja, a nie raportowanie.
- **Dowody:** F10, raport §9.3.

**Alternatywa 8C — Bez webhooków: suppression po stronie dostawcy**
- **Opis:** Mailgun i Resend same blokują wysyłkę na adresy z bounce i skargami. Aplikacja widzi tylko wynik API.
- **Mocne strony:** zero kodu webhooka, zero publicznego endpointu i sekretu.
- **Słabe strony:** aplikacja nie wie o skargach (nie wyłączy kategorii, nie pokaże w `/settings`, że adres nie działa); lista suppression ginie przy zmianie dostawcy; job dalej renderuje i wysyła maile, które dostawca odrzuci po cichu.
- **Najlepsza, gdy:** bardzo wczesny pilot (tylko maile transakcyjne, etap 1).
- **Dowody:** `external-providers-matrix.md` (suppression u dostawcy), raport §9.3.

**Alternatywa 8D — Job odpytujący API zdarzeń dostawcy**
- **Opis:** zamiast webhooka job co kilka minut pobiera zdarzenia `failed`/`complained` (Events API) od znacznika.
- **Mocne strony:** brak publicznego endpointu; działa też u dostawców z webhookami w becie (Scaleway).
- **Słabe strony:** znacznik i stronicowanie; retencja zdarzeń u dostawcy (1–5 dni Mailgun), więc dłuższa awaria joba gubi zdarzenia; kod zależny od dostawcy.
- **Najlepsza, gdy:** wybrano dostawcę bez stabilnych webhooków (1D).
- **Dowody:** raport §5.4 (Scaleway: odpytywanie statusów).

| Perspektywa | 8A pełny | 8B bounce + skargi | 8C bez webhooków | 8D odpytywanie |
|---|---|---|---|---|
| Wykonalność techniczna | wysoka | wysoka | wysoka | średnia |
| Wpływ na użytkownika | wysoki (diagnoza) | wysoki (adres nie działa → informacja) | niski | średni |
| Prostota | średnia | wysoka | wysoka | niska |
| Ryzyko | niskie | niskie | średnie (skargi niewidoczne) | średnie (utrata zdarzeń) |
| Skalowalność | średnia (ruch `delivered`) | wysoka | wysoka | średnia |

**Rekomendacja D8:** **8B**. W etapie 1 (tylko T, mały wolumen) dopuszczalne **8C** jako stan przejściowy, ale 8B musi działać przed włączeniem pierwszej kategorii P. **Co odwróciłoby decyzję:** częste zgłoszenia „nie doszło” → 8A (dodanie `delivered` to tylko subskrypcja i jedna gałąź); wybór 1D → 8D.

---

## 3. Zbiorcza analiza kompromisów

| Obszar | Rekomendacja | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność | Główny kompromis |
|---|---|---|---|---|---|---|---|
| D1 Dostawca | 1A Mailgun EU (warunkowo) | wysoka | wysoki | średnia | niskie–średnie | wysoka | dedupe w aplikacji zamiast `Idempotency-Key` |
| D2 Wpięcie i kolejka | 2A bezpośrednio do `email_messages` | wysoka | wysoki | wysoka | niskie | wysoka | `notifications` zna ACL modułu e-mail |
| D3 Zgoda i preferencje | 3A opt-out per kategoria (3D dla „Szukam” w odwodzie) | wysoka | wysoki | średnia | średnie | wysoka | pewność prawna średnia |
| D4 Weryfikacja | 4A baner + backfill Google | wysoka | wysoki | wysoka | niskie | wysoka | część kont nigdy nie zweryfikuje adresu |
| D5 Odbiorca | 5A SKIPPED + pomiar; reset Google = ustaw hasło | wysoka | średni | wysoka | niskie | wysoka | luka dla rzeczy organizacji |
| D6 Szablony | 6A Jinja2 w repo | wysoka | wysoki | wysoka | niskie | wysoka | nowa zależność |
| D7 Batching | 7A natychmiast + klucze + cisza nocna | wysoka | wysoki | wysoka | niskie–średnie | średnia | możliwa seria maili u aktywnych |
| D8 Webhooki | 8B bounce + skargi | wysoka | wysoki | wysoka | niskie | wysoka | brak statusu „dostarczono” |

**Spójność zestawu:** rekomendacje wzajemnie się wspierają. 2A daje `send_after` i klucz idempotencji, na których opierają się 7A (cisza nocna, throttling) i 1A (kompensacja braku idempotencji). 4A i 3A razem sprawiają, że domyślne włączenie dotyczy tylko adresów potwierdzonych przez właściciela. 8B zasila `email_suppressions`, które job sprawdza w ramach tego samego późnego wiązania co preferencje.

## 4. Rekomendowane podejście

**Zestaw:** Mailgun EU za portem `EmailSender` (adapter `httpx`) · moduł `app/email` z kolejką `email_messages` zapisywaną w transakcji bell (`notifications.service`) i flow auth, wysyłaną przez `_run_email_send` z backoffem i późnym wiązaniem · preferencje opt-out per kategoria, domyślnie włączone po weryfikacji · weryfikacja adresu wymagana dla P/D, backfill kont Google, baner w panelu · odbiorcy bez adresu i Organization = SKIPPED z `skip_reason`, reset dla kont tylko-Google jako „ustaw pierwsze hasło” · szablony Jinja2 w repo · wysyłka natychmiastowa z throttlingiem MATCH i ciszą nocną · webhook HMAC tylko dla twardych bounce i skarg.

**Główne uzasadnienie:** zestaw pokrywa wszystkie istniejące bell bez zmian w domenach. Używa wyłącznie wzorców, które już działają w aj (port + `set_x()`, job + `SKIP LOCKED`, ACL z testem granic, bramkowanie ustawieniem). Każdy element, który można odłożyć (digesty, statusy dostarczenia, reguła Organization), został odłożony, a ścieżka rozbudowy (`send_after`, `skip_reason`, subskrypcja `delivered`) jest wbudowana.

**Etapy (zgodne z raportem §11):** etap 1: moduł, kolejka, Mailgun + SMTP-dev + log + fake, DNS, A1–A3, `/verify-email`, `/reset-password`, backfill Google, 8C przejściowo · etap 2: `email_preferences`, `/settings`, RFC 8058, hook w `notifications.service`, 8B, B1/B3–B6/B8/B9 · etap 3: nowe bell C1, C2 (zasada „najpierw bell”).

**Przyjęte kompromisy:**
- Możliwy duplikat P po crashu między 2xx a commitem (Mailgun). Dla T zamieniany na FAILED.
- `notifications.service` wywołuje ACL modułu e-mail w tej samej transakcji (sprzężenie w zamian za brak trzeciego przeskoku).
- Właściciele rzeczy organizacji i konta z niezweryfikowanym adresem nie dostaną powiadomień w MVP.
- Brak statusu dostarczenia we własnym logu.
- Aktywni użytkownicy mogą dostać kilka maili dziennie.

**Kluczowe założenia (jeśli nieprawdziwe, rekomendacja się zmienia):**
1. Rezydencja w UE jest twarda (inaczej Resend).
2. Prawnik akceptuje kwalifikację powiadomień jako serwisowych (inaczej 3B lub 3D).
3. Wolumen na start mieści się w ~100 dziennie albo właściciel akceptuje $15 miesięcznie.
4. Rzeczy organizacji to mniejszość wystawień (inaczej 5B już w etapie 2).
5. Mediana liczby maili na aktywną osobę dziennie jest niska (inaczej 7C/7D).
6. Polityka prywatności (D14) powstanie przed etapem 2.

**Pewność rekomendacji:** średnio-wysoka. Wysoka dla D2, D4, D6, średnio-wysoka dla D1, D7, D8, średnia dla D3 i D5.

## 5. Dlaczego nie pozostałe

| Alternatywa | Dlaczego nie |
|---|---|
| 1B Resend | Metadane i logi w USA. Wybór tylko przy świadomie miękkiej rezydencji, wtedy wygrywa idempotencją |
| 1C Brevo | Remis punktowy z Mailgun, ale cennik, podpis webhooków i ścieżka transakcyjna niezweryfikowane |
| 1D Scaleway | Webhooki w becie przez SNS, więc trzeba odpytywać. Za dużo pracy przy jednym operatorze |
| 2B przez outbox | Trzeci przeskok, wzrost outboxa bez purge i ryzyko przejęcia `email.*` przez poller filtrów, bez nowej funkcji |
| 2C handler HTTP | Pokrywa 4/13 rodzajów, dubluje bell przy błędzie dostawcy, FAILED po ~5 min |
| 2D sweeper | Znacznik i wyścigi commitów. Zwinięte bell mogą zniknąć przed skanem. Trzeci mechanizm asynchroniczny |
| 3B opt-in | Kanał nie spełniłby celu (domknięcie wymian), a prawo w interpretacji badania tego nie wymaga |
| 3C globalny | Wypis z MATCH wyłącza maile o rezerwacjach. Trudno później dodać kategorie |
| 3D hybryda | Dobra rezerwa, ale bez opinii prawnej odcina „Szukam” od głównej wartości. Trzymana w odwodzie |
| 4B twarda bramka | Blokuje istniejących użytkowników, uzależnia rejestrację od dostarczalności, wychodzi poza zakres |
| 4C kampania | Masowa wysyłka z zimnej subdomeny, sprzeczna z planem warm-upu |
| 4D w locie | Maile na niezweryfikowane (potencjalnie cudze) adresy. Blokuje D8 |
| 5B liderzy | Reguła nieprześledzona, fan-out. Najpierw pomiar `skip_reason` |
| 5C założyciel | Założyciel może być nieaktualny. Ta sama potrzeba pomiaru co 5B |
| 5D adres organizacji | Nowe pole i flow weryfikacji, czyli rozszerzenie zakresu |
| 6B u dostawcy | Treść poza code review, vendor lock-in, trudne testy |
| 6C MJML | Krok budowania w Node dla kilku szablonów |
| 6D stdlib | Ręczny escaping i brak pętli to ryzyko błędów przy listach i przyszłych digestach |
| 7B dzienny digest | Pilne zdarzenia (propozycja, przejęcie przed terminem) przychodzą za późno |
| 7C okno 10 min | Logika łączenia i szablon zbiorczy przed pomiarem potrzeby |
| 7D digest MATCH | Job digestu przed pomiarem. Klucz dzienny per want daje podobny efekt taniej |
| 8A pełny webhook | Ruch `delivered` bez wpływu na decyzje aplikacji |
| 8C bez webhooków | Aplikacja nie widzi skarg. Lista suppression ginie przy zmianie dostawcy. Dopuszczalne tylko w etapie 1 |
| 8D odpytywanie | Znacznik, stronicowanie, utrata zdarzeń przy krótkiej retencji. Sensowne tylko przy 1D |

## 6. Granice zakresu i pomysły odłożone

### 6.1 Klasyfikacja
| Element | Klasa | Uzasadnienie |
|---|---|---|
| Moduł `app/email`, kolejka, job, port, adaptery, DNS | W zakresie | Rdzeń pytania „jak wdrożyć” |
| A1–A3 (weryfikacja, reset, hasło zmienione) | W zakresie | Warunek dla P. Pierwsze maile |
| B1, B3–B6, B8, B9 | W zakresie | Pytanie „w jakich momentach” |
| Preferencje, `/settings`, wypis RFC 8058, suppression | W zakresie | Wymóg deliverability i prawa |
| C1, C2 (nowe bell: anulowanie przez drugą stronę, zmiana terminu) | Stretch | Wymagają nowego `NotificationKind`. Luka także w aplikacji |
| A4 powitanie (połączone z A1) | Stretch | Opcjonalne |
| Reguła odbiorcy Organization (5B/5C) | Stretch | Po pomiarze `skip_reason` |
| Purge `email_messages` (90 dni) | Stretch | Retencja. Wymóg RODO przed dużym wolumenem |
| Purge `outbox_entries`, guard `run_forever` | Poza zakresem (sąsiednie) | Problem outboxa, nie maila. Ujawniony przy badaniu |
| Marketing, newslettery, re-engagement, SUGGESTION/SIMILAR mailem | Poza zakresem | Wymagają zgody z art. 398 PKE, wykluczone briefem |
| SMS, push | Poza zakresem | Wykluczone briefem |

### 6.2 Pomysły odłożone
| Pomysł | Dlaczego warto wrócić |
|---|---|
| Przypomnienie wieczorem przed terminem lub wydarzeniem (C4) | Największa wartość po MVP według researchu handover |
| Mail o nowej wiadomości czatu z opóźnieniem i tylko gdy nieprzeczytana (C6) | Najczęstsza prośba w podobnych produktach. Wymaga 7C |
| Digest organizatora (B11, B12, C8, C11, C12) | Opt-in. Mniej wchodzenia do aplikacji dla organizatorów |
| Digest MATCH (7D) | Gdy ludzie mają wiele aktywnych wantów |
| Status `delivered` (8A) | Gdy wsparcie będzie diagnozować dostarczenie |
| Zmiana adresu e-mail (A7) z mailem na stary i nowy adres | Brak flow. Naturalny następny krok po weryfikacji |
| Auto-linking Google po weryfikacji (D8 Google) | Weryfikacja go odblokowuje, ale to osobna decyzja bezpieczeństwa |
| Zaproszenie opiekuna z ustawieniem hasła zamiast hasła wpisanego przez innego opiekuna (A8) | Poprawa bezpieczeństwa rodzin |
| Mail po odrzuceniu mediów przez moderację (C15), potwierdzenie płatności (C9) | Najpierw bell (zasada „najpierw bell”) |
| `mailto:` w List-Unsubscribe i poczta przychodząca | Wymaga routingu przychodzącego. HTTPS wystarczy |
| Podgląd szablonów w panelu admina, log wysyłek w UI | Wygoda operatora. Dziś wystarczy Mailpit i SQL |
| Wersje językowe szablonów | Aplikacja jest tylko po polsku |
| Usuwanie konta (D10) z obsługą `email_suppressions` (hash) | Wymóg RODO, osobny temat |
