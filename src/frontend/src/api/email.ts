import { api } from "./client";

/** The categories a person can switch on `/settings`, in display order. */
export type EmailCategory = "RESERVATIONS" | "WANTS";

/** A preference row: `ALL` is the master switch over every category. */
export type EmailPreferenceCategory = "ALL" | EmailCategory;

export type Suppression = "BOUNCE" | "COMPLAINT";

export type UnsubscribeScope = "category" | "all";

/** The fixed Polish copy for a 503 from the mail endpoints (email is off). */
export const EMAIL_UNAVAILABLE_MESSAGE = "Wysyłka maili jest chwilowo niedostępna. Spróbuj później.";

export interface EmailCategoryPreference {
  category: EmailCategory;
  enabled: boolean;
}

export interface EmailPreferencesResponse {
  email: string | null;
  /** `null` while email is off or the profile has no address. */
  email_verified: boolean | null;
  suppression: Suppression | null;
  support_address: string | null;
  /** False while notification mail is not sent yet: the „wkrótce” note. */
  notifications_live: boolean;
  all_enabled: boolean;
  categories: EmailCategoryPreference[];
}

export interface UpdateEmailPreferenceRequest {
  category: EmailPreferenceCategory;
  enabled: boolean;
}

export interface UnsubscribeResponse {
  category: EmailCategory;
  scope: UnsubscribeScope;
}

export function getEmailPreferences(): Promise<EmailPreferencesResponse> {
  return api.get("/email/preferences");
}

export function updateEmailPreference(request: UpdateEmailPreferenceRequest): Promise<EmailPreferencesResponse> {
  return api.put("/email/preferences", request);
}

/** Turns off the token's category (or every notification mail); 404 for an unrecognised link. */
export function unsubscribe(token: string, scope: UnsubscribeScope): Promise<UnsubscribeResponse> {
  return api.post(`/email/unsubscribe/${encodeURIComponent(token)}`, { scope });
}
