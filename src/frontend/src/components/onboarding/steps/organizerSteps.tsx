import { useEffect, useState } from "react";
import type { Step, StepContext } from "../OnboardingWizard";
import { createMyCircle, type GroupResponse } from "../../../api/groups";
import { createNeededItem, createTerm, type NeededItemCategory } from "../../../api/terms";

const inputClass =
  "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-mint focus:ring-[3px] focus:ring-mint-soft";
const labelClass = "mb-1.5 block text-xs font-extrabold tracking-wide text-ink-soft";

const NEEDED_ITEM_LABELS: Record<NeededItemCategory, string> = {
  INSTRUMENT: "Instrument",
  MAT_BLANKET: "Mata/koc",
  ART_SUPPLIES: "Materiały plastyczne",
  OTHER: "Inne",
};

interface DraftNeededItem {
  category: NeededItemCategory;
  description: string;
}

/**
 * Holds the circle created by step 1 for step 2 to reference (`Grupa:
 * {step1 value}` in the mockup, and `circle_group_id` for `createTerm`).
 * Module-scoped rather than lifted into `OnboardingWizard`'s generic
 * `Step` contract — the wizard shell has no notion of cross-step state,
 * and only one onboarding flow is ever in progress per browser session.
 */
let createdCircle: GroupResponse | null = null;

/* ------------------------------------------------------------------ */
/*  Step 1/2 — Nazwa grupy: reuses createMyCircle()/handleAddGroup()'s   */
/*  logic (single text input + submit).                                 */
/* ------------------------------------------------------------------ */

function CircleNameStepBody({ ctx }: { ctx: StepContext }) {
  const [name, setName] = useState("");

  useEffect(() => {
    ctx.setSubmit(async () => {
      if (!name.trim()) return;
      createdCircle = await createMyCircle({ name: name.trim() });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return (
    <div>
      <label htmlFor="onboarding-circle-name" className={labelClass}>
        Nazwa grupy
      </label>
      <input
        id="onboarding-circle-name"
        className={inputClass}
        placeholder="np. Muzyczne Maluchy"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2/2 — Termin zajęć: mirrors PanelPage's "+ Dodaj termin" modal  */
/*  fields (Grupa/Data/Opis/Potrzebne rzeczy), including its own local   */
/*  needed-items draft list submitted after the term itself is created. */
/* ------------------------------------------------------------------ */

function TermStepBody({ ctx }: { ctx: StepContext }) {
  const [occursOn, setOccursOn] = useState("");
  const [description, setDescription] = useState("");
  const [neededDraft, setNeededDraft] = useState<DraftNeededItem[]>([]);
  const [draftCategory, setDraftCategory] = useState<NeededItemCategory>("OTHER");
  const [draftDescription, setDraftDescription] = useState("");

  useEffect(() => {
    ctx.setSubmit(async () => {
      if (!occursOn || !createdCircle) return;
      const term = await createTerm({
        circle_group_id: createdCircle.id,
        occurs_on: occursOn,
        description: description || undefined,
      });
      for (const item of neededDraft) {
        await createNeededItem({
          term_id: term.id,
          category: item.category,
          description: item.description || undefined,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occursOn, description, neededDraft]);

  function addDraftNeededItem() {
    setNeededDraft((prev) => [...prev, { category: draftCategory, description: draftDescription.trim() }]);
    setDraftDescription("");
  }

  function removeDraftNeededItem(index: number) {
    setNeededDraft((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className={labelClass}>Grupa</span>
        <p className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink-soft">
          {createdCircle?.name ?? "—"}
        </p>
      </div>

      <div>
        <label htmlFor="onboarding-term-date" className={labelClass}>
          Data
        </label>
        <input
          id="onboarding-term-date"
          type="date"
          className={inputClass}
          value={occursOn}
          onChange={(e) => setOccursOn(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="onboarding-term-description" className={labelClass}>
          Opis (opcjonalnie)
        </label>
        <input
          id="onboarding-term-description"
          className={inputClass}
          placeholder="17:00 · Park Sołacki · wstęp wolny"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <span className={labelClass}>Potrzebne rzeczy</span>
        {neededDraft.map((item, index) => (
          <div key={index} className="mb-1.5 flex items-center gap-2 text-[13px]">
            <span className="flex-1">
              {NEEDED_ITEM_LABELS[item.category]}
              {item.description ? ` — ${item.description}` : ""}
            </span>
            <button
              type="button"
              onClick={() => removeDraftNeededItem(index)}
              aria-label={`Usuń ${NEEDED_ITEM_LABELS[item.category]}`}
              className="text-xs font-bold text-danger"
            >
              Usuń
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <select
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value as NeededItemCategory)}
            className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
          >
            {(Object.keys(NEEDED_ITEM_LABELS) as NeededItemCategory[]).map((c) => (
              <option key={c} value={c}>
                {NEEDED_ITEM_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Opis (opcjonalnie)"
            className="min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
          />
          <button
            type="button"
            onClick={addDraftNeededItem}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft"
          >
            Dodaj
          </button>
        </div>
      </div>
    </div>
  );
}

export const organizerSteps: Step[] = [
  {
    id: "circle-name",
    title: "Nazwa grupy",
    isSkippable: true,
    render: (ctx) => <CircleNameStepBody ctx={ctx} />,
  },
  {
    id: "term",
    title: "Termin zajęć",
    isSkippable: true,
    render: (ctx) => <TermStepBody ctx={ctx} />,
  },
];
