import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { useUpdateOrganization } from "../../hooks/useUpdateOrganization";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { PencilIcon } from "../panel/panelIcons";
import { diffDraft, sameDraft, toDraft, type Draft } from "./editor/draft";
import { EditorSheet } from "./editor/EditorSheet";
import { LayoutRenderer } from "./LayoutRenderer";
import { resolveLayout } from "./layouts/registry";

// Height of the sticky account bar that `components/layout/PublicLayout.tsx`
// shows to logged-in visitors: border-t (1px) + py-2 (16px) + h-10 controls
// (40px). Update together with that bar's classes.
const LOGGED_IN_MIN_HEIGHT = "min-h-[calc(100dvh-57px)]";
const ANONYMOUS_MIN_HEIGHT = "min-h-dvh";

function PageFrame({ className = "", children }: { className?: string; children: ReactNode }) {
  const { token } = useAuth();
  const minHeight = token ? LOGGED_IN_MIN_HEIGHT : ANONYMOUS_MIN_HEIGHT;
  return <div className={`flex flex-col bg-cream ${minHeight} ${className}`}>{children}</div>;
}

/**
 * Public organizer page at `domena.pl/<slug>` — this is the mounted-last
 * catch-all route in `router.tsx` (after every fixed route), which is exactly
 * why `slugs.RESERVED_SLUGS` on the backend must never hand out a slug
 * matching one of those fixed paths: this route would otherwise permanently
 * shadow it. The owner sees the same page plus ghosts and the "Edytuj wygląd"
 * pill; `?edit=1` only means something once the owner check has passed, and
 * then opens the editor sheet. The page owns the editor's draft: it is
 * previewed live here and diffed against the owner's stored organization
 * (the baseline, which refreshes on every refetch) when saved.
 */
export function PublicOrganizationPage() {
  const { organizationSlug = "" } = useParams<{ organizationSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: organization, loading } = usePublicOrganization(organizationSlug);
  const myOrganization = useMyOrganization();
  const { update } = useUpdateOrganization();
  // `null` = nothing edited since the sheet opened, was reset or saved.
  const [draft, setDraft] = useState<Draft | null>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  const owner = myOrganization.data?.slug === organizationSlug ? myOrganization.data : null;
  const isOwner = owner !== null;
  const sheetOpen = isOwner && searchParams.get("edit") === "1";
  const pillVisible = isOwner && !sheetOpen;

  // A draft belongs to one opening of the sheet on one page: however the sheet
  // closes (X, browser Back, another slug in the same route), it is dropped.
  const editSession = sheetOpen ? organizationSlug : null;
  const [draftSession, setDraftSession] = useState(editSession);
  if (editSession !== draftSession) {
    setDraftSession(editSession);
    setDraft(null);
  }

  const sheetWasOpen = useRef(sheetOpen);
  useEffect(() => {
    if (sheetWasOpen.current && !sheetOpen) pillRef.current?.focus();
    sheetWasOpen.current = sheetOpen;
  }, [sheetOpen]);
  const baseline = sheetOpen && owner ? toDraft(owner) : null;
  const editing = owner && baseline ? { id: owner.id, baseline, current: draft ?? baseline } : null;
  const dirty = editing !== null && draft !== null && !sameDraft(draft, editing.baseline);

  async function save(id: string, current: Draft, base: Draft) {
    await update(id, diffDraft(current, base));
    // Anything changed after the save started stays as an unsaved draft.
    setDraft((latest) => (latest && sameDraft(latest, current) ? null : latest));
  }

  function closeEditor() {
    setSearchParams(
      (params) => {
        params.delete("edit");
        return params;
      },
      { replace: true },
    );
  }

  if (loading) {
    return (
      <PageFrame className="items-center justify-center text-ink-soft">Wczytywanie…</PageFrame>
    );
  }

  if (!organization) {
    return (
      <PageFrame className="items-center justify-center px-4 text-center font-sans text-ink">
        <div>
          <h1 className="mb-2 font-serif text-2xl font-semibold">Nie znaleziono strony</h1>
          <p className="text-sm text-ink-soft">Ta organizacja nie istnieje.</p>
        </div>
      </PageFrame>
    );
  }

  return (
    <OrganizerThemeScope theme={editing ? editing.current.theme : organization}>
      <PageFrame className={editing ? "pb-[60vh]" : pillVisible ? "pb-24" : ""}>
        <LayoutRenderer
          layout={resolveLayout(editing ? editing.current.pageLayout : organization.page_layout)}
          data={{ organization }}
          mode={isOwner ? "owner-edit" : "visitor"}
        />
      </PageFrame>
      {pillVisible && (
        <button
          ref={pillRef}
          type="button"
          onClick={() => setSearchParams({ edit: "1" }, { replace: true })}
          className="fixed bottom-6 left-1/2 z-[50] inline-flex min-h-[44px] -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-5 py-3 font-sans text-sm font-extrabold text-on-ink"
        >
          <PencilIcon c="currentColor" />
          Edytuj wygląd
        </button>
      )}
      {editing && (
        <EditorSheet
          draft={editing.current}
          dirty={dirty}
          onChange={setDraft}
          onReset={() => setDraft(null)}
          onSave={() => save(editing.id, editing.current, editing.baseline)}
          onClose={closeEditor}
        />
      )}
    </OrganizerThemeScope>
  );
}
