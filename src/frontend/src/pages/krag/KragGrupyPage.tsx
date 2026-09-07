import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useKragGrupy } from "../../hooks/useKragGrupy";
import { ProductPicker } from "../../components/shared/ProductPicker";
import { createEmptyProductPickerValue, type ProductPickerValue } from "../../utils/productPicker";
import { PhoneFrame } from "../../components/shared/PhoneFrame";

/* ------------------------------------------------------------------ */
/*  Krąg grupy — zajęcia + prośby o rzeczy (dane z API, nie mock)       */
/*  Scalenie KragGrupy.tsx + KragGrupyStart.tsx z pages/ (SPEC.md #3): */
/*  jeden komponent, liczba rodzin wynika z realnych Membership.        */
/*  Funkcja "wymiana/pożyczka" z prototypu usunięta — nie ma dziś        */
/*  odpowiednika w modelu domenowym (Reservation wymaga już istniejącego */
/*  InventoryItem); zostawiona wyłącznie realna funkcja Term/NeededItem/ */
/*  Pledge ("kto co przynosi"). Reskin na wspólny Tailwind/PhoneFrame    */
/*  system (dawniej własny "kg-*" CSS-in-JS, wizualnie odstający).      */
/* ------------------------------------------------------------------ */

const PALETTE = ["#1B8168", "#5D8A63", "#3F8E90", "#7E9A34", "#2A6B58", "#4E7D55", "#35797B", "#6B8A2F"];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function familyColor(name: string): string {
  return PALETTE[hashString(name) % PALETTE.length];
}

function familyInitials(name: string): string {
  const words = name.replace(/^Rodzina\s+/i, "").split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? words[0]?.[1] ?? "").toUpperCase();
}

const pillPrimary =
  "rounded-full bg-mint px-[13px] py-[7px] text-[12px] font-extrabold text-white disabled:opacity-60";
const pillGhost =
  "rounded-full border-[1.5px] border-line px-[13px] py-[7px] text-[12px] font-bold text-ink-soft hover:border-sage";
const pillOutlineMint =
  "flex-none rounded-full border-[1.5px] border-mint bg-paper px-[13px] py-[7px] text-[12px] font-extrabold text-mint transition-colors";
const pickerInputClass =
  "min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3 py-2 text-[13px] text-ink focus:border-mint focus:outline-none focus:ring-[3px] focus:ring-mint-soft";

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.5 5 8 12l6.5 7" stroke="#1E2E27" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KragGrupyPage() {
  const params = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const groupId = Number(params.groupId);
  const {
    loading,
    error,
    group,
    organizer,
    families,
    myPartyId,
    currentTerm,
    neededItems,
    products,
    pledgeFamilyName,
    pledge,
    withdraw,
    fulfillPledgeItem,
    confirmPledgeReceipt,
    addProduct,
  } = useKragGrupy(groupId);

  const [activeFamilyId, setActiveFamilyId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [busyPledgeId, setBusyPledgeId] = useState<number | null>(null);
  const [fulfillingItemId, setFulfillingItemId] = useState<number | null>(null);
  const [pickerValue, setPickerValue] = useState<ProductPickerValue>(createEmptyProductPickerValue());

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const activeFamily = useMemo(
    () => families.find((f) => f.familyId === activeFamilyId) ?? families[0] ?? null,
    [families, activeFamilyId],
  );

  const isOrganizerViewer =
    myPartyId !== null && organizer !== null && myPartyId === organizer.party_id;

  const slots = families.length + 1;
  const R = 38;
  const pos = (i: number) => {
    const a = (i / slots) * 2 * Math.PI - Math.PI / 2;
    return { left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` };
  };

  async function handlePledgeToggle(neededItemId: number, myPledgeId: number | null) {
    setBusyItemId(neededItemId);
    try {
      if (myPledgeId !== null) {
        await withdraw(myPledgeId);
      } else {
        await pledge(neededItemId);
      }
    } catch {
      setToast("Nie udalo sie zapisac zgloszenia");
    } finally {
      setBusyItemId(null);
    }
  }

  function openFulfillForm(itemId: number) {
    setFulfillingItemId(itemId);
    setPickerValue(createEmptyProductPickerValue(products[0]?.id ?? "new"));
  }

  async function handleFulfillSubmit(pledgeId: number) {
    setBusyPledgeId(pledgeId);
    try {
      let productId: number;
      if (pickerValue.selectedProductId === "new") {
        if (!pickerValue.newProductName.trim()) {
          setToast("Podaj nazwę przedmiotu");
          return;
        }
        // `price`/`sku` are the sales-catalog's own required fields (price
        // must be > 0) — a guardian registering "I'm bringing this
        // tambourine" has no natural value for either, so both get an
        // invisible placeholder rather than surfacing fields nobody here
        // cares about.
        const product = await addProduct({
          name: pickerValue.newProductName.trim(),
          category: pickerValue.newProductCategory,
          price: 0.01,
          sku: `${pickerValue.newProductName.trim().slice(0, 10).toUpperCase()}-${Date.now()}`,
        });
        productId = product.id;
      } else {
        productId = pickerValue.selectedProductId;
      }
      await fulfillPledgeItem(pledgeId, { product_id: productId, condition: pickerValue.condition });
      setFulfillingItemId(null);
    } catch {
      setToast("Nie udało się zarejestrować przedmiotu");
    } finally {
      setBusyPledgeId(null);
    }
  }

  async function handleConfirmReceipt(pledgeId: number, reservationId: number) {
    setBusyPledgeId(pledgeId);
    try {
      await confirmPledgeReceipt(pledgeId, reservationId);
    } catch {
      setToast("Nie udało się potwierdzić odbioru");
    } finally {
      setBusyPledgeId(null);
    }
  }

  if (loading) {
    return (
      <PhoneFrame>
        <div className="flex flex-1 items-center justify-center text-ink-soft">Wczytywanie…</div>
      </PhoneFrame>
    );
  }

  if (error || !group) {
    return (
      <PhoneFrame>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-ink-soft">
          {error ?? "Nie znaleziono grupy"}
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <header className="sticky top-0 z-20 border-b border-line bg-paper px-[18px] py-4">
        <button
          onClick={() => navigate(-1)}
          className="mb-2 inline-flex h-[34px] items-center gap-1.5 rounded-full bg-cream px-3 text-[13px] font-bold text-ink transition-colors hover:bg-mint-soft"
        >
          <BackIcon /> Wróć
        </button>
        <div className="text-[11px] font-extrabold uppercase tracking-wide text-sage">Grupa</div>
        <h1 className="mt-0.5 font-serif text-xl font-semibold text-ink">{group.name}</h1>
        <p className="mt-1 text-[13.5px] text-ink-soft">
          {currentTerm ? `Najbliższe zajęcia: ${currentTerm.occurs_on}` : "Brak zaplanowanych zajęć"} ·{" "}
          {families.length} {families.length === 1 ? "rodzina" : "rodzin"}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto pb-6">
        <div className="px-[18px] pb-1.5 pt-[26px]">
          <div className="relative mx-auto aspect-square w-full max-w-[360px]">
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" aria-hidden="true">
              {families.map((f, i) => {
                const a = (i / slots) * 2 * Math.PI - Math.PI / 2;
                const on = activeFamily?.familyId === f.familyId;
                return (
                  <line
                    key={f.familyId}
                    x1="50"
                    y1="50"
                    x2={50 + R * Math.cos(a)}
                    y2={50 + R * Math.sin(a)}
                    stroke={on ? "#1B8168" : "#CBDAC7"}
                    strokeWidth={on ? "1" : "0.45"}
                  />
                );
              })}
            </svg>

            {families.map((f, i) => {
              const on = activeFamily?.familyId === f.familyId;
              return (
                <button
                  key={f.familyId}
                  className="absolute -translate-x-1/2 -translate-y-1/2 transition-opacity"
                  style={pos(i)}
                  onClick={() => setActiveFamilyId(f.familyId)}
                  aria-pressed={on}
                  aria-label={f.name}
                >
                  <span
                    className={`relative flex h-[52px] w-[52px] items-center justify-center rounded-full border-[3px] border-cream text-[14.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(30,46,39,0.7)] transition-transform hover:scale-105 ${
                      on ? "scale-110 ring-4 ring-mint-soft" : ""
                    }`}
                    style={{ background: familyColor(f.name) }}
                  >
                    {familyInitials(f.name)}
                  </span>
                </button>
              );
            })}

            <button
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={pos(families.length)}
              onClick={() => setToast("Zaproszenie do grupy — wkrótce")}
              aria-label="Zaproś kolejną rodzinę"
            >
              <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-dashed border-mint bg-cream text-lg font-extrabold text-mint transition-transform hover:scale-105">
                +
              </span>
            </button>

            <div className="absolute left-1/2 top-1/2 w-[48%] -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="mx-auto flex h-[74px] w-[74px] items-center justify-center rounded-full bg-ink font-serif text-2xl text-white shadow-[0_14px_28px_-14px_rgba(30,46,39,0.85)]">
                {organizer ? organizer.display_name.slice(0, 1) : "?"}
              </div>
              <strong className="mt-2.5 block font-serif text-[15px] font-semibold text-ink">
                {organizer ? organizer.display_name : "Brak organizatora"}
              </strong>
              <span className="block text-xs text-ink-soft">prowadzi zajęcia</span>
            </div>
          </div>
        </div>

        <div className="mx-[18px] mt-[18px] rounded-[22px] border border-line bg-paper p-5">
          <h2 className="text-base font-semibold text-ink">Kto co przynosi</h2>
          <p className="mt-1 text-[12.5px] text-ink-soft">
            {currentTerm
              ? "Te rzeczy są potrzebne na najbliższe zajęcia — zgłoś się, jeśli możesz coś przynieść."
              : "Organizator nie dodał jeszcze żadnych zajęć z prośbą o rzeczy."}
          </p>

          <div className="mt-3.5">
            {neededItems.length === 0 && currentTerm && (
              <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                Brak listy potrzebnych rzeczy na te zajęcia.
              </div>
            )}
            {neededItems.map(({ item, pledges }) => {
              const activePledges = pledges.filter((p) => p.status !== "WITHDRAWN");
              const myPledge = activePledges.find((p) => p.pledged_by_party_id === myPartyId) ?? null;
              const shown = myPledge ?? activePledges[0] ?? null;
              const registered = shown?.resolved_reservation_id != null;
              const showWithdrawToggle = (!shown || myPledge) && !registered;
              const showFulfillAction = myPledge !== null && myPledge.status === "CLAIMED" && !registered;
              const showConfirmAction =
                isOrganizerViewer && shown !== null && shown.status === "CLAIMED" && registered;
              return (
                <div
                  key={item.id}
                  className="mt-2.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0"
                >
                  <div className="flex items-start gap-3.5">
                    <span
                      className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-[12px] font-extrabold text-white ${
                        shown ? "" : "border-2 border-dashed border-line text-ink-soft"
                      }`}
                      style={shown ? { background: familyColor(pledgeFamilyName(shown)) } : undefined}
                    >
                      {shown ? familyInitials(pledgeFamilyName(shown)) : "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[14.5px] font-semibold text-ink">
                        {item.category}
                        {item.description ? ` — ${item.description}` : ""}
                      </h3>
                      <small className="mt-0.5 block text-xs text-ink-soft">
                        {shown
                          ? `Przynosi: ${myPledge ? "Ty" : pledgeFamilyName(shown)}`
                          : "Jeszcze nikt się nie zgłosił"}
                      </small>
                    </div>
                    {showWithdrawToggle && (
                      <button
                        className={`${pillOutlineMint} ${myPledge ? "bg-mint text-white" : ""}`}
                        disabled={busyItemId === item.id}
                        onClick={() => void handlePledgeToggle(item.id, myPledge?.id ?? null)}
                        aria-label={
                          myPledge
                            ? `Rezygnuję z przyniesienia: ${item.category}`
                            : `Ja to przyniosę: ${item.category}`
                        }
                      >
                        {myPledge ? "Rezygnuję" : "Ja to przyniosę"}
                      </button>
                    )}
                    {showFulfillAction && fulfillingItemId !== item.id && (
                      <button className={pillOutlineMint} onClick={() => openFulfillForm(item.id)}>
                        Zarejestruj przedmiot
                      </button>
                    )}
                  </div>

                  {showFulfillAction && fulfillingItemId === item.id && myPledge && (
                    <div className="mt-2.5 border-t border-dashed border-line pt-2.5">
                      <ProductPicker
                        products={products}
                        value={pickerValue}
                        onChange={setPickerValue}
                        selectClassName={pickerInputClass}
                        inputClassName={pickerInputClass}
                        rowClassName="mb-2 flex gap-2"
                      />
                      <div className="flex gap-2">
                        <button
                          className={pillPrimary}
                          disabled={busyPledgeId === myPledge.id}
                          onClick={() => void handleFulfillSubmit(myPledge.id)}
                        >
                          Zapisz
                        </button>
                        <button className={pillGhost} onClick={() => setFulfillingItemId(null)}>
                          Anuluj
                        </button>
                      </div>
                    </div>
                  )}

                  {myPledge && registered && myPledge.status === "CLAIMED" && (
                    <div className="mt-2 text-xs font-bold text-sage">
                      Przedmiot zarejestrowany — czeka na potwierdzenie odbioru
                    </div>
                  )}
                  {shown && shown.status === "FULFILLED" && (
                    <div className="mt-2 text-xs font-bold text-sage">Zrealizowane ✓</div>
                  )}
                  {showConfirmAction && shown && (
                    <div className="mt-2">
                      <button
                        className={pillPrimary}
                        disabled={busyPledgeId === shown.id}
                        onClick={() => void handleConfirmReceipt(shown.id, shown.resolved_reservation_id as number)}
                      >
                        Potwierdź odbiór
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {activeFamily && (
          <div key={activeFamily.familyId} className="mx-[18px] mt-3.5 rounded-[22px] border border-line bg-paper p-5" aria-live="polite">
            <div className="flex items-center gap-3">
              <span
                className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-[13.5px] font-extrabold text-white"
                style={{ background: familyColor(activeFamily.name) }}
              >
                {familyInitials(activeFamily.name)}
              </span>
              <div className="min-w-0">
                <h3 className="text-[15.5px] font-semibold text-ink">{activeFamily.name}</h3>
                <small className="mt-0.5 block text-[12.5px] text-ink-soft">
                  {activeFamily.guardians.length}{" "}
                  {activeFamily.guardians.length === 1 ? "opiekun" : "opiekunów"}:{" "}
                  {activeFamily.guardians.map((g) => g.display_name).join(", ")}
                </small>
              </div>
            </div>
          </div>
        )}

        <p className="px-6 pt-4 text-center text-[13px] text-ink-soft">Dotknij rodziny, żeby zobaczyć jej kartę.</p>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-[26px] left-1/2 z-[120] -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-[#EAF2E9] shadow-lg">
          {toast}
        </div>
      )}
    </PhoneFrame>
  );
}
