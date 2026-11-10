import { useQuery } from "@tanstack/react-query";
import { getGroupTerms, type TermResponse } from "../api/terms";

export const GROUP_TERMS_KEY = "groupTerms";

/** The circle's earliest term from today on, or `null` when it has none. */
export function useNearestGroupTerm(groupId: string, { enabled }: { enabled: boolean }): TermResponse | null {
  const query = useQuery({
    queryKey: [GROUP_TERMS_KEY, groupId, "nearest"],
    queryFn: async () => (await getGroupTerms(groupId, "upcoming", 1, 1)).items[0] ?? null,
    enabled,
  });
  return query.data ?? null;
}
