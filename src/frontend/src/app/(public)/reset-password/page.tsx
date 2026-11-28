import type { Metadata } from "next";
import { ResetPasswordPage } from "../../../features/auth/ResetPasswordPage";

/** `no-referrer`: the mailed `?token=` never leaves through the Referer header. */
export const metadata: Metadata = { title: "Reset hasła", referrer: "no-referrer", robots: { index: false } };

export default function Page() {
  return <ResetPasswordPage />;
}
