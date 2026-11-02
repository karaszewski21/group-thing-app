import { readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { matchPath } from "../routing/paths";

export const APP_DIR = resolve(process.cwd(), "src/app");

export interface AppPageFile {
  /** The page's folder under `src/app`, with `/` separators (`""` for the root). */
  dir: string;
  /** The URL pattern: route groups dropped, `[x]` → `:x`, `[[...x]]` → `*`. */
  pattern: string;
}

function toPattern(dir: string): string {
  const segments = dir
    .split("/")
    .filter((segment) => segment !== "" && !/^\(.+\)$/.test(segment))
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "*";
      const param = /^\[(.+)\]$/.exec(segment);
      return param ? `:${param[1]}` : segment;
    });
  return `/${segments.join("/")}`;
}

/** Every `page.tsx` under `src/app` with its URL pattern. */
export function appPages(): AppPageFile[] {
  return readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(sep).join("/"))
    .filter((file) => file === "page.tsx" || file.endsWith("/page.tsx"))
    .map((file) => {
      const dir = file.slice(0, -"page.tsx".length).replace(/\/$/, "");
      return { dir, pattern: toPattern(dir) };
    });
}

/** Static segments outrank dynamic ones, which outrank a catch-all, compared segment by segment. */
function rank(pattern: string): number[] {
  return pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment === "*" ? 1 : segment.startsWith(":") ? 2 : 3));
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (b[i] ?? 0) - (a[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The page the App Router serves at `pathname`, or `null` (the not-found page). */
export function pageFor(pathname: string): AppPageFile | null {
  const matching = appPages().filter((page) => matchPath(page.pattern, pathname) !== null);
  matching.sort((a, b) => compareRanks(rank(a.pattern), rank(b.pattern)));
  return matching[0] ?? null;
}
