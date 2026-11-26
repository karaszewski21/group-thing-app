import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { getGoogleNonce } from "../../api/auth";
import { ApiError } from "../../api/client";
import { extractProblemMessage } from "../../api/problem";
import { useAuth } from "../../auth/AuthContext";
import type { AuthTab } from "../../auth/authPaths";
import {
  isGoogleLoginConfigured,
  loadGoogleIdentity,
  type GoogleCredentialResponse,
  type GoogleIdApi,
} from "../../lib/googleIdentity";

/** The backend's Google copies by status; any other message or status shows the 401 one. */
const GOOGLE_ERROR_COPY = {
  401: "Nie udało się zalogować przez Google. Spróbuj ponownie.",
  403: "Ten adres w Google nie jest potwierdzony. Potwierdź go w Google albo załóż konto emailem.",
  409: "Konto z tym adresem już istnieje — zaloguj się hasłem.",
  503: "Logowanie przez Google jest chwilowo niedostępne. Zaloguj się emailem albo spróbuj później.",
} as const;

type CopyStatus = keyof typeof GOOGLE_ERROR_COPY;

const NONCE_REFRESH_MS = 9 * 60 * 1000;
/** A closing popup refocuses the page just before GIS calls back; wait for it. */
const FOCUS_REFRESH_DELAY_MS = 1000;
const MIN_BUTTON_WIDTH = 200;
const MAX_BUTTON_WIDTH = 400;

export type GoogleSignInStatus = "hidden" | "loading" | "ready";

export interface GoogleSignInError {
  message: string;
  /** A matched 409: the email belongs to an account, so the register tab offers the login tab. */
  isConflict: boolean;
}

type Session = { kind: "hidden" } | { kind: "loading" } | { kind: "ready"; api: GoogleIdApi; nonce: string };

function isCopyStatus(status: number): status is CopyStatus {
  return status in GOOGLE_ERROR_COPY;
}

function googleErrorFor(err: unknown): GoogleSignInError {
  if (err instanceof ApiError && isCopyStatus(err.status)) {
    const copy = GOOGLE_ERROR_COPY[err.status];
    if (extractProblemMessage(err) === copy) return { message: copy, isConflict: err.status === 409 };
  }
  return { message: GOOGLE_ERROR_COPY[401], isConflict: false };
}

/**
 * The "Sign in with Google" flow behind `SocialAuthButtons`: nonce → GIS
 * script → `initialize` → `renderButton` into `slotRef`, all in effects (the
 * first render depends only on the inlined client ID, so it matches the server
 * one). After a failed sign-in it shows the error and fetches a new nonce; the
 * POST is never retried. The nonce is refreshed 9 minutes after each fetch,
 * but only marked stale while the tab is hidden, a popup is likely open
 * (`document.hasFocus()` is false) or a POST is in flight, and refreshed on
 * the return (on `focus` only after a 1 s pause, so a closing popup's
 * credential wins). Only one `/nonce` request runs at a time, shared by every
 * refresh and by StrictMode's second mount, so the cookie always holds the
 * nonce GIS was last initialized with.
 *
 * Assumes one live instance per page: the GIS callback is page-global, so a
 * second `initialize` takes it over (`/login` and `AuthSheet` never mount together).
 */
export function useGoogleSignIn(tab: AuthTab): {
  status: GoogleSignInStatus;
  slotRef: RefObject<HTMLDivElement | null>;
  error: GoogleSignInError | null;
} {
  const { loginWithGoogle } = useAuth();
  const [session, setSession] = useState<Session>(() =>
    isGoogleLoginConfigured() ? { kind: "loading" } : { kind: "hidden" },
  );
  const [error, setError] = useState<GoogleSignInError | null>(null);
  const [errorTab, setErrorTab] = useState(tab);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);
  const refreshNonce = useRef<(() => Promise<void>) | null>(null);
  const nonceRequest = useRef<Promise<string | null> | null>(null);

  if (errorTab !== tab) {
    setErrorTab(tab);
    setError(null);
  }

  const onCredential = useEffectEvent(async ({ credential }: GoogleCredentialResponse) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      await loginWithGoogle(credential);
      inFlight.current = false;
    } catch (err) {
      inFlight.current = false;
      setError(googleErrorFor(err));
      await refreshNonce.current?.();
    }
  });

  useEffect(() => {
    if (!isGoogleLoginConfigured()) return;
    let disposed = false;
    let generation = 0;
    let stale = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;

    function requestNonce(): Promise<string | null> {
      if (nonceRequest.current) return nonceRequest.current;
      const request = getGoogleNonce();
      const clear = () => {
        if (nonceRequest.current === request) nonceRequest.current = null;
      };
      request.then(clear, clear);
      nonceRequest.current = request;
      return request;
    }

    async function fetchNonce() {
      const run = ++generation;
      stale = false;
      clearTimeout(timer);
      let next: Session = { kind: "hidden" };
      try {
        const nonce = await requestNonce();
        const api = nonce === null ? null : await loadGoogleIdentity();
        if (nonce !== null && api !== null) next = { kind: "ready", api, nonce };
      } catch {
        // Any failure hides the block; an earlier sign-in error stays shown.
      }
      if (disposed || run !== generation) return;
      setSession(next);
      if (next.kind === "ready") timer = setTimeout(onTimer, NONCE_REFRESH_MS);
    }

    function onTimer() {
      if (document.visibilityState === "hidden" || !document.hasFocus() || inFlight.current) {
        stale = true;
        return;
      }
      void fetchNonce();
    }

    function onReturn() {
      if (!stale || inFlight.current || document.visibilityState === "hidden" || !document.hasFocus()) return;
      void fetchNonce();
    }

    function onFocus() {
      clearTimeout(focusTimer);
      focusTimer = setTimeout(onReturn, FOCUS_REFRESH_DELAY_MS);
    }

    refreshNonce.current = fetchNonce;
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onFocus);
    void fetchNonce();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(focusTimer);
      refreshNonce.current = null;
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const slot = slotRef.current;
    if (session.kind !== "ready" || !slot) return;
    let current = true;
    session.api.initialize({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
      nonce: session.nonce,
      callback: (response) => {
        if (current) void onCredential(response);
      },
      ux_mode: "popup",
      auto_select: false,
    });
    session.api.renderButton(slot, {
      type: "standard",
      theme: "outline",
      shape: "pill",
      size: "large",
      logo_alignment: "left",
      locale: "pl",
      text: tab === "login" ? "signin_with" : "signup_with",
      width: Math.min(MAX_BUTTON_WIDTH, Math.max(MIN_BUTTON_WIDTH, slot.clientWidth)),
    });
    return () => {
      current = false;
    };
  }, [session, tab]);

  return { status: session.kind, slotRef, error };
}
