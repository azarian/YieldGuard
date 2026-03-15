"use client";

import { useEffect, useState, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { routing } from "@/i18n/routing";
import { LogoFull } from "@/components/Logo";
import type { User } from "@supabase/supabase-js";

const localeConfig: Record<string, { flag: string; label: string }> = {
  en: { flag: "🇬🇧", label: "English" },
  he: { flag: "🇮🇱", label: "עברית" },
};

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("navbar");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [langOpen, setLangOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    router.push("/");
    router.refresh();
  }

  function switchLocale(newLocale: string) {
    router.replace(pathname, { locale: newLocale as "en" | "he" });
    setLangOpen(false);
  }

  const current = localeConfig[locale] ?? localeConfig.en;

  const navLinks = user
    ? [
        { href: "/dashboard" as const, label: t("dashboard") },
        { href: "/dashboard/system" as const, label: t("mySystem") },
      ]
    : [];

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-surface/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/">
          <LogoFull />
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}

          <div className="mx-2 h-5 w-px bg-border" />

          {/* Language picker */}
          <div className="relative" ref={langRef}>
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              aria-label="Select language"
            >
              <span className="text-base leading-none">{current.flag}</span>
              <span className="hidden lg:inline">{current.label}</span>
              <svg className={`h-3.5 w-3.5 text-muted-light transition-transform ${langOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {langOpen && (
              <div className="absolute end-0 z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                {routing.locales.map((loc) => {
                  const cfg = localeConfig[loc] ?? { flag: "🌐", label: loc };
                  const isActive = loc === locale;
                  return (
                    <button
                      key={loc}
                      onClick={() => switchLocale(loc)}
                      className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-start text-sm transition-colors ${
                        isActive
                          ? "bg-brand-light font-semibold text-brand"
                          : "text-foreground hover:bg-surface-hover"
                      }`}
                    >
                      <span className="text-base leading-none">{cfg.flag}</span>
                      <span>{cfg.label}</span>
                      {isActive && (
                        <svg className="ms-auto h-4 w-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {loading ? (
            <div className="h-8 w-20 animate-pulse rounded-lg bg-border-light" />
          ) : user ? (
            <button
              onClick={handleSignOut}
              className="ms-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              {t("logOut")}
            </button>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {t("logIn")}
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover"
              >
                {t("signUp")}
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-lg p-2 text-muted hover:bg-surface-hover md:hidden"
          aria-label="Menu"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-surface px-6 pb-4 pt-2 md:hidden">
          <div className="space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}

            {/* Language options */}
            <div className="border-t border-border pt-2">
              {routing.locales.map((loc) => {
                const cfg = localeConfig[loc] ?? { flag: "🌐", label: loc };
                const isActive = loc === locale;
                return (
                  <button
                    key={loc}
                    onClick={() => { switchLocale(loc); setMobileOpen(false); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-sm transition-colors ${
                      isActive ? "font-semibold text-brand" : "text-muted hover:bg-surface-hover"
                    }`}
                  >
                    <span className="text-base">{cfg.flag}</span>
                    <span>{cfg.label}</span>
                  </button>
                );
              })}
            </div>

            {!loading && (
              <div className="border-t border-border pt-2">
                {user ? (
                  <button
                    onClick={() => { handleSignOut(); setMobileOpen(false); }}
                    className="w-full rounded-lg px-3 py-2.5 text-start text-sm font-medium text-muted transition-colors hover:bg-surface-hover"
                  >
                    {t("logOut")}
                  </button>
                ) : (
                  <>
                    <Link href="/login" onClick={() => setMobileOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-hover">
                      {t("logIn")}
                    </Link>
                    <Link href="/signup" onClick={() => setMobileOpen(false)} className="mt-1 block rounded-lg bg-brand px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-hover">
                      {t("signUp")}
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
