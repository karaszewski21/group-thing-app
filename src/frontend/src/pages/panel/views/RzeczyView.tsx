import { type ItemCondition } from "../../../api/inventories";
import { type ProductCategory } from "../../../api/products";
import { CATEGORY_LABELS, CONDITION_LABELS, PRODUCT_CATEGORIES } from "../../../utils/productCategory";
import { createEmptyItemQuickAddValue } from "../../../utils/itemQuickAdd";
import { BoxIcon, PencilIcon, TrashIcon } from "../panelIcons";
import { capitalize, ITEM_MODE_STYLE, ITEM_MODES } from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

export function RzeczyView() {
  const {
    items,
    itemModes,
    editingItemMeta,
    editingItemCondition,
    itemMetaError,
    itemError,
    busy,
    productName,
    setItemDraft,
    setModal,
    setEditingItemMeta,
    setEditingItemCondition,
    saveItemMeta,
    saveItemCondition,
    startEditItemMeta,
    setItemMode,
    handleDeleteItem,
  } = usePanelData();

  return (
    <div>
      <div className="mb-3.5 flex items-start justify-between gap-2.5">
        <div>
          <h2 className="text-[19px] font-semibold text-ink">Moje rzeczy</h2>
          <small className="text-[12.5px] text-ink-soft">
            {items.length} {items.length === 1 ? "rzecz" : "rzeczy"}
          </small>
        </div>
        <button
          onClick={() => { setItemDraft(createEmptyItemQuickAddValue()); setModal("rzecz"); }}
          className="inline-flex flex-none items-center gap-1.5 rounded-full bg-ink px-[15px] py-2.5 text-[12.5px] font-extrabold text-[#EAF2E9] transition-transform hover:-translate-y-0.5"
        >
          + Dodaj rzecz
        </button>
      </div>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        {items.length === 0 && (
          <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
            Nie masz jeszcze żadnej rzeczy.
          </div>
        )}
        {items.map((it) => {
          const mode = itemModes[it.id] ?? null;
          const style = mode ? ITEM_MODE_STYLE[mode] : null;
          return (
            <div key={it.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
              <span
                className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl"
                style={{ background: style ? style.bg : "var(--color-line)" }}
              >
                <BoxIcon c={style ? style.c : "#5C7069"} />
              </span>
              <div className="min-w-0 flex-1">
                {editingItemMeta?.id === it.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Nazwa rzeczy"
                      value={editingItemMeta.name}
                      onChange={(e) =>
                        setEditingItemMeta((s) => (s ? { ...s, name: e.target.value } : s))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveItemMeta();
                        if (e.key === "Escape") setEditingItemMeta(null);
                      }}
                      className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-[13.5px] text-ink"
                    />
                    <select
                      aria-label="Typ rzeczy"
                      value={editingItemMeta.category}
                      onChange={(e) =>
                        setEditingItemMeta((s) =>
                          s ? { ...s, category: e.target.value as ProductCategory } : s,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveItemMeta();
                        if (e.key === "Escape") setEditingItemMeta(null);
                      }}
                      className="rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-[12.5px] text-ink"
                    >
                      {PRODUCT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => void saveItemMeta()}
                      disabled={busy}
                      className="flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60"
                    >
                      Zapisz
                    </button>
                    <button
                      onClick={() => setEditingItemMeta(null)}
                      className="flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft"
                    >
                      Anuluj
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-[15.5px] font-semibold text-ink">{productName(it.product_id)}</h3>
                    <button
                      onClick={() => startEditItemMeta(it)}
                      aria-label={`Edytuj rzecz ${productName(it.product_id)}`}
                      className="flex h-6 w-6 flex-none items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
                    >
                      <PencilIcon />
                    </button>
                  </div>
                )}
                {editingItemMeta?.id === it.id && itemMetaError && (
                  <p className="mt-1 text-[12.5px] font-semibold text-danger">{itemMetaError}</p>
                )}
                {editingItemCondition?.id === it.id ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Stan rzeczy"
                      value={editingItemCondition.condition}
                      onChange={(e) =>
                        setEditingItemCondition((s) =>
                          s ? { ...s, condition: e.target.value as ItemCondition } : s,
                        )
                      }
                      className="rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-[12.5px] text-ink"
                    >
                      {(Object.keys(CONDITION_LABELS) as ItemCondition[]).map((c) => (
                        <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => void saveItemCondition()}
                      disabled={busy}
                      className="flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60"
                    >
                      Zapisz
                    </button>
                    <button
                      onClick={() => setEditingItemCondition(null)}
                      className="flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft"
                    >
                      Anuluj
                    </button>
                  </div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <small className="text-[12.5px] text-ink-soft">
                      Stan: {CONDITION_LABELS[it.condition]}
                    </small>
                    <button
                      onClick={() => setEditingItemCondition({ id: it.id, condition: it.condition })}
                      aria-label="Edytuj stan rzeczy"
                      className="flex h-6 w-6 flex-none items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
                    >
                      <PencilIcon />
                    </button>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ITEM_MODES.map((m) => {
                    const on = mode === m;
                    const mStyle = ITEM_MODE_STYLE[m];
                    return (
                      <button
                        key={m}
                        onClick={() => setItemMode(it.id, m)}
                        aria-pressed={on}
                        className="rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:border-sage"
                        style={on ? { background: mStyle.bg, color: mStyle.c, borderColor: "transparent" } : undefined}
                      >
                        {capitalize(m)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={() => void handleDeleteItem(it.id)}
                aria-label={`Usuń rzecz ${productName(it.product_id)}`}
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-danger-soft hover:text-danger"
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}
        {itemError && (
          <p className="mt-2 text-[12.5px] font-semibold text-danger">{itemError}</p>
        )}
      </div>
    </div>
  );
}
