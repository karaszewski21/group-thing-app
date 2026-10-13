# External Findings: Delivery Channels and Calendar Integration

Category: external-ux-patterns (instance 4). All sources accessed 2026-10-13.

---

## 1. Web Push (PWA)

### 1.1 iOS / iPadOS: Home Screen install required
- WebKit blog, "Web Push for Web Apps on iOS and iPadOS", 16 Feb 2023 (iOS/iPadOS 16.4):
  - "A web app that has been added to the Home Screen can request permission to receive push notifications". A plain Safari tab cannot.
  - The permission request must come from "direct user interaction", such as a Subscribe button.
  - It uses the standard "Push API, Notifications API, and Service Workers" and the same APNs service as native push.
  - A manifest with `display: standalone` or `fullscreen` makes the site a Home Screen web app.
  - Notifications appear on the Lock Screen, in Notification Center and on Apple Watch, integrate with Focus, and badging is supported.
- Source: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ (Confidence: High, fetched)
- EU: Apple removed Home Screen web apps in the iOS 17.4 betas under the DMA, then reversed the decision in March 2024, so the existing capability stays in the EU, built on WebKit. https://www.engadget.com/apple-backtracks-on-plans-to-get-rid-of-web-apps-on-iphones-in-the-eu-195232177.html ; https://notificare.com/blog/2024/03/08/apple-reverse-decision-to-remove-pwa/ (Confidence: Medium–High. Later changes were not checked.)
- Install friction: iOS Safari has no native install prompt, so users must use Share → Add to Home Screen. No credible measured iOS install rates were found. The only figure (about 85%) is a library author's own claim. https://github.com/philfung/add-to-homescreen (Confidence: Low)
- **Implication:** on iOS, push reaches only users who install the PWA and then opt in. For a group app with many iPhone users, web push cannot be the only off-app channel.

### 1.2 Opt-in rates (vendor benchmarks, directional only)
- Website web-push opt-in is commonly 10–15% with well-placed prompts, and as low as about 5% for e-commerce (https://gravitec.net/blog/?p=426).
- Batch reports a much higher average for the services vertical (79–86%) and says 78% of web-push traffic is mobile (https://batch.com/blog/case-studies/benchmark-notifications-push-crm-mobile).
- Native app opt-in: Android dropped from 85% to 67% after Android 13 introduced its permission prompt; iOS is around 56% (Batch, same source). OneSignal 2024 reports about 20–57% by category (https://onesignal.com/mobile-app-benchmarks-2024).
- Confidence: Low–Medium (vendor methodologies are inconsistent).
- **Implication:** a contextual ask ("Want a reminder before Thursday's meeting?") at the moment a handover is agreed is the moment of highest motivation, and on iOS a user gesture is required anyway.

## 2. Email
- The default reminder channel at Eventbrite (48h), Meetup (7d and 1d), libraries (due-date notices) and Calendly (24h). See external-patterns-apps.md.
- Advantages: works on every platform, needs no install, persists in the inbox, and can carry an .ics attachment or calendar links.
- Requirement: a verified email address per user. Our codebase has a nullable `User.email`; see gatherer 2.

## 3. SMS
- Evidence: the Cochrane review found SMS as effective as calls and better than post or nothing (see external-patterns-evidence.md).
- Polish market cost is about 0.11–0.29 PLN per SMS, depending on volume:
  - OVHcloud: 0.111–0.135 PLN net (https://www.ovhcloud.com/pl/sms/prices/)
  - Reservio packs: about 0.20–0.29 PLN (https://help.reservio.com/en/articles/8041916-where-can-i-find-sms-notification-pricing)
  - D7: $0.029 (https://d7networks.com/sms/poland/)
  - Confidence: Medium
- Downsides: per-message cost, phone number collection and verification, GDPR consent. Calendly limits SMS to paid plans, which shows how SMS is usually positioned.

## 4. Messenger-style channels
- **Telegram bot:** a bot cannot message a user first. The user must open `t.me/<bot>?start=<payload>` and press START. The bot then receives `/start PAYLOAD`, which can be used to link the account. After that the bot can message the user freely and at no cost. https://core.telegram.org/method/messages.startBot ; https://kwizbot.notion.site/User-subscription-to-bot-notifications-4e39435689af44248c31d78d03dab19a (Confidence: Medium. The official Bot API deep-linking page was not fetched.)
- **Facebook Messenger:** standard 24-hour messaging window after the user's last message. Outside it, only Message Tags (non-promotional, restricted use cases) or One-Time Notifications are allowed, and misuse risks restrictions. https://developers.facebook.com/docs/messenger-platform/policy/policy-overview ; https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages (Confidence: High, official docs via snippet). Scheduled reminders days ahead don't fit well without One-Time Notification opt-ins and Meta app review.
- WhatsApp Business API: not researched in depth. Third-party lending apps (LoanedOut, Amana) use WhatsApp for reminders (Low).

## 5. Calendar integration (Add to calendar / .ics)
- **RFC 5545 VALARM:** a sub-component of VEVENT/VTODO that "is used to specify a reminder". A relative TRIGGER (e.g. `-PT24H`, `-PT2H`) fires before the event. REPEAT/DURATION allow repeats. RFC 9074 adds VALARM extensions. https://icalendar.org/iCalendar-RFC-5545/3-6-6-alarm-component.html ; https://datatracker.ietf.org/doc/rfc9074/ ; Python lib `icalendar`: https://icalendar.readthedocs.io/en/stable/reference/api/icalendar.cal.alarm.html (Confidence: High). Note: many clients ignore or strip VALARM from imported files and apply the user's own defaults (not verified in this research; flagged).
- **Google Calendar link:** `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=YYYYMMDDTHHMMSS/YYYYMMDDTHHMMSS&details=...&location=...&ctz=Europe/Warsaw`. Without `Z` the dates are in the user's time zone, `ctz` sets the time zone explicitly, and values must be URL-encoded. https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/master/services/google.md (Confidence: Medium. A third-party compilation; no official Google page found.)
- Practice: no confirmation found that Eventbrite or Meetup reminder emails contain .ics files (gap).
- **Why it matters:** once the handover is in the user's own calendar, the calendar's native alarms take over. This works on iOS without push or PWA install and needs no backend scheduler, which makes it the lowest-infrastructure off-app reminder. It also matches the implementation-intention evidence: putting a time in the user's own plan.
- Variants:
  - (a) one-off .ics download or Google link per Term/handover. No server state.
  - (b) a per-user subscribable ICS feed URL (webcal://) listing upcoming handovers, which updates automatically. Needs a secret token in the URL and must be rotatable. The design is inferred; no external source was fetched for it.

## 6. Channel comparison

| Channel | Reach on iOS | Infra / cost | User effort to enable | Evidence |
|---|---|---|---|---|
| In-app notification (today) | Only when the app is open | Exists | None | Read-once problem (brief) |
| Add-to-calendar (.ics / Google link) | Full | Very low (no scheduler) | 1 tap per event | Implementation intentions (PNAS 2011) |
| Subscribed ICS feed | Full | Low (one endpoint + token) | One-time setup | Same |
| Email reminder | Full | Low–medium (SMTP provider + scheduler) | Verified email | Industry default; reminder meta-analyses |
| Web push | iOS only if installed to Home Screen (16.4+) | Medium (VAPID, service worker, manifest, subscriptions) | Install (iOS) + opt-in | Opt-in benchmarks are low on the web |
| Telegram bot | Full (if the user has Telegram) | Low–medium | Deep link + START | None specific |
| SMS | Full | Per-message cost of about 0.11–0.29 PLN plus phone verification | Phone number | Cochrane: effective |
| FB Messenger | Full | Policy-constrained (24h window) | Opt-in | Poor fit for scheduled reminders |
