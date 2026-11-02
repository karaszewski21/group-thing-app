# Phase 6 Smoke: Run Instructions

## TL;DR
- Dev rows: backend `uvicorn` on :8080 plus `npm run dev` (= `next dev -p 5173`) in `src/frontend`. Compose rows: `docker compose up` (the user starts it) and nginx on :5174.
- Drive the browser with Playwright MCP. Record each row of `smoke-checklist.md` as PASS / FAIL / N/A with a note. Evidence goes into `verification/smoke/<row-id>-<what>.<ext>`.
- **Secrets**: check env values for presence only. Never paste tokens, passwords, cookie values, client secrets or keys into the checklist, the evidence files or a chat.
- At the end, stop every process you started, and delete `src/frontend/AGENTS.md` if `next dev` wrote it.

## Key Decisions
- Test accounts are named by role only: **ADMIN** and **EDIT-only editor**. The user types or provides the credentials at run time. They never go into a file.
- The smoke runs against the local dev database. Compose uses its own database, and `docker compose up` runs `alembic upgrade head` on it, so only the user starts compose.
- In Git Bash, prefix curl commands with `MSYS_NO_PATHCONV=1`. Otherwise MSYS rewrites `/path` arguments (the C11 OG log shows `C:/Program Files/Git/<slug>`).

## Open Questions / Risks
- Uploads need every `SPACES_*` value. The local backend reads `src/backend/.env`, which may not have them (they are in the root `.env`). Without them, S16a/W06 are `N/A`.
- Local TLS to Spaces may fail with `CERTIFICATE_VERIFY_FAILED` behind an intercepting root CA. The fix is an `AWS_CA_BUNDLE` PEM built from certifi plus the Windows root store. It is only needed for upload rows on the dev backend.

## 1. Secrets rule (read first)
- Never run `env`, `printenv`, `cat .env`, `docker compose config` without `-q`, or `docker inspect` (Env section). They print secret values into the transcript.
- Check presence only, for example:
  ```bash
  grep -q '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=.\+' .env && echo set || echo missing
  for k in SPACES_ENDPOINT_URL SPACES_REGION SPACES_BUCKET SPACES_KEY SPACES_SECRET SPACES_PUBLIC_BASE_URL; do grep -q "^$k=.\+" .env && echo "$k set" || echo "$k missing"; done
  ```
- In evidence, mask values: `code=<masked>`, `access_token: <present>`. Snapshot `localStorage` and cookies by **name** only. Do not screenshot devtools panels that show token values.
- The OAuth2 `client_secret` from `/oauth2/register` is never printed (§8 filters it out).

## 2. Before starting
1. Docker running (`docker info --format '{{.ServerVersion}}'`).
2. Ports free. Stale servers serve old code, and on Windows several uvicorn processes can share :8080:
   ```bash
   netstat -ano | grep LISTENING | grep -E ':(5173|5174|8080) '
   ```
   If something listens, find out what it is (`tasklist //FI "PID eq <pid>"`). Ask the user before stopping a process you did not start.
3. Dev database: the local Postgres (compose `postgres` service, `docker compose up -d postgres`, which starts only the database) at Alembic head. Starting only the database container does not migrate.
4. Maps key for `next dev` (W13 runs without one first): `src/frontend/.env.local` with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Presence check only. Next inlines it at dev-server start, so restart `next dev` after adding or removing it.

## 3. Backend (dev, :8080)
```bash
cd src/backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8080
```
- Run it in the background and keep its log. W03 and S14c read the access-log lines.
- Health check: `curl -s http://localhost:8080/api/health`.
- After stopping it, re-run the `netstat` check: no listener may be left on :8080.

## 4. Frontend (dev, :5173)
```bash
cd src/frontend
npm run dev        # predev builds the plugin SDK into public/assets, then next dev -p 5173
```
- `BACKEND_INTERNAL_URL` defaults to `http://localhost:8080`, so dev needs no env file.
- Check: `curl -sI http://localhost:5173/assets/plugin-sdk.js` → 200.
- W02 needs a **freshly started** dev server. Run it before other rows, or restart `next dev` for it.
- `next.config.ts` sets `agentRules: false`, so no `AGENTS.md` is expected. Delete `src/frontend/AGENTS.md` anyway if it appears.

## 5. Compose (:5174), started by the user
1. The backend image needs the `hf_token` build secret (`HF_TOKEN` in the user's shell) and must be rebuilt before the first `up` after this migration.
2. Rename `VITE_GOOGLE_MAPS_API_KEY` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in the root `.env` if not done yet (presence check only).
3. `docker compose up -d --build` (the user runs it: it migrates the compose database).
4. Check: `docker compose ps` (postgres, backend, web, frontend up), then `curl -sI http://localhost:5174/` → 200 and `curl -s http://localhost:5174/.well-known/oauth-authorization-server` → JSON.
5. Logs for evidence: `docker compose logs --no-color web frontend backend | tail -n 200`. Logs can contain request URLs, so mask any `code=` or token query values before saving.
6. Stop with `docker compose stop` when done. Do not run `down -v`: it deletes the compose database.

## 6. Test accounts and data
- **ADMIN**: an account with the ADMIN role (S02, S13a, most rows).
- **EDIT-only editor**: an account with EDIT permission and no ADMIN (S13b, W12).
- Also needed, from the dev DB: an Organization slug with a cover and a custom palette, a UUID party, an event, a public circle with an upcoming term, a private circle with a term (W08), an ACTIVE listed item, a conversation, and a plugin with a registered manifest (S13c). Note the ids in the checklist notes. Ids are not secret.
- Log in through `/login` in the Playwright browser. The user enters or provides the credentials. Never write them into a file or a command that is logged.

## 7. Stale cookie (S04, W04)
In the Playwright browser, on any page of `http://localhost:5173`, run `browser_evaluate` with:
```js
() => {
  localStorage.clear();
  document.cookie = "auth_token=garbage; Path=/; SameSite=Lax";
}
```
Then navigate to `/` (S04a) or `/home` (W04). For S04b, use an expired JWT-shaped value instead. It is fake and has no signature: `eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.x` (`{"exp":1}`).
Check afterwards, by name only:
```js
() => ({ hasAuthCookie: document.cookie.split("; ").some((c) => c.startsWith("auth_token=")), hasStoredToken: localStorage.getItem("auth_token") !== null })
```

## 8. Commands

### 8.1 OG curl (S10, S16c, W08)
```bash
og() { MSYS_NO_PATHCONV=1 curl -s -A 'facebookexternalhit/1.1' -w '\nHTTP %{http_code}\n' "http://localhost:5173$1" \
  | grep -oE '<title>[^<]*</title>|<meta (property|name)="(og|twitter):[^>]*>|HTTP [0-9]+|--color-primary:[^;"]*' ; }
og /<org-slug>
og /<org-slug>/event/<eventId>
og /<org-slug>/group/<groupId>/term/<termId>
```
Save the output to `verification/smoke/S10a-og.txt` and so on. For compose, use port 5174.

### 8.2 Redirect checks (S03b, S05f, S07, S15)
```bash
MSYS_NO_PATHCONV=1 curl -sI "http://localhost:5173/home?x=1" | grep -iE '^(HTTP|location)'
for p in /meetings /messages /admin /onboarding /groupsx; do printf '%s ' "$p"; MSYS_NO_PATHCONV=1 curl -sI "http://localhost:5173$p" | grep -iE '^(HTTP|location)' | tr '\r\n' '  '; echo; done
```

### 8.3 OAuth2 client and PKCE (S14)
Register a public client. Only the `client_id` is printed:
```bash
MSYS_NO_PATHCONV=1 curl -s -X POST http://localhost:5173/oauth2/register -H 'Content-Type: application/json' \
  -d '{"client_name":"Smoke client","redirect_uris":["http://localhost:9999/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"none","scope":"mcp:read mcp:edit"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).client_id))'
```
PKCE pair (non-secret test values, valid for this run only):
```bash
node -e 'const c=require("crypto");const v=c.randomBytes(32).toString("base64url");console.log("verifier="+v);console.log("challenge="+c.createHash("sha256").update(v).digest("base64url"))'
```
Open in the browser: `/oauth2/authorize?response_type=code&client_id=<id>&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcallback&scope=mcp%3Aread%20mcp%3Aedit&state=smoke1&code_challenge=<challenge>&code_challenge_method=S256`.
Nothing listens on :9999, so the final page fails to load. That is expected: read `code` and `state` from the redirect URL in the network log. Record only that `code` is present and that `state=smoke1`.
Token exchange (S14d). Only the status and the key names are printed:
```bash
cd "$TEMP"   # outside the repo
MSYS_NO_PATHCONV=1 curl -s -o tok.json -w 'HTTP %{http_code}\n' -X POST http://localhost:5173/oauth2/token \
  -d grant_type=authorization_code -d code=<code> -d redirect_uri=http://localhost:9999/callback -d client_id=<id> -d code_verifier=<verifier>
node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync("tok.json","utf8"))))'; rm -f tok.json
```

### 8.4 Optional forwarded-header echo (W03)
This shows what the proxy rewrite sends to the backend. It uses a second dev server on :5176 that points at an echo listener on :8099, and it prints only `Host` and `X-Forwarded-*`:
```bash
node -e 'require("http").createServer((q,r)=>{const h=Object.fromEntries(Object.entries(q.headers).filter(([k])=>k==="host"||k.startsWith("x-forwarded")));console.log(q.method,q.url,h);r.end("ok")}).listen(8099)' &
cd src/frontend && BACKEND_INTERNAL_URL=http://localhost:8099 npx next dev -p 5176 &
MSYS_NO_PATHCONV=1 curl -s -X POST http://localhost:5176/oauth2/authorize -d probe=1 -H 'X-Forwarded-Host: public.example' -H 'X-Forwarded-Proto: https'
```
Stop both processes afterwards and check that :5176 and :8099 are free.

### 8.5 Upload size (S16a, W06)
Make the test files locally, outside the repo (they are random bytes, so use a real 15 MB JPEG/PNG for the success case if the backend rejects undecodable data):
```bash
node -e 'require("fs").writeFileSync(process.argv[1], require("crypto").randomBytes(17*1024*1024))' "$TEMP/smoke-17mb.bin"
```
Upload through the item photo UI on :5174 and record the status of the upload request.

## 9. Evidence
- Folder: `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs/verification/smoke/`. Create it on first use.
- Names: `<row-id>-<short>.png|txt|json`, e.g. `S02a-home.png`, `S10a-og.txt`, `W01-console.txt`.
- Playwright: `browser_snapshot` (structure), `browser_take_screenshot` (visual rows: palette, Chakra, h-dvh), `browser_console_messages` (HYD/EMO rows: save the full list), `browser_network_requests` (redirects, AppData requests, uploads). Mask token values in saved network output.
- Fill the **Result** column and the run summary in `smoke-checklist.md`. A FAIL gets a one-line cause and the evidence file name.

## 10. Cleanup
- Stop the dev backend, `next dev`, any echo listener and any extra dev server. Then run `netstat -ano | grep LISTENING | grep -E ':(5173|5176|8080|8099) '`: no output expected.
- Close the Playwright browser (`browser_close`).
- Compose: `docker compose stop` (not `down -v`).
- Delete `src/frontend/AGENTS.md` if present. Delete local upload test files.
- Report which processes you stopped.
