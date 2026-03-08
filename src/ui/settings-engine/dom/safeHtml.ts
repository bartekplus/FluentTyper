const ALLOWED_TAGS = new Set([
  "A",
  "BR",
  "CODE",
  "DIV",
  "EM",
  "LI",
  "P",
  "SMALL",
  "SPAN",
  "STRONG",
  "UL",
]);

const GLOBAL_ATTRIBUTES = new Set(["class", "id"]);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  A: new Set(["href", "rel", "target"]),
};

function sanitizeHref(rawHref: string): string | null {
  const trimmedHref = rawHref.trim();
  if (!trimmedHref) {
    return null;
  }

  try {
    const url = new URL(trimmedHref, "https://fluenttyper.invalid");
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}

function cloneSanitizedNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? "");
  }

  if (!(node instanceof Element)) {
    return null;
  }

  const tagName = node.tagName.toUpperCase();
  if (!ALLOWED_TAGS.has(tagName)) {
    const fragment = document.createDocumentFragment();
    node.childNodes.forEach((child) => {
      const sanitizedChild = cloneSanitizedNode(child);
      if (sanitizedChild) {
        fragment.appendChild(sanitizedChild);
      }
    });
    return fragment;
  }

  const element = document.createElement(tagName.toLowerCase());
  for (const { name, value } of Array.from(node.attributes)) {
    if (GLOBAL_ATTRIBUTES.has(name)) {
      element.setAttribute(name, value);
      continue;
    }

    if (!TAG_ATTRIBUTES[tagName]?.has(name)) {
      continue;
    }

    if (tagName === "A" && name === "href") {
      const href = sanitizeHref(value);
      if (href) {
        element.setAttribute("href", href);
      }
      continue;
    }

    if (tagName === "A" && name === "target") {
      if (value === "_blank") {
        element.setAttribute("target", "_blank");
      }
      continue;
    }

    if (tagName === "A" && name === "rel") {
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  if (tagName === "A" && element.getAttribute("target") === "_blank") {
    element.setAttribute("rel", "noopener noreferrer");
  }

  node.childNodes.forEach((child) => {
    const sanitizedChild = cloneSanitizedNode(child);
    if (sanitizedChild) {
      element.appendChild(sanitizedChild);
    }
  });

  return element;
}

export function setSafeHtmlContent(container: HTMLElement, html: string): void {
  if (!html) {
    container.replaceChildren();
    return;
  }

  const parsed = new window.DOMParser().parseFromString(html, "text/html");
  const nodes = Array.from(parsed.body.childNodes)
    .map((node) => cloneSanitizedNode(node))
    .filter((node): node is Node => node !== null);

  container.replaceChildren(...nodes);
}
