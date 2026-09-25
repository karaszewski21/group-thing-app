import { useQuery } from "@tanstack/react-query";
import { getMyOrganization } from "../api/organizations";
import { useAuth } from "../auth/AuthContext";

/** The logged-in caller's own Organization slug, or `null` when they have
 * none yet (the endpoint 404s) or nobody is logged in. The token is part of
 * the key: another account's slug must never show, even briefly. */
export function useMyOrganizationSlug(): string | null {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: ["myOrganization", token],
    queryFn: getMyOrganization,
    enabled: token !== null,
  });
  return query.data?.slug ?? null;
}
