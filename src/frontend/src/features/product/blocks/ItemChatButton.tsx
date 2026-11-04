"use client";

import { BTN_GHOST, BTN_LG } from "../../../../components/shared/uiStyles";
import { AuthSheet } from "../../../auth/AuthSheet";
import { useAccountGate } from "../../../auth/useAccountGate";
import { useItemPage } from "../ItemPageContext";
import { ITEM_ACCOUNT_MESSAGE } from "../itemPageShared";

/** "💬 Napisz o przedmiocie" for anyone but the owner; an anonymous visitor
 * gets the login sheet first. */
export function ItemChatButton() {
  const { item, view, isLoggedIn, chat } = useItemPage();
  const accountGate = useAccountGate(isLoggedIn);
  if (view.kind === "loading" || view.kind === "hidden" || view.kind === "error" || view.kind === "own") return null;
  return (
    <>
      <button
        type="button"
        disabled={chat.busy}
        onClick={accountGate.guard(() => chat.open({ kind: "ITEM", id: item.id }))}
        className={`${BTN_GHOST} ${BTN_LG} mt-2.5 block w-full text-center text-ink no-underline`}
      >
        💬 Napisz o przedmiocie
      </button>
      {chat.error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {chat.error}
        </p>
      )}
      {accountGate.isOpen && <AuthSheet message={ITEM_ACCOUNT_MESSAGE} onClose={accountGate.close} />}
    </>
  );
}
