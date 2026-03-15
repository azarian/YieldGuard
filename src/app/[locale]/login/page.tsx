"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogoFull } from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) { setError(signInError.message); setLoading(false); return; }
    router.push("/dashboard");
    router.refresh();
  }

  const inputClass = "block w-full rounded-xl border border-border bg-background px-4 py-2.5 text-foreground shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand placeholder:text-muted-light";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4">
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
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">{t("email")}</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder={t("emailPlaceholder")} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">{t("password")}</label>
              <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder={t("passwordPlaceholder")} />
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
          {t("noAccount")}{" "}
          <Link href="/signup" className="font-medium text-brand hover:text-brand-hover">{t("signUpLink")}</Link>
        </p>
      </div>
    </div>
  );
}
