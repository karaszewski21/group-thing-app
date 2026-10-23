import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { authPath } from "./authPaths";
import { homePath } from "./homePath";
import type { ReactNode } from "react";

interface AuthGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
  /** Where to send an already-authenticated user away from a
   * `requireAuth={false}` page (/login's two tabs) when no
   * `?returnTo=` is present. Defaults to `homePath(permissions)`: back-office
   * roles to `/admin/products`, everyone else to the panel's Start at "/".
   * The "Załóż konto" tab passes "/onboarding" here so this guard's own
   * redirect (which fires the instant `register()` sets a token, racing the
   * imperative `navigate("/onboarding")` in RegisterForm's submit handler) can never
   * disagree with — and beat — the intended post-registration destination. */
  authenticatedRedirect?: string;
  /** Pass a `?returnTo=` on to `authenticatedRedirect` instead of jumping
   * straight to it — the "Załóż konto" tab uses this so onboarding still
   * runs before the visitor is sent back. */
  forwardReturnTo?: boolean;
}

export function AuthGuard({
  children,
  requireAuth = true,
  authenticatedRedirect,
  forwardReturnTo = false,
}: AuthGuardProps) {
  const { token, permissions } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  if (requireAuth && !token) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={authPath("login", returnTo)} replace />;
  }

  if (!requireAuth && token) {
    const returnTo = searchParams.get("returnTo");
    const redirect = authenticatedRedirect ?? homePath(permissions);
    if (!returnTo) return <Navigate to={redirect} replace />;
    if (forwardReturnTo) {
      return <Navigate to={`${redirect}?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }
    return <Navigate to={returnTo} replace />;
  }

  return <>{children}</>;
}
