import { initials } from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

export function ProfilView() {
  const { profile, localLocation, localBio, profileSaved, setLocalLocation, setLocalBio, saveProfile } =
    usePanelData();

  if (!profile) return null;

  return (
    <div className="rounded-[22px] border border-line bg-paper p-5">
      <h3 className="mb-3.5 text-base font-semibold text-ink">Dane profilowe</h3>
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full border-[3px] border-mint-soft bg-mint-soft font-serif text-xl font-semibold text-mint">
          {initials(profile.display_name)}
        </div>
        <p className="text-xs text-ink-soft">
          Zdjęcie profilowe pojawi się tutaj, gdy będzie dostępne — dziś pokazujemy inicjały.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-extrabold tracking-wide text-ink-soft">Imię i nazwisko</label>
          <input
            value={profile.display_name}
            disabled
            className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink disabled:opacity-70"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="panel-location" className="text-xs font-extrabold tracking-wide text-ink-soft">
            Lokalizacja
          </label>
          <input
            id="panel-location"
            value={localLocation}
            onChange={(e) => setLocalLocation(e.target.value)}
            placeholder="Miasto, dzielnica"
            className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink focus:border-mint focus:outline-none focus:ring-[3px] focus:ring-mint-soft"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="panel-bio" className="text-xs font-extrabold tracking-wide text-ink-soft">
            O mnie
          </label>
          <textarea
            id="panel-bio"
            value={localBio}
            onChange={(e) => setLocalBio(e.target.value)}
            placeholder="Kilka zdań o Tobie"
            className="min-h-[76px] resize-y rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink focus:border-mint focus:outline-none focus:ring-[3px] focus:ring-mint-soft"
          />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2.5">
        {profileSaved && <span className="text-center text-[13px] font-bold text-mint">✓ Zapisano</span>}
        <button
          onClick={saveProfile}
          className="w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(27,129,104,0.85)] transition-transform hover:-translate-y-0.5"
        >
          Zapisz zmiany
        </button>
      </div>
    </div>
  );
}
