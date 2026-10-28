import { useState } from "react";
import {
  createNeededItem,
  deleteNeededItem,
  updateNeededItem,
  updateTerm,
  type NeededItemResponse,
  type TermResponse,
  type UpdateNeededItemRequest,
  type UpdateTermRequest,
} from "../../api/terms";
import { serverMessageOr } from "../../api/problem";
import { CapacityField, Field, INPUT_CLASS, ModalSheet } from "../shared/appComponents";
import { capacityText, parseCapacity } from "../../utils/appHelpers";
import { LocationPicker } from "../shared/LocationPicker";

/* ------------------------------------------------------------------ */
/*  "Edytuj termin" — single Panel dialog replacing the inline per-    */
/*  field pencils that used to live inside `organizerTermCard`. Local  */
/*  `useState` (mirrors CreateFamilyDialog): the modal can be opened/  */
/*  closed/reopened in one page session. `term`/`neededItems` come as  */
/*  props from the host, which passes fresh values on every           */
/*  `load({ silent: true })` — so after each mutation we call          */
/*  `onChanged()` and the dialog re-renders with the refreshed data.   */
/*  Needed-item sub-CRUD is non-optimistic here (await, then refresh); */
/*  a rejected delete keeps the row and shows an inline message. A     */
/*  needed item is a plain name plus an optional refinement.           */
/* ------------------------------------------------------------------ */

const inputClass = `${INPUT_CLASS} w-full`;
const rowInputClass =
  "w-full min-w-0 rounded-lg border-[1.5px] border-line bg-cream px-2.5 py-2 text-[12.5px] text-ink";
const rowSaveBtn =
  "flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60";
const rowCancelBtn =
  "flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft";
const rowIconBtn =
  "flex-none rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:bg-cream hover:text-ink";

interface NeededItemDraft {
  name: string;
  description: string;
}

const EMPTY_DRAFT: NeededItemDraft = { name: "", description: "" };

interface EditTermDialogProps {
  term: TermResponse;
  neededItems: NeededItemResponse[];
  /** `() => void load({ silent: true })` on the host — refreshes the props. */
  onChanged: () => void;
  onClose: () => void;
}

function NeededItemFields({
  value,
  onChange,
  namePrefix,
}: {
  value: NeededItemDraft;
  onChange: (v: NeededItemDraft) => void;
  namePrefix: string;
}) {
  return (
    <>
      <input
        aria-label={`Nazwa ${namePrefix}`}
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        placeholder="np. Termos"
        className={rowInputClass}
      />
      <input
        aria-label={`Doprecyzowanie ${namePrefix}`}
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
        placeholder="Doprecyzowanie (opcjonalnie)"
        className={rowInputClass}
      />
    </>
  );
}

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:MM`; the API sends
 * seconds (and sometimes only a date). */
const toLocalInput = (iso: string): string =>
  iso.length >= 16 ? iso.slice(0, 16) : `${iso.slice(0, 10)}T00:00`;

export function EditTermDialog({ term, neededItems, onChanged, onClose }: EditTermDialogProps) {
  const [occursOn, setOccursOn] = useState(toLocalInput(term.occurs_on));
  const [description, setDescription] = useState(term.description ?? "");
  const [locationId, setLocationId] = useState<string | null>(term.location?.id ?? null);
  const [capacityInput, setCapacityInput] = useState(capacityText(term.capacity));
  const capacity = parseCapacity(capacityInput);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [editing, setEditing] = useState<({ id: string } & NeededItemDraft) | null>(null);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<NeededItemDraft>(EMPTY_DRAFT);
  const [itemsError, setItemsError] = useState<string | null>(null);

  async function saveTermFields() {
    if (capacity === undefined) return;
    const patch: UpdateTermRequest = {};
    if (occursOn && occursOn !== toLocalInput(term.occurs_on)) patch.occurs_on = occursOn;
    if (description !== (term.description ?? "")) patch.description = description;
    if (locationId !== (term.location?.id ?? null)) patch.location_id = locationId;
    if (capacity !== (term.capacity ?? null)) patch.capacity = capacity;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await updateTerm(term.id, patch);
      setSaved(true);
      onChanged();
    } catch (err) {
      setFormError(serverMessageOr(err, "Nie udało się zapisać zmian terminu — spróbuj ponownie"));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: NeededItemResponse) {
    setEditing({
      id: item.id,
      name: item.name,
      description: item.description ?? "",
    });
    setItemsError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const orig = neededItems.find((ni) => ni.id === editing.id);
    setBusy(true);
    setItemsError(null);
    try {
      const patch: UpdateNeededItemRequest = { description: editing.description.trim() };
      const name = editing.name.trim();
      if (name && name !== orig?.name) patch.name = name;
      await updateNeededItem(editing.id, patch);
      setEditing(null);
      onChanged();
    } catch (err) {
      setItemsError(serverMessageOr(err, "Nie udało się zapisać zmiany — spróbuj ponownie"));
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: string) {
    setBusy(true);
    setItemsError(null);
    try {
      await deleteNeededItem(id);
      onChanged();
    } catch {
      setItemsError("Nie udało się usunąć — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    if (!newDraft.name.trim()) return;
    setBusy(true);
    setItemsError(null);
    try {
      await createNeededItem({
        term_id: term.id,
        name: newDraft.name.trim(),
        description: newDraft.description.trim() || undefined,
      });
      setAdding(false);
      setNewDraft(EMPTY_DRAFT);
      onChanged();
    } catch (err) {
      setItemsError(serverMessageOr(err, "Nie udało się dodać rzeczy — spróbuj ponownie"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalSheet title="Edytuj termin" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Data i godzina">
          <input
            aria-label="Data i godzina"
            type="datetime-local"
            value={occursOn}
            onChange={(e) => {
              setOccursOn(e.target.value);
              setSaved(false);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Opis">
          <input
            aria-label="Opis"
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTermFields();
            }}
            placeholder="17:00 · Park Sołacki · wstęp wolny"
            className={inputClass}
          />
        </Field>
        <Field label="Miejsce">
          <LocationPicker
            value={locationId}
            onChange={(id) => {
              setLocationId(id);
              setSaved(false);
            }}
            label="Miejsce"
            noneLabel="Brak miejsca"
            idPrefix={`edit-term-${term.id}-place`}
            fallbackLocation={term.location}
          />
        </Field>
        <CapacityField
          label="Ile miejsc"
          value={capacityInput}
          onChange={(raw) => {
            setCapacityInput(raw);
            setSaved(false);
          }}
          inputClassName={`${inputClass} w-28`}
        />
      </div>
      {formError && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
          {formError}
        </p>
      )}
      {saved && !formError && <p className="mt-2 text-[12.5px] font-bold text-mint">Zapisano</p>}
      <button
        type="button"
        onClick={() => void saveTermFields()}
        disabled={busy || capacity === undefined}
        className="mt-3 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
      >
        Zapisz
      </button>

      <h4 className="mb-1.5 mt-6 text-sm font-semibold text-ink">Potrzebne rzeczy</h4>
      {neededItems.length > 0 && (
        <ul className="flex flex-col">
          {neededItems.map((ni) => (
            <li
              key={ni.id}
              className="flex flex-wrap items-center gap-1.5 border-t border-line/60 py-2 text-[12.5px] first:border-t-0"
            >
              {editing?.id === ni.id ? (
                <div className="flex w-full flex-col gap-1.5">
                  <NeededItemFields
                    value={editing}
                    onChange={(v) => setEditing((s) => (s ? { ...s, ...v } : s))}
                    namePrefix="rzeczy"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void saveEdit()}
                      disabled={busy}
                      className={rowSaveBtn}
                    >
                      Zapisz
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={rowCancelBtn}>
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-ink-soft">
                    {ni.name}
                    {ni.description ? ` — ${ni.description}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(ni)}
                    aria-label="Edytuj potrzebną rzecz"
                    className={rowIconBtn}
                  >
                    Edytuj
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeItem(ni.id)}
                    aria-label="Usuń potrzebną rzecz"
                    className="flex-none rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-extrabold text-danger transition-colors hover:bg-danger-soft"
                  >
                    Usuń
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-2 flex w-full flex-col gap-1.5">
          <NeededItemFields
            value={newDraft}
            onChange={setNewDraft}
            namePrefix="nowej rzeczy"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => void addItem()}
              disabled={busy || !newDraft.name.trim()}
              className={rowSaveBtn}
            >
              Dodaj
            </button>
            <button type="button" onClick={() => setAdding(false)} className={rowCancelBtn}>
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setNewDraft(EMPTY_DRAFT);
            setItemsError(null);
          }}
          aria-label="Dodaj potrzebną rzecz"
          className="mt-2 rounded-[9px] px-1.5 py-1 text-[12px] font-bold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
        >
          + Dodaj potrzebną rzecz
        </button>
      )}

      {itemsError && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
          {itemsError}
        </p>
      )}

    </ModalSheet>
  );
}
