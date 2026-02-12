import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function Home() {
  const t = useTranslations("home");
  const tc = useTranslations("common");

  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="max-w-3xl">
          {/* Logo / Brand */}
          <div className="mb-8 flex items-center justify-center gap-3">
            <svg
              className="h-12 w-12 text-yellow-500"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
              />
            </svg>
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
              {t("heroTitle")}
            </h1>
          </div>

          <p className="mx-auto mb-4 max-w-2xl text-lg text-gray-600 dark:text-gray-300 sm:text-xl">
            {t("heroSubtitle")}
          </p>

          <p className="mx-auto mb-10 max-w-xl text-sm text-gray-500 dark:text-gray-400">
            {t("heroDescription")}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-yellow-500 px-8 text-base font-semibold text-white shadow-sm transition-colors hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 sm:w-auto"
            >
              {t("getStarted")}
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-8 text-base font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:w-auto"
            >
              {t("logIn")}
            </Link>
          </div>
        </div>

        {/* Feature highlights */}
        <div className="mt-20 grid max-w-4xl gap-8 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <div className="mb-3 text-3xl">☀️</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              {t("featureOwnersTitle")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("featureOwnersDesc")}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <div className="mb-3 text-3xl">🔧</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              {t("featureProvidersTitle")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("featureProvidersDesc")}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <div className="mb-3 text-3xl">📊</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              {t("featureInsightsTitle")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("featureInsightsDesc")}
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
        {tc("footer", { year: new Date().getFullYear() })}
      </footer>
    </div>
  );
}

