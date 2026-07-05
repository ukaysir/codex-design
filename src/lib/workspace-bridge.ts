export const WORKSPACE_SELECTION_APP_TSX = String.raw`import { useEffect } from "react";
import Screen from "./generated/Screen";

function closestAnchor(target: EventTarget | null) {
  return target instanceof Element ? target.closest("[data-comment-anchor]") : null;
}

function elementPath(element: Element) {
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && path.length < 6) {
    const anchor = current.getAttribute("data-comment-anchor");
    const screen = current.getAttribute("data-screen-label");
    const id = current.id ? "#" + current.id : "";
    path.unshift(
      current.tagName.toLowerCase() +
        id +
        (screen ? '[data-screen-label="' + screen + '"]' : "") +
        (anchor ? '[data-comment-anchor="' + anchor + '"]' : ""),
    );
    current = current.parentElement;
  }
  return path;
}

function DesignForgeSelectionBridge() {
  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).get("designforgeSelect") === "1";
    if (!enabled) return;

    document.documentElement.setAttribute("data-designforge-select", "1");

    const style = document.createElement("style");
    style.id = "designforge-selection-style";
    style.textContent = [
      'html[data-designforge-select="1"] [data-comment-anchor] { cursor: crosshair; outline: 2px solid rgba(34, 211, 238, 0.32); outline-offset: 2px; }',
      'html[data-designforge-select="1"] [data-comment-anchor]:hover { outline-color: rgba(190, 242, 100, 0.92); }',
      'html[data-designforge-select="1"] [data-designforge-selected="true"] { outline: 3px solid #bef264 !important; outline-offset: 3px; }',
    ].join("\n");
    document.head.appendChild(style);

    let selected: Element | null = null;

    function handleClick(event: MouseEvent) {
      const element = closestAnchor(event.target);
      if (!element) return;

      event.preventDefault();
      event.stopPropagation();

      if (selected) selected.removeAttribute("data-designforge-selected");
      selected = element;
      selected.setAttribute("data-designforge-selected", "true");

      const anchorId = element.getAttribute("data-comment-anchor") || "";
      const screenLabel =
        element.closest("[data-screen-label]")?.getAttribute("data-screen-label") || "Generated Screen";
      const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);

      window.parent.postMessage(
        {
          source: "designforge-preview-select",
          anchorId,
          screenLabel,
          tagName: element.tagName.toLowerCase(),
          text,
          path: elementPath(element),
        },
        "*",
      );
    }

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.documentElement.removeAttribute("data-designforge-select");
      style.remove();
      if (selected) selected.removeAttribute("data-designforge-selected");
    };
  }, []);

  return null;
}

export default function App() {
  return (
    <>
      <DesignForgeSelectionBridge />
      <Screen />
    </>
  );
}
`;
