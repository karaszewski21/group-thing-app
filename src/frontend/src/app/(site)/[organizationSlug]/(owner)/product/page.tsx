import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  redirect(`/${encodeURIComponent(organizationSlug)}`);
}
