import { ToggleRow } from "../../components/shared/appComponents";
import { LogoutIcon } from "../../components/shared/appIcons";
import { useAppData } from "../../app/appDataStore";

export function SettingsView() {
  const { settings, setSettings, logout } = useAppData();

  return (
    <>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        <h3 className="mb-1 text-base font-semibold text-ink">Prywatność</h3>
        <ToggleRow
          label="Widoczny profil publiczny"
          hint="Inne rodziny mogą Cię znaleźć"
          checked={settings.publicProfile}
          onChange={() => setSettings((s) => ({ ...s, publicProfile: !s.publicProfile }))}
        />
      </div>
      <div className="mt-3.5 rounded-[22px] border border-line bg-paper p-5">
        <h3 className="mb-3.5 text-base font-semibold text-ink">Konto</h3>
        <button
          onClick={logout}
          className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-danger-soft px-5 py-3 text-[13.5px] font-extrabold text-danger"
        >
          <LogoutIcon /> Wyloguj się
        </button>
      </div>
      <p className="mt-3.5 px-1 text-xs text-ink-soft">
        Powiadomienia dostajesz w aplikacji (dzwonek u góry ekranu).
      </p>
    </>
  );
}
