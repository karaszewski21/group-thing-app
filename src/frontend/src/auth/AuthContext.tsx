import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getMyProfile } from "../api/people";
import { useRouterRefresh } from "../routing/navigation";
import {
  clearSession,
  decodeJwtPayload,
  readCookieToken,
  readStoredToken,
  reconcileSession,
  setSession,
  type InitialSession,
} from "./session";

export interface RegisterPayload {
  email: string;
  password: string;
}

interface AuthContextValue {
  token: string | null;
  username: string | null;
  displayName: string | null;
  permissions: string[];
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
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

/** Stands in for the token on the server render, which only gets the claims. */
const SERVER_SESSION_TOKEN = "server-session";

function initialTokenFor(session: InitialSession | null): string | null {
  if (!session) return null;
  if (typeof window === "undefined") return SERVER_SESSION_TOKEN;
  return readStoredToken() ?? readCookieToken() ?? SERVER_SESSION_TOKEN;
}

/** `initialSession` (the claims of the server's unexpired cookie token) seeds
 * the first render so logged-in chrome matches the server HTML; a layout
 * effect then reconciles it with the browser's stored session. */
export function AuthProvider({ children, initialSession }: { children: ReactNode; initialSession: InitialSession | null }) {
  const [initialToken] = useState(() => initialTokenFor(initialSession));
  const [token, setToken] = useState<string | null>(initialToken);
  const [username, setUsername] = useState<string | null>(initialSession?.username ?? null);
  const [permissions, setPermissions] = useState<string[]>(initialSession?.permissions ?? []);
  const [displayName, setDisplayName] = useState<string | null>(null);

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
    async (payload: RegisterPayload): Promise<void> => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "GUEST",
          email: payload.email,
          password: payload.password,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Registration failed" }));
        throw new Error(body.message ?? "Registration failed");
      }

      const { token: jwt } = await response.json();
      applyToken(jwt);
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
      login,
      register,
      logout,
      expireSession: resetAuth,
    }),
    [token, username, displayName, permissions, login, register, logout, resetAuth],
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
