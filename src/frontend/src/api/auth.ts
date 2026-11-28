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

export type AccountTokenPurpose = "VERIFY_EMAIL" | "PASSWORD_RESET";

/** The address an account token was issued for. */
export interface AccountTokenLookupResponse {
  email: string;
}

/** Always 202, whether or not the address has an account; 503 while email is off. */
export function requestPasswordReset(email: string): Promise<void> {
  return api.post("/auth/password-reset", { email });
}

/** 204; 404 for an unknown token, 410 for an expired or used one. */
export function confirmPasswordReset(token: string, password: string): Promise<void> {
  return api.post("/auth/password-reset/confirm", { token, password });
}

/** Sends a verification link to the caller's own address: 202, 503 while email is off. */
export function requestEmailVerification(): Promise<void> {
  return api.post("/auth/email-verification", {});
}

/** 204; 404 for an unknown token, 410 for an expired or used one. */
export function confirmEmailVerification(token: string): Promise<void> {
  return api.post("/auth/email-verification/confirm", { token });
}

/** A read without side effects: the token's address, or 404/410. */
export function lookupAccountToken(token: string, purpose: AccountTokenPurpose): Promise<AccountTokenLookupResponse> {
  return api.post("/auth/account-tokens/lookup", { token, purpose });
}
