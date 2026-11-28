import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// ต้นทุนการผลิต (modules/cost-rules.js): ใครเห็นราคา/ต้นทุน · ราคาที่มีผลในวันหนึ่ง · ต้นทุนสูตร (ทั้งสูตรน้ำหนักและสูตร PHR เดิม) · ต้นทุนจริงของล็อตผสมเทียบสูตร
const C = createRequire(import.meta.url)("../../modules/cost-rules.js");

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ได้ ${actual} ควรเป็น ${expected}`);
// เวลาไทย (UTC+7): วันที่ y-m-d เวลา h:mm → ms
const bkk = (y, m, d, h = 12, min = 0) => Date.UTC(y, m - 1, d, h - 7, min);

// สูตร DEMO-W01 (โหมดน้ำหนัก): เตรียมวัตถุดิบ (kg) · ขั้น 1 (กรัม) · ขั้น 2 · ขั้น 3 · kg = กิโลกรัมต่อ batch เสมอ (unit เป็นหน่วยที่กรอก)
const w = (materialCode, stage, kg, unit = "kg") => ({ materialCode, stage, kg, unit, phr: 0 });
const DEMO = {
  id: "DEMO-W01", revision: 1, status: "approved", productCode: "FG-91", batchKg: 75.6,
  items: [
    w("DM-RUB-A", 0, 11), w("DM-RUB-B", 0, 4), w("DM-FIL-A", 0, 9), w("DM-FIL-B", 0, 14), w("DM-PLS-A", 0, 12), w("DM-OIL-A", 0, 6), w("DM-FIL-C", 0, 15),
    w("DM-CH-01", 1, 0.35, "g"), w("DM-CH-02", 1, 0.15, "g"), w("DM-CH-03", 1, 0.8, "g"), w("DM-CH-04", 1, 0.12, "g"), w("DM-CH-05", 1, 0.09, "g"), w("DM-CH-06", 1, 0, "g"), w("DM-CH-07", 1, 0, "g"),
    w("DM-CH-08", 2, 0.9), w("DM-CH-09", 2, 1.6), w("DM-CH-10", 2, 0.18),
    w("DM-CH-11", 3, 0.31), w("DM-CH-12", 3, 0.075), w("DM-CH-13", 3, 0.025),
  ],
};
// ขั้น 1 กรอกเป็นกรัม 350 / 150 / 800 / 120 / 90 g (+ 0 / 0) = 1510 g = 1.51 kg ต่อ batch
const ALL_CODES = DEMO.items.map((item) => item.materialCode);
const row = (materialCode, unitPrice, effectiveFrom = "2026-01-01", createdAt = 1, id = `${materialCode}-${createdAt}`, kind = "chem") => ({ id, kind, materialCode, unitPrice, effectiveFrom, note: "", createdAt, createdBy: "ทดสอบ" });
// ราคาสมมติ: ทุกตัว 10 บาท/kg ยกเว้น DM-CH-11 = 100 และ DM-CH-13 = 1000 · ไม่มีราคา DM-FIL-C และ DM-CH-05 (เหมือนข้อมูลสาธิตของฮาร์เนส)
const PRICES = ALL_CODES.filter((code) => !["DM-FIL-C", "DM-CH-05"].includes(code)).map((code) => row(code, code === "DM-CH-11" ? 100 : code === "DM-CH-13" ? 1000 : 10));
const FULL = [...PRICES, row("DM-FIL-C", 10), row("DM-CH-05", 10)];

// ---------- น้ำหนักตามสูตร ----------
test("DEMO-W01: น้ำหนักต่อ batch 75.6 kg และน้ำหนักต่อขั้น 71 / 1.51 / 2.68 / 0.41", () => {
  const weights = C.recipeWeights(DEMO);
  assert.equal(weights.length, 20);
  assert.deepEqual(weights.find((line) => line.materialCode === "DM-CH-01"), { materialCode: "DM-CH-01", stage: 1, kg: 0.35, unit: "g" });
  const cost = C.formulaCost(DEMO, FULL, "2026-11-27");
  close(cost.batchKg, 75.6, "batchKg");
  assert.deepEqual(cost.parts.map((part) => part.stage), [0, 1, 2, 3]);
  assert.deepEqual(cost.parts.map((part) => part.label), ["ขั้นเตรียมวัตถุดิบ", "ขั้น 1", "ขั้น 2", "ขั้น 3"]);
  [71, 1.51, 2.68, 0.41].forEach((kg, index) => close(cost.parts[index].kg, kg, `ขั้น ${index}`));
});

// ---------- ต้นทุนสูตร ----------
test("ต้นทุนต่อ batch และต่อ kg ตามราคาที่มีผล", () => {
  const cost = C.formulaCost(DEMO, FULL, "2026-11-27");
  // ก่อนขั้น 3: 75.19 kg × 10 = 751.9 · ขั้น 3: 0.31 × 100 + 0.075 × 10 + 0.025 × 1000 = 56.75
  close(cost.cost, 808.65, "cost");
  close(cost.costPerKg, 808.65 / 75.6, "costPerKg");
  assert.equal(cost.complete, true);
  assert.deepEqual(cost.missing, []);
  // ต้นทุนแต่ละขั้นรวมกันเท่ากับต้นทุนทั้งสูตร
  close(cost.parts.reduce((sum, part) => sum + part.cost, 0), cost.cost, "parts");
  close(cost.parts[3].cost, 0.31 * 100 + 0.075 * 10 + 0.025 * 1000, "ขั้น 3");
});

test("เคมีที่ไม่มีราคา: รายการขาด · ยอดเป็นยอดบางส่วน · complete = false", () => {
  const cost = C.formulaCost(DEMO, PRICES, "2026-11-27");
  assert.equal(cost.complete, false);
  assert.deepEqual([...cost.missing].sort(), ["DM-CH-05", "DM-FIL-C"]);
  // ไม่รวม DM-FIL-C 15 kg และ DM-CH-05 0.09 kg (ราคา 10)
  close(cost.cost, 808.65 - 150 - 0.9, "partial cost");
  close(cost.batchKg, 75.6, "batchKg ยังเป็นของทั้งสูตร");
  const unpriced = cost.lines.filter((line) => line.cost === null);
  assert.deepEqual(unpriced.map((line) => line.materialCode).sort(), ["DM-CH-05", "DM-FIL-C"]);
  assert.ok(unpriced.every((line) => line.pricePerKg === null && line.share === null));
});

test("บรรทัดน้ำหนัก 0 ต้นทุน 0 และไม่เคยนับเป็นไม่มีราคา", () => {
  const cost = C.formulaCost(DEMO, PRICES.filter((entry) => !["DM-CH-06", "DM-CH-07"].includes(entry.materialCode)), "2026-11-27");
  const zero = cost.lines.filter((line) => ["DM-CH-06", "DM-CH-07"].includes(line.materialCode));
  assert.equal(zero.length, 2);
  assert.ok(zero.every((line) => line.kg === 0 && line.cost === 0 && line.pricePerKg === null));
  assert.ok(!cost.missing.includes("DM-CH-06") && !cost.missing.includes("DM-CH-07"));
});

test("รายการเรียงต้นทุนมากไปน้อย ไม่มีราคาไว้ท้าย และสัดส่วนรวมเป็น 1", () => {
  const cost = C.formulaCost(DEMO, PRICES, "2026-11-27");
  const priced = cost.lines.filter((line) => line.cost !== null);
  for (let index = 1; index < priced.length; index += 1) assert.ok(priced[index - 1].cost >= priced[index].cost);
  const firstUnpriced = cost.lines.findIndex((line) => line.cost === null);
  assert.ok(cost.lines.slice(firstUnpriced).every((line) => line.cost === null));
  close(priced.reduce((sum, line) => sum + line.share, 0), 1, "share");
  assert.equal(cost.lines[0].materialCode, "DM-FIL-B", "14 kg × 10 = 140 สูงสุดในบรรทัดที่มีราคา");
});

test("สูตรที่มี kg เพียงบางบรรทัดไม่ใช่โหมดน้ำหนัก (ตรงกับ rubberflow-rules): ใช้ phr ÷ Σphr × batchKg", () => {
  const mixed = { id: "RC-MIX", revision: 1, status: "approved", batchKg: 30, items: [{ materialCode: "EPDM-55", phr: 100, stage: 1, kg: 5 }, { materialCode: "S-80", phr: 50, stage: 1 }] };
  const weights = C.recipeWeights(mixed);
  close(weights[0].kg, 20, "EPDM = 100/150 × 30");
  close(weights[1].kg, 10, "S-80 = 50/150 × 30");
});

test("สูตรโหมดเดิม (PHR): น้ำหนักต่อ batch = phr ÷ Σphr × batchKg", () => {
  const legacy = { id: "RC-OLD", revision: 1, status: "approved", batchKg: 60, items: [{ materialCode: "EPDM-55", phr: 100, stage: 1 }, { materialCode: "CB-N550", phr: 50, stage: 1 }, { materialCode: "S-80", phr: 10, stage: 2 }] };
  const weights = C.recipeWeights(legacy);
  close(weights[0].kg, 37.5, "EPDM");
  close(weights[1].kg, 18.75, "CB");
  close(weights[2].kg, 3.75, "S-80");
  const cost = C.formulaCost(legacy, [row("EPDM-55", 100), row("CB-N550", 40), row("S-80", 200)], "2026-11-27");
  close(cost.batchKg, 60, "batchKg");
  close(cost.cost, 37.5 * 100 + 18.75 * 40 + 3.75 * 200, "cost");
  close(cost.costPerKg, cost.cost / 60, "per kg");
  assert.deepEqual(cost.parts.map((part) => part.label), ["ขั้น 1", "ขั้น 2"]);
  close(cost.parts[1].kg, 3.75, "ขั้น 2");
});

// ---------- ราคาที่มีผล ----------
test("priceAt: ประวัติราคา · แก้ในวันเดียวกัน (createdAt ใหม่สุดชนะ) · ราคาล่วงหน้ายังไม่ถูกใช้", () => {
  const history = [
    row("ZNO", 62, "2026-01-01", 1), row("ZNO", 68.5, "2026-10-01", 2), row("ZNO", 70, "2026-10-01", 3), row("ZNO", 80, "2027-01-01", 4), row("CBS", 5, "2026-06-01", 5),
  ];
  const at = (date) => C.priceAt(history, "ZNO", date)?.unitPrice ?? null;
  assert.equal(at("2025-12-31"), null, "ก่อนราคาแรก");
  assert.equal(at("2026-01-01"), 62);
  assert.equal(at("2026-09-30"), 62);
  assert.equal(at("2026-10-01"), 70, "วันเดียวกัน: แถวที่บันทึกล่าสุด");
  assert.equal(at("2026-11-27"), 70, "ราคาที่ตั้งล่วงหน้า (2027) ยังไม่ใช้");
  assert.equal(at("2027-01-01"), 80);
  assert.equal(C.priceAt(history, "NONE", "2026-11-27"), null);
  // ms แปลงเป็นวันตามเวลาไทย: 23:59 ของ 30 ก.ย. = 62 · 00:00 ของ 1 ต.ค. = 70
  assert.equal(at(bkk(2026, 9, 30, 23, 59)), 62);
  assert.equal(at(bkk(2026, 10, 1, 0, 0)), 70);
  // ลำดับของแถวที่ส่งมาไม่มีผล
  assert.equal(C.priceAt([...history].reverse(), "ZNO", "2026-10-01").unitPrice, 70);
  assert.equal(at("ไม่ใช่วันที่"), null);
});

test("ราคาแยกตามชนิด: ของซื้อกับเคมีรหัสเดียวกันไม่ปนกัน · ต้นทุนสูตรใช้เฉพาะราคาเคมี", () => {
  const prices = [row("ZNO", 62, "2026-01-01", 1), row("ZNO", 5, "2026-02-01", 2, "p-part", "part"), row("P-BOX-01", 4.5, "2026-01-01", 3, "p-box", "part")];
  assert.equal(C.priceAt(prices, "ZNO", "2026-11-27").unitPrice, 62, "เริ่มต้น = เคมี");
  assert.equal(C.priceAt(prices, "ZNO", "2026-11-27", "chem").unitPrice, 62);
  assert.equal(C.priceAt(prices, "ZNO", "2026-11-27", "part").unitPrice, 5);
  assert.equal(C.priceAt(prices, "P-BOX-01", "2026-11-27"), null, "รหัสของซื้อไม่ใช่เคมี");
  assert.equal(C.priceAt(prices, "P-BOX-01", "2026-11-27", "part").unitPrice, 4.5);
  assert.deepEqual([...C.pricesAt(prices, "2026-11-27", "part").keys()].sort(), ["P-BOX-01", "ZNO"]);
  assert.deepEqual([...C.pricesAt(prices, "2026-11-27").keys()], ["ZNO"]);
  assert.deepEqual(C.priceHistory(prices, "ZNO", "part").map((entry) => entry.unitPrice), [5]);
  assert.deepEqual(C.priceHistory(prices, "ZNO").map((entry) => entry.unitPrice), [62]);
  // แถวที่ไม่มี kind ถือเป็นเคมี
  assert.equal(C.priceAt([{ materialCode: "ZNO", unitPrice: 9, effectiveFrom: "2026-01-01", createdAt: 1 }], "ZNO", "2026-11-27").unitPrice, 9);
  // ต้นทุนสูตรไม่หยิบราคาของซื้อที่รหัสซ้ำกับเคมี (ราคาของซื้อใหม่กว่า)
  const recipe = { id: "R", revision: 1, status: "approved", batchKg: 10, items: [w("ZNO", 1, 10)] };
  assert.equal(C.formulaCost(recipe, prices, "2026-11-27").cost, 620);
  assert.deepEqual(C.formulaCost(recipe, [row("ZNO", 5, "2026-01-01", 1, "only-part", "part")], "2026-11-27").missing, ["ZNO"], "มีแต่ราคาของซื้อ = เคมียังไม่มีราคา");
  // ต้นทุนจริงของล็อตผสมก็ใช้เฉพาะราคาเคมี
  const lot = { lotNo: "L1", batches: 1, createdAt: Date.UTC(2026, 10, 1), requisitions: [{ id: "REQ", issuedAt: Date.UTC(2026, 10, 1), lines: [{ materialCode: "ZNO", stage: 1, targetKg: 10, actualKg: 10 }] }] };
  assert.equal(C.lotCost(lot, recipe, prices).actual, 620);
});

test("priceHistory: ใหม่ก่อน (วันมีผลแล้วเวลาที่บันทึก) · bangkokDay / dayKey / fmtDay", () => {
  const history = [row("ZNO", 62, "2026-01-01", 1), row("ZNO", 70, "2026-10-01", 3), row("ZNO", 68.5, "2026-10-01", 2), row("CBS", 5, "2026-06-01", 5)];
  assert.deepEqual(C.priceHistory(history, "ZNO").map((entry) => entry.unitPrice), [70, 68.5, 62]);
  assert.equal(C.bangkokDay(Date.UTC(2026, 8, 30, 17, 0)), "2026-10-01");
  assert.equal(C.dayKey("2026-10-01T05:00:00Z"), "2026-10-01");
  assert.equal(C.dayKey(null), "");
  assert.equal(C.fmtDay("2026-11-27"), "27 พ.ย. 2569");
  assert.equal(C.fmtDay(""), "-");
  assert.equal(C.fmtPrice(12.3), "12.30");
  assert.equal(C.fmtPrice(12.34567), "12.3457");
  assert.equal(C.fmtBaht(1234.5), "1,234.50");
});

test("ร้าน / ผู้ขาย: ราคาล่าสุดของแต่ละร้าน ถูกสุดก่อน · ไม่นับแถวที่ไม่ระบุร้าน · ชื่อร้านที่เคยใช้ · ราคาที่ใช้ไม่ดูร้าน", () => {
  const at = (materialCode, unitPrice, effectiveFrom, createdAt, supplier, kind = "chem") => ({ ...row(materialCode, unitPrice, effectiveFrom, createdAt, `${materialCode}-${createdAt}`, kind), supplier });
  const prices = [
    at("ZNO", 62, "2026-01-01", 1, "ร้าน ข"), at("ZNO", 60, "2026-03-01", 2, " ร้าน ข "), at("ZNO", 70, "2026-10-01", 3, "ร้าน ก"), at("ZNO", 65, "2026-10-01", 4, "ร้าน ค"),
    at("ZNO", 50, "2026-11-01", 5, ""), at("ZNO", 59, "2026-02-01", 6, "ร้าน ง"), at("ZNO", 59, "2026-02-01", 7, "ร้าน จ"), at("ZNO", 58, "2026-02-01", 8, "ร้าน จ"),
    at("ZNO", 1, "2026-01-01", 9, "ร้าน ก", "part"), at("CBS", 5, "2026-06-01", 10, "ร้าน ฉ"),
  ];
  const list = C.latestBySupplier(prices, "ZNO");
  // ร้าน ข: แถวล่าสุด (มี.ค. · ชื่อร้านตัดช่องว่าง) · ร้าน จ: วันเดียวกันใช้แถวที่บันทึกล่าสุด (58) · ไม่ระบุร้านไม่อยู่ในรายการ · ของซื้อรหัสเดียวกันไม่ปน
  assert.deepEqual(list.map(({ supplier, row: entry }) => [supplier, entry.unitPrice, entry.effectiveFrom]),
    [["ร้าน จ", 58, "2026-02-01"], ["ร้าน ง", 59, "2026-02-01"], ["ร้าน ข", 60, "2026-03-01"], ["ร้าน ค", 65, "2026-10-01"], ["ร้าน ก", 70, "2026-10-01"]]);
  // ราคาเท่ากัน: วันมีผลใหม่กว่าก่อน แล้วตามชื่อร้าน
  const tie = [at("X", 10, "2026-01-01", 1, "ร้าน ข"), at("X", 10, "2026-05-01", 2, "ร้าน ค"), at("X", 10, "2026-01-01", 3, "ร้าน ก")];
  assert.deepEqual(C.latestBySupplier(tie, "X").map((entry) => entry.supplier), ["ร้าน ค", "ร้าน ก", "ร้าน ข"]);
  assert.deepEqual(C.latestBySupplier(prices, "ZNO", "part").map((entry) => entry.supplier), ["ร้าน ก"], "ของซื้อแยกจากเคมี");
  assert.deepEqual(C.latestBySupplier([row("ZNO", 1, "2026-01-01", 1)], "ZNO"), [], "แถวที่ไม่มีช่องร้าน (ข้อมูลเก่า) ไม่นับ");
  assert.deepEqual(C.latestBySupplier(null, "ZNO"), []);
  // ราคาที่ใช้ยังเป็นแถวล่าสุดของวันมีผล ไม่ว่าร้านไหน (ร้านที่ไม่ระบุชื่อก็ใช้ได้)
  assert.equal(C.priceAt(prices, "ZNO", "2026-11-27").unitPrice, 50);
  assert.equal(C.priceAt(prices, "ZNO", "2026-10-15").supplier, "ร้าน ค");
  assert.equal(C.supplierOf({ supplier: "  ร้าน ก  " }), "ร้าน ก");
  assert.equal(C.supplierOf({}), "");
  assert.deepEqual(C.supplierNames(prices), ["ร้าน ก", "ร้าน ข", "ร้าน ค", "ร้าน ง", "ร้าน จ", "ร้าน ฉ"], "ไม่ซ้ำ ทุกชนิด ไม่มีค่าว่าง");
  assert.deepEqual(C.supplierNames(undefined), []);
});

test("ราคาของวันที่เลือกใช้กับต้นทุนสูตร (as of)", () => {
  const recipe = { id: "R", revision: 1, status: "approved", batchKg: 10, items: [w("ZNO", 1, 10)] };
  const history = [row("ZNO", 62, "2026-01-01", 1), row("ZNO", 70, "2026-10-01", 2)];
  close(C.formulaCost(recipe, history, "2026-09-30").cost, 620, "ก่อนปรับ");
  close(C.formulaCost(recipe, history, "2026-10-01").cost, 700, "หลังปรับ");
  assert.equal(C.formulaCost(recipe, history, "2025-01-01").complete, false, "ก่อนราคาแรก = ไม่มีราคา");
});

// ---------- ต้นทุนจริงของล็อตผสม ----------
test("lotCost: ต้นทุนจริงตามราคาที่มีผล ณ วันที่ชั่ง เทียบสูตร × batch", () => {
  const recipe = { id: "R", revision: 1, status: "approved", batchKg: 5, items: [w("ZNO", 1, 5)] };
  const history = [row("ZNO", 62, "2026-01-01", 1), row("ZNO", 70, "2026-10-01", 2)];
  const lot = (weighedAt, actualKg) => ({ lotNo: "MX-1", orderId: "WO-1", recipeId: "R", recipeRevision: 1, batches: 2, createdAt: bkk(2026, 10, 5), requisitions: [{ id: "REQ-1", issuedAt: bkk(2026, 10, 5), lines: [{ materialCode: "ZNO", stage: 1, targetKg: 10, actualKg, weighedAt }] }] });
  const after = C.lotCost(lot(bkk(2026, 10, 2), 10.4), recipe, history);
  close(after.actual, 10.4 * 70, "actual"); close(after.formula, 5 * 2 * 70, "formula"); close(after.diff, 28, "diff"); close(after.diffPct, 4, "diffPct");
  close(after.actualKg, 10.4, "actualKg"); close(after.formulaKg, 10, "formulaKg");
  assert.equal(after.complete, true);
  // ชั่งก่อนปรับราคา: ใช้ 62 ทั้งจริงและสูตร
  const before = C.lotCost(lot(bkk(2026, 9, 30), 10), recipe, history);
  close(before.actual, 620, "actual ก่อนปรับ"); close(before.formula, 620, "formula ก่อนปรับ"); close(before.diff, 0, "diff");
});

test("lotCost: วันที่ชั่งไม่มี → วันจ่ายของใบเบิก → วันสร้างล็อต · บรรทัดที่ actualKg ไม่เป็นตัวเลขข้าม", () => {
  const recipe = { id: "R", revision: 1, status: "approved", batchKg: 5, items: [w("ZNO", 1, 5)] };
  const history = [row("ZNO", 62, "2026-01-01", 1), row("ZNO", 70, "2026-10-01", 2)];
  const make = (issuedAt, createdAt, lines) => ({ lotNo: "MX-2", batches: 1, createdAt, requisitions: [{ id: "REQ-2", issuedAt, lines }] });
  const issued = C.lotCost(make(bkk(2026, 9, 29), bkk(2026, 10, 9), [{ materialCode: "ZNO", actualKg: 5, weighedAt: null }]), recipe, history);
  close(issued.actual, 310, "ใช้วันจ่ายของใบเบิก");
  const created = C.lotCost(make(null, bkk(2026, 10, 9), [{ materialCode: "ZNO", actualKg: 5 }]), recipe, history);
  close(created.actual, 350, "ใช้วันสร้างล็อต");
  const skipped = C.lotCost(make(null, bkk(2026, 10, 9), [{ materialCode: "ZNO", actualKg: null }, { materialCode: "ZNO", actualKg: undefined }, { materialCode: "ZNO", actualKg: "x" }, { materialCode: "ZNO", actualKg: 5 }]), recipe, history);
  close(skipped.actual, 350, "ข้ามบรรทัดที่ไม่มียอด"); close(skipped.actualKg, 5, "actualKg");
  const none = C.lotCost(make(null, bkk(2026, 10, 9), [{ materialCode: "ZNO", actualKg: null }]), recipe, history);
  assert.equal(none.actual, 0); assert.equal(none.actualKg, 0);
});

test("lotCost: เคมีที่ไม่มีราคา = ราคาไม่ครบ · ไม่พบสูตร = ไม่มีต้นทุนสูตร", () => {
  const recipe = { id: "R", revision: 1, status: "approved", batchKg: 6, items: [w("ZNO", 1, 5), w("DM-FIL-C", 1, 1)] };
  const history = [row("ZNO", 10, "2026-01-01", 1)];
  const lot = { lotNo: "MX-3", batches: 1, createdAt: bkk(2026, 10, 9), requisitions: [{ id: "REQ-3", issuedAt: bkk(2026, 10, 9), lines: [{ materialCode: "ZNO", actualKg: 5, weighedAt: bkk(2026, 10, 9) }, { materialCode: "DM-FIL-C", actualKg: 1, weighedAt: bkk(2026, 10, 9) }, { materialCode: "DM-CH-05", actualKg: 0, weighedAt: bkk(2026, 10, 9) }] }] };
  const result = C.lotCost(lot, recipe, history);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, ["DM-FIL-C"], "น้ำหนัก 0 ไม่นับว่าขาดราคา");
  close(result.actual, 50, "ยอดบางส่วน");
  const orphan = C.lotCost(lot, null, history);
  assert.equal(orphan.formula, null); assert.equal(orphan.diff, null); assert.equal(orphan.diffPct, null);
  assert.equal(C.lotCost({ lotNo: "MX-4", batches: 1, createdAt: 1, requisitions: [] }, recipe, history).actualKg, 0);
});

test("revision ที่ใช้งานและสูตรของล็อต", () => {
  const recipes = [{ id: "R", revision: 1, status: "superseded" }, { id: "R", revision: 2, status: "approved" }, { id: "R", revision: 3, status: "draft" }, { id: "S", revision: 1, status: "superseded" }, { id: "S", revision: 2, status: "superseded" }];
  assert.equal(C.currentRevision(recipes, "R").revision, 2, "อนุมัติแล้วก่อน");
  assert.equal(C.currentRevision(recipes, "S").revision, 2, "ไม่มีอนุมัติ/ร่าง = ล่าสุด");
  assert.equal(C.currentRevision(recipes, "NONE"), null);
  assert.deepEqual(C.revisionsOf(recipes, "R").map((entry) => entry.revision), [3, 2, 1]);
  assert.equal(C.recipeOfLot(recipes, { recipeId: "R", recipeRevision: 1 }).revision, 1);
  assert.equal(C.recipeOfLot(recipes, { recipeId: "R", recipeRevision: 9 }).revision, 2, "ไม่พบ revision = revision ที่ใช้งาน");
});

// ---------- ใครเห็นอะไร ----------
const emp = (role, dept, shape = "nested") => (shape === "flat" ? { role_code: role, department_code: dept } : { role: { code: role }, department: { code: dept } });
// [คำอธิบาย, พนักงาน, เห็นต้นทุน, เห็นราคา, บันทึกราคาได้]
const MATRIX = [
  ["admin", emp("admin", "MT"), true, true, true],
  ["ผู้จัดการทั่วไป", emp("general_manager", "MG"), true, true, false],
  ["ผู้จัดการโรงงาน", emp("factory_manager", "FM"), true, true, false],
  ["ผู้ช่วยผู้จัดการโรงงาน", emp("assistant_factory_manager", "FM"), false, false, false],
  ["พนักงาน PP", emp("staff", "PP"), true, true, false],
  ["พนักงาน PP (employee)", emp("employee", "PP"), true, true, false],
  ["หัวหน้าแผนก PP", emp("department_manager", "PP"), true, true, false],
  ["พนักงาน ST", emp("staff", "ST"), false, true, true],
  ["หัวหน้าแผนก ST", emp("department_manager", "ST"), false, true, true],
  ["ผู้ช่วยหัวหน้า ST", emp("assistant_department_manager", "ST"), false, true, true],
  ["หัวหน้าแผนก RB", emp("department_manager", "RB"), false, false, false],
  ["พนักงาน RB", emp("staff", "RB"), false, false, false],
  ["จัดซื้อ", emp("staff", "PU"), false, false, false],
  ["หัวหน้าจัดซื้อ", emp("department_manager", "PU"), false, false, false],
  ["หัวหน้า QA", emp("department_manager", "QA"), false, false, false],
  ["พนักงาน WH", emp("staff", "WH"), false, false, false],
  ["หัวหน้าฝ่ายขาย", emp("department_manager", "SA"), false, false, false],
  ["รูปแบบ role_code / department_code ตัวพิมพ์เล็ก (PP)", emp("staff", "pp", "flat"), true, true, false],
  ["รูปแบบ role_code / department_code (ST)", emp("staff", "st", "flat"), false, true, true],
  ["admin รูปแบบ flat", emp("admin", "IT", "flat"), true, true, true],
];
for (const [name, employee, cost, prices, edit] of MATRIX) {
  test(`สิทธิ์ราคา/ต้นทุน: ${name}`, () => {
    assert.equal(C.canSeeCost(employee), cost, "canSeeCost");
    assert.equal(C.canSeePrices(employee), prices, "canSeePrices");
    assert.equal(C.canEditPrices(employee), edit, "canEditPrices");
  });
}
test("สิทธิ์ราคา/ต้นทุน: ไม่มีผู้ใช้ / ข้อมูลไม่ครบ = ไม่เห็นอะไร", () => {
  for (const employee of [null, undefined, {}, { role: {}, department: {} }]) {
    assert.equal(C.canSeeCost(employee), false);
    assert.equal(C.canSeePrices(employee), false);
    assert.equal(C.canEditPrices(employee), false);
  }
});
test("ST ไม่เห็นต้นทุน · ผู้เห็นต้นทุนที่ไม่ใช่ ST/admin บันทึกราคาไม่ได้", () => {
  for (const [, employee, cost, , edit] of MATRIX) {
    if (employee.department?.code === "ST" || employee.department_code === "st") assert.equal(cost, false);
    if (cost && !(employee.role?.code === "admin" || employee.role_code === "admin")) assert.equal(edit, false);
  }
});

// ---------- ค่าแรง (เฟส 2): อัตราบาท/ชม. ต่อแผนก + เวลามาตรฐานของ RB ต่อรหัสสินค้า ----------
const rate = (departmentCode, ratePerHour, effectiveFrom = "2026-01-01", createdAt = 1) => ({ id: `${departmentCode}-${effectiveFrom}-${createdAt}`, departmentCode, ratePerHour, effectiveFrom, note: "", createdAt, createdBy: "ผู้ทดสอบ" });
const STEP_IDS = ["prep", "mix1", "mix2", "mix3", "extrusion", "curing", "finishing"];
const standard = (productCode, minutes, workers, effectiveFrom = "2026-01-01", createdAt = 1) => ({
  id: `${productCode}-${effectiveFrom}-${createdAt}`, productCode, effectiveFrom, note: "", createdAt, createdBy: "ผู้ทดสอบ",
  steps: STEP_IDS.map((step, index) => ({ step, minutes: minutes[index], workers: workers[index] })),
});
// ชั่วโมงคน: 30×2 + 12×2 + 6×2 + 0 + 60×3 + 45×1 + 30×4 = 441 นาทีคน = 7.35 ชม.
const STD = standard("FG-91", [30, 12, 6, 0, 60, 45, 30], [2, 2, 2, 0, 3, 1, 4]);
const RATES = [rate("RB", 60), rate("GR", 999)];

test("ขั้นของเวลามาตรฐาน: 7 ขั้นตามลำดับงาน สถานีผสมมี 4 ส่วน", () => {
  assert.deepEqual(C.STEPS.map((step) => step.id), STEP_IDS);
  assert.deepEqual(C.STEPS.filter((step) => step.station === "mixing").map((step) => step.id), ["prep", "mix1", "mix2", "mix3"]);
  assert.deepEqual(C.STATIONS.map((station) => station.id), ["mixing", "extrusion", "curing", "finishing"]);
  assert.deepEqual(C.LABOUR_DEPTS, ["RB", "GR", "PT", "BG", "PK"]);
});

test("labourCost: ค่าแรงต่อชุดผสม = Σ นาที ÷ 60 × คน × อัตรา RB · ต่อ kg · แยกขั้นและสถานี", () => {
  const out = C.labourCost(DEMO, [STD], RATES, "2026-11-27", 75.6);
  assert.equal(out.complete, true);
  assert.equal(out.reason, "");
  assert.equal(out.productCode, "FG-91");
  assert.equal(out.ratePerHour, 60, "อัตราของ RB ไม่ใช่ของแผนกอื่น");
  assert.equal(out.minutes, 183);
  close(out.manHours, 7.35);
  close(out.cost, 441);
  close(out.costPerKg, 441 / 75.6);
  assert.deepEqual(out.steps.map((step) => step.step), STEP_IDS);
  close(out.steps[0].cost, 60, "เตรียมวัตถุดิบ 30 นาที × 2 คน × 60 บาท/ชม.");
  close(out.steps[3].cost, 0, "ขั้นที่ไม่ทำ = 0");
  close(out.steps[5].cost, 45, "อบ 45 นาที × 1 คน");
  const mixing = out.stations.find((station) => station.station === "mixing");
  assert.equal(mixing.minutes, 48, "ผสม = เตรียม + ขั้น 1-3");
  close(mixing.cost, 96);
  close(out.stations.reduce((sum, station) => sum + station.cost, 0), out.cost, "สถานีรวมกันเท่ายอดรวม");
});

test("labourCost: คิดไม่ได้ = cost null พร้อมเหตุ (ไม่เดาเป็น 0)", () => {
  const noProduct = C.labourCost({ ...DEMO, productCode: "" }, [STD], RATES, "2026-11-27", 75.6);
  assert.deepEqual([noProduct.reason, noProduct.cost, noProduct.costPerKg, noProduct.complete], ["noProduct", null, null, false]);
  assert.equal(C.labourCost({ ...DEMO, productCode: null }, [STD], RATES, "2026-11-27", 75.6).reason, "noProduct");
  const noStandard = C.labourCost({ ...DEMO, productCode: "FG-OTHER" }, [STD], RATES, "2026-11-27", 75.6);
  assert.deepEqual([noStandard.reason, noStandard.cost, noStandard.minutes], ["noStandard", null, 0]);
  const early = C.labourCost(DEMO, [STD], RATES, "2025-12-31", 75.6);
  assert.equal(early.reason, "noStandard", "เวลามาตรฐานยังไม่ถึงวันมีผล");
  const noRate = C.labourCost(DEMO, [STD], [rate("GR", 50)], "2026-11-27", 75.6);
  assert.deepEqual([noRate.reason, noRate.cost, noRate.complete], ["noRate", null, false]);
  assert.equal(noRate.minutes, 183, "แผนก RB (ไม่มีอัตรา) ยังเห็นเวลา");
  close(noRate.manHours, 7.35);
  assert.equal(noRate.steps[0].cost, null);
  assert.equal(noRate.stations[0].cost, null);
  assert.equal(C.labourCost(DEMO, [STD], RATES, "2026-11-27", 0).costPerKg, null, "น้ำหนัก 0 = ไม่มีค่าแรงต่อ kg");
  assert.equal(C.labourCost(DEMO, null, null, "2026-11-27", 75.6).reason, "noStandard");
});

test("rateAt / standardAt: ประวัติ · แก้ในวันเดียวกัน (บันทึกล่าสุดชนะ) · ค่าล่วงหน้ายังไม่ถูกใช้ · การแก้ภายหลังไม่เปลี่ยนต้นทุนย้อนหลัง", () => {
  const rates = [rate("RB", 50, "2026-01-01", 1), rate("RB", 60, "2026-06-01", 2), rate("RB", 61, "2026-06-01", 3), rate("RB", 70, "2027-01-01", 4)];
  assert.equal(C.rateAt(rates, "RB", "2025-12-31"), null);
  assert.equal(C.rateAt(rates, "RB", "2026-05-31").ratePerHour, 50);
  assert.equal(C.rateAt(rates, "RB", "2026-06-01").ratePerHour, 61);
  assert.equal(C.rateAt(rates, "RB", "2026-12-31").ratePerHour, 61);
  assert.equal(C.rateAt(rates, "RB", "2027-01-01").ratePerHour, 70);
  assert.equal(C.rateAt(rates, "PK", "2026-06-01"), null);
  assert.equal(C.rateAt([rate("RB", 0), rate("RB", "x")], "RB", "2026-06-01"), null, "อัตราที่ไม่ใช่ตัวเลขบวกไม่ถูกใช้");
  assert.deepEqual(C.rateHistory(rates, "RB").map((row) => row.ratePerHour), [70, 61, 60, 50]);
  const slower = standard("FG-91", [60, 12, 6, 0, 60, 45, 30], [2, 2, 2, 0, 3, 1, 4], "2026-07-01", 2);
  const standards = [STD, slower, standard("FG-OTHER", [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1])];
  assert.equal(C.standardAt(standards, "FG-91", "2026-06-30"), STD);
  assert.equal(C.standardAt(standards, "FG-91", "2026-07-01"), slower);
  assert.equal(C.standardAt(standards, "", "2026-07-01"), null);
  assert.deepEqual(C.standardHistory(standards, "FG-91"), [slower, STD]);
  assert.equal(C.standardMinutes(slower), 213);
  close(C.labourCost(DEMO, standards, rates, "2026-05-01", 75.6).cost, 7.35 * 50, "ก่อนแก้: เวลาเดิม อัตราเดิม");
  close(C.labourCost(DEMO, standards, rates, "2026-08-01", 75.6).cost, 8.35 * 61, "หลังแก้: เวลาใหม่ อัตราใหม่");
});

test("standardSteps: ขั้นที่ขาดหรือค่าที่ไม่ใช่ตัวเลข = 0 ตามลำดับ STEPS เสมอ", () => {
  const steps = C.standardSteps({ steps: [{ step: "curing", minutes: 45, workers: 1 }, { step: "prep", minutes: "x", workers: -2 }, { step: "unknown", minutes: 9, workers: 9 }] });
  assert.deepEqual(steps.map((step) => [step.step, step.minutes, step.workers]), [["prep", 0, 0], ["mix1", 0, 0], ["mix2", 0, 0], ["mix3", 0, 0], ["extrusion", 0, 0], ["curing", 45, 1], ["finishing", 0, 0]]);
  assert.equal(C.stepLabel("prep"), "ผสม · ขั้นเตรียมวัตถุดิบ");
  assert.equal(C.fmtMinutes(12.5), "12.5");
});

test("สิทธิ์ค่าแรง: อัตรา = ผู้เห็นต้นทุน · เวลามาตรฐาน อ่าน = ผู้เห็นต้นทุน + แผนก RB · แก้ = ผู้เห็นต้นทุน + หัวหน้าแผนก RB", () => {
  // [role, dept, เห็นเวลา, แก้เวลา, แก้อัตรา]
  const cases = [
    ["general_manager", "MGT", true, true, true], ["factory_manager", "FT", true, true, true], ["admin", "IT", true, true, true],
    ["employee", "PP", true, true, true], ["assistant_factory_manager", "PP", true, true, true],
    ["employee", "RB", true, false, false], ["department_manager", "RB", true, true, false], ["assistant_department_manager", "RB", true, true, false],
    ["assistant_factory_manager", "FT", false, false, false], ["department_manager", "GR", false, false, false],
    ["employee", "ST", false, false, false], ["department_manager", "ST", false, false, false], ["employee", "QA", false, false, false], ["employee", "WH", false, false, false],
  ];
  for (const shape of ["nested", "flat"]) {
    for (const [role, dept, see, edit, rates] of cases) {
      const who = emp(role, dept, shape);
      assert.deepEqual([C.canSeeStandards(who), C.canEditStandards(who), C.canEditRates(who)], [see, edit, rates], `${role} ${dept} ${shape}`);
    }
  }
  assert.deepEqual([C.canSeeStandards(null), C.canEditStandards(undefined), C.canEditRates(null)], [false, false, false]);
});

// ---------- ต้นทุนต่อชิ้น (เฟส 3): itemCost ----------
// ชิ้นสมมติ: FG (เจ้าของ PK) = SE × 3 (ทำเอง) + กล่อง 0.25 (+4%) + สติ๊กเกอร์ 1 · SE (เจ้าของ GR) = เส้นยาง 0.1 · เป้า PK ประกอบ 30 ชิ้น/ชม. 2 คน · GR ตัด 20 ชิ้น/ชม. (ไม่ระบุคน = 1)
const ITEMS = {
  FG: { code: "FG", name: "สินค้า", kind: "FG", ownerDept: "PK", uom: "set" },
  SE: { code: "SE", name: "ชิ้นยาง", kind: "SE", ownerDept: "GR", uom: "pcs" },
  RB: { code: "RB", name: "เส้นยาง", kind: "RB", ownerDept: "RB", uom: "rod" },
  BOX: { code: "BOX", name: "กล่อง", kind: "PURCHASED", ownerDept: "ST", uom: "box" },
  STK: { code: "STK", name: "สติ๊กเกอร์", kind: "PURCHASED", ownerDept: "ST", uom: "pcs" },
  BAG: { code: "BAG", name: "กระเป๋า", kind: "BG", ownerDept: "BG", uom: "pcs" },
};
const BOMS = {
  FG: { itemCode: "FG", lines: [{ childCode: "SE", qty: 3 }, { childCode: "BOX", qty: 0.25, scrapPct: 4 }, { childCode: "STK", qty: 1 }] },
  SE: { itemCode: "SE", lines: [{ childCode: "RB", qty: 0.1 }] },
};
const CONFIGS = [
  { dept: "GR", steps: [{ code: "GR-04", name: "ตัดยาง", seq: 1, active: true }, { code: "GR-09", name: "เจาะ", seq: 2, active: false }], targets: [{ itemCode: "SE", stepCode: "GR-04", perHour: 20 }, { itemCode: "SE", stepCode: "GR-09", perHour: 0 }] },
  { dept: "PK", steps: [{ code: "PK-01", name: "ประกอบ", seq: 1, active: true }, { code: "PK-03", name: "บรรจุกล่อง", seq: 2, active: false }], targets: [{ itemCode: "FG", stepCode: "PK-03", perHour: 60, people: 1 }, { itemCode: "FG", stepCode: "PK-01", perHour: 30, people: 2 }] },
];
const PART_PRICES = [row("BOX", 20, "2026-01-01", 1, "box-1", "part"), row("BOX", 25, "2026-12-01", 2, "box-2", "part"), row("STK", 7, "2026-01-01", 1, "stk-chem", "chem")];
const UNIT_RATES = [rate("PK", 40), rate("GR", 50), rate("GR", 60, "2026-12-01", 2)];
const costOf = (code, extra = {}) => C.itemCost(ITEMS[code], { bom: BOMS[code] ?? null, itemOf: (child) => ITEMS[child] ?? null, configs: CONFIGS, prices: PART_PRICES, rates: UNIT_RATES, date: "2026-11-27", ...extra });

test("itemCost: ชิ้นที่ครบ · ค่าแรง = อัตรา × คน ÷ เป้า · นาที = 60 ÷ เป้า · ชั่วโมงคน = คน ÷ เป้า · ลูกที่ผลิตเองอยู่ใน made ไม่คิดเงิน", () => {
  const out = costOf("SE");
  assert.equal(out.itemCode, "SE");
  assert.deepEqual(out.labour.steps.map((step) => [step.dept, step.stepCode, step.stepName, step.perHour, step.people, step.ratePerHour]), [["GR", "GR-04", "ตัดยาง", 20, 1, 50]], "a target without people counts one worker · a zero target is skipped");
  close(out.labour.steps[0].minutes, 3);
  close(out.labour.steps[0].manHours, 0.05);
  close(out.labour.steps[0].cost, 2.5);
  assert.deepEqual(out.labour.depts.map((row) => [row.dept, row.ratePerHour]), [["GR", 50]]);
  close(out.labour.cost, 2.5);
  assert.deepEqual([out.labour.complete, out.labour.reasons], [true, []]);
  assert.deepEqual([out.materials.lines, out.materials.cost, out.materials.complete, out.materials.missing], [[], 0, true, []]);
  assert.deepEqual(out.made, [{ childCode: "RB", name: "เส้นยาง", kind: "RB", factor: 0.1 }]);
  close(out.own, 2.5);
  assert.equal(out.partial, false);
});

test("itemCost: จำนวนคน > 1 · หลายขั้นเรียงตามลำดับในตั้งค่า · ขั้นที่ไม่ใช้แล้วยังคิดถ้ายังมีเป้า · ของซื้อรวมเผื่อเสีย · ราคาที่ขาด = ยอดบางส่วนที่ไม่รวมตัวนั้น", () => {
  const out = costOf("FG");
  assert.deepEqual(out.labour.steps.map((step) => [step.stepCode, step.people]), [["PK-01", 2], ["PK-03", 1]], "seq order, inactive step still costed");
  close(out.labour.steps[0].cost, (40 * 2) / 30);
  close(out.labour.steps[0].manHours, 2 / 30);
  close(out.labour.steps[0].minutes, 2);
  close(out.labour.cost, (40 * 2) / 30 + 40 / 60);
  close(out.labour.depts[0].minutes, 3);
  const box = out.materials.lines.find((line) => line.childCode === "BOX");
  close(box.factor, 0.26, "0.25 × (1 + 4%)");
  assert.deepEqual([box.name, box.uom, box.qty, box.scrapPct, box.unitPrice], ["กล่อง", "box", 0.25, 4, 20]);
  close(box.cost, 5.2);
  const stk = out.materials.lines.find((line) => line.childCode === "STK");
  assert.deepEqual([stk.unitPrice, stk.cost], [null, null], "a chem price of the same code is not a part price");
  assert.deepEqual([out.materials.complete, out.materials.missing], [false, ["STK"]]);
  close(out.materials.cost, 5.2, "the cost leaves the unpriced part out");
  assert.deepEqual(out.made.map((child) => [child.childCode, child.kind, child.factor]), [["SE", "SE", 3]], "made children are listed, not costed");
  close(out.own, out.labour.cost + 5.2);
  assert.equal(out.partial, true);
});

test("itemCost: เจ้าของเป็น GR/PT/BG/PK ที่ไม่มีเป้า = noTarget · แผนกที่มีขั้นแต่ไม่มีอัตรา = noRate (cost null ไม่เดาเป็น 0) · ไม่มี BOM", () => {
  const bag = costOf("BAG");
  assert.deepEqual(bag.labour.reasons, [{ dept: "BG", reason: "noTarget" }]);
  assert.deepEqual([bag.labour.steps, bag.labour.cost, bag.labour.complete, bag.partial], [[], 0, false, true]);
  assert.deepEqual([bag.materials.lines, bag.materials.complete, bag.made], [[], true, []], "no BOM: nothing to buy, nothing made below");
  const noRate = costOf("FG", { rates: [rate("GR", 50)] });
  assert.deepEqual(noRate.labour.reasons, [{ dept: "PK", reason: "noRate" }]);
  assert.ok(noRate.labour.steps.every((step) => step.ratePerHour === null && step.cost === null));
  assert.deepEqual([noRate.labour.depts[0].ratePerHour, noRate.labour.depts[0].cost, noRate.labour.cost], [null, null, 0]);
  close(noRate.labour.minutes, 3, "minutes are known without a rate");
  // เจ้าของไม่ใช่แผนกที่มีเป้า (เช่น RB) และไม่มีเป้า = ไม่มีเหตุ
  assert.deepEqual(costOf("RB").labour.reasons, []);
  // configs แบบ object ต่อแผนกก็ได้
  assert.equal(C.itemCost(ITEMS.SE, { configs: { GR: { steps: CONFIGS[0].steps, targets: CONFIGS[0].targets } }, rates: UNIT_RATES, date: "2026-11-27" }).labour.steps[0].dept, "GR");
});

test("itemCost: ราคาและอัตราตามวันที่มีผล (asof) · ก่อนมีราคา/อัตรา = คิดไม่ได้", () => {
  const later = costOf("FG", { date: "2026-12-15" });
  assert.equal(later.materials.lines.find((line) => line.childCode === "BOX").unitPrice, 25, "the price in force on that day");
  const se = costOf("SE", { date: "2026-12-15" });
  close(se.labour.cost, 3, "GR 60 from December");
  const early = costOf("FG", { date: "2025-06-01" });
  assert.deepEqual([early.labour.reasons, early.materials.missing], [[{ dept: "PK", reason: "noRate" }], ["BOX", "STK"]]);
  assert.equal(early.own, 0);
  assert.equal(C.itemCost(ITEMS.FG, { bom: BOMS.FG, itemOf: (c) => ITEMS[c], configs: CONFIGS, prices: PART_PRICES, rates: UNIT_RATES, date: "nope" }).labour.complete, false, "a bad date knows no rate");
});

test("deptTargetsOf / hasItemCost / ตัวจัดรูป", () => {
  assert.deepEqual(C.deptTargetsOf(CONFIGS, "FG").map((target) => [target.dept, target.stepCode, target.people]), [["PK", "PK-01", 2], ["PK", "PK-03", 1]]);
  assert.deepEqual(C.deptTargetsOf([{ dept: "PT", steps: [], targets: [{ itemCode: "X", stepCode: "PT-01", perHour: 5, people: 99 }, { itemCode: "X", stepCode: "PT-02", perHour: 5, people: 2.5 }] }], "X").map((target) => target.people), [1, 1], "people outside 1–50 or not whole = 1");
  assert.deepEqual(["FG", "SE", "PT", "BG", "SUBPART", "PURCHASED", "CP", "RB"].map((kind) => C.hasItemCost({ kind })), [true, true, true, true, true, false, false, false]);
  assert.equal(C.hasItemCost(null), false);
  assert.equal(C.fmtPerHour(12.5), "12.5");
  assert.equal(C.fmtQtyPer(0.0036), "0.0036");
  assert.equal(C.fmtQtyPer(null), "-");
  assert.deepEqual([...C.STEP_DEPTS], ["GR", "PT", "BG", "PK"]);
});
