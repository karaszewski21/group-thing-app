import { useState } from "react";
import {
  createNeededItem,
  deleteNeededItem,
  updateNeededItem,
  updateTerm,
  type NeededItemResponse,
  type TermResponse,
  type UpdateNeededItemRequest,
} from "../../api/terms";
import { resolveProduct, type ProductCategory } from "../../api/products";
import { CATEGORY_LABELS, PRODUCT_CATEGORIES } from "../../utils/productCategory";
import { Field, ModalSheet } from "../../pages/panel/panelComponents";

/* ------------------------------------------------------------------ */
/*  "Edytuj termin" — single Panel dialog replacing the inline per-    */
/*  field pencils that used to live inside `organizerTermCard`. Local  */
/*  `useState` (mirrors CreateFamilyDialog): the modal can be opened/  */
/*  closed/reopened in one page session. `term`/`neededItems` come as  */
/*  props from the host, which passes fresh values on every           */
/*  `load({ silent: true })` — so after each mutation we call          */
/*  `onChanged()` and the dialog re-renders with the refreshed data.   */
/*  Needed-item sub-CRUD is non-optimistic here (await, then refresh); */
/*  a rejected delete keeps the row and shows an inline message. Each  */
/*  needed item names a real `Product` (resolved by name + category).  */
/* ------------------------------------------------------------------ */

const inputClass = "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";
const rowInputClass =
  "w-full min-w-0 rounded-lg border-[1.5px] border-line bg-cream px-2.5 py-2 text-[12.5px] text-ink";
const selectClass =
  "w-full rounded-lg border-[1.5px] border-line bg-cream px-2.5 py-2 text-[12.5px] text-ink";
const rowSaveBtn =
  "flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60";
const rowCancelBtn =
  "flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft";
const rowIconBtn =
  "flex-none rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:bg-cream hover:text-ink";

interface NeededItemDraft {
  name: string;
  category: ProductCategory;
  description: string;
}

const emptyDraft: NeededItemDraft = { name: "", category: "OTHER", description: "" };

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
        placeholder="np. Tamburyn"
        className={rowInputClass}
      />
      <select
        aria-label={`Typ ${namePrefix}`}
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value as ProductCategory })}
        className={selectClass}
      >
        {PRODUCT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
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

export function EditTermDialog({ term, neededItems, onChanged, onClose }: EditTermDialogProps) {
  const [occursOn, setOccursOn] = useState(term.occurs_on);
  const [description, setDescription] = useState(term.description ?? "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [editing, setEditing] = useState<({ id: number } & NeededItemDraft) | null>(null);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<NeededItemDraft>(emptyDraft);
  const [itemsError, setItemsError] = useState<string | null>(null);

  async function saveTermFields() {
    const patch: { occurs_on?: string; description?: string } = {};
    if (occursOn && occursOn !== term.occurs_on) patch.occurs_on = occursOn;
    if (description !== (term.description ?? "")) patch.description = description;
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
    } catch {
      setFormError("Nie udało się zapisać zmian terminu — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: NeededItemResponse) {
    setEditing({
      id: item.id,
      name: item.product_name,
      category: item.product_category,
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
      if (
        editing.name.trim() &&
        (editing.name.trim() !== orig?.product_name || editing.category !== orig?.product_category)
      ) {
        const product = await resolveProduct({ name: editing.name.trim(), category: editing.category });
        patch.product_id = product.id;
      }
      await updateNeededItem(editing.id, patch);
      setEditing(null);
      onChanged();
    } catch {
      setEditing(null);
      setItemsError("Nie udało się zapisać zmiany — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: number) {
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
      const product = await resolveProduct({
        name: newDraft.name.trim(),
        category: newDraft.category,
      });
      await createNeededItem({
        term_id: term.id,
        product_id: product.id,
        description: newDraft.description.trim() || undefined,
      });
      setAdding(false);
      setNewDraft(emptyDraft);
      onChanged();
    } catch {
      setItemsError("Nie udało się dodać rzeczy — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalSheet title="Edytuj termin" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Data">
          <input
            aria-label="Data"
            type="date"
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
      </div>
      {formError && <p className="mt-2 text-[12.5px] font-semibold text-danger">{formError}</p>}
      {saved && !formError && <p className="mt-2 text-[12.5px] font-bold text-mint">Zapisano</p>}
      <button
        type="button"
        onClick={() => void saveTermFields()}
        disabled={busy}
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
                    {ni.product_name}
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
                    className="flex-none rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:bg-danger-soft hover:text-danger"
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
          <NeededItemFields value={newDraft} onChange={setNewDraft} namePrefix="nowej rzeczy" />
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
            setNewDraft(emptyDraft);
            setItemsError(null);
          }}
          aria-label="Dodaj potrzebną rzecz"
          className="mt-2 rounded-[9px] px-1.5 py-1 text-[12px] font-bold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
        >
          + Dodaj potrzebną rzecz
        </button>
      )}

      {itemsError && <p className="mt-2 text-[12.5px] font-semibold text-danger">{itemsError}</p>}
    </ModalSheet>
  );
}
