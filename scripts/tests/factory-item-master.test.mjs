import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { FOLDERS, findEntry, url } = createRequire(import.meta.url)("../../modules/factory-item-master.js");

test("item master has the six folders from the reference menu, in order", () => {
  assert.deepEqual(
    FOLDERS.map((folder) => folder.name),
    ["โครงสร้าง", "สินค้า", "ราคา", "ผู้ร่วมมือ", "ใบเสนอราคา", "ใบสั่งขาย"],
  );
});

test("structure folder lists only the entries that could be read from the reference", () => {
  const structure = FOLDERS.find((folder) => folder.key === "structure");
  assert.deepEqual(
    structure.entries.map((entry) => entry.name),
    ["โครงสร้างสินค้า-ใหม่", "โครงสร้างสินค้า-แก้ไข", "โครงสร้างสินค้า-ดู"],
  );
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
