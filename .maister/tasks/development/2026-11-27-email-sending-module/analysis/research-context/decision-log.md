# Decision Log — moduł wysyłki e-maili `app/email`

## TL;DR
- 10 decyzji, wszystkie w statusie **Accepted**. Najważniejsze dla architektury: punkt wpięcia w `notifications.service` z kolejką `email_messages` w transakcji domeny (ADR-003) i job z późnym wiązaniem (ADR-004).
- Wobec bazowej decyzji z researchu handover (2026-10-13, dalej **„handover ADR-009”**): kierunek **potwierdzony**, punkt wpięcia, forma dedupe i model zgody **zastąpione**, uwaga o pollerze moderacji **nieaktualna** (ADR-001).
- Jedno odejście od rekomendacji eksploracji: pełny webhook 8A zamiast 8B (ADR-010), z wyboru użytkownika.
- Najsłabsze ogniwa: domyślne włączenie kategorii (prawo, ADR-005) i okno duplikatu na Mailgun (ADR-002/004).

## Key Decisions
- ADR-001 Relacja do handover ADR-009 — część potwierdzona, część zastąpiona. Nowy log to aktualne źródło prawdy dla e-maili.
- ADR-002 Mailgun EU przez `httpx` za portem `EmailSender` — rezydencja w UE, brak SDK, wymiana dostawcy to jeden adapter.
- ADR-003 Hook w `notifications.service` + `email_messages` w tej samej transakcji — pokrywa 13/13 rodzajów bell, dwa przeskoki zamiast trzech.
- ADR-004 Job wysyłki z późnym wiązaniem, backoffem i polityką zawieszonego SENDING — dispatcher outboxa nie ma backoffu i dubluje handlery.
- ADR-005 Opt-out per kategoria, domyślnie włączone po weryfikacji, RFC 8058 — mail serwisowy nie wymaga zgody z art. 398 PKE.
- ADR-006 `email_verified_at` + backfill Google + losowe hashowane tokeny w `account_tokens` + baner — weryfikacja bez blokowania i bez masowej wysyłki.
- ADR-007 SKIPPED z `skip_reason` dla odbiorców bez zweryfikowanego adresu. Reset konta tylko-Google ustawia pierwsze hasło — nigdy nie wysyłamy do niewłaściwej osoby, a odzyskiwanie się domyka.
- ADR-008 Jinja2 w repo z generycznym szablonem powiadomienia ze snapshotu bell — escaping, code review, zero ACL-i do domen dla treści.
- ADR-009 Natychmiast + klucz dzienny MATCH + cisza nocna + `EMAIL_DAILY_CAP`, bez digestów — rodzaje MVP są pilne.
- ADR-010 Pełny webhook Mailgun (delivered/failed/complained) z HMAC i ochroną przed replay — własny log dostarczenia przy 1–5-dniowej retencji u dostawcy.

## Open Questions / Risks
- Opinia prawna o domyślnym włączeniu „Szukam” (ADR-005). Gotowa ścieżka: jedna stała.
- DPA Mailgun/Sinch nieprzeczytane (ADR-002).
- Replay-cache webhooka w pamięci procesu zakłada jedną instancję backendu (ADR-010).
- Pole `topic_id` w `NotificationEntry` do potwierdzenia w specyfikacji (ADR-009).

---

## ADR-001: Relacja do handover ADR-009 (potwierdzenia, zmiany, zastąpienia)

### Status
Accepted. Handover ADR-009 („Email as an additional outbox handler behind a provider-agnostic port”, `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/decision-log.md`) przechodzi w status **Amended — częściowo zastąpiony przez ADR-002…ADR-010 tego logu**.

### Context
Handover ADR-009 zakładał, że e-mail będzie dodatkowym handlerem na istniejących zdarzeniach outboxa (bez zmian w domenach), z opt-in `email_reminders_enabled` i `email_consent_at`, dedupe `(outbox entry, recipient)` i adresami dostępnymi dla wszystkich stron. Badanie pokazało, że 9 z 13 rodzajów bell nie przechodzi przez outbox, dispatcher powtarza wszystkie handlery wpisu bez backoffu, a wiele party nie ma adresu (F1, F2, F4, F6). Fazy 1–3 handovera nie powstały.

### Decision Drivers
- Ciągłość decyzji: przyszły czytelnik musi wiedzieć, co z handover ADR-009 nadal obowiązuje
- Nowe fakty z kodu (F1, F2, F4) i z prawa (F11)
- Unikanie dwóch sprzecznych źródeł prawdy

### Considered Options
1. Element po elemencie: oznaczyć każdy punkt handover ADR-009 jako potwierdzony, zmieniony albo nieaktualny, i wskazać zastępujący ADR
2. Całkowicie zastąpić handover ADR-009 bez rozbioru
3. Pozostawić handover ADR-009 bez zmian i dopisać wyjątki

### Decision Outcome
Chosen option: **1**, bo większość handover ADR-009 nadal obowiązuje (port, adapter, brak wysyłki w requeście). Pełne zastąpienie zgubiłoby to uzasadnienie.

| Element handover ADR-009 | Werdykt | Gdzie teraz |
|---|---|---|
| Port `EmailSender` + adapter HTTP przez `httpx`, adapter log | **Potwierdzony** (+ `SmtpSender` dev, `FakeEmailSender` testy) | ADR-002 |
| Brak SDK dostawcy i SMTP w produkcji | **Potwierdzony** | ADR-002 |
| Brak wysyłki synchronicznej w requeście | **Potwierdzony** | ADR-003, ADR-004 |
| „Dodatkowy handler na istniejących zdarzeniach outboxa, bez zmian domeny” | **Zastąpiony**: hook w `notifications.service` + kolejka `email_messages` | ADR-003 |
| Dedupe `(outbox entry, recipient)` w `email_deliveries` | **Zastąpiony w formie**: `email_messages.idempotency_key` (`notification:<id>`, `auth:<token_id>`, `want_match:<want>:<dzień>`) | ADR-003, ADR-009 |
| Tylko zweryfikowane adresy | **Potwierdzony i doprecyzowany**: `email_verified_at`, backfill Google, SKIPPED z `skip_reason`; T (reset) na adres konta niezależnie od weryfikacji | ADR-006, ADR-007 |
| „Adresy istnieją dla wszystkich stron handoveru” | **Nieaktualny** (Organization, dzieci, goście RSVP bez adresu) | ADR-007 |
| Opt-in `email_reminders_enabled` default false + `email_consent_at` | **Zastąpiony**: opt-out per kategoria po weryfikacji, bez zgody PKE. Zgoda z wersją tekstu tylko dla przyszłego marketingu | ADR-005 |
| Podpisany wypis + `List-Unsubscribe` | **Potwierdzony i rozszerzony**: RFC 8058 one-click, osobny `EMAIL_LINK_SIGNING_SECRET` | ADR-005 |
| Nazwy 7 ustawień | **Potwierdzone i uzupełnione** o `EMAIL_BACKEND`, `EMAIL_REPLY_TO_ADDRESS`, `EMAIL_WEBHOOK_SIGNING_KEY`, `EMAIL_DAILY_CAP`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT` | ADR-002, HLD §6.2 |
| „Moderation worker's outbox poller must not claim these events” | **Nieaktualny**: maile nie przechodzą przez `outbox_entries` | ADR-003 |
| Gating do fazy 3 handovera | **Zastąpiony** etapami 1–3 tego projektu (najpierw maile konta) | HLD §10 |

### Consequences

#### Good
- Jedno aktualne źródło prawdy, a zachowane uzasadnienia nie giną.
- `architecture.md` i przyszły ADR projektu mogą cytować tę tabelę wprost.

#### Bad
- Dwa logi trzeba czytać razem, dopóki `architecture.md` nie zostanie zaktualizowany (rekomendacja R8).
- Kolizja numeracji: „ADR-009” w tym logu to inna decyzja niż handover ADR-009. Odwołania zawsze z przedrostkiem „handover”.

---

## ADR-002: Mailgun EU przez `httpx` za portem `EmailSender`

### Status
Accepted

### Context
Potrzebny jest zewnętrzny dostawca dla odbiorców w Polsce (RODO, aj jako administrator). W UE kluczowe jest rozróżnienie rezydencji danych i regionu wysyłki (F9). Projekt ma trzy działające precedensy portu z `set_x()` w lifespanie (`storage`, `text_guard`, `embeddings`). `httpx` jest już zależnością runtime. Jeden operator, brak budżetu na złożoną infrastrukturę.

### Decision Drivers
- Wiadomości, logi i suppression w UE
- Minimalne zależności, bez SDK dostawcy
- Webhooki podpisane i ochrona przed replay
- Wymiana dostawcy bez zmian poza adapterem
- Koszt przy 100/dzień → 10k → 50k miesięcznie

### Considered Options
1. **1A** Mailgun EU (`api.eu.mailgun.net`)
2. **1B** Resend (metadane w USA, natywny `Idempotency-Key`)
3. **1C** Brevo (dostawca z UE, niezweryfikowane webhooki i cennik)
4. **1D** Scaleway TEM (suwerenny, webhooki w becie przez SNS)

### Decision Outcome
Chosen option: **1A Mailgun EU**, bo dane wiadomości, logi i suppression zostają w regionie EU. Ma też najwyższy wynik ważony (81/100), HMAC-SHA256 w webhookach i liniowy cennik ($0/$15/$35). Integracja: `MailgunSender` (form POST przez `httpx`, Basic auth, timeout, `v:email_message_id`, tracking wyłączony) za Protocolem `EmailSender`, wybierany w lifespanie przez `EMAIL_BACKEND` (`mailgun` \| `smtp` \| `log`) i `set_sender()`. `SmtpSender` tylko dla Mailpit w dev, `FakeEmailSender` w testach. Domena musi powstać **w regionie EU**, bo nie da się jej potem przenieść.

### Consequences

#### Good
- Rezydencja danych w UE bez dodatkowego opisu transferu w polityce prywatności (poza procesorem).
- Zmiana dostawcy (np. na Resend) to nowy adapter, konfiguracja i DNS, bez zmian w kolejce.
- Brak nowej zależności dla wysyłki.

#### Bad
- Brak natywnej idempotencji: okno duplikatu między 2xx a commitem kompensuje polityka SENDING (ADR-004).
- Logi u dostawcy przez 1–5 dni, więc potrzebny jest własny log (ADR-010).
- Mailgun Technologies to spółka z USA (Sinch), z teoretyczną ekspozycją na CLOUD Act. DPA trzeba przeczytać przed etapem 1.
- Darmowy plan 100 dziennie, przy wzroście plan Basic ($15).

---

## ADR-003: Hook w `notifications.service` i kolejka `email_messages` w transakcji domeny

### Status
Accepted

### Context
13 rodzajów `NotificationKind` zapisuje się przez `create_notification` lub `create_notifications`. Tylko 4 przechodzą przez outbox, reszta powstaje synchronicznie w transakcji requestu (F2). Dispatcher outboxa ma 5 prób co ~60 s bez backoffu i przy błędzie powtarza wszystkie handlery wpisu (F1), więc handler mailowy obok handlera bell dublowałby bell. Maile konta (weryfikacja, reset) nie mają bell.

### Decision Drivers
- Pełne pokrycie bez zmian w logice domen
- Atomowość: mail istnieje tylko, gdy bell się zapisał
- Awaria dostawcy nie może dotknąć bell
- Najmniej przeskoków i mechanizmów asynchronicznych
- Granice modułów (ACL, test granic)

### Considered Options
1. **2A** Hook w `notifications.service` → `notifications/infrastructure/email_acl` → jeden `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` do `email_messages` w tej samej transakcji. Maile konta przez `auth/infrastructure/email_acl`
2. **2B** Hook → wpis `outbox_entries` → handler wstawia `email_messages`
3. **2C** Handler outboxa wywołujący dostawcę (oryginał handover ADR-009)
4. **2D** Sweeper czytający tabelę `notifications` od znacznika

### Decision Outcome
Chosen option: **2A**, bo to jedyny wariant, który pokrywa 13/13 rodzajów w dwóch przeskokach. Wiersz kolejki zapisany w transakcji domeny sam pełni rolę transactional outboxa. Ograniczenia, które utrzymują ryzyko „błąd modułu e-mail psuje bell” praktycznie na zerze:
- INSERT to **jedno zapytanie** (wielowierszowe dla `create_notifications`) **bez odczytów** adresu i preferencji, pokryte testem liczby zapytań.
- Decyzja „czy ten rodzaj idzie mailem” zapada w pamięci (`rules`). Rodzaj spoza mapy nic nie wstawia.
- Przy `EMAIL_ENABLED=false` kolejkowanie jest no-opem.
- `email_messages.notification_id` jest luźnym wskaźnikiem bez FK. Snapshot `message` i `link_path` trafia do `payload`, więc zwinięcie lub usunięcie bell (MATCH) nie gubi maila.
- `app.email` importują tylko `main.py` i dwa ACL-e konsumentów (test granic).

### Consequences

#### Good
- Wszystkie istniejące bell (i każdy przyszły, zgodnie z zasadą „najpierw bell”) mogą iść mailem bez zmian w domenach.
- `send_after` i klucz idempotencji dają ciszę nocną, throttling i backoff (ADR-004, ADR-009).
- Brak wzrostu `outbox_entries` i brak ryzyka przejęcia `email.*` przez poller z filtrami.

#### Bad
- `notifications` zna ACL modułu e-mail (sprzężenie synchroniczne w zamian za brak trzeciego przeskoku). Błąd schematu `email_messages` zepsułby zapis bell.
- `create_notification` musi nadawać `id` bella jawnie przed INSERT-em kolejki.
- Nowa tabela i job do utrzymania (purge jako stretch).

---

## ADR-004: Job wysyłki z późnym wiązaniem, backoffem i polityką zawieszonego SENDING

### Status
Accepted

### Context
Kolejka at-least-once wymaga idempotentnego konsumenta (F12). Adres, weryfikacja, preferencje i suppression mogą się zmienić między zapisem bell a wysyłką. Mailgun nie ma natywnej idempotencji, więc crash między 2xx a commitem zostawia niepewny stan. Standard error-handling wymaga, żeby joby logowały `40P01`/`40001` jako jeden WARNING z ponowieniem, a inne błędy raz z tracebackiem, bez przerywania pętli.

### Decision Drivers
- Brak wysyłki do adresu, który właśnie wypisał się lub został zablokowany
- Odporność na krótkie awarie dostawcy (backoff zamiast FAILED po ~5 min)
- Nie trzymać blokad DB w czasie wywołania HTTP
- Unikać dwóch linków resetu, akceptując rzadki duplikat powiadomienia
- Wzorce istniejących jobów (`SKIP LOCKED`, jedna linia logu)

### Considered Options
1. Job APScheduler co ~1 min: claim → SENDING (commit) → późne wiązanie → render → send → zapis wyniku. Zawieszony SENDING: P/D wracają do PENDING, T idą do FAILED
2. Wczesne wiązanie (adres i preferencje rozstrzygane przy INSERT)
3. Wysyłka w tej samej transakcji co claim (blokada wiersza na czas HTTP)

### Decision Outcome
Chosen option: **1**, bo późne wiązanie respektuje każdą zmianę preferencji i suppression do chwili wysyłki. Hook zostaje jednym zapytaniem bez odczytów (ADR-003), a HTTP działa bez otwartej transakcji. Ustalenia:
- Claim `PENDING AND send_after <= utcnow()` z `FOR UPDATE SKIP LOCKED`, batch 50, `coalesce=True`, `max_instances=1`.
- Późne wiązanie batchem (adresaci, suppression, preferencje, licznik dzienny, po jednym zapytaniu), a następnie SKIPPED z `skip_reason`.
- Wynik: 2xx daje SENT. 4xx (poza 429) daje FAILED bez retry. 429/5xx/timeout dają PENDING z backoffem (rosnące odstępy, stałe w `rules`). Po `MAX_ATTEMPTS` FAILED z jedną linią ERROR `email message %s FAILED after %d attempts`.
- SENDING starszy niż ~10 min: P/D wracają do PENDING (możliwy duplikat, akceptowany), T idą do FAILED (użytkownik ponawia żądanie).
- Surowy token T jest zerowany w `payload` przy stanie końcowym. Nigdy nie logujemy adresów, tokenów ani treści.
- Jedna linia na przebieg: `email send: claimed=… sent=… skipped=… retried=… failed=…`.

### Consequences

#### Good
- Wypis i suppression działają najpóźniej w następnym przebiegu.
- Awaria dostawcy do kilku godzin nie gubi maili.
- Zgodność ze standardem error-handling i wzorcami jobów.

#### Bad
- Rzadki podwójny mail P po crashu (Mailgun bez `Idempotency-Key`).
- Rzadka utrata T po crashu (FAILED), wymagająca ponownego żądania przez użytkownika.
- Do ~1 min opóźnienia z interwału joba.

---

## ADR-005: Opt-out per kategoria, domyślnie włączone po weryfikacji, wypis RFC 8058

### Status
Accepted (pewność prawna średnia; opinia prawna przed etapem 2)

### Context
Art. 398 PKE wymaga uprzedniej zgody tylko dla informacji handlowej i marketingu bezpośredniego. Powiadomienia o własnych rezerwacjach, wymianach i własnym want są mailami serwisowymi z podstawą w art. 6(1)(b) RODO, a dla opcjonalnych 6(1)(b)/(f) (F11, interpretacja). Zgoda wpleciona w rejestrację byłaby niedobrowolna (art. 7(4)). Gmail i Yahoo wymagają one-click unsubscribe dla maili „subscribed” (F10). MATCH to szara strefa.

### Decision Drivers
- Kanał musi docierać do ludzi, żeby domykać wymiany
- Zgodność z PKE/RODO bez wymuszonej zgody
- Wypis z jednej kategorii nie może wyłączać innych
- Tania zmiana kategorii „Szukam” na opt-in po opinii prawnej

### Considered Options
1. **3A** Opt-out per kategoria (`email_preferences(party_id, category, enabled)` + `ALL`), domyślnie włączone po weryfikacji, „Podsumowania organizatora” domyślnie wyłączone, „Transakcyjne” bez wyłączania
2. **3B** Opt-in per kategoria + `email_consent_at` (handover ADR-009)
3. **3C** Jeden globalny przełącznik
4. **3D** Hybryda: opt-in dla „Szukam” i „Wiadomości”

### Decision Outcome
Chosen option: **3A**, bo daje wartość kanału bez traktowania maila serwisowego jak marketingu. Model:
- Brak wiersza oznacza domyślną wartość z `rules`. Stała `WANTS_DEFAULT_ENABLED` przełącza „Szukam” na opt-in (wariant 3D) jedną zmianą.
- Kategoria efektywnie włączona = `ALL` nie wyłączone ∧ (wiersz kategorii ∨ domyślna wartość). „Szukam” dodatkowo respektuje per-want `notifications_enabled`.
- `/settings` pokazuje tylko kategorie z co najmniej jednym aktywnym rodzajem (w MVP Rezerwacje i Szukam, plus zablokowany wiersz Transakcyjne).
- Nagłówki `List-Unsubscribe: <https://…/api/email/unsubscribe/<token>>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click` i `List-Id` dla strumienia NOTIFICATION. Bez nich dla T.
- Token wypisu to HMAC-SHA256 nad `party_id` + kategorią (lub `ALL`) + wersją, kluczem `EMAIL_LINK_SIGNING_SECRET` (nie z `JWT_SECRET`, bo rotacja psułaby stare linki), bez wygasania.
- PUBLIC `POST /api/email/unsubscribe/{token}` (wiersz macierzy 78) zwraca 200 bez przekierowania i jest idempotentny. Strona `/unsubscribe` robi GET bez efektów ubocznych i akcję przez POST.
- Włączenie kategorii w `/settings` przez użytkownika usuwa suppression `COMPLAINT` jego adresu (świadomy powrót).
- Bez checkboxa zgody przy rejestracji. Bez bloków promocyjnych w szablonach. SUGGESTION/SIMILAR nie idą mailem.

### Consequences

#### Good
- Maile docierają do większości aktywnych użytkowników ze zweryfikowanym adresem.
- Wypis jest precyzyjny (kategoria) albo pełny (`ALL`), a one-click działa w Gmailu i Yahoo.
- Katalog kategorii ustalony teraz, bez migracji preferencji przy kolejnych rodzajach.

#### Bad
- Pewność prawna średnia (brak wytycznych UODO). MATCH może wymagać opt-in.
- Ryzyko skarg od osób, które nie pamiętają podania adresu (łagodzi to weryfikacja, ADR-006).
- Token wypisu bez wygasania: wyciek linku pozwala tylko wypisać daną osobę, co jest akceptowalne.

---

## ADR-006: Weryfikacja adresu, tokeny konta i wdrożenie dla istniejących kont

### Status
Accepted

### Context
`user_profiles.email` jest nullable i nieweryfikowany. Jedynym sygnałem weryfikacji jest `user_identities.email_verified` kont Google (F3). Nie ma resetu hasła. Nowa subdomena wymaga warm-upu, a masowa wysyłka z zimnej domeny psuje reputację (F10). JWT nie da się unieważnić (accepted risk z researchu Google).

### Decision Drivers
- Nikogo nie blokować przy logowaniu
- Wolumen rośnie organicznie (warm-up)
- Tokeny jednorazowe, krótkotrwałe i odwoływalne
- Odporność na skanery linków (prefetch GET)

### Considered Options
1. **4A** `email_verified_at` + backfill Google + mail przy rejestracji + baner w panelu i `/settings`; tokeny losowe, hashowane, w tabeli
2. **4B** Twarda bramka: konto nieaktywne do weryfikacji
3. **4C** Jednorazowa kampania weryfikacyjna do wszystkich kont
4. **4D** Bez weryfikacji („w locie” przez pierwszy mail)
5. (tokeny) JWT z krótkim `exp` zamiast tabeli

### Decision Outcome
Chosen option: **4A z tokenami w tabeli `account_tokens`** (moduł `auth`, obok `users` i `user_identities`):
- `account_tokens(user_id, purpose VERIFY_EMAIL|PASSWORD_RESET, token_hash SHA-256, email snapshot, expires_at, used_at)`. Surowy token ≥ 32 bajty z `secrets` istnieje tylko w linku i chwilowo w `payload` kolejki. Nowy token unieważnia poprzednie tego samego celu.
- Limit żądań w DB (np. ≤ 1/60 s i ≤ 5/h na konto i cel) bez nowej infrastruktury rate limit. Przekroczenie jest ciche (neutralna odpowiedź).
- Endpointy: `POST /api/auth/email-verification` (zalogowany, wiersz 77), `POST /api/auth/email-verification/confirm` (PUBLIC, wiersz 76). Mail weryfikacyjny wysyłany przy `POST /api/auth/register`.
- Potwierdzenie wymaga zgodności `email` ze snapshotem, ustawia `email_verified_at` i usuwa suppression `BOUNCE` dla adresu (dowód, że adres działa).
- Backfill w osobnej rewizji danych: konta Google z `email_verified=true` i zgodnym `lower(email)`. Nowe konta Google dostają `email_verified_at` przy zakładaniu.
- Każdy zapis zmieniający `user_profiles.email` czyści `email_verified_at`.
- Strona `/verify-email` robi GET bez efektów ubocznych i potwierdza przyciskiem (POST). Jest w obu listach reserved slugs, poza `PROTECTED_PREFIXES`.

### Consequences

#### Good
- Zero blokad. Konta Google kwalifikują się od razu (ogłoszenie w aplikacji, nie mailem).
- Tokeny dają się unieważnić i nie są wrażliwe na rotację `JWT_SECRET`.
- Weryfikacja odblokowuje przyszły auto-linking Google (poza zakresem).

#### Bad
- Część istniejących kont z hasłem nigdy nie zweryfikuje adresu i nie dostanie powiadomień.
- Konta Google zaczną dostawać powiadomienia bez własnej akcji (trzeba to ogłosić w aplikacji).
- Nowa tabela w `auth` i dwa nowe publiczne endpointy.

---

## ADR-007: Odbiorca bez zweryfikowanego adresu = SKIPPED; reset konta tylko-Google ustawia hasło

### Status
Accepted

### Context
Bell trafia do party, nie do adresu. Organization nie ma adresu, lekcy członkowie rodziny i goście RSVP mają `email IS NULL`, a opiekunowie adres „jak wpisano” (F4). Reguła liderzy/założyciel dla Organization nie jest prześledzona. Konta tylko-Google (`password_hash IS NULL`) nie mają odzyskiwania.

### Decision Drivers
- Nigdy nie wysyłać do niewłaściwej osoby
- Zmierzyć lukę przed budową reguły
- Zamknąć zaakceptowane ryzyko braku odzyskiwania kont Google
- Nie zdradzać istnienia kont (enumeracja)

### Considered Options
1. **5A** SKIPPED z `skip_reason` (`organization`, `no_address`, `unverified`) dla wszystkiego bez własnego zweryfikowanego adresu; dzieci SKIPPED
2. **5B** Organization → aktywni liderzy
3. **5C** Organization → założyciel
4. **5D** Własny adres organizacji
5. (reset Google) (i) ustaw pierwsze hasło, (ii) neutralnie bez maila, (iii) mail informacyjny bez linku

### Decision Outcome
Chosen option: **5A** oraz **(i)** dla resetu:
- Job rozwiązuje adresata przez `users_acl`. Party typu Organization daje `organization`, brak konta lub adresu (w tym dzieci) daje `no_address`, a adres niezweryfikowany dla P/D daje `unverified`. Bell zostaje bez zmian.
- `POST /api/auth/password-reset` (PUBLIC, wiersz 74) **zawsze** zwraca 202. Mail idzie na adres konta niezależnie od weryfikacji. Dla `password_hash IS NULL` tekst brzmi „logujesz się przez Google, możesz ustawić hasło”.
- `POST /api/auth/password-reset/confirm` (PUBLIC, wiersz 75) ustawia hasło (bcrypt), unieważnia tokeny resetu i kolejkuje T „hasło zmienione”.

### Consequences

#### Good
- Zero nowych reguł biznesowych. `skip_reason='organization'` mierzy lukę przed decyzją 5B/5C.
- Każde konto z adresem ma odzyskiwanie. Kontrola nad skrzynką i tak daje dziś kontrolę nad kontem Google.

#### Bad
- Właściciele rzeczy organizacji nie dostają maili w MVP.
- Reset nie unieważnia wydanych JWT (zaakceptowane ryzyko, bez zmian).
- Konto tylko-Google zyskuje drugą metodę logowania, co jest świadomą zmianą modelu.

---

## ADR-008: Szablony Jinja2 w repo z generycznym szablonem powiadomienia

### Status
Accepted

### Context
Treści są po polsku, z nazwami rzeczy wpisanymi przez użytkowników (ryzyko wstrzyknięcia HTML). Jinja2 domyślnie ma `autoescape=False` (F12). Bell ma już gotowy, przemoderowany polski tekst ≤ 500 znaków i `link_path`. Renderowanie z danych domen wymagałoby ACL-i do `groups`, `inventory`, `events` i `wants`.

### Decision Drivers
- Bezpieczny escaping i wykrywanie brakujących zmiennych
- Teksty pod code review i w testach
- Niezależność od dostawcy
- Minimum nowych zależności między modułami

### Considered Options
1. **6A** Jinja2 w repo (`select_autoescape(("html","html.j2"))`, `StrictUndefined`, pary `html.j2`/`txt.j2`, inline CSS)
2. **6B** Szablony u dostawcy
3. **6C** MJML prekompilowany
4. **6D** Stdlib `string.Template` + ręczny escaping
5. (treść powiadomień) a) generyczny szablon ze snapshotu bell; b) osobny szablon per rodzaj z danymi z ACL-i domen

### Decision Outcome
Chosen option: **6A** z **a)**. Jinja2 to nowa zależność backendu (wpis w `tech-stack.md`, `uv.lock`). Szablony MVP: `verify_email`, `password_reset` (z wariantem dla konta tylko-Google), `password_changed` i jeden **`notification`**. Ten ostatni renderuje `payload.message` bella jako treść, temat i etykietę CTA z mapy `rules` per rodzaj, oraz pełny URL `APP_PUBLIC_BASE_URL + link_path` (przycisk + URL tekstem pod nim). Do tego stopka z wypisem kategorii i linkiem do `/settings`. Daty w szablonach konta przez `clock.format_term_when`/`format_term_day`. Bez trackingu i bez bloków promocyjnych.

### Consequences

#### Good
- Zero ACL-i do domen na potrzeby treści. Nowy rodzaj bell to wpis w `rules`, bez nowego szablonu.
- Tekst maila zgadza się z bell (jedno źródło, już po moderacji tekstu).
- Autoescape chroni przed HTML w nazwach rzeczy.

#### Bad
- Treść powiadomień jest tak bogata jak tekst bell (bez zdjęć, listy rzeczy, adresu miejsca). Bogatsze szablony per rodzaj można dodać później.
- Nowa zależność i ręcznie pisany responsywny HTML wymagają testów w klientach (Mailpit, seed).

---

## ADR-009: Wysyłka natychmiastowa z kluczem dziennym MATCH, ciszą nocną i limitem dziennym

### Status
Accepted (to nie jest handover ADR-009 — ten opisuje ADR-001)

### Context
Rodzaje MVP wymagają reakcji albo zmieniają zobowiązanie (propozycja, przejęcie, potwierdzenie po terminie), więc nie wolno ich batchować (F12). Matcher działa co 60 s, a bell MATCH jest zwijany i zastępowany sumą (F8), więc mail per bell powtarzałby się. Nowa subdomena potrzebuje warm-upu, a darmowy plan Mailgun to 100 dziennie.

### Decision Drivers
- Pilne zdarzenia na czas
- Brak serii maili MATCH
- Brak maili w nocy dla powiadomień
- Kontrola wolumenu przy warm-upie
- Najmniej kodu (bez szablonów zbiorczych)

### Considered Options
1. **7A** Natychmiast + klucze throttlingu + cisza nocna + `EMAIL_DAILY_CAP`, bez digestów
2. **7B** Dzienny digest wszystkich P
3. **7C** Okno koalescencji 10 min per osoba
4. **7D** Digest tylko dla MATCH

### Decision Outcome
Chosen option: **7A**:
- `WANT_MATCH_FOUND` dostaje klucz `want_match:<want_id>:<YYYY-MM-DD Warsaw>` (data z `clock.local_now()` przy kolejkowaniu), więc najwyżej 1 mail dziennie na want, a throttling wynika wprost z `ON CONFLICT`. `want_id` przekazuje `wants` przez nowe, nieutrwalane pole `NotificationEntry.topic_id` (nazwa do potwierdzenia w specyfikacji).
- Cisza nocna 22:00–07:00 (Warsaw, `clock.local_now()`) dla strumienia NOTIFICATION. Job przesuwa `send_after` na najbliższą 07:00 (zapisaną w naiwnym UTC). T zawsze natychmiast.
- `EMAIL_DAILY_CAP`: po przekroczeniu liczby SENT w danym dniu P dostają SKIPPED `daily_cap` (jeden WARNING na przebieg). T omijają limit.
- Bez digestów. `send_after` zostawia drogę do koalescencji (7C/7D) po pomiarze.

### Consequences

#### Good
- Najmniej kodu. Pilne maile bez opóźnień (poza nocą).
- Throttling bez dodatkowego stanu.
- `app/email` trafia do strażnika zegara domeny.

#### Bad
- Aktywny wymieniacz może dostać kilka maili dziennie.
- Przy przekroczeniu limitu powiadomienia przepadają (SKIPPED), a nie czekają. To świadomy wybór, żeby nie wysyłać przeterminowanych treści.
- Drobna zmiana kontraktu `NotificationEntry` (pole tylko w pamięci).

---

## ADR-010: Pełny webhook Mailgun ze statusami dostarczenia i suppression

### Status
Accepted (wybór użytkownika: 8A zamiast rekomendowanego w eksploracji 8B)

### Context
Mailgun trzyma logi 1–5 dni, a ochrona reputacji wymaga reakcji na twarde bounce i skargi (spam rate < 0.3%, F10). Eksploracja rekomendowała 8B (tylko `failed`/`complained`). Użytkownik wybrał 8A, żeby mieć własny log dostarczenia do diagnozy „nie dostałem maila”.

### Decision Drivers
- Ochrona reputacji nadawcy
- Własna widoczność dostarczenia dłużej niż retencja dostawcy
- Bezpieczeństwo publicznego endpointu (podpis, replay)
- Idempotencja przy powtórzonych i nieuporządkowanych zdarzeniach

### Considered Options
1. **8A** Pełny webhook: `delivered`, `failed` (permanent), `complained` + statusy w `email_messages`
2. **8B** Tylko `failed`/permanent i `complained`
3. **8C** Bez webhooków (suppression tylko u dostawcy)
4. **8D** Job odpytujący Events API

### Decision Outcome
Chosen option: **8A**:
- `POST /api/email/webhooks/mailgun`, PUBLIC w `AUTHORIZATION_MATRIX` (wiersz 79, z komentarzem jak przy 72/73: uwierzytelnienie HMAC w handlerze, nie JWT).
- Weryfikacja: HMAC-SHA256 (`EMAIL_WEBHOOK_SIGNING_KEY`) nad `timestamp + token`, porównanie `compare_digest`, `|now − timestamp| ≤ 5 min`, odrzucenie tokenu widzianego wcześniej (pamięć procesu w oknie czasu). Zły podpis lub replay daje 401 bez szczegółów.
- Korelacja przez zmienną `v:email_message_id` (wysyłana z wiadomością), a w drugiej kolejności przez znormalizowany `provider_message_id`.
- Status = max(obecny, zdarzenie) według `COMPLAINED > BOUNCED > DELIVERED > SENT`. Zapis `delivered_at`/`event_at`.
- `failed` z `severity=permanent` i `complained` dodają `email_suppressions` (adres z `event-data`, `lower(trim)`, `ON CONFLICT DO NOTHING`). `complained` na strumieniu NOTIFICATION wyłącza też kategorię party. Tymczasowe błędy nie są subskrybowane.
- Nieznana wiadomość dostaje 200 (żeby dostawca nie ponawiał), bez logowania adresu.
- Webhook działa od etapu 1, więc maile transakcyjne też mają statusy dostarczenia.

### Consequences

#### Good
- Diagnoza dostarczenia z własnej bazy dłużej niż 1–5 dni u dostawcy.
- Suppression i wyłączenie kategorii przetrwają zmianę dostawcy.
- Idempotentna obsługa bez tabeli zdarzeń.

#### Bad
- Ruch `delivered`: jedno zdarzenie na mail, bez wpływu na decyzje aplikacji, więcej kodu i testów niż w 8B.
- Ochrona przed replay w pamięci procesu zakłada jedną instancję backendu (przy skalowaniu: tabela tokenów lub cache współdzielony).
- Publiczny endpoint i sekret do utrzymania oraz rotacji (`EMAIL_WEBHOOK_SIGNING_KEY` tylko w `.env`).
