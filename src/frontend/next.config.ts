import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080";

/** Backend routes Next forwards in dev and when nginx is not in front.
 * `POST /oauth2/authorize` is not here: the proxy rewrites it, since the
 * GET is a Next page. */
const BACKEND_PATHS = ["/api/:path*", "/oauth2/register", "/oauth2/token", "/oauth2/introspect", "/.well-known/:path*"];

const nextConfig: NextConfig = {
  output: "standalone",
  // Stops `next dev` from writing AGENTS.md into the project.
  agentRules: false,
  // The repo root has its own package-lock.json, which Next would otherwise
  // take as the workspace root.
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
  // Plugins on other origins load the SDK with `crossorigin`.
  async headers() {
    return [{ source: "/assets/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
  async rewrites() {
    return BACKEND_PATHS.map((source) => ({ source, destination: `${backendUrl}${source}` }));
  },
};

export default nextConfig;
