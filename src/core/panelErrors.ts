/**
 * Panel / activation errors in plain words. The panel answers with short codes ("get_package",
 * "STATUS_NO_CREDITS", "HTTP 503…") — the reseller gets what happened, why, and what to do.
 * Unknown messages are returned unchanged as the detail.
 */
export interface ExplainedError {
  /** What happened, one line. */
  title: string;
  /** Why it happens and what to do. */
  fix: string;
  /** The panel's original answer (for support). */
  detail: string;
}

const RULES: Array<{ re: RegExp; title: string; fix: string }> = [
  {
    re: /already expired|born expired|0 duration/i,
    title: "The panel created the line already expired.",
    fix: "The panel package has no duration for this line type (e.g. a test package with 0 hours). Set the duration of the package on the panel, then click Retry activation.",
  },
  {
    re: /not linked to a package on your XUI panel/i,
    title: "The package is not linked to a panel package.",
    fix: "Open Packages & prices → the package → choose “Panel package” (or “Import packages from panel”), then click Retry activation.",
  },
  {
    re: /no line id/i,
    title: "The panel did not confirm the new line.",
    fix: "Check on the panel whether the line was created. If it was, use “Load existing line”; if not, click Retry activation.",
  },
  {
    re: /get_package|INVALID_PACKAGE|package (?:not found|does not exist)|no such package/i,
    title: "The panel did not find the package for this line.",
    fix: "The package in billing is linked to a panel package that does not exist (any more) or is not assigned to your reseller account. Open Packages & prices → the package → “Panel package”, pick an existing one (or click “Import packages from panel”), save, then click Retry activation.",
  },
  {
    re: /NO_CREDITS|NOT_ENOUGH_CREDITS|INSUFFICIENT_CREDITS|insufficient credits|not enough credits|credits? (?:too )?low/i,
    title: "Not enough credits on your panel account.",
    fix: "Top up credits on the XUI panel (or ask your panel admin), then click Retry activation.",
  },
  {
    re: /USERNAME_EXISTS|EXISTS_USERNAME|already exists|username (?:is )?taken|duplicate/i,
    title: "This username already exists on the panel.",
    fix: "Another line already uses this username. Add the customer again with another username (or leave it empty so one is generated), or load the existing line with “Load existing line”.",
  },
  {
    re: /INVALID_USERNAME|invalid username/i,
    title: "The panel refused the username.",
    fix: "Use 4–40 letters and numbers only (no spaces or special characters), or leave it empty so one is generated.",
  },
  {
    re: /INVALID_PASSWORD|invalid password/i,
    title: "The panel refused the password.",
    fix: "Use 4–40 letters and numbers only, or leave it empty so one is generated.",
  },
  {
    re: /INVALID_(?:API_)?KEY|invalid api key|API key|ACCESS_DENIED|NO_PERMISSION|not allowed|unauthori[sz]ed|HTTP 40[13]/i,
    title: "The panel refused the API key.",
    fix: "The API key in XUI One panels is wrong, was changed on the panel, or has no right to create lines. Open XUI One panels → your panel, paste the current key and click Test connection.",
  },
  {
    re: /invalid action/i,
    title: "The panel does not know this command.",
    fix: "The API address probably points to the wrong API (admin vs reseller). Check the API URL in XUI One panels and click Test connection.",
  },
  {
    re: /HTTP (?:429|502|503|504)|Service (?:Temporarily )?Unavailable|Too Many Requests|Bad Gateway|Gateway Time-?out/i,
    title: "The panel was busy or temporarily down.",
    fix: "Nothing is wrong with the order — the panel did not answer in time. It is retried automatically; you can also click Retry activation in a minute.",
  },
  {
    re: /timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|could not be reached|socket hang up|network/i,
    title: "The panel could not be reached.",
    fix: "The panel server did not answer (down, wrong address or blocked). Check that the panel works, then click Retry activation.",
  },
  {
    re: /non-JSON|Invalid \(non-JSON\)|Unexpected token|<html/i,
    title: "The panel answered with a web page instead of data.",
    fix: "The API address is probably wrong (it must be the API link, not the panel login page). Check it in XUI One panels → Test connection.",
  },
  {
    re: /private or internal|Cannot resolve/i,
    title: "The panel address cannot be used.",
    fix: "The address points to a private network or does not exist. Use the public address of the panel.",
  },
  {
    re: /^STATUS_FAILURE$|^Unknown API error$|^STATUS_[A-Z_]+$/i,
    title: "The panel refused the request without a reason.",
    fix: "Usually the package, the credits or the username. Check the package link (Packages & prices), your credits and try another username, then click Retry activation.",
  },
];

/** Strips our own prefixes so the rules see the panel's text. */
function core(msg: string): string {
  return msg.replace(/^(?:Panel error|Activation failed|Error):\s*/i, "").trim();
}

export function explainPanelError(raw: string | null | undefined): ExplainedError | null {
  const msg = String(raw ?? "").trim();
  if (!msg) return null;
  const c = core(msg);
  for (const r of RULES) if (r.re.test(c)) return { title: r.title, fix: r.fix, detail: c.slice(0, 300) };
  // Already a sentence written for people (our own messages) → show it as it is.
  if (/\s/.test(c) && c.length > 25) return { title: c, fix: "", detail: "" };
  return { title: "The panel refused the request.", fix: "Check the package link (Packages & prices), your panel credits and the API key (XUI One panels → Test connection), then click Retry activation. If it keeps failing, send the panel answer below to support.", detail: c.slice(0, 300) };
}

/** One line for lists and flash messages. */
export function explainPanelErrorText(raw: string | null | undefined): string {
  const e = explainPanelError(raw);
  if (!e) return "";
  return [e.title, e.fix, e.detail ? `(Panel answer: ${e.detail})` : ""].filter(Boolean).join(" ");
}
