import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createMyOrganization,
  getMyOrganization,
  updateOrganization,
  type OrganizationResponse,
} from "../api/organizations";

const inputClass =
  "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-mint focus:ring-[3px] focus:ring-mint-soft";
const labelClass = "mb-1.5 block text-xs font-extrabold tracking-wide text-ink-soft";

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.5 5 8 12l6.5 7" stroke="#1E2E27" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Self-service brand identity profile — simplified to just the name (per
 * user feedback: the color-customization step was removed from this form).
 * `createMyOrganization`/`updateOrganization` still accept color fields on
 * the backend; this page simply never sends them.
 */
export function OrganizationPage() {
  const [organization, setOrganization] = useState<OrganizationResponse | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const org = await getMyOrganization();
      setOrganization(org);
      setName(org.name);
    } catch {
      // No organization yet (404) — the form starts empty; saving will
      // create one. Onboarding makes this step mandatory for new
      // ORGANIZER accounts, so this path mainly covers accounts that
      // registered before this feature shipped.
      setOrganization(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      if (organization) {
        const updated = await updateOrganization(organization.id, { name });
        setOrganization(updated);
      } else {
        const created = await createMyOrganization({ name });
        setOrganization(created);
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zapisać organizacji");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream text-ink-soft">
        Wczytywanie…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10 font-sans text-ink">
      <div className="w-full max-w-[440px] rounded-[22px] border border-line bg-paper p-10">
        <Link to="/panel" className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft">
          <BackIcon /> Wróć
        </Link>

        <h1 className="mb-2 text-center font-serif text-2xl font-semibold text-ink">
          Moja <span className="text-mint">organizacja</span>
        </h1>
        <p className="mb-8 text-center text-sm text-ink-soft">
          Nazwa widoczna na Twojej publicznej stronie.
        </p>

        <form onSubmit={handleSave}>
          <div className="mb-4">
            <label htmlFor="org-name" className={labelClass}>
              Nazwa organizacji
            </label>
            <input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Muzyczne Skrzaty"
              className={inputClass}
            />
          </div>

          {organization && (
            <div className="mb-6 rounded-xl border border-line bg-cream p-4">
              <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-ink-soft">
                Twoja publiczna strona
              </p>
              <Link
                to={`/${organization.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-bold text-mint hover:underline"
              >
                {window.location.origin}/{organization.slug}
              </Link>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {error}
            </div>
          )}
          {saved && !error && (
            <div className="mb-4 rounded-xl bg-mint-soft px-3 py-2.5 text-[13px] font-semibold text-mint">
              Zapisano.
            </div>
          )}

          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="w-full rounded-[13px] bg-mint px-4 py-3 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(27,129,104,0.85)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {saving ? "Zapisywanie…" : "Zapisz"}
          </button>
        </form>
      </div>
    </div>
  );
}
