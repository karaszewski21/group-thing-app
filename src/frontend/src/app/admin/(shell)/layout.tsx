"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "../../../auth/AuthGuard";
import { AppShell } from "../../../components/layout/AppShell";
import { PluginProvider } from "../../../plugins/host/PluginHost";
import { ClientOnly } from "../../../routing/ClientOnly";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ClientOnly>
      <AuthGuard>
        <PluginProvider>
          <AppShell>{children}</AppShell>
        </PluginProvider>
      </AuthGuard>
    </ClientOnly>
  );
}
