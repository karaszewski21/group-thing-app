import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { GuardianResponse } from "../../../api/families";
import dayjs from "../../../utils/dayjs";
import { approxAge, birthYearError, formatApproxAge, MIN_BIRTH_YEAR } from "../../../utils/age";
import { isSafeReturnPath } from "../../../utils/url";
import { Field } from "../panelComponents";
import { BackIcon, PencilIcon, TrashIcon } from "../panelIcons";
import { usePanelData } from "../panelDataStore";

function ReturnToTermButton() {
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  if (!isSafeReturnPath(returnTo)) return null;
  return (
    <div className="mt-7">
      <Link
        to={returnTo}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[13px] border-[1.5px] border-line px-5 py-2.5 text-[13px] font-extrabold text-ink-soft no-underline hover:border-mint hover:text-mint"
      >
        <BackIcon />
        Wróć do terminu
      </Link>
    </div>
  );
}

function roleLabel(g: GuardianResponse, selfPartyId: number): string {
  if (g.party_id === selfPartyId) return "(Ty)";
  return g.role_type === "CHILD" ? "(dziecko)" : "(opiekun)";
}

export function RodzinaView() {
  const {
    profile,
    family,
    guardians,
    renamingFamily,
    familyNameDraft,
    renameError,
    familyMemberError,
    memberName,
    memberRole,
    memberBirthYear,
    busy,
    setModal,
    setFamilyNameDraft,
    setMemberName,
    setMemberRole,
    setMemberBirthYear,
    startRenameFamily,
    cancelRenameFamily,
    saveRenameFamily,
    handleRemoveFamilyMember,
    handleAddFamilyMember,
    saveChildBirthYear,
  } = usePanelData();

  const [editingBirthYearFor, setEditingBirthYearFor] = useState<number | null>(null);
  const [birthYearDraft, setBirthYearDraft] = useState("");
  const [birthYearSaveError, setBirthYearSaveError] = useState<string | null>(null);

  if (!profile) return null;

  if (family === null) {
    return (
      <div>
        <div className="mb-3.5">
          <h2 className="text-[19px] font-semibold text-ink">Mój dom</h2>
        </div>
        <div className="rounded-2xl border-[1.5px] border-dashed border-line p-6 text-center">
          <p className="text-[15px] font-semibold text-ink">Nie masz jeszcze rodziny</p>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            Załóż rodzinę, aby dodać opiekunów i dzieci oraz wspólnie zapisywać się na zajęcia.
          </p>
          <button
            onClick={() => setModal("rodzina-nowa")}
            className="mt-4 rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white"
          >
            Załóż rodzinę
          </button>
        </div>
        <ReturnToTermButton />
      </div>
    );
  }

  const memberYearError = memberRole === "CHILD" ? birthYearError(memberBirthYear) : null;
  const draftYearError = birthYearError(birthYearDraft);

  function startEditBirthYear(g: GuardianResponse) {
    setEditingBirthYearFor(g.family_membership_id);
    setBirthYearDraft(g.birth_year === null ? "" : String(g.birth_year));
    setBirthYearSaveError(null);
  }

  function cancelEditBirthYear() {
    setEditingBirthYearFor(null);
    setBirthYearSaveError(null);
  }

  async function saveBirthYear(g: GuardianResponse) {
    if (busy || draftYearError) return;
    const next = birthYearDraft.trim() ? Number(birthYearDraft) : null;
    if (next === g.birth_year) {
      cancelEditBirthYear();
      return;
    }
    const error = await saveChildBirthYear(g, next);
    if (error) {
      setBirthYearSaveError(error);
    } else {
      setEditingBirthYearFor(null);
    }
  }

  function renderChildMeta(g: GuardianResponse) {
    if (editingBirthYearFor === g.family_membership_id) {
      const unchanged = birthYearDraft === (g.birth_year === null ? "" : String(g.birth_year));
      const inlineError = draftYearError ?? birthYearSaveError;
      return (
        <div className="mt-1.5">
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={MIN_BIRTH_YEAR}
              max={dayjs().year()}
              aria-label={`Rok urodzenia: ${g.display_name}`}
              autoFocus
              value={birthYearDraft}
              onChange={(e) => {
                setBirthYearDraft(e.target.value);
                setBirthYearSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveBirthYear(g);
                if (e.key === "Escape") cancelEditBirthYear();
              }}
              onBlur={() => {
                if (unchanged) cancelEditBirthYear();
              }}
              placeholder="np. 2018"
              className="w-28 min-w-0 rounded-xl border-[1.5px] border-line bg-paper px-3 py-1.5 text-ink"
            />
            <button
              onClick={() => void saveBirthYear(g)}
              disabled={busy || draftYearError !== null}
              className="flex-none rounded-[11px] bg-mint px-3.5 py-1.5 text-[12.5px] font-extrabold text-white disabled:opacity-60"
            >
              Zapisz
            </button>
          </div>
          {inlineError && <p className="mt-1 text-[12.5px] font-semibold text-danger">{inlineError}</p>}
        </div>
      );
    }
    if (g.birth_year === null) {
      return (
        <button
          onClick={() => startEditBirthYear(g)}
          className="mt-0.5 text-[12px] font-bold text-mint"
        >
          + Dodaj rok urodzenia
        </button>
      );
    }
    return (
      <div className="mt-0.5 flex items-center gap-1">
        <p className="text-[12.5px] text-ink-soft">
          rocznik {g.birth_year} · {formatApproxAge(approxAge(g.birth_year))}
        </p>
        <button
          onClick={() => startEditBirthYear(g)}
          aria-label={`Edytuj rok urodzenia: ${g.display_name}`}
          className="flex h-6 w-6 items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3.5">
        <h2 className="text-[19px] font-semibold text-ink">Mój dom</h2>
        {renamingFamily ? (
          <div className="mt-1.5 flex items-center gap-2">
            <input
              aria-label="Nazwa rodziny"
              autoFocus
              value={familyNameDraft}
              onChange={(e) => setFamilyNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveRenameFamily();
                if (e.key === "Escape") cancelRenameFamily();
              }}
              onBlur={() => {
                if (familyNameDraft.trim() === family.name) cancelRenameFamily();
              }}
              className="min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3 py-2 text-ink"
            />
            <button
              onClick={() => void saveRenameFamily()}
              disabled={busy}
              className="flex-none rounded-[11px] bg-mint px-3.5 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-60"
            >
              Zapisz
            </button>
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-2">
            <h3 className="text-[15.5px] font-semibold text-ink">{family.name}</h3>
            <button
              onClick={startRenameFamily}
              aria-label="Zmień nazwę rodziny"
              className="flex h-7 w-7 items-center justify-center rounded-[9px] text-ink-soft transition-colors hover:bg-cream hover:text-ink"
            >
              <PencilIcon />
            </button>
          </div>
        )}
        {renameError && (
          <p className="mt-1.5 text-[12.5px] font-semibold text-danger">{renameError}</p>
        )}
        <small className="mt-1 block text-[12.5px] text-ink-soft">
          {guardians.length} {guardians.length === 1 ? "osoba" : "osoby"}
        </small>
      </div>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        {guardians.length === 0 && (
          <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
            Nie masz jeszcze żadnych członków rodziny.
          </div>
        )}
        {guardians.map((g) => (
          <div
            key={g.family_membership_id}
            className="mt-2.5 flex items-center gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0"
          >
            <div className="min-w-0 flex-1">
              <h3 className="text-[15.5px] font-semibold text-ink">
                {g.display_name}
                <span className="ml-1.5 text-ink-soft">{roleLabel(g, profile.party_id)}</span>
              </h3>
              {g.role_type === "CHILD" && renderChildMeta(g)}
            </div>
            {g.party_id !== profile.party_id && (
              <button
                onClick={() => void handleRemoveFamilyMember(g)}
                disabled={busy}
                aria-label={`Usuń członka rodziny ${g.display_name}`}
                className="flex h-7 w-7 flex-none items-center justify-center rounded-[9px] text-ink-soft transition-colors hover:bg-paper hover:text-danger disabled:opacity-60"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        ))}
        {familyMemberError && (
          <p className="mt-2.5 text-[12.5px] font-semibold text-danger">{familyMemberError}</p>
        )}
      </div>

      <div className="mt-7">
        <h3 className="mb-3.5 text-base font-semibold text-ink">Dodaj kolejnego członka</h3>
        <div className="rounded-[22px] border border-line bg-paper p-5">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Imię i nazwisko">
              <input
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="np. Zosia Kowalska"
                className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              />
            </Field>
            <Field label="Rola">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMemberRole("GUARDIAN");
                    setMemberBirthYear("");
                  }}
                  aria-pressed={memberRole === "GUARDIAN"}
                  className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                    memberRole === "GUARDIAN" ? "border-mint bg-mint-soft text-mint" : "border-line bg-cream text-ink-soft"
                  }`}
                >
                  Opiekun
                </button>
                <button
                  type="button"
                  onClick={() => setMemberRole("CHILD")}
                  aria-pressed={memberRole === "CHILD"}
                  className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                    memberRole === "CHILD" ? "border-mint bg-mint-soft text-mint" : "border-line bg-cream text-ink-soft"
                  }`}
                >
                  Dziecko
                </button>
              </div>
            </Field>
            {memberRole === "CHILD" && (
              <Field label="Rok urodzenia">
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_BIRTH_YEAR}
                  max={dayjs().year()}
                  aria-label="Rok urodzenia"
                  value={memberBirthYear}
                  onChange={(e) => setMemberBirthYear(e.target.value)}
                  placeholder="np. 2018"
                  className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
                />
                {memberYearError ? (
                  <p className="text-[12.5px] font-semibold text-danger">{memberYearError}</p>
                ) : (
                  memberBirthYear.trim() && (
                    <p className="text-[12px] text-ink-soft">{formatApproxAge(approxAge(Number(memberBirthYear)))}</p>
                  )
                )}
              </Field>
            )}
          </div>
          <button
            onClick={() => void handleAddFamilyMember()}
            disabled={busy || !memberName.trim() || memberYearError !== null}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dodaj
          </button>
        </div>
      </div>

      <ReturnToTermButton />
    </div>
  );
}
