import { useState } from "react";
import { guestProfileIdKey, readValidGuestProfile } from "../../../api/groups";
import { AccountMergeForm } from "../../../components/krag/AccountMergeForm";

interface UseGuestMergeParams {
  groupId: number;
  termId: number | null;
  isLoggedIn: boolean;
  isAttendingOnServer: boolean;
}

/** A guest who already RSVP'd has no account to ask the server about — an
 * unexpired `guest_profile_id:<groupId>:<termId>` key is their proof of
 * sign-up, and lets them turn the guest profile into an account in place
 * (`AccountMergeForm`) instead of seeing the login gate. Row actions go
 * through `orMerge(key, action)`: for such a guest, clicking one swaps that
 * row (`key`) to the merge form instead of running `action`. */
export function useGuestMerge({ groupId, termId, isLoggedIn, isAttendingOnServer }: UseGuestMergeParams) {
  const guestProfileId =
    !isLoggedIn && termId !== null ? readValidGuestProfile(guestProfileIdKey(groupId, termId)) : null;
  const [mergingKey, setMergingKey] = useState<string | null>(null);

  return {
    isAttending: isLoggedIn ? isAttendingOnServer : guestProfileId !== null,
    /** The row is showing the merge form, so its own actions are hidden. */
    isMerging: (key: string) => mergingKey === key,
    orMerge: (key: string, action: () => void) => (guestProfileId !== null ? () => setMergingKey(key) : action),
    mergeForm: (key: string) =>
      mergingKey === key && guestProfileId !== null ? <AccountMergeForm userProfileId={guestProfileId} /> : null,
  };
}
