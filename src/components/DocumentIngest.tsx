import { useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Check,
  FileText,
  FlaskConical,
  Home,
  Lock,
  ScanLine,
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

const ACCENT: Record<SampleDocument["accent"], { ring: string; icon: string; glow: string }> = {
  medical: {
    ring: "border-emerald-400/20 hover:border-emerald-400/40",
    icon: "bg-emerald-400/10 text-emerald-300 border-emerald-400/20",
    glow: "group-hover:shadow-[0_0_40px_-20px_rgba(16,185,129,0.7)]",
  },
  lease: {
    ring: "border-blue-400/20 hover:border-blue-400/40",
    icon: "bg-blue-400/10 text-blue-300 border-blue-400/20",
    glow: "group-hover:shadow-[0_0_40px_-20px_rgba(59,130,246,0.7)]",
  },
  employment: {
    ring: "border-violet-400/20 hover:border-violet-400/40",
    icon: "bg-violet-400/10 text-violet-300 border-violet-400/20",
    glow: "group-hover:shadow-[0_0_40px_-20px_rgba(139,92,246,0.7)]",
  },
  adversarial: {
    ring: "border-amber-400/20 hover:border-amber-400/40",
    icon: "bg-amber-400/10 text-amber-300 border-amber-400/20",
    glow: "group-hover:shadow-[0_0_40px_-20px_rgba(245,158,11,0.7)]",
  },
};

const MAX_INPUT_CHARS = 200_000;

export interface DocumentIngestProps {
  busy: boolean;
  effectiveSimulation: boolean;
  nanoStatus: NanoStatus;
  initial?: DocumentInput | null;
  onScrub: (input: DocumentInput) => void;
}

export function DocumentIngest({
  busy,
  effectiveSimulation,
  nanoStatus,
  initial,
  onScrub,
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
  const [pdfNotice, setPdfNotice] = useState<{ tone: "warn" | "error" | "info"; text: string } | null>(
    null
  );
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

  function loadSample(sample: SampleDocument) {
    setText(sample.text);
    setDocumentType(sample.documentType);
    setJurisdiction(sample.jurisdiction);
    setSelectedSample(sample.id);
    setError(null);
    setPdfNotice(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          setPdfNotice({ tone: "info", text: `${file.name} loaded locally (${formatNumber(content.length)} characters).` });
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
            "This looks like a scanned or image-only PDF, so no text could be extracted. Paste the text or load a demo pack instead.",
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
      setError("Paste at least a few lines of the document (40+ characters), or load a demo pack.");
      return;
    }
    if (trimmed.length > MAX_INPUT_CHARS) {
      setError(`Documents are limited to ${formatNumber(MAX_INPUT_CHARS)} characters in this build.`);
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
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-12">
        <section className="flex flex-col justify-between gap-6 xl:col-span-5">
          <div>
            <Badge tone="green" className="mb-4">
              <Sparkles className="h-3 w-3" />
              Firebase AI Logic · Hybrid Inference
            </Badge>
            <h1 className="text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink-100 sm:text-[36px]">
              Redact locally.
              <br />
              Audit in the cloud.
              <br />
              <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-blue-300 bg-clip-text text-transparent">
                Rehydrate on-device.
              </span>
            </h1>
            <p className="mt-4 max-w-lg text-pretty text-[13.5px] leading-relaxed text-ink-300">
              A reversible semantic privacy firewall for high-stakes documents. Gemini Nano scrubs
              direct identifiers on your device; Cloud Gemini reads only the stripped wire payload
              against verified 2026 rule packs. The names come back locally.
            </p>
          </div>

          <div className="space-y-2.5">
            {[
              {
                icon: Lock,
                title: "Local scrub first",
                body: "Raw text never enters a network request. A regex firewall runs again at the boundary.",
                tone: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
              },
              {
                icon: CloudOffIcon,
                title: "Wire payload only",
                body: "The cloud sees tokens such as [PERSON_1] plus document type, jurisdiction, and line items.",
                tone: "text-amber-300 bg-amber-400/10 border-amber-400/20",
              },
              {
                icon: ShieldCheck,
                title: "Reversible by design",
                body: "Validated tokens rehydrate longest-first from a vault that stays in this browser.",
                tone: "text-blue-300 bg-blue-400/10 border-blue-400/20",
              },
            ].map((step, index) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
                >
                  <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", step.tone)}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold tracking-[0.14em] text-ink-500">
                        0{index + 1}
                      </span>
                      <h3 className="text-[12.5px] font-semibold text-ink-100">{step.title}</h3>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-400">{step.body}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] leading-relaxed text-ink-500">
            Airlock is not legal or medical advice. Free-tier Gemini API requests may be used by
            Google to improve products.
          </p>
        </section>

        <Card className="p-4 sm:p-5 xl:col-span-7" >
          <div ref={formRef} className="scroll-mt-24">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-semibold text-ink-100">Ingest a document</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-400">
                  Paste text, drop a text-based PDF, or start from a demo pack.
                </p>
              </div>
              <Badge tone={effectiveSimulation ? "amber" : "green"}>
                {effectiveSimulation ? (
                  <>
                    <FlaskConical className="h-3 w-3" /> Simulation scrub
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" /> Nano on-device
                  </>
                )}
              </Badge>
            </div>

            <div className="space-y-3.5">
              <div>
                <span className="label">Document type</span>
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
                          "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[11.5px] font-medium transition-colors",
                          active
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                            : "border-white/10 bg-white/[0.02] text-ink-300 hover:bg-white/[0.05]"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        <span className="truncate">{DOCUMENT_TYPE_LABELS[type]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="jurisdiction">
                    Jurisdiction
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
                  {documentType === "employment_contract" ? (
                    <p className="mt-1 text-[10px] text-ink-500">
                      Bundled employment rules cover California only.
                    </p>
                  ) : null}
                </div>
                <div>
                  <span className="label">Local parsing</span>
                  <div
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={onDrop}
                    className={cx(
                      "flex h-[38px] items-center justify-between gap-2 rounded-xl border border-dashed px-2.5 text-[11.5px] transition-colors",
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
                        {pdfBusy ? "Parsing PDF…" : "Drop PDF or TXT (≤15 pages)"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-400/10"
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
                  <span className="text-[10.5px] text-ink-500">
                    {formatNumber(text.length)} chars · {text.split(/\s+/).filter(Boolean).length} words
                  </span>
                </div>
                <textarea
                  id="document-text"
                  value={text}
                  onChange={(event) => handleTextChange(event.target.value)}
                  rows={11}
                  spellCheck={false}
                  placeholder="Paste a medical bill, lease, or employment agreement here. Nothing leaves this tab until you approve the wire payload."
                  className="field mono min-h-[200px] resize-y text-[12px] leading-relaxed"
                />
                {longDocument ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-300/90">
                    <AlertTriangle className="h-3 w-3" />
                    Long document: only the first 20 chunks (~32k characters) are analyzed.
                  </p>
                ) : null}
              </div>

              {pdfNotice ? (
                <InlineNotice tone={pdfNotice.tone === "info" ? "info" : pdfNotice.tone === "warn" ? "warn" : "error"}>
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

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={submit}
                  loading={busy}
                  icon={<ShieldCheck className="h-4 w-4" />}
                  className="flex-1 sm:flex-none"
                >
                  Scrub Locally
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
                <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-ink-500 sm:flex">
                  <Lock className="h-3 w-3" />
                  Stage 1 sends 0 document bytes
                </span>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-ink-950/50 px-3 py-2 text-[11px] text-ink-400">
                <ScanLine className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
                <span>
                  {nanoStatus === "available" && !effectiveSimulation
                    ? "Gemini Nano will extract names, addresses, and roles on-device."
                    : "Simulation Mode uses deterministic regex + heuristics. Structured IDs are covered; semantic coverage is weaker."}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[13.5px] font-semibold text-ink-100">Demo packs</h2>
            <p className="mt-0.5 text-[11.5px] text-ink-400">
              Fictional documents with planted traps. The fourth is a deliberate red-team sample.
            </p>
          </div>
          <Badge tone="slate">
            <FileText className="h-3 w-3" /> 4 samples
          </Badge>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {SAMPLES.map((sample) => {
            const accent = ACCENT[sample.accent];
            const Icon = TYPE_ICON[sample.documentType];
            const active = selectedSample === sample.id;
            return (
              <button
                key={sample.id}
                type="button"
                onClick={() => loadSample(sample)}
                className={cx(
                  "group flex flex-col items-start gap-2.5 rounded-xl border bg-white/[0.02] p-3.5 text-left transition-all",
                  accent.ring,
                  accent.glow,
                  active && "border-emerald-400/50 bg-emerald-400/[0.06]"
                )}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <span className={cx("flex h-8 w-8 items-center justify-center rounded-lg border", accent.icon)}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  {sample.adversarial ? (
                    <Badge tone="amber">
                      <FlaskConical className="h-3 w-3" /> Adversarial test
                    </Badge>
                  ) : active ? (
                    <Check className="h-4 w-4 text-emerald-300" />
                  ) : null}
                </div>
                <div>
                  <div className="text-[12.5px] font-semibold leading-snug text-ink-100">
                    {sample.title}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-400">{sample.subtitle}</div>
                </div>
                <div className="mt-auto flex items-center gap-1 text-[10.5px] font-medium text-ink-500">
                  <span>{sample.badge}</span>
                  <ArrowRight className="ml-auto h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function CloudOffIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18.5 17.5H6a4 4 0 0 1-.4-7.98A6 6 0 0 1 17 8.5a4.5 4.5 0 0 1 1.5 9z" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
