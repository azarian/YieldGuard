/**
 * Worker registry — import and register all pipeline workers.
 *
 * Call initWorkers() once at app startup (or lazily on first pipeline request).
 */

import { registerWorker } from "../engine";
import inverterTelemetryWorker from "./inverter-telemetry";
import siteEnergyWorker from "./site-energy";
import dailyEnergyWorker from "./daily-energy";

let initialized = false;

export function initWorkers(): void {
  if (initialized) return;
  registerWorker(inverterTelemetryWorker);
  registerWorker(siteEnergyWorker);
  registerWorker(dailyEnergyWorker);
  // Future workers:
  // registerWorker(optimizerTelemetryWorker);
  // registerWorker(soilingAnalysisWorker);
  initialized = true;
}
