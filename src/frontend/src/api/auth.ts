import { api } from "./client";
import { hasStatus } from "./problem";

interface GoogleNonceResponse {
  nonce: string;
}

/** A fresh nonce for the Google button (the response also rotates the nonce
 * cookie), or `null` when Google login is unavailable (503). A plain call,
 * not a query: each request must reach the server and is never cached. */
export async function getGoogleNonce(): Promise<string | null> {
  try {
    const { nonce } = await api.post<GoogleNonceResponse>("/auth/google/nonce", {});
    return nonce;
  } catch (err) {
    if (hasStatus(err, 503)) return null;
    throw err;
  }
}
