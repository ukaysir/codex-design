import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentChatMeta, AgentChatStatus, ChatMessage } from "../lib/chat-messages";

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function shortSessionId(sessionId: string) {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}...` : sessionId;
}

function agentStatusTone(status: AgentChatStatus): "lime" | "cyan" | "amber" | "danger" | "steel" {
  if (status === "done") return "lime";
  if (status === "active") return "cyan";
  if (status === "error") return "danger";
  if (status === "queued") return "amber";
  return "steel";
}

function AgentBadge({
  children,
  tone = "steel",
}: {
  children: ReactNode;
  tone?: "lime" | "cyan" | "amber" | "danger" | "steel";
}) {
  const styles = {
    lime: "border-blue-100 bg-blue-50 text-[var(--primary-strong)]",
    cyan: "border-[var(--primary)] bg-[var(--primary)] text-white",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-red-200 bg-red-50 text-red-700",
    steel: "border-[var(--line)] bg-[var(--panel-2)] text-[var(--charcoal)]",
  };

  return (
    <span
      className={cn(
        "inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[11px] font-semibold",
        styles[tone],
      )}
    >
      {children}
    </span>
  );
}

function AgentChatRow({ message, agent }: { message: ChatMessage; agent: AgentChatMeta }) {
  const parsedDate = new Date(message.createdAt);
  const timestamp = Number.isNaN(parsedDate.getTime()) ? message.createdAt : parsedDate.toLocaleTimeString();
  const isActive = agent.status === "active";
  const isError = agent.status === "error";

  return (
    <div className="flex min-w-0 max-w-full justify-start">
      <div
        className={cn(
          "w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-[12px] leading-5 shadow-[0_4px_14px_rgba(31,41,55,0.03)]",
          isError ? "border-red-200 bg-red-50 text-red-800" : "border-[var(--line)] text-[var(--charcoal)]",
        )}
      >
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {isActive ? (
              <Loader2 size={13} className="shrink-0 animate-spin text-[var(--primary)]" />
            ) : isError ? (
              <XCircle size={13} className="shrink-0 text-red-500" />
            ) : (
              <CheckCircle2 size={13} className="shrink-0 text-[var(--primary)]" />
            )}
            <span className="truncate text-[11px] font-bold text-[var(--ink-strong)]">{agent.phase}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <AgentBadge tone={agentStatusTone(agent.status)}>{agent.status}</AgentBadge>
            <span className="font-mono text-[9px] text-[var(--muted)]">{timestamp}</span>
          </div>
        </div>
        <p className="whitespace-pre-wrap break-words text-[12px] font-semibold leading-5 text-[var(--ink)] [overflow-wrap:anywhere]">
          {agent.title}
        </p>
        {agent.details?.length ? (
          <ul className="mt-1.5 grid gap-1 text-[11px] leading-4 text-[var(--muted)]">
            {agent.details.map((detail, index) => (
              <li key={`${agent.runId}-${agent.phase}-${index}`} className="flex min-w-0 gap-1.5">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--primary)]" />
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">{detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {(agent.threadId || agent.artifactPath) && (
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[10px] text-[var(--muted)]">
            {agent.threadId ? <span className="truncate rounded-md bg-[var(--panel-2)] px-2 py-1 font-mono">thread {shortSessionId(agent.threadId)}</span> : null}
            {agent.artifactPath ? <span className="truncate rounded-md bg-[var(--panel-2)] px-2 py-1 font-mono">{agent.artifactPath}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatRow({ message }: { message: ChatMessage }) {
  if (message.agent) return <AgentChatRow message={message} agent={message.agent} />;

  const parsedDate = new Date(message.createdAt);
  const timestamp = Number.isNaN(parsedDate.getTime()) ? message.createdAt : parsedDate.toLocaleTimeString();
  const isUser = message.role === "user";
  const levelClass =
    message.level === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : message.level === "success"
        ? "border-blue-100 bg-blue-50 text-[var(--primary-strong)]"
        : isUser
          ? "border-[#101010] bg-[#101010] text-white"
          : "border-[var(--line)] bg-white text-[var(--charcoal)]";

  return (
    <div className="flex min-w-0 max-w-full justify-start">
      <div className={cn("w-full min-w-0 rounded-lg border px-3 py-2 text-[12px] leading-5 shadow-[0_4px_14px_rgba(31,41,55,0.03)]", levelClass)}>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold">{isUser ? "요청" : message.kind ?? "DesignForge"}</span>
          <span className={cn("shrink-0 font-mono text-[9px]", isUser ? "text-white/55" : "text-[var(--muted)]")}>
            {timestamp}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[12px] leading-5 [overflow-wrap:anywhere]">{message.content}</p>
        {message.attachments?.length ? (
          <div className="mt-2 grid gap-1">
            {message.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className={cn(
                  "flex min-h-6 items-center justify-between gap-2 rounded-md border px-2 py-1 text-[10px]",
                  isUser ? "border-white/20 bg-white/10 text-white/80" : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)]",
                )}
              >
                <span className="min-w-0 truncate">
                  {attachment.kind} · {attachment.name}
                </span>
                <span className="shrink-0 font-mono">{Math.max(1, Math.round(attachment.size / 1024))}KB</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
