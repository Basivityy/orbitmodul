"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { renderEmail } from "@/core/emailLayout";
import { VARIABLE_HELP } from "@/core/emailTemplates";
import { SubmitButton } from "@/components/client";

export type TestState = { ok: boolean; message: string } | null;

interface Props {
  def: { key: string; label: string; when?: string; variables: string[]; credentials?: boolean };
  saved: { subject: string; body: string };
  recommended: { subject: string; body: string };
  customized: boolean;
  sample: Record<string, string>;
  brand: { title: string; color: string; footer: string };
  defaultTo: string;
  saveAction: (fd: FormData) => Promise<void>;
  testAction: (prev: TestState, fd: FormData) => Promise<TestState>;
}

const hasVar = (text: string, name: string) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(text);

export function EmailTemplateEditor({ def, saved, recommended, customized, sample, brand, defaultTo, saveAction, testAction }: Props) {
  const [subject, setSubject] = useState(saved.subject);
  const [body, setBody] = useState(saved.body);
  const [showPreview, setShowPreview] = useState(true);
  const [test, testFormAction] = useActionState(testAction, null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<"subject" | "body">("body");

  const dirty = subject !== saved.subject || body !== saved.body;
  const isRecommended = subject === recommended.subject && body === recommended.body;
  const missingCreds = def.credentials ? (["username", "password"] as const).filter((v) => !hasVar(body, v)) : [];

  const preview = useMemo(
    () => renderEmail({ key: def.key, subject, body, vars: sample, title: brand.title, brandColor: brand.color, footer: brand.footer }),
    [def.key, subject, body, sample, brand],
  );

  function insert(name: string) {
    const token = `{{${name}}}`;
    const el = lastField.current === "subject" ? subjectRef.current : bodyRef.current;
    const value = lastField.current === "subject" ? subject : body;
    const set = lastField.current === "subject" ? setSubject : setBody;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    set(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800 sm:px-5 sm:py-4">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-base">
            {def.label}
            {customized ? <span className="badge-blue">your text</span> : <span className="badge-gray">recommended text</span>}
            {dirty && <span className="badge-amber">unsaved changes</span>}
          </h2>
          {def.when && <p className="muted mt-0.5">{def.when}</p>}
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setShowPreview((s) => !s)}>
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
      </div>

      <div className={`card-pad grid gap-6 ${showPreview ? "xl:grid-cols-2" : ""}`}>
        <div className="min-w-0 space-y-3">
          <form action={saveAction} className="space-y-3">
            <input type="hidden" name="key" value={def.key} />
            <div>
              <label className="label" htmlFor={`${def.key}-subject`}>Subject</label>
              <input ref={subjectRef} className="input" id={`${def.key}-subject`} name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} onFocus={() => (lastField.current = "subject")} maxLength={200} required />
            </div>
            <div>
              <label className="label" htmlFor={`${def.key}-body`}>Text</label>
              <textarea ref={bodyRef} className="input font-mono text-xs leading-relaxed" id={`${def.key}-body`} name="body" rows={def.credentials ? 18 : 10} value={body} onChange={(e) => setBody(e.target.value)} onFocus={() => (lastField.current = "body")} maxLength={10000} required />
            </div>
            <div>
              <p className="hint mb-1.5">Click to insert at the cursor — filled in automatically for every customer:</p>
              <div className="flex flex-wrap gap-1.5">
                {def.variables.map((v) => (
                  <button key={v} type="button" className="btn-secondary btn-sm font-mono" title={VARIABLE_HELP[v] ?? v} onClick={() => insert(v)}>
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
            {missingCreds.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                {missingCreds.map((v) => `{{${v}}}`).join(" and ")} {missingCreds.length > 1 ? "are" : "is"} not in your text. The customer always gets the login details, so {missingCreds.length > 1 ? "they are" : "it is"} added at the end of the email automatically.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="op" value="save">Save</SubmitButton>
              {dirty && (
                <button type="button" className="btn-ghost" onClick={() => { setSubject(saved.subject); setBody(saved.body); }}>
                  Undo changes
                </button>
              )}
              {!isRecommended && (
                <button type="button" className="btn-ghost" onClick={() => { setSubject(recommended.subject); setBody(recommended.body); }} title="Puts the recommended text in the editor. Click Save to keep it.">
                  Use recommended text
                </button>
              )}
              {customized && (
                <SubmitButton name="op" value="reset" className="btn-ghost text-rose-600" confirm="Delete your text and go back to the recommended text?">
                  Reset to recommended
                </SubmitButton>
              )}
            </div>
          </form>

          <form action={testFormAction} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input type="hidden" name="key" value={def.key} />
            <input type="hidden" name="subject" value={subject} />
            <input type="hidden" name="body" value={body} />
            <label className="label" htmlFor={`${def.key}-to`}>Send a test email</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="input flex-1" id={`${def.key}-to`} name="to" type="email" defaultValue={defaultTo} placeholder="name@example.com" required />
              <SubmitButton className="btn-secondary whitespace-nowrap">Send test</SubmitButton>
            </div>
            <p className="hint">Sends the text above (also unsaved changes) with example data, e.g. username <code>{sample.username}</code>. The subject starts with [TEST].</p>
            {test && (
              <p role={test.ok ? "status" : "alert"} className={`mt-2 rounded-lg px-3 py-2 text-sm ${test.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100" : "bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-100"}`}>
                {test.ok ? "✓ " : "! "}
                {test.message}
              </p>
            )}
          </form>
        </div>

        {showPreview && (
          <div className="min-w-0">
            <div className="label">Preview (example data)</div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="border-b border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <span className="muted">Subject: </span>
                <b>{preview.subject}</b>
              </div>
              <iframe title={`Preview: ${def.label}`} sandbox="" srcDoc={preview.html} className="h-[560px] w-full rounded-b-lg bg-white" />
            </div>
            {def.credentials && <p className="hint mt-2">If the package includes MaxPlayer, the app guide with download links is added below this text automatically.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
