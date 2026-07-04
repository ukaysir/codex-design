import ts from "typescript";

for (const key of Object.keys(process.env)) {
  if (key.startsWith("npm_")) delete process.env[key];
}

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");

if (!configPath) {
  console.error("Could not find tsconfig.json");
  process.exit(1);
}

const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([config.error], formatHost()));
  process.exit(1);
}

const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program);

if (diagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost()));
  process.exit(1);
}

const { build } = await import("vite");
await build();

function formatHost() {
  return {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  };
}
