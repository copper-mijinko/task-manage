import DOMPurify from "dompurify";

const FORBIDDEN_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
  "base",
];

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,/i;

/**
 * Sanitize HTML generated from user-controlled Markdown while retaining the
 * formatting Task Manage supports (tables, details, highlighted code and task
 * list checkboxes). Mermaid SVG is generated after this step and is therefore
 * unaffected by the HTML profile used here.
 */
export function sanitizeMarkdownHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: ["style", "srcdoc", "formaction", "xlink:href"],
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SANITIZE_DOM: true,
    SANITIZE_NAMED_PROPS: true,
  });

  const template = document.createElement("template");
  template.innerHTML = String(sanitized);

  template.content.querySelectorAll("input").forEach((input) => {
    if (input.getAttribute("type")?.toLowerCase() !== "checkbox") {
      input.remove();
      return;
    }
    for (const attribute of [...input.attributes]) {
      if (!["type", "checked", "disabled"].includes(attribute.name)) {
        input.removeAttribute(attribute.name);
      }
    }
  });

  template.content.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    const src = image.getAttribute("src") ?? "";
    if (src.startsWith("data:") && !SAFE_DATA_IMAGE.test(src)) {
      image.removeAttribute("src");
    }
  });

  return template.innerHTML;
}
