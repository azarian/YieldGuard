/**
 * Worker registry — import and register all pipeline workers.
 *
 * Call initWorkers() once at app startup (or lazily on first pipeline request).
 */

import { registerWorker } from "../engine";
import inverterTelemetryWorker from "./inverter-telemetry";
import siteEnergyWorker from "./site-energy";

let initialized = false;

export function initWorkers(): void {
  if (initialized) return;
  registerWorker(inverterTelemetryWorker);
  registerWorker(siteEnergyWorker);
  // Future workers:
  // registerWorker(optimizerTelemetryWorker);
  // registerWorker(dailyEnergyWorker);
  // registerWorker(soilingAnalysisWorker);
  initialized = true;
}
