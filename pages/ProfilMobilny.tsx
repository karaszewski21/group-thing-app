import { useState, useEffect } from "react";
import { AVATAR_SRC, HERO_SRC } from "../data/photos";

/* ------------------------------------------------------------------ */
/*  Muzyczna Wioska — profil prowadzącej (układ mobilny)                */
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

.mv-stage{
  background:#EDF1EA;min-height:100vh;
  display:flex;justify-content:center;padding:0;
  font-family:Karla,"Segoe UI",system-ui,sans-serif;color:var(--ink);
  -webkit-font-smoothing:antialiased;
}
.mv-phone{
  width:100%;max-width:430px;background:var(--cream);position:relative;
  display:flex;flex-direction:column;min-height:100vh;
}
.mv-phone h1,.mv-phone h2,.mv-phone h3{
  font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.02em;line-height:1.12;margin:0;
}
.mv-phone p{margin:0;line-height:1.6;}
.mv-phone ul{margin:0;padding:0;list-style:none;}
.mv-phone button{font-family:inherit;cursor:pointer;}

/* ---------- hero ---------- */
.mv-hero{position:relative;height:330px;flex:none;overflow:hidden;}
.mv-hero-art{position:absolute;inset:0;width:100%;height:100%;}
.mv-hero-art img{width:100%;height:100%;object-fit:cover;display:block;}
.mv-hero-shade{
  position:absolute;inset:0;
  background:linear-gradient(to bottom,rgba(30,46,39,.34) 0%,rgba(30,46,39,0) 34%,rgba(30,46,39,.12) 55%,rgba(30,46,39,.72) 100%);
}
.mv-hero-bar{
  position:absolute;top:0;left:0;right:0;z-index:4;
  display:flex;align-items:center;justify-content:space-between;padding:18px 18px 0;
}
.mv-round{
  border:none;background:rgba(255,255,255,.94);border-radius:999px;
  height:42px;display:inline-flex;align-items:center;gap:8px;padding:0 17px;
  font-weight:700;font-size:14.5px;color:var(--ink);
  box-shadow:0 6px 18px -8px rgba(30,46,39,.5);
  transition:transform .16s ease,background .16s ease;
}
.mv-round:hover{transform:translateY(-1px);background:#fff;}
.mv-round:focus-visible{outline:3px solid var(--mint-bright);outline-offset:3px;}
.mv-square{width:42px;padding:0;justify-content:center;border-radius:14px;}

.mv-hero-title{position:absolute;left:20px;right:20px;bottom:96px;z-index:3;color:#fff;}
.mv-hero-title h1{font-size:34px;color:#fff;text-shadow:0 3px 20px rgba(30,46,39,.45);}
.mv-hero-title p{
  font-size:14.5px;margin-top:7px;color:rgba(255,255,255,.92);
  text-shadow:0 2px 12px rgba(30,46,39,.55);
}

/* ---------- pasek miniatur ---------- */
.mv-thumbs{
  position:absolute;left:0;right:0;bottom:14px;z-index:3;
  display:flex;gap:9px;padding:0 20px;overflow-x:auto;scrollbar-width:none;
}
.mv-thumbs::-webkit-scrollbar{display:none;}
.mv-thumb{
  flex:none;width:70px;height:62px;border-radius:14px;border:2.5px solid rgba(255,255,255,.75);
  overflow:hidden;padding:0;background:none;position:relative;
  box-shadow:0 8px 20px -10px rgba(30,46,39,.7);
  transition:transform .18s ease,border-color .18s ease;
}
.mv-thumb:hover{transform:translateY(-3px);}
.mv-thumb.is-on{border-color:#fff;transform:translateY(-4px);}
.mv-thumb.is-on::after{
  content:"";position:absolute;inset:0;border-radius:11px;box-shadow:inset 0 0 0 2px var(--mint-bright);
}
.mv-thumb svg,.mv-thumb img{width:100%;height:100%;display:block;object-fit:cover;}
.mv-name-row{display:flex;align-items:center;gap:10px;}
.mv-avatar{
  width:68px;height:68px;border-radius:999px;object-fit:cover;flex:none;
  border:3px solid rgba(255,255,255,.85);box-shadow:0 4px 14px -6px rgba(30,46,39,.6);
}

/* ---------- karta treści ---------- */
.mv-sheet{
  background:var(--cream);border-radius:26px 26px 0 0;margin-top:-22px;
  position:relative;z-index:5;flex:1;padding:22px 18px 26px;
}

/* ---------- pasek statystyk ---------- */
.mv-stats{display:flex;gap:9px;}
.mv-stat{
  flex:1;background:var(--paper);border:1px solid var(--line);border-radius:18px;
  padding:11px 10px;display:flex;align-items:center;gap:9px;min-width:0;
}
.mv-stat-ico{
  width:32px;height:32px;border-radius:11px;flex:none;
  display:flex;align-items:center;justify-content:center;
}
.mv-stat-ico svg{width:17px;height:17px;}
.mv-stat small{display:block;font-size:10.5px;color:var(--ink-soft);letter-spacing:.03em;}
.mv-stat b{display:block;font-size:13.5px;line-height:1.25;}
.mv-stat-btn{border:1px solid var(--line);text-align:left;transition:transform .16s ease,background .16s ease;}
.mv-stat-btn:hover{background:var(--lime-soft);transform:translateY(-1px);}
.mv-stat-btn:focus-visible{outline:3px solid var(--mint-bright);outline-offset:2px;}

/* ---------- wymiana rzeczy ---------- */
.mv-exchange{display:flex;gap:9px;}
.mv-exchange-card{
  flex:1;border-radius:16px;padding:14px 10px;display:flex;flex-direction:column;
  align-items:flex-start;gap:6px;min-width:0;
}
.mv-exchange-ico{
  width:30px;height:30px;border-radius:10px;background:rgba(255,255,255,.6);
  display:flex;align-items:center;justify-content:center;
}
.mv-exchange-ico svg{width:16px;height:16px;}
.mv-exchange-card b{font-family:Fraunces,Georgia,serif;font-size:27px;line-height:1;}
.mv-exchange-card small{font-size:12px;font-weight:800;letter-spacing:.01em;}

/* ---------- zakładki ---------- */
.mv-tabs{display:flex;gap:22px;margin-top:24px;border-bottom:1px solid var(--line);}
.mv-tab{
  background:none;border:none;padding:0 0 12px;font-size:16px;font-weight:700;
  color:var(--ink-soft);position:relative;display:flex;align-items:center;gap:7px;
}
.mv-tab.is-on{color:var(--ink);}
.mv-tab.is-on::after{
  content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;
  border-radius:3px;background:var(--mint);
}
.mv-badge{
  background:var(--lime);color:#33430E;border-radius:999px;
  font-size:11.5px;font-weight:800;min-width:20px;height:20px;
  display:inline-flex;align-items:center;justify-content:center;padding:0 6px;
}

.mv-body{padding-top:18px;font-size:15.5px;color:var(--ink-soft);}
.mv-body p + p{margin-top:13px;}
.mv-hl{color:var(--mint);font-weight:700;}

/* ---------- tagi ---------- */
.mv-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;}
.mv-tag{
  background:var(--sage-soft);color:#3B5C41;border-radius:999px;
  padding:6px 12px;font-size:12.5px;font-weight:700;
}

/* ---------- grupy ---------- */
.mv-group{
  background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:15px;
  display:flex;gap:13px;align-items:flex-start;transition:transform .18s ease,border-color .18s ease;
}
.mv-group + .mv-group{margin-top:11px;}
.mv-group:hover{transform:translateY(-3px);border-color:#C9DBC6;}
.mv-group-ico{width:44px;height:44px;border-radius:15px;flex:none;display:flex;align-items:center;justify-content:center;}
.mv-group h3{font-size:16.5px;}
.mv-group small{display:block;font-size:13px;color:var(--ink-soft);margin-top:3px;}
.mv-slot{
  font-size:11.5px;font-weight:800;border-radius:999px;padding:4px 10px;margin-top:9px;
  display:inline-block;background:var(--mint-soft);color:#12604D;
}
.mv-slot.is-full{background:var(--line);color:var(--ink-soft);}

/* ---------- opinie ---------- */
.mv-quote{background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:17px;}
.mv-quote + .mv-quote{margin-top:11px;}
.mv-quote p{font-size:15px;color:var(--ink);}
.mv-who{display:flex;align-items:center;gap:10px;margin-top:13px;}
.mv-av{
  width:36px;height:36px;border-radius:50%;flex:none;color:#fff;font-weight:700;font-size:12.5px;
  display:flex;align-items:center;justify-content:center;
}
.mv-who strong{font-size:13.5px;display:block;}
.mv-who small{font-size:12px;color:var(--ink-soft);}
.mv-stars{display:flex;gap:3px;margin-bottom:9px;}

/* ---------- terminy ---------- */
.mv-date{display:flex;align-items:center;gap:13px;padding:12px 0;}
.mv-date + .mv-date{border-top:1px dashed var(--line);}
.mv-day{
  width:48px;height:52px;border-radius:15px;flex:none;background:var(--lime-soft);
  display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;
}
.mv-day b{font-family:Fraunces,Georgia,serif;font-size:18px;}
.mv-day small{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#56701F;}
.mv-date strong{font-size:15px;display:block;}
.mv-date small{font-size:13px;color:var(--ink-soft);}

/* ---------- dolny pasek ---------- */
.mv-bottom{
  position:sticky;bottom:0;z-index:20;background:var(--paper);
  border-top:1px solid var(--line);padding:14px 18px calc(14px + env(safe-area-inset-bottom));
  display:flex;align-items:center;justify-content:space-between;gap:14px;
  box-shadow:0 -10px 30px -22px rgba(30,46,39,.7);
}
.mv-price small{display:block;font-size:11.5px;color:var(--ink-soft);letter-spacing:.04em;}
.mv-price b{font-family:Fraunces,Georgia,serif;font-size:25px;line-height:1.1;display:block;}
.mv-cta{
  border:none;background:var(--mint);color:#fff;border-radius:16px;
  padding:15px 26px;font-size:16px;font-weight:800;flex:none;
  box-shadow:0 8px 20px -10px rgba(27,129,104,.9);
  transition:transform .16s ease;
}
.mv-cta:hover{transform:translateY(-2px);}
.mv-cta:focus-visible{outline:3px solid var(--teal);outline-offset:3px;}

/* ---------- modal ---------- */
.mv-overlay{
  position:fixed;inset:0;z-index:100;background:rgba(30,46,39,.5);
  display:flex;align-items:flex-end;justify-content:center;animation:mv-fade .18s ease;
}
.mv-modal{
  background:var(--paper);width:100%;max-width:430px;border-radius:26px 26px 0 0;
  padding:24px 20px 26px;animation:mv-up .26s cubic-bezier(.2,.8,.2,1);max-height:90vh;overflow-y:auto;
}
.mv-field{margin-top:13px;}
.mv-field label{display:block;font-size:13px;font-weight:700;margin-bottom:6px;}
.mv-field input,.mv-field textarea{
  width:100%;padding:12px 14px;border-radius:14px;border:2px solid var(--line);
  background:var(--cream);font-family:inherit;font-size:16px;color:var(--ink);resize:vertical;
}
.mv-field input:focus,.mv-field textarea:focus{outline:none;border-color:var(--sage);background:#fff;}
.mv-close{background:none;border:none;font-size:24px;color:var(--ink-soft);padding:4px 8px;border-radius:10px;}
.mv-close:hover{background:var(--cream);color:var(--ink);}
.mv-toast{
  position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:120;
  background:var(--ink);color:#EAF2E9;border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;
  box-shadow:0 14px 30px -14px rgba(30,46,39,.9);animation:mv-up .2s ease;
}

@keyframes mv-fade{from{opacity:0}to{opacity:1}}
@keyframes mv-up{from{transform:translateY(18px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes mv-sway{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.mv-sway{animation:mv-sway 6s ease-in-out infinite;}

.mv-fade-in{animation:mv-fade .3s ease;}

@media (min-width:520px){
  .mv-stage{padding:26px 16px;background:#E7EDE4;}
  .mv-phone{
    min-height:0;border-radius:34px;overflow:hidden;
    box-shadow:0 40px 80px -40px rgba(30,46,39,.6),0 0 0 9px #1E2E27;
    margin:8px 0;
  }
  .mv-hero{border-radius:0;}
}
@media (prefers-reduced-motion:reduce){
  .mv-stage *{animation:none !important;transition:none !important;}
}
`;

/* ---------------- ikony ---------------- */

const Pin = ({ c = "#12604D" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />
    <circle cx="12" cy="10" r="2.5" stroke={c} strokeWidth="2.2" />
  </svg>
);
const People = ({ c = "#245F61" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="9" cy="8" r="3.6" stroke={c} strokeWidth="2.2" />
    <path d="M2.8 20c.6-3.4 3.1-5.3 6.2-5.3s5.6 1.9 6.2 5.3" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
    <path d="M16.6 6.4a2.9 2.9 0 0 1 0 5.6M18 14.9c2.2.4 3.5 2 3.8 4.3" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const Back = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M15 5 8 12l7 7" stroke="#1E2E27" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Share = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="17.5" cy="6" r="2.6" stroke="#1E2E27" strokeWidth="2" />
    <circle cx="6.5" cy="12" r="2.6" stroke="#1E2E27" strokeWidth="2" />
    <circle cx="17.5" cy="18" r="2.6" stroke="#1E2E27" strokeWidth="2" />
    <path d="m9 10.7 6-3.4M9 13.3l6 3.4" stroke="#1E2E27" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const GiftIcon = ({ c = "#12604D" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3.5" y="9" width="17" height="11" rx="2" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />
    <path d="M3.5 9h17M12 9v11" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
    <path d="M12 9C9.5 9 8 7.6 8 6a2 2 0 0 1 4 0 2 2 0 0 1 4 0c0 1.6-1.5 3-4 3Z" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />
  </svg>
);
const SwapIcon = ({ c = "#33430E" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 8.5h13l-3.2-3.4M20 15.5H7l3.2 3.4" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const BasketIcon = ({ c = "#0E3B2E" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.5 9h17l-1.7 9.4a2.5 2.5 0 0 1-2.5 2H7.7a2.5 2.5 0 0 1-2.5-2L3.5 9Z" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />
    <path d="M8.5 9 11 3.5M15.5 9 13 3.5" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const GalleryIcon = ({ c = "#56701F", s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4" width="18" height="15" rx="3" stroke={c} strokeWidth="2" />
    <circle cx="8.5" cy="9.5" r="1.6" fill={c} />
    <path d="m4 16 5-5 4 4 3-3 4 4" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ---------------- dane ---------------- */

const DATES = [
  { d: "27", m: "sie", t: "Muzyczne Maluchy", s: "16:30 · Sala nr 2 · zostały 2 miejsca" },
  { d: "30", m: "sie", t: "Rytmy i grzechotki", s: "10:00 · zajęcia otwarte" },
  { d: "14", m: "wrz", t: "Koncert rodzinny", s: "17:00 · Park Sołacki · wstęp wolny" },
];

const EXCHANGE = [
  { label: "Oddam", count: 3, bg: "var(--mint-soft)", c: "#12604D", Icon: GiftIcon },
  { label: "Wymienię", count: 4, bg: "var(--lime-soft)", c: "#56701F", Icon: SwapIcon },
  { label: "Wypożyczę", count: 0, bg: "var(--teal-soft)", c: "#245F61", Icon: BasketIcon },
];

/* ---------------- strona ---------------- */

export default function ProfilMobilny({ onOpenGallery }: { onOpenGallery: () => void }) {
  const [toast, setToast] = useState("");

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

  const share = () => {
    if (navigator.clipboard) navigator.clipboard.writeText("https://muzyczna-wioska.pl/rodzinny-grajdolek").catch(() => {});
    setToast("Link do profilu skopiowany");
  };

  return (
    <div className="mv-stage">
      <style>{CSS}</style>

      <div className="mv-phone">
        {/* ---------- hero ---------- */}
        <div className="mv-hero">
          <div className="mv-hero-art"><img src={HERO_SRC} alt="Rodzinny grajdołek" /></div>
          <div className="mv-hero-shade" />

          <div className="mv-hero-bar">
            <button className="mv-round" onClick={() => setToast("Powrót — prototyp")}>
              <Back /> Wróć
            </button>
            <button className="mv-round mv-square" onClick={share} aria-label="Udostępnij profil">
              <Share />
            </button>
          </div>

          <div className="mv-hero-title">
            <div className="mv-name-row">
              <img className="mv-avatar" src={AVATAR_SRC} alt="Rodzinny grajdołek" />
              <h1>Rodzinny grajdołek</h1>
            </div>
            <p>Zajęcia umuzykalniające dla dzieci 0–6 lat · Poznań, Jeżyce</p>
          </div>
        </div>

        {/* ---------- treść ---------- */}
        <div className="mv-sheet">
          <div className="mv-stats">
            <div className="mv-stat">
              <span className="mv-stat-ico" style={{ background: "var(--mint-soft)" }}><Pin /></span>
              <span><small>Miejsce</small><b>Jeżyce</b></span>
            </div>
            <div className="mv-stat">
              <span className="mv-stat-ico" style={{ background: "var(--teal-soft)" }}><People /></span>
              <span><small>Rodziny</small><b>32</b></span>
            </div>
            <button className="mv-stat mv-stat-btn" onClick={onOpenGallery}>
              <span className="mv-stat-ico" style={{ background: "var(--lime-soft)" }}><GalleryIcon /></span>
              <span><small>Zobacz</small><b>Galeria</b></span>
            </button>
          </div>

          <div className="mv-body mv-fade-in">
            <p>
              Zaczęłam od <span className="mv-hl">jednej grupy w salce na Jeżycach</span>, bo szukałam
              zajęć dla własnego syna i nie znalazłam takich, na jakich chciałabym siedzieć razem z nim.
              Dziś prowadzę trzy grupy, ale zasada została ta sama: mała grupa, dorosły siedzi na
              podłodze razem z dzieckiem, a <span className="mv-hl">instrument dostaje każdy</span>,
              kto po niego sięgnie.
            </p>
            <p>
              Pracuję <span className="mv-hl">metodą Gordona</span> i elementami Orffa — w praktyce
              znaczy to, że więcej śpiewamy niż tłumaczymy. Nie robimy występów dla rodziców,
              bo rodzice już tu są.
            </p>

            <h3 style={{ fontSize: 17, marginTop: 24, marginBottom: 4, color: "var(--ink)" }}>Najbliższe terminy</h3>
            {DATES.map((d) => (
              <div className="mv-date" key={d.d + d.t}>
                <div className="mv-day"><b>{d.d}</b><small>{d.m}</small></div>
                <div><strong>{d.t}</strong><small>{d.s}</small></div>
              </div>
            ))}

            <h3 style={{ fontSize: 17, marginTop: 24, marginBottom: 10, color: "var(--ink)" }}>Wymiana rzeczy</h3>
            <div className="mv-exchange">
              {EXCHANGE.map((e) => (
                <div className="mv-exchange-card" style={{ background: e.bg }} key={e.label}>
                  <span className="mv-exchange-ico"><e.Icon c={e.c} /></span>
                  <b style={{ color: e.c }}>{e.count}</b>
                  <small style={{ color: e.c }}>{e.label}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="mv-toast" role="status">{toast}</div>}
    </div>
  );
}