import { inkFor } from "../core/color";

/**
 * Starter app (one HTML file) that implements the whole code-login flow against the App API.
 * Works as-is in a browser, as a Samsung Tizen / LG webOS web app, or inside an Android/iOS WebView.
 * The developer only plugs a video player into `play()`.
 */
export function appTemplateHtml(cfg: { apiBase: string; store: string | null; appName: string; brandColor: string }): string {
  const conf = JSON.stringify({ API: cfg.apiBase, STORE: cfg.store, NAME: cfg.appName }).replace(/</g, "\\u003c");
  const color = /^#[0-9a-fA-F]{6}$/.test(cfg.brandColor) ? cfg.brandColor : "#ffd400";
  const ink = inkFor(color);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>App</title>
<style>
  :root { --brand: ${color}; --ink: ${ink}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #000; color: #f5f5f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .card { width: 100%; max-width: 440px; background: #141413; border: 1px solid #242422; border-top: 3px solid var(--brand); border-radius: 12px; padding: 28px; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
  h1 { margin: 0 0 6px; font-size: 22px; } p { color: #9aa6c0; margin: 0 0 18px; font-size: 14px; }
  input { width: 100%; padding: 14px; border-radius: 10px; border: 2px solid #3a3a36; background: #000; color: #fff; font-size: 20px; letter-spacing: 3px; text-transform: uppercase; text-align: center; }
  input:focus, button:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px rgba(255,255,255,.15); }
  button { width: 100%; margin-top: 12px; padding: 14px; border: 2px solid transparent; border-radius: 10px; background: var(--brand); color: var(--ink); font-size: 17px; font-weight: 600; cursor: pointer; }
  button.secondary { background: transparent; border-color: #3a3a36; color: #deded8; }
  .msg { min-height: 22px; margin-top: 12px; font-size: 14px; color: #ffb4b4; }
  .ok { color: #9be6b4; } dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; font-size: 14px; } dt { color: #9aa6c0; } dd { margin: 0; font-family: ui-monospace, monospace; word-break: break-all; }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="card">
  <!-- 1) Enter code -->
  <section id="login">
    <h1 id="title"></h1>
    <p>Enter the code you received after payment.</p>
    <input id="code" maxlength="14" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autofocus>
    <button id="go">Activate</button>
    <div class="msg" id="loginMsg"></div>
  </section>

  <!-- 2) Signed in -->
  <section id="home" class="hidden">
    <h1>Ready to watch</h1>
    <p id="state"></p>
    <dl>
      <dt>Valid until</dt><dd id="exp"></dd>
      <dt>Server</dt><dd id="srv"></dd>
      <dt>Username</dt><dd id="usr"></dd>
      <dt>Password</dt><dd id="pwd"></dd>
      <dt>Devices</dt><dd id="dev"></dd>
    </dl>
    <button id="watch">Watch</button>
    <button class="secondary" id="showExtend">Extend with a new code</button>
    <div id="extendBox" class="hidden">
      <input id="newCode" maxlength="14" placeholder="NEW CODE" autocomplete="off" style="margin-top:12px">
      <button id="extend">Extend</button>
    </div>
    <button class="secondary" id="logout">Sign out</button>
    <div class="msg" id="homeMsg"></div>
  </section>
</div>
<script>
const CONFIG = ${conf};
document.getElementById("title").textContent = CONFIG.NAME;

// A stable id for this device (keep it the same across app restarts; on Android use ANDROID_ID).
function deviceId() {
  let id = localStorage.getItem("deviceId");
  if (!id) { id = "dev-" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem("deviceId", id); }
  return id;
}
async function call(path, body) {
  const res = await fetch(CONFIG.API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, deviceId: deviceId(), deviceName: navigator.userAgent.slice(0, 60), store: CONFIG.STORE || undefined }) });
  const data = await res.json().catch(() => ({ status: "error", message: "Network error" }));
  if (data.status === "error") throw new Error(data.message || data.error);
  return data;
}
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let session = null;

function show(data) {
  session = data;
  $("login").classList.add("hidden"); $("home").classList.remove("hidden");
  $("state").textContent = data.status === "expired" ? "Your subscription has expired — enter a new code." : data.status === "extending" ? "Extending…" : "Your subscription is active.";
  $("exp").textContent = data.expiresAt ? new Date(data.expiresAt).toLocaleString() : "—";
  $("srv").textContent = data.server || ""; $("usr").textContent = data.username || ""; $("pwd").textContent = data.password || "";
  $("dev").textContent = data.devices ? data.devices.used + " / " + data.devices.limit : "";
}

// Activate a new code, or sign in again with the code the line was activated with.
async function activate(code) {
  $("loginMsg").textContent = "Please wait…"; $("loginMsg").className = "msg ok";
  for (let i = 0; i < 40; i++) {
    const data = await call("/activate", { code });
    if (data.status !== "activating") { localStorage.setItem("loginCode", code); return show(data); }
    $("loginMsg").textContent = data.message || "Creating your line…";
    await sleep(3000);
  }
  throw new Error("It is taking longer than usual. Try again in a minute.");
}

// On every app start: refresh the details (expiry may have changed after an extension).
async function refresh() {
  const loginCode = localStorage.getItem("loginCode");
  if (!loginCode) return;
  try { show(await call("/status", { loginCode })); } catch (e) { $("loginMsg").textContent = e.message; localStorage.removeItem("loginCode"); }
}

async function extend() {
  const loginCode = localStorage.getItem("loginCode");
  const code = $("newCode").value.trim();
  $("homeMsg").textContent = "Please wait…"; $("homeMsg").className = "msg ok";
  try {
    await call("/extend", { loginCode, code });
    for (let i = 0; i < 40; i++) { await sleep(3000); const d = await call("/status", { loginCode }); if (d.status !== "extending") { show(d); $("homeMsg").textContent = "Extended!"; return; } }
  } catch (e) { $("homeMsg").textContent = e.message; $("homeMsg").className = "msg"; }
}

// Plug your player here. Xtream Codes API: server + username + password.
//  - Live/VOD/Series lists: <server>/player_api.php?username=U&password=P
//  - Playlist (M3U):        <server>/get.php?username=U&password=P&type=m3u_plus&output=ts
function play() {
  if (!session) return;
  const m3u = session.server + "/get.php?username=" + encodeURIComponent(session.username) + "&password=" + encodeURIComponent(session.password) + "&type=m3u_plus&output=ts";
  alert("Connect your player here.\\n\\nM3U: " + m3u);
}

$("go").onclick = () => activate($("code").value.trim()).catch((e) => { $("loginMsg").textContent = e.message; $("loginMsg").className = "msg"; });
$("code").onkeydown = (e) => { if (e.key === "Enter") $("go").click(); };
$("watch").onclick = play;
$("showExtend").onclick = () => $("extendBox").classList.toggle("hidden");
$("extend").onclick = extend;
$("logout").onclick = () => { localStorage.removeItem("loginCode"); session = null; $("home").classList.add("hidden"); $("login").classList.remove("hidden"); };
refresh();
</script>
</body>
</html>
`;
}
