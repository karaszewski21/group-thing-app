import { useState } from "react";

const CSS = `
.gal-stage{
  background:#EDF1EA;min-height:100vh;display:flex;justify-content:center;
  font-family:Karla,"Segoe UI",system-ui,sans-serif;color:#1E2E27;
}
.gal-phone{width:100%;max-width:430px;background:#F4F8F0;min-height:100vh;display:flex;flex-direction:column;}
.gal-head{
  display:flex;align-items:center;gap:12px;padding:18px;position:sticky;top:0;z-index:5;
  background:#F4F8F0;border-bottom:1px solid #E2EADF;
}
.gal-back{
  border:none;background:#fff;border-radius:999px;height:38px;padding:0 15px;
  display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:14px;color:#1E2E27;
  box-shadow:0 4px 12px -6px rgba(30,46,39,.4);cursor:pointer;
}
.gal-title{font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;}
.gal-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:16px 18px;}
.gal-item{border:none;padding:0;border-radius:14px;overflow:hidden;aspect-ratio:1/1;cursor:pointer;}
.gal-item img{width:100%;height:100%;object-fit:cover;display:block;}
.gal-overlay{
  position:fixed;inset:0;background:rgba(20,28,24,.92);display:flex;
  align-items:center;justify-content:center;z-index:50;padding:28px;
}
.gal-overlay img{max-width:100%;max-height:100%;border-radius:12px;}
.gal-close{
  position:absolute;top:18px;right:18px;border:none;background:rgba(255,255,255,.92);
  width:38px;height:38px;border-radius:999px;font-size:20px;cursor:pointer;
}
`;

type Photo = { id: string; label: string; src: string };

export default function GaleriaZdjec({ photos, onBack }: { photos: Photo[]; onBack: () => void }) {
  const [lightbox, setLightbox] = useState<Photo | null>(null);

  return (
    <div className="gal-stage">
      <style>{CSS}</style>
      <div className="gal-phone">
        <div className="gal-head">
          <button className="gal-back" onClick={onBack}>‹ Wróć</button>
          <span className="gal-title">Galeria</span>
        </div>

        <div className="gal-grid">
          {photos.map((p) => (
            <button key={p.id} className="gal-item" onClick={() => setLightbox(p)} aria-label={p.label}>
              <img src={p.src} alt={p.label} />
            </button>
          ))}
        </div>
      </div>

      {lightbox && (
        <div className="gal-overlay" role="dialog" aria-modal="true" aria-label={lightbox.label} onClick={() => setLightbox(null)}>
          <button className="gal-close" onClick={() => setLightbox(null)} aria-label="Zamknij">×</button>
          <img src={lightbox.src} alt={lightbox.label} />
        </div>
      )}
    </div>
  );
}
