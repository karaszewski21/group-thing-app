import { useRef } from "react";
import { initials } from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

const AVATAR_STATUS_NOTE: Record<string, string> = {
  PENDING: "Zdjęcie czeka na moderację — do tego czasu widzisz je tylko Ty.",
  NEEDS_REVIEW: "Zdjęcie czeka na sprawdzenie przez moderatora.",
  REJECTED: "Zdjęcie zostało odrzucone przez moderację. Wgraj inne.",
};

const INPUT_CLASS =
  "rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink focus:border-mint focus:outline-none focus:ring-[3px] focus:ring-mint-soft";

export function ProfilView() {
  const {
    profile,
    profileName,
    profileBio,
    profileSaved,
    profileError,
    avatarBusy,
    avatarError,
    setProfileName,
    setProfileBio,
    saveProfile,
    changeAvatar,
    removeAvatar,
  } = usePanelData();
  const fileInput = useRef<HTMLInputElement>(null);

  if (!profile) return null;

  const avatar = profile.avatar;
  const statusNote = avatar ? AVATAR_STATUS_NOTE[avatar.status] : undefined;

  return (
    <div className="rounded-[22px] border border-line bg-paper p-5">
      <h3 className="mb-3.5 text-base font-semibold text-ink">Dane profilowe</h3>
      <div className="mb-5 flex items-center gap-4">
        {avatar ? (
          <img
            src={avatar.url}
            alt="Twoje zdjęcie profilowe"
            className="h-[72px] w-[72px] flex-none rounded-full border-[3px] border-mint-soft object-cover"
          />
        ) : (
          <div className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full border-[3px] border-mint-soft bg-mint-soft font-serif text-xl font-semibold text-mint">
            {initials(profile.display_name)}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={avatarBusy}
              onClick={() => fileInput.current?.click()}
              className="rounded-[11px] border-[1.5px] border-mint px-3 py-1.5 text-[12.5px] font-extrabold text-mint disabled:opacity-60"
            >
              {avatar ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
            </button>
            {avatar && (
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => void removeAvatar()}
                className="rounded-[11px] px-3 py-1.5 text-[12.5px] font-bold text-ink-soft disabled:opacity-60"
              >
                Usuń
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Zdjęcie profilowe"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void changeAvatar(file);
            }}
          />
          {statusNote && <p className="text-xs text-ink-soft">{statusNote}</p>}
          {avatarError && (
            <p role="alert" className="text-xs font-bold text-red-600">
              {avatarError}
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="panel-name" className="text-xs font-extrabold tracking-wide text-ink-soft">
            Imię i nazwisko
          </label>
          <input
            id="panel-name"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            maxLength={255}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="panel-bio" className="text-xs font-extrabold tracking-wide text-ink-soft">
            O mnie
          </label>
          <textarea
            id="panel-bio"
            value={profileBio}
            onChange={(e) => setProfileBio(e.target.value)}
            maxLength={1000}
            placeholder="Kilka zdań o Tobie"
            className={`min-h-[76px] resize-y ${INPUT_CLASS}`}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2.5">
        {profileError && (
          <p role="alert" className="text-center text-[13px] font-bold text-red-600">
            {profileError}
          </p>
        )}
        {profileSaved && <span className="text-center text-[13px] font-bold text-mint">✓ Zapisano</span>}
        <button
          onClick={() => void saveProfile()}
          disabled={!profileName.trim()}
          className="w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(27,129,104,0.85)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          Zapisz zmiany
        </button>
      </div>
    </div>
  );
}
