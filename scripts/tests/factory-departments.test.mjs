import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { DEPARTMENTS, find, url } = createRequire(import.meta.url)("../../modules/factory-departments.js");

test("factory division has the six departments in display order", () => {
  assert.deepEqual(
    DEPARTMENTS.map(({ code, name }) => [code, name]),
    [
      ["PP", "วางแผนการผลิต"],
      ["RB", "ขึ้นรูปยาง"],
      ["GR", "แปรรูปยาง"],
      ["PT", "ขึ้นรูปพลาสติก"],
      ["BG", "เย็บจักร"],
      ["PK", "ประกอบบรรจุภัณฑ์"],
    ],
  );
});

test("department codes are unique and every department has a two-colour theme", () => {
  assert.equal(new Set(DEPARTMENTS.map((department) => department.code)).size, DEPARTMENTS.length);
  for (const department of DEPARTMENTS) {
    assert.equal(department.theme.length, 2, department.code);
    for (const colour of department.theme) assert.match(colour, /^#[0-9a-f]{6}$/i, department.code);
  }
});

test("department list cannot be changed by callers", () => {
  assert.throws(() => { "use strict"; DEPARTMENTS.push({ code: "XX" }); }, TypeError);
  assert.throws(() => { "use strict"; DEPARTMENTS[0].name = "เปลี่ยนชื่อ"; }, TypeError);
});

test("find ignores case and surrounding spaces and never guesses", () => {
  assert.equal(find("rb").code, "RB");
  assert.equal(find("  pk ").name, "ประกอบบรรจุภัณฑ์");
  assert.equal(find("QA"), null);
  assert.equal(find(""), null);
  assert.equal(find(null), null);
  assert.equal(find(undefined), null);
});

test("url links known departments only and falls back to the overview", () => {
  assert.equal(url("PP"), "#/factory?dept=PP");
  assert.equal(url("gr"), "#/factory?dept=GR");
  assert.equal(url("PP&x=1"), "#/factory");
  assert.equal(url("<script>"), "#/factory");
  assert.equal(url(), "#/factory");
});
