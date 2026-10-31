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
  assert.equal(lines.find((line) => line.itemCode === "PEL").qtyPerParent, 0.02 * 1.1, "quantity per parent (with scrap) travels with the line");
  assert.equal(lines[0].qtyPerParent, 1);
});

test("net requirements apply the BOMSHEET column AK rule level by level: SE stock is converted into rods before RB stock is subtracted", () => {
  // Megaform 25041, BOMSHEET แถว 16–19: MEGA-SL-01B(P)-Y × 1008 → SE บอล 68 มม. 1 ชิ้น/ชุด → RB-B0006-01 ตัดได้ 28 ชิ้น/เส้น (O = 1/28)
  const items = new Map([
    ["FG", { code: "FG", kind: "FG", name: "สินค้า", uom: "set", ownerDept: "PK" }],
    ["SE", { code: "SE", kind: "SE", name: "บอล 68 มม.", uom: "pcs", ownerDept: "GR" }],
    ["RB", { code: "RB", kind: "RB", name: "เส้นยาง", uom: "rod", ownerDept: "RB" }],
    ["BOX", { code: "BOX", kind: "PURCHASED", name: "กล่อง", uom: "box", ownerDept: "ST" }],
  ]);
  const boms = new Map([
    ["FG", { id: "B1", revision: 1, lines: [{ childCode: "SE", qty: 1 }, { childCode: "BOX", qty: 1 / 12 }] }],
    ["SE", { id: "B2", revision: 1, lines: [{ childCode: "RB", qty: 1 / 28 }] }],
  ]);
  const opts = { itemOf: (code) => items.get(code) ?? null, approvedBomOf: (code) => boms.get(code) ?? null };
  const explode = (qty) => rules.explode("FG", qty, opts).lines;
  const byCode = (entries) => Object.fromEntries(entries.map((entry) => [entry.itemCode, entry]));
  // แถว 16–17: สต๊อก SE 416 → GR ต้องตัด 592 → RB ต้องรีด 592/28 = 21.14 (ชีตแสดง 21.142857)
  let net = byCode(rules.netRequirements(explode(1008), { SE: 416 }));
  assert.equal(net.SE.required, 1008);
  assert.equal(net.SE.stock, 416);
  assert.equal(net.SE.toMake, 592);
  assert.equal(net.RB.required.toFixed(4), "21.1429", "RB demand comes from the SE shortage, not the full SE requirement");
  assert.equal(net.RB.stock, undefined, "not counted");
  assert.equal(net.RB.toMake, 21.1429);
  assert.equal(net.BOX.toMake, 84);
  assert.equal(net.FG.dept, "PK");
  assert.equal(net.FG.required, 1008);
  assert.deepEqual(net.RB.parents, [{ code: "SE", qtyPerParent: 1 / 28 }]);
  assert.deepEqual(net.SE.children.map((child) => child.code), ["RB"]);
  // แถว 18–19: สต๊อก SE 976 สต๊อก RB 9 → ชีตให้ AK = 32/28 − 9 = −7.857 (ของเกิน) → ที่นี่ ต้องรีด 0 และของเกิน 7.857
  net = byCode(rules.netRequirements(explode(1008), { SE: 976, RB: 9 }));
  assert.equal(net.RB.required.toFixed(4), "1.1429");
  assert.equal(net.RB.net.toFixed(4), "-7.8571");
  assert.equal(net.RB.toMake, 0);
  assert.equal(net.RB.surplus, 7.8571);
  // สต๊อก SE เกินความต้องการ: ไม่ส่งค่าติดลบลงไปที่ RB (ต่างจาก Excel โดยตั้งใจ)
  net = byCode(rules.netRequirements(explode(1008), { SE: 1200 }));
  assert.equal(net.SE.toMake, 0);
  assert.equal(net.SE.surplus, 192);
  assert.equal(net.RB.required, 0);
  assert.equal(net.RB.toMake, 0);
  // ไม่นับเลย = ต้องผลิตเต็มจำนวน และสองสินค้าที่ใช้ SE เดียวกันรวมความต้องการก่อนหักคงคลังครั้งเดียว
  net = byCode(rules.netRequirements([...explode(1008), ...explode(500).map((line) => ({ ...line, fgCode: "FG2" }))], { SE: 1000 }));
  assert.equal(net.SE.required, 1508);
  assert.equal(net.SE.toMake, 508);
  assert.deepEqual(net.SE.fgCodes, ["FG", "FG2"]);
  assert.equal(net.RB.required.toFixed(4), (508 / 28).toFixed(4));
  assert.equal(net.FG.required, 1508, "the same FG code twice adds up (the order merges lines, this is a guard)");
  // ค่าที่นับเป็นข้อความว่าง/null = ยังไม่นับ · คงคลังของตัว FG ไม่ถูกใช้ (ต้องผลิตครบจำนวนสั่ง)
  net = byCode(rules.netRequirements(explode(10), { SE: "", RB: null, FG: 7 }));
  assert.equal(net.SE.stock, undefined);
  assert.equal(net.RB.stock, undefined);
  assert.equal(net.FG.stock, undefined);
  assert.equal(net.FG.toMake, 10);
  assert.equal(net.SE.required, 10);
  // จัดกลุ่มตามแผนก ต้นน้ำ → ปลายน้ำ ข้ามแผนกที่ไม่มีงาน
  const groups = rules.groupByDept(rules.netRequirements(explode(1008), {}));
  assert.deepEqual(groups.map((group) => group.dept), ["RB", "GR", "ST", "PK"]);
  assert.deepEqual(groups.find((group) => group.dept === "PK").entries.map((entry) => entry.itemCode), ["FG"]);
  assert.deepEqual(rules.FLOW_DEPTS, ["RB", "GR", "PT", "BG", "ST", "PK"]);
});

test("colour helpers: colour codes, colourless slot keys, recolouring codes and names, slots of a product and the change plan", () => {
  assert.deepEqual(rules.parseColorCode("or01"), { code: "OR01", master: "OR", shade: "01" });
  assert.equal(rules.parseColorCode("ORANGE"), null);
  assert.equal(rules.colorName("OR01"), "ส้ม 01");
  assert.equal(rules.colorName("OR01", [{ code: "OR01", name: "ส้มสด" }]), "ส้มสด");
  assert.equal(rules.colorName("ZZ09"), "ZZ 09");
  assert.equal(rules.colorOfCode("SE-TP01-OR01-100-18-65"), "OR01");
  assert.equal(rules.colorOfCode("RB-B0006-01-204-0-76"), "", "a rod code without a colour segment (BOMSHEET column X form)");
  assert.equal(rules.colorOfCode("P-BOX-01"), "");
  assert.equal(rules.colorSlotKey("SE-TP01-OR01-100-18-65"), "SE-TP01-*-100-18-65");
  assert.equal(rules.colorSlotKey("SE-SL01B-68-0-68"), "SE-SL01B-*-68-0-68", "a colourless SE has the same slot key as its coloured variants");
  assert.equal(rules.colorSlotKey("RB-DM01-02-OR01-202-18-70"), "RB-DM01-02-*-202-18-70");
  assert.equal(rules.colorSlotKey("PT-00320"), null);
  assert.equal(rules.recolorCode("SE-TP01-OR01-100-18-65", "rd01"), "SE-TP01-RD01-100-18-65");
  assert.equal(rules.recolorCode("SE-SL01B-68-0-68", "RD01"), "SE-SL01B-RD01-68-0-68", "a colourless code gains the colour segment");
  assert.equal(rules.recolorCode("RB-DM01-02-OR01-202-18-70", "RD01"), "RB-DM01-02-RD01-202-18-70");
  assert.equal(rules.recolorCode("PT-00320", "RD01"), "PT-00320");
  assert.equal(rules.recolorCode("SE-X-OR01-100-18-065", "RD01"), "SE-X-RD01-100-18-065", "numeric segments keep their original spelling");
  assert.equal(rules.recolorCode("SE-X-18-65X", "RD01"), "SE-X-18-65X", "a code whose tail is not three numbers is left alone");
  assert.equal(rules.colorSlotKey("SE-X-18-65X"), null);
  assert.equal(rules.colorSlotKey("RB-B0006-01-204-0-76"), "RB-B0006-01-*-204-0-76");
  assert.equal(rules.recolorCode("RB-B0006-01-204-0-76", "RD01"), "RB-B0006-01-RD01-204-0-76");
  assert.equal(rules.renameColor("ยางแผ่นปีก เหลือง YE03", "YE03", "RD01", [{ code: "YE03", name: "เหลืองสด" }]), "ยางแผ่นปีก แดง RD01", "the standard master name is tried when the registered name is not in the text");
  assert.equal(rules.renameColor("ยาง แดง", "RD02", "RD01"), "ยาง แดง RD01", "a new shade of the same master keeps the Thai name once and adds the code");
  assert.equal(rules.renameColor("ยาง แดง RD02", "RD02", "RD01"), "ยาง แดง RD01");
  assert.equal(rules.colorOfCode("SE-TP01-OR01-100-18-65X"), "", "colorOfCode agrees with colorSlotKey: a non-numeric tail means no colour in the code");
  assert.equal(rules.colorOfCode("SE-TP01-OR01-100-18-065"), "OR01");
  assert.equal(rules.buildSeCode({ product: "TP01", color: "", lengthMm: 100, holeMm: 18, odMm: 65 }), "SE-TP01-100-18-65");
  assert.equal(rules.renameColor("ลูกตอปิโด TP-01 ส้ม OR01 ยาว 100", "OR01", "RD01"), "ลูกตอปิโด TP-01 แดง RD01 ยาว 100");
  assert.equal(rules.renameColor("ยางกลมตัน หัวตอปิโด Ø72", "OR01", "RD01"), "ยางกลมตัน หัวตอปิโด Ø72 แดง RD01", "no colour in the name → appended");
  assert.equal(rules.renameColor("บอล 68", "", "BL02", [{ code: "BL02", name: "ฟ้าอ่อน" }]), "บอล 68 ฟ้าอ่อน BL02");
  assert.equal(rules.renameColor("x OR01", "OR01", "OR01"), "x OR01");
  // ช่องสีของสินค้า: SE/RB ชั้นแรกเรียงตามบรรทัด ซ้ำได้ RB ใต้ SE ไม่นับ
  const items = new Map([
    ["FG", { code: "FG", kind: "FG" }], ["SE-B-RD01-68-0-68", { code: "SE-B-RD01-68-0-68", kind: "SE", rubber: { color: "RD01" } }], ["SE-B-YE03-68-0-68", { code: "SE-B-YE03-68-0-68", kind: "SE", rubber: { color: "YE03" } }],
    ["RB-C1-01-BK01-200-0-5", { code: "RB-C1-01-BK01-200-0-5", kind: "RB", rubber: { color: "BK01" } }], ["BOX", { code: "BOX", kind: "PURCHASED" }], ["RB-C1-02-RD01-100-9-25", { code: "RB-C1-02-RD01-100-9-25", kind: "RB" }],
  ]);
  const boms = new Map([
    ["FG", { lines: [{ childCode: "SE-B-RD01-68-0-68", qty: 1 }, { childCode: "SE-B-YE03-68-0-68", qty: 1 }, { childCode: "RB-C1-01-BK01-200-0-5", qty: 2 }, { childCode: "BOX", qty: 0.1 }] }],
    ["SE-B-RD01-68-0-68", { lines: [{ childCode: "RB-C1-02-RD01-100-9-25", qty: 0.04 }] }],
  ]);
  const opts = { itemOf: (code) => items.get(code) ?? null, approvedBomOf: (code) => boms.get(code) ?? null };
  const slots = rules.colorSlotsOf("FG", opts);
  assert.deepEqual(slots, [
    { key: "SE-B-*-68-0-68", color: "RD01", itemCode: "SE-B-RD01-68-0-68", lineIndex: 0 },
    { key: "SE-B-*-68-0-68", color: "YE03", itemCode: "SE-B-YE03-68-0-68", lineIndex: 1 },
    { key: "RB-C1-01-*-200-0-5", color: "BK01", itemCode: "RB-C1-01-BK01-200-0-5", lineIndex: 2 },
  ]);
  assert.deepEqual(rules.colorSlotsOf("NOPE", opts), []);
  // แผนเปลี่ยนสี: ช่องซ้ำจับคู่ตามลำดับ สีเดิมข้าม ช่องที่ชุดสีไม่กำหนดรายงาน
  const { plan, unmatched } = rules.colorChangePlan(slots, [{ key: "SE-B-*-68-0-68", color: "bl02" }, { key: "SE-B-*-68-0-68", color: "YE03" }]);
  assert.deepEqual(plan, [{ lineIndex: 0, from: "SE-B-RD01-68-0-68", to: "SE-B-BL02-68-0-68", color: "BL02", fromColor: "RD01" }]);
  assert.deepEqual(unmatched.map((slot) => slot.itemCode), ["RB-C1-01-BK01-200-0-5"]);
  assert.deepEqual(rules.colorChangePlan(slots, []).plan, []);
  assert.equal(Object.keys(rules.COLOR_MASTERS).length >= 12, true);
});

test("a BOMSHEET paste is read too, and the แม่สี/เฉดที่ columns turn a colourless SE/RB code into one item per colour", () => {
  // หัว BOMSHEET จริง (B–AF บางส่วน) และแถว 16–21 ของใบ 25041: บอล 68 มม. สามสี SE รหัสเดียวกัน (ไม่มีสี) RB รหัสเดียวกัน
  const H = ["ITEM  สินค้า", "จำนวนสั่งFG", "รหัส FG/RB/SE/ST/PT/BG", "รหัสแผนก", "สินค้า/สูตรยาง", "สีSE/ประเภทยาง", "ความยาวSE/สีRB", "รู,ความหนา/ความยาวRB", "วงนอกSE/รูในRB", "วงนอกRB", "จำนวนGRตัดได้", "จำนวนSE/ST/PT/BG:1FG", "แม่สี", "เฉดที่", "แม่สี", "เฉดที่", "แม่สี", "เฉดที่", "ความยาว GR ตัด / CM", "จำนวน SE ที่ได้ : 1 GR", "ชื่อวัตถุดิบในการผลิต", "แผนกผู้ผลิต", "หน่วยวัสดุ"];
  const r = (cells) => cells.join("\t");
  const fg = ["MEGA-SL-01B(P)-Y", "1008", "MEGA-SL-01B", "PK", "-", "-", "-", "-", "-", "-", "-", "-", "", "", "", "", "", "", "-", "-", "สินค้า SL-01B", "PK", "ชุด / SET"];
  const se = (m, s, name) => ["MEGA-SL-01B(P)-Y", "1008", "SE-SL01B--68-0-68", "SE", "SL01B", "0", "68", "0", "68", "-", "-", "1", m, s, "XX", "XX", "XX", "XX", "-", "-", name, "SE", "ชิ้น/pcs"];
  const rb = (m, s) => ["MEGA-SL-01B(P)-Y", "1008", "RB-B0006-01- -204-0-76", "RB", "B0006", "01", "", "204", "0", "76", "28", "1", m, s, "XX", "XX", "XX", "XX", "7.2", "1", "ยางกลมตัน บอล 68,70mm เจียร์", "RB", "ชิ้น/pcs"];
  const dot = [".", "0", ".", "", "", "", "", "", "", "", ".", ".", "", "", "", "", "", "", ".", ".", ".", "", "."];
  const text = [r(H), r(dot), r(fg), r(se("RD", "01", "บอล 68,70mm ลายเรียบ แดง RD01")), r(rb("RD", "01")), r(se("YE", "3", "บอล 68,70mm ลายเรียบ เหลือง YE03")), r(rb("YE", "03")), r(se("BL", "02", "บอล 68,70mm ลายเรียบ ฟ้า BL02")), r(rb("BL", "02"))].join("\n");
  const flat = rules.readFlatRows(text);
  assert.equal(flat.length, 7, "the '.' spacer row of BOMSHEET is skipped");
  assert.deepEqual(flat.map((row) => row.color), ["", "RD01", "RD01", "YE03", "YE03", "BL02", "BL02"], "shade 3 is padded to 03, XX pairs are ignored");
  assert.equal(flat[1].qty, 1, "จำนวนSE/ST/PT/BG:1FG is the quantity per set");
  assert.equal(flat[2].pcsPerRoll, 28, "จำนวนGRตัดได้ is the pieces per rod");
  assert.equal(flat[2].uom, "ชิ้น/pcs", "หน่วยวัสดุ is the unit");
  const built = rules.buildFromFlat(flat);
  const codes = [...built.items.keys()];
  assert.ok(["SE-SL01B-RD01-68-0-68", "SE-SL01B-YE03-68-0-68", "SE-SL01B-BL02-68-0-68", "RB-B0006-01-RD01-204-0-76", "RB-B0006-01-YE03-204-0-76", "RB-B0006-01-BL02-204-0-76"].every((code) => codes.includes(code)), codes.join(" "));
  assert.ok(!codes.includes("SE-SL01B-68-0-68"), "no colourless SE left over");
  assert.equal(built.report.colored, 6);
  assert.deepEqual(built.boms.get("MEGA-SL-01B(P)-Y").map((line) => [line.childCode, line.qty]), [["SE-SL01B-RD01-68-0-68", 1], ["SE-SL01B-YE03-68-0-68", 1], ["SE-SL01B-BL02-68-0-68", 1]], "three colour slots, not one SE with quantity 3");
  assert.deepEqual(built.boms.get("SE-SL01B-YE03-68-0-68").map((line) => line.childCode), ["RB-B0006-01-YE03-204-0-76"], "each coloured SE gets its own coloured rod");
  assert.equal(built.boms.get("SE-SL01B-RD01-68-0-68")[0].qty.toFixed(6), (1 / 28).toFixed(6));
  const redRod = built.items.get("RB-B0006-01-RD01-204-0-76");
  assert.equal(redRod.name, "ยางกลมตัน บอล 68,70mm เจียร์ แดง RD01", "a rod name without a colour gets the colour appended");
  assert.equal(redRod.rubber.color, "RD01");
  assert.ok(redRod.legacyCodes.includes("RB-B0006-01- -204-0-76"), "the sheet spelling is kept for search");
  assert.equal(built.items.get("SE-SL01B-RD01-68-0-68").name, "บอล 68,70mm ลายเรียบ แดง RD01", "a name that already carries the colour is kept");
  assert.equal(built.items.get("SE-SL01B-RD01-68-0-68").rubber.color, "RD01");
  assert.equal(built.report.variants, 0, "the colourless sheet code kept as a legacy code is not counted as a spelling variant");
  // เฉดว่างไม่กลายเป็น 00 · สองสี · ชื่อที่มีสีไทยอยู่แล้วต่อเฉพาะรหัส
  const two = rules.readFlatRows([r(H), r(fg), r(se("RD", "", "บอล แดง")), r(["MEGA-SL-01B(P)-Y", "1008", "SE-SL01B--68-0-68", "SE", "SL01B", "0", "68", "0", "68", "-", "-", "1", "YE", "03", "BK", "1", "XX", "XX", "-", "-", "บอลสองสี", "SE", "ชิ้น/pcs"]), r(se("RD", "01", "บอล แดง"))].join(String.fromCharCode(10)));
  assert.deepEqual(two.map((row) => row.color), ["", "", "YE03-BK01", "RD01"]);
  const twoBuilt = rules.buildFromFlat(two);
  assert.equal(twoBuilt.items.get("SE-SL01B-YE03-BK01-68-0-68").name, "บอลสองสี เหลือง-ดำ YE03-BK01");
  assert.equal(twoBuilt.items.get("SE-SL01B-RD01-68-0-68").name, "บอล แดง RD01", "a Thai colour name already in the text is not repeated");
  const latin = rules.buildFromFlat(rules.readFlatRows([r(H), r(fg), r(se("RD", "01", "Plastic ball pcs")), r(se("ZZ", "01", "Glass ball  x"))].join(String.fromCharCode(10))));
  assert.equal(latin.items.get("SE-SL01B-RD01-68-0-68").name, "Plastic ball pcs แดง RD01", "lower-case s is kept, spaces are collapsed");
  assert.equal(latin.items.get("SE-SL01B-ZZ01-68-0-68").name, "Glass ball x ZZ01", "an unknown master adds only the code");
  // ชีต DATA (ไม่มีคอลัมน์ แม่สี) อ่านเหมือนเดิม
  assert.equal(rules.readFlatRows(PI_TSV).every((row) => row.color === ""), true);
});

test("BOMSHEET of 25047: a header row with another code is still the FG, zero repeat rows are not conflicts, ใบ and ถัง(18 kg) are known units", () => {
  const H = ["ITEM  สินค้า", "จำนวนสั่งFG", "รหัส FG/RB/SE/ST/PT/BG", "รหัสแผนก", "จำนวนSE/ST/PT/BG:1FG", "ชื่อวัตถุดิบในการผลิต", "แผนกผู้ผลิต", "หน่วยวัสดุ"];
  const r = (cells) => cells.join("\t");
  // แถว 246–249: แถวหัวใช้รหัสลูกค้า SPORTIME-ENC-3 · แถว 41: แถวหัว MEGA-BBL-06(P) ของ ITEM MEGA-BBL-06(P)-Y
  // แถว 384–386: แผ่นพลาสติกใส C20-020 แถวแรกเก็บพื้นที่รวม แถวถัดไปเป็น 0 · แถว 347: สีสกรีน ถัง(18 kg)
  const rows = [
    ["MEGA-ENC-3(P)-Y", "864", "SPORTIME-ENC-3", "PK", "", "สินค้า ENC-3 แพ็ค 3 ลูก", "PK", "ชุด / SET"],
    ["MEGA-ENC-3(P)-Y", "864", "B01-690", "ST", "1", "คู่มือวิธีการเล่น", "PK-ST", "ใบ"],
    ["MEGA-ENC-3(P)-Y", "864", "B28-005", "ST", "0.05", "สีสกรีน สีดำ # 47010", "PK-ST", "ถัง(18 kg)"],
    ["MEGA-BBL-06(P)-Y", "36", "MEGA-BBL-06(P) ", "PK", "", "สินค้า MEGA-BBL-06(P) KK เหลือง-ม่วง", "PK", "ชุด / SET"],
    ["MEGA-BBL-06(P)-Y", "36", "PT-00534", "ST", "1", "บอลพลาสติก 150mm", "PK-PT", "ลูก( 260g )"],
    ["MEGA-MAM-03(B)-Y", "300", "MEGA-MAM-03", "PK", "", "สินค้า Megaform-MAM-03(B)", "PK", "ชุด / SET"],
    ["MEGA-MAM-03(B)-Y", "300", "B02-038", "ST", "1", "กระเป๋า MAM-03", "PK-BG", "ชิ้น/pcs"],
    ["MEGA-MAM-03(B)-Y", "300", "C20-020", "ST", "0.0018852157943067033", "ม้วนพลาสติกใส ( แผ่นหน้า-หลัง )", "BG-ST", "ม้วน(100Y)"],
    ["MEGA-MAM-03(B)-Y", "300", "C20-020", "ST", "0", "ม้วนพลาสติกใส ( แผ่นคู่ซิป )", "BG-ST", "ม้วน(100Y)"],
    ["MEGA-MAM-03(B)-Y", "300", "C20-020", "ST", "0", "ม้วนพลาสติกใส ( แผ่นข้าง )", "BG-ST", "ม้วน(100Y)"],
  ];
  const built = rules.buildFromFlat(rules.readFlatRows([r(H), ...rows.map(r)].join("\n")));
  const fgs = [...built.items.values()].filter((item) => item.kind === "FG").map((item) => item.code);
  assert.deepEqual(fgs, ["MEGA-ENC-3(P)-Y", "MEGA-BBL-06(P)-Y", "MEGA-MAM-03(B)-Y"], "the header row is not a second FG");
  assert.equal(built.items.get("MEGA-ENC-3(P)-Y").name, "สินค้า ENC-3 แพ็ค 3 ลูก", "the header row names the FG");
  assert.ok(built.items.get("MEGA-ENC-3(P)-Y").legacyCodes.includes("SPORTIME-ENC-3"), "the customer code is kept for search");
  assert.ok(built.items.get("MEGA-BBL-06(P)-Y").legacyCodes.includes("MEGA-BBL-06(P)"));
  assert.deepEqual(built.boms.get("MEGA-ENC-3(P)-Y").map((line) => line.childCode), ["B01-690", "B28-005"]);
  assert.deepEqual(built.boms.get("MEGA-BBL-06(P)-Y").map((line) => line.childCode), ["PT-00534"]);
  assert.equal(built.items.get("B01-690").uom, "pcs");
  assert.equal(built.items.get("B28-005").uom, "bucket");
  assert.deepEqual(rules.normalizeUom("ถัง(18 kg)").pack, { qty: 18, unit: "kg" });
  assert.deepEqual([...built.report.unknownUom], []);
  assert.deepEqual(built.boms.get("B02-038").map((line) => [line.childCode, line.qty]), [["C20-020", 0.001885215794]], "the first row holds the total area (rounded to 12 places per parent)");
  assert.deepEqual(built.report.conflicts, [], "zero repeat rows are description rows, not conflicts");
  // แถวแรกเป็น 0 แล้วแถวหลังมีปริมาณ: ใช้ปริมาณของแถวหลัง
  const zeroFirst = rules.buildFromFlat(rules.readFlatRows([r(H), ...[rows[5], rows[6], rows[8], rows[7]].map(r)].join("\n")));
  assert.equal(zeroFirst.boms.get("B02-038")[0].qty, 0.001885215794);
  assert.deepEqual(zeroFirst.report.conflicts, []);
});

test("PI numbers follow the Excel pattern, due dates default from lead times, and the station rule table selects the BOMSHEET rows per sheet", () => {
  const oct3 = new Date(2025, 9, 3, 10).getTime();
  assert.equal(rules.piNumber(oct3, 41), "251003-25041", "Megaform 25041: ordered 3 Oct 2025, 41st order of 2025");
  assert.equal(rules.piNumber(new Date(2026, 0, 7).getTime(), 3), "260107-26003");
  assert.equal(rules.piYear(oct3), "25");
  // ใบ 25041: WH 28 ม.ค. 2569 → PK 27 · GR/PT/BG/ST 21 · RB 17
  const wh = new Date(2026, 0, 28).getTime();
  const due = rules.defaultDueDates(wh);
  const dayOf = (ms) => new Date(ms).getDate();
  assert.deepEqual(Object.fromEntries(Object.entries(due).map(([dept, ms]) => [dept, dayOf(ms)])), { RB: 17, GR: 21, PT: 21, BG: 21, ST: 21, PK: 27 });
  assert.deepEqual(rules.defaultDueDates(NaN), {});
  assert.deepEqual(rules.LEAD_DAYS, { PK: 1, GR: 6, PT: 6, BG: 6, ST: 6, RB: 4 });
  // คู่ผู้ผลิตแบบคอลัมน์ AF
  assert.equal(rules.producerPair({ level: 0, kind: "FG" }), "PK");
  assert.equal(rules.producerPair({ level: 1, kind: "RB" }, "GR"), "RB");
  assert.equal(rules.producerPair({ level: 1, kind: "PT" }, "PK"), "PK-PT");
  assert.equal(rules.producerPair({ level: 2, kind: "PURCHASED" }, "PT"), "PT-ST");
  assert.equal(rules.producerPair({ level: 2, kind: "PURCHASED" }, "BG"), "BG-ST");
  assert.equal(rules.producerPair({ level: 1, kind: "SUBPART" }, "PK"), "PK-PK");
  assert.equal(rules.producerPair({ level: 1, kind: "BG" }, "PK"), "BG");
  // ใบแต่ละสถานีเลือกบรรทัดตามตารางกฎ (ไม่ใช่สูตร IF 8 คอลัมน์)
  const items = new Map([
    ["FG", { code: "FG", kind: "FG", name: "สินค้า", uom: "set", ownerDept: "PK" }], ["SE", { code: "SE", kind: "SE", name: "ลูก", uom: "pcs", ownerDept: "GR" }], ["RB", { code: "RB", kind: "RB", name: "เส้น", uom: "rod", ownerDept: "RB" }],
    ["PT", { code: "PT", kind: "PT", name: "แกน", uom: "pcs", ownerDept: "PT" }], ["PEL", { code: "PEL", kind: "PURCHASED", name: "เม็ด", uom: "kg", ownerDept: "ST" }], ["BOX", { code: "BOX", kind: "PURCHASED", name: "กล่อง", uom: "box", ownerDept: "ST" }],
    ["BG", { code: "BG", kind: "BG", name: "กระเป๋า", uom: "pcs", ownerDept: "BG" }], ["FAB", { code: "FAB", kind: "PURCHASED", name: "ผ้า", uom: "yd", ownerDept: "ST" }], ["XP", { code: "XP", kind: "SUBPART", name: "ทำเอง", uom: "pcs", ownerDept: "PK" }],
  ]);
  const boms = new Map([
    ["FG", { id: "B1", revision: 1, lines: [{ childCode: "SE", qty: 3 }, { childCode: "PT", qty: 1 }, { childCode: "BOX", qty: 0.1 }, { childCode: "BG", qty: 1 }, { childCode: "XP", qty: 1 }] }],
    ["SE", { id: "B2", revision: 1, lines: [{ childCode: "RB", qty: 0.05 }] }], ["PT", { id: "B3", revision: 1, lines: [{ childCode: "PEL", qty: 0.02 }] }], ["BG", { id: "B4", revision: 1, lines: [{ childCode: "FAB", qty: 0.5 }] }],
  ]);
  const lines = rules.explode("FG", 10, { itemOf: (code) => items.get(code) ?? null, approvedBomOf: (code) => boms.get(code) ?? null }).lines.map((line) => ({ ...line, fgQty: 10 }));
  const codes = (id) => rules.sheetLines(rules.sheetOf(id), lines).map((line) => `${line.itemCode}:${line.pair}`);
  assert.deepEqual(codes("RB"), ["FG:PK", "RB:RB"]);
  assert.deepEqual(codes("GR"), ["FG:PK", "SE:SE", "RB:RB"]);
  assert.deepEqual(codes("SE"), ["FG:PK", "SE:SE"]);
  assert.deepEqual(codes("PT"), ["FG:PK", "PT:PK-PT"]);
  assert.deepEqual(codes("ST01"), ["FG:PK", "BOX:PK-ST", "BG:BG"]);
  assert.deepEqual(codes("ST02"), ["FG:PK", "SE:SE", "RB:RB", "PT:PK-PT", "BOX:PK-ST", "BG:BG"]);
  assert.deepEqual(codes("BG"), ["FG:PK", "BG:BG"]);
  assert.deepEqual(codes("PK"), ["FG:PK", "SE:SE", "PT:PK-PT", "BOX:PK-ST", "BG:BG"]);
  assert.deepEqual(codes("ASK"), ["FG:PK", "SE:SE", "RB:RB"]);
  assert.deepEqual(codes("WIP-RBGR"), ["SE:SE", "RB:RB"]);
  assert.deepEqual(codes("WIP-PTBG"), ["FG:PK", "PT:PK-PT", "PEL:PT-ST", "BOX:PK-ST", "BG:BG", "FAB:BG-ST", "XP:PK-PK"]);
  assert.equal(rules.sheetOf("nope"), null);
  assert.equal(rules.sheetOf("wip-rbgr").layout, "wip-rbgr");
  assert.equal(rules.SHEETS.length, 11);
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

test("the product structure rolls up material, labour and minutes per department, and flags parts without a cost", () => {
  const items = {
    FG: { code: "FG", name: "สินค้า", kind: "FG", uom: "set", ownerDept: "PK" },
    SE: { code: "SE", name: "ชิ้นยาง", kind: "SE", uom: "pcs", ownerDept: "GR" },
    RB: { code: "RB", name: "เส้นยาง", kind: "RB", uom: "rod", ownerDept: "RB", unitCost: 100 },
    BOX: { code: "BOX", name: "กล่อง", kind: "PURCHASED", uom: "box", ownerDept: "ST", unitCost: 20 },
    XP: { code: "XP", name: "ชิ้นไม่มีราคา", kind: "SUBPART", uom: "pcs", ownerDept: "PK" },
  };
  const boms = {
    FG: { revision: 2, lines: [{ childCode: "SE", qty: 3 }, { childCode: "BOX", qty: 0.25, scrapPct: 4 }] },
    SE: { revision: 1, lines: [{ childCode: "RB", qty: 0.1 }] },
  };
  const routings = { FG: { revision: 1, steps: [{ processCode: "PK-ASM", minutesPerPc: 2 }] }, SE: { revision: 3, steps: [{ processCode: "GR-CUT", minutesPerPc: 0.4 }] } };
  const processes = Object.fromEntries(rules.DEFAULT_PROCESSES.map((entry) => [entry.code, entry]));
  const deps = { itemOf: (code) => items[code] ?? null, approvedBomOf: (code) => boms[code] ?? null, routingOf: (code) => routings[code] ?? null, processOf: (code) => processes[code] ?? null };
  const tree = rules.structureTree("FG", deps);
  assert.deepEqual(tree.rows.map((row) => [row.itemCode, row.level]), [["FG", 0], ["SE", 1], ["RB", 2], ["BOX", 1]]);
  const se = tree.rows[1];
  assert.equal(se.material, 10, "0.1 rod × 100");
  assert.equal(se.labor, 1, "0.4 min × 2.5 baht/min (GR)");
  assert.equal(se.unitCost, 11);
  assert.equal(tree.rows[3].qtyPerRoot, 0.26, "scrap is added to the quantity per product");
  assert.equal(tree.root.material, 3 * 11 + 0.26 * 20);
  assert.equal(tree.root.labor, 4, "2 min × 2 baht/min (PK)");
  assert.equal(tree.root.complete, true);
  assert.deepEqual(tree.minutesByDept, { PK: 2, GR: 1.2 }, "SE minutes count three times per product");
  assert.equal(tree.totalMinutes, 3.2);
  assert.deepEqual(tree.missingCost, []);
  // มุมมองลำดับผลิต: ลูกที่มี BOM/ขั้นตอนเป็นสายป้อน · ลูกเข้าที่ขั้นที่ระบุ ที่เหลือเข้าขั้นแรก · ไม่มีขั้นตอน = ขั้นเดียว
  routings.FG.steps = [{ processCode: "PK-ASM", minutesPerPc: 2, inputs: ["SE"] }, { processCode: "PK-PACK", minutesPerPc: 1, inputs: ["BOX", "GONE"] }];
  const staged = rules.structureTree("FG", deps);
  const flow = rules.flowOf(staged.root);
  assert.deepEqual(flow.feeds.map((feed) => feed.itemCode), ["SE"]);
  assert.deepEqual(flow.stages.map((stage) => [stage.step.processCode, stage.inputs.map((child) => child.itemCode)]), [["PK-ASM", ["SE"]], ["PK-PACK", ["BOX"]]]);
  routings.FG.steps = [{ processCode: "PK-ASM", minutesPerPc: 2 }];
  assert.deepEqual(rules.flowOf(rules.structureTree("FG", deps).root).stages.map((stage) => stage.inputs.length), [2], "unplaced parts enter at the first step");
  assert.deepEqual(rules.flowOf(rules.structureTree("FG", deps).rows[2]).stages.map((stage) => stage.step), [null], "a part without steps is one unnamed stage");
  // ชิ้นที่ไม่มี BOM และไม่มีราคา ทำให้ต้นทุนของพ่อทุกชั้นไม่ครบ · รหัสที่ไม่มีใน item master และวงจรถูกรายงาน
  boms.FG.lines.push({ childCode: "XP", qty: 1 }, { childCode: "GONE", qty: 1 });
  boms.SE.lines.push({ childCode: "FG", qty: 1 });
  const broken = rules.structureTree("FG", deps);
  assert.equal(broken.root.complete, false);
  assert.equal(broken.rows.find((row) => row.itemCode === "SE").complete, false, "the cycle back to FG makes SE incomplete");
  assert.deepEqual(broken.missingCost, ["XP"]);
  assert.deepEqual(broken.missing, ["FG (วงจร)", "GONE"]);
});
