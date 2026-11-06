import { test } from "node:test";
import assert from "node:assert/strict";
import { explainPanelError, explainPanelErrorText } from "../../src/core/panelErrors";

test("panel errors: short panel codes are explained with what to do", () => {
  const e = explainPanelError("get_package")!;
  assert.match(e.title, /did not find the package/);
  assert.match(e.fix, /Panel package/);
  assert.equal(e.detail, "get_package");
  assert.match(explainPanelError("Panel error: STATUS_NO_CREDITS")!.title, /credits/);
  assert.match(explainPanelError("HTTP 503: <html>503 Service Temporarily Unavailable</html>")!.title, /busy/);
  assert.match(explainPanelError("STATUS_EXISTS_USERNAME")!.title, /already exists/);
  assert.match(explainPanelError("Invalid API key")!.title, /API key/);
  assert.match(explainPanelError("STATUS_FAILURE")!.title, /without a reason/);
  assert.match(explainPanelError("This package is not linked to a package on your XUI panel (needed to extend lines with a reseller API key).")!.title, /not linked/);
});

test("panel errors: our own sentences stay, unknown codes get general advice, empty is nothing", () => {
  assert.equal(explainPanelError("Line was removed from the panel by someone else in the meantime.")!.title, "Line was removed from the panel by someone else in the meantime.");
  assert.match(explainPanelError("weird_code_42")!.fix, /Retry activation/);
  assert.equal(explainPanelError(""), null);
  assert.match(explainPanelErrorText("get_package"), /Panel answer: get_package/);
});
