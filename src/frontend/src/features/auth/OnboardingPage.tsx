import { useEffect, useState } from "react";
import { Navigate, useAppNavigate, useAppSearchParams } from "../../routing/navigation";
import { useAuth } from "../../auth/AuthContext";
import { getLeadershipsForPerson, getMyProfile } from "../../api/people";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { organizerSteps } from "./onboarding/steps/organizerSteps";

type Role = "GUEST" | "ORGANIZER";

/**
 * Role-aware landing for `/onboarding`, entered immediately after
 * registration. Only an ORGANIZER gets a wizard; a GUEST goes straight on
 * to `returnTo` (or `/`). Prefers the role captured by `AuthContext.register()`
 * (no extra round trip); falls back to a profile/leaderships lookup for
 * the rarer case of the route being reached via a stored token (e.g. a
 * page refresh) rather than a fresh register call.
 */
export function OnboardingPage() {
  const { registeredRole } = useAuth();
  const navigate = useAppNavigate();
  const [searchParams] = useAppSearchParams();
  const [role, setRole] = useState<Role | null>(
    registeredRole ? (registeredRole.role === "ORGANIZER" ? "ORGANIZER" : "GUEST") : null,
  );
  const [loading, setLoading] = useState(role === null);

  useEffect(() => {
    if (role !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await getMyProfile();
        const leaderships = await getLeadershipsForPerson(profile.id);
        if (!cancelled) {
          setRole(leaderships.some((l) => l.valid_to === null) ? "ORGANIZER" : "GUEST");
        }
      } catch {
        if (!cancelled) setRole("GUEST");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const returnTo = searchParams.get("returnTo") || "/";

  function finishOnboarding() {
    navigate(returnTo, { replace: true });
  }

  if (loading || role === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream text-ink-soft">
        Wczytywanie…
      </div>
    );
  }

  if (role === "GUEST") return <Navigate to={returnTo} replace />;

  return (
    <OnboardingWizard
      steps={organizerSteps}
      onSkip={finishOnboarding}
      onComplete={finishOnboarding}
    />
  );
}
