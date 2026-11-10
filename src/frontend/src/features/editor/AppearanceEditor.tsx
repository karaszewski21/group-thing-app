"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { nextIndex } from "../../components/shared/rovingIndex";
import { Link, useAppPathname, useAppSearchParams, useNavigationGuard } from "../../routing/navigation";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { AboutTab } from "./AboutTab";
import { ColorsTab, SECTION_LABEL } from "./ColorsTab";
import { diffDraft, sameDraft, type Draft, type DraftChanges } from "./draft";
import { LayoutTab, type LayoutOption } from "./LayoutTab";
import { NameTab } from "./NameTab";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

type Tab = "photos" | "layout" | "name";

const TABS: { id: Tab; label: string }[] = [
  { id: "photos", label: "Zdjęcia i opis" },
  { id: "layout", label: "Układ i kolor" },
  { id: "name", label: "Nazwa" },
];

const SAVE_FALLBACK = "Nie udało się zapisać. Spróbuj ponownie.";

function toTab(value: string | null): Tab {
  return TABS.find((t) => t.id === value)?.id ?? "photos";
}

interface AppearanceEditorProps {
  /** The stored page; it refreshes on every refetch. */
  baseline: Draft;
  /** Sends the changed fields (`draft` is the whole edited page); rejects
   * with a Polish message. */
  save: (changes: DraftChanges, draft: Draft) => Promise<void>;
  /** The photos section; it saves on its own, outside the draft. */
  photos: ReactNode;
  about: { label: string; placeholder: string };
  name: { label: string; hint: string };
  /** `null` while the data the cards need is loading. */
  layouts: LayoutOption[] | null;
  /** Why some layouts are locked (with a way to unlock them). */
  lockedNote?: ReactNode;
  /** The public page the editor changes. */
  viewHref: string;
}

/** "Wygląd strony" of an Organization or a person's profile: photos save at
 * once; the name, description, layout and colors form a draft saved together
 * with "Zapisz", diffed against `baseline`. Leaving for another page with an
 * unsaved draft asks first. The colors preview on the editor through the
 * draft theme. */
export function AppearanceEditor({
  baseline,
  save,
  photos,
  about,
  name,
  layouts,
  lockedNote,
  viewHref,
}: AppearanceEditorProps) {
  const [searchParams, setSearchParams] = useAppSearchParams();
  const tab = toTab(searchParams.get("tab"));
  // `null` = nothing edited since the page opened, was reset or saved.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pathname = useAppPathname();

  const current = draft ?? baseline;
  const dirty = draft !== null && !sameDraft(draft, baseline);
  const invalid = current.name.trim() === "";
  // Switching tabs only changes the query string and is never blocked.
  const blocker = useNavigationGuard((next) => dirty && next.pathname !== pathname);

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

  async function submit() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await save(diffDraft(current, baseline), current);
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

  return (
    <OrganizerThemeScope theme={current.theme}>
      <div role="tablist" aria-label="Ustawienia strony" className="mb-3 flex flex-wrap gap-1.5">
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
        {tab === "photos" && photos}
        {/* Locked while saving, so nothing is edited on top of the draft being sent. */}
        <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
          {tab === "photos" && (
            <div className="mt-5 border-t border-line pt-4">
              <AboutTab
                label={about.label}
                placeholder={about.placeholder}
                value={current.about}
                onChange={(next) => change({ ...current, about: next })}
              />
            </div>
          )}
          {tab === "layout" && (
            <>
              <p className={`${SECTION_LABEL} mb-2`}>Układ strony</p>
              {layouts ? (
                <LayoutTab
                  value={current.pageLayout}
                  options={layouts}
                  lockedNote={lockedNote}
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
          {tab === "name" && (
            <NameTab
              label={name.label}
              hint={name.hint}
              value={current.name}
              onChange={(next) => change({ ...current, name: next })}
            />
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
        <Link to={viewHref} className="text-[13px] font-extrabold text-primary-fg underline">
          Zobacz stronę →
        </Link>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setDraft(null);
            }}
            disabled={!dirty || saving}
            className="min-h-[44px] rounded-full border-[1.5px] border-line bg-cream px-5 py-2.5 text-sm font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!dirty || saving || invalid}
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
