// ผล critique H (27/40): คำกริยาของขั้นบนปุ่มมติ, ร่างไม่หายเมื่อแถบร่างค้างยังไม่ถูกตอบ, งานถัดไปของใบเดิม,
// คีย์ลัดบนคีย์บอร์ดภาษาไทย และข้อมูลซ้ำที่เหลือ
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

await import("../../modules/form-draft.js");
const draftApi = globalThis.MNP_FORM_DRAFT;
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const app = read("app.js");
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

function pick(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} found`);
  return app.slice(start, app.indexOf("\n}", start) + 2);
}

test("a step's own verb names the approve button", () => {
  const context = vm.createContext({});
  vm.runInContext(`${pick("stepVerbOf")}\n${pick("decisionButtonsOf")}\nthis.api = { stepVerbOf, decisionButtonsOf };`, context);
  const { stepVerbOf, decisionButtonsOf } = context.api;
  assert.equal(stepVerbOf("ผู้จัดการแผนกซ่อมบำรุงรับงาน"), "รับงาน");
  assert.equal(stepVerbOf("ผู้จัดการแผนกที่รับผิดชอบรับทราบ"), "รับทราบ");
  assert.equal(stepVerbOf("ผู้จัดการทั่วไปปิด NCR"), "ปิด NCR");
  assert.equal(stepVerbOf("ผู้จัดการโรงงานอนุมัติ"), "อนุมัติ");
  assert.equal(stepVerbOf(undefined), "อนุมัติ");
  const labels = (verb) => Object.fromEntries(Array.from(decisionButtonsOf([], verb), (item) => [item.decision, item.label]));
  assert.deepEqual(labels("รับงาน"), { rejected: "ไม่รับงาน", more_info: "ขอข้อมูลเพิ่ม", approved: "รับงาน" });
  assert.deepEqual(labels("รับทราบ"), { rejected: "ไม่อนุมัติ", more_info: "ขอข้อมูลเพิ่ม", approved: "รับทราบ" });
  assert.deepEqual(labels(undefined), { rejected: "ไม่อนุมัติ", more_info: "ขอข้อมูลเพิ่ม", approved: "อนุมัติ" }, "default stays อนุมัติ");
  // ทุกจุดที่แสดงมติใช้คำของขั้น (บันทึกในฐานข้อมูลยังเป็น approved)
  assert.match(app, /idleDecisionButtonsHtml\(decisionButtonsOf\(extraDecisions, stepVerbOf\(currentStep\.step_name\)\)\)/);
  assert.match(app, /const options = decisionButtonsOf\(extraDecisions, stepVerbOf\(currentStep\.step_name\)\);/);
  assert.match(app, /recentDecisions\.set\(id, \{ decision, verb: labelOf\(decision\),/);
  assert.match(app, /const verb = receipt\.verb \?\? decisionVerbs\[receipt\.decision\] \?\? "บันทึกผล";/);
  assert.match(app, /afterApproval: isRepair \? myRepairActionLabels\.pending_assign : ""/, "repair requests say what comes next, not 'last step'");
});

function fakeBannerAndForm() {
  const listeners = { banner: [], form: [] };
  const banner = {
    hidden: true,
    innerHTML: "",
    addEventListener: (type, fn) => listeners.banner.push({ type, fn }),
    removeEventListener: (type, fn) => { listeners.banner = listeners.banner.filter((entry) => entry.fn !== fn); },
    contains: (node) => node?.inBanner === true,
  };
  const form = {
    addEventListener: (type, fn) => listeners.form.push({ type, fn }),
    removeEventListener: (type, fn) => { listeners.form = listeners.form.filter((entry) => entry.fn !== fn); },
  };
  const fire = (type, event) => listeners.form.filter((entry) => entry.type === type).forEach((entry) => entry.fn(event));
  return { banner, form, listeners, fire };
}

test("typing while the draft banner is open starts a new draft instead of being lost", () => {
  const { banner, form, listeners, fire } = fakeBannerAndForm();
  let edited = 0, used = 0, discarded = 0;
  draftApi.offerDraft({ banner, message: "มีร่างค้าง", onUse: () => { used += 1; }, onDiscard: () => { discarded += 1; }, form, onEdit: () => { edited += 1; } });
  assert.equal(banner.hidden, false);
  fire("input", { isTrusted: false, target: {} });
  assert.equal(edited, 0, "events fired by code do not count as the user's choice");
  fire("input", { isTrusted: true, target: { inBanner: true } });
  assert.equal(edited, 0, "clicks inside the banner are its own buttons");
  fire("input", { isTrusted: true, target: {} });
  assert.equal(edited, 1);
  assert.equal(banner.hidden, true, "the banner closes");
  assert.equal(listeners.form.length, 0, "it listens only until the first edit");
  fire("change", { isTrusted: true, target: {} });
  assert.equal(edited, 1);
  assert.equal(used + discarded, 0);
  // ทุกฟอร์มที่มีแถบร่างส่ง form + onEdit และเริ่มบันทึกร่างทันที
  for (const file of ["app.js", "modules/module-mt.js", "modules/module-ncr.js"]) {
    assert.match(read(file), /onEdit: \(\) => \{ draftPending = false; autosave\.start\(\); autosave\.schedule\(\); \},/, file);
  }
});

test("without a form the banner behaves as before", () => {
  const { banner, listeners } = fakeBannerAndForm();
  draftApi.offerDraft({ banner, message: "มีร่างค้าง", onUse() {}, onDiscard() {} });
  assert.equal(listeners.form.length, 0);
  assert.equal(listeners.banner.length, 1);
});

test("after a decision the next job on the same request comes first, counted like the home queue", () => {
  const panel = pick("fillNextItemPanel");
  assert.match(panel, /await Promise\.all\(\[getPendingApprovals\(\), getMyRepairActionItems\(\)\]\)/);
  assert.match(panel, /window\.MNP_HOME_QUEUE\.sortQueue\(/);
  assert.match(panel, /sameRequestTask\?\.status === "pending_assign" \? document\.querySelector\("#assign-form"\) : null/);
  assert.match(panel, /`ใบนี้ต่อด้วย: \$\{label\}/);
});

test("shortcuts read the physical key so a Thai keyboard layout still works", () => {
  assert.match(app, /\{ KeyJ: "j", KeyK: "k", KeyA: "a", KeyR: "r" \}\[event\.code\] \?\? event\.key\.toLowerCase\(\)/);
  assert.match(app, /const slash = event\.key === "\/" \|\| \(event\.code === "Slash" && !event\.shiftKey\);/);
});

test("remaining repeats are gone", () => {
  // ตัวเลือกสถานะตามขั้นตอนของโมดูล
  assert.match(app, /const offWorkflow = repair \? \["acknowledged"\] : \["pending_assign", "assigned", "pending_verify"\];/);
  // หัวโมดูลไม่ขึ้นตัวย่อซ้ำเมื่อชื่อมีตัวย่ออยู่แล้ว
  assert.match(app, /typeCardMarkHtml\(selected, \{ prefix: !selected\.prefix \|\| !requestTypeLabel\(selected\)\.includes\(selected\.prefix\) \}\)/);
  // ทะเบียน NCR ในหน้าคำร้องไม่ซ้อนหัวอีกชั้น
  assert.match(read("modules/module-ncr.js"), /\$\{embedded \? "" : `<div class="page-heading"><div><div class="eyebrow">QA02-FM02<\/div>/);
  // ไม่มีแถบสีข้างในกล่องความเห็น และลิงก์ย้อนกลับเป็นตัวรอง
  assert.doesNotMatch(css, /\.timeline-item \.timeline-item-message \{[^}]*border-left/);
  assert.doesNotMatch(css, /\.step-reply \{[^}]*border-left/);
  assert.match(css, /\.request-back-link \{[^}]*color: var\(--primary-ink\); background: var\(--paper\);/);
});
