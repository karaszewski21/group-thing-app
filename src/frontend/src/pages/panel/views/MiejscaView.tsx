import { useEffect, useRef, useState } from "react";
import type { LocationResponse, UpdateLocationRequest } from "../../../api/locations";
import {
  LOCATION_CANCEL_BTN_CLASS,
  LOCATION_ERROR_CLASS,
  LOCATION_INPUT_CLASS,
  LOCATION_LABEL_CLASS,
  LOCATION_SAVE_BTN_CLASS,
  LocationAddForm,
} from "../../../components/shared/LocationAddForm";
import { ConfirmDeleteDialog } from "../../../components/shared/ConfirmDeleteDialog";
import { useMyLocations } from "../../../hooks/useMyLocations";

/* ------------------------------------------------------------------ */
/*  "Moje miejsca" (/panel/miejsca): the only place to list, add, edit */
/*  and delete the caller's saved places (mockups 2a-2e).              */
/* ------------------------------------------------------------------ */

const rowBtn =
  "flex-none rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors";

/** `onPlacesChanged` lets the panel refresh the group tiles and term cards
 * that show a place's name and address. */
export function MiejscaView({ onPlacesChanged }: { onPlacesChanged: () => void }) {
  const { data: locations, loading, error, create, update, remove } = useMyLocations();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LocationResponse | null>(null);
  const focusables = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const addFormId = "miejsca-add-location";

  // Focus moves (after add, edit, cancel, delete) wait for the re-render
  // that mounts their target.
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

  function handleCreated(location: LocationResponse) {
    pendingFocus.current = `edit:${location.id}`;
    setAdding(false);
    onPlacesChanged();
  }

  function closeEdit(id: string) {
    pendingFocus.current = `edit:${id}`;
    setEditingId(null);
  }

  async function saveEdit(id: string, request: UpdateLocationRequest) {
    await update(id, request);
    closeEdit(id);
    onPlacesChanged();
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
          {locations.map((location) =>
            editingId === location.id ? (
              <li key={location.id} className="border-t border-line/60 p-3.5 first:border-t-0">
                <EditLocationRow
                  location={location}
                  onSave={(request) => saveEdit(location.id, request)}
                  onCancel={() => closeEdit(location.id)}
                />
              </li>
            ) : (
              <li key={location.id} className="flex items-start gap-1 border-t border-line/60 p-3.5 first:border-t-0">
                <div className="flex min-w-0 flex-1 flex-col text-[13px]">
                  <span className="font-bold text-ink">{location.name}</span>
                  <span className="text-ink-soft">{location.formatted_address}</span>
                  {location.notes && <span className="text-ink-soft">{location.notes}</span>}
                </div>
                <button
                  ref={focusRef(`edit:${location.id}`)}
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setEditingId(location.id);
                  }}
                  aria-label={`Edytuj miejsce ${location.name}`}
                  className={`${rowBtn} hover:bg-cream hover:text-ink`}
                >
                  Edytuj
                </button>
                <button
                  ref={focusRef(`delete:${location.id}`)}
                  type="button"
                  onClick={() => setDeleting(location)}
                  aria-label={`Usuń miejsce ${location.name}`}
                  className={`${rowBtn} hover:bg-danger-soft hover:text-danger`}
                >
                  Usuń
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {!loading && (
        <div className="mt-3.5 flex flex-col gap-2.5">
          <button
            ref={focusRef("add")}
            type="button"
            aria-expanded={adding}
            aria-controls={adding ? addFormId : undefined}
            onClick={() => {
              setEditingId(null);
              setAdding((open) => !open);
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.5px] border-line px-5 py-2.5 text-[13px] font-extrabold text-ink-soft transition-colors hover:border-mint hover:text-mint"
          >
            {adding ? "– Dodaj miejsce (zwiń)" : "+ Dodaj miejsce"}
          </button>
          {adding && (
            <div id={addFormId} className="rounded-[22px] border border-line bg-paper p-4">
              <LocationAddForm
                idPrefix="miejsca"
                create={create}
                onSaved={handleCreated}
                onCancel={() => {
                  pendingFocus.current = "add";
                  setAdding(false);
                }}
              />
            </div>
          )}
        </div>
      )}
      {deleting && (
        <DeleteLocationDialog
          location={deleting}
          onConfirm={() => confirmDelete(deleting)}
          onClose={() => {
            pendingFocus.current = `delete:${deleting.id}`;
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

/* ---------------- edit row (2e) ---------------- */

function EditLocationRow({
  location,
  onSave,
  onCancel,
}: {
  location: LocationResponse;
  onSave: (request: UpdateLocationRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const manual = location.source === "MANUAL";
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.formatted_address);
  const [notes, setNotes] = useState(location.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function save() {
    if (!name.trim()) {
      setError("Podaj nazwę miejsca");
      return;
    }
    if (manual && !address.trim()) {
      setError("Podaj adres");
      return;
    }
    const request: UpdateLocationRequest = { name: name.trim(), notes: notes.trim() || null };
    if (manual) request.formatted_address = address.trim();
    setError(null);
    setBusy(true);
    try {
      await onSave(request);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Nie udało się zapisać miejsca.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={LOCATION_LABEL_CLASS}>Nazwa miejsca</span>
      <input
        ref={nameRef}
        aria-label="Nazwa miejsca"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={LOCATION_INPUT_CLASS}
      />
      <span className={LOCATION_LABEL_CLASS}>Adres</span>
      {manual ? (
        <input
          aria-label="Adres"
          required
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={LOCATION_INPUT_CLASS}
        />
      ) : (
        <p className="text-[13px] text-ink">
          {location.formatted_address} <span className="text-ink-soft">(z Google)</span>
        </p>
      )}
      <span className={LOCATION_LABEL_CLASS}>Notatka</span>
      <input aria-label="Notatka" value={notes} onChange={(e) => setNotes(e.target.value)} className={LOCATION_INPUT_CLASS} />
      {error && (
        <p role="alert" className={LOCATION_ERROR_CLASS}>
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <button type="button" onClick={() => void save()} disabled={busy} className={LOCATION_SAVE_BTN_CLASS}>
          Zapisz
        </button>
        <button type="button" onClick={onCancel} className={LOCATION_CANCEL_BTN_CLASS}>
          Anuluj
        </button>
      </div>
    </div>
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
