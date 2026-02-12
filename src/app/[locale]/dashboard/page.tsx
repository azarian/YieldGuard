import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const t = await getTranslations("dashboard");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch the user's profile to get their role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "owner";
  const displayName = profile?.full_name ?? user.email ?? "";

  // Fetch user's solar system (for owners)
  let solarSystem: { system_name: string; last_synced_at: string | null } | null = null;
  if (role === "owner") {
    const { data } = await supabase
      .from("solar_systems")
      .select("system_name, last_synced_at")
      .eq("user_id", user.id)
      .single();
    solarSystem = data;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">
        {t("title")}
      </h1>
      <p className="mb-8 text-gray-500 dark:text-gray-400">
        {t("welcomeBack", { name: displayName })}
      </p>

      {/* Role-specific content */}
      <div className="rounded-xl border border-gray-200 p-8 dark:border-gray-700">
        {role === "owner" && (
          <>
            <div className="mb-4 text-4xl">☀️</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
              {t("ownerTitle")}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              {t("ownerDesc")}
            </p>

            {/* Solar system summary */}
            <div className="mt-6 rounded-lg border border-gray-200 p-5 dark:border-gray-700">
              {solarSystem ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {solarSystem.system_name}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                      {solarSystem.last_synced_at
                        ? t("lastSynced", {
                            date: new Date(
                              solarSystem.last_synced_at
                            ).toLocaleString(),
                          })
                        : t("neverSynced")}
                    </p>
                  </div>
                  <Link
                    href={`/${locale}/dashboard/system`}
                    className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-yellow-600"
                  >
                    {t("manageSystem")}
                  </Link>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-500 dark:text-gray-400">
                      {t("noSystemRegistered")}
                    </p>
                  </div>
                  <Link
                    href={`/${locale}/dashboard/system`}
                    className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-yellow-600"
                  >
                    {t("registerSystem")}
                  </Link>
                </div>
              )}
            </div>
          </>
        )}

        {role === "provider" && (
          <>
            <div className="mb-4 text-4xl">🔧</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
              {t("providerTitle")}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              {t("providerDesc")}
            </p>
          </>
        )}

        {role === "admin" && (
          <>
            <div className="mb-4 text-4xl">⚙️</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
              {t("adminTitle")}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              {t("adminDesc")}
            </p>
          </>
        )}
      </div>

      {/* Quick info cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("roleLabel")}</p>
          <p className="mt-1 text-lg font-semibold capitalize text-gray-900 dark:text-white">
            {role}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("emailLabel")}</p>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
            {user.email}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("statusLabel")}</p>
          <p className="mt-1 text-lg font-semibold text-green-600">{t("statusActive")}</p>
        </div>
      </div>
    </div>
  );
}
