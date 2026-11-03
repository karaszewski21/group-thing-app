"use client";

import type { ReactNode } from "react";
import { PanelGate } from "../../../features/panel/PanelGate";
import { ClientOnly } from "../../../routing/ClientOnly";

/** The panel, browser-only: PanelGate's session gate and AppPage around the
 * section page, kept mounted while switching sections. */
export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <ClientOnly>
      <PanelGate>{children}</PanelGate>
    </ClientOnly>
  );
}
