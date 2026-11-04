"use client";

import type { ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { CARD } from "../../components/shared/uiStyles";
import { useItemActions } from "../../hooks/useItemActions";
import { useItemDetail } from "../../hooks/useItemDetail";
import { useOpenAndNavigate } from "../../hooks/useOpenAndNavigate";
import { Navigate, notFound, useAppSearch } from "../../routing/navigation";
import { AuthPromptButtons } from "../auth/AuthSheet";
import { resolveItemActionsView } from "./itemActionsViewState";
import { ItemBackButton } from "./ItemBackButton";
import { ItemLoadError, ItemPageContext, type ItemPageValue } from "./ItemPageContext";
import { ItemPageSkeleton } from "./ItemPageSkeleton";
import { resolveItemPageView } from "./itemPageViewState";

/** `/:slug/product/:id`: reads the item and its actions and gives the
 * blocks passed as `children` (composed in the route's `page.tsx`) their
 * data through `ItemPageContext`. Public for listed items; the owner edits
 * in the panel (`/items/:id/edit`). */
export function ItemPage({ slug, id, children }: { slug: string; id: string; children: ReactNode }) {
  const search = useAppSearch();
  const isLoggedIn = useAuth().token !== null;
  const details = useItemDetail(id);
  const actions = useItemActions(id);
  const chat = useOpenAndNavigate();
  const owner = actions.data?.owner;
  const view = resolveItemPageView({
    slug,
    id,
    search,
    ownerSlug: owner ? (owner.slug ?? owner.party_id) : null,
    item: details.item,
    notFound: details.notFound,
    error: details.error,
    isLoggedIn,
  });
  switch (view.kind) {
    case "redirect":
      return <Navigate to={view.to} replace />;
    case "content": {
      const actionsView = resolveItemActionsView({
        item: { deleted: view.item.deleted_at !== null, isOwner: view.item.is_owner },
        detailsLoading: false,
        actions: actions.data,
        actionsLoading: actions.loading,
        actionsFetching: actions.fetching,
        actionsError: actions.error,
        isLoggedIn,
      });
      const value: ItemPageValue = {
        item: view.item,
        actions,
        view: actionsView,
        isLoggedIn,
        statusAsPill:
          (actionsView.kind === "choose" || actionsView.kind === "anonymous") && view.item.status.code === "AVAILABLE",
        chat,
      };
      return (
        <ItemPageContext.Provider value={value}>
          <div className="flex-1 overflow-y-auto pb-6">{children}</div>
        </ItemPageContext.Provider>
      );
    }
    case "loginRequired":
      return <ItemLoginRequired />;
    case "notFound":
      return notFound();
    case "error":
      throw new ItemLoadError(view.message);
    case "loading":
      return <ItemPageSkeleton />;
  }
}

function ItemLoginRequired() {
  return (
    <div className="flex-1 overflow-y-auto px-4.5 pt-4.5 pb-6">
      <ItemBackButton />
      <section className={`mt-3 ${CARD}`}>
        <h2 className="text-[15px] font-extrabold text-ink">Zaloguj się, żeby zobaczyć tę rzecz</h2>
        <p className="mt-1 text-[13px] text-ink-soft">Ta rzecz nie jest publiczna albo już jej nie ma.</p>
        <AuthPromptButtons sheetMessage="Niektóre rzeczy widzą tylko zalogowani. Zaloguj się albo załóż konto — zostaniesz na tej stronie." />
      </section>
    </div>
  );
}

/** The rounded sheet under the gallery, overlapping its bottom edge. */
export function ItemSheet({ children }: { children: ReactNode }) {
  return <div className="relative -mt-6 rounded-t-[28px] bg-cream px-5 pt-6">{children}</div>;
}
