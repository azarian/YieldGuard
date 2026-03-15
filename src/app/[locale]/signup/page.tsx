"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogoFull } from "@/components/Logo";

export default function SignUpPage() {
  const router = useRouter();
  const t = useTranslations("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"owner" | "provider">("owner");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, role } } });
    if (signUpError) { setError(signUpError.message); setLoading(false); return; }
    router.push("/dashboard");
    router.refresh();
  }

  const inputClass = "block w-full rounded-xl border border-border bg-background px-4 py-2.5 text-foreground shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand placeholder:text-muted-light";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block">
            <LogoFull className="justify-center" />
          </Link>
          <h2 className="mt-6 text-2xl font-bold text-foreground">{t("title")}</h2>
          <p className="mt-2 text-sm text-muted">{t("subtitle")}</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-foreground">{t("fullName")}</label>
              <input id="fullName" type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} placeholder={t("fullNamePlaceholder")} />
            </div>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">{t("email")}</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder={t("emailPlaceholder")} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">{t("password")}</label>
              <input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder={t("passwordPlaceholder")} />
            </div>
            <div>
              <label htmlFor="role" className="mb-1.5 block text-sm font-medium text-foreground">{t("roleLabel")}</label>
              <select id="role" value={role} onChange={(e) => setRole(e.target.value as "owner" | "provider")} className={inputClass}>
                <option value="owner">{t("roleOwner")}</option>
                <option value="provider">{t("roleProvider")}</option>
              </select>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{error}</div>
            )}

            <button type="submit" disabled={loading}
              className="flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white shadow-md shadow-brand/20 transition-all hover:bg-brand-hover hover:shadow-lg disabled:opacity-50">
              {loading ? t("submitting") : t("submit")}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          {t("hasAccount")}{" "}
          <Link href="/login" className="font-medium text-brand hover:text-brand-hover">{t("logInLink")}</Link>
        </p>
      </div>
    </div>
  );
}
