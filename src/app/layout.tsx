import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/components/language-provider";
import { languageCookie, translate } from "@/lib/i18n";
import "./globals.css";

const baseMetadata: Metadata = {
  title: "PasseTonPG — Retrouvez le passe général",
  description: "Organisez vos clés et cylindres et identifiez les codes de passe général possibles.",
  applicationName: "PasseTonPG",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "PasseTonPG" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export async function generateMetadata(): Promise<Metadata> {
  const language = (await cookies()).get(languageCookie)?.value === "en" ? "en" : "fr";
  return { ...baseMetadata, title: translate("PasseTonPG — Retrouvez le passe général", language), description: translate("Organisez vos clés et cylindres et identifiez les codes de passe général possibles.", language) };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f7fb" }, { media: "(prefers-color-scheme: dark)", color: "#101722" }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const language = (await cookies()).get(languageCookie)?.value === "en" ? "en" : "fr";
  return <html lang={language}><body><LanguageProvider initialLanguage={language}>{children}</LanguageProvider></body></html>;
}
