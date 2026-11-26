import { ExternalLink, Scale, ShieldCheck } from "lucide-react";
import type { AuditFinding } from "../types";
import { isAllowedCitationUrl } from "../rules/rulePacks2026";
import { Badge } from "./ui";

export function RuleCitations({
  findings,
  rulePackVersion,
}: {
  findings: AuditFinding[];
  rulePackVersion: string;
}) {
  const unique = new Map<string, AuditFinding>();
  for (const finding of findings) {
    if (!finding.matchedRuleId) continue;
    if (!finding.citationUrl || !isAllowedCitationUrl(finding.citationUrl)) continue;
    if (!unique.has(finding.matchedRuleId)) unique.set(finding.matchedRuleId, finding);
  }
  const citations = [...unique.values()];

  return (
    <section aria-labelledby="rule-citations-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3
          id="rule-citations-heading"
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400"
        >
          <Scale className="h-3.5 w-3.5" />
          Verified citations
        </h3>
        <Badge tone="slate">{rulePackVersion || "2026.1"}</Badge>
      </div>

      {citations.length === 0 ? (
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-400">
          No verified citations were attached to these findings. Airlock only renders links that
          resolve to a bundled rule ID and an official government host.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {citations.map((finding) => (
            <li
              key={finding.matchedRuleId}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium leading-snug text-ink-100">
                    {finding.matchedRuleTitle ?? finding.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-400">
                    <span className="mono rounded bg-ink-950/60 px-1 py-0.5 text-[10px] text-ink-300">
                      {finding.matchedRuleId}
                    </span>
                    <span className="truncate">{finding.citation}</span>
                  </div>
                </div>
                {finding.citationUrl ? (
                  <a
                    href={finding.citationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-1 text-[10.5px] font-semibold text-emerald-200 no-underline transition-colors hover:bg-emerald-400/[0.12]"
                  >
                    Official source
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-ink-500">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        Citation allowlist enforced by matched rule ID. Links are restricted to verified official
        <span className="mono"> https: </span> hosts in the bundled 2026 packs.
      </p>
    </section>
  );
}
