import { useEffect, type ReactNode } from "react";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600;700;800&display=swap";

const CSS = `
.kg-head{background:var(--color-paper);border-bottom:1px solid var(--color-line);padding:18px 18px 16px;position:sticky;top:0;z-index:20;}
.kg-eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;font-weight:800;color:var(--color-ink-soft);}
.kg-head h1{font-size:23px;margin-top:5px;}
.kg-head-sub{font-size:13.5px;color:var(--color-ink-soft);margin-top:4px;}
.kg-back{border:none;background:none;color:var(--color-primary-fg);font-weight:700;font-size:13px;padding:0 0 8px;}
.kg-main{flex:1;}
.kg-circle-wrap{padding:26px 18px 6px;}
.kg-stagebox{position:relative;width:100%;max-width:360px;margin:0 auto;}
.kg-square{position:relative;width:100%;padding-top:100%;}
.kg-inner{position:absolute;inset:0;}
.kg-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
.kg-fam{position:absolute;transform:translate(-50%,-50%);background:none;border:none;padding:0;transition:opacity .25s ease;}
.kg-av{position:relative;width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:white;font-weight:800;font-size:14.5px;border:3px solid var(--color-cream);box-shadow:0 8px 18px -10px rgba(30,46,39,.7);
  transition:transform .22s cubic-bezier(.2,.8,.2,1);}
.kg-fam:hover .kg-av{transform:scale(1.09);}
.kg-fam.is-on .kg-av{transform:scale(1.1);box-shadow:0 0 0 4px var(--color-primary-soft),0 8px 18px -10px rgba(30,46,39,.7);}
.kg-mark{position:absolute;right:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;border:2.5px solid var(--color-cream);font-size:11px;}
.kg-mark-left{position:absolute;left:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;border:2.5px solid var(--color-cream);font-size:11px;}
.kg-mark-shares{background:var(--color-primary);color:var(--color-on-primary);}
.kg-mark-brings{background:var(--color-teal);color:var(--color-ink);}
.kg-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;width:48%;}
.kg-center-av{width:74px;height:74px;border-radius:50%;background:var(--color-ink);margin:0 auto;display:flex;align-items:center;justify-content:center;
  color:var(--color-on-ink);font-family:Fraunces,Georgia,serif;font-size:22px;box-shadow:0 14px 28px -14px rgba(30,46,39,.85);}
.kg-center strong{display:block;margin-top:10px;font-family:Fraunces,Georgia,serif;font-size:15px;}
.kg-center span{display:block;font-size:12px;color:var(--color-ink-soft);}
.kg-bring{margin:18px 18px 0;background:var(--color-paper);border:1px solid var(--color-line);border-radius:22px;padding:17px;}
.kg-bring h2{font-size:17px;}
.kg-bring-sub{font-size:12.5px;color:var(--color-ink-soft);margin-top:3px;}
.kg-bring-list{margin-top:12px;}
.kg-bring-item{padding:10px 0;}
.kg-bring-item + .kg-bring-item{border-top:1px solid var(--color-line);}
.kg-bring-row{display:flex;align-items:center;gap:11px;}
.kg-bring-body{flex:1;min-width:0;}
.kg-bring-body strong{display:block;font-size:14px;}
.kg-bring-body small{display:block;color:var(--color-ink-soft);font-size:12px;margin-top:1px;}
.kg-bring-btn{flex:none;border:1.5px solid var(--color-primary-fg);background:var(--color-paper);color:var(--color-primary-fg);border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;}
.kg-bring-empty{font-size:13px;color:var(--color-ink-soft);text-align:center;padding:16px 0;}
.kg-attendee{padding:12px 0;border-radius:14px;scroll-margin-top:120px;outline:none;transition:background .25s ease;}
.kg-attendee + .kg-attendee{border-top:1px solid var(--color-line);}
.kg-attendee.is-on{background:var(--color-primary-soft);padding:12px 10px;}
.kg-attendee:focus-visible{box-shadow:0 0 0 3px var(--color-focus-ring);}
.kg-attendee-head{display:flex;align-items:center;gap:11px;}
.kg-attendee-head .kg-av{width:40px;height:40px;font-size:12.5px;border-width:2px;}
.kg-attendee-items{margin:6px 0 0 51px;}
.kg-fulfill{margin-top:10px;padding-top:10px;border-top:1px dashed var(--color-line);}
.kg-fulfill-row{display:flex;gap:8px;margin-bottom:8px;}
.kg-select,.kg-input{flex:1;min-width:0;border:1.5px solid var(--color-line);border-radius:12px;padding:8px 10px;font-size:13px;font-family:inherit;background:var(--color-cream);color:var(--color-ink);}
.kg-select:focus,.kg-input:focus{outline:none;border-color:var(--color-focus-ring);box-shadow:0 0 0 3px var(--color-primary-soft);}
.kg-fulfill-actions{display:flex;gap:8px;}
.kg-btn-primary{border:none;background:var(--color-primary);color:var(--color-on-primary);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:800;}
.kg-btn-primary:disabled{opacity:.6;}
.kg-btn-ghost{border:1.5px solid var(--color-line);background:none;color:var(--color-ink-soft);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:700;}
.kg-status-line{font-size:12px;color:var(--color-ink-soft);font-weight:700;margin-top:8px;}
.kg-error{color:var(--color-danger);font-size:12px;margin-bottom:10px;}
.kg-card{margin:18px 18px 24px;background:var(--color-paper);border:1px solid var(--color-line);border-radius:22px;padding:17px;}
.kg-foot{position:sticky;bottom:0;z-index:20;background:var(--color-paper);border-top:1px solid var(--color-line);padding:14px 18px;}
.kg-foot .kg-btn-primary{display:block;width:100%;padding:13px 22px;font-size:14px;text-align:center;}
.kg-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:120;background:var(--color-ink);color:var(--color-on-ink);
  border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;box-shadow:0 14px 30px -14px rgba(30,46,39,.9);}
.kg-state{text-align:center;padding:60px 24px;color:var(--color-ink-soft);}
.kg-term{margin:18px 18px 0;background:linear-gradient(135deg,var(--color-primary-soft),var(--color-paper));
  border:1px solid var(--color-line);border-radius:22px;padding:18px;}
.kg-term-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--color-primary-fg);}
.kg-term-date{font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;color:var(--color-ink);
  margin-top:6px;text-transform:capitalize;line-height:1.15;}
.kg-term-time{display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:var(--color-paper);
  border:1px solid var(--color-line);border-radius:999px;padding:5px 12px;font-size:13px;font-weight:800;color:var(--color-ink);}
.kg-term-empty{font-size:13.5px;color:var(--color-ink-soft);}
`;

/** Shell for the group/term screens: the `.kg-*` stylesheet and the
 * Fraunces/Karla fonts. The rules only read `--color-*` tokens from `index.css`
 * (re-themed by an enclosing `OrganizerThemeScope`) and declare nothing global.
 * `overlay` renders after the content (toasts, bottom sheets). */
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
    <div>
      <style>{CSS}</style>
      {children}
      {overlay}
    </div>
  );
}