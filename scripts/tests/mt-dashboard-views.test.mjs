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
// ตัวกรองงานค้าง: รายการด้านล่างเป็นรายการใบค้างเอง จึงไม่ซ่อนใบที่ "ต้องลงมือตอนนี้" แสดงอยู่ (หน้าปกติไม่พิมพ์ใบเดียวกันสองที่)
const OPEN = "&scope=open";

async function render({ status = "assigned", technicians = ["t1"], directory, overdue = false, startedOn = null, requesterId = "requester", requesterName = "ผู้แจ้งในใบ", owners = [], ownerError = null, section = "drill", search = "", querySelector = () => null } = {}) {
  const root = { innerHTML: "", addEventListener() {}, querySelector };
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
    URLSearchParams, console: { warn() {} }, CSS: { escape: (value) => value },
  });
  vm.runInContext(source, context);
  await mtModule.pages["mt-dashboard"](new URLSearchParams(`year=2026${search}`));
  if (section === "page") return root.innerHTML;
  return root.innerHTML.split(section === "act" ? 'data-card="act"' : 'id="nd-drill"')[1].split("</section>")[0];
}

test("waiting and in-progress MT requests show the assigned technician below their status", async () => {
  for (const status of ["assigned", "in_progress"]) {
    const html = await render({ status, overdue: true, search: OPEN });
    assert.match(html, /ช่างผู้รับผิดชอบ: สมชาย ใจดี/);
    assert.match(html, /เลยกำหนด/);
    assert.match(html, /href="#\/request\?id=r1"/);
  }
});

test("all assignees appear once and technician names are escaped", async () => {
  const html = await render({
    search: OPEN,
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
  assert.match(await render({ search: OPEN, technicians: [] }), /ช่างผู้รับผิดชอบ: ยังไม่ได้มอบหมายช่าง/);
  assert.match(await render({ search: OPEN, directory: new Map() }),/ช่างผู้รับผิดชอบ: ช่าง \(ไม่พบชื่อ\)/);
});

test("requests waiting on other workflow participants do not claim a technician owns the work", async () => {
  for (const status of ["pending_approval", "more_info", "pending_assign", "pending_verify", "completed", "rejected"]) {
    assert.doesNotMatch(await render({ status, search: ["completed", "rejected"].includes(status) ? "" : OPEN }), /ช่างผู้รับผิดชอบ:/);
  }
});

// ช่อง "รอใคร": บรรทัดบนคือชื่อขั้น (บอกตำแหน่งอยู่แล้วในเกือบทุกขั้น) บรรทัดล่างคือชื่อคน — ตำแหน่งขึ้นต้นชื่อเฉพาะขั้นที่ชื่อขั้นไม่บอก
const who = (names) => new RegExp(`<br><span class="nd-muted">${names}</span></td>`);

test("act-now waiting-on cell names every assigned technician and escapes their names", async () => {
  const directory = new Map([
    ["t1", { first_name: "สมชาย", last_name: "ใจดี" }],
    ["t2", { first_name: "<ช่าง>", last_name: "สอง" }],
  ]);
  const waiting = await render({ section: "act", status: "assigned", technicians: ["t1", "t2", "t1"], directory });
  assert.match(waiting, /รอช่างเริ่มงาน<br><span class="nd-muted">สมชาย ใจดี, &lt;ช่าง&gt; สอง<\/span>/, "the label says ช่าง, so the names are not prefixed with it again");
  assert.match(await render({ section: "act", status: "in_progress", technicians: ["t1", "t2", "t1"], directory }), /กำลังซ่อม<br><span class="nd-muted">ช่าง: สมชาย ใจดี, &lt;ช่าง&gt; สอง<\/span>/);
});

test("act-now information and verification steps name the requester, with the saved name as fallback", async () => {
  for (const status of ["more_info", "pending_verify"]) {
    const current = await render({ section: "act", status, directory: new Map([["requester", { first_name: "ผู้แจ้ง", last_name: "ปัจจุบัน" }]]) });
    assert.match(current, who("ผู้แจ้ง ปัจจุบัน"));
    assert.doesNotMatch(current, /ผู้แจ้ง: /, "the role is in the label, not repeated before the name");
    assert.match(await render({ section: "act", status, requesterName: "ผู้แจ้ง <เดิม>" }), who("ผู้แจ้ง &lt;เดิม&gt;"));
  }
});

test("act-now role owners come from the scoped RPC, including managers and approval fallback", async () => {
  const approval = await render({ section: "act", status: "pending_approval", owners: [
    { request_id: "r1", status: "pending_approval", full_name: "ผู้จัดการ หนึ่ง" },
    { request_id: "r1", status: "pending_approval", full_name: "ผู้ช่วย สอง" },
  ] });
  assert.match(approval, /รอผู้จัดการโรงงานอนุมัติ<br><span class="nd-muted">ผู้จัดการ หนึ่ง, ผู้ช่วย สอง<\/span>/);
  assert.doesNotMatch(approval, /ผู้จัดการโรงงาน: |ผจก\./, "the role is said once, in full");
  assert.match(await render({ section: "act", status: "pending_assign", owners: [{ request_id: "r1", status: "pending_assign", full_name: "หัวหน้า MT" }] }), /รอมอบหมายช่าง<br><span class="nd-muted">ผู้จัดการแผนกซ่อมบำรุง: หัวหน้า MT<\/span>/);
  assert.match(await render({ section: "act", status: "pending_approval", owners: [{ request_id: "r1", status: "pending_approval", full_name: "ผู้ดูแล", is_fallback: true }] }), /ผู้ดูแล \(รับแทน\)/);
});

test("act-now names have a clear fallback when data is absent, unavailable or stale", async () => {
  // ไม่มีคำว่า "ไม่พบ" ที่อ่านเหมือนระบบพัง: บอกว่ารออะไรอยู่ด้วยคำธรรมดา
  assert.match(await render({ section: "act", technicians: [] }), who("ยังไม่ได้มอบหมายช่าง"));
  // อ่านรายชื่อตามบทบาทไม่สำเร็จ: บอกเพียงตำแหน่งที่รอ (ขั้นอนุมัติชื่อขั้นบอกแล้ว จึงไม่มีบรรทัดล่าง)
  assert.match(await render({ section: "act", status: "pending_assign", ownerError: new Error("unavailable") }), who("ผู้จัดการแผนกซ่อมบำรุง"));
  const approvalFailed = await render({ section: "act", status: "pending_approval", ownerError: new Error("unavailable") });
  assert.match(approvalFailed, /<td>รอผู้จัดการโรงงานอนุมัติ<\/td>/);
  assert.doesNotMatch(approvalFailed, /ไม่พบ|<span class="nd-muted"><\/span>/);
  // อ่านสำเร็จแต่ไม่มีผู้ถือบทบาทของขั้นนี้ (รวมข้อมูลของขั้นเดิม)
  assert.match(await render({ section: "act", status: "pending_assign", owners: [{ request_id: "r1", status: "pending_approval", full_name: "ผู้อนุมัติเดิม" }] }), who("ผู้จัดการแผนกซ่อมบำรุง: ยังไม่ได้ตั้งผู้รับผิดชอบ"));
  assert.match(await render({ section: "act", status: "pending_approval", owners: [{ request_id: "r1", status: "pending_approval", current_step: 2, full_name: "ผู้อนุมัติขั้นถัดไป" }] }), who("ยังไม่ได้ตั้งผู้อนุมัติ"));
  assert.doesNotMatch(await render({ section: "page", technicians: [] }), /ไม่พบชื่อผู้รับผิดชอบ|ไม่พบข้อมูลช่างที่รับผิดชอบ/);
});

test("each request is on the page once: the drill list skips what act-now shows, and a backlog filter replaces act-now", async () => {
  const page = await render({ section: "page" });
  assert.equal(page.match(/>TEST-MT-001</g).length, 1, "listed in act-now only");
  // รอบ 11: ทุกใบอยู่ใน "ต้องลงมือตอนนี้" แล้ว จึงไม่มีการ์ดรายการประกอบตัวเลขที่บอกแค่ว่าไม่มีอะไรเพิ่ม
  assert.doesNotMatch(page, /id="nd-drill"|ทุกใบอยู่ใน “ต้องลงมือตอนนี้” ด้านบนแล้ว/, "no card that only says nothing more");
  const filtered = await render({ section: "page", search: OPEN });
  assert.equal(filtered.match(/>TEST-MT-001</g).length, 1, "the backlog list is the only place");
  assert.doesNotMatch(filtered, /data-card="act"|ไม่แสดงซ้ำ/);
  // ใบที่ปิดแล้วไม่อยู่ใน act-now จึงอยู่ในรายการด้านล่างตามปกติ
  const closed = await render({ section: "page", status: "completed" });
  assert.match(closed, /<table class="nd-rowlink">[\s\S]*>TEST-MT-001</);
  assert.doesNotMatch(closed, /ไม่แสดงซ้ำ/);
});

test("a role is written once per row, and cards with nothing to chart collapse to one line", async () => {
  const page = await render({ section: "page" });
  assert.match(page, /<span class="nd-lab">รอผู้จัดการโรงงานอนุมัติ<\/span>/, "the stage label names the role; no short sub-label");
  assert.match(page, /<span class="nd-lab">รอมอบหมายช่าง<br><span class="nd-muted">ผู้จัดการแผนกซ่อมบำรุง<\/span><\/span>/, "a sub-label stays where the label does not name the owner");
  assert.doesNotMatch(page, /ผจก\.(?:โรงงาน|ทั่วไป|ซ่อมบำรุง)<\/span>/, "no short role as a sub-label");
  const phase = page.split('data-card="phase"')[1].split("</section>")[0];
  assert.doesNotMatch(phase, /nd-brow/);
  assert.match(phase, /<p class="nd-empty">ยังไม่มีช่วงที่เดินครบ/, "no four rows of —");
  const tech = page.split('data-card="tech"')[1].split("</section>")[0];
  // รอบ 12: ยังไม่มีเวลาซ่อม จึงไม่จัดอันดับช่างที่ 0 ชม. บอกว่ายังไม่มี พร้อมช่างที่ถืองานอยู่ (ไม่ขัดกับใบกำลังซ่อมในตาราง)
  assert.match(tech, /<p class="nd-empty">ยังไม่มีเวลาซ่อมจากใบที่แจ้งในช่วงนี้ · ถืองานอยู่ตอนนี้: [^<]+ 1 ใบ<\/p>/);
  assert.doesNotMatch(tech, /nd-brow|ชม\.|nd-legend/, "no ranking of zero hours");
});

test("bar cards are marked for the two-column grid and wide tables are not", async () => {
  const page = await render({ section: "page" });
  for (const card of ["stage", "phase", "machine", "tech"]) assert.match(page, new RegExp(`class="card nd-card nd-half" data-card="${card}"`));
  for (const card of ["act", "deptrank"]) assert.match(page, new RegExp(`class="card nd-card" data-card="${card}"`));
  // รายการประกอบตัวเลข (เมื่อมีใบที่ไม่อยู่ใน act-now) เป็นการ์ดเต็มแถว
  assert.match(await render({ section: "page", status: "completed" }), /class="card nd-card" id="nd-drill"/);
});

test("the due column shows the date only; the late pill is the one place that counts days", async () => {
  const soon = await render({ section: "act" });
  assert.match(soon, /<td>2026-10-15<\/td>/, "a date and nothing derived from it");
  assert.doesNotMatch(soon, /อีก \d+ วัน|ครบกำหนดวันนี้|เลยมา/);
  const late = await render({ section: "act", overdue: true });
  assert.match(late, /<td>2026-10-02<\/td>/);
  assert.equal(late.match(/เลย 8 วัน/g).length, 1, "the pill says it once; the date cell does not repeat it");
  assert.doesNotMatch(late, /เลยมา/);
});

test("the oldest-job figure is not repeated in a banner above the tiles", async () => {
  const page = await render({ section: "page" });
  assert.match(page, /<div class="nd-summary" role="status"><\/div>/, "empty, so the page hides it");
  assert.doesNotMatch(page, /ใบที่ค้างนานสุด/);
  assert.equal(page.match(/ค้างมา<\/th>/g).length, 1);
  assert.match(source, /\["ค้างนานสุด"/, "still available once, in the tapped stage detail");
});

// โครงจำลองของ DOM แค่พอให้ placeDrill ทำงาน: การ์ดเป็นพี่น้องกัน มี class และ after()
test("the filtered list goes after the right card of a half-width pair, so no half card is left alone in its row", async () => {
  const place = async (classes, hostAt) => {
    const cards = classes.map((cls, index) => ({ name: `c${index}`, classList: { contains: (name) => cls.split(" ").includes(name) }, after(node) { node.placedAfter = this.name; } }));
    cards.forEach((card, index) => { card.previousElementSibling = cards[index - 1] ?? null; card.nextElementSibling = cards[index + 1] ?? null; });
    const drill = { placedAfter: null };
    await render({ section: "page", search: OPEN, querySelector: (selector) => (selector === "#nd-drill" ? drill : selector === ".nd-summary" ? { closest: () => cards[hostAt] } : null) });
    return drill.placedAfter;
  };
  const layout = ["card", "card nd-half", "card nd-half", "card nd-half", "card nd-half", "card"];
  assert.equal(await place(layout, 1), "c2", "after the pair, not between the halves");
  assert.equal(await place(layout, 2), "c2");
  assert.equal(await place(layout, 3), "c4", "the second pair");
  assert.equal(await place(layout, 5), "c5", "a full-width card is unchanged");
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
  // หัวแบบเดียวกับแดชบอร์ด NCR: สถานะเวอร์ชันอยู่ในบรรทัดขอบเขต ไม่เป็นป้ายในช่องขวา
  assert.match(html, /<p>ไม่นับใบที่ยกเลิก · เวอร์ชันทดสอบ<\/p>/);
  assert.doesNotMatch(html, /<span class="badge">เวอร์ชันทดสอบ<\/span>/);
  // ไม่มี MNP_NOTES (เทสต์นี้โหลดแค่แดชบอร์ด) จึงเหลือบรรทัดเวลาข้อมูล · ในหน้าจริงคำขอให้แจ้งใบที่ไม่ตรงอยู่หลังปุ่ม ⓘ ที่แตะได้บนจอสัมผัส
  assert.match(html, /<p class="nd-muted">ข้อมูล ณ [^<]*<\/p>/);
  assert.match(source, /window\.MNP_NOTES\?\.toggle\("ข้อมูลของแดชบอร์ด", "<p>ตัวเลขนับเฉพาะใบที่บัญชีนี้มีสิทธิ์เห็น · ตัวเลขไม่ตรงกับหน้างาน แจ้งเลขที่ใบที่ไม่ตรงได้เลย<\/p>"\)/, "the request to report mismatches sits behind the ⓘ button (a button works on touch, a title does not)");
  assert.doesNotMatch(html, /ค้างมากสุดที่ขั้น/, "the busiest stage is the dark bar in งานค้างอยู่ที่ใคร");
  assert.match(html, /<h2>ช่างที่ใช้เวลาซ่อมมากสุด<\/h2><p>[^<]*ไม่ใช่ชั่วโมงทำงานจริง/, "the technician-hours caveat is in the card note that dashboard-notes.js folds into วิธีนับ");
  assert.match(source, /<span>เวลาตามนาฬิกา ไม่ใช่ชั่วโมงทำงาน<\/span><\/div>/, "and a short reminder stays in its legend");
  assert.match(html, /<table class="nd-act nd-rowlink">[\s\S]*<td class="nd-num" data-label="ค้างมา">/, "the act-now table can become cards on a phone, and the whole row opens the request");
  assert.doesNotMatch(html, /ตรงกับจำนวนใน/, "no reconciliation sentence repeating a tile's number");
});
