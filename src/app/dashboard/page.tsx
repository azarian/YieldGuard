import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

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
  const displayName = profile?.full_name ?? user.email;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">
        Dashboard
      </h1>
      <p className="mb-8 text-gray-500 dark:text-gray-400">
        Welcome back, <span className="font-medium text-gray-900 dark:text-white">{displayName}</span>
      </p>

      {/* Role-specific content */}
      <div className="rounded-xl border border-gray-200 p-8 dark:border-gray-700">
        {role === "owner" && (
          <>
            <div className="mb-4 text-4xl">☀️</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
              Solar System Owner
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              Your systems overview will appear here. You&apos;ll be able to monitor
              performance, track energy yield, and request maintenance services.
            </p>
          </>
        )}

        {role === "provider" && (
          <>
            <div className="mb-4 text-4xl">🔧</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
              Service Provider
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              Your order management panel will appear here. You&apos;ll be able to
              manage service requests, customer communication, and your schedule.
            </p>
          </>
        )}

        {role === "admin" && (
          <>
            <div className="mb-4 text-4xl">⚙️</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
              System Admin
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              System management tools will appear here. You&apos;ll have full
              access to manage users, services, and platform settings.
            </p>
          </>
        )}
      </div>

      {/* Quick info cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Role</p>
          <p className="mt-1 text-lg font-semibold capitalize text-gray-900 dark:text-white">
            {role}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
            {user.email}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
          <p className="mt-1 text-lg font-semibold text-green-600">Active</p>
        </div>
      </div>
    </div>
  );
}

