import { useEffect, useState } from "react";
import type { Step, StepContext } from "../OnboardingWizard";
import { createLightweightMembers } from "../../../api/families";
import { resolveProduct } from "../../../api/products";
import { createInventory, getInventories, registerInventoryItem } from "../../../api/inventories";
import { getMyProfile } from "../../../api/people";
import { ItemQuickAddForm } from "../../shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue, type ItemQuickAddValue } from "../../../utils/itemQuickAdd";

const inputClass =
  "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-mint focus:ring-[3px] focus:ring-mint-soft";
const labelClass = "mb-1.5 block text-xs font-extrabold tracking-wide text-ink-soft";

/* ------------------------------------------------------------------ */
/*  Step 1/3 — Nazwa rodziny: frontend-only draft, never sent to the    */
/*  backend (spec's "Draft family name" note) — discarded on skip or    */
/*  wizard abandonment since nothing ever persists it.                  */
/* ------------------------------------------------------------------ */

function FamilyNameStepBody({ ctx }: { ctx: StepContext }) {
  const [name, setName] = useState("");

  useEffect(() => {
    ctx.setSubmit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <label htmlFor="onboarding-family-name" className={labelClass}>
        Nazwa rodziny
      </label>
      <input
        id="onboarding-family-name"
        className={inputClass}
        placeholder="np. Rodzina Kowalskich"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2/3 — Członkowie rodziny: accumulating draft list, submitted   */
/*  as one batch to POST /api/families/mine/members on advance          */
/*  (mirrors PanelPage's neededDraft/addDraftNeededItem pattern).       */
/* ------------------------------------------------------------------ */

type FamilyRoleType = "GUARDIAN" | "CHILD";

interface MemberDraft {
  name: string;
  roleType: FamilyRoleType;
}

function FamilyMembersStepBody({ ctx }: { ctx: StepContext }) {
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [name, setName] = useState("");
  const [roleType, setRoleType] = useState<FamilyRoleType>("GUARDIAN");

  useEffect(() => {
    ctx.setSubmit(async () => {
      if (members.length === 0) return;
      await createLightweightMembers(members.map((m) => ({ name: m.name, role_type: m.roleType })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  function addDraftMember() {
    if (!name.trim()) return;
    setMembers((prev) => [...prev, { name: name.trim(), roleType }]);
    setName("");
  }

  function removeDraftMember(index: number) {
    setMembers((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-4">
      {members.length > 0 && (
        <div>
          <span className={labelClass}>Dodani członkowie</span>
          <div className="overflow-hidden rounded-xl border border-line">
            {members.map((m, index) => (
              <div
                key={`${m.name}-${index}`}
                className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-sm last:border-b-0"
              >
                <span>
                  {m.name} ({m.roleType === "GUARDIAN" ? "opiekun" : "dziecko"})
                </span>
                <button
                  type="button"
                  onClick={() => removeDraftMember(index)}
                  aria-label={`Usuń ${m.name}`}
                  className="text-xs font-bold text-danger"
                >
                  Usuń
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="onboarding-member-name" className={labelClass}>
          Imię
        </label>
        <input
          id="onboarding-member-name"
          className={inputClass}
          placeholder="np. Zosia"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <span className={labelClass}>Rola</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRoleType("GUARDIAN")}
            className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
              roleType === "GUARDIAN" ? "border-mint bg-mint-soft text-mint" : "border-line bg-cream text-ink-soft"
            }`}
          >
            Opiekun
          </button>
          <button
            type="button"
            onClick={() => setRoleType("CHILD")}
            className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
              roleType === "CHILD" ? "border-mint bg-mint-soft text-mint" : "border-line bg-cream text-ink-soft"
            }`}
          >
            Dziecko
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={addDraftMember}
        disabled={!name.trim()}
        className="rounded-xl border border-line bg-cream px-3 py-2.5 text-sm font-bold text-ink-soft disabled:opacity-60"
      >
        + Dodaj kolejną osobę
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3/3 — Rzeczy, które masz: reworked 3-field ItemQuickAddForm,   */
/*  resolved via resolveProduct() then registerInventoryItem() on       */
/*  submit — same pattern as PanelPage's "+ Dodaj rzecz" call site      */
/*  (spec.md Core Requirement 10), inline in the step body (no          */
/*  ModalSheet chrome here).                                            */
/* ------------------------------------------------------------------ */

function ItemsStepBody({ ctx }: { ctx: StepContext }) {
  const [value, setValue] = useState<ItemQuickAddValue>(createEmptyItemQuickAddValue());

  useEffect(() => {
    ctx.setSubmit(async () => {
      if (!value.name.trim()) return;
      const profile = await getMyProfile();
      if (profile.account_user_id == null) return;
      const inventories = await getInventories(profile.account_user_id);
      let inventory = inventories.find((i) => i.inventory_type === "PERSONAL") ?? null;
      if (!inventory) inventory = await createInventory({ inventory_type: "PERSONAL" });
      const product = await resolveProduct({ name: value.name.trim(), category: value.category });
      await registerInventoryItem({
        inventory_id: inventory.id,
        product_id: product.id,
        condition: value.condition,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <ItemQuickAddForm value={value} onChange={setValue} />;
}

export const guestSteps: Step[] = [
  {
    id: "family-name",
    title: "Nazwa rodziny",
    isSkippable: true,
    render: (ctx) => <FamilyNameStepBody ctx={ctx} />,
  },
  {
    id: "family-members",
    title: "Członkowie rodziny",
    isSkippable: true,
    render: (ctx) => <FamilyMembersStepBody ctx={ctx} />,
  },
  {
    id: "items",
    title: "Co chcesz oddać, wymienić lub wypożyczyć?",
    isSkippable: true,
    render: (ctx) => <ItemsStepBody ctx={ctx} />,
  },
];
