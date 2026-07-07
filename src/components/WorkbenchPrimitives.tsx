import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LogEvent } from "../types";

type ButtonVariant = "primary" | "secondary" | "ghost";
type BadgeTone = "lime" | "cyan" | "amber" | "danger" | "steel";
type StepStatus = "idle" | "active" | "done" | "error";

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-65 focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]",
        variant === "primary" && "border border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-strong)]",
        variant === "secondary" &&
          "border border-[var(--line-strong)] bg-white text-[var(--ink)] hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)]",
        variant === "ghost" && "border border-transparent text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--accent)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "steel",
}: {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
}) {
  const styles = {
    lime: "border-[var(--line-strong)] bg-[var(--panel-2)] text-[var(--primary-strong)]",
    cyan: "border-[var(--primary)] bg-[var(--primary)] text-white",
    amber: "border-[var(--warning)] bg-[var(--panel-2)] text-[var(--ink)]",
    danger: "border-[var(--danger)] bg-[var(--panel-2)] text-[var(--danger)]",
    steel: "border-[var(--line)] bg-[var(--panel-2)] text-[var(--charcoal)]",
  } satisfies Record<BadgeTone, string>;

  return (
    <span className={cn("inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded border px-3 text-[11px] font-semibold", styles[tone])}>
      {children}
    </span>
  );
}

export function StepIcon({ status }: { readonly status: StepStatus }) {
  if (status === "done") return <CheckCircle2 size={14} className="mt-0.5 text-[var(--primary)]" />;
  if (status === "error") return <XCircle size={14} className="mt-0.5 text-[var(--danger)]" />;
  if (status === "active") return <Loader2 size={14} className="mt-0.5 animate-spin text-[var(--primary)]" />;
  return <Circle size={14} className="mt-0.5 text-[var(--mute)]" />;
}

export function LogRow({ log }: { readonly log: LogEvent }) {
  return (
    <div className="rounded border border-[var(--line-strong)] bg-[var(--surface-dark)] p-3 text-white">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "font-medium",
            log.level === "success" && "text-white",
            log.level === "error" && "text-[var(--danger)]",
            log.level === "info" && "text-[var(--on-dark-muted)]",
          )}
        >
          {log.level}
        </span>
        <span className="text-[var(--on-dark-muted)]">{log.timestamp}</span>
      </div>
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-white">{log.message}</pre>
    </div>
  );
}
