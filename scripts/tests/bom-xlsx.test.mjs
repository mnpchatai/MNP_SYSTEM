import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { makeZip } from "./zip-fixture.mjs";

// อ่าน .xlsx/.xlsm ในเบราว์เซอร์ (modules/bom-xlsx.js): สร้างไฟล์ zip เล็ก ๆ ในเทสต์ ไม่ใช้ไฟล์ลูกค้าจริง
const require = createRequire(import.meta.url);
const xlsx = require("../../modules/bom-xlsx.js");
const rules = require("../../modules/bom-rules.js");

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
  <sheet name="HOME" sheetId="1" r:id="rId1"/><sheet name="BOMSHEET" sheetId="2" r:id="rId2"/><sheet state="hidden" r:id="rId3" sheetId="3" name="EPLAN"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Target="/xl/worksheets/sheet2.xml" Id="rId2" Type="ws"/><Relationship Id="rId3" Type="ws" Target="worksheets/sheet3.xml"/></Relationships>`;
// สตริงร่วม: run หลายท่อน · entity · คำอ่าน rPh ที่ต้องตัดทิ้ง
const SHARED = `<sst><si><t>ITEM  สินค้า</t></si><si><t>รหัส FG/RB/SE/ST/PT/BG</t></si><si><t>รหัสแผนก</t></si><si><t>จำนวนSE/ST/PT/BG:1FG</t></si><si><t>ชื่อวัตถุดิบในการผลิต</t></si><si><t>แผนกผู้ผลิต</t></si><si><t>หน่วยวัสดุ</t></si>
  <si><t>MEGA-X(P)-Y</t></si><si><r><t>สินค้า </t></r><r><rPr><b/></rPr><t xml:space="preserve">X &amp; Y</t></r><rPh><t>อ่าน</t></rPh></si><si><t>ชุด / SET</t></si><si><t>ใบคำนวณวัตถุดิบ</t></si></sst>`;
const SHEET = `<worksheet><sheetData>
  <row r="1"><c r="D1" t="s"><v>10</v></c></row>
  <row r="2" spans="1:3"/>
  <row r="7"><c r="B7" t="s"><v>0</v></c><c r="C7" t="s"><v>1</v></c><c r="D7" t="s"><v>2</v></c><c r="E7" t="s"><v>3</v></c><c r="F7" t="s"><v>4</v></c><c r="G7" t="s"><v>5</v></c><c r="H7" t="s"><v>6</v></c></row>
  <row r="8"><c r="B8" t="s"><v>7</v></c><c r="C8" t="str"><f>LEFT(B8,6)</f><v>MEGA-X</v></c><c r="D8" t="inlineStr"><is><t>PK</t></is></c><c r="E8" t="e"><v>#N/A</v></c><c r="F8" t="s"><v>8</v></c><c r="G8"><v>0</v></c><c r="H8" t="s"><v>9</v></c></row>
  <row r="9"><c r="B9" t="s"><v>7</v></c><c r="C9" t="inlineStr"><is><t>B25-018</t></is></c><c r="D9" t="inlineStr"><is><t>ST</t></is></c><c r="E9"><v>0.10100000000000001</v></c><c r="F9" t="inlineStr"><is><t>สติ๊กเกอร์&#10;CE &#x41;</t></is></c><c r="G9" t="inlineStr"><is><t>PK-ST</t></is></c><c r="H9" t="inlineStr"><is><t>ชิ้น/pcs</t></is></c></row>
</sheetData></worksheet>`;
const FILES = [
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "xl/workbook.xml", data: WORKBOOK },
  { name: "xl/_rels/workbook.xml.rels", data: RELS },
  { name: "xl/sharedStrings.xml", data: SHARED },
  { name: "xl/worksheets/sheet1.xml", data: "<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><v>1</v></c></row></sheetData></worksheet>", store: true },
  { name: "xl/worksheets/sheet2.xml", data: SHEET },
  { name: "xl/worksheets/sheet3.xml", data: "<worksheet><sheetData/></worksheet>" },
  { name: "xl/vbaProject.bin", data: "macro bytes are never read", store: true },
];

test("a workbook lists its sheets, opens BOMSHEET by default, and turns cached cell values into rows", async () => {
  const workbook = await xlsx.openWorkbook(makeZip(FILES));
  assert.deepEqual(workbook.sheets.map((sheet) => [sheet.name, sheet.hidden, sheet.path]), [["HOME", false, "xl/worksheets/sheet1.xml"], ["BOMSHEET", false, "xl/worksheets/sheet2.xml"], ["EPLAN", true, "xl/worksheets/sheet3.xml"]], "relative and absolute rel targets, attributes in any order");
  assert.equal(workbook.defaultSheet, "BOMSHEET");
  assert.deepEqual([...await workbook.rows("HOME")], [["1"]], "a stored (uncompressed) part is read too");
  assert.deepEqual([...await workbook.rows("EPLAN")], []);
  const rows = await workbook.rows("BOMSHEET");
  assert.equal(rows.length, 4, "blank rows are dropped");
  assert.deepEqual(rows[0], ["", "", "", "ใบคำนวณวัตถุดิบ"], "columns keep their position");
  assert.deepEqual(rows[2], ["", "MEGA-X(P)-Y", "MEGA-X", "PK", "", "สินค้า X & Y", "0", "ชุด / SET"], "formula string, inline string, error → empty, rich text without phonetic runs");
  assert.deepEqual(rows[3].slice(1), ["MEGA-X(P)-Y", "B25-018", "ST", "0.101", "สติ๊กเกอร์ CE A", "PK-ST", "ชิ้น/pcs"], "numbers are shortened and line breaks become spaces");
  const flat = rules.readFlatRows(xlsx.rowsToTsv(rows));
  assert.deepEqual(flat.map((row) => [row.item, row.code, row.qty]), [["MEGA-X(P)-Y", "MEGA-X", 0], ["MEGA-X(P)-Y", "B25-018", 0.101]], "the title rows above the header are skipped by readFlatRows");
  const built = rules.buildFromFlat(flat);
  assert.equal(built.items.get("MEGA-X(P)-Y").name, "สินค้า X & Y");
  assert.deepEqual(built.boms.get("MEGA-X(P)-Y").map((line) => line.childCode), ["B25-018"]);
});

test("the default sheet falls back to DATA, then the first visible sheet", async () => {
  const wb = (names) => `<workbook><sheets>${names.map(([name, hidden], i) => `<sheet name="${name}" r:id="rId${i + 1}"${hidden ? ' state="hidden"' : ""}/>`).join("")}</sheets></workbook>`;
  const rels = (count) => `<Relationships>${Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join("")}</Relationships>`;
  const files = (names) => [{ name: "xl/workbook.xml", data: wb(names) }, { name: "xl/_rels/workbook.xml.rels", data: rels(names.length) }, ...names.map((_, i) => ({ name: `xl/worksheets/s${i + 1}.xml`, data: "<worksheet/>" }))];
  assert.equal((await xlsx.openWorkbook(makeZip(files([["MAIN"], ["Data "]])))).defaultSheet, "Data ");
  assert.equal((await xlsx.openWorkbook(makeZip(files([["Secret", true], ["Sheet1"]])))).defaultSheet, "Sheet1");
  assert.equal(xlsx.isWorkbookName("Material_Megaform 25047.XLSM"), true);
  assert.equal(xlsx.isWorkbookName("bom.tsv"), false);
  assert.equal(xlsx.isWorkbookName("old.xls"), false);
});

test("files that are not workbooks, or parts larger than the limit, fail with a readable message", async () => {
  await assert.rejects(xlsx.openWorkbook(new TextEncoder().encode("ITEM\tCODE\n").buffer), /ไม่ใช่ \.xlsx/);
  await assert.rejects(xlsx.openWorkbook(makeZip([{ name: "word/document.xml", data: "<w/>" }])), /ไม่พบ xl\/workbook\.xml/);
  const huge = FILES.map((file) => (file.name === "xl/worksheets/sheet2.xml" ? { ...file, declaredSize: xlsx.MAX_PART_BYTES + 1 } : file));
  const workbook = await xlsx.openWorkbook(makeZip(huge));
  await assert.rejects(workbook.rows("BOMSHEET"), /เกินที่อ่านได้ในเบราว์เซอร์/, "the declared size is checked before inflating");
  await assert.rejects(workbook.rows("ไม่มี"), /ไม่พบชีต/);
  await assert.rejects(xlsx.openWorkbook(new ArrayBuffer(xlsx.MAX_FILE_BYTES + 1)), /เกิน/);
});

test("cell references and XML entities decode like Excel writes them", () => {
  assert.deepEqual(["A1", "Z9", "AA10", "AF7", "XFD1"].map(xlsx.columnIndex), [0, 25, 26, 31, 16383]);
  assert.equal(xlsx.decodeXml("a &lt;b&gt; &quot;c&quot; &apos;d&apos; &amp;amp; &#3585; &#xE01; &bogus;"), "a <b> \"c\" 'd' &amp; ก ก &bogus;");
  assert.deepEqual(xlsx.sharedStrings('<sst><si><t>a</t></si><si/><si><t xml:space="preserve"> b </t></si></sst>'), ["a", "", " b "]);
});

test("reader limits: inflated size is counted (a lying declared size is caught), corrupt data and wide or long sheets fail in Thai", async () => {
  const sheetFiles = (sheetXml, extra = {}) => [
    { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="../xl/./worksheets/s.xml"/></Relationships>' },
    { name: "xl/worksheets/s.xml", data: sheetXml, ...extra },
  ];
  const big = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${"x".repeat(5000)}</t></is></c></row></sheetData></worksheet>`;
  const lying = await xlsx.openWorkbook(makeZip(sheetFiles(big, { declaredSize: 100 })), { maxPartBytes: 1000 });
  assert.deepEqual(lying.sheets.map((sheet) => sheet.path), ["xl/worksheets/s.xml"], "../ and ./ in a rel target resolve");
  await assert.rejects(lying.rows("S"), /ใหญ่เกินที่อ่านได้/, "the size is counted while inflating, not taken from the file");
  const corrupt = makeZip(sheetFiles(big, { store: true }));
  new Uint8Array(corrupt).fill(0xff, 30 + "xl/workbook.xml".length, 30 + "xl/workbook.xml".length + 3); // ข้อมูลบีบอัดของส่วนแรกเสีย (block type ไม่ถูกต้อง)
  await assert.rejects(xlsx.openWorkbook(corrupt), /ไฟล์เสียหาย/);
  // แถวที่มีค่าไกลกว่าคอลัมน์ MAX_COLUMNS: ข้ามค่านั้น นับไว้ และไม่สร้างแถวกว้าง 16,384 ช่อง
  const wide = await xlsx.openWorkbook(makeZip(sheetFiles('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="XFD1"><v>2</v></c></row><row r="2"><c r="XFD2"><v>3</v></c></row></sheetData></worksheet>')));
  const wideRows = await wide.rows("S");
  assert.deepEqual([...wideRows], [["1"]]);
  assert.equal(wideRows.skippedCells, 2);
  const many = Array.from({ length: xlsx.MAX_ROWS + 1 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join("");
  await assert.rejects((await xlsx.openWorkbook(makeZip(sheetFiles(`<worksheet><sheetData>${many}</sheetData></worksheet>`)))).rows("S"), /เกิน 60,000 แถว/);
  assert.equal(xlsx.resolvePath("/xl/worksheets/a.xml"), "xl/worksheets/a.xml");
});

test("an empty text run (<t/>) adds nothing and does not swallow the next run", () => {
  assert.deepEqual(xlsx.sharedStrings("<sst><si><r><t/></r><r><t>abc</t></r></si><si><t/></si></sst>"), ["abc", ""]);
});
