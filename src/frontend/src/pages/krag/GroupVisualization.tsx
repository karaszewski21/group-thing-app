import type { CSSProperties } from "react";
import {
  getCirclePosition,
  getPitchPosition,
  getStableSlotOrder,
  getTablePosition,
} from "../../utils/layoutPositions";
import { Avatar } from "../../components/shared/Avatar";
import { BringsIcon, SharesIcon } from "../../components/shared/Icons";
import type { NeededItemRowVM } from "./components/termSectionTypes";

export type GroupLayoutMode = "CIRCLE" | "PITCH" | "TABLE";

/** One avatar in the visualization — a person signed up for the Term. */
export interface VisualizationFamily {
  familyId: number;
  name: string;
  /** Renders the "udostępnia rzecz" (shares) marker on the avatar. */
  sharesItem?: boolean;
  /** Renders the "przynosi na zajęcia" (brings) marker on the avatar. */
  bringsItem?: boolean;
}

export interface GroupVisualizationProps {
  layoutMode: GroupLayoutMode;
  /** Organizer/leader display name — rendered as the CIRCLE center node, the
   * "trenerka" above the PITCH, and the top node above the TABLE. */
  organizerName: string;
  families: VisualizationFamily[];
  neededItemRows: NeededItemRowVM[]
  activeFamilyId: number | string | null;
  onSelectFamily: (familyId: number) => void;
  /** Seeds the deterministic PITCH/TABLE family→slot shuffle
   * (`getStableSlotOrder`); unused by CIRCLE, which keeps `families`' natural
   * order. Still accepted uniformly so all 3 layouts share one prop contract. */
  groupId: number | string;
}

function isActive(activeFamilyId: number | string | null, familyId: number): boolean {
  return activeFamilyId !== null && String(activeFamilyId) === String(familyId);
}

interface FamilySlotProps {
  family: VisualizationFamily;
  active: boolean;
  style: CSSProperties;
  onSelectFamily: (familyId: number) => void;
}

/** One family's clickable avatar slot — shared markup across all 3 layouts. */
function FamilySlot({ family, active, style, onSelectFamily }: FamilySlotProps) {
  return (
    <button
      type="button"
      className={`kg-fam ${active ? "is-on" : ""}`}
      style={style}
      onClick={() => onSelectFamily(family.familyId)}
      aria-pressed={active}
      aria-label={family.name}
    >
      <Avatar name={family.name} showsSharesIcon={family.sharesItem} showsBringsIcon={family.bringsItem} />
    </button>
  );
}

interface LayoutProps {
  families: VisualizationFamily[];
  neededItemRows: NeededItemRowVM[]
  organizerName: string;
  activeFamilyId: number | string | null;
  onSelectFamily: (familyId: number) => void;
}

/**
 * CIRCLE layout — people evenly spaced around the organizer
 * (`getCirclePosition`), each joined to the center by a line.
 */
function CircleLayout({ families, organizerName, activeFamilyId, onSelectFamily }: LayoutProps) {
  const slots = families.length;
  const pos = (i: number) => {
    const { x, y } = getCirclePosition(i, slots);
    return { left: `${x}%`, top: `${y}%` };
  };

  return (
    <div className="kg-circle-wrap">
      <div className="kg-stagebox">
        <div className="kg-square">
          <div className="kg-inner">
            <svg className="kg-svg" viewBox="0 0 100 100" aria-hidden="true">
              {families.map((f, i) => {
                const { x, y } = getCirclePosition(i, slots);
                const on = isActive(activeFamilyId, f.familyId);
                return (
                  <line
                    key={f.familyId}
                    x1="50"
                    y1="50"
                    x2={x}
                    y2={y}
                    stroke={on ? "#1B8168" : "#CBDAC7"}
                    strokeWidth={on ? "1" : "0.45"}
                  />
                );
              })}
            </svg>

            {families.map((f, i) => (
              <FamilySlot
                key={f.familyId}
                family={f}
                active={isActive(activeFamilyId, f.familyId)}
                style={pos(i)}
                onSelectFamily={onSelectFamily}
              />
            ))}

            <div className="kg-center">
              <div className="kg-center-av">{organizerName ? organizerName.slice(0, 1) : "?"}</div>
              <strong>{organizerName || "Brak organizatora"}</strong>
              <span>prowadzi zajęcia</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * PITCH layout (new) — families laid out in evenly spaced rows
 * (`getPitchPosition`/`distributeEvenly`/`locateInRows`), any family count
 * without avatar overlap, deterministic slot shuffle via
 * `getStableSlotOrder` (seeded by `groupId`, per mockup's "rozkład rodzin na
 * boisku jest losowy — bez znaczenia taktycznego"). The organizer renders
 * above the pitch as "trenerka", separate from the family grid — per
 * `wizualizacja-grupy-boisko.html`.
 */
function PitchLayout({
  families,
  organizerName,
  activeFamilyId,
  onSelectFamily,
  groupId,
}: LayoutProps & { groupId: number | string }) {
  const slots = families.length;
  const order = getStableSlotOrder(groupId, families.map((f) => f.familyId));
  const byId = new Map(families.map((f) => [f.familyId, f]));

  return (
    <div className="px-[18px] pt-[16px]">
      <div className="text-center mb-3">
        <div className="mx-auto w-[52px] h-[52px] rounded-full bg-[var(--ink)] text-white flex items-center justify-center text-lg shadow-[0_14px_28px_-14px_rgba(30,46,39,.85)]">
          🎵
        </div>
        <strong className="block mt-2.5 font-serif text-[15px] text-[var(--ink)]">
          {organizerName || "Brak organizatora"}
        </strong>
        <span className="block text-[12px] text-[var(--ink-soft)]">trenerka</span>
      </div>

      <div
        className="relative w-full max-w-[360px] mx-auto aspect-square rounded-[18px] border-2 border-white/50 overflow-hidden"
        style={{ background: "linear-gradient(160deg,#4E9A5F,#3E8A4E)" }}
        data-testid="pitch-field"
      >
        {order.map((familyId, i) => {
          const family = byId.get(familyId);
          if (!family) return null;
          const { x, y } = getPitchPosition(i, slots);
          return (
            <FamilySlot
              key={family.familyId}
              family={family}
              active={isActive(activeFamilyId, family.familyId)}
              style={{ left: `${x}%`, top: `${y}%` }}
              onSelectFamily={onSelectFamily}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * TABLE layout (new) — families distributed around an ellipse's perimeter
 * (`getTablePosition`), any family count without avatar overlap, same
 * deterministic slot shuffle as PITCH. The term's needed items sit as
 * "chips" in the center of the table and are never interactive (no
 * `onClick`, not `<button>` elements).
 */
function TableLayout({
  families,
  organizerName,
  activeFamilyId,
  neededItemRows,
  onSelectFamily,
  groupId,
}: LayoutProps & { groupId: number | string }) {
  const slots = families.length;
  const order = getStableSlotOrder(groupId, families.map((f) => f.familyId));
  const byId = new Map(families.map((f) => [f.familyId, f]));

  return (
    <div className="px-[18px] pt-[16px]">
      <div className="relative w-full max-w-[360px] mx-auto aspect-square">
        <div className="absolute left-1/2 top-[8%] -translate-x-1/2 -translate-y-1/2 text-center w-[52%]">
          <div className="mx-auto w-[52px] h-[52px] rounded-full bg-[var(--ink)] text-white flex items-center justify-center text-lg shadow-[0_14px_28px_-14px_rgba(30,46,39,.85)]">
            🎵
          </div>
          <strong className="block mt-2.5 font-serif text-[15px] text-[var(--ink)]">
            {organizerName || "Brak organizatora"}
          </strong>
          <span className="block text-[12px] text-[var(--ink-soft)]">prowadzi zajęcia</span>
        </div>

        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[64%] h-[46%] rounded-full flex flex-col items-center justify-center gap-2 p-2.5"
          style={{ background: "#e7cfa8", border: "6px solid var(--ink)" }}
          data-testid="table-chips"
        >
          {neededItemRows.map((chip) => (
            <span
              key={chip.key}
              className="bg-white rounded-2xl px-3.5 py-1.5 text-[12px] font-bold text-[var(--ink)] shadow-[0_4px_8px_rgba(0,0,0,0.12)] flex items-center gap-1.5"
            >
              {chip.title}
            </span>
          ))}
        </div>

        {order.map((familyId, i) => {
          const family = byId.get(familyId);
          if (!family) return null;
          const { x, y } = getTablePosition(i, slots);
          return (
            <FamilySlot
              key={family.familyId}
              family={family}
              active={isActive(activeFamilyId, family.familyId)}
              style={{ left: `${x}%`, top: `${y}%` }}
              onSelectFamily={onSelectFamily}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Two-entry exchange-status legend, rendered once beneath the visualization
 * regardless of `layoutMode` — identical content/markup in all 3 layouts
 * (Core Requirement 8 / `component:exchange-legend`). */
function ExchangeLegend() {
  return (
    <div className="flex gap-3.5 justify-center text-[11px] text-[var(--ink-soft)] mt-2.5 mx-5 mb-1" data-testid="exchange-legend">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-[var(--mint)] inline-flex items-center justify-center text-white">
          <SharesIcon size={8} strokeWidth={3} />
        </span>
        udostępnia rzecz
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-[var(--teal)] inline-flex items-center justify-center text-white">
          <BringsIcon size={8} strokeWidth={3} />
        </span>
        przynosi na zajęcia
      </span>
    </div>
  );
}

/**
 * Container for the group's participant visualization — renders exactly one
 * of `CircleLayout`/`PitchLayout`/`TableLayout` based on `layoutMode`, plus
 * the shared `ExchangeLegend` beneath it. See spec.md Section 4 (Architektura
 * komponentów) for the full contract.
 */
export function GroupVisualization({
  layoutMode,
  organizerName,
  families,
  neededItemRows,
  activeFamilyId,
  onSelectFamily,
  groupId,
}: GroupVisualizationProps) {
  return (
    <>
      {layoutMode === "CIRCLE" && (
        <CircleLayout
          families={families}
          neededItemRows={neededItemRows}
          organizerName={organizerName}
          activeFamilyId={activeFamilyId}
          onSelectFamily={onSelectFamily}
        />
      )}
      {layoutMode === "PITCH" && (
        <PitchLayout
          families={families}
          organizerName={organizerName}
          neededItemRows={neededItemRows}
          activeFamilyId={activeFamilyId}
          onSelectFamily={onSelectFamily}
          groupId={groupId}
        />
      )}
      {layoutMode === "TABLE" && (
        <TableLayout
          families={families}
          neededItemRows={neededItemRows}
          organizerName={organizerName}
          activeFamilyId={activeFamilyId}
          onSelectFamily={onSelectFamily}
          groupId={groupId}
        />
      )}
      <ExchangeLegend />
    </>
  );
}
