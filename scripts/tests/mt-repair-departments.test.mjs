import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// ปุ่มแผนกในฟอร์มแจ้งซ่อม MT = แผนกที่ฐานข้อมูลคืนมา (is_repair_site) ∩ รายการใน module-mt.js
// โหลด module-mt.js (script ธรรมดาใน browser) เข้า context จำลองแล้วเรียก loadRepairDepartments กับ Supabase จำลอง
function loadMtModule() {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(fs.readFileSync("modules/module-mt.js", "utf8"), context, { filename: "modules/module-mt.js" });
  return context.window.MNP_REQUEST_MODULES.MT_REPAIR;
}
function fakeSupabase(codes) {
  const rows = codes.map((code) => ({ id: `id-${code}`, code, name_th: code }));
  const query = { select: () => query, eq: () => query, order: () => Promise.resolve({ data: rows, error: null }) };
  return { from: () => query };
}
const ORIGINAL = ["RB", "GR", "BG", "PT", "PK", "QA", "ST", "WH", "SR", "FT", "MT", "AD"];

test("the repair form lists the original departments in order, with ST shown as ST-WH and WH left out", async () => {
  const departments = await loadMtModule().loadRepairDepartments(fakeSupabase(ORIGINAL));
  // Array.from: array จาก vm เป็นคนละ realm กับในเทสต์ deepEqual แบบ strict จึงเทียบ prototype ไม่ผ่าน
  assert.deepEqual(Array.from(departments, (item) => item.displayCode), ["RB", "GR", "BG", "PT", "PK", "QA", "ST-WH", "SR", "FT", "MT", "AD"]);
});

test("Indesign (ID) gets the last button once the database returns it", async () => {
  const departments = await loadMtModule().loadRepairDepartments(fakeSupabase([...ORIGINAL, "ID"]));
  const last = departments.at(-1);
  assert.equal(departments.length, 12);
  assert.deepEqual({ sourceCode: last.sourceCode, displayCode: last.displayCode, name: last.name, id: last.id }, { sourceCode: "ID", displayCode: "ID", name: "Indesign", id: "id-ID" });
});

test("on a database without the ID department the button is dropped instead of breaking the form", async () => {
  const departments = await loadMtModule().loadRepairDepartments(fakeSupabase(ORIGINAL));
  assert.equal(departments.some((item) => item.sourceCode === "ID"), false);
  assert.ok(departments.every((item) => item.id));
});

test("every department button has its own colour rule in styles.css", () => {
  const css = fs.readFileSync("styles.css", "utf8");
  for (const code of [...ORIGINAL.filter((value) => value !== "WH"), "ID"]) {
    assert.match(css, new RegExp(`\\.repair-department-card\\[data-dept-code="${code}"\\]\\s*\\{[^}]*--department-from`), `${code} has no colour rule`);
  }
});
