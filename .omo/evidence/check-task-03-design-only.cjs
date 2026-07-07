const fs = require("fs");

const source = fs.readFileSync("src/App.tsx", "utf8");
const match = source.match(/async function runDesignRequest[\s\S]*?\n  async function/);
if (!match) {
  throw new Error("runDesignRequest block not found");
}

const forbidden = [
  "startPreviewSafely",
  "verifyWorkspace",
  "runManualCapture",
  "runManualCritique",
  "runManualQualityAudit",
  "runManualRepair",
  "runManualExport",
  "typecheck",
  "tsc --noEmit",
];

const found = forbidden.filter((item) => match[0].includes(item));
if (found.length) {
  console.error(found.join("\n"));
  process.exit(1);
}
