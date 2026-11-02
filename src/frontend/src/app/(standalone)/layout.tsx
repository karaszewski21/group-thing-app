"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "../../auth/AuthGuard";
import { ClientOnly } from "../../routing/ClientOnly";

export default function StandaloneLayout({ children }: { children: ReactNode }) {
  return (
    <ClientOnly>
      <AuthGuard>{children}</AuthGuard>
    </ClientOnly>
  );
}
