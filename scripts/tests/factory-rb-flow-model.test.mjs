import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// ตรรกะ RubberFlow ของหน้าแผนก RB (modules/factory-rb-flow-model.js): จัดขั้นของ Routing เข้าสถานี กระดานสถานี นาฬิกาพักยาง สรุป ลิงก์
const require = createRequire(import.meta.url);
globalThis.MNP_FACTORY_JOB_MODEL = require("../../modules/factory-job-model.js");
const flow = require("../../modules/factory-rb-flow-model.js");

// ขั้นของ Routing ยางเส้นยาวในชุดทดลอง 5 สินค้า (20261007020000) และสถานีที่ควรได้
const TRIAL = [
  ["RB-01 ชั่งเคมี", "mixing"],
  ["RB-02 ตียางด้วยเครื่อง Auto และใส่เคมีขั้นที่ 1", "mixing"],
  ["RB-03 ตียางด้วยเครื่อง 2 ลูกกลิ้ง ขั้นที่ 1", "mixing"],
  ["RB-04 พักยาง 4 ชั่วโมง", "mixing"],
  ["RB-05 ตียางด้วยเครื่อง Auto และใส่เคมีขั้นที่ 2", "mixing"],
  ["RB-06 ตียางด้วยเครื่อง 2 ลูกกลิ้ง ขั้นที่ 2", "mixing"],
  ["RB-07 พักยาง 4 ชั่วโมง", "mixing"],
  ["RB-08 แบ่งยาง 4 กิโลกรัม แล้วใส่เคมีขั้นที่ 3 ที่เครื่อง Auto เล็ก", "mixing"],
  ["RB-09 นำยางที่ผสมเคมีจากเครื่อง Auto เล็ก มาผสมกับยางที่เหลือด้วยเครื่อง 2 ลูกกลิ้ง", "mixing"],
  ["RB-10 ฉีดยาง", "forming"],
  ["RB-11 อบยางด้วย Oven", "curing"],
  ["RB-12 อบยางด้วย HCM", "curing"],
  ["RB-13 ตัดยางเส้นยาว", "finishing"],
];

const step = (sequence, name, center = "RB", status = "pending", extra = {}) => ({ sequence, name, work_center_code: center, department_code: center === "QC" ? "QA" : center, run_minutes: 0, status, completed_at: null, ...extra });
const job = (id, status, steps, extra = {}) => ({ id, code: id, status, qty: 100, output_qty: null, on_hold: false, created_at: `2026-10-0${1 + (id.charCodeAt(1) % 9)}T01:00:00Z`, started_at: null, completed_at: null, steps, ...extra });
const NOW = Date.parse("2026-10-28T10:00:00Z");
const HOUR = 3600000;

test("every RB step of the trial routing lands on the RubberFlow station its name describes", () => {
  for (const [name, stage] of TRIAL) assert.equal(flow.stageOf(name), stage, name);
  assert.equal(flow.stageOf("QC-01 ตรวจขนาด"), "finishing", "a QC-looking name still matches, the department decides whether it is RB");
  assert.equal(flow.stageOf("ประกอบชิ้นส่วน"), null, "the word ประกอบ does not count as อบ");
  assert.equal(flow.stageOf("ขั้นพิเศษ"), null);
  assert.equal(flow.stageOf(null), null);
});

test("steps of other departments get no station and an unmatched RB step inherits the station of the RB step before it", () => {
  const rows = flow.classifySteps({ steps: [step(10, "RB-11 อบยางด้วย Oven"), step(20, "RB-99 ขั้นพิเศษ"), step(30, "SR-01 รับเข้าคลัง", "SR"), step(40, "QC-01 ตรวจขนาด", "QC")] });
  assert.deepEqual(rows.map((row) => [row.stage, row.inferred]), [["curing", false], ["curing", true], [null, false], [null, false]]);
  const first = flow.classifySteps({ steps: [step(10, "RB-99 ขั้นพิเศษ"), step(20, "RB-10 ฉีดยาง")] });
  assert.deepEqual(first.map((row) => [row.stage, row.inferred]), [["mixing", true], ["forming", false]], "the first RB step without a keyword starts at mixing");
});

test("the rest timer reads hours or minutes from the step name, falls back to run_minutes, and counts from the previous step", () => {
  assert.equal(flow.restMinutes({ name: "RB-04 พักยาง 4 ชั่วโมง" }), 240);
  assert.equal(flow.restMinutes({ name: "พักยาง 90 นาที" }), 90);
  assert.equal(flow.restMinutes({ name: "พักยาง", run_minutes: 30 }), 30);
  assert.equal(flow.restMinutes({ name: "พักยาง" }), null);
  const resting = job("jB", "in_progress", [step(10, "RB-03 ตียาง", "RB", "done", { completed_at: new Date(NOW - 3 * HOUR).toISOString() }), step(20, "RB-04 พักยาง 4 ชั่วโมง")]);
  const timer = flow.restTimer(resting, resting.steps[1], NOW);
  assert.equal(timer.minutes, 240);
  assert.equal(timer.remainingMs, 1 * HOUR);
  assert.equal(timer.readyAt, new Date(NOW + HOUR).toISOString());
  assert.equal(flow.restTimer(resting, resting.steps[1], NOW + 2 * HOUR).remainingMs, 0, "never negative once the rest is over");
  assert.equal(flow.restTimer(resting, resting.steps[0], NOW), null, "only rest steps have a timer");
  const noReference = job("jX", "open", [step(10, "RB-04 พักยาง 4 ชั่วโมง")]);
  assert.equal(flow.restTimer(noReference, noReference.steps[0], NOW), null, "no previous step and no start time = no timer");
  const fromStart = job("jY", "in_progress", [step(10, "RB-04 พักยาง 1 ชั่วโมง")], { started_at: new Date(NOW - 30 * 60000).toISOString() });
  assert.equal(flow.restTimer(fromStart, fromStart.steps[0], NOW).remainingMs, 30 * 60000, "a first rest step counts from the job start");
});

const RB_LINE = (statusOf = () => "pending", extra = () => ({})) => [
  step(10, "RB-01 ชั่งเคมี", "RB", statusOf(10), extra(10)), step(20, "RB-10 ฉีดยาง", "RB", statusOf(20), extra(20)),
  step(30, "RB-11 อบยางด้วย Oven", "RB", statusOf(30), extra(30)), step(40, "RB-13 ตัดยางเส้นยาว", "RB", statusOf(40), extra(40)),
  step(50, "SR-01 รับเข้าคลัง", "SR", statusOf(50)), step(60, "QC-01 ตรวจขนาด", "QC", statusOf(60)),
];
const doneBefore = (limit) => (sequence) => (sequence < limit ? "done" : "pending");
const JOBS = [
  job("jA", "open", RB_LINE()),
  job("jB", "in_progress", [step(10, "RB-03 ตียาง", "RB", "done", { completed_at: new Date(NOW - 3 * HOUR).toISOString() }), step(20, "RB-04 พักยาง 4 ชั่วโมง"), step(30, "RB-10 ฉีดยาง")]),
  job("jC", "in_progress", RB_LINE(doneBefore(20)), { on_hold: true, hold_reason: "ความหนาหลุดสเปก", held_at: "2026-10-28T01:00:00Z" }),
  job("jD", "in_progress", RB_LINE(doneBefore(50))),
  job("jE", "in_progress", [step(10, "RB-01 ชั่งเคมี", "RB", "done"), step(20, "QC-01 ตรวจขนาด", "QC"), step(30, "RB-13 ตัดยางเส้นยาว")]),
  job("jF", "completed", RB_LINE(() => "done"), { output_qty: 95, completed_at: "2026-10-27T05:00:00Z" }),
  job("jG", "cancelled", RB_LINE()),
  job("jH", "open", [step(10, "GR-01 แปรรูป", "GR")]),
  job("jI", "in_progress", [step(10, "RB-11 อบยางด้วย Oven", "RB", "done"), step(20, "RB-99 ขั้นพิเศษ"), step(30, "SR-01 รับเข้าคลัง", "SR")]),
  job("jJ", "completed", RB_LINE(() => "done"), { qty: 50, output_qty: null, completed_at: "2026-10-26T05:00:00Z" }),
];

test("the board puts every active RB job at the station of its next step, keeps held jobs apart, and lists what left the line", () => {
  const board = flow.board(JOBS, NOW);
  assert.deepEqual(board.stations.map((station) => [station.stage, station.ready.map((row) => row.job.id), station.held.map((row) => row.job.id)]), [
    ["mixing", ["jA", "jB"], []],
    ["forming", [], ["jC"]],
    ["curing", ["jI"], []],
    ["finishing", [], []],
  ]);
  assert.equal(board.stations[0].ready[1].rest.remainingMs, HOUR, "the resting job carries its timer");
  assert.equal(board.stations[0].ready[0].rest, null);
  assert.equal(board.stations[2].ready[0].inferred, true, "the unmatched step says it was inferred");
  assert.deepEqual(board.stations[1].held[0].progress, { done: 1, total: 4 });
  assert.deepEqual(board.handed.map((row) => [row.job.id, row.step.name]), [["jD", "SR-01 รับเข้าคลัง"]]);
  assert.deepEqual(board.waiting.map((row) => [row.job.id, row.step.department_code]), [["jE", "QA"]]);
  assert.deepEqual(board.completed.map((row) => row.job.id), ["jF", "jJ"], "newest finished first");
  assert.deepEqual(board.summary, { active: 5, held: 1, handed: 1, completed: 2, yieldPercent: 96.7 }, "yield = (95 + 50) / (100 + 50), a missing output counts as the ordered qty");
  assert.equal(flow.board([], NOW).summary.yieldPercent, null);
  assert.equal(flow.board(undefined, NOW).stations.length, 4);
});

test("the station comes from the URL when known, else the first one with work, else the first station", () => {
  const { stations } = flow.board(JOBS, NOW);
  assert.equal(flow.pickStation(stations, "curing").stage, "curing");
  assert.equal(flow.pickStation(stations, "nope").stage, "mixing");
  assert.equal(flow.pickStation(stations, null).stage, "mixing");
  const quiet = flow.board([JOBS[2]], NOW).stations;
  assert.equal(flow.pickStation(quiet, null).stage, "forming", "a station with only held jobs still counts as having work");
  assert.equal(flow.pickStation(flow.board([], NOW).stations, null).stage, "mixing");
});

test("links and the rest text", () => {
  assert.equal(flow.url(), "#/factory?dept=RB");
  assert.equal(flow.url({ st: "curing" }), "#/factory?dept=RB&st=curing");
  assert.equal(flow.url({ st: "bogus", jb: "j 1" }), "#/factory?dept=RB&jb=j+1", "unknown stations are dropped, ids are encoded");
  assert.equal(flow.remainingText(0), "ครบเวลาพักแล้ว");
  assert.equal(flow.remainingText(59000), "พักอีก 1 นาที");
  assert.equal(flow.remainingText(HOUR + 5 * 60000), "พักอีก 1 ชม. 5 นาที");
});
