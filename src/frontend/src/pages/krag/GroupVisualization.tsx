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
  familyId: string;
  name: string;
  /** Renders the "udostępnia rzecz" (shares) marker on the avatar. */
  sharesItem?: boolean;
  /** Renders the "przynosi na zajęcia" (brings) marker on the avatar. */
  bringsItem?: boolean;
}

export interface GroupVisualizationProps {
  layoutMode: GroupLayoutMode;
  /** Organizer/leader display name — rendered as the CIRCLE center node, the
   * name above the PITCH, and the seat at the head of the TABLE. */
  organizerName: string;
  families: VisualizationFamily[];
  neededItemRows: NeededItemRowVM[]
  activeFamilyId: string | string | null;
  onSelectFamily: (familyId: string) => void;
  /** Seeds the deterministic PITCH/TABLE family→slot shuffle
   * (`getStableSlotOrder`); unused by CIRCLE, which keeps `families`' natural
   * order. Still accepted uniformly so all 3 layouts share one prop contract. */
  groupId: string | string;
}

function isActive(activeFamilyId: string | string | null, familyId: string): boolean {
  return activeFamilyId !== null && String(activeFamilyId) === String(familyId);
}

interface FamilySlotProps {
  family: VisualizationFamily;
  active: boolean;
  style: CSSProperties;
  onSelectFamily: (familyId: string) => void;
}

/** One family's clickable avatar slot — shared markup across all 3 layouts. */
function FamilySlot({ family, active, style, onSelectFamily }: FamilySlotProps) {
  return (
    <button
      type="button"
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-200 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${active ? "scale-110 ring-4 ring-primary" : ""}`}
      style={style}
      onClick={() => onSelectFamily(family.familyId)}
      aria-pressed={active}
      aria-label={family.name}
    >
      <Avatar name={family.name} showsSharesIcon={family.sharesItem} showsBringsIcon={family.bringsItem} />
    </button>
  );
}

/** Seats drawn while nobody has signed up yet — dashed, decorative only. */
const GHOST_SEATS = { CIRCLE: 8, PITCH: 6, TABLE: 8 } as const;

function GhostSeat({ style, onPitch = false }: { style: CSSProperties; onPitch?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-ghost-seat
      className={`absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed ${
        onPitch ? "border-white/75 bg-white/10" : "border-primary/45 bg-paper"
      }`}
      style={style}
    />
  );
}

interface LayoutProps {
  families: VisualizationFamily[];
  neededItemRows: NeededItemRowVM[]
  organizerName: string;
  activeFamilyId: string | string | null;
  onSelectFamily: (familyId: string) => void;
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
    <div className="px-4.5 pt-5 pb-1.5">
      <div className="relative mx-auto aspect-square w-full max-w-90">
        <div className="absolute inset-0">
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="38" fill="none" className="stroke-primary/35" strokeWidth="0.6" strokeDasharray="2 2" />
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
                    className={on ? "stroke-primary" : "stroke-line-strong"}
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
            {slots === 0 &&
              Array.from({ length: GHOST_SEATS.CIRCLE }, (_, i) => {
                const { x, y } = getCirclePosition(i, GHOST_SEATS.CIRCLE);
                return <GhostSeat key={i} style={{ left: `${x}%`, top: `${y}%` }} />;
              })}

            <div className="absolute top-1/2 left-1/2 w-[48%] -translate-x-1/2 -translate-y-1/2 text-center">
              <OrganizerAvatar name={organizerName} />
              <strong className="mt-2.5 block font-serif text-[15px] font-bold">
                {organizerName || "Brak organizatora"}
              </strong>
            </div>
        </div>
      </div>
    </div>
  );
}

/** The organizer's initial in a primary disc, ringed like the mockup's center. */
function OrganizerAvatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <div
      className={`mx-auto flex items-center justify-center rounded-full bg-primary font-serif font-extrabold text-on-primary shadow-[0_0_0_5px_var(--color-primary-soft),0_0_0_7px_var(--color-primary)] ${small ? "h-13 w-13 text-xl" : "h-20 w-20 text-3xl"}`}
    >
      {name ? name.slice(0, 1).toUpperCase() : "?"}
    </div>
  );
}

/**
 * PITCH layout (new) — families laid out in evenly spaced rows
 * (`getPitchPosition`/`distributeEvenly`/`locateInRows`), any family count
 * without avatar overlap, deterministic slot shuffle via
 * `getStableSlotOrder` (seeded by `groupId`, per mockup's "rozkład rodzin na
 * boisku jest losowy — bez znaczenia taktycznego"). The organizer renders
 * above the pitch, separate from the family grid — per
 * `wizualizacja-grupy-boisko.html`.
 */
function PitchLayout({
  families,
  organizerName,
  activeFamilyId,
  onSelectFamily,
  groupId,
}: LayoutProps & { groupId: string | string }) {
  const slots = families.length;
  const order = getStableSlotOrder(groupId, families.map((f) => f.familyId));
  const byId = new Map(families.map((f) => [f.familyId, f]));

  return (
    <div className="px-4.5 pt-5 pb-1.5">
      <div className="mb-3 text-center">
        <OrganizerAvatar name={organizerName} small />
        <strong className="mt-2.5 block font-serif text-[15px] font-bold text-ink">
          {organizerName || "Brak organizatora"}
        </strong>
      </div>

      <div
        className="relative mx-auto aspect-square w-full max-w-90 overflow-hidden rounded-[18px] border-2 border-white/50"
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
        {slots === 0 &&
          Array.from({ length: GHOST_SEATS.PITCH }, (_, i) => {
            const { x, y } = getPitchPosition(i, GHOST_SEATS.PITCH);
            return <GhostSeat key={i} onPitch style={{ left: `${x}%`, top: `${y}%` }} />;
          })}
      </div>
    </div>
  );
}

/**
 * TABLE layout (new) — families distributed around an ellipse's perimeter
 * (`getTablePosition`), any family count without avatar overlap, same
 * deterministic slot shuffle as PITCH. The organizer sits at the head of the
 * table (the first seat of `slots + 1`); families take the seats after it.
 * The term's needed items sit as "chips" in the center of the table and are
 * never interactive (no `onClick`, not `<button>` elements).
 */
function TableLayout({
  families,
  organizerName,
  activeFamilyId,
  neededItemRows,
  onSelectFamily,
  groupId,
}: LayoutProps & { groupId: string | string }) {
  const slots = families.length;
  const order = getStableSlotOrder(groupId, families.map((f) => f.familyId));
  const byId = new Map(families.map((f) => [f.familyId, f]));

  const seats = (slots === 0 ? GHOST_SEATS.TABLE : slots) + 1;
  const head = getTablePosition(0, seats);

  return (
    <div className="px-4.5 pt-12 pb-1.5">
      <div className="relative mx-auto aspect-square w-full max-w-90">
        {/* Avatar centered on the head seat, the name above it. */}
        <div
          className="absolute flex -translate-x-1/2 -translate-y-[calc(100%-26px)] flex-col items-center gap-2"
          style={{ left: `${head.x}%`, top: `${head.y}%` }}
        >
          <strong className="rounded-full bg-paper px-3 py-1 font-serif text-[14px] font-bold whitespace-nowrap text-ink">
            {organizerName || "Brak organizatora"}
          </strong>
          <OrganizerAvatar name={organizerName} small />
        </div>

        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[64%] h-[46%] rounded-full flex flex-col items-center justify-center gap-2 p-2.5"
          style={{ background: "#e7cfa8", border: "6px solid var(--color-ink)" }}
          data-testid="table-chips"
        >
          {neededItemRows.length === 0 && (
            <span className="px-3 text-center text-[12.5px] leading-snug text-ink/70">Tu pojawią się potrzebne rzeczy</span>
          )}
          {neededItemRows.map((chip) => (
            <span
              key={chip.key}
              className="bg-paper rounded-2xl px-3.5 py-1.5 text-[12px] font-bold text-ink shadow-[0_4px_8px_rgba(0,0,0,0.12)] flex items-center gap-1.5"
            >
              {chip.title}
            </span>
          ))}
        </div>

        {order.map((familyId, i) => {
          const family = byId.get(familyId);
          if (!family) return null;
          const { x, y } = getTablePosition(i + 1, seats);
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
        {slots === 0 &&
          Array.from({ length: GHOST_SEATS.TABLE }, (_, i) => {
            const { x, y } = getTablePosition(i + 1, seats);
            return <GhostSeat key={i} style={{ left: `${x}%`, top: `${y}%` }} />;
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
    <div className="flex gap-3.5 justify-center text-[11px] text-ink-soft mt-2.5 mx-5 mb-1" data-testid="exchange-legend">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-accent text-ink">
          <SharesIcon size={8} strokeWidth={3} />
        </span>
        udostępnia rzecz
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-teal inline-flex items-center justify-center text-ink">
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
      {families.length === 0 && (
        <p className="mx-auto mt-1 w-max rounded-full bg-paper px-3.5 py-1.5 text-[13px] font-bold text-primary-fg">
          Nikt się jeszcze nie zapisał
        </p>
      )}
      <ExchangeLegend />
    </>
  );
}
