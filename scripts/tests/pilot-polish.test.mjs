// ขั้น polish ของ Pilot Web หลัง critique F: รายละเอียดที่ผู้ใช้เห็นทุกวัน (มือถือ ถุงมือ แสงจ้า)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const app = read("app.js");
const mt = read("modules/module-mt.js");
const ncr = read("modules/module-ncr.js");
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(selector) {
  const found = new Map();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").map((part) => part.trim().replace(/\s+/g, " ")).includes(selector)) continue;
    for (const line of body.split(";")) {
      const [name, value] = line.split(/:(.*)/s).map((part) => part?.trim());
      if (name && value) found.set(name, value);
    }
  }
  return found;
}

test("the selected department shows a check mark, not only a thin ring", () => {
  assert.match(mt, /<span class="repair-department-check">\$\{uiIcon\("check"\)\}<\/span><strong>/);
  assert.equal(declarations(".repair-department-card .repair-department-check").get("display"), "none");
  assert.equal(declarations(".repair-department-card.active .repair-department-check").get("display"), "grid");
});

test("photo buttons carry the camera icon", () => {
  assert.doesNotMatch(`${app}\n${mt}`, /uiIcon\("download"\)\} ถ่ายรูป/);
  assert.equal((`${app}\n${mt}`.match(/uiIcon\("camera"\)\} ถ่ายรูป \/ เลือกไฟล์/g) ?? []).length, 5, "the old generic create form uses the shared picker too; the MT finish form has one file field");
});

test("urgency is said once on the MT detail page", () => {
  // "ด่วน" แบบเดียว: ป้าย urgent-flag ในบรรทัดหัวใบ ทั้งความสำคัญสูง/เร่งด่วนและใบที่ติ๊กแจ้งด่วน ไม่มีการ์ด "ความเร่งด่วน" ซ้ำ
  assert.match(app, /const priorityIsFlagged = \["high", "urgent"\]\.includes\(request\.priority\) \|\| Boolean\(request\.is_urgent\);/);
  assert.doesNotMatch(mt, /requestFact\("ความเร่งด่วน"/, "urgency is the header badge, not a second fact card with a flag icon");
  // "ปกติ" ไม่ใช่ข้อมูล: ความสำคัญทั่วไปไม่แสดง "ปกติ"
  assert.match(app, /priorityIsFlagged \|\| !request\.priority \|\| request\.priority === "normal" \? "" : requestFact\("ความสำคัญ"/);
  // กำหนดเสร็จมีการ์ดของตัวเองตอนรอเริ่มงาน/กำลังซ่อม จึงไม่มีช่องข้อมูลซ้ำ
  assert.match(mt, /request\.work_expected_date && !\(canRecordProgress && \["assigned", "in_progress"\]\.includes\(request\.status\)\) \? \[requestFact\("กำหนดเสร็จ"/);
});

test("waiting badges are amber with the clock, one name per role and field, back links name their destination", () => {
  assert.match(css, /\.badge\.pending_verify, \.badge\.assigned \{ color: #fff; background: var\(--warning-strong\); \}/);
  assert.match(css, /\.badge\.loss-pending-flag \{ color: #fff; background: var\(--primary-strong\); \}/, "the NCR loss-data badge keeps its blue (user request)");
  assert.match(css, /\.badge:is\(\.pending_approval, \.pending_assign, \.pending_verify, \.assigned, \.loss-pending-flag\) \{ --badge-glyph:/);
  assert.doesNotMatch(css, /\.badge\.in_progress, \.badge\.assigned \{|\.badge:is\(\.approved, \.in_progress, \.assigned\)/, "รอช่างเริ่มงาน is not blue any more");
  const ncr = readFileSync(new URL("../../modules/module-ncr.js", import.meta.url), "utf8");
  assert.doesNotMatch(ncr, /ผู้จัดการฝ่ายโรงงาน/);
  assert.doesNotMatch(mt, /requestFact\("แนวทางการซ่อม"/);
  assert.match(mt, /requestFact\("ความคิดเห็นของช่างผู้ตรวจสอบ"/);
  for (const text of ["‹ ย้อนกลับ<", "‹ กลับรายการคำร้อง", "‹ กลับหน้า MT", "‹ กลับหน้า NCR"]) assert.ok(!app.includes(text) && !readFileSync(new URL("../../modules/module-mt-dashboard.js", import.meta.url), "utf8").includes(text) && !readFileSync(new URL("../../modules/module-ncr-dashboard.js", import.meta.url), "utf8").includes(text), text);
  // รอบ 11: ตัวเลือกของหัวใบอยู่ในเมนู ⋯ เสมอ (critique รอบ 10: ปุ่มดาวน์โหลดตัวใหญ่ข้างป้ายสถานะบนมือถือ)
  assert.doesNotMatch(app, /if \(\(actionsHtml\.match\(\/<\(a\|button\)\\b\/g\) \?\? \[\]\)\.length === 1\) return/, "header actions always live in the ⋯ menu");
  assert.match(app, /window\.addEventListener\("hashchange", closeOnNavigate, \{ once: true \}\);/, "the help sheet closes on back/forward");
});

test("the request number in the detail header never breaks mid-number", () => {
  assert.equal(declarations(".request-detail-kicker .eyebrow").get("white-space"), "nowrap");
  assert.equal(declarations(".request-detail-kicker").get("flex-wrap"), "wrap", "the long status badge moves to its own line instead");
});

test("the create flow has no step label that contradicts the form's own step count", () => {
  assert.doesNotMatch(app, /ขั้นตอนที่ 1 · สร้างคำร้อง|สร้างคำร้อง · กรอกรายละเอียด/);
});

test("the review step leaves out fields that were not filled instead of showing a dash", () => {
  assert.match(app, /const row = \(label, value, wide = false\) => \(value \? `<div class="definition/);
  assert.match(ncr, /const row = \(label, content, full = false\) => \(content \? definition\(label, escapeHtml\(content\), full\) : ""\);/);
});

test("send-now during the undo window wears the colour of the decision being sent", () => {
  assert.match(app, /if \(decision === "rejected"\) return "danger-solid is-primary";/);
  assert.match(app, /return tone === "secondary" \? "is-primary" : `\$\{tone\} is-primary`;/, "a grey extra decision still gets a primary send button, unlike undo");
  assert.match(app, /button\("ส่งเลย", decisionButtonClass\(state\.decision\), "send-now"\)/);
  assert.doesNotMatch(app, /button\("ส่งเลย", "is-primary"/);
});

test("copy-to-department checkboxes are glove-sized and show when chosen", () => {
  assert.equal(declarations(".cc-department-option").get("min-height"), "44px");
  assert.equal(declarations(".cc-department-option input").get("width"), "22px");
  assert.ok(declarations(".cc-department-option:has(input:checked)").get("background"), "a checked department is tinted");
});

test("mark-all-read names the action in both clients", () => {
  assert.match(app, /id="mark-read">ทำเครื่องหมายว่าอ่านแล้วทั้งหมด<\/button>/);
  assert.match(read("src/app/(app)/notifications/page.tsx"), /className="page-heading notifications-heading"[\s\S]*ทำเครื่องหมายว่าอ่านแล้วทั้งหมด<\/button>/);
  assert.match(read("src/app/globals.css"), /\.notifications-heading \{ flex-wrap: wrap; \}/, "the Next.js page lets the long button drop below the heading too");
  assert.doesNotMatch(app, /อ่านทั้งหมดแล้ว/);
});
