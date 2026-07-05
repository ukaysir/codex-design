import type { AnchorInfo } from "../types";

export type SectionImageTask = {
  id: string;
  label: string;
  prompt: string;
};

export function isImageGenerationRequest(request: string) {
  return /\$imagegen|이미지\s*(생성|만들|그려|제작)|그림\s*(생성|만들|그려|제작)|generate\s+(an?\s+)?image|create\s+(an?\s+)?image/i.test(request);
}

export function isMultiSectionImageRequest(request: string) {
  return (
    isImageGenerationRequest(request) &&
    /(각\s*(섹션|구역|영역|파트)|섹션별|구역별|영역별|section\s*(by|per)|per\s+section|each\s+section|every\s+section|backgrounds?|배경)/i.test(request)
  );
}

export function shouldApplyGeneratedImagesToScreen(request: string) {
  return /(넣어|넣어줘|적용|배경|background|place|insert|use\s+.*image|이미지.*사용)/i.test(request);
}

function sectionImageTaskId(value: string, index: number) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || `section-${index + 1}`;
}

export function buildSectionImageTasks(request: string, anchors: AnchorInfo[], generatedImagesDir: string): SectionImageTask[] {
  const anchorCandidates = anchors
    .filter((anchor) => !/(primary-action|agent-chat|run-history|codex-wrapper|pipeline|project|toolbar|button|input)/i.test(anchor.id))
    .slice(0, 6);
  const fallbackLabels = ["hero", "main-content", "supporting-section", "closing-section"];
  const labels = anchorCandidates.length
    ? anchorCandidates.map((anchor) => `${anchor.id} on ${anchor.screenLabel}`)
    : fallbackLabels;

  return labels.map((label, index) => {
    const id = sectionImageTaskId(label, index);
    return {
      id,
      label,
      prompt: [
        `Single-image task ${index + 1}/${labels.length}.`,
        `Create exactly one polished raster background image for the "${label}" section.`,
        `Use filename hint: ${generatedImagesDir}/${id}-background.png.`,
        "The image must work behind UI text: low clutter, strong negative space, no logos, no readable fake text.",
        "Keep it visually distinct from the other section backgrounds while matching the same product/design system.",
        "",
        `Original user request: ${request}`,
      ].join("\n"),
    };
  });
}
