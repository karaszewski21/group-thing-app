import type { ReactNode } from "react";

/**
 * Shared "phone" chrome for the new Tailwind pages (Panel, Inventory) —
 * Tailwind port of pages/PanelGoscia.tsx's `.org-stage`/`.org-phone` pattern:
 * full-height mobile view below 520px, a floating rounded "device" with a
 * solid dark bezel ring above it.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen justify-center bg-[#EDF1EA] font-sans text-ink min-[520px]:bg-[#E7EDE4] min-[520px]:p-6">
      <div className="flex min-h-screen w-full flex-col bg-cream min-[520px]:my-2 min-[520px]:min-h-0 min-[520px]:overflow-hidden">
        {children}
      </div>
    </div>
  );
}
