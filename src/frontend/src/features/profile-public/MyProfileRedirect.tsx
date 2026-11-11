"use client";

import { Navigate } from "../../routing/navigation";
import { useAppData } from "../panel/appDataStore";

/** `/profile`, kept for old links: the caller's own public profile at
 * `/<party-id>`, where its settings live. */
export function MyProfileRedirect() {
  const { profile } = useAppData();
  if (!profile) return <p className="text-[12.5px] text-ink-soft">Wczytywanie…</p>;
  return <Navigate to={`/${profile.party_id}`} replace />;
}
