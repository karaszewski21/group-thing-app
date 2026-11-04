"use client";

import { useState } from "react";
import type { ItemContextOptionResponse } from "../../../../api/itemActions";
import { FIELD } from "../../../../components/shared/uiStyles";
import { Link } from "../../../../routing/navigation";
import dayjs from "../../../../utils/dayjs";
import { useItemPage } from "../ItemPageContext";
import { FIELD_LABEL, ITEM_SECTION } from "../itemPageShared";

function contextKey(context: ItemContextOptionResponse): string {
  return `${context.kind}-${context.id}`;
}

function contextOptionLabel(context: ItemContextOptionResponse): string {
  const label = `${dayjs(context.starts_at).format("ddd D MMM, HH:mm")} · ${context.name}`;
  return context.kind === "EVENT" ? `${label} (wydarzenie)` : label;
}

/** The selected term or event: a date tile, the time and the name up front,
 * the place under them and the whole card linking to its page. */
function PickupContextCard({ context }: { context: ItemContextOptionResponse }) {
  const startsAt = dayjs(context.starts_at);
  const isEvent = context.kind === "EVENT";
  return (
    <Link
      to={context.path}
      className="mt-3 flex items-center gap-3.5 rounded-2xl border-[1.5px] border-primary bg-primary-soft p-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span
        aria-hidden="true"
        className="flex w-14 flex-none flex-col items-center rounded-xl bg-primary py-1.5 text-on-primary"
      >
        <span className="text-[10.5px] font-extrabold uppercase tracking-wide">{startsAt.format("ddd")}</span>
        <span className="text-2xl leading-none font-extrabold">{startsAt.format("D")}</span>
        <span className="text-[10.5px] font-bold uppercase">{startsAt.format("MMM")}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-extrabold uppercase tracking-wide text-primary-fg">
          {isEvent ? "Wydarzenie" : "Termin"}
        </span>
        <span className="block text-lg leading-tight font-extrabold text-ink">
          <span className="sr-only">{startsAt.format("dddd D MMMM")},</span> godz. {startsAt.format("HH:mm")}
        </span>
        <span className="mt-0.5 block text-[15px] font-extrabold wrap-break-word text-ink">{context.name}</span>
        {context.location_name && (
          <span className="mt-0.5 block text-[13px] wrap-break-word text-ink-soft">📍 {context.location_name}</span>
        )}
        <span className="mt-1.5 block text-[13px] font-bold text-primary-fg underline underline-offset-2">
          {isEvent ? "Zobacz wydarzenie ›" : "Zobacz termin ›"}
        </span>
      </span>
    </Link>
  );
}

/** "Gdzie jeszcze można odebrać": the owner's upcoming terms and events (the
 * server sends them soonest first) — the selected one as a highlighted card,
 * a select to switch when there are more. Nothing when there are none. */
export function ItemPickupPlaces() {
  const { view } = useItemPage();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  if (view.kind !== "own" && view.kind !== "anonymous" && view.kind !== "choose") return null;
  const { contexts } = view;
  if (contexts.length === 0) return null;
  const context = contexts.find((c) => contextKey(c) === selectedKey) ?? contexts[0];
  return (
    <section className={ITEM_SECTION} aria-labelledby="item-pickup-places-heading">
      <h3 id="item-pickup-places-heading" className={FIELD_LABEL}>
        Gdzie jeszcze można odebrać
      </h3>
      <PickupContextCard context={context} />
      {contexts.length > 1 && (
        <select
          aria-labelledby="item-pickup-places-heading"
          value={contextKey(context)}
          onChange={(e) => setSelectedKey(e.target.value)}
          className={`${FIELD} mt-2.5 w-full`}
        >
          {contexts.map((c) => (
            <option key={contextKey(c)} value={contextKey(c)}>
              {contextOptionLabel(c)}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}
