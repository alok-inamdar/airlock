import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BookOpen,
  Check,
  Cloud,
  Eraser,
  FlaskConical,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import {
  describeFirebaseError,
  firebaseEnabled,
  initFirebase,
} from "./ai/firebaseConfig";
import { useCapabilities } from "./ai/capabilities";
import { scrubLocalDocument, type LocalScrubOutcome, type ScrubProgress } from "./ai/stage1LocalScrub";
import {
  CloudAuditError,
  runCloudAudit,
  runOfflineTriage,
} from "./ai/stage2CloudAudit";
import {
  buildLetterState,
  copyToClipboard,
  downloadTextFile,
  letterFilename,
  printTextDocument,
} from "./ai/stage3Rehydrate";
import { buildCachedDemoAudit } from "./samples/demoAudit";
import {
  auditRecordFromReport,
  deleteAllAudits,
  getAudit,
  listAudits,
  queuedAuditsFrom,
  retryQueuedAudits,
  saveAudit,
  startQueuedAuditRunner,
  type AuditRecord,
} from "./services/firestoreAudits";
import { defaultPolicy, loadRemotePolicy, type RemotePolicy } from "./services/remoteConfig";
import { logRequest, telemetry } from "./services/telemetry";
import { probeNetwork, useOnlineStatus } from "./lib/connectivity";
import { createId } from "./lib/ids";
import { formatBytes, formatNumber } from "./lib/format";
import {
  removeVaultEntry,
  saveVaultEntry,
  updateVaultEntry,
  vaultStats,
  wipeVault,
} from "./vault/db";
import {
  payloadReductionPercent,
  toWire,
  wireByteSize,
  type WireBuildResult,
  type WirePayload,
} from "./vault/wireBoundary";
import { replaceAllInsensitive, replaceAllLiteral, TokenRegistry } from "./vault/tokenMap";
import type {
  AuditReport,
  AuditStatus,
  AuditTelemetry,
  DocumentInput,
  FirebaseStatus,
  LetterState,
  Tone,
} from "./types";
import { DOCUMENT_TYPE_LABELS } from "./types";
import { RULE_PACK_DISCLAIMER } from "./rules/rulePacks2026";
import { AirlockXRay, type AuditPaneState, type XRayStats } from "./components/AirlockXRay";
import { CapabilityBanner } from "./components/CapabilityBanner";
import { DocumentIngest } from "./components/DocumentIngest";
import { TutorialModal } from "./components/TutorialModal";
import { SAMPLES } from "./samples";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  InlineNotice,
  ProgressBar,
  Spinner,
  ToastStack,
  type ToastMessage,
} from "./components/ui";

type Stage = "ingest" | "scrubbing" | "xray";
type ConfirmKind = "wipe" | "delete" | null;

interface ManualRedaction {
  token: string;
  original: string;
}

function reportFromRecord(record: AuditRecord): AuditReport {
  return {
    auditId: record.auditId,
    documentType: record.documentType,
    jurisdiction: record.jurisdiction,
    createdAt: record.createdAt,
    overallRiskScore: record.overallRiskScore,
    estimatedSavings: record.estimatedSavings,
    summary: record.summary ?? "",
    findings: record.findings,
    tokenizedDisputeDraft: record.tokenizedDisputeDraft,
    rulePackVersion: record.rulePackVersion,
    rulePackIds: [],
    source: record.source ?? "cloud",
    cloudInferenceSource: record.telemetry.cloudInferenceSource,
    droppedCitations: [],
    latencyMs: record.telemetry.cloudLatencyMs,
    warnings: [],
  };
}

function ScrubbingView({
  label,
  mode,
  progress,
}: {
  label: string;
  mode: string;
  progress: ScrubProgress | null;
}) {
  const ratio = progress && progress.chunkCount > 0
    ? (progress.chunkIndex + 1) / progress.chunkCount
    : 0.12;
  return (
    <div className="mx-auto max-w-2xl animate-fade-in py-8">
      <Card className="p-7 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-400/10">
          <ShieldCheck className="h-7 w-7 text-emerald-300" />
        </span>
        <h2 className="mt-4 text-[18px] font-semibold text-ink-100">Scrubbing locally</h2>
        <p className="mt-1 text-[12.5px] text-ink-400">
          {label} · {mode}. No document bytes are being sent.
        </p>
        <div className="mt-5">
          <ProgressBar value={Math.min(0.95, Math.max(0.06, ratio))} />
        </div>
        <p className="mt-3 flex items-center justify-center gap-2 text-[11.5px] text-ink-300">
          <Spinner className="h-3.5 w-3.5" />
          {progress?.message ?? "Preparing chunks and the local token registry…"}
        </p>
        <div className="mt-5 grid gap-1.5 text-left text-[10.5px] text-ink-500 sm:grid-cols-3">
          <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            1. Chunk ≤ 1,600 chars
          </span>
          <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            2. Deterministic tokens
          </span>
          <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            3. Regex firewall
          </span>
        </div>
        <p className="mt-4 text-[10px] leading-relaxed text-ink-500">
          A cold Gemini Nano download can take several minutes. If it stalls, reload and choose
          “Use Simulation Mode Now” from the banner.
        </p>
      </Card>
    </div>
  );
}

export default function App() {
  const [stage, setStage] = useState<Stage>("ingest");
  const [document, setDocument] = useState<DocumentInput | null>(null);
  const [scrub, setScrub] = useState<LocalScrubOutcome | null>(null);
  const [wireBuild, setWireBuild] = useState<WireBuildResult | null>(null);
  const [wire, setWire] = useState<WirePayload | null>(null);
  const [auditId, setAuditId] = useState("");
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [auditState, setAuditState] = useState<AuditPaneState>("idle");
  const [auditError, setAuditError] = useState<{ message: string; hint: string } | null>(null);
  const [auditStartedAt, setAuditStartedAt] = useState<number | null>(null);
  const [letter, setLetter] = useState<LetterState | null>(null);
  const [letterBusy, setLetterBusy] = useState(false);
  const [tone, setTone] = useState<Tone>("formal");
  const [manual, setManual] = useState<ManualRedaction[]>([]);
  const [scrubProgress, setScrubProgress] = useState<ScrubProgress | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseStatus>(
    firebaseEnabled ? "initializing" : "disabled"
  );
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [appCheckActive, setAppCheckActive] = useState(false);
  const [appCheckError, setAppCheckError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<RemotePolicy>(() => defaultPolicy());
  const [refreshingPolicy, setRefreshingPolicy] = useState(false);

  const [auditCount, setAuditCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [vaultCount, setVaultCount] = useState(() => vaultStats().entries);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [tutorialOpen, setTutorialOpen] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem("airlock.tutorial-seen.v1") !== "1";
    } catch {
      return false;
    }
  });

  const closeTutorial = useCallback(() => {
    setTutorialOpen(false);
    try {
      localStorage.setItem("airlock.tutorial-seen.v1", "1");
    } catch {
      // ignore
    }
  }, []);

  const online = useOnlineStatus();
  const capabilities = useCapabilities();
  const requestLog = useSyncExternalStore(
    telemetry.subscribe,
    telemetry.getSnapshot,
    telemetry.getSnapshot
  );
  const letterRequestRef = useRef(0);

  const showToast = useCallback((toneValue: ToastMessage["tone"], message: string) => {
    const id = createId("toast");
    setToasts((previous) => [...previous.slice(-2), { id, tone: toneValue, message }]);
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, 7000);
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const records = await listAudits();
      setAuditCount(records.length);
      setQueueCount(queuedAuditsFrom(records).length);
    } catch {
      // Counting is best-effort; the pipeline does not depend on it.
    }
    setVaultCount(vaultStats().entries);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!firebaseEnabled) {
        setFirebaseStatus("disabled");
        setPolicy(defaultPolicy());
        return;
      }
      setFirebaseStatus("initializing");
      try {
        const runtime = await initFirebase();
        if (cancelled) return;
        setAppCheckActive(Boolean(runtime?.appCheck));
        setAppCheckError(runtime?.appCheckError ?? null);
        setFirebaseError(runtime?.authError ?? null);
        setFirebaseStatus("ready");
        const nextPolicy = await loadRemotePolicy();
        if (!cancelled) setPolicy(nextPolicy);
      } catch (error) {
        if (cancelled) return;
        setFirebaseStatus("error");
        setFirebaseError(describeFirebaseError(error));
        setPolicy(defaultPolicy());
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts, firebaseStatus]);

  const handleQueuedRecord = useCallback(
    async (record: AuditRecord) => {
      const report = await runCloudAudit(record.wirePayload, {
        auditId: record.auditId,
        modelName: policy.cloudAuditorModel,
      });
      const telemetryData: AuditTelemetry = {
        ...record.telemetry,
        cloudLatencyMs: report.latencyMs,
        cloudInferenceSource: report.cloudInferenceSource ?? "none",
        documentBytesSent:
          report.source === "cloud" ? wireByteSize(record.wirePayload) : 0,
      };
      await saveAudit(
        auditRecordFromReport(report, record.wirePayload, telemetryData, "audited_cloud")
      );
      await refreshCounts();
      window.dispatchEvent(
        new CustomEvent("airlock:audit-updated", { detail: { auditId: record.auditId } })
      );
    },
    [refreshCounts, policy.cloudAuditorModel]
  );

  useEffect(() => {
    // With no Firebase project there is no real cloud to reconnect to; keep the
    // queue manual so the demo shows the queued state and its cached fallback.
    if (!firebaseEnabled) return;
    const stop = startQueuedAuditRunner({
      run: handleQueuedRecord,
      onError: (_record, message) => {
        showToast("error", `Queued audit retry failed: ${message}`);
      },
    });
    return stop;
  }, [handleQueuedRecord, showToast]);

  const handleScrub = useCallback(
    async (input: DocumentInput) => {
      setIngestError(null);
      setScrubProgress(null);
      setDocument(input);
      setStage("scrubbing");
      const nextAuditId = createId("audit");
      const started = Date.now();

      try {
        const outcome = await scrubLocalDocument(input.text, {
          documentType: input.documentType,
          jurisdiction: input.jurisdiction,
          redactionStrictness: policy.redactionStrictness,
          maxChunkChars: policy.maxChunkChars,
          forceSimulation:
            !firebaseEnabled || firebaseStatus !== "ready" || capabilities.effectiveSimulation,
          onProgress: setScrubProgress,
        });
        const build = toWire(outcome, input.documentType, input.jurisdiction);
        saveVaultEntry({
          auditId: nextAuditId,
          createdAt: Date.now(),
          documentType: input.documentType,
          jurisdiction: input.jurisdiction,
          rawDocumentText: input.text,
          tokenMap: build.tokenMap,
          reverseMap: build.reverseMap,
        });
        setScrub(outcome);
        setWire(build.wire);
        setWireBuild(build);
        setAuditId(nextAuditId);
        setManual([]);
        setAudit(null);
        setLetter(null);
        setAuditState("idle");
        setAuditError(null);
        setAuditStartedAt(null);
        setVaultCount(vaultStats().entries);
        logRequest({
          kind: "ai_on_device",
          label:
            outcome.mode === "on_device"
              ? "Local scrub · Gemini Nano"
              : "Local scrub · Simulation Mode",
          detail: `${outcome.chunks} chunk(s) · ${outcome.entities.length} identifiers · ${build.firewallHits.length} regex catches · 0 bytes sent`,
          bytes: 0,
          durationMs: Date.now() - started,
          status: "ok",
        });
        setStage("xray");
        if (outcome.warnings.length > 0) showToast("info", outcome.warnings[0]);
      } catch (error) {
        setStage("ingest");
        const message = error instanceof Error ? error.message : "Local scrub failed.";
        if (message.startsWith("PRIVACY_VIOLATION")) {
          setIngestError(
            "Airlock rejected the local result because inferenceSource was not on_device. The pipeline stopped before any audit. Inspect the classified request log; if the SDK attempted a cloud call, do not retry with the same document until you have reloaded and verified Nano availability."
          );
        } else if (message.startsWith("ON_DEVICE_UNAVAILABLE")) {
          setIngestError(
            "Gemini Nano is not available, so Airlock refused to call the SDK's local path. Use Simulation Mode Now and retry."
          );
        } else {
          setIngestError(message);
        }
        showToast("error", "The local scrub failed and the audit was blocked.");
      }
    },
    [policy, firebaseStatus, capabilities.effectiveSimulation, showToast]
  );

  const addManualRedaction = useCallback(
    (rawWord: string) => {
      if (!scrub || !wireBuild || !document) return;
      if (audit) {
        showToast("info", "The audit is complete. Start a new document to change the payload.");
        return;
      }
      const word = rawWord.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
      if (word.length < 3) {
        showToast("error", "Choose a word with at least three letters or digits.");
        return;
      }
      const registry = new TokenRegistry(
        { tokenMap: wireBuild.tokenMap, reverseMap: wireBuild.reverseMap },
        document.text
      );
      const existing = registry.lookup(word);
      if (existing) {
        showToast("info", `${word} is already covered by ${existing}.`);
        return;
      }
      if (!scrub.sanitizedText.toLowerCase().includes(word.toLowerCase())) {
        showToast(
          "info",
          `${word} is already inside a redacted entity or does not appear in the sanitized text.`
        );
        return;
      }
      const token = registry.register(word, "MANUAL");
      if (!token) return;
      const sanitizedText = replaceAllInsensitive(scrub.sanitizedText, word, token);
      const nextScrub: LocalScrubOutcome = {
        ...scrub,
        sanitizedText,
        entities: [
          ...scrub.entities,
          {
            original: word,
            category: "MANUAL",
            token,
            source: "manual",
          },
        ],
        tokenMap: registry.tokenMap,
        reverseMap: registry.reverseMap,
      };
      const nextBuild = toWire(nextScrub, document.documentType, document.jurisdiction);
      setScrub(nextScrub);
      setWire(nextBuild.wire);
      setWireBuild(nextBuild);
      setManual((previous) => [...previous, { token, original: word }]);
      updateVaultEntry(auditId, {
        tokenMap: nextBuild.tokenMap,
        reverseMap: nextBuild.reverseMap,
      });
      showToast("success", `Manual redaction: ${word} → ${token}. The wire payload was rebuilt locally.`);
    },
    [scrub, wireBuild, document, audit, auditId, showToast]
  );

  const undoManualRedaction = useCallback(
    (token: string) => {
      if (!scrub || !wireBuild || !document) return;
      if (audit) {
        showToast("info", "The audit is complete. Start a new document to change the payload.");
        return;
      }
      const tokenMap = { ...wireBuild.tokenMap };
      const original = tokenMap[token];
      delete tokenMap[token];
      const reverseMap = { ...wireBuild.reverseMap };
      if (original) delete reverseMap[original.toLowerCase()];
      const sanitizedText = original
        ? replaceAllLiteral(scrub.sanitizedText, token, original)
        : scrub.sanitizedText;
      const nextScrub: LocalScrubOutcome = {
        ...scrub,
        sanitizedText,
        entities: scrub.entities.filter((entity) => entity.token !== token),
        tokenMap,
        reverseMap,
      };
      const nextBuild = toWire(nextScrub, document.documentType, document.jurisdiction);
      setScrub(nextScrub);
      setWire(nextBuild.wire);
      setWireBuild(nextBuild);
      setManual((previous) => previous.filter((item) => item.token !== token));
      updateVaultEntry(auditId, {
        tokenMap: nextBuild.tokenMap,
        reverseMap: nextBuild.reverseMap,
      });
      showToast("success", original ? `Restored “${original}” to the local document.` : "Manual redaction removed.");
    },
    [scrub, wireBuild, document, audit, auditId, showToast]
  );

  const persistAuditSafe = useCallback(
    async (
      report: AuditReport,
      currentWire: WirePayload,
      currentScrub: LocalScrubOutcome,
      status: AuditStatus
    ) => {
      const bytes = wireByteSize(currentWire);
      const telemetryData: AuditTelemetry = {
        piiEntitiesScrubbed: currentScrub.entities.length,
        regexCatches: currentScrub.firewallHits.length,
        localLatencyMs: currentScrub.localLatencyMs,
        cloudLatencyMs: report.latencyMs,
        documentBytesSent: report.source === "cloud" ? bytes : 0,
        rawDocumentBytes: currentScrub.rawBytes,
        wirePayloadBytes: bytes,
        localInferenceSource: currentScrub.mode,
        cloudInferenceSource: report.cloudInferenceSource ?? "none",
      };
      try {
        const result = await saveAudit(
          auditRecordFromReport(report, currentWire, telemetryData, status)
        );
        await refreshCounts();
        if (result.warning) {
          showToast("error", `Audit saved locally: ${result.warning}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown persistence error";
        showToast("error", `Audit could not be saved: ${message}`);
      }
    },
    [refreshCounts, showToast]
  );

  const generateLetter = useCallback(
    async (
      report: AuditReport,
      currentWire: WirePayload,
      currentDoc: DocumentInput,
      nextTone: Tone,
      allowPolish: boolean
    ) => {
      if (!wireBuild) return;
      const requestId = letterRequestRef.current + 1;
      letterRequestRef.current = requestId;
      setLetterBusy(true);
      try {
        const state = await buildLetterState(
          {
            documentType: currentDoc.documentType,
            jurisdiction: currentDoc.jurisdiction,
            report,
            roleHints: currentWire.roleHints,
            tokenMap: wireBuild.tokenMap,
            wire: currentWire,
          },
          nextTone,
          { polish: allowPolish }
        );
        if (requestId !== letterRequestRef.current) return;
        setLetter(state);
        updateVaultEntry(report.auditId, { rehydratedLetter: state.final });
      } catch (error) {
        if (requestId !== letterRequestRef.current) return;
        const message = error instanceof Error ? error.message : "Letter build failed.";
        showToast("error", `The letter could not be built: ${message}`);
      } finally {
        if (requestId === letterRequestRef.current) setLetterBusy(false);
      }
    },
    [wireBuild, showToast]
  );

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ auditId?: string }>).detail;
      if (!detail?.auditId || detail.auditId !== auditId || !wire || !document) return;
      void (async () => {
        const record = await getAudit(detail.auditId as string);
        if (!record || record.status === "queued_offline") return;
        const report = reportFromRecord(record);
        setAudit(report);
        setAuditState("done");
        await generateLetter(report, wire, document, tone, false);
      })();
    };
    window.addEventListener("airlock:audit-updated", onUpdated);
    return () => window.removeEventListener("airlock:audit-updated", onUpdated);
  }, [auditId, wire, document, tone, generateLetter]);

  const runAudit = useCallback(
    async (mode: "auto" | "cached") => {
      if (!document || !wire || !scrub) return;
      if (auditState === "running") return;
      if (wireBuild && !wireBuild.passed) {
        showToast(
          "error",
          "The PII firewall still detects direct identifiers. The cloud call is blocked; retry the local scrub or use Simulation Mode."
        );
        return;
      }
      setAuditError(null);
      setAuditStartedAt(Date.now());

      if (mode === "cached") {
        const report = buildCachedDemoAudit(wire, {
          auditId,
          reason: "Cached demo result requested from the Airlock X-Ray.",
        });
        setAudit(report);
        setAuditState("done");
        await persistAuditSafe(report, wire, scrub, "audited_cloud");
        await generateLetter(report, wire, document, tone, false);
        showToast("info", "Cached demo result rendered locally. It is clearly labeled in Pane 3.");
        return;
      }

      setAuditState("running");
      setLetter(null);
      try {
        const reachable = online && (await probeNetwork());
        if (!reachable) {
          const triage = await runOfflineTriage(wire);
          setAudit(triage);
          setAuditState("queued");
          await persistAuditSafe(triage, wire, scrub, "queued_offline");
          await generateLetter(triage, wire, document, tone, false);
          showToast("info", "Offline: the sanitized audit is queued. Retry when the connection returns.");
          return;
        }

        const report = await runCloudAudit(wire, {
          auditId,
          modelName: policy.cloudAuditorModel,
        });
        setAudit(report);
        setAuditState("done");
        await persistAuditSafe(report, wire, scrub, "audited_cloud");
        await generateLetter(report, wire, document, tone, true);
        if (report.source === "cached_demo") {
          showToast("info", "Cloud unavailable — a clearly labeled cached demo result was used.");
        } else {
          showToast("success", `Cloud audit complete: ${report.findings.length} finding(s).`);
        }
      } catch (error) {
        const classified =
          error instanceof CloudAuditError
            ? error
            : new CloudAuditError(
                "unknown",
                error instanceof Error ? error.message : "Cloud audit failed."
              );
        setAuditError({ message: classified.message, hint: classified.hint });
        setAuditState("error");
      }
    },
    [
      document,
      wire,
      scrub,
      auditId,
      online,
      policy.cloudAuditorModel,
      tone,
      auditState,
      wireBuild,
      persistAuditSafe,
      generateLetter,
      showToast,
    ]
  );

  const handleToneChange = useCallback(
    (nextTone: Tone) => {
      setTone(nextTone);
      if (!audit || !wire || !document) return;
      const polished =
        capabilities.snapshot.nanoStatus === "available" && !capabilities.effectiveSimulation;
      void generateLetter(audit, wire, document, nextTone, polished);
    },
    [audit, wire, document, generateLetter, capabilities]
  );

  const retryQueue = useCallback(async () => {
    const reachable = await probeNetwork();
    if (!reachable) {
      showToast("error", "Still offline. Queued audits were not sent.");
      return;
    }
    const processed = await retryQueuedAudits({
      run: handleQueuedRecord,
      onError: (_record, message) => showToast("error", `Queued audit failed: ${message}`),
    });
    await refreshCounts();

    if (auditState === "queued" && auditId && wire && document) {
      const record = await getAudit(auditId);
      if (record && record.status !== "queued_offline") {
        const report = reportFromRecord(record);
        setAudit(report);
        setAuditState("done");
        await generateLetter(report, wire, document, tone, false);
      }
    }

    showToast(
      processed > 0 ? "success" : "info",
      processed > 0
        ? `${processed} queued audit(s) completed.`
        : "No queued audits needed sending."
    );
  }, [
    handleQueuedRecord,
    refreshCounts,
    auditState,
    auditId,
    wire,
    document,
    generateLetter,
    tone,
    showToast,
  ]);

  const resetSession = useCallback(
    (silent = false) => {
      if (auditId) removeVaultEntry(auditId);
      letterRequestRef.current += 1;
      setStage("ingest");
      setDocument(null);
      setScrub(null);
      setWire(null);
      setWireBuild(null);
      setAudit(null);
      setLetter(null);
      setManual([]);
      setAuditState("idle");
      setAuditError(null);
      setAuditStartedAt(null);
      setAuditId("");
      setScrubProgress(null);
      setIngestError(null);
      setVaultCount(vaultStats().entries);
      if (!silent) {
        telemetry.clear();
        showToast("info", "New document ready. The previous raw text was removed from the local vault.");
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [auditId, showToast]
  );

  const handleRefreshPolicy = useCallback(async () => {
    setRefreshingPolicy(true);
    try {
      const next = await loadRemotePolicy();
      setPolicy(next);
      if (!firebaseEnabled || firebaseStatus !== "ready") {
        showToast(
          "info",
          "Bundled policy defaults are active until Firebase is connected."
        );
      } else if (next.error) {
        showToast("error", "Remote Config unavailable; bundled policy defaults kept.");
      } else {
        showToast("success", "Policy refreshed from Remote Config.");
      }
    } finally {
      setRefreshingPolicy(false);
    }
  }, [showToast, firebaseStatus]);

  const handleCopyWire = useCallback(async () => {
    if (!wire) return;
    const copied = await copyToClipboard(JSON.stringify(wire, null, 2));
    showToast(copied ? "success" : "error", copied ? "Wire payload copied." : "Copy failed.");
  }, [wire, showToast]);

  const handleCopyLetter = useCallback(async () => {
    if (!letter) return;
    const copied = await copyToClipboard(letter.final);
    showToast(copied ? "success" : "error", copied ? "Letter copied." : "Copy failed.");
  }, [letter, showToast]);

  const handleDownloadLetter = useCallback(() => {
    if (!letter || !document) return;
    try {
      downloadTextFile(letterFilename(document.documentType), letter.final);
      showToast("success", "Letter downloaded as a .txt file.");
    } catch {
      showToast("error", "The browser blocked the download.");
    }
  }, [letter, document, showToast]);

  const handlePrintLetter = useCallback(() => {
    if (!letter || !document) return;
    try {
      printTextDocument(`Airlock letter — ${DOCUMENT_TYPE_LABELS[document.documentType]}`, letter.final);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Printing failed.");
    }
  }, [letter, document, showToast]);

  const handleWipeVault = useCallback(async () => {
    setDialogBusy(true);
    try {
      wipeVault();
      setConfirm(null);
      resetSession(true);
      telemetry.clear();
      showToast("success", "Local vault wiped. No raw document text remains in this tab.");
    } finally {
      setDialogBusy(false);
    }
  }, [resetSession, showToast]);

  const handleDeleteAudits = useCallback(async () => {
    setDialogBusy(true);
    try {
      const result = await deleteAllAudits();
      await refreshCounts();
      setConfirm(null);
      if (result.warning) {
        showToast("error", `Local audits deleted; Firestore cleanup reported: ${result.warning}`);
      } else {
        showToast("success", `${result.deleted} anonymized audit(s) deleted.`);
      }
    } finally {
      setDialogBusy(false);
    }
  }, [refreshCounts, showToast]);

  const stats: XRayStats = useMemo(() => {
    const wireBytes = wire ? wireByteSize(wire) : 0;
    return {
      entities: scrub?.entities.length ?? 0,
      regexCatches: wireBuild?.firewallHits.length ?? 0,
      manualRedactions: manual.length,
      payloadReduction:
        scrub && wire ? payloadReductionPercent(scrub.rawBytes, wireBytes) : 0,
      wireBytes,
      rawBytes: scrub?.rawBytes ?? 0,
      firewallPassed: wireBuild?.passed ?? true,
      localLatencyMs: scrub?.localLatencyMs ?? 0,
      cloudLatencyMs: audit?.latencyMs ?? 0,
      localSource: scrub?.mode ?? "simulation",
    };
  }, [wire, scrub, wireBuild, manual.length, audit]);

  const documentBytes = useMemo(
    () =>
      requestLog
        .filter((entry) => entry.kind === "document_payload")
        .reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
    [requestLog]
  );

  const modeLabel =
    scrub?.mode === "on_device" ? "on_device · Nano" : "simulation · local regex";
  const willSimulate =
    capabilities.effectiveSimulation || !firebaseEnabled || firebaseStatus !== "ready";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
          <button
            type="button"
            onClick={() => (stage !== "ingest" ? resetSession() : undefined)}
            className="flex items-center gap-2.5 text-left"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-300/30 bg-gradient-to-br from-emerald-300 to-teal-500 shadow-[0_10px_30px_-14px_rgba(16,185,129,0.9)]">
              <ShieldCheck className="h-[18px] w-[18px] text-ink-950" />
            </span>
            <div>
              <div className="text-[14.5px] font-semibold tracking-tight text-ink-100">Airlock</div>
              <div className="text-[10px] text-ink-400">Private Document Auditor</div>
            </div>
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {!online ? (
              <Badge tone="amber">
                <WifiOff className="h-3 w-3" /> Offline
              </Badge>
            ) : null}
            {queueCount > 0 ? (
              <Button
                size="sm"
                variant="amber"
                onClick={() => void retryQueue()}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                {queueCount} queued
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTutorialOpen(true)}
              icon={<BookOpen className="h-3.5 w-3.5 text-emerald-300" />}
            >
              How It Works
            </Button>
            {vaultCount > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirm("wipe")}
                icon={<Eraser className="h-3.5 w-3.5" />}
              >
                <span className="hidden sm:inline">Wipe Vault</span>
              </Button>
            ) : null}
            {auditCount > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirm("delete")}
                icon={<Trash2 className="h-3.5 w-3.5" />}
              >
                <span className="hidden sm:inline">Delete Audits</span>
                <span className="text-[10px] text-ink-500">({auditCount})</span>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        <nav aria-label="Workflow steps" className="grid grid-cols-3 gap-2">
          {[
            { num: 1, title: "Choose Document", sub: "Sample, paste, or PDF" },
            { num: 2, title: "Review Privacy", sub: "Check what stays hidden" },
            { num: 3, title: "Audit & Letter", sub: "Findings + dispute draft" },
          ].map((item) => {
            const currentStep =
              stage === "ingest" || stage === "scrubbing"
                ? 1
                : auditState === "done" || auditState === "queued"
                  ? 3
                  : 2;
            const done = item.num < currentStep;
            const active = item.num === currentStep;
            return (
              <div
                key={item.num}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors ${
                  active
                    ? "border-emerald-400/35 bg-emerald-400/[0.07]"
                    : done
                      ? "border-white/[0.08] bg-white/[0.03]"
                      : "border-white/[0.05] bg-white/[0.015] opacity-60"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    done
                      ? "bg-emerald-400/20 text-emerald-200"
                      : active
                        ? "bg-emerald-400 text-ink-950"
                        : "bg-white/10 text-ink-400"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : item.num}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-ink-100">
                    {item.title}
                  </div>
                  <div className="hidden truncate text-[10.5px] text-ink-400 sm:block">
                    {item.sub}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        <CapabilityBanner
          snapshot={capabilities.snapshot}
          firebaseStatus={firebaseStatus}
          firebaseError={firebaseError}
          appCheckActive={appCheckActive}
          appCheckError={appCheckError}
          effectiveSimulation={willSimulate}
          simulationRequested={capabilities.simulationRequested}
          downloadProgress={capabilities.downloadProgress}
          downloadError={capabilities.downloadError}
          policySource={policy.source}
          policyWarnings={policy.warnings}
          refreshingPolicy={refreshingPolicy}
          online={online}
          onStartDownload={() => void capabilities.startDownload()}
          onUseSimulation={capabilities.useSimulationNow}
          onDisableSimulation={capabilities.disableSimulation}
          onRefreshPolicy={() => void handleRefreshPolicy()}
        />

        {ingestError ? (
          <InlineNotice tone="error" title="Local scrub did not run">
            {ingestError}
          </InlineNotice>
        ) : null}

        {stage === "xray" && scrub && scrub.warnings.length > 0 ? (
          <InlineNotice tone="warn" title="Local scrub notes">
            <ul className="list-inside list-disc space-y-0.5">
              {scrub.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </InlineNotice>
        ) : null}

        {stage === "scrubbing" ? (
          <ScrubbingView
            label={document?.label ?? "Document"}
            mode={willSimulate ? "Simulation Mode" : "Gemini Nano"}
            progress={scrubProgress}
          />
        ) : stage === "xray" && document && scrub && wire && wireBuild ? (
          <AirlockXRay
            documentLabel={document.label}
            rawText={document.text}
            entities={scrub.entities}
            wire={wire}
            stats={stats}
            audit={audit}
            auditState={auditState}
            auditError={auditError}
            auditStartedAt={auditStartedAt}
            letter={letter}
            letterBusy={letterBusy}
            tone={tone}
            manualRedactions={manual}
            requestLog={requestLog}
            documentBytes={documentBytes}
            online={online}
            firebaseEnabled={firebaseEnabled}
            queueCount={queueCount}
            modeLabel={modeLabel}
            onRedactWord={addManualRedaction}
            onUndoManual={undoManualRedaction}
            onApprove={() => void runAudit("auto")}
            onUseCached={() => void runAudit("cached")}
            onRetry={() => void runAudit("auto")}
            onRetryQueue={() => void retryQueue()}
            onNewDocument={() => resetSession()}
            onToneChange={handleToneChange}
            onCopyLetter={() => void handleCopyLetter()}
            onDownloadLetter={handleDownloadLetter}
            onPrintLetter={handlePrintLetter}
            onCopyWire={() => void handleCopyWire()}
          />
        ) : (
          <DocumentIngest
            busy={false}
            effectiveSimulation={willSimulate}
            nanoStatus={capabilities.snapshot.nanoStatus}
            initial={document}
            onScrub={(input) => void handleScrub(input)}
            onOpenTutorial={() => setTutorialOpen(true)}
          />
        )}

        <div className="hidden items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.015] px-3.5 py-2 text-[10px] text-ink-500 sm:flex">
          <span className="flex items-center gap-1.5">
            <Lock className="h-3 w-3" />
            Raw text and the token map are session-only. Cloud stores zero detected direct
            identifiers.
          </span>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <FlaskConical className="h-3 w-3" /> {formatBytes(scrub?.rawBytes ?? 0)} local
            </span>
            <span className="inline-flex items-center gap-1">
              <Cloud className="h-3 w-3" /> {formatBytes(documentBytes)} sent
            </span>
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3" /> {formatNumber(auditCount)} audits
            </span>
          </span>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-[1500px] px-4 pb-8 sm:px-6">
        <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-4 text-[10px] leading-relaxed text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl">
            <span className="font-semibold text-ink-400">Not legal or medical advice.</span>{" "}
            {RULE_PACK_DISCLAIMER}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Apache-2.0</span>
            <span aria-hidden>·</span>
            <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">
              Gemini API terms
            </a>
            <span aria-hidden>·</span>
            <span>Free-tier requests may be used to improve Google products.</span>
          </p>
        </div>
      </footer>

      <ConfirmDialog
        open={confirm === "wipe"}
        title="Wipe the local vault?"
        body={
          <>
            This deletes the raw document text, token map, and locally stored letter from session
            memory and sessionStorage. The current session resets. Zero-PII Firestore audits are not
            affected.
            <br />
            <br />
            You will not be able to rehydrate the current letter afterward.
          </>
        }
        confirmLabel="Wipe Local Vault"
        tone="danger"
        busy={dialogBusy}
        onConfirm={() => void handleWipeVault()}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete all audits?"
        body={
          <>
            This permanently deletes {auditCount} anonymized audit record(s) from Firestore and
            localStorage. Raw documents and token maps are not stored there, so this cannot be
            undone.
          </>
        }
        confirmLabel="Delete All Audits"
        tone="danger"
        busy={dialogBusy}
        onConfirm={() => void handleDeleteAudits()}
        onCancel={() => setConfirm(null)}
      />

      <TutorialModal
        open={tutorialOpen}
        onClose={closeTutorial}
        onTryDemo={() => {
          const erSample = SAMPLES[0];
          if (erSample) {
            void handleScrub({
              text: erSample.text,
              documentType: erSample.documentType,
              jurisdiction: erSample.jurisdiction,
              label: erSample.label,
              sampleId: erSample.id,
            });
          }
        }}
      />

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((previous) => previous.filter((toast) => toast.id !== id))}
      />
    </div>
  );
}
