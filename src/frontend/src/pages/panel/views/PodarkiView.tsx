import { GiftIcon, TrashIcon } from "../panelIcons";
import { capitalize, GIFT_SOURCE_STYLE } from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

export function PodarkiView() {
  const { gifts, removeGift } = usePanelData();

  return (
    <div>
      <div className="mb-3.5">
        <h2 className="text-[19px] font-semibold text-ink">Podarki</h2>
        <small className="text-[12.5px] text-ink-soft">
          rzeczy od innych rodzin, które wypożyczyłaś lub się wymieniłaś
        </small>
      </div>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        {gifts.length === 0 && (
          <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
            Nie masz jeszcze żadnego podarku.
          </div>
        )}
        {gifts.map((g) => {
          const style = GIFT_SOURCE_STYLE[g.source];
          return (
            <div key={g.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
              <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl" style={{ background: style.bg }}>
                <GiftIcon c={style.c} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15.5px] font-semibold text-ink">{g.name}</h3>
                <small className="mt-0.5 block text-[12.5px] text-ink-soft">Od: {g.from}</small>
                <span className="mt-1.5 inline-block rounded-full px-2.5 py-1 text-[11.5px] font-extrabold" style={{ background: style.bg, color: style.c }}>
                  {capitalize(g.source)}
                </span>
              </div>
              <button
                onClick={() => removeGift(g.id)}
                aria-label={`Usuń podarek ${g.name}`}
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-danger-soft hover:text-danger"
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
