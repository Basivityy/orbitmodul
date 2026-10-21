import { test } from "node:test";
import assert from "node:assert/strict";
import { appTemplateHtml } from "../../src/lib/appTemplate";

test("app template: valid script, configured API and store, no HTML injection", () => {
  const html = appTemplateHtml({ apiBase: "https://billing.example.com/api/app/v1", store: "main", appName: "Marko </script><script>alert(1)</script> TV", brandColor: "red;}</style><script>" });
  const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) ?? [];
  assert.equal(scripts.length, 1, "exactly one script block (the name cannot break out)");
  const js = scripts[0].replace(/^<script>/, "").replace(/<\/script>$/, "");
  assert.doesNotThrow(() => new Function(js), "template JavaScript parses");
  assert.match(js, /"API":"https:\/\/billing\.example\.com\/api\/app\/v1"/);
  assert.match(js, /"STORE":"main"/);
  assert.match(html, /--brand: #ffd400; --ink: #000000/, "invalid color falls back to signal yellow with black text");
  for (const call of ["/activate", "/status", "/extend"]) assert.ok(js.includes(`"${call}"`), call);
});
