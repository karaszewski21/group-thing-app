import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  deleteOrganizationMedia,
  reorderOrganizationGallery,
  uploadOrganizationMedia,
  type MediaKind,
} from "../api/organizations";
import { serverMessageOr } from "../api/problem";
import { MY_ORGANIZATION_KEY } from "./useMyOrganization";
import { PUBLIC_ORGANIZATION_KEY } from "./usePublicOrganization";

const UPLOAD_FALLBACK = "Nie udało się wysłać zdjęcia. Spróbuj ponownie.";
const DELETE_FALLBACK = "Nie udało się usunąć zdjęcia. Spróbuj ponownie.";
const REORDER_FALLBACK = "Nie udało się zmienić kolejności. Spróbuj ponownie.";

/** Logo, cover and gallery edits of one Organization. Both the public and
 * the owner's organization are re-read afterwards, on failure too (a 409
 * means the cached media list is stale). Errors are rethrown as Polish
 * messages: the server's own when it gives one, else a per-action fallback. */
export function useOrganizationMedia(organizationId: string) {
  const queryClient = useQueryClient();

  const mutate = useCallback(
    async (call: () => Promise<unknown>, fallback: string) => {
      const invalidate = () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: [PUBLIC_ORGANIZATION_KEY] }),
          queryClient.invalidateQueries({ queryKey: [MY_ORGANIZATION_KEY] }),
        ]);
      try {
        await call();
      } catch (err) {
        await invalidate();
        throw new Error(serverMessageOr(err, fallback));
      }
      await invalidate();
    },
    [queryClient],
  );

  const upload = useCallback(
    (kind: MediaKind, file: File) => mutate(() => uploadOrganizationMedia(organizationId, kind, file), UPLOAD_FALLBACK),
    [mutate, organizationId],
  );

  const remove = useCallback(
    (mediaId: string) => mutate(() => deleteOrganizationMedia(organizationId, mediaId), DELETE_FALLBACK),
    [mutate, organizationId],
  );

  const reorder = useCallback(
    (mediaIds: string[]) => mutate(() => reorderOrganizationGallery(organizationId, mediaIds), REORDER_FALLBACK),
    [mutate, organizationId],
  );

  return { upload, remove, reorder };
}
