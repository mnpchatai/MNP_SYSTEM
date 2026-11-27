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
