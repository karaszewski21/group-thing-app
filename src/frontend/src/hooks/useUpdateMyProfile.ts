import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError } from "../api/client";
import {
  updateMyProfile,
  updateMyProfileAppearance,
  type UpdateMyProfileAppearanceRequest,
  type UpdateMyProfileRequest,
} from "../api/people";
import { serverMessageOr } from "../api/problem";
import { MY_PROFILE_KEY } from "./useMyProfile";
import { OWNER_ITEMS_KEY } from "./useOwnerItems";

const INVALID_APPEARANCE_FALLBACK = "Nie udało się zapisać wyglądu. Wybierz układ i kolory jeszcze raz.";
const SAVE_FALLBACK = "Nie udało się zapisać. Spróbuj ponownie.";

function saveErrorMessage(err: unknown): string {
  return serverMessageOr(err, err instanceof ApiError && err.status === 400 ? INVALID_APPEARANCE_FALLBACK : SAVE_FALLBACK);
}

/** Writes to the caller's own profile: its look (`updateAppearance`) and
 * its name with the bio (`updateDetails`). The own and the public profile
 * (under the owner items key) are re-read afterwards, on failure too.
 * Errors are rethrown as Polish messages. */
export function useUpdateMyProfile() {
  const queryClient = useQueryClient();

  const run = useCallback(
    async (call: () => Promise<unknown>) => {
      const invalidate = () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: [MY_PROFILE_KEY] }),
          queryClient.invalidateQueries({ queryKey: [OWNER_ITEMS_KEY] }),
        ]);
      try {
        await call();
      } catch (err) {
        await invalidate();
        throw new Error(saveErrorMessage(err));
      }
      await invalidate();
    },
    [queryClient],
  );

  const updateAppearance = useCallback(
    (request: UpdateMyProfileAppearanceRequest) => run(() => updateMyProfileAppearance(request)),
    [run],
  );
  const updateDetails = useCallback((request: UpdateMyProfileRequest) => run(() => updateMyProfile(request)), [run]);

  return { updateAppearance, updateDetails };
}
