import type { AttachmentInfo, CodexAppServerEvent, LogLevel } from "../types";

export type ChatKind = "chat" | "status" | "tool" | "summary" | "agent" | "agent-result";

export type AgentChatStatus = "queued" | "active" | "done" | "error" | "info";

export type AgentChatMeta = {
  runId: string;
  phase: string;
  title: string;
  status: AgentChatStatus;
  details?: string[];
  threadId?: string | null;
  artifactPath?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  kind?: ChatKind;
  level?: LogLevel;
  attachments?: AttachmentInfo[];
  agent?: AgentChatMeta;
};

export function completedAgentText(event: CodexAppServerEvent) {
  if (event.method !== "item/completed" || !event.params || typeof event.params !== "object") return null;
  const item = (event.params as { item?: unknown }).item;
  if (!item || typeof item !== "object") return null;
  const candidate = item as { type?: unknown; text?: unknown };
  return candidate.type === "agentMessage" && typeof candidate.text === "string" ? candidate.text : null;
}

export function codexStatusMessage(event: CodexAppServerEvent) {
  if (event.method !== "designforge/status" || !event.params || typeof event.params !== "object") return null;
  const candidate = event.params as { message?: unknown };
  return typeof candidate.message === "string" ? candidate.message : null;
}

export function codexEventLabel(method?: string) {
  if (!method) return "Codex 연결 대기";
  if (method === "designforge/status") return "Codex 세션 준비";
  if (method === "thread/started") return "대화 스레드 연결";
  if (method === "turn/started") return "작업 턴 시작";
  if (method === "item/started") return "파일/명령 작업 시작";
  if (method === "item/agentMessage/delta") return "응답 작성 중";
  if (method === "item/completed") return "작업 항목 완료";
  if (method === "turn/completed") return "작업 턴 완료";
  if (method === "error") return "Codex 오류";
  return method.replaceAll("/", " / ");
}

export function buildAgentContent(agent: AgentChatMeta) {
  const details = agent.details?.length ? `\n${agent.details.map((detail) => `- ${detail}`).join("\n")}` : "";
  return `${agent.title}${details}`;
}

export function agentLevel(status: AgentChatStatus): LogLevel | undefined {
  if (status === "error") return "error";
  if (status === "done") return "success";
  return "info";
}

export function createIntroMessages(): ChatMessage[] {
  return [
    {
      id: "intro",
      role: "assistant",
      content:
        "만들고 싶은 화면을 말해 주세요. 필요한 경우 질문을 먼저 만들고, 답변과 첨부파일까지 묶어 실제 앱 파일을 변경합니다.",
      createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      kind: "summary",
      level: "info",
    },
  ];
}

export function isActivityMessage(message: ChatMessage) {
  return message.kind === "status" || message.kind === "tool";
}

export function parseChatMessageRecords(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Partial<ChatMessage>)
    .filter(
      (message): message is ChatMessage =>
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        typeof message.createdAt === "string",
    );
}

export function dedupeMessages(messages: ChatMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}
