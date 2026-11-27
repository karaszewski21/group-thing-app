# Research Brief — moduł mailingowy

## TL;DR
Badanie mieszane (literature + technical): (1) wybór zewnętrznego dostawcy e-maili transakcyjnych i wzorca integracji z backendem FastAPI aj, (2) przegląd aplikacji wskazujący zdarzenia, przy których powinien wychodzić e-mail. Wynik: rekomendacja dostawcy, szkic architektury modułu i priorytetyzowana lista triggerów.

## Key Decisions
- Typ badania: mixed — część zewnętrzna (dostawcy, deliverability, RODO) i część codebase (triggery, outbox, notifications).
- Poza zakresem: implementacja, marketing masowy, SMS/push.

## Open Questions / Risks
- Brak wiedzy, czy aplikacja ma dziś reset hasła / weryfikację e-maila — do ustalenia w codebase.
- Wybór dostawcy zależy od budżetu i wymogu przechowywania danych w UE (do potwierdzenia z użytkownikiem).

## Pytanie badawcze
Jak wdrożyć moduł wysyłki e-maili w aj (FastAPI + Next.js, VPS, docker compose) z użyciem zewnętrznego dostawcy i w jakich momentach aplikacji maile powinny być wysyłane?

## Pytania szczegółowe
1. Którzy dostawcy (np. Resend, Postmark, Amazon SES, Mailgun (EU), Brevo, MailerSend, SendGrid, Mailjet, Scaleway TEM) najlepiej pasują: EU data residency/RODO+DPA, cena na małej skali, deliverability, Python SDK/HTTP API vs SMTP, webhooki bounce/complaint, szablony, limity darmowe?
2. Jak wpiąć wysyłkę w istniejącą architekturę: outbox (`embeddings.requested`, `storage.objects_delete`, `wants.bells_due`), moduł notifications (bell, kinds), scheduled jobs, ACL między BC, config/env, testy (testcontainers)?
3. Które zdarzenia w aplikacji powinny generować e-mail (auth: rejestracja/weryfikacja/reset hasła/Google; rezerwacje take/propose/accept/confirm/cancel; terminy i eventy; wants MATCH/EXPIRING; wiadomości; punkty; grupy/członkostwo; zmiany konta)? Które obowiązkowe (transakcyjne), które opcjonalne (z preferencją), które digest?
4. Preferencje użytkownika i wypis (List-Unsubscribe, RFC 8058), szablony po polsku (HTML + text), lokalizacja dat (Europe/Warsaw).
5. Deliverability: SPF, DKIM, DMARC, domena nadawcza/subdomena, rozgrzewanie, obsługa bounce/suppression.

## Zakres
- W zakresie: porównanie dostawców, wzorzec integracji, inwentarz triggerów, preferencje/wypisy, szablony, DNS, bounce.
- Poza zakresem: implementacja kodu, newslettery/marketing, SMS/push.
- Ograniczenia: użytkownicy w PL, treści PL, RODO, mała skala na VPS, sekrety tylko w `.env`.

## Kryteria sukcesu
- Uzasadniona rekomendacja dostawcy (+ alternatywa) z porównaniem.
- Szkic modułu `app/email` zgodny ze standardami (outbox, ACL, clock, błędy).
- Tabela triggerów: zdarzenie → miejsce w kodzie → odbiorca → priorytet (MVP/później) → typ (transakcyjny/powiadomienie/digest).
