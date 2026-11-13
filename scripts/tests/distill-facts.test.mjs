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
  // รอบรวม 20: บรรทัดนี้อยู่ในหัวใบใต้บรรทัดผู้รายงาน
  assert.match(ncr, /\$\{work\.length \|\| !waiting \? "" : `<p class="ncr-waiting">ขั้นตอนนี้รอ:/, "no 'ขั้นตอนนี้รอ' line when the viewer has work");
  // ส่วนที่ 2 ไม่ทวนสิ่งที่ฟอร์มตอบหรือบรรทัด "ขั้นตอนนี้รอ" บอกแล้ว (รอบ 14)
  assert.match(ncr, /\$\{designated && !responderSection && !waitingSaysResponder \? partField\("ผู้ตอบที่ระบุ"/);
  assert.match(ncr, /\$\{dueInForm \|\| waitingSaysDue \? "" : partField\("กำหนดตอบ"/);
  assert.match(ncr, /const waitingShown = !work\.length && Boolean\(waiting\);/, "the same condition that draws the waiting line");
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
  // รอบ 15: ลิงก์กลับขึ้นแถบบนแทนป้ายทางเดิน จึงบอกชื่อรายการที่จะกลับไป
  assert.match(read("modules/module-ncr.js"), /<a class="request-back-link" href="#\/ncr">‹ NCR\/CAR<\/a>/);
  assert.match(app, /">‹ \$\{escapeHtml\(type \? requestTypeLabel\(type\) : "คำร้อง"\)\}<\/a>/);
  // รอบรวม 19: ตัวคั่นแยกเป็น span ซ่อนบนมือถือ (รหัสฟอร์มบรรทัดหนึ่ง เลขที่บรรทัดสอง ไม่มี " ·" ห้อย)
  assert.match(read("modules/module-ncr.js"), /<div class="request-detail-kicker"><span class="eyebrow"><span class="nowrap">\$\{escapeHtml\(ncr\.form_code\)\}<\/span><span class="eyebrow-sep"> · <\/span><span class="nowrap">\$\{escapeHtml\(ncr\.ncr_no\)\}<\/span><\/span>/);
});

// ---- รอบ 11: ส่วนประกอบกลางที่ MT และ NCR ใช้ร่วมกัน ----
test("MT and NCR lists share one header: scope tabs on top, then one filter row with search", () => {
  assert.match(app, /\$\{requestsViewTabs\(params, \{ board: selected\.code !== "NCR_CAR" \}\)\}\$\{list\}<\/div>`;/);
  assert.match(app, /requestListFilters\(params, \{ placeholder: "ค้นหาเลขที่ NCR สินค้า ลูกค้า หรือข้อบกพร่อง", statusSelect: ncrStatus\.html, statusApplied: ncrStatus\.applied \}\)/);
  assert.doesNotMatch(app, /function requestScopeSwitch\(/);
  const ncr = read("modules/module-ncr.js");
  assert.match(ncr, /if \(search\) rows = rows\.filter\(\(row\) => \[row\.ncr_no, row\.product_name, row\.customer_name, relation\(row\.defect_type\)\?\.name_th\]/);
  assert.match(ncr, /\$\{embedded \? "" : `<div class="list-filters">/, "the register keeps its own filter row only on the stand-alone test page");
});

test("an empty list caused by a search or filter says nothing matched and offers to clear, not to create", () => {
  // ผู้เรียกบอกว่าหน้านั้นกรองจริงหรือไม่ (คำค้นที่ค้างจากโมดูลอื่นไม่นับ)
  assert.match(app, /function listEmptyOf\(params, filtered\) \{/);
  assert.match(app, /filtered: Boolean\(typeId\) && \(Boolean\(search\) \|\| Boolean\(departmentId\) \|\| statuses\.length > 0\)/);
  assert.match(app, /"ไม่พบคำร้องที่ตรงกับคำค้นหรือตัวกรองนี้"/);
  assert.match(app, /label: "ล้างตัวกรอง" \}/);
  assert.match(read("modules/module-ncr.js"), /emptyState\(search \? "ไม่พบ NCR ที่ตรงกับคำค้นนี้" : "ไม่มี NCR ในหมวดนี้ที่คุณมีสิทธิ์เห็น"/);
});

test("both dashboards share one header and do not show a list that repeats act-now or a row of — tiles", () => {
  const mt = read("modules/module-mt-dashboard.js");
  const ncrDash = read("modules/module-ncr-dashboard.js");
  assert.match(mt, /<div><h1>\$\{TITLE\}<\/h1><p>ไม่นับใบที่ยกเลิก · เวอร์ชันทดสอบ<\/p><\/div>/);
  assert.match(ncrDash, /<div><h1>แดชบอร์ด NCR<\/h1><p>ไม่นับใบที่ยกเลิก<\/p><\/div>/);
  for (const source of [mt, ncrDash]) assert.match(source, /if \(list\.length && !rest\.length && !hasDrillFilter\(filters\)\) return "";/);
  assert.match(mt, /const measurable = \(period\) => period\.avgCycle !== null \|\| Boolean\(period\.onTimeBase\) \|\| Boolean\(period\.verified\);/);
  assert.match(mt, /class="nd-tile nd-tile-pending"/);
});

test("the NCR hero states the reporter and issue date once, in the same meta line as a request", () => {
  const ncr = read("modules/module-ncr.js");
  assert.match(ncr, /<p class="request-detail-meta">โดย \$\{escapeHtml\(personName\(directory, ncr\.reporter_id\)\)\}/);
  assert.doesNotMatch(ncr, /partField\("วันที่ออก"|partField\("ผู้รายงาน \/ แผนก"/);
});

// ---- รอบ 12: ข้อที่ผู้ตรวจ 3 คนเห็นตรงกัน ----
test("the NCR register states the loss state once, in the loss column, and names the owner like a request row", () => {
  const ncr = read("modules/module-ncr.js");
  assert.match(ncr, /status: `<span class="register-badges">\$\{statusBadgeHtml\(row\)\}<\/span>/);
  // รอบ 18: คอลัมน์ชื่อ "ความสูญเสีย" อยู่แล้ว ป้ายในช่องจึงบอกแค่ "รอข้อมูล" (ชื่อเต็มใน title)
  assert.match(ncr, /loss: `\$\{row\.lossPending \? '<span class="badge loss-pending-flag" title="รอข้อมูลความสูญเสีย">รอข้อมูล<\/span>' : ""\}/);
  assert.match(ncr, /return registerSubHtml\(`\$\{party\}\$\{progress\}`, `\$\{uiIcon\("user"\)\} `, `ผู้รับผิดชอบ: /);
  const dash = read("modules/module-ncr-dashboard.js");
  assert.doesNotMatch(dash, /">รอข้อมูลความสูญเสีย \$\{fmtCount/, "the assessed tile's fraction is not repeated as a pill");
  assert.doesNotMatch(dash, /return sums\.need > sums\.assessed \? "ยอดบาทเป็นตัวเลขขั้นต่ำ/, "no banner that repeats the tile");
});

test("small consistency fixes: file toggle marker, read-only fields, parts table by container, help per step, RubberFlow reason", () => {
  const css = read("styles.css");
  assert.match(css, /\.action-panel-files > summary::after \{ content: "";/);
  // ช่องที่ปิดชั่วคราวระหว่างส่งฟอร์ม (setFormBusy ใส่ aria-busy) ไม่เปลี่ยนเป็นหน้าตา "แก้ไม่ได้"
  assert.match(app, /form\.toggleAttribute\("aria-busy", busy\);/);
  assert.match(css, /:is\(\.input, \.select, \.textarea\):disabled:not\(\[aria-busy\] \*\) \{ color: var\(--muted\); background: var\(--shell\); border-style: dashed; cursor: not-allowed; \}/);
  assert.match(css, /\.parts-field \{ container-type: inline-size; \}\r?\n@container \(max-width: 760px\) \{/);
  assert.match(mt, /<div class="field parts-field"><label>รายการอะไหล่/);
  assert.match(read("modules/shortcut-help.js"), /"อนุมัติแล้วกดเลิกทำได้ภายใน 5 วินาที ส่วนเริ่มงาน เสร็จสิ้นงาน และตรวจรับส่งทันทีหลังกดยืนยัน"/);
  assert.match(read("modules/rubberflow-pages-plan.js"), /ต้องมีสูตรยางที่อนุมัติแล้วก่อน จึงเปิดใบสั่งผลิตได้/);
});

// ---- รอบ 13: ปุ่ม 44px · ค่าเสียหายครั้งเดียว · แดชบอร์ดข้อมูลน้อย · ใครต้องทำต่อแบบเดียว ----
test("desktop buttons meet the 44px target in PRODUCT.md, small buttons 40px", () => {
  const css = read("styles.css").replace(/\r\n/g, "\n");
  assert.match(css, /\.btn \{\n  min-height: 44px;\n  padding: 0 16px;/);
  assert.match(css, /  font-weight: 600;\n  font-size: var\(--text-ui\);\n\}\n\.btn \{ transition:/);
  assert.match(css, /\.btn\.small \{ min-height: 40px; padding: 0 12px; font-size: var\(--text-meta\); \}/);
});

test("sparse dashboards draw no zero rows and no legend that compares nothing", () => {
  const mtDash = read("modules/module-mt-dashboard.js");
  assert.match(mtDash, /const shown = stages\.filter\(\(stage\) => stage\.count > 0 \|\| filters\.stage === stage\.key\);/);
  assert.match(mtDash, /\$\{shown\.some\(\(stage\) => stage\.count !== shown\[0\]\.count\) \? `<div class="nd-legend">/);
  assert.match(mtDash, /\$\{items\.some\(\(item\) => item\.count !== items\[0\]\.count\) \? `<div class="nd-legend">/);
  const ncrDash = read("modules/module-ncr-dashboard.js");
  assert.match(ncrDash, /\$\{items\.length > 1 \? `<div class="nd-legend"><span><i class="strong"><\/i>กลุ่มที่รวมกันได้ 80% แรก/);
  assert.match(ncrDash, /\$\{sums\.estimated \|\| sums\.legacy \? `<span class="nd-note">/, "no '+ ประมาณการ 0 ฿' line");
});

test("who acts next on an NCR has one format: แผนก X (names) for every department, never trimmed to names", () => {
  const ncr = read("modules/module-ncr.js");
  assert.match(ncr, /parts\.map\(\(part\) => `แผนก \$\{part\}`\)\.join\(" · "\)/);
  assert.doesNotMatch(ncr, /\(ผู้ตอบที่ระบุ: \$\{named/);
  assert.doesNotMatch(ncr, /const single = oneDepartment/);
});

test("round 14: one repair-result vocabulary, labelled parts rows, one machine format, and no fact said twice", () => {
  const mt = read("modules/module-mt.js");
  // ประวัติไม่ทวนผลการซ่อมด้วยชื่อหัวข้ออีกชุด
  assert.doesNotMatch(app, /ความเห็นผู้ตรวจสอบ: |อะไหล่\/วัสดุ: |latestRepairResult/);
  // แถวอะไหล่: ชื่อช่องจริง ไม่ใช้ข้อความตัวอย่างแทน · จำนวนและราคาเปิดแป้นตัวเลข · ลบแล้วเลิกทำได้
  assert.doesNotMatch(mt, /placeholder="(จำนวน|หน่วย|ราคา|ชื่อร้าน|หมายเหตุ|รายการอะไหล่\/วัสดุที่ใช้)"/);
  assert.equal(mt.match(/inputmode="decimal"/g).length, 2);
  assert.match(mt, /<td data-label="จำนวน"><input class="input" type="text" inputmode="decimal"/);
  assert.match(mt, /class="btn secondary small parts-row-restore">เลิกทำ<\/button>/);
  const css = read("styles.css");
  assert.match(css, /\.parts-table td\[data-label\]::before \{ content: attr\(data-label\);/);
  // แถบปุ่มล่างจอสองปุ่ม: ปุ่มรองไม่ตัดสองบรรทัด
  assert.match(css, /:has\(> \.btn:nth-child\(2\):last-child\) > \.btn:first-child \{ flex: 0 0 auto; padding-inline: 14px; white-space: nowrap; \}/);
  // แดชบอร์ด MT: ชื่อเครื่องจักรผ่าน machineLabelOf ทุกที่ ไม่ต่อรหัสหน้าชื่อเอง
  const dash = read("modules/module-mt-dashboard.js");
  assert.doesNotMatch(dash, /item\.code\)\}\$\{item\.name \?|String\(row\.machine_code\)\.trim\(\)\} \(/);
  assert.equal(dash.match(/machineLabelOf\(/g).length >= 4, true);
  // โปรไฟล์: รหัสพนักงานที่เดียว · ช่องไม่บังคับบอก (ถ้ามี) · ไม่มี "ชื่อตำแหน่งงาน" คู่กับ "ตำแหน่ง"
  assert.doesNotMatch(app, /profile-employee-no|ชื่อตำแหน่งงาน/);
  // อีเมลล้างทิ้งไม่ได้ (app_update_own_profile คืนค่าเดิม) จึงจำเป็น · เบอร์ล้างได้จึง (ถ้ามี)
  assert.match(app, /<label for="profile-email">อีเมล\$\{REQUIRED_MARK\}<\/label>[^\n]*required><\/div>/);
  assert.match(app, /<label for="profile-phone">เบอร์ติดต่อ \(ถ้ามี\)<\/label>/);
  // ปุ่มอัปโหลดตามชุดไฟล์จริง รวมตอนกด × ลบไฟล์ในตัวอย่าง
  assert.match(app, /\["change", "mnp:files-changed"\]\.forEach/);
  assert.equal(read("modules/attachment-image.js").match(/new Event\("mnp:files-changed", \{ bubbles: true \}\)/g).length, 2);
  // อัปโหลดกดได้เมื่อเลือกไฟล์แล้ว · หัวเรื่องไม่ตัดรหัสกลางคำ
  assert.match(app, /class="btn secondary attachment-upload" type="submit" disabled>อัปโหลด/);
  assert.match(app, /<h1>\$\{headingTextHtml\(request\.title\)\}<\/h1>/);
  assert.match(read("modules/module-ncr.js"), /<h1>\$\{headingTextHtml\(ncr\.product_name \|\| ncr\.ncr_no\)\}<\/h1>/);
  assert.match(read("modules/module-ncr.js"), /แนวทางการป้องกันไม่ให้เกิดซ้ำ \(ถ้ามี\)<\/label>/);
});

test("headingTextHtml keeps a machine code on one line and still escapes the text", () => {
  const context = vm.createContext({});
  const source = app.match(/function escapeHtml\([^]*?\r?\n\}\r?\n/)[0] + app.match(/function headingTextHtml\([^]*?\r?\n\}\r?\n/)[0];
  vm.runInContext(source, context);
  assert.equal(context.headingTextHtml("HCM-03 รั่ว <b>"), '<span class="nowrap">HCM-03</span> รั่ว &lt;b&gt;');
  assert.equal(context.headingTextHtml("ไม่มีรหัส"), "ไม่มีรหัส");
});

test("round 15: the topbar carries the page's back link instead of a breadcrumb that repeats the heading", () => {
  assert.doesNotMatch(app, /class="breadcrumbs"/);
  assert.match(app, /const lift = backMatch && \(headingAt < 0 \|\| backMatch\.index < headingAt\);/, "the first back link before the page heading, even inside a page wrapper");
  assert.match(app, /\$\{appNavButtons\(\)\}\$\{topbarBack\}/);
  // แดชบอร์ดบอกชื่อรายการที่จะกลับไป
  assert.match(read("modules/module-mt-dashboard.js"), />‹ ใบคำร้อง\/แจ้งซ่อม MT<\/a>/);
  assert.match(read("modules/module-ncr-dashboard.js"), /<a class="request-back-link" href="#\/ncr">‹ NCR\/CAR<\/a>/);
});

test("round 15: the shell moves a leading back link into the topbar and leaves other pages without a page-name repeat", () => {
  const source = app.match(/function shell\(content, active, title, tabTitle = title\) \{[^]*?\r?\n\}\r?\n/)[0];
  const context = vm.createContext({
    state: { employee: { first_name: "ก", last_name: "ข", role: { code: "staff" } }, unread: 0 }, document: {},
    activeNavFor: (value) => value, isSandboxMode: () => false, isLabOnly: () => false, navLink: () => "", requestModuleNavLinks: () => "",
    homePath: () => "dashboard", NAV_ICONS: {}, window: { MNP_REQUEST_CENTER: { overviewUrl: () => "#/requests" } }, escapeHtml: (value) => String(value),
    initials: () => "กข", uiIcon: () => "", appNavButtons: () => "", helpButton: () => "", themeButton: () => "", sandboxBannerHtml: () => "",
  });
  vm.runInContext(source, context);
  const detail = context.shell('\n    <a class="request-back-link" href="#/ncr">‹ NCR/CAR</a><h1>เรื่อง</h1>', "ncr", "NCR");
  const wrapped = context.shell('<div class="nd"><a class="request-back-link" href="#/ncr">‹ NCR/CAR</a><div class="page-heading"><h1>แดชบอร์ด</h1><a class="request-back-link" href="#/x">‹ อื่น</a></div></div>', "ncr", "NCR");
  assert.match(wrapped, /<div class="topbar-start">\s*<a class="request-back-link" href="#\/ncr">/);
  assert.match(wrapped, /<h1>แดชบอร์ด<\/h1><a class="request-back-link" href="#\/x">/, "a link after the heading stays where it is");
  assert.match(detail, /<div class="topbar-start">\s*<a class="request-back-link" href="#\/ncr">‹ NCR\/CAR<\/a>\s*<\/div>/);
  assert.equal(detail.match(/request-back-link/g).length, 1, "moved, not copied");
  const profile = context.shell("<h1>ข้อมูลส่วนตัว</h1>", "profile", "ข้อมูลส่วนตัว");
  assert.equal(profile.match(/ข้อมูลส่วนตัว/g).length, 1, "the page name is said by the heading only");
});

test("round 15: NCR history rows are headed by the resulting status like MT/MG, the action is the detail line", () => {
  const ncr = read("modules/module-ncr.js");
  assert.match(ncr, /const heading = statusChanged \? STATUS_LABELS\[item\.to_status\] \?\? item\.to_status : actionLabel;/);
  assert.match(ncr, /const detail = statusChanged && !actionLabel\.startsWith\(heading\) \? `\$\{actionLabel\} · \$\{personName\(directory, item\.changed_by\)\}` : personName\(directory, item\.changed_by\);/);
  assert.match(ncr, /signoff_gm: "ผู้จัดการทั่วไปลงนาม"/, "the heading already says ปิดแล้ว");
});

test("round 15: picked files show an unsent state and a leave warning; closed requests still take files, labelled as added after closing", () => {
  assert.match(app, /<p class="attachment-pending" role="status" hidden><\/p><\/form>/);
  // ปุ่มย้อนกลับของเบราว์เซอร์บางตัวถามไม่ได้ ข้อความจึงบอกให้อัปโหลดก่อนออกเอง
  assert.match(app, /pending\.textContent = count \? `ยังไม่ได้อัปโหลด \$\{count\} ไฟล์ · กดอัปโหลดก่อนออกจากหน้านี้` : "";/);
  assert.match(app, /button\.classList\.toggle\("secondary", !count\);/, "upload becomes the primary button while files wait");
  assert.match(app, /confirmLabel: "ออกโดยไม่อัปโหลด", cancelLabel: "อยู่ต่อเพื่ออัปโหลด"/);
  assert.match(app, /window\.addEventListener\("beforeunload", \(event\) => \{\r?\n  if \(!pendingAttachmentCount\(\)\) return;/);
  // รอบรวม 19: ยังไม่มีไฟล์ไม่พูดว่า "เพิ่ม"
  assert.match(app, /\$\{requestClosed \? \(attachments\.length \? "แนบไฟล์เพิ่มหลังปิดใบ" : "แนบไฟล์หลังปิดใบ"\) : attachments\.length \? "แนบไฟล์เพิ่ม" : "แนบไฟล์"\}/);
  // ไม่ถามระหว่างกำลังอัปโหลด · ปุ่ม/ท่าทางย้อนกลับถามด้วย (Navigation API) แล้วย้อนกลับต่อเมื่อยืนยัน
  assert.match(app, /if \(!form \|\| form\.hasAttribute\("aria-busy"\)\) return 0;/);
  assert.match(app, /window\.navigation\?\.addEventListener\("navigate", \(event\) => \{\r?\n  if \(event\.navigationType !== "traverse" \|\| !event\.cancelable\) return;/);
  assert.match(app, /window\.navigation\.traverseTo\(key\);/);
  // แถวยกเลิก: หัว "ยกเลิก" บรรทัดรองไม่พูด "ยกเลิก NCR" ซ้ำ
  assert.match(read("modules/module-ncr.js"), /const detail = statusChanged && !actionLabel\.startsWith\(heading\) \?/);
  assert.match(app, /const requestClosed = \["completed", "rejected", "cancelled", "acknowledged"\]\.includes\(request\.status\) \|\| isFinalDecision\(type, request\.status\);/);
  // ตัวเลือกช่างเป็นกลุ่มที่มีชื่อ
  assert.match(read("modules/module-mt.js"), /<fieldset class="field" data-field="technician_ids"><legend>ช่างผู้รับผิดชอบ/);
});

test("round 16: editing an assignment does not force dates, and the page has one place to attach files and one to move the due date", () => {
  assert.match(mt, /const reassign = request\.status !== "pending_assign";/);
  assert.match(mt, /const dueCardShown = canRecordProgress && \["assigned", "in_progress"\]\.includes\(request\.status\);/);
  assert.match(mt, /วันเริ่มงาน\$\{reassign \? " \(ถ้ามี\)" : REQUIRED\}/);
  assert.match(mt, /\$\{dueCardShown \? "" : `<div class="field" data-field="work_expected_date">/, "the due-date card is the one place to move the due date");
  assert.match(mt, /\$\{reassign \? "" : extraFilesFieldHtml\("assign-files"\)\}/);
  assert.doesNotMatch(mt, /extraFilesFieldHtml\("expected-date-files"\)/, "files go on the attachments card");
  // ขั้นรอมอบหมาย: ไฟล์ส่งพร้อมการมอบหมายทางเดียว การ์ดไฟล์แนบชี้ไปที่ฟอร์มนั้น (แบบเดียวกับฟอร์มจบงานและการ์ดตรวจรับ)
  assert.match(app, /\?\? document\.querySelector\("#assign-files"\);/);
  assert.match(app, /"assign-files": "แนบไฟล์ในฟอร์มมอบหมายช่าง"/);
  assert.match(mt, /const rules = form\.hasAttribute\("data-reassign"\)\r?\n\s+\? ASSIGN_RULES\.map\(\(rule\) => \(\["work_started_date", "work_expected_date"\]\.includes\(rule\.name\) \? \{ \.\.\.rule, required: false \} : rule\)\)/);
  // ฐานข้อมูลบังคับวันเริ่มงานเฉพาะการมอบหมายครั้งแรก (ค่าว่างตอนแก้คงวันเดิม)
  const sql = readFileSync(new URL("../../supabase/migrations/20260930010000_assistant_department_manager_acts_as_manager.sql", import.meta.url), "utf8");
  assert.match(sql, /v_start {5}:= coalesce\(p_work_started_date, v_request\.work_started_date\);/);
  assert.match(sql, /if v_first_assign then[^]*?if v_start is null then raise exception 'WORK_START_DATE_REQUIRED'; end if;/);
});

test("round 16: the board tab stays for everyone (it searches machines and reporters), and its tab title names the module", () => {
  // คนที่เห็นทุกใบก็ยังต้องการกระดาน: ค้นด้วยเครื่องจักร ผู้แจ้ง แผนก และมีคอลัมน์ที่รายการไม่มี (auditor รอบ 16)
  assert.doesNotMatch(app, /seesWholeModule/);
  assert.match(app, /requestsViewTabs\(params, \{ board: selected\.code !== "NCR_CAR" \}\)/);
  assert.match(app, /\$\{withBoard \|\| board \? tab\(board/, "an open board keeps its own tab");
  // วันเริ่มงานต้องไม่หลังกำหนดเสร็จที่แก้ที่การ์ด: บอกก่อนส่ง และบอกว่าแก้กำหนดเสร็จที่ไหน
  assert.match(mt, /data-expected="\$\{escapeHtml\(request\.work_expected_date\)\}"/);
  assert.match(mt, /if \(!errors\.length && form\.dataset\.expected && startDate && startDate > form\.dataset\.expected\) \{/);
  assert.match(mt, /เลื่อนกำหนดเสร็จที่การ์ดกำหนดเสร็จก่อน/);
  assert.match(mt, /title="เว้นว่างไว้ ระบบคงวันเริ่มงานเดิม"/);
  // กระดานบอกชื่อโมดูลในชื่อแท็บ · RubberFlow แถบเครื่องมือขยายเต็มแถบหัว
  assert.match(app, /shell\(content, "requests", "คำร้อง", selected \? `ติดตามสถานะ · \$\{requestTypeLabel\(selected\)\}` : "ติดตามสถานะทุกใบ"\)/);
  assert.match(read("styles.css"), /\.rf-page \.rf-head \.rf-toolbar \{ flex: 1 1 auto;/);
});
test("round 18: one due-date term, inline errors on the date and reply forms, and small consistency fixes", () => {
  const mt = read("modules/module-mt.js");
  // "กำหนดเสร็จ" คำเดียวบนหน้าจอ MT (ประวัติและการแจ้งเตือนในฐานข้อมูลใช้คำนี้อยู่แล้ว)
  assert.doesNotMatch(mt, /"[^"]*วันที่คาดว่าจะเสร็จ[^"]*"|>[^<]*วันที่คาดว่าจะเสร็จ[^<]*</);
  assert.doesNotMatch(app, /: "[^"]*วันที่คาดว่าจะเสร็จ/, "error messages too");
  assert.match(mt, /id="expected-date-toggle" aria-expanded="false" aria-controls="expected-date-form">แก้กำหนดเสร็จ<\/button>/);
  assert.match(mt, /id="expected-date-cancel">ยกเลิก<\/button>/);
  // ข้อผิดพลาดใต้ช่อง แทน toast
  assert.doesNotMatch(mt, /showToast\("กรุณาระบุวันที่คาดว่า/);
  assert.match(mt, /showRepairFieldErrors\(form, \[\{ name: "expected_date", message: "เลือกกำหนดเสร็จใหม่" \}\]\)/);
  assert.equal(mt.match(/showRepairFieldErrors\(form, \[\{ name: "expected_on",/g).length, 2);
  assert.match(app, /window\.MNP_FORM_STEPS\.showFieldErrors\(form, \[\{ name: "message", message: "พิมพ์ข้อความตอบกลับ" \}\]\);/);
  // การ์ดตอบกลับอย่างเดียว: หัวย่อยไม่พูด "ตอบกลับความเห็น" ซ้ำกับหัวการ์ด
  assert.match(app, /stepReplyFormHtml\(step, directory, \{ optional: Boolean\(moduleWorkHtml\), short: !moduleWorkHtml \}\)/);
  // ลิงก์ภายในไม่มีลูกศรลิงก์ภายนอก · คิวเว้นที่ช่องติ๊กให้ทุกแถว · อะไหล่บนจอคอมเป็นการ์ดสามแถว
  assert.doesNotMatch(read("modules/module-bom.js"), /RubberFlow ↗/);
  const css = read("styles.css");
  assert.match(css, /:is\(ul, ol\):has\(> \.queue-item > \.queue-item-check\) > \.queue-item > \.queue-item-main:first-child \{ padding-left: 44px; \}/);
  assert.match(css, /@container \(min-width: 520px\) and \(max-width: 760px\) \{\r?\n\s+\.parts-table tr\.parts-row \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
  // ฟอร์มขอแก้รหัสบอกตรงตาม RPC และคำช่วยเหลือบอกตำแหน่งประวัติถูกทั้งจอคอมและมือถือ
  assert.match(app, /ทุกคำขอต้องตั้งรหัสผ่านใหม่<\/small>/);
  // auditor: ฟอร์มที่บอกข้อผิดใต้ช่องต้อง novalidate (ไม่งั้น bubble ของเบราว์เซอร์ดักก่อน) และ id ไม่ซ้ำต่อฟอร์ม
  assert.match(mt, /<form class="progress-order-form" id="progress-order-\$\{escapeHtml\(step\.id\)\}" data-step="\$\{escapeHtml\(step\.id\)\}" novalidate>/);
  assert.match(mt, /<form class="progress-reschedule-form hidden" id="progress-reschedule-\$\{escapeHtml\(step\.id\)\}" data-step="\$\{escapeHtml\(step\.id\)\}" novalidate>/);
  assert.match(app, /<form class="step-reply-form" id="step-reply-form-\$\{escapeHtml\(step\.id\)\}" data-step-id="\$\{escapeHtml\(step\.id\)\}" novalidate>/);
  assert.match(app, /form\.elements\.message\?\.addEventListener\("input", \(\) => window\.MNP_FORM_STEPS\.clearFieldError\(form, "message"\)\)/);
  // กฎมือถือของชิปงานชนะกฎหลัก (เจาะจงกว่า) · แดชบอร์ดไม่มีคำเดิม
  assert.match(css, /@media \(max-width: 760px\) \{ \.queue-item-top \.queue-item-due \{ margin-left: 0; \} \}/);
  assert.doesNotMatch(read("modules/module-mt-dashboard.js"), /วันที่คาดว่าจะเสร็จ/);
  assert.match(read("modules/shortcut-help.js"), /"ประวัติเอกสาร \(ใครทำอะไรเมื่อไร\) อยู่คอลัมน์ขวา บนมือถืออยู่ท้ายหน้า"/);
});
test("batch 19: one search across list fields, NCR responders read the problem in the action card, one overdue verb, and phone layout fixes", () => {
  // รายการของโมดูลค้นเลขที่ ชื่อเรื่อง เครื่องจักร และผู้แจ้ง (กรองบนเครื่องแบบเดียวกับทะเบียน NCR)
  assert.doesNotMatch(app, /query\.ilike\("request_no"/);
  assert.match(app, /const matchesSearch = \(row\) => !needle \|\| \[row\.request_no, row\.title, row\.machine_code, row\.machine_name, row\.requester_name, personName\(directory, row\.requester_id\)\]/);
  assert.match(app, /placeholder: isRepairType\(selected\) \? "ค้นหาเลขที่ใบ ชื่อเรื่อง เครื่องจักร หรือผู้แจ้ง" : "ค้นหาเลขที่ใบ ชื่อเรื่อง หรือผู้แจ้ง"/);
  // NCR: ผู้ตอบ/ผู้พิจารณาอ่านรายละเอียดที่พบในการ์ดงาน ส่วนที่ 1 ไม่บอกซ้ำ · กำหนดตอบอยู่ใต้หัวฟอร์ม
  const ncr = read("modules/module-ncr.js");
  // ทุกงานในการ์ด (ตอบ พิจารณา ระบุผู้ตอบ ความสูญเสีย) เปิดด้วยรายละเอียดที่พบ
  assert.match(ncr, /const briefInAction = Boolean\(String\(ncr\.description \?\? ""\)\.trim\(\)\) && work\.length > 0;/);
  // รายการ MT บอกใบที่เลยกำหนดเสร็จ (ใบในมือช่างเท่านั้น)
  // รอบ 21: ป้ายเดียวกันเป็นฟังก์ชันเดียว ใช้ทั้งรายการของโมดูลและกระดานสถานะ (กระดานได้ work_expected_date จาก migration)
  const overdue = (() => { const start = app.indexOf("function overdueFinishBadge("); return app.slice(start, app.indexOf("\n}", start) + 2); })();
  assert.match(overdue, /if \(!\["assigned", "in_progress"\]\.includes\(request\.status\) \|\| !request\.work_expected_date \|\| request\.work_expected_date >= bangkokToday\(\)\) return "";/);
  assert.match(overdue, /<span class="badge urgent-flag" title="กำหนดเสร็จ \$\{escapeHtml\(formatDate\(request\.work_expected_date\)\)\}">เลยกำหนดเสร็จ<\/span>/);
  assert.equal((app.match(/\$\{overdueFinishBadge\((request|row)\)\}/g) ?? []).length, 2, "the module list and the status board");
  assert.match(app, /isFinalDecision\(\{ code: row\.type_code \}, row\.status\)\)\}\$\{overdueFinishBadge\(row\)\}/);
  assert.match(read("supabase/migrations/20261118010000_request_status_board_expected_date.sql"), /can_open boolean,\r?\n\s+work_expected_date date\r?\n\)/);
  // รอบ 21: ยกเลิกรายการความสูญเสียรับเหตุผล 3–500 ตัวอักษรตามฐานข้อมูล (ข้อความ INVALID_REASON "5" เป็นของยกเลิกทั้งใบ)
  assert.match(ncr, /const VOID_REASON_MIN = 3;\r?\n\s+const VOID_REASON_MAX = 500;/);
  assert.match(ncr, /if \(reason\.trim\(\)\.length < VOID_REASON_MIN \|\| reason\.trim\(\)\.length > VOID_REASON_MAX\) \{\r?\n\s+showToast\(`เหตุผลที่ยกเลิกรายการต้องมี \$\{VOID_REASON_MIN\}–\$\{VOID_REASON_MAX\} ตัวอักษร`, "error"\);\r?\n\s+return;/);
  assert.match(app, /needed_date,work_expected_date,machine_code/);
  assert.match(ncr, /\$\{briefInAction \? "" : partField\("รายละเอียด \(ปัญหา สเปค และค่าที่วัดได้จริง\)"/);
  assert.match(ncr, /<h3>ส่วนที่ 3 — ตอบ NCR<\/h3>\r?\n\s+\$\{responseDueNote\(ncr\)\}/);
  // "เลยกำหนด" คำเดียว
  for (const source of [ncr, app, read("modules/module-ncr-dashboard.js"), read("modules/shortcut-help.js")]) assert.doesNotMatch(source, /"[^"]*เกินกำหนด|>[^<]*เกินกำหนด/);
  // ข้อผิดของตัวเลือกไม่ซ้ำข้อความตัวเลือก · กลุ่มช่างขอบแดง · แถวอะไหล่แถวเดียวไม่มีปุ่มลบ · ปุ่มปิดช่วยเหลืออยู่ในจอ
  assert.match(mt, /message: "ยังไม่ได้เลือกการดำเนินงาน" \}/);
  assert.match(css, /\[data-field="technician_ids"\]:has\(> \.field-error\) \.tech-picker \{/);
  assert.match(css, /#finish-parts-rows:not\(:has\(\.parts-row ~ \.parts-row\)\) \.parts-row-remove \{ display: none; \}/);
  assert.match(css, /\.shortcut-dialog \.confirm-dialog-actions \{ position: sticky; bottom: 0;/);
  // ปุ่มส่งของฟอร์มงานติดขอบล่างบนจอคอม · แถบกราฟบนมือถือเต็มความกว้าง
  assert.match(css, /@media \(min-width: 761px\) \{\r?\n\s+\.detail-actions \.form-actions \{ position: sticky; bottom: 0;/);
  assert.match(css, /\.nd-brow \.nd-trk \{ grid-column: 1 \/ -1; grid-row: 2; \}/);
  // ชื่อช่องโปรไฟล์บอกว่าแสดงที่ไหน · "อื่น ๆ" · โหมดทดสอบไม่มีปุ่มล้าง NCR บน RubberFlow/BOM · ปุ่มใน BOM บอกปลายทาง
  assert.match(app, /ตำแหน่งที่แสดงใต้ชื่อ \(ถ้ามี\)<\/label>/);
  assert.doesNotMatch(ncr, /อื่นๆ/);
  assert.match(app, /const showPurge = !\["rubberflow", "bom"\]\.includes\(currentRoute\(\)\.path\);/);
  assert.match(read("modules/module-bom.js"), />ใบสั่งผลิต \(RubberFlow\)<\/a>/);
});
