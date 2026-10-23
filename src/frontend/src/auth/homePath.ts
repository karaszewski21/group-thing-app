/** Where a freshly logged-in user lands without a `?returnTo=`: back-office
 * roles (ADMIN / PLUGIN_MANAGEMENT — the permissions gating the
 * Categories/Plugins Sidebar links) to `/admin/products`, everyone else to the
 * panel's Start. */
export function homePath(permissions: string[]): string {
  const isBackOffice = permissions.includes("ADMIN") || permissions.includes("PLUGIN_MANAGEMENT");
  return isBackOffice ? "/admin/products" : "/";
}
