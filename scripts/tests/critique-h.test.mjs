// ผล critique H (27/40): ร่างไม่หายเมื่อแถบร่างค้างยังไม่ถูกตอบ, คีย์ลัดบนคีย์บอร์ดภาษาไทย และข้อมูลซ้ำที่เหลือ
// (คำกริยาของขั้นบนปุ่มมติไม่ทำ: ผู้ใช้ให้คง logic เดิม — ผู้จัดการทั่วไปอนุมัติแล้วหัวหน้าซ่อมบำรุงมอบหมายช่างทันที)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

await import("../../modules/form-draft.js");
const draftApi = globalThis.MNP_FORM_DRAFT;
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const app = read("app.js");
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

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
  let edited = 0, used = 0, discarded = 0, filled = false;
  draftApi.offerDraft({ banner, message: "มีร่างค้าง", onUse: () => { used += 1; }, onDiscard: () => { discarded += 1; }, form, onEdit: () => { edited += 1; }, hasInput: () => filled });
  assert.equal(banner.hidden, false);
  fire("input", { isTrusted: false, target: {} });
  assert.equal(edited, 0, "events fired by code do not count as the user's choice");
  fire("input", { isTrusted: true, target: { inBanner: true } });
  assert.equal(edited, 0, "clicks inside the banner are its own buttons");
  fire("input", { isTrusted: true, target: {} });
  assert.equal(edited, 0, "an edit that leaves nothing to save (a space, typed then deleted) keeps the old draft and the banner");
  assert.equal(banner.hidden, false);
  filled = true;
  fire("input", { isTrusted: true, target: {} });
  assert.equal(edited, 1);
  assert.equal(banner.hidden, true, "the banner closes");
  assert.equal(listeners.form.length, 0, "it listens only until the first real edit");
  fire("change", { isTrusted: true, target: {} });
  assert.equal(edited, 1);
  assert.equal(used + discarded, 0);
  // ทุกฟอร์มที่มีแถบร่างส่ง form + onEdit + hasInput และเริ่มบันทึกร่างทันที
  for (const file of ["app.js", "modules/module-mt.js", "modules/module-ncr.js"]) {
    const source = read(file);
    assert.match(source, /onEdit: \(\) => \{ draftPending = false; autosave\.start\(\); autosave\.schedule\(\); \},\s*hasInput: \(\) =>/, file);
  }
});

test("without a form the banner behaves as before", () => {
  const { banner, listeners } = fakeBannerAndForm();
  draftApi.offerDraft({ banner, message: "มีร่างค้าง", onUse() {}, onDiscard() {} });
  assert.equal(listeners.form.length, 0);
  assert.equal(listeners.banner.length, 1);
});

test("the decision panel keeps the original wording and flow", () => {
  assert.doesNotMatch(app, /stepVerbOf|ไม่รับงาน|ใบนี้ต่อด้วย/);
  assert.match(app, /\{ decision: "approved", label: "อนุมัติ", tone: "success" \}/);
});

test("shortcuts fall back to the physical key only when the layout types a non-Latin letter", () => {
  const start = app.indexOf("const key = /^[a-z]$/i.test(event.key)");
  assert.ok(start >= 0, "j/k/a/r reads event.key first");
  const keyOf = new Function("event", `${app.slice(start, app.indexOf(";", start) + 1)} return key;`);
  assert.equal(keyOf({ key: "j", code: "KeyJ" }), "j");
  assert.equal(keyOf({ key: "่", code: "KeyJ" }), "j", "Thai layout on the J key");
  assert.equal(keyOf({ key: "ฟ", code: "KeyA" }), "a");
  assert.equal(keyOf({ key: "q", code: "KeyA" }), "q", "AZERTY q on the A position stays q");
  assert.equal(keyOf({ key: "h", code: "KeyJ" }), "h", "Dvorak h on the J position stays h");
  assert.match(app, /const slash = event\.key === "\/" \|\| \(event\.code === "Slash" && !event\.shiftKey && !\/\^\[\\x20-\\x7e\]\$\/\.test\(event\.key\)\);/);
});

test("remaining repeats are gone", () => {
  // ตัวเลือกสถานะตามขั้นตอนเฉพาะหน้าของโมดูลเดียว กระดานทุกโมดูลแสดงทุกสถานะ
  assert.match(app, /const offWorkflow = !module \? \[\] : repair \? \["acknowledged"\] : \["pending_assign", "assigned", "pending_verify"\];/);
  assert.match(app, /repair: isRepairType\(selected\), module: Boolean\(selected\) \}\)/);
  // หัวโมดูลไม่ขึ้นตัวย่อซ้ำเมื่อชื่อมีตัวย่ออยู่แล้ว
  assert.match(app, /typeCardMarkHtml\(selected, \{ prefix: !selected\.prefix \|\| !requestTypeLabel\(selected\)\.includes\(selected\.prefix\) \}\)/);
  // ทะเบียน NCR ในหน้าคำร้องไม่ซ้อนหัวอีกชั้น
  assert.match(read("modules/module-ncr.js"), /\$\{embedded \? "" : `<div class="page-heading"><div><div class="eyebrow">QA02-FM02<\/div>/);
  // ไม่มีแถบสีข้างในกล่องความเห็น และลิงก์ย้อนกลับเป็นตัวรอง
  assert.doesNotMatch(css, /\.timeline-item \.timeline-item-message \{[^}]*border-left/);
  assert.doesNotMatch(css, /\.step-reply \{[^}]*border-left/);
  assert.match(css, /\.request-back-link \{[^}]*color: var\(--primary-ink\); background: var\(--paper\);/);
});
