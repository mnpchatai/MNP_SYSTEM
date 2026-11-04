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
  assert.match(filters, /data-list-filters-toggle>\$\{uiIcon\("search"\)\} ตัวกรอง\$\{active \? ` \(\$\{active\}\)` : ""\}<\/button>/);
  assert.match(filters, /aria-expanded="\$\{open\}" aria-controls="list-filters-body"/);
  assert.match(app, /listFiltersOpen = toggle\.getAttribute\("aria-expanded"\) !== "true";/, "the toggle flips its own state");
  assert.match(css, /\.list-filters-body \{ display: contents; \}/, "wide screens keep the old single row");
  assert.match(css, /\.list-filters-toggle \{ display: none; \}/);
  assert.match(css, /\.list-filters:not\(\.is-open\) \.list-filters-body \{ display: none; \}/);
});
