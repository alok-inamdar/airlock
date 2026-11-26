import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Code2,
  Copy,
  Eye,
  FileText,
  Fingerprint,
  FlaskConical,
  Gauge,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Server,
  ShieldCheck,
  Sparkles,
  Undo2,
  WifiOff,
} from "lucide-react";
import type { AuditReport, LetterState, Tone } from "../types";
import { DOCUMENT_TYPE_LABELS } from "../types";
import type { LocalScrubEntity, WirePayload } from "../vault/wireBoundary";
import type { EntityCategory } from "../vault/tokenMap";
import { escapeRegExp } from "../vault/tokenMap";
import {
  classifyRequest,
  REQUEST_KIND_LABEL,
  type RequestLogEntry,
} from "../services/telemetry";
import {
  formatBytes,
  formatClock,
  formatDuration,
  formatNumber,
  formatUsd,
} from "../lib/format";
import { RuleCitations } from "./RuleCitations";
import { RehydratedLetter } from "./RehydratedLetter";
import { Badge, Button, InlineNotice, JsonView, Spinner, cx } from "./ui";

export interface XRayStats {
  entities: number;
  regexCatches: number;
  manualRedactions: number;
  payloadReduction: number;
  wireBytes: number;
  rawBytes: number;
  firewallPassed: boolean;
  localLatencyMs: number;
  cloudLatencyMs: number;
  localSource: string;
}

export type AuditPaneState = "idle" | "running" | "queued" | "done" | "error";

export interface AirlockXRayProps {
  documentLabel: string;
  rawText: string;
  entities: LocalScrubEntity[];
  wire: WirePayload;
  stats: XRayStats;
  audit: AuditReport | null;
  auditState: AuditPaneState;
  auditError: { message: string; hint: string } | null;
  auditStartedAt: number | null;
  letter: LetterState | null;
  letterBusy: boolean;
  tone: Tone;
  manualRedactions: Array<{ token: string; original: string }>;
  requestLog: RequestLogEntry[];
  documentBytes: number;
  online: boolean;
  firebaseEnabled: boolean;
  queueCount: number;
  modeLabel: string;
  onRedactWord: (word: string) => void;
  onUndoManual: (token: string) => void;
  onApprove: () => void;
  onUseCached: () => void;
  onRetry: () => void;
  onRetryQueue: () => void;
  onNewDocument: () => void;
  onToneChange: (tone: Tone) => void;
  onCopyLetter: () => void;
  onDownloadLetter: () => void;
  onPrintLetter: () => void;
  onCopyWire: () => void;
}

const CATEGORY_STYLE: Record<EntityCategory, { chip: string; dot: string; label: string }> = {
  PERSON: {
    chip: "bg-violet-400/[0.15] text-violet-100 decoration-violet-400/40",
    dot: "bg-violet-400",
    label: "Person",
  },
  ORG: {
    chip: "bg-sky-400/[0.15] text-sky-100 decoration-sky-400/40",
    dot: "bg-sky-400",
    label: "Organization",
  },
  ADDRESS: {
    chip: "bg-cyan-400/[0.15] text-cyan-100 decoration-cyan-400/40",
    dot: "bg-cyan-400",
    label: "Address",
  },
  ID_NUMBER: {
    chip: "bg-rose-400/[0.15] text-rose-100 decoration-rose-400/40",
    dot: "bg-rose-400",
    label: "ID / SSN",
  },
  CONTACT: {
    chip: "bg-amber-400/[0.15] text-amber-100 decoration-amber-400/40",
    dot: "bg-amber-400",
    label: "Contact",
  },
  DATE: {
    chip: "bg-slate-400/[0.15] text-slate-100 decoration-slate-400/40",
    dot: "bg-slate-400",
    label: "Date",
  },
  ACCOUNT: {
    chip: "bg-emerald-400/[0.15] text-emerald-100 decoration-emerald-400/40",
    dot: "bg-emerald-400",
    label: "Financial",
  },
  MANUAL: {
    chip: "bg-fuchsia-400/[0.15] text-fuchsia-100 decoration-fuchsia-400/40",
    dot: "bg-fuchsia-400",
    label: "Manual",
  },
};

interface TextRange {
  start: number;
  end: number;
  entity: LocalScrubEntity;
}

function collectRanges(text: string, entities: LocalScrubEntity[]): TextRange[] {
  const ranges: TextRange[] = [];
  for (const entity of entities) {
    const needle = entity.original.trim();
    if (needle.length < 2) continue;
    const prefix = /^[A-Za-z0-9]/.test(needle) ? "\\b" : "";
    const suffix = /[A-Za-z0-9]$/.test(needle) ? "\\b" : "";
    const expression = new RegExp(`${prefix}${escapeRegExp(needle)}${suffix}`, "gi");
    let match = expression.exec(text);
    let count = 0;
    while (match && count < 8) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
        entity,
      });
      count += 1;
      if (expression.lastIndex === match.index) expression.lastIndex += 1;
      match = expression.exec(text);
    }
  }

  ranges.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  const filtered: TextRange[] = [];
  let cursor = -1;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    filtered.push(range);
    cursor = range.end;
  }
  return filtered;
}

function PlainWords({
  text,
  redactMode,
  onWord,
}: {
  text: string;
  redactMode: boolean;
  onWord: (word: string) => void;
}) {
  if (!redactMode) return <>{text}</>;
  return (
    <>
      {text.split(/(\s+)/).map((part, index) => {
        if (!part.trim()) return <span key={index}>{part}</span>;
        return (
          <button
            key={index}
            type="button"
            onClick={() => onWord(part)}
            title="Redact this word"
            className="-mx-0.5 rounded px-0.5 text-left transition-colors hover:bg-rose-400/25 hover:text-rose-100"
          >
            {part}
          </button>
        );
      })}
    </>
  );
}

function AnnotatedDocument({
  text,
  entities,
  redactMode,
  onWord,
}: {
  text: string;
  entities: LocalScrubEntity[];
  redactMode: boolean;
  onWord: (word: string) => void;
}) {
  const ranges = useMemo(() => collectRanges(text, entities), [text, entities]);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(
        <PlainWords
          key={`plain-${index}`}
          text={text.slice(cursor, range.start)}
          redactMode={redactMode}
          onWord={onWord}
        />
      );
    }
    const style = CATEGORY_STYLE[range.entity.category];
    nodes.push(
      <span
        key={`entity-${index}`}
        title={`${style.label}${range.entity.role ? ` · ${range.entity.role}` : ""} → ${range.entity.token}`}
        className={cx("rounded px-0.5 underline decoration-2 underline-offset-2", style.chip)}
      >
        {text.slice(range.start, range.end)}
        {range.entity.role ? (
          <span className="ml-1 align-middle text-[8px] font-semibold uppercase tracking-wide opacity-70">
            {range.entity.role}
          </span>
        ) : null}
      </span>
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    nodes.push(
      <PlainWords
        key="plain-tail"
        text={text.slice(cursor)}
        redactMode={redactMode}
        onWord={onWord}
      />
    );
  }

  return (
    <div className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-[1.8] text-ink-200">
      {nodes}
    </div>
  );
}

function LocalPane({
  documentLabel,
  rawText,
  entities,
  stats,
  manualRedactions,
  canEdit,
  onRedactWord,
  onUndoManual,
}: {
  documentLabel: string;
  rawText: string;
  entities: LocalScrubEntity[];
  stats: XRayStats;
  manualRedactions: Array<{ token: string; original: string }>;
  canEdit: boolean;
  onRedactWord: (word: string) => void;
  onUndoManual: (token: string) => void;
}) {
  const [redactMode, setRedactMode] = useState(false);
  const [showEntities, setShowEntities] = useState(false);

  useEffect(() => {
    setRedactMode(false);
  }, [rawText, canEdit]);

  return (
    <section className="pane border-emerald-400/[0.15] bg-ink-850/70">
      <div className="flex items-center justify-between gap-3 border-b border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-emerald-200">
        <div className="flex min-w-0 items-center gap-2.5">
          <Lock className="h-4 w-4 shrink-0 opacity-85" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-emerald-100">
              Your Original (Stays Private)
            </div>
            <div className="truncate text-[11px] text-emerald-200/70">
              {documentLabel} · never leaves your browser
            </div>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setRedactMode((value) => !value)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
              redactMode
                ? "border-rose-400/40 bg-rose-400/15 text-rose-100"
                : "border-white/15 bg-white/[0.05] text-ink-200 hover:bg-white/[0.1]"
            )}
            aria-pressed={redactMode}
          >
            <ScanLine className="h-3 w-3" />
            {redactMode ? "Click word to hide" : "Hide more"}
          </button>
        ) : (
          <Badge tone="green">{stats.entities} hidden</Badge>
        )}
      </div>

      <div className="pane-scroll px-4 py-4">
        {redactMode ? (
          <div className="mb-3 rounded-lg border border-rose-400/25 bg-rose-400/[0.07] px-3 py-2 text-[11.5px] text-rose-100">
            Click any un-highlighted word below to hide it before sending.
          </div>
        ) : null}

        <AnnotatedDocument
          text={rawText}
          entities={entities}
          redactMode={redactMode}
          onWord={onRedactWord}
        />

        {manualRedactions.length > 0 ? (
          <div className="mt-4">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
              Added by you
            </div>
            <div className="flex flex-wrap gap-1.5">
              {manualRedactions.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  onClick={() => onUndoManual(item.token)}
                  className="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/25 bg-fuchsia-400/[0.08] px-2.5 py-0.5 text-[11px] text-fuchsia-100 transition-colors hover:bg-fuchsia-400/[0.15]"
                  title={`Restore ${item.original}`}
                >
                  <span className="max-w-[120px] truncate">{item.original}</span>
                  <Undo2 className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <button
            type="button"
            onClick={() => setShowEntities((value) => !value)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[11.5px] font-semibold text-ink-300"
            aria-expanded={showEntities}
          >
            <span className="flex items-center gap-1.5">
              <Fingerprint className="h-3.5 w-3.5 text-emerald-300" />
              Hidden details ({entities.length})
            </span>
            <span className="text-[11px] font-normal text-ink-500">
              {showEntities ? "Hide list" : "Show list"}
            </span>
          </button>
          {showEntities ? (
            <ul className="max-h-52 space-y-1.5 overflow-y-auto border-t border-white/[0.06] px-3 py-2.5">
              {entities.map((entity) => (
                <li key={entity.token} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cx(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        CATEGORY_STYLE[entity.category].dot
                      )}
                    />
                    <span className="truncate text-ink-200">{entity.original}</span>
                  </span>
                  <span className="mono shrink-0 text-[10px] text-amber-200/80">{entity.token}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function RequestLog({ entries, documentBytes }: { entries: RequestLogEntry[]; documentBytes: number }) {
  const infrastructure = entries.filter((entry) => classifyRequest(entry) === "infrastructure").length;
  const local = entries.filter((entry) => classifyRequest(entry) === "local").length;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-ink-950/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">
          <Server className="h-3.5 w-3.5" />
          Network log
        </span>
        <span className="flex items-center gap-1.5">
          <Badge tone={documentBytes > 0 ? "amber" : "green"}>
            sent {formatBytes(documentBytes)}
          </Badge>
          <Badge tone="slate">{infrastructure} infra</Badge>
          <Badge tone="slate">{local} local</Badge>
        </span>
      </div>
      <ul className="max-h-44 divide-y divide-white/[0.04] overflow-y-auto">
        {entries.length === 0 ? (
          <li className="px-3 py-3 text-[10.5px] text-ink-500">No requests logged yet.</li>
        ) : (
          entries.slice(0, 20).map((entry) => {
            const classification = classifyRequest(entry);
            const dot =
              entry.status === "ok"
                ? "bg-emerald-400"
                : entry.status === "error"
                  ? "bg-rose-400"
                  : entry.status === "pending"
                    ? "bg-amber-400 animate-pulse-soft"
                    : "bg-ink-500";
            return (
              <li key={entry.id} className="flex items-start gap-2 px-3 py-1.5 text-[10px]">
                <span className={cx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
                <span className="w-[88px] shrink-0 truncate text-ink-400">
                  {REQUEST_KIND_LABEL[entry.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink-200">{entry.label}</span>
                  {entry.detail ? (
                    <span className="block truncate text-[9.5px] text-ink-500">{entry.detail}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right text-[9px] text-ink-500">
                  {entry.bytes !== undefined ? <span className="block">{formatBytes(entry.bytes)}</span> : null}
                  <span className="block">{formatClock(entry.at)}</span>
                </span>
                <span
                  className={cx(
                    "shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide",
                    classification === "document"
                      ? "bg-amber-400/10 text-amber-300"
                      : classification === "local"
                        ? "bg-emerald-400/10 text-emerald-300"
                        : "bg-blue-400/10 text-blue-300"
                  )}
                >
                  {classification === "document" ? "doc" : classification}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function HighlightedSanitizedText({ text }: { text: string }) {
  const parts = text.split(/(\[[A-Z][A-Z0-9_]*_\d+\])/g);
  return (
    <div className="whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-ink-950/60 p-4 font-sans text-[12.5px] leading-[1.8] text-ink-200">
      {parts.map((part, index) =>
        /^\[[A-Z][A-Z0-9_]*_\d+\]$/.test(part) ? (
          <span
            key={index}
            className="mono mx-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200"
          >
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </div>
  );
}

function WirePane({
  wire,
  stats,
  requestLog,
  documentBytes,
  onCopyWire,
}: {
  wire: WirePayload;
  stats: XRayStats;
  requestLog: RequestLogEntry[];
  documentBytes: number;
  onCopyWire: () => void;
}) {
  const [view, setView] = useState<"readable" | "technical">("readable");

  return (
    <section className="pane border-amber-400/[0.15] bg-ink-850/70">
      <div className="flex items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-amber-200">
        <div className="flex min-w-0 items-center gap-2.5">
          <ArrowLeftRight className="h-4 w-4 shrink-0 opacity-85" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-amber-100">
              Safe to Send (Anonymized)
            </div>
            <div className="truncate text-[11px] text-amber-200/70">
              Only this scrubbed version goes to Cloud AI · {formatBytes(stats.wireBytes)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-ink-950/60 p-0.5">
          <button
            type="button"
            onClick={() => setView("readable")}
            className={cx(
              "rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors",
              view === "readable"
                ? "bg-amber-400/20 text-amber-100"
                : "text-ink-400 hover:text-ink-200"
            )}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setView("technical")}
            className={cx(
              "rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors",
              view === "technical"
                ? "bg-amber-400/20 text-amber-100"
                : "text-ink-400 hover:text-ink-200"
            )}
          >
            JSON &amp; Log
          </button>
        </div>
      </div>

      <div className="pane-scroll space-y-3 px-4 py-4">
        {!stats.firewallPassed ? (
          <InlineNotice tone="error" title="Privacy firewall blocked this payload">
            Direct identifiers are still present. Use “Hide more” or retry the local scrub.
          </InlineNotice>
        ) : null}

        {view === "readable" ? (
          <>
            <HighlightedSanitizedText text={wire.sanitizedText} />

            {Object.keys(wire.roleHints).length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10.5px] font-medium text-ink-500">Roles kept:</span>
                {Object.entries(wire.roleHints).map(([token, role]) => (
                  <span
                    key={token}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10.5px]"
                  >
                    <span className="mono text-[10px] text-amber-200/80">{token}</span>
                    <ArrowRight className="h-2.5 w-2.5 text-ink-500" />
                    <span className="text-ink-300">{role}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                  <Code2 className="h-3.5 w-3.5" /> Exact WirePayload JSON
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onCopyWire}
                  icon={<Copy className="h-3 w-3" />}
                  className="h-6 px-2 text-[10.5px]"
                >
                  Copy JSON
                </Button>
              </div>
              <JsonView value={wire} className="max-h-[280px] overflow-y-auto" ariaLabel="Wire payload JSON" />
            </div>

            <RequestLog entries={requestLog} documentBytes={documentBytes} />
          </>
        )}
      </div>
    </section>
  );
}

const SEVERITY_STYLE = {
  HIGH: { tone: "red" as const, dot: "bg-rose-400" },
  MEDIUM: { tone: "amber" as const, dot: "bg-amber-400" },
  LOW: { tone: "slate" as const, dot: "bg-slate-400" },
};

function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, now - startedAt) : 0;
}

export function AirlockXRay(props: AirlockXRayProps) {
  const { stats, audit, auditState, auditError, auditStartedAt } = props;
  const [showXRayInResults, setShowXRayInResults] = useState(false);
  const elapsed = useElapsed(auditState === "running" ? auditStartedAt : null);

  useEffect(() => {
    if (auditState === "done" || auditState === "queued") {
      setShowXRayInResults(false);
    }
  }, [auditState]);

  const isResultsReady = (auditState === "done" || auditState === "queued") && audit !== null;

  if (isResultsReady && !showXRayInResults) {
    const scoreColor =
      audit.overallRiskScore >= 60
        ? "#fb7185"
        : audit.overallRiskScore >= 30
          ? "#fbbf24"
          : "#34d399";
    const sourceLabel =
      audit.source === "cloud"
        ? `Live cloud audit · ${audit.cloudModel ?? "Gemini"}`
        : audit.source === "cached_demo"
          ? "Cached demo preview"
          : "Offline triage · queued";

    return (
      <div className="animate-fade-in space-y-4">
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/15">
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-300" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14.5px] font-semibold text-ink-100">
                  {audit.findings.length} issue{audit.findings.length === 1 ? "" : "s"} found &amp; dispute letter ready
                </h2>
                <Badge tone={audit.source === "cloud" ? "green" : "amber"}>{sourceLabel}</Badge>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-ink-400">
                {props.documentLabel} · {DOCUMENT_TYPE_LABELS[props.wire.documentType]} · {props.wire.jurisdiction}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {audit.source === "local_triage" ? (
              <Button
                size="sm"
                variant="blue"
                onClick={props.onRetryQueue}
                disabled={!props.online}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Retry Cloud Audit{props.queueCount > 0 ? ` (${props.queueCount})` : ""}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowXRayInResults(true)}
              icon={<Eye className="h-3.5 w-3.5 text-emerald-300" />}
            >
              Privacy X-Ray ({stats.entities} hidden)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={props.onNewDocument}
              icon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              New Document
            </Button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-6">
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <div className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-ink-850/75 px-4 py-3.5">
                <div
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(${scoreColor} ${Math.max(4, audit.overallRiskScore) * 3.6}deg, rgba(255,255,255,0.07) 0deg)`,
                  }}
                >
                  <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-ink-850 text-[16px] font-bold text-ink-100">
                    {audit.overallRiskScore}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                    <Gauge className="h-3 w-3" /> Risk score
                  </div>
                  <div className="text-[13.5px] font-semibold text-ink-100">
                    {audit.overallRiskScore >= 60
                      ? "High attention"
                      : audit.overallRiskScore >= 30
                        ? "Review recommended"
                        : "Low flag count"}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-ink-850/75 px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                    Estimated financial impact
                  </span>
                  <Badge tone="slate">{audit.rulePackVersion}</Badge>
                </div>
                <div className="mt-1 text-[24px] font-semibold leading-tight text-emerald-200">
                  {formatUsd(audit.estimatedSavings)}
                </div>
                {audit.summary ? (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-300">{audit.summary}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                  <ListChecks className="h-3.5 w-3.5" /> Findings ({audit.findings.length})
                </span>
                <span className="text-[11px] text-ink-500">
                  {formatDuration(audit.latencyMs)}
                </span>
              </div>

              {audit.findings.length === 0 ? (
                <p className="rounded-2xl border border-white/[0.06] bg-ink-850/70 px-4 py-4 text-[12.5px] leading-relaxed text-ink-300">
                  No specific violation was flagged under the bundled 2026 Rule Packs. Try another
                  jurisdiction or review the line items manually.
                </p>
              ) : (
                audit.findings.map((finding) => {
                  const severity = SEVERITY_STYLE[finding.severity];
                  return (
                    <article
                      key={finding.id}
                      className="rounded-2xl border border-white/[0.08] bg-ink-850/75 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", severity.dot)} />
                          <div className="min-w-0">
                            <h3 className="text-[13.5px] font-semibold leading-snug text-ink-100">
                              {finding.title}
                            </h3>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge tone={severity.tone}>{finding.severity}</Badge>
                              {finding.flaggedAsPotential ? (
                                <Badge tone="amber">Potential</Badge>
                              ) : null}
                              <span className="mono rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-ink-400">
                                {finding.matchedRuleId}
                              </span>
                            </div>
                          </div>
                        </div>
                        {finding.estimatedImpact ? (
                          <span className="shrink-0 text-[14px] font-semibold text-emerald-200">
                            {formatUsd(finding.estimatedImpact)}
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-300">
                        {finding.explanation}
                      </p>

                      {finding.tokenizedEvidence ? (
                        <p className="mt-2.5 rounded-xl bg-ink-950/60 px-3 py-2 text-[11.5px] leading-relaxed text-ink-400">
                          “{finding.tokenizedEvidence}”
                        </p>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>

            <RuleCitations findings={audit.findings} rulePackVersion={audit.rulePackVersion} />
          </div>

          <div className="lg:col-span-6">
            <div className="lg:sticky lg:top-[76px]">
              <RehydratedLetter
                letter={props.letter}
                tone={props.tone}
                busy={props.letterBusy}
                onToneChange={props.onToneChange}
                onCopy={props.onCopyLetter}
                onDownload={props.onDownloadLetter}
                onPrint={props.onPrintLetter}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/15">
            <ShieldCheck className="h-4.5 w-4.5 text-emerald-300" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink-100">
              {isResultsReady
                ? `Privacy X-Ray — ${stats.entities} personal details stayed on your device`
                : auditState === "running"
                  ? "Auditing the anonymized document against 2026 rules…"
                  : `We hid ${stats.entities} personal details locally — review before sending`}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-300">
              {isResultsReady
                ? "Compare your private original (left) with the anonymized version sent to Cloud AI (right)."
                : "Nothing has left your browser yet. Click “Hide more” on the left if you want to redact extra words."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isResultsReady ? (
            <Button
              size="md"
              variant="primary"
              onClick={() => setShowXRayInResults(false)}
              icon={<ArrowLeft className="h-4 w-4" />}
            >
              Back to Audit &amp; Letter
            </Button>
          ) : auditState === "idle" ? (
            <>
              <Button
                size="md"
                variant="primary"
                onClick={props.onApprove}
                icon={<Cloud className="h-4 w-4" />}
              >
                {props.online ? "Approve & Run Cloud Audit" : "Run Offline Triage"}
              </Button>
              {!props.firebaseEnabled ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={props.onUseCached}
                  icon={<FlaskConical className="h-3.5 w-3.5" />}
                >
                  Preview Demo
                </Button>
              ) : null}
            </>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onNewDocument}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
          >
            Start Over
          </Button>
        </div>
      </div>

      {auditState === "running" ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-blue-400/20 bg-blue-400/[0.04] px-6 py-8 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-blue-300" />
          <div>
            <h3 className="text-[14px] font-semibold text-ink-100">
              Checking anonymized text against 2026 rules…
            </h3>
            <p className="mt-1 flex items-center justify-center gap-2 text-[12px] text-ink-400">
              <Spinner className="h-3.5 w-3.5" />
              Only {formatBytes(stats.wireBytes)} of scrubbed text sent · {formatDuration(elapsed)}
            </p>
          </div>
        </div>
      ) : null}

      {auditState === "error" || (auditError && !audit) ? (
        <div className="rounded-2xl border border-rose-400/25 bg-rose-400/[0.06] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[13.5px] font-semibold text-rose-100">Cloud audit failed</h3>
              <p className="mt-1 text-[12px] text-rose-200/90">
                {auditError?.message ?? "The cloud audit failed."}
              </p>
              {auditError?.hint ? (
                <p className="mt-1 text-[11.5px] text-rose-200/70">{auditError.hint}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={props.onRetry} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                Retry
              </Button>
              <Button size="sm" variant="amber" onClick={props.onUseCached} icon={<FlaskConical className="h-3.5 w-3.5" />}>
                Use Cached Demo Result
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!props.online && auditState === "idle" ? (
        <InlineNotice tone="warn" title="You are offline">
          Airlock will run a local triage on the scrubbed text and queue the full cloud audit until
          your connection returns.
        </InlineNotice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <LocalPane
          documentLabel={props.documentLabel}
          rawText={props.rawText}
          entities={props.entities}
          stats={stats}
          manualRedactions={props.manualRedactions}
          canEdit={!isResultsReady && auditState !== "running"}
          onRedactWord={props.onRedactWord}
          onUndoManual={props.onUndoManual}
        />
        <WirePane
          wire={props.wire}
          stats={stats}
          requestLog={props.requestLog}
          documentBytes={props.documentBytes}
          onCopyWire={props.onCopyWire}
        />
      </div>

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-white/[0.04] p-0 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Details hidden", value: formatNumber(stats.entities), icon: Fingerprint },
          { label: "Regex catches", value: formatNumber(stats.regexCatches), icon: ShieldCheck },
          { label: "Payload reduction", value: `${stats.payloadReduction}%`, icon: Layers },
          { label: "Wire size", value: formatBytes(stats.wireBytes), icon: ArrowLeftRight },
          { label: "Local speed", value: formatDuration(stats.localLatencyMs), icon: Sparkles },
          {
            label: "Cloud speed",
            value: audit ? formatDuration(audit.latencyMs) : "—",
            icon: Cloud,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-ink-850/90 px-3.5 py-2.5">
              <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-ink-500">
                <Icon className="h-3 w-3" /> {item.label}
              </div>
              <div className="mt-0.5 text-[13px] font-semibold text-ink-100">{item.value}</div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10.5px] text-ink-500">
        <span className="flex items-center gap-1.5">
          <WifiOff className="hidden h-3 w-3" />
          <ShieldCheck className="h-3 w-3 text-emerald-400" />
          Zero detected direct identifiers leave your browser.
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Session-only local vault · Wipe anytime
        </span>
      </div>
    </div>
  );
}
