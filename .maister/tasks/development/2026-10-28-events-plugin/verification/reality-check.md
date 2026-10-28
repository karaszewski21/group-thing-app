# Reality Check: Events plugin (wydarzenia) at /add/event

## TL;DR
- **Status: ⚠️ Issues Found. Expected to work end-to-end in dev, but the real host↔backend round trip in a browser has not been run yet.** Every seam I traced matches: message names, payloads, auth, response shapes and error envelopes.
- Backend feature tests: 79/79 passed. Frontend feature tests: 163/163 passed. `plugins/events` `npm run build`: OK.
- No critical gaps. The main risks are the manual dev setup (4 processes plus a curl that needs an admin token, with gaps in the docs), a 10 s SDK timeout that can lead to duplicate events, and the plugin being localhost-only (accepted).
- The feature counts as done only after E2E step 6.5 runs the real flow in a browser: create, upload a banner, then `done` → `/add` with a toast.

## Key Decisions
- The verdict is not "Ready" because no browser has done the full round trip with the real SDK bundle and backend. Group 8/9 Playwright runs used a stubbed `PluginSDK`.
- The unpublished prod hosting of the plugin is accepted scope (scope-clarifications). It is not counted as a gap against this task.

## Open Questions / Risks
- I could not tell whether the events manifest is registered in the local DB: `GET /api/plugins` needs a token, and I did not handle credentials. If it is not registered, `/add/event` shows the "Plugin wydarzeń jest niedostępny" fallback. That is correct behaviour, but it is not the feature.
- The SDK has a 10 s timeout. `POST /api/events` runs two `check_text` calls, each with a 5 s budget (`app/moderation/text_guard.py:17`). A slow but successful create can show "Nie udało się zapisać…", and a retry then creates a **duplicate event**.

---

## 1. Verification state found
| Report | State |
|---|---|
| `verification/spec-audit.md` | present |
| `verification/production-readiness-report.md` | GO with mitigations for the backend and host. The plugin cannot ship to prod (localhost URLs, accepted) |
| code-review / pragmatic | produced in parallel, not yet available |
| `implementation-plan.md` | 66/67 steps ✅. **6.5 (iframe height tuning) deferred to E2E** |
| work-log | Full backend suite 908 passed. Frontend 1192 passed / 9 failed (8 pre-existing on a clean HEAD, 1 flaky) |

## 2. Independent test run (this check)
| Command | Result |
|---|---|
| `pytest tests/test_events_migration.py tests/test_events.py tests/test_event_banners.py tests/test_authorization_matrix.py` | **79 passed** (27.5 s) |
| `vitest run plugins.test.tsx plugin-sdk.test.ts eventCreateViewState.test.ts AppPage.test.tsx` | **163 passed** (4 files) |
| `plugins/events: npm run build` (tsc -b + vite) | **OK**, 277 kB JS |
| Live probes | backend :8080 is up (`/api/plugins` → 401 without a token). `:5173/assets/plugin-sdk.js` → 200. `:3004` → 200 |

The work log reports "frontend feature 166". My 163 comes from the four files named in the brief, so this is not a discrepancy.

## 3. Can a logged-in user actually do the flow? Seam-by-seam trace

| Step | Evidence | Verdict |
|---|---|---|
| Reach `/add/event` | `router.tsx:51` has `add/event` in `PANEL_VIEWS` behind `AuthGuard`. `AppPage.tsx:105` renders `EventCreateView`. `AddView.tsx:78` has the tile | ✅ |
| Plugin discovery | `usePlugins` → `GET /api/plugins` needs `READ` (matrix #13). Regular users get READ+EDIT (`app/users/service.py:64`). The backend stores `extensionPoints` without validating the type, so `add.event` is accepted. `resolveEventCreateView` takes the first enabled `add.event` by priority, and on error or no match shows the fallback | ✅ |
| Single message handler | `PluginProvider` (the global handler) is mounted only under `/admin` (`router.tsx:55-61, 194`). `/add/event` installs its own handler through `usePluginMessageHandler`, so requests are not handled twice and there are no double POSTs | ✅ (checked on purpose: two handlers would create two events) |
| iframe + origin check | `PluginFrame` registers the iframe. The handler checks `event.source` against the registry and `event.origin` against the manifest URL origin (`http://localhost:3004`). Context `RENDER{…hostOrigin}` → SDK `__pluginHostOrigin` | ✅ |
| SDK loads in the iframe | `plugins/events/index.html` loads `http://localhost:5173/assets/plugin-sdk.js` with `crossorigin`. `npm run build:sdk` now copies it into `public/assets/`, which is git-ignored. The file is present and served | ✅ in dev |
| Create event | plugin `hostApp.fetch("/api/events", POST JSON)` → `pluginFetch` → host adds the Bearer token and `X-Requested-With` → Vite proxy → `POST /api/events` (EDIT) → 201 `EventResponse` (8 keys). The plugin's `toEvent` checks exactly id/name/description/starts_at/ends_at/location/created_at/updated_at. `LocationRefResponse` has id/name/formatted_address (plus extra fields the parser ignores) | ✅ shapes match |
| Datetimes | Plugin sends naive `YYYY-MM-DDTHH:mm:00`. The backend rejects aware datetimes, checks the start against `clock.local_now()`, and requires the end to be the same day and later than the start. The plugin always reuses the start date for the end, so `END_OTHER_DAY` cannot fire from the UI | ✅ |
| Location | `GET /api/locations/mine` → `list[LocationResponse]` (has id/name/formatted_address). `POST /api/locations` `{name, formatted_address, source:"MANUAL"}` fits `CreateLocationRequest` (extra=forbid; MANUAL forbids place_id/lat/lng, and none are sent). 201/200 are both handled | ✅ |
| Banner upload | `hostApp.uploadImage(url, file)` → message `uploadImage {url, file}`. The File is structured-cloned, so `instanceof Blob` holds in the host realm. The host allowlist regex is `/api/events/{uuid}/banner`, max 5 MB, MIME jpeg/png/webp. It builds `FormData` field `file` → backend `file: UploadFile = File()` → 200 `{url, status}` → plugin `toBanner` | ✅ names/payloads match across `domain.ts`, `plugins/sdk.ts`, `plugin-sdk/host-app.ts` and `PluginMessageHandler.ts` |
| Return to /add | plugin `thisPlugin.done({name})` → `sendFireAndForget("done", …)` → handler `type === "done"` → `onDone` → toast `Wydarzenie „{name}” zapisane`, invalidates `[LOCATIONS_KEY]`, `navigate(viewPath("add"))` | ✅ |

## 4. Error paths
| Path | Behaviour | Verdict |
|---|---|---|
| Domain validation 400 | `ValueError` → envelope `{message}` with Polish text. The plugin's `bodyMessage` reads `message` | ✅ |
| Pydantic 400 ("Validation failed", English) | Shown as is through `bodyMessage` | Low: not reachable from the UI with valid input |
| 401 | session copy, for both create and banner | ✅ |
| 403/404 on create (location not owned or deleted) | "Wybrane miejsce jest niedostępne — wybierz inne." | ✅ |
| 503 moderation unavailable | backend message shown, draft kept | ✅ |
| Banner 409 (storage off) / 400 corrupt / 403 / 404 | `bannerFailed` with the detail line, plus retry or skip. The event is already saved | ✅ |
| SDK timeout/reject | `call()` → null → generic copy | ⚠️ see R1 |
| Plugin missing or disabled, or `/api/plugins` fails | Polish fallback card with a back link | ✅ (unit-tested) |
| Banner orphan on thumb `put` failure | The large image is left behind in storage (same pattern as avatars; noted in the work log) | Low |

## 5. Reality gaps

### Critical
None found.

### High
- **H1. The real round trip has not been exercised.** *Claim:* implementation complete. *Reality:* Groups 8/9 verified the plugin standalone, with a **stubbed** `PluginSDK`. The host tests use mocked `fetch`. Nobody has driven the live chain in a browser (host on :5173 → iframe on :3004 → SDK on :5173 → proxy → :8080 → storage). That chain covers the CORS/`crossorigin` script load, cloning a File across origins, the sandbox file picker, multipart through the Vite proxy, and the public banner URL rendering. *Impact:* each seam reads correctly in code, but none has been proven in a running stack. *Plan:* the E2E phase, step 6.5.

### Medium
- **R1. Timeout can cause duplicate events.** The SDK timeout is 10 s. Create runs 2 × `check_text` (5 s each) plus DB work. A create that succeeds just over 10 s shows an error in the plugin. The user presses save again and a second event is created. The banner upload (5 MB processed in a thread) has the same 10 s budget, but there a retry replaces the banner, so it is harmless. *Impact:* rare, but the user sees duplicate data.
- **D1. Manual dev setup is fragile, and plugins/CLAUDE.md does not cover all of it.** To get to a working page you need:
  1. backend on :8080 (Docker for Postgres)
  2. `cd src/frontend && npm run build:sdk` (documented, step 2)
  3. `npm run dev` on :5173 (documented)
  4. `cd plugins/events && npm install && npm run dev` on :3004 (port documented; `npm install` not mentioned for this plugin)
  5. `PUT /api/plugins/{id}/manifest` with an admin token (documented generically)

  Gaps in the docs:
  - They never say which plugin id to register events under, e.g. `events`.
  - They never say how to get a `PLUGIN_MANAGEMENT`/`ADMIN` token.
  - The curl snippet's line continuations were collapsed into runs of spaces with no `\`. It still runs as one line, but it reads like a broken multi-line command.
  - They do not say that a missing step 2 or 5 makes the page fall back silently to "Plugin wydarzeń jest niedostępny" (missing manifest), or leaves a blank or non-working iframe (missing SDK, so `window.PluginSDK` is undefined).

### Low
- L1. The iframe has a fixed height (`calc(100dvh - 240px)`, min 560 px) and step 6.5 is not tuned yet. The location sheet inside the iframe may clip on short screens. Check this in E2E.
- L2. HEIC/other image types are rejected on the client with a clear message. That is acceptable.
- L3. A missing `crossorigin` in box-size/warehouse `index.html`, and `.playwright-mcp/` not being git-ignored, are logged follow-ups outside this scope.

## 6. Functional completeness
About **90%** of the requested scope is implemented and consistent in code:
- Create-only event with name, start, optional end and description
- Location from Locations, including adding a place inline
- Optional banner of up to 5 MB, with retry
- `event_attendances` table with no UI
- No banner moderation
- Manual registration
- Separate from Term (its own `app/events` bounded context; locations reached through an ACL)

The remaining ~10% is runtime proof and height tuning (6.5). The event list/detail view is out of scope by decision.

## 7. Pragmatic action plan
| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Run the E2E flow on the live stack: log in as a regular user → `/add` → Wydarzenie tile → fill the form → pick or add a place → attach a PNG → save → `done` | Event row in the DB, `event_banners` row plus public URL renders in SavedCard, toast shown on `/add`, no console errors on either origin | High | 1–2 h |
| 2 | During E2E, also exercise: an unregistered or disabled manifest (fallback), an expired token (401 copy), storage off (409 → bannerFailed → skip), and a 360 px viewport with the location sheet open (closes 6.5) | Each shows the specified Polish copy, and nothing clips or scrolls horizontally | High | 1 h |
| 3 | Complete the events setup in plugins/CLAUDE.md: plugin id (e.g. `events`), `npm install`, how to get an admin token, curl with real `\` continuations, and what symptom each missing step produces | A new developer follows the doc from a clean checkout to a working `/add/event` | Medium | 20 min |
| 4 | Mitigate R1. Pick one: (a) the plugin shows "nie wiadomo, czy zapisano" on timeout instead of the generic error; (b) send an idempotency key; (c) give `uploadImage`/create a longer per-call timeout | A timeout cannot lead to a silent duplicate | Medium | 30–90 min |
| 5 | Follow-ups already logged (orphaned large image, prod hosting, banner moderation, EntityId) | Tracked as tasks | Low | — |

## 8. Completion verdict
**⚠️ Gaps.** Every integration seam between the plugin, SDK, host handler and backend agrees in code, and the feature tests pass (79 backend, 163 frontend, plugin build). The code solves the stated problem, with no critical defect found. It is not "actually complete" until the E2E phase has run the real browser round trip once (item 1) and closed step 6.5. The dev setup docs need the small fixes in item 3.
