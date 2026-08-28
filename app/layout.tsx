import type { Metadata } from "next";
import { Almarai, IBM_Plex_Sans_Arabic, IBM_Plex_Mono } from "next/font/google";
import { DIR, HTML_LANG, t } from "@/lib/strings";
import "./globals.css";

// Self-hosted at build time by next/font — no request to Google at runtime,
// no layout shift, and no PHI-adjacent third-party call on page load.
const almarai = Almarai({
  subsets: ["arabic", "latin"],
  weight: ["400", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-data",
  display: "swap",
});

export const metadata: Metadata = {
  title: t("appName"),
  description: t("appTagline"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang={HTML_LANG}
      dir={DIR}
      className={`${almarai.variable} ${plexArabic.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the saved theme before first paint. Without this the page
            flashes the OS theme for a frame before React hydrates. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("clinicos-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{--display:var(--font-display),"Segoe UI",Tahoma,sans-serif;--body:var(--font-body),"Segoe UI",Tahoma,sans-serif;--data:var(--font-data),ui-monospace,monospace}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
