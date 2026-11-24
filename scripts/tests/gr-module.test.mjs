import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โมดูลแปรรูปยาง (GR) #/gr หน้าจอ (modules/gr-pages.js + module-gr.js · โรงงาน ขั้น 2 · 20261216010000) และการเปลี่ยนที่ PK / SR:
// เมนูต่อผู้ใช้ (พนักงาน GR · หัวหน้า GR · ฝ่ายวางแผน · PK / ST เปิดไม่ได้) · งานของฉัน · หน้างาน · ฟอร์มบันทึกผลรายวัน (ค่าเริ่ม) · ตั้งค่า (ซ่อนจากพนักงาน)
// · การ์ด "รับจาก GR" ของ PK · การ์ดคำขอเบิกของ SR · dialog ของ GR · สรุปผล · ข้อความผู้ใช้ถูก escape
// ข้อมูลสาธิต (modules/bom-seed.js addGrDemo): งาน SE-HL24-YE03-400-19-30 ของใบ DEMO-26001 ตั้งขั้นตอนแล้ว (ตัดยาง → ทากาว → เจียร์ → เจาะ) ยอดดี 65 ส่ง PK 30 (รับแล้ว) + 25 (รอรับ)
// คำขอเบิก RB-DM02-02-YE03-204-19-34 × 10 ยังเปิด · งานลูกตอปิโดยังไม่ตั้งขั้นตอน · แกนหางตอปิโดรายงานยอดแบบเดิม
const FILES = [
  "vendor/qrcode-generator/qrcode.js", "modules/ui-icons.js", "modules/department-access.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/factory-kit.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
  "modules/st-pages.js", "modules/module-st.js", "modules/module-sr.js", "modules/module-qa.js", "modules/gr-pages.js", "modules/module-gr.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js", "modules/wh-pages.js", "modules/module-wh.js",
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
const HL = "SE-HL24-YE03-400-19-30";
const ROD = "RB-DM02-02-YE03-204-19-34";
// ผู้ใช้ BOM ที่ไม่มีในข้อมูลสาธิต: หัวหน้า GR (ผู้ช่วยผู้จัดการแผนก) และพนักงาน PK
const EXTRA_USERS = Object.freeze({
  grHead: { id: "GR-HEAD", role: "gr", dept: "GR", roleCode: "assistant_department_manager", name: "หัวหน้า GR ทดสอบ" },
  pk: { id: "PK-1", role: "pk", dept: "PK", name: "พนักงาน PK ทดสอบ" },
});
const PERSONA = Object.freeze({ staff: ["B05", emp("GR")], head: ["GR-HEAD", emp("GR", "assistant_department_manager")], planner: ["B03", emp("PP")], pk: ["PK-1", emp("PK")], sr: ["B11", emp("SR")], st: ["B08", emp("ST")] });
function as(who) {
  const [userId, employee] = PERSONA[who];
  const env = load({ employee });
  env.store.data().users.push(...Object.values(EXTRA_USERS).map((user) => ({ ...user })));
  env.store.setUser(userId);
  return env;
}
const gr = (env, query = "") => env.open("FACTORY_GR", query);
const dataOf = (env) => env.store.data();
const jobOf = (env, itemCode, orderId = "DEMO-26001") => dataOf(env).jobs.find((job) => job.orderId === orderId && job.itemCode === itemCode && job.dept === "GR");
const ctxOf = (env, query = "") => env.context.MNP_BOM.context(new URLSearchParams(query));
const dialog = (env, name, args) => env.context.MNP_BOM_DIALOGS[name](ctxOf(env), args);

test("GR menu per user: staff see five pages, a GR head and the planner also see settings; PK and ST staff cannot open the module even by address", async () => {
  const staff = as("staff");
  await gr(staff);
  assert.deepEqual(plain(navOf(staff, "FACTORY_GR").map((item) => [item.label, item.href])), [["งานของฉัน", "#/gr"], ["บันทึกผลรายวัน", "#/gr?tab=log"], ["ยางเส้นยาว", "#/gr?tab=rods"], ["ส่งให้ PK", "#/gr?tab=pk"], ["สรุปผล", "#/gr?tab=summary"]]);
  for (const who of ["head", "planner"]) {
    const env = as(who);
    await gr(env);
    assert.deepEqual(navOf(env, "FACTORY_GR").map((item) => item.label).at(-1), "ตั้งค่าขั้นตอนและเป้า", who);
    assert.equal(navOf(env, "FACTORY_GR").length, 6, who);
  }
  const { modules } = staff;
  assert.equal(modules.FACTORY_GR.navAllowed(emp("GR")), true);
  assert.equal(modules.FACTORY_GR.navAllowed(emp("GR", "assistant_department_manager")), true);
  for (const employee of [emp("PK"), emp("ST"), emp("PK", "department_manager"), { ...emp("GR"), isSandbox: false }]) assert.equal(modules.FACTORY_GR.navAllowed(employee), false, JSON.stringify(employee));
  for (const who of ["pk", "st"]) {
    const env = as(who);
    await gr(env, "tab=log");
    assert.equal(env.log.notFound, 1, `${who} gets not found`);
  }
  // หน้างานอยู่ใต้ "งานของฉัน" ในเมนูข้าง
  await gr(staff, `job=${jobOf(staff, HL).id}`);
  assert.deepEqual(plain(navOf(staff, "FACTORY_GR").filter((item) => item.active).map((item) => item.label)), ["งานของฉัน"]);
});

test("GR งานของฉัน: a planned job shows its steps and opens the daily log; a fresh job asks the head to set steps; a head can send unsent good to PK; a done job with unsent good stays", async () => {
  const staff = as("staff");
  const planned = jobOf(staff, HL);
  const fresh = jobOf(staff, "SE-TP01-OR01-100-18-65");
  const html = await gr(staff);
  assert.equal(h1Of(html), "งานของฉัน");
  assert.match(html, /href="#\/gr\?st=done">เสร็จแล้ว<\/a>/, "เสร็จแล้ว is a filter link on the page");
  const card = (page, job) => cardsOf(page).find((entry) => entry.includes(`job=${job.id}"`));
  const plannedCard = card(html, planned);
  assert.match(plannedCard, /class="bom-job-parts gr-steps"/);
  for (const text of ["ตัดยาง", "ทากาว", "เจียร์", "เจาะ", "65/120"]) assert.ok(plannedCard.includes(text), text);
  assert.ok(plannedCard.includes(`href="#/gr?tab=log&amp;j=${planned.id}"`), "บันทึกผล opens the log with this job");
  assert.doesNotMatch(plannedCard, /jobReport|bom-job-amount/, "no old report button, no second total line");
  assert.match(plannedCard, /ขอเบิก RB-DM02-02-YE03-204-19-34 รอ SR จ่าย 10/);
  assert.doesNotMatch(plannedCard, /grSendPk/, "staff do not send to PK");
  assert.match(card(html, fresh), /รอหัวหน้าแผนก GR ตั้งขั้นตอนก่อนบันทึกผล/);
  assert.doesNotMatch(card(html, fresh), /jobReport|grSteps/);
  assert.match(card(html, fresh), /data-rf-open="grRodRequest"/, "a job that still needs rods and has no open request offers the request");
  const head = as("head");
  const headHtml = await gr(head);
  assert.match(card(headHtml, fresh), /data-rf-open="grSteps"/);
  assert.match(card(headHtml, planned), /data-rf-open="grSendPk"/);
  // งานเสร็จแล้ว แต่ของดียังไม่ได้ส่ง PK ครบ: ยังอยู่ในงานของฉัน (ส่งได้) ไม่อยู่ในเสร็จแล้ว
  const done = jobOf(head, HL);
  done.status = "done";
  assert.ok(card(await gr(head), done), "stays on งานของฉัน");
  assert.ok(!(await gr(head, "st=done")).includes(`job=${done.id}"`));
  // ไม่มีงาน
  dataOf(staff).jobs = [];
  assert.match(await gr(staff), /ไม่มีงานของ GR ค้างอยู่/);
});

test("GR job page: facts, the steps with good / target, rods with the lots and requests, hand-overs to PK and the job's daily records; an unknown job says so", async () => {
  const head = as("head");
  const job = jobOf(head, HL);
  const html = await gr(head, `job=${job.id}`);
  assert.equal(h1Of(html), escapeHtml(job.name));
  assert.match(html, /class="request-back-link" href="#\/gr">‹ งานของฉัน<\/a>/);
  for (const heading of ["ขั้นตอนของงาน", "ยางเส้นยาว", "ส่งให้ PK", "ผลรายวันของงานนี้"]) assert.match(html, new RegExp(`<h2>${heading}</h2>`), heading);
  assert.match(html, /115 \/ 120/, "ตัดยาง good / target");
  assert.match(html, /data-rf-open="grSteps"[^>]*>แก้ขั้นตอน/);
  assert.match(html, /data-rf-open="grSendPk"/);
  assert.match(html, /รอ PK รับ/);
  assert.match(html, /PK รับแล้ว/);
  assert.equal((html.match(/data-rf-open="grRecordEdit"/g) ?? []).length, dataOf(head).grRecords.filter((record) => record.jobId === job.id && record.status === "active").length, "a head edits every active record");
  assert.doesNotMatch(html, /บาท|ค่าแรง|incentive/i, "no money");
  assert.match(await gr(head, "job=NO-SUCH"), /ไม่พบงานนี้/);
});

test("GR บันทึกผลรายวัน: the form defaults to today, me and one person; staff record only today or yesterday for themselves; a head picks the worker; edit and cancel follow the same-day rule", async () => {
  const staff = as("staff");
  const job = jobOf(staff, HL);
  const R = staff.R;
  const today = R.grDay(Date.now());
  const html = await gr(staff, `tab=log&j=${job.id}`);
  assert.equal(h1Of(html), "บันทึกผลรายวัน");
  const form = html.match(/<form[^>]*data-rf-form="addGrRecord"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.ok(form, "the record form is on the page");
  assert.match(form, new RegExp(`name="workDate"[^>]*value="${today}"`));
  assert.match(form, new RegExp(`min="${R.grDay(Date.now(), -1)}"`), "staff: yesterday at the earliest");
  assert.doesNotMatch(form, /name="workerId"/, "staff record for themselves");
  assert.match(form, /name="people"[^>]*value="1"/);
  assert.match(form, new RegExp(`<option value="${job.id}" selected>`), "the job from the card is chosen");
  for (const code of ["GR-04", "GR-05", "GR-06", "GR-09"]) assert.match(form, new RegExp(`<option value="${code}"`));
  assert.match(form, /data-gr-reason hidden/, "the reject reason shows only with rejects");
  assert.match(form, /\(จำเป็น\)/);
  assert.match(form, /data-gr-targets="[^"]*GR-04[^"]*"/, "the step targets drive the live ต้องทำ line");
  // บันทึกจริงผ่าน store (ช่องเป็นข้อความเหมือนฟอร์ม)
  const before = dataOf(staff).grRecords.length;
  assert.equal(staff.store.run("addGrRecord", { jobId: job.id, stepCode: "GR-05", workDate: today, hours: "2", people: "1", good: "5", reject: "0", reason: "", note: "" }).ok, true);
  assert.equal(dataOf(staff).grRecords.length, before + 1);
  const mine = await gr(staff, "tab=log");
  assert.match(mine, /<h2>ผลของฉัน วันนี้และเมื่อวาน<\/h2>/);
  const added = dataOf(staff).grRecords.at(-1);
  assert.ok(mine.includes(`&quot;recordId&quot;:&quot;${added.id}&quot;`), "today's record has แก้ไข / ยกเลิก");
  const old = dataOf(staff).grRecords.find((record) => record.workerId === "B05" && R.grDay(record.createdAt) !== today);
  if (old) assert.ok(!mine.includes(`&quot;recordId&quot;:&quot;${old.id}&quot;`), "an older record is not editable by staff");
  assert.equal(staff.store.run("addGrRecord", { jobId: job.id, stepCode: "GR-05", workDate: today, workerId: "GR-DEMO-2", hours: "1", good: "1" }).ok, false, "staff cannot record for another worker");
  // หัวหน้า: เลือกผู้ทำจากพนักงาน GR (grWorkers) · ไม่อยู่ในรายชื่อ = ไม่มีชื่อตัวเองให้เลือก ช่องว่างและต้องเลือก · อยู่ในรายชื่อ = ค่าเริ่มเป็นตัวเอง · ตารางทุกผลพร้อมตัวกรอง
  const head = as("head");
  const headHtml = await gr(head, "tab=log");
  const workerSelect = headHtml.match(/<select[^>]*name="workerId"[\s\S]*?<\/select>/)?.[0] ?? "";
  assert.match(workerSelect, /<select[^>]*name="workerId"[^>]*required/);
  assert.match(workerSelect, /<option value="">เลือกผู้ทำ<\/option>/);
  assert.doesNotMatch(workerSelect, /GR-HEAD/, "a head outside the GR worker list is not offered as the worker");
  assert.doesNotMatch(workerSelect, / selected>/, "nothing is chosen for them");
  assert.match(workerSelect, /<option value="GR-DEMO-2">/);
  assert.equal(head.store.run("addGrRecord", { jobId: job.id, stepCode: "GR-05", workDate: today, hours: "1", good: "1" }).ok, false, "the action refuses a worker outside the list, like the database");
  dataOf(head).grWorkers.push({ id: "GR-HEAD", name: "หัวหน้า GR ทดสอบ" });
  assert.match(await gr(head, "tab=log"), /<option value="GR-HEAD" selected>/, "a head on the list starts as the worker");
  assert.match(headHtml, /name="day"[^>]*data-gr-filter/);
  assert.match(headHtml, /<h2>ผลที่บันทึก<\/h2>/);
  // dialog แก้ / ยกเลิก: เหตุผลจำเป็น · พนักงานเปิดของเก่าไม่ได้
  const edit = dialog(staff, "grRecordEdit", { recordId: added.id });
  assert.match(edit.html, /data-rf-form="editGrRecord"/);
  assert.match(edit.html, /name="editReason"[^>]*required/);
  assert.match(dialog(staff, "grRecordVoid", { recordId: added.id }).html, /name="reason"[^>]*required[^>]*minlength="3"/);
  if (old) assert.equal(dialog(staff, "grRecordEdit", { recordId: old.id }), null);
});

test("GR settings: hidden from staff (the page refuses too); a head edits steps, reasons and targets in one form whose payload the action accepts", async () => {
  const staff = as("staff");
  const refused = await gr(staff, "tab=settings");
  assert.doesNotMatch(refused, /data-rf-form="saveGrConfig"/);
  assert.match(refused, /หน้านี้สำหรับหัวหน้าแผนก GR และฝ่ายวางแผน/);
  const head = as("head");
  const html = await gr(head, "tab=settings");
  assert.match(html, /<form[^>]*data-rf-form="saveGrConfig"/);
  assert.equal((html.match(/<tr data-gr-row="step"/g) ?? []).length, 12 + 1, "twelve steps and the new-row template");
  assert.match(html, /name="reasons"/);
  assert.match(html, /data-gr-target-search/);
  assert.match(html, /<template data-gr-template="target">/);
  // ขั้นที่ใช้อยู่ไม่มีปุ่มลบ
  const used = html.split('<tr data-gr-row="step"').find((row) => row.includes('value="GR-04"'));
  assert.doesNotMatch(used, /data-gr-remove/);
  // ฟอร์ม → payload (ตัวแปลงของ module-bom.js) → action
  const transform = head.context.MNP_BOM.transforms().saveGrConfig;
  const config = head.R.grConfig(dataOf(head));
  const payload = transform({
    step: { code: [...config.steps.map((step) => step.code), ""], name: [...config.steps.map((step) => step.name), "ขัดผิว"], kind: [...config.steps.map((step) => step.kind), "side"], active: [...config.steps.map(() => "1"), "1"] },
    reasons: "ขนาดไม่ได้\r\nผิวไม่สวย/มีรอย\n\nอื่นๆ",
    target: { itemCode: [HL, ""], stepCode: ["GR-04", ""], perHour: ["25", ""] },
  });
  assert.deepEqual(plain(payload.reasons), ["ขนาดไม่ได้", "ผิวไม่สวย/มีรอย", "อื่นๆ"]);
  assert.equal(payload.targets.length, 1, "an empty target row is skipped");
  const result = head.store.run("saveGrConfig", payload);
  assert.equal(result.ok, true, String(result.error?.message ?? ""));
  assert.equal(head.R.grConfig(dataOf(head)).steps.at(-1).code, "GR-13", "a new step gets the next code");
  assert.equal(staff.store.run("saveGrConfig", payload).ok, false, "staff cannot save settings");
});

test("GR dialogs: set steps (head, default = all 9 main steps), request rods (staff), send to PK (head, capped at the unsent good), cancel a send; each refuses the wrong user", () => {
  const head = as("head");
  const staff = as("staff");
  const fresh = jobOf(head, "SE-TP01-OR01-100-18-65");
  const steps = dialog(head, "grSteps", { jobId: fresh.id });
  assert.match(steps.html, /data-rf-form="setGrJobSteps"/);
  for (const code of ["GR-01", "GR-02", "GR-03", "GR-04", "GR-05", "GR-06", "GR-07", "GR-08", "GR-09"]) assert.match(steps.html, new RegExp(`name="code\\[\\]" value="${code}" checked`), `${code} is a main step, ticked by default`);
  for (const code of ["GR-10", "GR-11", "GR-12"]) assert.doesNotMatch(steps.html, new RegExp(`name="code\\[\\]" value="${code}" checked`), `${code} is a side step, not ticked`);
  assert.equal(dialog(staff, "grSteps", { jobId: fresh.id }), null);
  const transform = head.context.MNP_BOM.transforms().setGrJobSteps;
  const result = head.store.run("setGrJobSteps", transform({ jobId: fresh.id, code: ["GR-04", "GR-09"], qty: { "GR-04": "240", "GR-09": "240", "GR-05": "1" } }));
  assert.equal(result.ok, true, String(result.error?.message ?? ""));
  assert.deepEqual(plain(head.R.grPlanOf(dataOf(head), fresh.id).steps.map((step) => step.code)), ["GR-04", "GR-09"]);
  // ลำดับในรายการ = ลำดับที่ส่ง: แผนเดิมตามลำดับแผนก่อน แล้วขั้นที่เหลือตามตั้งค่า · มีปุ่มเลื่อนขึ้น / ลง · ส่งตามลำดับที่แสดง (ขั้นสุดท้าย = ยอดของงาน)
  const reordered = head.store.run("setGrJobSteps", transform({ jobId: fresh.id, code: ["GR-09", "GR-04"], qty: { "GR-04": "240", "GR-09": "240" } }));
  assert.equal(reordered.ok, true, String(reordered.error?.message ?? ""));
  assert.deepEqual(plain(head.R.grPlanOf(dataOf(head), fresh.id).steps.map((step) => step.code)), ["GR-09", "GR-04"], "the order shown is the order sent");
  const again = dialog(head, "grSteps", { jobId: fresh.id });
  const order = [...again.html.matchAll(/name="qty\.(GR-[0-9A-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order.slice(0, 2), ["GR-09", "GR-04"], "the plan's own order comes first");
  assert.deepEqual(order.slice(2), plain(head.R.grConfig(dataOf(head)).steps.filter((step) => step.active && !["GR-09", "GR-04"].includes(step.code)).map((step) => step.code)), "then the other steps in the settings order");
  assert.equal((again.html.match(/data-gr-move="up"/g) ?? []).length, order.length, "every row moves up");
  assert.equal((again.html.match(/data-gr-move="down"/g) ?? []).length, order.length, "and down");
  assert.match(again.html, /aria-label="เลื่อน เจาะ ขึ้น"/);
  assert.equal(typeof again.bind, "function", "the dialog binds the move buttons");
  // routing ไม่มีผลต่อค่าเริ่ม: เริ่มครบ 9 ขั้นสายหลักตามลำดับในตั้งค่าเสมอ
  const other = jobOf(head, "SE-TP01-OR01-75-3-30");
  const routing = dataOf(head).routings.find((entry) => entry.itemCode === other.itemCode && entry.status === "approved");
  routing.steps = [{ processCode: "GR-09" }, { processCode: "GR-05" }];
  const fromRouting = [...dialog(head, "grSteps", { jobId: other.id }).html.matchAll(/name="code\[\]" value="(GR-[0-9A-Z]+)"( checked)?/g)].map((match) => [match[1], Boolean(match[2])]);
  assert.deepEqual(plain(fromRouting.slice(0, 9)), ["GR-01", "GR-02", "GR-03", "GR-04", "GR-05", "GR-06", "GR-07", "GR-08", "GR-09"].map((code) => [code, true]), "a routing does not change the default: all 9 main steps in the settings order");
  assert.equal(fromRouting.slice(9).some(([, on]) => on), false, "the side steps are offered unticked");
  // ขอเบิก: เส้นยางของงานนี้
  const rod = dialog(staff, "grRodRequest", { jobId: fresh.id });
  assert.match(rod.html, /data-rf-form="requestRods"/);
  assert.match(rod.html, /RB-DM01-01-OR01-200-0-72/);
  // ส่งให้ PK: เพดาน = ของดีที่ยังไม่ได้ส่ง
  const planned = jobOf(head, HL);
  const send = dialog(head, "grSendPk", { jobId: planned.id });
  const waiting = head.R.grHandoverSummary(dataOf(head), planned).waitingAtGr;
  assert.match(send.html, new RegExp(`name="qty"[^>]*value="${waiting}"[^>]*max="${waiting}"`));
  assert.equal(dialog(staff, "grSendPk", { jobId: planned.id }), null);
  const sent = dataOf(head).grHandovers.find((row) => row.status === "sent");
  assert.match(dialog(head, "grHandoverCancel", { handoverId: sent.id }).html, /ยกเลิกการส่ง/);
  assert.equal(dialog(staff, "grHandoverCancel", { handoverId: sent.id }), null);
});

test("GR ยางเส้นยาว shows each open request once (in the request table, with its cancel button); a job done by quantity still takes records, a planner-closed one does not; a held job with records resumes instead of going back to the queue", async () => {
  const staff = as("staff");
  const rods = await gr(staff, "tab=rods");
  assert.doesNotMatch(rods, /คำขอที่รอ SR/, "no second column of open requests");
  assert.match(rods, /<h2>คำขอเบิก<\/h2>/);
  assert.equal((rods.match(/รอ SR จ่าย/g) ?? []).length, 1, "the open request shows once");
  assert.equal((rods.match(/data-rf-open="grRodCancel"/g) ?? []).length, 1, "with one cancel button, in the request table");
  const needsTable = rods.split("<h2>คำขอเบิก</h2>")[0];
  assert.doesNotMatch(needsTable, new RegExp(`aria-label="ขอเบิกยางเส้นยาว ${ROD} ใบ DEMO-26001"`), "no second request for a rod already asked on that order");
  assert.match(needsTable, new RegExp(`aria-label="ขอเบิกยางเส้นยาว ${ROD} ใบ DEMO-26006"`), "another order without a request still offers it");
  // งานเสร็จเพราะยอดถึงแผน: ยังบันทึกผลได้ · ฝ่ายวางแผนปิดก่อนถึงแผน: พนักงานบันทึกไม่ได้
  const job = jobOf(staff, HL);
  Object.assign(job, { status: "done", qtyDone: job.qtyPlanned });
  assert.equal(staff.context.MNP_BOM_ACTIONS.helpers.grJobBlock(dataOf(staff), job, dataOf(staff).users.find((user) => user.id === "B05")), null);
  assert.match(await gr(staff, `tab=log&j=${job.id}`), new RegExp(`<option value="${job.id}" selected>`), "a job done by quantity is still in the record form");
  Object.assign(job, { qtyDone: 65 });
  assert.doesNotMatch(await gr(staff, "tab=log"), new RegExp(`<option value="${job.id}"`), "a job closed below the plan is not offered to staff");
  // พักงาน: มีผลรายวันแล้ว = ทำต่อ (คืนคิวไม่ได้) · ยังไม่มีผล = คืนคิว
  const head = as("head");
  const planned = jobOf(head, HL);
  const fresh = jobOf(head, "SE-TP01-OR01-100-18-65");
  planned.status = "hold";
  fresh.status = "hold";
  const html = await gr(head);
  const card = (entry) => cardsOf(html).find((item) => item.includes(`job=${entry.id}"`)) ?? "";
  assert.match(card(planned), /&quot;status&quot;:&quot;in_progress&quot;[^>]*>ทำต่อ</);
  assert.doesNotMatch(card(planned), />คืนคิว</);
  assert.match(card(fresh), />คืนคิว</);
});

test("PK งานของฉัน: one รับจาก GR card per unreceived send, รับ takes the whole send; someone outside PK sees it read-only", async () => {
  const pk = as("pk");
  const sent = dataOf(pk).grHandovers.filter((row) => row.status === "sent");
  assert.equal(sent.length, 1);
  const html = await pk.open("FACTORY_PK");
  const cards = cardsOf(html).filter((card) => card.includes("รับจาก GR"));
  assert.equal(cards.length, 1);
  assert.match(cards[0], /data-rf-action="receiveGrAtPk"/);
  assert.match(cards[0], />รับ<\/button>/);
  assert.match(cards[0], /25 ชิ้น/);
  const count = navOf(pk, "FACTORY_PK")[0].count;
  assert.equal(count, cardsOf(html).length, "the menu count includes the receive card");
  assert.equal(pk.store.run("receiveGrAtPk", { handoverId: sent[0].id }).ok, true);
  assert.equal(cardsOf(await pk.open("FACTORY_PK")).filter((card) => card.includes("รับจาก GR")).length, 0, "received: the card is gone");
  // ผู้วางแผนที่ทำหน้าที่เป็นพนักงาน GR (ผู้ใช้ BOM ไม่ใช่ PK) เห็นการ์ดแบบดูอย่างเดียว
  const viewer = load({ employee: emp("PP") });
  viewer.store.setUser("B05");
  const readOnly = cardsOf(await viewer.open("FACTORY_PK")).find((card) => card.includes("รับจาก GR"));
  assert.match(readOnly, /ดูอย่างเดียว/);
  assert.doesNotMatch(readOnly, /receiveGrAtPk/);
});

test("SR งานของฉัน: an open GR rod request is a task card to the SR issue page with the issue button set to what is still asked; that order and rod code has no second card", async () => {
  const sr = as("sr");
  const html = await sr.open("FACTORY_SR");
  const request = cardsOf(html).find((card) => card.includes("GR ขอเบิก"));
  assert.ok(request, "the request card is on SR งานของฉัน");
  assert.ok(request.includes(`href="#/sr?issue=DEMO-26001&amp;code=${ROD}"`), "the card opens the existing SR issue page");
  assert.match(request, /data-rf-open="rodIssue"[^>]*&quot;qty&quot;:10/);
  assert.match(request, /เส้นยางหมดที่โต๊ะตัด/, "the request note");
  assert.equal(cardsOf(html).filter((card) => card.includes(`จ่ายยางเส้นยาวให้ GR ตามใบ DEMO-26001`) && card.includes(ROD)).length, 0, "no second issue card for the same order and rod code");
  const issue = sr.context.MNP_BOM_DIALOGS.rodIssue(ctxOf(sr), { orderId: "DEMO-26001", itemCode: ROD, qty: 10 });
  assert.match(issue.html, /name="qty"[^>]*value="(10|6)"/, "the issue dialog starts at the asked qty (capped by the stock)");
  // GR ยกเลิกคำขอ: การ์ดคำขอหาย การ์ดจ่ายตามใบกลับมา (มีของในคลัง)
  const staff = as("staff");
  const id = dataOf(sr).rodRequests[0].id;
  dataOf(sr).rodRequests[0].status = "cancelled";
  const after = await sr.open("FACTORY_SR");
  assert.ok(!cardsOf(after).some((card) => card.includes("GR ขอเบิก")));
  assert.ok(cardsOf(after).some((card) => card.includes("จ่ายยางเส้นยาวให้ GR ตามใบ DEMO-26001") && card.includes(ROD)));
  assert.equal(staff.store.run("cancelRodRequest", { requestId: id, reason: "ได้ครบแล้ว" }).ok, true, "the requester cancels with a reason");
});

test("GR ส่งให้ PK and สรุปผล: per-job good / sent / waiting, the sends with their status; summary tables per day, step and worker with no money; ST and PK users cannot record", async () => {
  const head = as("head");
  const pkPage = await gr(head, "tab=pk");
  assert.match(pkPage, /<h2>ของดีของแต่ละงาน<\/h2>/);
  assert.match(pkPage, /<h2>รายการส่ง<\/h2>/);
  assert.match(pkPage, /รอ PK รับ/);
  assert.match(pkPage, /data-rf-open="grHandoverCancel"/);
  const summary = await gr(head, "tab=summary&m=all");
  for (const heading of ["ต่อวัน", "ต่อขั้นตอน", "ต่อคน", "ของเสียตามเหตุผล", "ผลรายวัน"]) assert.match(summary, new RegExp(`<h2>${heading}</h2>`), heading);
  for (const name of ["กมล ทดลองดี", "รัตนา สมมุติ", "สุนทร ใจงาม"]) assert.ok(summary.includes(name), name);
  assert.match(summary, /เจียร์เกิน/);
  assert.doesNotMatch(summary, /บาท|ค่าแรง|undefined|NaN/);
  for (const who of ["st", "pk"]) {
    const env = as(who);
    assert.equal(env.store.run("addGrRecord", { jobId: jobOf(env, HL).id, stepCode: "GR-04", hours: 1, good: 1 }).ok, false, who);
  }
});

test("GR pages escape what users typed and keep to the wording rules; module files load in order", async () => {
  const head = as("head");
  const record = dataOf(head).grRecords.find((row) => row.status === "active");
  record.note = "<img src=x onerror=alert(1)>";
  record.workerName = "<b>ชื่อ</b>";
  dataOf(head).rodRequests[0].note = "<script>x</script>";
  const pages = [await gr(head, "tab=log"), await gr(head, `job=${record.jobId}`), await gr(head, "tab=rods"), await gr(head, "tab=summary&m=all")];
  for (const html of pages) {
    assert.doesNotMatch(html, /<img src=x|<b>ชื่อ|<script>x/);
    assert.doesNotMatch(html, /แท่ง|undefined|NaN|\[object Object\]/);
  }
  assert.ok(pages[0].includes("&lt;img src=x onerror=alert(1)&gt;"));
  for (const file of ["modules/gr-pages.js", "modules/module-gr.js"]) assert.doesNotMatch(read(file), /แท่ง/, file);
  const html = read("index.html");
  const order = [...html.matchAll(/<script defer src="\.\/([^"?]+)/g)].map((match) => match[1]);
  assert.ok(order.indexOf("modules/gr-pages.js") > order.indexOf("modules/module-sr.js") && order.indexOf("modules/gr-pages.js") < order.indexOf("modules/module-gr.js"));
  assert.ok(order.indexOf("modules/module-gr.js") < order.indexOf("modules/module-pk.js"));
});
