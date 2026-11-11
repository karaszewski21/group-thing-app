import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { createMyOrganization, type OrganizationResponse } from "../api/organizations";
import { serverMessageOr } from "../api/problem";
import { MY_ORGANIZATION_KEY } from "./useMyOrganization";
import { MY_PROFILE_KEY } from "./useMyProfile";
import { OWNER_ITEMS_KEY } from "./useOwnerItems";

const CREATE_FALLBACK = "Nie udało się założyć organizacji";

/** Founds the caller's Organization (its page starts with a copy of their
 * profile photos), then re-reads the own Organization and profile and the
 * public profile, which now redirects to the Organization's page. Errors are
 * rethrown as Polish messages. */
export function useCreateMyOrganization() {
  const queryClient = useQueryClient();

  const create = useCallback(
    async (name: string): Promise<OrganizationResponse> => {
      let organization: OrganizationResponse;
      try {
        organization = await createMyOrganization({ name });
      } catch (err) {
        throw new Error(serverMessageOr(err, CREATE_FALLBACK));
      }
      await Promise.all(
        [MY_ORGANIZATION_KEY, MY_PROFILE_KEY, OWNER_ITEMS_KEY].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      return organization;
    },
    [queryClient],
  );

  return { create };
}
