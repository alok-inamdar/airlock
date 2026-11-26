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
  onStartDownload: () => void;
  onUseSimulation: () => void;
  onDisableSimulation: () => void;
  onRefreshPolicy: () => void;
}

type BannerTone = "green" | "amber" | "blue" | "slate";

interface BannerCopy {
  tone: BannerTone;
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}

function copyFor(props: CapabilityBannerProps): BannerCopy {
  const { snapshot, firebaseStatus, effectiveSimulation, downloadProgress } = props;

  if (firebaseStatus === "error") {
    return {
      tone: "amber",
      icon: AlertTriangle,
      title: "Firebase could not initialize",
      body:
        "Airlock fell back to Local Demo Mode so you can still walk the full pipeline. Fix the environment variables or console setup to enable live Gemini calls.",
    };
  }
  if (firebaseStatus === "disabled") {
    return {
      tone: "amber",
      icon: FlaskConical,
      title: "Local Demo Mode",
      body:
        "No Firebase credentials are configured, so nothing is sent to Google. Scrubbing, rehydration, the offline queue, and Remote Config defaults all run locally; cloud audits are clearly labeled cached demo results.",
    };
  }
  if (firebaseStatus === "initializing") {
    return {
      tone: "blue",
      icon: Loader2,
      title: "Connecting to Firebase",
      body: "Initializing Anonymous Auth, App Check, Firestore persistent cache, and Remote Config.",
    };
  }
  if (snapshot.nanoStatus === "checking") {
    return {
      tone: "blue",
      icon: Loader2,
      title: "Checking on-device capability",
      body:
        "Probing Chrome's LanguageModel API. Scrubbing starts in Simulation Mode until the probe returns, so nothing blocks the demo.",
    };
  }
  if (downloadProgress !== null) {
    return {
      tone: "blue",
      icon: DownloadCloud,
      title: "Downloading Gemini Nano 4",
      body: "Chrome is fetching the on-device model. Keep this tab open; you can switch to Simulation Mode at any time.",
    };
  }
  if (snapshot.nanoStatus === "available" && !effectiveSimulation) {
    return {
      tone: "green",
      icon: ShieldCheck,
      title: "Gemini Nano 4 is ready",
      body:
        "Stage 1 scrubbing and Stage 3 tone polish run on-device. Only the scrubbed WirePayload can reach Cloud Gemini, protected by App Check.",
    };
  }
  if (snapshot.nanoStatus === "available" && effectiveSimulation) {
    return {
      tone: "green",
      icon: Sparkles,
      title: "Gemini Nano 4 is available",
      body:
        "Airlock is currently using Simulation Mode by request. Switch back to Gemini Nano for semantic name, address, and role detection.",
    };
  }
  if (snapshot.nanoStatus === "downloadable") {
    return {
      tone: "blue",
      icon: DownloadCloud,
      title: "Gemini Nano needs a one-time download",
      body:
        "Chrome 148+ can run the on-device model, but it is not downloaded yet. Start the download from this button, or use Simulation Mode immediately.",
    };
  }
  if (snapshot.nanoStatus === "downloading") {
    return {
      tone: "blue",
      icon: DownloadCloud,
      title: "Chrome is already downloading Gemini Nano",
      body: "The model is still downloading in this browser. Simulation Mode works right now.",
    };
  }
  if (!snapshot.hasLanguageModelApi) {
    return {
      tone: "amber",
      icon: FlaskConical,
      title: "Simulation Mode — Chrome's on-device model is unavailable",
      body:
        "This browser does not expose the LanguageModel API. Simulation Mode catches structured IDs (SSN, email, phone, card, bank, DOB, MRN) locally in JavaScript, but misses unstructured names, addresses, and rare diagnoses — privacy protection is weaker than Gemini Nano 4.",
    };
  }
  return {
    tone: "amber",
    icon: FlaskConical,
    title: "Simulation Mode — on-device model unavailable",
    body:
      "Gemini Nano reports unavailable, so Airlock never calls the SDK's local inference path. Structured IDs are still caught locally by regex; names and addresses rely on heuristics and coverage is weaker.",
  };
}

export function CapabilityBanner(props: CapabilityBannerProps) {
  const copy = copyFor(props);
  const Icon = copy.icon;
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
  } = props;

  const canDownload =
    firebaseStatus === "ready" &&
    snapshot.nanoStatus === "downloadable" &&
    downloadProgress === null;
  const nanoAvailable = snapshot.nanoStatus === "available";
  const nanoUsable = firebaseStatus === "ready" && nanoAvailable;
  const toneClasses = {
    green: "border-emerald-400/20 bg-emerald-400/[0.05]",
    amber: "border-amber-400/25 bg-amber-400/[0.05]",
    blue: "border-blue-400/20 bg-blue-400/[0.05]",
    slate: "border-white/10 bg-white/[0.03]",
  }[copy.tone];
  const iconClasses = {
    green: "text-emerald-300 bg-emerald-400/10 border-emerald-400/25",
    amber: "text-amber-300 bg-amber-400/10 border-amber-400/25",
    blue: "text-blue-300 bg-blue-400/10 border-blue-400/25",
    slate: "text-ink-300 bg-white/[0.05] border-white/10",
  }[copy.tone];

  return (
    <Card className={cx("animate-fade-in border p-4", toneClasses)}>
      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cx(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
              iconClasses
            )}
          >
            <Icon
              className={cx("h-[18px] w-[18px]", copy.icon === Loader2 && "animate-spin")}
              aria-hidden
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[13.5px] font-semibold text-ink-100">{copy.title}</h2>
              {!online ? (
                <Badge tone="amber">
                  <WifiOff className="h-3 w-3" /> Offline
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-300">
              {copy.body}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
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
          {nanoUsable && effectiveSimulation ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={props.onDisableSimulation}
              icon={<Sparkles className="h-3.5 w-3.5" />}
            >
              Switch to Nano
            </Button>
          ) : null}
          {!effectiveSimulation ? (
            <Button
              size="sm"
              variant="amber"
              onClick={props.onUseSimulation}
              icon={<FlaskConical className="h-3.5 w-3.5" />}
            >
              Use Simulation Mode Now
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
        </div>
      </div>

      {downloadProgress !== null ? (
        <div className="mt-3">
          <ProgressBar value={downloadProgress} tone="blue" />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-3">
        <Badge tone={firebaseStatus === "ready" ? "green" : firebaseStatus === "error" ? "red" : "amber"}>
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
              : snapshot.nanoStatus === "downloadable" || snapshot.nanoStatus === "downloading"
                ? "blue"
                : "amber"
          }
        >
          <Sparkles className="h-3 w-3" />
          Nano: {snapshot.nanoStatus}
          {nanoAvailable && !nanoUsable ? " (needs Firebase)" : ""}
        </Badge>
        <Badge tone={effectiveSimulation ? "amber" : "green"}>
          {effectiveSimulation ? "Simulation scrub" : "On-device scrub"}
        </Badge>
        <Badge tone={policySource === "remote" ? "green" : "slate"}>
          Policy: {policySource === "remote" ? "Remote Config" : "bundled defaults"}
        </Badge>
        <span className="ml-auto hidden text-[11px] text-ink-500 sm:inline">
          Zero detected direct identifiers sent to cloud
        </span>
      </div>

      {firebaseError ? (
        <p className="mt-2.5 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[12px] text-rose-200">
          {firebaseError}
        </p>
      ) : null}
      {appCheckError ? (
        <p className="mt-2.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          {appCheckError}
        </p>
      ) : null}
      {downloadError ? (
        <p className="mt-2.5 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[12px] text-rose-200">
          {downloadError}
        </p>
      ) : null}
      {policyWarnings.length > 0 ? (
        <p className="mt-2.5 rounded-lg border border-blue-400/20 bg-blue-400/[0.06] px-3 py-2 text-[12px] text-blue-200">
          {policyWarnings[0]}
        </p>
      ) : null}
    </Card>
  );
}
