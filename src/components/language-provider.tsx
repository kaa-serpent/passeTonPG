"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { languageCookie, translate, type Language, type TranslationParams } from "@/lib/i18n";

type LanguageContext = {
  language: Language;
  locale: string;
  setLanguage(language: Language): void;
  t(message: string, params?: TranslationParams): string;
};
const Context = createContext<LanguageContext | null>(null);

export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: ReactNode }) {
  const [language, updateLanguage] = useState(initialLanguage);
  useEffect(() => {
    // An offline page may come from a cached shell in the other language.
    const saved = document.cookie.split("; ").find((entry) => entry.startsWith(`${languageCookie}=`))?.split("=")[1];
    if (saved === "fr" || saved === "en") updateLanguage(saved);
  }, []);
  const t = useCallback((message: string, params?: TranslationParams) => translate(message, language, params), [language]);
  const setLanguage = useCallback((next: Language) => {
    updateLanguage(next);
    document.cookie = `${languageCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t("PasseTonPG — Retrouvez le passe général");
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("Organisez vos clés et cylindres et identifiez les codes de passe général possibles."));
  }, [language, t]);
  const value = useMemo(() => ({ language, locale: language === "en" ? "en-GB" : "fr-FR", setLanguage, t }), [language, setLanguage, t]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLanguage() {
  const context = useContext(Context);
  if (!context) throw new Error("LanguageProvider is missing");
  return context;
}

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  return <select className="language-selector" aria-label={t("Langue")} value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
    <option value="fr" lang="fr">Français</option>
    <option value="en" lang="en">English</option>
  </select>;
}
