import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { LocationResponse, UpdateLocationRequest } from "../../api/locations";
import { useAppData } from "../../app/appDataStore";
import {
  LOCATION_CANCEL_BTN_CLASS,
  LOCATION_ERROR_CLASS,
  LOCATION_INPUT_CLASS,
  LOCATION_LABEL_CLASS,
  LOCATION_SAVE_BTN_CLASS,
} from "../../components/shared/LocationAddForm";
import { SubPageHeader } from "../../components/shared/appComponents";
import { useMyLocations } from "../../hooks/useMyLocations";
import { viewPath } from "../../utils/appHelpers";

const TITLE = "Edytuj miejsce";

/** `/places/:locationId/edit`: name, notes and — for a manually entered
 * place — the address; a Google place keeps its address. Saves, then goes
 * back to "Moje miejsca". `onPlacesChanged` lets the panel refresh the group
 * tiles and term cards that show the place. */
export function PlaceEditView({ onPlacesChanged }: { onPlacesChanged: () => void }) {
  const { locationId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useAppData();
  const { data: locations, loading, error, update } = useMyLocations();
  const location = locations.find((l) => l.id === locationId) ?? null;

  async function save(request: UpdateLocationRequest) {
    await update(locationId, request);
    onPlacesChanged();
    showToast("Zapisano miejsce");
    navigate(viewPath("places"));
  }

  return (
    <section aria-label={TITLE}>
      <SubPageHeader title={TITLE} backTo={viewPath("places")} backLabel="Wróć do moich miejsc" />
      {loading ? (
        <p className="text-[13px] text-ink-soft">Ładowanie miejsc…</p>
      ) : error ? (
        <p role="alert" className={LOCATION_ERROR_CLASS}>
          {error}
        </p>
      ) : location ? (
        <div className="rounded-[22px] border border-line bg-paper p-5">
          <EditLocationForm location={location} onSave={save} onCancel={() => navigate(viewPath("places"))} />
        </div>
      ) : (
        <p className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">
          Nie znaleziono tego miejsca wśród Twoich miejsc.
        </p>
      )}
    </section>
  );
}

function EditLocationForm({
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
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void save();
      }}
      className="flex flex-col gap-1.5"
    >
      <span className={LOCATION_LABEL_CLASS}>Nazwa miejsca</span>
      <input
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
        <button type="submit" disabled={busy} className={LOCATION_SAVE_BTN_CLASS}>
          Zapisz
        </button>
        <button type="button" onClick={onCancel} className={LOCATION_CANCEL_BTN_CLASS}>
          Anuluj
        </button>
      </div>
    </form>
  );
}
