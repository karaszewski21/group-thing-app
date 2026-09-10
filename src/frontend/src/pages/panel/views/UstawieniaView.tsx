import { ToggleRow } from "../panelComponents";
import { LogoutIcon } from "../panelIcons";
import { usePanelData } from "../panelDataStore";

export function UstawieniaView() {
  const { settings, setSettings, logout } = usePanelData();

  return (
    <>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        <h3 className="mb-1 text-base font-semibold text-ink">Powiadomienia</h3>
        <ToggleRow
          label="Powiadomienia e-mail"
          hint="Nowe zgłoszenia i wiadomości"
          checked={settings.emailNotifs}
          onChange={() => setSettings((s) => ({ ...s, emailNotifs: !s.emailNotifs }))}
        />
        <ToggleRow
          label="Powiadomienia SMS"
          hint="Przypomnienia o nadchodzących zajęciach"
          checked={settings.smsNotifs}
          onChange={() => setSettings((s) => ({ ...s, smsNotifs: !s.smsNotifs }))}
        />
      </div>
      <div className="mt-3.5 rounded-[22px] border border-line bg-paper p-5">
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
    </>
  );
}
