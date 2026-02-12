import Link from "next/link";

export default function Home() {
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
              YieldGuard
            </h1>
          </div>

          <p className="mx-auto mb-4 max-w-2xl text-lg text-gray-600 dark:text-gray-300 sm:text-xl">
            Monitor your solar system performance, maximize energy yield, and
            connect with trusted service providers — all in one place.
          </p>

          <p className="mx-auto mb-10 max-w-xl text-sm text-gray-500 dark:text-gray-400">
            Whether you own a home solar setup or provide maintenance services,
            YieldGuard keeps everything running at peak efficiency.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-yellow-500 px-8 text-base font-semibold text-white shadow-sm transition-colors hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 sm:w-auto"
            >
              Get Started
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-8 text-base font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:w-auto"
            >
              Log In
            </Link>
          </div>
        </div>

        {/* Feature highlights */}
        <div className="mt-20 grid max-w-4xl gap-8 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <div className="mb-3 text-3xl">☀️</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              Solar Owners
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Track your system&apos;s performance, get alerts, and request
              maintenance with a single click.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <div className="mb-3 text-3xl">🔧</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              Service Providers
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manage orders, schedules, and customer communication from your
              dedicated dashboard.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <div className="mb-3 text-3xl">📊</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              Real-Time Insights
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Actionable data on energy yield, cleaning schedules, and system
              health — at your fingertips.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
        &copy; {new Date().getFullYear()} YieldGuard. All rights reserved.
      </footer>
    </div>
  );
}
