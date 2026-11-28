import type { Metadata } from "next";
import { VerifyEmailPage } from "../../../features/email/VerifyEmailPage";

/** The token in the URL never leaves through the Referer header. */
export const metadata: Metadata = { title: "Potwierdź adres", referrer: "no-referrer", robots: { index: false } };

export default function Page() {
  return <VerifyEmailPage />;
}
