export type LogLevel = "info" | "success" | "error";
export type GenerationMode = "guided" | "variations";

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

export type ProjectInfo = {
  path: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  chatCount: number;
  runCount: number;
  lastMessage?: string;
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
  sessionId?: string | null;
  usedResume?: boolean;
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

export type DesignSystemHealth = {
  score: number;
  status: "strong" | "needs-detail" | "thin";
  missingSections: string[];
  weakSignals: string[];
  checkedAt: string;
};

export type DesignContextManifest = {
  updatedAt: string;
  assetFiles: string[];
  styleFiles: string[];
  sourceFiles: string[];
  generatedArtifactExists: boolean;
  anchorCount: number;
  notes: string[];
};

export type DesignBriefManifest = {
  updatedAt: string;
  request: string;
  mode: GenerationMode;
  classification: "targeted-edit" | "system-revision" | "fresh-design";
  audienceAssumption: string;
  purposeAssumption: string;
  qualityBar: string[];
  questionsToConsider: string[];
  assumptions: string[];
  designSystemHealth: DesignSystemHealth;
  contextPath: string;
  clarificationPath?: string;
};

export type ClarificationQuestion = {
  id: string;
  question: string;
  why: string;
  kind: "audience" | "brand" | "content" | "visual-direction" | "interaction" | "constraint" | "variation" | "asset" | "other";
  required: boolean;
};

export type DesignClarificationManifest = {
  status: "ready" | "skipped" | "failed";
  updatedAt: string;
  request: string;
  mode: GenerationMode;
  promptPath: string;
  manifestPath: string;
  shouldAskQuestions: boolean;
  confidence: number;
  requestType: "targeted-edit" | "system-revision" | "fresh-design" | "unknown";
  interpretation: {
    product: string;
    userGoal: string;
    targetSurface: string;
    likelyAudience: string;
    requestedFidelity: string;
    designSystemNeed: string;
  };
  knownContext: string[];
  missingContext: string[];
  questions: ClarificationQuestion[];
  assumptionsIfSkipped: string[];
  designSystemFocus: string[];
  error?: string;
};

export type QualityAuditManifest = {
  status: "ready" | "applied" | "failed" | "no-evidence" | "no-change";
  updatedAt: string;
  promptPath: string;
  manifestPath: string;
  artifactPath: string;
  briefPath?: string;
  contextPath?: string;
  screenshotPath?: string;
  consolePath?: string;
  verificationPassed?: boolean;
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
  briefPath?: string;
  contextPath?: string;
  clarificationPath?: string;
  critiqueStatus?: CritiqueManifest["status"];
  critiquePromptPath?: string;
  critiqueManifestPath?: string;
  qualityAuditStatus?: QualityAuditManifest["status"];
  qualityAuditPromptPath?: string;
  qualityAuditManifestPath?: string;
  previewUrl?: string;
  previewStatus?: PreviewManifest["status"];
  codexExitCode: number | null;
  codexSessionId?: string;
  codexUsedResume?: boolean;
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
  defaultProjectRootDir: string;
  codexPath: string;
  packageManager: "npm" | "pnpm" | "bun";
  lastWorkspacePath: string;
};
