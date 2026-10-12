import type { ReactNode } from "react";

/** Shell of the group/term screens: the cream page in the (organizer-themed)
 * tokens. `overlay` renders after the content (toasts, bottom sheets). */
export function KragStage({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-cream font-sans text-ink">
      {children}
      {overlay}
    </div>
  );
}
