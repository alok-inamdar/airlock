/**
 * Capability probe, Gemini Nano download progress, and Simulation Mode state.
 * The app must never call the SDK's on-device path when Nano is absent.
 */

import { useCallback, useEffect, useState } from "react";
import { firebaseEnabled } from "./firebaseConfig";
import { initializeDeviceModel, readNanoAvailability } from "./modelFactory";

export type NanoStatus =
  | "checking"
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable"
  | "unknown";

export interface CapabilitySnapshot {
  firebaseEnabled: boolean;
  nanoStatus: NanoStatus;
  rawAvailability: string | null;
  hasLanguageModelApi: boolean;
  checkedAt: number;
  error: string | null;
}

const SIMULATION_KEY = "airlock.simulation-mode.v1";

function mapStatus(raw: string): NanoStatus {
  if (raw === "available") return "available";
  if (raw === "downloadable" || raw === "after-download") return "downloadable";
  if (raw === "downloading") return "downloading";
  if (raw === "unavailable" || raw === "no") return "unavailable";
  return "unknown";
}

export function isSimulationEnabled(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(SIMULATION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSimulationEnabled(enabled: boolean): void {
  try {
    if (enabled) sessionStorage.setItem(SIMULATION_KEY, "1");
    else sessionStorage.removeItem(SIMULATION_KEY);
  } catch {
    // Session storage can be blocked; the in-memory state still works.
  }
}

export function hasLanguageModelApi(): boolean {
  if (typeof window === "undefined") return false;
  // Must match the global the Firebase AI Logic adapter inspects (#10635).
  return Boolean(
    window.LanguageModel && typeof window.LanguageModel.availability === "function"
  );
}

export async function probeCapabilities(): Promise<CapabilitySnapshot> {
  const apiPresent = hasLanguageModelApi();
  const raw = apiPresent ? await readNanoAvailability() : "unavailable";
  return {
    firebaseEnabled,
    nanoStatus: apiPresent ? mapStatus(raw) : "unavailable",
    rawAvailability: apiPresent ? raw : null,
    hasLanguageModelApi: apiPresent,
    checkedAt: Date.now(),
    error: null,
  };
}

export interface CapabilityState {
  snapshot: CapabilitySnapshot;
  downloadProgress: number | null;
  simulationRequested: boolean;
  effectiveSimulation: boolean;
  downloadError: string | null;
  refresh: () => Promise<void>;
  startDownload: () => Promise<void>;
  useSimulationNow: () => void;
  disableSimulation: () => void;
}

const INITIAL: CapabilitySnapshot = {
  firebaseEnabled,
  nanoStatus: "checking",
  rawAvailability: null,
  hasLanguageModelApi: false,
  checkedAt: 0,
  error: null,
};

export function useCapabilities(): CapabilityState {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot>(INITIAL);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [simulationRequested, setSimulationRequested] = useState<boolean>(() =>
    isSimulationEnabled()
  );

  const refresh = useCallback(async () => {
    try {
      const next = await probeCapabilities();
      setSnapshot(next);
    } catch (error) {
      setSnapshot((previous) => ({
        ...previous,
        nanoStatus: "unknown",
        checkedAt: Date.now(),
        error: error instanceof Error ? error.message : "Capability probe failed.",
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startDownload = useCallback(async () => {
    setDownloadError(null);
    setDownloadProgress(0);
    try {
      const ready = await initializeDeviceModel((progress) => setDownloadProgress(progress));
      await refresh();
      if (!ready) {
        setDownloadError(
          "The on-device model finished initializing but still reports unavailable. Reload Chrome and try again."
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model download failed.";
      if (/not implemented|Unable to create|user gesture/i.test(message)) {
        setDownloadError(
          "Chrome blocked the model download. Click the download button again from a fresh page interaction, or use Simulation Mode."
        );
      } else {
        setDownloadError(message);
      }
    } finally {
      setDownloadProgress(null);
    }
  }, [refresh]);

  const useSimulationNow = useCallback(() => {
    setSimulationEnabled(true);
    setSimulationRequested(true);
  }, []);

  const disableSimulation = useCallback(() => {
    setSimulationEnabled(false);
    setSimulationRequested(false);
  }, []);

  const effectiveSimulation =
    simulationRequested || !firebaseEnabled || snapshot.nanoStatus !== "available";

  return {
    snapshot,
    downloadProgress,
    simulationRequested,
    effectiveSimulation,
    downloadError,
    refresh,
    startDownload,
    useSimulationNow,
    disableSimulation,
  };
}
