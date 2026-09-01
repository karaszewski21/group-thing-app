## Plugin Authentication

The client-side contract described in this document is **unchanged by the backend migration** — the FastAPI backend still issues plain JWS tokens (never JWE) with the same flat `permissions`/`scopes` string-array claim shape the plugin SDKs already decode. Only the server-side implementation details below were updated to reference the current backend.

### Browser SDK Auth

Plugin iframes use `sdk.hostApp.getToken()` to obtain the logged-in user's JWT from the host via `postMessage`. The host's message handler serves this by reading the token from localStorage — unchanged from before the migration; no code change was needed in `plugins/` or `src/frontend/` for this migration.

### Plugin Server-Side Auth

Plugin backends (e.g., Next.js API routes) receive the JWT from their own frontend and forward it to the host API — now the FastAPI backend at `app/` — via `createServerSDK`:

```typescript
// Plugin API route — pass the incoming request directly
const sdk = createServerSDK("my-plugin", undefined, req);
```

The SDK extracts the `Authorization` header from the request object automatically. On the host side, the FastAPI backend's `app/core/auth_deps.py` reads that same `Authorization: Bearer <token>` header (or, for the OAuth2 `/oauth2/authorize` form-post flow only, a `_token` query/form-param fallback) — see `standards/backend/security.md`.

### Permission Checking in Plugins

Plugins should check user permissions before showing write UI. Decode the JWT from `hostApp.getToken()` to read the `permissions` claim — **still unverified, client-side only**, exactly as before the migration (the FastAPI backend performs its own signature verification server-side on every request; the client-side decode below is purely a UI convenience, never a security boundary):

```typescript
const token = await sdk.hostApp.getToken();
if (token) {
  const payload = JSON.parse(atob(token.split(".")[1]));
  const canEdit = payload.permissions?.includes("EDIT");
}
```

Note: a token obtained via the OAuth2 token-exchange bridge (`mcp:read`/`mcp:edit` scopes, see `standards/backend/security.md`) carries a `scopes` claim instead of `permissions`, already mapped to the same `READ`/`EDIT` permission names — the decode snippet above only reads `permissions`, so it will not see an OAuth2-issued token's grants under this field name. This is unchanged from the pre-migration behavior (the Java backend produced the same two distinct claim shapes) — not a regression introduced by this migration.

---

*Last Updated*: 2026-09-01 — server-side implementation notes updated for the FastAPI backend (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`); the client-side contract itself is unchanged.
