import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LogoIcon } from "@/components/Logo";

export default function Home() {
  const t = useTranslations("home");

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-6 pb-20 pt-16 sm:pb-28 sm:pt-24">
        {/* Subtle gradient background */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-x-0 top-0 h-[500px] bg-gradient-to-b from-brand-light/40 to-transparent dark:from-brand-light/10" />
          <div className="absolute end-0 top-20 h-72 w-72 rounded-full bg-brand/5 blur-3xl" />
          <div className="absolute start-0 top-40 h-56 w-56 rounded-full bg-accent/5 blur-3xl" />
        </div>

        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-8 flex justify-center">
            <LogoIcon className="h-16 w-16 text-brand" />
          </div>

          <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {t("heroTitle")}
          </h1>

          <p className="mx-auto mb-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
            {t("heroSubtitle")}
          </p>

          <p className="mx-auto mb-10 max-w-xl text-sm text-muted-light">
            {t("heroDescription")}
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/signup"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand px-8 text-base font-semibold text-white shadow-md shadow-brand/20 transition-all hover:bg-brand-hover hover:shadow-lg hover:shadow-brand/30 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 sm:w-auto"
            >
              {t("getStarted")}
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-border bg-surface px-8 text-base font-semibold text-foreground shadow-sm transition-colors hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 sm:w-auto"
            >
              {t("logIn")}
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border-light px-6 py-16 sm:py-20">
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-3">
          {/* Solar Owners */}
          <div className="group rounded-2xl border border-border bg-surface p-6 transition-all hover:border-brand/30 hover:shadow-lg hover:shadow-brand/5">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-light">
              <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">
              {t("featureOwnersTitle")}
            </h3>
            <p className="text-sm leading-relaxed text-muted">
              {t("featureOwnersDesc")}
            </p>
          </div>

          {/* Service Providers */}
          <div className="group rounded-2xl border border-border bg-surface p-6 transition-all hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-light">
              <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.65-5.65a2.12 2.12 0 010-3l.71-.71a2.12 2.12 0 013 0l5.65 5.65M11.42 15.17l2.12 2.12a2.12 2.12 0 003 0l.71-.71a2.12 2.12 0 000-3l-2.12-2.12M11.42 15.17L7.75 18.84" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">
              {t("featureProvidersTitle")}
            </h3>
            <p className="text-sm leading-relaxed text-muted">
              {t("featureProvidersDesc")}
            </p>
          </div>

          {/* Insights */}
          <div className="group rounded-2xl border border-border bg-surface p-6 transition-all hover:border-blue-400/30 hover:shadow-lg hover:shadow-blue-400/5">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
              <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">
              {t("featureInsightsTitle")}
            </h3>
            <p className="text-sm leading-relaxed text-muted">
              {t("featureInsightsDesc")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
