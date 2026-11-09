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
  assert.match(app, /<p class="request-detail-meta">\$\{escapeHtml\(detailView\?\.typeLabel \?\? type\?\.name_th \?\? "คำร้อง"\)\} · โดย/);
  assert.match(mt, /typeLabel: docTypeLabels\[request\.doc_type\] \?\? null,/);
  assert.doesNotMatch(mt, /requestFact\("ประเภทเอกสาร"/);
  assert.match(mt, /const showRequester = requesterName && requesterName !== personName\(directory, request\.requester_id\);/);
  assert.match(mt, /\.\.\.\(showRequester \? \[requestFact\("ผู้แจ้ง", requesterName,/);
});

test("the top bar names the module where the page heading already shows the number", () => {
  assert.match(app, /shell\(content, "requests", type \? requestTypeLabel\(type\) : "คำร้อง", request\.request_no\)/);
  assert.match(read("modules/module-ncr.js"), /shell\(content, "ncr", "ทะเบียน NCR", ncr\.ncr_no\)/);
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
test("an MT row does not repeat the machine name on its second line", () => {
  const context = vm.createContext({});
  vm.runInContext(`${pick(app, "titleWithoutMachine")}\nthis.strip = titleWithoutMachine;`, context);
  const { strip } = context;
  assert.equal(strip("เครื่องอัดยาง NCM-03 — มอเตอร์ร้อน", "เครื่องอัดยาง NCM-03", "NCM-03"), "มอเตอร์ร้อน");
  assert.equal(strip("เครื่องอัดยาง NCM-03", "เครื่องอัดยาง NCM-03", "NCM-03"), "", "nothing but the machine: no second line");
  assert.equal(strip("แจ้งซ่อมปั๊มลม", "เครื่องอัดยาง NCM-03", "NCM-03"), "แจ้งซ่อมปั๊มลม", "a title without the machine is kept");
  assert.match(app, /const detail = machine \? titleWithoutMachine\(request\.title, request\.machine_name, request\.machine_code\) : description;/);
});

test("the module header does not count what the table below already lists, and the chooser says 'เลือกโมดูล' once", () => {
  assert.doesNotMatch(app, /ยังไม่จบ \$\{counts\.get\(selected\.id\)/);
  assert.doesNotMatch(app, /<h2>เลือกโมดูล<\/h2>/);
  assert.doesNotMatch(app, /เลือกโมดูลเพื่อแสดงรายการคำร้อง/);
});

test("the next-item panel states the remaining count once, and the profile and login use the Thai label for the employee number", () => {
  assert.match(app, /รอคุณพิจารณาอีก \$\{pending\.length\} ใบ/);
  assert.doesNotMatch(app, /รายการถัดไป \(\$\{pending\.length\}\)/);
  assert.doesNotMatch(app, /UserID/);
  assert.doesNotMatch(app, /<h2>\$\{escapeHtml\(employee\.first_name\)\} \$\{escapeHtml\(employee\.last_name\)\}<\/h2><span class="badge">/, "the profile card does not repeat the name and role the form shows");
});
