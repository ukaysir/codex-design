import {
  Bot,
  CheckCircle2,
  Circle,
  Code2,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Play,
  Send,
  Sparkles,
  Square,
  Terminal,
  Wand2,
  XCircle,
} from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
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
  theme: "dark",
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
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "bg-[var(--primary)] text-white hover:bg-[var(--primary-strong)]",
        variant === "secondary" &&
          "border border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink)] hover:border-[var(--accent)]",
        variant === "ghost" && "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]",
        className,
      )}
    >
      {children}
    </button>
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
      ...current.slice(-199),
      { id: crypto.randomUUID(), level, timestamp: now(), message: message.trim() || "(empty output)" },
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
    setFiles(nextFiles);
    pushLog("info", `Indexed ${nextFiles.length} workspace entries.`);
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
    if (result.stdout.trim()) pushLog("info", result.stdout.trim().slice(0, 6000));
    if (result.stderr.trim()) pushLog("error", result.stderr.trim().slice(0, 6000));
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
        await refreshFiles(path);
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
          await refreshFiles(path);

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
          await refreshFiles(path);
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

  return (
    <div className="grid h-screen grid-cols-[minmax(0,1fr)_360px] overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <main className="grid min-w-0 grid-rows-[64px_minmax(0,1fr)_auto]">
        <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg)] px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-[var(--primary)] text-white">
              <Wand2 size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">DesignForge</div>
              <div className="truncate text-xs text-[var(--muted)]">
                {workspacePath || DEFAULT_WORKSPACE} · {ARTIFACT_PATH}
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-[var(--muted)] md:flex">
            <Sparkles size={14} className="text-[var(--accent)]" />
            Chat drives the full design pipeline
          </div>
        </header>

        <section className="min-h-0 overflow-auto px-5 py-6">
          <div className="mx-auto grid max-w-4xl gap-4">
            {messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  "max-w-[78ch] rounded-lg border px-4 py-3 text-sm leading-6",
                  message.role === "user"
                    ? "ml-auto border-[var(--primary)] bg-[var(--primary)] text-white"
                    : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]",
                )}
              >
                {message.content}
              </article>
            ))}
            {busy && (
              <article className="flex max-w-[78ch] items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
                <Loader2 size={16} className="animate-spin text-[var(--accent)]" />
                구조화, 디자인 시스템 시드, Codex 실행 중
              </article>
            )}
          </div>
        </section>

        <footer className="border-t border-[var(--line)] bg-[var(--panel)] p-4">
          <div className="mx-auto grid max-w-4xl grid-cols-[minmax(0,1fr)_auto] gap-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runChat();
              }}
              className="min-h-24 w-full resize-none rounded-md border border-[var(--line)] bg-[var(--bg)] p-3 text-sm leading-6 text-[var(--ink)] placeholder:text-[var(--muted)]"
              placeholder="만들고 싶은 프론트엔드 디자인을 그대로 입력하세요. 예: 공공 데이터 서비스 랜딩 페이지를 고급스럽게 만들어줘."
              disabled={busy}
            />
            <Button variant="primary" onClick={runChat} disabled={busy || !input.trim()} className="self-end">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Send
            </Button>
          </div>
        </footer>
      </main>

      <aside className="grid min-w-0 grid-rows-[auto_auto_auto_auto_minmax(0,1fr)] border-l border-[var(--line)] bg-[var(--panel)]">
        <section className="border-b border-[var(--line)] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Bot size={16} className="text-[var(--accent)]" />
            Automatic Pipeline
          </div>
          <div className="grid gap-2">
            {steps.map((step) => (
              <div key={step.id} className="grid grid-cols-[20px_1fr] gap-2 rounded-md bg-[var(--bg)] p-2">
                <StepIcon status={step.status} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{step.label}</div>
                  <div className="text-xs text-[var(--muted)]">{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-[var(--line)] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FolderOpen size={16} className="text-[var(--accent)]" />
            Artifacts
          </div>
          <div className="grid gap-2">
            {(visibleFiles.length ? visibleFiles : [{ relativePath: ARTIFACT_PATH, isDirectory: false }]).map((file) => (
              <div key={file.relativePath} className="flex items-center gap-2 rounded-md bg-[var(--bg)] px-2 py-2 text-xs">
                {file.relativePath.endsWith(".md") ? <FileText size={14} /> : <Code2 size={14} />}
                <span className="truncate font-mono text-[var(--muted)]">{file.relativePath}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-[var(--line)] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Play size={16} className="text-[var(--accent)]" />
              Preview
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="h-8 px-2"
                onClick={() => void startPreviewSafely()}
                disabled={!workspacePath}
                aria-label="Start preview"
                title="Start preview"
              >
                <Play size={14} />
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-2"
                onClick={() => void stopPreviewSafely()}
                disabled={!preview}
                aria-label="Stop preview"
                title="Stop preview"
              >
                <Square size={14} />
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--bg)]">
            {preview ? (
              <iframe title="Workspace preview" src={preview.url} className="h-44 w-full bg-white" />
            ) : (
              <div className="grid h-44 place-items-center px-3 text-center text-xs leading-5 text-[var(--muted)]">
                Preview starts automatically after a successful Codex run.
              </div>
            )}
          </div>
        </section>

        <section className="border-b border-[var(--line)] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <History size={16} className="text-[var(--accent)]" />
            Recent Runs
          </div>
          <div className="grid gap-2">
            {runHistory.length === 0 && <div className="text-xs text-[var(--muted)]">No runs recorded yet.</div>}
            {runHistory.slice(0, 5).map((run) => (
              <div key={run.id} className="rounded-md bg-[var(--bg)] p-2">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className={run.status === "success" ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                    {run.status}
                    {run.repairAttempts ? ` · repair ${run.repairAttempts}` : ""}
                  </span>
                  <span className="text-[var(--muted)]">{new Date(run.finishedAt).toLocaleTimeString()}</span>
                </div>
                <div className="line-clamp-2 text-xs leading-5 text-[var(--ink)]">{run.request}</div>
                {(run.previewStatus || run.exportPath) && (
                  <div className="mt-2 grid gap-1 text-[11px] leading-4 text-[var(--muted)]">
                    {run.previewStatus && <span>preview: {run.previewStatus}</span>}
                    {run.critiqueStatus && <span>critique: {run.critiqueStatus}</span>}
                    {run.consolePath && (
                      <span className="truncate font-mono">
                        {run.consolePath} ({run.consoleErrorCount ?? 0}/{run.consoleWarningCount ?? 0})
                      </span>
                    )}
                    {run.screenshotPath && <span className="truncate font-mono">{run.screenshotPath}</span>}
                    {run.critiquePromptPath && (
                      <span className="truncate font-mono">{run.critiquePromptPath}</span>
                    )}
                    {run.exportPath && (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono">{run.exportPath}</span>
                        <Button
                          variant="ghost"
                          className="h-7 shrink-0 px-2 text-[11px]"
                          onClick={() => void revealPath(EXPORT_PATH)}
                        >
                          <FolderOpen size={12} />
                          Reveal
                        </Button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="min-h-0 overflow-auto p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Terminal size={16} className="text-[var(--accent)]" />
            System Log
          </div>
          <div className="grid gap-2">
            {logs.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle2 size={16} className="mt-0.5 text-[var(--accent)]" />;
  if (status === "error") return <XCircle size={16} className="mt-0.5 text-[var(--danger)]" />;
  if (status === "active") return <Loader2 size={16} className="mt-0.5 animate-spin text-[var(--primary-strong)]" />;
  return <Circle size={16} className="mt-0.5 text-[var(--muted)]" />;
}

function LogRow({ log }: { log: LogEvent }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg)] p-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "font-medium",
            log.level === "success" && "text-[var(--accent)]",
            log.level === "error" && "text-[var(--danger)]",
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
