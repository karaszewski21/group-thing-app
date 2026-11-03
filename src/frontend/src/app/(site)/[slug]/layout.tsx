import type { ReactNode } from "react";
import { getPublicOrganizationOnServer } from "../../../api/server";
import { ServerThemeProvider } from "../../../theme/ServerThemeProvider";

/** The Organization's palette on first paint for every page under the slug;
 * a person profile, `krag` or an unknown slug renders without one. The event
 * and term pages wrap their own palette (from the event or circle) inside it. */
export default async function OwnerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const organization = await getPublicOrganizationOnServer((await params).slug);
  if (organization === null) return children;
  const { primary_color, accent_color, palette_preset } = organization;
  return (
    <ServerThemeProvider initialTheme={{ primary_color, accent_color, palette_preset }}>{children}</ServerThemeProvider>
  );
}
