"use client";

import { useState, type FormEvent } from "react";
import { useCreateMyOrganization } from "../../hooks/useCreateMyOrganization";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { Navigate, useAppNavigate } from "../../routing/navigation";
import { usePanelReload } from "../panel/appDataStore";

const INPUT =
  "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-soft";
const LABEL = "mb-1.5 block text-xs font-extrabold tracking-wide text-ink-soft";

/** `/organization` (a panel view under Konto): founds the caller's
 * Organization. Its page starts with a copy of the profile's photos and
 * unlocks every layout. Once founded, the name is edited in the page's
 * "Wygląd strony", so an owner is sent there. */
export function OrganizationFoundPage() {
  const myOrganization = useMyOrganization();
  const { create } = useCreateMyOrganization();
  const reloadPanel = usePanelReload();
  const navigate = useAppNavigate();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (myOrganization.loading) return <p className="text-[12.5px] text-ink-soft">Wczytywanie…</p>;
  if (myOrganization.data && !saving) {
    return <Navigate to={`/${myOrganization.data.slug}/appearance?tab=name`} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const organization = await create(name);
      reloadPanel();
      navigate(`/${organization.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  const blank = name.trim() === "";
  return (
    <div className="rounded-[22px] border border-line bg-paper p-5">
      <h1 className="mb-2 font-serif text-2xl font-semibold text-ink">
        Załóż <span className="text-primary-fg">organizację</span>
      </h1>
      <p className="mb-6 text-sm text-ink-soft">
        Własna strona z nazwą, wszystkimi układami i kolorami. Zdjęcia z Twojego profilu przeniesiemy na nią.
      </p>

      <form onSubmit={(event) => void handleSubmit(event)}>
        <div className="mb-4">
          <label htmlFor="org-name" className={LABEL}>
            Nazwa organizacji
          </label>
          <input
            id="org-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="np. Muzyczne Skrzaty"
            maxLength={255}
            className={INPUT}
          />
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={blank || saving}
          className="min-h-11 w-full rounded-full bg-primary px-4 py-3 text-[13.5px] font-extrabold text-on-primary disabled:opacity-60"
        >
          {saving ? "Zakładanie…" : "Załóż organizację"}
        </button>
      </form>
    </div>
  );
}
