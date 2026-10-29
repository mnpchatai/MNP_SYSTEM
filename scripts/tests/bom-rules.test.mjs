import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// กฎล้วนของ BOM รายแผนก (modules/bom-rules.js): รหัส หน่วย อ่านชีต DATA ประกอบต้นไม้ ระเบิด BOM และ CSV
const require = createRequire(import.meta.url);
const rules = require("../../modules/bom-rules.js");

// ชีต DATA ของไฟล์ Material_*.xlsm (หัวคอลัมน์แบบไฟล์ต่อ PI) วางจาก Excel เป็น TSV — ข้อมูลสมมติที่เลียนโครงจริง
const PI_HEADER = ["ITEM", "น.น RB/g", "CODE", "รหัสแผนก", "สินค้า/สูตรยาง", "สีSE/ประเภทยาง", "ความยาวSE/สีRB", "รู,ความหนา/ความยาวRB", "วงนอกSE/รูในRB", "วงนอกRB", "NAME", "แผนกผู้ผลิต", "จำนวนที่ใช้ต่อชุด", "ความยาวตัด", "หน่วย", "จำนวนชิ้นที่ได้ต่อเส้น RB", "หน่วย", "จำนวนที่ได้ต่อ 1 GR", "หน่วย", "หน่วยนับ RB", "น.น ต่อเส้น RB / ก.ก"];
const row = (cells) => cells.join("\t");
const PI_TSV = [
  row(PI_HEADER),
  row(["DEMO-ST-01(P)-Y", "1", "DEMO-ST-01", "PK", "-", "-", "-", "-", "-", "-", "สินค้า ตอปิโด ST-01", "PK", "-", "-", "-", "-", "-", "-", "-", "ชุด / SET", "-"]),
  row(["DEMO-ST-01(P)-Y", "2", "-", "PK", "-", "-", "-", "-", "-", "-", "แกนตอปิโด ตัด 14cm", "PK-PK", "1", "-", "-", "-", "-", "-", "-", "ชิ้น(1.9g)", "-"]),
  row(["DEMO-ST-01(P)-Y", "3", "PT-00320", "ST", "-", "-", "-", "-", "-", "-", "แกนตอปิโด ท่อดำ 150CM", "PK-PT", "0.3", "-", "-", "-", "-", "-", "-", "ชิ้น(20g)", "-"]),
  row(["DEMO-ST-01(P)-Y", "4", "D21-016", "ST", "-", "-", "-", "-", "-", "-", "เม็ดพลาสติก PE-LD-B สีดำ", "PT-ST", "0.006", "-", "-", "-", "-", "-", "-", "กิโลกรัม", "-"]),
  row(["DEMO-ST-01(P)-Y", "5", "B03-1032", "ST", "-", "-", "-", "-", "-", "-", "กล่องนอก 34 x 79 x 29CM", "PK-ST", "0.025", "-", "-", "-", "-", "-", "-", "กล่อง", "-"]),
  row(["DEMO-ST-01(P)-Y", "6", "SE-ST01--100-18-65", "SE", "ST01", "0", "100", "18", "65", "-", "ลูกตอปิโด ST-01 ส้ม", "SE ", "3", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "49"]),
  row(["DEMO-ST-01(P)-Y", "7", "RB-B0006-02- -202-18-70", "RB", "B0006", "02", "", "202", "18", "70", "ยางกลมมีรู ตัว ST-01", "RB", "3", "6.5", "CM", "31", "ชิ้น", "1", "ชิ้น", "ชิ้น/pcs", "1530"]),
  row(["DEMO-ST-01(P)-Y", "8", "SE-ST01--100-18-65", "SE", "ST01", "0", "100", "18", "65", "-", "ลูกตอปิโด ST-01 ส้ม", "SE", "3", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs.", "49"]),
  row(["DEMO-ST-01(P)-Y", "9", "RB-B0006-02--202-18-70", "RB", "B0006", "02", "", "202", "18", "70", "ยางกลมมีรู ตัว ST-01", "RB", "3", "6.5", "CM", "31", "ชิ้น", "1", "ชิ้น", "ชิ้น/pcs", "1530"]),
  row(["DEMO-ST-01(P)-Y", "10", "B02-092", "ST", "-", "-", "-", "-", "-", "-", "กระเป๋า ST-01", "PK-BG", "1", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "-"]),
  row(["DEMO-ST-01(P)-Y", "11", "C17-012", "ST", "-", "-", "-", "-", "-", "-", "ผ้าซิป สีฟ้า NO.5", "BG-ST", "0.59", "-", "-", "-", "-", "-", "-", "หลา", "-"]),
  row(["DEMO-AT-01(B)-A", "1", "DEMO-AT-01", "PK", "-", "-", "-", "-", "-", "-", "สินค้า AT-01", "PK", "-", "-", "-", "-", "-", "-", "-", "ชุด/SET", "-"]),
  row(["DEMO-AT-01(B)-A", "2", "SE-ST01--100-18-65", "SE", "ST01", "0", "100", "18", "65", "-", "ลูกตอปิโด ST-01 ส้ม", "SE", "2", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "49"]),
  row(["DEMO-AT-01(B)-A", "3", "RB-B0006-02- -202-18-70", "RB", "B0006", "02", "", "202", "18", "70", "ยางกลมมีรู ตัว ST-01", "RB", "2", "6.5", "CM", "31", "ชิ้น", "1", "ชิ้น", "ชิ้น/pcs", "1530"]),
  row(["DEMO-AT-01(B)-A", "4", "F13-028", "ST", "-", "-", "-", "-", "-", "-", "ถุงพลาสติก IPP 9x13", "PK-ST", "0.01", "-", "-", "-", "-", "-", "-", "กก.(112pcs)", "-"]),
].join("\n");

test("canonical codes merge the spelling variants of RB/SE codes and keep FG code parts", () => {
  assert.equal(rules.canonicalCode("RB-B0005-02- -132-9-25"), "RB-B0005-02-132-9-25");
  assert.equal(rules.canonicalCode("RB-B0005-02--132-9-25"), "RB-B0005-02-132-9-25");
  assert.equal(rules.canonicalCode(" RB-B0005-02-  -132-9-25 "), "RB-B0005-02-132-9-25");
  assert.equal(rules.canonicalCode("se-st01--100-18-65"), "SE-ST01-100-18-65");
  assert.deepEqual(rules.parseFgCode("MEGA-ST-01(P)-Y"), { base: "MEGA-ST-01", pkg: "P", colorSet: "Y" });
  assert.deepEqual(rules.parseFgCode("AHL-24WA(N)-A"), { base: "AHL-24WA", pkg: "N", colorSet: "A" });
  assert.deepEqual(rules.parseFgCode("ACG-01-A"), { base: "ACG-01", pkg: "", colorSet: "A" });
  assert.equal(rules.buildFgCode("mega-st-01", "p", "y"), "MEGA-ST-01(P)-Y");
  assert.equal(rules.buildFgCode("ACG-01", "", "A"), "ACG-01-A");
  assert.equal(rules.buildFgCode("AHL-24WA", "N", ""), "AHL-24WA(N)");
  assert.equal(rules.buildFgCode(" AG-01 "), "AG-01");
  assert.deepEqual(rules.parseFgCode(rules.buildFgCode("MEGA-AT-01N-MOD", "B-N", "Y")), { base: "MEGA-AT-01N-MOD", pkg: "B-N", colorSet: "Y" });
  assert.ok(rules.PACKAGES.includes("B-N") && rules.COLOR_SETS.includes("Y"));
  assert.deepEqual(rules.parseRbCode("RB-B0006-02- -202-18-70"), { compound: "B0006", type: "02", color: "", lengthMm: 202, holeMm: 18, odMm: 70 });
  assert.deepEqual(rules.parseRbCode("RB-DM01-02-OR01-202-18-70"), { compound: "DM01", type: "02", color: "OR01", lengthMm: 202, holeMm: 18, odMm: 70 });
  assert.equal(rules.parseRbCode("SE-ST01-100-18-65"), null);
  assert.deepEqual(rules.parseSeCode("SE-ST01--100-18-65"), { product: "ST01", color: "", lengthMm: 100, holeMm: 18, odMm: 65 });
  assert.ok(rules.isBlankCode("-") && rules.isBlankCode("0") && rules.isBlankCode(" ") && !rules.isBlankCode("B01-064"));
});

test("item kind follows the code prefix, the producing department and the producer pair", () => {
  assert.equal(rules.kindOf({ code: "RB-B0006-02-202-18-70", deptKind: "RB", pair: "RB" }), "RB");
  assert.equal(rules.kindOf({ code: "SE-ST01-100-18-65", deptKind: "SE", pair: "SE " }), "SE");
  assert.equal(rules.kindOf({ code: "PT-00320", deptKind: "ST", pair: "PK-PT" }), "PT");
  assert.equal(rules.kindOf({ code: "B02-092", deptKind: "ST", pair: "PK-BG" }), "BG");
  assert.equal(rules.kindOf({ code: "D21-016", deptKind: "ST", pair: "PT-ST" }), "PURCHASED");
  assert.equal(rules.kindOf({ code: "MEGA-ST-01", deptKind: "PK", pair: "PK" }), "FG");
  assert.equal(rules.kindOf({ code: "-", deptKind: "PK", pair: "PK-PK" }), "SUBPART");
  assert.equal(rules.ownerDeptOf("SUBPART", "PK-PK"), "PK");
  assert.equal(rules.ownerDeptOf("SE"), "GR");
  assert.equal(rules.ownerDeptOf("PURCHASED"), "ST");
});

test("unit spellings of the sheet normalise to a standard unit with pack size or piece weight", () => {
  assert.equal(rules.normalizeUom("ชิ้น/pcs").code, "pcs");
  assert.equal(rules.normalizeUom("ชิ้น/pcs.").code, "pcs");
  assert.deepEqual(rules.normalizeUom("ชิ้น(20g)"), { code: "pcs", raw: "ชิ้น(20g)", weightG: 20 });
  assert.equal(rules.normalizeUom("กิโลกรัม").code, "kg");
  assert.equal(rules.normalizeUom("กก.").code, "kg");
  assert.deepEqual(rules.normalizeUom("กก.(112pcs)").pack, { qty: 112, unit: "pcs" });
  assert.deepEqual(rules.normalizeUom("ม้วน(50M)"), { code: "roll", raw: "ม้วน(50M)", pack: { qty: 50, unit: "m" } });
  assert.equal(rules.normalizeUom("ม้วน (50M)").pack.qty, 50);
  assert.deepEqual(rules.normalizeUom("ม้วน(100Y)").pack, { qty: 100, unit: "yd" });
  assert.equal(rules.normalizeUom("ชุด / SET").code, "set");
  assert.equal(rules.normalizeUom("ชุด/SET").code, "set");
  assert.equal(rules.normalizeUom(" เมตร ").code, "m");
  assert.equal(rules.normalizeUom("หลา").code, "yd");
  assert.equal(rules.normalizeUom("กล่อง").code, "box");
  assert.equal(rules.normalizeUom("เส้น").code, "rod");
  assert.equal(rules.normalizeUom("ลังไม้").code, "other");
  assert.equal(rules.uomLabel("kg"), "กก.");
});

test("RB per SE follows the BOMSHEET formula: 1 / (pieces per rod × SE per GR), or grams/1000 when counted in kg", () => {
  assert.ok(Math.abs(rules.rbPerSe({ pcsPerRoll: 31, sePerGr: 1 }) - 1 / 31) < 1e-12);
  assert.ok(Math.abs(rules.rbPerSe({ pcsPerRoll: 176, sePerGr: 10 }) - 1 / 1760) < 1e-12);
  assert.equal(rules.rbPerSe({ pcsPerRoll: 0 }), 0);
  assert.equal(rules.rbPerSe({ uom: "kg", weightG: 245 }), 0.245);
  assert.equal(rules.rbPerSe({ uom: "kg", weightG: 0 }), 0);
});

test("the flat DATA sheet (per-PI header) is read into rows and rebuilt as a multi-level BOM", () => {
  const flat = rules.readFlatRows(PI_TSV);
  assert.equal(flat.length, 15);
  assert.equal(flat[5].pair, "SE", "trailing space in the producer pair is trimmed");
  assert.equal(flat[6].weightG, 1530, "weight comes from the per-rod weight column, not the row number");
  assert.equal(flat[6].pcsPerRoll, 31);
  const { items, boms, report } = rules.buildFromFlat(flat);
  assert.equal(report.fgCount, 2);
  const fg = items.get("DEMO-ST-01(P)-Y");
  assert.equal(fg.kind, "FG");
  assert.equal(fg.uom, "set");
  const rb = items.get("RB-B0006-02-202-18-70");
  assert.equal(rb.kind, "RB");
  assert.deepEqual(rb.legacyCodes, ["RB-B0006-02- -202-18-70", "RB-B0006-02--202-18-70"], "both spellings are kept as legacy codes");
  assert.equal(rb.rubber.compound, "B0006");
  assert.equal(rb.rubber.kgPerRoll, 1.53);
  assert.equal(rb.rubber.pcsPerRoll, 31);
  assert.equal(items.get("PT-00320").weightG, 20, "piece weight parsed from the unit text");
  assert.equal(items.get("PT-00320").ownerDept, "PT");
  assert.equal(items.get("B02-092").kind, "BG");
  assert.equal(items.get("XP-00001").kind, "SUBPART", "the uncoded PK-made part gets a generated code");
  assert.equal(items.get("XP-00001").ownerDept, "PK");
  // ชั้นของต้นไม้: FG → SE → RB · FG → PT → เม็ดพลาสติก · FG → BG → ผ้าซิป
  const fgLines = boms.get("DEMO-ST-01(P)-Y");
  assert.deepEqual(fgLines.map((line) => [line.childCode, line.qty]), [["XP-00001", 1], ["PT-00320", 0.3], ["B03-1032", 0.025], ["SE-ST01-100-18-65", 6], ["B02-092", 1]], "the duplicated SE line is merged by summing its quantity");
  assert.equal(report.merged, 1, "only the SE line under the FG is summed; the duplicated RB ratio under the SE is not doubled");
  // คอลัมน์ "จำนวนที่ใช้ต่อชุด" เป็นต่อ FG ทั้งชีต: เม็ดพลาสติก 0.006 กก./ชุด ÷ แกน 0.3 ชิ้น/ชุด = 0.02 กก. ต่อแกน 1 ชิ้น (= 20 กรัมตามหน่วย "ชิ้น(20g)")
  assert.deepEqual(boms.get("PT-00320"), [{ childCode: "D21-016", qty: 0.02, uom: "kg", consumerDept: "PT", producerDept: "ST", scrapPct: 0, flags: [], note: "" }]);
  assert.deepEqual(boms.get("B02-092").map((line) => [line.childCode, line.qty]), [["C17-012", 0.59]], "bag used 1 per set → per-bag quantity equals the sheet quantity");
  const seLines = boms.get("SE-ST01-100-18-65");
  assert.equal(seLines.length, 1);
  assert.ok(Math.abs(seLines[0].qty - 1 / 31) < 1e-12, "RB under SE uses the cutting formula, not the repeated SE quantity");
  assert.equal(seLines[0].consumerDept, "GR");
  // สินค้าที่สองใช้ SE เดิม: ไม่สร้างซ้ำ และไม่มีข้อขัดแย้ง (RB ลูกเดียวกัน ปริมาณเดียวกัน)
  assert.deepEqual(boms.get("DEMO-AT-01(B)-A").map((line) => [line.childCode, line.qty]), [["SE-ST01-100-18-65", 2], ["F13-028", 0.01]]);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.compounds, ["B0006"]);
  assert.equal(report.itemCount, items.size);
});

test("the master DATA BOM.xlsx header variant is detected too and a sheet without a header is refused", () => {
  const masterHeader = ["ITEM", "น.น ชิ้นงาน RB,SE,PT ต่อเส้น", "CODE", "รหัสแผนกที่ผลิต", "สินค้า/สูตรยาง", "ยางกลมมีรู ", "ความยาว SE/mm/สี RB/ความยาว", "รู,ความหนาSE/ความยาว RB", "วงนอก SE/รูใน,หนา RB", "วงนอก RB", "ชื่อสินค้า", "แผนกผู้ผลิต(ที่เกี่ยวข้อง)", "จำนวนที่ใช้ต่อชุด", "ความยาว GR ตัด CM", "น้ำหนัก (กรัม)", "จำนวนชิ้น GR ที่ได้ต่อเส้น RB", "หน่วย", "จำนวนที่ได้ SE ต่อ 1 GR", "หน่วย", "หน่วยนับ", "น้ำหนักชิ้นงานท่อนยาว SE , RB"];
  const tsv = [row(["รายการเปลี่ยนแปลง", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "PK"]), row(masterHeader),
    row(["ACG-01-A", "1", "ACG-01-A", "PK", "-", "-", "-", "-", "-", "-", "สินค้า ACG-01(B)-A", "PK", "-", "-", "-", "-", "-", "-", "-", "ชุด / SET", "-"]),
    row(["ACG-01-A", "2", "SE-ACG01--210-14-19", "SE", "ACG01", "0", "210", "14", "19", "-", "ยางปลอก ACG", "SE", "2", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "40"]),
    row(["ACG-01-A", "3", "RB-A2003-02--212-14-19", "RB", "A2003", "02", "0", "212", "14", "19", "ยางกลมมีรู ACG", "RB", "2", "21", "CM", "10", "ชิ้น", "1", "ชิ้น", "ม้วน(50M)", "800"])].join("\n");
  const header = rules.detectHeader(rules.parseDelimited(tsv));
  assert.equal(header.rowIndex, 1);
  assert.equal(header.map.weight, 20, "weight is the 'ท่อนยาว' column, never column B");
  assert.equal(header.map.name, 10);
  const { items, boms } = rules.buildFromFlat(rules.readFlatRows(tsv));
  assert.equal(items.get("RB-A2003-02-212-14-19").rubber.kgPerRoll, 0.8);
  assert.equal(items.get("RB-A2003-02-212-14-19").uom, "roll");
  assert.equal(boms.get("SE-ACG01-210-14-19")[0].qty, 0.1);
  assert.throws(() => rules.readFlatRows("a\tb\n1\t2"), /ไม่พบแถวหัวคอลัมน์/);
  // CSV ที่มีเครื่องหมายคำพูดและจุลภาคในชื่อ
  const csv = `ITEM,CODE,NAME,รหัสแผนก,แผนกผู้ผลิต,จำนวนที่ใช้ต่อชุด,หน่วยนับ\nX-01,X-01,"สินค้า X, รุ่น ""A""",PK,PK,-,ชุด\nX-01,B01-001,สติ๊กเกอร์,ST,PK-ST,2,ชิ้น`;
  const flat = rules.readFlatRows(csv);
  assert.equal(flat[0].name, 'สินค้า X, รุ่น "A"');
  assert.equal(flat[1].qty, 2);
});

test("explosion reproduces the BOMSHEET numbers of a real order line and aggregates requirements across products", () => {
  // Megaform 26017: MEGA-ST-01(P)-Y × 80 → SE ลูกตอปิโด 3/ชุด → RB-B0006-02 ตัดได้ 31 ชิ้น/เส้น → ต้องเบิก 7.74 เส้น (BOMSHEET แสดง 7.74)
  const items = new Map([
    ["FG", { code: "FG", kind: "FG", name: "สินค้า", uom: "set", ownerDept: "PK" }],
    ["SE", { code: "SE", kind: "SE", name: "ลูกตอปิโด", uom: "pcs", ownerDept: "GR" }],
    ["RB", { code: "RB", kind: "RB", name: "เส้นยาง", uom: "rod", ownerDept: "RB" }],
    ["PT", { code: "PT", kind: "PT", name: "แกน", uom: "pcs", ownerDept: "PT" }],
    ["PEL", { code: "PEL", kind: "PURCHASED", name: "เม็ดพลาสติก", uom: "kg", ownerDept: "ST" }],
    ["BOX", { code: "BOX", kind: "PURCHASED", name: "กล่อง", uom: "box", ownerDept: "ST" }],
  ]);
  const boms = new Map([
    ["FG", { id: "B1", revision: 2, lines: [{ childCode: "SE", qty: 3 }, { childCode: "PT", qty: 0.3 }, { childCode: "BOX", qty: 0.025 }] }],
    ["SE", { id: "B2", revision: 1, lines: [{ childCode: "RB", qty: rules.rbPerSe({ pcsPerRoll: 31, sePerGr: 1 }) }] }],
    ["PT", { id: "B3", revision: 1, lines: [{ childCode: "PEL", qty: 0.02, scrapPct: 10 }] }],
  ]);
  const opts = { itemOf: (code) => items.get(code) ?? null, approvedBomOf: (code) => boms.get(code) ?? null };
  const { lines, missing } = rules.explode("FG", 80, opts);
  assert.deepEqual(missing, []);
  assert.deepEqual(lines.map((line) => [line.level, line.itemCode]), [[0, "FG"], [1, "SE"], [2, "RB"], [1, "PT"], [2, "PEL"], [1, "BOX"]], "depth-first like BOMSHEET");
  const rb = lines.find((line) => line.itemCode === "RB");
  assert.equal(rb.required.toFixed(2), "7.74");
  assert.equal(rb.producerDept, "RB");
  assert.deepEqual(rb.path, ["FG", "SE", "RB"]);
  assert.equal(rb.revision, null, "RB is a leaf of this BOM; its compound recipe lives in RubberFlow");
  assert.equal(rb.noBom, undefined, "a leaf RB is not flagged as missing a BOM");
  assert.equal(lines.find((line) => line.itemCode === "SE").revision, 1);
  assert.equal(lines[0].revision, 2);
  assert.equal(lines.find((line) => line.itemCode === "PEL").required.toFixed(3), (80 * 0.3 * 0.02 * 1.1).toFixed(3), "scrap percentage inflates the child quantity");
  // พ่อที่ต้องผลิตแต่ไม่มี BOM ถูกธง และวงจรถูกตัด
  boms.set("SE", { id: "B2", revision: 1, lines: [{ childCode: "RB", qty: 1 }, { childCode: "FG", qty: 1 }] });
  boms.delete("PT");
  const second = rules.explode("FG", 1, opts);
  assert.ok(second.missing.some((code) => code.includes("วงจร")));
  assert.equal(second.lines.find((line) => line.itemCode === "PT").noBom, true);
  // รวมความต้องการ: SE จากสองสินค้าถูกรวมเป็นงานเดียว
  const agg = rules.aggregateRequirements([...rules.explode("FG", 80, opts).lines.map((line) => ({ ...line, fgCode: "FG" })), ...rules.explode("FG", 20, opts).lines.map((line) => ({ ...line, fgCode: "FG2" }))]);
  const se = agg.find((entry) => entry.itemCode === "SE");
  assert.equal(se.required, 300);
  assert.deepEqual(se.fgCodes, ["FG", "FG2"]);
  assert.ok(!agg.some((entry) => entry.itemCode === "FG"), "the FG rows themselves are not requirements");
  assert.equal(rules.toMake(7.7419, 18), -10.2581);
  assert.equal(rules.toMake(10, undefined), 10);
});

test("CSV output quotes commas and quotes, and formatting helpers handle empty values", () => {
  const csv = rules.toCsv([["a", 'b "c"', "d,e"], [1, 0.5, ""], ["=SUM(A1)", "-0.86", -0.86, "@x"]]);
  assert.equal(csv, "﻿a,\"b \"\"c\"\"\",\"d,e\"\r\n1,0.5,\r\n'=SUM(A1),'-0.86,-0.86,'@x", "formula-looking text is prefixed, numbers are not");
  assert.equal(rules.fmtQty(7.7419), "7.74");
  assert.equal(rules.fmtQty(0.0323), "0.0323");
  assert.equal(rules.fmtQty(80), "80");
  assert.equal(rules.fmtQty(null), "-");
  assert.equal(rules.fmtDate(null), "-");
  assert.equal(rules.fmtDate(Date.UTC(2026, 5, 22, 5)), "22 มิ.ย. 69");
  assert.equal(rules.toInputDate(NaN), "");
  assert.ok(Number.isNaN(rules.fromInputDate("")));
  assert.equal(rules.orderTypeOf("Thailand"), "SA");
  assert.equal(rules.orderTypeOf("Belgium"), "EX");
});
