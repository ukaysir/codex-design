import {
  CheckCircle2,
  Circle,
  Code2,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Play,
  Send,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  buildCritiquePrompt,
  buildDesignSystemSeed,
  buildRepairPrompt,
  buildStructuredPrompt,
} from "./lib/prompt-template";
import { callTauri } from "./lib/tauri";
import type {
  AnchorInfo,
  AnchorManifest,
  CommentRecord,
  CommandResult,
  ConsoleInfo,
  CritiqueManifest,
  ExportInfo,
  LogEvent,
  LogLevel,
  PreviewInfo,
  PreviewManifest,
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
const PROMPT_PATH = "prompts/latest.md";
const REPAIR_PROMPT_PATH = "prompts/repair-latest.md";
const CRITIQUE_PROMPT_PATH = "prompts/critique-latest.md";
const CRITIQUE_MANIFEST_PATH = ".designforge/critique.json";
const ANCHORS_PATH = ".designforge/anchors.json";
const HANDOFF_PATH = "outputs/handoff/README.md";
const EXPORT_PATH = "outputs/exports/designforge-handoff.zip";
const PREVIEW_MANIFEST_PATH = ".designforge/preview.json";
const COMMENTS_PATH = ".designforge/comments.jsonl";
const SCREENSHOT_PATH = "outputs/screenshots/latest.png";
const CONSOLE_PATH = "outputs/console/latest.json";
const MAX_LOGS = 80;
const LOG_PREVIEW_CHARS = 2000;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type StepStatus = "idle" | "active" | "done" | "error";

type PipelineStep = {
  id: string;
  label: string;
  detail: string;
  status: StepStatus;
};

type FileSnapshot = Array<{ relativePath: string; content: string | null }>;

const START_STEPS: PipelineStep[] = [
  { id: "context", label: "Context", detail: "Create or open the workspace", status: "idle" },
  { id: "design", label: "Design system", detail: "Infer DESIGN.md from the chat", status: "idle" },
  { id: "prompt", label: "Prompt", detail: "Compile the Codex Design brief", status: "idle" },
  { id: "codex", label: "Codex", detail: "Run the local Codex CLI", status: "idle" },
  { id: "artifact", label: "Artifact", detail: "Refresh generated files", status: "idle" },
  { id: "verify", label: "Verify", detail: "Typecheck and build the generated workspace", status: "idle" },
  { id: "repair", label: "Repair", detail: "Ask Codex to fix failed verification once", status: "idle" },
  { id: "preview", label: "Preview", detail: "Start the local preview server", status: "idle" },
  { id: "screenshot", label: "Screenshot", detail: "Capture preview evidence", status: "idle" },
  { id: "console", label: "Console", detail: "Capture runtime console evidence", status: "idle" },
  { id: "critique", label: "Critique", detail: "Run screenshot-driven critique pass", status: "idle" },
  { id: "handoff", label: "Handoff", detail: "Write implementation handoff notes", status: "idle" },
  { id: "export", label: "Export", detail: "Package handoff files", status: "idle" },
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
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "bg-[var(--primary)] text-[#14170f] hover:bg-[var(--primary-strong)]",
        variant === "secondary" &&
          "border border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink)] hover:border-[var(--accent)] hover:bg-[var(--panel-3)]",
        variant === "ghost" && "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]",
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
    lime: "border-lime-300/35 bg-lime-300/10 text-lime-100",
    cyan: "border-cyan-300/35 bg-cyan-300/10 text-cyan-100",
    amber: "border-amber-300/35 bg-amber-300/10 text-amber-100",
    danger: "border-red-300/35 bg-red-300/10 text-red-100",
    steel: "border-zinc-500/35 bg-zinc-800/70 text-zinc-300",
  };

  return (
    <span
      className={cn(
        "inline-flex min-h-6 shrink-0 items-center whitespace-nowrap rounded border px-2 text-[11px] font-medium",
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

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [workspacePath, setWorkspacePath] = useState(settings.lastWorkspacePath);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<PipelineStep[]>(START_STEPS);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      content:
        "채팅에 만들고 싶은 프론트엔드 화면을 적으면 claude-design 기준으로 DESIGN.md, prompt, Codex 실행, 검증, preview를 자동 처리합니다.",
    },
  ]);
  const [logs, setLogs] = useState<LogEvent[]>([
    { id: "boot", level: "info", timestamp: now(), message: "Chat-first DesignForge ready." },
  ]);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);

  const visibleFiles = useMemo(
    () =>
      files
        .filter((file) => !file.isDirectory)
        .filter((file) =>
          [
            "DESIGN.md",
            "AGENTS.md",
            PROMPT_PATH,
            REPAIR_PROMPT_PATH,
            CRITIQUE_PROMPT_PATH,
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

  function pushMessage(role: ChatMessage["role"], content: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, content }]);
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

  async function seedDesignSystem(path: string, request: string) {
    let current = "";
    try {
      current = await callTauri<string>("read_file", { workspacePath: path, relativePath: "DESIGN.md" });
    } catch {
      current = "";
    }

    const isLegacySeed =
      current.includes("DesignForge inferred this project") ||
      current.includes("Pending first chat request") ||
      current.includes("Describe the product") ||
      current.includes("Define the visual mood");
    const looksEmpty = current.trim().length < 900 || isLegacySeed;

    if (!looksEmpty) {
      pushLog("info", "Existing DESIGN.md kept.");
      return;
    }

    await callTauri("write_file", {
      workspacePath: path,
      relativePath: "DESIGN.md",
      content: buildDesignSystemSeed(request),
    });
    pushLog("success", "Seeded DESIGN.md from chat request and claude-design priority.");
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
    pushLog("success", `Indexed ${manifest.anchors.length} comment anchors.`);
    return manifest;
  }

  async function writePrompt(path: string, request: string) {
    const feedbackContext = buildFeedbackContext(await loadComments(path));
    const prompt = buildStructuredPrompt(request, { artifactPath: ARTIFACT_PATH, feedbackContext });
    await callTauri("write_file", {
      workspacePath: path,
      relativePath: PROMPT_PATH,
      content: prompt,
    });
    pushLog("success", `Compiled ${PROMPT_PATH}.`);
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
    if (result.stdout.trim()) pushLog("info", result.stdout);
    if (result.stderr.trim()) pushLog("error", result.stderr);
  }

  async function startPreview(path = workspacePath) {
    if (!path) throw new Error("Open or create a workspace first.");
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
      await startPreview();
      setStep("preview", "done");
    } catch (error) {
      setStep("preview", "error");
      if (workspacePath) {
        await savePreviewManifest(workspacePath, previewManifest("error", { error: textFromError(error) }));
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
    pushLog("info", "Preview stopped.");
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
    const result = await callTauri<CommandResult>("run_codex", {
      workspacePath: path,
      codexPath: settings.codexPath,
      prompt,
    });
    pushCommandResult(label, result);
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
    try {
      designSystem = await callTauri<string>("read_file", { workspacePath: path, relativePath: "DESIGN.md" });
    } catch {
      designSystem = "DESIGN.md was unavailable when the handoff was created.";
    }

    const content = `# Handoff: Generated Screen

## Overview

DesignForge generated a React/Tailwind screen from this chat request:

${request}

## About The Design Files

These files are local design references and implementation starting points. Recreate the intent in the target codebase using its established framework, components, and data model rather than blindly copying markup.

## Fidelity

High-fidelity frontend screen, verified with TypeScript and Vite build checks.${repairAttempts ? ` Verification required ${repairAttempts} automatic repair pass.` : ""}

## Verification & Preview

- TypeScript/Vite verification: ${verifyResult.success ? "passed" : "failed"}
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

  async function runChat() {
    const request = input.trim();
    if (!request || busy) return;

    setInput("");
    setBusy(true);
    setSteps(START_STEPS);
    pushMessage("user", request);
    const startedAt = new Date().toISOString();
    let path = "";
    let lastResult: CommandResult | null = null;
    let repairAttempts = 0;
    let currentPreview: PreviewManifest | null = null;
    let screenshot: ScreenshotInfo | null = null;
    let consoleInfo: ConsoleInfo | null = null;
    let anchors: AnchorManifest | null = null;
    let critique: CritiqueManifest | null = null;

    try {
      setStep("context", "active");
      path = await ensureWorkspace();
      await refreshFiles(path);
      await loadRunHistory(path);
      setStep("context", "done");

      setStep("design", "active");
      await seedDesignSystem(path, request);
      setStep("design", "done");

      setStep("prompt", "active");
      const prompt = await writePrompt(path, request);
      setStep("prompt", "done");

      setStep("codex", "active");
      const check = await callTauri<CommandResult>("check_codex", { codexPath: settings.codexPath });
      pushCommandResult("Codex check", check);
      if (!check.success) throw new Error("Codex CLI is not available.");

      const result = await runCodexPrompt(path, prompt, "Codex run");
      lastResult = result;
      setStep("codex", "done");

      setStep("artifact", "active");
      await refreshFiles(path);
      setStep("artifact", "done");

      setStep("verify", "active");
      let verifyResult = await verifyWorkspace(path);
      if (!verifyResult.success) {
        setStep("verify", "error");
        setStep("repair", "active");
        repairAttempts = 1;
        const repairPrompt = await writeRepairPrompt(path, request, verifyResult);
        lastResult = await runCodexPrompt(path, repairPrompt, "Codex repair");
        setStep("repair", "done");

        setStep("verify", "active");
        verifyResult = await verifyWorkspace(path);
      }
      if (!verifyResult.success) throw new Error("Workspace verification failed after repair.");
      setStep("verify", "done");

      setStep("preview", "active");
      try {
        const info = await startPreview(path);
        currentPreview = previewManifest("running", { url: info.url, pid: info.pid, statusCode: info.statusCode });
        setStep("preview", "done");
      } catch (error) {
        setStep("preview", "error");
        currentPreview = previewManifest("error", { error: textFromError(error) });
        await savePreviewManifest(path, currentPreview);
        pushLog("error", `Preview unavailable: ${textFromError(error)}`);
      }

      setStep("screenshot", "active");
      if (currentPreview?.url) {
        try {
          screenshot = await captureScreenshot(path, currentPreview.url);
          setStep("screenshot", "done");
        } catch (error) {
          setStep("screenshot", "error");
          pushLog("error", `Screenshot unavailable: ${textFromError(error)}`);
        }
      } else {
        setStep("screenshot", "error");
      }

      setStep("console", "active");
      if (currentPreview?.url) {
        try {
          consoleInfo = await captureConsole(path, currentPreview.url);
          setStep("console", "done");
        } catch (error) {
          setStep("console", "error");
          pushLog("error", `Console capture unavailable: ${textFromError(error)}`);
        }
      } else {
        setStep("console", "error");
      }

      setStep("critique", "active");
      critique = await writeCritiquePrompt(path, request, screenshot, consoleInfo);
      if (screenshot) {
        const snapshot = await snapshotGeneratedFiles(path);
        let critiqueApplied = false;

        try {
          const critiquePrompt = await callTauri<string>("read_file", {
            workspacePath: path,
            relativePath: CRITIQUE_PROMPT_PATH,
          });
          lastResult = await runCodexPrompt(path, critiquePrompt, "Codex critique");

          setStep("verify", "active");
          const critiqueVerifyResult = await verifyWorkspace(path);
          if (!critiqueVerifyResult.success) {
            setStep("verify", "error");
            throw new Error("Critique pass broke workspace verification.");
          }
          verifyResult = critiqueVerifyResult;
          setStep("verify", "done");

          critique = { ...critique, status: "applied", updatedAt: new Date().toISOString() };
          await saveCritiqueManifest(path, critique);
          critiqueApplied = true;
        } catch (error) {
          await restoreGeneratedFiles(path, snapshot);
          setStep("verify", "done");
          critique = {
            ...critique,
            status: "failed",
            updatedAt: new Date().toISOString(),
            error: textFromError(error),
          };
          await saveCritiqueManifest(path, critique);
          pushLog("error", `Critique skipped after rollback: ${textFromError(error)}`);
        }

        if (critiqueApplied) {
          setStep("preview", "active");
          try {
            const info = await startPreview(path);
            currentPreview = previewManifest("running", { url: info.url, pid: info.pid, statusCode: info.statusCode });
            setStep("preview", "done");
          } catch (error) {
            setStep("preview", "error");
            currentPreview = previewManifest("error", { error: textFromError(error) });
            await savePreviewManifest(path, currentPreview);
            pushLog("error", `Preview unavailable after critique: ${textFromError(error)}`);
          }

          setStep("console", "active");
          if (currentPreview?.url) {
            try {
              consoleInfo = await captureConsole(path, currentPreview.url);
              critique = {
                ...critique,
                consolePath: consoleInfo.relativePath,
                updatedAt: new Date().toISOString(),
              };
              await saveCritiqueManifest(path, critique);
              setStep("console", "done");
            } catch (error) {
              setStep("console", "error");
              pushLog("error", `Console capture unavailable after critique: ${textFromError(error)}`);
            }
          } else {
            setStep("console", "error");
          }

          setStep("screenshot", "active");
          if (currentPreview?.url) {
            try {
              screenshot = await captureScreenshot(path, currentPreview.url);
              critique = {
                ...critique,
                screenshotPath: screenshot.relativePath,
                updatedAt: new Date().toISOString(),
              };
              await saveCritiqueManifest(path, critique);
              setStep("screenshot", "done");
            } catch (error) {
              setStep("screenshot", "error");
              pushLog("error", `Screenshot unavailable after critique: ${textFromError(error)}`);
            }
          } else {
            setStep("screenshot", "error");
          }
        }
      }
      setStep("critique", critique.status === "failed" ? "error" : "done");

      anchors = await writeAnchorManifest(path);

      setStep("handoff", "active");
      const handoffPath = await createHandoff(
        path,
        request,
        repairAttempts,
        verifyResult,
        currentPreview,
        screenshot,
        consoleInfo,
        anchors,
        critique,
      );
      setStep("handoff", "done");

      setStep("export", "active");
      const exportPath = await exportHandoff(path);
      setStep("export", "done");
      await refreshFiles(path);

      const runId = crypto.randomUUID();
      await recordRun(path, {
        id: runId,
        request,
        status: "success",
        startedAt,
        finishedAt: new Date().toISOString(),
        promptPath: PROMPT_PATH,
        artifactPath: ARTIFACT_PATH,
        handoffPath,
        exportPath,
        screenshotPath: screenshot?.relativePath,
        consolePath: consoleInfo?.relativePath,
        consoleErrorCount: consoleInfo?.errorCount,
        consoleWarningCount: consoleInfo?.warningCount,
        anchorManifestPath: ANCHORS_PATH,
        anchorCount: anchors.anchors.length,
        critiqueStatus: critique.status,
        critiquePromptPath: critique.promptPath,
        critiqueManifestPath: critique.manifestPath,
        previewUrl: currentPreview?.url,
        previewStatus: currentPreview?.status,
        codexExitCode: lastResult?.code ?? result.code,
        stdoutPreview: (lastResult ?? result).stdout.trim().slice(0, 1000),
        stderrPreview: (lastResult ?? result).stderr.trim().slice(0, 1000),
        repairAttempts,
      });
      await appendComment(path, {
        id: crypto.randomUUID(),
        artifactPath: ARTIFACT_PATH,
        screenLabel: "Generated Screen",
        note: request,
        source: "chat",
        anchorId: anchorFromRequest(request),
        status: "applied",
        createdAt: new Date().toISOString(),
        runId,
      });
      pushMessage(
        "assistant",
        `완료했습니다. 디자인 시스템은 DESIGN.md에 정리했고, 생성 화면은 ${ARTIFACT_PATH}에 반영했습니다.`,
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
          request,
          status: "error",
          startedAt,
          finishedAt: new Date().toISOString(),
          promptPath: PROMPT_PATH,
          artifactPath: ARTIFACT_PATH,
          consolePath: consoleInfo?.relativePath,
          consoleErrorCount: consoleInfo?.errorCount,
          consoleWarningCount: consoleInfo?.warningCount,
          anchorManifestPath: anchors ? ANCHORS_PATH : undefined,
          anchorCount: anchors?.anchors.length,
          critiqueStatus: critique?.status,
          critiquePromptPath: critique?.promptPath,
          critiqueManifestPath: critique?.manifestPath,
          codexExitCode: lastResult?.code ?? null,
          stdoutPreview: lastResult?.stdout.trim().slice(0, 1000) ?? "",
          stderrPreview: lastResult?.stderr.trim().slice(0, 1000) ?? "",
          repairAttempts,
          error: message,
        });
        await appendComment(path, {
          id: crypto.randomUUID(),
          artifactPath: ARTIFACT_PATH,
          screenLabel: "Generated Screen",
          note: request,
          source: "chat",
          anchorId: anchorFromRequest(request),
          status: "pending",
          createdAt: new Date().toISOString(),
          runId,
        });
      }
      pushMessage("assistant", `중단됐습니다: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  const latestRun = runHistory[0];
  const visibleArtifacts = visibleFiles.length ? visibleFiles : [{ relativePath: ARTIFACT_PATH, isDirectory: false }];
  const verificationRows: Array<{ name: string; value: string; tone: "lime" | "cyan" | "amber" | "danger" | "steel" }> = [
    {
      name: "TypeScript/Vite",
      value: latestRun?.status === "success" ? "통과" : latestRun?.status === "error" ? "실패" : busy ? "진행 중" : "대기",
      tone: latestRun?.status === "success" ? "lime" : latestRun?.status === "error" ? "danger" : busy ? "cyan" : "steel",
    },
    {
      name: "콘솔",
      value: latestRun?.consolePath
        ? `${latestRun.consoleErrorCount ?? 0} errors / ${latestRun.consoleWarningCount ?? 0} warnings`
        : "대기",
      tone:
        latestRun?.consolePath && (latestRun.consoleErrorCount ?? 0) === 0 && (latestRun.consoleWarningCount ?? 0) === 0
          ? "lime"
          : latestRun?.consolePath
            ? "amber"
            : "steel",
    },
    {
      name: "스크린샷",
      value: latestRun?.screenshotPath ? "캡처됨" : "대기",
      tone: latestRun?.screenshotPath ? "lime" : "steel",
    },
  ];

  return (
    <div
      data-screen-label="designforge-workbench"
      className="grid h-screen min-w-[1180px] grid-cols-[300px_minmax(520px,1fr)_360px] overflow-hidden bg-[var(--bg)] text-[var(--ink)]"
    >
      <aside
        data-comment-anchor="navigation"
        className="flex min-h-0 flex-col border-r border-[var(--line)] bg-[var(--panel)] px-5 py-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-lime-200/80">local codex studio</p>
            <h1 className="mt-1 font-serif text-3xl tracking-normal text-[var(--ink-strong)]">DesignForge</h1>
            <p className="mt-2 truncate text-xs text-[var(--muted)]" title={workspacePath || DEFAULT_WORKSPACE}>
              {truncatePath(workspacePath || DEFAULT_WORKSPACE)}
            </p>
          </div>
          <Badge tone="lime">로컬</Badge>
        </header>

        <nav className="mt-7 grid gap-1 text-sm text-zinc-300" aria-label="작업 보기">
          {["작업대", "생성 기록", "디자인 시스템", "검증 로그"].map((item, index) => (
            <button
              key={item}
              type="button"
              className={cn(
                "flex min-h-10 items-center justify-between rounded-md px-3 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-300/70",
                index === 0 ? "bg-[var(--panel-3)] text-[var(--ink-strong)]" : "hover:bg-[var(--panel-2)]",
              )}
            >
              <span>{item}</span>
              {index === 0 ? <span className="h-1.5 w-1.5 rounded-full bg-lime-300" /> : null}
            </button>
          ))}
        </nav>

        <section data-comment-anchor="chat-request" className="mt-auto pt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--ink-strong)]">요청 입력</h2>
            <Badge tone="cyan">대화형</Badge>
          </div>
          <div className="grid gap-3">
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
              className="min-h-36 w-full resize-none rounded-md border border-[var(--line-strong)] bg-[#101210] p-3 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/30"
              placeholder="만들고 싶은 프론트엔드 디자인을 그대로 입력하세요."
              disabled={busy}
            />
            <div data-comment-anchor="primary-action" className="flex gap-2">
              <Button variant="primary" onClick={runChat} disabled={busy || !input.trim()} className="flex-1">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                생성 실행
              </Button>
              <Button
                variant="secondary"
                onClick={() => setInput("")}
                disabled={busy || !input}
                aria-label="입력 비우기"
              >
                비우기
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-2 text-xs text-zinc-400">
            <p className="font-medium text-zinc-300">최근 요청</p>
            {runHistory.length === 0 && (
              <div className="rounded border border-[var(--line)] px-3 py-2 leading-5 text-[var(--muted)]">
                첫 실행 후 최근 요청이 여기에 쌓입니다.
              </div>
            )}
            {runHistory.slice(0, 2).map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setInput(run.request)}
                className="line-clamp-2 rounded border border-[var(--line)] px-3 py-2 text-left leading-5 hover:bg-[var(--panel-2)] focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
              >
                {run.request}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main data-comment-anchor="preview" className="flex min-h-0 min-w-0 flex-col bg-[var(--canvas)]">
        <div className="flex min-h-14 items-center justify-between border-b border-[var(--line)] px-5">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-sm font-semibold text-[var(--ink-strong)]">생성 디자인 캔버스</h2>
            <Badge tone={preview ? "lime" : busy ? "cyan" : "steel"}>{preview ? "미리보기 활성" : busy ? "생성 중" : "대기"}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="min-h-9 px-3 text-xs"
              onClick={() => void startPreviewSafely()}
              disabled={!workspacePath}
            >
              <Play size={14} />
              시작
            </Button>
            <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => void stopPreviewSafely()} disabled={!preview}>
              <Square size={14} />
              중지
            </Button>
            <span className="rounded-md border border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)]">100%</span>
          </div>
        </div>

        <section className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-stone-400/45 bg-[#e9e0ce] shadow-2xl shadow-black/35">
            <div className="flex min-h-10 items-center justify-between border-b border-stone-300 bg-[#f6efe2] px-4 text-xs text-stone-600">
              <span className="truncate font-mono">{ARTIFACT_PATH}</span>
              <span>{preview ? `HTTP ${preview.statusCode}` : "미리보기 준비"}</span>
            </div>
            {preview ? (
              <iframe title="Workspace preview" src={preview.url} className="h-[min(70vh,720px)] w-full bg-white" />
            ) : (
              <div className="grid min-h-[560px] grid-cols-[210px_1fr] bg-[#ece3d1] text-stone-950">
                <div className="border-r border-stone-300 bg-[#d8d0c1] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-600">DesignForge</p>
                  <div className="mt-6 grid gap-2">
                    {["브리프", "시스템", "화면", "검증"].map((item, index) => (
                      <div
                        key={item}
                        className={cn(
                          "rounded px-3 py-2 text-sm",
                          index === 1 ? "bg-stone-950 text-lime-100" : "bg-stone-200",
                        )}
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 p-6">
                  <div className="flex items-start justify-between gap-5">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-cyan-800">현재 산출물</p>
                      <h3 className="mt-2 max-w-xl break-keep font-serif text-3xl leading-tight tracking-normal">
                        반복 생성에 맞춘 실제 작업 화면
                      </h3>
                    </div>
                    <span className="shrink-0 rounded bg-lime-200 px-3 py-1 text-xs font-bold text-stone-950">
                      {latestRun?.status === "success" ? "검토 가능" : busy ? "작성 중" : "대기"}
                    </span>
                  </div>
                  <div className="mt-8 grid grid-cols-3 gap-4">
                    {[
                      { title: "디자인 시스템", detail: "DESIGN.md에서 방향을 먼저 고정합니다." },
                      { title: "React 화면", detail: "생성 화면은 한 파일 중심으로 관리합니다." },
                      { title: "검증 리포트", detail: "빌드, 콘솔, 스크린샷을 한 흐름으로 봅니다." },
                    ].map((item) => (
                      <div key={item.title} className="min-h-28 rounded-md border border-stone-300 bg-[#f8f1e5] p-4">
                        <p className="text-sm font-bold">{item.title}</p>
                        <p className="mt-3 break-keep text-xs leading-5 text-stone-600">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 min-h-40 rounded-md border border-stone-300 bg-stone-950 p-4 text-lime-100">
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span>verification console</span>
                      <span>
                        {latestRun?.consolePath
                          ? `${latestRun.consoleErrorCount ?? 0} errors`
                          : busy
                            ? "running"
                            : "waiting"}
                      </span>
                    </div>
                    <div className="mt-7 grid gap-3 font-mono text-sm text-cyan-100">
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
          <h2 className="text-sm font-semibold text-[var(--ink-strong)]">자동 파이프라인</h2>
          <Badge tone={busy ? "cyan" : latestRun?.status === "error" ? "danger" : latestRun?.status === "success" ? "lime" : "steel"}>
            {busy ? "실행 중" : latestRun?.status === "success" ? "완료" : latestRun?.status === "error" ? "확인 필요" : "대기"}
          </Badge>
        </div>

        <section className="mt-5 grid gap-3" aria-label="파이프라인 단계">
          {steps.map((step) => (
            <div key={step.id} className="grid grid-cols-[14px_1fr_auto] gap-3 border-b border-zinc-800 pb-3">
              <StepIcon status={step.status} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">{step.label}</p>
                <p className="mt-1 truncate text-xs text-zinc-500">{step.detail}</p>
              </div>
              <Badge tone={stepTone(step.status)}>{stepLabel(step.status)}</Badge>
            </div>
          ))}
        </section>

        <section data-comment-anchor="artifact-list" className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">아티팩트</h3>
            <span className="text-xs text-zinc-500">{visibleArtifacts.length}개</span>
          </div>
          <div className="grid gap-2">
            {visibleArtifacts.slice(0, 8).map((file) => (
              <div key={file.relativePath} className="grid grid-cols-[18px_1fr] gap-2 rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-3 py-3">
                {file.relativePath.endsWith(".md") ? <FileText size={14} /> : <Code2 size={14} />}
                <span className="truncate font-mono text-xs text-zinc-200">{file.relativePath}</span>
              </div>
            ))}
          </div>
        </section>

        <section data-comment-anchor="verification" className="mt-7">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">검증 결과</h3>
          <div className="mt-3 grid gap-2">
            {verificationRows.map((check) => (
              <div key={check.name} className="flex min-h-9 items-center justify-between gap-3 border-b border-zinc-800 text-sm">
                <span className="text-zinc-400">{check.name}</span>
                <Badge tone={check.tone}>{check.value}</Badge>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
            <History size={16} className="text-[var(--accent)]" />
            생성 기록
          </div>
          <div className="grid gap-2">
            {runHistory.length === 0 && <div className="text-xs text-[var(--muted)]">기록된 실행이 없습니다.</div>}
            {runHistory.slice(0, 3).map((run) => (
              <div key={run.id} className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                  <Badge tone={runTone(run.status)}>
                    {run.status === "success" ? "success" : "error"}
                    {run.repairAttempts ? ` · repair ${run.repairAttempts}` : ""}
                  </Badge>
                  <span className="text-[var(--muted)]">{new Date(run.finishedAt).toLocaleTimeString()}</span>
                </div>
                <div className="line-clamp-2 text-xs leading-5 text-[var(--ink)]">{run.request}</div>
                {(run.previewStatus || run.exportPath) && (
                  <div className="mt-2 grid gap-1 text-[11px] leading-4 text-[var(--muted)]">
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

        <section data-comment-anchor="export" className="mt-7 border-t border-zinc-800 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">핸드오프 export</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                스크린샷, 콘솔 로그, 변경 파일을 묶어 전달합니다.
              </p>
            </div>
            <Badge tone={latestRun?.exportPath ? "lime" : busy ? "cyan" : "steel"}>
              {latestRun?.exportPath ? "준비됨" : busy ? "생성 중" : "대기"}
            </Badge>
          </div>
          <Button
            variant="primary"
            className="mt-4 w-full"
            onClick={() => void revealPath(EXPORT_PATH)}
            disabled={!workspacePath || !latestRun?.exportPath}
          >
            <FolderOpen size={16} />
            export 열기
          </Button>
        </section>

        <section className="mt-7 min-h-48 border-t border-zinc-800 pt-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
            <Terminal size={16} className="text-[var(--accent)]" />
            시스템 로그
          </div>
          <div className="grid gap-2">
            {logs.slice(-8).map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle2 size={14} className="mt-0.5 text-lime-300" />;
  if (status === "error") return <XCircle size={14} className="mt-0.5 text-red-300" />;
  if (status === "active") return <Loader2 size={14} className="mt-0.5 animate-spin text-cyan-300" />;
  return <Circle size={14} className="mt-0.5 text-zinc-600" />;
}

function LogRow({ log }: { log: LogEvent }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] p-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "font-medium",
            log.level === "success" && "text-lime-200",
            log.level === "error" && "text-red-200",
            log.level === "info" && "text-[var(--muted)]",
          )}
        >
          {log.level}
        </span>
        <span className="text-[var(--muted)]">{log.timestamp}</span>
      </div>
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[var(--ink)]">
        {log.message}
      </pre>
    </div>
  );
}
