import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const model = require("../../modules/mt-dashboard-model.js");
const source = readFileSync(new URL("../../modules/module-mt-dashboard.js", import.meta.url), "utf8");
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
// ชื่อเครื่องจักรใช้ตัวช่วยกลางของ app.js (ตัวจริง ไม่ใช่ของจำลอง)
const appSource = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
const machineLabelStart = appSource.indexOf("function machineLabelOf(");
const machineLabelContext = vm.createContext({});
vm.runInContext(`${appSource.slice(machineLabelStart, appSource.indexOf("\n}", machineLabelStart) + 2)}\nthis.fn = machineLabelOf;`, machineLabelContext);
const machineLabelOf = machineLabelContext.fn;

async function render({ status = "assigned", technicians = ["t1"], directory, overdue = false, startedOn = null, requesterId = "requester", requesterName = "ผู้แจ้งในใบ", owners = [], ownerError = null, section = "drill" } = {}) {
  const root = { innerHTML: "", addEventListener() {}, querySelector: () => null };
  const mtModule = {};
  const request = {
    id: "r1", request_no: "TEST-MT-001", status, current_step: 1, doc_type: "repair",
    submitted_at: "2026-10-01T02:00:00Z", department: { code: "MT" },
    requester_id: requesterId, requester_name: requesterName,
    work_started_date: startedOn, work_expected_date: overdue ? "2026-10-02" : "2026-10-15",
    request_technicians: technicians.map((id) => ({ technician_id: id })),
  };
  const query = {
    select() { return this; }, eq() { return this; }, order() { return this; },
    maybeSingle: async () => ({ data: { id: "type-mt" } }),
    range: async () => ({ data: [request] }),
  };
  const context = vm.createContext({
    window: {
      MNP_REQUEST_MODULES: { MT_REPAIR: mtModule }, MNP_MT_DASHBOARD: model,
      MNP_REQUEST_CENTER: { url: () => "#/requests" }, scrollY: 0, scrollTo() {},
    },
    document: { getElementById: () => root, activeElement: null },
    sb: { from: () => query, rpc: (name, args) => {
      assert.equal(name, "app_mt_dashboard_role_owners");
      assert.deepEqual(Array.from(args.p_request_ids), ["r1"]);
      return { range: async () => ({ data: owners.map((owner) => ({ current_step: 1, ...owner })), error: ownerError }) };
    } }, state: { employee: { id: "viewer" } },
    app: { innerHTML: "" }, shell: (html) => html, bindShell() {}, loadingShell() {},
    escapeHtml, machineLabelOf, relation: (value) => value, bangkokToday: () => "2026-10-10",
    formatDate: (value) => value, statusBadge: (value) => `<span class="badge">${value}</span>`,
    loadEmployeeDirectory: async () => directory ?? new Map([["t1", { first_name: "สมชาย", last_name: "ใจดี" }]]),
    URLSearchParams, console: { warn() {} },
  });
  vm.runInContext(source, context);
  await mtModule.pages["mt-dashboard"](new URLSearchParams("year=2026"));
  if (section === "page") return root.innerHTML;
  return root.innerHTML.split(section === "act" ? 'data-card="act"' : 'id="nd-drill"')[1].split("</section>")[0];
}

test("waiting and in-progress MT requests show the assigned technician below their status", async () => {
  for (const status of ["assigned", "in_progress"]) {
    const html = await render({ status, overdue: true });
    assert.match(html, /ช่างผู้รับผิดชอบ: สมชาย ใจดี/);
    assert.match(html, /เลยกำหนด/);
    assert.match(html, /href="#\/request\?id=r1"/);
  }
});

test("all assignees appear once and technician names are escaped", async () => {
  const html = await render({
    technicians: ["t1", "t2", "t1"],
    directory: new Map([
      ["t1", { first_name: "สมชาย", last_name: "ใจดี" }],
      ["t2", { first_name: "<img src=x onerror=alert(1)>", last_name: "&ทีม" }],
    ]),
  });
  assert.match(html, /ช่างผู้รับผิดชอบ: สมชาย ใจดี, &lt;img src=x onerror=alert\(1\)&gt; &amp;ทีม/);
  assert.equal(html.match(/สมชาย ใจดี/g).length, 1);
  assert.doesNotMatch(html, /<img/);
});

test("missing assignment or directory data has a clear fallback", async () => {
  assert.match(await render({ technicians: [] }), /ช่างผู้รับผิดชอบ: ไม่พบข้อมูลช่างที่รับผิดชอบ/);
  assert.match(await render({ directory: new Map() }), /ช่างผู้รับผิดชอบ: ช่าง \(ไม่พบชื่อ\)/);
});

test("requests waiting on other workflow participants do not claim a technician owns the work", async () => {
  for (const status of ["pending_approval", "more_info", "pending_assign", "pending_verify", "completed", "rejected"]) {
    assert.doesNotMatch(await render({ status }), /ช่างผู้รับผิดชอบ:/);
  }
});

test("act-now waiting-on cell names every assigned technician and escapes their names", async () => {
  const directory = new Map([
    ["t1", { first_name: "สมชาย", last_name: "ใจดี" }],
    ["t2", { first_name: "<ช่าง>", last_name: "สอง" }],
  ]);
  for (const status of ["assigned", "in_progress"]) {
    assert.match(await render({ section: "act", status, technicians: ["t1", "t2", "t1"], directory }), /ช่าง: สมชาย ใจดี, &lt;ช่าง&gt; สอง/);
  }
});

test("act-now information and verification steps name the requester, with the saved name as fallback", async () => {
  for (const status of ["more_info", "pending_verify"]) {
    assert.match(await render({ section: "act", status, directory: new Map([["requester", { first_name: "ผู้แจ้ง", last_name: "ปัจจุบัน" }]]) }), /ผู้แจ้ง: ผู้แจ้ง ปัจจุบัน/);
    assert.match(await render({ section: "act", status, requesterName: "ผู้แจ้ง <เดิม>" }), /ผู้แจ้ง: ผู้แจ้ง &lt;เดิม&gt;/);
  }
});

test("act-now role owners come from the scoped RPC, including managers and approval fallback", async () => {
  const approval = await render({ section: "act", status: "pending_approval", owners: [
    { request_id: "r1", status: "pending_approval", full_name: "ผู้จัดการ หนึ่ง" },
    { request_id: "r1", status: "pending_approval", full_name: "ผู้ช่วย สอง" },
  ] });
  assert.match(approval, /ผจก.โรงงาน: ผู้จัดการ หนึ่ง, ผู้ช่วย สอง/);
  assert.match(await render({ section: "act", status: "pending_assign", owners: [{ request_id: "r1", status: "pending_assign", full_name: "หัวหน้า MT" }] }), /ผจก.ซ่อมบำรุง: หัวหน้า MT/);
  assert.match(await render({ section: "act", status: "pending_approval", owners: [{ request_id: "r1", status: "pending_approval", full_name: "ผู้ดูแล", is_fallback: true }] }), /ผู้ดูแล \(รับแทน\)/);
});

test("act-now names have a clear fallback when data is absent, unavailable or stale", async () => {
  assert.match(await render({ section: "act", technicians: [] }), /ช่าง: ไม่พบชื่อผู้รับผิดชอบ/);
  assert.match(await render({ section: "act", status: "pending_assign", ownerError: new Error("unavailable") }), /ผจก.ซ่อมบำรุง: ไม่พบชื่อผู้รับผิดชอบ/);
  assert.match(await render({ section: "act", status: "pending_assign", owners: [{ request_id: "r1", status: "pending_approval", full_name: "ผู้อนุมัติเดิม" }] }), /ผจก.ซ่อมบำรุง: ไม่พบชื่อผู้รับผิดชอบ/);
  assert.match(await render({ section: "act", status: "pending_approval", owners: [{ request_id: "r1", status: "pending_approval", current_step: 2, full_name: "ผู้อนุมัติขั้นถัดไป" }] }), /ผจก.โรงงาน: ไม่พบชื่อผู้รับผิดชอบ/);
});

test("act-now badge counts a waiting job from the assigned start date and a late job from the expected date", async () => {
  assert.match(await render({ section: "act", startedOn: "2026-10-07" }), /เลยวันเริ่ม 3 วัน/);
  assert.doesNotMatch(await render({ section: "act", startedOn: "2026-10-10" }), /เลยวันเริ่ม/);
  const late = await render({ section: "act", startedOn: "2026-10-01", overdue: true });
  assert.match(late, /เลย 8 วัน/);
  assert.doesNotMatch(late, /เลยวันเริ่ม/);
});

// กติกา "Show each fact once" (AGENTS.md): คำอธิบายอยู่ใน "วิธีนับ" ของการ์ดหรือนิยาม ไม่ซ้ำเป็นย่อหน้าถาวร
test("the page has no permanent explanation paragraphs and no fact said twice", async () => {
  const html = await render({ section: "page" });
  assert.doesNotMatch(html, /class="nd-warn"|class="nd-hint">(?:ตรวจรับไม่ผ่าน|"ถืออยู่")/, "card notes fold into each card's วิธีนับ");
  assert.doesNotMatch(html, /<p>ไม่นับฉบับร่างและใบที่ยกเลิก<\/p>/, "the definition of open jobs already says this");
  assert.match(html, /<span class="badge">เวอร์ชันทดสอบ<\/span>/);
  // ไม่มี MNP_NOTES (เทสต์นี้โหลดแค่แดชบอร์ด) จึงเหลือบรรทัดเวลาข้อมูล · ในหน้าจริงคำขอให้แจ้งใบที่ไม่ตรงอยู่หลังปุ่ม ⓘ ที่แตะได้บนจอสัมผัส
  assert.match(html, /<p class="nd-muted">ข้อมูล ณ [^<]*<\/p>/);
  assert.match(source, /window\.MNP_NOTES\?\.toggle\("ข้อมูลของแดชบอร์ด", "<p>ตัวเลขนับเฉพาะใบที่บัญชีนี้มีสิทธิ์เห็น · ตัวเลขไม่ตรงกับหน้างาน แจ้งเลขที่ใบที่ไม่ตรงได้เลย<\/p>"\)/, "the request to report mismatches sits behind the ⓘ button (a button works on touch, a title does not)");
  assert.doesNotMatch(html, /ค้างมากสุดที่ขั้น/, "the busiest stage is the dark bar in งานค้างอยู่ที่ใคร");
  assert.match(html, /<h2>ช่างที่ใช้เวลาซ่อมมากสุด<\/h2><p>[^<]*ไม่ใช่ชั่วโมงทำงานจริง/, "the technician-hours caveat is in the card note that dashboard-notes.js folds into วิธีนับ");
  assert.match(source, /<span>เวลาตามนาฬิกา ไม่ใช่ชั่วโมงทำงาน<\/span><\/div>/, "and a short reminder stays in its legend");
  assert.match(html, /<table class="nd-act nd-rowlink">[\s\S]*<td class="nd-num" data-label="ค้างมา">/, "the act-now table can become cards on a phone, and the whole row opens the request");
  assert.doesNotMatch(html, /ตรงกับจำนวนใน/, "no reconciliation sentence repeating a tile's number");
});
