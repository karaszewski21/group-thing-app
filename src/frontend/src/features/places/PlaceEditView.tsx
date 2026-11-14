import { useAppNavigate, useAppParams } from "../../routing/navigation";
import { useAppData, usePanelReload } from "../panel/appDataStore";
import { LOCATION_ERROR_CLASS, LocationAddForm, PLACE_TITLE_CLASS } from "../../components/shared/LocationAddForm";
import { useMyLocations } from "../../hooks/useMyLocations";
import { viewPath } from "../../routing/paths";

const TITLE = "Edytuj miejsce";

/** `/places/:locationId/edit`: the place form prefilled with the saved
 * locality and address; saving replaces both (PUT), then goes back to
 * "Moje miejsca". `onPlacesChanged` (the panel reload) refreshes the group
 * tiles and term cards that show the place. */
export function PlaceEditView() {
  const onPlacesChanged = usePanelReload();
  const { locationId = "" } = useAppParams();
  const navigate = useAppNavigate();
  const { showToast } = useAppData();
  const { data: locations, loading, error, update } = useMyLocations();
  const location = locations.find((l) => l.id === locationId) ?? null;

  return (
    <section aria-labelledby="miejsce-edycja-tytul" className="flex flex-col gap-3">
      <h1 id="miejsce-edycja-tytul" className={PLACE_TITLE_CLASS}>
        {TITLE}
      </h1>
      {loading ? (
        <p className="text-[13px] text-ink-soft">Ładowanie miejsc…</p>
      ) : error ? (
        <p role="alert" className={LOCATION_ERROR_CLASS}>
          {error}
        </p>
      ) : location ? (
        <div className="rounded-[22px] border border-line bg-paper p-5">
          <LocationAddForm
            key={location.id}
            idPrefix="miejsce-edycja"
            initial={location}
            submit={(request) => update(location.id, request)}
            onSaved={() => {
              onPlacesChanged();
              showToast("Zapisano miejsce");
              navigate(viewPath("places"));
            }}
            onCancel={() => navigate(viewPath("places"))}
          />
        </div>
      ) : (
        <p className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">
          Nie znaleziono tego miejsca wśród Twoich miejsc.
        </p>
      )}
    </section>
  );
}
