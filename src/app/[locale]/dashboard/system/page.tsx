"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import SolarEdgeInstructions from "@/components/SolarEdgeInstructions";

interface SolarSystem {
  id: string;
  user_id: string;
  site_id: string;
  api_key: string;
  system_name: string;
  provider: string;
  created_at: string;
  last_synced_at: string | null;
}

interface SyncDataRow {
  id: string;
  system_id: string;
  sync_type: string;
  data: Record<string, unknown>;
  period_start: string;
  period_end: string;
  synced_at: string;
}

export default function SystemPage() {
  const t = useTranslations("system");
  const supabase = createClient();

  // State
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<SolarSystem | null>(null);
  const [syncData, setSyncData] = useState<SyncDataRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Form fields
  const [systemName, setSystemName] = useState("");
  const [siteId, setSiteId] = useState("");
  const [apiKey, setApiKey] = useState("");

  const fetchSystem = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("solar_systems")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (data) {
      setSystem(data);
      setSystemName(data.system_name);
      setSiteId(data.site_id);
      setApiKey(data.api_key);

      // Fetch sync data
      const { data: syncRows } = await supabase
        .from("sync_data")
        .select("*")
        .eq("system_id", data.id)
        .order("synced_at", { ascending: false });

      if (syncRows) setSyncData(syncRows);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchSystem();
  }, [fetchSystem]);

  // Register new system
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setFormError("Not authenticated");
      setFormLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("solar_systems")
      .insert({
        user_id: user.id,
        system_name: systemName,
        site_id: siteId,
        api_key: apiKey,
        provider: "solaredge",
      })
      .select()
      .single();

    if (error) {
      setFormError(error.message);
      setFormLoading(false);
      return;
    }

    setSystem(data);
    setFormLoading(false);
  }

  // Update system
  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!system) return;
    setFormError(null);
    setFormLoading(true);

    const { data, error } = await supabase
      .from("solar_systems")
      .update({
        system_name: systemName,
        site_id: siteId,
        api_key: apiKey,
      })
      .eq("id", system.id)
      .select()
      .single();

    if (error) {
      setFormError(error.message);
      setFormLoading(false);
      return;
    }

    setSystem(data);
    setEditing(false);
    setFormLoading(false);
  }

  // Delete system
  async function handleDelete() {
    if (!system) return;
    if (!window.confirm(t("deleteConfirm"))) return;

    setFormLoading(true);
    const { error } = await supabase
      .from("solar_systems")
      .delete()
      .eq("id", system.id);

    if (error) {
      setFormError(error.message);
      setFormLoading(false);
      return;
    }

    setSystem(null);
    setSyncData([]);
    setSystemName("");
    setSiteId("");
    setApiKey("");
    setFormLoading(false);
  }

  // Sync now
  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);

    try {
      const res = await fetch("/api/solar/sync", { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        setSyncMessage({ type: "error", text: json.error || t("syncError") });
        setSyncing(false);
        return;
      }

      setSyncMessage({ type: "success", text: t("syncSuccess") });

      // Refresh system and sync data
      await fetchSystem();
    } catch {
      setSyncMessage({ type: "error", text: t("syncError") });
    }

    setSyncing(false);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-4 h-64 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }

  // ─── NO SYSTEM REGISTERED: show registration form ───
  if (!system) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← {t("pageTitle")}
        </Link>

        <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">
          {t("registerTitle")}
        </h1>
        <p className="mb-8 text-gray-500 dark:text-gray-400">
          {t("registerSubtitle")}
        </p>

        {/* Instructions */}
        <div className="mb-6">
          <SolarEdgeInstructions />
        </div>

        <form onSubmit={handleRegister} className="space-y-5">
          {/* System Name */}
          <div>
            <label
              htmlFor="systemName"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("systemName")}
            </label>
            <input
              id="systemName"
              type="text"
              required
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder={t("systemNamePlaceholder")}
            />
          </div>

          {/* Site ID */}
          <div>
            <label
              htmlFor="siteId"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("siteId")}
            </label>
            <input
              id="siteId"
              type="text"
              required
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder={t("siteIdPlaceholder")}
            />
          </div>

          {/* API Key */}
          <div>
            <label
              htmlFor="apiKey"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("apiKey")}
            </label>
            <input
              id="apiKey"
              type="password"
              required
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder={t("apiKeyPlaceholder")}
            />
          </div>

          {/* Provider (read-only) */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("provider")}
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
              ☀️ SolarEdge
            </div>
          </div>

          {/* Error */}
          {formError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {formError}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={formLoading}
            className="flex w-full items-center justify-center rounded-lg bg-yellow-500 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {formLoading ? t("registering") : t("register")}
          </button>
        </form>
      </div>
    );
  }

  // ─── SYSTEM REGISTERED: show details + sync ───
  const overviewSync = syncData.find((s) => s.sync_type === "overview");
  const energySync = syncData.find((s) => s.sync_type === "energy");
  const powerSync = syncData.find((s) => s.sync_type === "power");

  // Extract overview fields safely
  const overview = overviewSync?.data as
    | { overview?: { lifeTimeData?: { energy?: number }; lastMonthData?: { energy?: number }; lastDayData?: { energy?: number }; currentPower?: { power?: number } } }
    | undefined;

  const overviewInfo = overview?.overview;

  // Extract energy values
  const energyValues = (
    energySync?.data as { energy?: { values?: Array<{ date: string; value: number | null }> } } | undefined
  )?.energy?.values;

  // Extract power values
  const powerValues = (
    powerSync?.data as { power?: { values?: Array<{ date: string; value: number | null }> } } | undefined
  )?.power?.values;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        ← {t("pageTitle")}
      </Link>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {system.system_name}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            ☀️ SolarEdge · Site ID: {system.site_id}
          </p>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
            {system.last_synced_at
              ? t("lastSynced", {
                  date: new Date(system.last_synced_at).toLocaleString(),
                })
              : t("neverSynced")}
          </p>
        </div>

        <div className="flex gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("editSystem")}
            </button>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
          >
            {syncing ? t("syncing") : t("syncNow")}
          </button>
        </div>
      </div>

      {/* Sync message */}
      {syncMessage && (
        <div
          className={`mb-6 rounded-lg p-3 text-sm ${
            syncMessage.type === "success"
              ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          {syncMessage.text}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
            {t("editSystem")}
          </h2>

          {/* Instructions */}
          <div className="mb-4">
            <SolarEdgeInstructions />
          </div>

          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label
                htmlFor="editSystemName"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("systemName")}
              </label>
              <input
                id="editSystemName"
                type="text"
                required
                value={systemName}
                onChange={(e) => setSystemName(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="editSiteId"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("siteId")}
              </label>
              <input
                id="editSiteId"
                type="text"
                required
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="editApiKey"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("apiKey")}
              </label>
              <input
                id="editApiKey"
                type="password"
                required
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>

            {formError && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {formError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={formLoading}
                className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
              >
                {formLoading ? t("saving") : t("save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setFormError(null);
                  setSystemName(system.system_name);
                  setSiteId(system.site_id);
                  setApiKey(system.api_key);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {t("cancelEdit")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={formLoading}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-50"
              >
                {formLoading ? t("deleting") : t("delete")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Synced data display */}
      {syncData.length === 0 ? (
        <div className="rounded-xl border border-gray-200 p-8 text-center dark:border-gray-700">
          <div className="mb-3 text-4xl">📊</div>
          <p className="text-gray-500 dark:text-gray-400">{t("noData")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {t("syncedData")}
          </h2>

          {/* Overview cards */}
          {overviewInfo && (
            <div>
              <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">
                {t("overviewTitle")}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("lifetimeEnergy")}
                  </p>
                  <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                    {overviewInfo.lifeTimeData?.energy != null
                      ? `${(overviewInfo.lifeTimeData.energy / 1000).toFixed(1)} kWh`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("lastMonthEnergy")}
                  </p>
                  <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                    {overviewInfo.lastMonthData?.energy != null
                      ? `${(overviewInfo.lastMonthData.energy / 1000).toFixed(1)} kWh`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("lastDayEnergy")}
                  </p>
                  <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                    {overviewInfo.lastDayData?.energy != null
                      ? `${(overviewInfo.lastDayData.energy / 1000).toFixed(1)} kWh`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("currentPower")}
                  </p>
                  <p className="mt-1 text-xl font-bold text-green-600">
                    {overviewInfo.currentPower?.power != null
                      ? `${overviewInfo.currentPower.power.toFixed(0)} W`
                      : "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Energy table */}
          {energyValues && energyValues.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">
                {t("energyTitle")}
              </h3>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-3 text-start font-medium text-gray-700 dark:text-gray-300">
                        {t("energyDate")}
                      </th>
                      <th className="px-4 py-3 text-start font-medium text-gray-700 dark:text-gray-300">
                        {t("energyValue")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {energyValues
                      .filter((v) => v.value != null)
                      .map((v, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2.5 text-gray-900 dark:text-white">
                            {v.date}
                          </td>
                          <td className="px-4 py-2.5 text-gray-900 dark:text-white">
                            {v.value != null
                              ? v.value.toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Power table (show latest 20 entries) */}
          {powerValues && powerValues.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">
                {t("powerTitle")}
              </h3>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-3 text-start font-medium text-gray-700 dark:text-gray-300">
                        {t("powerTime")}
                      </th>
                      <th className="px-4 py-3 text-start font-medium text-gray-700 dark:text-gray-300">
                        {t("powerValue")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {powerValues
                      .filter((v) => v.value != null)
                      .slice(-20)
                      .map((v, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2.5 text-gray-900 dark:text-white">
                            {v.date}
                          </td>
                          <td className="px-4 py-2.5 text-gray-900 dark:text-white">
                            {v.value != null
                              ? v.value.toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

