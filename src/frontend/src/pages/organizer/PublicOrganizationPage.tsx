import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { useOrganizerPage } from "../../hooks/useOrganizerPage";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { useUpdateOrganization } from "../../hooks/useUpdateOrganization";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { SettingsIcon } from "../panel/panelIcons";
import { diffDraft, sameDraft, toDraft, type Draft } from "./editor/draft";
import { EditorSheet } from "./editor/EditorSheet";
import { LayoutRenderer } from "./LayoutRenderer";
import { resolveLayout } from "./layouts/registry";
import type { DirectoryStatus, OrganizerPageData } from "./layouts/types";
import { NotFoundFrame, PageFrame } from "./PageFrame";

/**
 * Public organizer page at `domena.pl/<slug>` — this is the mounted-last
 * catch-all route in `router.tsx` (after every fixed route), which is exactly
 * why `slugs.RESERVED_SLUGS` on the backend must never hand out a slug
 * matching one of those fixed paths: this route would otherwise permanently
 * shadow it. The owner sees the same page plus ghosts and a settings button
 * ("Edytuj wygląd") at the top; `?edit=1` only means something once the owner
 * check has passed, and then opens the editor sheet, which closes on save. The page owns the editor's draft: it is
 * previewed live here and diffed against the owner's stored organization
 * (the baseline, which refreshes on every refetch) when saved.
 */
export function PublicOrganizationPage() {
  const { organizationSlug = "" } = useParams<{ organizationSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: organization, loading } = usePublicOrganization(organizationSlug);
  // Fetched in parallel; the directory never holds back the first paint.
  const directory = useOrganizerPage(organizationSlug);
  const directoryStatus: DirectoryStatus = directory.loading
    ? "loading"
    : directory.notFound || directory.error !== null
      ? "unavailable"
      : "ready";
  const myOrganization = useMyOrganization();
  const { update } = useUpdateOrganization();
  // `null` = nothing edited since the sheet opened, was reset or saved.
  const [draft, setDraft] = useState<Draft | null>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);

  const owner = myOrganization.data?.slug === organizationSlug ? myOrganization.data : null;
  const isOwner = owner !== null;
  const sheetOpen = isOwner && searchParams.get("edit") === "1";

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
    if (sheetWasOpen.current && !sheetOpen) settingsRef.current?.focus();
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

  if (!organization) return <NotFoundFrame />;

  const pageData: OrganizerPageData = {
    organization,
    directory: directoryStatus === "ready" ? directory.data : null,
    directoryStatus,
  };

  return (
    <OrganizerThemeScope theme={editing ? editing.current.theme : organization}>
      <title>{organization.name}</title>
      <PageFrame className={editing ? "pb-[60vh]" : ""}>
        {isOwner && (
          <div className="flex justify-end bg-paper px-4 pt-3">
            <button
              ref={settingsRef}
              type="button"
              onClick={() => setSearchParams({ edit: "1" }, { replace: true })}
              aria-label="Edytuj wygląd"
              aria-expanded={sheetOpen}
              title="Edytuj wygląd"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-cream text-ink hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <SettingsIcon c="currentColor" />
            </button>
          </div>
        )}
        <LayoutRenderer
          layout={resolveLayout(editing ? editing.current.pageLayout : organization.page_layout)}
          data={pageData}
          mode={isOwner ? "owner-edit" : "visitor"}
        />
      </PageFrame>
      {editing && (
        <EditorSheet
          pageData={pageData}
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
