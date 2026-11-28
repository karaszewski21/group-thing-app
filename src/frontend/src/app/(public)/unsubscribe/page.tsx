import type { Metadata } from "next";
import { UnsubscribePage } from "../../../features/email/UnsubscribePage";

/** The token in the URL never leaves through the Referer header. */
export const metadata: Metadata = { title: "Wypisz się z maili", referrer: "no-referrer", robots: { index: false } };

export default function Page() {
  return <UnsubscribePage />;
}
