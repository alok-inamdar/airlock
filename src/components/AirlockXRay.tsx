import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cloud,
  Code2,
  Copy,
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
import type { LocalScrubEntity } from "../vault/wireBoundary";
import type { WirePayload } from "../vault/wireBoundary";
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
    label: "Person + role",
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
    label: "Financial / account",
  },
  MANUAL: {
    chip: "bg-fuchsia-400/[0.15] text-fuchsia-100 decoration-fuchsia-400/40",
    dot: "bg-fuchsia-400",
    label: "Manual redaction",
  },
};

const LEGEND: EntityCategory[] = [
  "PERSON",
  "ORG",
  "ADDRESS",
  "ID_NUMBER",
  "CONTACT",
  "DATE",
  "ACCOUNT",
];

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
        title={`${style.label}${range.entity.role ? ` · role: ${range.entity.role}` : ""} → ${range.entity.token}`}
        className={cx(
          "rounded px-0.5 underline decoration-2 underline-offset-2",
          style.chip
        )}
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
    <div className="whitespace-pre-wrap break-words font-sans text-[12px] leading-[1.75] text-ink-200">
      {nodes}
    </div>
  );
}

function PaneHeader({
  tone,
  label,
  subtitle,
  icon,
  right,
}: {
  tone: "green" | "amber" | "blue";
  label: string;
  subtitle: string;
  icon: ReactNode;
  right?: ReactNode;
}) {
  const styles = {
    green: "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200",
    amber: "border-amber-400/20 bg-amber-400/[0.06] text-amber-200",
    blue: "border-blue-400/20 bg-blue-400/[0.06] text-blue-200",
  }[tone];
  return (
    <div className={cx("flex items-start justify-between gap-3 border-b px-4 py-3", styles)}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 opacity-80">{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em]">
            {label}
          </div>
          <div className="mt-0.5 text-[10.5px] font-normal opacity-70">{subtitle}</div>
        </div>
      </div>
      {right}
    </div>
  );
}

function LocalPane({
  documentLabel,
  rawText,
  entities,
  wire,
  stats,
  manualRedactions,
  modeLabel,
  onRedactWord,
  onUndoManual,
}: {
  documentLabel: string;
  rawText: string;
  entities: LocalScrubEntity[];
  wire: WirePayload;
  stats: XRayStats;
  manualRedactions: Array<{ token: string; original: string }>;
  modeLabel: string;
  onRedactWord: (word: string) => void;
  onUndoManual: (token: string) => void;
}) {
  const [redactMode, setRedactMode] = useState(false);
  const [showEntities, setShowEntities] = useState(false);

  useEffect(() => {
    setRedactMode(false);
  }, [rawText]);

  return (
    <section className="pane border-emerald-400/[0.15] bg-ink-850/70">
      <PaneHeader
        tone="green"
        label="1. Your Original (Private)"
        subtitle="Stays in your browser · never sent"
        icon={<Lock className="h-4 w-4" />}
        right={<Badge tone="green">{modeLabel}</Badge>}
      />

      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="slate">{DOCUMENT_TYPE_LABELS[wire.documentType]}</Badge>
          <Badge tone="slate">{wire.jurisdiction}</Badge>
          <Badge tone="violet">{stats.entities} identifiers</Badge>
          <button
            type="button"
            onClick={() => setRedactMode((value) => !value)}
            className={cx(
              "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors",
              redactMode
                ? "border-rose-400/40 bg-rose-400/10 text-rose-200"
                : "border-white/10 bg-white/[0.03] text-ink-300 hover:bg-white/[0.06]"
            )}
            aria-pressed={redactMode}
          >
            <ScanLine className="h-3 w-3" />
            {redactMode ? "Click-to-redact: ON" : "Redact more"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {LEGEND.map((category) => (
            <span key={category} className="inline-flex items-center gap-1 text-[9.5px] text-ink-400">
              <span className={cx("h-1.5 w-1.5 rounded-full", CATEGORY_STYLE[category].dot)} />
              {CATEGORY_STYLE[category].label}
            </span>
          ))}
        </div>
      </div>

      <div className="pane-scroll px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between gap-2 text-[10.5px] text-ink-500">
          <span className="truncate font-medium text-ink-400">{documentLabel}</span>
          <span>{formatNumber(rawText.length)} chars</span>
        </div>

        {redactMode ? (
          <div className="mb-3 rounded-lg border border-rose-400/25 bg-rose-400/[0.07] px-2.5 py-2 text-[10.5px] leading-relaxed text-rose-100">
            Click any un-highlighted word to replace it with a local manual token. The wire payload
            rebuilds immediately.
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
              Manual redactions
            </div>
            <div className="flex flex-wrap gap-1.5">
              {manualRedactions.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  onClick={() => onUndoManual(item.token)}
                  className="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/25 bg-fuchsia-400/[0.08] px-2 py-0.5 text-[10.5px] text-fuchsia-100 transition-colors hover:bg-fuchsia-400/[0.15]"
                  title={`Remove manual redaction ${item.token}`}
                >
                  <span className="mono text-[9.5px] opacity-70">{item.token}</span>
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
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[11px] font-semibold text-ink-300"
            aria-expanded={showEntities}
          >
            <span className="flex items-center gap-1.5">
              <Fingerprint className="h-3.5 w-3.5" />
              Detected identifiers ({entities.length})
            </span>
            <span className="text-[10px] font-normal text-ink-500">
              {showEntities ? "Hide" : "Inspect local map"}
            </span>
          </button>
          {showEntities ? (
            <ul className="max-h-56 space-y-1 overflow-y-auto border-t border-white/[0.06] px-3 py-2">
              {entities.map((entity) => (
                <li key={entity.token} className="flex items-start gap-2 text-[10.5px]">
                  <span
                    className={cx(
                      "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                      CATEGORY_STYLE[entity.category].dot
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-200">{entity.original}</span>
                    <span className="ml-1.5 mono text-[9.5px] text-ink-500">{entity.token}</span>
                    {entity.role ? (
                      <span className="ml-1.5 rounded bg-white/[0.06] px-1 text-[9px] text-ink-400">
                        {entity.role}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-ink-600">
                    {entity.source ?? "device"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-emerald-400/[0.04] px-4 py-2 text-[10px] text-emerald-200/80">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3" /> Raw text stays in this tab
        </span>
        <span>0 raw document bytes sent</span>
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
          Classified request log
        </span>
        <span className="flex items-center gap-1.5">
          <Badge tone={documentBytes > 0 ? "amber" : "green"}>
            document {formatBytes(documentBytes)}
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
                <span className="w-[92px] shrink-0 truncate text-ink-400">
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
    <div className="whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-ink-950/60 p-3.5 font-sans text-[12px] leading-[1.75] text-ink-200">
      {parts.map((part, index) =>
        /^\[[A-Z][A-Z0-9_]*_\d+\]$/.test(part) ? (
          <span
            key={index}
            className="mono mx-0.5 rounded bg-amber-400/15 px-1 py-0.5 text-[11px] font-semibold text-amber-200"
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
      <PaneHeader
        tone="amber"
        label="2. Safe to Send (Anonymized)"
        subtitle="Only this scrubbed version leaves your browser"
        icon={<ArrowLeftRight className="h-4 w-4" />}
        right={<Badge tone={stats.firewallPassed ? "green" : "red"}>{stats.firewallPassed ? "Safe" : "Blocked"}</Badge>}
      />

      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-ink-950/60 p-1">
          <button
            type="button"
            onClick={() => setView("readable")}
            className={cx(
              "rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors",
              view === "readable"
                ? "bg-amber-400/15 text-amber-100"
                : "text-ink-400 hover:text-ink-200"
            )}
          >
            Readable Preview
          </button>
          <button
            type="button"
            onClick={() => setView("technical")}
            className={cx(
              "rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors",
              view === "technical"
                ? "bg-amber-400/15 text-amber-100"
                : "text-ink-400 hover:text-ink-200"
            )}
          >
            Raw JSON &amp; Log
          </button>
        </div>
      </div>

      <div className="pane-scroll space-y-3 px-4 py-3.5">
        <div
          className={cx(
            "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px]",
            stats.firewallPassed
              ? "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-200"
              : "border-rose-400/30 bg-rose-400/[0.08] text-rose-200"
          )}
        >
          <span className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="h-3.5 w-3.5" />
            Privacy firewall: {stats.firewallPassed ? "PASSED" : "FAILED"}
          </span>
          <span className="text-[10px] opacity-80">{stats.entities} details hidden</span>
        </div>

        {view === "readable" ? (
          <>
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              Every highlighted placeholder below (like <span className="mono text-amber-200">[PERSON_1]</span>) replaces your real info. Only this text is sent for auditing.
            </p>
            <HighlightedSanitizedText text={wire.sanitizedText} />

            {Object.keys(wire.roleHints).length > 0 ? (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                  Role labels kept for context
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(wire.roleHints).map(([token, role]) => (
                    <span
                      key={token}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[10.5px]"
                    >
                      <span className="mono text-[10px] text-ink-300">{token}</span>
                      <ArrowRight className="h-2.5 w-2.5 text-ink-500" />
                      <span className="text-ink-300">{role}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                  <Code2 className="h-3 w-3" /> Exact WirePayload JSON
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onCopyWire}
                  icon={<Copy className="h-3 w-3" />}
                  className="h-6 px-2 text-[10px]"
                >
                  Copy JSON
                </Button>
              </div>
              <JsonView value={wire} className="max-h-[280px] overflow-y-auto" ariaLabel="Wire payload JSON" />
            </div>

            <RequestLog entries={requestLog} documentBytes={documentBytes} />

            <p className="text-[10px] leading-relaxed text-ink-500">
              Runtime guard: only <span className="mono">documentType</span>,{" "}
              <span className="mono">jurisdiction</span>, <span className="mono">sanitizedText</span>,{" "}
              <span className="mono">roleHints</span>, and <span className="mono">extractedItems</span>{" "}
              are serialized. Raw entities never enter this object.
            </p>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-amber-400/[0.04] px-4 py-2 text-[10.5px] text-amber-200/80">
        <span className="flex items-center gap-1.5">
          <ArrowLeftRight className="h-3 w-3" /> {formatBytes(stats.wireBytes)} payload
        </span>
        <span>{formatNumber(wire.sanitizedText.length)} anonymized chars</span>
      </div>
    </section>
  );
}

const SEVERITY_STYLE = {
  HIGH: { tone: "red" as const, dot: "bg-rose-400", text: "text-rose-200" },
  MEDIUM: { tone: "amber" as const, dot: "bg-amber-400", text: "text-amber-200" },
  LOW: { tone: "slate" as const, dot: "bg-slate-400", text: "text-slate-200" },
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

function AuditReportView({
  audit,
  onNewDocument,
  letter,
  tone,
  letterBusy,
  onToneChange,
  onCopyLetter,
  onDownloadLetter,
  onPrintLetter,
  queueCount,
  onRetryQueue,
  online,
}: {
  audit: AuditReport;
  onNewDocument: () => void;
  letter: LetterState | null;
  tone: Tone;
  letterBusy: boolean;
  onToneChange: (tone: Tone) => void;
  onCopyLetter: () => void;
  onDownloadLetter: () => void;
  onPrintLetter: () => void;
  queueCount: number;
  onRetryQueue: () => void;
  online: boolean;
}) {
  const source = audit.source;
  const sourceBanner =
    source === "cloud"
      ? {
          tone: "success" as const,
          title: "Live cloud audit",
          body: `${audit.cloudModel ?? "gemini-4-hydrogen"} · inference ${audit.cloudInferenceSource ?? "in_cloud"} · ${formatNumber(audit.findings.length)} findings`,
        }
      : source === "cached_demo"
        ? {
            tone: "warn" as const,
            title: "Cached demo result — cloud audit unavailable",
            body:
              audit.warnings[0] ??
              "This is a deterministic preview from the bundled rule packs, not a live Gemini call.",
          }
        : {
            tone: "warn" as const,
            title: "Local triage only — queued for cloud audit",
            body:
              "The sanitized payload was triaged on-device and queued. Run the cloud audit when the network returns.",
          };
  const scoreColor =
    audit.overallRiskScore >= 60
      ? "#fb7185"
      : audit.overallRiskScore >= 30
        ? "#fbbf24"
        : "#34d399";

  return (
    <div className="space-y-3.5">
      <InlineNotice tone={sourceBanner.tone} title={sourceBanner.title}>
        {sourceBanner.body}
      </InlineNotice>

      {source === "local_triage" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="blue"
            onClick={onRetryQueue}
            disabled={!online}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Retry Queued Audit{queueCount > 0 ? ` (${queueCount})` : ""}
          </Button>
          {!online ? (
            <span className="flex items-center gap-1 text-[10px] text-amber-300">
              <WifiOff className="h-3 w-3" /> Back online to send the wire payload
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2.5 sm:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div
            className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(${scoreColor} ${Math.max(4, audit.overallRiskScore) * 3.6}deg, rgba(255,255,255,0.07) 0deg)`,
            }}
          >
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-ink-850 text-[15px] font-bold text-ink-100">
              {audit.overallRiskScore}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-ink-500">
              <Gauge className="h-3 w-3" /> Risk score
            </div>
            <div className="text-[12px] font-semibold text-ink-100">
              {audit.overallRiskScore >= 60 ? "High attention" : audit.overallRiskScore >= 30 ? "Review recommended" : "Low flag count"}
            </div>
            <div className="text-[10px] text-ink-500">{formatNumber(audit.findings.length)} findings</div>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[9.5px] uppercase tracking-[0.12em] text-ink-500">Estimated financial impact</div>
            <Badge tone="slate">{audit.rulePackVersion}</Badge>
          </div>
          <div className="mt-0.5 text-[20px] font-semibold leading-tight text-emerald-200">
            {formatUsd(audit.estimatedSavings)}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-400">
            {audit.summary}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
          <ListChecks className="h-3.5 w-3.5" /> Findings
        </div>
        <div className="space-y-2">
          {audit.findings.length === 0 ? (
            <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[11px] leading-relaxed text-ink-400">
              No specific violation was supported by the bundled 2026 Rule Packs. That is a valid
              result — it does not prove the document is fair. Try another jurisdiction or review the
              line items manually.
            </p>
          ) : (
            audit.findings.map((finding) => {
              const severity = SEVERITY_STYLE[finding.severity];
              return (
                <article
                  key={finding.id}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", severity.dot)} />
                      <div className="min-w-0">
                        <h4 className="text-[11.5px] font-semibold leading-snug text-ink-100">
                          {finding.title}
                        </h4>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <Badge tone={severity.tone}>{finding.severity}</Badge>
                          {finding.flaggedAsPotential ? <Badge tone="amber">Potential</Badge> : null}
                          {finding.confidence ? (
                            <span className="text-[9px] uppercase tracking-wide text-ink-500">
                              {finding.confidence} confidence
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {finding.estimatedImpact ? (
                      <span className="shrink-0 text-[11.5px] font-semibold text-emerald-200">
                        {formatUsd(finding.estimatedImpact)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-300">{finding.explanation}</p>
                  {finding.tokenizedEvidence ? (
                    <p className="mt-1.5 rounded-lg bg-ink-950/50 px-2 py-1.5 text-[10px] leading-relaxed text-ink-400">
                      “{finding.tokenizedEvidence}”
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9.5px] text-ink-500">
                    <span className="mono rounded bg-white/[0.04] px-1 py-0.5">{finding.matchedRuleId}</span>
                    <span className="truncate">{finding.citation}</span>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      <RuleCitations findings={audit.findings} rulePackVersion={audit.rulePackVersion} />

      <RehydratedLetter
        letter={letter}
        tone={tone}
        busy={letterBusy}
        onToneChange={onToneChange}
        onCopy={onCopyLetter}
        onDownload={onDownloadLetter}
        onPrint={onPrintLetter}
      />

      {(() => {
        const notes = source === "cached_demo" ? audit.warnings.slice(1) : audit.warnings;
        if (notes.length === 0) return null;
        return (
          <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <summary className="cursor-pointer text-[10.5px] font-semibold text-ink-400">
              Audit notes ({notes.length})
            </summary>
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed text-ink-500">
              {notes.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        );
      })()}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <span className="flex items-center gap-1 text-[9.5px] text-ink-500">
          <Clock className="h-3 w-3" /> audit {formatDuration(audit.latencyMs)} ·{" "}
          {audit.source === "cloud" ? "live call" : audit.source === "cached_demo" ? "local preview" : "on-device"}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={onNewDocument}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
        >
          New Document
        </Button>
      </div>
    </div>
  );
}

function AuditPane({
  wire,
  audit,
  auditState,
  auditError,
  auditStartedAt,
  letter,
  letterBusy,
  tone,
  online,
  firebaseEnabled,
  queueCount,
  onApprove,
  onUseCached,
  onRetry,
  onRetryQueue,
  onNewDocument,
  onToneChange,
  onCopyLetter,
  onDownloadLetter,
  onPrintLetter,
}: {
  wire: WirePayload;
  audit: AuditReport | null;
  auditState: AuditPaneState;
  auditError: { message: string; hint: string } | null;
  auditStartedAt: number | null;
  letter: LetterState | null;
  letterBusy: boolean;
  tone: Tone;
  online: boolean;
  firebaseEnabled: boolean;
  queueCount: number;
  onApprove: () => void;
  onUseCached: () => void;
  onRetry: () => void;
  onRetryQueue: () => void;
  onNewDocument: () => void;
  onToneChange: (tone: Tone) => void;
  onCopyLetter: () => void;
  onDownloadLetter: () => void;
  onPrintLetter: () => void;
}) {
  const elapsed = useElapsed(auditState === "running" ? auditStartedAt : null);

  return (
    <section className="pane border-blue-400/[0.15] bg-ink-850/70">
      <PaneHeader
        tone="blue"
        label="3. Audit & Dispute Letter"
        subtitle="2026 rules check · names restored locally"
        icon={<Cloud className="h-4 w-4" />}
        right={
          <Badge
            tone={
              auditState === "running"
                ? "blue"
                : auditState === "error"
                  ? "red"
                  : audit
                    ? "green"
                    : "slate"
            }
          >
            {auditState === "running"
              ? "auditing…"
              : auditState === "error"
                ? "failed"
                : audit
                  ? audit.source.replace("_", " ")
                  : "ready to approve"}
          </Badge>
        }
      />

      <div className="pane-scroll px-4 py-3.5">
        {auditState === "running" ? (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 text-center">
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-blue-400/30 bg-blue-400/10">
              <Loader2 className="h-6 w-6 animate-spin text-blue-300" />
            </span>
            <div>
              <h3 className="text-[13.5px] font-semibold text-ink-100">Auditing the wire payload</h3>
              <p className="mt-1 max-w-xs text-[11.5px] leading-relaxed text-ink-400">
                {firebaseEnabled
                  ? "Cloud Gemini is matching the sanitized document against the bundled 2026 Rule Packs."
                  : "Firebase is not configured, so Airlock is preparing a clearly labeled cached demo result."}
              </p>
            </div>
            <div className="flex flex-col items-start gap-1.5 text-left text-[10.5px] text-ink-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> Wire payload approved and locked
              </span>
              <span className="flex items-center gap-1.5">
                <Spinner className="h-3.5 w-3.5" /> Structured JSON audit · 25s budget
              </span>
              <span className="flex items-center gap-1.5 opacity-60">
                <Clock className="h-3.5 w-3.5" /> {formatDuration(elapsed)} elapsed
              </span>
            </div>
            <p className="max-w-xs text-[10px] leading-relaxed text-ink-500">
              One retry, then fallback to gemini-3.5-flash-lite. Citation allowlist validates every
              matched rule ID.
            </p>
          </div>
        ) : auditState === "error" || (auditError && !audit) ? (
          <div className="space-y-3">
            <InlineNotice tone="error" title="Cloud audit failed">
              <p>{auditError?.message ?? "The cloud audit failed."}</p>
              <p className="mt-1 text-[11px] opacity-80">{auditError?.hint}</p>
            </InlineNotice>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={onRetry}
                icon={<RefreshCw className="h-4 w-4" />}
              >
                Retry
              </Button>
              <Button
                variant="amber"
                onClick={onUseCached}
                icon={<FlaskConical className="h-4 w-4" />}
              >
                Use Cached Demo Result
              </Button>
            </div>
            <p className="text-[10.5px] leading-relaxed text-ink-500">
              Only the scrubbed wire payload is resent. The raw document and vault never leave this
              browser.
            </p>
          </div>
        ) : audit ? (
          <AuditReportView
            audit={audit}
            onNewDocument={onNewDocument}
            letter={letter}
            tone={tone}
            letterBusy={letterBusy}
            onToneChange={onToneChange}
            onCopyLetter={onCopyLetter}
            onDownloadLetter={onDownloadLetter}
            onPrintLetter={onPrintLetter}
            queueCount={queueCount}
            onRetryQueue={onRetryQueue}
            online={online}
          />
        ) : (
          <div className="flex h-full min-h-[420px] flex-col justify-between gap-4">
            <div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <h3 className="text-[12.5px] font-semibold text-ink-100">The approval gate</h3>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">
                  Nothing has left this browser. Approving sends only the exact JSON in Pane 2 —{" "}
                  {formatNumber(wire.sanitizedText.length)} sanitized characters and{" "}
                  {wire.extractedItems.length} extracted items — to Cloud Gemini.
                </p>
                <div className="mt-2.5 space-y-1.5 text-[10.5px] text-ink-400">
                  <div className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                    Zero detected direct identifiers in the payload
                  </div>
                  <div className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                    Structured JSON output, no Google Search Grounding
                  </div>
                  <div className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                    Verified 2026 rule IDs only; unverified citations are dropped
                  </div>
                </div>
              </div>

              {!firebaseEnabled ? (
                <InlineNotice tone="warn" title="Local Demo Mode">
                  Firebase is not configured. “Approve & Run Cloud Audit” will return a clearly
                  labeled cached demo result built from the bundled rule packs. Nothing is sent to
                  Google.
                </InlineNotice>
              ) : null}

              {!online ? (
                <InlineNotice tone="warn" title="You are offline">
                  Airlock will run a local triage on the sanitized payload, queue the audit, and
                  retry automatically when the connection returns.
                </InlineNotice>
              ) : null}
            </div>

            <div className="space-y-2">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={onApprove}
                icon={<Cloud className="h-4 w-4" />}
              >
                {online ? "Approve & Run Cloud Audit" : "Run Local Triage & Queue Audit"}
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={onUseCached}
                  icon={<FlaskConical className="h-3.5 w-3.5" />}
                >
                  Use Cached Demo Result
                </Button>
                {queueCount > 0 ? (
                  <Button
                    variant="blue"
                    size="sm"
                    className="flex-1"
                    onClick={onRetryQueue}
                    disabled={!online}
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                  >
                    Retry Queued Audit ({queueCount})
                  </Button>
                ) : null}
              </div>
              <p className="text-center text-[9.5px] leading-relaxed text-ink-500">
                The cloud never receives your raw text, token map, or letter. Not legal or medical
                advice.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-blue-400/[0.04] px-4 py-2 text-[10px] text-blue-200/80">
        <span className="flex items-center gap-1.5">
          <Lock className="h-3 w-3" /> Rehydration happens locally
        </span>
        <span className="flex items-center gap-1">
          <Sparkles className="h-3 w-3" /> {audit?.cloudInferenceSource ?? "on_device"}
        </span>
      </div>
    </section>
  );
}

export function AirlockXRay(props: AirlockXRayProps) {
  const { stats, audit, auditState } = props;

  return (
    <div className="animate-fade-in space-y-4">
      {/* Clear guided next-step bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/15">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold text-ink-100">
              {auditState === "idle"
                ? `We hid ${stats.entities} personal details on your device — ready to audit?`
                : auditState === "running"
                  ? "Auditing the anonymized document against 2026 rules…"
                  : auditState === "done" && audit
                    ? `Audit complete — ${audit.findings.length} issue(s) found & letter ready`
                    : auditState === "queued"
                      ? "Offline triage done — queued for full cloud audit"
                      : "Cloud audit ran into an issue"}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-300">
              {auditState === "idle"
                ? "Review Pane 2 (Safe to Send). Click any word in Pane 1 to hide more, then approve."
                : `${props.documentLabel} · ${DOCUMENT_TYPE_LABELS[props.wire.documentType]} · ${props.wire.jurisdiction}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {auditState === "idle" ? (
            <Button
              size="md"
              variant="primary"
              onClick={props.onApprove}
              icon={<Cloud className="h-4 w-4" />}
            >
              {props.online ? "Approve & Run Cloud Audit" : "Run Offline Triage"}
            </Button>
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

      <div className="grid gap-3.5 xl:grid-cols-3">
        <LocalPane
          documentLabel={props.documentLabel}
          rawText={props.rawText}
          entities={props.entities}
          wire={props.wire}
          stats={stats}
          manualRedactions={props.manualRedactions}
          modeLabel={props.modeLabel}
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
        <AuditPane
          wire={props.wire}
          audit={audit}
          auditState={props.auditState}
          auditError={props.auditError}
          auditStartedAt={props.auditStartedAt}
          letter={props.letter}
          letterBusy={props.letterBusy}
          tone={props.tone}
          online={props.online}
          firebaseEnabled={props.firebaseEnabled}
          queueCount={props.queueCount}
          onApprove={props.onApprove}
          onUseCached={props.onUseCached}
          onRetry={props.onRetry}
          onRetryQueue={props.onRetryQueue}
          onNewDocument={props.onNewDocument}
          onToneChange={props.onToneChange}
          onCopyLetter={props.onCopyLetter}
          onDownloadLetter={props.onDownloadLetter}
          onPrintLetter={props.onPrintLetter}
        />
      </div>

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-white/[0.04] p-0 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Identifiers scrubbed", value: formatNumber(stats.entities), icon: Fingerprint },
          { label: "Regex catches", value: formatNumber(stats.regexCatches), icon: ShieldCheck },
          { label: "Payload reduction", value: `${stats.payloadReduction}%`, icon: Layers },
          { label: "Wire size", value: formatBytes(stats.wireBytes), icon: ArrowLeftRight },
          { label: "Local latency", value: formatDuration(stats.localLatencyMs), icon: Sparkles },
          {
            label: "Cloud latency",
            value: audit ? formatDuration(audit.latencyMs) : "—",
            icon: Cloud,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-ink-850/90 px-3.5 py-2.5">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-ink-500">
                <Icon className="h-3 w-3" /> {item.label}
              </div>
              <div className="mt-0.5 text-[13px] font-semibold text-ink-100">{item.value}</div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-ink-500">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3 text-emerald-400" />
          Zero detected direct identifiers sent to cloud. Semantic context and quasi-identifiers may
          remain.
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Local vault: session-only · Wipe anytime
        </span>
      </div>
    </div>
  );
}
