import { useState, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Muzyczna Wioska — krąg grupy z wymianą rzeczy                       */
/* ------------------------------------------------------------------ */

const CSS = `
:root{
  --cream:#F4F8F0;
  --paper:#FFFFFF;
  --ink:#1E2E27;
  --ink-soft:#5C7069;
  --mint:#1B8168;
  --mint-bright:#3FB68F;
  --mint-soft:#D8F0E6;
  --sage:#5D8A63;
  --sage-soft:#DFEBDC;
  --teal:#6FB6B8;
  --teal-soft:#D9ECEC;
  --lime:#A9C24F;
  --lime-soft:#EAF2CE;
  --line:#E2EADF;
}
*,*::before,*::after{box-sizing:border-box;}

.kg-stage{
  background:#EDF1EA;min-height:100vh;display:flex;justify-content:center;
  font-family:Karla,"Segoe UI",system-ui,sans-serif;color:var(--ink);
  -webkit-font-smoothing:antialiased;
}
.kg-app{
  width:100%;max-width:430px;background:var(--cream);
  display:flex;flex-direction:column;min-height:100vh;
}
.kg-app h1,.kg-app h2,.kg-app h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.02em;line-height:1.12;margin:0;}
.kg-app p{margin:0;line-height:1.6;}
.kg-app button{font-family:inherit;cursor:pointer;}

/* ---------- nagłówek grupy ---------- */
.kg-head{
  background:var(--paper);border-bottom:1px solid var(--line);
  padding:18px 18px 16px;position:sticky;top:0;z-index:20;
}
.kg-head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.kg-eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;font-weight:800;color:var(--sage);}
.kg-head h1{font-size:23px;margin-top:5px;}
.kg-head-sub{font-size:13.5px;color:var(--ink-soft);margin-top:4px;}
.kg-icon-btn{
  width:40px;height:40px;border-radius:14px;border:1px solid var(--line);background:var(--cream);
  display:inline-flex;align-items:center;justify-content:center;flex:none;transition:background .16s;
}
.kg-icon-btn:hover{background:var(--mint-soft);}

/* ---------- filtry ---------- */
.kg-filters{display:flex;gap:8px;margin-top:14px;overflow-x:auto;scrollbar-width:none;}
.kg-filters::-webkit-scrollbar{display:none;}
.kg-f{
  flex:none;border:1px solid var(--line);background:var(--cream);color:var(--ink-soft);
  border-radius:999px;padding:8px 14px;font-size:13px;font-weight:700;
  display:inline-flex;align-items:center;gap:7px;transition:all .16s ease;
}
.kg-f svg{width:15px;height:15px;}
.kg-f:hover{border-color:var(--sage);}
.kg-f.is-on{background:var(--ink);border-color:var(--ink);color:#EAF2E9;}
.kg-f-count{
  background:var(--lime);color:#33430E;border-radius:999px;font-size:11px;font-weight:800;
  min-width:19px;height:19px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;
}
.kg-f.is-on .kg-f-count{background:var(--mint-bright);color:#0E3B2E;}

/* ---------- krąg ---------- */
.kg-circle-wrap{padding:26px 18px 6px;}
.kg-stagebox{position:relative;width:100%;max-width:360px;margin:0 auto;}
.kg-square{position:relative;width:100%;padding-top:100%;}
.kg-inner{position:absolute;inset:0;}
.kg-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
.kg-dash{transform-origin:50% 50%;animation:kg-spin 110s linear infinite;}
@keyframes kg-spin{to{transform:rotate(360deg)}}

.kg-fam{
  position:absolute;transform:translate(-50%,-50%);background:none;border:none;padding:0;
  transition:opacity .25s ease,filter .25s ease;
}
.kg-fam.is-dim{opacity:.3;filter:saturate(.35);}
.kg-av{
  position:relative;width:52px;height:52px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:800;font-size:14.5px;border:3px solid var(--cream);
  box-shadow:0 8px 18px -10px rgba(30,46,39,.7);
  transition:transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .22s ease;
}
.kg-fam:hover .kg-av{transform:scale(1.09);}
.kg-fam:focus-visible{outline:none;}
.kg-fam:focus-visible .kg-av{outline:3px solid var(--teal);outline-offset:3px;}
.kg-fam.is-on .kg-av{transform:scale(1.1);box-shadow:0 0 0 4px var(--mint-soft),0 8px 18px -10px rgba(30,46,39,.7);}

/* plakietka wymiany na awatarze */
.kg-mark{
  position:absolute;right:-5px;bottom:-5px;width:23px;height:23px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;border:2.5px solid var(--cream);
}
.kg-mark svg{width:12px;height:12px;}
.kg-mark-swap{background:var(--lime);}
.kg-mark-bring{background:var(--teal);}

/* pulsujący pierścień dla nowych ofert */
.kg-pulse{
  position:absolute;inset:-6px;border-radius:50%;border:2px solid var(--lime);
  animation:kg-pulse 2.6s ease-out infinite;pointer-events:none;
}
@keyframes kg-pulse{
  0%{transform:scale(.92);opacity:.85}
  70%{transform:scale(1.24);opacity:0}
  100%{opacity:0}
}

.kg-plus .kg-av{
  background:var(--cream);color:var(--mint);border:2.5px dashed var(--mint);
  font-size:24px;font-weight:400;box-shadow:none;
}

.kg-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;width:48%;}
.kg-center-av{
  width:74px;height:74px;border-radius:50%;background:var(--ink);margin:0 auto;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 14px 28px -14px rgba(30,46,39,.85);
}
.kg-center strong{display:block;margin-top:10px;font-family:Fraunces,Georgia,serif;font-size:15px;}
.kg-center span{display:block;font-size:12px;color:var(--ink-soft);}

/* ---------- kto co przynosi ---------- */
.kg-bring{
  margin:18px 18px 0;background:var(--paper);border:1px solid var(--line);
  border-radius:22px;padding:17px;animation:kg-in .25s ease;
}
.kg-bring h2{font-size:17px;}
.kg-bring-sub{font-size:12.5px;color:var(--ink-soft);margin-top:3px;}
.kg-bring-list{margin-top:12px;}
.kg-bring-item{display:flex;align-items:center;gap:11px;padding:10px 0;}
.kg-bring-item + .kg-bring-item{border-top:1px solid var(--line);}
.kg-bring-av{
  width:36px;height:36px;border-radius:50%;flex:none;color:#fff;font-weight:800;font-size:12px;
  display:flex;align-items:center;justify-content:center;
}
.kg-bring-av-empty{background:none;border:2px dashed var(--line);color:var(--ink-soft);}
.kg-bring-body{flex:1;min-width:0;}
.kg-bring-body strong{display:block;font-size:14px;}
.kg-bring-body small{display:block;color:var(--ink-soft);font-size:12px;margin-top:1px;}
.kg-bring-btn{
  flex:none;border:1.5px solid var(--mint);background:var(--paper);color:var(--mint);
  border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;transition:all .15s ease;
}
.kg-bring-btn:hover{background:var(--mint-soft);}
.kg-bring-btn.is-on{background:var(--mint);color:#fff;}
.kg-bring-empty{font-size:13px;color:var(--ink-soft);text-align:center;padding:10px 0 2px;}

/* ---------- legenda ---------- */
.kg-legend{
  display:flex;justify-content:center;gap:16px;flex-wrap:wrap;
  padding:14px 18px 0;font-size:12.5px;color:var(--ink-soft);
}
.kg-legend span{display:inline-flex;align-items:center;gap:7px;}
.kg-dot{
  width:17px;height:17px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none;
}
.kg-dot svg{width:10px;height:10px;}

/* ---------- karta rodziny ---------- */
.kg-card{
  margin:18px 18px 0;background:var(--paper);border:1px solid var(--line);
  border-radius:22px;padding:17px;animation:kg-in .25s ease;
}
@keyframes kg-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.kg-card-top{display:flex;align-items:center;gap:12px;}
.kg-card-av{
  width:44px;height:44px;border-radius:50%;flex:none;color:#fff;font-weight:800;font-size:13.5px;
  display:flex;align-items:center;justify-content:center;
}
.kg-card-top h3{font-size:17px;}
.kg-card-top small{font-size:13px;color:var(--ink-soft);}
.kg-pill{
  margin-left:auto;flex:none;background:var(--sage-soft);color:#3B5C41;
  border-radius:999px;padding:5px 11px;font-size:11.5px;font-weight:800;
}
.kg-offer{
  margin-top:14px;border:1px solid var(--line);border-radius:16px;padding:13px;
  display:flex;gap:11px;align-items:flex-start;
}
.kg-offer-ico{width:36px;height:36px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;}
.kg-offer small{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--ink-soft);}
.kg-offer strong{display:block;font-size:15px;margin-top:2px;}
.kg-offer p{font-size:13px;color:var(--ink-soft);margin-top:3px;}
.kg-acts{display:flex;gap:9px;margin-top:14px;}
.kg-btn{
  flex:1;border:none;border-radius:14px;padding:13px;font-size:14.5px;font-weight:800;
  transition:transform .16s ease;
}
.kg-btn:hover{transform:translateY(-2px);}
.kg-btn:focus-visible{outline:3px solid var(--teal);outline-offset:3px;}
.kg-btn-primary{background:var(--mint);color:#fff;box-shadow:0 7px 16px -8px rgba(27,129,104,.9);}
.kg-btn-ghost{background:var(--cream);color:var(--ink);border:1.5px solid var(--line);}

.kg-hint{text-align:center;font-size:13px;color:var(--ink-soft);padding:16px 24px 26px;}

.kg-toast{
  position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:120;
  background:var(--ink);color:#EAF2E9;border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;
  box-shadow:0 14px 30px -14px rgba(30,46,39,.9);animation:kg-in .2s ease;
}

@media (min-width:520px){
  .kg-stage{padding:26px 16px;background:#E7EDE4;}
  .kg-app{min-height:0;border-radius:34px;overflow:hidden;box-shadow:0 40px 80px -40px rgba(30,46,39,.6),0 0 0 9px #1E2E27;margin:8px 0;}
  .kg-av{width:56px;height:56px;font-size:15px;}
  .kg-center-av{width:80px;height:80px;}
}
@media (prefers-reduced-motion:reduce){
  .kg-stage *{animation:none !important;transition:none !important;}
}
`;

/* ---------------- ikony ---------------- */

const Note = ({ c = "#A9C24F", s = 30 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="8" cy="17.5" r="3.2" fill={c} />
    <circle cx="17.5" cy="15" r="3.2" fill={c} />
    <path d="M11.2 17.5V6l9.5-2.4V15" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const Swap = ({ c = "#33430E" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 8.5h13l-3.2-3.4M20 15.5H7l3.2 3.4" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Basket = ({ c = "#0E3B2E" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.5 9h17l-1.7 9.4a2.5 2.5 0 0 1-2.5 2H7.7a2.5 2.5 0 0 1-2.5-2L3.5 9Z" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />
    <path d="M8.5 9 11 3.5M15.5 9 13 3.5" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const Users = ({ c = "#1E2E27" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
    <circle cx="9" cy="8" r="3.4" stroke={c} strokeWidth="2" />
    <path d="M3 20c.6-3.2 3-5 6-5s5.4 1.8 6 5" stroke={c} strokeWidth="2" strokeLinecap="round" />
    <path d="M16.4 6.6a2.8 2.8 0 0 1 0 5.4M17.6 15c2 .4 3.2 1.9 3.5 4" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const Dots = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="5.5" r="1.9" fill="#1E2E27" />
    <circle cx="12" cy="12" r="1.9" fill="#1E2E27" />
    <circle cx="12" cy="18.5" r="1.9" fill="#1E2E27" />
  </svg>
);

/* ---------------- dane ---------------- */
/*  nazwisko: forma dopełniacza ("Rodzina Wiśniewskich"), bo "Rodzina Wiśniewscy" jest błędne  */

const FAMILIES = [
  { id: "wis", n: "Wiśniewskich", i: "WI", c: "#1B8168", kids: "Zosia, 2 lata",
    bring: "3 książeczki dźwiękowe", swap: "Książka: Pucio", mode: "wymienię", fresh: true },
  { id: "now", n: "Nowaków", i: "NO", c: "#5D8A63", kids: "Antek, 3 lata",
    bring: "Tamburyn i dzwonki", swap: "Tamburyn", mode: "pożyczę", fresh: false },
  { id: "lew", n: "Lewandowskich", i: "LE", c: "#3F8E90", kids: "Hania 2 l., Staś 4 l.",
    bring: "Koc piknikowy", swap: "Puzzle 3+", mode: "oddam", fresh: true },
  { id: "kow", n: "Kowalskich", i: "KO", c: "#7E9A34", kids: "Lena, 18 miesięcy",
    bring: "Owoce na koncert", swap: null, mode: null, fresh: false },
  { id: "zie", n: "Zielińskich", i: "ZI", c: "#2A6B58", kids: "Franek, 3 lata",
    bring: "Koc i poduszki", swap: "Książeczki kontrastowe", mode: "oddam", fresh: false },
  { id: "maz", n: "Mazurów", i: "MA", c: "#4E7D55", kids: "Iga, 2 lata",
    bring: "Mata piankowa i marakasy", swap: "Mata piankowa", mode: "pożyczę", fresh: false },
  { id: "kac", n: "Kaczmarków", i: "KA", c: "#35797B", kids: "Julia, 3 lata",
    bring: "Materiały plastyczne", swap: null, mode: null, fresh: false },
  { id: "dab", n: "Dąbrowskich", i: "DĄ", c: "#6B8A2F", kids: "Tymon, 2 lata",
    bring: null, swap: null, mode: null, fresh: false },
];

const MODE_STYLE: Record<string, { bg: string; c: string }> = {
  "wymienię": { bg: "var(--lime-soft)", c: "#56701F" },
  "pożyczę": { bg: "var(--teal-soft)", c: "#245F61" },
  "oddam": { bg: "var(--mint-soft)", c: "#12604D" },
};

/* ---------------- kto co przynosi ---------------- */
/*  lista rzeczy, których prowadząca potrzebuje na najbliższe zajęcia;
    goście mogą się zgłosić dobrowolnie, nie muszą wybierać nic  */

const NEEDED_ITEMS = ["Tamburyn i dzwonki", "Mata piankowa", "Koc piknikowy"];

type BringClaim = { by: "family" | "you"; name: string; c: string; i: string } | null;

const INITIAL_BRING_CLAIMS: Record<string, BringClaim> = {};
NEEDED_ITEMS.forEach((name) => {
  const fam = FAMILIES.find((f) => f.bring === name);
  INITIAL_BRING_CLAIMS[name] = fam ? { by: "family", name: `Rodzina ${fam.n}`, c: fam.c, i: fam.i } : null;
});

/* ---------------- komponent ---------------- */

export default function KragGrupy() {
  const [active, setActive] = useState("wis");
  const [filter, setFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [bringClaims, setBringClaims] = useState<Record<string, BringClaim>>(INITIAL_BRING_CLAIMS);

  const toggleBringClaim = (item: string) => {
    setBringClaims((c) => {
      const current = c[item];
      if (current && current.by !== "you") return c;
      return { ...c, [item]: current ? null : { by: "you", name: "Ciebie", c: "#1E2E27", i: "TY" } };
    });
  };

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

  const swapCount = FAMILIES.filter((f) => f.swap).length;
  const bringCount = FAMILIES.filter((f) => f.bring).length;

  const matches = (f: (typeof FAMILIES)[number]) =>
    filter === "all" || (filter === "swap" && f.swap) || (filter === "bring" && f.bring);

  const slots = FAMILIES.length + 1;
  const R = 38;
  const pos = (i: number) => {
    const a = (i / slots) * 2 * Math.PI - Math.PI / 2;
    return { left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` };
  };

  const fam = FAMILIES.find((f) => f.id === active) || FAMILIES[0];
  const modeStyle = (fam.mode && MODE_STYLE[fam.mode]) || { bg: "var(--line)", c: "#1E2E27" };

  return (
    <div className="kg-stage">
      <style>{CSS}</style>

      <div className="kg-app">
        {/* nagłówek */}
        <header className="kg-head">
          <div className="kg-head-row">
            <div>
              <div className="kg-eyebrow">Grupa</div>
              <h1>Muzyczne Maluchy</h1>
              <div className="kg-head-sub">Środy 16:30 · Sala nr 2 · 8 rodzin</div>
            </div>
            <button className="kg-icon-btn" aria-label="Więcej opcji" onClick={() => setToast("Menu grupy — prototyp")}>
              <Dots />
            </button>
          </div>

          <div className="kg-filters" role="tablist" aria-label="Filtr kręgu">
            <button className={`kg-f ${filter === "all" ? "is-on" : ""}`} onClick={() => setFilter("all")} aria-pressed={filter === "all"}>
              <Users c={filter === "all" ? "#EAF2E9" : "#5C7069"} /> Wszyscy
            </button>
            <button className={`kg-f ${filter === "swap" ? "is-on" : ""}`} onClick={() => setFilter("swap")} aria-pressed={filter === "swap"}>
              <Swap c={filter === "swap" ? "#EAF2E9" : "#5C7069"} /> Wymiana
              <span className="kg-f-count">{swapCount}</span>
            </button>
            <button className={`kg-f ${filter === "bring" ? "is-on" : ""}`} onClick={() => setFilter("bring")} aria-pressed={filter === "bring"}>
              <Basket c={filter === "bring" ? "#EAF2E9" : "#5C7069"} /> Przynoszą
              <span className="kg-f-count">{bringCount}</span>
            </button>
          </div>
        </header>

        {/* krąg */}
        <div className="kg-circle-wrap">
          <div className="kg-stagebox">
            <div className="kg-square">
              <div className="kg-inner">
                <svg className="kg-svg" viewBox="0 0 100 100" aria-hidden="true">
                  {FAMILIES.map((f, i) => {
                    const a = (i / slots) * 2 * Math.PI - Math.PI / 2;
                    const on = active === f.id;
                    return (
                      <line
                        key={f.id}
                        x1="50" y1="50"
                        x2={50 + R * Math.cos(a)} y2={50 + R * Math.sin(a)}
                        stroke={on ? "#1B8168" : "#CBDAC7"}
                        strokeWidth={on ? "1" : "0.45"}
                        opacity={matches(f) ? 1 : 0.3}
                      />
                    );
                  })}
                  <circle className="kg-dash" cx="50" cy="50" r={R} fill="none"
                    stroke="#CBDAC7" strokeWidth="0.7" strokeDasharray="2.4 3.4" strokeLinecap="round" />
                </svg>

                {FAMILIES.map((f, i) => (
                  <button
                    key={f.id}
                    className={`kg-fam ${active === f.id ? "is-on" : ""} ${matches(f) ? "" : "is-dim"}`}
                    style={pos(i)}
                    onClick={() => setActive(f.id)}
                    aria-pressed={active === f.id}
                    aria-label={
                      `Rodzina ${f.n}, ${f.kids}` +
                      (f.swap ? `, udostępnia: ${f.swap} — ${f.mode}` : "")
                    }
                  >
                    <span className="kg-av" style={{ background: f.c }}>
                      {f.i}
                      {f.swap && f.fresh && <span className="kg-pulse" />}
                      {f.swap && (
                        <span className="kg-mark kg-mark-swap" aria-hidden="true"><Swap /></span>
                      )}
                      {!f.swap && f.bring && (
                        <span className="kg-mark kg-mark-bring" aria-hidden="true"><Basket c="#0E3B2E" /></span>
                      )}
                    </span>
                  </button>
                ))}

                <button
                  className="kg-fam kg-plus"
                  style={pos(FAMILIES.length)}
                  onClick={() => setToast("Zaproszenie do grupy — prototyp")}
                  aria-label="Zaproś kolejną rodzinę"
                >
                  <span className="kg-av">+</span>
                </button>

                <div className="kg-center">
                  <div className="kg-center-av"><Note /></div>
                  <strong>Zuzanna Karaszewska</strong>
                  <span>prowadzi zajęcia</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* kto co przynosi */}
        <div className="kg-bring">
          <h2>Kto co przynosi</h2>
          <p className="kg-bring-sub">Te rzeczy są potrzebne na najbliższe zajęcia — zgłoś się, jeśli możesz coś przynieść. To opcjonalne.</p>
          <div className="kg-bring-list">
            {NEEDED_ITEMS.map((item) => {
              const claim = bringClaims[item];
              const isYou = claim?.by === "you";
              return (
                <div className="kg-bring-item" key={item}>
                  <span className={`kg-bring-av ${claim ? "" : "kg-bring-av-empty"}`} style={claim ? { background: claim.c } : undefined}>
                    {claim ? claim.i : "?"}
                  </span>
                  <div className="kg-bring-body">
                    <strong>{item}</strong>
                    <small>{claim ? `Przynosi: ${claim.name}` : "Jeszcze nikt się nie zgłosił"}</small>
                  </div>
                  {(!claim || isYou) && (
                    <button className={`kg-bring-btn ${isYou ? "is-on" : ""}`} onClick={() => toggleBringClaim(item)}>
                      {isYou ? "Rezygnuję" : "Ja to przyniosę"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* legenda */}
        <div className="kg-legend">
          <span>
            <i className="kg-dot" style={{ background: "var(--lime)" }}><Swap /></i>
            udostępnia rzecz
          </span>
          <span>
            <i className="kg-dot" style={{ background: "var(--teal)" }}><Basket /></i>
            przynosi na zajęcia
          </span>
        </div>

        {/* karta wybranej rodziny */}
        <div className="kg-card" key={fam.id} aria-live="polite">
          <div className="kg-card-top">
            <span className="kg-card-av" style={{ background: fam.c }}>{fam.i}</span>
            <div style={{ minWidth: 0 }}>
              <h3>Rodzina {fam.n}</h3>
              <small>{fam.kids}</small>
            </div>
            {fam.swap && modeStyle && (
              <span className="kg-pill" style={{ background: modeStyle.bg, color: modeStyle.c }}>
                {fam.mode}
              </span>
            )}
          </div>

          {fam.swap ? (
            <>
              <div className="kg-offer" style={{ background: modeStyle.bg, borderColor: "transparent" }}>
                <span className="kg-offer-ico" style={{ background: "rgba(255,255,255,.75)" }}>
                  <span style={{ width: 18, height: 18 }}><Swap c={modeStyle.c} /></span>
                </span>
                <div>
                  <small style={{ color: modeStyle.c }}>Do wymiany w grupie</small>
                  <strong>{fam.swap}</strong>
                  <p>Odbiór przy najbliższych zajęciach, w środę o 16:30.</p>
                </div>
              </div>
              <div className="kg-acts">
                <button className="kg-btn kg-btn-ghost" onClick={() => setToast("Wiadomość — prototyp")}>
                  Napisz
                </button>
                <button className="kg-btn kg-btn-primary" onClick={() => setToast(`Zgłoszono chęć: ${fam.swap}`)}>
                  {fam.mode === "pożyczę" ? "Chcę pożyczyć" : "Biorę"}
                </button>
              </div>
            </>
          ) : (
            <div className="kg-offer">
              <span className="kg-offer-ico" style={{ background: "var(--teal-soft)" }}>
                <span style={{ width: 18, height: 18 }}><Basket c="#245F61" /></span>
              </span>
              <div>
                <small>Na najbliższe zajęcia</small>
                <strong>{fam.bring || "Jeszcze nic nie zgłosili"}</strong>
                <p>{fam.bring ? "Zgłoszone przez rodzinę." : "Nowi w grupie — poznajcie się w środę."}</p>
              </div>
            </div>
          )}
        </div>

        <p className="kg-hint">
          Dotknij rodziny, żeby zobaczyć jej kartę. Zielona kropka oznacza rzecz do wymiany.
        </p>
      </div>

      {toast && <div className="kg-toast" role="status">{toast}</div>}
    </div>
  );
}