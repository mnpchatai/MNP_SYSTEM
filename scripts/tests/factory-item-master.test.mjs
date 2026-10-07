import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { FOLDERS, findEntry, url } = createRequire(import.meta.url)("../../modules/factory-item-master.js");

test("item master keeps the six reference folders first, then the folders added for the ported app", () => {
  assert.deepEqual(
    FOLDERS.map((folder) => folder.name),
    ["โครงสร้าง", "สินค้า", "ราคา", "ผู้ร่วมมือ", "ใบเสนอราคา", "ใบสั่งขาย", "ขั้นตอนการผลิต", "คลังสินค้า", "ใบสั่งผลิต", "สั่งวัตถุดิบ", "ใบงานผลิต"],
  );
});

test("item folder holds the item register, the new-item form and the edit history", () => {
  const item = FOLDERS.find((folder) => folder.key === "item");
  assert.deepEqual(item.entries.map((entry) => [entry.name, entry.view]), [
    ["ทะเบียนสินค้า", "items"],
    ["สินค้า-ใหม่", "item-new"],
    ["ประวัติการแก้ไขสินค้า", "history"],
  ]);
});

test("folders without confirmed entries stay empty instead of guessing", () => {
  for (const key of ["price", "partner", "quotation", "sales-order"]) {
    assert.equal(FOLDERS.find((folder) => folder.key === key).entries.length, 0, key);
  }
});

test("every entry view is one the factory pages know how to draw", () => {
  const known = new Set(["bom", "bom-new", "bom-drafts", "bom-approvals", "items", "item-new", "history", "routing", "inventory", "production", "production-new", "production-planning", "material-new", "material", "job-queue", "job-new", "job"]);
  for (const folder of FOLDERS) for (const entry of folder.entries) assert.ok(known.has(entry.view), entry.key);
});

test("structure folder holds new, edit, approve and view entries in that order (approve is the one added beyond the reference menu)", () => {
  const structure = FOLDERS.find((folder) => folder.key === "structure");
  assert.deepEqual(
    structure.entries.map((entry) => [entry.name, entry.view]),
    [["โครงสร้างสินค้า-ใหม่", "bom-new"], ["โครงสร้างสินค้า-แก้ไข", "bom-drafts"], ["โครงสร้างสินค้า-อนุมัติ", "bom-approvals"], ["โครงสร้างสินค้า-ดู", "bom"]],
  );
});

test("production folder holds new, planning queue and view entries (the planning queue is the one added for the workflow)", () => {
  const production = FOLDERS.find((folder) => folder.key === "production");
  assert.deepEqual(production.entries.map((entry) => [entry.name, entry.view]), [
    ["ใบสั่งผลิต-ใหม่", "production-new"],
    ["ใบสั่งผลิต-ฝ่ายวางแผน", "production-planning"],
    ["ใบสั่งผลิต-ดู", "production"],
  ]);
});

test("material folder holds the new order form and the list/detail view", () => {
  const material = FOLDERS.find((folder) => folder.key === "material");
  assert.deepEqual(material.entries.map((entry) => [entry.name, entry.view]), [
    ["ใบสั่งวัตถุดิบ-ใหม่", "material-new"],
    ["ใบสั่งวัตถุดิบ-ดู", "material"],
  ]);
});

test("job folder holds the department queue, the new job form and the list/detail view", () => {
  const job = FOLDERS.find((folder) => folder.key === "job");
  assert.deepEqual(job.entries.map((entry) => [entry.name, entry.view]), [
    ["ใบงานผลิต-คิวแผนกของฉัน", "job-queue"],
    ["ใบงานผลิต-ใหม่", "job-new"],
    ["ใบงานผลิต-ดู", "job"],
  ]);
});

test("url keeps the jb and part parameters used by the job screens", () => {
  assert.equal(url("job-view", { jb: "abc" }), "#/factory?item=job-view&jb=abc");
  assert.equal(url("job-new", { wo: "w", part: "p", qty: 12, evil: "x" }), "#/factory?item=job-new&wo=w&part=p&qty=12");
  assert.equal(url("job-view", { status: "open" }), "#/factory?item=job-view&status=open");
});

test("url keeps the mo and wo parameters used by the material order screens", () => {
  assert.equal(url("material-view", { mo: "abc" }), "#/factory?item=material-view&mo=abc");
  assert.equal(url("material-new", { wo: "def", evil: "x" }), "#/factory?item=material-new&wo=def");
  assert.equal(url("material-new", { mo: "abc" }), "#/factory?item=material-new&mo=abc");
});

test("url keeps the po parameter used by the production order screens", () => {
  assert.equal(url("production-view", { po: "abc" }), "#/factory?item=production-view&po=abc");
  assert.equal(url("production-new", { po: "abc", evil: "x" }), "#/factory?item=production-new&po=abc");
  assert.equal(url("production-view", { status: "planning" }), "#/factory?item=production-view&status=planning");
});

test("folder and entry keys are unique across the whole menu and names are not blank", () => {
  const folderKeys = FOLDERS.map((folder) => folder.key);
  const entryKeys = FOLDERS.flatMap((folder) => folder.entries.map((entry) => entry.key));
  assert.equal(new Set(folderKeys).size, folderKeys.length);
  assert.equal(new Set(entryKeys).size, entryKeys.length);
  for (const folder of FOLDERS) {
    assert.ok(folder.name.trim().length > 0, folder.key);
    for (const entry of folder.entries) assert.ok(entry.name.trim().length > 0, entry.key);
  }
});

test("menu cannot be changed by callers", () => {
  assert.throws(() => { "use strict"; FOLDERS.push({ key: "x" }); }, TypeError);
  assert.throws(() => { "use strict"; FOLDERS[0].name = "เปลี่ยนชื่อ"; }, TypeError);
  assert.throws(() => { "use strict"; FOLDERS[0].entries.push({ key: "x" }); }, TypeError);
  assert.throws(() => { "use strict"; FOLDERS[0].entries[0].name = "เปลี่ยนชื่อ"; }, TypeError);
});

test("findEntry returns the entry with its folder and never guesses", () => {
  const found = findEntry("structure-edit");
  assert.equal(found.entry.name, "โครงสร้างสินค้า-แก้ไข");
  assert.equal(found.folder.name, "โครงสร้าง");
  assert.equal(findEntry("structure"), null, "a folder key is not an entry key");
  assert.equal(findEntry("STRUCTURE-NEW"), null, "keys are exact, not case-folded");
  assert.equal(findEntry(""), null);
  assert.equal(findEntry(null), null);
  assert.equal(findEntry(undefined), null);
  assert.equal(findEntry("<img src=x onerror=alert(1)>"), null);
});

test("url links known entries only and falls back to the factory overview", () => {
  assert.equal(url("structure-new"), "#/factory?item=structure-new");
  assert.equal(url("structure-view"), "#/factory?item=structure-view");
  assert.equal(url("structure"), "#/factory", "a folder is not a page");
  assert.equal(url("structure-new&x=1"), "#/factory");
  assert.equal(url("<script>"), "#/factory");
  assert.equal(url(), "#/factory");
});

test("url keeps only known extra parameters and encodes their values", () => {
  assert.equal(url("item-list", { id: "a b", edit: 1 }), "#/factory?item=item-list&id=a+b&edit=1");
  assert.equal(url("item-list", { q: "ยาง&x=1", page: 2, admin: "yes", item: "structure-new" }), "#/factory?item=item-list&q=%E0%B8%A2%E0%B8%B2%E0%B8%87%26x%3D1&page=2");
  assert.equal(url("item-list", { id: "", bom: null, routing: undefined }), "#/factory?item=item-list");
  assert.equal(url("nope", { id: "x" }), "#/factory");
});

test("url keeps the bom and from parameters used by the BOM screens and drops unknown ones", () => {
  assert.equal(url("structure-new", { bom: "abc" }), "#/factory?item=structure-new&bom=abc");
  assert.equal(url("structure-new", { from: "def", evil: "x" }), "#/factory?item=structure-new&from=def");
  assert.equal(url("structure-approve"), "#/factory?item=structure-approve");
});
