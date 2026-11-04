import { useState } from "react";
import type { ExchangeMode } from "../../api/groups";
import type { ItemContextOptionResponse } from "../../api/itemActions";
import { ModalSheet } from "../../components/shared/ModalSheet";
import { BTN_LG, BTN_PRIMARY } from "../../components/shared/uiStyles";
import dayjs from "../../utils/dayjs";

/** "📍 <place> · HH:mm", or just the time when the context has no place. */
export function ContextPlaceLine({ context, className }: { context: ItemContextOptionResponse; className: string }) {
  const time = dayjs(context.starts_at).format("HH:mm");
  return <span className={className}>{context.location_name ? `📍 ${context.location_name} · ${time}` : time}</span>;
}

function contextTitle(context: ItemContextOptionResponse): string {
  const day = dayjs(context.starts_at).format("ddd D MMM");
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${context.name}`;
}

interface ChooseContextSheetProps {
  ownerName: string;
  mode: ExchangeMode;
  /** The viewer's eligible upcoming contexts, at least one. */
  contexts: ItemContextOptionResponse[];
  /** Reserves (GIFT) or continues to the swap picker (SWAP) in `context`. */
  onConfirm: (context: ItemContextOptionResponse) => void;
  onClose: () => void;
}

/** "Wybieram termin": one of the terms and events the viewer shares with
 * the owner, as a radio list. Focus returns to the opener on close
 * (`ModalSheet`). */
export function ChooseContextSheet({ ownerName, mode, contexts, onConfirm, onClose }: ChooseContextSheetProps) {
  const [selectedId, setSelectedId] = useState(contexts[0]?.id ?? null);
  const selected = contexts.find((context) => context.id === selectedId) ?? null;

  return (
    <ModalSheet title="Wybierz termin odbioru" onClose={onClose}>
      <p className="text-[13px] text-ink-soft">
        {`Pokazujemy terminy i wydarzenia, w których bierzesz udział razem z ${ownerName}.`}
      </p>
      <fieldset className="mt-3">
        <legend className="sr-only">Termin odbioru</legend>
        {contexts.map((context) => (
          <label
            key={`${context.kind}-${context.id}`}
            className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-2xl border-[1.5px] border-line bg-paper px-3 py-2.5 has-checked:border-primary"
          >
            <input
              type="radio"
              name="pickup-context"
              value={context.id}
              checked={context.id === selectedId}
              onChange={() => setSelectedId(context.id)}
              className="mt-1 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold text-ink">{contextTitle(context)}</span>
              <ContextPlaceLine context={context} className="block text-xs text-ink-soft" />
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "SWAP" && (
        <p className="mt-3 rounded-xl bg-accent-soft p-2.5 text-xs text-ink">
          {`${ownerName} chce się zamienić — w następnym kroku wybierzesz rzecz, którą zaproponujesz.`}
        </p>
      )}
      <button
        type="button"
        disabled={selected === null}
        onClick={() => selected && onConfirm(selected)}
        className={`${BTN_PRIMARY} ${BTN_LG} mt-4 block w-full text-center`}
      >
        {mode === "SWAP" ? "Dalej: wybierz rzecz na zamianę" : "Rezerwuję na ten termin"}
      </button>
    </ModalSheet>
  );
}
