import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NeededItemQuickAddForm } from "../../components/shared/NeededItemQuickAddForm";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { CapacityField, Field, INPUT_CLASS, SubPageHeader } from "../../components/shared/appComponents";
import { useAppData } from "../../app/appDataStore";
import { parseCapacity, viewPath } from "../../utils/appHelpers";

const TITLE = "Dodaj termin zajęć";

/** `/add/term`: a new term in one of the user's groups. The form state and
 * the save (which then goes to "Spotkania") live in AppDataContext. */
export function AddTermView() {
  const {
    myGroups,
    addTermError,
    termGroupId,
    termDate,
    termDescription,
    termLocationId,
    termCapacity,
    neededDraft,
    draftNeededItem,
    busy,
    selectTermGroup,
    setTermDate,
    setTermDescription,
    setTermLocationId,
    setTermCapacity,
    setDraftNeededItem,
    handleAddTerm,
    addDraftNeededItem,
    removeDraftNeededItem,
  } = useAppData();

  // "Potrzebne rzeczy" is optional — collapsed behind a small button until
  // the organizer actually wants to add one (same pattern as EditTermDialog).
  const [addingNeeded, setAddingNeeded] = useState(false);
  const termGroup = myGroups.find((g) => g.id === termGroupId) ?? null;

  // Entered by URL (not from a "Dodaj termin" button): start on the first group.
  useEffect(() => {
    if (!termGroupId && myGroups.length > 0) selectTermGroup(myGroups[0].id);
  }, [termGroupId, myGroups, selectTermGroup]);

  return (
    <section aria-label={TITLE}>
      <SubPageHeader title={TITLE} backTo={viewPath("add")} backLabel="Wróć do dodawania" />
      {myGroups.length === 0 ? (
        <div className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">
          <p>Termin dodasz w swojej grupie — najpierw ją załóż.</p>
          <Link
            to={viewPath("groups/new")}
            className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-sm font-extrabold text-on-primary"
          >
            Załóż grupę
          </Link>
        </div>
      ) : (
        <div className="rounded-[22px] border border-line bg-paper p-5">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Grupa">
              <select
                aria-label="Grupa"
                value={termGroupId ?? ""}
                onChange={(e) => selectTermGroup(e.target.value || null)}
                className={INPUT_CLASS}
              >
                <option value="" disabled>Wybierz grupę…</option>
                {myGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Data i godzina">
              <input
                type="datetime-local"
                aria-label="Data i godzina"
                value={termDate}
                onChange={(e) => setTermDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Opis (opcjonalnie)">
              <input
                aria-label="Opis (opcjonalnie)"
                value={termDescription}
                onChange={(e) => setTermDescription(e.target.value)}
                placeholder="Park Sołacki · wstęp wolny"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Miejsce">
              <LocationPicker
                value={termLocationId}
                onChange={setTermLocationId}
                label="Miejsce"
                noneLabel="Brak miejsca"
                idPrefix="add-term-place"
                fallbackLocation={termGroup?.default_location ?? null}
              />
            </Field>
            <CapacityField label="Ile miejsc" value={termCapacity} onChange={setTermCapacity} />
            <Field label="Potrzebne rzeczy (opcjonalnie)">
              {neededDraft.map((item, index) => (
                <div key={index} className="mb-1.5 flex items-center gap-2 text-[13px]">
                  <span className="flex-1">
                    {item.name}
                    {item.description ? ` — ${item.description}` : ""}
                  </span>
                  <button type="button" onClick={() => removeDraftNeededItem(index)} className="text-xs font-bold text-danger">
                    Usuń
                  </button>
                </div>
              ))}
              {addingNeeded ? (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <NeededItemQuickAddForm value={draftNeededItem} onChange={setDraftNeededItem} />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={addDraftNeededItem}
                      disabled={!draftNeededItem.name.trim()}
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-50"
                    >
                      Dodaj rzecz
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingNeeded(false)}
                      className="rounded-full px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-cream"
                    >
                      Zwiń
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingNeeded(true)}
                  className="mt-1 self-start rounded-[9px] px-1.5 py-1 text-[12px] font-bold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
                >
                  + Dodaj potrzebną rzecz
                </button>
              )}
            </Field>
          </div>
          {addTermError && (
            <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">{addTermError}</p>
          )}
          <button
            type="button"
            onClick={() => void handleAddTerm()}
            disabled={busy || !termDate || !termGroupId || parseCapacity(termCapacity) === undefined}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dodaj termin
          </button>
        </div>
      )}
    </section>
  );
}
