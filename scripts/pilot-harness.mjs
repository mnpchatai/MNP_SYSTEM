// เซิร์ฟเวอร์ localhost สำหรับลองโมดูลโหมดทดสอบของ Pilot Web (RubberFlow, BOM รายแผนก) โดยไม่ต้องล็อกอิน Supabase
//
//   npm run pilot:harness            → http://localhost:5181/harness/   (PORT=… เปลี่ยนพอร์ตได้)
//                                    → http://localhost:5181/pilot-shell.html   (หน้าหลักจริงของ app.js ด้วย Supabase จำลอง; ?empty=1 = ไม่มีงาน)
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

// Supabase จำลองสำหรับ /pilot-shell.html: ตอบข้อมูลตัวอย่างตามตาราง ไม่มีการเชื่อมต่อจริง และเขียนอะไรไม่ได้
const MOCK_SUPABASE = String.raw`
// ไม่ลงทะเบียน service worker บนหน้าจำลอง
Object.defineProperty(navigator, "serviceWorker", { value: { register: () => Promise.resolve(), getRegistration: () => Promise.resolve(undefined), ready: new Promise(() => {}) } });
// หน้าจำลองไม่ส่งอะไรออกนอกเครื่อง: fetch ข้าม origin ทุกตัว (Supabase Edge Function, Google Apps Script ที่เขียนชีตสำรอง ฯลฯ) ได้คำตอบว่างแทน
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const target = new URL(String(input && input.url || input), location.href);
  return target.origin === location.origin ? realFetch(input, init) : Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
};
(() => {
  const empty = new URLSearchParams(location.search).has("empty");
  const ME = { id: "e1", employee_no: "E001", first_name: "ปกรณ์", last_name: "ศรีวัฒนา", email: "demo@example.test", phone: "", job_title: "ผู้จัดการฝ่ายผลิต", department_id: "d1", role_id: "r1", acting_role_id: null, manager_id: null, role: { code: "manager", name_th: "ผู้จัดการ" }, department: { code: "RB", name_th: "ฝ่ายผลิต RB" } };
  const PEOPLE = [ME, { id: "e2", first_name: "สมชาย", last_name: "ช่างซ่อม", job_title: "ช่างซ่อมบำรุง", role_id: "r2", department_id: "d2", is_active: true }, { id: "e3", first_name: "วิภา", last_name: "ใจดี", job_title: "เจ้าหน้าที่ QC", role_id: "r3", department_id: "d3", is_active: true }];
  const TYPE = (code, name_th) => ({ code, name_th, uses_repair_workflow: code === "MT_REPAIR" });
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const REQ = (i, no, title, code, name, status, requester, ago) => ({ id: "q" + i, request_no: no, title, description: "", status, priority: i === 1 ? "high" : "normal", created_at: day(ago), updated_at: day(ago), needed_date: null, requester_id: requester, assignee_id: null, current_step: 1, request_type: TYPE(code, name), request_technicians: [] });
  const REQUESTS = empty ? [] : [
    REQ(1, "MT-2569-0412", "แจ้งซ่อมเครื่องฉีด HCM-03", "MT_REPAIR", "แจ้งซ่อม", "pending_approval", "e2", 1),
    REQ(2, "NCR-2569-0088", "NCR ยางขอบไม่เต็ม ล็อต RB-1103", "NCR", "NCR/CAR", "pending_approval", "e3", 2),
    REQ(3, "IT-2569-0057", "ขอเพิ่มสิทธิ์ระบบ ERP", "IT_REPAIR", "แจ้งงาน IT", "approved", "e1", 3),
    REQ(4, "MG-2569-0019", "บันทึกข้อความ แจ้งปรับกะทำงาน", "MG_MEMO", "บันทึกข้อความ", "completed", "e1", 6),
  ];
  const STEPS = empty ? [] : REQUESTS.filter((r) => r.status === "pending_approval").map((r, i) => ({ id: "s" + i, request_id: r.id, step_order: 1, step_name: "หัวหน้าแผนกอนุมัติ", approver_employee_id: "e1", approver_role_id: null, approver_department_id: null, status: "pending", created_at: r.created_at, request: { ...r, requester: PEOPLE.find((p) => p.id === r.requester_id) } }));
  const TYPES = [["MT_REPAIR", "แจ้งซ่อม", "งานซ่อมเครื่องจักรและอาคาร"], ["NCR", "NCR/CAR", "รายงานสินค้าไม่เป็นไปตามข้อกำหนด"], ["IT_REPAIR", "แจ้งงาน IT", "อุปกรณ์และสิทธิ์ระบบ"], ["MG_MEMO", "บันทึกข้อความ", "หนังสือภายใน"]].map(([code, name_th, description], i) => ({ id: "t" + i, code, name_th, description }));
  const COUNTS = empty ? { mine: 0, in_progress: 0, completed: 0, notifications: 0 } : { mine: 12, in_progress: 3, completed: 5, notifications: 2 };
  const ok = (data, count = null) => Promise.resolve({ data, error: null, count });

  function query(table) {
    const q = { table, head: false, single: false, filters: [] };
    const chain = new Proxy({}, {
      get(_, key) {
        if (key === "then") return (resolve, reject) => answer(q).then(resolve, reject);
        if (key === "maybeSingle" || key === "single") return () => { q.single = true; return chain; };
        if (key === "select") return (_cols, opts) => { if (opts && opts.head) q.head = true; return chain; };
        return (...args) => { q.filters.push([key, ...args]); return chain; };
      },
    });
    return chain;
  }
  function answer(q) {
    const has = (name, col, val) => q.filters.some(([k, c, v]) => k === name && c === col && (val === undefined || JSON.stringify(v) === JSON.stringify(val)));
    if (q.table === "employees") return q.single ? ok(ME) : ok(PEOPLE);
    if (q.table === "request_types") return ok(TYPES);
    if (q.table === "approval_steps") return ok(STEPS);
    if (q.table === "notifications") return q.head ? ok(null, COUNTS.notifications) : ok([]);
    if (q.table === "requests") {
      if (q.head) return ok(null, has("eq", "requester_id") ? COUNTS.mine : has("in", "status") ? COUNTS.in_progress : COUNTS.completed);
      if (q.single) return ok(REQUESTS[0] || null);
      if (has("in", "status")) return ok([]);
      return ok(REQUESTS);
    }
    return q.single ? ok(null) : ok([]);
  }
  const client = {
    from: query,
    rpc: (name) => ok(name === "app_my_approval_modules" ? TYPES.map(({ code }) => ({ code })) : name === "app_lab_access" ? false : null),
    auth: {
      getSession: () => ok({ session: { access_token: "mock", user: { id: "u1", email: ME.email } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => ok(null), refreshSession: () => ok({ session: null }), setSession: () => ok({ session: null }),
    },
    storage: { from: () => ({ createSignedUrl: () => ok(null), createSignedUrls: () => ok([]), upload: () => ok(null), remove: () => ok(null) }) },
    functions: { invoke: () => ok(null) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
  };
  window.supabase = { createClient: () => client };
})();
`;

async function shellPage() {
  const html = await readFile(join(root, "index.html"), "utf8");
  const cdn = /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^"]*"><\/script>/;
  if (!cdn.test(html)) throw new Error("supabase script tag not found in index.html");
  // CSP ของ index.html ห้าม inline script จึงโหลด mock เป็นไฟล์จาก origin เดียวกัน (defer ตามลำดับ ก่อนโมดูลและ app.js)
  return html.replace(cdn, '<script defer src="/harness-mock-supabase.js"></script>');
}

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname === "/" || url.pathname === "/harness" || url.pathname === "/harness/") {
      response.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
      response.end(await harnessPage());
      return;
    }
    if (url.pathname === "/harness-mock-supabase.js") {
      response.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
      response.end(MOCK_SUPABASE);
      return;
    }
    if (url.pathname === "/pilot-shell.html") {
      response.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
      response.end(await shellPage());
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
  console.log(`Pilot harness: http://localhost:${port}/harness/  (BOM: #/bom · RubberFlow: #/rubberflow) · shell: /pilot-shell.html`);
});
