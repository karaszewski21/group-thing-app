import type { Metadata } from "next";
import { getPublicOrganizationOnServer } from "../../../api/server";
import { OwnerPage } from "../../../features/owner-page/OwnerPage";
import { organizationMetadata } from "../../../lib/publicMetadata";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return organizationMetadata(await getPublicOrganizationOnServer((await params).slug));
}

export default function Page() {
  return <OwnerPage />;
}
