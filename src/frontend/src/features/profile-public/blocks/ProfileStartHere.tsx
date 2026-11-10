"use client";

import { usePartyProfilePage } from "../PartyProfileContext";
import { ProfileEmptyBox } from "./ProfileEmptyBox";

/** The owner's single box while they have neither terms nor items; the
 * terms and items sections then stay empty. */
export function ProfileStartHere() {
  const { profile, hasTerms, hasItems } = usePartyProfilePage();
  if (!profile.is_me || hasTerms || hasItems) return null;
  return <ProfileEmptyBox title="Nie masz jeszcze ani terminów, ani rzeczy" addLabel="Dodaj termin lub rzecz" />;
}
