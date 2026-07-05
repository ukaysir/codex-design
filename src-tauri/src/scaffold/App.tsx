import { useEffect } from "react";
import Screen from "./generated/Screen";

function closestAnchor(target: EventTarget | null) {
  return target instanceof Element ? target.closest("[data-comment-anchor]") : null;
}

function targetElement(target: EventTarget | null, anchor: Element) {
  return target instanceof Element && anchor.contains(target) ? target : anchor;
}

function siblingIndex(element: Element) {
  const siblings = Array.from(element.parentElement?.children ?? []).filter((item) => item.tagName === element.tagName);
  const index = siblings.indexOf(element);
  return siblings.length > 1 && index >= 0 ? ":nth-of-type(" + (index + 1) + ")" : "";
}

function elementPath(element: Element) {
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && path.length < 8) {
    const anchor = current.getAttribute("data-comment-anchor");
    const screen = current.getAttribute("data-screen-label");
    const id = current.id ? "#" + current.id : "";
    const classes = (current.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((name) => "." + name.replace(/[^a-zA-Z0-9_-]/g, ""))
      .join("");
    path.unshift(
      current.tagName.toLowerCase() +
        id +
        classes +
        siblingIndex(current) +
        (screen ? '[data-screen-label="' + screen + '"]' : "") +
        (anchor ? '[data-comment-anchor="' + anchor + '"]' : ""),
    );
    current = current.parentElement;
  }
  return path;
}

function compactText(element: Element) {
  return (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

function DesignForgeSelectionBridge() {
  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).get("designforgeSelect") === "1";
    if (!enabled) return;

    document.documentElement.setAttribute("data-designforge-select", "1");

    const style = document.createElement("style");
    style.id = "designforge-selection-style";
    style.textContent = [
      'html[data-designforge-select="1"] [data-comment-anchor], html[data-designforge-select="1"] [data-comment-anchor] * { cursor: crosshair; }',
      'html[data-designforge-select="1"] [data-comment-anchor] { outline: 2px solid rgba(34, 211, 238, 0.22); outline-offset: 2px; }',
      'html[data-designforge-select="1"] [data-comment-anchor] *:hover { outline: 2px solid rgba(190, 242, 100, 0.86); outline-offset: 2px; }',
      'html[data-designforge-select="1"] [data-designforge-selected="true"] { outline: 3px solid #bef264 !important; outline-offset: 3px; }',
    ].join("\n");
    document.head.appendChild(style);

    let selected: Element | null = null;

    function handleClick(event: MouseEvent) {
      const anchor = closestAnchor(event.target);
      if (!anchor) return;
      const element = targetElement(event.target, anchor);

      event.preventDefault();
      event.stopPropagation();

      if (selected) selected.removeAttribute("data-designforge-selected");
      selected = element;
      selected.setAttribute("data-designforge-selected", "true");

      const anchorId = anchor.getAttribute("data-comment-anchor") || "";
      const screenLabel =
        anchor.closest("[data-screen-label]")?.getAttribute("data-screen-label") || "Generated Screen";
      const text = compactText(element);
      const anchorText = compactText(anchor);

      window.parent.postMessage(
        {
          source: "designforge-preview-select",
          anchorId,
          screenLabel,
          tagName: element.tagName.toLowerCase(),
          anchorTagName: anchor.tagName.toLowerCase(),
          text,
          anchorText,
          className: element.getAttribute("class") || "",
          path: elementPath(element),
          anchorPath: elementPath(anchor),
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
