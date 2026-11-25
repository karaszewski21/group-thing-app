import { useState } from "react";
import { useClientValue } from "../../lib/useClientValue";
import { RADII_KM } from "../../utils/appHelpers";

const STORAGE_KEY = "home.radius";
/** „Tylko tu”: the visitor's locality alone. */
const ONLY_HERE = "only";
export const DEFAULT_HOME_RADIUS_KM = 25;

/** A stored radius (`null` for „Tylko tu”), or the default for none, junk
 * or blocked storage. */
function readStoredRadius(): number | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === ONLY_HERE) return null;
    return RADII_KM.find((km) => String(km) === stored) ?? DEFAULT_HOME_RADIUS_KM;
  } catch {
    return DEFAULT_HOME_RADIUS_KM;
  }
}

/** The home feed's radius around the visitor's locality, one of `RADII_KM`
 * or `null` for „Tylko tu”, remembered on this device. */
export function useHomeRadius(): [number | null, (km: number | null) => void] {
  const stored = useClientValue(readStoredRadius, DEFAULT_HOME_RADIUS_KM);
  const [picked, setPicked] = useState<{ km: number | null } | null>(null);

  function pick(km: number | null) {
    try {
      localStorage.setItem(STORAGE_KEY, km === null ? ONLY_HERE : String(km));
    } catch {
      // Storage is blocked: the pick holds for this visit only.
    }
    setPicked({ km });
  }

  return [picked ? picked.km : stored, pick];
}
