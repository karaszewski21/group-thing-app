# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:settings-email | screen | analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html | /settings „Powiadomienia e-mail”, 4 states: verified, unverified, link sent, complaint-suppressed |
| screen:home-verify-banner | screen | analysis/design-context/mockups/start-baner-weryfikacji-adresu.html | Home verification banner: before and after sending, hidden state |
| screen:account-settings-row | screen | analysis/design-context/mockups/konto-sekcja-ustawienia.html | AccountView „Ustawienia” section with the new „Powiadomienia e-mail” row |
| screen:login-forgot-link | screen | analysis/design-context/mockups/logowanie-link-nie-pamietasz-hasla.html | LoginForm with the „Nie pamiętasz hasła?” link |
| screen:reset-password-request | screen | analysis/design-context/mockups/reset-hasla-prosba.html | /reset-password request form, neutral 202 confirmation, 503 state |
| screen:reset-password-new | screen | analysis/design-context/mockups/reset-hasla-nowe-haslo.html | /reset-password?token= new password form, expired/used state, success state |
| screen:verify-email | screen | analysis/design-context/mockups/potwierdzenie-adresu-verify-email.html | /verify-email?token= confirm button, success, invalid/expired state |
| screen:unsubscribe | screen | analysis/design-context/mockups/wypisanie-unsubscribe.html | /unsubscribe?token= category or all choice, confirmation, invalid-link state |
| screen:emails | screen | analysis/design-context/mockups/maile-powiadomienie-i-weryfikacja.html | Email templates: generic notification (with List-Unsubscribe) and verify_email |
| component:email-category-switch | component | analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html | Category ToggleRow + Switch with optimistic save (WantNotificationToggle pattern) |
| component:verify-banner | component | analysis/design-context/mockups/start-baner-weryfikacji-adresu.html | HintCard-style banner without dismiss, role=status |
