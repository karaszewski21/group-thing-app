import { useState } from "react";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { LOCATION_ERROR_CLASS } from "../../components/shared/LocationAddForm";
import { useMyInventoryLocation } from "../../hooks/useMyInventoryLocation";

const LABEL = "Gdzie są moje rzeczy?";

/** The pickup place of the caller's PERSONAL inventory, picked from their
 * saved places. Required for "Odbiorę osobiście"; others only see its name. */
export function InventoryLocationCard() {
  const { data: location, loading, set } = useMyInventoryLocation();
  // The picked id until the save settles, so the select doesn't jump back.
  const [pendingId, setPendingId] = useState<string | null | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleChange(locationId: string | null) {
    setSaveError(null);
    setPendingId(locationId);
    try {
      await set(locationId);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Nie udało się zapisać miejsca — spróbuj ponownie");
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <section aria-labelledby="inventory-location-label" className="mb-4 rounded-[22px] border border-line bg-paper p-3.5">
      <p id="inventory-location-label" className="mb-1.5 text-xs font-bold text-ink-soft">
        <span aria-hidden="true">📍</span>{" "}
        <span>{LABEL}</span>
      </p>
      {loading ? (
        <p className="text-[12.5px] text-ink-soft">Ładowanie miejsca…</p>
      ) : (
        <LocationPicker
          value={pendingId !== undefined ? pendingId : (location?.id ?? null)}
          onChange={(id) => void handleChange(id)}
          label={LABEL}
          noneLabel="Nie wybrano miejsca"
          idPrefix="inventory-location"
          fallbackLocation={location}
          addMode="inline"
        />
      )}
      {saveError && (
        <p role="alert" className={`mt-1.5 ${LOCATION_ERROR_CLASS}`}>
          {saveError}
        </p>
      )}
      <p className="mt-1.5 text-[12.5px] text-ink-soft">
        Inni zalogowani zobaczą tylko nazwę miejsca (np. „Dom – Mokotów”), nigdy adres. Bez lokalizacji nie da się
        zarezerwować „osobiście”.
      </p>
    </section>
  );
}
