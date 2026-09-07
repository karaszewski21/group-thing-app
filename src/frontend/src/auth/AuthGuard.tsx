import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { ReactNode } from "react";

interface AuthGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
  /** Where to send an already-authenticated user away from a
   * `requireAuth={false}` page (e.g. /login, /register) when no
   * `?returnTo=` is present. Defaults to "/panel". `/register` passes
   * "/onboarding" here so this guard's own redirect (which fires the
   * instant `register()` sets a token, racing the imperative
   * `navigate("/onboarding")` in RegisterPage's submit handler) can never
   * disagree with — and beat — the intended post-registration destination. */
  authenticatedRedirect?: string;
}

export function AuthGuard({ children, requireAuth = true, authenticatedRedirect = "/panel" }: AuthGuardProps) {
  const { token } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  if (requireAuth && !token) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (!requireAuth && token) {
    const returnTo = searchParams.get("returnTo") || authenticatedRedirect;
    return <Navigate to={returnTo} replace />;
  }

  return <>{children}</>;
}
