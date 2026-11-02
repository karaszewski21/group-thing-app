import type { ReactNode } from "react";
import { getPublicOrganizationOnServer } from "../../../../api/server";
import { ServerThemeProvider } from "../../../../theme/ServerThemeProvider";

/** The Organization's palette on first paint for every owner page; a person
 * profile, `krag` or an unknown slug renders without one. */
export default async function OwnerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const organization = await getPublicOrganizationOnServer((await params).organizationSlug);
  if (organization === null) return children;
  const { primary_color, accent_color, palette_preset } = organization;
  return (
    <ServerThemeProvider initialTheme={{ primary_color, accent_color, palette_preset }}>{children}</ServerThemeProvider>
  );
}
