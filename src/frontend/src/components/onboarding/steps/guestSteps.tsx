import { useEffect, useState } from "react";
import type { Step, StepContext } from "../OnboardingWizard";
import { resolveProduct } from "../../../api/products";
import { createInventory, getInventories, registerInventoryItem } from "../../../api/inventories";
import { getMyProfile } from "../../../api/people";
import { ItemQuickAddForm } from "../../shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue, type ItemQuickAddValue } from "../../../utils/itemQuickAdd";

/* ------------------------------------------------------------------ */
/*  Rzeczy, które masz: reworked 3-field ItemQuickAddForm, resolved     */
/*  via resolveProduct() then registerInventoryItem() on submit — same  */
/*  pattern as PanelPage's "+ Dodaj rzecz" call site (spec.md Core      */
/*  Requirement 10), inline in the step body (no ModalSheet chrome).    */
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
    id: "items",
    title: "Co chcesz oddać, wymienić lub wypożyczyć?",
    isSkippable: true,
    render: (ctx) => <ItemsStepBody ctx={ctx} />,
  },
];
