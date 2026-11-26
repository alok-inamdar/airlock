/** Hand-rolled UI primitives: no shadcn CLI, no external assets. */

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { AlertTriangle, Check, Info, Loader2, X } from "lucide-react";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "amber" | "blue";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border border-emerald-400/50 bg-emerald-500 text-ink-950 hover:bg-emerald-400 active:bg-emerald-500 shadow-[0_10px_30px_-16px_rgba(16,185,129,0.9)] disabled:hover:bg-emerald-500",
  secondary:
    "border border-white/10 bg-white/[0.04] text-ink-100 hover:bg-white/[0.08] active:bg-white/[0.06]",
  ghost: "border border-transparent text-ink-300 hover:bg-white/[0.06] hover:text-ink-100",
  danger:
    "border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 active:bg-rose-500/[0.15]",
  amber:
    "border border-amber-400/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 active:bg-amber-500/[0.15]",
  blue: "border border-blue-400/30 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20 active:bg-blue-500/[0.15]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-[12px]",
  md: "h-10 gap-2 rounded-xl px-3.5 text-[13px]",
  lg: "h-12 gap-2.5 rounded-xl px-5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  iconRight,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex select-none items-center justify-center font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

type BadgeTone = "green" | "amber" | "blue" | "red" | "slate" | "violet";

const BADGE_TONES: Record<BadgeTone, string> = {
  green: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  amber: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  blue: "border-blue-400/25 bg-blue-400/10 text-blue-200",
  red: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  slate: "border-white/10 bg-white/[0.04] text-ink-300",
  violet: "border-violet-400/25 bg-violet-400/10 text-violet-200",
};

export function Badge({
  tone = "slate",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]",
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx("panel", className)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cx("h-4 w-4 animate-spin text-emerald-300", className)}
      aria-hidden
    />
  );
}

export function ProgressBar({
  value,
  tone = "green",
  className,
}: {
  value: number;
  tone?: "green" | "amber" | "blue";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const bar =
    tone === "amber"
      ? "bg-amber-400"
      : tone === "blue"
        ? "bg-blue-400"
        : "bg-emerald-400";
  return (
    <div
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-300", bar)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;

function renderJsonLine(line: string, lineIndex: number): ReactNode {
  JSON_TOKEN.lastIndex = 0;
  const output: ReactNode[] = [];
  let cursor = 0;
  let match = JSON_TOKEN.exec(line);
  let key = 0;
  while (match) {
    if (match.index > cursor) {
      output.push(
        <span key={`text-${lineIndex}-${key}`} className="text-ink-300">
          {line.slice(cursor, match.index)}
        </span>
      );
      key += 1;
    }
    if (match[1]) {
      const isKey = Boolean(match[2]);
      output.push(
        <span
          key={`str-${lineIndex}-${key}`}
          className={isKey ? "text-emerald-300" : "text-amber-200"}
        >
          {match[1]}
          {match[2] ?? ""}
        </span>
      );
    } else if (match[3]) {
      output.push(
        <span key={`lit-${lineIndex}-${key}`} className="text-violet-300">
          {match[3]}
        </span>
      );
    } else if (match[4]) {
      output.push(
        <span key={`num-${lineIndex}-${key}`} className="text-blue-300">
          {match[4]}
        </span>
      );
    }
    key += 1;
    cursor = match.index + match[0].length;
    match = JSON_TOKEN.exec(line);
  }
  if (cursor < line.length) {
    output.push(
      <span key={`tail-${lineIndex}`} className="text-ink-300">
        {line.slice(cursor)}
      </span>
    );
  }
  return output.length > 0 ? output : <span> </span>;
}

export function JsonView({
  value,
  className,
  ariaLabel = "JSON payload",
}: {
  value: unknown;
  className?: string;
  ariaLabel?: string;
}) {
  const json =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const lines = json.split("\n");
  return (
    <pre
      aria-label={ariaLabel}
      className={cx(
        "mono overflow-x-auto whitespace-pre rounded-xl border border-white/[0.06] bg-ink-950/70 p-3.5",
        className
      )}
    >
      {lines.map((line, index) => (
        <div key={index} className="min-h-[1.35em]">
          {renderJsonLine(line, index)}
        </div>
      ))}
    </pre>
  );
}

export function InlineNotice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "error" | "success";
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    info: "border-blue-400/20 bg-blue-400/[0.06] text-blue-100",
    warn: "border-amber-400/25 bg-amber-400/[0.07] text-amber-100",
    error: "border-rose-400/25 bg-rose-400/[0.07] text-rose-100",
    success: "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100",
  }[tone];
  const Icon = tone === "error" || tone === "warn" ? AlertTriangle : tone === "success" ? Check : Info;
  return (
    <div className={cx("rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed", styles)}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
        <div className="min-w-0 flex-1">
          {title ? <div className="mb-0.5 font-semibold">{title}</div> : null}
          <div className="opacity-90 [&_a]:text-current [&_a]:underline">{children}</div>
          {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ButtonVariant;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-ink-950/80 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md animate-fade-in rounded-2xl border border-white/10 bg-ink-850 p-5 shadow-2xl"
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-[15px] font-semibold text-ink-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-ink-400 transition-colors hover:bg-white/[0.06] hover:text-ink-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="text-[13px] leading-relaxed text-ink-300">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={tone} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface ToastMessage {
  id: string;
  tone: "success" | "error" | "info";
  message: string;
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
      {toasts.map((toast) => {
        const tone =
          toast.tone === "success"
            ? "border-emerald-400/30 bg-ink-850 text-emerald-100"
            : toast.tone === "error"
              ? "border-rose-400/30 bg-ink-850 text-rose-100"
              : "border-blue-400/30 bg-ink-850 text-blue-100";
        const Icon = toast.tone === "success" ? Check : toast.tone === "error" ? AlertTriangle : Info;
        return (
          <div
            key={toast.id}
            className={cx(
              "pointer-events-auto flex animate-fade-in items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px] shadow-2xl",
              tone
            )}
            role="status"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="flex-1 leading-relaxed">{toast.message}</div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
