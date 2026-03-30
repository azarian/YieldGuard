"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import SolarEdgeInstructions from "@/components/SolarEdgeInstructions";
import { SolarEdgeLogo, SolarEdgeIcon } from "@/components/SolarEdgeLogo";

interface SolarSystem {
  id: string; user_id: string; site_id: string; api_key: string; system_name: string;
  provider: string; created_at: string; last_synced_at: string | null;
  electricity_price_per_kwh: number | null; currency: string;
  latitude: number | null; longitude: number | null;
  peak_power_kwp: number | null; azimuth: number | null; tilt: number | null;
  se_portal_username: string | null;
}

interface EquipmentItem {
  id: string;
  serial_number: string;
  equipment_type: string;
  name: string | null;
  manufacturer: string | null;
  model: string | null;
  earliest_data: string | null;
  latest_data: string | null;
  has_data: boolean;
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

  // Provider selection
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // SolarEdge form fields
  const [systemName, setSystemName] = useState("");
  const [siteId, setSiteId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [electricityPrice, setElectricityPrice] = useState("");
  const [currency, setCurrency] = useState("ILS");

  // Portal credentials
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalUsername, setPortalUsername] = useState("");
  const [portalPassword, setPortalPassword] = useState("");
  const [portalConfigured, setPortalConfigured] = useState(false);
  const [portalSavedUser, setPortalSavedUser] = useState<string | null>(null);

  // Equipment inventory (collapsible)
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [equipmentLoaded, setEquipmentLoaded] = useState(false);

  const fetchSystem = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("solar_systems")
      .select("id,user_id,site_id,api_key,system_name,provider,created_at,last_synced_at,electricity_price_per_kwh,currency,latitude,longitude,peak_power_kwp,azimuth,tilt,se_portal_username")
      .eq("user_id", user.id)
      .single();
    if (data) {
      setSystem(data);
      setSystemName(data.system_name);
      setSiteId(data.site_id);
      setApiKey(data.api_key);
      setElectricityPrice(data.electricity_price_per_kwh?.toString() ?? "");
      setCurrency(data.currency ?? "ILS");
      setPortalConfigured(!!data.se_portal_username);
      setPortalSavedUser(data.se_portal_username ?? null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchSystem(); }, [fetchSystem]);

  useEffect(() => {
    if (equipmentOpen && !equipmentLoaded) {
      fetch("/api/solar/sync/inventory")
        .then((r) => r.json())
        .then((json) => {
          if (json.equipment) setEquipmentList(json.equipment);
          setEquipmentLoaded(true);
        })
        .catch(() => setEquipmentLoaded(true));
    }
  }, [equipmentOpen, equipmentLoaded]);

  async function savePortalCredentials(systemId: string) {
    if (!portalUsername || !portalPassword) return;
    try {
      const res = await fetch("/api/solar/system/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", username: portalUsername, password: portalPassword }),
      });
      if (res.ok) {
        setPortalConfigured(true);
        setPortalSavedUser(portalUsername);
        setPortalPassword("");
      }
    } catch { /* handled silently — system is registered regardless */ }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault(); setFormError(null); setFormLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setFormError("Not authenticated"); setFormLoading(false); return; }
    const { data, error } = await supabase.from("solar_systems").insert({
      user_id: user.id, system_name: systemName, site_id: siteId, api_key: apiKey,
      provider: "solaredge",
      electricity_price_per_kwh: electricityPrice ? parseFloat(electricityPrice) : null,
      currency,
    }).select().single();
    if (error) { setFormError(error.message); setFormLoading(false); return; }

    if (portalUsername && portalPassword) {
      await savePortalCredentials(data.id);
    }

    setSystem(data);
    setFormLoading(false);
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault(); if (!system) return; setFormError(null); setFormLoading(true);
    const { data, error } = await supabase.from("solar_systems").update({
      system_name: systemName, site_id: siteId, api_key: apiKey,
      electricity_price_per_kwh: electricityPrice ? parseFloat(electricityPrice) : null,
      currency,
    }).eq("id", system.id).select().single();
    if (error) { setFormError(error.message); setFormLoading(false); return; }

    if (portalUsername && portalPassword) {
      await savePortalCredentials(system.id);
    }

    setSystem(data);
    setEditing(false);
    setFormLoading(false);
  }

  async function handleDelete() {
    if (!system) return; if (!window.confirm(t("deleteConfirm"))) return;
    setFormLoading(true);
    const { error } = await supabase.from("solar_systems").delete().eq("id", system.id);
    if (error) { setFormError(error.message); setFormLoading(false); return; }
    setSystem(null); setSystemName(""); setSiteId(""); setApiKey(""); setElectricityPrice(""); setCurrency("ILS");
    setSelectedProvider(null); setPortalUsername(""); setPortalPassword(""); setPortalConfigured(false); setPortalSavedUser(null);
    setFormLoading(false);
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

  /* ─── Portal credentials section (shared between register and edit forms) ─── */
  const portalCredentialsJsx = (
    <div className="rounded-2xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setPortalOpen(!portalOpen)}
        className="flex w-full items-center justify-between p-5 text-start"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-light">
            <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{t("enhancedMonitoring")}</p>
            <p className="mt-0.5 text-xs text-muted">
              {portalConfigured
                ? t("portalConnected", { username: portalSavedUser ?? "" })
                : t("enhancedMonitoringHint")}
            </p>
          </div>
        </div>
        <svg
          className={`h-5 w-5 text-muted transition-transform ${portalOpen ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {portalOpen && (
        <div className="border-t border-border px-5 pb-5 pt-4">
          <p className="mb-4 text-sm text-muted">{t("enhancedMonitoringDesc")}</p>

          {portalConfigured && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-accent/20 bg-accent-light/20 p-3">
              <svg className="h-4 w-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-foreground">
                {t("portalConnected", { username: portalSavedUser ?? "" })}
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="portalUsername" className="mb-1.5 block text-sm font-medium text-foreground">{t("portalUsername")}</label>
              <input
                id="portalUsername" type="text"
                value={portalUsername}
                onChange={(e) => setPortalUsername(e.target.value)}
                placeholder={portalSavedUser || t("portalUsernamePlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="portalPassword" className="mb-1.5 block text-sm font-medium text-foreground">{t("portalPassword")}</label>
              <input
                id="portalPassword" type="password"
                value={portalPassword}
                onChange={(e) => setPortalPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>
          </div>

          <p className="mt-3 text-[10px] text-muted-light">{t("portalSecurityNote")}</p>
        </div>
      )}
    </div>
  );

  /* ─── No system: provider selection → form ─── */
  if (!system) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          {t("backToDashboard")}
        </Link>

        <h1 className="mb-2 text-3xl font-bold text-foreground">{t("registerTitle")}</h1>
        <p className="mb-8 text-muted">{t("registerSubtitle")}</p>

        {/* ── Phase 1: Provider selection ─── */}
        {!selectedProvider && (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-foreground">{t("selectProvider")}</h2>
            <p className="mb-6 text-sm text-muted">{t("selectProviderSubtitle")}</p>

            <button
              onClick={() => setSelectedProvider("solaredge")}
              className="group flex w-full items-center gap-5 rounded-2xl border-2 border-border bg-surface p-6 text-start transition-all hover:border-brand hover:shadow-md"
            >
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-border">
                <SolarEdgeIcon className="h-9 w-9" />
              </div>
              <div className="flex-1">
                <p className="text-lg font-semibold text-foreground group-hover:text-brand">{t("solarEdge")}</p>
                <p className="mt-0.5 text-sm text-muted">{t("solarEdgeDesc")}</p>
              </div>
              <svg className="h-5 w-5 text-muted transition-colors group-hover:text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>

            <p className="mt-6 text-center text-xs text-muted-light">{t("comingSoon")}</p>
          </div>
        )}

        {/* ── Phase 2: SolarEdge form ─── */}
        {selectedProvider === "solaredge" && (
          <div>
            {/* Form header with SolarEdge branding */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-border">
                  <SolarEdgeIcon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">{t("solarEdgeSetup")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProvider(null)}
                className="text-xs text-muted hover:text-foreground transition-colors"
              >
                {t("changeProvider")}
              </button>
            </div>

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

              {portalCredentialsJsx}

              {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{formError}</div>}
              <button type="submit" disabled={formLoading} className="flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white shadow-md shadow-brand/20 transition-all hover:bg-brand-hover hover:shadow-lg disabled:opacity-50">
                {formLoading ? t("registering") : t("register")}
              </button>
            </form>
          </div>
        )}
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
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-border">
            <SolarEdgeIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">{system.system_name}</h1>
            <p className="mt-0.5 text-sm text-muted">SolarEdge · Site ID: {system.site_id}</p>
          </div>
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
          <div className="mb-4 flex items-center gap-3">
            <SolarEdgeIcon className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-foreground">{t("editSystem")}</h2>
          </div>
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

            {portalCredentialsJsx}

            {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{formError}</div>}
            <div className="flex gap-3">
              <button type="submit" disabled={formLoading} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50">{formLoading ? t("saving") : t("save")}</button>
              <button type="button" onClick={() => {
                setEditing(false); setFormError(null);
                setSystemName(system.system_name); setSiteId(system.site_id); setApiKey(system.api_key);
                setElectricityPrice(system.electricity_price_per_kwh?.toString() ?? ""); setCurrency(system.currency ?? "ILS");
                setPortalUsername(""); setPortalPassword(""); setPortalOpen(false);
              }}
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
                <dd className="mt-1 flex items-center gap-2 font-medium text-foreground">
                  <SolarEdgeIcon className="h-4 w-4" />
                  SolarEdge
                </dd>
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

          {/* Enhanced monitoring status */}
          <div className="rounded-2xl border border-border bg-surface p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-light">
                <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t("enhancedMonitoring")}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {portalConfigured
                    ? t("portalConnected", { username: portalSavedUser ?? "" })
                    : t("portalNotConfigured")}
                </p>
              </div>
              {portalConfigured && (
                <svg className="ms-auto h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
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

          {/* Collapsible Equipment Inventory */}
          <div className="rounded-2xl border border-border bg-surface">
            <button
              type="button"
              onClick={() => setEquipmentOpen(!equipmentOpen)}
              className="flex w-full items-center justify-between p-5 text-start"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light">
                  <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("equipmentInventory")}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {equipmentOpen ? t("hideEquipment") : t("showEquipment")}
                  </p>
                </div>
              </div>
              <svg
                className={`h-5 w-5 text-muted transition-transform ${equipmentOpen ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {equipmentOpen && (
              <div className="border-t border-border px-5 pb-5 pt-4">
                {!equipmentLoaded ? (
                  <div className="flex items-center gap-2 py-4">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                    <span className="text-sm text-muted">Loading...</span>
                  </div>
                ) : equipmentList.length === 0 ? (
                  <p className="text-sm text-muted">{t("noEquipmentSystem")}</p>
                ) : (
                  <div className="space-y-4">
                    {(() => {
                      const inverters = equipmentList.filter((e) => e.equipment_type === "inverter");
                      const optimizers = equipmentList.filter((e) => e.equipment_type === "optimizer");
                      return (
                        <>
                          {inverters.length > 0 && (
                            <div>
                              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Inverters</h3>
                              <div className="space-y-2">
                                {inverters.map((eq) => (
                                  <div key={eq.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                                    <div>
                                      <p className="text-sm font-medium text-foreground">{eq.name || eq.serial_number}</p>
                                      <p className="text-xs text-muted">{eq.manufacturer} {eq.model}</p>
                                    </div>
                                    <div className="text-end">
                                      {eq.has_data ? (
                                        <p className="text-xs font-medium text-accent">
                                          {new Date(eq.earliest_data!).toLocaleDateString()} — {new Date(eq.latest_data!).toLocaleDateString()}
                                        </p>
                                      ) : (
                                        <p className="text-xs text-muted-light">No data</p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {optimizers.length > 0 && (
                            <div>
                              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                                <SolarEdgeIcon className="h-4 w-4" />
                                Optimizers ({optimizers.length})
                              </h3>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {optimizers.map((eq) => (
                                  <div key={eq.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-foreground">{eq.name || eq.serial_number}</p>
                                      <p className="text-xs text-muted">{eq.serial_number}</p>
                                    </div>
                                    <div className="ms-2 text-end">
                                      {eq.has_data ? (
                                        <span className="inline-block rounded-full bg-accent-light px-2 py-0.5 text-[10px] font-semibold text-accent">
                                          {new Date(eq.earliest_data!).toLocaleDateString()} — {new Date(eq.latest_data!).toLocaleDateString()}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-muted-light">No data</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
