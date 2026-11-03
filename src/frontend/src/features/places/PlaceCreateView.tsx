import { useAppNavigate, useAppSearchParams } from "../../routing/navigation";
import { useAppData } from "../panel/appDataStore";
import { LocationAddForm } from "../../components/shared/LocationAddForm";
import { useMyLocations } from "../../hooks/useMyLocations";
import { type PickedLocationState } from "../../utils/appHelpers";
import { viewPath } from "../../routing/paths";
import { isSafeReturnPath } from "../../utils/url";

const TITLE = "Nowe miejsce";

/** `/places/new[?returnTo=…&picker=…]`: saves one place (Google search or
 * manual entry), then goes back with a toast — to "Moje miejsca", or, when
 * opened from a form's place picker (`placeCreatePath`), to that form with
 * the new place handed to the picker. */
export function PlaceCreateView() {
  const navigate = useAppNavigate();
  const [searchParams] = useAppSearchParams();
  const { showToast } = useAppData();
  const { create } = useMyLocations();
  const requested = searchParams.get("returnTo");
  const returnTo = isSafeReturnPath(requested) ? requested : null;
  const picker = searchParams.get("picker");
  const backTo = returnTo ?? viewPath("places");

  return (
    <section aria-label={TITLE}>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        <LocationAddForm
          idPrefix="miejsca"
          create={create}
          onSaved={(location) => {
            showToast(`Dodano miejsce „${location.name}”`);
            const state: PickedLocationState | null =
              returnTo && picker ? { pickedLocation: { picker, locationId: location.id } } : null;
            navigate(backTo, { state });
          }}
          onCancel={() => navigate(backTo)}
        />
      </div>
    </section>
  );
}
