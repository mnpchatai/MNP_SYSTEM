import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const range = require("../../modules/lab-range.js");

// คณิตของช่วงทดสอบละเอียดผ่านตัวห่อของ Mooney ที่ lab-mooney-views.test.mjs (min = 12) ที่นี่ทดสอบ min ที่ส่งเข้ามาเองและส่วนที่ใช้ร่วมกับ MDR
test("range math takes its own minimum width", () => {
  assert.deepEqual(range.normalize({ start: 5, end: 6 }, 20, 3), { start: 5, end: 8 });
  assert.deepEqual(range.normalize({ start: 5, end: 6 }, 20, 12), { start: 5, end: 17 });
  assert.deepEqual(range.zoom({ start: 0, end: 20 }, 20, 2, 1, 3), { start: 10, end: 20 }, "zooming in at the newest edge keeps the newest day");
  assert.deepEqual(range.zoom({ start: 17, end: 20 }, 20, 2, 1, 3), { start: 17, end: 20 }, "not narrower than the minimum");
  assert.deepEqual(range.pan({ start: 10, end: 20 }, 20, range.panStep({ start: 10, end: 20 }, -0.5), 3), { start: 5, end: 15 });
  assert.equal(range.panStep({ start: 0, end: 1 }, 0.5), 1, "always moves at least one");
  assert.deepEqual(range.limits({ start: 0, end: 3 }, 20, 3), { back: true, forward: false, out: false, in: true });
  assert.deepEqual(range.limits({ start: 0, end: 20 }, 20, 3), { back: true, forward: true, out: true, in: false });
  assert.deepEqual(range.resolve({ kind: "latest" }, ["2026-10", "2026-11", "2026-11"], { latest: 30, min: 3 }), { start: 0, end: 3 });
});

test("months: exactMonths (MDR) keeps exactly the chosen months; without it (Mooney) the range still widens to the minimum", () => {
  const months = ["2026-10", "2026-10", "2026-11", "2026-11", "2026-11", "2026-11"];
  assert.deepEqual(range.resolve({ kind: "months", from: "2026-10", to: "2026-10" }, months, { latest: 30, min: 3, exactMonths: true }), { start: 0, end: 2 });
  assert.deepEqual(range.resolve({ kind: "months", from: "2026-10", to: "2026-10" }, months, { latest: 30, min: 3 }), { start: 0, end: 3 }, "Mooney behaviour unchanged");
  assert.deepEqual(range.limits({ start: 0, end: 2 }, 6, 3), { back: true, forward: false, out: false, in: true }, "+ stays off below the minimum");
});

test("month picks: a start after the end moves the other select along", () => {
  assert.deepEqual(range.pickMonths("2026-10", "2026-11", "from"), { from: "2026-10", to: "2026-11" });
  assert.deepEqual(range.pickMonths("2026-12", "2026-11", "from"), { from: "2026-12", to: "2026-12" });
  assert.deepEqual(range.pickMonths("2026-12", "2026-11", "to"), { from: "2026-11", to: "2026-11" });
});

test("toolbar: the Mooney bar markup with the caller's ids and an escaped label", () => {
  const html = range.toolbar({ ids: { bar: "x-zoom", from: "x-from", to: "x-to" }, titles: { latest: "ล่าสุด", all: "ทั้งหมด" }, latestLabel: "ล่าสุด <30>" });
  assert.match(html, /^<div class="lab-zoom" id="x-zoom" role="toolbar"[^>]* hidden>/);
  assert.match(html, /id="x-from" data-native-select/);
  assert.match(html, /id="x-to" data-native-select/);
  assert.match(html, />ล่าสุด &lt;30&gt;</);
  assert.equal(range.monthOptions(["2026-10", "2026-11"], "2026-11", (m) => `M${m}`), `<option value="2026-10">M2026-10</option><option value="2026-11" selected>M2026-11</option>`);
});
