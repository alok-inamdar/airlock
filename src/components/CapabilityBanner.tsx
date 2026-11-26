import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  DownloadCloud,
  FlaskConical,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WifiOff,
  X,
} from "lucide-react";
import type { CapabilitySnapshot } from "../ai/capabilities";
import type { FirebaseStatus } from "../types";
import { Badge, Button, Card, ProgressBar, cx } from "./ui";

export interface CapabilityBannerProps {
  snapshot: CapabilitySnapshot;
  firebaseStatus: FirebaseStatus;
  firebaseError: string | null;
  appCheckActive: boolean;
  appCheckError: string | null;
  effectiveSimulation: boolean;
  simulationRequested: boolean;
  downloadProgress: number | null;
  downloadError: string | null;
  policySource: "defaults" | "remote";
  policyWarnings: string[];
  refreshingPolicy: boolean;
  online: boolean;
  detailsOpen: boolean;
  onCloseDetails: () => void;
  onStartDownload: () => void;
  onUseSimulation: () => void;
  onDisableSimulation: () => void;
  onRefreshPolicy: () => void;
}

export function CapabilityBanner(props: CapabilityBannerProps) {
  const {
    snapshot,
    firebaseStatus,
    firebaseError,
    appCheckActive,
    appCheckError,
    effectiveSimulation,
    downloadProgress,
    downloadError,
    policySource,
    policyWarnings,
    refreshingPolicy,
    online,
    detailsOpen,
    onCloseDetails,
  } = props;

  const canDownload =
    firebaseStatus === "ready" &&
    snapshot.nanoStatus === "downloadable" &&
    downloadProgress === null;
  const nanoAvailable = snapshot.nanoStatus === "available";
  const nanoUsable = firebaseStatus === "ready" && nanoAvailable;

  // Only show an automatic inline banner when there is an actionable state
  // (Nano download available/in-progress, download error, or Firebase error).
  const needsActionBanner =
    canDownload ||
    downloadProgress !== null ||
    Boolean(downloadError) ||
    firebaseStatus === "error";

  if (!needsActionBanner && !detailsOpen) {
    return null;
  }

  return (
    <div className="animate-fade-in space-y-2.5">
      {needsActionBanner ? (
        <Card
          className={cx(
            "border px-3.5 py-2.5",
            firebaseStatus === "error" || downloadError
              ? "border-amber-400/25 bg-amber-400/[0.05]"
              : "border-blue-400/25 bg-blue-400/[0.05]"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={cx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                  firebaseStatus === "error" || downloadError
                    ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
                    : "border-blue-400/25 bg-blue-400/10 text-blue-300"
                )}
              >
                {firebaseStatus === "error" || downloadError ? (
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                ) : (
                  <DownloadCloud className="h-4 w-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0 text-[12.5px]">
                <span className="font-semibold text-ink-100">
                  {downloadProgress !== null
                    ? "Downloading Gemini Nano on-device AI"
                    : canDownload
                      ? "On-device AI (Gemini Nano) is ready to download"
                      : firebaseStatus === "error"
                        ? "Cloud connection unavailable — using Local Demo Mode"
                        : "On-device AI download paused"}
                </span>
                <span className="ml-1.5 hidden text-ink-400 sm:inline">
                  {downloadError
                    ? downloadError
                    : canDownload
                      ? "Download once for stronger local redaction, or continue with Local Scrubber."
                      : downloadProgress !== null
                        ? "You can keep using Airlock while Chrome finishes downloading."
                        : firebaseError ?? "Everything still works locally."}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {canDownload ? (
                <Button
                  size="sm"
                  variant="blue"
                  onClick={props.onStartDownload}
                  icon={<DownloadCloud className="h-3.5 w-3.5" />}
                >
                  Download Nano
                </Button>
              ) : null}
              {downloadProgress !== null ? (
                <Badge tone="blue">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {Math.round(downloadProgress * 100)}%
                </Badge>
              ) : null}
            </div>
          </div>

          {downloadProgress !== null ? (
            <div className="mt-2">
              <ProgressBar value={downloadProgress} tone="blue" />
            </div>
          ) : null}
        </Card>
      ) : null}

      {detailsOpen ? (
        <Card className="border border-white/10 bg-ink-850/90 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11.5px] font-semibold text-ink-200">
                System status
              </span>
              {!online ? (
                <Badge tone="amber">
                  <WifiOff className="h-3 w-3" /> Offline
                </Badge>
              ) : null}
              <Badge
                tone={
                  firebaseStatus === "ready"
                    ? "green"
                    : firebaseStatus === "error"
                      ? "red"
                      : "amber"
                }
              >
                {firebaseStatus === "ready" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : firebaseStatus === "disabled" ? (
                  <FlaskConical className="h-3 w-3" />
                ) : (
                  <CloudOff className="h-3 w-3" />
                )}
                {firebaseStatus === "ready"
                  ? "Firebase connected"
                  : firebaseStatus === "disabled"
                    ? "Local Demo Mode"
                    : firebaseStatus === "error"
                      ? "Firebase error"
                      : "Connecting"}
              </Badge>
              <Badge tone={appCheckActive ? "green" : "slate"}>
                <KeyRound className="h-3 w-3" />
                App Check {appCheckActive ? "active" : "off"}
              </Badge>
              <Badge
                tone={
                  nanoUsable
                    ? "green"
                    : snapshot.nanoStatus === "downloadable" ||
                        snapshot.nanoStatus === "downloading"
                      ? "blue"
                      : "amber"
                }
              >
                <Sparkles className="h-3 w-3" />
                Nano: {snapshot.nanoStatus}
              </Badge>
              <Badge tone={effectiveSimulation ? "amber" : "green"}>
                {effectiveSimulation ? "Local regex scrubber" : "Gemini Nano active"}
              </Badge>
              <Badge tone={policySource === "remote" ? "green" : "slate"}>
                Policy: {policySource === "remote" ? "Remote Config" : "defaults"}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {nanoUsable && effectiveSimulation ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={props.onDisableSimulation}
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                >
                  Use Gemini Nano
                </Button>
              ) : null}
              {!effectiveSimulation ? (
                <Button
                  size="sm"
                  variant="amber"
                  onClick={props.onUseSimulation}
                  icon={<FlaskConical className="h-3.5 w-3.5" />}
                >
                  Use Local Scrubber
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={props.onRefreshPolicy}
                loading={refreshingPolicy}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Refresh Policy
              </Button>
              <button
                type="button"
                onClick={onCloseDetails}
                aria-label="Close system status"
                className="rounded-lg p-1 text-ink-400 transition-colors hover:bg-white/[0.06] hover:text-ink-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <p className="mt-2 text-[11.5px] text-ink-400">
            {effectiveSimulation
              ? "Local Browser Scrubber hides SSNs, emails, phones, cards, and common fields locally. For full on-device AI redaction, open in Chrome 148+."
              : "Gemini Nano is scrubbing names, addresses, and IDs on-device before any anonymized text is sent to Cloud Gemini."}
          </p>

          {firebaseError ? (
            <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-1.5 text-[11.5px] text-rose-200">
              {firebaseError}
            </p>
          ) : null}
          {appCheckError ? (
            <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1.5 text-[11.5px] text-amber-200">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              {appCheckError}
            </p>
          ) : null}
          {policyWarnings.length > 0 ? (
            <p className="mt-2 rounded-lg border border-blue-400/20 bg-blue-400/[0.06] px-3 py-1.5 text-[11.5px] text-blue-200">
              {policyWarnings[0]}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
