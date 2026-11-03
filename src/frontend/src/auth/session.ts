/** The login JWT lives in two places kept in lockstep: localStorage (read by
 * `api/client.ts` and the plugin host's `getToken`) and the non-HttpOnly
 * `auth_token` cookie (read by the backend on GET/HEAD and by the server
 * render). Every write goes through `setSession`/`clearSession`. */
const TOKEN_KEY = "auth_token";

interface JwtClaims {
  sub?: string;
  permissions?: string[];
  exp?: number;
}

export function decodeJwtPayload(token: string): JwtClaims {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return {};
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return {};
  }
}

/** A token without an `exp` claim counts as expired. */
export function isTokenExpired(token: string): boolean {
  const { exp } = decodeJwtPayload(token);
  if (!exp) return true;
  return exp * 1000 < Date.now();
}

/** True only when the token carries an `exp` that has passed. */
export function hasTokenExpired(token: string): boolean {
  const { exp } = decodeJwtPayload(token);
  return exp !== undefined && exp * 1000 < Date.now();
}

/** The raw localStorage token; `null` while server rendering. */
export function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** What the server render may know about the session: the claims of an
 * unexpired cookie token, never the token itself (it would be embedded in the
 * page's HTML/RSC payload). Garbage or expired cookies give `null`. */
export interface InitialSession {
  username: string | null;
  permissions: string[];
}

export function sessionFromToken(token: string | null | undefined): InitialSession | null {
  if (!token || isTokenExpired(token)) return null;
  const { sub, permissions } = decodeJwtPayload(token);
  return { username: sub ?? null, permissions: permissions ?? [] };
}

export function readCookieToken(): string | null {
  const prefix = `${TOKEN_KEY}=`;
  const entry = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

function writeCookie(value: string, maxAgeSeconds: number | null): void {
  const maxAge = maxAgeSeconds === null ? "" : `; Max-Age=${maxAgeSeconds}`;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${maxAge}${secure}`;
}

export function setSession(jwt: string): void {
  localStorage.setItem(TOKEN_KEY, jwt);
  const { exp } = decodeJwtPayload(jwt);
  const maxAge = exp === undefined ? null : Math.max(0, exp - Math.floor(Date.now() / 1000));
  writeCookie(jwt, maxAge);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  writeCookie("", 0);
}

/** Boot reconciliation: a valid localStorage token wins, otherwise a valid
 * cookie token is copied to localStorage, otherwise both are cleared. The
 * cookie is always rewritten to match. Returns the surviving token. */
export function reconcileSession(): string | null {
  const stored = readStoredToken();
  const cookie = readCookieToken();
  const winner =
    stored && !isTokenExpired(stored) ? stored : cookie && !isTokenExpired(cookie) ? cookie : null;
  if (winner) {
    setSession(winner);
  } else {
    clearSession();
  }
  return winner;
}
