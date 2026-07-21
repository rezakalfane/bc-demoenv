import type { AppLocale } from "@/lib/db";

export const APP_LOCALES = ["en", "fr", "es", "it"] as const satisfies readonly AppLocale[];
export const DEFAULT_APP_LOCALE: AppLocale = "en";
export const APP_LOCALE_COOKIE = "bc-demoenv-locale";

export function normalizeAppLocale(value: unknown): AppLocale {
  return value === "fr" || value === "es" || value === "it" ? value : DEFAULT_APP_LOCALE;
}

export function appLocaleLabel(locale: AppLocale) {
  return locale === "fr"
    ? "Français"
    : locale === "es"
      ? "Español"
      : locale === "it" ? "Italiano" : "English";
}
