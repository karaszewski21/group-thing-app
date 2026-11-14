import { useAppNavigate, useAppSearchParams } from "../../routing/navigation";
import { useAppData } from "../panel/appDataStore";
import { LocationAddForm, PLACE_TITLE_CLASS } from "../../components/shared/LocationAddForm";
import { useMyLocations } from "../../hooks/useMyLocations";
import { type PickedLocationState } from "../../utils/appHelpers";
import { viewPath } from "../../routing/paths";
import { isSafeReturnPath } from "../../utils/url";

const TITLE = "Nowe miejsce";

/** `/places/new[?returnTo=…&picker=…]`: saves one place, then goes back with
 * a toast — to "Moje miejsca", or, when opened from a form's place picker
 * (`placeCreatePath`), to that form. The way back to the form replaces this
 * page in history (as the picker's `+` replaced the form), on save and on
 * cancel alike; the picker gets the new place's id, or `null` on cancel. */
export function PlaceCreateView() {
  const navigate = useAppNavigate();
  const [searchParams] = useAppSearchParams();
  const { showToast } = useAppData();
  const { create } = useMyLocations();
  const requested = searchParams.get("returnTo");
  const returnTo = isSafeReturnPath(requested) ? requested : null;
  const picker = searchParams.get("picker");

  function leave(locationId: string | null) {
    if (!returnTo) {
      navigate(viewPath("places"));
      return;
    }
    const state: PickedLocationState | undefined = picker ? { pickedLocation: { picker, locationId } } : undefined;
    navigate(returnTo, { replace: true, state });
  }

  return (
    <section aria-labelledby="miejsca-tytul" className="flex flex-col gap-3">
      <h1 id="miejsca-tytul" className={PLACE_TITLE_CLASS}>
        {TITLE}
      </h1>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        <LocationAddForm
          idPrefix="miejsca"
          submit={create}
          onSaved={(location) => {
            showToast(`Dodano miejsce „${location.locality.name}”`);
            leave(location.id);
          }}
          onCancel={() => leave(null)}
        />
      </div>
    </section>
  );
}
