import type { EmailPreferencesResponse } from "../../api/email";

/** What `/settings` knows: the preferences query and whether a verification
 * link was sent from this view. */
export interface EmailSettingsData {
  preferences: EmailPreferencesResponse | null;
  loading: boolean;
  error: string | null;
  sent: boolean;
}

/** The address card's state, in precedence order: a complaint wins over
 * everything, an unknown verification (email off or no address) over a sent
 * link, a sent link over a bounce, a bounce over a plain unverified address. */
export type EmailAddressState = "complaint" | "unknown" | "sent" | "bounce" | "unverified" | "verified";

export type EmailSettingsView =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      preferences: EmailPreferencesResponse;
      address: EmailAddressState;
      /** Mail cannot reach the address yet (or anymore): no switch can change. */
      togglesDisabled: boolean;
    };

const DISABLING_STATES: ReadonlySet<EmailAddressState> = new Set(["complaint", "sent", "bounce", "unverified"]);

function addressState(preferences: EmailPreferencesResponse, sent: boolean): EmailAddressState {
  if (preferences.suppression === "COMPLAINT") return "complaint";
  if (preferences.email_verified === null) return "unknown";
  if (sent) return "sent";
  if (preferences.suppression === "BOUNCE") return "bounce";
  if (!preferences.email_verified) return "unverified";
  return "verified";
}

/** Loaded preferences win over a failed or pending refresh. */
export function resolveEmailSettingsView({ preferences, loading, error, sent }: EmailSettingsData): EmailSettingsView {
  if (preferences === null) return !loading && error !== null ? { kind: "error" } : { kind: "loading" };
  const address = addressState(preferences, sent);
  return {
    kind: "ready",
    preferences,
    address,
    togglesDisabled: DISABLING_STATES.has(address),
  };
}
