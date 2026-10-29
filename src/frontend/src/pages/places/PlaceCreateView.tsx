import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppData } from "../../app/appDataStore";
import { LocationAddForm } from "../../components/shared/LocationAddForm";
import { SubPageHeader } from "../../components/shared/appComponents";
import { useMyLocations } from "../../hooks/useMyLocations";
import { viewPath, type PickedLocationState } from "../../utils/appHelpers";
import { isSafeReturnPath } from "../../utils/url";

const TITLE = "Nowe miejsce";

/** `/places/new[?returnTo=…&picker=…]`: saves one place (Google search or
 * manual entry), then goes back with a toast — to "Moje miejsca", or, when
 * opened from a form's place picker (`placeCreatePath`), to that form with
 * the new place handed to the picker. */
export function PlaceCreateView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useAppData();
  const { create } = useMyLocations();
  const requested = searchParams.get("returnTo");
  const returnTo = isSafeReturnPath(requested) ? requested : null;
  const picker = searchParams.get("picker");
  const backTo = returnTo ?? viewPath("places");

  return (
    <section aria-label={TITLE}>
      <SubPageHeader
        title={TITLE}
        backTo={backTo}
        backLabel={returnTo ? "Wróć do formularza" : "Wróć do moich miejsc"}
      />
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
