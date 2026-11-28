import { api } from "./client";

/** The admin-tunable app settings (`app_settings`). `updated_at` is the token
 * the PUT sends back; a stale one is a 409. */
export interface AppSettingsResponse {
  max_featured_items: number;
  updated_at: string;
}

export function getAppSettings(): Promise<AppSettingsResponse> {
  return api.get("/admin/settings");
}

/** A full replace; the body carries the `updated_at` the client read. */
export function updateAppSettings(request: AppSettingsResponse): Promise<AppSettingsResponse> {
  return api.put("/admin/settings", request);
}
