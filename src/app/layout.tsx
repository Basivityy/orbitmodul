import type { Metadata, Viewport } from "next";
import "./globals.css";
import { refreshPublicUrl } from "@/lib/publicUrl";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: { default: env.platformName, template: `%s · ${env.platformName}` },
  description: process.env.PLATFORM_TAGLINE || "Billing, activation codes and automatic line activation for resellers",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: env.platformName },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#000000" };

// Applies the saved theme before first paint (no flash). Static string, no user input.
// Dark (black & yellow) is the default; light only when the user picked it.
const themeScript = `try{if(localStorage.getItem('theme')==='light'){document.documentElement.classList.remove('dark')}}catch(e){}`;

const FONT_URL = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap";
const fontScript = `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='${FONT_URL}';document.head.appendChild(l)})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await refreshPublicUrl();
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Font loads after first paint (never blocks the page on slow mobile networks). */}
        <script dangerouslySetInnerHTML={{ __html: fontScript }} />
        <noscript><link rel="stylesheet" href={FONT_URL} /></noscript>
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
