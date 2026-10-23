import type { ReactNode } from "react";

/**
 * Shared "phone" chrome for the new Tailwind pages (Panel, Inventory) —
 * Tailwind port of pages/PanelGoscia.tsx's `.org-stage`/`.org-phone` pattern:
 * fills the space between PublicLayout's top and bottom bars below 520px,
 * a floating rounded "device" with a solid dark bezel ring above it.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 justify-center bg-stage font-sans text-ink min-[520px]:bg-stage-wide min-[520px]:p-6">
      <div className="flex w-full flex-col bg-cream min-[520px]:my-2 min-[520px]:overflow-hidden">
        {children}
      </div>
    </div>
  );
}
