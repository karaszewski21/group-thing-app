"use client";

import { PanelGate } from "../../../features/panel/PanelGate";
import { ClientOnly } from "../../../routing/ClientOnly";

/** Every panel section renders PanelGate; the section pages are empty. */
export default function PanelLayout() {
  return (
    <ClientOnly>
      <PanelGate />
    </ClientOnly>
  );
}
