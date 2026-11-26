import { useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Briefcase,
  Check,
  FlaskConical,
  Home,
  Lock,
  Play,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Upload,
  X,
} from "lucide-react";
import type { NanoStatus } from "../ai/capabilities";
import type { DocumentInput, DocumentType } from "../types";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, JURISDICTIONS } from "../types";
import { SAMPLES, type SampleDocument } from "../samples";
import { formatNumber } from "../lib/format";
import { Badge, Button, Card, InlineNotice, Spinner, cx } from "./ui";

const TYPE_ICON: Record<DocumentType, typeof Stethoscope> = {
  medical_bill: Stethoscope,
  residential_lease: Home,
  employment_contract: Briefcase,
};

const ACCENT: Record<SampleDocument["accent"], { ring: string; icon: string }> = {
  medical: {
    ring: "border-emerald-400/20 hover:border-emerald-400/45",
    icon: "bg-emerald-400/10 text-emerald-300 border-emerald-400/20",
  },
  lease: {
    ring: "border-blue-400/20 hover:border-blue-400/45",
    icon: "bg-blue-400/10 text-blue-300 border-blue-400/20",
  },
  employment: {
    ring: "border-violet-400/20 hover:border-violet-400/45",
    icon: "bg-violet-400/10 text-violet-300 border-violet-400/20",
  },
  adversarial: {
    ring: "border-amber-400/20 hover:border-amber-400/45",
    icon: "bg-amber-400/10 text-amber-300 border-amber-400/20",
  },
};

const MAX_INPUT_CHARS = 200_000;

export interface DocumentIngestProps {
  busy: boolean;
  effectiveSimulation: boolean;
  nanoStatus: NanoStatus;
  initial?: DocumentInput | null;
  onScrub: (input: DocumentInput) => void;
  onOpenTutorial: () => void;
}

export function DocumentIngest({
  busy,
  effectiveSimulation,
  nanoStatus,
  initial,
  onScrub,
  onOpenTutorial,
}: DocumentIngestProps) {
  const [text, setText] = useState(initial?.text ?? "");
  const [documentType, setDocumentType] = useState<DocumentType>(
    initial?.documentType ?? "medical_bill"
  );
  const [jurisdiction, setJurisdiction] = useState<DocumentInput["jurisdiction"]>(
    initial?.jurisdiction ?? (JURISDICTIONS[0].value as DocumentInput["jurisdiction"])
  );
  const [selectedSample, setSelectedSample] = useState<string | null>(
    initial?.sampleId ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNotice, setPdfNotice] = useState<{
    tone: "warn" | "error" | "info";
    text: string;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const docLabel =
    SAMPLES.find((sample) => sample.id === selectedSample)?.label ??
    `${DOCUMENT_TYPE_LABELS[documentType]} — pasted document`;
  const jurisdictionOptions =
    documentType === "employment_contract"
      ? JURISDICTIONS.filter((option) => option.value === "California, US")
      : JURISDICTIONS;

  function loadSample(sample: SampleDocument, runImmediately = false) {
    setText(sample.text);
    setDocumentType(sample.documentType);
    setJurisdiction(sample.jurisdiction);
    setSelectedSample(sample.id);
    setError(null);
    setPdfNotice(null);
    if (runImmediately) {
      onScrub({
        text: sample.text,
        documentType: sample.documentType,
        jurisdiction: sample.jurisdiction,
        label: sample.label,
        sampleId: sample.id,
      });
    } else {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleTextChange(value: string) {
    setText(value);
    setSelectedSample(null);
    setError(null);
  }

  async function handleFile(file: File) {
    setError(null);
    setPdfNotice(null);

    if (!/\.pdf$/i.test(file.name)) {
      if (/\.(txt|md|csv)$/i.test(file.name)) {
        try {
          const content = await file.text();
          setText(content.slice(0, MAX_INPUT_CHARS));
          setSelectedSample(null);
          setPdfNotice({
            tone: "info",
            text: `${file.name} loaded locally (${formatNumber(content.length)} characters).`,
          });
        } catch {
          setPdfNotice({ tone: "error", text: "Could not read that text file." });
        }
        return;
      }
      setPdfNotice({ tone: "error", text: "Upload a PDF, TXT, MD, or CSV file." });
      return;
    }

    setPdfBusy(true);
    try {
      const { parsePdfFile } = await import("../vault/pdfParser");
      const result = await parsePdfFile(file);
      if (result.scanned) {
        setPdfNotice({
          tone: "warn",
          text:
            "This looks like a scanned or image-only PDF, so no text could be extracted. Paste the text or try a sample instead.",
        });
        return;
      }
      setText(result.text.slice(0, MAX_INPUT_CHARS));
      setSelectedSample(null);
      if (result.warnings.length > 0) {
        setPdfNotice({ tone: "warn", text: result.warnings.join(" ") });
      } else {
        setPdfNotice({
          tone: "info",
          text: `${file.name} parsed locally — ${result.pagesProcessed} page(s), ${formatNumber(result.text.length)} characters.`,
        });
      }
    } catch (parseError) {
      setPdfNotice({
        tone: "error",
        text: parseError instanceof Error ? parseError.message : "Could not parse that PDF.",
      });
    } finally {
      setPdfBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function submit() {
    const trimmed = text.trim();
    if (trimmed.length < 40) {
      setError("Paste at least a few lines of a document (40+ characters), or pick a sample above.");
      return;
    }
    if (trimmed.length > MAX_INPUT_CHARS) {
      setError(`Documents are limited to ${formatNumber(MAX_INPUT_CHARS)} characters.`);
      return;
    }
    setError(null);
    onScrub({
      text,
      documentType,
      jurisdiction,
      label: docLabel,
      ...(selectedSample ? { sampleId: selectedSample } : {}),
    });
  }

  const longDocument = text.length > 30_000;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-emerald-400/[0.06] via-ink-850/90 to-blue-400/[0.05] px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-balance text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink-100 sm:text-[32px]">
              Audit medical bills, leases &amp; contracts{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-blue-300 bg-clip-text text-transparent">
                without exposing your private info.
              </span>
            </h1>
            <p className="mt-2.5 text-[14px] leading-relaxed text-ink-300">
              Airlock hides your name, SSN, and address right in your browser before Cloud AI checks
              the document against 2026 rules—then puts your details back locally into a
              ready-to-send dispute letter.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              size="lg"
              variant="secondary"
              onClick={onOpenTutorial}
              icon={<BookOpen className="h-4 w-4 text-emerald-300" />}
            >
              How It Works (60s Tour)
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="quick-demos-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="quick-demos-heading" className="text-[15px] font-semibold text-ink-100">
              Try a sample in one click
            </h2>
            <p className="mt-0.5 text-[12.5px] text-ink-400">
              Pick a realistic fictional document with built-in billing or legal issues to see
              Airlock in action.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SAMPLES.map((sample) => {
            const accent = ACCENT[sample.accent];
            const Icon = TYPE_ICON[sample.documentType];
            const active = selectedSample === sample.id;
            return (
              <div
                key={sample.id}
                className={cx(
                  "group flex flex-col justify-between gap-3 rounded-2xl border bg-ink-850/75 p-4 transition-all",
                  accent.ring,
                  active && "border-emerald-400/50 bg-emerald-400/[0.06]"
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cx(
                        "flex h-9 w-9 items-center justify-center rounded-xl border",
                        accent.icon
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    {sample.adversarial ? (
                      <Badge tone="amber">
                        <FlaskConical className="h-3 w-3" /> Security test
                      </Badge>
                    ) : active ? (
                      <Badge tone="green">
                        <Check className="h-3 w-3" /> Loaded
                      </Badge>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-[13.5px] font-semibold leading-snug text-ink-100">
                    {sample.title}
                  </h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
                    {sample.subtitle}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="primary"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => loadSample(sample, true)}
                    icon={<Play className="h-3.5 w-3.5" />}
                  >
                    Run Sample
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => loadSample(sample, false)}
                  >
                    Inspect
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Card className="p-5 sm:p-6">
        <div ref={formRef} className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-100">
                Or use your own document
              </h2>
              <p className="mt-0.5 text-[12.5px] text-ink-400">
                Paste text or drop a PDF. Everything stays on your device until you review and
                approve.
              </p>
            </div>
            <Badge tone={effectiveSimulation ? "amber" : "green"}>
              {effectiveSimulation ? (
                <>
                  <FlaskConical className="h-3 w-3" /> Local browser scrubber
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" /> Gemini Nano on-device
                </>
              )}
            </Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <span className="label">1. What kind of document is this?</span>
              <div className="grid grid-cols-3 gap-1.5">
                {DOCUMENT_TYPES.map((type) => {
                  const Icon = TYPE_ICON[type];
                  const active = documentType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setDocumentType(type);
                        setSelectedSample(null);
                        if (type === "employment_contract" && jurisdiction !== "California, US") {
                          setJurisdiction("California, US");
                        }
                      }}
                      aria-pressed={active}
                      className={cx(
                        "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[12px] font-medium transition-colors",
                        active
                          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                          : "border-white/10 bg-white/[0.02] text-ink-300 hover:bg-white/[0.05]"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{DOCUMENT_TYPE_LABELS[type]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="jurisdiction">
                2. Which state or city rules apply?
              </label>
              <select
                id="jurisdiction"
                className="field"
                value={jurisdiction}
                onChange={(event) => {
                  setJurisdiction(event.target.value as DocumentInput["jurisdiction"]);
                  setSelectedSample(null);
                }}
              >
                {jurisdictionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="label">3. Upload a file (optional)</span>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                className={cx(
                  "flex h-[40px] items-center justify-between gap-2 rounded-xl border border-dashed px-3 text-[12px] transition-colors",
                  dragActive
                    ? "border-emerald-400/50 bg-emerald-400/[0.07] text-emerald-200"
                    : "border-white/[0.15] bg-white/[0.02] text-ink-400"
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {pdfBusy ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">
                    {pdfBusy ? "Reading PDF locally…" : "Drop PDF or TXT (≤15 pages)"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 rounded-md px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-400/10"
                  disabled={pdfBusy}
                >
                  Browse
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,.csv,application/pdf,text/plain"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <label className="label mb-0" htmlFor="document-text">
                Document text
              </label>
              <span className="text-[11px] text-ink-500">
                {formatNumber(text.length)} chars · {text.split(/\s+/).filter(Boolean).length} words
              </span>
            </div>
            <textarea
              id="document-text"
              value={text}
              onChange={(event) => handleTextChange(event.target.value)}
              rows={9}
              spellCheck={false}
              placeholder="Paste your medical bill, lease, or severance agreement here—or click 'Run Sample' on any card above."
              className="field mono min-h-[180px] resize-y text-[12.5px] leading-relaxed"
            />
            {longDocument ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-amber-300/90">
                <AlertTriangle className="h-3.5 w-3.5" />
                Long document: only the first 20 chunks (~32k characters) are analyzed.
              </p>
            ) : null}
          </div>

          {pdfNotice ? (
            <InlineNotice
              tone={
                pdfNotice.tone === "info"
                  ? "info"
                  : pdfNotice.tone === "warn"
                    ? "warn"
                    : "error"
              }
            >
              {pdfNotice.text}
            </InlineNotice>
          ) : null}

          {error ? (
            <InlineNotice tone="error">
              <span className="flex items-start gap-1.5">
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </span>
            </InlineNotice>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <Button
              variant="primary"
              size="lg"
              onClick={submit}
              loading={busy}
              icon={<ShieldCheck className="h-4 w-4" />}
              className="flex-1 sm:flex-none"
            >
              Hide Personal Info Locally
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                setText("");
                setSelectedSample(null);
                setPdfNotice(null);
                setError(null);
              }}
              icon={<X className="h-4 w-4" />}
              disabled={busy || (!text && !pdfNotice)}
            >
              Clear
            </Button>
            <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-400">
              <Lock className="h-3.5 w-3.5 text-emerald-300" />
              {nanoStatus === "available" && !effectiveSimulation
                ? "Scrubbed on-device by Gemini Nano · 0 bytes sent"
                : "Scrubbed locally in your browser · 0 bytes sent"}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
