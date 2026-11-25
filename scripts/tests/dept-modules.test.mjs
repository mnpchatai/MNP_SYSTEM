import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โมดูลแผนก PT #/pt · BG #/bg · PK #/pk หน้าจอ (modules/gr-pages.js ชุดเดียวกับ GR + modules/dept-pages.js · โรงงาน ขั้น 7 · 20261224010000_bom_dept_steps.sql) และจุดต่อกับ WH / BOM:
// เมนูต่อผู้ใช้ · งานของฉัน · หน้างาน · วัตถุดิบจาก ST (PT / BG) · ส่งให้ PK (PT / BG) · รอรับของ + ส่งให้ WH (PK) · ตั้งค่า · สรุปผล · ปุ่มต่อสิทธิ์ (อนุญาต + ปฏิเสธ) · BOM อ่านอย่างเดียว
// ข้อมูลสาธิต (modules/bom-seed.js): งานแกน PT-00320 ของ DEMO-26001 (ฉีด 14 ส่ง PK 10 รอรับ) · งานกระเป๋า BG-0092 ของ DEMO-26006 (เย็บ 45 ส่ง PK 20 รับแล้ว) · งาน PK ของ DEMO-26006 (ส่ง WH 6 + 20)
const FILES = [
  "vendor/qrcode-generator/qrcode.js", "modules/ui-icons.js", "modules/department-access.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/factory-kit.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
  "modules/st-pages.js", "modules/module-st.js", "modules/module-sr.js", "modules/qa-pages.js", "modules/module-qa.js", "modules/gr-pages.js", "modules/dept-pages.js", "modules/module-gr.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js", "modules/wh-pages.js", "modules/module-wh.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const read = (file) => fs.readFileSync(file, "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const emp = (dept, role = "employee", extra = {}) => ({ department: { code: dept }, role: { code: role }, isSandbox: true, ...extra });

function load({ employee = emp("PP") } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { renders: 0, notFound: 0, hash: "#/", toasts: [] };
  const fakes = {};
  const node = () => ({
    handlers: {}, dataset: {}, value: "", disabled: false, textContent: "", innerHTML: "", tagName: "DIV", classList: { toggle() {}, add() {}, remove() {} }, files: [],
    addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector: (selector) => fakes[selector]?.[0] ?? null, querySelectorAll: (selector) => fakes[selector] ?? [],
    focus() {}, dispatchEvent() {}, close() {}, remove() {}, showModal() {},
  });
  const generic = () => ({ ...node(), querySelector: () => generic(), querySelectorAll: () => [], addEventListener() {} });
  const root = node();
  const storage = new Map();
  Object.assign(context, {
    window: context, addEventListener() {}, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirmDialog: async () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state: { employee },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null, createElement: () => generic(), addEventListener() {} },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  for (const file of FILES) vm.runInContext(read(file), context, { filename: file });
  const modules = context.MNP_REQUEST_MODULES;
  const open = async (code, query = "") => {
    const entry = modules[code];
    const path = entry.nav[0].path;
    log.hash = `#/${path}${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await entry.pages[path](new URLSearchParams(query));
    return app.innerHTML;
  };
  return { context, app, log, fakes, modules, store: context.MNP_BOM.store, open, R: context.MNP_BOM_RULES };
}
const navOf = (env, code) => {
  const item = env.modules[code].nav[0];
  return [...item.subnav(item.path).matchAll(/<a class="rf-nav-item( is-active)?" href="([^"]*)"[^>]*>[\s\S]*?<span class="rf-nav-text">([^<]*)<\/span>(?:<span class="rf-nav-count"[^>]*>(\d+)<\/span>)?<\/a>/g)]
    .map((match) => ({ label: match[3], href: match[2], active: Boolean(match[1]), count: match[4] ? Number(match[4]) : 0 }));
};
const h1Of = (html) => (html.match(/<h1>([^<]*)<\/h1>/) ?? [])[1] ?? "";
const cardsOf = (html) => html.match(/<article class="card rf-card bom-job[\s\S]*?<\/article>/g) ?? [];
const HEAD = "assistant_department_manager";
// หัวหน้าแผนก (ผู้ช่วยผู้จัดการแผนก) และพนักงาน PK ที่ไม่มีในข้อมูลสาธิต
const EXTRA_USERS = Object.freeze([
  { id: "PT-HEAD", role: "pt", dept: "PT", roleCode: HEAD, name: "หัวหน้า PT ทดสอบ" },
  { id: "BG-HEAD", role: "bg", dept: "BG", roleCode: HEAD, name: "หัวหน้า BG ทดสอบ" },
  { id: "PK-HEAD", role: "pk", dept: "PK", roleCode: HEAD, name: "หัวหน้า PK ทดสอบ" },
  { id: "PK-1", role: "pk", dept: "PK", name: "พนักงาน PK ทดสอบ" },
]);
const PERSONA = Object.freeze({
  pt: ["B06", emp("PT")], ptHead: ["PT-HEAD", emp("PT", HEAD)], bg: ["B07", emp("BG")], bgHead: ["BG-HEAD", emp("BG", HEAD)],
  pk: ["PK-1", emp("PK")], pkHead: ["PK-HEAD", emp("PK", HEAD)], gr: ["B05", emp("GR")], planner: ["B03", emp("PP")], wh: ["B09", emp("WH")], st: ["B08", emp("ST")],
  office: ["B03", emp("HR")], admin: ["B01", emp("PP", "admin")],
});
function as(who) {
  const [userId, employee] = PERSONA[who];
  const env = load({ employee });
  env.store.data().users.push(...EXTRA_USERS.map((user) => ({ ...user })));
  env.store.setUser(userId);
  return env;
}
const CODE = { pt: "FACTORY_PT", bg: "FACTORY_BG", pk: "FACTORY_PK" };
const dataOf = (env) => env.store.data();
const jobBy = (env, dept, pick = () => true) => dataOf(env).jobs.find((job) => job.dept === dept && pick(job));
const ptJob = (env) => jobBy(env, "PT", (job) => job.itemCode === "PT-00320");
const bgJob = (env) => jobBy(env, "BG", (job) => job.status === "in_progress");
const pkJob = (env) => jobBy(env, "PK", (job) => job.kind === "FG" && job.status === "in_progress");
const ctxOf = (env, query = "") => env.context.MNP_BOM.context(new URLSearchParams(query));
const dialog = (env, name, args) => env.context.MNP_BOM_DIALOGS[name](ctxOf(env), args);
const cardOf = (html, job) => cardsOf(html).find((entry) => entry.includes(`job=${job.id}"`));

test("menus: PT and BG show five pages, PK five too; a department head and the planner also get settings; other departments and the office get not found", async () => {
  const expected = {
    pt: [["งานของฉัน", "#/pt"], ["บันทึกผลรายวัน", "#/pt?tab=log"], ["วัตถุดิบจาก ST", "#/pt?tab=materials"], ["ส่งให้ PK", "#/pt?tab=pk"], ["สรุปผล", "#/pt?tab=summary"]],
    bg: [["งานของฉัน", "#/bg"], ["บันทึกผลรายวัน", "#/bg?tab=log"], ["วัตถุดิบจาก ST", "#/bg?tab=materials"], ["ส่งให้ PK", "#/bg?tab=pk"], ["สรุปผล", "#/bg?tab=summary"]],
    pk: [["งานของฉัน", "#/pk"], ["บันทึกผลรายวัน", "#/pk?tab=log"], ["รอรับของ", "#/pk?tab=incoming"], ["ส่งให้ WH", "#/pk?tab=wh"], ["สรุปผล", "#/pk?tab=summary"]],
  };
  for (const dept of ["pt", "bg", "pk"]) {
    const staff = as(dept);
    await staff.open(CODE[dept]);
    assert.deepEqual(plain(navOf(staff, CODE[dept]).map((item) => [item.label, item.href])), expected[dept], `${dept} staff: no settings`);
    for (const who of [`${dept}Head`, "planner", "admin"]) {
      const env = as(who);
      await env.open(CODE[dept]);
      assert.deepEqual(plain(navOf(env, CODE[dept]).map((item) => [item.label, item.href])), [...expected[dept], ["ตั้งค่าขั้นตอนและเป้า", `#/${dept}?tab=settings`]], `${dept}: ${who} sees settings`);
    }
    // ปฏิเสธ: แผนกอื่น / ออฟฟิศ / นอกโหมดทดสอบ เปิดไม่ได้แม้พิมพ์ที่อยู่เอง
    for (const who of ["gr", "wh", "st", "office", ...["pt", "bg", "pk"].filter((other) => other !== dept)]) {
      const env = as(who);
      await env.open(CODE[dept], "tab=log");
      assert.equal(env.log.notFound, 1, `${who} cannot open ${dept}`);
    }
    assert.equal(staff.modules[CODE[dept]].navAllowed({ ...emp(dept.toUpperCase()), isSandbox: false }), false, "outside test mode");
  }
  // หัวหน้า PT เปิดโมดูล BG / PK ไม่ได้ (เห็นเฉพาะโมดูลของแผนกตัวเอง)
  const ptHead = as("ptHead");
  await ptHead.open("FACTORY_BG");
  assert.equal(ptHead.log.notFound, 1);
  // ผู้ดูแลระบบและฝ่ายวางแผนเห็นหน้าเดียวกัน
  const admin = as("admin");
  assert.ok(h1Of(await admin.open("FACTORY_PK")));
});

test("PT งานของฉัน: the card shows the step with done / target, staff open the daily log, a PT head or the planner can send to PK, other roles cannot", async () => {
  const staff = as("pt");
  const job = ptJob(staff);
  const html = await staff.open("FACTORY_PT");
  assert.equal(h1Of(html), "งานของฉัน");
  assert.match(html, /href="#\/pt\?st=done">เสร็จแล้ว<\/a>/);
  const card = cardOf(html, job);
  assert.ok(card, "the done PT job with 4 unsent stays on งานของฉัน");
  assert.match(card, /class="bom-job-parts gr-steps"/);
  assert.match(card, /ขึ้นรูป/);
  assert.match(card, /14\/14/);
  assert.match(card, /ยังไม่ได้ส่ง PK 4/);
  assert.ok(card.includes(`href="#/pt?tab=log&amp;j=${job.id}"`), "บันทึกผล opens the log with this job");
  assert.doesNotMatch(card, /data-rf-open="jobReport"|grSendPk/, "no old report button; staff do not send to PK");
  for (const who of ["ptHead", "planner"]) {
    const env = as(who);
    assert.match(cardOf(await env.open("FACTORY_PT"), ptJob(env)), /data-rf-open="grSendPk"/, `${who} sends to PK`);
  }
  // หัวหน้า BG เปิดหน้า PT ไม่ได้ จึงไม่มีทางกดส่งให้ PK ของ PT
  const bgHead = as("bgHead");
  await bgHead.open("FACTORY_PT");
  assert.equal(bgHead.log.notFound, 1);
  assert.equal(bgHead.store.run("sendToPk", { jobId: job.id, qty: 1 }).ok, false, "the action refuses a BG head too");
  // งานของ PT เท่านั้น: งาน BG ไม่อยู่ในหน้า PT และหน้างานของแผนกอื่นไม่พบ
  assert.ok(!html.includes(bgJob(staff).id));
  assert.match(await staff.open("FACTORY_PT", `job=${bgJob(staff).id}`), /ไม่พบงานนี้/);
  // ไม่มีงาน
  dataOf(staff).jobs = [];
  assert.match(await staff.open("FACTORY_PT"), /ไม่มีงานของ PT ค้างอยู่/);
});

test("PT / BG job page: the step table, the materials ST issued for the order, the sends to PK with cancel only for the sending head, and the daily records", async () => {
  const head = as("ptHead");
  const job = ptJob(head);
  job.status = "in_progress"; // งานยังไม่เสร็จ: หัวหน้าแก้ขั้นตอนได้
  const html = await head.open("FACTORY_PT", `job=${job.id}`);
  assert.equal(h1Of(html), escapeHtml(job.name));
  assert.match(html, /class="request-back-link" href="#\/pt">‹ งานของฉัน<\/a>/);
  for (const heading of ["ขั้นตอนของงาน", "วัตถุดิบจาก ST", "ส่งให้ PK", "ผลรายวันของงานนี้"]) assert.match(html, new RegExp(`<h2>${heading}</h2>`), heading);
  assert.match(html, /P-PEL-BK/, "the pellets ST issues for this order");
  assert.match(html, /data-rf-open="grSteps"[^>]*>แก้ขั้นตอน/);
  assert.match(html, /data-rf-open="grSendPk"/);
  assert.match(html, /รอ PK รับ/);
  assert.match(html, /data-rf-open="grHandoverCancel"/, "the PT head cancels an unreceived send");
  assert.doesNotMatch(html, /ยางเส้นยาว|grRodRequest/, "rods are GR only");
  for (const who of ["pt", "pkHead"]) {
    const env = as(who);
    if (who === "pkHead") { await env.open("FACTORY_PT", `job=${job.id}`); assert.equal(env.log.notFound, 1); continue; }
    const page = await env.open("FACTORY_PT", `job=${job.id}`);
    assert.doesNotMatch(page, /grHandoverCancel|grSendPk|grSteps/, "PT staff: no cancel, no send, no step setup");
  }
  // BG: เหมือนกัน (วัตถุดิบของงานเย็บ)
  const bgHead = as("bgHead");
  const bg = bgJob(bgHead);
  const bgHtml = await bgHead.open("FACTORY_BG", `job=${bg.id}`);
  assert.match(bgHtml, /<h2>วัตถุดิบจาก ST<\/h2>/);
  assert.match(bgHtml, /P-FAB-BL/);
  assert.doesNotMatch(bgHtml, /P-PEL-BK/);
  assert.match(bgHtml, /PK รับแล้ว/);
  assert.match(bgHtml, /ผู้ส่ง|ส่งให้ PK/);
  // PK: หน้างานของ PK มี "ของที่ต้องรับ" ไม่มีวัตถุดิบ ST แบบ PT / BG
  const pk = as("pkHead");
  const pkHtml = await pk.open("FACTORY_PK", `job=${pkJob(pk).id}`);
  assert.match(pkHtml, /<h2>ของที่ต้องรับ<\/h2>/);
  assert.match(pkHtml, /<h2>ส่งให้ WH<\/h2>/);
  assert.match(pkHtml, /data-rf-open="pkSendWh"/);
  assert.doesNotMatch(pkHtml, /วัตถุดิบจาก ST/);
});

test("PT / BG วัตถุดิบจาก ST: per open order the materials, needed, issued and who / when; read only; a PK staff user cannot see it", async () => {
  const pt = as("pt");
  const html = await pt.open("FACTORY_PT", "tab=materials");
  assert.equal(h1Of(html), "วัตถุดิบจาก ST");
  assert.match(html, /P-PEL-BK/);
  assert.match(html, /DEMO-26001/);
  assert.doesNotMatch(html, /data-rf-(open|action|form)=/, "read only");
  assert.doesNotMatch(html, /P-FAB-BL/, "BG materials are not PT's");
  const bg = as("bg");
  const bgHtml = await bg.open("FACTORY_BG", "tab=materials");
  assert.match(bgHtml, /P-FAB-BL/);
  assert.match(bgHtml, /P-ZIP-05/);
  // ชุดสาธิต: ST จ่ายบางส่วนแล้ว (เม็ดพลาสติก 0.2 kg ให้ PT · ผ้าตาข่าย 10 หลาให้ BG) ยอด วันที่ และผู้จ่ายขึ้นในตาราง
  const rowOf = (page, code) => (page.split("<tr").find((row) => row.includes(code) && row.includes("DEMO-26001")) ?? "");
  const stDay = pt.R.fmtDate(dataOf(pt).stockMoves.find((move) => move.itemCode === "P-PEL-BK" && move.kind === "issue").at);
  assert.ok(rowOf(html, "P-PEL-BK").includes(`>${pt.R.fmtQty(0.2)}<`), "issued quantity");
  assert.match(rowOf(html, "P-PEL-BK"), /สมศักดิ์ แก้วใส/, "issued by");
  assert.ok(rowOf(html, "P-PEL-BK").includes(stDay), "issued on");
  assert.ok(rowOf(bgHtml, "P-FAB-BL").includes(`>${pt.R.fmtQty(10)}<`), "the BG fabric issued");
  assert.match(rowOf(bgHtml, "P-FAB-BL"), /สมศักดิ์ แก้วใส/);
  // ST จ่ายเพิ่ม: ยอดใหม่และผู้จ่ายล่าสุดขึ้นในตาราง
  const data = dataOf(pt);
  const stJob = data.jobs.find((job) => job.dept === "ST" && job.orderId === "DEMO-26001" && job.itemCode === "P-PEL-BK");
  stJob.qtyDone = 0.28;
  data.stockMoves.push({ id: "SM-X1", itemCode: "P-PEL-BK", kind: "issue", qty: -0.08, ref: "DEMO-26001", at: Date.now(), by: "ทดสอบ ST" });
  const issued = await pt.open("FACTORY_PT", "tab=materials");
  assert.match(issued, /0\.28/);
  assert.match(issued, /ทดสอบ ST/);
  // ค้นหาและหน้าที่ไม่มีข้อมูล
  assert.match(await pt.open("FACTORY_PT", "tab=materials&q=zzzz"), /ไม่พบวัตถุดิบที่ค้นหา/);
});

test("PT / BG ส่งให้ PK: per job good, sent and waiting; the send button only for the head and the planner; the sends list with its status; cancel and reverse follow the roles", async () => {
  const staff = as("pt");
  const job = ptJob(staff);
  const html = await staff.open("FACTORY_PT", "tab=pk");
  assert.equal(h1Of(html), "ส่งให้ PK");
  assert.match(html, /<h2>ของดีของแต่ละงาน<\/h2>/);
  assert.match(html, /<h2>รายการส่ง<\/h2>/);
  assert.match(html, /รอที่ PT/);
  assert.match(html, /รอ PK รับ/);
  assert.doesNotMatch(html, /data-rf-open="grSendPk"|grHandoverCancel/, "staff only read");
  const head = as("ptHead");
  const headHtml = await head.open("FACTORY_PT", "tab=pk");
  assert.match(headHtml, /data-rf-open="grSendPk"/);
  assert.match(headHtml, /data-rf-open="grHandoverCancel"/);
  // dialog: ส่งให้ PK ใช้ action sendToPk ของ PT (ไม่ใช่ sendGrToPk) · ค่าเริ่ม = ที่ยังไม่ได้ส่ง
  const send = dialog(head, "grSendPk", { jobId: job.id }).html;
  assert.match(send, /data-rf-form="sendToPk"/);
  assert.match(send, /name="qty"[^>]*value="4"[^>]*max="4"/);
  assert.match(send, /หัวหน้าแผนก PT/);
  assert.equal(dialog(staff, "grSendPk", { jobId: job.id }), null, "staff get no dialog");
  assert.equal(dialog(as("bgHead"), "grSendPk", { jobId: job.id }), null, "a BG head cannot send PT's good");
  // ส่งจริง แล้วหน้ารอ PK รับเพิ่ม · PK รับ = ทั้งรายการ
  assert.equal(head.store.run("sendToPk", { jobId: job.id, qty: 4 }).ok, true);
  assert.equal(head.R.deptHandoverSummary(dataOf(head), job).waiting, 0);
  assert.equal(dialog(head, "grSendPk", { jobId: job.id }), null, "nothing left to send");
  // ยกเลิกการส่ง: dialog ของหัวหน้า PT ได้ · พนักงาน PT ไม่ได้ · ใช้ action cancelHandover (ไม่ใช่ของ GR)
  const row = dataOf(head).grHandovers.find((entry) => entry.jobId === job.id && entry.status === "sent");
  const cancel = dialog(head, "grHandoverCancel", { handoverId: row.id });
  assert.match(cancel.html, /data-rf-form="cancelHandover"/);
  assert.equal(dialog(staff, "grHandoverCancel", { handoverId: row.id }), null);
  assert.equal(dialog(as("pk"), "grHandoverCancel", { handoverId: row.id }), null, "PK cannot cancel the sender's send");
  // BG: ส่งให้ PK ของงานเย็บ (ส่งไปแล้ว 20 รับแล้ว) · หัวหน้า PK ย้อนการรับได้ที่หน้านี้ของ BG ไม่ได้ (ย้อนที่โมดูล PK)
  const bgHead = as("bgHead");
  const bgHtml = await bgHead.open("FACTORY_BG", "tab=pk");
  assert.match(bgHtml, /PK รับแล้ว/);
  assert.doesNotMatch(bgHtml, /รอที่ PT/);
});

test("PT / BG บันทึกผลรายวัน: only the department's jobs, steps and workers; the reject reasons are the department's own; staff record for themselves, a head picks the worker", async () => {
  const staff = as("pt");
  const job = ptJob(staff);
  const html = await staff.open("FACTORY_PT", `tab=log&j=${job.id}`);
  assert.equal(h1Of(html), "บันทึกผลรายวัน");
  const form = html.match(/<form[^>]*data-rf-form="addGrRecord"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.ok(form, "the record form is on the page");
  assert.doesNotMatch(form, /name="workerId"/, "staff record for themselves");
  assert.match(form, new RegExp(`<option value="${job.id}" selected>`));
  assert.match(form, /<option value="PT-01"/);
  assert.match(form, /ขึ้นรูปไม่เต็ม/, "PT reject reasons");
  assert.doesNotMatch(form, /ฝีเข็มไม่สวย|ตัดยาง/, "not BG's or GR's lists");
  assert.match(form, /\(จำเป็น\)/);
  assert.doesNotMatch(form, new RegExp(bgJob(staff).id), "BG jobs are not offered to PT");
  // หัวหน้า: ผู้ทำ = พนักงาน PT เท่านั้น
  const head = as("ptHead");
  const select = (await head.open("FACTORY_PT", "tab=log")).match(/<select[^>]*name="workerId"[\s\S]*?<\/select>/)?.[0] ?? "";
  assert.match(select, /<option value="PT-DEMO-2">/);
  assert.doesNotMatch(select, /GR-DEMO-2|BG-DEMO-2/);
  // BG หัวหน้า: เหตุผลของเสียของ BG
  const bgHead = as("bgHead");
  assert.match(await bgHead.open("FACTORY_BG", "tab=log"), /ฝีเข็มไม่สวย/);
  // บันทึกจริง: พนักงาน PT บันทึกขั้น PT-01 ของตัวเอง · ของเสียต้องมีเหตุผลของ PT · พนักงาน BG บันทึกงาน PT ไม่ได้
  const R = staff.R;
  const today = R.grDay(Date.now());
  const open = jobBy(staff, "PT", (row) => row.status !== "done" && staff.R.grPlanOf(dataOf(staff), row.id));
  const target = open ?? job;
  if (open) {
    assert.equal(staff.store.run("addGrRecord", { jobId: target.id, stepCode: "PT-01", workDate: today, hours: "2", good: "3", reject: "1", reason: "ฝีเข็มไม่สวย/หลุด" }).ok, false, "a BG reason is not PT's");
    assert.equal(staff.store.run("addGrRecord", { jobId: target.id, stepCode: "PT-01", workDate: today, hours: "2", good: "3", reject: "1", reason: "สีไม่ตรง" }).ok, true);
  }
  const bgStaff = as("bg");
  assert.equal(bgStaff.store.run("addGrRecord", { jobId: job.id, stepCode: "PT-01", workDate: today, hours: "1", good: "1" }).ok, false, "BG staff cannot record PT's job");
  assert.equal(as("gr").store.run("addGrRecord", { jobId: job.id, stepCode: "PT-01", workDate: today, hours: "1", good: "1" }).ok, false, "GR staff cannot either");
});

test("PT settings: the head and the planner edit the department's steps, reasons and targets; the form carries the department; staff only see a short note; the save keeps the department", async () => {
  const head = as("ptHead");
  const html = await head.open("FACTORY_PT", "tab=settings");
  assert.equal(h1Of(html), "ตั้งค่าขั้นตอนและเป้า");
  const form = html.match(/<form[^>]*data-rf-form="saveGrConfig"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.match(form, /data-rf-args="[^"]*PT[^"]*"/, "the form says which department it saves");
  assert.match(form, /ขึ้นรูป/);
  assert.match(form, /ขึ้นรูปไม่เต็ม/);
  assert.doesNotMatch(form, /ตัดยาง/, "GR's steps are not PT's");
  const transform = head.context.MNP_BOM.transforms().saveGrConfig({ dept: "PT", step: { code: ["PT-01"], name: ["ขึ้นรูป"], kind: ["main"], active: ["1"] }, reasons: "สีไม่ตรง\nอื่นๆ", target: {} });
  assert.equal(transform.dept, "PT");
  assert.equal(head.store.run("saveGrConfig", transform).ok, true);
  assert.equal(head.R.grConfig(dataOf(head), "PT").stored, true);
  assert.equal(head.R.grConfig(dataOf(head), "BG").stored, false, "another department's config is untouched");
  assert.deepEqual(plain(head.R.grConfig(dataOf(head), "PT").reasons), ["สีไม่ตรง", "อื่นๆ"]);
  // ปฏิเสธ: พนักงาน PT / หัวหน้า BG ตั้งค่า PT ไม่ได้
  assert.match(await as("pt").open("FACTORY_PT", "tab=settings"), /หน้านี้สำหรับหัวหน้าแผนก PT และฝ่ายวางแผน/);
  assert.equal(as("pt").store.run("saveGrConfig", transform).ok, false);
  assert.equal(as("bgHead").store.run("saveGrConfig", transform).ok, false);
  // PK ตั้งค่าของตัวเอง: 3 ขั้นตั้งต้น
  const pkHead = as("pkHead");
  const pkForm = await pkHead.open("FACTORY_PK", "tab=settings");
  for (const text of ["ประกอบ", "ใส่กระเป๋า", "บรรจุกล่อง"]) assert.ok(pkForm.includes(text), text);
  assert.match(pkForm, /data-rf-args="[^"]*PK[^"]*"/);
});

test("PT / BG / PK สรุปผล: each shows only its own department's records and steps", async () => {
  const pt = as("pt");
  const html = await pt.open("FACTORY_PT", "tab=summary&m=all");
  assert.equal(h1Of(html), "สรุปผล");
  assert.match(html, /ขึ้นรูป/);
  assert.doesNotMatch(html, /ตัดยาง|ทากาว|ฝีเข็ม/, "no GR / BG steps");
  const bgHtml = await as("bg").open("FACTORY_BG", "tab=summary&m=all");
  assert.match(bgHtml, /เย็บ/);
  assert.doesNotMatch(bgHtml, /ขึ้นรูป|ตัดยาง/);
  const pkHtml = await as("pk").open("FACTORY_PK", "tab=summary&m=all");
  for (const text of ["ประกอบ", "ใส่กระเป๋า", "บรรจุกล่อง"]) assert.ok(pkHtml.includes(text), text);
  assert.doesNotMatch(pkHtml, /ตัดยาง|ขึ้นรูป/);
});

test("PK งานของฉัน: receive cards from GR, PT and BG come first; job cards show the three steps and per-source readiness; PK staff and the planner receive, others cannot open it", async () => {
  const staff = as("pk");
  const html = await staff.open("FACTORY_PK");
  assert.equal(h1Of(html), "งานของฉัน");
  const cards = cardsOf(html);
  const receive = cards.filter((card) => /bom-job-state">รับจาก (GR|PT|BG)/.test(card));
  const sent = dataOf(staff).grHandovers.filter((row) => row.status === "sent" && (row.toDept ?? "PK") === "PK");
  assert.equal(receive.length, sent.length);
  assert.ok(receive.some((card) => card.includes("รับจาก GR")) && receive.some((card) => card.includes("รับจาก PT")), "GR and PT sends are both cards");
  assert.equal(cards.indexOf(receive[0]), 0, "receive cards first");
  const ptCard = receive.find((card) => card.includes("รับจาก PT"));
  assert.match(ptCard, /data-rf-action="receiveAtPk"/, "PT's send is received with the shared action");
  assert.match(receive.find((card) => card.includes("รับจาก GR")), /data-rf-action="receiveGrAtPk"/, "GR's keeps its own action");
  assert.ok(!html.includes("รับจาก BG"), "BG's send is already received");
  // งาน PK: ขั้นตอนและความพร้อม
  const job = pkJob(staff);
  const card = cardOf(html, job);
  assert.match(card, /ประกอบ/);
  assert.match(card, /ใส่กระเป๋า/);
  assert.match(card, /บรรจุกล่อง/);
  assert.match(card, /aria-label="ความพร้อมของที่ต้องรับ"/);
  assert.match(card, /จาก GR/);
  assert.match(card, /จาก PT|จาก BG/);
  assert.doesNotMatch(card, /พร้อมประกอบ/, "not ready while GR, PT and BG have not all arrived");
  // PK รับจริงทั้งรายการ
  const row = sent.find((entry) => (entry.fromDept ?? "GR") === "PT");
  assert.equal(staff.store.run("receiveAtPk", { handoverId: row.id }).ok, true);
  assert.equal(dataOf(staff).grHandovers.find((entry) => entry.id === row.id).status, "received");
  assert.ok(!(await staff.open("FACTORY_PK")).includes("รับจาก PT"));
  // ปฏิเสธ: หัวหน้า PT / WH เปิด PK ไม่ได้และรับเองไม่ได้
  for (const who of ["ptHead", "wh", "st"]) {
    const env = as(who);
    await env.open("FACTORY_PK");
    assert.equal(env.log.notFound, 1, who);
    assert.equal(env.store.run("receiveAtPk", { handoverId: sent.find((entry) => entry.status === "sent" && (entry.fromDept ?? "GR") === "GR").id }).ok, false, `${who} cannot receive`);
  }
  // ผู้วางแผนเห็นการ์ดรับของเดียวกันพร้อมปุ่มรับ
  const planner = as("planner");
  assert.match(await planner.open("FACTORY_PK"), /data-rf-action="receive(Gr)?AtPk"/);
  // เมนู: ตัวเลขที่ "งานของฉัน" = การ์ดรับ + งานเปิด
  const count = navOf(staff, "FACTORY_PK")[0].count;
  assert.ok(count >= receive.length - 1, "the count includes the receive cards");
});

test("PK badge พร้อมประกอบ: appears only when every source (GR, PT, BG and ST parts) has arrived, and PK can record before that", async () => {
  const env = as("pk");
  const data = dataOf(env);
  const job = pkJob(env);
  const orderId = job.orderId;
  // เหลือแหล่งเดียว: งาน GR ที่ส่งและ PK รับครบ · ไม่มีของซื้อ
  data.jobs = data.jobs.filter((entry) => entry.orderId !== orderId || entry.dept === "PK");
  const before = await env.open("FACTORY_PK");
  assert.doesNotMatch(cardOf(before, job), /พร้อมประกอบ|aria-label="ความพร้อมของที่ต้องรับ"/, "no source at all: nothing to say");
  data.jobs.push({ id: "SRC-GR", orderId, dept: "GR", itemCode: "SE-X", name: "ลูกทดสอบ", kind: "SE", uom: "pcs", qtyPlanned: 10, qtyDone: 10, qtyReject: 0, dueAt: Date.now(), status: "done", reports: [], createdAt: Date.now() });
  data.grHandovers.push({ id: "H-SRC", jobId: "SRC-GR", orderId, itemCode: "SE-X", qty: 4, status: "received", note: "", fromDept: "GR", toDept: "PK", sentBy: "x", sentAt: Date.now(), receivedBy: "y", receivedAt: Date.now(), moves: [] });
  const partial = await env.open("FACTORY_PK");
  assert.doesNotMatch(cardOf(partial, job), /พร้อมประกอบ/);
  assert.match(cardOf(partial, job), /4\/10/);
  assert.match(await env.open("FACTORY_PK", `job=${job.id}`), /รอ PK รับ|ยังไม่ส่งมา/, "the job page lists the missing source");
  data.grHandovers.find((row) => row.id === "H-SRC").qty = 10;
  const ready = await env.open("FACTORY_PK");
  assert.match(cardOf(ready, job), /พร้อมประกอบ/);
  assert.match(await env.open("FACTORY_PK", `job=${job.id}`), /พร้อมประกอบ/);
  // PK บันทึกได้เสมอแม้ยังไม่พร้อม: ปุ่มบันทึกผลและ action ไม่ถูกกั้นด้วยความพร้อม
  data.grHandovers.find((row) => row.id === "H-SRC").qty = 1;
  const lead = as("pkHead");
  const live = jobBy(lead, "PK", (row) => row.status === "in_progress" && lead.R.grPlanOf(dataOf(lead), row.id));
  const liveOrder = dataOf(lead).orders.find((order) => order.id === live.orderId);
  assert.equal(lead.R.pkReadiness(dataOf(lead), liveOrder).ready, false, "the seed order is still waiting for parts");
  const worker = lead.R.stepWorkers(dataOf(lead), "PK")[0];
  assert.ok(worker, "the seed has PK workers");
  assert.equal(lead.store.run("addGrRecord", { jobId: live.id, stepCode: lead.R.grPlanOf(dataOf(lead), live.id).steps[0].code, workDate: lead.R.grDay(Date.now()), workerId: worker.id, hours: "1", good: "1" }).ok, true, "recording is never blocked by readiness");
  const html = await env.open("FACTORY_PK");
  assert.match(cardOf(html, job), /tab=log/, "บันทึกผล stays available while sources are missing");
});

test("PK รอรับของ: the sends waiting for PK with the receive button, then what each order still waits for from GR, PT and BG with the sent-not-received first; read only for non-PK roles who can open it", async () => {
  const pk = as("pk");
  const html = await pk.open("FACTORY_PK", "tab=incoming");
  assert.equal(h1Of(html), "รอรับของ");
  assert.match(html, /<h2>ส่งมาแล้ว รอ PK รับ<\/h2>/);
  assert.match(html, /<h2>ของที่ยังไม่ครบต่อใบ<\/h2>/);
  assert.match(html, /data-rf-action="receive(Gr)?AtPk"/);
  assert.match(html, /<td>PT<\/td>/);
  assert.match(html, /ยังไม่ส่งมา|รอ PK รับ/);
  // เรียง: ส่งมาแล้วยังไม่รับก่อน
  const waiting = html.slice(html.indexOf("ของที่ยังไม่ครบต่อใบ"));
  const firstSentBadge = waiting.indexOf("รอ PK รับ");
  const firstUnsent = waiting.indexOf("ยังไม่ส่งมา");
  if (firstSentBadge >= 0 && firstUnsent >= 0) assert.ok(firstSentBadge < firstUnsent, "sent-not-received rows first");
  // ค้นหา
  assert.match(await pk.open("FACTORY_PK", "tab=incoming&q=zzzz"), /ไม่พบรายการที่ค้นหา/);
  // ผู้ที่เปิด PK ไม่ได้ได้ not found
  const gr = as("gr");
  await gr.open("FACTORY_PK", "tab=incoming");
  assert.equal(gr.log.notFound, 1);
});

test("PK ส่งให้ WH: per job good, sent to WH, received by WH and waiting; the send button for the PK head and the planner only; the cancel button only for the part WH has not received", async () => {
  const staff = as("pk");
  const job = pkJob(staff);
  const html = await staff.open("FACTORY_PK", "tab=wh");
  assert.equal(h1Of(html), "ส่งให้ WH");
  assert.match(html, /<h2>ของดีของแต่ละงาน<\/h2>/);
  assert.match(html, /WH รับแล้ว/);
  assert.match(html, /รอที่ PK/);
  assert.match(html, /ส่งให้ WH แล้ว/);
  assert.doesNotMatch(html, /pkSendWh|pkWhCancel/, "staff only read");
  const head = as("pkHead");
  const headHtml = await head.open("FACTORY_PK", "tab=wh");
  assert.match(headHtml, /data-rf-open="pkSendWh"/);
  assert.match(headHtml, /data-rf-open="pkWhCancel"/);
  assert.match(await as("planner").open("FACTORY_PK", "tab=wh"), /data-rf-open="pkSendWh"/);
  // dialog ส่ง: ค่าเริ่ม = ที่ยังไม่ได้ส่ง · action sendPkToWh
  const waiting = head.R.deptHandoverSummary(dataOf(head), job).waiting;
  assert.ok(waiting > 0);
  const dlg = dialog(head, "pkSendWh", { jobId: job.id });
  assert.match(dlg.html, /data-rf-form="sendPkToWh"/);
  assert.match(dlg.html, new RegExp(`name="qty"[^>]*value="${waiting}"`));
  assert.equal(dialog(staff, "pkSendWh", { jobId: job.id }), null, "PK staff get no dialog");
  assert.equal(dialog(as("wh"), "pkSendWh", { jobId: job.id }), null, "WH does not send for PK");
  assert.equal(dialog(as("ptHead"), "pkSendWh", { jobId: job.id }), null);
  assert.equal(head.store.run("sendPkToWh", { jobId: job.id, qty: waiting + 1 }).ok, false, "more than the good is refused");
  assert.equal(head.store.run("sendPkToWh", { jobId: job.id, qty: waiting }).ok, true);
  assert.equal(dialog(head, "pkSendWh", { jobId: job.id }), null, "nothing left to send");
  // ยกเลิก: ส่วนที่ WH ยังไม่รับเท่านั้น
  const row = dataOf(head).grHandovers.filter((entry) => entry.jobId === job.id && (entry.toDept ?? "PK") === "WH" && entry.status === "sent").at(-1);
  const cancel = dialog(head, "pkWhCancel", { handoverId: row.id });
  assert.match(cancel.html, /data-rf-form="cancelPkToWh"/);
  assert.equal(dialog(staff, "pkWhCancel", { handoverId: row.id }), null);
  assert.equal(dialog(as("wh"), "pkWhCancel", { handoverId: row.id }), null);
  // WH รับเข้าแล้ว: ส่วนที่รับไปแล้วยกเลิกไม่ได้ (ไม่มีปุ่ม)
  const pos = head.R.pkToWhPosition(dataOf(head), row.orderId, row.itemCode);
  dataOf(head).fgMoves.push({ id: "FM-X", orderId: row.orderId, fgCode: row.itemCode, kind: "receive", qty: pos.sent, at: Date.now(), by: "WH" });
  assert.equal(dialog(head, "pkWhCancel", { handoverId: row.id }), null, "WH already received: no cancel");
  assert.doesNotMatch(await head.open("FACTORY_PK", "tab=wh"), new RegExp(`pkWhCancel[^>]*${row.id}`), "no cancel button");
});

test("WH receive panel: the column is what PK sent to WH and the receivable follows it; BOM jobs page is read only for PT, BG and PK with a link to the module", async () => {
  const wh = as("wh");
  const data = dataOf(wh);
  const order = data.orders.find((entry) => entry.id === "DEMO-26006");
  const pos = wh.R.fgPosition(data, order);
  const product = pos.products.find((entry) => entry.pkSent > 0);
  assert.ok(product, "the seed has PK sends to WH");
  assert.ok(product.receivable <= product.pkSent + 1e-9);
  const html = (await wh.open("FACTORY_WH", `order=${order.id}`));
  assert.match(html, /PK ส่งให้ WH แล้ว/);
  assert.doesNotMatch(html, /PK ส่งมอบแล้ว/);
  // BOM งานของแผนก: แถว PT / BG / PK อ่านอย่างเดียวพร้อมลิงก์ไปโมดูล · แผนกอื่นยังมีปุ่ม
  const planner = as("planner");
  const bom = planner.context.MNP_BOM_PAGES.jobs(ctxOf(planner, "p=jobs&dept=ALL&st=all")).html;
  const rowOf = (job) => bom.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?${job.id}(?:(?!</tr>)[\\s\\S])*?</tr>`))?.[0] ?? "";
  for (const dept of ["GR", "PT", "BG", "PK"]) {
    const row = rowOf(jobBy(planner, dept, (job) => job.status !== "done") ?? jobBy(planner, dept));
    assert.ok(row, dept);
    assert.match(row, new RegExp(`href="#/${dept.toLowerCase()}"[^>]*>ทำงานที่โมดูล ${dept}`), dept);
    assert.doesNotMatch(row, /data-rf-open="(jobReport|jobHold|jobClose)"|data-rf-action="setJobStatus"/, `${dept}: no report, hold or close here`);
  }
  const rbRow = rowOf(jobBy(planner, "RB", (job) => job.status !== "done"));
  assert.match(rbRow, /data-rf-open="jobClose"/, "other departments keep their buttons");
});

test("dialogs of the shared step machinery follow the job's department: steps, edit and cancel of a record; PK jobs start with the three steps", async () => {
  const ptHead = as("ptHead");
  const job = jobBy(ptHead, "PT", (row) => row.status !== "done");
  if (job) {
    const dlg = dialog(ptHead, "grSteps", { jobId: job.id });
    assert.match(dlg.html, /data-rf-form="setGrJobSteps"/);
    assert.match(dlg.html, /ขึ้นรูป/);
    assert.doesNotMatch(dlg.html, /ตัดยาง/);
    assert.equal(dialog(as("pt"), "grSteps", { jobId: job.id }), null, "staff cannot set steps");
    assert.equal(dialog(as("bgHead"), "grSteps", { jobId: job.id }), null, "another department's head cannot");
  }
  const pkHead = as("pkHead");
  const pk = jobBy(pkHead, "PK", (row) => row.status === "queued") ?? jobBy(pkHead, "PK", (row) => row.status !== "done");
  const steps = dialog(pkHead, "grSteps", { jobId: pk.id });
  for (const text of ["ประกอบ", "ใส่กระเป๋า", "บรรจุกล่อง"]) assert.ok(steps.html.includes(text), text);
  // แก้ / ยกเลิกผลของ PT: เหตุผลต้องกรอก · พนักงานแก้เฉพาะของตัวเองวันเดียวกัน
  const record = dataOf(ptHead).grRecords.find((row) => row.status === "active" && ptHead.R.recordDept(dataOf(ptHead), row) === "PT");
  assert.ok(record, "the seed has a PT record");
  const edit = dialog(ptHead, "grRecordEdit", { recordId: record.id });
  assert.match(edit.html, /data-rf-form="editGrRecord"/);
  assert.match(edit.html, /ขึ้นรูป/);
  assert.match(edit.html, /\(จำเป็น\)/);
  assert.equal(dialog(as("gr"), "grRecordEdit", { recordId: record.id }), null, "GR staff cannot edit PT's record");
  assert.equal(dialog(as("bg"), "grRecordVoid", { recordId: record.id }), null);
  assert.match(dialog(ptHead, "grRecordVoid", { recordId: record.id }).html, /data-rf-form="voidGrRecord"/);
});

test("user text is escaped and the files keep to the wording rules: no raw job names, ยางเส้นยาว only, one ?v= and the new file loaded before the modules", async () => {
  const env = as("ptHead");
  const job = ptJob(env);
  job.name = '<img src=x onerror="alert(1)">';
  const row = dataOf(env).grHandovers.find((entry) => entry.jobId === job.id);
  row.note = '<script>alert(2)</script>';
  for (const query of ["", `job=${job.id}`, "tab=pk", "tab=log", "tab=materials", "tab=summary"]) {
    const html = await env.open("FACTORY_PT", query);
    assert.doesNotMatch(html, /<img src=x|<script>alert/, `PT ?${query}`);
  }
  for (const file of ["modules/dept-pages.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js"]) assert.doesNotMatch(read(file), /แท่ง/, file);
  const index = read("index.html");
  const versions = new Set([...index.matchAll(/\?v=([0-9a-z]+)"/g)].map((match) => match[1]));
  assert.equal(versions.size, 1, "one ?v= on every entry");
  const order = [...index.matchAll(/src="\.\/(modules\/[^"?]+)/g)].map((match) => match[1]);
  assert.ok(order.indexOf("modules/dept-pages.js") > order.indexOf("modules/gr-pages.js"));
  for (const file of ["modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js"]) assert.ok(order.indexOf("modules/dept-pages.js") < order.indexOf(file), file);
  assert.ok(index.indexOf("modules/dept-pages.js") < index.indexOf('src="./app.js'), "before app.js");
  assert.doesNotMatch(read("modules/bom-pages.js"), /ส่งงาน GR ให้ PK/, "the audit label covers every department and WH");
});

test("PK งานของฉัน: waiting to send = good pieces minus the sends (not cancelled), the same cap as the database; what WH received is never subtracted", async () => {
  const env = as("pkHead");
  const data = dataOf(env);
  const { waitingOf } = env.context.MNP_GR_PAGES.kit;
  const ctx = () => ctxOf(env);
  const done = jobBy(env, "PK", (job) => job.status === "done" && job.kind === "FG" && job.orderId === "DEMO-26008");
  assert.ok(done, "the seed has a finished PK job on the closed order");
  // ใบสาธิตส่งครบแล้ว (เหมือนแถวที่ migration เติมให้ใบที่ WH รับก่อนมีการส่ง): ไม่มีอะไรรอส่ง ไม่อยู่ที่งานของฉัน
  assert.equal(waitingOf(ctx(), done), 0);
  assert.ok(!(await env.open("FACTORY_PK")).includes(`job=${done.id}"`), "nothing left to send: not on งานของฉัน");
  // ไม่มีแถวส่งแม้ WH รับแล้ว: ฐานข้อมูลนับจากแถวส่งอย่างเดียว (Σ ที่ส่ง) client จึงนับเท่ากัน ไม่หักยอดรับของ WH
  const [send] = data.grHandovers.filter((row) => row.jobId === done.id);
  data.grHandovers = data.grHandovers.filter((row) => row.jobId !== done.id);
  assert.ok(data.fgMoves.some((move) => move.orderId === done.orderId && move.fgCode === done.itemCode && move.kind === "receive"), "WH received it");
  assert.equal(waitingOf(ctx(), done), Number(done.qtyDone), "the whole good is waiting, as the database lets the head send it");
  assert.ok((await env.open("FACTORY_PK")).includes(`job=${done.id}"`), "so the job is on งานของฉัน for the head to send");
  // ส่งบางส่วน + แถวที่ยกเลิก: ยกเลิกไม่นับ
  data.grHandovers.push({ ...send, id: "W-1", qty: 5, status: "sent" }, { ...send, id: "W-2", qty: 3, status: "cancelled", cancelledAt: Date.now(), cancelReason: "ผิด" });
  assert.equal(waitingOf(ctx(), done), Number(done.qtyDone) - 5);
  assert.match(cardOf(await env.open("FACTORY_PK"), done), new RegExp(`ยังไม่ได้ส่ง WH ${Number(done.qtyDone) - 5}`), "the card says what is still to send");
  // งาน PT: ยอดดี − ที่ส่งให้ PK (ไม่นับยกเลิก)
  const pt = ptJob(env);
  const ptSent = data.grHandovers.filter((row) => row.jobId === pt.id && row.status !== "cancelled").reduce((sum, row) => sum + Number(row.qty), 0);
  assert.ok(ptSent > 0, "the seed PT job has a send");
  assert.equal(waitingOf(ctx(), pt), Number(pt.qtyDone) - ptSent);
});
