/**
 * SolarEdge Public Monitoring API client.
 *
 * Single module for all interactions with https://monitoringapi.solaredge.com.
 * Used by the sync routes — never call this API from the analysis/dashboard layer.
 */

const BASE_URL = "https://monitoringapi.solaredge.com";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SiteDetails {
  details: {
    peakPower?: number;
    azimuth?: number;
    tilt?: number;
    installationDate?: string;
    location?: {
      latitude?: number;
      longitude?: number;
      country?: string;
      city?: string;
      timeZone?: string;
    };
    [key: string]: unknown;
  };
}

export interface EquipmentListItem {
  serialNumber: string;
  name: string;
  manufacturer: string;
  model: string;
  type: string;
  connectedTo?: string;
}

export interface EquipmentList {
  reporters: { list: EquipmentListItem[] };
}

export interface TelemetryRecord {
  date?: string;
  totalActivePower?: number;
  activePower?: number;
  power?: number;
  dcVoltage?: number;
  voltage?: number;
  current?: number;
  totalEnergy?: number;
  energy?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface EquipmentDataResponse {
  data?: { telemetries?: TelemetryRecord[] };
  telemetries?: TelemetryRecord[];
}

export interface EnergyValue {
  date: string;
  value: number | null;
}

export interface SiteEnergyResponse {
  energy: { values: EnergyValue[] };
}

export type TimeUnit = "QUARTER_OF_AN_HOUR" | "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR";

// ── Error types ──────────────────────────────────────────────────────────────

export class SolarEdgeRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfter: number) {
    super(`SolarEdge rate limited — retry after ${retryAfter}s`);
    this.name = "SolarEdgeRateLimitError";
    this.retryAfterSeconds = retryAfter;
  }
}

export class SolarEdgeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SolarEdgeApiError";
    this.status = status;
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function seFetch<T>(url: string, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "60", 10);
      throw new SolarEdgeRateLimitError(retryAfter);
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    if (attempt < retries && res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new SolarEdgeApiError(
      res.status,
      `SolarEdge API ${res.status}: ${body.substring(0, 200)}`
    );
  }

  throw new SolarEdgeApiError(500, "Exhausted retries");
}

function formatDateTime(date: string): string {
  return `${date} 00:00:00`;
}

// ── Public API methods ───────────────────────────────────────────────────────

export async function getSiteDetails(
  siteId: string,
  apiKey: string
): Promise<SiteDetails> {
  return seFetch<SiteDetails>(
    `${BASE_URL}/site/${siteId}/details?api_key=${apiKey}`
  );
}

export async function getEquipmentList(
  siteId: string,
  apiKey: string
): Promise<EquipmentList> {
  return seFetch<EquipmentList>(
    `${BASE_URL}/equipment/${siteId}/list?api_key=${apiKey}`
  );
}

export async function getEquipmentData(
  siteId: string,
  serial: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<TelemetryRecord[]> {
  const startTime = encodeURIComponent(formatDateTime(startDate));
  const endTime = encodeURIComponent(formatDateTime(endDate));
  const data = await seFetch<EquipmentDataResponse>(
    `${BASE_URL}/equipment/${siteId}/${serial}/data?startTime=${startTime}&endTime=${endTime}&api_key=${apiKey}`
  );
  return data?.data?.telemetries ?? data?.telemetries ?? [];
}

export async function getSiteEnergy(
  siteId: string,
  apiKey: string,
  startDate: string,
  endDate: string,
  timeUnit: TimeUnit = "QUARTER_OF_AN_HOUR"
): Promise<EnergyValue[]> {
  const data = await seFetch<SiteEnergyResponse>(
    `${BASE_URL}/site/${siteId}/energy?api_key=${apiKey}&timeUnit=${timeUnit}&startDate=${startDate}&endDate=${endDate}`
  );
  return data?.energy?.values ?? [];
}
