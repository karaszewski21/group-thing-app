import { useId, useState, type KeyboardEvent } from "react";
import type { ItemCondition } from "../../api/inventories";
import type { ItemDetailsResponse } from "../../api/items";
import { CategoryTreePicker } from "../../components/shared/CategoryTreePicker";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { PRIMARY_BTN } from "./itemPageShared";

const DESCRIPTION_MAX = 2000;

const INPUT = "rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-ink";
const SECONDARY_BTN =
  "flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft";
const ERROR_TEXT = "mt-1.5 text-[12.5px] font-semibold text-danger";
const HINT_TEXT = "mt-1.5 text-[11.5px] text-ink-soft";

/** Shared Zapisz/Anuluj state: an unchanged value closes without a request,
 * a failed save keeps the editor open with the hook's Polish message. */
function useFieldSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(unchanged: boolean, call: () => Promise<void>) {
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return { busy, error, setError, save };
}

function SaveCancel({ busy, onSave, onCancel }: { busy: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="mt-2 flex gap-2">
      <button type="button" onClick={onSave} disabled={busy} className={PRIMARY_BTN}>
        Zapisz
      </button>
      <button type="button" onClick={onCancel} className={SECONDARY_BTN}>
        Anuluj
      </button>
    </div>
  );
}

export function NameCategoryEditor({
  item,
  onSave,
  onClose,
}: {
  item: ItemDetailsResponse;
  onSave: (name: string, categoryId: string) => Promise<void>;
  onClose: () => void;
}) {
  const categoryLabelId = useId();
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.category_id);
  const { busy, error, setError, save } = useFieldSave(onClose);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Podaj nazwę rzeczy");
      return;
    }
    void save(trimmed === item.name && categoryId === item.category_id, () =>
      onSave(trimmed, categoryId),
    );
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="mt-2">
      <input
        aria-label="Nazwa rzeczy"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        className={`w-full min-w-0 text-[13.5px] ${INPUT}`}
      />
      {/* No Enter/Escape handler on the picker: its trigger opens the sheet. */}
      <div className="mt-2 flex flex-col gap-1">
        <span id={categoryLabelId} className="text-[11.5px] font-extrabold text-ink-soft">
          Kategoria
        </span>
        <CategoryTreePicker
          labelledBy={categoryLabelId}
          value={categoryId}
          onChange={(id) => {
            if (id) setCategoryId(id);
          }}
          placeholder={item.category_name ?? undefined}
        />
      </div>
      <SaveCancel busy={busy} onSave={submit} onCancel={onClose} />
      <p className={HINT_TEXT}>
        Ta zmiana podepnie rzecz pod inny produkt z katalogu — innych rzeczy nie zmienia. Zdjęcia i opis
        należą do produktu — po zmianie nazwy lub kategorii rzecz pokaże zdjęcia i opis nowego produktu.
      </p>
      {error && (
        <p role="alert" className={ERROR_TEXT}>
          {error}
        </p>
      )}
    </div>
  );
}

export function ConditionEditor({
  item,
  onSave,
  onClose,
}: {
  item: ItemDetailsResponse;
  onSave: (condition: ItemCondition) => Promise<void>;
  onClose: () => void;
}) {
  const [condition, setCondition] = useState<ItemCondition>(item.condition);
  const { busy, error, save } = useFieldSave(onClose);
  const submit = () => void save(condition === item.condition, () => onSave(condition));

  return (
    <div className="mt-2">
      <select
        aria-label="Stan rzeczy"
        value={condition}
        onChange={(e) => setCondition(e.target.value as ItemCondition)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onClose();
        }}
        className={`text-[12.5px] ${INPUT}`}
      >
        {(Object.keys(CONDITION_LABELS) as ItemCondition[]).map((c) => (
          <option key={c} value={c}>
            {CONDITION_LABELS[c]}
          </option>
        ))}
      </select>
      <SaveCancel busy={busy} onSave={submit} onCancel={onClose} />
      {error && (
        <p role="alert" className={ERROR_TEXT}>
          {error}
        </p>
      )}
    </div>
  );
}

export function DescriptionEditor({
  item,
  onSave,
  onClose,
}: {
  item: ItemDetailsResponse;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const initial = item.description ?? "";
  const [text, setText] = useState(initial);
  const { busy, error, save } = useFieldSave(onClose);
  const submit = () => void save(text.trim() === initial.trim(), () => onSave(text));

  return (
    <div className="mt-2">
      <textarea
        aria-label="Opis rzeczy"
        rows={4}
        maxLength={DESCRIPTION_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className={`block w-full resize-y text-[13.5px] ${INPUT}`}
      />
      <p className="mt-1 text-right text-[11.5px] text-ink-soft">
        {text.length} / {DESCRIPTION_MAX}
      </p>
      <p className={HINT_TEXT}>Opis jest wspólny dla wszystkich rzeczy tego produktu.</p>
      <SaveCancel busy={busy} onSave={submit} onCancel={onClose} />
      {error && (
        <p role="alert" className={ERROR_TEXT}>
          {error}
        </p>
      )}
    </div>
  );
}
