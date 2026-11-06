"use client";

import { useEffect } from "react";

/**
 * On phones every `.table` turns into a list of cards (one card per row, "Label: value" lines),
 * so nothing has to be scrolled sideways. The labels come from the table head; the CSS for it is
 * in globals.css (`.table[data-cards]`). Tables with `data-nocards` stay tables.
 */
function label(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>("table.table:not([data-nocards])").forEach((t) => {
    const heads = Array.from(t.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim());
    if (!heads.length) return;
    t.querySelectorAll("tbody tr").forEach((tr) => {
      let col = 0;
      Array.from(tr.children).forEach((td) => {
        const span = Number((td as HTMLTableCellElement).colSpan) || 1;
        if (span > 1) td.setAttribute("data-wide", "");
        else if (!td.hasAttribute("data-label")) td.setAttribute("data-label", heads[col] ?? "");
        col += span;
      });
    });
    t.setAttribute("data-cards", "");
  });
}

export function MobileTables() {
  useEffect(() => {
    label(document);
    let queued = false;
    const obs = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        label(document);
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return null;
}
