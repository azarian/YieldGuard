import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "he"],
  defaultLocale: "en",
});

export const localeNames: Record<string, string> = {
  en: "English",
  he: "עברית",
};

export const rtlLocales = new Set(["he"]);

