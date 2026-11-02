import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getMyProfile } from "../api/people";
import { useRouterRefresh } from "../routing/navigation";
import { clearSession, decodeJwtPayload, reconcileSession, setSession } from "./session";

export interface RegisterPayload {
  role: "GUEST" | "ORGANIZER";
  email: string;
  password: string;
}

export interface RegisterResult {
  partyId: string;
  role: string;
}

interface AuthContextValue {
  token: string | null;
  username: string | null;
  displayName: string | null;
  permissions: string[];
  /** Set by `register()` for the lifetime of the current session — lets
   * `/onboarding` pick the right `Step[]` config right after a fresh
   * registration without a follow-up `GET /api/people/me` call. `null`
   * when the app was loaded from a stored token instead (returning user),
   * in which case callers fall back to a profile/leaderships lookup. */
  registeredRole: RegisterResult | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<RegisterResult>;
  /** Stores `jwt` as the session (`auth/session.ts`), decodes its claims, and updates
   * context state — identical body to the internal `applyToken`, just
   * exposed publicly for a non-login/register auth event (spec.md §4's
   * account-merge flow: the visitor is authenticated by a merge response,
   * not a `/api/auth/login` or `/api/auth/register` call). */
  applyExternalToken: (jwt: string) => void;
  logout: () => void;
  /** Clears an expired session without leaving the page (`AuthGuard`). */
  expireSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function claimsOf(token: string | null): { username: string | null; permissions: string[] } {
  if (!token) return { username: null, permissions: [] };
  const payload = decodeJwtPayload(token);
  return { username: payload.sub ?? null, permissions: payload.permissions ?? [] };
}

/** `initialToken` seeds the first render (the server cookie under Next, the
 * localStorage token under Vite); a mount effect then reconciles it with the
 * browser's stored session. */
export function AuthProvider({ children, initialToken }: { children: ReactNode; initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [username, setUsername] = useState<string | null>(() => claimsOf(initialToken).username);
  const [permissions, setPermissions] = useState<string[]>(() => claimsOf(initialToken).permissions);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [registeredRole, setRegisteredRole] = useState<RegisterResult | null>(null);

  const refreshDisplayName = useCallback(async () => {
    try {
      const me = await getMyProfile();
      setDisplayName(me.display_name);
    } catch {
      setDisplayName(null);
    }
  }, []);

  const showToken = useCallback((jwt: string | null) => {
    const claims = claimsOf(jwt);
    setToken(jwt);
    setUsername(claims.username);
    setPermissions(claims.permissions);
  }, []);

  const resetAuth = useCallback(() => {
    clearSession();
    showToken(null);
    setDisplayName(null);
    setRegisteredRole(null);
  }, [showToken]);

  const applyToken = useCallback(
    (jwt: string) => {
      setSession(jwt);
      showToken(jwt);
      void refreshDisplayName();
    },
    [showToken, refreshDisplayName],
  );

  // Layout effect: runs before any child's data fetch reads the stored token.
  useLayoutEffect(() => {
    const reconciled = reconcileSession();
    if (reconciled !== initialToken) showToken(reconciled);
    if (reconciled) void refreshDisplayName();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshRouter = useRouterRefresh();
  const previousToken = useRef(token);
  useEffect(() => {
    if (previousToken.current === token) return;
    previousToken.current = token;
    refreshRouter();
  }, [token, refreshRouter]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Login failed" }));
        throw new Error(body.message ?? "Login failed");
      }

      const { token: jwt } = await response.json();
      applyToken(jwt);
    },
    [applyToken],
  );

  const register = useCallback(
    async (payload: RegisterPayload): Promise<RegisterResult> => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: payload.role,
          email: payload.email,
          password: payload.password,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Registration failed" }));
        throw new Error(body.message ?? "Registration failed");
      }

      const { token: jwt, party_id: partyId, role } = await response.json();
      applyToken(jwt);
      const result = { partyId, role };
      setRegisteredRole(result);
      return result;
    },
    [applyToken],
  );

  const logout = useCallback(() => {
    resetAuth();
    window.location.href = "/login";
  }, [resetAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      username,
      displayName,
      permissions,
      registeredRole,
      login,
      register,
      applyExternalToken: applyToken,
      logout,
      expireSession: resetAuth,
    }),
    [token, username, displayName, permissions, registeredRole, login, register, applyToken, logout, resetAuth],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
