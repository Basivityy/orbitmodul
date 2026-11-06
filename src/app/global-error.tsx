"use client";

/** Last resort when even the root layout fails: plain HTML, no app styles needed. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <div style={{ maxWidth: 480, margin: "48px auto", padding: 24, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16 }}>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>This page could not be loaded</h1>
          <p style={{ fontSize: 14, color: "#475569" }}>Something went wrong. Try again — if it keeps happening, send the error id to support.</p>
          {error?.digest && <p style={{ fontFamily: "monospace", fontSize: 12, color: "#64748b" }}>Error id: {error.digest}</p>}
          <button type="button" onClick={() => reset()} style={{ marginRight: 8, padding: "8px 14px", borderRadius: 8, border: 0, background: "#f59e0b", fontWeight: 700 }}>Try again</button>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>Reload page</button>
        </div>
      </body>
    </html>
  );
}
