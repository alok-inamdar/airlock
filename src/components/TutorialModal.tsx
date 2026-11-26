import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Cloud,
  FileCheck2,
  Lock,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Badge, Button, cx } from "./ui";

export interface TutorialModalProps {
  open: boolean;
  onClose: () => void;
  onTryDemo: () => void;
}

const STEPS = [
  {
    eyebrow: "Step 1 of 4 · The Problem",
    title: "Why not paste private documents into regular AI?",
    subtitle:
      "Medical bills, leases, and severance agreements contain your SSN, address, salary, and diagnoses. Airlock lets you get expert-level AI auditing without giving away your identity.",
  },
  {
    eyebrow: "Step 2 of 4 · Local Privacy Scrub",
    title: "Your personal info is hidden right inside your browser",
    subtitle:
      "Before anything touches the internet, Airlock scans your document locally and swaps names, SSNs, addresses, and account numbers with safe placeholders.",
  },
  {
    eyebrow: "Step 3 of 4 · You Approve What Leaves",
    title: "Only the anonymized text is audited in the cloud",
    subtitle:
      "You inspect the exact scrubbed document before clicking Approve. Cloud Gemini checks the clauses or billing codes against verified 2026 California, NYC, and CMS rules.",
  },
  {
    eyebrow: "Step 4 of 4 · Ready-to-Send Letter",
    title: "Your real details come back locally—never in the cloud",
    subtitle:
      "Airlock puts your real names and account details back into the dispute letter inside your browser, ready to copy, download, or print. Wipe the local vault anytime.",
  },
] as const;

export function TutorialModal({ open, onClose, onTryDemo }: TutorialModalProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setStep((s) => Math.min(STEPS.length - 1, s + 1));
      if (event.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="panel w-full max-w-2xl overflow-hidden border-white/15 bg-ink-900 shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-400/10">
              <BookOpen className="h-3.5 w-3.5 text-emerald-300" />
            </span>
            <span className="text-[12.5px] font-semibold text-ink-100">
              How Airlock Works
            </span>
          </div>
          <div className="flex items-center gap-1.5" aria-label="Tutorial progress">
            {STEPS.map((item, index) => (
              <button
                key={item.eyebrow}
                type="button"
                onClick={() => setStep(index)}
                aria-label={`Go to step ${index + 1}`}
                className={cx(
                  "h-1.5 rounded-full transition-all",
                  index === step
                    ? "w-7 bg-emerald-400"
                    : index < step
                      ? "w-3 bg-emerald-400/40"
                      : "w-3 bg-white/15 hover:bg-white/25"
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tutorial"
            className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-white/[0.06] hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
              {current.eyebrow}
            </div>
            <h2
              id="tutorial-title"
              className="mt-1.5 text-[21px] font-semibold leading-snug text-ink-100"
            >
              {current.title}
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-300">
              {current.subtitle}
            </p>
          </div>

          {/* Visual diagram per step */}
          {step === 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-4">
                <div className="text-[12px] font-semibold text-rose-200">
                  Ordinary Cloud AI
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-300">
                  You paste your full ER bill or lease. Your name, SSN, address, and diagnosis are
                  sent straight to remote servers.
                </p>
              </div>
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-200">
                  <ShieldCheck className="h-4 w-4" /> Airlock Hybrid Privacy
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-300">
                  Personal details stay locked in your browser. Only anonymous billing codes or
                  clauses go to Cloud Gemini for rule checking.
                </p>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-ink-950/60 p-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-ink-400">
                  <span className="flex items-center gap-1">
                    <Lock className="h-3 w-3 text-emerald-300" /> Stays in your browser
                  </span>
                </div>
                <div className="space-y-1.5 text-[12px] text-ink-200">
                  <div>
                    Patient:{" "}
                    <span className="rounded bg-violet-400/20 px-1.5 py-0.5 text-violet-100">
                      Rohan Sharma
                    </span>
                  </div>
                  <div>
                    SSN:{" "}
                    <span className="rounded bg-rose-400/20 px-1.5 py-0.5 text-rose-100">
                      000-00-0000
                    </span>
                  </div>
                  <div>Charge: CPT 99284 — $1,450 (×2)</div>
                </div>
              </div>
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-amber-200">
                  <span>Anonymized version</span>
                  <Badge tone="green">0 bytes sent yet</Badge>
                </div>
                <div className="space-y-1.5 text-[12px] text-ink-200">
                  <div>
                    Patient: <span className="mono text-amber-200">[PERSON_1]</span>
                  </div>
                  <div>
                    SSN: <span className="mono text-amber-200">[REDACTED_REGEX_1]</span>
                  </div>
                  <div>Charge: CPT 99284 — $1,450 (×2)</div>
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="rounded-xl border border-blue-400/20 bg-blue-400/[0.05] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-200">
                  <Cloud className="h-4 w-4" /> Verified 2026 Rule Packs
                </span>
                <Badge tone="blue">Human Approval Gate</Badge>
              </div>
              <ul className="mt-3 space-y-2 text-[12.5px] text-ink-200">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <span>
                    You inspect the scrubbed text and can even click any extra word to hide it
                    before approving.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <span>
                    Cloud Gemini flags duplicate CPT codes, illegal security deposits (CA AB 12,
                    NYC), and unenforceable non-competes—linking only to official government URLs.
                  </span>
                </li>
              </ul>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-emerald-200">
                <FileCheck2 className="h-4 w-4" /> Personalized Dispute Letter
              </div>
              <p className="mt-2 rounded-lg bg-ink-950/60 p-3 text-[12px] leading-relaxed text-ink-200">
                “Dear <span className="text-emerald-200">Metro General Hospital</span>, I am writing
                to formally dispute the duplicate <span className="mono">CPT 99284</span> charge
                ($1,450) on my statement… Sincerely,{" "}
                <span className="text-emerald-200">Rohan Sharma</span>.”
              </p>
              <p className="mt-2.5 text-[11.5px] text-ink-400">
                Choose Formal, Collaborative, or Escalation tone, then copy, download, or print.
              </p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-ink-950/50 px-5 py-3.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
            icon={step > 0 ? <ArrowLeft className="h-3.5 w-3.5" /> : undefined}
          >
            {step === 0 ? "Skip tour" : "Back"}
          </Button>

          <div className="flex items-center gap-2">
            {isLast ? (
              <>
                <Button size="sm" variant="secondary" onClick={onClose}>
                  Close
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onClose();
                    onTryDemo();
                  }}
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                >
                  Try ER Bill Demo Now
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => setStep((s) => s + 1)}
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
