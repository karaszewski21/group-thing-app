import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  Rodzinny grajdołek — panel gościa (mock UI, widok mobilny)          */
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
  --danger:#B23B3B;
  --danger-soft:#F6E4E2;
}
*,*::before,*::after{box-sizing:border-box;}

.org-stage{
  background:#EDF1EA;min-height:100vh;display:flex;justify-content:center;
  font-family:Karla,"Segoe UI",system-ui,sans-serif;color:var(--ink);
  -webkit-font-smoothing:antialiased;
}
.org-phone{
  width:100%;max-width:430px;background:var(--cream);
  display:flex;flex-direction:column;min-height:100vh;
}
.org-phone h1,.org-phone h2,.org-phone h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.02em;margin:0;}
.org-phone p{margin:0;line-height:1.55;}
.org-phone button{font-family:inherit;cursor:pointer;}
.org-phone input,.org-phone textarea,.org-phone select{font-family:inherit;font-size:14.5px;}

/* ---------- nagłówek ---------- */
.org-header{
  background:var(--paper);border-bottom:1px solid var(--line);
  padding:16px 18px;position:sticky;top:0;z-index:20;
  display:flex;align-items:center;gap:12px;
}
.org-avatar-btn{
  border:none;background:none;padding:0;border-radius:50%;flex:none;
  transition:transform .16s ease;
}
.org-avatar-btn:hover{transform:scale(1.05);}
.org-avatar-btn:focus-visible{outline:3px solid var(--mint-bright);outline-offset:2px;}
.org-avatar-img{width:48px;height:48px;border-radius:50%;object-fit:cover;border:2.5px solid var(--mint-soft);display:block;}
.org-header-id{flex:1;min-width:0;}
.org-header-id h1{font-size:16.5px;line-height:1.2;}
.org-header-id small{display:block;font-size:12px;color:var(--ink-soft);margin-top:2px;}
.org-icon-btn{
  width:40px;height:40px;border-radius:14px;border:1px solid var(--line);background:var(--cream);
  display:inline-flex;align-items:center;justify-content:center;flex:none;transition:background .16s;
}
.org-icon-btn:hover{background:var(--mint-soft);}
.org-back{
  border:none;background:#fff;border-radius:999px;height:38px;padding:0 15px;
  display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:13.5px;color:var(--ink);
  box-shadow:0 3px 10px -6px rgba(30,46,39,.4);flex:none;
}

/* ---------- menu hamburgera ---------- */
.org-menu-wrap{position:relative;flex:none;}
.org-menu-backdrop{position:fixed;inset:0;z-index:25;background:none;border:none;padding:0;cursor:default;}
.org-menu{
  position:absolute;top:48px;right:0;z-index:30;min-width:190px;
  background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:6px;
  box-shadow:0 16px 34px -16px rgba(30,46,39,.45);animation:org-in .15s ease;
}
.org-menu-item{
  width:100%;border:none;background:none;text-align:left;padding:11px 12px;border-radius:11px;
  font-weight:700;font-size:14px;color:var(--ink);display:flex;align-items:center;gap:10px;
}
.org-menu-item:hover{background:var(--cream);}
.org-menu-item svg{width:18px;height:18px;flex:none;}

/* ---------- treść ---------- */
.org-body{flex:1;padding:18px 18px 24px;overflow-y:auto;}
.org-greeting{margin-bottom:18px;}
.org-greeting h2{font-size:21px;}
.org-greeting p{color:var(--ink-soft);font-size:13.5px;margin-top:4px;}

.org-section-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:14px;}
.org-section-title-text{display:flex;flex-direction:column;gap:2px;}
.org-section-title h2{font-size:19px;}
.org-section-title small{color:var(--ink-soft);font-size:12.5px;}
.org-section-add{
  border:none;background:var(--ink);color:#EAF2E9;border-radius:999px;padding:9px 15px;
  font-size:12.5px;font-weight:800;display:inline-flex;align-items:center;gap:6px;flex:none;
  transition:transform .15s ease;
}
.org-section-add:hover{transform:translateY(-2px);}
.org-section-add svg{width:15px;height:15px;}
.org-section + .org-section{margin-top:28px;}

.org-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;}
.org-card-head h3{font-size:16px;}
.org-link-btn{border:none;background:none;color:var(--mint);font-weight:800;font-size:12.5px;padding:4px;}
.org-link-btn:hover{text-decoration:underline;}

.org-card{
  background:var(--paper);border:1px solid var(--line);border-radius:22px;
  padding:20px;animation:org-in .2s ease;
}
@keyframes org-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.org-card + .org-card{margin-top:14px;}
.org-card h3{font-size:16px;margin-bottom:14px;}

.org-avatar-row{display:flex;align-items:center;gap:16px;margin-bottom:20px;}
.org-avatar{width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid var(--mint-soft);flex:none;}

.org-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media (max-width:360px){.org-grid{grid-template-columns:1fr;}}
.org-field{display:flex;flex-direction:column;gap:6px;}
.org-field.is-full{grid-column:1/-1;}
.org-field label{font-size:12px;font-weight:800;color:var(--ink-soft);letter-spacing:.02em;}
.org-field input,.org-field textarea,.org-field select{
  border:1.5px solid var(--line);border-radius:12px;padding:11px 13px;background:var(--cream);color:var(--ink);
}
.org-field input:focus,.org-field textarea:focus,.org-field select:focus{
  outline:none;border-color:var(--mint);box-shadow:0 0 0 3px var(--mint-soft);
}
.org-field textarea{resize:vertical;min-height:76px;}

.org-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:16px;}
.org-btn{border:none;border-radius:13px;padding:12px 20px;font-weight:800;font-size:13.5px;transition:transform .15s ease;}
.org-btn:hover{transform:translateY(-2px);}
.org-btn:focus-visible{outline:3px solid var(--teal);outline-offset:2px;}
.org-btn-primary{background:var(--mint);color:#fff;box-shadow:0 8px 18px -10px rgba(27,129,104,.85);width:100%;}
.org-btn-ghost{background:var(--cream);color:var(--ink);border:1.5px solid var(--line);}

.org-saved{display:inline-flex;align-items:center;gap:7px;color:var(--mint);font-weight:700;font-size:13px;margin-right:auto;animation:org-in .2s ease;}

/* ---------- ustawienia ---------- */
.org-toggle-row{
  display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 2px;
}
.org-toggle-row + .org-toggle-row{border-top:1px solid var(--line);}
.org-toggle-row strong{display:block;font-size:14px;}
.org-toggle-row small{display:block;color:var(--ink-soft);font-size:12px;margin-top:2px;}
.org-toggle{
  position:relative;width:44px;height:26px;flex:none;border-radius:999px;border:none;background:var(--line);
  transition:background .18s ease;padding:0;
}
.org-toggle.is-on{background:var(--mint);}
.org-toggle-thumb{
  position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;
  box-shadow:0 2px 6px -1px rgba(30,46,39,.5);transition:transform .18s ease;
}
.org-toggle.is-on .org-toggle-thumb{transform:translateX(18px);}
.org-btn-danger{background:var(--danger-soft);color:var(--danger);width:100%;}

.org-list-item{
  display:flex;align-items:flex-start;gap:13px;padding:15px;border:1px solid var(--line);
  border-radius:16px;background:var(--cream);
}
.org-list-item + .org-list-item{margin-top:10px;}
.org-list-ico{width:38px;height:38px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;transition:background .18s ease;}
.org-list-item h3{font-size:15.5px;}
.org-list-item small{display:block;color:var(--ink-soft);font-size:12.5px;margin-top:2px;}
.org-list-body{flex:1;min-width:0;}
.org-slot{
  display:inline-block;margin-top:7px;border-radius:999px;padding:4px 10px;font-size:11.5px;font-weight:800;
  background:var(--lime-soft);color:#56701F;
}
.org-remove{
  border:none;background:none;color:var(--ink-soft);width:30px;height:30px;border-radius:10px;flex:none;
  display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;
}
.org-remove:hover{background:var(--danger-soft);color:var(--danger);}

.org-date{display:flex;align-items:center;gap:13px;}
.org-day{
  width:46px;height:46px;border-radius:13px;background:var(--mint-soft);flex:none;
  display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05;
}
.org-day b{font-family:Fraunces,Georgia,serif;font-size:16px;color:var(--ink);}
.org-day small{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft);}

/* ---------- rzeczy ---------- */
.org-mode-row{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap;}
.org-mode-btn{
  border:1.5px solid var(--line);background:var(--paper);color:var(--ink-soft);
  border-radius:999px;padding:6px 12px;font-size:11.5px;font-weight:800;transition:all .15s ease;
}
.org-mode-btn:hover{border-color:var(--sage);}
.org-mode-btn.is-on{border-color:transparent;}

.org-need-chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px;}
.org-need-chip{
  background:var(--lime-soft);color:#56701F;border-radius:999px;padding:3px 9px;
  font-size:10.5px;font-weight:800;
}

/* ---------- statystyki (home) ---------- */
.org-stat-grid{display:flex;gap:9px;}
.org-stat-card{
  flex:1;border-radius:16px;padding:14px 10px;display:flex;flex-direction:column;
  align-items:flex-start;gap:6px;min-width:0;
}
.org-stat-ico{width:30px;height:30px;border-radius:10px;background:rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;}
.org-stat-ico svg{width:16px;height:16px;}
.org-stat-card b{font-family:Fraunces,Georgia,serif;font-size:27px;line-height:1;}
.org-stat-card small{font-size:11.5px;font-weight:800;}

.org-empty{
  text-align:center;color:var(--ink-soft);font-size:13.5px;padding:26px 16px;
  border:1.5px dashed var(--line);border-radius:16px;
}

/* ---------- modal ---------- */
.org-modal-overlay{
  position:fixed;inset:0;background:rgba(20,28,24,.55);z-index:60;
  display:flex;align-items:flex-end;justify-content:center;
}
.org-modal{
  width:100%;max-width:430px;background:var(--paper);border-radius:24px 24px 0 0;
  padding:20px 20px calc(20px + env(safe-area-inset-bottom));max-height:88vh;overflow-y:auto;
  animation:org-modal-in .2s ease;
}
@keyframes org-modal-in{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
.org-modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
.org-modal-head h3{font-size:18px;}
.org-modal-close{
  border:none;background:var(--cream);width:34px;height:34px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;color:var(--ink-soft);flex:none;
}
.org-modal-close:hover{background:var(--danger-soft);color:var(--danger);}

/* ---------- dolne menu ---------- */
.org-nav{
  position:sticky;bottom:0;z-index:20;background:var(--paper);border-top:1px solid var(--line);
  display:flex;padding:8px 10px calc(8px + env(safe-area-inset-bottom));
  box-shadow:0 -10px 30px -22px rgba(30,46,39,.7);
}
.org-nav-btn{
  flex:1;border:none;background:none;display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:8px 4px;border-radius:14px;color:var(--ink-soft);font-size:11.5px;font-weight:700;
  transition:color .16s ease,background .16s ease;
}
.org-nav-btn:hover{background:var(--cream);}
.org-nav-btn.is-on{color:var(--mint);}
.org-nav-btn svg{width:22px;height:22px;}

.org-toast{
  position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:120;
  background:var(--ink);color:#EAF2E9;border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;
  box-shadow:0 14px 30px -14px rgba(30,46,39,.9);animation:org-in .2s ease;
}

@media (min-width:520px){
  .org-stage{padding:26px 16px;background:#E7EDE4;}
  .org-phone{min-height:0;border-radius:34px;overflow:hidden;box-shadow:0 40px 80px -40px rgba(30,46,39,.6),0 0 0 9px #1E2E27;margin:8px 0;}
  .org-modal-overlay{align-items:center;}
  .org-modal{border-radius:24px;max-height:80vh;}
}
`;

/* ---------------- ikony ---------------- */

const SettingsIcon = ({ c = "#1E2E27" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="3.2" stroke={c} strokeWidth="2" />
    <path
      d="M19.4 13.5c.1-.5.1-1 0-1.5l1.9-1.4-1.5-2.6-2.2.7c-.4-.3-.8-.6-1.3-.8l-.3-2.3H11l-.3 2.3c-.5.2-.9.5-1.3.8l-2.2-.7-1.5 2.6L7.6 12c-.1.5-.1 1 0 1.5l-1.9 1.4 1.5 2.6 2.2-.7c.4.3.8.6 1.3.8l.3 2.3h3l.3-2.3c.5-.2.9-.5 1.3-.8l2.2.7 1.5-2.6-1.9-1.4Z"
      stroke={c} strokeWidth="1.7" strokeLinejoin="round"
    />
  </svg>
);
const HomeIcon = ({ c = "#1E2E27" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 11.5 12 4l8 7.5" stroke={c} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 10v9a1 1 0 0 0 1 1h3v-5a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5h3a1 1 0 0 0 1-1v-9" stroke={c} strokeWidth="2.1" strokeLinejoin="round" />
  </svg>
);
const CalendarIcon = ({ c = "#1E2E27" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="3" stroke={c} strokeWidth="2.1" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={c} strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);
const BoxIcon = ({ c = "#1E2E27" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.5 8.3 12 4l8.5 4.3-8.5 4.3-8.5-4.3Z" stroke={c} strokeWidth="2" strokeLinejoin="round" />
    <path d="M3.5 8.3V16l8.5 4 8.5-4V8.3M12 12.6V20" stroke={c} strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
const GiftIcon = ({ c = "#1E2E27" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3.5" y="9.5" width="17" height="11" rx="2" stroke={c} strokeWidth="2" strokeLinejoin="round" />
    <path d="M3.5 9.5h17M12 9.5v11" stroke={c} strokeWidth="2" strokeLinecap="round" />
    <path d="M12 9.5c-2.5 0-4-1.4-4-3a2 2 0 0 1 4 0 2 2 0 0 1 4 0c0 1.6-1.5 3-4 3Z" stroke={c} strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
const CheckIcon = ({ c = "#1B8168" }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 12.5 9.5 18 20 6" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 7h16M9.5 7V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7M6.5 7l1 12.4c.1 1 .9 1.8 1.9 1.8h5.2c1 0 1.8-.8 1.9-1.8L17.5 7"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14.5 5 8 12l6.5 7" stroke="#1E2E27" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const MenuIcon = ({ c = "#1E2E27" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" stroke={c} strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);
const UserIcon = ({ c = "#1E2E27" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="8" r="3.6" stroke={c} strokeWidth="2" />
    <path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const LogoutIcon = ({ c = "#B23B3B" }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M14 12H4m0 0 4-4m-4 4 4 4" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/* ---------------- typy i dane startowe ---------------- */

type Profile = {
  name: string;
  bio: string;
  location: string;
  avatar: string;
};

type Term = {
  id: string;
  day: string;
  month: string;
  groupName: string;
  note: string;
  neededItems: string[];
};

type ItemMode = "wypożyczę" | "oddam" | "zamienię";

type Item = {
  id: string;
  name: string;
  mode: ItemMode | null;
};

let uid = 0;
const nextId = () => `item-${++uid}`;

const GUEST_AVATAR = "https://i.pravatar.cc/160?img=32";

const MY_TERMS: Term[] = [
  { id: nextId(), day: "27", month: "sie", groupName: "Muzyczne Maluchy", note: "16:30 · Sala nr 2 · zapisani", neededItems: ["Tamburyn i dzwonki", "Mata piankowa"] },
];

const ITEM_MODES: ItemMode[] = ["wypożyczę", "oddam", "zamienię"];
const ITEM_MODE_STYLE: Record<ItemMode, { bg: string; c: string }> = {
  "wypożyczę": { bg: "var(--teal-soft)", c: "#245F61" },
  "oddam": { bg: "var(--mint-soft)", c: "#12604D" },
  "zamienię": { bg: "var(--lime-soft)", c: "#56701F" },
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const INITIAL_ITEMS: Item[] = [
  { id: nextId(), name: "Książka: Pucio", mode: "zamienię" },
  { id: nextId(), name: "Puzzle 3+", mode: "oddam" },
  { id: nextId(), name: "Grzechotki drewniane", mode: null },
];

type GiftSource = "pożyczone" | "otrzymane" | "zamienione";

type Gift = {
  id: string;
  name: string;
  from: string;
  source: GiftSource;
};

const GIFT_SOURCES: GiftSource[] = ["pożyczone", "otrzymane", "zamienione"];
const GIFT_SOURCE_STYLE: Record<GiftSource, { bg: string; c: string }> = {
  "pożyczone": { bg: "var(--teal-soft)", c: "#245F61" },
  "otrzymane": { bg: "var(--mint-soft)", c: "#12604D" },
  "zamienione": { bg: "var(--lime-soft)", c: "#56701F" },
};

const INITIAL_GIFTS: Gift[] = [
  { id: nextId(), name: "Tamburyn i dzwonki", from: "Rodzina Nowaków", source: "pożyczone" },
  { id: nextId(), name: "Książeczki kontrastowe", from: "Rodzina Zielińskich", source: "zamienione" },
];

/* ---------------- komponent ---------------- */

type View = "home" | "spotkania" | "rzeczy" | "podarki" | "profil" | "ustawienia";
type Modal = "rzecz" | null;

const NAV_ITEMS: { key: View; label: string; Icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "spotkania", label: "Spotkania", Icon: CalendarIcon },
  { key: "rzeczy", label: "Moje rzeczy", Icon: BoxIcon },
  { key: "podarki", label: "Podarki", Icon: GiftIcon },
];

export default function PanelGoscia() {
  const [view, setView] = useState<View>("home");
  const [modal, setModal] = useState<Modal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");

  const [profile, setProfile] = useState<Profile>({
    name: "Marta Wiśniewska",
    bio: "Mama Zosi (2 lata). Staramy się nie opuszczać żadnych zajęć.",
    location: "Poznań, Jeżyce",
    avatar: GUEST_AVATAR,
  });
  const [profileSaved, setProfileSaved] = useState(false);

  const [terms] = useState<Term[]>(MY_TERMS);

  const [items, setItems] = useState<Item[]>(INITIAL_ITEMS);
  const [itemForm, setItemForm] = useState({ name: "" });

  const [gifts, setGifts] = useState<Gift[]>(INITIAL_GIFTS);

  const [settings, setSettings] = useState({
    emailNotifs: true,
    smsNotifs: false,
    publicProfile: true,
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const saveProfile = () => {
    setProfileSaved(true);
    showToast("Zapisano dane profilowe");
    setTimeout(() => setProfileSaved(false), 2200);
  };

  const addItem = () => {
    if (!itemForm.name.trim()) return;
    setItems((is) => [...is, { id: nextId(), name: itemForm.name.trim(), mode: null }]);
    setItemForm({ name: "" });
    setModal(null);
    showToast("Dodano rzecz");
  };

  const removeItem = (id: string) => setItems((is) => is.filter((i) => i.id !== id));

  const setItemMode = (id: string, mode: ItemMode) =>
    setItems((is) => is.map((i) => (i.id === id ? { ...i, mode: i.mode === mode ? null : mode } : i)));

  const itemCounts = {
    "wypożyczę": items.filter((i) => i.mode === "wypożyczę").length,
    "oddam": items.filter((i) => i.mode === "oddam").length,
    "zamienię": items.filter((i) => i.mode === "zamienię").length,
  };

  const giftCounts = {
    "pożyczone": gifts.filter((g) => g.source === "pożyczone").length,
    "otrzymane": gifts.filter((g) => g.source === "otrzymane").length,
    "zamienione": gifts.filter((g) => g.source === "zamienione").length,
  };

  const removeGift = (id: string) => setGifts((gs) => gs.filter((g) => g.id !== id));

  const isTopLevel = view === "home" || view === "spotkania" || view === "rzeczy" || view === "podarki";

  return (
    <div className="org-stage">
      <style>{CSS}</style>

      <div className="org-phone">
        {/* ---------- nagłówek ---------- */}
        <header className="org-header">
          {isTopLevel ? (
            <>
              <button className="org-avatar-btn" onClick={() => setView("profil")} aria-label="Otwórz dane profilowe">
                <img className="org-avatar-img" src={profile.avatar} alt={profile.name} />
              </button>
              <div className="org-header-id">
                <h1>{profile.name}</h1>
                <small>{profile.location}</small>
              </div>
              <div className="org-menu-wrap">
                <button className="org-icon-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>
                  <MenuIcon />
                </button>
                {menuOpen && (
                  <>
                    <button className="org-menu-backdrop" onClick={() => setMenuOpen(false)} aria-label="Zamknij menu" />
                    <div className="org-menu" role="menu">
                      <button className="org-menu-item" role="menuitem" onClick={() => { setView("profil"); setMenuOpen(false); }}>
                        <UserIcon /> Profil
                      </button>
                      <button className="org-menu-item" role="menuitem" onClick={() => { setView("ustawienia"); setMenuOpen(false); }}>
                        <SettingsIcon /> Ustawienia
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <button className="org-back" onClick={() => setView("home")}><BackIcon /> Wróć</button>
              <div className="org-header-id">
                <h1>{view === "profil" ? "Dane profilowe" : "Ustawienia"}</h1>
              </div>
            </>
          )}
        </header>

        {/* ---------- treść ---------- */}
        <div className="org-body">
          {view === "home" && (
            <>
              <div className="org-greeting">
                <h2>Cześć, {profile.name.split(" ")[0]}!</h2>
                <p>Oto co dzieje się w Twojej grupie.</p>
              </div>

              <div className="org-card">
                <div className="org-card-head">
                  <h3>Twoje najbliższe zajęcia</h3>
                  <button className="org-link-btn" onClick={() => setView("spotkania")}>Zobacz</button>
                </div>
                {terms.length === 0 && <div className="org-empty">Nie jesteś jeszcze zapisana na żadne zajęcia.</div>}
                {terms.slice(0, 3).map((t) => (
                  <div className="org-list-item org-date" key={t.id}>
                    <div className="org-day"><b>{t.day}</b><small>{t.month}</small></div>
                    <div className="org-list-body">
                      <h3>{t.groupName}</h3>
                      <small>{t.note}</small>
                      {t.neededItems.length > 0 && (
                        <div className="org-need-chips">
                          {t.neededItems.map((n) => <span className="org-need-chip" key={n}>{n}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="org-card">
                <div className="org-card-head">
                  <h3>Rzeczy dla innych</h3>
                  <button className="org-link-btn" onClick={() => setView("rzeczy")}>Zobacz wszystkie</button>
                </div>
                <div className="org-stat-grid">
                  {ITEM_MODES.map((m) => {
                    const style = ITEM_MODE_STYLE[m];
                    return (
                      <div className="org-stat-card" style={{ background: style.bg }} key={m}>
                        <span className="org-stat-ico"><BoxIcon c={style.c} /></span>
                        <b style={{ color: style.c }}>{itemCounts[m]}</b>
                        <small style={{ color: style.c }}>{capitalize(m)}</small>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="org-card">
                <div className="org-card-head">
                  <h3>Rzeczy od innych</h3>
                  <button className="org-link-btn" onClick={() => setView("podarki")}>Zobacz wszystkie</button>
                </div>
                <div className="org-stat-grid">
                  {GIFT_SOURCES.map((s) => {
                    const style = GIFT_SOURCE_STYLE[s];
                    return (
                      <div className="org-stat-card" style={{ background: style.bg }} key={s}>
                        <span className="org-stat-ico"><GiftIcon c={style.c} /></span>
                        <b style={{ color: style.c }}>{giftCounts[s]}</b>
                        <small style={{ color: style.c }}>{capitalize(s)}</small>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {view === "profil" && (
            <div className="org-card">
              <h3>Dane profilowe</h3>

              <div className="org-avatar-row">
                <img className="org-avatar" src={profile.avatar} alt={profile.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="org-field">
                    <label htmlFor="org-avatar-url">Link do zdjęcia profilowego</label>
                    <input
                      id="org-avatar-url"
                      value={profile.avatar}
                      onChange={(e) => setProfile({ ...profile, avatar: e.target.value })}
                      placeholder="https://…"
                    />
                  </div>
                </div>
              </div>

              <div className="org-grid">
                <div className="org-field is-full">
                  <label htmlFor="org-name">Imię i nazwisko</label>
                  <input id="org-name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                </div>
                <div className="org-field is-full">
                  <label htmlFor="org-location">Lokalizacja</label>
                  <input id="org-location" value={profile.location} onChange={(e) => setProfile({ ...profile, location: e.target.value })} placeholder="Miasto, dzielnica" />
                </div>
                <div className="org-field is-full">
                  <label htmlFor="org-bio">O mnie</label>
                  <textarea id="org-bio" value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} placeholder="Kilka słów o Tobie i dziecku" />
                </div>
              </div>

              <div className="org-actions">
                {profileSaved && <span className="org-saved"><CheckIcon /> Zapisano</span>}
                <button className="org-btn org-btn-primary" onClick={saveProfile}>Zapisz zmiany</button>
              </div>
            </div>
          )}

          {view === "ustawienia" && (
            <>
              <div className="org-card">
                <h3>Powiadomienia</h3>
                <div className="org-toggle-row">
                  <div>
                    <strong>Powiadomienia e-mail</strong>
                    <small>Nowe wiadomości od prowadzącej</small>
                  </div>
                  <button
                    className={`org-toggle ${settings.emailNotifs ? "is-on" : ""}`}
                    role="switch"
                    aria-checked={settings.emailNotifs}
                    aria-label="Powiadomienia e-mail"
                    onClick={() => setSettings((s) => ({ ...s, emailNotifs: !s.emailNotifs }))}
                  >
                    <span className="org-toggle-thumb" />
                  </button>
                </div>
                <div className="org-toggle-row">
                  <div>
                    <strong>Powiadomienia SMS</strong>
                    <small>Przypomnienia o nadchodzących zajęciach</small>
                  </div>
                  <button
                    className={`org-toggle ${settings.smsNotifs ? "is-on" : ""}`}
                    role="switch"
                    aria-checked={settings.smsNotifs}
                    aria-label="Powiadomienia SMS"
                    onClick={() => setSettings((s) => ({ ...s, smsNotifs: !s.smsNotifs }))}
                  >
                    <span className="org-toggle-thumb" />
                  </button>
                </div>
              </div>

              <div className="org-card">
                <h3>Prywatność</h3>
                <div className="org-toggle-row">
                  <div>
                    <strong>Widoczny profil w grupie</strong>
                    <small>Inne rodziny widzą Twoje imię i to, co udostępniasz</small>
                  </div>
                  <button
                    className={`org-toggle ${settings.publicProfile ? "is-on" : ""}`}
                    role="switch"
                    aria-checked={settings.publicProfile}
                    aria-label="Widoczny profil w grupie"
                    onClick={() => setSettings((s) => ({ ...s, publicProfile: !s.publicProfile }))}
                  >
                    <span className="org-toggle-thumb" />
                  </button>
                </div>
              </div>

              <div className="org-card">
                <h3>Konto</h3>
                <button className="org-btn org-btn-danger" onClick={() => showToast("Wylogowano — prototyp")}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <LogoutIcon /> Wyloguj się
                  </span>
                </button>
              </div>
            </>
          )}

          {view === "spotkania" && (
            <div className="org-section">
              <div className="org-section-title">
                <div className="org-section-title-text">
                  <h2>Spotkania</h2>
                  <small>{terms.length} {terms.length === 1 ? "termin, na który jesteś zapisana" : "terminy, na które jesteś zapisana"}</small>
                </div>
              </div>

              <div className="org-card">
                {terms.length === 0 && <div className="org-empty">Nie jesteś jeszcze zapisana na żadne zajęcia.</div>}
                {terms.map((t) => (
                  <div className="org-list-item org-date" key={t.id}>
                    <div className="org-day"><b>{t.day}</b><small>{t.month}</small></div>
                    <div className="org-list-body">
                      <h3>{t.groupName}</h3>
                      <small>{t.note}</small>
                      {t.neededItems.length > 0 && (
                        <div className="org-need-chips">
                          {t.neededItems.map((n) => <span className="org-need-chip" key={n}>{n}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "rzeczy" && (
            <div className="org-section">
              <div className="org-section-title">
                <div className="org-section-title-text">
                  <h2>Moje rzeczy</h2>
                  <small>{items.length} {items.length === 1 ? "rzecz" : "rzeczy"}</small>
                </div>
                <button className="org-section-add" onClick={() => setModal("rzecz")}>
                  <BoxIcon c="#EAF2E9" /> Dodaj rzecz
                </button>
              </div>

              <div className="org-card">
                {items.length === 0 && <div className="org-empty">Nie masz jeszcze żadnej rzeczy.</div>}
                {items.map((it) => {
                  const style = it.mode ? ITEM_MODE_STYLE[it.mode] : null;
                  return (
                    <div className="org-list-item" key={it.id}>
                      <span className="org-list-ico" style={{ background: style ? style.bg : "var(--line)" }}>
                        <BoxIcon c={style ? style.c : "#5C7069"} />
                      </span>
                      <div className="org-list-body">
                        <h3>{it.name}</h3>
                        <div className="org-mode-row">
                          {ITEM_MODES.map((m) => {
                            const on = it.mode === m;
                            const mStyle = ITEM_MODE_STYLE[m];
                            return (
                              <button
                                key={m}
                                className={`org-mode-btn ${on ? "is-on" : ""}`}
                                style={on ? { background: mStyle.bg, color: mStyle.c } : undefined}
                                onClick={() => setItemMode(it.id, m)}
                                aria-pressed={on}
                              >
                                {capitalize(m)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <button className="org-remove" onClick={() => removeItem(it.id)} aria-label={`Usuń rzecz ${it.name}`}>
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {view === "podarki" && (
            <div className="org-section">
              <div className="org-section-title">
                <div className="org-section-title-text">
                  <h2>Podarki</h2>
                  <small>rzeczy od innych rodzin, które wypożyczyłaś lub się wymieniłaś</small>
                </div>
              </div>

              <div className="org-card">
                {gifts.length === 0 && <div className="org-empty">Nie masz jeszcze żadnego podarku.</div>}
                {gifts.map((g) => {
                  const style = GIFT_SOURCE_STYLE[g.source];
                  return (
                    <div className="org-list-item" key={g.id}>
                      <span className="org-list-ico" style={{ background: style.bg }}>
                        <GiftIcon c={style.c} />
                      </span>
                      <div className="org-list-body">
                        <h3>{g.name}</h3>
                        <small>Od: {g.from}</small>
                        <span className="org-slot" style={{ background: style.bg, color: style.c }}>
                          {capitalize(g.source)}
                        </span>
                      </div>
                      <button className="org-remove" onClick={() => removeGift(g.id)} aria-label={`Usuń podarek ${g.name}`}>
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ---------- dolne menu ---------- */}
        {isTopLevel && (
          <nav className="org-nav" aria-label="Nawigacja panelu">
            {NAV_ITEMS.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={`org-nav-btn ${view === key ? "is-on" : ""}`}
                onClick={() => setView(key)}
                aria-current={view === key}
              >
                <Icon c={view === key ? "#1B8168" : "#5C7069"} />
                {label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* ---------- modal: dodaj rzecz ---------- */}
      {modal === "rzecz" && (
        <div className="org-modal-overlay" onClick={() => setModal(null)}>
          <div className="org-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Dodaj rzecz">
            <div className="org-modal-head">
              <h3>Dodaj rzecz</h3>
              <button className="org-modal-close" onClick={() => setModal(null)} aria-label="Zamknij"><CloseIcon /></button>
            </div>
            <div className="org-grid">
              <div className="org-field is-full">
                <label htmlFor="org-i-name">Nazwa rzeczy</label>
                <input id="org-i-name" value={itemForm.name} onChange={(e) => setItemForm({ name: e.target.value })} placeholder="np. Grzechotki drewniane" />
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>
              Sposób udostępnienia (wypożyczę / oddam / zamienię) ustawisz na liście po dodaniu.
            </p>
            <div className="org-actions">
              <button className="org-btn org-btn-primary" onClick={addItem}>Dodaj rzecz</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="org-toast" role="status">{toast}</div>}
    </div>
  );
}
