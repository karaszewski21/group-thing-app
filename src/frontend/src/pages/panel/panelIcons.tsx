/* ---------------- ikony (wydzielone z PanelPage.tsx, verbatim) ---------------- */

export const HomeIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <path d="M4 11.5 12 4l8 7.5" stroke={c} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M6 10v9a1 1 0 0 0 1 1h3v-5a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5h3a1 1 0 0 0 1-1v-9"
      stroke={c} strokeWidth="2.1" strokeLinejoin="round"
    />
  </svg>
);
export const CalendarIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <rect x="3.5" y="5" width="17" height="15" rx="3" stroke={c} strokeWidth="2.1" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={c} strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);
export const BoxIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <path d="M3.5 8.3 12 4l8.5 4.3-8.5 4.3-8.5-4.3Z" stroke={c} strokeWidth="2" strokeLinejoin="round" />
    <path d="M3.5 8.3V16l8.5 4 8.5-4V8.3M12 12.6V20" stroke={c} strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
export const GiftIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <rect x="3.5" y="9.5" width="17" height="11" rx="2" stroke={c} strokeWidth="2" strokeLinejoin="round" />
    <path d="M3.5 9.5h17M12 9.5v11" stroke={c} strokeWidth="2" strokeLinecap="round" />
    <path
      d="M12 9.5c-2.5 0-4-1.4-4-3a2 2 0 0 1 4 0 2 2 0 0 1 4 0c0 1.6-1.5 3-4 3Z"
      stroke={c} strokeWidth="2" strokeLinejoin="round"
    />
  </svg>
);
export const SettingsIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <circle cx="12" cy="12" r="3.2" stroke={c} strokeWidth="2" />
    <path
      d="M19.4 13.5c.1-.5.1-1 0-1.5l1.9-1.4-1.5-2.6-2.2.7c-.4-.3-.8-.6-1.3-.8l-.3-2.3H11l-.3 2.3c-.5.2-.9.5-1.3.8l-2.2-.7-1.5 2.6L7.6 12c-.1.5-.1 1 0 1.5l-1.9 1.4 1.5 2.6 2.2-.7c.4.3.8.6 1.3.8l.3 2.3h3l.3-2.3c.5-.2.9-.5 1.3-.8l2.2.7 1.5-2.6-1.9-1.4Z"
      stroke={c} strokeWidth="1.7" strokeLinejoin="round"
    />
  </svg>
);
export const CalendarPlusIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <rect x="3.5" y="5" width="17" height="15" rx="3" stroke={c} strokeWidth="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={c} strokeWidth="2" strokeLinecap="round" />
    <path d="M12 12.5v5M9.5 15h5" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
export const BuildingIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <rect x="4" y="3" width="16" height="18" rx="1.5" stroke={c} strokeWidth="2" />
    <path d="M8 7h1.5M14.5 7H16M8 11h1.5M14.5 11H16M8 15h1.5M14.5 15H16" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
export const UserIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <circle cx="12" cy="8" r="3.6" stroke={c} strokeWidth="2" />
    <path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
export const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <path d="M4 7h16M4 12h16M4 17h16" stroke="#1E2E27" strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);
export const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14.5 5 8 12l6.5 7" stroke="#1E2E27" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
export const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 7h16M9.5 7V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7M6.5 7l1 12.4c.1 1 .9 1.8 1.9 1.8h5.2c1 0 1.8-.8 1.9-1.8L17.5 7"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);
export const FamilyIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <circle cx="8" cy="8" r="2.6" stroke={c} strokeWidth="2" />
    <circle cx="17" cy="9" r="2.1" stroke={c} strokeWidth="2" />
    <path d="M3 20c.7-3.4 2.6-5.2 5-5.2s4.3 1.8 5 5.2" stroke={c} strokeWidth="2" strokeLinecap="round" />
    <path d="M14.2 15.4c1.9.2 3.2 1.7 3.8 4.6" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
export const PencilIcon = ({ c = "#5C7069" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <path
      d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"
      stroke={c} strokeWidth="2" strokeLinejoin="round"
    />
  </svg>
);
export const CopyIcon = ({ c = "#5C7069" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <rect x="9" y="9" width="11" height="11" rx="2" stroke={c} strokeWidth="2" />
    <path
      d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"
      stroke={c} strokeWidth="2" strokeLinecap="round"
    />
  </svg>
);
export const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <path
      d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M14 12H4m0 0 4-4m-4 4 4 4"
      stroke="#B23B3B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);
