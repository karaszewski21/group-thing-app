import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useBlocker } from "react-router-dom";
import { CloseIcon } from "../../panel/panelIcons";
import type { OrganizerPageData } from "../layouts/types";
import { ColorsTab } from "./ColorsTab";
import type { Draft } from "./draft";
import { LayoutTab } from "./LayoutTab";
import { nextIndex } from "./rovingIndex";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

type Tab = "uklad" | "kolory";

const TABS: { id: Tab; label: string }[] = [
  { id: "uklad", label: "Układ" },
  { id: "kolory", label: "Kolory" },
];

const SAVE_FALLBACK = "Nie udało się zapisać. Spróbuj ponownie.";

interface EditorSheetProps {
  /** The live page's data; drives the layout cards' "Polecany" badges. */
  pageData: OrganizerPageData;
  draft: Draft;
  dirty: boolean;
  onChange: (next: Draft) => void;
  onReset: () => void;
  /** Rejects with an Error whose message is the Polish copy to show. */
  onSave: () => Promise<void>;
  onClose: () => void;
}

/** The owner's appearance editor, docked at the bottom of their public page.
 * Non-modal: no scrim, no focus trap, Esc does nothing, and the page above
 * stays usable and shows the draft live. Only closing explicitly (X) or
 * leaving for another page asks before an unsaved draft is dropped. */
export function EditorSheet({ pageData, draft, dirty, onChange, onReset, onSave, onClose }: EditorSheetProps) {
  const [tab, setTab] = useState<Tab>("uklad");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [customInvalid, setCustomInvalid] = useState(false);
  // Bumped by Anuluj to remount the colors tab, which drops hex text that
  // never reached the draft.
  const [resetCount, setResetCount] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ uklad: null, kolory: null });
  // Changing only the query string (closing the sheet) is never blocked.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const blocked = blocker.state === "blocked";

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function change(next: Draft) {
    setError(null);
    setSaved(false);
    onChange(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : SAVE_FALLBACK);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setError(null);
    setSaved(false);
    setResetCount((count) => count + 1);
    onReset();
  }

  function requestClose() {
    if (dirty) setConfirmOpen(true);
    else onClose();
  }

  function discard() {
    if (blocked) blocker.proceed();
    else onClose();
  }

  function keepEditing() {
    if (blocked) blocker.reset();
    else setConfirmOpen(false);
    closeRef.current?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = nextIndex(event.key, TABS.findIndex((t) => t.id === tab), TABS.length, "horizontal");
    if (index === null) return;
    event.preventDefault();
    const next = TABS[index].id;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="editor-title"
        aria-busy={saving}
        className="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-[430px] rounded-t-[24px] bg-paper p-5 font-sans shadow-[0_-16px_34px_-16px_var(--color-scrim)] min-[520px]:bottom-4 min-[520px]:rounded-[24px]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="editor-title" ref={titleRef} tabIndex={-1} className="font-serif text-lg font-semibold text-ink outline-none">
            Wygląd strony
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={requestClose}
            aria-label="Zamknij"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-cream text-ink-soft hover:bg-danger-soft hover:text-danger"
          >
            <CloseIcon />
          </button>
        </div>

        <div role="tablist" aria-label="Wygląd strony" className="mb-3 flex gap-1.5">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                ref={(element) => {
                  tabRefs.current[t.id] = element;
                }}
                type="button"
                role="tab"
                id={`editor-tab-${t.id}`}
                aria-selected={on}
                aria-controls={on ? `editor-panel-${t.id}` : undefined}
                tabIndex={on ? 0 : -1}
                onClick={() => setTab(t.id)}
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
          className="max-h-[55vh] overflow-y-auto"
        >
          {/* Locked while saving, so nothing is edited on top of the draft being sent. */}
          <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
            {tab === "uklad" && (
              <LayoutTab
                value={draft.pageLayout}
                data={pageData}
                onSelect={(pageLayout) => change({ ...draft, pageLayout })}
              />
            )}
            {tab === "kolory" && (
              <ColorsTab
                key={resetCount}
                theme={draft.theme}
                onChange={(theme) => change({ ...draft, theme })}
                onCustomInvalidChange={setCustomInvalid}
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

        <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-4">
          <span role="status" className="mr-auto text-sm font-bold text-primary-fg">
            {saved ? "✓ Zapisano" : ""}
          </span>
          <button
            type="button"
            onClick={reset}
            disabled={!(dirty || customInvalid) || saving}
            className="min-h-[44px] rounded-full border-[1.5px] border-line bg-cream px-5 py-2.5 text-sm font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || customInvalid}
            className="min-h-[44px] rounded-full bg-primary px-5 py-2.5 text-sm font-extrabold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Zapisywanie…" : "Zapisz"}
          </button>
        </div>
      </section>

      {(confirmOpen || blocked) && <UnsavedChangesDialog onDiscard={discard} onKeepEditing={keepEditing} />}
    </>
  );
}
