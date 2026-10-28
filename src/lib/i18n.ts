import english from "./translations.en.json";

export type Language = "fr" | "en";
export const languageCookie = "passetonpg-language";
export type TranslationParams = Record<string, string | number>;

export function translate(message: string, language: Language, params: TranslationParams = {}): string {
  const messages = english as Record<string, string>;
  const translated = messages[message] ?? (messages[message.trim()] === undefined ? message : message.replace(message.trim(), messages[message.trim()]));
  const template = language === "en" ? translated : message;
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : placeholder);
}
