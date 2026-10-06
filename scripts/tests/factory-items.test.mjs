import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { ITEMS, CATEGORIES, find, grouped } = createRequire(import.meta.url)("../../modules/factory-items.js");

test("item codes are unique, marked TEST- and every item has the fields the page shows", () => {
  assert.ok(ITEMS.length > 0);
  assert.equal(new Set(ITEMS.map((item) => item.code)).size, ITEMS.length);
  for (const item of ITEMS) {
    assert.match(item.code, /^TEST-[A-Z]{2}-\d{3}$/, item.code);
    assert.ok(item.name.includes("(ตัวอย่าง)"), `${item.code} must be labelled as a sample`);
    assert.ok(item.unit.length > 0, item.code);
    assert.ok(CATEGORIES.some((category) => category.key === item.category), `${item.code} has an unknown category`);
  }
});

test("item master cannot be changed by callers", () => {
  assert.throws(() => { "use strict"; ITEMS.push({ code: "X" }); }, TypeError);
  assert.throws(() => { "use strict"; ITEMS[0].name = "เปลี่ยนชื่อ"; }, TypeError);
  assert.throws(() => { "use strict"; CATEGORIES[0].name = "เปลี่ยนชื่อ"; }, TypeError);
});

test("find ignores case and spaces, returns the category name and never guesses", () => {
  const item = find("  test-fg-001 ");
  assert.equal(item.code, "TEST-FG-001");
  assert.equal(item.categoryName, "สินค้าสำเร็จรูป");
  assert.equal(find("TEST-RM-001").unit, "กก.");
  assert.equal(find("TEST-XX-999"), null);
  assert.equal(find(""), null);
  assert.equal(find(null), null);
  assert.equal(find(undefined), null);
  assert.equal(find("<script>"), null);
});

test("grouped follows category order, keeps every item once and skips empty categories", () => {
  const groups = grouped();
  assert.deepEqual(groups.map((group) => group.category.key), CATEGORIES.map((category) => category.key));
  const codes = groups.flatMap((group) => group.items.map((item) => item.code));
  assert.deepEqual([...codes].sort(), ITEMS.map((item) => item.code).sort());
  for (const group of groups) {
    assert.ok(group.items.length > 0);
    assert.ok(group.items.every((item) => item.category === group.category.key));
  }
});
