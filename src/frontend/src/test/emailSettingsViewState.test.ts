import { describe, expect, it } from "vitest";
import type { EmailPreferencesResponse } from "../api/email";
import {
  resolveEmailSettingsView,
  type EmailAddressState,
  type EmailSettingsData,
  type EmailSettingsView,
} from "../features/email/emailSettingsViewState";

function preferences(overrides: Partial<EmailPreferencesResponse> = {}): EmailPreferencesResponse {
  return {
    email: "ania@example.pl",
    email_verified: true,
    suppression: null,
    support_address: "pomoc@example.pl",
    notifications_live: true,
    all_enabled: true,
    categories: [
      { category: "RESERVATIONS", enabled: true },
      { category: "WANTS", enabled: true },
    ],
    ...overrides,
  };
}

function data(overrides: Partial<EmailSettingsData>): EmailSettingsData {
  return {
    preferences: null,
    loading: false,
    error: null,
    sent: false,
    ...overrides,
  };
}

function ready(
  shown: EmailPreferencesResponse,
  address: EmailAddressState,
  togglesDisabled: boolean,
): EmailSettingsView {
  return { kind: "ready", preferences: shown, address, togglesDisabled };
}

const VERIFIED = preferences();
const UNVERIFIED = preferences({ email_verified: false });
const BOUNCED_UNVERIFIED = preferences({
  email_verified: false,
  suppression: "BOUNCE",
});
const COMPLAINED_UNVERIFIED = preferences({
  email_verified: false,
  suppression: "COMPLAINT",
});
const COMPLAINED_UNKNOWN = preferences({
  email_verified: null,
  suppression: "COMPLAINT",
});
const BOUNCED_UNKNOWN = preferences({
  email_verified: null,
  suppression: "BOUNCE",
});
const NO_ADDRESS = preferences({ email: null, email_verified: null });

describe("resolveEmailSettingsView", () => {
  it.each<[string, EmailSettingsData, EmailSettingsView]>([
    ["first load", data({ loading: true }), { kind: "loading" }],
    ["failed first load", data({ error: "Błąd serwera." }), { kind: "error" }],
    [
      "loaded data wins over a failed refresh",
      data({ preferences: VERIFIED, error: "Błąd." }),
      ready(VERIFIED, "verified", false),
    ],
    ["verified address", data({ preferences: VERIFIED }), ready(VERIFIED, "verified", false)],
    ["unverified address", data({ preferences: UNVERIFIED }), ready(UNVERIFIED, "unverified", true)],
    ["link sent", data({ preferences: UNVERIFIED, sent: true }), ready(UNVERIFIED, "sent", true)],
    ["bounce + unverified", data({ preferences: BOUNCED_UNVERIFIED }), ready(BOUNCED_UNVERIFIED, "bounce", true)],
    [
      "complaint + unverified",
      data({ preferences: COMPLAINED_UNVERIFIED }),
      ready(COMPLAINED_UNVERIFIED, "complaint", true),
    ],
    [
      "sent after bounce",
      data({ preferences: BOUNCED_UNVERIFIED, sent: true }),
      ready(BOUNCED_UNVERIFIED, "sent", true),
    ],
    [
      "complaint beats sent",
      data({ preferences: COMPLAINED_UNVERIFIED, sent: true }),
      ready(COMPLAINED_UNVERIFIED, "complaint", true),
    ],
    ["null + bounce", data({ preferences: BOUNCED_UNKNOWN }), ready(BOUNCED_UNKNOWN, "unknown", false)],
    ["complaint + null", data({ preferences: COMPLAINED_UNKNOWN }), ready(COMPLAINED_UNKNOWN, "complaint", true)],
    ["no address", data({ preferences: NO_ADDRESS, sent: true }), ready(NO_ADDRESS, "unknown", false)],
  ])("%s", (_label, input, expected) => {
    expect(resolveEmailSettingsView(input)).toEqual(expected);
  });
});
