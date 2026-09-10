import { Link } from "react-router-dom";
import { BoxIcon, PencilIcon, TrashIcon } from "../panelIcons";
import { dayMonth, NEEDED_ITEM_LABELS, termPublicPath } from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

export function SpotkaniaView() {
  const {
    isOrganizer,
    myGroups,
    terms,
    groupExtras,
    renamingCircle,
    circleNameDraft,
    circleRenameError,
    busy,
    setModal,
    setTermGroupId,
    setCircleNameDraft,
    startRenameCircle,
    cancelRenameCircle,
    saveRenameCircle,
    handleRemoveGroup,
    organizerTermCard,
  } = usePanelData();

  if (isOrganizer) {
    return (
      <>
        <div>
          <div className="mb-3.5 flex items-start justify-between gap-2.5">
            <div>
              <h2 className="text-[19px] font-semibold text-ink">Grupy</h2>
              <small className="text-[12.5px] text-ink-soft">
                {myGroups.length} {myGroups.length === 1 ? "grupa" : "grupy"}
              </small>
            </div>
            <button
              onClick={() => setModal("grupa")}
              className="inline-flex flex-none items-center gap-1.5 rounded-full bg-ink px-[15px] py-2.5 text-[12.5px] font-extrabold text-[#EAF2E9] transition-transform hover:-translate-y-0.5"
            >
              + Dodaj grupę
            </button>
          </div>
          <div className="rounded-[22px] border border-line bg-paper p-5">
            {myGroups.length === 0 && (
              <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                Nie masz jeszcze żadnej grupy.
              </div>
            )}
            {myGroups.map((g) => {
              const extra = groupExtras[g.id];
              return (
                <div key={g.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
                  <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl bg-mint-soft">
                    <BoxIcon c="#12604D" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {renamingCircle === g.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          aria-label="Nazwa kręgu"
                          autoFocus
                          value={circleNameDraft}
                          onChange={(e) => setCircleNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveRenameCircle(g);
                            if (e.key === "Escape") cancelRenameCircle();
                          }}
                          className="min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3 py-2 text-ink"
                        />
                        <button
                          onClick={() => void saveRenameCircle(g)}
                          disabled={busy}
                          className="flex-none rounded-[11px] bg-mint px-3.5 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-60"
                        >
                          Zapisz
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h3 className="text-[15.5px] font-semibold text-ink">{g.name}</h3>
                        <button
                          onClick={() => startRenameCircle(g)}
                          aria-label="Zmień nazwę kręgu"
                          className="flex h-7 w-7 flex-none items-center justify-center rounded-[9px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
                        >
                          <PencilIcon />
                        </button>
                      </div>
                    )}
                    {circleRenameError?.groupId === g.id && (
                      <p className="mt-1.5 text-[12.5px] font-semibold text-danger">{circleRenameError.message}</p>
                    )}
                    {extra?.location && <small className="mt-0.5 block text-[12.5px] text-ink-soft">{extra.location}</small>}
                    {extra && extra.freeSpots > 0 && (
                      <span className="mt-1.5 inline-block rounded-full bg-lime-soft px-2.5 py-1 text-[11.5px] font-extrabold text-[#56701F]">
                        wolne {extra.freeSpots} miejsca
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => void handleRemoveGroup(g.id)}
                    aria-label={`Usuń grupę ${g.name}`}
                    className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-danger-soft hover:text-danger"
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-7">
          <div className="mb-3.5 flex items-start justify-between gap-2.5">
            <div>
              <h2 className="text-[19px] font-semibold text-ink">Terminy</h2>
              <small className="text-[12.5px] text-ink-soft">
                {terms.length} {terms.length === 1 ? "termin" : "terminy"}
              </small>
            </div>
            <button
              onClick={() => { setTermGroupId(myGroups[0]?.id ?? null); setModal("termin"); }}
              className="inline-flex flex-none items-center gap-1.5 rounded-full bg-ink px-[15px] py-2.5 text-[12.5px] font-extrabold text-[#EAF2E9] transition-transform hover:-translate-y-0.5"
            >
              + Dodaj termin
            </button>
          </div>
          <div className="rounded-[22px] border border-line bg-paper p-5">
            {terms.length === 0 && (
              <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                Brak zaplanowanych terminów.
              </div>
            )}
            {terms.map(({ term, group, neededItems }) => (
              <div key={term.id} className="mt-2.5 first:mt-0">
                {organizerTermCard(term, group, neededItems)}
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <div>
      <div className="mb-3.5">
        <h2 className="text-[19px] font-semibold text-ink">Spotkania</h2>
        <small className="text-[12.5px] text-ink-soft">
          {terms.length === 0
            ? "Nie jesteś jeszcze zapisana na żadne zajęcia"
            : `${terms.length} ${terms.length === 1 ? "termin, na który jesteś zapisana" : "terminy, na które jesteś zapisana"}`}
        </small>
      </div>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        {terms.length === 0 && (
          <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
            Nie jesteś jeszcze zapisana na żadne zajęcia.
          </div>
        )}
        {terms.map(({ term, group, neededItems }) => {
          const { day, month } = dayMonth(term.occurs_on);
          return (
            <Link
              key={term.id}
              to={termPublicPath(group, term.id)}
              className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] transition-colors first:mt-0 hover:border-mint"
            >
              <div className="flex h-[46px] w-[46px] flex-none flex-col items-center justify-center rounded-[13px] bg-mint-soft leading-none">
                <b className="font-serif text-base text-ink">{day}</b>
                <small className="text-[9.5px] uppercase tracking-wide text-ink-soft">{month}</small>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15.5px] font-semibold text-ink">{group.name}</h3>
                <small className="mt-0.5 block text-[12.5px] text-ink-soft">{term.description || "Bez opisu"}</small>
                {neededItems.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {neededItems.map((ni) => (
                      <span key={ni.id} className="rounded-full bg-lime-soft px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#56701F]">
                        {NEEDED_ITEM_LABELS[ni.category]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
