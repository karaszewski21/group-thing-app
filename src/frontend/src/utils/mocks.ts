import type { ItemMode } from "./appHelpers";

/* ------------------------------------------------------------------ */
/*  MOCK — sample data for panel sections that have no backend yet:     */
/*  "Ostatnio dodane" on Start, the landing page meetings and "Szukam". */
/*  Replace with real API hooks once the endpoints exist.              */
/* ------------------------------------------------------------------ */

export interface MockItem {
  id: string;
  name: string;
  owner: string;
  mode: ItemMode;
  addedAgo: string;
}

export interface MockMeeting {
  id: string;
  group: string;
  organizer: string;
  occursOn: string;
  spots: string;
}

export interface MockWant {
  id: string;
  name: string;
  modes: ItemMode[];
  matches: number;
}

export const MOCK_RECENT_ITEMS: MockItem[] = [
  { id: "m1", name: "Fotelik 9–18 kg", owner: "Anna K.", mode: "oddam", addedAgo: "2 godz." },
  { id: "m2", name: "Body 74, 5 szt.", owner: "Marta W.", mode: "oddam", addedAgo: "wczoraj" },
  { id: "m3", name: "Klocki drewniane", owner: "Kasia P.", mode: "zamienię", addedAgo: "wczoraj" },
  { id: "m4", name: "Leżaczek bujany", owner: "Ola S.", mode: "zamienię", addedAgo: "2 dni" },
  { id: "m5", name: "Kalosze 25", owner: "Ewa M.", mode: "oddam", addedAgo: "3 dni" },
  { id: "m6", name: "Rowerek 12\"", owner: "Piotr L.", mode: "zamienię", addedAgo: "4 dni" },
];

export const MOCK_SEARCH_MEETINGS: MockMeeting[] = [
  { id: "s1", group: "Mali Odkrywcy", organizer: "Pracownia Ciekawości", occursOn: "2026-11-03T17:00:00", spots: "3 wolne miejsca" },
  { id: "s2", group: "Joga dla rodzin", organizer: "Studio Oddech", occursOn: "2026-11-07T09:30:00", spots: "1 wolne miejsce" },
  { id: "s3", group: "Spacer z wózkami", organizer: "Mamy z Mokotowa", occursOn: "2026-11-07T10:00:00", spots: "Bez limitu" },
  { id: "s4", group: "Muzyczne Maluchy", organizer: "rodzinny grajdołek", occursOn: "2026-11-09T10:00:00", spots: "Lista rezerwowa" },
];

export const MOCK_WANTS: MockWant[] = [
  { id: "w1", name: "Fotelik samochodowy 9–18 kg", modes: ["oddam"], matches: 2 },
  { id: "w2", name: "Kurtka zimowa 110", modes: ["oddam", "zamienię"], matches: 0 },
  { id: "w3", name: "Rowerek biegowy", modes: ["oddam", "zamienię"], matches: 1 },
];
