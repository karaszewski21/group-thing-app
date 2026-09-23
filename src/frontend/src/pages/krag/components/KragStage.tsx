import { useEffect, type ReactNode } from "react";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600;700;800&display=swap";

const CSS = `
:root{
  --cream:#F4F8F0;--paper:#FFFFFF;--ink:#1E2E27;--ink-soft:#5C7069;
  --mint:#1B8168;--mint-soft:#D8F0E6;--sage:#5D8A63;--sage-soft:#DFEBDC;
  --teal:#6FB6B8;--teal-soft:#D9ECEC;--lime:#A9C24F;--line:#E2EADF;
  --danger:#B4443A;
}
*,*::before,*::after{box-sizing:border-box;}
.kg-stage{background:#EDF1EA;min-height:100vh;display:flex;justify-content:center;
  font-family:Karla,"Segoe UI",system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;}
.kg-app{width:100%;max-width:430px;background:var(--cream);display:flex;flex-direction:column;min-height:100vh;}
.kg-app h1,.kg-app h2,.kg-app h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.02em;line-height:1.12;margin:0;}
.kg-app p{margin:0;line-height:1.6;}
.kg-app button{font-family:inherit;cursor:pointer;}
.kg-head{background:var(--paper);border-bottom:1px solid var(--line);padding:18px 18px 16px;position:sticky;top:0;z-index:20;}
.kg-eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;font-weight:800;color:var(--sage);}
.kg-head h1{font-size:23px;margin-top:5px;}
.kg-head-sub{font-size:13.5px;color:var(--ink-soft);margin-top:4px;}
.kg-back{border:none;background:none;color:var(--mint);font-weight:700;font-size:13px;padding:0 0 8px;}
.kg-main{flex:1;}
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
.kg-mark{position:absolute;right:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;border:2.5px solid var(--cream);font-size:11px;color:#fff;}
.kg-mark-left{position:absolute;left:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;border:2.5px solid var(--cream);font-size:11px;color:#fff;}
.kg-mark-shares{background:var(--mint);}
.kg-mark-brings{background:var(--teal);}
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
.kg-bring-body{flex:1;min-width:0;}
.kg-bring-body strong{display:block;font-size:14px;}
.kg-bring-body small{display:block;color:var(--ink-soft);font-size:12px;margin-top:1px;}
.kg-bring-btn{flex:none;border:1.5px solid var(--mint);background:var(--paper);color:var(--mint);border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;}
.kg-bring-empty{font-size:13px;color:var(--ink-soft);text-align:center;padding:16px 0;}
.kg-attendee{padding:12px 0;border-radius:14px;scroll-margin-top:120px;outline:none;transition:background .25s ease;}
.kg-attendee + .kg-attendee{border-top:1px solid var(--line);}
.kg-attendee.is-on{background:var(--mint-soft);padding:12px 10px;}
.kg-attendee:focus-visible{box-shadow:0 0 0 3px var(--mint);}
.kg-attendee-head{display:flex;align-items:center;gap:11px;}
.kg-attendee-head .kg-av{width:40px;height:40px;font-size:12.5px;border-width:2px;}
.kg-attendee-items{margin:6px 0 0 51px;}
.kg-fulfill{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);}
.kg-fulfill-row{display:flex;gap:8px;margin-bottom:8px;}
.kg-select,.kg-input{flex:1;min-width:0;border:1.5px solid var(--line);border-radius:12px;padding:8px 10px;font-size:13px;font-family:inherit;background:var(--cream);color:var(--ink);}
.kg-select:focus,.kg-input:focus{outline:none;border-color:var(--mint);box-shadow:0 0 0 3px var(--mint-soft);}
.kg-fulfill-actions{display:flex;gap:8px;}
.kg-btn-primary{border:none;background:var(--mint);color:#fff;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:800;}
.kg-btn-primary:disabled{opacity:.6;}
.kg-btn-ghost{border:1.5px solid var(--line);background:none;color:var(--ink-soft);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:700;}
.kg-status-line{font-size:12px;color:var(--sage);font-weight:700;margin-top:8px;}
.kg-error{color:var(--danger);font-size:12px;margin-bottom:10px;}
.kg-card{margin:18px 18px 24px;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:17px;}
.kg-foot{position:sticky;bottom:0;z-index:20;background:var(--paper);border-top:1px solid var(--line);padding:14px 18px;}
.kg-foot .kg-btn-primary{display:block;width:100%;padding:13px 22px;font-size:14px;text-align:center;}
.kg-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:120;background:var(--ink);color:#EAF2E9;
  border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;box-shadow:0 14px 30px -14px rgba(30,46,39,.9);}
.kg-state{text-align:center;padding:60px 24px;color:var(--ink-soft);}
.kg-term{margin:18px 18px 0;background:linear-gradient(135deg,var(--mint-soft),var(--paper));
  border:1px solid var(--line);border-radius:22px;padding:18px;}
.kg-term-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--mint);}
.kg-term-date{font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;color:var(--ink);
  margin-top:6px;text-transform:capitalize;line-height:1.15;}
.kg-term-time{display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:var(--paper);
  border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:13px;font-weight:800;color:var(--ink);}
.kg-term-empty{font-size:13.5px;color:var(--ink-soft);}
@media (min-width:520px){
  .kg-stage{padding:26px 16px;background:#E7EDE4;}
  .kg-app{min-height:0;border-radius:34px;overflow:hidden;box-shadow:0 40px 80px -40px rgba(30,46,39,.6),0 0 0 9px #1E2E27;margin:8px 0;}
}
`;

/** Phone-frame page shell for the group/term screens: the `.kg-*` stylesheet,
 * the Fraunces/Karla fonts, and the `.kg-stage > .kg-app` wrapper. `overlay`
 * renders outside the frame (toasts, bottom sheets). */
export function KragStage({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    document.head.appendChild(link);
    return () => {
      link.parentNode?.removeChild(link);
    };
  }, []);

  return (
    <div className="kg-stage">
      <style>{CSS}</style>
      <div className="kg-app">{children}</div>
      {overlay}
    </div>
  );
}

/** Full-page loading / error message inside `KragStage`. */
export function KragStageMessage({ children }: { children: ReactNode }) {
  return (
    <KragStage>
      <div className="kg-state">{children}</div>
    </KragStage>
  );
}
