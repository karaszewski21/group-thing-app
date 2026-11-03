import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { sessionFromToken } from "../auth/session";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Krąg grupy",
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const initialSession = sessionFromToken((await cookies()).get("auth_token")?.value);
  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Figtree:wght@400..800&display=swap"
        />
      </head>
      <body>
        <div id="root">
          <Providers initialSession={initialSession}>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
