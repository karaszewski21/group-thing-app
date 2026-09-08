import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getMyProfile } from "../api/people";

export interface RegisterPayload {
  role: "GUEST" | "ORGANIZER";
  email: string;
  password: string;
}

export interface RegisterResult {
  partyId: number;
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
  /** Stores `jwt` under `"auth_token"`, decodes its claims, and updates
   * context state — identical body to the internal `applyToken`, just
   * exposed publicly for a non-login/register auth event (spec.md §4's
   * account-merge flow: the visitor is authenticated by a merge response,
   * not a `/api/auth/login` or `/api/auth/register` call). */
  applyExternalToken: (jwt: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwtPayload(token: string): { sub?: string; permissions?: string[]; exp?: number } {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return {};
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload.exp) return true;
  return payload.exp * 1000 < Date.now();
}

function loadStoredAuth(): { token: string | null; username: string | null; permissions: string[] } {
  const stored = localStorage.getItem("auth_token");
  if (stored && !isTokenExpired(stored)) {
    const payload = decodeJwtPayload(stored);
    return { token: stored, username: payload.sub ?? null, permissions: payload.permissions ?? [] };
  }
  if (stored) {
    localStorage.removeItem("auth_token");
  }
  return { token: null, username: null, permissions: [] };
}

const initialAuth = loadStoredAuth();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(initialAuth.token);
  const [username, setUsername] = useState<string | null>(initialAuth.username);
  const [permissions, setPermissions] = useState<string[]>(initialAuth.permissions);
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

  const applyToken = useCallback(
    (jwt: string) => {
      localStorage.setItem("auth_token", jwt);
      const payload = decodeJwtPayload(jwt);
      setToken(jwt);
      setUsername(payload.sub ?? null);
      setPermissions(payload.permissions ?? []);
      void refreshDisplayName();
    },
    [refreshDisplayName],
  );

  // Populate displayName on initial load when a valid token was already
  // stored (applyToken only runs on fresh login/register).
  useEffect(() => {
    if (initialAuth.token) {
      void refreshDisplayName();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    localStorage.removeItem("auth_token");
    setToken(null);
    setUsername(null);
    setPermissions([]);
    setDisplayName(null);
    setRegisteredRole(null);
    window.location.href = "/login";
  }, []);

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
    }),
    [token, username, displayName, permissions, registeredRole, login, register, applyToken, logout],
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
