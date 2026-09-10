import { useEffect, useState } from "react";
import type { Step, StepContext } from "../OnboardingWizard";
import { createMyCircle, type GroupResponse } from "../../../api/groups";
import { createNeededItem, createTerm } from "../../../api/terms";
import { resolveProduct } from "../../../api/products";
import { createMyOrganization } from "../../../api/organizations";
import { NeededItemQuickAddForm } from "../../shared/NeededItemQuickAddForm";
import {
  createEmptyNeededItemQuickAddValue,
  type NeededItemQuickAddValue,
} from "../../../utils/neededItemQuickAdd";

const inputClass =
  "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-mint focus:ring-[3px] focus:ring-mint-soft";
const labelClass = "mb-1.5 block text-xs font-extrabold tracking-wide text-ink-soft";

/**
 * Holds the circle created by step 1 for step 2 to reference (`Grupa:
 * {step1 value}` in the mockup, and `circle_group_id` for `createTerm`).
 * Module-scoped rather than lifted into `OnboardingWizard`'s generic
 * `Step` contract — the wizard shell has no notion of cross-step state,
 * and only one onboarding flow is ever in progress per browser session.
 */
let createdCircle: GroupResponse | null = null;

/* ------------------------------------------------------------------ */
/*  Step 1/3 — Nazwa organizacji: mandatory (isSkippable: false, see     */
/*  export below) — every ORGANIZER account gets an Organization brand   */
/*  identity, per the "full pakiet" requirement. Throws (rather than      */
/*  silently no-op'ing like the skippable steps below) on an empty name  */
/*  so `OnboardingWizard.handleAdvance` blocks advancing instead of       */
/*  quietly skipping creation.                                           */
/* ------------------------------------------------------------------ */

function OrganizationNameStepBody({ ctx }: { ctx: StepContext }) {
  const [name, setName] = useState("");

  useEffect(() => {
    ctx.setSubmit(async () => {
      if (!name.trim()) throw new Error("Nazwa organizacji jest wymagana");
      await createMyOrganization({ name: name.trim() });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return (
    <div>
      <label htmlFor="onboarding-organization-name" className={labelClass}>
        Nazwa organizacji
      </label>
      <input
        id="onboarding-organization-name"
        className={inputClass}
        placeholder="np. Muzyczne Skrzaty"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <p className="mt-1.5 text-xs text-ink-soft">
        Własną stronę organizacji (z kolorami) skonfigurujesz później w menu.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2/3 — Nazwa grupy: reuses createMyCircle()/handleAddGroup()'s   */
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
/*  Step 3/3 — Termin zajęć: mirrors PanelPage's "+ Dodaj termin" modal  */
/*  fields (Grupa/Data/Opis/Potrzebne rzeczy), including its own local   */
/*  needed-items draft list submitted after the term itself is created. */
/* ------------------------------------------------------------------ */

function TermStepBody({ ctx }: { ctx: StepContext }) {
  const [occursOn, setOccursOn] = useState("");
  const [description, setDescription] = useState("");
  const [neededDraft, setNeededDraft] = useState<NeededItemQuickAddValue[]>([]);
  const [draft, setDraft] = useState<NeededItemQuickAddValue>(createEmptyNeededItemQuickAddValue());
  const [addingNeeded, setAddingNeeded] = useState(false);

  useEffect(() => {
    ctx.setSubmit(async () => {
      if (!occursOn || !createdCircle) return;
      const term = await createTerm({
        circle_group_id: createdCircle.id,
        occurs_on: occursOn,
        description: description || undefined,
      });
      for (const item of neededDraft) {
        const product = await resolveProduct({ name: item.name, category: item.category });
        await createNeededItem({
          term_id: term.id,
          product_id: product.id,
          description: item.description || undefined,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occursOn, description, neededDraft]);

  function addDraftNeededItem() {
    if (!draft.name.trim()) return;
    setNeededDraft((prev) => [
      ...prev,
      { ...draft, name: draft.name.trim(), description: draft.description.trim() },
    ]);
    setDraft(createEmptyNeededItemQuickAddValue());
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
          Data i godzina
        </label>
        <input
          id="onboarding-term-date"
          type="datetime-local"
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
        <span className={labelClass}>Potrzebne rzeczy (opcjonalnie)</span>
        {neededDraft.map((item, index) => (
          <div key={index} className="mb-1.5 flex items-center gap-2 text-[13px]">
            <span className="flex-1">
              {item.name}
              {item.description ? ` — ${item.description}` : ""}
            </span>
            <button
              type="button"
              onClick={() => removeDraftNeededItem(index)}
              aria-label={`Usuń ${item.name}`}
              className="text-xs font-bold text-danger"
            >
              Usuń
            </button>
          </div>
        ))}
        {addingNeeded ? (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <NeededItemQuickAddForm value={draft} onChange={setDraft} />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={addDraftNeededItem}
                disabled={!draft.name.trim()}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-50"
              >
                Dodaj rzecz
              </button>
              <button
                type="button"
                onClick={() => setAddingNeeded(false)}
                className="rounded-full px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-cream"
              >
                Zwiń
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingNeeded(true)}
            className="mt-1 rounded-[9px] px-1.5 py-1 text-[12px] font-bold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
          >
            + Dodaj potrzebną rzecz
          </button>
        )}
      </div>
    </div>
  );
}

export const organizerSteps: Step[] = [
  {
    id: "organization-name",
    title: "Nazwa organizacji",
    isSkippable: false,
    render: (ctx) => <OrganizationNameStepBody ctx={ctx} />,
  },
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
