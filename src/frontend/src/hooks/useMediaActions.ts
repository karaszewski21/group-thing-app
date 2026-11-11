import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { deleteMedia, reorderGallery, uploadMedia, type MediaKind, type MediaOwner } from "../api/media";
import { serverMessageOr } from "../api/problem";
import { MY_ORGANIZATION_KEY } from "./useMyOrganization";
import { MY_PROFILE_KEY } from "./useMyProfile";
import { OWNER_ITEMS_KEY } from "./useOwnerItems";
import { PUBLIC_ORGANIZATION_KEY } from "./usePublicOrganization";

const UPLOAD_FALLBACK = "Nie udało się wysłać zdjęcia. Spróbuj ponownie.";
const DELETE_FALLBACK = "Nie udało się usunąć zdjęcia. Spróbuj ponownie.";
const REORDER_FALLBACK = "Nie udało się zmienić kolejności. Spróbuj ponownie.";

/** The keys an owner's media shows under: their own read and their public page. */
function ownerKeys(owner: MediaOwner): string[] {
  return owner.kind === "organization"
    ? [PUBLIC_ORGANIZATION_KEY, MY_ORGANIZATION_KEY]
    : [MY_PROFILE_KEY, OWNER_ITEMS_KEY];
}

/** Logo, avatar, cover and gallery edits of one owner (an Organization or
 * the caller's profile). The owner's reads are re-read afterwards, on
 * failure too (a 409 means the cached media list is stale). Errors are
 * rethrown as Polish messages: the server's own when it gives one, else a
 * per-action fallback. */
export function useMediaActions(owner: MediaOwner) {
  const queryClient = useQueryClient();
  const organizationId = owner.kind === "organization" ? owner.organizationId : null;

  const mutate = useCallback(
    async (call: (target: MediaOwner) => Promise<unknown>, fallback: string) => {
      const target: MediaOwner = organizationId === null ? { kind: "me" } : { kind: "organization", organizationId };
      const invalidate = () =>
        Promise.all(ownerKeys(target).map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      try {
        await call(target);
      } catch (err) {
        await invalidate();
        throw new Error(serverMessageOr(err, fallback));
      }
      await invalidate();
    },
    [queryClient, organizationId],
  );

  const upload = useCallback(
    (kind: MediaKind, file: File) => mutate((target) => uploadMedia(target, kind, file), UPLOAD_FALLBACK),
    [mutate],
  );
  const remove = useCallback(
    (mediaId: string) => mutate((target) => deleteMedia(target, mediaId), DELETE_FALLBACK),
    [mutate],
  );
  const reorder = useCallback(
    (mediaIds: string[]) => mutate((target) => reorderGallery(target, mediaIds), REORDER_FALLBACK),
    [mutate],
  );

  return { upload, remove, reorder };
}

export type MediaActions = ReturnType<typeof useMediaActions>;
