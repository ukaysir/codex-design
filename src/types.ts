export type Page =
  | "home"
  | "workspace"
  | "prompt"
  | "files"
  | "preview"
  | "settings"
  | "logs";

export type LogLevel = "info" | "success" | "error";

export type LogEvent = {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
};

export type WorkspaceInfo = {
  path: string;
  name: string;
};

export type WorkspaceFile = {
  relativePath: string;
  isDirectory: boolean;
};

export type CommandResult = {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

export type PreviewInfo = {
  url: string;
  pid: number;
  statusCode: number;
};

export type PreviewManifest = {
  status: "running" | "stopped" | "error";
  updatedAt: string;
  url?: string;
  pid?: number;
  statusCode?: number;
  error?: string;
};

export type ExportInfo = {
  path: string;
};

export type ScreenshotInfo = {
  path: string;
  relativePath: string;
  url: string;
};

export type ConsoleInfo = {
  path: string;
  relativePath: string;
  url: string;
  errorCount: number;
  warningCount: number;
};

export type AnchorInfo = {
  id: string;
  artifactPath: string;
  line: number;
  screenLabel: string;
};

export type AnchorManifest = {
  updatedAt: string;
  artifactPath: string;
  anchors: AnchorInfo[];
};

export type CritiqueManifest = {
  status: "ready" | "no-screenshot" | "applied" | "failed";
  updatedAt: string;
  promptPath: string;
  manifestPath: string;
  artifactPath: string;
  screenshotPath?: string;
  consolePath?: string;
  error?: string;
};

export type RunRecord = {
  id: string;
  request: string;
  status: "success" | "error";
  startedAt: string;
  finishedAt: string;
  promptPath: string;
  artifactPath: string;
  handoffPath?: string;
  exportPath?: string;
  screenshotPath?: string;
  consolePath?: string;
  consoleErrorCount?: number;
  consoleWarningCount?: number;
  anchorManifestPath?: string;
  anchorCount?: number;
  critiqueStatus?: CritiqueManifest["status"];
  critiquePromptPath?: string;
  critiqueManifestPath?: string;
  previewUrl?: string;
  previewStatus?: PreviewManifest["status"];
  codexExitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  repairAttempts?: number;
  error?: string;
};

export type CommentRecord = {
  id: string;
  artifactPath: string;
  screenLabel: string;
  note: string;
  source: "chat";
  anchorId?: string;
  status: "applied" | "pending";
  createdAt: string;
  runId?: string;
};

export type Settings = {
  defaultWorkspaceDir: string;
  codexPath: string;
  packageManager: "npm" | "pnpm" | "bun";
  theme: "dark" | "light" | "system";
  lastWorkspacePath: string;
};
