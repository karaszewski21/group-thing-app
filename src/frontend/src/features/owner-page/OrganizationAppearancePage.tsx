import { useState, type KeyboardEvent } from "react";
import type { MyOrganizationResponse } from "../../api/organizations";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { useOrganizerPage } from "../../hooks/useOrganizerPage";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { useUpdateOrganization } from "../../hooks/useUpdateOrganization";
import { Link, useAppPathname, useAppSearchParams, useNavigationGuard } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { AboutTab } from "./editor/AboutTab";
import { ColorsTab, SECTION_LABEL } from "./editor/ColorsTab";
import { diffDraft, sameDraft, toDraft, type Draft } from "./editor/draft";
import { LayoutTab } from "./editor/LayoutTab";
import { PhotosTab } from "./editor/PhotosTab";
import { nextIndex } from "./editor/rovingIndex";
import { UnsavedChangesDialog } from "./editor/UnsavedChangesDialog";
import type { DirectoryStatus, OrganizerPageData } from "./layouts/types";

type Tab = "photos" | "layout";

const TABS: { id: Tab; label: string }[] = [
  { id: "photos", label: "Zdjęcia i opis" },
  { id: "layout", label: "Układ i kolor" },
];

const TITLE = "Wygląd strony";
const SAVE_FALLBACK = "Nie udało się zapisać. Spróbuj ponownie.";
const NOTICE = "rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft";

function toTab(value: string | null): Tab {
  return TABS.find((t) => t.id === value)?.id ?? "photos";
}

/** `/organization/appearance` ("Wygląd strony"): the owner's photos,
 * description, page layout and colors, a Konto sub-page. Without an
 * Organization it points to `/organization`, where one is founded. */
export function OrganizationAppearancePage() {
  const myOrganization = useMyOrganization();

  return (
    <section aria-label={TITLE}>
      {myOrganization.loading ? (
        <p className="text-[12.5px] text-ink-soft">Wczytywanie…</p>
      ) : myOrganization.data === null ? (
        <p className={NOTICE}>
          Najpierw załóż organizację.{" "}
          <Link to={viewPath("organization")} className="font-extrabold text-primary-fg underline">
            Moja organizacja →
          </Link>
        </p>
      ) : (
        <AppearanceEditor owner={myOrganization.data} />
      )}
    </section>
  );
}

/** The editor itself: photos save at once; the description, layout and colors
 * form a draft saved together with "Zapisz", diffed against the stored
 * organization (the baseline, which refreshes on every refetch). Leaving
 * for another page with an unsaved draft asks first. The colors preview on
 * the editor through the draft theme. */
function AppearanceEditor({ owner }: { owner: MyOrganizationResponse }) {
  const organization = usePublicOrganization(owner.slug);
  const directory = useOrganizerPage(owner.slug);
  const { update } = useUpdateOrganization();
  const [searchParams, setSearchParams] = useAppSearchParams();
  const tab = toTab(searchParams.get("tab"));
  // `null` = nothing edited since the page opened, was reset or saved.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pathname = useAppPathname();

  const baseline = toDraft(owner);
  const current = draft ?? baseline;
  const dirty = draft !== null && !sameDraft(draft, baseline);
  // Switching tabs only changes the query string and is never blocked.
  const blocker = useNavigationGuard((next) => dirty && next.pathname !== pathname);

  const directoryStatus: DirectoryStatus = directory.loading
    ? "loading"
    : directory.notFound || directory.error !== null
      ? "unavailable"
      : "ready";

  function selectTab(next: Tab) {
    setSearchParams(
      (params) => {
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  }

  function change(next: Draft) {
    setError(null);
    setSaved(false);
    setDraft(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await update(owner.id, diffDraft(current, baseline));
    } catch (err) {
      setError(err instanceof Error ? err.message : SAVE_FALLBACK);
      setSaving(false);
      return;
    }
    // Anything changed after the save started stays as an unsaved draft.
    setDraft((latest) => (latest && sameDraft(latest, current) ? null : latest));
    setSaving(false);
    setSaved(true);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = nextIndex(event.key, TABS.findIndex((t) => t.id === tab), TABS.length, "horizontal");
    if (index === null) return;
    event.preventDefault();
    selectTab(TABS[index].id);
    document.getElementById(`editor-tab-${TABS[index].id}`)?.focus();
  }

  const pageData: OrganizerPageData | null = organization.data
    ? {
        organization: organization.data,
        directory: directoryStatus === "ready" ? directory.data : null,
        directoryStatus,
      }
    : null;

  return (
    <OrganizerThemeScope theme={current.theme}>
      <div role="tablist" aria-label="Ustawienia strony" className="mb-3 flex gap-1.5">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`editor-tab-${t.id}`}
              aria-selected={on}
              aria-controls={on ? `editor-panel-${t.id}` : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => selectTab(t.id)}
              onKeyDown={handleTabKeyDown}
              className={`min-h-[44px] rounded-full border-[1.5px] px-4 py-2 text-[12px] font-extrabold transition-colors ${
                on ? "border-transparent bg-ink text-on-ink" : "border-line text-ink-soft hover:border-line-strong"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`editor-panel-${tab}`}
        aria-labelledby={`editor-tab-${tab}`}
        aria-busy={saving}
        className="rounded-[22px] border border-line bg-paper p-5"
      >
        {/* Photos save on their own, so the draft lock and dirty state never touch them. */}
        {tab === "photos" && <PhotosTab organizationId={owner.id} />}
        {/* Locked while saving, so nothing is edited on top of the draft being sent. */}
        <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
          {tab === "photos" && (
            <div className="mt-5 border-t border-line pt-4">
              <AboutTab value={current.description} onChange={(description) => change({ ...current, description })} />
            </div>
          )}
          {tab === "layout" && (
            <>
              <p className={`${SECTION_LABEL} mb-2`}>Układ strony</p>
              {pageData ? (
                <LayoutTab
                  value={current.pageLayout}
                  data={pageData}
                  onSelect={(pageLayout) => change({ ...current, pageLayout })}
                />
              ) : (
                <p className="text-[12.5px] text-ink-soft">Wczytywanie układów…</p>
              )}
              <div className="mt-5 border-t border-line pt-4">
                <ColorsTab theme={current.theme} onChange={(theme) => change({ ...current, theme })} />
              </div>
            </>
          )}
        </fieldset>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-[13px] font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {error}
        </div>
      )}
      {saved && !dirty && (
        <p role="status" className="mt-3 rounded-2xl bg-primary-soft px-4 py-3 text-[13px] font-bold text-primary-fg">
          Zapisano
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2.5">
        <Link to={`/${owner.slug}`} className="text-[13px] font-extrabold text-primary-fg underline">
          Zobacz stronę →
        </Link>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => change(baseline)}
            disabled={!dirty || saving}
            className="min-h-[44px] rounded-full border-[1.5px] border-line bg-cream px-5 py-2.5 text-sm font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="min-h-[44px] rounded-full bg-primary px-5 py-2.5 text-sm font-extrabold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Zapisywanie…" : "Zapisz"}
          </button>
        </div>
      </div>

      {blocker.state === "blocked" && (
        <UnsavedChangesDialog onDiscard={() => blocker.proceed()} onKeepEditing={() => blocker.reset()} />
      )}
    </OrganizerThemeScope>
  );
}
