// เซิร์ฟเวอร์ localhost สำหรับลองโมดูลโหมดทดสอบของ Pilot Web (RubberFlow, BOM รายแผนก) โดยไม่ต้องล็อกอิน Supabase
//
//   npm run pilot:harness            → http://localhost:5181/harness/   (PORT=… เปลี่ยนพอร์ตได้)
//                                    → http://localhost:5181/pilot-shell.html   (หน้าหลักจริงของ app.js ด้วย Supabase จำลองใน scripts/pilot-harness-mock.mjs; ?empty=1 = ไม่มีงาน, ?sandbox=1 = admin ในโหมดทดสอบ เห็น RubberFlow/BOM)
//
// ฟังเฉพาะ loopback (127.0.0.1 และ ::1) เครื่องอื่นใน LAN ต่อไม่ได้ และเสิร์ฟเฉพาะไฟล์ชุดเดียวกับที่ scripts/build-pilot.mjs เผยแพร่
// (/styles.css, /modules/*.js …) ไฟล์อื่นของ repo (.git, package.json, .env*) ได้ 404 แล้วสร้างหน้า /harness/ ที่โหลดสไตล์ + สคริปต์โมดูลทุกตัวตามลำดับใน
// index.html (ยกเว้น app.js) แล้วแทน app.js ด้วย stub ของ helper ที่โมดูลเรียก (state, app, shell, bindShell, renderNotFound,
// escapeHtml, showToast, friendlyError, confirmDialog, renderRoute, currentRoute) โดยถือว่าอยู่ในโหมดทดสอบเสมอ ข้อมูลของโมดูลอยู่ใน localStorage
// ของเบราว์เซอร์เหมือนของจริง ใช้เพื่อดู/ลองกดเท่านั้น ไม่ใช่ทางเข้าของผู้ใช้จริง และสคริปต์นี้ไม่ถูกเผยแพร่ (ดู scripts/build-pilot.mjs)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mockSupabaseScript } from "./pilot-harness-mock.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5181;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8",
};
// allowlist เดียวกับ scripts/build-pilot.mjs: ไฟล์ที่ราก + โฟลเดอร์ที่หน้าเว็บโหลดจริง
const STATIC_FILES = new Set(["index.html", "app.js", "styles.css", "favicon.ico", "manifest.webmanifest", "sw.js"]);
const STATIC_DIRS = new Set(["modules", "fonts", "vendor", "icons"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function servable(relative) {
  const parts = relative.split(sep);
  if (parts.includes("..")) return false;
  return parts.length === 1 ? STATIC_FILES.has(parts[0]) : STATIC_DIRS.has(parts[0]) && parts.at(-1) !== "";
}

async function moduleScripts() {
  const html = await readFile(join(root, "index.html"), "utf8");
  return [...html.matchAll(/<script defer src="\.\/(modules\/[^"?]+)(?:\?v=[^"]*)?"><\/script>/g)].map((match) => match[1]);
}

async function harnessPage() {
  // Supabase จำลองต้องโหลดก่อนโมดูล: module-bom.js ดูว่ามี window.supabase หรือไม่เพื่อเลือกเก็บข้อมูลหลักในฐานข้อมูล (จำลอง) แทน localStorage
  const scripts = ["harness-mock-sandbox.js", ...(await moduleScripts())].map((path) => `  <script defer src="/${path}"></script>`).join("\n");
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pilot harness</title>
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body { margin: 0; }
    .h-shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
    .h-side { padding: 12px; background: #0b1f3a; color: #fff; }
    .h-side a { color: #fff; }
    .h-side > div { margin-top: 10px; }
    .content { padding: 16px; min-width: 0; }
    .h-toast { position: fixed; right: 12px; bottom: 12px; padding: 10px 14px; background: #222; color: #fff; border-radius: 8px; max-width: 420px; z-index: 99; }
    .h-toast.error { background: #b3261e; }
    .h-note { font-size: 12px; opacity: .75; }
    @media (max-width: 760px) { .h-shell { grid-template-columns: 1fr; } .h-side { display: none; } }
  </style>
  <script>
    // stub ของ app.js: โมดูลอ้างเป็น global และ root.escapeHtml จึงต้องเป็น property ของ window
    window.MNP_REQUEST_MODULES = {};
    // บัญชีทดสอบ (persona) แบบ admin: BOM เทียบกับตำแหน่ง/แผนกนี้เพื่อให้เขียนข้อมูลหลักได้ (เหมือน persona ของ /pilot-shell.html?sandbox=1)
    const state = { employee: { isSandbox: true, id: "persona-1", employee_no: "E001", first_name: "ปกรณ์", last_name: "ศรีวัฒนา", display_name: "harness", role: { code: "admin" }, department: { code: "MT" } } };
    // sb ของ app.js: RPC ข้อมูลหลัก BOM ไปที่ Supabase จำลองตัวเดียวกับ /pilot-shell.html (สคริปต์ /harness-mock-sandbox.js) ข้อมูลเก็บใน localStorage ของพอร์ตนี้
    const sb = { rpc: (name, args) => window.supabase.createClient().rpc(name, args) };
    let app = null;
    const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    const showToast = (message, kind = "ok") => {
      const node = document.createElement("div");
      node.className = "h-toast" + (kind === "error" ? " error" : "");
      node.textContent = message;
      document.body.appendChild(node);
      setTimeout(() => node.remove(), 3500);
    };
    const friendlyError = (error) => String(error && error.message ? error.message : error);
    const currentRoute = () => {
      const raw = location.hash.replace(/^#\\/?/, "");
      const [path, query = ""] = raw.split("?");
      return { path, params: new URLSearchParams(query) };
    };
    const navItems = () => Object.values(window.MNP_REQUEST_MODULES).flatMap((entry) => entry.nav || []);
    const shell = (content, path, title) => {
      document.title = title;
      const nav = navItems().map((item) => "<div><a href=\\"#/" + item.path + "\\">" + escapeHtml(item.label) + "</a>" + ((item.subnav && item.subnav(path)) || "") + "</div>").join("");
      return "<div class=\\"h-shell\\"><aside class=\\"h-side\\"><strong>Pilot harness</strong><div class=\\"h-note\\">โหมดทดสอบจำลอง ไม่มี Supabase</div>" + nav + "</aside><main class=\\"content\\">" + content + "</main></div>";
    };
    const bindShell = () => {};
    const loadingShell = () => {};
    const renderNotFound = () => { app.innerHTML = "<p>not found</p>"; };
    async function renderRoute() {
      const { path, params } = currentRoute();
      const entry = Object.values(window.MNP_REQUEST_MODULES).find((item) => item.pages && typeof item.pages[path] === "function");
      if (!entry) {
        const links = navItems().map((item) => "<a href=\\"#/" + item.path + "\\">" + escapeHtml(item.label) + "</a>").join(" · ");
        app.innerHTML = shell("<p>เลือกโมดูล: " + links + "</p>", "", "Pilot harness");
        return;
      }
      await entry.pages[path](params);
    }
    // กฎกลางของ popup (สำเนาจาก app.js): ปิดเมื่อแตะ/ย้าย focus ออกนอกกรอบของ popup ไม่ใช้ blur
    function closePopup(popup) {
      popup.hidden = true;
      const owner = popup.parentElement.querySelector("[aria-expanded]");
      if (owner) { owner.setAttribute("aria-expanded", "false"); owner.removeAttribute("aria-activedescendant"); }
      popup.dispatchEvent(new CustomEvent("popup-close"));
    }
    const closePopupsOutside = (event) => document.querySelectorAll("[data-popup]:not([hidden])").forEach((popup) => { if (!popup.parentElement.contains(event.target)) closePopup(popup); });
    document.addEventListener("pointerdown", closePopupsOutside);
    document.addEventListener("focusin", closePopupsOutside);
    // กล่องยืนยัน (ย่อจาก confirmDialog ของ app.js): markup/class เดียวกัน ยืนยัน = true · ยกเลิก/Esc/เปลี่ยนหน้า = false
    function confirmDialog({ title, message = "", confirmLabel, danger = false }) {
      return new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.className = "confirm-dialog";
        dialog.innerHTML = "<form method=\\"dialog\\"><h2></h2>" + (message ? "<p></p>" : "") + "<div class=\\"confirm-dialog-actions\\"><button class=\\"btn secondary\\" value=\\"cancel\\">ยกเลิก</button><button class=\\"btn" + (danger ? " danger-solid" : "") + "\\" value=\\"confirm\\"></button></div></form>";
        dialog.querySelector("h2").textContent = title;
        if (message) dialog.querySelector("p").textContent = message;
        dialog.querySelector("[value=confirm]").textContent = confirmLabel;
        let settled = false;
        const finish = (confirmed) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("hashchange", cancelOnLeave);
          if (dialog.open) dialog.close();
          dialog.remove();
          resolve(confirmed);
        };
        const cancelOnLeave = () => finish(false);
        window.addEventListener("hashchange", cancelOnLeave, { once: true });
        dialog.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); finish(Boolean(event.submitter && event.submitter.value === "confirm")); });
        dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
        document.body.appendChild(dialog);
        dialog.showModal();
        dialog.querySelector("[value=cancel]").focus();
      });
    }
    Object.assign(window, { escapeHtml, showToast, friendlyError, currentRoute, shell, bindShell, loadingShell, renderNotFound, renderRoute, closePopup, confirmDialog });
    window.addEventListener("DOMContentLoaded", () => {
      app = document.getElementById("app");
      window.addEventListener("hashchange", renderRoute);
      renderRoute();
    });
  </script>
${scripts}
</head>
<body><div id="app"></div></body>
</html>
`;
}

async function shellPage() {
  const html = await readFile(join(root, "index.html"), "utf8");
  const cdn = /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^"]*"><\/script>/;
  if (!cdn.test(html)) throw new Error("supabase script tag not found in index.html");
  // CSP ของ index.html ห้าม inline script จึงโหลด mock เป็นไฟล์จาก origin เดียวกัน (defer ตามลำดับ ก่อนโมดูลและ app.js)
  return html.replace(cdn, '<script defer src="/harness-mock-supabase.js"></script>');
}

async function handle(request, response) {
  try {
    // Host ต้องเป็น loopback ด้วย กันหน้าเว็บภายนอกที่ใช้ DNS rebinding ชี้ชื่อของตัวเองมาที่ 127.0.0.1
    let host = "";
    try { host = new URL(`http://${request.headers.host ?? ""}`).hostname; } catch { host = ""; }
    if (!LOOPBACK_HOSTS.has(host)) { response.writeHead(403); response.end("forbidden"); return; }
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname === "/" || url.pathname === "/harness" || url.pathname === "/harness/") {
      response.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
      response.end(await harnessPage());
      return;
    }
    if (url.pathname === "/harness-mock-supabase.js") {
      response.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
      response.end(mockSupabaseScript());
      return;
    }
    // หน้า /harness/ ไม่มี ?sandbox=1 ใน URL จึงได้ Supabase จำลองที่เปิดโหมดทดสอบไว้เลย
    if (url.pathname === "/harness-mock-sandbox.js") {
      response.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
      response.end(mockSupabaseScript({ sandbox: true }));
      return;
    }
    if (url.pathname === "/pilot-shell.html") {
      response.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
      response.end(await shellPage());
      return;
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "");
    if (!servable(relative)) { response.writeHead(404); response.end("not found"); return; }
    const data = await readFile(join(root, relative));
    response.writeHead(200, { "content-type": TYPES[extname(relative)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(data);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500);
    response.end(error?.code === "ENOENT" ? "not found" : "error");
  }
}

// สองเซิร์ฟเวอร์ใช้ handler เดียวกัน: localhost อาจถูก resolve เป็น ::1 (เช่น browser pane ของ Claude desktop) หรือ 127.0.0.1
// เครื่องที่ปิด IPv6 จะฟังได้แค่ 127.0.0.1 ซึ่งยังใช้ได้ ข้อผิดพลาดอื่น (เช่น EADDRINUSE) ทำให้จบด้วย exit code 1
const IPV6_UNAVAILABLE = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT", "EINVAL"]);
for (const address of ["127.0.0.1", "::1"]) {
  http.createServer(handle)
    .on("error", (error) => {
      if (address === "::1" && IPV6_UNAVAILABLE.has(error.code)) {
        console.warn(`Pilot harness: IPv6 loopback unavailable (${error.code}), listening on 127.0.0.1 only`);
        return;
      }
      console.error(`Pilot harness: listen on ${address}:${port} failed (${error.code ?? error.message})`);
      process.exit(1);
    })
    .listen(port, address, () => {
      if (address === "127.0.0.1") console.log(`Pilot harness: http://localhost:${port}/harness/  (BOM: #/bom · RubberFlow: #/rubberflow) · shell: /pilot-shell.html`);
    });
}
