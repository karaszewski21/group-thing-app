import type { ReactNode } from "react";

/** Every panel section but the chat thread: one padded scroller inside the
 * panel frame. The thread (`messages/[conversationId]`) sits outside this
 * group because it scrolls its own message list above the composer. */
export default function PanelScrollLayout({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">{children}</div>;
}
