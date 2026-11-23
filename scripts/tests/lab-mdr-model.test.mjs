import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const model = require("../../modules/lab-mdr-model.js");

// ไฟล์ .ini จำลองรูปแบบเดียวกับเครื่อง MDR (CRLF, หัวไฟล์ key value, แถวละวินาที: ลำดับ แรงบิดก่อนหน้า วินาที แรงบิด T1 T2)
// กราฟ: ลดจาก 3.0 ถึงต่ำสุด 2.0 ที่วินาที 10 แล้วขึ้นเป็นเส้นตรง 0.05 dNm/วินาที จนถึง 8.0 ที่วินาที 130 แล้วคงที่
const torqueAt = (second) => (second <= 10 ? 3 - second * 0.1 : Math.min(8, 2 + (second - 10) * 0.05));
function iniText({ name = "A2004F1", id = "112", date = "2026-11-02", time = "16:21", seconds = 300, header = {}, rows = null } = {}) {
  const head = { ID: id, Name: name, Testdate: date, Testtime: time, Testtemperature: "155", Settime: "5", MH: "8.000", ML: "2.000",
    T5: "0:23", T30: "0:46", T50: "1:10", T90: "1:58", T100: "2:10", TS1: "0:30", TS2: "0:50", VC1: "14.49", VC2: "14.85", Result: "OK", ...header };
  const lines = Object.entries(head).filter(([, value]) => value !== undefined).map(([key, value]) => `${key} ${value}`);
  lines.push("T,s F,M T,s F,M T1 T2");
  const data = rows ?? Array.from({ length: seconds + 1 }, (_, second) => `${Math.max(0, second - 1)} ${torqueAt(Math.max(0, second - 1)).toFixed(4)} ${second} ${torqueAt(second).toFixed(4)} 155.002 155.006`);
  return [...lines, ...data].join("\r\n") + "\r\n";
}

test("cure results are computed from the curve: ML/MH = min/max, ts = ML + 1/2 dNm, tx = ML + x% of the rise", () => {
  const parsed = model.parseIni(iniText());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.formula, "A2004");
  assert.equal(parsed.part, "F1");
  const t = parsed.test;
  assert.equal(t.ml, 2);
  assert.equal(t.mh, 8);
  assert.equal(t.ts1_s, 30, "first second at or above ML + 1");
  assert.equal(t.ts2_s, 50);
  assert.equal(t.t50_s, 70, "ML + 50% of (MH − ML) = 5.0");
  assert.equal(t.t90_s, 118, "ML + 90% = 7.4");
  assert.equal(t.curve.length, 301, "one torque value per second from second 0");
  assert.equal(t.test_time, "16:21");
  assert.equal(t.temperature_c, 155);
  assert.equal(t.vc1, 14.49);
  assert.equal(t.result, "OK");
  assert.equal(t.header.Name, "A2004F1");
  assert.equal(parsed.key, "A2004F1|2026-11-02|16:21|112");
});

test("shifted T labels in the header (T10 … T90, no T100) do not change cure results, because they come from the curve", () => {
  const shifted = model.parseIni(iniText({ header: { T10: "0:46", T30: "1:10", T50: "1:58", T90: "2:10", T100: undefined } }));
  const normal = model.parseIni(iniText());
  for (const key of ["ml", "mh", "ts1_s", "ts2_s", "t50_s", "t90_s"]) assert.equal(shifted.test[key], normal.test[key], key);
});

test("the crossing is searched after the minimum, so the falling start of the curve is never read as a crossing", () => {
  const parsed = model.parseIni(iniText());
  assert.ok(parsed.test.ts1_s > 10, "torque is above ML + 1 during the first seconds, but ts1 is after the minimum");
  const curve = [9, 5, 3, 2, 2.5, 3.1, 4.2, 6, 7, 7.5, 7.5];
  assert.deepEqual(model.cureFromCurve(curve), { ml: 2, mh: 9, ts1_s: 5, ts2_s: 6, t50_s: 7, t90_s: null },
    "a level never reached after the minimum (MH is the first sample here) is null, not a wrong time");
});

test("names: trimmed, F1 = cure, F2 = swelling, formula without the suffix; anything else is skipped with a reason", () => {
  assert.deepEqual(model.splitName("B0005F2 "), { name: "B0005F2", formula: "B0005", part: "F2" });
  assert.deepEqual(model.splitName("AF2"), { name: "AF2", formula: "A", part: "F2" });
  assert.equal(model.splitName("B0005 ").error, model.SKIP.noSuffix);
  assert.equal(model.splitName("A").error, model.SKIP.noSuffix);
  assert.equal(model.splitName("F1").error, model.SKIP.noSuffix, "a suffix alone has no formula");
  assert.equal(model.splitName("A2004 F1").error, model.SKIP.badName, "spaces inside the name are not accepted by the database");
  const skipped = model.parseIni(iniText({ name: "B0005 " }));
  assert.deepEqual([skipped.ok, skipped.reason, skipped.name], [false, model.SKIP.noSuffix, "B0005"]);
});

test("swelling (F2) files carry no curve: values come from the header, 0:00 means not measured, shifted labels are mapped", () => {
  const rows = [];
  const parsed = model.parseIni(iniText({ name: "A2004F2", rows, header: { MH: "34131.000", ML: "8444.000", T100: "0:00", TS1: "0:00", TS2: "0:00", T50: "1:01", T90: "4:21" } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.part, "F2");
  assert.deepEqual([parsed.test.ml, parsed.test.mh, parsed.test.ts1_s, parsed.test.ts2_s, parsed.test.t50_s, parsed.test.t90_s], [8444, 34131, null, null, 61, 261]);
  assert.equal(parsed.test.curve, null);
  const shifted = model.parseIni(iniText({ name: "SEP001F2", rows, header: { MH: "17983.000", ML: "6192.000", T10: "0:34", T30: "1:01", T50: "4:21", T90: "9:00", T100: undefined } }));
  assert.deepEqual([shifted.test.t50_s, shifted.test.t90_s], [61, 261]);
  const aborted = model.parseIni(iniText({ name: "SEP001F2", rows, header: { MH: "0.000", ML: "6290.000" } }));
  assert.deepEqual([aborted.ok, aborted.reason], [false, model.SKIP.badValues], "an aborted test (MH 0) is skipped and says why");
  assert.equal(model.parseIni(iniText({ rows })).reason, model.SKIP.noCurve, "a cure file without its curve is skipped");
});

test("broken files are skipped with a reason instead of being sent", () => {
  assert.equal(model.parseIni("hello").reason, model.SKIP.unreadable);
  assert.equal(model.parseIni(iniText({ date: "2026-13-45" })).reason, model.SKIP.unreadable);
  assert.equal(model.parseIni(iniText({ id: "1 2" })).reason, model.SKIP.unreadable);
  const gap = iniText().replace(/\r\n5 [^\r]*\r\n/, "\r\n");
  assert.equal(model.parseIni(gap).reason, model.SKIP.badCurve, "a missing second is not silently shifted");
  assert.equal(model.parseIni(iniText({ seconds: model.MAX_POINTS })).reason, model.SKIP.curveTooLong);
  assert.equal(model.parseIni(iniText({ seconds: model.MAX_POINTS - 1 })).ok, true, "120 minutes (7,201 points) still fits");
});

test("classifyFiles accounts for every picked file: accepted, or skipped with a reason (including repeats in one pick)", () => {
  const files = [
    { name: "A2004F1$111.ini", size: 70000, text: iniText({ id: "111", time: "15:49" }) },
    { name: "A2004F1$112.ini", size: 70000, text: iniText() },
    { name: "copy/A2004F1$112.ini", size: 70000, text: iniText() },
    { name: "B0005$111.ini", size: 70000, text: iniText({ name: "B0005" }) },
    { name: "B0005$112.ini", size: 70000, text: iniText({ name: "B0005 " }) },
    { name: "report.xls", size: 5000, text: null },
    { name: "huge.ini", size: model.MAX_FILE_BYTES + 1, text: null },
  ];
  const { accepted, skipped } = model.classifyFiles(files);
  assert.deepEqual(accepted.map((item) => item.file), ["A2004F1$111.ini", "A2004F1$112.ini"]);
  assert.equal(accepted.length + skipped.length, files.length, "nothing is dropped silently");
  assert.deepEqual(model.groupSkipped(skipped), [
    { reason: model.SKIP.noSuffix, files: ["B0005$111.ini", "B0005$112.ini"] },
    { reason: model.SKIP.sameInBatch, files: ["copy/A2004F1$112.ini"] },
    { reason: model.SKIP.notIni, files: ["report.xls"] },
    { reason: model.SKIP.tooBig, files: ["huge.ini"] },
  ]);
  assert.deepEqual(model.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.ok(model.UPLOAD_BATCH <= 25, "batches stay within the database limit");
});

test("AVG and sample SD (n − 1, like Excel STDEV) per test date, newest date first, tests in machine order", () => {
  const tests = model.normalizeTests([
    { id: 3, machine_id: "121", test_date: "2026-11-03", test_time: "08:25", ml: "2.20", mh: "8.60", ts2_s: 40, t90_s: 170 },
    { id: 2, machine_id: "112", test_date: "2026-11-02", test_time: "16:21", ml: "2.18", mh: "8.57", ts2_s: 39, t90_s: 166 },
    { id: 1, machine_id: "111", test_date: "2026-11-02", test_time: "15:49", ml: "2.18", mh: "8.69", ts2_s: 39, t90_s: 177 },
    { id: 4, machine_id: "113", test_date: "2026-11-02", test_time: "16:53", ml: "2.20", mh: "8.55", ts2_s: 41, t90_s: null },
  ]);
  const days = model.groupByDate(tests);
  assert.deepEqual(days.map((day) => day.date), ["2026-11-03", "2026-11-02"]);
  assert.deepEqual(days[1].tests.map((test) => test.machine_id), ["111", "112", "113"]);
  assert.equal(days[1].groups.length, 1, "one set time and temperature: one group");
  const stats = days[1].groups[0].stats;
  assert.ok(Math.abs(stats.mh.avg - 8.6033333) < 1e-6);
  assert.ok(Math.abs(stats.mh.sd - 0.0757188) < 1e-6, "STDEV(8.69, 8.57, 8.55)");
  assert.ok(Math.abs(stats.delta.avg - (8.6033333 - 2.1866667)) < 1e-6, "MH−ML per test, then averaged");
  assert.deepEqual([stats.t90_s.n, stats.t90_s.avg], [2, 171.5], "a missing time is left out, not counted as zero");
  assert.equal(days[0].groups[0].stats.mh.sd, null, "one test has no SD");
  assert.equal(model.sampleSd([1]), null);
});

test("formatting: m:ss times, dNm with 2 decimals, swelling values without decimals, SD of times in seconds, Thai dates", () => {
  assert.equal(model.formatClock(166), "2:46");
  assert.equal(model.formatClock(39.4), "0:39");
  assert.equal(model.formatClock(null), "–");
  assert.equal(model.formatTorque(8.566, "F1"), "8.57");
  assert.equal(model.formatTorque(34131, "F2"), "34,131");
  const time = model.METRICS.find((metric) => metric.key === "t90_s");
  const torque = model.METRICS.find((metric) => metric.key === "mh");
  assert.equal(model.formatSd(time, 4.24), "4.2 วิ");
  assert.equal(model.formatSd(torque, 0.0757, "F1"), "0.076");
  assert.equal(model.formatDate("2026-11-02"), "2 พ.ย. 2569");
  assert.equal(model.parseClock("0:00"), null);
  assert.equal(model.parseClock("12:05"), 725);
});

test("routes: part defaults to F1, formula and date are validated, the date only travels with a formula", () => {
  const params = (query) => new URLSearchParams(query);
  assert.deepEqual(model.readRoute(params("module=mdr")), { part: "F1", formula: "", date: "" });
  assert.deepEqual(model.readRoute(params("module=mdr&part=F2&formula=A2004&date=2026-11-02")), { part: "F2", formula: "A2004", date: "2026-11-02" });
  assert.deepEqual(model.readRoute(params("module=mdr&part=F9&formula=<x>&date=yesterday")), { part: "F1", formula: "", date: "" });
  assert.equal(model.routeUrl({ part: "F2", formula: "B0005", date: "2026-11-03" }), "#/lab?module=mdr&part=F2&formula=B0005&date=2026-11-03");
  assert.equal(model.routeUrl({ part: "F1", date: "2026-11-03" }), "#/lab?module=mdr&part=F1");
});

// ข้อมูลจริง A2004 F1 10 พ.ย. 2569: สามครั้ง 30 นาที + สามครั้ง 20 นาที (รวมกันเฉลี่ย MH−ML ได้ 5.61 แยกกัน 5.25 / 5.98)
const mixedDay = model.normalizeTests([
  { id: 1, machine_id: "111", test_date: "2026-11-10", test_time: "14:35", set_minutes: 30, temperature_c: 155, ml: 1.97, mh: 7.24 },
  { id: 2, machine_id: "112", test_date: "2026-11-10", test_time: "15:05", set_minutes: 30, temperature_c: 155, ml: 1.91, mh: 7.16 },
  { id: 3, machine_id: "113", test_date: "2026-11-10", test_time: "15:36", set_minutes: 30, temperature_c: 155, ml: 1.91, mh: 7.12 },
  { id: 4, machine_id: "121", test_date: "2026-11-10", test_time: "15:58", set_minutes: 20, temperature_c: 155, ml: 2.08, mh: 8.03 },
  { id: 5, machine_id: "122", test_date: "2026-11-10", test_time: "16:18", set_minutes: 20, temperature_c: 155, ml: 1.97, mh: 8.15 },
  { id: 6, machine_id: "123", test_date: "2026-11-10", test_time: "16:39", set_minutes: 20, temperature_c: 155, ml: 1.91, mh: 7.71 },
]);

test("B: tests with different set times (or temperatures) are averaged per group, never together", () => {
  const [day] = model.groupByDate(mixedDay);
  assert.deepEqual(day.groups.map((group) => [group.set_minutes, group.tests.length]), [[30, 3], [20, 3]], "groups in the order they were tested");
  assert.ok(Math.abs(day.groups[0].stats.delta.avg - 5.25) < 0.01);
  assert.ok(Math.abs(day.groups[1].stats.delta.avg - 5.98) < 0.01);
  const hotter = model.normalizeTests([{ ...mixedDay[0], id: 9, temperature_c: 165 }, mixedDay[1]]);
  assert.equal(model.groupByDate(hotter)[0].groups.length, 2, "same set time at another temperature is another group");
  assert.deepEqual(model.conditionsOf([...mixedDay, mixedDay[0]]).map((item) => [item.key, item.n]), [["30|155", 4], ["20|155", 3]], "most tests first");
  assert.equal(model.formatCondition({ set_minutes: 30, temperature_c: 155 }), "30 นาที · 155 °C");
  assert.equal(model.formatCondition({ set_minutes: null, temperature_c: null }), "ไม่ระบุเวลาทดสอบ");
});

test("C: an F2 test where the rubber did not swell keeps ML/MH but its t50/t90 are not measured", () => {
  const f2 = model.normalizeTests([
    { id: 1, machine_id: "111", test_date: "2026-11-14", test_time: "09:00", set_minutes: 30, temperature_c: 155, ml: 6092, mh: 6097, t50_s: 1793, t90_s: 1797 },
    { id: 2, machine_id: "112", test_date: "2026-11-16", test_time: "10:45", set_minutes: 40, temperature_c: 155, ml: 6337, mh: 6900, t50_s: 2400, t90_s: 2400 },
    { id: 3, machine_id: "113", test_date: "2026-11-03", test_time: "15:12", set_minutes: 30, temperature_c: 155, ml: 8444, mh: 34131, t50_s: 61, t90_s: 261 },
    { id: 4, machine_id: "114", test_date: "2026-11-03", test_time: "15:40", set_minutes: 30, temperature_c: 155, ml: 8000, mh: 8070, t50_s: 120, t90_s: 400 },
  ]);
  const shown = model.applyDisplayRules(f2, "F2");
  assert.deepEqual(shown.map((test) => [test.no_swell === true, test.t90_s]), [[true, null], [true, null], [false, 261], [true, null]],
    "MH−ML under 1% of ML (A2401 14 Nov), or t90 at the set time (SNBR002 40 min), or both");
  assert.deepEqual([shown[0].ml, shown[0].mh, shown[0].t50_s, shown[0].t90_raw], [6092, 6097, null, 1797], "ML/MH stay, the machine's t90 is kept aside");
  assert.equal(f2[0].t90_s, 1797, "the stored rows are not changed");
  assert.equal(model.noSwell({ ml: 8000, mh: 8100, set_minutes: 30, t90_s: 1789 }), false, "1.25 % rise and t90 11 s before the end: a real result");
  assert.equal(model.noSwell({ ml: 8000, mh: 8100, set_minutes: 30, t90_s: 1790 }), true, "t90 10 s before the end");
  assert.equal(model.applyDisplayRules(f2, "F1"), f2, "cure tests are not touched");
  const day = model.groupByDate(shown.slice(2))[0];
  assert.equal(day.groups[0].stats.t90_s.n, 1, "a test that did not swell is left out of AVG/SD");
});

test("G: a curve shorter than the set time (machine stopped early) is skipped with a reason", () => {
  assert.equal(model.parseIni(iniText({ seconds: 12, header: { Settime: "30" } })).reason, model.SKIP.curveTooShort, "12 seconds of a 30-minute test");
  assert.equal(model.parseIni(iniText({ seconds: 294 })).reason, model.SKIP.curveTooShort, "6 s short of 5 minutes");
  assert.equal(model.parseIni(iniText({ seconds: 295 })).ok, true, "up to 5 s short is still accepted");
  assert.equal(model.parseIni(iniText({ seconds: 300 })).ok, true);
});
