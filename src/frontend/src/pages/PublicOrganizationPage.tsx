import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPublicOrganization, type PublicOrganizationResponse } from "../api/organizations";

const DEFAULT_PRIMARY = "#1b8168"; // --color-mint
const DEFAULT_ACCENT = "#a9c24f"; // --color-lime

/**
 * Public, unauthenticated organizer page at `domena.pl/<slug>` — this is
 * the mounted-last catch-all route in `router.tsx` (after every fixed
 * route), which is exactly why `slugs.RESERVED_SLUGS` on the backend must
 * never hand out a slug matching one of those fixed paths: this route
 * would otherwise permanently shadow it.
 */
export function PublicOrganizationPage() {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [organization, setOrganization] = useState<PublicOrganizationResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!organizationSlug) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    getPublicOrganization(organizationSlug)
      .then((org) => {
        if (!cancelled) setOrganization(org);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream text-ink-soft">
        Wczytywanie…
      </div>
    );
  }

  if (notFound || !organization) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-4 text-center font-sans text-ink">
        <div>
          <h1 className="mb-2 font-serif text-2xl font-semibold">Nie znaleziono strony</h1>
          <p className="text-sm text-ink-soft">Ta organizacja nie istnieje.</p>
        </div>
      </div>
    );
  }

  const primaryColor = organization.primary_color ?? DEFAULT_PRIMARY;
  const accentColor = organization.accent_color ?? DEFAULT_ACCENT;

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-cream px-4 py-10 font-sans text-ink"
      style={{
        ["--color-mint" as string]: primaryColor,
        ["--color-lime" as string]: accentColor,
      }}
    >
      <div className="w-full max-w-[440px] rounded-[22px] border border-line bg-paper p-10 text-center">
        <span className="mb-4 inline-flex rounded-full bg-lime-soft px-3.5 py-1.5 text-xs font-extrabold text-[#56701F]">
          Organizacja
        </span>
        <h1 className="mb-2 font-serif text-3xl font-semibold text-ink">
          {organization.name}
        </h1>
        <p className="mt-6 text-sm text-ink-soft">domena.pl/{organization.slug}</p>
      </div>
    </div>
  );
}
