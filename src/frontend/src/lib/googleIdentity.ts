/**
 * Loader for Google Identity Services (the "Sign in with Google" button),
 * cloned from the `googleMaps.ts` loader. Nothing loads at import time; the
 * auth form calls `loadGoogleIdentity()` only when a client ID is configured.
 */

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
const SCRIPT_ID = "google-identity-services";
const LOAD_TIMEOUT_MS = 10_000;

export interface GoogleCredentialResponse {
  credential: string;
}

export interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  ux_mode?: "popup" | "redirect";
  auto_select?: boolean;
}

export interface GoogleButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
}

/** The narrow slice of `google.accounts.id` the app uses. */
export interface GoogleIdApi {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
}

interface GoogleIdentityWindow {
  google?: { accounts?: { id?: GoogleIdApi } };
}

/** Reads the env on every call (never cached) so tests can flip modes with `vi.stubEnv`. */
export function isGoogleLoginConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
}

let identityPromise: Promise<GoogleIdApi | null> | null = null;

/** Memoized; resolves `null` without a client ID, on a script error or after
 * 10 s, and forgets a failed attempt so the next call can retry. */
export function loadGoogleIdentity(): Promise<GoogleIdApi | null> {
  if (!identityPromise) {
    identityPromise = loadWithTimeout().then((api) => {
      if (!api) identityPromise = null;
      return api;
    });
  }
  return identityPromise;
}

async function loadWithTimeout(): Promise<GoogleIdApi | null> {
  if (!isGoogleLoginConfigured()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([ensureIdentityScript(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readyApi(): GoogleIdApi | undefined {
  return (window as GoogleIdentityWindow).google?.accounts?.id;
}

/** The tag this module injected and the one promise its load/error listeners settle. */
let pendingScript: { script: HTMLElement; loaded: Promise<GoogleIdApi> } | null = null;

/** A retry after a timeout shares the promise of the tag still loading instead
 * of adding a second tag or listener pair; a tag that already loaded yet left
 * no `google.accounts.id` is stale and gets replaced. */
function ensureIdentityScript(): Promise<GoogleIdApi> {
  const ready = readyApi();
  if (ready) return Promise.resolve(ready);
  const existing = document.getElementById(SCRIPT_ID);
  if (existing && pendingScript?.script === existing && !existing.dataset.loaded) return pendingScript.loaded;
  existing?.remove();
  const script = document.createElement("script");
  const loaded = new Promise<GoogleIdApi>((resolve, reject) => {
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      const api = readyApi();
      if (api) resolve(api);
      else reject(new Error("Google Identity Services did not initialise"));
    });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Google Identity Services script failed to load"));
    });
  });
  pendingScript = { script, loaded };
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = SCRIPT_URL;
  document.head.appendChild(script);
  return loaded;
}
