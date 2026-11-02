import { CARD } from "../../../components/shared/uiStyles";
import { AccountMergeForm } from "../../terms/modals/AccountMergeForm";

/** After a guest sign-up: turn the guest profile into an account in place,
 * which unlocks the event chat and withdrawing. */
export function EventGuestMergeCard({ guestProfileId }: { guestProfileId: string }) {
  return (
    <section className={`${CARD} mx-5 mt-6`}>
      <AccountMergeForm
        userProfileId={guestProfileId}
        title="Zapisano Cię jako gościa ✓"
        hint="Załóż konto, żeby pisać na czacie wydarzenia i móc się wypisać."
      />
    </section>
  );
}
