// critique G P2 "บอกข้อเท็จจริงครั้งเดียว" (กฎใน AGENTS.md): ชื่อเครื่องจักร ข้อมูลใต้หัวใบ หัวโมดูล และตัวกรองบนมือถือ
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const app = read("app.js");
const mt = read("modules/module-mt.js");
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

function pick(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} found`);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("a machine name that already carries its code is not prefixed with the code again", () => {
  const context = vm.createContext({});
  vm.runInContext(`${pick(app, "machineLabelOf")}\nthis.label = machineLabelOf;`, context);
  const { label } = context;
  assert.equal(label("HCM-03", "เครื่องฉีดยาง HCM-03"), "เครื่องฉีดยาง HCM-03");
  assert.equal(label("CMP-01", "ปั๊มลมห้องซ่อม"), "CMP-01 — ปั๊มลมห้องซ่อม");
  assert.equal(label("CMP-01", "ปั๊มลมห้องซ่อม", " · "), "CMP-01 · ปั๊มลมห้องซ่อม", "the list keeps its own separator");
  assert.equal(label("CV-02", "CV-02"), "CV-02");
  assert.equal(label("CV-02", ""), "CV-02");
  assert.equal(label("", "ห้องซ่อม"), "ห้องซ่อม");
  assert.equal(label(null, null), "", "no machine: callers show their own placeholder");
  // รหัสต้องอยู่ในชื่อเป็นคำทั้งคำ: ส่วนหนึ่งของรหัสอื่นไม่นับ, ตัวพิมพ์เล็ก/ใหญ่ไม่ต่างกัน
  assert.equal(label("CV-0", "CV-02 line"), "CV-0 — CV-02 line");
  assert.equal(label("A", "Banana"), "A — Banana");
  assert.equal(label("hcm-03", "เครื่องฉีดยาง HCM-03"), "เครื่องฉีดยาง HCM-03");
  assert.equal(label("MX-1(B)", "เครื่องผสม MX-1(B)"), "เครื่องผสม MX-1(B)", "regex characters in a code are literal");
  // ทุกจุดที่แสดงเครื่องจักรใช้ตัวช่วยนี้
  assert.match(app, /const machine = machineLabelOf\(request\.machine_code, request\.machine_name, " · "\);/);
  assert.match(mt, /const machineLabel = \(machine\) => machine\.is_placeholder \? machine\.code : machineLabelOf\(machine\.code, machine\.name\);/);
  assert.match(mt, /requestFact\("เครื่องจักร", machineLabelOf\(request\.machine_code, request\.machine_name\) \|\| "—"/);
  assert.match(read("modules/module-mt-dashboard.js"), /return machineLabelOf\(row\.machine_code, row\.machine_name\) \|\| "ไม่ระบุเครื่องจักร";/);
});

test("the MT detail page says the document type and the requester once", () => {
  // บรรทัดใต้หัวใบ: ประเภทเอกสาร · โดย <บัญชีที่ส่ง> — การ์ดไม่ซ้ำสองค่านี้
  // ชื่อโมดูลอยู่ที่แถบบน บรรทัดใต้หัวบอกชนิดเอกสารเฉพาะเมื่อต่างจากชื่อโมดูล (MT: ใบแจ้งซ่อม/ใบคำร้อง)
  assert.match(app, /<p class="request-detail-meta">\$\{detailView\?\.typeLabel \? `\$\{escapeHtml\(detailView\.typeLabel\)\} · ` : ""\}โดย /);
  assert.match(mt, /typeLabel: docTypeLabels\[request\.doc_type\] \?\? null,/);
  assert.doesNotMatch(mt, /requestFact\("ประเภทเอกสาร"/);
  assert.match(mt, /const showRequester = requesterName && requesterName !== personName\(directory, request\.requester_id\);/);
  assert.match(mt, /\.\.\.\(showRequester \? \[requestFact\("ผู้แจ้ง", requesterName,/);
});

test("the top bar names the module where the page heading already shows the number", () => {
  assert.match(app, /shell\(content, "requests", type \? requestTypeLabel\(type\) : "คำร้อง", request\.request_no\)/);
  // ชื่อเดียวต่อที่: แถบบน ลิงก์กลับ และชื่อประเภทคำร้องเรียกโมดูลนี้ว่า NCR/CAR
  assert.match(read("modules/module-ncr.js"), /shell\(content, "ncr", "NCR\/CAR", ncr\.ncr_no\)/);
});

test("buttons in a module header do not repeat the module name", () => {
  assert.match(app, /MT_REPAIR: "สร้างคำร้อง \/ แจ้งซ่อม",/);
  assert.match(read("modules/module-mt-dashboard.js"), /label: "แดชบอร์ด", icon: ICON/);
  assert.match(read("modules/module-ncr-dashboard.js"), /label: "แดชบอร์ด", icon: ICON/);
});

test("list filters fold behind one button on phones and stay in one row on wide screens", () => {
  const filters = pick(app, "requestListFilters");
  assert.match(filters, /data-list-filters-toggle\$\{[^]*?\}>\$\{uiIcon\("search"\)\} ตัวกรอง\$\{active \? ` \(\$\{active\}\)` : ""\}<\/button>/);
  assert.match(filters, /aria-expanded="\$\{open\}" aria-controls="list-filters-body"/);
  assert.match(app, /listFiltersOpen = toggle\.getAttribute\("aria-expanded"\) !== "true";/, "the toggle flips its own state");
  // นับเฉพาะตัวกรองที่หน้านี้ใช้จริง และบอกค่าที่กรองอยู่ใน title ตอนพับ
  assert.match(filters, /const query = search \? \(params\.get\("q"\) \?\? ""\)\.trim\(\) : "";/);
  assert.match(filters, /const department = departments \? selectedFilterDepartment\(params, departments\) : null;/);
  assert.match(filters, /title="\$\{escapeHtml\(`กรองอยู่: \$\{applied\.join\(" · "\)\}`\)\}"/);
  // คีย์ลัด / เปิดตัวกรองที่พับไว้ก่อนโฟกัสช่องค้นหา
  assert.match(app, /if \(!search\.getClientRects\(\)\.length\) search\.closest\("\.list-filters"\)\?\.querySelector\('\[data-list-filters-toggle\]\[aria-expanded="false"\]'\)\?\.click\(\);/);
  assert.match(css, /\.list-filters-body \{ display: contents; \}/, "wide screens keep the old single row");
  assert.match(css, /\.list-filters-toggle \{ display: none; \}/);
  assert.match(css, /\.list-filters:not\(\.is-open\) \.list-filters-body \{ display: none; \}/);
});

// ---- รอบสี + ยุบหน้า: บอกข้อเท็จจริงครั้งเดียว ----
test("an MT row is titled by its subject, like the home queue and the detail page, and names the machine only when the subject does not", () => {
  // ชื่อเดียวต่อใบทุกหน้า (critique รอบ 8): หัวของแถวคือชื่อเรื่อง เครื่องจักรอยู่บรรทัดรองเมื่อชื่อเรื่องยังไม่มีรหัสเครื่อง
  assert.match(app, /const main = request\.title;/);
  // ชื่อเรื่องที่ระบบสร้างคือ "ชื่อเครื่อง — อาการ" จึงดูทั้งชื่อและรหัสเครื่อง
  assert.match(app, /const machineInTitle = \[request\.machine_code, request\.machine_name\]\.some\(\(value\) => value && request\.title\.includes\(value\)\);/);
  assert.match(app, /const detail = machine \? \(machineInTitle \? "" : machine\) : description;/);
  assert.doesNotMatch(app, /function titleWithoutMachine\(/);
});

test("the module header does not count what the table below already lists, and the chooser says 'เลือกโมดูล' once", () => {
  assert.doesNotMatch(app, /ยังไม่จบ \$\{counts\.get\(selected\.id\)/);
  assert.doesNotMatch(app, /<h2>เลือกโมดูล<\/h2>/);
  assert.doesNotMatch(app, /เลือกโมดูลเพื่อแสดงรายการคำร้อง/);
});

test("the next-item panel states the remaining count once, and the profile and login use the Thai label for the employee number", () => {
  assert.match(app, /ต้องจัดการอีก \$\{others\.length\} รายการ · ถัดไป/);
  assert.doesNotMatch(app, /รอคุณพิจารณาอีก/, "the panel counts the same queue as the home page");
  assert.doesNotMatch(app, /รายการถัดไป \(\$\{pending\.length\}\)/);
  assert.doesNotMatch(app, /UserID/);
  assert.doesNotMatch(app, /<h2>\$\{escapeHtml\(employee\.first_name\)\} \$\{escapeHtml\(employee\.last_name\)\}<\/h2><span class="badge">/, "the profile card does not repeat the name and role the form shows");
});

// ---- รอบ 10: ส่วนที่ critique รอบ 9 ยังเห็นต่างกัน ----
test("every bottom bar on phones has one layout: full-width buttons, the primary last and twice as wide", () => {
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /:is\(\.ncr-actions, \.detail-actions\) :is\(\.form-actions, \.approval-actions\) \{ display: flex; flex-wrap: nowrap; justify-content: stretch; gap: 8px; \}/);
  assert.match(css, /:is\(\.ncr-actions, \.detail-actions\) :is\(\.form-actions, \.approval-actions\) > \.btn:last-child:not\(:only-child\) \{ flex-grow: 2; \}/);
  assert.match(css, /\.action-panel-buttons \.btn\.is-primary \{ flex-grow: 2; \}/, "the decision bar follows the same rule");
  assert.match(css, /\.step-panel \.action-panel-head \{ display: none; \}/, "no caption that repeats the start button");
  // ปุ่มหลักเป็นปุ่มสุดท้ายในทุกแถบของงานที่ต้องทำ
  assert.match(read("modules/module-mt.js"), /data-result="fail">\$\{uiIcon\("close"\)\} ไม่ผ่าน<\/button><button class="btn success verify-button" data-result="pass">/);
  assert.match(read("modules/ncr-loss-form.js"), /id="ncr-loss-reset" hidden>ยกเลิกการแก้ไข<\/button><button class="btn" type="submit">บันทึกรายการ<\/button>/);
});

test("the NCR detail keeps all of the viewer's work in one action card and names the responder and the due date once", () => {
  const ncr = read("modules/module-ncr.js");
  assert.match(ncr, /const work = \[\.\.\.forms, responderSection, \.\.\.\(lossesInWork \? \[lossesSection\] : \[\]\)\]\.filter\(Boolean\);/);
  assert.match(ncr, /\.\.\.\(lossesInWork \? \[\] : \[lossesSection\]\),/, "the loss card is not shown twice");
  assert.match(ncr, /\$\{work\.length \? "" : waiting \?/, "no 'ขั้นตอนนี้รอ' line when the viewer has work");
  assert.match(ncr, /\$\{designated && !responderSection \? partField\("ผู้ตอบที่ระบุ"/);
  assert.match(ncr, /\$\{dueInForm \? "" : partField\("กำหนดตอบ"/);
  assert.match(read("modules/ncr-loss-form.js"), /'<div class="ncr-action-group ncr-loss-card"><h3>ความสูญเสีย<\/h3>'/, "inside the action card it is a group, not a nested card");
});

test("status glyphs follow the agreed mapping and one age definition is used on home and the NCR dashboard", () => {
  assert.match(read("modules/module-ncr.js"), /const STATUS_BADGE_CLASS = \{ closed: "completed", cancelled: "cancelled", awaiting_info: "more_info" \};/);
  assert.match(app, /function isFinalDecision\(type, status\) \{\r?\n  return status === "approved" && Boolean\(requestModule\(type\?\.code\)\?\.endsAtDecision\);/);
  const css = read("styles.css");
  assert.match(css, /\.badge\.completed, \.badge\.acknowledged, \.badge\.approved\.is-final \{/);
  assert.match(css, /\.badge:is\(\.completed, \.acknowledged, \.approved\.is-final\), \.rf-badge\.is-good \{ --badge-glyph:/);
  assert.match(read("modules/module-ncr.js"), /from\("ncr_status_history"\)\.select\("ncr_id,changed_at"\)/);
  assert.match(app, /createdAt: ncr\.step_since \?\? ncr\.updated_at \?\? ncr\.created_at,/);
});

test("request and NCR details share one hero: back link, eyebrow with the status, then the heading", () => {
  assert.match(app, /<a class="request-back-link" href="#\/requests\$\{type\?\.id/);
  // ลิงก์กลับบอกการกระทำ ชื่อโมดูลอยู่แถบบนครั้งเดียว (และใน title)
  assert.match(read("modules/module-ncr.js"), /<a class="request-back-link" href="#\/ncr" title="กลับไปรายการ NCR\/CAR">‹ กลับไปรายการ<\/a>/);
  assert.match(app, />‹ กลับไปรายการ<\/a>/);
  assert.match(read("modules/module-ncr.js"), /<div class="request-detail-kicker"><span class="eyebrow">\$\{escapeHtml\(ncr\.form_code\)\} · /);
});
