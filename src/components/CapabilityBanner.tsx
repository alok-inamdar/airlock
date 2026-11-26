import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
  summary: string;
}

function copyFor(props: CapabilityBannerProps): BannerCopy {
  const { snapshot, firebaseStatus, effectiveSimulation, downloadProgress } = props;

  if (firebaseStatus === "error") {
    return {
      tone: "amber",
      icon: AlertTriangle,
      title: "Local Demo Mode",
      summary: "Firebase could not connect, so everything runs locally with preview results.",
    };
  }
  if (firebaseStatus === "disabled") {
    return {
      tone: "amber",
      icon: FlaskConical,
      title: "Local Demo Mode",
      summary: "Everything runs locally in your browser using built-in preview audits.",
    };
  }
  if (firebaseStatus === "initializing" || snapshot.nanoStatus === "checking") {
    return {
      tone: "blue",
      icon: Loader2,
      title: "Checking browser privacy engine…",
      summary: "You can start right away while Airlock checks on-device AI support.",
    };
  }
  if (downloadProgress !== null) {
    return {
      tone: "blue",
      icon: DownloadCloud,
      title: "Downloading on-device AI (Gemini Nano)",
      summary: "Keep this tab open, or use Local Browser Scrubber right away.",
    };
  }
  if (snapshot.nanoStatus === "available" && !effectiveSimulation) {
    return {
      tone: "green",
      icon: ShieldCheck,
      title: "On-Device AI Active (Gemini Nano)",
      summary: "Your browser hides names, SSNs, and addresses locally before anything leaves.",
    };
  }
  if (snapshot.nanoStatus === "available" && effectiveSimulation) {
    return {
      tone: "green",
      icon: Sparkles,
      title: "Local Scrubber Active (Gemini Nano ready)",
      summary: "Switch back to Gemini Nano anytime for stronger name and address detection.",
    };
  }
  if (snapshot.nanoStatus === "downloadable") {
    return {
      tone: "blue",
      icon: DownloadCloud,
      title: "On-device AI available to download",
      summary: "Download Gemini Nano once for stronger redaction, or continue with Local Scrubber now.",
    };
  }
  if (snapshot.nanoStatus === "downloading") {
    return {
      tone: "blue",
      icon: DownloadCloud,
      title: "Gemini Nano is downloading in Chrome",
      summary: "Local Scrubber is active so you can test Airlock immediately.",
    };
  }
  return {
    tone: "amber",
    icon: FlaskConical,
    title: "Local Browser Scrubber (Simulation Mode)",
    summary:
      "Hides SSNs, emails, phones, cards, and common fields locally. For full AI redaction, open in Chrome 148+.",
  };
}

export function CapabilityBanner(props: CapabilityBannerProps) {
  const [expanded, setExpanded] = useState(false);
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
    green: "border-emerald-400/20 bg-emerald-400/[0.04]",
    amber: "border-amber-400/20 bg-amber-400/[0.04]",
    blue: "border-blue-400/20 bg-blue-400/[0.04]",
    slate: "border-white/10 bg-white/[0.02]",
  }[copy.tone];

  const iconClasses = {
    green: "text-emerald-300 bg-emerald-400/10 border-emerald-400/25",
    amber: "text-amber-300 bg-amber-400/10 border-amber-400/25",
    blue: "text-blue-300 bg-blue-400/10 border-blue-400/25",
    slate: "text-ink-300 bg-white/[0.05] border-white/10",
  }[copy.tone];

  return (
    <Card className={cx("animate-fade-in border px-3.5 py-2.5", toneClasses)}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cx(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
              iconClasses
            )}
          >
            <Icon
              className={cx("h-4 w-4", copy.icon === Loader2 && "animate-spin")}
              aria-hidden
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-ink-100">{copy.title}</span>
              {!online ? (
                <Badge tone="amber">
                  <WifiOff className="h-3 w-3" /> Offline
                </Badge>
              ) : null}
              <span className="hidden text-[12px] text-ink-400 md:inline">
                — {copy.summary}
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-ink-400 md:hidden">{copy.summary}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
              Use Gemini Nano
            </Button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink-300 transition-colors hover:bg-white/[0.07] hover:text-ink-100"
          >
            System details
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {downloadProgress !== null ? (
        <div className="mt-2.5">
          <ProgressBar value={downloadProgress} tone="blue" />
        </div>
      ) : null}

      {downloadError ? (
        <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-1.5 text-[11.5px] text-rose-200">
          {downloadError}
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-2.5 border-t border-white/[0.07] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
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
                {effectiveSimulation ? "Simulation scrub" : "On-device scrub"}
              </Badge>
              <Badge tone={policySource === "remote" ? "green" : "slate"}>
                Policy: {policySource === "remote" ? "Remote Config" : "defaults"}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {!effectiveSimulation ? (
                <Button
                  size="sm"
                  variant="amber"
                  onClick={props.onUseSimulation}
                  icon={<FlaskConical className="h-3.5 w-3.5" />}
                >
                  Use Simulation Mode
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

          {firebaseError ? (
            <p className="rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[12px] text-rose-200">
              {firebaseError}
            </p>
          ) : null}
          {appCheckError ? (
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              {appCheckError}
            </p>
          ) : null}
          {policyWarnings.length > 0 ? (
            <p className="rounded-lg border border-blue-400/20 bg-blue-400/[0.06] px-3 py-2 text-[12px] text-blue-200">
              {policyWarnings[0]}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
