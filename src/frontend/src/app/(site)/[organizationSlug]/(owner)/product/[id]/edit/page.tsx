import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ organizationSlug: string; id: string }> }) {
  const { organizationSlug, id } = await params;
  redirect(`/${encodeURIComponent(organizationSlug)}/product/${encodeURIComponent(id)}?edit=1`);
}
