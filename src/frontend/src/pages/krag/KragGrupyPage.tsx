import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useKragGrupy } from "../../hooks/useKragGrupy";
import { ProductPicker } from "../../components/shared/ProductPicker";
import { createEmptyProductPickerValue, type ProductPickerValue } from "../../utils/productPicker";

/* ------------------------------------------------------------------ */
/*  Krąg grupy — zajęcia + prośby o rzeczy (dane z API, nie mock)       */
/*  Scalenie KragGrupy.tsx + KragGrupyStart.tsx z pages/ (SPEC.md #3): */
/*  jeden komponent, liczba rodzin wynika z realnych Membership.        */
/*  Funkcja "wymiana/pożyczka" z prototypu usunięta — nie ma dziś        */
/*  odpowiednika w modelu domenowym (Reservation wymaga już istniejącego */
/*  InventoryItem); zostawiona wyłącznie realna funkcja Term/NeededItem/ */
/*  Pledge ("kto co przynosi").                                         */
/* ------------------------------------------------------------------ */

const CSS = `
:root{
  --cream:#F4F8F0;--paper:#FFFFFF;--ink:#1E2E27;--ink-soft:#5C7069;
  --mint:#1B8168;--mint-soft:#D8F0E6;--sage:#5D8A63;--sage-soft:#DFEBDC;
  --teal:#6FB6B8;--teal-soft:#D9ECEC;--lime:#A9C24F;--line:#E2EADF;
}
*,*::before,*::after{box-sizing:border-box;}
.kg-stage{background:#EDF1EA;min-height:100vh;display:flex;justify-content:center;
  font-family:Karla,"Segoe UI",system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;}
.kg-app{width:100%;max-width:430px;background:var(--cream);display:flex;flex-direction:column;min-height:100vh;}
.kg-app h1,.kg-app h2,.kg-app h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.02em;line-height:1.12;margin:0;}
.kg-app p{margin:0;line-height:1.6;}
.kg-app button{font-family:inherit;cursor:pointer;}
.kg-head{background:var(--paper);border-bottom:1px solid var(--line);padding:18px 18px 16px;position:sticky;top:0;z-index:20;}
.kg-head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.kg-eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;font-weight:800;color:var(--sage);}
.kg-head h1{font-size:23px;margin-top:5px;}
.kg-head-sub{font-size:13.5px;color:var(--ink-soft);margin-top:4px;}
.kg-back{border:none;background:none;color:var(--mint);font-weight:700;font-size:13px;padding:0 0 8px;}
.kg-circle-wrap{padding:26px 18px 6px;}
.kg-stagebox{position:relative;width:100%;max-width:360px;margin:0 auto;}
.kg-square{position:relative;width:100%;padding-top:100%;}
.kg-inner{position:absolute;inset:0;}
.kg-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
.kg-fam{position:absolute;transform:translate(-50%,-50%);background:none;border:none;padding:0;transition:opacity .25s ease;}
.kg-av{position:relative;width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:800;font-size:14.5px;border:3px solid var(--cream);box-shadow:0 8px 18px -10px rgba(30,46,39,.7);
  transition:transform .22s cubic-bezier(.2,.8,.2,1);}
.kg-fam:hover .kg-av{transform:scale(1.09);}
.kg-fam.is-on .kg-av{transform:scale(1.1);box-shadow:0 0 0 4px var(--mint-soft),0 8px 18px -10px rgba(30,46,39,.7);}
.kg-mark{position:absolute;right:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;background:var(--teal);
  display:flex;align-items:center;justify-content:center;border:2.5px solid var(--cream);font-size:11px;}
.kg-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;width:48%;}
.kg-center-av{width:74px;height:74px;border-radius:50%;background:var(--ink);margin:0 auto;display:flex;align-items:center;justify-content:center;
  color:#fff;font-family:Fraunces,Georgia,serif;font-size:22px;box-shadow:0 14px 28px -14px rgba(30,46,39,.85);}
.kg-center strong{display:block;margin-top:10px;font-family:Fraunces,Georgia,serif;font-size:15px;}
.kg-center span{display:block;font-size:12px;color:var(--ink-soft);}
.kg-bring{margin:18px 18px 0;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:17px;}
.kg-bring h2{font-size:17px;}
.kg-bring-sub{font-size:12.5px;color:var(--ink-soft);margin-top:3px;}
.kg-bring-list{margin-top:12px;}
.kg-bring-item{padding:10px 0;}
.kg-bring-item + .kg-bring-item{border-top:1px solid var(--line);}
.kg-bring-row{display:flex;align-items:center;gap:11px;}
.kg-bring-av{width:36px;height:36px;border-radius:50%;flex:none;color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;}
.kg-bring-av-empty{background:none;border:2px dashed var(--line);color:var(--ink-soft);}
.kg-bring-body{flex:1;min-width:0;}
.kg-bring-body strong{display:block;font-size:14px;}
.kg-bring-body small{display:block;color:var(--ink-soft);font-size:12px;margin-top:1px;}
.kg-bring-btn{flex:none;border:1.5px solid var(--mint);background:var(--paper);color:var(--mint);border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;}
.kg-bring-btn.is-on{background:var(--mint);color:#fff;}
.kg-bring-empty{font-size:13px;color:var(--ink-soft);text-align:center;padding:16px 0;}
.kg-fulfill{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);}
.kg-fulfill-row{display:flex;gap:8px;margin-bottom:8px;}
.kg-select,.kg-input{flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit;background:var(--paper);color:var(--ink);}
.kg-fulfill-actions{display:flex;gap:8px;}
.kg-btn-primary{border:none;background:var(--mint);color:#fff;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:800;}
.kg-btn-primary:disabled{opacity:.6;}
.kg-btn-ghost{border:1.5px solid var(--line);background:none;color:var(--ink-soft);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:700;}
.kg-status-line{font-size:12px;color:var(--sage);font-weight:700;margin-top:8px;}
.kg-card{margin:18px 18px 24px;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:17px;}
.kg-card-top{display:flex;align-items:center;gap:12px;}
.kg-card-av{width:44px;height:44px;border-radius:50%;flex:none;color:#fff;font-weight:800;font-size:13.5px;display:flex;align-items:center;justify-content:center;}
.kg-card-top h3{font-size:17px;}
.kg-card-top small{font-size:13px;color:var(--ink-soft);}
.kg-hint{text-align:center;font-size:13px;color:var(--ink-soft);padding:4px 24px 26px;}
.kg-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:120;background:var(--ink);color:#EAF2E9;
  border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;box-shadow:0 14px 30px -14px rgba(30,46,39,.9);}
.kg-state{text-align:center;padding:60px 24px;color:var(--ink-soft);}
@media (min-width:520px){
  .kg-stage{padding:26px 16px;background:#E7EDE4;}
  .kg-app{min-height:0;border-radius:34px;overflow:hidden;box-shadow:0 40px 80px -40px rgba(30,46,39,.6),0 0 0 9px #1E2E27;margin:8px 0;}
}
`;

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
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
    return () => {
      l.parentNode?.removeChild(l);
    };
  }, []);

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
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">Wczytywanie...</div>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">{error ?? "Nie znaleziono grupy"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kg-stage">
      <style>{CSS}</style>
      <div className="kg-app">
        <header className="kg-head">
          <button className="kg-back" onClick={() => navigate(-1)}>
            ← Wróć
          </button>
          <div className="kg-head-row">
            <div>
              <div className="kg-eyebrow">Grupa</div>
              <h1>{group.name}</h1>
              <div className="kg-head-sub">
                {currentTerm ? `Najbliższe zajęcia: ${currentTerm.occurs_on}` : "Brak zaplanowanych zajęć"} ·{" "}
                {families.length} {families.length === 1 ? "rodzina" : "rodzin"}
              </div>
            </div>
          </div>
        </header>

        <div className="kg-circle-wrap">
          <div className="kg-stagebox">
            <div className="kg-square">
              <div className="kg-inner">
                <svg className="kg-svg" viewBox="0 0 100 100" aria-hidden="true">
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

                {families.map((f, i) => (
                  <button
                    key={f.familyId}
                    className={`kg-fam ${activeFamily?.familyId === f.familyId ? "is-on" : ""}`}
                    style={pos(i)}
                    onClick={() => setActiveFamilyId(f.familyId)}
                    aria-pressed={activeFamily?.familyId === f.familyId}
                    aria-label={f.name}
                  >
                    <span className="kg-av" style={{ background: familyColor(f.name) }}>
                      {familyInitials(f.name)}
                    </span>
                  </button>
                ))}

                <button
                  className="kg-fam"
                  style={pos(families.length)}
                  onClick={() => setToast("Zaproszenie do grupy — wkrótce")}
                  aria-label="Zaproś kolejną rodzinę"
                >
                  <span className="kg-av" style={{ background: "var(--cream)", color: "var(--mint)", border: "2.5px dashed var(--mint)", boxShadow: "none" }}>
                    +
                  </span>
                </button>

                <div className="kg-center">
                  <div className="kg-center-av">{organizer ? organizer.display_name.slice(0, 1) : "?"}</div>
                  <strong>{organizer ? organizer.display_name : "Brak organizatora"}</strong>
                  <span>prowadzi zajęcia</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="kg-bring">
          <h2>Kto co przynosi</h2>
          <p className="kg-bring-sub">
            {currentTerm
              ? "Te rzeczy są potrzebne na najbliższe zajęcia — zgłoś się, jeśli możesz coś przynieść."
              : "Organizator nie dodał jeszcze żadnych zajęć z prośbą o rzeczy."}
          </p>
          <div className="kg-bring-list">
            {neededItems.length === 0 && currentTerm && (
              <div className="kg-bring-empty">Brak listy potrzebnych rzeczy na te zajęcia.</div>
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
                <div className="kg-bring-item" key={item.id}>
                  <div className="kg-bring-row">
                    <span
                      className={`kg-bring-av ${shown ? "" : "kg-bring-av-empty"}`}
                      style={shown ? { background: familyColor(pledgeFamilyName(shown)) } : undefined}
                    >
                      {shown ? familyInitials(pledgeFamilyName(shown)) : "?"}
                    </span>
                    <div className="kg-bring-body">
                      <strong>{item.category}{item.description ? ` — ${item.description}` : ""}</strong>
                      <small>
                        {shown
                          ? `Przynosi: ${myPledge ? "Ty" : pledgeFamilyName(shown)}`
                          : "Jeszcze nikt się nie zgłosił"}
                      </small>
                    </div>
                    {showWithdrawToggle && (
                      <button
                        className={`kg-bring-btn ${myPledge ? "is-on" : ""}`}
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
                      <button className="kg-bring-btn" onClick={() => openFulfillForm(item.id)}>
                        Zarejestruj przedmiot
                      </button>
                    )}
                  </div>

                  {showFulfillAction && fulfillingItemId === item.id && myPledge && (
                    <div className="kg-fulfill">
                      <ProductPicker
                        products={products}
                        value={pickerValue}
                        onChange={setPickerValue}
                        selectClassName="kg-select"
                        inputClassName="kg-input"
                        rowClassName="kg-fulfill-row"
                      />
                      <div className="kg-fulfill-actions">
                        <button
                          className="kg-btn-primary"
                          disabled={busyPledgeId === myPledge.id}
                          onClick={() => void handleFulfillSubmit(myPledge.id)}
                        >
                          Zapisz
                        </button>
                        <button className="kg-btn-ghost" onClick={() => setFulfillingItemId(null)}>
                          Anuluj
                        </button>
                      </div>
                    </div>
                  )}

                  {myPledge && registered && myPledge.status === "CLAIMED" && (
                    <div className="kg-status-line">Przedmiot zarejestrowany — czeka na potwierdzenie odbioru</div>
                  )}
                  {shown && shown.status === "FULFILLED" && <div className="kg-status-line">Zrealizowane ✓</div>}
                  {showConfirmAction && shown && (
                    <div className="kg-fulfill-actions" style={{ marginTop: "8px" }}>
                      <button
                        className="kg-btn-primary"
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
          <div className="kg-card" key={activeFamily.familyId} aria-live="polite">
            <div className="kg-card-top">
              <span className="kg-card-av" style={{ background: familyColor(activeFamily.name) }}>
                {familyInitials(activeFamily.name)}
              </span>
              <div style={{ minWidth: 0 }}>
                <h3>{activeFamily.name}</h3>
                <small>
                  {activeFamily.guardians.length}{" "}
                  {activeFamily.guardians.length === 1 ? "opiekun" : "opiekunów"}:{" "}
                  {activeFamily.guardians.map((g) => g.display_name).join(", ")}
                </small>
              </div>
            </div>
          </div>
        )}

        <p className="kg-hint">Dotknij rodziny, żeby zobaczyć jej kartę.</p>
      </div>

      {toast && (
        <div className="kg-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
