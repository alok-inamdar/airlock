import { Download, FileCheck2, Lock, Printer, Sparkles } from "lucide-react";
import type { LetterState, Tone } from "../types";
import { TONES } from "../types";
import { Badge, Button, InlineNotice, Spinner, cx } from "./ui";

export interface RehydratedLetterProps {
  letter: LetterState | null;
  tone: Tone;
  busy: boolean;
  onToneChange: (tone: Tone) => void;
  onCopy: () => void;
  onDownload: () => void;
  onPrint: () => void;
}

export function RehydratedLetter({
  letter,
  tone,
  busy,
  onToneChange,
  onCopy,
  onDownload,
  onPrint,
}: RehydratedLetterProps) {
  return (
    <section aria-labelledby="letter-heading" className="rounded-xl border border-blue-400/[0.15] bg-blue-400/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3.5 py-3">
        <div>
          <h3
            id="letter-heading"
            className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-100"
          >
            <FileCheck2 className="h-3.5 w-3.5 text-blue-300" />
            Ready-to-send letter
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-400">
            <Lock className="h-3 w-3" />
            Tokens rehydrated locally from the vault
            {letter?.polished ? (
              <span className="ml-1 inline-flex items-center gap-1 text-emerald-300">
                <Sparkles className="h-3 w-3" /> Nano-polished
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCopy}
            disabled={!letter || busy}
            aria-label="Copy letter"
          >
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDownload}
            disabled={!letter || busy}
            aria-label="Download letter"
            icon={<Download className="h-3.5 w-3.5" />}
          >
            Download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onPrint}
            disabled={!letter || busy}
            aria-label="Print letter"
            icon={<Printer className="h-3.5 w-3.5" />}
          >
            Print
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-3.5">
        <div>
          <span className="label">Tone</span>
          <div className="grid grid-cols-3 gap-1.5">
            {TONES.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.description}
                onClick={() => onToneChange(option.value)}
                aria-pressed={tone === option.value}
                className={cx(
                  "rounded-lg border px-2 py-1.5 text-[10.5px] font-semibold transition-colors",
                  tone === option.value
                    ? "border-blue-400/40 bg-blue-400/10 text-blue-100"
                    : "border-white/10 bg-white/[0.02] text-ink-300 hover:bg-white/[0.05]"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {busy ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-ink-950/50 px-3 py-2.5 text-[11.5px] text-ink-300">
            <Spinner className="h-3.5 w-3.5" />
            Rebuilding the letter and attempting a local Nano tone polish…
          </div>
        ) : null}

        {letter ? (
          <>
            <div className="max-h-[430px] overflow-y-auto rounded-xl border border-white/[0.06] bg-ink-950/70 p-4">
              <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-ink-200">
                {letter.final}
              </pre>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="green">
                <Lock className="h-3 w-3" /> {letter.tokenized.match(/\[[A-Z][A-Z0-9_]*_\d+\]/g)?.length ?? 0} tokens
              </Badge>
              <Badge tone={letter.polished ? "green" : "slate"}>
                {letter.polished ? "Local polish applied" : "Deterministic draft"}
              </Badge>
              <Badge tone="slate">{letter.final.length.toLocaleString()} chars</Badge>
            </div>

            {letter.warnings.length > 0 ? (
              <InlineNotice tone="warn" title="Rehydration notes">
                <ul className="list-inside list-disc space-y-0.5">
                  {letter.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </InlineNotice>
            ) : null}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[11.5px] text-ink-400">
            The letter appears after the audit and local rehydration.
          </p>
        )}

        <p className="text-[10.5px] leading-relaxed text-ink-500">
          <span className="font-semibold text-ink-400">Not legal or medical advice.</span> Airlock is
          a document-review tool, not a law firm or provider. Verify every citation and figure before
          sending. Sending a letter does not create an attorney-client relationship.
        </p>
      </div>
    </section>
  );
}
