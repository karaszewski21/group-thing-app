import { useId } from "react";
import { ModalSheet } from "../../components/shared/ModalSheet";
import { BTN_GHOST, BTN_LG } from "../../components/shared/uiStyles";
import { useMyPoints } from "../../hooks/useMyPoints";
import dayjs from "../../utils/dayjs";
import type { TakeTarget } from "./useItemTake";

/** The orange POINTS action (ink text: about 5:1 on orange). */
export const POINTS_ACTION =
  "rounded-full border-0 bg-orange font-extrabold text-ink disabled:opacity-60 " +
  "aria-disabled:cursor-not-allowed aria-disabled:bg-line-strong aria-disabled:text-ink-soft " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const GHOST_ACTION = `${BTN_GHOST} ${BTN_LG} mt-2.5 block w-full text-center text-ink`;
const ROW = "flex justify-between border-b border-line py-2 text-sm last:border-0";

/** "odbiór osobisty · <locality>" or "odbiór: spotkanie „<name>”, sob 6.12". */
function pickupLine(target: TakeTarget, locationName: string | null): string {
  if (target.kind === "PERSONAL") return locationName ? `odbiór osobisty · ${locationName}` : "odbiór osobisty";
  const kind = target.kind === "EVENT" ? "wydarzenie" : "spotkanie";
  return `odbiór: ${kind} „${target.name}”, ${dayjs(target.starts_at).format("ddd D.MM")}`;
}

interface PointsReservationSheetProps {
  itemName: string;
  price: number;
  target: TakeTarget;
  /** The item's locality, for a personal pickup. */
  locationName: string | null;
  busy: boolean;
  /** The server's refusal of the last attempt, shown verbatim. */
  error: string | null;
  onConfirm: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

/** "Biorę za punkty": the price, the caller's available balance and what is
 * left after the hold, with where the item is picked up. A short balance
 * keeps the action focusable but blocked (`aria-disabled`), described by
 * how many points are missing; the server still decides. A refusal replaces
 * the action with its message and „Odśwież”. */
export function PointsReservationSheet({
  itemName,
  price,
  target,
  locationName,
  busy,
  error,
  onConfirm,
  onRefresh,
  onClose,
}: PointsReservationSheetProps) {
  const points = useMyPoints();
  const hintId = useId();
  const balance = points.data?.balance ?? null;
  const missing = balance !== null && balance < price ? price - balance : null;

  return (
    <ModalSheet title="Biorę za punkty" onClose={onClose}>
      <p className="text-[12.5px] text-ink-soft">{`${itemName} · ${pickupLine(target, locationName)}`}</p>
      <dl className="mt-2.5">
        <div className={ROW}>
          <dt>Cena</dt>
          <dd className="font-extrabold">{`${price} pkt`}</dd>
        </div>
        <div className={ROW}>
          <dt>Dostępne saldo</dt>
          <dd className="font-extrabold">{balance === null ? (points.loading ? "…" : "—") : `${balance} pkt`}</dd>
        </div>
        {balance !== null && missing === null && (
          <div className={ROW}>
            <dt>Po rezerwacji</dt>
            <dd className="font-extrabold">{`${balance - price} pkt`}</dd>
          </div>
        )}
      </dl>
      {error !== null ? (
        <>
          <p role="alert" className="mt-3 rounded-[14px] bg-danger-soft px-3 py-2.5 text-[12.5px] font-bold text-danger">
            {error}
          </p>
          <button type="button" onClick={onRefresh} className={GHOST_ACTION}>
            Odśwież
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            aria-disabled={!busy && missing !== null ? true : undefined}
            aria-describedby={missing !== null ? hintId : undefined}
            onClick={() => {
              if (missing === null) onConfirm();
            }}
            className={`${POINTS_ACTION} ${BTN_LG} mt-4 block w-full text-center`}
          >
            {`Zablokuj ${price} pkt i rezerwuj`}
          </button>
          {missing !== null && (
            <p id={hintId} className="mt-1.5 text-[12.5px] font-bold text-danger">
              {`Brakuje Ci ${missing} pkt.`}
            </p>
          )}
          {points.error !== null && (
            <p className="mt-1.5 text-[12.5px] text-ink-soft">Nie udało się wczytać salda — serwer sprawdzi je przy rezerwacji.</p>
          )}
        </>
      )}
      <button type="button" onClick={onClose} className={GHOST_ACTION}>
        Anuluj
      </button>
    </ModalSheet>
  );
}
