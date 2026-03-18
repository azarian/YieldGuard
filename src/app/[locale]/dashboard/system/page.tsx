"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import SolarEdgeInstructions from "@/components/SolarEdgeInstructions";

interface SolarSystem {
  id: string; user_id: string; site_id: string; api_key: string; system_name: string;
  provider: string; created_at: string; last_synced_at: string | null;
  electricity_price_per_kwh: number | null; currency: string;
  latitude: number | null; longitude: number | null;
  peak_power_kwp: number | null; azimuth: number | null; tilt: number | null;
}

const CURRENCIES: { code: string; symbol: string; label: string }[] = [
  { code: "ILS", symbol: "₪", label: "₪ ILS" },
  { code: "USD", symbol: "$", label: "$ USD" },
  { code: "EUR", symbol: "€", label: "€ EUR" },
];

function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

export default function SystemPage() {
  const t = useTranslations("system");
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<SolarSystem | null>(null);
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [systemName, setSystemName] = useState("");
  const [siteId, setSiteId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [electricityPrice, setElectricityPrice] = useState("");
  const [currency, setCurrency] = useState("ILS");

  const fetchSystem = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("solar_systems").select("*").eq("user_id", user.id).single();
    if (data) { setSystem(data); setSystemName(data.system_name); setSiteId(data.site_id); setApiKey(data.api_key); setElectricityPrice(data.electricity_price_per_kwh?.toString() ?? ""); setCurrency(data.currency ?? "ILS"); }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchSystem(); }, [fetchSystem]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault(); setFormError(null); setFormLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setFormError("Not authenticated"); setFormLoading(false); return; }
    const { data, error } = await supabase.from("solar_systems").insert({ user_id: user.id, system_name: systemName, site_id: siteId, api_key: apiKey, provider: "solaredge", electricity_price_per_kwh: electricityPrice ? parseFloat(electricityPrice) : null, currency }).select().single();
    if (error) { setFormError(error.message); setFormLoading(false); return; }
    setSystem(data); setFormLoading(false);
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault(); if (!system) return; setFormError(null); setFormLoading(true);
    const { data, error } = await supabase.from("solar_systems").update({ system_name: systemName, site_id: siteId, api_key: apiKey, electricity_price_per_kwh: electricityPrice ? parseFloat(electricityPrice) : null, currency }).eq("id", system.id).select().single();
    if (error) { setFormError(error.message); setFormLoading(false); return; }
    setSystem(data); setEditing(false); setFormLoading(false);
  }

  async function handleDelete() {
    if (!system) return; if (!window.confirm(t("deleteConfirm"))) return;
    setFormLoading(true);
    const { error } = await supabase.from("solar_systems").delete().eq("id", system.id);
    if (error) { setFormError(error.message); setFormLoading(false); return; }
    setSystem(null); setSystemName(""); setSiteId(""); setApiKey(""); setElectricityPrice(""); setCurrency("ILS"); setFormLoading(false);
  }

  const inputClass = "block w-full rounded-xl border border-border bg-background px-4 py-2.5 text-foreground shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand placeholder:text-muted-light";

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-border-light" />
        <div className="mt-4 h-64 animate-pulse rounded-2xl bg-border-light" />
      </div>
    );
  }

  /* ─── No system: registration form ─── */
  if (!system) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          {t("backToDashboard")}
        </Link>

        <h1 className="mb-2 text-3xl font-bold text-foreground">{t("registerTitle")}</h1>
        <p className="mb-8 text-muted">{t("registerSubtitle")}</p>

        <div className="mb-6"><SolarEdgeInstructions /></div>

        <form onSubmit={handleRegister} className="space-y-5">
          <div>
            <label htmlFor="systemName" className="mb-1.5 block text-sm font-medium text-foreground">{t("systemName")}</label>
            <input id="systemName" type="text" required value={systemName} onChange={(e) => setSystemName(e.target.value)} className={inputClass} placeholder={t("systemNamePlaceholder")} />
          </div>
          <div>
            <label htmlFor="siteId" className="mb-1.5 block text-sm font-medium text-foreground">{t("siteId")}</label>
            <input id="siteId" type="text" required value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass} placeholder={t("siteIdPlaceholder")} />
          </div>
          <div>
            <label htmlFor="apiKey" className="mb-1.5 block text-sm font-medium text-foreground">{t("apiKey")}</label>
            <input id="apiKey" type="password" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} placeholder={t("apiKeyPlaceholder")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor="electricityPrice" className="mb-1.5 block text-sm font-medium text-foreground">{t("electricityPrice")}</label>
              <input id="electricityPrice" type="number" step="0.01" min="0" value={electricityPrice} onChange={(e) => setElectricityPrice(e.target.value)} className={inputClass} placeholder={t("electricityPricePlaceholder")} />
            </div>
            <div>
              <label htmlFor="currency" className="mb-1.5 block text-sm font-medium text-foreground">{t("currency")}</label>
              <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted-light sm:col-span-2">{t("electricityPriceHint")}</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">{t("provider")}</label>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-hover px-4 py-2.5 text-muted">SolarEdge</div>
          </div>
          {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{formError}</div>}
          <button type="submit" disabled={formLoading} className="flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white shadow-md shadow-brand/20 transition-all hover:bg-brand-hover hover:shadow-lg disabled:opacity-50">
            {formLoading ? t("registering") : t("register")}
          </button>
        </form>
      </div>
    );
  }

  /* ─── System registered: static info ─── */
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        {t("backToDashboard")}
      </Link>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{system.system_name}</h1>
          <p className="mt-1 text-sm text-muted">SolarEdge · Site ID: {system.site_id}</p>
        </div>
        {!editing && (
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground">{t("editSystem")}</button>
            <button onClick={handleDelete} disabled={formLoading} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">{t("delete")}</button>
          </div>
        )}
      </div>

      {/* Edit form */}
      {editing && (
        <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">{t("editSystem")}</h2>
          <div className="mb-4"><SolarEdgeInstructions /></div>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label htmlFor="editSystemName" className="mb-1.5 block text-sm font-medium text-foreground">{t("systemName")}</label>
              <input id="editSystemName" type="text" required value={systemName} onChange={(e) => setSystemName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="editSiteId" className="mb-1.5 block text-sm font-medium text-foreground">{t("siteId")}</label>
              <input id="editSiteId" type="text" required value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="editApiKey" className="mb-1.5 block text-sm font-medium text-foreground">{t("apiKey")}</label>
              <input id="editApiKey" type="password" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div>
                <label htmlFor="editElectricityPrice" className="mb-1.5 block text-sm font-medium text-foreground">{t("electricityPrice")}</label>
                <input id="editElectricityPrice" type="number" step="0.01" min="0" value={electricityPrice} onChange={(e) => setElectricityPrice(e.target.value)} className={inputClass} placeholder={t("electricityPricePlaceholder")} />
              </div>
              <div>
                <label htmlFor="editCurrency" className="mb-1.5 block text-sm font-medium text-foreground">{t("currency")}</label>
                <select id="editCurrency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-light sm:col-span-2">{t("electricityPriceHint")}</p>
            </div>
            {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{formError}</div>}
            <div className="flex gap-3">
              <button type="submit" disabled={formLoading} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50">{formLoading ? t("saving") : t("save")}</button>
              <button type="button" onClick={() => { setEditing(false); setFormError(null); setSystemName(system.system_name); setSiteId(system.site_id); setApiKey(system.api_key); setElectricityPrice(system.electricity_price_per_kwh?.toString() ?? ""); setCurrency(system.currency ?? "ILS"); }}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover">{t("cancelEdit")}</button>
            </div>
          </form>
        </div>
      )}

      {/* Static system details */}
      {!editing && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="mb-5 text-lg font-semibold text-foreground">{t("systemDetails")}</h2>
            <dl className="grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted">{t("systemName")}</dt>
                <dd className="mt-1 font-medium text-foreground">{system.system_name}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("provider")}</dt>
                <dd className="mt-1 font-medium text-foreground">SolarEdge</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("siteId")}</dt>
                <dd className="mt-1 font-medium text-foreground">{system.site_id}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("apiKey")}</dt>
                <dd className="mt-1 font-medium text-foreground">••••••••{system.api_key.slice(-4)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("electricityPrice")}</dt>
                <dd className="mt-1 font-medium text-foreground">
                  {system.electricity_price_per_kwh != null ? `${currencySymbol(system.currency)}${system.electricity_price_per_kwh} / kWh` : t("notSet")}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("registeredOn")}</dt>
                <dd className="mt-1 font-medium text-foreground">{new Date(system.created_at).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>

          {(system.peak_power_kwp || system.latitude) && (
            <div className="rounded-2xl border border-border bg-surface p-6">
              <h2 className="mb-5 text-lg font-semibold text-foreground">{t("technicalDetails")}</h2>
              <dl className="grid gap-5 sm:grid-cols-2">
                {system.peak_power_kwp != null && (
                  <div>
                    <dt className="text-sm text-muted">{t("peakPower")}</dt>
                    <dd className="mt-1 font-medium text-foreground">{system.peak_power_kwp} kWp</dd>
                  </div>
                )}
                {system.azimuth != null && (
                  <div>
                    <dt className="text-sm text-muted">{t("azimuthLabel")}</dt>
                    <dd className="mt-1 font-medium text-foreground">{system.azimuth}°</dd>
                  </div>
                )}
                {system.tilt != null && (
                  <div>
                    <dt className="text-sm text-muted">{t("tiltLabel")}</dt>
                    <dd className="mt-1 font-medium text-foreground">{system.tilt}°</dd>
                  </div>
                )}
                {system.latitude != null && system.longitude != null && (
                  <div>
                    <dt className="text-sm text-muted">{t("location")}</dt>
                    <dd className="mt-1 font-medium text-foreground">{system.latitude.toFixed(4)}, {system.longitude.toFixed(4)}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-4 text-xs text-muted-light">{t("technicalDetailsHint")}</p>
            </div>
          )}

          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-muted">
              {system.last_synced_at ? t("lastSynced", { date: new Date(system.last_synced_at).toLocaleString() }) : t("neverSynced")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
