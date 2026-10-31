// เซิร์ฟเวอร์ localhost สำหรับลองโมดูลโหมดทดสอบของ Pilot Web (RubberFlow, BOM รายแผนก) โดยไม่ต้องล็อกอิน Supabase
//
//   npm run pilot:harness            → http://localhost:5181/harness/   (PORT=… เปลี่ยนพอร์ตได้)
//
// เสิร์ฟไฟล์ของ repo ตามเดิม (/styles.css, /modules/*.js …) และสร้างหน้า /harness/ ที่โหลดสไตล์ + สคริปต์โมดูลทุกตัวตามลำดับใน
// index.html (ยกเว้น app.js) แล้วแทน app.js ด้วย stub ของ helper ที่โมดูลเรียก (state, app, shell, bindShell, renderNotFound,
// escapeHtml, showToast, friendlyError, renderRoute, currentRoute) โดยถือว่าอยู่ในโหมดทดสอบเสมอ ข้อมูลของโมดูลอยู่ใน localStorage
// ของเบราว์เซอร์เหมือนของจริง ใช้เพื่อดู/ลองกดเท่านั้น ไม่ใช่ทางเข้าของผู้ใช้จริง และสคริปต์นี้ไม่ถูกเผยแพร่ (ดู scripts/build-pilot.mjs)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5181;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8",
};

async function moduleScripts() {
  const html = await readFile(join(root, "index.html"), "utf8");
  return [...html.matchAll(/<script defer src="\.\/(modules\/[^"?]+)(?:\?v=[^"]*)?"><\/script>/g)].map((match) => match[1]);
}

async function harnessPage() {
  const scripts = (await moduleScripts()).map((path) => `  <script defer src="/${path}"></script>`).join("\n");
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
    const state = { employee: { isSandbox: true, display_name: "harness" } };
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
    Object.assign(window, { escapeHtml, showToast, friendlyError, currentRoute, shell, bindShell, loadingShell, renderNotFound, renderRoute, closePopup });
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

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname === "/" || url.pathname === "/harness" || url.pathname === "/harness/") {
      response.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
      response.end(await harnessPage());
      return;
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "");
    if (relative.split(sep).includes("..")) { response.writeHead(403); response.end("forbidden"); return; }
    const data = await readFile(join(root, relative));
    response.writeHead(200, { "content-type": TYPES[extname(relative)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(data);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500);
    response.end(error?.code === "ENOENT" ? "not found" : "error");
  }
}).listen(port, () => {
  console.log(`Pilot harness: http://localhost:${port}/harness/  (BOM: #/bom · RubberFlow: #/rubberflow)`);
});
