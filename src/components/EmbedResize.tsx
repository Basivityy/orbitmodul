"use client";

import { useEffect } from "react";

/** Inside the widget iframe: tells the host page our height, so there is no inner scrollbar. */
export function EmbedResize() {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "orbitmodul:height", height: document.documentElement.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    window.addEventListener("load", send);
    return () => {
      ro.disconnect();
      window.removeEventListener("load", send);
    };
  }, []);
  return null;
}
