import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LocationResponse } from "../../api/locations";
import { LOCATION_ERROR_CLASS } from "../../components/shared/LocationAddForm";
import { ConfirmDeleteDialog } from "../../components/shared/ConfirmDeleteDialog";
import { useMyLocations } from "../../hooks/useMyLocations";
import { placeEditPath, viewPath } from "../../utils/appHelpers";

/* ------------------------------------------------------------------ */
/*  "Moje miejsca" (/places): the caller's saved places, deleted here; */
/*  adding and editing have their own pages (/places/new,              */
/*  /places/:id/edit).                                                 */
/* ------------------------------------------------------------------ */

const rowBtn =
  "flex-none rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors";

/** `onPlacesChanged` lets the panel refresh the group tiles and term cards
 * that show a place's name and address. */
export function PlacesView({ onPlacesChanged }: { onPlacesChanged: () => void }) {
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
      <h1 className="mb-5 font-serif text-[32px] leading-tight font-extrabold tracking-tight text-ink">
        Moje miejsca
      </h1>
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
                <span className="font-bold text-ink">{location.name}</span>
                <span className="text-ink-soft">{location.formatted_address}</span>
                {location.notes && <span className="text-ink-soft">{location.notes}</span>}
              </div>
              <Link
                ref={focusRef(`edit:${location.id}`)}
                to={placeEditPath(location.id)}
                aria-label={`Edytuj miejsce ${location.name}`}
                className={`${rowBtn} hover:bg-cream hover:text-ink`}
              >
                Edytuj
              </Link>
              <button
                type="button"
                onClick={() => setDeleting(location)}
                aria-label={`Usuń miejsce ${location.name}`}
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
      title={`Usunąć miejsce „${location.name}”?`}
      body="Zniknie z Twojej listy miejsc. Grupy i terminy, które już je mają, nadal je pokażą."
      confirmLabel="Usuń miejsce"
      fallbackError="Nie udało się usunąć miejsca."
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
