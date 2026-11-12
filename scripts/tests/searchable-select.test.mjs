import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { normalizeText, matches, filterOptions, stepIndex, accessibleName } =createRequire(import.meta.url)("../../modules/searchable-select.js");

test("search text ignores case, extra spaces and missing values", () => {
  assert.equal(normalizeText("  RB   ขึ้นรูปยาง\t"), "rb ขึ้นรูปยาง");
  assert.equal(normalizeText(null), "");
});

test("an option matches when every typed word appears in its label", () => {
  assert.equal(matches("RB · ขึ้นรูปยาง", ""), true, "an empty query keeps every option");
  assert.equal(matches("RB · ขึ้นรูปยาง", "rb"), true);
  assert.equal(matches("RB · ขึ้นรูปยาง", "ยาง rb"), true, "the words may come in any order");
  assert.equal(matches("RB · ขึ้นรูปยาง", "rb พลาสติก"), false, "every word must be found");
});

test("filtering keeps the original option order and indexes", () => {
  const options = [{ label: "ทุกสถานะ" }, { label: "ฉบับร่าง" }, { label: "ส่งแล้ว รอรับ" }, { label: "ฉบับร่าง (ฝ่ายขาย)" }];
  assert.deepEqual(filterOptions(options, ""), [0, 1, 2, 3]);
  assert.deepEqual(filterOptions(options, "ฉบับร่าง"), [1, 3]);
  assert.deepEqual(filterOptions(options, "zzz"), []);
  assert.deepEqual(filterOptions(null, "x"), []);
});

test("arrow keys skip disabled options and wrap around", () => {
  const options = [{ label: "a" }, { label: "b", disabled: true }, { label: "c" }];
  const visible = [0, 1, 2];
  assert.equal(stepIndex(visible, options, -1, 1), 0, "down from nothing starts at the first option");
  assert.equal(stepIndex(visible, options, -1, -1), 2, "up from nothing starts at the last option");
  assert.equal(stepIndex(visible, options, 0, 1), 2, "the disabled option is skipped");
  assert.equal(stepIndex(visible, options, 2, 1), 0, "it wraps to the top");
  assert.equal(stepIndex([], options, -1, 1), -1, "nothing to highlight");
  assert.equal(stepIndex([1], options, -1, 1), -1, "only disabled options cannot be highlighted");
});

test("the combobox is named by its aria-label, then its associated labels, then the label of its field, then a generic name", () => {
  assert.equal(accessibleName({ own: "หมวดและชนิด", labels: ["หมวด"], fieldLabel: "หมวด / ชนิด" }), "หมวดและชนิด", "an own aria-label or title wins");
  assert.equal(accessibleName({ labels: [" ฐานรหัส ", "", "แพ็กเกจ"], fieldLabel: "ชื่ออื่น" }), "ฐานรหัส แพ็กเกจ", "associated labels (for or wrapping) keep the old behaviour");
  assert.equal(accessibleName({ labels: [], fieldLabel: " ใบสั่งผลิต (ร่าง) (จำเป็น) " }), "ใบสั่งผลิต (ร่าง) (จำเป็น)", "a label next to the select, without for, names it");
  assert.equal(accessibleName({ labels: [], fieldLabel: "" }), "เลือกรายการ", "nothing to go by keeps the generic name");
  assert.equal(accessibleName(), "เลือกรายการ");
});
