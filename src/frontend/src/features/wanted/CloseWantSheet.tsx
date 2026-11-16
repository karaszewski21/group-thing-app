import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { hasStatus, serverMessageOr } from "../../api/problem";
import { closeWant, type WantResponse } from "../../api/wants";
import { ModalSheet } from "../../components/shared/ModalSheet";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../../components/shared/uiStyles";
import { WANTS_KEY } from "../../hooks/useWants";

const ACTION = `${BTN_LG} w-full`;

function closeLabel(count: number): string {
  if (count === 1) return "Zamknij poszukiwanie";
  return count === 2 ? "Zamknij oba poszukiwania" : "Zamknij wszystkie poszukiwania";
}

/** A want that is already closed (409) or gone (404) needs no closing. */
function isAlreadyClosed(err: unknown): boolean {
  return hasStatus(err, 409) || hasStatus(err, 404);
}

/** "Znalezione?": asks whether to close the active `wants` (at least one)
 * that the just-taken item matches. "Zamknij …" closes all of them as
 * FULFILLED and then calls `onClose`; a failure stays inline, and pressing
 * again re-sends every want, so one that failed part-way can be completed.
 * "Szukam dalej" only calls `onClose`. */
export function CloseWantSheet({ wants, onClose }: { wants: WantResponse[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const single = wants.length === 1;

  async function closeAll() {
    setBusy(true);
    setError(null);
    // Direct API calls, not `useWants().close`: each want gets its own outcome via allSettled (404/409 = already
    // closed), and the wants prefix is invalidated once for all of them instead of once per want.
    const results = await Promise.allSettled(wants.map((want) => closeWant(want.id, "FULFILLED")));
    await queryClient.invalidateQueries({ queryKey: [WANTS_KEY] });
    const failure = results.find((result) => result.status === "rejected" && !isAlreadyClosed(result.reason));
    if (failure?.status === "rejected") {
      setError(serverMessageOr(failure.reason, "Nie udało się zamknąć poszukiwania. Spróbuj ponownie."));
      setBusy(false);
      return;
    }
    onClose();
  }

  return (
    <ModalSheet title="Znalezione?" ariaLabel="Zamknąć poszukiwanie?" onClose={onClose}>
      <p className="mb-1.5 text-[15px] text-ink">
        {single ? "Ta rzecz pasuje do Twojego poszukiwania:" : "Ta rzecz pasuje do Twoich poszukiwań:"}
      </p>
      {single ? (
        <p className="mb-4 text-base font-extrabold text-ink">„{wants[0].name}”</p>
      ) : (
        <ul className="mb-4 ml-[18px] list-disc text-base leading-normal font-extrabold text-ink">
          {wants.map((want) => (
            <li key={want.id}>„{want.name}”</li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="mb-2.5 text-[13px] font-bold text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2.5">
        <button type="button" disabled={busy} onClick={() => void closeAll()} className={`${BTN_PRIMARY} ${ACTION}`}>
          {closeLabel(wants.length)}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={`${BTN_GHOST} ${ACTION} text-ink`}>
          Szukam dalej
        </button>
      </div>
      <p className="mt-2.5 text-xs text-ink-soft">
        {single
          ? "Zamknięte poszukiwanie możesz wznowić przez 30 dni."
          : "Zamknięte poszukiwania możesz wznowić przez 30 dni."}
      </p>
    </ModalSheet>
  );
}
