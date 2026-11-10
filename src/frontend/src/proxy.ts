import { NextResponse, type NextRequest } from "next/server";
import { authPath } from "./auth/authPaths";
import { isAppearancePath, PROTECTED_PREFIXES } from "./routing/paths";

export interface ProxyRequest {
  method: string;
  pathname: string;
  search: string;
  /** An `auth_token` cookie is present. Only a hint: the JWT is never verified here. */
  hasSession: boolean;
}

export type ProxyDecision =
  | { kind: "next" }
  | { kind: "redirect"; location: string }
  | { kind: "rewrite"; destination: string };

function isProtected(pathname: string): boolean {
  if (isAppearancePath(pathname)) return true;
  return PROTECTED_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function resolveProxy(
  { method, pathname, search, hasSession }: ProxyRequest,
  backendUrl: string,
): ProxyDecision {
  if (pathname === "/home") return { kind: "redirect", location: `/${search}` };
  if (pathname === "/" && hasSession) return { kind: "rewrite", destination: `/home${search}` };
  // The GET is the consent page; the form POST belongs to the backend.
  if (pathname === "/oauth2/authorize" && method === "POST") {
    return { kind: "rewrite", destination: `${backendUrl}/oauth2/authorize${search}` };
  }
  if (!hasSession && isProtected(pathname)) {
    return { kind: "redirect", location: authPath("login", pathname + search) };
  }
  return { kind: "next" };
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const decision = resolveProxy(
    { method: request.method, pathname, search, hasSession: Boolean(request.cookies.get("auth_token")?.value) },
    process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080",
  );
  switch (decision.kind) {
    case "redirect":
      return NextResponse.redirect(new URL(decision.location, request.url));
    case "rewrite":
      return NextResponse.rewrite(new URL(decision.destination, request.url));
    case "next":
      return NextResponse.next();
  }
}

// `/api/*` must stay unmatched: the proxy buffers bodies up to 10 MB, and uploads go up to 15 MB.
export const config = {
  matcher: "/((?!api/|_next/|assets/|\\.well-known/|favicon\\.svg|icons\\.svg).*)",
};
