import {
  CheckCircle2,
  Circle,
  Code2,
  FileText,
  FolderOpen,
  History,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  MessageCircle,
  Minimize2,
  MousePointer2,
  Paperclip,
  Play,
  Plus,
  Search,
  Send,
  Square,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import type { ButtonHTMLAttributes, ClipboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  buildCritiquePrompt,
  buildDesignClarificationPrompt,
  buildDesignSystemSeed,
  buildImageGenerationPrompt,
  buildQualityAuditPrompt,
  buildRepairPrompt,
  buildStructuredPrompt,
} from "./lib/prompt-template";
import { callTauri } from "./lib/tauri";
import { WORKSPACE_SELECTION_APP_TSX } from "./lib/workspace-bridge";
import type {
  AnchorInfo,
  AnchorManifest,
  AttachmentInfo,
  CommentRecord,
  CodexAppServerEvent,
  CodexEffort,
  CodexRuntime,
  CommandResult,
  ConsoleInfo,
  CritiqueManifest,
  DesignBriefManifest,
  DesignClarificationManifest,
  DesignContextManifest,
  DesignSystemHealth,
  DesignTokenManifest,
  ExportInfo,
  LogEvent,
  LogLevel,
  PreviewInfo,
  PreviewManifest,
  ProjectInfo,
  QualityAuditManifest,
  RunRecord,
  ScreenshotInfo,
  Settings,
  StaticCheckManifest,
  WorkspaceFile,
  WorkspaceInfo,
} from "./types";

const DEFAULT_SETTINGS: Settings = {
  defaultWorkspaceDir: "",
  defaultProjectRootDir: "",
  codexPath: "codex",
  codexRuntime: "app-server",
  codexModel: "",
  codexEffort: "",
  packageManager: "npm",
  lastWorkspacePath: "",
};

const ARTIFACT_PATH = "src/generated/Screen.tsx";
const DEFAULT_WORKSPACE = "designforge-workspace";
const DEFAULT_PROJECT_ROOT = DEFAULT_WORKSPACE;
const RUNS_PATH = ".designforge/runs.jsonl";
const CHAT_PATH = ".designforge/chat.jsonl";
const ACTIVITY_PATH = ".designforge/activity.jsonl";
const PROJECT_MANIFEST_PATH = ".designforge/project.json";
const CODEX_SESSION_PATH = ".designforge/codex-session.json";
const BRIEF_PATH = ".designforge/brief.json";
const CONTEXT_PATH = ".designforge/context.json";
const TOKEN_MANIFEST_PATH = ".designforge/tokens.json";
const STATIC_CHECK_PATH = ".designforge/static-check.json";
const CLARIFICATION_PATH = ".designforge/clarification.json";
const QUALITY_AUDIT_PATH = ".designforge/quality-audit.json";
const PROMPT_PATH = "prompts/latest.md";
const CLARIFICATION_PROMPT_PATH = "prompts/clarification-latest.md";
const IMAGE_PROMPT_PATH = "prompts/image-latest.md";
const REPAIR_PROMPT_PATH = "prompts/repair-latest.md";
const CRITIQUE_PROMPT_PATH = "prompts/critique-latest.md";
const QUALITY_PROMPT_PATH = "prompts/quality-latest.md";
const CRITIQUE_MANIFEST_PATH = ".designforge/critique.json";
const ANCHORS_PATH = ".designforge/anchors.json";
const HANDOFF_PATH = "outputs/handoff/README.md";
const EXPORT_PATH = "outputs/exports/designforge-handoff.zip";
const PREVIEW_MANIFEST_PATH = ".designforge/preview.json";
const COMMENTS_PATH = ".designforge/comments.jsonl";
const ATTACHMENTS_MANIFEST_PATH = ".designforge/attachments.json";
const ATTACHMENTS_DIR = ".designforge/attachments";
const GENERATED_IMAGES_PATH = ".designforge/generated-images.json";
const GENERATED_IMAGES_DIR = "assets/generated";
const SCREENSHOT_PATH = "outputs/screenshots/latest.png";
const CONSOLE_PATH = "outputs/console/latest.json";
const ARTIFACT_VIEWPORT_WIDTH = 1920;
const ARTIFACT_VIEWPORT_HEIGHT = 1080;
const MAX_LOGS = 300;
const LOG_PREVIEW_CHARS = 2000;

type ChatKind = "chat" | "status" | "tool" | "summary";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  kind?: ChatKind;
  level?: LogLevel;
  attachments?: AttachmentInfo[];
};

type StepStatus = "idle" | "active" | "done" | "error";
type ChatPanelTab = "conversation" | "history";

type PipelineStep = {
  id: string;
  label: string;
  detail: string;
  status: StepStatus;
};

type FileSnapshot = Array<{ relativePath: string; content: string | null }>;

type PreviewSelection = {
  anchorId: string;
  screenLabel: string;
  tagName: string;
  anchorTagName?: string;
  text: string;
  anchorText?: string;
  className?: string;
  path: string[];
  anchorPath?: string[];
};

type GuidedDraft = {
  request: string;
  clarification: DesignClarificationManifest;
  attachments: AttachmentInfo[];
  createdAt: string;
};

type RunRequestOptions = {
  displayRequest?: string;
  recordRequest?: string;
  commentNote?: string;
  anchorId?: string;
  screenLabel?: string;
  clarification?: DesignClarificationManifest | null;
  attachments?: AttachmentInfo[];
};

type CodexSessionManifest = {
  sessionId: string;
  updatedAt: string;
  resetAt?: string;
  lastLabel?: string;
  lastUsedResume?: boolean;
};

type CodexStreamState = {
  runId: string;
  status: "idle" | "running" | "completed" | "error";
  text: string;
  eventCount: number;
  method?: string;
  threadId?: string | null;
  turnId?: string | null;
};

const CODEX_MODEL_OPTIONS = ["", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"] as const;
const CODEX_EFFORT_OPTIONS: CodexEffort[] = ["", "minimal", "low", "medium", "high", "xhigh"];
const MAX_ATTACHMENT_PREVIEW_CHARS = 2400;
const MAX_ATTACHMENT_READ_BYTES = 8 * 1024 * 1024;

const START_STEPS: PipelineStep[] = [
  { id: "context", label: "Context", detail: "Create or open the workspace", status: "idle" },
  { id: "design", label: "Design system", detail: "Infer DESIGN.md from the chat", status: "idle" },
  { id: "brief", label: "Brief", detail: "Write design brief and context manifest", status: "idle" },
  { id: "prompt", label: "Prompt", detail: "Compile the Codex Design brief", status: "idle" },
  { id: "codex", label: "Codex", detail: "Run the local Codex CLI", status: "idle" },
  { id: "artifact", label: "Artifact", detail: "Refresh generated files", status: "idle" },
  { id: "verify", label: "Verify", detail: "Manual TypeScript and Vite check", status: "idle" },
  { id: "repair", label: "Repair", detail: "Manual Codex repair after failed verification", status: "idle" },
  { id: "preview", label: "Preview", detail: "Manual local preview server", status: "idle" },
  { id: "screenshot", label: "Screenshot", detail: "Manual preview evidence capture", status: "idle" },
  { id: "console", label: "Console", detail: "Manual runtime console capture", status: "idle" },
  { id: "critique", label: "Critique", detail: "Manual screenshot-driven critique pass", status: "idle" },
  { id: "quality", label: "Quality", detail: "Manual design quality audit pass", status: "idle" },
  { id: "handoff", label: "Handoff", detail: "Manual implementation handoff notes", status: "idle" },
  { id: "export", label: "Export", detail: "Manual package handoff files", status: "idle" },
];

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("designforge.settings") || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings) {
  localStorage.setItem("designforge.settings", JSON.stringify(settings));
}

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function textFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isCodexAppServerEvent(value: unknown): value is CodexAppServerEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CodexAppServerEvent>;
  return typeof candidate.runId === "string" && typeof candidate.method === "string";
}

function cleanSettingValue(value: string) {
  return value.trim() || null;
}

function completedAgentText(event: CodexAppServerEvent) {
  if (event.method !== "item/completed" || !event.params || typeof event.params !== "object") return null;
  const item = (event.params as { item?: unknown }).item;
  if (!item || typeof item !== "object") return null;
  const candidate = item as { type?: unknown; text?: unknown };
  return candidate.type === "agentMessage" && typeof candidate.text === "string" ? candidate.text : null;
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function createIntroMessages(): ChatMessage[] {
  return [
    {
      id: "intro",
      role: "assistant",
      content:
        "만들고 싶은 화면을 말해 주세요. 필요한 경우 질문을 먼저 만들고, 답변과 첨부파일까지 묶어 실제 앱 파일을 변경합니다.",
      createdAt: now(),
      kind: "summary",
      level: "info",
    },
  ];
}

function Button({
  children,
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]",
        variant === "primary" && "border border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_8px_18px_rgba(49,130,246,0.18)] hover:bg-[var(--primary-strong)]",
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

function Badge({
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

function stepLabel(status: StepStatus) {
  if (status === "done") return "완료";
  if (status === "active") return "진행 중";
  if (status === "error") return "확인 필요";
  return "대기";
}

function stepTone(status: StepStatus): "lime" | "cyan" | "amber" | "danger" | "steel" {
  if (status === "done") return "lime";
  if (status === "active") return "cyan";
  if (status === "error") return "danger";
  return "steel";
}

function runTone(status?: RunRecord["status"]): "lime" | "danger" | "steel" {
  if (status === "success") return "lime";
  if (status === "error") return "danger";
  return "steel";
}

function truncatePath(path: string) {
  return path.length > 42 ? `...${path.slice(-39)}` : path;
}

function shortSessionId(sessionId: string) {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}...` : sessionId;
}

function trimLog(message: string) {
  const clean = message.trim();
  if (!clean) return "(empty output)";
  return clean.length > LOG_PREVIEW_CHARS ? `${clean.slice(0, LOG_PREVIEW_CHARS)}\n...truncated` : clean;
}

function sameWorkspaceFiles(left: WorkspaceFile[], right: WorkspaceFile[]) {
  return (
    left.length === right.length &&
    left.every((file, index) => file.relativePath === right[index]?.relativePath && file.isDirectory === right[index]?.isDirectory)
  );
}

function isActivityMessage(message: ChatMessage) {
  return message.kind === "status" || message.kind === "tool";
}

function parseChatMessageRecords(raw: string) {
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

function dedupeMessages(messages: ChatMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function formatProjectTime(value: string) {
  const seconds = Number(value);
  const date = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "기록 없음";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function previewFrameSrc(url: string, selectionMode: boolean) {
  if (!selectionMode) return url;
  return `${url}${url.includes("?") ? "&" : "?"}designforgeSelect=1`;
}

function isPreviewSelection(value: unknown): value is PreviewSelection & { source: "designforge-preview-select" } {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<PreviewSelection> & { source?: unknown };
  return data.source === "designforge-preview-select" && typeof data.anchorId === "string" && data.anchorId.length > 0;
}

function attachmentKind(file: File): AttachmentInfo["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (
    file.type.startsWith("text/") ||
    /\.(md|mdx|txt|json|csv|ts|tsx|js|jsx|css|scss|html|xml|yml|yaml|toml|ini|env|log)$/i.test(file.name)
  ) {
    return "text";
  }
  return "binary";
}

function safeAttachmentName(name: string) {
  const parts = name.trim().replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1] || "attachment";
  const clean = filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "attachment";
}

function attachmentRelativePath(id: string, name: string) {
  return `${ATTACHMENTS_DIR}/${id}-${safeAttachmentName(name)}`;
}

function extensionForMediaType(mediaType: string) {
  const subtype = mediaType.split("/")[1]?.split(";")[0]?.toLowerCase();
  if (!subtype) return "bin";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype.replace(/[^a-z0-9]+/g, "") || "bin";
}

function pastedAttachmentName(file: File, index: number) {
  const prefix = file.type.startsWith("image/") ? "pasted-image" : "pasted-file";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}-${index}.${extensionForMediaType(file.type)}`;
}

function normalizeClipboardFile(file: File, index: number) {
  if (file.name.trim()) return file;
  return new File([file], pastedAttachmentName(file, index), {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now(),
  });
}

function clipboardAttachmentFiles(data: DataTransfer | null) {
  if (!data) return [];

  const files: File[] = [];
  const seen = new Set<string>();
  const addFile = (file: File | null, index: number) => {
    if (!file) return;
    const nextFile = normalizeClipboardFile(file, index);
    const key = `${nextFile.name}:${nextFile.size}:${nextFile.type}:${nextFile.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(nextFile);
  };

  Array.from(data.items ?? []).forEach((item, index) => {
    if (item.kind === "file") addFile(item.getAsFile(), index + 1);
  });
  Array.from(data.files ?? []).forEach((file, index) => addFile(file, files.length + index + 1));

  return files;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function trimAttachmentPreview(value: string) {
  const clean = value.replace(/\r\n/g, "\n").trim();
  return clean.length > MAX_ATTACHMENT_PREVIEW_CHARS ? `${clean.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS)}\n...truncated` : clean;
}

function formatAttachmentsForPrompt(attachments: AttachmentInfo[]) {
  if (!attachments.length) return "";
  return attachments
    .map((item, index) => {
      const preview = item.previewText ? `\nPreview:\n${item.previewText}` : "";
      return `${index + 1}. ${item.name}\n- kind: ${item.kind}\n- mediaType: ${item.mediaType || "unknown"}\n- size: ${item.size} bytes\n- workspacePath: ${item.relativePath}${preview}`;
    })
    .join("\n\n");
}

function requestWithAttachments(request: string, attachments: AttachmentInfo[]) {
  if (!attachments.length) return request;
  return `${request.trim()}

Attached files supplied by the user:
${formatAttachmentsForPrompt(attachments)}

Use these attachments as source material. For image attachments, inspect the saved workspace file path. For text or Markdown attachments, treat the preview above and the saved file as source truth.`;
}

function buildTargetedComponentRequest(anchorId: string, screenLabel: string, note: string, selection: PreviewSelection | null) {
  const elementLines = [
    "<mentioned-element>",
    "source: DesignForge preview click",
    `dom: [data-screen-label="${screenLabel}"] [data-comment-anchor="${anchorId}"]`,
    selection?.tagName ? `tag: ${selection.tagName}` : "",
    selection?.text ? `text: ${selection.text}` : "",
    selection?.path?.length ? `path: ${selection.path.join(" > ")}` : "",
    "</mentioned-element>",
  ].filter(Boolean);

  return `${elementLines.join("\n")}

Targeted edit for @${anchorId}:
${note}

Apply this as a small component-level revision. Preserve the current DESIGN.md visual system, the existing screen, unrelated layout, spacing, typography, colors, copy, data-screen-label, and all data-comment-anchor values. If the selected anchor is not the right source location, make the narrowest safe edit and explain the assumption in DESIGN.md. Do not regenerate the whole screen unless the user explicitly asks for a fresh design.`;
}

const DESIGN_HEALTH_SECTIONS = [
  "Purpose",
  "Tone",
  "Differentiation",
  "Visual Foundations",
  "Quality Bar",
  "Design Quality Lenses",
  "Interaction and State Model",
  "Responsive Rules",
  "Asset and Source Policy",
  "Editability and Anchors",
  "Component Inventory",
  "Revision Rules",
  "Content Rules",
  "Implementation Rules",
];

const WEAK_DESIGN_SIGNALS = [
  "Pending first chat request",
  "Define the product",
  "Pick a specific direction",
  "Name the one visual",
  "real assets used or needed",
  "Track the semantic regions",
  "Describe the product",
  "Define the visual mood",
];

function sectionBody(markdown: string, section: string) {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`(^|\\n)## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i"));
  return match?.[2]?.trim() ?? "";
}

function inspectDesignSystem(markdown: string): DesignSystemHealth {
  const checkedAt = new Date().toISOString();
  const trimmed = markdown.trim();
  if (!trimmed) {
    return {
      score: 0,
      status: "thin",
      missingSections: DESIGN_HEALTH_SECTIONS,
      weakSignals: ["DESIGN.md is empty"],
      checkedAt,
    };
  }

  const missingSections: string[] = [];
  const weakSignals: string[] = [];
  let score = 10;

  for (const section of DESIGN_HEALTH_SECTIONS) {
    const body = sectionBody(markdown, section);
    if (!body) {
      missingSections.push(section);
      continue;
    }

    const hasWeakPlaceholder = WEAK_DESIGN_SIGNALS.some((signal) => body.includes(signal));
    if (body.length < 80 || hasWeakPlaceholder) {
      weakSignals.push(`${section} needs concrete detail`);
      score += 5;
    } else {
      score += 10;
    }
  }

  if (/#[0-9a-f]{6}/i.test(markdown) || markdown.includes("oklch(") || markdown.includes("rgb(")) score += 5;
  if (/font|type|typography|서체|폰트/i.test(markdown)) score += 5;
  if (/data-comment-anchor|anchor/i.test(markdown)) score += 5;
  if (/motion|animation|transition|reduced-motion|모션/i.test(markdown)) score += 5;

  const capped = Math.max(0, Math.min(100, score));
  return {
    score: capped,
    status: capped >= 80 ? "strong" : capped >= 55 ? "needs-detail" : "thin",
    missingSections,
    weakSignals,
    checkedAt,
  };
}

function classifyRequestForBrief(request: string): DesignBriefManifest["classification"] {
  const lower = request.toLowerCase();
  if (/@[a-z][a-z0-9-]{1,63}/i.test(request) || request.includes("<mentioned-element>")) return "targeted-edit";
  if (/(새로|처음부터|new direction|fresh|reset|replace|리디자인|redesign)/i.test(lower)) return "fresh-design";
  return "system-revision";
}

function inferAudienceAssumption(request: string) {
  if (/dashboard|admin|crm|관리자|운영|어드민/i.test(request)) return "Repeated operational users who need dense, scannable controls.";
  if (/landing|랜딩|marketing|홈페이지|site|website/i.test(request)) return "Prospective users evaluating the product promise in the first viewport.";
  if (/mobile|app|onboarding|가입|설정/i.test(request)) return "End users completing a focused product flow with low friction.";
  return "Product users who need a polished, credible interface that matches the request context.";
}

function inferPurposeAssumption(request: string) {
  if (/수정|변경|바꿔|edit|fix|adjust/i.test(request)) return "Refine the existing artifact while preserving the current system.";
  return "Create a focused, high-craft frontend screen that can be iterated through chat.";
}

function isImageGenerationRequest(request: string) {
  return /\$imagegen|이미지\s*(생성|만들|그려|제작)|그림\s*(생성|만들|그려|제작)|generate\s+(an?\s+)?image|create\s+(an?\s+)?image/i.test(request);
}

function isSmallRevisionRequest(request: string, hasTarget: boolean, hasAttachments: boolean) {
  if (hasAttachments || isImageGenerationRequest(request)) return false;
  if (request.length > 360) return false;
  const asksForNewWork = /(새로|처음부터|new\s+screen|fresh|reset|replace\s+the\s+whole|리디자인|전체\s*교체|랜딩|페이지\s*만들|앱\s*만들|사이트\s*만들)/i.test(request);
  if (asksForNewWork) return false;
  const editSignal =
    /(@[a-z][a-z0-9-]{1,63}|줄바꿈|줄\s*바꿈|개행|위치|정렬|간격|여백|크기|폰트|글자|색|컬러|문구|텍스트|버튼|작게|크게|왼쪽|오른쪽|위로|아래로|수정|변경|바꿔|고쳐|edit|fix|adjust|move|resize|align|spacing|padding|margin|color|text)/i.test(request);
  return editSignal && (hasTarget || request.length <= 160);
}

function qualityBar() {
  return [
    "The request is translated into explicit artifact type, audience, fidelity, constraints, and success criteria.",
    "Provided assets, code, design systems, screenshots, and prior chat are treated as source truth before invention.",
    "Attached files are read as source material before visual or content decisions are invented.",
    "Primary hierarchy is legible within five seconds.",
    "The aesthetic direction is specific, not a generic AI SaaS default.",
    "Every section earns its place; no filler copy or fake metrics.",
    "Typography, color, spacing, and components behave like a system.",
    "Expected interaction states and responsive behavior are defined when the surface implies a real product.",
    "Assets are real or clearly marked assumptions; no invented logos, icons, or copyrighted recreation.",
    "Text fits, controls are accessible, and anchors are stable.",
    "Open questions and assumptions must be explicit in DESIGN.md.",
  ];
}

function formatBriefForPrompt(brief: DesignBriefManifest) {
  return JSON.stringify(brief, null, 2);
}

function formatContextForPrompt(context: DesignContextManifest) {
  return JSON.stringify(
    {
      updatedAt: context.updatedAt,
      assetFiles: context.assetFiles.slice(0, 30),
      attachmentFiles: context.attachmentFiles?.slice(0, 30) ?? [],
      styleFiles: context.styleFiles.slice(0, 20),
      sourceFiles: context.sourceFiles.slice(0, 30),
      tokenManifestPath: context.tokenManifestPath,
      staticCheckPath: context.staticCheckPath,
      generatedArtifactExists: context.generatedArtifactExists,
      anchorCount: context.anchorCount,
      notes: context.notes,
    },
    null,
    2,
  );
}

function formatClarificationForPrompt(clarification: DesignClarificationManifest | null) {
  return clarification ? JSON.stringify(clarification, null, 2) : "";
}

function uniqueLimited(values: string[], limit = 80) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function regexValues(source: string, pattern: RegExp, limit = 80) {
  return uniqueLimited(
    Array.from(source.matchAll(pattern)).map((match) => match[1] || match[0]),
    limit,
  );
}

function lineNumberAt(source: string, index: number) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function nearestScreenLabel(source: string, index: number) {
  const before = source.slice(0, index);
  const matches = Array.from(before.matchAll(/data-screen-label\s*=\s*["']([^"']+)["']/g));
  return matches[matches.length - 1]?.[1]?.trim() || "Generated Screen";
}

function extractComponentInventory(source: string): DesignTokenManifest["componentInventory"] {
  const seen = new Set<string>();
  const inventory: DesignTokenManifest["componentInventory"] = [];
  for (const match of source.matchAll(/data-comment-anchor\s*=\s*["']([^"']+)["']/g)) {
    const anchorId = match[1].trim();
    if (!anchorId || seen.has(anchorId)) continue;
    seen.add(anchorId);
    inventory.push({
      anchorId,
      line: lineNumberAt(source, match.index ?? 0),
      screenLabel: nearestScreenLabel(source, match.index ?? 0),
    });
  }
  return inventory;
}

function extractTailwindClasses(source: string, predicate: (token: string) => boolean, limit = 80) {
  const tokens: string[] = [];
  for (const match of source.matchAll(/["'`]([^"'`]+)["'`]/g)) {
    tokens.push(
      ...match[1]
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token && !token.includes("${") && predicate(token)),
    );
  }
  return uniqueLimited(tokens, limit);
}

function extractTypographyEvidence(designSystem: string, styles: string, source: string) {
  const designLines = designSystem
    .split(/\r?\n/)
    .filter((line) => /font|type|typography|서체|폰트|leading|line-height|tracking/i.test(line))
    .slice(0, 24);
  const styleFamilies = regexValues(styles, /font-family\s*:\s*([^;\n]+)/gi, 24);
  const classTokens = extractTailwindClasses(
    source,
    (token) => /^(font|text|leading|tracking)-/.test(token),
    40,
  );
  return uniqueLimited([...styleFamilies, ...classTokens, ...designLines], 80);
}

function staticCheckTone(status?: StaticCheckManifest["status"]): "lime" | "amber" | "danger" | "steel" {
  if (status === "passed") return "lime";
  if (status === "warning") return "amber";
  if (status === "failed") return "danger";
  return "steel";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDirectReplacement(note: string) {
  const patterns = [
    /["'“”‘’]([^"'“”‘’]{1,220})["'“”‘’]\s*(?:을|를)?\s*["'“”‘’]([^"'“”‘’]{1,220})["'“”‘’]\s*(?:로|으로)\s*(?:변경|바꿔|교체)?/i,
    /["'“”‘’]([^"'“”‘’]{1,220})["'“”‘’]\s*(?:->|=>|to)\s*["'“”‘’]([^"'“”‘’]{1,220})["'“”‘’]/i,
    /replace\s+["'“”‘’]([^"'“”‘’]{1,220})["'“”‘’]\s+(?:with|to)\s+["'“”‘’]([^"'“”‘’]{1,220})["'“”‘’]/i,
  ];
  for (const pattern of patterns) {
    const match = note.match(pattern);
    if (match?.[1] && match?.[2] && match[1] !== match[2]) {
      return { oldText: match[1], newText: match[2] };
    }
  }
  return null;
}

function countOccurrences(value: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = value.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function lineStartOffsets(source: string) {
  const offsets = [0];
  for (const match of source.matchAll(/\r?\n/g)) {
    offsets.push((match.index ?? 0) + match[0].length);
  }
  return offsets;
}

type AnchorSourceRegion = {
  startOffset: number;
  endOffset: number;
  region: string;
};

type DirectSourcePatch = {
  nextSource: string;
  line: number;
  summary: string;
};

const TEXT_SIZE_CLASSES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl"];
const SPACING_SCALE = ["0", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "8", "10", "12", "16"];

function findAnchorRegion(source: string, anchorId: string): AnchorSourceRegion | null {
  const match = source.match(new RegExp(`data-comment-anchor\\s*=\\s*["']${escapeRegex(anchorId)}["']`));
  if (match?.index === undefined) return null;

  const offsets = lineStartOffsets(source);
  const anchorLine = lineNumberAt(source, match.index) - 1;
  const startLine = Math.max(0, anchorLine - 30);
  const endLine = Math.min(offsets.length, anchorLine + 90);
  const startOffset = offsets[startLine] ?? 0;
  const endOffset = offsets[endLine] ?? source.length;
  const region = source.slice(startOffset, endOffset);
  return { startOffset, endOffset, region };
}

function findUniqueTextInRegion(region: string, text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (countOccurrences(region, clean) === 1) {
    const index = region.indexOf(clean);
    return { index, length: clean.length, text: clean };
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const pattern = new RegExp(parts.map(escapeRegex).join("\\s+"), "m");
  const matches = Array.from(region.matchAll(new RegExp(pattern.source, "gm")));
  if (matches.length !== 1 || matches[0].index === undefined) return null;
  return { index: matches[0].index, length: matches[0][0].length, text: matches[0][0] };
}

function jsxTextWithBreaks(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br />");
}

function applyAnchoredTextReplacement(source: string, anchorId: string, oldText: string, newText: string): DirectSourcePatch | null {
  const anchorRegion = findAnchorRegion(source, anchorId);
  if (!anchorRegion) return null;
  const { startOffset, region } = anchorRegion;
  if (countOccurrences(region, oldText) !== 1) return null;

  const relativeIndex = region.indexOf(oldText);
  const absoluteIndex = startOffset + relativeIndex;
  return {
    nextSource: `${source.slice(0, absoluteIndex)}${newText}${source.slice(absoluteIndex + oldText.length)}`,
    line: lineNumberAt(source, absoluteIndex),
    summary: `Text replacement at ${ARTIFACT_PATH}:${lineNumberAt(source, absoluteIndex)}.`,
  };
}

function applyAnchoredLineBreakEdit(source: string, anchorId: string, selectedText: string, nextText: string): DirectSourcePatch | null {
  const anchorRegion = findAnchorRegion(source, anchorId);
  if (!anchorRegion) return null;
  const match = findUniqueTextInRegion(anchorRegion.region, selectedText);
  if (!match) return null;

  const absoluteIndex = anchorRegion.startOffset + match.index;
  const replacement = nextText.includes("\n") ? jsxTextWithBreaks(nextText) : nextText.trim();
  return {
    nextSource: `${source.slice(0, absoluteIndex)}${replacement}${source.slice(absoluteIndex + match.length)}`,
    line: lineNumberAt(source, absoluteIndex),
    summary: `Direct text edit at ${ARTIFACT_PATH}:${lineNumberAt(source, absoluteIndex)}.`,
  };
}

function classTokenIndex(tokens: string[], allowed: string[]) {
  return tokens.findIndex((token) => allowed.includes(token));
}

function shiftBy<T>(values: T[], currentIndex: number, delta: number) {
  return Math.max(0, Math.min(values.length - 1, currentIndex + delta));
}

function adjustTextSizeClasses(className: string, delta: number) {
  const tokens = className.split(/\s+/).filter(Boolean);
  const index = classTokenIndex(tokens, TEXT_SIZE_CLASSES);
  const currentIndex = index >= 0 ? TEXT_SIZE_CLASSES.indexOf(tokens[index]) : TEXT_SIZE_CLASSES.indexOf("text-base");
  const nextClass = TEXT_SIZE_CLASSES[shiftBy(TEXT_SIZE_CLASSES, currentIndex, delta)];
  if (index >= 0) tokens[index] = nextClass;
  else tokens.push(nextClass);
  return uniqueLimited(tokens, 120).join(" ");
}

function shiftSpacingToken(token: string, delta: number) {
  const match = token.match(/^(p[trblxy]?)-(.+)$/);
  if (!match) return token;
  const current = SPACING_SCALE.indexOf(match[2]);
  if (current < 0) return token;
  return `${match[1]}-${SPACING_SCALE[shiftBy(SPACING_SCALE, current, delta)]}`;
}

function adjustElementSpaceClasses(className: string, delta: number) {
  const tokens = className.split(/\s+/).filter(Boolean);
  const indexes = tokens.map((token, index) => (/^p[trblxy]?-[\w.]+$/.test(token) ? index : -1)).filter((index) => index >= 0);
  if (!indexes.length) {
    tokens.push(delta > 0 ? "px-4" : "px-2", delta > 0 ? "py-3" : "py-1.5");
  } else {
    indexes.forEach((index) => {
      tokens[index] = shiftSpacingToken(tokens[index], delta);
    });
  }
  return uniqueLimited(tokens, 120).join(" ");
}

function nearestOpeningTagStart(source: string, textIndex: number) {
  let index = textIndex;
  while (index >= 0) {
    const start = source.lastIndexOf("<", index);
    if (start < 0) return -1;
    const end = source.indexOf(">", start);
    if (end >= textIndex) {
      index = start - 1;
      continue;
    }
    const nextClose = source.indexOf("</", end);
    if (nextClose >= textIndex || nextClose === -1) return start;
    index = start - 1;
  }
  return -1;
}

function replaceOpeningTagClass(source: string, openingStart: number, adjust: (className: string) => string): DirectSourcePatch | null {
  const openingEnd = source.indexOf(">", openingStart);
  if (openingEnd < 0) return null;
  const opening = source.slice(openingStart, openingEnd + 1);
  const stringClass = opening.match(/\sclassName=(["'`])([^"'`]*?)\1/);
  if (!stringClass && /\sclassName=/.test(opening)) return null;
  const nextOpening = stringClass
    ? `${opening.slice(0, stringClass.index)} className=${stringClass[1]}${adjust(stringClass[2])}${stringClass[1]}${opening.slice((stringClass.index ?? 0) + stringClass[0].length)}`
    : `${opening.slice(0, -1)} className="${adjust("")}">`;
  return {
    nextSource: `${source.slice(0, openingStart)}${nextOpening}${source.slice(openingEnd + 1)}`,
    line: lineNumberAt(source, openingStart),
    summary: `Class adjustment at ${ARTIFACT_PATH}:${lineNumberAt(source, openingStart)}.`,
  };
}

function applyAnchoredClassAdjustment(
  source: string,
  anchorId: string,
  selection: PreviewSelection | null,
  adjust: (className: string) => string,
): DirectSourcePatch | null {
  const anchorRegion = findAnchorRegion(source, anchorId);
  if (!anchorRegion) return null;
  const match = selection?.text ? findUniqueTextInRegion(anchorRegion.region, selection.text) : null;
  const relativeTarget = match?.index ?? anchorRegion.region.indexOf(`data-comment-anchor=`);
  if (relativeTarget < 0) return null;
  const openingStart = nearestOpeningTagStart(source, anchorRegion.startOffset + relativeTarget);
  if (openingStart < anchorRegion.startOffset || openingStart > anchorRegion.endOffset) return null;
  return replaceOpeningTagClass(source, openingStart, adjust);
}

function normalizeQuestionKind(value: unknown): DesignClarificationManifest["questions"][number]["kind"] {
  const allowed = new Set(["audience", "brand", "content", "visual-direction", "interaction", "constraint", "asset", "other"]);
  return typeof value === "string" && allowed.has(value) ? (value as DesignClarificationManifest["questions"][number]["kind"]) : "other";
}

function normalizeClarificationManifest(value: unknown, request: string): DesignClarificationManifest {
  const data = value && typeof value === "object" ? (value as Partial<DesignClarificationManifest>) : {};
  const interpretation =
    data.interpretation && typeof data.interpretation === "object"
      ? (data.interpretation as Record<string, unknown>)
      : {};
  const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
  const questions = rawQuestions
    .map((item, index) => {
      const question = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const text = typeof question.question === "string" ? question.question.trim() : "";
      if (!text) return null;
      return {
        id: typeof question.id === "string" && question.id.trim() ? question.id.trim() : `question-${index + 1}`,
        question: text,
        why: typeof question.why === "string" && question.why.trim() ? question.why.trim() : "This answer changes design-system decisions.",
        kind: normalizeQuestionKind(question.kind),
        required: typeof question.required === "boolean" ? question.required : true,
      };
    })
    .filter((item): item is DesignClarificationManifest["questions"][number] => Boolean(item));

  return {
    status: data.status === "skipped" || data.status === "failed" ? data.status : "ready",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    request: typeof data.request === "string" && data.request.trim() ? data.request : request,
    mode: "guided",
    promptPath: typeof data.promptPath === "string" ? data.promptPath : CLARIFICATION_PROMPT_PATH,
    manifestPath: typeof data.manifestPath === "string" ? data.manifestPath : CLARIFICATION_PATH,
    shouldAskQuestions: typeof data.shouldAskQuestions === "boolean" ? data.shouldAskQuestions && questions.length > 0 : questions.length > 0,
    confidence: typeof data.confidence === "number" ? Math.max(0, Math.min(100, data.confidence)) : 0,
    requestType:
      data.requestType === "targeted-edit" || data.requestType === "system-revision" || data.requestType === "fresh-design"
        ? data.requestType
        : "unknown",
    interpretation: {
      product: typeof interpretation.product === "string" ? interpretation.product : "",
      userGoal: typeof interpretation.userGoal === "string" ? interpretation.userGoal : "",
      targetSurface: typeof interpretation.targetSurface === "string" ? interpretation.targetSurface : "",
      likelyAudience: typeof interpretation.likelyAudience === "string" ? interpretation.likelyAudience : "",
      requestedFidelity: typeof interpretation.requestedFidelity === "string" ? interpretation.requestedFidelity : "",
      designSystemNeed: typeof interpretation.designSystemNeed === "string" ? interpretation.designSystemNeed : "",
    },
    knownContext: Array.isArray(data.knownContext) ? data.knownContext.filter((item): item is string => typeof item === "string") : [],
    missingContext: Array.isArray(data.missingContext) ? data.missingContext.filter((item): item is string => typeof item === "string") : [],
    questions,
    assumptionsIfSkipped: Array.isArray(data.assumptionsIfSkipped)
      ? data.assumptionsIfSkipped.filter((item): item is string => typeof item === "string")
      : [],
    designSystemFocus: Array.isArray(data.designSystemFocus) ? data.designSystemFocus.filter((item): item is string => typeof item === "string") : [],
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

function buildClarificationChatMessage(clarification: DesignClarificationManifest) {
  const interpretation = [
    clarification.interpretation.product ? `제품/대상: ${clarification.interpretation.product}` : "",
    clarification.interpretation.targetSurface ? `화면: ${clarification.interpretation.targetSurface}` : "",
    clarification.interpretation.userGoal ? `목표: ${clarification.interpretation.userGoal}` : "",
    clarification.interpretation.designSystemNeed ? `디자인 시스템 쟁점: ${clarification.interpretation.designSystemNeed}` : "",
  ].filter(Boolean);

  const questions = clarification.questions
    .map((question, index) => `${index + 1}. ${question.question}\n   이유: ${question.why}`)
    .join("\n");

  return `요청을 먼저 해석했습니다.

${interpretation.length ? interpretation.join("\n") : "현재 요청과 워크스페이스 문맥을 기준으로 추가 확인이 필요합니다."}

확인 질문:
${questions}

한 번에 답변해 주세요. 답변을 받으면 이 분석과 답변을 함께 Design Brief에 반영해 실제 화면 생성을 진행합니다.`;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [workspacePath, setWorkspacePath] = useState(settings.lastWorkspacePath);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatPanelTab, setChatPanelTab] = useState<ChatPanelTab>("conversation");
  const [guidedDraft, setGuidedDraft] = useState<GuidedDraft | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentInfo[]>([]);
  const [steps, setSteps] = useState<PipelineStep[]>(START_STEPS);
  const [messages, setMessages] = useState<ChatMessage[]>(createIntroMessages);
  const [logs, setLogs] = useState<LogEvent[]>([
    { id: "boot", level: "info", timestamp: now(), message: "Chat-first DesignForge ready." },
  ]);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [showPipelinePanel, setShowPipelinePanel] = useState(false);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [activityMessages, setActivityMessages] = useState<ChatMessage[]>([]);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [codexSession, setCodexSession] = useState<CodexSessionManifest | null>(null);
  const [anchorManifest, setAnchorManifest] = useState<AnchorManifest | null>(null);
  const [selectedAnchorId, setSelectedAnchorId] = useState("");
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [artifactOnlyMode, setArtifactOnlyMode] = useState(false);
  const [componentEdit, setComponentEdit] = useState("");
  const [selectedTextDraft, setSelectedTextDraft] = useState("");
  const [manualVerifyResult, setManualVerifyResult] = useState<CommandResult | null>(null);
  const [manualConsoleInfo, setManualConsoleInfo] = useState<ConsoleInfo | null>(null);
  const [manualScreenshotInfo, setManualScreenshotInfo] = useState<ScreenshotInfo | null>(null);
  const [manualCritique, setManualCritique] = useState<CritiqueManifest | null>(null);
  const [manualQualityAudit, setManualQualityAudit] = useState<QualityAuditManifest | null>(null);
  const [manualExportPath, setManualExportPath] = useState("");
  const [latestBrief, setLatestBrief] = useState<DesignBriefManifest | null>(null);
  const [latestContext, setLatestContext] = useState<DesignContextManifest | null>(null);
  const [latestTokenManifest, setLatestTokenManifest] = useState<DesignTokenManifest | null>(null);
  const [latestStaticCheck, setLatestStaticCheck] = useState<StaticCheckManifest | null>(null);
  const [latestClarification, setLatestClarification] = useState<DesignClarificationManifest | null>(null);
  const [codexStream, setCodexStream] = useState<CodexStreamState>({
    runId: "",
    status: "idle",
    text: "",
    eventCount: 0,
  });
  const projectRootPath = settings.defaultProjectRootDir || DEFAULT_PROJECT_ROOT;

  const visibleFiles = useMemo(
    () =>
      files
        .filter((file) => !file.isDirectory)
        .filter((file) =>
          [
            "DESIGN.md",
            "AGENTS.md",
            PROJECT_MANIFEST_PATH,
            CHAT_PATH,
            ACTIVITY_PATH,
            CODEX_SESSION_PATH,
            CLARIFICATION_PATH,
            BRIEF_PATH,
            CONTEXT_PATH,
            TOKEN_MANIFEST_PATH,
            STATIC_CHECK_PATH,
            QUALITY_AUDIT_PATH,
            CLARIFICATION_PROMPT_PATH,
            PROMPT_PATH,
            IMAGE_PROMPT_PATH,
            REPAIR_PROMPT_PATH,
            CRITIQUE_PROMPT_PATH,
            QUALITY_PROMPT_PATH,
            CRITIQUE_MANIFEST_PATH,
            ANCHORS_PATH,
            HANDOFF_PATH,
            EXPORT_PATH,
            SCREENSHOT_PATH,
            CONSOLE_PATH,
            PREVIEW_MANIFEST_PATH,
            COMMENTS_PATH,
            GENERATED_IMAGES_PATH,
            ARTIFACT_PATH,
            "designforge.config.json",
          ].includes(file.relativePath) ||
          file.relativePath === "CODEX_DESIGN.md" ||
          file.relativePath.startsWith(`${GENERATED_IMAGES_DIR}/`) ||
          file.relativePath === "src/styles.css",
        ),
    [files],
  );

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      if (!isPreviewSelection(event.data)) return;
      const selection: PreviewSelection = {
        anchorId: event.data.anchorId,
        screenLabel: event.data.screenLabel || "Generated Screen",
        tagName: event.data.tagName || "element",
        anchorTagName: event.data.anchorTagName,
        text: event.data.text || "",
        anchorText: event.data.anchorText,
        className: event.data.className,
        path: Array.isArray(event.data.path) ? event.data.path.filter((item) => typeof item === "string") : [],
        anchorPath: Array.isArray(event.data.anchorPath) ? event.data.anchorPath.filter((item) => typeof item === "string") : [],
      };
      setSelectedAnchorId(selection.anchorId);
      setPreviewSelection(selection);
      setSelectedTextDraft(selection.text);
    }

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, []);

  useEffect(() => {
    function handleArtifactOnlyShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (event.key === "Escape" && artifactOnlyMode) {
        event.preventDefault();
        setArtifactOnlyMode(false);
        return;
      }

      if (isTyping) return;

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setArtifactOnlyMode((current) => !current);
      }
    }

    window.addEventListener("keydown", handleArtifactOnlyShortcut);
    return () => window.removeEventListener("keydown", handleArtifactOnlyShortcut);
  }, [artifactOnlyMode]);

  useEffect(() => {
    if (!workspacePath) return;
    void (async () => {
      try {
        await refreshFiles(workspacePath);
        await loadRunHistory(workspacePath);
        await loadCodexSession(workspacePath);
        await loadAnchorManifest(workspacePath);
        await loadChatHistory(workspacePath);
        await loadActivityHistory(workspacePath);
        await loadDesignClarification(workspacePath);
        await loadDesignBrief(workspacePath);
        await loadDesignContext(workspacePath);
        await loadTokenManifest(workspacePath);
        await loadStaticCheck(workspacePath);
        await loadQualityAudit(workspacePath);
      } catch (error) {
        pushLog("error", `Could not load workspace state: ${textFromError(error)}`);
      }
    })();
  }, [workspacePath]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void listen<CodexAppServerEvent>("codex-app-server-event", (event) => {
      const payload = event.payload;
      if (!isCodexAppServerEvent(payload)) return;
      setCodexStream((current) => {
        if (current.runId && current.runId !== payload.runId) return current;
        const completedText = completedAgentText(payload);
        const text = completedText ?? (payload.delta ? `${current.text}${payload.delta}` : current.text);
        const status =
          payload.method === "error"
            ? "error"
            : payload.method === "turn/completed"
              ? "completed"
              : current.status === "idle"
                ? "running"
                : current.status;

        return {
          runId: payload.runId,
          status,
          text,
          eventCount: current.eventCount + 1,
          method: payload.method,
          threadId: payload.threadId ?? current.threadId,
          turnId: payload.turnId ?? current.turnId,
        };
      });
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [projectRootPath, workspacePath]);

  function patchSettings(patch: Partial<Settings>) {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }

  function pushLog(level: LogLevel, message: string) {
    setLogs((current) => [
      ...current.slice(-(MAX_LOGS - 1)),
      { id: crypto.randomUUID(), level, timestamp: now(), message: trimLog(message) },
    ]);
  }

  function createChatMessage(
    role: ChatMessage["role"],
    content: string,
    kind: ChatKind = "chat",
    level?: LogLevel,
    attachments?: AttachmentInfo[],
  ): ChatMessage {
    return {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
      kind,
      level,
      attachments: attachments?.length ? attachments : undefined,
    };
  }

  function pushMessage(role: ChatMessage["role"], content: string, kind: ChatKind = "chat", level?: LogLevel) {
    const message = createChatMessage(role, content, kind, level);
    if (isActivityMessage(message)) {
      setActivityMessages((current) => [...current, message].slice(-120));
    } else {
      setMessages((current) => [...current, message]);
    }
    return message;
  }

  async function appendChatMessage(
    path: string,
    role: ChatMessage["role"],
    content: string,
    kind: ChatKind = "chat",
    level?: LogLevel,
    attachments?: AttachmentInfo[],
  ) {
    const message = createChatMessage(role, content, kind, level, attachments);
    const isActivity = isActivityMessage(message);
    const relativePath = isActivity ? ACTIVITY_PATH : CHAT_PATH;
    if (isActivity) {
      setActivityMessages((current) => [...current, message].slice(-120));
    } else {
      setMessages((current) => [...current, message]);
    }
    try {
      let raw = "";
      try {
        raw = await callTauri<string>("read_file", { workspacePath: path, relativePath });
      } catch {
        raw = "";
      }
      await callTauri("write_file", {
        workspacePath: path,
        relativePath,
        content: `${raw.trimEnd()}\n${JSON.stringify(message)}\n`.trimStart(),
      });
    } catch (error) {
      pushLog("error", `Could not persist ${isActivity ? "activity" : "chat"} message: ${textFromError(error)}`);
    }
    return message;
  }

  async function loadChatHistory(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CHAT_PATH });
      const records = parseChatMessageRecords(raw).filter((message) => !isActivityMessage(message));
      setMessages(records.length ? records.slice(-80) : createIntroMessages());
    } catch {
      setMessages(createIntroMessages());
    }
  }

  async function loadActivityHistory(path: string) {
    try {
      let raw = "";
      try {
        raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: ACTIVITY_PATH });
      } catch {
        raw = "";
      }
      let legacyRaw = "";
      try {
        legacyRaw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CHAT_PATH });
      } catch {
        legacyRaw = "";
      }
      const records = dedupeMessages([
        ...parseChatMessageRecords(legacyRaw).filter(isActivityMessage),
        ...parseChatMessageRecords(raw).filter(isActivityMessage),
      ]);
      setActivityMessages(records.slice(-120));
    } catch {
      setActivityMessages([]);
    }
  }

  async function loadAttachmentManifest(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: ATTACHMENTS_MANIFEST_PATH });
      const parsed = JSON.parse(raw) as unknown;
      const records = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { attachments?: unknown }).attachments)
          ? (parsed as { attachments: unknown[] }).attachments
          : [];
      return records.filter((item): item is AttachmentInfo => {
        if (!item || typeof item !== "object") return false;
        const value = item as Partial<AttachmentInfo>;
        return (
          typeof value.id === "string" &&
          typeof value.name === "string" &&
          typeof value.relativePath === "string" &&
          (value.kind === "image" || value.kind === "text" || value.kind === "binary")
        );
      });
    } catch {
      return [];
    }
  }

  async function saveAttachmentManifest(path: string, attachments: AttachmentInfo[]) {
    const unique = Array.from(new Map(attachments.map((item) => [item.id, item])).values());
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: ATTACHMENTS_MANIFEST_PATH,
      content: JSON.stringify({ updatedAt: new Date().toISOString(), attachments: unique }, null, 2),
    });
    return unique;
  }

  async function addPendingFiles(files: FileList | File[] | null, source: "picker" | "clipboard" = "picker") {
    const selected = Array.from(files ?? []);
    if (!selected.length || busy) return;

    try {
      const path = workspacePath || (await ensureWorkspace("Attached DesignForge Files"));
      const existing = await loadAttachmentManifest(path);
      const nextAttachments: AttachmentInfo[] = [];

      for (const file of selected) {
        if (file.size > MAX_ATTACHMENT_READ_BYTES) {
          pushLog("error", `Attachment skipped because it is too large: ${file.name}`);
          continue;
        }
        const id = crypto.randomUUID();
        const kind = attachmentKind(file);
        const relativePath = attachmentRelativePath(id.slice(0, 8), file.name);
        let previewText: string | undefined;

        if (kind === "text") {
          const text = await file.text();
          previewText = trimAttachmentPreview(text);
          await callTauri("write_file", { workspacePath: path, relativePath, content: text });
        } else {
          const base64Content = arrayBufferToBase64(await file.arrayBuffer());
          await callTauri("write_binary_file", { workspacePath: path, relativePath, base64Content });
        }

        nextAttachments.push({
          id,
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          size: file.size,
          kind,
          relativePath,
          previewText,
          createdAt: new Date().toISOString(),
        });
      }

      if (!nextAttachments.length) return;
      const saved = await saveAttachmentManifest(path, [...existing, ...nextAttachments]);
      setPendingAttachments((current) => [...current, ...nextAttachments]);
      await refreshFiles(path);
      pushLog(
        "success",
        `${source === "clipboard" ? "Pasted" : "Attached"} ${nextAttachments.length} file(s). Total saved attachments: ${saved.length}.`,
      );
    } catch (error) {
      pushLog("error", `Could not attach file: ${textFromError(error)}`);
    }
  }

  async function pastePendingFiles(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = clipboardAttachmentFiles(event.clipboardData);
    if (!files.length) return;

    event.preventDefault();
    await addPendingFiles(files, "clipboard");
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((item) => item.id !== id));
  }

  async function loadDesignBrief(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: BRIEF_PATH });
      const manifest = JSON.parse(raw) as DesignBriefManifest;
      setLatestBrief(manifest);
      return manifest;
    } catch {
      setLatestBrief(null);
      return null;
    }
  }

  async function loadDesignContext(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CONTEXT_PATH });
      const manifest = JSON.parse(raw) as DesignContextManifest;
      setLatestContext(manifest);
      return manifest;
    } catch {
      setLatestContext(null);
      return null;
    }
  }

  async function loadTokenManifest(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: TOKEN_MANIFEST_PATH });
      const manifest = JSON.parse(raw) as DesignTokenManifest;
      setLatestTokenManifest(manifest);
      return manifest;
    } catch {
      setLatestTokenManifest(null);
      return null;
    }
  }

  async function loadStaticCheck(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: STATIC_CHECK_PATH });
      const manifest = JSON.parse(raw) as StaticCheckManifest;
      setLatestStaticCheck(manifest);
      return manifest;
    } catch {
      setLatestStaticCheck(null);
      return null;
    }
  }

  async function loadDesignClarification(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CLARIFICATION_PATH });
      const manifest = normalizeClarificationManifest(JSON.parse(raw), "");
      setLatestClarification(manifest);
      return manifest;
    } catch {
      setLatestClarification(null);
      return null;
    }
  }

  async function loadQualityAudit(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: QUALITY_AUDIT_PATH });
      const manifest = JSON.parse(raw) as QualityAuditManifest;
      setManualQualityAudit(manifest);
      return manifest;
    } catch {
      setManualQualityAudit(null);
      return null;
    }
  }

  function setStep(id: string, status: StepStatus) {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, status } : step)));
  }

  function previewManifest(status: PreviewManifest["status"], patch: Omit<PreviewManifest, "status" | "updatedAt"> = {}) {
    return { status, updatedAt: new Date().toISOString(), ...patch };
  }

  async function refreshProjects() {
    try {
      const nextProjects = await callTauri<ProjectInfo[]>("list_projects", { projectRootPath });
      setProjects(nextProjects);
    } catch (error) {
      pushLog("error", `Could not load projects: ${textFromError(error)}`);
    }
  }

  function resetWorkspaceScopedState() {
    setFiles([]);
    setCodexSession(null);
    setPreview(null);
    setSelectionMode(false);
    setArtifactOnlyMode(false);
    setAnchorManifest(null);
    setRunHistory([]);
    setActivityMessages([]);
    setSelectedAnchorId("");
    setPreviewSelection(null);
    setComponentEdit("");
    setGuidedDraft(null);
    setInput("");
    setPendingAttachments([]);
    setChatPanelTab("conversation");
    setMessages(createIntroMessages());
    setLatestClarification(null);
    setLatestBrief(null);
    setLatestContext(null);
    setLatestTokenManifest(null);
    setLatestStaticCheck(null);
    setManualVerifyResult(null);
    setManualConsoleInfo(null);
    setManualScreenshotInfo(null);
    setManualCritique(null);
    setManualQualityAudit(null);
    setManualExportPath("");
    setSteps(START_STEPS);
  }

  async function stopPreviewBeforeProjectChange() {
    try {
      await callTauri("stop_preview");
    } catch {
      // Project switching should not fail just because no preview is running.
    }
  }

  async function switchProject(path: string) {
    if (busy || path === workspacePath) {
      setShowProjectPanel(false);
      return;
    }
    await stopPreviewBeforeProjectChange();
    resetWorkspaceScopedState();
    try {
      const info = await callTauri<WorkspaceInfo>("open_workspace", { path });
      setWorkspacePath(info.path);
      patchSettings({ lastWorkspacePath: info.path });
      setShowProjectPanel(false);
      pushLog("success", `Switched project: ${info.path}`);
      await refreshProjects();
    } catch (error) {
      pushLog("error", `Could not open project: ${textFromError(error)}`);
    }
  }

  async function createNewProject(name?: string, manageBusy = true) {
    if (manageBusy && busy) return "";
    if (manageBusy) setBusy(true);
    await stopPreviewBeforeProjectChange();
    resetWorkspaceScopedState();
    try {
      const project = await callTauri<ProjectInfo>("create_project", {
        projectRootPath,
        name: name?.trim() || "Untitled DesignForge Project",
      });
      setWorkspacePath(project.path);
      patchSettings({ lastWorkspacePath: project.path });
      setProjects((current) => [project, ...current.filter((item) => item.path !== project.path)]);
      setShowProjectPanel(false);
      pushLog("success", `Created project: ${project.path}`);
      await refreshProjects();
      return project.path;
    } catch (error) {
      pushLog("error", `Could not create project: ${textFromError(error)}`);
      return "";
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  async function ensureWorkspace(projectName?: string) {
    const target = workspacePath || settings.lastWorkspacePath || settings.defaultWorkspaceDir;
    if (!target) {
      const created = await createNewProject(projectName, false);
      if (!created) throw new Error("Could not create a project workspace.");
      return created;
    }
    try {
      const info = await callTauri<WorkspaceInfo>("open_workspace", { path: target });
      setWorkspacePath(info.path);
      patchSettings({ lastWorkspacePath: info.path });
      pushLog("success", `Opened workspace: ${info.path}`);
      return info.path;
    } catch {
      const info = await callTauri<WorkspaceInfo>("create_workspace", { path: target });
      setWorkspacePath(info.path);
      patchSettings({ lastWorkspacePath: info.path });
      pushLog("success", `Created workspace: ${info.path}`);
      return info.path;
    }
  }

  async function refreshFiles(path: string) {
    const nextFiles = await callTauri<WorkspaceFile[]>("list_workspace_files", { workspacePath: path });
    setFiles((current) => (sameWorkspaceFiles(current, nextFiles) ? current : nextFiles));
  }

  async function loadRunHistory(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: RUNS_PATH });
      const records = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RunRecord);
      setRunHistory(records.slice(-8).reverse());
    } catch {
      setRunHistory([]);
    }
  }

  async function loadCodexSession(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CODEX_SESSION_PATH });
      const manifest = JSON.parse(raw) as Partial<CodexSessionManifest>;
      if (typeof manifest.sessionId !== "string" || !manifest.sessionId.trim()) {
        setCodexSession(null);
        return null;
      }
      const next: CodexSessionManifest = {
        sessionId: manifest.sessionId.trim(),
        updatedAt: typeof manifest.updatedAt === "string" ? manifest.updatedAt : new Date().toISOString(),
        resetAt: typeof manifest.resetAt === "string" ? manifest.resetAt : undefined,
        lastLabel: typeof manifest.lastLabel === "string" ? manifest.lastLabel : undefined,
        lastUsedResume: typeof manifest.lastUsedResume === "boolean" ? manifest.lastUsedResume : undefined,
      };
      setCodexSession(next);
      return next;
    } catch {
      setCodexSession(null);
      return null;
    }
  }

  async function saveCodexSession(path: string, result: CommandResult, label: string) {
    if (!result.sessionId) return codexSession;
    const manifest: CodexSessionManifest = {
      sessionId: result.sessionId,
      updatedAt: new Date().toISOString(),
      lastLabel: label,
      lastUsedResume: result.usedResume,
    };
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: CODEX_SESSION_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
    setCodexSession(manifest);
    pushLog("success", `${result.usedResume ? "Resumed" : "Stored"} Codex session: ${result.sessionId.slice(0, 8)}...`);
    return manifest;
  }

  async function loadAnchorManifest(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: ANCHORS_PATH });
      const manifest = JSON.parse(raw) as AnchorManifest;
      setAnchorManifest(manifest);
      return manifest;
    } catch {
      setAnchorManifest(null);
      return null;
    }
  }

  async function ensurePreviewSelectionBridge(path: string) {
    try {
      const current = await callTauri<string>("read_file", { workspacePath: path, relativePath: "src/App.tsx" });
      if (current.includes("DesignForgeSelectionBridge")) {
        if (current.includes("function targetElement") && current.includes("anchorText")) return;
        const isBridgeWrapper =
          current.includes('import Screen from "./generated/Screen"') &&
          current.includes("<DesignForgeSelectionBridge />") &&
          current.includes("<Screen />");
        if (!isBridgeWrapper) {
          pushLog("info", "Workspace src/App.tsx has a custom selection bridge; leaving it unchanged.");
          return;
        }
        await callTauri("write_file", {
          workspacePath: path,
          relativePath: "src/App.tsx",
          content: WORKSPACE_SELECTION_APP_TSX,
        });
        pushLog("success", "Upgraded preview click selection bridge.");
        return;
      }

      const isDefaultWrapper =
        current.includes('import Screen from "./generated/Screen"') &&
        current.includes("return <Screen />") &&
        current.length < 500;

      if (!isDefaultWrapper) {
        pushLog("info", "Workspace src/App.tsx is custom; preview click selection will use the anchor list fallback.");
        return;
      }

      await callTauri("write_file", {
        workspacePath: path,
        relativePath: "src/App.tsx",
        content: WORKSPACE_SELECTION_APP_TSX,
      });
      pushLog("success", "Enabled preview click selection bridge.");
    } catch (error) {
      pushLog("error", `Could not enable preview selection bridge: ${textFromError(error)}`);
    }
  }

  async function loadComments(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: COMMENTS_PATH });
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CommentRecord)
        .slice(-10);
    } catch {
      return [];
    }
  }

  async function appendRunRecord(path: string, record: RunRecord) {
    let raw = "";
    try {
      raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: RUNS_PATH });
    } catch {
      raw = "";
    }
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: RUNS_PATH,
      content: `${raw.trimEnd()}\n${JSON.stringify(record)}\n`.trimStart(),
    });
    await loadRunHistory(path);
    pushLog("success", `Recorded run: ${record.status}`);
  }

  async function recordRun(path: string, record: RunRecord) {
    try {
      await appendRunRecord(path, record);
    } catch (error) {
      pushLog("error", `Could not record run: ${textFromError(error)}`);
    }
  }

  async function appendComment(path: string, record: CommentRecord) {
    let raw = "";
    try {
      raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: COMMENTS_PATH });
    } catch {
      raw = "";
    }
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: COMMENTS_PATH,
      content: `${raw.trimEnd()}\n${JSON.stringify(record)}\n`.trimStart(),
    });
  }

  async function savePreviewManifest(path: string, manifest: PreviewManifest) {
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: PREVIEW_MANIFEST_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
  }

  async function readDesignSystem(path: string) {
    try {
      return await callTauri<string>("read_file", { workspacePath: path, relativePath: "DESIGN.md" });
    } catch {
      return "";
    }
  }

  function scaffoldDesignSection(section: string) {
    const map: Record<string, string> = {
      Purpose: "Define the product, audience, job-to-be-done, and the screen's role before coding.",
      Tone: "Commit to a specific aesthetic direction that fits the request instead of a generic default.",
      Differentiation: "Name the one visual or interaction idea the user should remember.",
      "Visual Foundations":
        "- Color: background, surface, text, accent, border, semantic states, and contrast notes.\n- Typography: display/body/mono choices, scale, weights, line-height, and why they fit.\n- Layout: grid, density, spacing rhythm, responsive behavior, and composition rules.\n- Components: buttons, inputs, cards, navigation, feedback, empty states, and repeated patterns.\n- Motion: what moves, why it moves, duration/easing, and reduced-motion behavior.\n- Assets: real assets used or needed; do not invent logos or decorative replacements.",
      "Quality Bar":
        "- Strong hierarchy: the primary message and action are obvious within five seconds.\n- Specific aesthetic direction: the design should not read like a generic AI SaaS template.\n- Useful content only: every section earns its place.\n- System continuity: repeated controls, cards, spacing, type, and tone follow the same vocabulary.\n- Implementation fidelity: responsive constraints, readable text, visible focus, and accessible controls.",
      "Design Quality Lenses":
        "1. Request fit: artifact type, fidelity, audience, constraints, and option count.\n2. Source truth: assets, code, design systems, screenshots, and prior chat.\n3. System first: purpose, tone, differentiation, tokens, components, motion, and content rules.\n4. Content economy: no filler, fake metrics, or unrequested material.\n5. Visual distinctiveness: memorable direction, not generic AI defaults.\n6. Composition and scale: hierarchy, density, viewport, responsiveness, and type scale.\n7. Interaction realism: hover, focus, active, loading, empty, error, validation, and navigation states.\n8. Editability and anchors: literal copy, stable data-comment-anchor values, and narrow targeted edits.\n9. Asset integrity: real assets only, no invented logos/icons, no copyrighted recreation.\n10. Verification and handoff: previewability, assumptions, caveats, and implementation details.",
      "Interaction and State Model":
        "- Define hover, active, focus, loading, empty, error, success, and disabled states when the surface implies product interaction.\n- Prototype enough behavior to make the generated result feel real without making the code difficult to revise.\n- Use motion for comprehension, rhythm, or state change and respect reduced-motion preferences.",
      "Responsive Rules":
        "- Name the primary viewport and fixed-canvas requirements before coding.\n- Ensure text, controls, and repeated items fit at desktop and narrower widths.\n- Use stable flex/grid constraints, explicit gaps, and intentional density.",
      "Asset and Source Policy":
        "- Use provided assets, code, or design-system evidence as source of truth.\n- Do not invent logos, fake icons, fake metrics, or copyrighted UI details.\n- If assets are missing, record assumptions and use neutral placeholders.",
      "Editability and Anchors":
        "- Keep user-visible copy literal and directly editable where practical.\n- Preserve existing data-comment-anchor values and add stable anchors for major semantic regions.\n- For targeted edits, change only the requested region and preserve unrelated layout, spacing, type, colors, and copy.",
      "Component Inventory":
        "Track stable semantic regions and keep them aligned with data-comment-anchor values in src/generated/Screen.tsx.",
      "Revision Rules":
        "- Continue inside this design system unless the user explicitly asks for a new direction.\n- For a component-level request, edit only the matching anchor's semantic region.\n- Preserve unrelated layout, spacing, typography, color, copy, and anchor ids.",
      "Content Rules":
        "- No filler sections or lorem ipsum.\n- No fake metrics unless the request provides real data or asks for sample data.\n- Emoji only when appropriate to the product or provided brand.\n- Copy should match the product tone and stay concise.",
      "Implementation Rules":
        "- Main generated screen: src/generated/Screen.tsx.\n- Keep high-level screen roots labelled with data-screen-label.\n- Add stable kebab-case data-comment-anchor values to important semantic regions.\n- Preserve data-comment-anchor values during revisions.\n- Use semantic HTML and accessible controls.\n- Use flex/grid with gap for grouped UI.",
    };
    return map[section] ?? "DesignForge should fill this section with concrete guidance during the next design pass.";
  }

  function enrichDesignSystem(current: string, health: DesignSystemHealth, request: string) {
    const additions = health.missingSections
      .map((section) => `## ${section}\n\n${scaffoldDesignSection(section)}`)
      .join("\n\n");
    const healthNotes = `## DesignForge Health Notes

- Last request: ${request}
- Health score before this pass: ${health.score}/100 (${health.status})
- Missing sections before this pass: ${health.missingSections.length ? health.missingSections.join(", ") : "none"}
- Weak signals before this pass: ${health.weakSignals.length ? health.weakSignals.join("; ") : "none"}
- Future Codex runs should replace scaffold language with concrete product-specific decisions.`;

    return [current.trim(), additions, healthNotes].filter(Boolean).join("\n\n");
  }

  async function prepareDesignSystem(path: string, request: string) {
    const current = await readDesignSystem(path);

    const isLegacySeed =
      current.includes("DesignForge inferred this project") ||
      current.includes("Pending first chat request") ||
      current.includes("Describe the product") ||
      current.includes("Define the visual mood");
    const health = inspectDesignSystem(current);

    if (health.status === "strong" && !isLegacySeed) {
      pushLog("info", `Existing DESIGN.md kept. Health ${health.score}/100.`);
      return health;
    }

    const next =
      health.status === "thin" || isLegacySeed
        ? buildDesignSystemSeed(request)
        : enrichDesignSystem(current, health, request);
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: "DESIGN.md",
      content: next,
    });
    const nextHealth = inspectDesignSystem(next);
    pushLog("success", `Updated DESIGN.md quality scaffold. Health ${nextHealth.score}/100.`);
    return nextHealth;
  }

  async function writeDesignContextManifest(path: string) {
    const workspaceFiles = await callTauri<WorkspaceFile[]>("list_workspace_files", { workspacePath: path });
    const loadedAnchors = anchorManifest ?? (await loadAnchorManifest(path));
    const attachmentFiles = await loadAttachmentManifest(path);
    const tokenManifest = await writeTokenManifest(path);
    const staticCheck = await writeStaticCheckManifest(path);
    const filePaths = workspaceFiles.filter((file) => !file.isDirectory).map((file) => file.relativePath);
    const artifactExists = workspaceFiles.some((file) => file.relativePath === ARTIFACT_PATH);
    const assetFiles = filePaths
      .filter((file) => file.startsWith("assets/") || /\.(png|jpe?g|webp|gif|svg|ico|avif|ttf|otf|woff2?)$/i.test(file))
      .slice(0, 80);
    const styleFiles = filePaths
      .filter((file) => /\.(css|scss|sass|less|cjs|mjs|config\.js|config\.ts)$/i.test(file) || file.includes("tailwind"))
      .slice(0, 80);
    const sourceFiles = filePaths
      .filter((file) => file.startsWith("src/") && /\.(tsx?|jsx?)$/i.test(file))
      .slice(0, 100);
    const notes = [
      assetFiles.length ? `${assetFiles.length} local asset files available.` : "No local assets found; avoid inventing logos or fake imagery.",
      attachmentFiles.length
        ? `${attachmentFiles.length} user attachment files available; inspect them as source material.`
        : "No user attachments saved for this project.",
      styleFiles.length ? `${styleFiles.length} style/config files available.` : "No shared style files found beyond defaults.",
      artifactExists ? `${ARTIFACT_PATH} exists.` : `${ARTIFACT_PATH} is missing and should be created.`,
      loadedAnchors?.anchors.length ? `${loadedAnchors.anchors.length} comment anchors indexed.` : "No anchors indexed yet.",
      `${TOKEN_MANIFEST_PATH} records ${tokenManifest.colors.length} color values, ${tokenManifest.typography.length} typography signals, and ${tokenManifest.componentInventory.length} component anchors.`,
      `${STATIC_CHECK_PATH} status is ${staticCheck.status}.`,
    ];
    const manifest: DesignContextManifest = {
      updatedAt: new Date().toISOString(),
      assetFiles,
      attachmentFiles,
      styleFiles,
      sourceFiles,
      tokenManifestPath: TOKEN_MANIFEST_PATH,
      staticCheckPath: STATIC_CHECK_PATH,
      generatedArtifactExists: artifactExists,
      anchorCount: loadedAnchors?.anchors.length ?? 0,
      notes,
    };
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: CONTEXT_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
    pushLog("success", `Wrote context manifest: ${CONTEXT_PATH}`);
    return manifest;
  }

  async function writeDesignBriefManifest(
    path: string,
    request: string,
    designSystemHealth: DesignSystemHealth,
    context: DesignContextManifest,
    clarification: DesignClarificationManifest | null = latestClarification,
  ) {
    const classification =
      clarification?.requestType === "targeted-edit" || clarification?.requestType === "system-revision" || clarification?.requestType === "fresh-design"
        ? clarification.requestType
        : classifyRequestForBrief(request);
    const audienceAssumption = clarification?.interpretation.likelyAudience || inferAudienceAssumption(request);
    const purposeAssumption = clarification?.interpretation.userGoal || inferPurposeAssumption(request);
    const assumptions = [
      audienceAssumption,
      purposeAssumption,
      ...(clarification?.assumptionsIfSkipped ?? []),
      ...(clarification?.knownContext ?? []).slice(0, 4),
      context.assetFiles.length
        ? "Use available local assets when they match the requested surface."
        : "No local assets were found, so the design should avoid invented brand marks and fake imagery.",
      designSystemHealth.status === "strong"
        ? "The existing design system is strong enough to preserve."
        : "The design system needs concrete decisions during this run.",
    ];
    const manifest: DesignBriefManifest = {
      updatedAt: new Date().toISOString(),
      request,
      mode: "guided",
      classification,
      audienceAssumption,
      purposeAssumption,
      qualityBar: qualityBar(),
      questionsToConsider: clarification?.questions.map((question) => `${question.question} (${question.why})`) ?? [],
      assumptions,
      designSystemHealth,
      contextPath: CONTEXT_PATH,
      clarificationPath: clarification ? CLARIFICATION_PATH : undefined,
    };
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: BRIEF_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
    pushLog("success", `Wrote design brief: ${BRIEF_PATH}`);
    return manifest;
  }

  function buildFeedbackContext(records: CommentRecord[]) {
    if (records.length === 0) return "";
    return records
      .map((record) => {
        const date = new Date(record.createdAt).toLocaleString();
        const anchor = record.anchorId ? ` @${record.anchorId}` : "";
        return `- ${date} [${record.status}]${anchor} ${record.screenLabel}: ${record.note}`;
      })
      .join("\n");
  }

  function anchorFromRequest(request: string) {
    return request.match(/(?:^|\s)@([a-z][a-z0-9-]{1,63})(?=\b|$)/i)?.[1];
  }

  function extractAnchors(source: string): AnchorManifest {
    const screenLabel = source.match(/data-screen-label\s*=\s*["']([^"']+)["']/)?.[1] ?? "Generated Screen";
    const seen = new Set<string>();
    const anchors: AnchorInfo[] = [];

    source.split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(/data-comment-anchor\s*=\s*["']([^"']+)["']/g)) {
        const id = match[1].trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        anchors.push({ id, artifactPath: ARTIFACT_PATH, line: index + 1, screenLabel });
      }
    });

    return { updatedAt: new Date().toISOString(), artifactPath: ARTIFACT_PATH, anchors };
  }

  async function writeAnchorManifest(path: string) {
    const source = await callTauri<string>("read_file", { workspacePath: path, relativePath: ARTIFACT_PATH });
    const manifest = extractAnchors(source);
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: ANCHORS_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
    setAnchorManifest(manifest);
    pushLog("success", `Indexed ${manifest.anchors.length} comment anchors.`);
    return manifest;
  }

  async function readOptionalWorkspaceFile(path: string, relativePath: string) {
    try {
      return await callTauri<string>("read_file", { workspacePath: path, relativePath });
    } catch {
      return "";
    }
  }

  async function writeTokenManifest(path: string) {
    const [designSystem, styles, artifact] = await Promise.all([
      readOptionalWorkspaceFile(path, "DESIGN.md"),
      readOptionalWorkspaceFile(path, "src/styles.css"),
      readOptionalWorkspaceFile(path, ARTIFACT_PATH),
    ]);
    const combined = [designSystem, styles, artifact].join("\n");
    const colors = regexValues(combined, /#[0-9a-f]{3,8}\b|oklch\([^)]+\)|rgba?\([^)]+\)/gi, 96);
    const typography = extractTypographyEvidence(designSystem, styles, artifact);
    const spacingClasses = extractTailwindClasses(
      artifact,
      (token) => /^(?:-?m[trblxy]?|-?p[trblxy]?|gap|space-[xy]|inset|top|right|bottom|left|w|h|min-w|min-h|max-w|max-h)-/.test(token),
      96,
    );
    const radiusClasses = extractTailwindClasses(artifact, (token) => /^rounded(?:-|$)/.test(token), 48);
    const shadowClasses = extractTailwindClasses(artifact, (token) => /^shadow(?:-|$|\[)/.test(token), 48);
    const componentInventory = extractComponentInventory(artifact);
    const sourceFiles = [
      designSystem ? "DESIGN.md" : "",
      styles ? "src/styles.css" : "",
      artifact ? ARTIFACT_PATH : "",
    ].filter(Boolean);
    const manifest: DesignTokenManifest = {
      updatedAt: new Date().toISOString(),
      sourceFiles,
      colors,
      typography,
      spacingClasses,
      radiusClasses,
      shadowClasses,
      componentInventory,
      notes: [
        colors.length ? `${colors.length} color values found.` : "No explicit color values found in source.",
        typography.length ? `${typography.length} typography signals found.` : "No typography signals found; generated design should document type decisions.",
        componentInventory.length
          ? `${componentInventory.length} anchored component regions found.`
          : "No data-comment-anchor regions found; targeted chat edits will be weaker.",
      ],
    };
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: TOKEN_MANIFEST_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
    setLatestTokenManifest(manifest);
    pushLog("success", `Wrote token manifest: ${TOKEN_MANIFEST_PATH}`);
    return manifest;
  }

  async function writeStaticCheckManifest(path: string) {
    let artifact = "";
    try {
      artifact = await callTauri<string>("read_file", { workspacePath: path, relativePath: ARTIFACT_PATH });
    } catch {
      artifact = "";
    }
    const anchors = extractComponentInventory(artifact);
    const anchorIds = anchors.map((item) => item.anchorId);
    const duplicateAnchors = anchorIds.filter((id, index) => anchorIds.indexOf(id) !== index);
    const checks: StaticCheckManifest["checks"] = [
      {
        id: "artifact-readable",
        status: artifact ? "passed" : "failed",
        message: artifact ? `${ARTIFACT_PATH} is readable.` : `${ARTIFACT_PATH} is missing or unreadable.`,
      },
      {
        id: "default-export",
        status: /export\s+default\s+function|export\s+default\s+[A-Z]/.test(artifact) ? "passed" : "failed",
        message: /export\s+default\s+function|export\s+default\s+[A-Z]/.test(artifact)
          ? "The generated screen has a default export."
          : "The generated screen does not expose a recognizable default export.",
      },
      {
        id: "screen-label",
        status: /data-screen-label\s*=/.test(artifact) ? "passed" : "warning",
        message: /data-screen-label\s*=/.test(artifact)
          ? "A high-level data-screen-label is present."
          : "No data-screen-label was found; comment context will be weaker.",
      },
      {
        id: "comment-anchors",
        status: anchors.length >= 3 ? "passed" : anchors.length ? "warning" : "failed",
        message: anchors.length
          ? `${anchors.length} data-comment-anchor regions found.`
          : "No data-comment-anchor regions found.",
      },
      {
        id: "duplicate-anchors",
        status: duplicateAnchors.length ? "failed" : "passed",
        message: duplicateAnchors.length
          ? `Duplicate anchor ids: ${uniqueLimited(duplicateAnchors, 12).join(", ")}`
          : "No duplicate data-comment-anchor ids found.",
      },
      {
        id: "filler-copy",
        status: /\blorem ipsum\b|\bTODO\b|dummy data|fake metric/i.test(artifact) ? "warning" : "passed",
        message: /\blorem ipsum\b|\bTODO\b|dummy data|fake metric/i.test(artifact)
          ? "Potential filler or fake-content markers were found."
          : "No obvious lorem/TODO/fake metric markers found.",
      },
    ];
    const status: StaticCheckManifest["status"] = checks.some((check) => check.status === "failed")
      ? "failed"
      : checks.some((check) => check.status === "warning")
        ? "warning"
        : "passed";
    const manifest: StaticCheckManifest = {
      status,
      updatedAt: new Date().toISOString(),
      artifactPath: ARTIFACT_PATH,
      checks,
    };
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: STATIC_CHECK_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
    setLatestStaticCheck(manifest);
    pushLog(status === "failed" ? "error" : "success", `Wrote static check: ${STATIC_CHECK_PATH} (${status})`);
    return manifest;
  }

  async function writePrompt(
    path: string,
    request: string,
    brief: DesignBriefManifest,
    context: DesignContextManifest,
    clarification: DesignClarificationManifest | null = latestClarification,
  ) {
    const feedbackContext = buildFeedbackContext(await loadComments(path));
    const prompt = buildStructuredPrompt(request, {
      artifactPath: ARTIFACT_PATH,
      feedbackContext,
      briefPath: BRIEF_PATH,
      contextPath: CONTEXT_PATH,
      clarificationPath: CLARIFICATION_PATH,
      briefContext: formatBriefForPrompt(brief),
      contextSummary: formatContextForPrompt(context),
      clarificationContext: formatClarificationForPrompt(clarification),
      generationMode: brief.mode,
    });
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: PROMPT_PATH,
      content: prompt,
    });
    pushLog("success", `Compiled ${PROMPT_PATH}.`);
    return prompt;
  }

  async function writeImageGenerationPrompt(path: string, request: string, context: DesignContextManifest) {
    const prompt = buildImageGenerationPrompt(request, {
      contextPath: CONTEXT_PATH,
      designSystemPath: "DESIGN.md",
      contextSummary: formatContextForPrompt(context),
    });
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: IMAGE_PROMPT_PATH,
      content: prompt,
    });
    pushLog("success", `Compiled ${IMAGE_PROMPT_PATH}.`);
    return prompt;
  }

  async function writeClarificationPrompt(
    path: string,
    request: string,
    context: DesignContextManifest,
    designSystemHealth: DesignSystemHealth,
    designSystemMarkdown: string,
  ) {
    const feedbackContext = buildFeedbackContext(await loadComments(path));
    const prompt = buildDesignClarificationPrompt(request, {
      artifactPath: ARTIFACT_PATH,
      designSystemPath: "DESIGN.md",
      contextPath: CONTEXT_PATH,
      clarificationPath: CLARIFICATION_PATH,
      contextSummary: formatContextForPrompt(context),
      generationMode: "guided",
      mode: "guided",
      designSystemHealth,
      designSystemExcerpt: designSystemMarkdown.slice(0, 12000),
      recentFeedback: feedbackContext,
    });
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: CLARIFICATION_PROMPT_PATH,
      content: prompt,
    });
    pushLog("success", `Compiled ${CLARIFICATION_PROMPT_PATH}.`);
    return prompt;
  }

  async function writeRepairPrompt(path: string, request: string, verifyResult: CommandResult) {
    const prompt = buildRepairPrompt(request, verifyResult, { artifactPath: ARTIFACT_PATH });
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: REPAIR_PROMPT_PATH,
      content: prompt,
    });
    pushLog("info", `Compiled repair prompt in ${REPAIR_PROMPT_PATH}.`);
    return prompt;
  }

  async function writeCritiquePrompt(
    path: string,
    request: string,
    screenshot: ScreenshotInfo | null,
    consoleInfo: ConsoleInfo | null,
  ) {
    const screenshotPath = screenshot?.relativePath ?? SCREENSHOT_PATH;
    const prompt = buildCritiquePrompt(request, screenshotPath, {
      artifactPath: ARTIFACT_PATH,
      consolePath: consoleInfo?.relativePath,
    });
    const manifest: CritiqueManifest = {
      status: screenshot ? "ready" : "no-screenshot",
      updatedAt: new Date().toISOString(),
      promptPath: CRITIQUE_PROMPT_PATH,
      manifestPath: CRITIQUE_MANIFEST_PATH,
      artifactPath: ARTIFACT_PATH,
      screenshotPath: screenshot?.relativePath,
      consolePath: consoleInfo?.relativePath,
    };

    await callTauri("write_file", {
      workspacePath: path,
      relativePath: CRITIQUE_PROMPT_PATH,
      content: prompt,
    });
    await saveCritiqueManifest(path, manifest);
    pushLog("success", `Prepared critique input: ${CRITIQUE_PROMPT_PATH}`);
    return manifest;
  }

  async function saveCritiqueManifest(path: string, manifest: CritiqueManifest) {
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: CRITIQUE_MANIFEST_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
  }

  async function saveQualityAuditManifest(path: string, manifest: QualityAuditManifest) {
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: QUALITY_AUDIT_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
    setManualQualityAudit(manifest);
  }

  async function readQualityAuditManifest(path: string) {
    const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: QUALITY_AUDIT_PATH });
    return JSON.parse(raw) as QualityAuditManifest;
  }

  async function writeQualityAuditPrompt(
    path: string,
    request: string,
    screenshot: ScreenshotInfo | null,
    consoleInfo: ConsoleInfo | null,
  ) {
    const prompt = buildQualityAuditPrompt(request, screenshot?.relativePath ?? null, {
      artifactPath: ARTIFACT_PATH,
      briefPath: BRIEF_PATH,
      contextPath: CONTEXT_PATH,
      qualityAuditPath: QUALITY_AUDIT_PATH,
      consolePath: consoleInfo?.relativePath,
    });
    const manifest: QualityAuditManifest = {
      status: screenshot || consoleInfo ? "ready" : "no-evidence",
      updatedAt: new Date().toISOString(),
      promptPath: QUALITY_PROMPT_PATH,
      manifestPath: QUALITY_AUDIT_PATH,
      artifactPath: ARTIFACT_PATH,
      briefPath: BRIEF_PATH,
      contextPath: CONTEXT_PATH,
      screenshotPath: screenshot?.relativePath,
      consolePath: consoleInfo?.relativePath,
    };

    await callTauri("write_file", {
      workspacePath: path,
      relativePath: QUALITY_PROMPT_PATH,
      content: prompt,
    });
    await saveQualityAuditManifest(path, manifest);
    pushLog("success", `Prepared quality audit input: ${QUALITY_PROMPT_PATH}`);
    return manifest;
  }

  async function snapshotGeneratedFiles(path: string): Promise<FileSnapshot> {
    return Promise.all(
      ["DESIGN.md", ARTIFACT_PATH, "src/styles.css"].map(async (relativePath) => {
        try {
          const content = await callTauri<string>("read_file", { workspacePath: path, relativePath });
          return { relativePath, content };
        } catch {
          return { relativePath, content: null };
        }
      }),
    );
  }

  async function restoreGeneratedFiles(path: string, snapshot: FileSnapshot) {
    for (const file of snapshot) {
      if (file.content === null) continue;
      await callTauri("write_file", {
        workspacePath: path,
        relativePath: file.relativePath,
        content: file.content,
      });
    }
  }

  function pushCommandResult(label: string, result: CommandResult) {
    pushLog(result.success ? "success" : "error", `${label}: exit ${result.code ?? "unknown"}`);
    if (result.sessionId) {
      pushLog("info", `${label}: Codex session ${shortSessionId(result.sessionId)} (${result.usedResume ? "resumed" : "fresh"})`);
    }
    if (result.stdout.trim()) pushLog("info", result.stdout);
    if (result.stderr.trim()) pushLog("error", result.stderr);
  }

  async function startPreview(path = workspacePath) {
    if (!path) throw new Error("Open or create a workspace first.");
    await ensurePreviewSelectionBridge(path);
    const info = await callTauri<PreviewInfo>("start_preview", {
      workspacePath: path,
      packageManager: settings.packageManager,
    });
    await savePreviewManifest(
      path,
      previewManifest("running", { url: info.url, pid: info.pid, statusCode: info.statusCode }),
    );
    setPreview(info);
    pushLog("success", `Preview started: ${info.url}`);
    return info;
  }

  async function startPreviewSafely() {
    setStep("preview", "active");
    try {
      const target = workspacePath || (await ensureWorkspace());
      await appendChatMessage(target, "assistant", "사용자 요청으로 Vite preview 서버를 시작합니다.", "tool", "info");
      const info = await startPreview(target);
      setStep("preview", "done");
      await appendChatMessage(target, "assistant", `미리보기가 실행 중입니다: ${info.url}`, "tool", "success");
    } catch (error) {
      setStep("preview", "error");
      if (workspacePath) {
        await savePreviewManifest(workspacePath, previewManifest("error", { error: textFromError(error) }));
        await appendChatMessage(workspacePath, "assistant", `미리보기 시작 실패: ${textFromError(error)}`, "tool", "error");
      }
      pushLog("error", `Preview unavailable: ${textFromError(error)}`);
    }
  }

  async function stopPreview() {
    await callTauri("stop_preview");
    if (workspacePath) {
      await savePreviewManifest(workspacePath, previewManifest("stopped"));
    }
    setPreview(null);
    setSelectionMode(false);
    pushLog("info", "Preview stopped.");
    if (workspacePath) await appendChatMessage(workspacePath, "assistant", "미리보기를 중지했습니다.", "tool", "info");
  }

  async function stopPreviewSafely() {
    try {
      await stopPreview();
    } catch (error) {
      pushLog("error", `Could not stop preview: ${textFromError(error)}`);
    }
  }

  async function verifyWorkspace(path: string) {
    const result = await callTauri<CommandResult>("verify_workspace", {
      workspacePath: path,
      packageManager: settings.packageManager,
    });
    pushCommandResult("Workspace verify", result);
    return result;
  }

  async function runCodexPrompt(path: string, prompt: string, label: string) {
    const session = await loadCodexSession(path);
    const model = cleanSettingValue(settings.codexModel);
    const effort = cleanSettingValue(settings.codexEffort);
    const runtime = settings.codexRuntime || "app-server";
    const args = {
      workspacePath: path,
      codexPath: settings.codexPath,
      prompt,
      resumeSessionId: session?.sessionId ?? null,
      model,
      effort,
    };
    let result: CommandResult;
    if (runtime === "app-server") {
      const runId = crypto.randomUUID();
      setCodexStream({ runId, status: "running", text: "", eventCount: 0 });
      try {
        result = await callTauri<CommandResult>("run_codex_app_server", { ...args, runId });
      } catch (error) {
        setCodexStream((current) =>
          current.runId === runId ? { ...current, status: "error", method: "designforge/fallback" } : current,
        );
        pushLog("error", `Codex app-server unavailable; retrying with codex exec: ${textFromError(error)}`);
        result = await callTauri<CommandResult>("run_codex", args);
      }
    } else {
      setCodexStream({ runId: "", status: "idle", text: "", eventCount: 0 });
      result = await callTauri<CommandResult>("run_codex", args);
    }
    pushCommandResult(label, result);
    await saveCodexSession(path, result, label);
    if (!result.success) throw new Error(`${label} failed.`);
    return result;
  }

  async function createHandoff(
    path: string,
    request: string,
    repairAttempts: number,
    verifyResult: CommandResult,
    currentPreview: PreviewManifest | null,
    screenshot: ScreenshotInfo | null,
    consoleInfo: ConsoleInfo | null,
    anchors: AnchorManifest | null,
    critique: CritiqueManifest | null,
  ) {
    let designSystem = "";
    let clarification = "";
    let designBrief = "";
    let designContext = "";
    let tokenManifest = "";
    let staticCheck = "";
    let qualityAudit = "";
    try {
      designSystem = await callTauri<string>("read_file", { workspacePath: path, relativePath: "DESIGN.md" });
    } catch {
      designSystem = "DESIGN.md was unavailable when the handoff was created.";
    }
    try {
      clarification = await callTauri<string>("read_file", { workspacePath: path, relativePath: CLARIFICATION_PATH });
    } catch {
      clarification = "";
    }
    try {
      designBrief = await callTauri<string>("read_file", { workspacePath: path, relativePath: BRIEF_PATH });
    } catch {
      designBrief = "";
    }
    try {
      designContext = await callTauri<string>("read_file", { workspacePath: path, relativePath: CONTEXT_PATH });
    } catch {
      designContext = "";
    }
    try {
      tokenManifest = await callTauri<string>("read_file", { workspacePath: path, relativePath: TOKEN_MANIFEST_PATH });
    } catch {
      tokenManifest = "";
    }
    try {
      staticCheck = await callTauri<string>("read_file", { workspacePath: path, relativePath: STATIC_CHECK_PATH });
    } catch {
      staticCheck = "";
    }
    try {
      qualityAudit = await callTauri<string>("read_file", { workspacePath: path, relativePath: QUALITY_AUDIT_PATH });
    } catch {
      qualityAudit = "";
    }
    const verificationStatus = verifyResult.stdout === "Verification not requested."
      ? "not requested"
      : verifyResult.success
        ? "passed"
        : "failed";

    const content = `# Handoff: Generated Screen

## Overview

DesignForge generated a React/Tailwind screen from this chat request:

${request}

## About The Design Files

These files are local design references and implementation starting points. Recreate the intent in the target codebase using its established framework, components, and data model rather than blindly copying markup.

## Fidelity

High-fidelity frontend screen generated from this request. TypeScript/Vite verification status is listed below.${repairAttempts ? ` Verification required ${repairAttempts} automatic repair pass.` : ""}

## DesignForge Quality Evidence

- Design brief: ${designBrief ? BRIEF_PATH : "not-created"}
- Context manifest: ${designContext ? CONTEXT_PATH : "not-created"}
- Token manifest: ${tokenManifest ? TOKEN_MANIFEST_PATH : "not-created"}
- Static source check: ${staticCheck ? STATIC_CHECK_PATH : "not-created"}
- Clarification analysis: ${clarification ? CLARIFICATION_PATH : "not-created"}
- Quality audit: ${qualityAudit ? QUALITY_AUDIT_PATH : "not-created"}

${clarification ? `### Clarification\n\n\`\`\`json\n${clarification.trim()}\n\`\`\`` : ""}

${designBrief ? `### Brief\n\n\`\`\`json\n${designBrief.trim()}\n\`\`\`` : ""}

${designContext ? `### Context\n\n\`\`\`json\n${designContext.trim()}\n\`\`\`` : ""}

${tokenManifest ? `### Tokens And Components\n\n\`\`\`json\n${tokenManifest.trim()}\n\`\`\`` : ""}

${staticCheck ? `### Static Source Check\n\n\`\`\`json\n${staticCheck.trim()}\n\`\`\`` : ""}

${qualityAudit ? `### Quality Audit\n\n\`\`\`json\n${qualityAudit.trim()}\n\`\`\`` : ""}

## Verification & Preview

- TypeScript/Vite verification: ${verificationStatus}
- Verification exit code: ${verifyResult.code ?? "unknown"}
- Preview status: ${currentPreview?.status ?? "not-started"}
${currentPreview?.url ? `- Preview URL: ${currentPreview.url}` : ""}
${currentPreview?.pid ? `- Preview PID: ${currentPreview.pid}` : ""}
${currentPreview?.statusCode ? `- Preview HTTP status: ${currentPreview.statusCode}` : ""}
${currentPreview?.error ? `- Preview error: ${currentPreview.error}` : ""}
- Preview manifest: ${PREVIEW_MANIFEST_PATH}
${screenshot ? `- Screenshot: ${screenshot.relativePath}` : ""}
${consoleInfo ? `- Console capture: ${consoleInfo.relativePath}` : ""}
${consoleInfo ? `- Console errors/warnings: ${consoleInfo.errorCount}/${consoleInfo.warningCount}` : ""}

## Comment Anchors

- Anchor manifest: ${ANCHORS_PATH}
- Anchor count: ${anchors?.anchors.length ?? 0}
${anchors?.anchors.length ? anchors.anchors.map((anchor) => `- @${anchor.id}: ${anchor.artifactPath}:${anchor.line}`).join("\n") : ""}

## Critique Loop

- Critique status: ${critique?.status ?? "not-created"}
${critique ? `- Critique prompt: ${critique.promptPath}` : ""}
${critique ? `- Critique manifest: ${critique.manifestPath}` : ""}
${critique?.screenshotPath ? `- Critique screenshot source: ${critique.screenshotPath}` : ""}
${critique?.consolePath ? `- Critique console source: ${critique.consolePath}` : ""}
${critique?.error ? `- Critique rollback reason: ${critique.error}` : ""}

## Screens / Views

- Generated Screen: ${ARTIFACT_PATH}
- Design system source: DESIGN.md
- Codex design protocol: CODEX_DESIGN.md

## Interactions & Behavior

Review ${ARTIFACT_PATH} for current interaction details. Preserve data-screen-label and any data-comment-anchor attributes during implementation.

## Design System

${designSystem.trim()}

## Files

- ${ARTIFACT_PATH}
- src/styles.css
- DESIGN.md
- CODEX_DESIGN.md
- ${ANCHORS_PATH}
- ${PROMPT_PATH}
- ${CLARIFICATION_PATH}
- ${CLARIFICATION_PROMPT_PATH}
- ${BRIEF_PATH}
- ${CONTEXT_PATH}
- ${TOKEN_MANIFEST_PATH}
- ${STATIC_CHECK_PATH}
${qualityAudit ? `- ${QUALITY_AUDIT_PATH}` : ""}
${qualityAudit ? `- ${QUALITY_PROMPT_PATH}` : ""}
${repairAttempts ? `- ${REPAIR_PROMPT_PATH}` : ""}
${critique ? `- ${critique.promptPath}` : ""}
${critique ? `- ${critique.manifestPath}` : ""}
${screenshot ? `- ${screenshot.relativePath}` : ""}
${consoleInfo ? `- ${consoleInfo.relativePath}` : ""}
`;

    await callTauri("write_file", {
      workspacePath: path,
      relativePath: HANDOFF_PATH,
      content,
    });
    pushLog("success", `Wrote handoff: ${HANDOFF_PATH}`);
    return HANDOFF_PATH;
  }

  async function exportHandoff(path: string) {
    const info = await callTauri<ExportInfo>("export_handoff", { workspacePath: path });
    pushLog("success", `Exported handoff: ${info.path}`);
    return info.path;
  }

  async function captureScreenshot(path: string, url: string) {
    const info = await callTauri<ScreenshotInfo>("capture_screenshot", { workspacePath: path, url });
    pushLog("success", `Captured screenshot: ${info.relativePath}`);
    return info;
  }

  async function captureConsole(path: string, url: string) {
    const info = await callTauri<ConsoleInfo>("capture_console", { workspacePath: path, url });
    pushLog(
      info.errorCount ? "error" : "success",
      `Captured console: ${info.relativePath} (${info.errorCount} errors, ${info.warningCount} warnings)`,
    );
    return info;
  }

  async function revealPath(relativePath: string) {
    if (!workspacePath) return;
    try {
      await callTauri("reveal_path", { workspacePath, relativePath });
      pushLog("info", `Opened in Explorer: ${relativePath}`);
    } catch (error) {
      pushLog("error", `Could not reveal file: ${textFromError(error)}`);
    }
  }

  async function ensureActionWorkspace() {
    const path = workspacePath || (await ensureWorkspace());
    await ensurePreviewSelectionBridge(path);
    await loadChatHistory(path);
    await loadActivityHistory(path);
    return path;
  }

  async function runManualVerify() {
    if (busy) return;
    setBusy(true);
    setStep("verify", "active");
    try {
      const path = await ensureActionWorkspace();
      await appendChatMessage(path, "assistant", "사용자 요청으로 TypeScript/Vite 검증을 실행합니다.", "tool", "info");
      const result = await verifyWorkspace(path);
      setManualVerifyResult(result);
      setStep("verify", result.success ? "done" : "error");
      await appendChatMessage(
        path,
        "assistant",
        result.success ? "검증이 통과했습니다." : `검증이 실패했습니다. exit ${result.code ?? "unknown"}`,
        "tool",
        result.success ? "success" : "error",
      );
    } catch (error) {
      const message = textFromError(error);
      setStep("verify", "error");
      pushLog("error", message);
      if (workspacePath) await appendChatMessage(workspacePath, "assistant", `검증 실행 중단: ${message}`, "tool", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runManualRepair() {
    if (busy || !manualVerifyResult || manualVerifyResult.success) return;
    setBusy(true);
    setStep("repair", "active");
    try {
      const path = await ensureActionWorkspace();
      await appendChatMessage(path, "assistant", "사용자 요청으로 검증 실패 수리 프롬프트를 Codex에 전달합니다.", "tool", "info");
      const repairPrompt = await writeRepairPrompt(path, latestRun?.request ?? "Manual DesignForge repair", manualVerifyResult);
      await runCodexPrompt(path, repairPrompt, "Codex repair");
      setStep("repair", "done");

      setStep("artifact", "active");
      await refreshFiles(path);
      await writeAnchorManifest(path);
      await writeTokenManifest(path);
      await writeStaticCheckManifest(path);
      await refreshFiles(path);
      setStep("artifact", "done");
      setManualVerifyResult(null);
      await appendChatMessage(path, "assistant", "수리 변경을 반영했습니다. 검증은 자동 재실행하지 않았습니다. 필요하면 검증 실행을 다시 누르세요.", "tool", "success");
    } catch (error) {
      const message = textFromError(error);
      setStep("repair", "error");
      pushLog("error", message);
      if (workspacePath) await appendChatMessage(workspacePath, "assistant", `수리 실행 중단: ${message}`, "tool", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runManualCapture() {
    if (busy || !preview) return;
    setBusy(true);
    setStep("console", "active");
    setStep("screenshot", "active");
    try {
      const path = await ensureActionWorkspace();
      await appendChatMessage(path, "assistant", "사용자 요청으로 콘솔 로그와 스크린샷을 캡처합니다.", "tool", "info");

      try {
        const consoleCapture = await captureConsole(path, preview.url);
        setManualConsoleInfo(consoleCapture);
        setStep("console", "done");
      } catch (error) {
        setStep("console", "error");
        pushLog("error", `Console capture unavailable: ${textFromError(error)}`);
      }

      try {
        const screenshotCapture = await captureScreenshot(path, preview.url);
        setManualScreenshotInfo(screenshotCapture);
        setStep("screenshot", "done");
      } catch (error) {
        setStep("screenshot", "error");
        pushLog("error", `Screenshot unavailable: ${textFromError(error)}`);
      }

      await refreshFiles(path);
      await appendChatMessage(path, "assistant", "캡처 작업이 끝났습니다. 결과 파일은 아티팩트 목록과 시스템 로그에서 확인할 수 있습니다.", "tool", "success");
    } catch (error) {
      const message = textFromError(error);
      setStep("console", "error");
      setStep("screenshot", "error");
      pushLog("error", message);
      if (workspacePath) await appendChatMessage(workspacePath, "assistant", `캡처 실행 중단: ${message}`, "tool", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runManualCritique() {
    if (busy) return;
    setBusy(true);
    setStep("critique", "active");
    try {
      const path = await ensureActionWorkspace();
      await appendChatMessage(path, "assistant", "사용자 요청으로 스크린샷 기반 크리틱 패스를 시작합니다.", "tool", "info");

      let consoleInfo = manualConsoleInfo;
      let screenshot = manualScreenshotInfo;

      if (preview?.url && !consoleInfo) {
        setStep("console", "active");
        try {
          consoleInfo = await captureConsole(path, preview.url);
          setManualConsoleInfo(consoleInfo);
          setStep("console", "done");
        } catch (error) {
          setStep("console", "error");
          pushLog("error", `Console capture unavailable before critique: ${textFromError(error)}`);
        }
      }

      if (preview?.url && !screenshot) {
        setStep("screenshot", "active");
        try {
          screenshot = await captureScreenshot(path, preview.url);
          setManualScreenshotInfo(screenshot);
          setStep("screenshot", "done");
        } catch (error) {
          setStep("screenshot", "error");
          pushLog("error", `Screenshot unavailable before critique: ${textFromError(error)}`);
        }
      }

      let critique = await writeCritiquePrompt(path, latestRun?.request ?? "Manual DesignForge critique", screenshot, consoleInfo);
      setManualCritique(critique);
      if (!screenshot) {
        setStep("critique", "error");
        await appendChatMessage(
          path,
          "assistant",
          "스크린샷이 없어 크리틱 프롬프트만 준비했습니다. 미리보기를 시작하고 캡처한 뒤 다시 실행하세요.",
          "tool",
          "error",
        );
        await refreshFiles(path);
        return;
      }

      const snapshot = await snapshotGeneratedFiles(path);
      try {
        const critiquePrompt = await callTauri<string>("read_file", {
          workspacePath: path,
          relativePath: CRITIQUE_PROMPT_PATH,
        });
        await runCodexPrompt(path, critiquePrompt, "Codex critique");

        setStep("verify", "active");
        const verifyResult = await verifyWorkspace(path);
        setManualVerifyResult(verifyResult);
        if (!verifyResult.success) {
          setStep("verify", "error");
          throw new Error("Critique pass broke workspace verification.");
        }
        setStep("verify", "done");

        critique = { ...critique, status: "applied", updatedAt: new Date().toISOString() };
        await saveCritiqueManifest(path, critique);
        setManualCritique(critique);
        await refreshFiles(path);
        await writeAnchorManifest(path);
        await writeTokenManifest(path);
        await writeStaticCheckManifest(path);
        await refreshFiles(path);
        setStep("critique", "done");
        await appendChatMessage(path, "assistant", "크리틱 패스를 적용했고 검증까지 통과했습니다.", "tool", "success");
      } catch (error) {
        await restoreGeneratedFiles(path, snapshot);
        critique = {
          ...critique,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: textFromError(error),
        };
        await saveCritiqueManifest(path, critique);
        setManualCritique(critique);
        setStep("critique", "error");
        await refreshFiles(path);
        await appendChatMessage(path, "assistant", `크리틱 변경을 롤백했습니다: ${textFromError(error)}`, "tool", "error");
      }
    } catch (error) {
      const message = textFromError(error);
      setStep("critique", "error");
      pushLog("error", message);
      if (workspacePath) await appendChatMessage(workspacePath, "assistant", `크리틱 실행 중단: ${message}`, "tool", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runManualQualityAudit() {
    if (busy) return;
    setBusy(true);
    setStep("quality", "active");
    try {
      const path = await ensureActionWorkspace();
      await appendChatMessage(path, "assistant", "사용자 요청으로 디자인 품질 검사를 시작합니다.", "tool", "info");

      let consoleInfo = manualConsoleInfo;
      let screenshot = manualScreenshotInfo;

      if (preview?.url && !consoleInfo) {
        setStep("console", "active");
        try {
          consoleInfo = await captureConsole(path, preview.url);
          setManualConsoleInfo(consoleInfo);
          setStep("console", "done");
        } catch (error) {
          setStep("console", "error");
          pushLog("error", `Console capture unavailable before quality audit: ${textFromError(error)}`);
        }
      }

      if (preview?.url && !screenshot) {
        setStep("screenshot", "active");
        try {
          screenshot = await captureScreenshot(path, preview.url);
          setManualScreenshotInfo(screenshot);
          setStep("screenshot", "done");
        } catch (error) {
          setStep("screenshot", "error");
          pushLog("error", `Screenshot unavailable before quality audit: ${textFromError(error)}`);
        }
      }

      let audit = await writeQualityAuditPrompt(path, latestRun?.request ?? "Manual DesignForge quality audit", screenshot, consoleInfo);
      const snapshot = await snapshotGeneratedFiles(path);

      try {
        const qualityPrompt = await callTauri<string>("read_file", {
          workspacePath: path,
          relativePath: QUALITY_PROMPT_PATH,
        });
        await runCodexPrompt(path, qualityPrompt, "Codex quality audit");

        setStep("verify", "active");
        const verifyResult = await verifyWorkspace(path);
        setManualVerifyResult(verifyResult);
        if (!verifyResult.success) {
          setStep("verify", "error");
          throw new Error("Quality audit pass broke workspace verification.");
        }
        setStep("verify", "done");

        try {
          const authored = await readQualityAuditManifest(path);
          audit = {
            ...audit,
            ...authored,
            status: authored.status === "failed" ? "failed" : authored.status === "no-change" ? "no-change" : "applied",
            updatedAt: new Date().toISOString(),
            verificationPassed: true,
          };
        } catch {
          audit = { ...audit, status: "applied", updatedAt: new Date().toISOString(), verificationPassed: true };
        }
        await saveQualityAuditManifest(path, audit);
        await refreshFiles(path);
        await writeAnchorManifest(path);
        await writeTokenManifest(path);
        await writeStaticCheckManifest(path);
        await refreshFiles(path);
        setStep("quality", audit.status === "failed" ? "error" : "done");
        await appendChatMessage(path, "assistant", `품질 검사가 완료됐습니다. status=${audit.status}.`, "tool", "success");
      } catch (error) {
        await restoreGeneratedFiles(path, snapshot);
        audit = {
          ...audit,
          status: "failed",
          updatedAt: new Date().toISOString(),
          verificationPassed: false,
          error: textFromError(error),
        };
        await saveQualityAuditManifest(path, audit);
        setStep("quality", "error");
        await refreshFiles(path);
        await appendChatMessage(path, "assistant", `품질 검사 변경을 롤백했습니다: ${textFromError(error)}`, "tool", "error");
      }
    } catch (error) {
      const message = textFromError(error);
      setStep("quality", "error");
      pushLog("error", message);
      if (workspacePath) await appendChatMessage(workspacePath, "assistant", `품질 검사 중단: ${message}`, "tool", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runManualExport() {
    if (busy) return;
    setBusy(true);
    setStep("handoff", "active");
    try {
      const path = await ensureActionWorkspace();
      await appendChatMessage(path, "assistant", "사용자 요청으로 핸드오프와 export 패키지를 생성합니다.", "tool", "info");
      const anchors = anchorManifest ?? (await loadAnchorManifest(path)) ?? (await writeAnchorManifest(path));
      await writeTokenManifest(path);
      await writeStaticCheckManifest(path);
      await refreshFiles(path);
      const previewState = preview
        ? previewManifest("running", { url: preview.url, pid: preview.pid, statusCode: preview.statusCode })
        : null;
      const verifyResult =
        manualVerifyResult ??
        ({
          success: false,
          code: null,
          stdout: "Verification not requested.",
          stderr: "",
        } satisfies CommandResult);

      const handoffPath = await createHandoff(
        path,
        latestRun?.request ?? "Manual DesignForge handoff",
        0,
        verifyResult,
        previewState,
        manualScreenshotInfo,
        manualConsoleInfo,
        anchors,
        manualCritique,
      );
      setStep("handoff", "done");

      setStep("export", "active");
      const exportPath = await exportHandoff(path);
      setManualExportPath(exportPath);
      setStep("export", "done");
      await refreshFiles(path);
      await appendChatMessage(path, "assistant", `핸드오프 ${handoffPath}와 export 패키지를 생성했습니다.`, "tool", "success");
    } catch (error) {
      const message = textFromError(error);
      setStep("handoff", "error");
      setStep("export", "error");
      pushLog("error", message);
      if (workspacePath) await appendChatMessage(workspacePath, "assistant", `export 생성 중단: ${message}`, "tool", "error");
    } finally {
      setBusy(false);
    }
  }

  async function listGeneratedImageFiles(path: string) {
    const workspaceFiles = await callTauri<WorkspaceFile[]>("list_workspace_files", { workspacePath: path });
    return workspaceFiles
      .filter((file) => !file.isDirectory && file.relativePath.startsWith(`${GENERATED_IMAGES_DIR}/`) && /\.(png|jpe?g|webp|gif|avif)$/i.test(file.relativePath))
      .map((file) => file.relativePath)
      .sort();
  }

  async function runImageGenerationRequest(rawRequest: string, options: Pick<RunRequestOptions, "attachments" | "displayRequest" | "recordRequest"> = {}) {
    const request = rawRequest.trim();
    if (!request || busy) return;

    setInput("");
    setChatPanelTab("conversation");
    setBusy(true);
    setSteps(START_STEPS);
    setManualVerifyResult(null);
    setManualConsoleInfo(null);
    setManualScreenshotInfo(null);
    setManualCritique(null);
    setManualQualityAudit(null);
    setManualExportPath("");
    const attachments = options.attachments ?? [];
    const requestForCodex = requestWithAttachments(request, attachments);
    const displayRequest = options.displayRequest ?? request;
    const recordRequest = options.recordRequest ?? displayRequest;
    const startedAt = new Date().toISOString();
    let path = "";
    let lastResult: CommandResult | null = null;

    try {
      setStep("context", "active");
      path = await ensureWorkspace(recordRequest);
      await ensurePreviewSelectionBridge(path);
      await refreshFiles(path);
      await loadRunHistory(path);
      await loadCodexSession(path);
      await loadChatHistory(path);
      await loadActivityHistory(path);
      await appendChatMessage(path, "user", displayRequest, "chat", undefined, attachments);
      await appendChatMessage(path, "assistant", "Codex 이미지 생성 기능으로 에셋을 만들겠습니다.", "status", "info");
      const context = await writeDesignContextManifest(path);
      setLatestContext(context);
      setStep("context", "done");

      setStep("prompt", "active");
      const prompt = await writeImageGenerationPrompt(path, requestForCodex, context);
      await appendChatMessage(path, "assistant", `${IMAGE_PROMPT_PATH}에 이미지 생성 프롬프트를 준비했습니다.`, "tool", "success");
      setStep("prompt", "done");

      setStep("codex", "active");
      const check = await callTauri<CommandResult>("check_codex", { codexPath: settings.codexPath });
      pushCommandResult("Codex check", check);
      if (!check.success) throw new Error("Codex CLI is not available.");
      lastResult = await runCodexPrompt(path, prompt, "Codex image generation");
      setStep("codex", "done");

      setStep("artifact", "active");
      await refreshFiles(path);
      const imageFiles = await listGeneratedImageFiles(path);
      await callTauri("write_file", {
        workspacePath: path,
        relativePath: GENERATED_IMAGES_PATH,
        content: JSON.stringify(
          {
            updatedAt: new Date().toISOString(),
            request: recordRequest,
            promptPath: IMAGE_PROMPT_PATH,
            imageFiles,
            sourcePrompt: requestForCodex,
            notes: imageFiles.length
              ? [`${imageFiles.length} generated image file(s) found in ${GENERATED_IMAGES_DIR}.`]
              : [`No generated image files were detected under ${GENERATED_IMAGES_DIR}. Check Codex output for details.`],
          },
          null,
          2,
        ),
      });
      await refreshFiles(path);
      setStep("artifact", "done");

      const runId = crypto.randomUUID();
      await recordRun(path, {
        id: runId,
        request: recordRequest,
        status: "success",
        startedAt,
        finishedAt: new Date().toISOString(),
        promptPath: IMAGE_PROMPT_PATH,
        artifactPath: GENERATED_IMAGES_DIR,
        contextPath: CONTEXT_PATH,
        codexExitCode: lastResult.code,
        codexSessionId: lastResult.sessionId ?? codexSession?.sessionId,
        codexUsedResume: lastResult.usedResume,
        stdoutPreview: lastResult.stdout.trim().slice(0, 1000),
        stderrPreview: lastResult.stderr.trim().slice(0, 1000),
        repairAttempts: 0,
      });
      await appendChatMessage(
        path,
        "assistant",
        imageFiles.length
          ? `이미지 생성이 완료됐습니다. ${imageFiles.map((file) => `\`${file}\``).join(", ")}`
          : `이미지 생성 턴은 완료됐지만 ${GENERATED_IMAGES_DIR}에서 결과 파일을 찾지 못했습니다. Codex 출력과 ${GENERATED_IMAGES_PATH}를 확인하세요.`,
        "summary",
        imageFiles.length ? "success" : "info",
      );
      await refreshProjects();
    } catch (error) {
      const message = textFromError(error);
      setSteps((current) => current.map((step) => (step.status === "active" ? { ...step, status: "error" } : step)));
      pushLog("error", message);
      if (path) {
        const runId = crypto.randomUUID();
        await recordRun(path, {
          id: runId,
          request: recordRequest,
          status: "error",
          startedAt,
          finishedAt: new Date().toISOString(),
          promptPath: IMAGE_PROMPT_PATH,
          artifactPath: GENERATED_IMAGES_DIR,
          contextPath: CONTEXT_PATH,
          codexExitCode: lastResult?.code ?? null,
          codexSessionId: lastResult?.sessionId ?? codexSession?.sessionId,
          codexUsedResume: lastResult?.usedResume,
          stdoutPreview: lastResult?.stdout.trim().slice(0, 1000) ?? "",
          stderrPreview: lastResult?.stderr.trim().slice(0, 1000) ?? "",
          repairAttempts: 0,
          error: message,
        });
        await appendChatMessage(path, "assistant", `이미지 생성이 중단됐습니다: ${message}`, "summary", "error");
      } else {
        pushMessage("assistant", `이미지 생성이 중단됐습니다: ${message}`, "summary", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function startGuidedClarification(request: string, attachments: AttachmentInfo[]) {
    setInput("");
    setChatPanelTab("conversation");
    setBusy(true);
    const requestForCodex = requestWithAttachments(request, attachments);
    try {
      const path = await ensureWorkspace(request);
      await ensurePreviewSelectionBridge(path);
      await refreshFiles(path);
      await loadRunHistory(path);
      await loadChatHistory(path);
      await loadActivityHistory(path);
      await loadAnchorManifest(path);
      await appendChatMessage(path, "user", request, "chat", undefined, attachments);
      await appendChatMessage(path, "assistant", "요청과 현재 디자인 시스템을 먼저 분석한 뒤 필요한 질문을 만들겠습니다.", "status", "info");

      const designSystemMarkdown = await readDesignSystem(path);
      const designSystemHealth = inspectDesignSystem(designSystemMarkdown);
      const context = await writeDesignContextManifest(path);
      const prompt = await writeClarificationPrompt(path, requestForCodex, context, designSystemHealth, designSystemMarkdown);
      await runCodexPrompt(path, prompt, "Codex design preflight");

      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CLARIFICATION_PATH });
      const clarification = normalizeClarificationManifest(JSON.parse(raw), requestForCodex);
      const nextClarification = {
        ...clarification,
        mode: "guided" as const,
        request: requestForCodex,
        promptPath: CLARIFICATION_PROMPT_PATH,
        manifestPath: CLARIFICATION_PATH,
        updatedAt: new Date().toISOString(),
      };
      await callTauri("write_file", {
        workspacePath: path,
        relativePath: CLARIFICATION_PATH,
        content: JSON.stringify(nextClarification, null, 2),
      });
      setLatestClarification(nextClarification);
      await refreshFiles(path);

      if (nextClarification.shouldAskQuestions) {
        setGuidedDraft({ request, clarification: nextClarification, attachments, createdAt: new Date().toISOString() });
        await appendChatMessage(path, "assistant", buildClarificationChatMessage(nextClarification), "chat", "info");
        pushLog("info", `AI preflight produced ${nextClarification.questions.length} tailored questions.`);
        return nextClarification;
      }

      await appendChatMessage(
        path,
        "assistant",
        "분석 결과, 추가 질문 없이 현재 맥락으로 진행할 수 있습니다. 바로 생성합니다.",
        "status",
        "info",
      );
      pushLog("info", "AI preflight skipped questions because context was sufficient.");
      return nextClarification;
    } catch (error) {
      const message = textFromError(error);
      pushLog("error", `Design preflight failed: ${message}`);
      const failed: DesignClarificationManifest = {
        status: "failed",
        updatedAt: new Date().toISOString(),
        request: requestForCodex,
        mode: "guided",
        promptPath: CLARIFICATION_PROMPT_PATH,
        manifestPath: CLARIFICATION_PATH,
        shouldAskQuestions: false,
        confidence: 0,
        requestType: "unknown",
        interpretation: {
          product: "",
          userGoal: "",
          targetSurface: "",
          likelyAudience: "",
          requestedFidelity: "",
          designSystemNeed: "",
        },
        knownContext: [],
        missingContext: [],
        questions: [],
        assumptionsIfSkipped: [],
        designSystemFocus: [],
        error: message,
      };
      setLatestClarification(failed);
      setGuidedDraft({ request, clarification: failed, attachments, createdAt: new Date().toISOString() });
      if (workspacePath) {
        await appendChatMessage(
          workspacePath,
          "assistant",
          `질문 생성이 실패했습니다: ${message}\n\n원래 요청은 보존했습니다. 입력창에 "진행해"처럼 답하면 추가 질문 없이 원 요청 기준으로 생성을 진행합니다.`,
          "tool",
          "error",
        );
      } else {
        pushMessage(
          "assistant",
          `질문 생성이 실패했습니다: ${message}\n\n원래 요청은 보존했습니다. 입력창에 "진행해"처럼 답하면 추가 질문 없이 원 요청 기준으로 생성을 진행합니다.`,
          "tool",
          "error",
        );
      }
      return failed;
    } finally {
      setBusy(false);
    }
  }

  async function runChat() {
    const request = input.trim();
    if ((!request && pendingAttachments.length === 0) || busy) return;
    const attachments = pendingAttachments;
    const effectiveRequest = request || "첨부파일을 바탕으로 디자인을 생성하세요.";
    const targetedAnchorId = anchorFromRequest(effectiveRequest) || selectedAnchorId || previewSelection?.anchorId || "";

    if (!guidedDraft) {
      setPendingAttachments([]);
      if (isImageGenerationRequest(effectiveRequest)) {
        await runImageGenerationRequest(effectiveRequest, { attachments });
        return;
      }

      if (targetedAnchorId) {
        const directReplacement = parseDirectReplacement(effectiveRequest);
        if (directReplacement) {
          const anchor = anchorManifest?.anchors.find((item) => item.id === targetedAnchorId);
          const screenLabel = previewSelection?.screenLabel || anchor?.screenLabel || "Generated Screen";
          const applied = await runDirectSourceSplice(targetedAnchorId, screenLabel, effectiveRequest, directReplacement);
          if (applied) {
            setInput("");
            return;
          }
        }
      }

      if (isSmallRevisionRequest(effectiveRequest, Boolean(targetedAnchorId), attachments.length > 0)) {
        const anchor = targetedAnchorId ? anchorManifest?.anchors.find((item) => item.id === targetedAnchorId) : undefined;
        const screenLabel = previewSelection?.screenLabel || anchor?.screenLabel || "Generated Screen";
        const targetRequest =
          targetedAnchorId && !anchorFromRequest(effectiveRequest)
            ? buildTargetedComponentRequest(targetedAnchorId, screenLabel, effectiveRequest, previewSelection)
            : effectiveRequest;
        await runDesignRequest(targetRequest, {
          displayRequest: effectiveRequest,
          commentNote: effectiveRequest,
          anchorId: targetedAnchorId || undefined,
          screenLabel,
          attachments,
        });
        return;
      }

      const clarification = await startGuidedClarification(effectiveRequest, attachments);
      if (clarification.status !== "failed" && !clarification.shouldAskQuestions) {
        await runDesignRequest(effectiveRequest, { clarification, attachments });
      }
      return;
    }

    if (guidedDraft) {
      const isFailedPreflight = guidedDraft.clarification.status === "failed";
      const combinedAttachments = [...guidedDraft.attachments, ...attachments];
      setPendingAttachments([]);
      const combinedRequest = isFailedPreflight
        ? `${guidedDraft.request}

DesignForge preflight failed:
${JSON.stringify(guidedDraft.clarification, null, 2)}

User follow-up after preflight failure:
${effectiveRequest}

Proceed from the original request. Infer missing context conservatively and record assumptions in DESIGN.md.`
        : `${guidedDraft.request}

DesignForge preflight analysis:
${JSON.stringify(guidedDraft.clarification, null, 2)}

User answers to preflight questions:
${effectiveRequest}`;
      const recordRequest = `${guidedDraft.request}

질문 답변:
${effectiveRequest}`;
      const clarification = guidedDraft.clarification;
      setGuidedDraft(null);
      await runDesignRequest(combinedRequest, {
        displayRequest: effectiveRequest,
        recordRequest,
        commentNote: recordRequest,
        clarification,
        attachments: combinedAttachments,
      });
      return;
    }

    setPendingAttachments([]);
    await runDesignRequest(effectiveRequest, { attachments });
  }

  async function runDesignRequest(rawRequest: string, options: RunRequestOptions = {}) {
    const request = rawRequest.trim();
    if (!request || busy) return;

    setInput("");
    setChatPanelTab("conversation");
    setBusy(true);
    setSteps(START_STEPS);
    setManualVerifyResult(null);
    setManualConsoleInfo(null);
    setManualScreenshotInfo(null);
    setManualCritique(null);
    setManualQualityAudit(null);
    setManualExportPath("");
    const displayRequest = options.displayRequest ?? request;
    const recordRequest = options.recordRequest ?? displayRequest;
    const commentNote = options.commentNote ?? displayRequest;
    const attachments = options.attachments ?? [];
    const requestForCodex = requestWithAttachments(request, attachments);
    const commentAnchorId = options.anchorId ?? anchorFromRequest(request);
    const commentScreenLabel = options.screenLabel ?? "Generated Screen";

    const startedAt = new Date().toISOString();
    let path = "";
    let lastResult: CommandResult | null = null;
    let repairAttempts = 0;
    let anchors: AnchorManifest | null = null;
    let brief: DesignBriefManifest | null = null;
    let context: DesignContextManifest | null = null;
    let tokenManifest: DesignTokenManifest | null = null;
    let staticCheck: StaticCheckManifest | null = null;
    const clarification = options.clarification ?? latestClarification;

    try {
      setStep("context", "active");
      path = await ensureWorkspace(recordRequest);
      await ensurePreviewSelectionBridge(path);
      await refreshFiles(path);
      await loadRunHistory(path);
      await loadCodexSession(path);
      await loadAnchorManifest(path);
      await loadChatHistory(path);
      await loadActivityHistory(path);
      if (clarification) setLatestClarification(clarification);
      else await loadDesignClarification(path);
      await loadQualityAudit(path);
      await appendChatMessage(path, "user", displayRequest, "chat", undefined, attachments);
      await appendChatMessage(path, "assistant", "워크스페이스와 이전 DesignForge 대화를 연결했습니다.", "status", "info");
      setStep("context", "done");

      setStep("design", "active");
      await appendChatMessage(path, "assistant", "DESIGN.md를 섹션별로 검사하고 부족한 품질 기준을 보강합니다.", "status", "info");
      const designHealth = await prepareDesignSystem(path, requestForCodex);
      setStep("design", "done");

      setStep("brief", "active");
      context = await writeDesignContextManifest(path);
      brief = await writeDesignBriefManifest(path, requestForCodex, designHealth, context, clarification);
      setLatestContext(context);
      setLatestBrief(brief);
      await appendChatMessage(
        path,
        "assistant",
        `Design Brief를 작성했습니다. mode=${brief.mode}, health=${brief.designSystemHealth.score}/100.`,
        "tool",
        "success",
      );
      setStep("brief", "done");

      setStep("prompt", "active");
      const prompt = await writePrompt(path, requestForCodex, brief, context, clarification);
      await appendChatMessage(path, "assistant", `${PROMPT_PATH}에 Codex 전달 프롬프트를 준비했습니다.`, "tool", "success");
      setStep("prompt", "done");

      setStep("codex", "active");
      await appendChatMessage(path, "assistant", "Codex CLI에 변경 요청을 전달합니다.", "status", "info");
      const check = await callTauri<CommandResult>("check_codex", { codexPath: settings.codexPath });
      pushCommandResult("Codex check", check);
      if (!check.success) throw new Error("Codex CLI is not available.");

      const result = await runCodexPrompt(path, prompt, "Codex run");
      lastResult = result;
      setStep("codex", "done");

      setStep("artifact", "active");
      await refreshFiles(path);
      anchors = await writeAnchorManifest(path);
      tokenManifest = await writeTokenManifest(path);
      staticCheck = await writeStaticCheckManifest(path);
      if (context) {
        context = {
          ...context,
          updatedAt: new Date().toISOString(),
          tokenManifestPath: TOKEN_MANIFEST_PATH,
          staticCheckPath: STATIC_CHECK_PATH,
          anchorCount: anchors.anchors.length,
          notes: uniqueLimited(
            [
              ...context.notes.filter((note) => !note.includes(TOKEN_MANIFEST_PATH) && !note.includes(STATIC_CHECK_PATH)),
              `${TOKEN_MANIFEST_PATH} records ${tokenManifest.colors.length} color values, ${tokenManifest.typography.length} typography signals, and ${tokenManifest.componentInventory.length} component anchors.`,
              `${STATIC_CHECK_PATH} status is ${staticCheck.status}.`,
            ],
            24,
          ),
        };
        await callTauri("write_file", {
          workspacePath: path,
          relativePath: CONTEXT_PATH,
          content: JSON.stringify(context, null, 2),
        });
        setLatestContext(context);
      }
      await refreshFiles(path);
      setStep("artifact", "done");

      const runId = crypto.randomUUID();
      await recordRun(path, {
        id: runId,
        request: recordRequest,
        status: "success",
        startedAt,
        finishedAt: new Date().toISOString(),
        promptPath: PROMPT_PATH,
        artifactPath: ARTIFACT_PATH,
        anchorManifestPath: ANCHORS_PATH,
        anchorCount: anchors.anchors.length,
        briefPath: BRIEF_PATH,
        contextPath: CONTEXT_PATH,
        clarificationPath: clarification ? CLARIFICATION_PATH : undefined,
        tokenManifestPath: tokenManifest ? TOKEN_MANIFEST_PATH : undefined,
        staticCheckPath: staticCheck ? STATIC_CHECK_PATH : undefined,
        staticCheckStatus: staticCheck?.status,
        codexExitCode: lastResult?.code ?? result.code,
        codexSessionId: (lastResult ?? result).sessionId ?? codexSession?.sessionId,
        codexUsedResume: (lastResult ?? result).usedResume,
        stdoutPreview: (lastResult ?? result).stdout.trim().slice(0, 1000),
        stderrPreview: (lastResult ?? result).stderr.trim().slice(0, 1000),
        repairAttempts,
      });
      await appendComment(path, {
        id: crypto.randomUUID(),
        artifactPath: ARTIFACT_PATH,
        screenLabel: commentScreenLabel,
        note: commentNote,
        source: "chat",
        anchorId: commentAnchorId,
        status: "applied",
        createdAt: new Date().toISOString(),
        runId,
      });
      await appendChatMessage(
        path,
        "assistant",
        `기본 생성이 완료됐습니다. ${ARTIFACT_PATH}와 ${ANCHORS_PATH}를 갱신했고, 검증/프리뷰/캡처/크리틱/export는 오른쪽 작업 버튼에서 필요할 때 실행합니다.`,
        "summary",
        "success",
      );
    } catch (error) {
      const message = textFromError(error);
      setSteps((current) =>
        current.map((step) => (step.status === "active" ? { ...step, status: "error" } : step)),
      );
      pushLog("error", message);
      if (path) {
        const runId = crypto.randomUUID();
        await recordRun(path, {
          id: runId,
        request: recordRequest,
          status: "error",
          startedAt,
          finishedAt: new Date().toISOString(),
          promptPath: PROMPT_PATH,
          artifactPath: ARTIFACT_PATH,
          anchorManifestPath: anchors ? ANCHORS_PATH : undefined,
          anchorCount: anchors?.anchors.length,
          briefPath: brief ? BRIEF_PATH : undefined,
          contextPath: context ? CONTEXT_PATH : undefined,
          clarificationPath: clarification ? CLARIFICATION_PATH : undefined,
          tokenManifestPath: tokenManifest ? TOKEN_MANIFEST_PATH : undefined,
          staticCheckPath: staticCheck ? STATIC_CHECK_PATH : undefined,
          staticCheckStatus: staticCheck?.status,
          codexExitCode: lastResult?.code ?? null,
          codexSessionId: lastResult?.sessionId ?? codexSession?.sessionId,
          codexUsedResume: lastResult?.usedResume,
          stdoutPreview: lastResult?.stdout.trim().slice(0, 1000) ?? "",
          stderrPreview: lastResult?.stderr.trim().slice(0, 1000) ?? "",
          repairAttempts,
          error: message,
        });
        await appendComment(path, {
          id: crypto.randomUUID(),
          artifactPath: ARTIFACT_PATH,
          screenLabel: commentScreenLabel,
          note: commentNote,
          source: "chat",
          anchorId: commentAnchorId,
          status: "pending",
          createdAt: new Date().toISOString(),
          runId,
        });
      }
      if (path) {
        await appendChatMessage(path, "assistant", `중단됐습니다: ${message}`, "summary", "error");
      } else {
        pushMessage("assistant", `중단됐습니다: ${message}`, "summary", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function runDirectArtifactPatch(
    anchorId: string,
    screenLabel: string,
    note: string,
    promptLabel: string,
    successMessage: (patch: DirectSourcePatch) => string,
    applyPatchToSource: (source: string) => DirectSourcePatch | null,
  ) {
    if (busy) return false;

    setBusy(true);
    setSteps(START_STEPS);
    setManualVerifyResult(null);
    setManualConsoleInfo(null);
    setManualScreenshotInfo(null);
    setManualCritique(null);
    setManualQualityAudit(null);
    setManualExportPath("");
    const startedAt = new Date().toISOString();
    let path = "";

    try {
      setStep("context", "active");
      path = await ensureActionWorkspace();
      setStep("context", "done");

      setStep("artifact", "active");
      const source = await callTauri<string>("read_file", { workspacePath: path, relativePath: ARTIFACT_PATH });
      const applied = applyPatchToSource(source);
      if (!applied) {
        setStep("artifact", "idle");
        pushLog("info", `${promptLabel} skipped because the selected source location was not unique enough.`);
        await appendChatMessage(
          path,
          "assistant",
          "직접 수정 위치가 명확하지 않아 자동 적용하지 않았습니다. 아래 '선택 영역 수정 내용'으로 보내면 Codex가 좁게 수정합니다.",
          "tool",
          "info",
        );
        return false;
      }

      await callTauri("write_file", {
        workspacePath: path,
        relativePath: ARTIFACT_PATH,
        content: applied.nextSource,
      });
      await appendChatMessage(path, "user", `@${anchorId} ${note}`, "chat");
      await refreshFiles(path);
      const anchors = await writeAnchorManifest(path);
      const tokenManifest = await writeTokenManifest(path);
      const staticCheck = await writeStaticCheckManifest(path);
      await refreshFiles(path);
      setStep("artifact", "done");

      const runId = crypto.randomUUID();
      await recordRun(path, {
        id: runId,
        request: `@${anchorId} ${note}`,
        status: "success",
        startedAt,
        finishedAt: new Date().toISOString(),
        promptPath: promptLabel,
        artifactPath: ARTIFACT_PATH,
        anchorManifestPath: ANCHORS_PATH,
        anchorCount: anchors.anchors.length,
        tokenManifestPath: TOKEN_MANIFEST_PATH,
        staticCheckPath: STATIC_CHECK_PATH,
        staticCheckStatus: staticCheck.status,
        codexExitCode: null,
        stdoutPreview: `${applied.summary} Tokens: ${tokenManifest.colors.length} colors.`,
        stderrPreview: "",
        repairAttempts: 0,
      });
      await appendComment(path, {
        id: crypto.randomUUID(),
        artifactPath: ARTIFACT_PATH,
        screenLabel,
        note,
        source: "chat",
        anchorId,
        status: "applied",
        createdAt: new Date().toISOString(),
        runId,
      });
      await appendChatMessage(path, "assistant", successMessage(applied), "tool", "success");
      await loadRunHistory(path);
      await refreshProjects();
      return true;
    } catch (error) {
      pushLog("error", `${promptLabel} failed: ${textFromError(error)}`);
      if (path) await appendChatMessage(path, "assistant", `직접 수정은 실패해서 Codex 경로로 이어갑니다: ${textFromError(error)}`, "tool", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runDirectSourceSplice(anchorId: string, screenLabel: string, note: string, replacement: { oldText: string; newText: string }) {
    return runDirectArtifactPatch(
      anchorId,
      screenLabel,
      note,
      "direct-source-splice",
      (patch) => `선택 영역의 문구를 직접 수정했습니다. ${ARTIFACT_PATH}:${patch.line}`,
      (source) => applyAnchoredTextReplacement(source, anchorId, replacement.oldText, replacement.newText),
    );
  }

  async function runDirectSelectedTextEdit() {
    const anchorId = selectedAnchorId || previewSelection?.anchorId || "";
    const selectedText = previewSelection?.text.trim() || "";
    const nextText = selectedTextDraft.trim();
    if (!anchorId || !selectedText || !nextText || busy || nextText === selectedText) return;
    const screenLabel = previewSelection?.screenLabel || selectedAnchor?.screenLabel || "Generated Screen";
    const note = `직접 텍스트 수정: ${selectedText} -> ${nextText}`;
    const applied = await runDirectArtifactPatch(
      anchorId,
      screenLabel,
      note,
      "direct-selected-text-edit",
      (patch) => `선택 텍스트를 직접 수정했습니다. ${ARTIFACT_PATH}:${patch.line}`,
      (source) => applyAnchoredLineBreakEdit(source, anchorId, selectedText, nextText),
    );
    if (applied) setComponentEdit("");
  }

  async function runDirectClassAdjustment(kind: "text" | "space", delta: number) {
    const anchorId = selectedAnchorId || previewSelection?.anchorId || "";
    if (!anchorId || busy) return;
    const screenLabel = previewSelection?.screenLabel || selectedAnchor?.screenLabel || "Generated Screen";
    const label = kind === "text" ? (delta > 0 ? "글자 크게" : "글자 작게") : delta > 0 ? "요소 여백 확대" : "요소 여백 축소";
    await runDirectArtifactPatch(
      anchorId,
      screenLabel,
      label,
      kind === "text" ? "direct-text-size-adjust" : "direct-spacing-adjust",
      (patch) => `${label}를 직접 적용했습니다. ${ARTIFACT_PATH}:${patch.line}`,
      (source) =>
        applyAnchoredClassAdjustment(source, anchorId, previewSelection, (className) =>
          kind === "text" ? adjustTextSizeClasses(className, delta) : adjustElementSpaceClasses(className, delta),
        ),
    );
  }

  async function runComponentEdit() {
    const note = componentEdit.trim();
    const anchorId = selectedAnchorId || previewSelection?.anchorId || "";
    if (!anchorId || !note || busy) return;

    const anchor = anchorManifest?.anchors.find((item) => item.id === anchorId);
    const screenLabel = previewSelection?.screenLabel || anchor?.screenLabel || "Generated Screen";
    const directReplacement = parseDirectReplacement(note);
    if (directReplacement) {
      const applied = await runDirectSourceSplice(anchorId, screenLabel, note, directReplacement);
      if (applied) {
        setComponentEdit("");
        return;
      }
    }
    const request = buildTargetedComponentRequest(anchorId, screenLabel, note, previewSelection);
    await runDesignRequest(request, {
      displayRequest: `@${anchorId} ${note}`,
      commentNote: note,
      anchorId,
      screenLabel,
    });
    setComponentEdit("");
  }

  const latestRun = runHistory[0];
  const anchors = anchorManifest?.anchors ?? [];
  const selectedAnchor = anchors.find((anchor) => anchor.id === selectedAnchorId);
  const selectedAnchorLabel = selectedAnchorId || "선택 없음";
  const codexSessionLabel = codexSession?.sessionId ? shortSessionId(codexSession.sessionId) : "fresh";
  const codexRuntime = settings.codexRuntime || "app-server";
  const codexModelLabel = settings.codexModel.trim() || "CLI default";
  const codexEffortLabel = settings.codexEffort || "auto";
  const visibleArtifacts = visibleFiles.length ? visibleFiles : [{ relativePath: ARTIFACT_PATH, isDirectory: false }];
  const verifyStepStatus = steps.find((step) => step.id === "verify")?.status ?? "idle";
  const qualityStepStatus = steps.find((step) => step.id === "quality")?.status ?? "idle";
  const consolePath = manualConsoleInfo?.relativePath ?? latestRun?.consolePath;
  const consoleErrors = manualConsoleInfo?.errorCount ?? latestRun?.consoleErrorCount;
  const consoleWarnings = manualConsoleInfo?.warningCount ?? latestRun?.consoleWarningCount;
  const screenshotPath = manualScreenshotInfo?.relativePath ?? latestRun?.screenshotPath;
  const exportReadyPath = manualExportPath || latestRun?.exportPath || "";
  const critiqueStatus = manualCritique?.status ?? latestRun?.critiqueStatus;
  const qualityStatus = manualQualityAudit?.status ?? latestRun?.qualityAuditStatus;
  const designHealth = latestBrief?.designSystemHealth;
  const tokenSummary = latestTokenManifest
    ? `${latestTokenManifest.colors.length} colors · ${latestTokenManifest.componentInventory.length} anchors`
    : "pending";
  const visibleLogs = showAllLogs ? logs : logs.slice(-8);
  const conversationMessages = useMemo(
    () => messages.filter((message) => !isActivityMessage(message)),
    [messages],
  );
  const historyCount = activityMessages.length + runHistory.length;
  const activeProject = projects.find((project) => project.path === workspacePath);
  const activeProjectName = activeProject?.name || (workspacePath ? workspacePath.split(/[\\/]/).filter(Boolean).pop() : "프로젝트 없음");
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      [project.name, project.path, project.lastMessage ?? ""].some((value) => value.toLowerCase().includes(query)),
    );
  }, [projects, projectSearch]);
  const verificationRows: Array<{ name: string; value: string; tone: "lime" | "cyan" | "amber" | "danger" | "steel" }> = [
    {
      name: "TypeScript/Vite",
      value: manualVerifyResult
        ? manualVerifyResult.success
          ? "통과"
          : "실패"
        : verifyStepStatus === "active"
          ? "진행 중"
          : "요청 대기",
      tone: manualVerifyResult
        ? manualVerifyResult.success
          ? "lime"
          : "danger"
        : verifyStepStatus === "active"
          ? "cyan"
          : "steel",
    },
    {
      name: "콘솔",
      value: consolePath ? `${consoleErrors ?? 0} errors / ${consoleWarnings ?? 0} warnings` : "요청 대기",
      tone:
        consolePath && (consoleErrors ?? 0) === 0 && (consoleWarnings ?? 0) === 0
          ? "lime"
          : consolePath
            ? "amber"
            : "steel",
    },
    {
      name: "스크린샷",
      value: screenshotPath ? "캡처됨" : "요청 대기",
      tone: screenshotPath ? "lime" : "steel",
    },
    {
      name: "품질",
      value: qualityStatus
        ? qualityStatus
        : qualityStepStatus === "active"
          ? "진행 중"
          : "요청 대기",
      tone:
        qualityStatus === "applied" || qualityStatus === "no-change"
          ? "lime"
          : qualityStatus === "failed"
            ? "danger"
            : qualityStepStatus === "active"
              ? "cyan"
              : "steel",
    },
    {
      name: "정적 소스 체크",
      value: latestStaticCheck?.status ?? latestRun?.staticCheckStatus ?? "요청 대기",
      tone: staticCheckTone(latestStaticCheck?.status ?? latestRun?.staticCheckStatus),
    },
  ];

  if (artifactOnlyMode) {
    return (
      <div
        data-screen-label="designforge-artifact-only-preview"
        className="flex h-screen min-w-0 flex-col overflow-hidden bg-[var(--panel-2)] text-[var(--ink)]"
      >
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--line)] bg-white px-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--primary)]">artifact only preview</p>
            <h1 className="truncate text-xl font-bold text-[var(--ink-strong)]">작업물 미리보기</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
              {ARTIFACT_VIEWPORT_WIDTH} x {ARTIFACT_VIEWPORT_HEIGHT}
            </span>
            <Button
              variant="ghost"
              className="min-h-9 px-3 text-xs"
              onClick={() => void startPreviewSafely()}
              disabled={busy || !workspacePath}
            >
              <Play size={14} />
              시작
            </Button>
            <Button
              variant="ghost"
              className="min-h-9 px-3 text-xs"
              onClick={() => setSelectionMode((current) => !current)}
              disabled={!preview}
            >
              <MousePointer2 size={14} />
              {selectionMode ? "선택 중" : "선택 수정"}
            </Button>
            <Button
              variant="ghost"
              className="min-h-9 border-[var(--line)] bg-white px-3 text-xs text-[var(--ink)] hover:text-[var(--primary)]"
              onClick={() => setArtifactOnlyMode(false)}
              title="Esc 키로도 돌아갈 수 있습니다."
            >
              <Minimize2 size={14} />
              작업대로 돌아가기
            </Button>
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-auto p-6">
          <div className="mx-auto w-max">
            <div className="mb-3 flex items-center justify-between gap-4 text-xs text-[var(--muted)]">
              <span className="truncate font-mono">{ARTIFACT_PATH}</span>
              <span>{preview ? `HTTP ${preview.statusCode}` : "미리보기 준비 필요"} · Ctrl+Shift+P 토글 · Esc 닫기</span>
            </div>
            <div
              className="overflow-hidden bg-white shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
              style={{ width: ARTIFACT_VIEWPORT_WIDTH, height: ARTIFACT_VIEWPORT_HEIGHT }}
            >
              {preview ? (
                <iframe
                  title="Workspace artifact 1920 by 1080 preview"
                  src={previewFrameSrc(preview.url, selectionMode)}
                  className={cn(
                    "block h-[1080px] w-[1920px] border-0 bg-white",
                    selectionMode && "ring-4 ring-[var(--focus-ring)] ring-inset",
                  )}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-white text-[var(--ink)]">
                  <div className="max-w-md text-center">
                    <p className="font-mono text-xs uppercase tracking-normal text-[var(--muted)]">preview waiting</p>
                    <h2 className="mt-3 text-3xl font-semibold tracking-normal">미리보기를 먼저 시작하세요</h2>
                    <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                      이 모드는 작업물만 {ARTIFACT_VIEWPORT_WIDTH} x {ARTIFACT_VIEWPORT_HEIGHT} 원본 캔버스로 보여줍니다.
                    </p>
                    <Button className="mt-6" variant="primary" onClick={() => void startPreviewSafely()} disabled={busy || !workspacePath}>
                      <Play size={16} />
                      미리보기 시작
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      data-screen-label="designforge-workbench"
      className="relative grid h-screen min-w-[1180px] grid-cols-[320px_minmax(0,1fr)] overflow-hidden bg-[var(--bg)] text-[var(--ink)]"
    >
      <aside
        data-comment-anchor="navigation"
        className="flex min-h-0 flex-col overflow-y-auto border-r border-[var(--line)] bg-[#fbfaf7] px-4 py-3"
      >
        <header className="flex min-h-10 items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white shadow-[0_8px_18px_rgba(49,130,246,0.18)] focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]"
              onClick={() => setShowProjectPanel(true)}
              title="프로젝트 목록"
              aria-label="프로젝트 목록"
            >
              <FolderOpen size={17} />
            </button>
            <Button
              variant="secondary"
              className="min-h-8 shrink-0 px-3 text-xs"
              onClick={() => void createNewProject()}
              disabled={busy}
              title="새 프로젝트 만들기"
            >
              <Plus size={14} />
              새 프로젝트
            </Button>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)] focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]"
            onClick={() => setChatPanelTab((current) => (current === "conversation" ? "history" : "conversation"))}
            title={chatPanelTab === "conversation" ? "작업 기록 보기" : "대화로 돌아가기"}
            aria-label={chatPanelTab === "conversation" ? "작업 기록 보기" : "대화로 돌아가기"}
          >
            {chatPanelTab === "conversation" ? <History size={17} /> : <MessageCircle size={17} />}
          </button>
        </header>

        <section className="mt-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs leading-5 text-[var(--muted)]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--ink)]">현재 프로젝트</span>
            <Badge tone={workspacePath ? "lime" : "steel"}>{workspacePath ? "연결됨" : "대기"}</Badge>
          </div>
          <p className="mt-1 truncate font-semibold text-[var(--ink-strong)]">{activeProjectName}</p>
          <p className="truncate font-mono">{workspacePath || projectRootPath}</p>
        </section>

        <section data-comment-anchor="agent-chat" className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {chatPanelTab === "conversation" ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-0 py-2">
                <div className="grid gap-2">
                  {conversationMessages.slice(-60).map((message) => (
                    <ChatRow key={message.id} message={message} />
                  ))}
                  {codexRuntime === "app-server" && codexStream.status === "running" ? (
                    <ChatRow
                      message={{
                        id: `codex-stream-${codexStream.runId}`,
                        role: "assistant",
                        content: codexStream.text || "Codex app-server가 요청을 처리하고 있습니다.",
                        createdAt: new Date().toISOString(),
                        kind: "tool",
                        level: "info",
                      }}
                    />
                  ) : null}
                </div>
              </div>

              <div data-comment-anchor="hero" className="rounded-xl border border-[var(--line)] bg-white p-2.5 shadow-[0_6px_18px_rgba(31,41,55,0.05)]">
                {guidedDraft ? (
                  <div className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-2 text-[11px] leading-4 text-[var(--charcoal)]">
                    <p className="font-medium text-[var(--ink)]">질문에 답변 중</p>
                    <p className="mt-1 line-clamp-2">{guidedDraft.request}</p>
                  </div>
                ) : null}

                <label className="sr-only" htmlFor="designforge-request">
                  DesignForge 요청
                </label>
                <textarea
                  id="designforge-request"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onPaste={(event) => void pastePendingFiles(event)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runChat();
                  }}
                  className="min-h-[72px] max-h-32 w-full resize-none rounded-xl border border-[var(--line-strong)] bg-white px-3 py-2.5 text-[12px] leading-5 text-[var(--ink)] outline-none placeholder:text-[12px] placeholder:text-[var(--mute)] shadow-[0_6px_18px_rgba(31,41,55,0.045)] focus:border-[var(--primary)] focus:bg-white focus:ring-4 focus:ring-[var(--focus-ring)]"
                  placeholder={
                    guidedDraft
                      ? "위 질문에 답변하세요. 모르는 항목은 '알아서 판단'이라고 적어도 됩니다."
                      : "만들고 싶은걸 입력하세요"
                  }
                  title="이미지를 복사한 뒤 Ctrl+V로 붙여넣을 수 있습니다."
                  disabled={busy}
                />
                {pendingAttachments.length ? (
                  <div className="mt-2 grid gap-1.5">
                    {pendingAttachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex min-h-7 items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 text-[11px] text-[var(--charcoal)]"
                      >
                        <span className="min-w-0 truncate">
                          {attachment.kind} · {attachment.name}
                        </span>
                        <button
                          type="button"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)]"
                          onClick={() => removePendingAttachment(attachment.id)}
                          aria-label={`${attachment.name} 첨부 제거`}
                          disabled={busy}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div data-comment-anchor="primary-action" className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex gap-1.5">
                    <input
                      id="designforge-attachments"
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        void addPendingFiles(event.currentTarget.files);
                        event.currentTarget.value = "";
                      }}
                      disabled={busy}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-7 px-3 text-[11px]"
                      onClick={() => {
                        const imageRequest = input.trim() || "DesignForge에서 사용할 이미지를 생성하세요.";
                        const attachments = pendingAttachments;
                        setPendingAttachments([]);
                        void runImageGenerationRequest(imageRequest, { attachments });
                      }}
                      disabled={busy || (!input.trim() && pendingAttachments.length === 0)}
                      title="Codex $imagegen으로 이미지 에셋을 생성합니다."
                    >
                      <ImageIcon size={12} />
                      이미지
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-7 px-3 text-[11px]"
                      onClick={() => document.getElementById("designforge-attachments")?.click()}
                      disabled={busy}
                    >
                      <Paperclip size={12} />
                      파일
                    </Button>
                  </div>
                  <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-7 px-3 text-[11px]"
                    onClick={() => {
                      setInput("");
                      setGuidedDraft(null);
                      setPendingAttachments([]);
                    }}
                    disabled={busy || (!input && !guidedDraft && pendingAttachments.length === 0)}
                    aria-label="입력 비우기"
                  >
                    비우기
                  </Button>
                  <Button variant="primary" onClick={runChat} disabled={busy || (!input.trim() && pendingAttachments.length === 0)} className="min-h-7 px-3 text-[11px]">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    {guidedDraft ? "답변 보내기" : "보내기"}
                  </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div data-comment-anchor="run-history" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-0 py-2">
              <div className="grid gap-3">
                <section className="rounded-2xl border border-[var(--line)] bg-white p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
                      <History size={16} className="text-[var(--accent)]" />
                      대화 작업 로그
                    </div>
                    <Badge tone="steel">{activityMessages.length}개</Badge>
                  </div>
                  <div className="grid gap-3">
                    {activityMessages.length === 0 && (
                      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4 text-sm text-[var(--muted)]">
                        아직 분리된 작업 로그가 없습니다.
                      </div>
                    )}
                    {activityMessages.slice(-30).map((message) => (
                      <ChatRow key={message.id} message={message} />
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--line)] bg-white p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
                      <History size={16} className="text-[var(--accent)]" />
                      생성 실행 기록
                    </div>
                    <Badge tone="steel">{runHistory.length}개</Badge>
                  </div>
                  <div className="grid gap-3">
                    {runHistory.length === 0 && (
                      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4 text-sm text-[var(--muted)]">
                        기록된 실행이 없습니다.
                      </div>
                    )}
                    {runHistory.map((run) => (
                      <div key={run.id} className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4">
                        <div className="mb-3 flex items-center justify-between gap-2 text-xs">
                          <Badge tone={runTone(run.status)}>
                            {run.status === "success" ? "success" : "error"}
                            {run.repairAttempts ? ` · repair ${run.repairAttempts}` : ""}
                          </Badge>
                          <span className="text-[var(--muted)]">{new Date(run.finishedAt).toLocaleTimeString()}</span>
                        </div>
                        <div className="line-clamp-3 text-sm leading-6 text-[var(--ink)]">{run.request}</div>
                        {(run.codexSessionId || run.previewStatus || run.exportPath) && (
                          <div className="mt-3 grid gap-1 text-xs leading-5 text-[var(--muted)]">
                            {run.codexSessionId && (
                              <span className="truncate font-mono">
                                codex: {shortSessionId(run.codexSessionId)} {run.codexUsedResume ? "resume" : "fresh"}
                              </span>
                            )}
                            {run.previewStatus && <span>preview: {run.previewStatus}</span>}
                            {run.critiqueStatus && <span>critique: {run.critiqueStatus}</span>}
                            {run.screenshotPath && <span className="truncate font-mono">{run.screenshotPath}</span>}
                            {run.exportPath && <span className="truncate font-mono">{truncatePath(run.exportPath)}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </section>

      </aside>

      <main data-comment-anchor="preview" className="flex min-h-0 min-w-0 flex-col bg-white">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge tone={preview ? "lime" : busy ? "cyan" : "steel"}>{preview ? "미리보기 활성" : busy ? "생성 중" : "대기"}</Badge>
            <Button
              variant="ghost"
              className="min-h-9 shrink-0 whitespace-nowrap px-3 text-xs"
              onClick={() => void startPreviewSafely()}
              disabled={busy || !workspacePath}
            >
              <Play size={14} />
              시작
            </Button>
            <Button
              variant="ghost"
              className="min-h-9 shrink-0 whitespace-nowrap px-3 text-xs"
              onClick={() => void stopPreviewSafely()}
              disabled={!preview}
            >
              <Square size={14} />
              중지
            </Button>
            <Button
              variant={selectionMode ? "primary" : "ghost"}
              className="min-h-9 shrink-0 whitespace-nowrap px-3 text-xs"
              onClick={() => setSelectionMode((current) => !current)}
              disabled={!preview}
              title="미리보기에서 data-comment-anchor 영역을 클릭해 수정 대상을 선택합니다."
            >
              <MousePointer2 size={14} />
              선택 수정
            </Button>
            <Button
              variant="ghost"
              className="min-h-9 shrink-0 whitespace-nowrap px-3 text-xs"
              onClick={() => setArtifactOnlyMode(true)}
              title="작업물만 1920 x 1080 원본 캔버스로 봅니다. 단축키: Ctrl+Shift+P"
            >
              <Maximize2 size={14} />
              작업물 보기
            </Button>
            <span className="shrink-0 whitespace-nowrap rounded-full border border-[var(--line)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
              {ARTIFACT_VIEWPORT_WIDTH}x{ARTIFACT_VIEWPORT_HEIGHT}
            </span>
          </div>
          <Button
            variant={showPipelinePanel ? "primary" : "secondary"}
            className="min-h-9 shrink-0 whitespace-nowrap px-3 text-xs"
            onClick={() => setShowPipelinePanel((current) => !current)}
            title="작업 파이프라인과 검증 패널을 엽니다."
          >
            <Terminal size={14} />
            파이프라인
          </Button>
        </div>

        <section className="min-h-0 flex-1 overflow-auto bg-[var(--panel-2)] p-4">
          <div className="mx-auto flex max-h-full w-full max-w-none flex-col overflow-hidden rounded-[24px] border border-[var(--line)] bg-white shadow-[0_18px_48px_rgba(31,41,55,0.06)]">
            <div className="flex min-h-14 items-center justify-between border-b border-[var(--line)] bg-white px-5 text-xs text-[var(--muted)]">
              <span className="truncate font-mono">{ARTIFACT_PATH}</span>
              <span>{preview ? `HTTP ${preview.statusCode}` : "미리보기 준비"}</span>
            </div>
            {preview ? (
              <iframe
                title="Workspace preview"
                src={previewFrameSrc(preview.url, selectionMode)}
                className={cn(
                  "h-[min(76vh,820px)] w-full bg-white",
                  selectionMode && "ring-4 ring-[var(--focus-ring)]",
                )}
              />
            ) : (
              <div className="min-h-[560px] bg-[var(--panel-2)] p-5 text-[var(--ink)]">
                <div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />
                      <span className="truncate font-mono text-xs text-[var(--charcoal)]">
                        artifact://designforge-workbench
                      </span>
                    </div>
                    <Badge tone="steel">anchors visible</Badge>
                  </div>
                  <div className="grid gap-4 p-4 lg:grid-cols-[1fr_220px]">
                    <div className="space-y-4">
                      <div className="rounded-[22px] border border-[var(--line)] bg-white p-6">
                        <p className="text-sm font-semibold text-[var(--primary)]">composer</p>
                        <h3 className="mt-3 max-w-2xl break-keep text-3xl font-bold leading-tight tracking-normal text-[var(--ink-strong)]">
                          요청에서 검증까지 한 화면에서 이어지는 DesignForge
                        </h3>
                        <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                          사용자는 한국어로 변경 의도를 남기고, 시스템은 디자인 기준과 컴포넌트 앵커를 보존한 채 React/Tailwind 산출물을 갱신합니다.
                        </p>
                        <div className="mt-5 flex flex-wrap gap-2">
                          <Badge tone="cyan">run codex design</Badge>
                          <Badge tone="lime">{latestRun?.status === "success" ? "검토 가능" : busy ? "작성 중" : "대기"}</Badge>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        {["요청 해석", "시스템 갱신", "빌드 확인"].map((item, index) => (
                          <div key={item} className="rounded-[20px] border border-[var(--line)] bg-white p-4">
                            <p className="font-mono text-xs text-[var(--mute)]">0{index + 1}</p>
                            <p className="mt-5 text-sm font-medium text-[var(--ink)]">{item}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[22px] border border-[var(--line)] bg-[var(--panel-2)] p-4">
                      <p className="font-mono text-xs text-[var(--muted)]">outline</p>
                      <div className="mt-4 space-y-2">
                        {(anchors.length ? anchors : [{ id: "navigation", line: 0 } as AnchorInfo]).slice(0, 8).map((anchor) => (
                          <div
                            key={anchor.id}
                            className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2 last:border-b-0"
                          >
                            <code className="text-xs text-[var(--ink)]">{anchor.id}</code>
                            <span className="text-xs text-[var(--muted)]">{anchor.line ? `L${anchor.line}` : "ready"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-[var(--line)] bg-[var(--surface-dark)] p-5 font-mono text-sm leading-7 text-white">
                    {messages.slice(-3).map((message) => (
                      <p key={message.id} className="line-clamp-2">
                        {message.role === "user" ? "> " : "$ "}
                        {message.content}
                      </p>
                      ))}
                    {busy && <p>codex {codexRuntime} · generating workspace artifact...</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {showProjectPanel ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 bg-slate-900/10"
            aria-label="프로젝트 목록 닫기"
            onClick={() => setShowProjectPanel(false)}
          />
          <aside
            data-comment-anchor="project-list"
            className="fixed bottom-16 left-4 top-4 z-30 flex w-[410px] min-h-0 flex-col overflow-y-auto overflow-x-hidden rounded-[24px] border border-[var(--line)] bg-white px-5 py-5 shadow-[0_24px_70px_rgba(31,41,55,0.18)]"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--primary)]">projects</p>
                <h2 className="truncate text-xl font-bold text-[var(--ink-strong)]">디자인 프로젝트</h2>
              </div>
              <Button variant="ghost" className="min-h-8 px-3 text-xs" onClick={() => setShowProjectPanel(false)}>
                닫기
              </Button>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
              <p className="font-medium text-[var(--ink)]">프로젝트 루트</p>
              <p className="truncate font-mono">{projectRootPath}</p>
            </div>

            <div className="mt-4 grid gap-2">
              <label className="sr-only" htmlFor="new-project-name">
                새 프로젝트 이름
              </label>
              <input
                id="new-project-name"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                className="min-h-10 w-full rounded-xl border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--focus-ring)]"
                placeholder="프로젝트 이름"
                disabled={busy}
              />
              <Button
                className="w-full"
                variant="primary"
                onClick={() => {
                  const name = newProjectName.trim();
                  setNewProjectName("");
                  void createNewProject(name || undefined);
                }}
                disabled={busy}
              >
                <Plus size={16} />
                새 프로젝트 만들기
              </Button>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">프로젝트 목록</h3>
              <Button variant="ghost" className="min-h-8 px-3 text-xs" onClick={() => void refreshProjects()}>
                새로고침
              </Button>
            </div>

            <label className="mt-3 flex min-h-10 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 text-xs text-[var(--muted)]" htmlFor="project-search">
              <Search size={14} className="shrink-0" />
              <input
                id="project-search"
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
                placeholder="프로젝트 검색"
              />
              <span className="shrink-0 font-mono">{filteredProjects.length}/{projects.length}</span>
            </label>

            <div className="mt-3 grid gap-2">
              {projects.length === 0 ? (
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4 text-sm leading-6 text-[var(--muted)]">
                  아직 생성된 프로젝트가 없습니다. 새 프로젝트를 만들면 독립된 채팅, 작업 기록, DESIGN.md, 생성 결과물을 갖는 디렉토리가 생성됩니다.
                </div>
              ) : null}
              {projects.length > 0 && filteredProjects.length === 0 ? (
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4 text-sm leading-6 text-[var(--muted)]">
                  검색 결과가 없습니다.
                </div>
              ) : null}
              {filteredProjects.map((project) => {
                const active = project.path === workspacePath;
                return (
                  <button
                    key={project.path}
                    type="button"
                    className={cn(
                      "w-full min-w-0 overflow-hidden rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] focus:ring-inset",
                      active
                        ? "border-[var(--primary)] bg-blue-50"
                        : "border-[var(--line)] bg-white hover:border-[var(--primary)] hover:bg-[var(--panel-2)]",
                    )}
                    onClick={() => void switchProject(project.path)}
                    disabled={busy}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--ink-strong)]">{project.name}</p>
                        <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{truncatePath(project.path)}</p>
                      </div>
                      <span className="max-w-[112px] shrink-0 overflow-hidden">
                        <Badge tone={active ? "cyan" : "steel"}>{active ? "현재" : formatProjectTime(project.updatedAt)}</Badge>
                      </span>
                    </div>
                    {project.lastMessage ? (
                      <p className="mt-3 line-clamp-2 break-words text-xs leading-5 text-[var(--charcoal)] [overflow-wrap:anywhere]">
                        {project.lastMessage}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge tone="steel">chat {project.chatCount}</Badge>
                      <Badge tone={project.runCount ? "lime" : "steel"}>runs {project.runCount}</Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        </>
      ) : null}

      {showPipelinePanel ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 bg-slate-900/10"
            aria-label="작업 파이프라인 닫기"
            onClick={() => setShowPipelinePanel(false)}
          />
          <aside
            data-comment-anchor="pipeline-status"
            className="fixed bottom-16 right-4 top-4 z-30 flex w-[380px] min-h-0 flex-col overflow-y-auto rounded-[28px] border border-[var(--line)] bg-[var(--panel-dark)] px-5 py-6 shadow-[0_24px_70px_rgba(31,41,55,0.18)]"
          >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ink-strong)]">작업 파이프라인</h2>
          <div className="flex items-center gap-2">
            <Badge tone={busy ? "cyan" : latestRun?.status === "error" ? "danger" : latestRun?.status === "success" ? "lime" : "steel"}>
              {busy ? "실행 중" : latestRun?.status === "success" ? "생성 완료" : latestRun?.status === "error" ? "확인 필요" : "대기"}
            </Badge>
            <Button
              variant="ghost"
              className="min-h-8 px-3 text-xs"
              onClick={() => setShowPipelinePanel(false)}
              aria-label="작업 파이프라인 닫기"
            >
              닫기
            </Button>
          </div>
        </div>

        <section data-comment-anchor="codex-wrapper" className="mt-5 rounded-[22px] border border-[var(--line)] bg-white p-4 shadow-[0_12px_30px_rgba(31,41,55,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--primary)]">codex wrapper</p>
              <h2 className="mt-1 truncate text-xl font-bold tracking-normal text-[var(--ink-strong)]">앱 내 Codex 제어</h2>
            </div>
            <Badge tone={codexRuntime === "app-server" ? "lime" : "steel"}>{codexRuntime}</Badge>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {(["app-server", "exec"] as CodexRuntime[]).map((runtime) => (
              <button
                key={runtime}
                type="button"
                onClick={() => patchSettings({ codexRuntime: runtime })}
                disabled={busy}
                className={cn(
                  "min-h-9 rounded-xl border px-3 text-xs font-semibold transition focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]",
                  codexRuntime === runtime
                    ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                    : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--charcoal)] hover:border-[var(--primary)]",
                )}
              >
                {runtime}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs font-medium text-[var(--ink)]" htmlFor="codex-model">
              Model
              <input
                id="codex-model"
                list="codex-model-options"
                value={settings.codexModel}
                onChange={(event) => patchSettings({ codexModel: event.target.value })}
                className="min-h-10 rounded-xl border border-[var(--line-strong)] bg-[var(--panel-2)] px-3 font-mono text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:bg-white focus:ring-4 focus:ring-[var(--focus-ring)]"
                placeholder="CLI default"
                disabled={busy}
              />
              <datalist id="codex-model-options">
                {CODEX_MODEL_OPTIONS.filter(Boolean).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>

            <label className="grid gap-1 text-xs font-medium text-[var(--ink)]" htmlFor="codex-effort">
              Effort
              <select
                id="codex-effort"
                value={settings.codexEffort}
                onChange={(event) => patchSettings({ codexEffort: event.target.value as CodexEffort })}
                className="min-h-10 rounded-xl border border-[var(--line-strong)] bg-[var(--panel-2)] px-3 font-mono text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:bg-white focus:ring-4 focus:ring-[var(--focus-ring)]"
                disabled={busy}
              >
                {CODEX_EFFORT_OPTIONS.map((effort) => (
                  <option key={effort || "auto"} value={effort}>
                    {effort || "auto"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs leading-5 text-[var(--muted)]">
            <span className="truncate rounded-xl bg-[var(--panel-2)] px-3 py-2 font-mono">session {codexSessionLabel}</span>
            <span className="truncate rounded-xl bg-[var(--panel-2)] px-3 py-2 font-mono">model {codexModelLabel}</span>
            <span className="truncate rounded-xl bg-[var(--panel-2)] px-3 py-2 font-mono">effort {codexEffortLabel}</span>
            <span className="truncate rounded-xl bg-[var(--panel-2)] px-3 py-2 font-mono">events {codexStream.eventCount}</span>
          </div>

          {codexRuntime === "app-server" && (codexStream.status !== "idle" || codexStream.text) ? (
            <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-dark)] p-3 text-white">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">{codexStream.status}</span>
                <span className="truncate font-mono text-[var(--on-dark-muted)]">{codexStream.method || "app-server"}</span>
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-white">
                {codexStream.text || "Codex app-server connected..."}
              </pre>
            </div>
          ) : null}
        </section>

        <section data-comment-anchor="feature-list" className="mt-5 rounded-[22px] border border-[var(--line)] bg-white shadow-[0_12px_30px_rgba(31,41,55,0.04)]">
          <div className="border-b border-[var(--line)] p-4">
            <p className="text-sm font-semibold text-[var(--primary)]">design system</p>
            <h2 className="mt-2 text-xl font-bold tracking-normal text-[var(--ink-strong)]">문서 우선 상태</h2>
          </div>
          {[
            ["Brief", latestBrief?.mode ?? "guided", designHealth ? `${designHealth.score}/100` : "pending"],
            [
              "Clarify",
              latestClarification ? `${latestClarification.confidence}/100` : "pending",
              latestClarification?.shouldAskQuestions ? `${latestClarification.questions.length} qs` : latestClarification ? "skipped" : "AI",
            ],
            ["Context", latestContext ? `${latestContext.assetFiles.length} assets` : "pending", latestContext ? `${latestContext.sourceFiles.length} src` : "ready"],
            ["Tokens", tokenSummary, latestTokenManifest ? `${latestTokenManifest.typography.length} type` : "pending"],
            ["System", designHealth?.status ?? "not scored", designHealth?.missingSections.length ? `${designHealth.missingSections.length} gaps` : "stable"],
            ["Artifact", ARTIFACT_PATH, preview ? "live" : "ready"],
          ].map(([name, value, note]) => (
            <div
              key={name}
              className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ink)]">{name}</p>
                <p className="truncate font-mono text-xs text-[var(--muted)]">{value}</p>
              </div>
              <span className="shrink-0 text-right text-xs text-[var(--muted)]">{note}</span>
            </div>
          ))}
        </section>

        <section data-comment-anchor="component-edit" className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">컴포넌트 직접 수정</h3>
            <Badge tone={selectedAnchorId ? "lime" : selectionMode ? "cyan" : "steel"}>{selectedAnchorLabel}</Badge>
          </div>
          <div className="rounded-[22px] border border-[var(--line)] bg-white p-4 shadow-[0_10px_24px_rgba(31,41,55,0.04)]">
            <div className="flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
              <MousePointer2 size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <p>
                미리보기에서 <span className="text-[var(--ink)]">선택 수정</span>을 켠 뒤 영역을 클릭하거나, 아래 앵커를 선택해 해당 컴포넌트만 좁게 수정합니다.
              </p>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                variant={selectionMode ? "primary" : "secondary"}
                className="min-h-9 flex-1 px-3 text-xs"
                onClick={() => setSelectionMode((current) => !current)}
                disabled={!preview}
              >
                <MousePointer2 size={14} />
                {selectionMode ? "선택 중" : "클릭 선택"}
              </Button>
              <Button
                variant="secondary"
                className="min-h-9 px-3 text-xs"
                onClick={() => (workspacePath ? void loadAnchorManifest(workspacePath) : undefined)}
                disabled={!workspacePath}
              >
                새로고침
              </Button>
            </div>

            <div className="mt-3 grid max-h-28 gap-1 overflow-auto">
              {anchors.length === 0 && <p className="text-xs leading-5 text-[var(--muted)]">아직 색인된 앵커가 없습니다. 생성 후 자동으로 채워집니다.</p>}
              {anchors.map((anchor) => (
                <button
                  key={anchor.id}
                  type="button"
                  onClick={() => {
                    setSelectedAnchorId(anchor.id);
                    setPreviewSelection(null);
                    setSelectedTextDraft("");
                  }}
                  className={cn(
                    "flex min-h-8 items-center justify-between gap-2 rounded-full px-3 text-left text-xs transition focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]",
                    selectedAnchorId === anchor.id ? "bg-[var(--primary)] text-white" : "text-[var(--charcoal)] hover:bg-[var(--panel-2)]",
                  )}
                >
                  <span className="truncate">@{anchor.id}</span>
                  <span className="shrink-0 font-mono text-[10px] opacity-70">L{anchor.line}</span>
                </button>
              ))}
            </div>

            {selectedAnchor || previewSelection ? (
              <div className="mt-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel-2)] p-3 text-[11px] leading-5 text-[var(--muted)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate">{previewSelection?.screenLabel || selectedAnchor?.screenLabel}</span>
                  <span className="shrink-0 font-mono">{previewSelection?.tagName || `L${selectedAnchor?.line}`}</span>
                </div>
                {previewSelection?.text ? <p className="mt-1 line-clamp-2 text-[var(--ink)]">{previewSelection.text}</p> : null}
                {previewSelection?.path?.length ? <p className="mt-1 truncate font-mono">{previewSelection.path[previewSelection.path.length - 1]}</p> : null}
              </div>
            ) : null}

            <div className="mt-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel-2)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--ink)]">선택 요소 직접 조정</p>
                <Badge tone={previewSelection?.text ? "lime" : selectedAnchorId ? "cyan" : "steel"}>
                  {previewSelection?.text ? "텍스트 선택" : selectedAnchorId ? "앵커 선택" : "대기"}
                </Badge>
              </div>
              <textarea
                value={selectedTextDraft}
                onChange={(event) => setSelectedTextDraft(event.target.value)}
                className="mt-2 min-h-16 w-full resize-y rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs leading-5 text-[var(--ink)] outline-none placeholder:text-[var(--mute)] focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--focus-ring)]"
                placeholder="프리뷰에서 텍스트를 클릭하면 직접 수정할 수 있습니다. 줄바꿈도 그대로 입력하세요."
                disabled={busy || !previewSelection?.text}
              />
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Button
                  variant="secondary"
                  className="min-h-8 px-2 text-[11px]"
                  onClick={() => void runDirectSelectedTextEdit()}
                  disabled={busy || !previewSelection?.text || !selectedTextDraft.trim() || selectedTextDraft.trim() === previewSelection.text.trim()}
                >
                  줄바꿈/문구 적용
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-8 px-2 text-[11px]"
                  onClick={() => void runDirectClassAdjustment("text", -1)}
                  disabled={busy || !selectedAnchorId}
                >
                  글자 작게
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-8 px-2 text-[11px]"
                  onClick={() => void runDirectClassAdjustment("text", 1)}
                  disabled={busy || !selectedAnchorId}
                >
                  글자 크게
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-8 px-2 text-[11px]"
                  onClick={() => void runDirectClassAdjustment("space", -1)}
                  disabled={busy || !selectedAnchorId}
                >
                  여백 축소
                </Button>
                <Button
                  variant="secondary"
                  className="col-span-2 min-h-8 px-2 text-[11px]"
                  onClick={() => void runDirectClassAdjustment("space", 1)}
                  disabled={busy || !selectedAnchorId}
                >
                  여백 확대
                </Button>
              </div>
            </div>

            <label className="mt-3 block text-xs font-medium text-[var(--ink)]" htmlFor="component-edit">
              선택 영역 수정 내용
            </label>
            <textarea
              id="component-edit"
              value={componentEdit}
              onChange={(event) => setComponentEdit(event.target.value)}
              className="mt-2 min-h-28 w-full resize-none rounded-[18px] border border-[var(--line-strong)] bg-[var(--panel-2)] p-4 text-sm leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--mute)] focus:border-[var(--primary)] focus:bg-white focus:ring-4 focus:ring-[var(--focus-ring)]"
              placeholder="예: hero 문구만 더 짧게, CTA 색만 accent로 변경"
              disabled={busy}
            />
            <Button
              variant="primary"
              className="mt-3 w-full"
              onClick={() => void runComponentEdit()}
              disabled={busy || !selectedAnchorId || !componentEdit.trim()}
            >
              선택 영역만 수정
            </Button>
          </div>
        </section>

        <section className="mt-5 grid gap-3" aria-label="파이프라인 단계">
          {steps.map((step) => (
            <div key={step.id} className="grid grid-cols-[14px_1fr_auto] gap-3 rounded-[18px] bg-white px-3 py-3 shadow-[0_8px_18px_rgba(31,41,55,0.035)]">
              <StepIcon status={step.status} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ink)]">{step.label}</p>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">{step.detail}</p>
              </div>
              <Badge tone={stepTone(step.status)}>{stepLabel(step.status)}</Badge>
            </div>
          ))}
        </section>

        <section data-comment-anchor="artifact-list" className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">아티팩트</h3>
            <span className="text-xs text-[var(--muted)]">{visibleArtifacts.length}개</span>
          </div>
          <div className="grid gap-2">
            {visibleArtifacts.slice(0, 8).map((file) => (
              <div key={file.relativePath} className="grid grid-cols-[18px_1fr] gap-2 rounded-[18px] border border-[var(--line)] bg-white px-3 py-3">
                {file.relativePath.endsWith(".md") ? <FileText size={14} /> : <Code2 size={14} />}
                <span className="truncate font-mono text-xs text-[var(--ink)]">{file.relativePath}</span>
              </div>
            ))}
          </div>
        </section>

        <section data-comment-anchor="verification" className="mt-7">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">요청형 검증 작업</h3>
            {critiqueStatus ? <Badge tone={critiqueStatus === "applied" ? "lime" : critiqueStatus === "failed" ? "danger" : "steel"}>critique {critiqueStatus}</Badge> : null}
          </div>
          <div className="mt-3 grid gap-2">
            {verificationRows.map((check) => (
              <div key={check.name} className="flex min-h-10 items-center justify-between gap-3 rounded-[16px] bg-white px-3 text-sm">
                <span className="text-[var(--charcoal)]">{check.name}</span>
                <Badge tone={check.tone}>{check.value}</Badge>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => void runManualVerify()} disabled={busy || !workspacePath}>
              <CheckCircle2 size={14} />
              검증 실행
            </Button>
            <Button
              variant="secondary"
              className="min-h-9 px-3 text-xs"
              onClick={() => void runManualRepair()}
              disabled={busy || !workspacePath || !manualVerifyResult || manualVerifyResult.success}
            >
              <XCircle size={14} />
              검증 수리
            </Button>
            <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => void runManualCapture()} disabled={busy || !workspacePath || !preview}>
              <Terminal size={14} />
              캡처 실행
            </Button>
            <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => void runManualCritique()} disabled={busy || !workspacePath}>
              <Code2 size={14} />
              크리틱 실행
            </Button>
            <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => void runManualQualityAudit()} disabled={busy || !workspacePath}>
              <CheckCircle2 size={14} />
              품질 검사
            </Button>
            <Button variant="primary" className="min-h-9 px-3 text-xs" onClick={() => void runManualExport()} disabled={busy || !workspacePath}>
              <FileText size={14} />
              Export 생성
            </Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            기본 생성은 brief/context 작성과 Codex 변경 반영까지만 실행합니다. Node 기반 검증, 프리뷰, 캡처, 품질 검사는 버튼을 누를 때만 시작됩니다.
          </p>
        </section>

        <section data-comment-anchor="export" className="mt-7 border-t border-[var(--line)] pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">핸드오프 export</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                스크린샷, 콘솔 로그, 변경 파일을 묶어 전달합니다.
              </p>
            </div>
            <Badge tone={exportReadyPath ? "lime" : busy ? "cyan" : "steel"}>
              {exportReadyPath ? "준비됨" : busy ? "생성 중" : "대기"}
            </Badge>
          </div>
          <Button
            variant="primary"
            className="mt-4 w-full"
            onClick={() => void revealPath(EXPORT_PATH)}
            disabled={!workspacePath || !exportReadyPath}
          >
            <FolderOpen size={16} />
            export 열기
          </Button>
        </section>

        <section className="mt-7 min-h-48 border-t border-[var(--line)] pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
              <Terminal size={16} className="text-[var(--accent)]" />
              시스템 로그
            </div>
            <Button variant="ghost" className="min-h-8 px-3 text-xs" onClick={() => setShowAllLogs((current) => !current)}>
              {showAllLogs ? "접기" : "전체 보기"}
            </Button>
          </div>
          <div className="grid gap-2">
            {visibleLogs.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        </section>
          </aside>
        </>
      ) : null}

    </div>
  );
}

function ChatRow({ message }: { message: ChatMessage }) {
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

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle2 size={14} className="mt-0.5 text-[var(--primary)]" />;
  if (status === "error") return <XCircle size={14} className="mt-0.5 text-red-300" />;
  if (status === "active") return <Loader2 size={14} className="mt-0.5 animate-spin text-[var(--primary)]" />;
  return <Circle size={14} className="mt-0.5 text-[var(--mute)]" />;
}

function LogRow({ log }: { log: LogEvent }) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[var(--surface-dark)] p-3 text-white">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "font-medium",
            log.level === "success" && "text-white",
            log.level === "error" && "text-red-200",
            log.level === "info" && "text-[var(--on-dark-muted)]",
          )}
        >
          {log.level}
        </span>
        <span className="text-[var(--on-dark-muted)]">{log.timestamp}</span>
      </div>
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-white">
        {log.message}
      </pre>
    </div>
  );
}
