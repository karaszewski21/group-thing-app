"use client";

import { useId, useState } from "react";
import { Link } from "../../routing/navigation";
import dayjs from "../../utils/dayjs";
import { FIELD } from "./uiStyles";

/** A term or event where a thing can be picked up. */
export interface PickupOption {
  kind: "TERM" | "EVENT";
  id: string;
  name: string;
  /** Naive Warsaw wall clock. */
  starts_at: string;
  /** The term or event page. */
  path: string;
  /** The place's full label. */
  location_name: string | null;
}

function optionKey(option: PickupOption): string {
  return `${option.kind}-${option.id}`;
}

function optionLabel(option: PickupOption): string {
  const label = `${dayjs(option.starts_at).format("ddd D MMM, HH:mm")} · ${option.name}`;
  return option.kind === "EVENT" ? `${label} (wydarzenie)` : label;
}

/** The selected option: a date tile, the time and the name up front, the
 * place under them, the whole card linking to its page. */
function PickupDateCard({ option }: { option: PickupOption }) {
  const date = dayjs(option.starts_at);
  const isEvent = option.kind === "EVENT";
  return (
    <Link
      to={option.path}
      className="mt-3 flex items-center gap-3.5 rounded-2xl border-[1.5px] border-primary bg-primary-soft p-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span
        aria-hidden="true"
        className="flex w-14 flex-none flex-col items-center rounded-xl bg-primary py-1.5 text-on-primary"
      >
        <span className="text-[10.5px] font-extrabold uppercase tracking-wide">{date.format("ddd")}</span>
        <span className="text-2xl leading-none font-extrabold">{date.format("D")}</span>
        <span className="text-[10.5px] font-bold uppercase">{date.format("MMM")}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-extrabold uppercase tracking-wide text-primary-fg">
          {isEvent ? "Wydarzenie" : "Termin"}
        </span>
        <span className="block text-lg leading-tight font-extrabold text-ink">
          <span className="sr-only">{date.format("dddd D MMMM")},</span> godz. {date.format("HH:mm")}
        </span>
        <span className="mt-0.5 block text-[15px] font-extrabold wrap-break-word text-ink">{option.name}</span>
        {option.location_name && (
          <span className="mt-0.5 block text-[13px] wrap-break-word text-ink-soft">📍 {option.location_name}</span>
        )}
        <span className="mt-1.5 block text-[13px] font-bold text-primary-fg underline underline-offset-2">
          {isEvent ? "Zobacz wydarzenie ›" : "Zobacz termin ›"}
        </span>
      </span>
    </Link>
  );
}

interface PickupPlacesBoxProps {
  heading: string;
  /** `h3` inside the item page, `h2` on the owner pages. */
  headingLevel?: "h2" | "h3";
  /** Soonest first; the first one is selected. Nothing renders when empty. */
  options: PickupOption[];
  className?: string;
}

/** Where a thing can be picked up: the selected term or event as a
 * highlighted card and, with more of them, a select to switch. Shared by the
 * item page and the owner's item listings. */
export function PickupPlacesBox({ heading, headingLevel = "h3", options, className = "" }: PickupPlacesBoxProps) {
  const headingId = useId();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  if (options.length === 0) return null;
  const selected = options.find((o) => optionKey(o) === selectedKey) ?? options[0];
  const Heading = headingLevel;
  return (
    <section className={`rounded-3xl border border-line bg-paper p-5 ${className}`} aria-labelledby={headingId}>
      <Heading id={headingId} className="text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft">
        {heading}
      </Heading>
      <PickupDateCard option={selected} />
      {options.length > 1 && (
        <select
          aria-labelledby={headingId}
          value={optionKey(selected)}
          onChange={(e) => setSelectedKey(e.target.value)}
          className={`${FIELD} mt-2.5 w-full`}
        >
          {options.map((o) => (
            <option key={optionKey(o)} value={optionKey(o)}>
              {optionLabel(o)}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}
