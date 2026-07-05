import {
  CheckCircle2,
  Circle,
  Code2,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointer2,
  Play,
  Send,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  buildCritiquePrompt,
  buildDesignClarificationPrompt,
  buildDesignSystemSeed,
  buildQualityAuditPrompt,
  buildRepairPrompt,
  buildStructuredPrompt,
} from "./lib/prompt-template";
import { callTauri } from "./lib/tauri";
import { WORKSPACE_SELECTION_APP_TSX } from "./lib/workspace-bridge";
import type {
  AnchorInfo,
  AnchorManifest,
  CommentRecord,
  CommandResult,
  ConsoleInfo,
  CritiqueManifest,
  DesignBriefManifest,
  DesignClarificationManifest,
  DesignContextManifest,
  DesignSystemHealth,
  ExportInfo,
  GenerationMode,
  LogEvent,
  LogLevel,
  PreviewInfo,
  PreviewManifest,
  QualityAuditManifest,
  RunRecord,
  ScreenshotInfo,
  Settings,
  WorkspaceFile,
  WorkspaceInfo,
} from "./types";

const DEFAULT_SETTINGS: Settings = {
  defaultWorkspaceDir: "",
  codexPath: "codex",
  packageManager: "npm",
  lastWorkspacePath: "",
};

const ARTIFACT_PATH = "src/generated/Screen.tsx";
const DEFAULT_WORKSPACE = "designforge-workspace";
const RUNS_PATH = ".designforge/runs.jsonl";
const CHAT_PATH = ".designforge/chat.jsonl";
const CODEX_SESSION_PATH = ".designforge/codex-session.json";
const BRIEF_PATH = ".designforge/brief.json";
const CONTEXT_PATH = ".designforge/context.json";
const CLARIFICATION_PATH = ".designforge/clarification.json";
const QUALITY_AUDIT_PATH = ".designforge/quality-audit.json";
const PROMPT_PATH = "prompts/latest.md";
const CLARIFICATION_PROMPT_PATH = "prompts/clarification-latest.md";
const REPAIR_PROMPT_PATH = "prompts/repair-latest.md";
const CRITIQUE_PROMPT_PATH = "prompts/critique-latest.md";
const QUALITY_PROMPT_PATH = "prompts/quality-latest.md";
const CRITIQUE_MANIFEST_PATH = ".designforge/critique.json";
const ANCHORS_PATH = ".designforge/anchors.json";
const HANDOFF_PATH = "outputs/handoff/README.md";
const EXPORT_PATH = "outputs/exports/designforge-handoff.zip";
const PREVIEW_MANIFEST_PATH = ".designforge/preview.json";
const COMMENTS_PATH = ".designforge/comments.jsonl";
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
};

type StepStatus = "idle" | "active" | "done" | "error";
type NavKey = "workbench" | "design" | "history" | "verify";
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
  text: string;
  path: string[];
};

type GuidedDraft = {
  request: string;
  mode: GenerationMode;
  clarification: DesignClarificationManifest;
  createdAt: string;
};

type RunRequestOptions = {
  displayRequest?: string;
  recordRequest?: string;
  commentNote?: string;
  anchorId?: string;
  screenLabel?: string;
  clarification?: DesignClarificationManifest | null;
};

type CodexSessionManifest = {
  sessionId: string;
  updatedAt: string;
  resetAt?: string;
  lastLabel?: string;
  lastUsedResume?: boolean;
};

const NAV_ITEMS: Array<{ key: NavKey; label: string; anchor: string }> = [
  { key: "workbench", label: "작업대", anchor: "preview" },
  { key: "design", label: "디자인 시스템", anchor: "feature-list" },
  { key: "history", label: "작업 기록", anchor: "agent-chat" },
  { key: "verify", label: "검증 로그", anchor: "verification" },
];

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

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function createIntroMessages(): ChatMessage[] {
  return [
    {
      id: "intro",
      role: "assistant",
      content:
        "만들고 싶은 화면을 말해 주세요. 기본 흐름에서는 먼저 필요한 질문을 하고, 답변까지 묶어 실제 앱 파일을 변경합니다. 필요하면 3안 비교 생성을 선택할 수 있습니다.",
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
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]",
        variant === "primary" && "border border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-strong)]",
        variant === "secondary" &&
          "border border-[var(--line-strong)] bg-white text-[var(--ink)] hover:bg-[var(--panel-2)]",
        variant === "ghost" && "border border-transparent text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]",
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
    lime: "border-[var(--line-strong)] bg-white text-[var(--ink)]",
    cyan: "border-black bg-black text-white",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-red-200 bg-red-50 text-red-700",
    steel: "border-[var(--line)] bg-[var(--panel-2)] text-[var(--charcoal)]",
  };

  return (
    <span
      className={cn(
        "inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[11px] font-medium",
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

function previewFrameSrc(url: string, selectionMode: boolean) {
  if (!selectionMode) return url;
  return `${url}${url.includes("?") ? "&" : "?"}designforgeSelect=1`;
}

function isPreviewSelection(value: unknown): value is PreviewSelection & { source: "designforge-preview-select" } {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<PreviewSelection> & { source?: unknown };
  return data.source === "designforge-preview-select" && typeof data.anchorId === "string" && data.anchorId.length > 0;
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
  if (/3안|variation|옵션|비교/i.test(request)) return "Explore multiple strong directions before committing to one visual system.";
  return "Create a focused, high-craft frontend screen that can be iterated through chat.";
}

function qualityBarForMode(mode: GenerationMode) {
  const base = [
    "Primary hierarchy is legible within five seconds.",
    "The aesthetic direction is specific, not a generic AI SaaS default.",
    "Every section earns its place; no filler copy or fake metrics.",
    "Typography, color, spacing, and components behave like a system.",
    "Text fits, controls are accessible, and anchors are stable.",
  ];
  if (mode === "variations") return [...base, "Three directions must be meaningfully different and comparable in one artifact."];
  if (mode === "guided") return [...base, "Open questions and assumptions must be explicit in DESIGN.md."];
  return base;
}

function formatBriefForPrompt(brief: DesignBriefManifest) {
  return JSON.stringify(brief, null, 2);
}

function formatContextForPrompt(context: DesignContextManifest) {
  return JSON.stringify(
    {
      updatedAt: context.updatedAt,
      assetFiles: context.assetFiles.slice(0, 30),
      styleFiles: context.styleFiles.slice(0, 20),
      sourceFiles: context.sourceFiles.slice(0, 30),
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

function normalizeQuestionKind(value: unknown): DesignClarificationManifest["questions"][number]["kind"] {
  const allowed = new Set(["audience", "brand", "content", "visual-direction", "interaction", "constraint", "variation", "asset", "other"]);
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
    mode: data.mode === "variations" ? "variations" : "guided",
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
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeNav, setActiveNav] = useState<NavKey>("workbench");
  const [chatPanelTab, setChatPanelTab] = useState<ChatPanelTab>("conversation");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("guided");
  const [guidedDraft, setGuidedDraft] = useState<GuidedDraft | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>(START_STEPS);
  const [messages, setMessages] = useState<ChatMessage[]>(createIntroMessages);
  const [logs, setLogs] = useState<LogEvent[]>([
    { id: "boot", level: "info", timestamp: now(), message: "Chat-first DesignForge ready." },
  ]);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [codexSession, setCodexSession] = useState<CodexSessionManifest | null>(null);
  const [anchorManifest, setAnchorManifest] = useState<AnchorManifest | null>(null);
  const [selectedAnchorId, setSelectedAnchorId] = useState("");
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [artifactOnlyMode, setArtifactOnlyMode] = useState(false);
  const [componentEdit, setComponentEdit] = useState("");
  const [manualVerifyResult, setManualVerifyResult] = useState<CommandResult | null>(null);
  const [manualConsoleInfo, setManualConsoleInfo] = useState<ConsoleInfo | null>(null);
  const [manualScreenshotInfo, setManualScreenshotInfo] = useState<ScreenshotInfo | null>(null);
  const [manualCritique, setManualCritique] = useState<CritiqueManifest | null>(null);
  const [manualQualityAudit, setManualQualityAudit] = useState<QualityAuditManifest | null>(null);
  const [manualExportPath, setManualExportPath] = useState("");
  const [latestBrief, setLatestBrief] = useState<DesignBriefManifest | null>(null);
  const [latestContext, setLatestContext] = useState<DesignContextManifest | null>(null);
  const [latestClarification, setLatestClarification] = useState<DesignClarificationManifest | null>(null);

  const visibleFiles = useMemo(
    () =>
      files
        .filter((file) => !file.isDirectory)
        .filter((file) =>
          [
            "DESIGN.md",
            "AGENTS.md",
            CHAT_PATH,
            CODEX_SESSION_PATH,
            CLARIFICATION_PATH,
            BRIEF_PATH,
            CONTEXT_PATH,
            QUALITY_AUDIT_PATH,
            CLARIFICATION_PROMPT_PATH,
            PROMPT_PATH,
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
            ARTIFACT_PATH,
            "designforge.config.json",
          ].includes(file.relativePath) ||
          file.relativePath === "CODEX_DESIGN.md" ||
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
        text: event.data.text || "",
        path: Array.isArray(event.data.path) ? event.data.path.filter((item) => typeof item === "string") : [],
      };
      setSelectedAnchorId(selection.anchorId);
      setPreviewSelection(selection);
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
        await loadDesignClarification(workspacePath);
        await loadDesignBrief(workspacePath);
        await loadDesignContext(workspacePath);
        await loadQualityAudit(workspacePath);
      } catch (error) {
        pushLog("error", `Could not load workspace state: ${textFromError(error)}`);
      }
    })();
  }, [workspacePath]);

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

  function activateNav(item: (typeof NAV_ITEMS)[number]) {
    setActiveNav(item.key);
    if (item.key === "history") setChatPanelTab("history");
    if (item.key === "workbench") setChatPanelTab("conversation");
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-comment-anchor="${item.anchor}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    });
  }

  function createChatMessage(
    role: ChatMessage["role"],
    content: string,
    kind: ChatKind = "chat",
    level?: LogLevel,
  ): ChatMessage {
    return {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
      kind,
      level,
    };
  }

  function pushMessage(role: ChatMessage["role"], content: string, kind: ChatKind = "chat", level?: LogLevel) {
    const message = createChatMessage(role, content, kind, level);
    setMessages((current) => [...current, message]);
    return message;
  }

  function selectGenerationMode(mode: GenerationMode) {
    setGenerationMode(mode);
    if (mode !== "guided") setGuidedDraft(null);
  }

  async function appendChatMessage(
    path: string,
    role: ChatMessage["role"],
    content: string,
    kind: ChatKind = "chat",
    level?: LogLevel,
  ) {
    const message = pushMessage(role, content, kind, level);
    try {
      let raw = "";
      try {
        raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CHAT_PATH });
      } catch {
        raw = "";
      }
      await callTauri("write_file", {
        workspacePath: path,
        relativePath: CHAT_PATH,
        content: `${raw.trimEnd()}\n${JSON.stringify(message)}\n`.trimStart(),
      });
    } catch (error) {
      pushLog("error", `Could not persist chat message: ${textFromError(error)}`);
    }
    return message;
  }

  async function loadChatHistory(path: string) {
    try {
      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CHAT_PATH });
      const records = raw
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
      setMessages(records.length ? records.slice(-80) : createIntroMessages());
    } catch {
      setMessages(createIntroMessages());
    }
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

  async function ensureWorkspace() {
    const target = workspacePath || settings.lastWorkspacePath || settings.defaultWorkspaceDir || DEFAULT_WORKSPACE;
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

  async function resetCodexSession(path = workspacePath) {
    const target = path || (await ensureWorkspace());
    const manifest = {
      sessionId: "",
      updatedAt: new Date().toISOString(),
      resetAt: new Date().toISOString(),
    };
    try {
      await callTauri("stop_preview");
    } catch {
      // Preview may not be running; reset should still continue.
    }
    await callTauri("reset_workspace_design_state", { workspacePath: target });
    await callTauri("write_file", {
      workspacePath: target,
      relativePath: CODEX_SESSION_PATH,
      content: JSON.stringify(manifest, null, 2),
    });
    setCodexSession(null);
    setPreview(null);
    setSelectionMode(false);
    setArtifactOnlyMode(false);
    setAnchorManifest(null);
    setRunHistory([]);
    setSelectedAnchorId("");
    setPreviewSelection(null);
    setComponentEdit("");
    setGuidedDraft(null);
    setInput("");
    setGenerationMode("guided");
    setChatPanelTab("conversation");
    setMessages(createIntroMessages());
    setLatestClarification(null);
    setLatestBrief(null);
    setLatestContext(null);
    setManualVerifyResult(null);
    setManualConsoleInfo(null);
    setManualScreenshotInfo(null);
    setManualCritique(null);
    setManualQualityAudit(null);
    setManualExportPath("");
    setSteps(START_STEPS);
    await callTauri("write_file", {
      workspacePath: target,
      relativePath: CHAT_PATH,
      content: "",
    });
    pushLog("info", "Started a fresh design system, cleared prior runs, and reset the Codex session.");
    await refreshFiles(target);
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
      if (current.includes("DesignForgeSelectionBridge")) return;

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
    const artifactExists = workspaceFiles.some((file) => file.relativePath === ARTIFACT_PATH);
    const assetFiles = workspaceFiles
      .filter((file) => !file.isDirectory)
      .map((file) => file.relativePath)
      .filter((file) => file.startsWith("assets/") || /\.(png|jpe?g|webp|gif|svg|ico|avif|ttf|otf|woff2?)$/i.test(file))
      .slice(0, 80);
    const styleFiles = workspaceFiles
      .filter((file) => !file.isDirectory)
      .map((file) => file.relativePath)
      .filter((file) => /\.(css|scss|sass|less|cjs|mjs|config\.js|config\.ts)$/i.test(file) || file.includes("tailwind"))
      .slice(0, 80);
    const sourceFiles = workspaceFiles
      .filter((file) => !file.isDirectory)
      .map((file) => file.relativePath)
      .filter((file) => file.startsWith("src/") && /\.(tsx?|jsx?)$/i.test(file))
      .slice(0, 100);
    const notes = [
      assetFiles.length ? `${assetFiles.length} local asset files available.` : "No local assets found; avoid inventing logos or fake imagery.",
      styleFiles.length ? `${styleFiles.length} style/config files available.` : "No shared style files found beyond defaults.",
      artifactExists ? `${ARTIFACT_PATH} exists.` : `${ARTIFACT_PATH} is missing and should be created.`,
      loadedAnchors?.anchors.length ? `${loadedAnchors.anchors.length} comment anchors indexed.` : "No anchors indexed yet.",
    ];
    const manifest: DesignContextManifest = {
      updatedAt: new Date().toISOString(),
      assetFiles,
      styleFiles,
      sourceFiles,
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
    mode: GenerationMode,
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
      mode,
      classification,
      audienceAssumption,
      purposeAssumption,
      qualityBar: qualityBarForMode(mode),
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

  async function writeClarificationPrompt(
    path: string,
    request: string,
    mode: GenerationMode,
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
      generationMode: mode,
      mode,
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
    const result = await callTauri<CommandResult>("run_codex", {
      workspacePath: path,
      codexPath: settings.codexPath,
      prompt,
      resumeSessionId: session?.sessionId ?? null,
    });
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
- Clarification analysis: ${clarification ? CLARIFICATION_PATH : "not-created"}
- Quality audit: ${qualityAudit ? QUALITY_AUDIT_PATH : "not-created"}

${clarification ? `### Clarification\n\n\`\`\`json\n${clarification.trim()}\n\`\`\`` : ""}

${designBrief ? `### Brief\n\n\`\`\`json\n${designBrief.trim()}\n\`\`\`` : ""}

${designContext ? `### Context\n\n\`\`\`json\n${designContext.trim()}\n\`\`\`` : ""}

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

  async function startGuidedClarification(request: string, mode: GenerationMode) {
    setInput("");
    setChatPanelTab("conversation");
    setBusy(true);
    try {
      const path = await ensureWorkspace();
      await ensurePreviewSelectionBridge(path);
      await refreshFiles(path);
      await loadRunHistory(path);
      await loadChatHistory(path);
      await loadAnchorManifest(path);
      await appendChatMessage(path, "user", request);
      await appendChatMessage(path, "assistant", "요청과 현재 디자인 시스템을 먼저 분석한 뒤 필요한 질문을 만들겠습니다.", "status", "info");

      const designSystemMarkdown = await readDesignSystem(path);
      const designSystemHealth = inspectDesignSystem(designSystemMarkdown);
      const context = await writeDesignContextManifest(path);
      const prompt = await writeClarificationPrompt(path, request, mode, context, designSystemHealth, designSystemMarkdown);
      await runCodexPrompt(path, prompt, "Codex design preflight");

      const raw = await callTauri<string>("read_file", { workspacePath: path, relativePath: CLARIFICATION_PATH });
      const clarification = normalizeClarificationManifest(JSON.parse(raw), request);
      const nextClarification = {
        ...clarification,
        mode,
        request,
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
        setGuidedDraft({ request, mode, clarification: nextClarification, createdAt: new Date().toISOString() });
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
        request,
        mode,
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
      setGuidedDraft({ request, mode, clarification: failed, createdAt: new Date().toISOString() });
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
    if (!request || busy) return;

    if (!guidedDraft) {
      const clarification = await startGuidedClarification(request, generationMode);
      if (clarification.status !== "failed" && !clarification.shouldAskQuestions) {
        await runDesignRequest(request, { clarification });
      }
      return;
    }

    if (guidedDraft) {
      const isFailedPreflight = guidedDraft.clarification.status === "failed";
      const combinedRequest = isFailedPreflight
        ? `${guidedDraft.request}

DesignForge preflight failed:
${JSON.stringify(guidedDraft.clarification, null, 2)}

User follow-up after preflight failure:
${request}

Proceed from the original request. Infer missing context conservatively and record assumptions in DESIGN.md.`
        : `${guidedDraft.request}

DesignForge preflight analysis:
${JSON.stringify(guidedDraft.clarification, null, 2)}

User answers to preflight questions:
${request}`;
      const recordRequest = `${guidedDraft.request}

질문 답변:
${request}`;
      const clarification = guidedDraft.clarification;
      setGuidedDraft(null);
      await runDesignRequest(combinedRequest, {
        displayRequest: request,
        recordRequest,
        commentNote: recordRequest,
        clarification,
      });
      return;
    }

    await runDesignRequest(request);
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
    const commentAnchorId = options.anchorId ?? anchorFromRequest(request);
    const commentScreenLabel = options.screenLabel ?? "Generated Screen";

    const startedAt = new Date().toISOString();
    let path = "";
    let lastResult: CommandResult | null = null;
    let repairAttempts = 0;
    let anchors: AnchorManifest | null = null;
    let brief: DesignBriefManifest | null = null;
    let context: DesignContextManifest | null = null;
    const clarification = options.clarification ?? latestClarification;

    try {
      setStep("context", "active");
      path = await ensureWorkspace();
      await ensurePreviewSelectionBridge(path);
      await refreshFiles(path);
      await loadRunHistory(path);
      await loadCodexSession(path);
      await loadAnchorManifest(path);
      await loadChatHistory(path);
      if (clarification) setLatestClarification(clarification);
      else await loadDesignClarification(path);
      await loadQualityAudit(path);
      await appendChatMessage(path, "user", displayRequest);
      await appendChatMessage(path, "assistant", "워크스페이스와 이전 DesignForge 대화를 연결했습니다.", "status", "info");
      setStep("context", "done");

      setStep("design", "active");
      await appendChatMessage(path, "assistant", "DESIGN.md를 섹션별로 검사하고 부족한 품질 기준을 보강합니다.", "status", "info");
      const designHealth = await prepareDesignSystem(path, request);
      setStep("design", "done");

      setStep("brief", "active");
      context = await writeDesignContextManifest(path);
      brief = await writeDesignBriefManifest(path, request, generationMode, designHealth, context, clarification);
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
      const prompt = await writePrompt(path, request, brief, context, clarification);
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

  async function runComponentEdit() {
    const note = componentEdit.trim();
    const anchorId = selectedAnchorId || previewSelection?.anchorId || "";
    if (!anchorId || !note || busy) return;

    const anchor = anchorManifest?.anchors.find((item) => item.id === anchorId);
    const screenLabel = previewSelection?.screenLabel || anchor?.screenLabel || "Generated Screen";
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
  const visibleLogs = showAllLogs ? logs : logs.slice(-8);
  const conversationMessages = useMemo(
    () => messages.filter((message) => message.kind !== "status" && message.kind !== "tool"),
    [messages],
  );
  const activityMessages = useMemo(
    () => messages.filter((message) => message.kind === "status" || message.kind === "tool"),
    [messages],
  );
  const historyCount = activityMessages.length + runHistory.length;
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
  ];

  if (artifactOnlyMode) {
    return (
      <div
        data-screen-label="designforge-artifact-only-preview"
        className="flex h-screen min-w-0 flex-col overflow-hidden bg-[#0b0b0b] text-white"
      >
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-[#252525] bg-[#111111] px-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-normal text-white/45">artifact only preview</p>
            <h1 className="truncate text-base font-semibold">작업물 미리보기</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-[#2f2f2f] bg-[#171717] px-3 py-2 font-mono text-xs text-white/70">
              {ARTIFACT_VIEWPORT_WIDTH} x {ARTIFACT_VIEWPORT_HEIGHT}
            </span>
            <Button
              variant="ghost"
              className="min-h-9 border-[#2f2f2f] bg-[#171717] px-3 text-xs text-white hover:bg-[#232323]"
              onClick={() => void startPreviewSafely()}
              disabled={busy || !workspacePath}
            >
              <Play size={14} />
              시작
            </Button>
            <Button
              variant="ghost"
              className="min-h-9 border-[#2f2f2f] bg-[#171717] px-3 text-xs text-white hover:bg-[#232323]"
              onClick={() => setSelectionMode((current) => !current)}
              disabled={!preview}
            >
              <MousePointer2 size={14} />
              {selectionMode ? "선택 중" : "선택 수정"}
            </Button>
            <Button
              variant="ghost"
              className="min-h-9 border-[#2f2f2f] bg-white px-3 text-xs text-black hover:bg-white/90"
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
            <div className="mb-3 flex items-center justify-between gap-4 text-xs text-white/55">
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
      className="grid h-screen min-w-[1280px] grid-cols-[minmax(680px,0.95fr)_minmax(300px,1fr)_300px] grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-[var(--bg)] text-[var(--ink)]"
    >
      <aside
        data-comment-anchor="navigation"
        className="flex min-h-0 flex-col overflow-y-auto border-r border-[var(--line)] bg-[var(--panel)] px-6 py-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)] bg-white">
              <span className="font-mono text-sm font-medium text-[var(--ink)]">DF</span>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-medium tracking-normal text-[var(--ink-strong)]">DesignForge</h1>
              <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]" title={workspacePath || DEFAULT_WORKSPACE}>
                {truncatePath(workspacePath || DEFAULT_WORKSPACE)}
              </p>
            </div>
          </div>
          <Badge tone={codexSession ? "lime" : "cyan"}>{codexSession ? `session ${codexSessionLabel}` : "Codex ready"}</Badge>
        </header>

        <nav className="mt-5 grid grid-cols-4 gap-2 text-sm text-[var(--charcoal)]" aria-label="작업 보기">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => activateNav(item)}
              aria-current={activeNav === item.key ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center justify-center gap-2 rounded-full px-3 text-center transition focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]",
                activeNav === item.key
                  ? "border border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink-strong)]"
                  : "hover:bg-[var(--panel-2)]",
              )}
            >
              <span>{item.label}</span>
              {activeNav === item.key ? <span className="h-1.5 w-1.5 rounded-full bg-black" /> : null}
            </button>
          ))}
        </nav>

        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="secondary"
            className="min-h-9 flex-1 px-3 text-xs"
            onClick={() => void resetCodexSession()}
            disabled={busy}
            title="현재 채팅, 디자인 시스템, 생성 화면을 초기화하고 새 Codex 세션으로 시작합니다."
          >
            새 디자인 시작
          </Button>
          <Badge tone="steel">{codexSession ? "resume on" : "fresh next"}</Badge>
        </div>

        <section data-comment-anchor="agent-chat" className="mt-5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-normal text-[var(--muted)]">design conversation</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--ink-strong)]">디자인 대화</h2>
              </div>
              <Badge tone={guidedDraft ? "cyan" : "steel"}>
                {chatPanelTab === "conversation"
                  ? guidedDraft
                    ? "답변 대기"
                    : `${conversationMessages.length}개`
                  : `${historyCount}개`}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-full bg-[var(--panel-2)] p-1">
              {[
                { tab: "conversation" as ChatPanelTab, label: "현재 대화", count: conversationMessages.length },
                { tab: "history" as ChatPanelTab, label: "작업 기록", count: historyCount },
              ].map(({ tab, label, count }) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setChatPanelTab(tab)}
                  className={cn(
                    "flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]",
                    chatPanelTab === tab ? "bg-white text-[var(--ink-strong)] shadow-sm" : "text-[var(--charcoal)] hover:bg-white/70",
                  )}
                >
                  <span>{label}</span>
                  <span className="font-mono text-xs text-[var(--muted)]">{count}</span>
                </button>
              ))}
            </div>
          </div>

          {chatPanelTab === "conversation" ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--panel-2)] px-5 py-5">
                <div className="grid gap-4">
                  {conversationMessages.slice(-60).map((message) => (
                    <ChatRow key={message.id} message={message} />
                  ))}
                </div>
              </div>

              <div data-comment-anchor="hero" className="border-t border-[var(--line)] bg-white p-4">
                {guidedDraft ? (
                  <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-4 py-3 text-sm leading-6 text-[var(--charcoal)]">
                    <p className="font-medium text-[var(--ink)]">질문에 답변 중</p>
                    <p className="mt-1 line-clamp-2">{guidedDraft.request}</p>
                  </div>
                ) : null}

                <label className="mb-3 inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 text-sm font-medium text-[var(--charcoal)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-black"
                    checked={generationMode === "variations"}
                    onChange={(event) => selectGenerationMode(event.target.checked ? "variations" : "guided")}
                    disabled={busy || Boolean(guidedDraft)}
                  />
                  3안 비교 생성
                </label>

                <label className="sr-only" htmlFor="designforge-request">
                  DesignForge 요청
                </label>
                <textarea
                  id="designforge-request"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runChat();
                  }}
                  className="min-h-36 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-[var(--panel-2)] p-5 text-base leading-8 text-[var(--ink)] outline-none placeholder:text-[var(--mute)] focus:ring-4 focus:ring-[var(--focus-ring)]"
                  placeholder={
                    guidedDraft
                      ? "위 질문에 답변하세요. 모르는 항목은 '알아서 판단'이라고 적어도 됩니다."
                      : "DesignForge에게 만들고 싶은 화면이나 수정할 컴포넌트를 대화하듯 입력하세요."
                  }
                  disabled={busy}
                />
                <div data-comment-anchor="primary-action" className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-9 px-4 text-xs"
                    onClick={() => {
                      setInput("");
                      setGuidedDraft(null);
                    }}
                    disabled={busy || (!input && !guidedDraft)}
                    aria-label="입력 비우기"
                  >
                    비우기
                  </Button>
                  <Button variant="primary" onClick={runChat} disabled={busy || !input.trim()} className="min-h-9 px-5 text-xs">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {guidedDraft ? "답변 보내기" : "보내기"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div data-comment-anchor="run-history" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--panel-2)] px-5 py-5">
              <div className="grid gap-5">
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

      <main data-comment-anchor="preview" className="flex min-h-0 min-w-0 flex-col bg-[var(--canvas)]">
        <div className="flex min-h-16 items-center justify-between border-b border-[var(--line)] px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-normal text-[var(--muted)]">live artifact canvas</p>
              <h2 className="truncate text-2xl font-medium tracking-normal text-[var(--ink-strong)]">생성 화면 미리보기</h2>
            </div>
            <Badge tone={preview ? "lime" : busy ? "cyan" : "steel"}>{preview ? "미리보기 활성" : busy ? "생성 중" : "대기"}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="min-h-9 px-3 text-xs"
              onClick={() => void startPreviewSafely()}
              disabled={busy || !workspacePath}
            >
              <Play size={14} />
              시작
            </Button>
            <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => void stopPreviewSafely()} disabled={!preview}>
              <Square size={14} />
              중지
            </Button>
            <Button
              variant={selectionMode ? "primary" : "ghost"}
              className="min-h-9 px-3 text-xs"
              onClick={() => setSelectionMode((current) => !current)}
              disabled={!preview}
              title="미리보기에서 data-comment-anchor 영역을 클릭해 수정 대상을 선택합니다."
            >
              <MousePointer2 size={14} />
              선택 수정
            </Button>
            <Button
              variant="ghost"
              className="min-h-9 px-3 text-xs"
              onClick={() => setArtifactOnlyMode(true)}
              title="작업물만 1920 x 1080 원본 캔버스로 봅니다. 단축키: Ctrl+Shift+P"
            >
              <Maximize2 size={14} />
              작업물만 보기
            </Button>
            <span className="rounded-full border border-[var(--line)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
              {ARTIFACT_VIEWPORT_WIDTH}x{ARTIFACT_VIEWPORT_HEIGHT}
            </span>
          </div>
        </div>

        <section className="min-h-0 flex-1 overflow-auto bg-[var(--panel-2)] p-5">
          <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--line-strong)] bg-white">
            <div className="flex min-h-12 items-center justify-between border-b border-[var(--line)] bg-white px-4 text-xs text-[var(--muted)]">
              <span className="truncate font-mono">{ARTIFACT_PATH}</span>
              <span>{preview ? `HTTP ${preview.statusCode}` : "미리보기 준비"}</span>
            </div>
            {preview ? (
              <iframe
                title="Workspace preview"
                src={previewFrameSrc(preview.url, selectionMode)}
                className={cn(
                  "h-[min(70vh,720px)] w-full bg-white",
                  selectionMode && "ring-4 ring-[var(--focus-ring)]",
                )}
              />
            ) : (
              <div className="min-h-[560px] bg-[var(--panel-2)] p-5 text-[var(--ink)]">
                <div className="rounded-xl border border-[var(--line)] bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-black" />
                      <span className="truncate font-mono text-xs text-[var(--charcoal)]">
                        artifact://designforge-workbench
                      </span>
                    </div>
                    <Badge tone="steel">anchors visible</Badge>
                  </div>
                  <div className="grid gap-4 p-4 lg:grid-cols-[1fr_220px]">
                    <div className="space-y-4">
                      <div className="rounded-xl border border-[var(--line)] bg-white p-5">
                        <p className="font-mono text-xs text-[var(--muted)]">composer</p>
                        <h3 className="mt-3 max-w-2xl break-keep text-3xl font-medium leading-tight tracking-normal text-[var(--ink-strong)]">
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
                          <div key={item} className="rounded-xl border border-[var(--line)] bg-white p-4">
                            <p className="font-mono text-xs text-[var(--mute)]">0{index + 1}</p>
                            <p className="mt-5 text-sm font-medium text-[var(--ink)]">{item}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4">
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
                    {busy && <p>codex exec · generating workspace artifact...</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <aside
        data-comment-anchor="pipeline-status"
        className="flex min-h-0 flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--panel-dark)] px-5 py-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--ink-strong)]">작업 파이프라인</h2>
          <Badge tone={busy ? "cyan" : latestRun?.status === "error" ? "danger" : latestRun?.status === "success" ? "lime" : "steel"}>
            {busy ? "실행 중" : latestRun?.status === "success" ? "생성 완료" : latestRun?.status === "error" ? "확인 필요" : "대기"}
          </Badge>
        </div>

        <section data-comment-anchor="feature-list" className="mt-5 rounded-xl border border-[var(--line)] bg-white">
          <div className="border-b border-[var(--line)] p-4">
            <p className="font-mono text-xs uppercase tracking-normal text-[var(--muted)]">design system</p>
            <h2 className="mt-2 text-lg font-medium tracking-normal text-[var(--ink-strong)]">문서 우선 상태</h2>
          </div>
          {[
            ["Brief", latestBrief?.mode ?? generationMode, designHealth ? `${designHealth.score}/100` : "pending"],
            [
              "Clarify",
              latestClarification ? `${latestClarification.confidence}/100` : "pending",
              latestClarification?.shouldAskQuestions ? `${latestClarification.questions.length} qs` : latestClarification ? "skipped" : "AI",
            ],
            ["Context", latestContext ? `${latestContext.assetFiles.length} assets` : "pending", latestContext ? `${latestContext.sourceFiles.length} src` : "ready"],
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
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
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
                  }}
                  className={cn(
                    "flex min-h-8 items-center justify-between gap-2 rounded-full px-3 text-left text-xs transition focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring)]",
                    selectedAnchorId === anchor.id ? "bg-black text-white" : "text-[var(--charcoal)] hover:bg-white",
                  )}
                >
                  <span className="truncate">@{anchor.id}</span>
                  <span className="shrink-0 font-mono text-[10px] opacity-70">L{anchor.line}</span>
                </button>
              ))}
            </div>

            {selectedAnchor || previewSelection ? (
              <div className="mt-3 rounded-xl border border-[var(--line)] bg-white p-3 text-[11px] leading-5 text-[var(--muted)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate">{previewSelection?.screenLabel || selectedAnchor?.screenLabel}</span>
                  <span className="shrink-0 font-mono">{previewSelection?.tagName || `L${selectedAnchor?.line}`}</span>
                </div>
                {previewSelection?.text ? <p className="mt-1 line-clamp-2 text-[var(--ink)]">{previewSelection.text}</p> : null}
              </div>
            ) : null}

            <label className="mt-3 block text-xs font-medium text-[var(--ink)]" htmlFor="component-edit">
              선택 영역 수정 내용
            </label>
            <textarea
              id="component-edit"
              value={componentEdit}
              onChange={(event) => setComponentEdit(event.target.value)}
              className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[var(--line-strong)] bg-white p-3 text-xs leading-5 text-[var(--ink)] outline-none placeholder:text-[var(--mute)] focus:ring-4 focus:ring-[var(--focus-ring)]"
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
            <div key={step.id} className="grid grid-cols-[14px_1fr_auto] gap-3 border-b border-[var(--line)] pb-3">
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
              <div key={file.relativePath} className="grid grid-cols-[18px_1fr] gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-3">
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
              <div key={check.name} className="flex min-h-9 items-center justify-between gap-3 border-b border-[var(--line)] text-sm">
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

      <footer
        data-comment-anchor="footer"
        className="col-span-3 flex min-h-12 items-center justify-between gap-4 border-t border-[var(--line)] bg-white px-5 text-sm text-[var(--muted)]"
      >
        <span>DesignForge · local documentation-first workbench</span>
        <span className="truncate font-mono">
          DESIGN.md synced · {ARTIFACT_PATH} · {preview ? "preview live" : "preview waiting"}
        </span>
      </footer>
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
        ? "border-[var(--line-strong)] bg-white text-[var(--ink)]"
        : isUser
          ? "border-black bg-black text-white"
          : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--charcoal)]";

  return (
    <div className={cn("flex min-w-0 max-w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0 max-w-[min(88%,58ch)] rounded-[20px] border px-5 py-4 text-base leading-8 shadow-sm", levelClass)}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-medium">{isUser ? "user" : message.kind ?? "DesignForge"}</span>
          <span className={cn("shrink-0 font-mono text-[11px]", isUser ? "text-white/70" : "text-[var(--muted)]")}>{timestamp}</span>
        </div>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle2 size={14} className="mt-0.5 text-[var(--ink)]" />;
  if (status === "error") return <XCircle size={14} className="mt-0.5 text-red-300" />;
  if (status === "active") return <Loader2 size={14} className="mt-0.5 animate-spin text-[var(--ink)]" />;
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
