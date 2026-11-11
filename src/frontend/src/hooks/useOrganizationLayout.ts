import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getOrganizationLayout, type OrganizationLayoutResponse, type PageLayoutKey } from "../api/organizations";
import { extractProblemMessage, hasStatus } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

export const ORGANIZATION_LAYOUT_KEY = "organizationLayout";

interface UseOrganizationLayoutResult {
  data: OrganizationLayoutResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** What one layout of the Organization page behind `/:slug` shows: the
 * owner's stats plus that layout's lists. A 404 is reported as `notFound`;
 * while not `enabled` it stays loading.
 * The reserved badges are personalised, so the viewer's user id is part of
 * the key. */
export function useOrganizationLayout(
  slug: string,
  layout: PageLayoutKey,
  { enabled = true }: { enabled?: boolean } = {},
): UseOrganizationLayoutResult {
  const { username: viewerUserId } = useAuth();
  const query = useQuery({
    queryKey: [ORGANIZATION_LAYOUT_KEY, slug, layout, viewerUserId ?? null],
    queryFn: () => getOrganizationLayout(slug, layout),
    enabled,
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const notFound = hasStatus(query.error, 404);
  return {
    data: query.data ?? null,
    loading: query.isPending,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
