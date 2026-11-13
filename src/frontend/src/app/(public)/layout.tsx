"use client";

import type { ReactNode } from "react";
import { PublicPageLayout } from "../../components/layout/PublicPageLayout";

export default function Layout({ children }: { children: ReactNode }) {
  return <PublicPageLayout>{children}</PublicPageLayout>;
}
