"use client";

import { useEventPage } from "../EventPageContext";
import { RETRY_BUTTON } from "../EventRouteStates";

/** A failed refresh for a new token, under the read-only event. */
export function EventRefreshError() {
  const { view, actions } = useEventPage();
  if (view.kind !== "refreshing" || view.error === null) return null;
  return (
    <div className="mx-5 mt-6">
      <p role="alert" className="text-[12.5px] font-semibold text-danger">
        Nie udało się odświeżyć wydarzenia — {view.error}
      </p>
      <button type="button" onClick={() => void actions.refetch()} className={RETRY_BUTTON}>
        Spróbuj ponownie
      </button>
    </div>
  );
}
