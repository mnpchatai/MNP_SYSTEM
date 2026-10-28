import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const model = require("../../modules/factory-spc-model.js");
const lab = require("../../modules/lab-mooney-model.js");

const near = (actual, expected, digits = 6) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≠ ${expected}`);

const job = (id, code, extra = {}) => ({ id, code, routing_id: "r1", routing_revision: 1, item_code: "RB-01", item_name: "ยางเส้น", steps: [{ sequence: 20, name: "ขึ้นรูป" }], ...extra });
const reading = (jobId, value, at, extra = {}) => ({ job_id: jobId, step_sequence: 20, code: "THICK", label: "ความหนา", unit: "mm", value, min: 1.8, max: 2.2, recorded_at: at, recorded_by_name: "ทดสอบ RB", ...extra });
const DATA = {
  jobs: [job("j1", "TEST-JB-26-001"), job("j2", "TEST-JB-26-002"), job("j3", "TEST-JB-26-003", { routing_id: "r2", routing_revision: 2 })],
  steps: [
    { routing_id: "r1", sequence: 20, name: "ขึ้นรูป", params: [{ code: "TEMP", label: "อุณหภูมิ", unit: "°C", min: 90, max: null }, { code: "THICK", label: "ความหนา", unit: "mm", min: 1.9, max: 2.1 }] },
    { routing_id: "r2", sequence: 20, name: "ขึ้นรูป", params: [] },
  ],
  job_readings: [
    reading("j2", "2.05", "2026-10-20T03:00:00Z"),
    reading("j1", 2.0, "2026-10-19T03:00:00Z"),
    reading("j1", 95, "2026-10-19T03:00:00Z", { code: "TEMP", label: "อุณหภูมิ", unit: "°C", min: 90, max: null }),
    reading("j3", 2.4, "2026-10-21T03:00:00Z"),
    reading("missing-job", 2.0, "2026-10-21T03:00:00Z"),
    reading("j2", "abc", "2026-10-21T03:00:00Z", { code: "BAD" }),
  ],
};

test("readings group per routing step parameter, oldest first, in the routing's parameter order", () => {
  const groups = model.characteristics(DATA);
  assert.deepEqual(groups.map((group) => [group.key, group.points.map((point) => point.value)]), [
    ["r1:20:TEMP", [95]],
    ["r1:20:THICK", [2, 2.05]],
    ["r2:20:THICK", [2.4]],
  ]);
  const thick = groups[1];
  assert.equal(thick.step_name, "ขึ้นรูป");
  assert.deepEqual(thick.points.map((point) => point.job_code), ["TEST-JB-26-001", "TEST-JB-26-002"]);
});

test("limits come from the current routing spec and readings taken under an older spec are counted", () => {
  const [, thick, removed] = model.characteristics(DATA);
  assert.deepEqual(thick.spec, { min: 1.9, max: 2.1 });
  assert.equal(thick.specFromRouting, true);
  assert.equal(thick.specChanged, 2);
  // พารามิเตอร์ถูกลบออกจาก Routing แล้ว: ใช้สเปกที่บันทึกไว้กับค่าล่าสุด
  assert.deepEqual(removed.spec, { min: 1.8, max: 2.2 });
  assert.equal(removed.specFromRouting, false);
  assert.equal(removed.specChanged, 0);
});

test("choice labels add the routing revision only when two series would read the same", () => {
  const labels = model.choiceLabels(model.characteristics(DATA));
  assert.deepEqual(labels.map(([, text]) => text), [
    "RB-01 · 20 ขึ้นรูป · อุณหภูมิ (°C)",
    "RB-01 · 20 ขึ้นรูป · ความหนา (mm) · Rev 1",
    "RB-01 · 20 ขึ้นรูป · ความหนา (mm) · Rev 2",
  ]);
});

test("capability uses the moving-range sigma for Cp/Cpk and the overall SD for Ppk", () => {
  const values = [10, 12, 11, 13, 12];
  const stats = model.capability(values, { min: 5, max: 17 });
  const control = lab.controlLimits(values);
  // MR̄ = (2 + 1 + 2 + 1) / 4 = 1.5 → σ = 1.5 / 1.128
  near(stats.sigma, 1.5 / 1.128);
  near(stats.mean, 11.6);
  near(stats.cp, 12 / (6 * control.sigma));
  near(stats.cpk, (17 - 11.6) / (3 * control.sigma));
  near(stats.ppk, (17 - 11.6) / (3 * lab.describe(values).sd));
  assert.equal(stats.ucl, control.ucl);
  assert.equal(stats.reason, null);
  assert.deepEqual(stats.outOfSpec, []);
});

test("one-sided specs give Cpk from that side and no Cp", () => {
  const lower = model.capability([95, 97, 96, 98], { min: 90, max: null });
  assert.equal(lower.cp, null);
  near(lower.cpk, (96.5 - 90) / (3 * lower.sigma));
  const upper = model.capability([95, 97, 96, 98], { min: null, max: 100 });
  near(upper.cpk, (100 - 96.5) / (3 * upper.sigma));
});

test("points outside the control limits and outside the spec are reported by position", () => {
  const values = [10, 10.1, 9.9, 10, 10.1, 9.9, 10, 14];
  const stats = model.capability(values, { min: 9, max: 11 });
  assert.deepEqual(stats.outOfSpec, [7]);
  assert.deepEqual(stats.outOfControl, [7]);
});

test("too few or identical values cannot give an index and say why", () => {
  const one = model.capability([2], { min: 1, max: 3 });
  assert.equal(one.cpk, null);
  assert.deepEqual(model.verdict(one), { tone: "none", text: "ข้อมูลไม่พอ", provisional: false });
  const flat = model.capability([2, 2, 2], { min: 1, max: 3 });
  assert.equal(flat.cpk, null);
  assert.equal(flat.ucl, null);
  assert.equal(model.verdict(flat).text, "ค่าทุกตัวเท่ากัน");
  assert.equal(model.capability([], { min: 1, max: 3 }).n, 0);
});

test("verdict follows the usual Cpk bands and marks small samples as provisional", () => {
  const at = (cpk, n = model.MIN_SAMPLE) => model.verdict({ cpk, n, reason: null });
  assert.equal(at(1.7).text, "ดีมาก (≥ 1.67)");
  assert.equal(at(1.33).tone, "good");
  assert.equal(at(1.2).tone, "warn");
  assert.equal(at(0.8).tone, "bad");
  assert.equal(at(1.5).provisional, false);
  assert.equal(at(1.5, model.MIN_SAMPLE - 1).provisional, true);
  // ตัดสินจากค่าที่แสดง (ทศนิยม 2 ตำแหน่ง): 1.3299 แสดง 1.33 จึงผ่านเกณฑ์
  assert.equal(at(1.3299).text, "ผ่านเกณฑ์ (≥ 1.33)");
  assert.equal(at(0.9949).tone, "bad");
});

test("readings sort by actual time even when the timestamp text differs in precision", () => {
  const data = { ...DATA, job_readings: [
    reading("j1", 2.0, "2026-10-19T03:00:00.5+00:00"),
    reading("j2", 2.05, "2026-10-19T03:00:00+00:00"),
  ] };
  assert.deepEqual(model.characteristics(data)[0].points.map((point) => point.job_code), ["TEST-JB-26-002", "TEST-JB-26-001"]);
});

test("statistics and the histogram handle a very long series without spreading it into arguments", () => {
  const values = Array.from({ length: 200000 }, (_, index) => 2 + ((index * 7) % 11) / 100);
  const stats = model.capability(values, { min: 1.9, max: 2.2 });
  assert.equal(stats.n, values.length);
  assert.equal(stats.max, 2.1);
  const bins = model.histogram(values, { min: 1.9, max: 2.2 });
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), values.length);
});

test("histogram spans values and spec, keeps every value and puts the top value in the last bin", () => {
  const values = [1.95, 2, 2, 2.05, 2.1];
  const bins = model.histogram(values, { min: 1.8, max: 2.2 });
  assert.equal(bins.length, 5);
  near(bins[0].from, 1.8);
  near(bins.at(-1).to, 2.2);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), values.length);
  assert.equal(model.histogram([3], { min: null, max: null }).reduce((sum, bin) => sum + bin.count, 0), 1);
  assert.equal(model.histogram(Array.from({ length: 400 }, (_, i) => i), { min: null, max: null }).length, 12);
  assert.deepEqual(model.histogram([], { min: 1, max: 2 }), []);
});
