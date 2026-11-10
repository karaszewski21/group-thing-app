import { useState } from "react";
import { Link } from "../../routing/navigation";
import { FamilyIcon } from "../../components/shared/appIcons";
import { viewPath } from "../../routing/paths";
import { AttendingTab } from "./tabs/AttendingTab";
import { OrganizedTab } from "./tabs/OrganizedTab";

type Tab = "organizujesz" | "udzial";

const TABS: { id: Tab; label: string }[] = [
  { id: "organizujesz", label: "Organizujesz" },
  { id: "udzial", label: "Biorę udział" },
];

/** The panel's `/meetings`: two tabs, each loading its own data only once
 * opened (a tab's queries stay cached when switching back). */
export function MeetingsView() {
  const [tab, setTab] = useState<Tab>("organizujesz");

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Link
          to={viewPath("groups")}
          className="flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-3.5 text-sm font-extrabold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <FamilyIcon c="currentColor" /> Moje grupy
        </Link>
      </div>
      <div role="tablist" aria-label="Rodzaj spotkań" className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-line p-1">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`spotkania-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`spotkania-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`min-h-10.5 rounded-full text-[15px] font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                on ? "bg-paper text-ink shadow-[0_2px_8px_-2px_rgba(42,35,32,0.25)]" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`spotkania-panel-${tab}`} aria-labelledby={`spotkania-tab-${tab}`}>
        {tab === "organizujesz" ? <OrganizedTab /> : <AttendingTab />}
      </div>
    </>
  );
}
