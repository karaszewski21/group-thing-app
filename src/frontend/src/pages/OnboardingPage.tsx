import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getLeadershipsForPerson, getMyProfile } from "../api/people";
import { OnboardingWizard } from "../components/onboarding/OnboardingWizard";
import { guestSteps } from "../components/onboarding/steps/guestSteps";
import { organizerSteps } from "../components/onboarding/steps/organizerSteps";

type Role = "GUEST" | "ORGANIZER";

/**
 * Role-aware landing for `/onboarding`, entered immediately after
 * registration. Prefers the role captured by `AuthContext.register()`
 * (no extra round trip); falls back to a profile/leaderships lookup for
 * the rarer case of the route being reached via a stored token (e.g. a
 * page refresh) rather than a fresh register call.
 */
export function OnboardingPage() {
  const { registeredRole } = useAuth();
  const navigate = useNavigate();
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

  function goToPanel() {
    navigate("/panel", { replace: true });
  }

  if (loading || role === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream text-ink-soft">
        Wczytywanie…
      </div>
    );
  }

  return (
    <OnboardingWizard
      steps={role === "ORGANIZER" ? organizerSteps : guestSteps}
      onSkip={goToPanel}
      onComplete={goToPanel}
    />
  );
}
