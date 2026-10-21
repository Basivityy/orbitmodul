/**
 * Builds the final email (subject, plain text, HTML) from a template. Pure, so the same code renders
 * the real emails (server) and the live preview in the reseller's email editor (browser).
 */
import { inkFor } from "./color";
import { dropEmptyVariableLines, EN_DIVIDER, findTemplate, withRequiredCredentials } from "./emailTemplates";
import { escapeHtml, renderTemplate, textToHtml } from "./template";

/** Name the customer sees in emails: the reseller's sender name, or the store name when it is empty. */
export function emailSenderName(r: { emailFromName?: string | null; storeName: string }): string {
  return (r.emailFromName ?? "").trim() || r.storeName;
}

/** Email footer: sender name and the contact email. */
export function emailFooter(r: { emailFromName?: string | null; storeName: string; contactEmail?: string | null }): string {
  return `${emailSenderName(r)}${r.contactEmail ? " · " + r.contactEmail : ""}`;
}

export function wrapEmailHtml(title: string, inner: string, brandColor: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:${brandColor};color:${inkFor(brandColor)};padding:18px 24px;font-size:17px;font-weight:600">${escapeHtml(title)}</td></tr>
<tr><td style="padding:24px;font-size:15px">${inner}</td></tr>
<tr><td style="padding:14px 24px;font-size:12px;color:#6b7280;border-top:1px solid #f0f0f0">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderEmail(input: {
  key: string;
  subject: string;
  body: string;
  vars: Record<string, string | null | undefined>;
  title: string;
  brandColor: string;
  footer: string;
  extra?: { text: string; html: string };
}): RenderedEmail {
  const body = dropEmptyVariableLines(withRequiredCredentials(findTemplate(input.key), input.body, input.vars), input.vars);
  const subject = renderTemplate(input.subject, input.vars).replace(/\s+/g, " ").trim();
  const text = renderTemplate(body, input.vars) + (input.extra ? `\n\n${input.extra.text}` : "");
  const inner = textToHtml(renderTemplate(body, input.vars, { html: true })).replace(
    new RegExp(`<p[^>]*>\\s*${EN_DIVIDER}\\s*</p>`, "g"),
    '<div style="margin:26px 0 16px;padding-top:14px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;letter-spacing:.08em;text-transform:uppercase">English version</div>',
  );
  const html = wrapEmailHtml(input.title, inner + (input.extra?.html ?? ""), input.brandColor, input.footer);
  return { subject, text, html };
}
