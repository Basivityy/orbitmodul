export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders {{variable}} placeholders. Values are HTML-escaped when `html` is true,
 * so reseller-provided data cannot inject markup into emails. Unknown vars render empty.
 */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>, opts: { html?: boolean } = {}): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined) return "";
    const s = String(v);
    return opts.html ? escapeHtml(s) : s;
  });
}

/** Convert a plain-text template body into simple HTML paragraphs (after rendering escaped vars). */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function templateVariables(template: string): string[] {
  return Array.from(new Set(Array.from(template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((m) => m[1])));
}
