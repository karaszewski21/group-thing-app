import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError } from "../api/client";
import { updateOrganization, type UpdateOrganizationRequest } from "../api/organizations";
import { serverMessageOr } from "../api/problem";
import { MY_ORGANIZATION_KEY } from "./useMyOrganization";
import { PUBLIC_ORGANIZATION_KEY } from "./usePublicOrganization";

const CONFLICT_MESSAGE =
  "Ktoś zmienił tę stronę w międzyczasie. Pobraliśmy aktualną wersję — sprawdź swoje zmiany i zapisz ponownie.";
const INVALID_APPEARANCE_FALLBACK = "Nie udało się zapisać wyglądu. Wybierz układ i kolory jeszcze raz.";
const SAVE_FALLBACK = "Nie udało się zapisać. Spróbuj ponownie.";

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return CONFLICT_MESSAGE;
  const fallback = err instanceof ApiError && err.status === 400 ? INVALID_APPEARANCE_FALLBACK : SAVE_FALLBACK;
  return serverMessageOr(err, fallback);
}

/** Partially updates an Organization. Both the public and the owner's
 * organization are re-read afterwards, on failure too, since the server
 * state may differ from the cached one (409, or a write that landed before
 * the request failed). Errors are rethrown as Polish messages. */
export function useUpdateOrganization() {
  const queryClient = useQueryClient();

  const update = useCallback(
    async (id: string, request: UpdateOrganizationRequest) => {
      const invalidate = () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: [PUBLIC_ORGANIZATION_KEY] }),
          queryClient.invalidateQueries({ queryKey: [MY_ORGANIZATION_KEY] }),
        ]);
      try {
        await updateOrganization(id, request);
      } catch (err) {
        await invalidate();
        throw new Error(saveErrorMessage(err));
      }
      await invalidate();
    },
    [queryClient],
  );

  return { update };
}
