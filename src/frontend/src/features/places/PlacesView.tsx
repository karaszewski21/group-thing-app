import { useEffect, useRef, useState } from "react";
import { Link } from "../../routing/navigation";
import type { LocationResponse } from "../../api/locations";
import { LOCATION_ERROR_CLASS } from "../../components/shared/LocationAddForm";
import { ConfirmDeleteDialog } from "../../components/shared/ConfirmDeleteDialog";
import { useMyLocations } from "../../hooks/useMyLocations";
import { placeEditPath, viewPath } from "../../routing/paths";
import { localityDetail } from "../../utils/locationLabel";
import { usePanelReload } from "../panel/appDataStore";

/* ------------------------------------------------------------------ */
/*  "Moje miejsca" (/places): the caller's saved places, deleted here; */
/*  adding and editing have their own pages (/places/new,              */
/*  /places/:id/edit).                                                 */
/* ------------------------------------------------------------------ */

/** The row's second line: the address with the voivodeship, or the
 * locality's detail line for a place without an address. */
function placeSecondLine({ locality, formatted_address }: LocationResponse): string {
  return formatted_address ? `${formatted_address} · ${locality.voivodeship}` : localityDetail(locality);
}

const rowBtn =
  "flex-none rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors";

/** `onPlacesChanged` (the panel reload) lets the panel refresh the group tiles and term cards
 * that show a place's locality and address. */
export function PlacesView() {
  const onPlacesChanged = usePanelReload();
  const { data: locations, loading, error, remove } = useMyLocations();
  const [deleting, setDeleting] = useState<LocationResponse | null>(null);
  const focusables = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);

  // After a confirmed delete, focus waits for the re-render without the row;
  // a cancelled delete is left to `ConfirmDeleteDialog`, which returns focus
  // to its opener.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    const target = focusables.current.get(key);
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  });

  function focusRef(key: string) {
    return (el: HTMLElement | null) => {
      if (el) focusables.current.set(key, el);
      else focusables.current.delete(key);
    };
  }

  async function confirmDelete(location: LocationResponse) {
    await remove(location.id);
    const index = locations.findIndex((l) => l.id === location.id);
    const next = locations[index + 1] ?? locations[index - 1];
    pendingFocus.current = next ? `edit:${next.id}` : "add";
    setDeleting(null);
    onPlacesChanged();
  }

  return (
    <>
      {error && (
        <p role="alert" className={`${LOCATION_ERROR_CLASS} mb-3`}>
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-[13px] text-ink-soft">Ładowanie miejsc…</p>
      ) : locations.length === 0 ? (
        !error && <p className="text-[13px] text-ink-soft">Nie masz jeszcze zapisanych miejsc.</p>
      ) : (
        <ul aria-label="Moje miejsca" className="flex flex-col rounded-[22px] border border-line bg-paper">
          {locations.map((location) => (
            <li key={location.id} className="flex items-start gap-1 border-t border-line/60 p-3.5 first:border-t-0">
              <div className="flex min-w-0 flex-1 flex-col text-[13px]">
                <span className="font-bold text-ink">{location.locality.name}</span>
                <span className="text-ink-soft">{placeSecondLine(location)}</span>
              </div>
              <Link
                ref={focusRef(`edit:${location.id}`)}
                to={placeEditPath(location.id)}
                aria-label={`Edytuj miejsce ${location.label}`}
                className={`${rowBtn} hover:bg-cream hover:text-ink`}
              >
                Edytuj
              </Link>
              <button
                type="button"
                onClick={() => setDeleting(location)}
                aria-label={`Usuń miejsce ${location.label}`}
                className={`${rowBtn} hover:bg-danger-soft hover:text-danger`}
              >
                Usuń
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && (
        <Link
          ref={focusRef("add")}
          to={viewPath("places/new")}
          className="mt-3.5 flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.5px] border-line px-5 py-2.5 text-[13px] font-extrabold text-ink-soft transition-colors hover:border-mint hover:text-mint"
        >
          + Dodaj miejsce
        </Link>
      )}
      {!loading && (
        <p className="mt-3 text-[12.5px] text-ink-soft">
          Miejsca bez adresu wystarczą dla przedmiotów. Dla terminów i wydarzeń dodaj adres.
        </p>
      )}
      {deleting && (
        <DeleteLocationDialog
          location={deleting}
          onConfirm={() => confirmDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/* ---------------- delete confirmation ---------------- */

function DeleteLocationDialog({
  location,
  onConfirm,
  onClose,
}: {
  location: LocationResponse;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <ConfirmDeleteDialog
      title={`Usunąć miejsce „${location.label}”?`}
      body="Zniknie z Twojej listy miejsc. Grupy i terminy, które już je mają, nadal je pokażą."
      confirmLabel="Usuń miejsce"
      fallbackError="Nie udało się usunąć miejsca."
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
