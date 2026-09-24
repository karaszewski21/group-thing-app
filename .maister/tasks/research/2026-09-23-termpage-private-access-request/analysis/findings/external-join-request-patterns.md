# Zewnętrzne wzorce „prośby o dołączenie” (SQ8, wkład do SQ9)

**Data przeglądu**: 2026-09-23
**Metoda**: WebSearch + WebFetch. Wiele stron pomocy (Facebook Help, Discord Support, Meetup Help) zwróciło 403/404 przy WebFetch, więc część twierdzeń opiera się na fragmentach wyników wyszukiwania (snippetach) z tych stron. Pewność oznaczono przy każdym produkcie.
**Aktualność**: funkcje produktów się zmieniają; źródła to strony pomocy w stanie z 2026-09 (bez daty) oraz artykuły z datami podanymi niżej.

---

## 1. Facebook Groups (grupa prywatna, pytania członkowskie)

| Aspekt | Obserwacja | Źródło |
|---|---|---|
| Co widzi osoba spoza grupy | Grupa prywatna (widoczna) pokazuje nazwę, opis i liczbę członków; posty i lista członków są ukryte do czasu zatwierdzenia. Grupa „hidden” nie jest wyszukiwalna, dostęp tylko przez zaproszenie/link. | https://groupboss.io/blog/public-vs-private-facebook-group/ ; https://www.eff.org/deeplinks/2017/06/understanding-public-closed-and-secret-facebook-groups (2017-06) |
| Logowanie | Wymagane (prośba to akcja konta FB) — wniosek z modelu produktu, brak osobnego cytatu. | niska-średnia pewność |
| Formularz | Do 3 pytań kwalifikujących (np. cel dołączenia). | https://blog.groupleads.net/can-someone-see-if-you-decline-their-request-to-your-facebook-group/ (snippet) |
| Stan „oczekuje” | Przycisk zmienia się na „Request Sent”; najechanie → „Cancel Request” + dialog potwierdzenia. Anulowanie nie cofa powiadomienia, które admin już dostał. | https://smallbusiness.chron.com/cancel-facebook-group-awaiting-membership-30535.html |
| Odrzucenie | Domyślnie brak powiadomienia o odrzuceniu (ciche); od 2021 admin może „odrzucić z feedbackiem” — wtedy użytkownik dostaje powiadomienie i może poprosić ponownie z lepszymi odpowiedziami. | https://grouptize.com/2021/12/admins-now-able-to-decline-facebook-group-member-requests-with-feedback/ (2021-12); https://blog.groupleads.net/can-someone-see-if-you-decline-their-request-to-your-facebook-group/ |
| Zatwierdzenie | Powiadomienie FB o akceptacji; strona grupy od razu pokazuje treść. | j.w. (snippet) |

**Pewność**: średnia (70%) — oficjalne strony pomocy FB niedostępne przez WebFetch; zgodne źródła wtórne.

## 2. Discord — Server Member Applications („Apply to Join”)

| Aspekt | Obserwacja | Źródło |
|---|---|---|
| Tryby dołączania | Owner wybiera: Invite Only / Apply to Join / Discoverable. | https://support.discord.com/hc/en-us/articles/29729107418519-Server-Member-Applications (snippet) |
| Co widzi wnioskujący | Podczas oczekiwania „users cannot view any server content”. | j.w. |
| Formularz | Pytania screeningowe; poradnik zaleca 3–5 pytań otwartych. | https://peakbot.pro/blog/how-to-set-up-discord-membership-applications-approval-2026 (2026-06-03) |
| Stan „oczekuje” / wycofanie | Użytkownik może złożyć **i wycofać** wniosek (desktop i mobile). | Discord Support (snippet) |
| Proces admina | Admin może napisać DM / „przesłuchać” przed decyzją; approve lub reject (spam, ban-evader, słabe dopasowanie). | Discord Support (snippet) |
| Odrzucenie / ponowny wniosek | Brak potwierdzonych szczegółów w dostępnych źródłach. | luka |

**Pewność**: średnia (65%).

## 3. Slack — prośby o zaproszenie do workspace

| Aspekt | Obserwacja | Źródło |
|---|---|---|
| Model | Brak klasycznej „prośby z zewnątrz”: członek prosi o zaproszenie dla kogoś, admin zatwierdza; alternatywnie auto-dołączanie po zatwierdzonej domenie e-mail (auto-approve według reguły). | https://slack.com/help/articles/115004854783-Require-admin-approval-for-workspace-invitations ; https://slack.com/help/articles/115004856503-Manage-how-people-join-your-workspace |
| Powiadomienia | „When an invitation request is approved or denied, the member who requested it will be notified.” Prośby trafiają do adminów (powiadomienie Slack) lub na wskazany kanał. | Slack Help (snippet) |
| Wygasanie | Zaproszenia i linki zapraszające wygasają po 30 dniach. | https://slack.com/help/articles/360060363633-Manage-pending-invitations-and-invite-links-for-your-workspace |

**Pewność**: średnia-wysoka (75%). Istotne głównie jako: *auto-approve według reguły*, *jawne powiadomienie o odmowie*, *wygasanie oczekujących*.

## 4. Meetup — „New member approval” + pytania profilowe

| Aspekt | Obserwacja | Źródło |
|---|---|---|
| Stan | Przy włączonej akceptacji członek jest „Pending until their request is accepted or denied”. | https://help.meetup.com/hc/en-us/articles/360002878091-Controlling-who-joins-a-Meetup-group (snippet) |
| Formularz | Do 5 pytań profilowych, obowiązkowe przed wysłaniem prośby; odpowiedzi widzi tylko organizator/zespół prowadzący, nie inni członkowie. | https://help.meetup.com/hc/en-us/articles/360022471332-Profile-and-event-questions (snippet) |
| Zatwierdzenie | Członek dostaje wiadomość powitalną (może zawierać własną notkę organizatora). | https://help.meetup.com/hc/en-us/articles/40708711774221-What-notifications-Meetup-can-send (snippet) |
| Odrzucenie | Brak potwierdzonych szczegółów (odróżnić od bana — zbanowany nie może dołączyć ponownie). | j.w.; luka |
| Logowanie | Wymagane konto (dołączenie to akcja profilu) — wniosek z modelu. | niska-średnia |

**Pewność**: średnia (70%). **Najbliższa analogia** do naszej aplikacji (grupy + wydarzenia/terminy, organizator zatwierdza, odpowiedzi widoczne tylko dla organizatora).

## 5. Telegram / WhatsApp — prośba przez link zaproszenia

| Aspekt | Telegram | WhatsApp |
|---|---|---|
| Wejście | Link zaproszenia z włączonym „Admin Approval” → użytkownik widzi przycisk wysłania prośby. | Po „Join group” pop-up z „Request to join” i tekstem „An admin must approve your request.” |
| Po stronie admina | Pasek u góry czatu z oczekującymi; podgląd zdjęć/bio; approve/dismiss (także zbiorczo przez API). | Powiadomienie „pending request”; ✓/✗ przy każdej osobie. |
| Domyślne | Opcja per link zaproszenia. | „Approve New Participants” domyślnie wyłączone — link = natychmiastowe dołączenie. |
| Źródła | https://core.telegram.org/api/invites ; https://telegram.tips/blog/join-requests/ | https://faq.whatsapp.com/902091421605313/ ; https://beebom.com/how-approve-new-participants-whatsapp-groups/ |

**Pewność**: średnia (70%). Wzorzec: **zatwierdzanie jako przełącznik** na linku/grupie, zero formularza, jedno zdanie informujące, że potrzebna akceptacja admina. Nie potwierdzono możliwości anulowania prośby przez użytkownika.

## 6. GitLab — „Request access” do grupy/projektu

| Aspekt | Obserwacja | Źródło |
|---|---|---|
| Wejście | Na stronie grupy przycisk „Request access” („if an administrator allows it” — funkcja wyłączalna). Wymaga zalogowania. | https://docs.gitlab.com/user/group/ (WebFetch, cytat) |
| Wycofanie | „If you change your mind before your request is approved, select **Withdraw access request**.” | j.w. |
| Powiadomienie ownerów | „Up to ten of the most recently active group owners receive an email with your request.” | j.w. |
| Decyzja | „Any group owner can approve or decline the request” — dokumentacja nie opisuje sposobu powiadomienia wnioskującego. | j.w. |

**Pewność**: wysoka (90%) — oficjalna dokumentacja, cytaty dosłowne. (GitHub — organizacje opierają się na zaproszeniach, nie na prośbach; niezweryfikowane, pominięte.)

---

## 7. UX / dostępność stanu „oczekuje”

- **WCAG 2.2 SC 4.1.3 Status Messages (AA)**: „Status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus.” → komunikat „Prośba wysłana, czeka na akceptację organizatora” w kontenerze `role="status"` (`aria-live="polite"`), bez przenoszenia fokusu. Źródło: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- Region live powinien istnieć w DOM przed zmianą treści; `aria-atomic="true"`, by odczytać cały komunikat; błędy → `role="alert"`/`assertive`, zwykłe statusy → `polite`. Źródła: https://www.uxpin.com/studio/blog/aria-live-regions-for-dynamic-content/ ; https://auditbuffet.com/patterns/ab-000127
- Przycisk w trakcie wysyłania: stan „pending” z etykietą dla czytnika (np. „Wysyłanie…”) i blokadą podwójnego kliknięcia. Źródło: https://opensource.adobe.com/spectrum-web-components/tools/pending-state/
- Wzorzec wizualny z produktów: przycisk główny zamienia się w **nieaktywny stan z etykietą** („Request Sent”/„Pending”) + **akcja drugorzędna „Wycofaj prośbę”** z potwierdzeniem (FB, GitLab, Discord).

---

## 8. Tabela porównawcza

| Cecha | FB | Discord | Slack | Meetup | TG/WA | GitLab |
|---|---|---|---|---|---|---|
| Podgląd przed dołączeniem | nazwa, opis, liczba członków | brak treści | – | strona grupy | nazwa/zdjęcie z linku | strona grupy |
| Logowanie wymagane | tak | tak | tak | tak | tak (konto aplikacji) | tak |
| Pytania przy prośbie | do 3 | tak (3–5 zalecane) | nie | do 5, obowiązkowe | nie | nie |
| Wycofanie prośby | tak (z potwierdzeniem) | tak | – | brak danych | brak danych | tak |
| Powiadomienie o akceptacji | tak | brak danych | tak | tak (powitanie + notka) | dodanie do czatu | brak w docs |
| Powiadomienie o odrzuceniu | domyślnie nie; opcja „z feedbackiem” | brak danych | tak | brak danych | brak danych | brak w docs |
| Ponowna prośba po odrzuceniu | tak | brak danych | – | tak, chyba że ban | brak danych | brak danych |
| Wygasanie | brak danych | brak danych | 30 dni | brak danych | per link | brak danych |

---

## 9. Implikacje dla małej aplikacji grup zajęciowych rodzic/dziecko

1. **Minimalny podgląd publiczny dla PRIVATE** (wzorzec FB): nazwa grupy, organizator/organizacja, ewentualnie opis i liczba członków — bez listy uczestników i bez wrażliwych szczegółów terminu. Dzieci w grupie → lista członków zawsze ukryta dla nie-członków.
2. **Logowanie przed prośbą** — wszystkie badane produkty wymagają konta. Dla anonima: CTA „Zaloguj się, aby poprosić o dostęp” z powrotem na ten sam URL.
3. **Formularz lekki**: 0–1 pole (opcjonalna wiadomość do organizatora) — wzorzec WA/TG/GitLab; pytania à la Meetup/FB (widoczne tylko dla organizatora) jako rozszerzenie. Wkład do SQ9: czy prośba zbiera dane jak `guardian_name`/`child_count`.
4. **Pending jako trwały stan strony** (nie tylko toast): „Prośba wysłana — czeka na akceptację organizatora” w `role="status"` + drugorzędna akcja „Wycofaj prośbę” z potwierdzeniem.
5. **Odrzucenie**: ciche (FB domyślnie) vs. jawne (Slack, FB z feedbackiem). Dla małej społeczności rodziców sensowniejsze jawne, łagodne „Organizator nie zaakceptował prośby” z możliwością ponownej prośby, ewentualnie z cooldownem/limitem — decyzja w SQ9.
6. **Powiadomienie organizatora** o nowej prośbie (GitLab: e-mail do ≤10 ownerów; Telegram: pasek oczekujących; WA: notyfikacja) oraz **powiadomienie wnioskującego o akceptacji** (Meetup: powitanie z notką). Po akceptacji strona terminu przechodzi w widok członka przy ponownym wejściu/odświeżeniu.
7. **Przełącznik zamiast osobnego typu strony** (WA/TG/Discord): „wymaga akceptacji” to ustawienie grupy — spójne z obsługą PRIVATE w tym samym komponencie TermPage.
8. **Wygasanie oczekujących próśb** (Slack: 30 dni dla zaproszeń) — opcjonalna decyzja SQ9.

## 10. Luki

- Brak potwierdzonych danych o powiadomieniach o odrzuceniu i ponownym wniosku w Discord, Meetup, Telegram, WhatsApp, GitLab.
- Oficjalne strony pomocy FB/Discord/Meetup niedostępne przez WebFetch (403/404) — twierdzenia oparte na snippetach wyszukiwarki i źródłach wtórnych.
- GitHub (organizacje) pominięty — model zaproszeń, nie próśb (niezweryfikowane).

**Ogólna pewność**: średnia (~70%). Wzorce zbiorcze (wymagane logowanie, stan pending z możliwością wycofania, powiadomienie organizatora) — wysoka, bo potwierdzone w ≥3 niezależnych produktach.
