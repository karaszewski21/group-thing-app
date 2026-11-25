import { useCallback, useEffect, useState } from "react";
import type { LocationConsent } from "./homeFeedViewState";

const OFF_KEY = "home.location.declined";
const POSITION_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 };

/** Two decimals, about 1 km: enough to find the locality, and the visitor's
 * exact position never leaves the browser. */
function coarse(degrees: number): number {
  return Math.round(degrees * 100) / 100;
}

function readTurnedOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function storeTurnedOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // Storage is blocked: the choice holds for this visit only.
  }
}

/** The starting consent, without prompting. „Nie teraz” or „Wyłącz” on this
 * device wins over a granted permission; a browser that blocks the location
 * (or has none) cannot be asked again from the page; `granted` locates at
 * once; anything else asks first. */
async function initialConsent(): Promise<"granted" | "ask" | "turnedOff" | "blocked"> {
  if (!("geolocation" in navigator)) return "blocked";
  if (readTurnedOff()) return "turnedOff";
  let state: PermissionState | null = null;
  try {
    state = (await navigator.permissions?.query({ name: "geolocation" }))?.state ?? null;
  } catch {
    state = null;
  }
  if (state === "granted") return "granted";
  if (state === "denied") return "blocked";
  return "ask";
}

/** The home feed's location consent. The browser's permission prompt shows
 * only after `turnOn()` (the visitor's „Włącz lokalizację”); `turnOff()`
 * („Nie teraz” or „Wyłącz”) is remembered on this device until the visitor
 * turns it on again. A prompt the browser denies leaves it off without a way
 * back from the page; any other failure (a timeout, no position) falls back to
 * the newest and may be retried. */
export function useLocationConsent(): { consent: LocationConsent; turnOn: () => void; turnOff: () => void } {
  const [consent, setConsent] = useState<LocationConsent>({ kind: "checking" });

  const locate = useCallback(() => {
    setConsent({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        setConsent({ kind: "located", point: { lat: coarse(coords.latitude), lng: coarse(coords.longitude) } }),
      (error) => setConsent({ kind: "off", canTurnOn: error.code !== error.PERMISSION_DENIED }),
      POSITION_OPTIONS,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void initialConsent().then((initial) => {
      if (cancelled) return;
      if (initial === "granted") locate();
      else if (initial === "ask") setConsent({ kind: "ask" });
      else setConsent({ kind: "off", canTurnOn: initial === "turnedOff" });
    });
    return () => {
      cancelled = true;
    };
  }, [locate]);

  const turnOn = useCallback(() => {
    storeTurnedOff(false);
    locate();
  }, [locate]);

  const turnOff = useCallback(() => {
    storeTurnedOff(true);
    setConsent({ kind: "off", canTurnOn: true });
  }, []);

  return { consent, turnOn, turnOff };
}
