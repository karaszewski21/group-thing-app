import { useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Rodzinny grajdołek — strona główna (landing page)                   */
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

.lp-page{
  background:var(--cream);color:var(--ink);
  font-family:Karla,"Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;justify-content:center;
}
.lp-shell{width:100%;max-width:1440px;}
.lp-page h1,.lp-page h2,.lp-page h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.02em;line-height:1.1;margin:0;}
.lp-page p{margin:0;line-height:1.6;}
.lp-page button{font-family:inherit;cursor:pointer;}
.lp-wrap{max-width:1120px;margin:0 auto;padding:0 24px;}

/* ---------- topbar ---------- */
.lp-top{
  position:sticky;top:0;z-index:30;background:rgba(244,248,240,.9);backdrop-filter:blur(6px);
  border-bottom:1px solid var(--line);
}
.lp-top-inner{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;max-width:1120px;margin:0 auto;}
.lp-brand{display:flex;align-items:center;gap:10px;font-family:Fraunces,Georgia,serif;font-weight:600;font-size:19px;}
.lp-brand-dot{width:12px;height:12px;border-radius:50%;background:var(--mint);flex:none;}
.lp-top-cta{
  border:none;background:var(--ink);color:#EAF2E9;border-radius:999px;padding:11px 20px;
  font-size:13.5px;font-weight:800;transition:transform .15s ease;
}
.lp-top-cta:hover{transform:translateY(-2px);}

/* ---------- hero ---------- */
.lp-hero{position:relative;overflow:hidden;}
.lp-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.lp-hero-shade{
  position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(30,46,39,.55) 0%,rgba(30,46,39,.72) 55%,rgba(30,46,39,.86) 100%);
}
.lp-hero-inner{position:relative;padding:96px 24px 88px;max-width:1120px;margin:0 auto;color:#fff;}
.lp-eyebrow{
  font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;color:var(--lime);
  display:inline-flex;align-items:center;gap:8px;
}
.lp-hero h1{font-size:clamp(34px,6vw,58px);margin-top:14px;max-width:16ch;text-shadow:0 4px 30px rgba(0,0,0,.25);}
.lp-hero p.lp-lede{
  font-size:clamp(15px,2vw,18.5px);color:rgba(255,255,255,.92);margin-top:18px;max-width:52ch;line-height:1.6;
}
.lp-hero-ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:32px;}
.lp-btn{
  border:none;border-radius:999px;padding:14px 24px;font-size:14.5px;font-weight:800;
  transition:transform .16s ease,box-shadow .16s ease;
}
.lp-btn:hover{transform:translateY(-2px);}
.lp-btn-primary{background:var(--mint-bright);color:#0E3B2E;box-shadow:0 12px 26px -12px rgba(63,182,143,.7);}
.lp-btn-ghost{background:rgba(255,255,255,.14);color:#fff;border:1.5px solid rgba(255,255,255,.55);}
.lp-btn-ghost:hover{background:rgba(255,255,255,.24);}

/* ---------- pasek haseł ---------- */
.lp-tickerbar{background:var(--ink);color:#EAF2E9;padding:14px 0;}
.lp-ticker{
  display:flex;gap:44px;white-space:nowrap;font-size:13.5px;font-weight:700;letter-spacing:.02em;
  animation:lp-scroll 26s linear infinite;width:max-content;
}
.lp-ticker span{opacity:.9;}
.lp-ticker span b{color:var(--lime);font-weight:800;}
@keyframes lp-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.lp-ticker{animation:none;}}

/* ---------- sekcje ---------- */
.lp-section{padding:76px 24px;}
.lp-section.is-alt{background:var(--paper);}
.lp-section-head{max-width:640px;margin:0 auto 44px;text-align:center;}
.lp-section-head .lp-eyebrow{color:var(--sage);}
.lp-section-head h2{font-size:clamp(26px,4vw,36px);margin-top:12px;}
.lp-section-head p{color:var(--ink-soft);margin-top:14px;font-size:15.5px;}

.lp-intro{display:grid;grid-template-columns:1.1fr .9fr;gap:52px;align-items:center;}
@media (max-width:820px){.lp-intro{grid-template-columns:1fr;}}
.lp-intro-photo{border-radius:26px;overflow:hidden;box-shadow:0 30px 60px -30px rgba(30,46,39,.4);}
.lp-intro-photo img{width:100%;height:100%;object-fit:cover;display:block;aspect-ratio:4/3;}
.lp-intro-text h2{font-size:clamp(24px,3.4vw,32px);}
.lp-intro-text p{color:var(--ink-soft);margin-top:16px;font-size:15.5px;}
.lp-intro-text p + p{margin-top:12px;}
.lp-intro-tag{
  display:inline-block;margin-top:20px;background:var(--lime-soft);color:#56701F;
  border-radius:999px;padding:9px 16px;font-size:13px;font-weight:800;
}

/* ---------- karty funkcji ---------- */
.lp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;max-width:1120px;margin:0 auto;}
.lp-card{
  background:var(--paper);border:1px solid var(--line);border-radius:24px;overflow:hidden;
  display:flex;flex-direction:column;transition:transform .18s ease,box-shadow .18s ease;text-align:left;
}
.lp-card:hover{transform:translateY(-4px);box-shadow:0 24px 50px -28px rgba(30,46,39,.35);}
.lp-card-photo{aspect-ratio:16/10;overflow:hidden;background:var(--mint-soft);}
.lp-card-photo img{width:100%;height:100%;object-fit:cover;display:block;}
.lp-card-body{padding:22px;flex:1;display:flex;flex-direction:column;gap:10px;}
.lp-card-body h3{font-size:19px;}
.lp-card-body p{color:var(--ink-soft);font-size:14px;flex:1;}
.lp-card-link{
  align-self:flex-start;border:none;background:none;color:var(--mint);font-weight:800;font-size:13.5px;
  display:inline-flex;align-items:center;gap:6px;padding:4px 0;margin-top:4px;
}
.lp-card-link:hover{text-decoration:underline;}

/* ---------- jak to działa ---------- */
.lp-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:1120px;margin:0 auto;}
@media (max-width:760px){.lp-steps{grid-template-columns:1fr;}}
.lp-step{background:var(--cream);border:1.5px dashed var(--line);border-radius:22px;padding:26px 22px;}
.lp-step-num{
  width:38px;height:38px;border-radius:12px;background:var(--mint);color:#fff;font-family:Fraunces,Georgia,serif;
  font-weight:700;display:flex;align-items:center;justify-content:center;font-size:17px;margin-bottom:14px;
}
.lp-step h3{font-size:17px;}
.lp-step p{color:var(--ink-soft);margin-top:8px;font-size:14px;}

/* ---------- cytat ---------- */
.lp-quote{
  max-width:760px;margin:0 auto;text-align:center;padding:0 24px;
}
.lp-quote blockquote{
  font-family:Fraunces,Georgia,serif;font-size:clamp(20px,3vw,28px);font-weight:500;line-height:1.4;color:var(--ink);margin:0;
}
.lp-quote-who{margin-top:20px;display:flex;align-items:center;justify-content:center;gap:12px;}
.lp-quote-av{width:44px;height:44px;border-radius:50%;object-fit:cover;}
.lp-quote-who small{display:block;color:var(--ink-soft);font-size:13px;}

/* ---------- cta stopka ---------- */
.lp-cta{
  background:linear-gradient(135deg,#123B31,#1B8168 65%,#3FB68F);color:#fff;
  border-radius:32px;padding:56px 36px;text-align:center;max-width:1120px;margin:0 auto;
}
.lp-cta h2{font-size:clamp(26px,4vw,36px);}
.lp-cta p{color:rgba(255,255,255,.88);margin-top:14px;max-width:48ch;margin-left:auto;margin-right:auto;font-size:15.5px;}
.lp-cta-ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:28px;}

.lp-footer{padding:32px 24px 44px;text-align:center;color:var(--ink-soft);font-size:13px;}
`;

/* ---------------- ikony ---------------- */

const NoteIcon = ({ c = "#3FB68F" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="8" cy="17.5" r="3.2" fill={c} />
    <circle cx="17.5" cy="15" r="3.2" fill={c} />
    <path d="M11.2 17.5V6l9.5-2.4V15" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const ArrowIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ---------------- dane ---------------- */

const FEATURES = [
  {
    key: "profil",
    title: "Profil prowadzącej",
    desc: "Poznaj Zuzannę, zobacz galerię z zajęć i dowiedz się, jak wygląda typowe spotkanie.",
    photo: "https://picsum.photos/seed/rg-profil/500/320",
  },
  {
    key: "krag",
    title: "Krąg grupy",
    desc: "Zobacz, kto jest w Waszej grupie, kto co przynosi i co można wymienić na najbliższych zajęciach.",
    photo: "https://picsum.photos/seed/rg-krag/500/320",
  },
  {
    key: "panel",
    title: "Panel organizatora",
    desc: "Zarządzaj grupami, terminami i rzeczami do wymiany — wszystko z telefonu, w kilka dotknięć.",
    photo: "https://picsum.photos/seed/rg-panel/500/320",
  },
  {
    key: "gosc",
    title: "Panel gościa",
    desc: "Twoje zajęcia, Twoje rzeczy i podarki od innych rodzin — w jednym, prostym miejscu.",
    photo: "https://picsum.photos/seed/rg-gosc/500/320",
  },
] as const;

const STEPS = [
  { n: "1", title: "Zapisujesz się do grupy", desc: "Wybierasz zajęcia dopasowane do wieku dziecka i zapisujesz się w kilka sekund." },
  { n: "2", title: "Dołączasz do kręgu", desc: "Poznajesz inne rodziny, widzisz kto co przynosi i czym można się wymienić." },
  { n: "3", title: "Bawicie się i wymieniacie", desc: "Mniej kupowania, więcej pożyczania — grzechotki, maty i książeczki krążą między rodzinami." },
];

/* ---------------- komponent ---------------- */

export default function StronaGlowna({
  onOpenProfil,
  onOpenKrag,
  onOpenPanelOrganizatora,
  onOpenPanelGoscia,
}: {
  onOpenProfil: () => void;
  onOpenKrag: () => void;
  onOpenPanelOrganizatora: () => void;
  onOpenPanelGoscia: () => void;
}) {
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

  const goTo = (key: (typeof FEATURES)[number]["key"]) => {
    if (key === "profil") onOpenProfil();
    else if (key === "krag") onOpenKrag();
    else if (key === "panel") onOpenPanelOrganizatora();
    else onOpenPanelGoscia();
  };

  return (
    <div className="lp-page">
      <style>{CSS}</style>
      <div className="lp-shell">

      {/* topbar */}
      <div className="lp-top">
        <div className="lp-top-inner">
          <div className="lp-brand">
            <span className="lp-brand-dot" />
            Rodzinny grajdołek
          </div>
          <button className="lp-top-cta" onClick={onOpenPanelGoscia}>Wejdź do panelu</button>
        </div>
      </div>

      {/* hero */}
      <section className="lp-hero">
        <img className="lp-hero-img" src="https://picsum.photos/seed/rg-hero/1600/900" alt="" />
        <div className="lp-hero-shade" />
        <div className="lp-hero-inner">
          <span className="lp-eyebrow"><NoteIcon /> Zajęcia umuzykalniające 0–6 lat · Poznań, Jeżyce</span>
          <h1>Nie tylko zajęcia. Wspólnota, która się wymienia.</h1>
          <p className="lp-lede">
            Rodzinny grajdołek to aplikacja dla grup umuzykalniających — łączy profil prowadzącej,
            żywy krąg rodzin i panele, w których każdy wie, co się dzieje: kto przychodzi,
            czego potrzeba na zajęcia i co akurat krąży między rodzinami.
          </p>
          <div className="lp-hero-ctas">
            <button className="lp-btn lp-btn-primary" onClick={onOpenProfil}>Poznaj prowadzącą</button>
            <button className="lp-btn lp-btn-ghost" onClick={onOpenKrag}>Zobacz krąg grupy</button>
          </div>
        </div>
      </section>

      {/* pasek haseł */}
      <div className="lp-tickerbar">
        <div className="lp-wrap" style={{ overflow: "hidden" }}>
          <div className="lp-ticker">
            {Array.from({ length: 2 }).map((_, rep) => (
              <div key={rep} style={{ display: "flex", gap: 44 }}>
                <span>Mniej kupowania, <b>więcej wymieniania</b></span>
                <span>Muzyka, która <b>łączy rodziny</b></span>
                <span>Wszystko o grupie <b>w jednym miejscu</b></span>
                <span>Zapisz się, zaprzyjaźnij się, <b>wymień się</b></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* czym jest */}
      <section className="lp-section is-alt">
        <div className="lp-wrap lp-intro">
          <div className="lp-intro-photo">
            <img src="https://picsum.photos/seed/rg-wioska/700/525" alt="" />
          </div>
          <div className="lp-intro-text">
            <span className="lp-eyebrow">Czym jest Rodzinny grajdołek?</span>
            <h2 style={{ marginTop: 12 }}>To nie jest zwykły grafik zajęć.</h2>
            <p>
              To miejsce, w którym rodziny naprawdę się poznają — dzielą się grzechotkami, matami
              i strojami na koncert, umawiają się na zamianę i pomagają sobie nawzajem.
            </p>
            <p>
              A prowadząca ma wszystko pod ręką: grupy, najbliższe terminy i listę rzeczy,
              których potrzebuje na kolejne spotkanie.
            </p>
            <span className="lp-intro-tag">Pierwsze zajęcia zawsze bezpłatne</span>
          </div>
        </div>
      </section>

      {/* funkcje */}
      <section className="lp-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Co znajdziesz w aplikacji</span>
          <h2>Cztery miejsca, jedna wspólnota</h2>
          <p>Dla rodziców i dla prowadzącej — każdy widzi to, czego potrzebuje.</p>
        </div>
        <div className="lp-wrap">
          <div className="lp-grid">
            {FEATURES.map((f) => (
              <div className="lp-card" key={f.key}>
                <div className="lp-card-photo">
                  <img src={f.photo} alt="" />
                </div>
                <div className="lp-card-body">
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                  <button className="lp-card-link" onClick={() => goTo(f.key)}>
                    Zobacz <ArrowIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* jak to działa */}
      <section className="lp-section is-alt">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Jak to działa</span>
          <h2>Trzy kroki do pierwszego wymienienia się</h2>
        </div>
        <div className="lp-wrap">
          <div className="lp-steps">
            {STEPS.map((s) => (
              <div className="lp-step" key={s.n}>
                <div className="lp-step-num">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* cytat */}
      <section className="lp-section">
        <div className="lp-quote">
          <blockquote>
            „Poszliśmy po zajęcia, a zostaliśmy dla ludzi. Wymieniamy się książkami
            i pilnujemy sobie dzieci na koncertach.”
          </blockquote>
          <div className="lp-quote-who">
            <img className="lp-quote-av" src="https://i.pravatar.cc/80?img=15" alt="" />
            <div style={{ textAlign: "left" }}>
              <strong style={{ fontSize: 14 }}>Tomek K.</strong>
              <small>tata Antka, 3 lata</small>
            </div>
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="lp-section is-alt">
        <div className="lp-wrap">
          <div className="lp-cta">
            <span className="lp-eyebrow" style={{ color: "var(--lime)" }}>Dołącz do kręgu</span>
            <h2 style={{ marginTop: 12 }}>Zobacz, jak wygląda Twój panel</h2>
            <p>Bez względu na to, czy prowadzisz grupę, czy właśnie do niej dołączasz — masz tu wszystko, czego potrzebujesz.</p>
            <div className="lp-cta-ctas">
              <button className="lp-btn lp-btn-primary" onClick={onOpenPanelGoscia}>Panel gościa</button>
              <button className="lp-btn lp-btn-ghost" onClick={onOpenPanelOrganizatora}>Panel organizatora</button>
            </div>
          </div>
        </div>
      </section>

      <div className="lp-footer">Rodzinny grajdołek · Poznań, Jeżyce · prototyp</div>
      </div>
    </div>
  );
}
