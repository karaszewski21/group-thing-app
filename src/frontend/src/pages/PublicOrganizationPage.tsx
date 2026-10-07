import { useParams } from "react-router-dom";
import { usePublicOrganization } from "../hooks/usePublicOrganization";
import { OrganizerThemeScope } from "../theme/OrganizerThemeScope";

/**
 * Public, unauthenticated organizer page at `domena.pl/<slug>` — this is
 * the mounted-last catch-all route in `router.tsx` (after every fixed
 * route), which is exactly why `slugs.RESERVED_SLUGS` on the backend must
 * never hand out a slug matching one of those fixed paths: this route
 * would otherwise permanently shadow it.
 */
export function PublicOrganizationPage() {
  const { organizationSlug = "" } = useParams<{ organizationSlug: string }>();
  const { data: organization, loading } = usePublicOrganization(organizationSlug);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream text-ink-soft">
        Wczytywanie…
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-4 text-center font-sans text-ink">
        <div>
          <h1 className="mb-2 font-serif text-2xl font-semibold">Nie znaleziono strony</h1>
          <p className="text-sm text-ink-soft">Ta organizacja nie istnieje.</p>
        </div>
      </div>
    );
  }

  return (
    <OrganizerThemeScope theme={organization}>
      <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10 font-sans text-ink">
        <div className="w-full max-w-[440px] rounded-[22px] border border-line bg-paper p-10 text-center">
          <span className="mb-4 inline-flex rounded-full bg-accent-soft px-3.5 py-1.5 text-xs font-extrabold text-accent-fg">
            Organizacja
          </span>
          <h1 className="mb-2 font-serif text-3xl font-semibold text-ink">
            {organization.name}
          </h1>
          <p className="mt-6 text-sm text-ink-soft">domena.pl/{organization.slug}</p>
        </div>
      </div>
    </OrganizerThemeScope>
  );
}
