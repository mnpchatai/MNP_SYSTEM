import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
require("../../modules/lab-range.js"); // ตั้ง globalThis.MNP_LAB_RANGE ให้กราฟ/หน้าที่ใช้แถบช่วง
const model = require("../../modules/lab-mdr-model.js");
globalThis.MNP_LAB_MDR = model;
globalThis.MNP_LAB_SECTIONS = require("../../modules/lab-sections.js");
const views = require("../../modules/lab-mdr-views.js");

const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const tests = model.normalizeTests([
  { id: 1, machine_id: "111", test_date: "2026-11-02", test_time: "15:49", temperature_c: 155, ml: 2.18, mh: 8.69, ts2_s: 39, t90_s: 177 },
  { id: 2, machine_id: "112", test_date: "2026-11-02", test_time: "16:21", temperature_c: 155, ml: 2.18, mh: 8.57, ts2_s: 39, t90_s: 166 },
  { id: 3, machine_id: "121", test_date: "2026-11-03", test_time: "08:25", temperature_c: 155, ml: 2.2, mh: 8.6, ts2_s: 40, t90_s: 170 },
]);
const formulas = [{ formula: "A2004", tests: 3, days: 2, last_date: "2026-11-03" }, { formula: "B0005", tests: 15, days: 5, last_date: "2026-11-06" }];
const curve = Array.from({ length: 1801 }, (_, second) => Math.min(8.6, 2.2 + second * 0.02));

test("the page: module banner with the upload control, one tab per test set, the open tab marked as current", () => {
  const page = views.page({ part: "F2", formula: "A2004", date: "" });
  assert.match(page, /<h1>รายงานทดสอบ MDR<\/h1>/);
  assert.match(page, /id="mdr-pick-folder" webkitdirectory/);
  assert.match(page, /id="mdr-pick-files" accept="\.ini" multiple/);
  assert.match(page, /data-popup hidden/, "the menu uses the shared popup rule");
  assert.equal(count(page, /type="file"[^>]*data-attachment-skip/g), 2, "both pickers opt out of the 10-file attachment rule of app.js");
  assert.match(page, /href="#\/lab\?module=mdr&amp;part=F1&amp;formula=A2004" data-part="F1">/, "the other tab keeps the formula");
  assert.match(page, /href="#\/lab\?module=mdr&amp;part=F2" data-part="F2" aria-current="page"/, "the open tab goes back to its formula list");
  assert.equal(count(visibleText(page), /ทดสอบการสุกของยาง/g), 1);
  assert.equal(count(visibleText(page), /ทดสอบการพองตัวของยาง/g), 1);
});

test("formula list: one row per formula linking to its page; an empty set explains how to upload", () => {
  const html = views.overview("F1", formulas);
  assert.match(html, /href="#\/lab\?module=mdr&amp;part=F1&amp;formula=B0005">B0005<\/a>/);
  assert.match(html, /3 พ.ย. 2569/);
  assert.match(views.overview("F2", []), /ยังไม่มีผลทดสอบการพองตัวของยาง/);
});

test("cure formula page: chart of the chosen day with a key per test, then one table grouped by date with AVG and SD rows", () => {
  const curveZoom = views.curveZoomFor(model.groupByDate(tests), "2026-11-02");
  const html = views.formulaBody({ part: "F1", formula: "A2004" }, { formulas, tests, curveDate: "2026-11-02", curves: [{ id: 1, curve }, { id: 2, curve }] }, undefined, curveZoom);
  assert.match(html, /id="mdr-formula"/);
  assert.match(html, /<option value="A2004" selected>A2004<\/option>/);
  assert.doesNotMatch(html, /id="mdr-date"/, "the one-day select is gone: the torque chart has its own range bar");
  assert.match(html, /กราฟแรงบิด<span class="lab-mdr-chart-when" id="mdr-curve-when"> · 2 พ.ย. 2569<\/span>/, "one day: its date in the card heading");
  assert.equal(count(html, /class="lab-mdr-key"/g), 2, "a key per test drawn on the chart");
  assert.equal(count(html, /class="lab-mdr-stat"/g), 2, "an AVG row per date");
  assert.equal(count(html, /lab-mdr-sd/g), 2, "an SD row per date");
  assert.match(html, /<span class="lab-mdr-day-flag">ในกราฟแรงบิด<\/span>/, "the charted day is marked, not repeated");
  assert.match(html, /data-show-date="2026-11-03"/, "other days offer their chart");
  assert.match(html, /ts2 \(นาที:วินาที\)/);
  assert.match(html, /ML \(dNm\)/);
  assert.match(html, /8\.63/, "AVG MH of 2 Nov = (8.69 + 8.57) / 2");
  assert.match(html, /<td class="num">2:46<\/td>/);
  assert.doesNotMatch(html, /T1|T2|°C<\/text>/, "die temperature curves are not shown");
});

test("swelling formula page: no chart, and columns that the machine never fills (ts2) are left out", () => {
  const swelling = model.normalizeTests([
    { id: 9, machine_id: "111", test_date: "2026-11-03", test_time: "15:12", temperature_c: 155, ml: 8444, mh: 34131, ts2_s: null, t90_s: 261 },
    { id: 10, machine_id: "112", test_date: "2026-11-03", test_time: "15:49", temperature_c: 155, ml: 9170, mh: 32526, ts2_s: null, t90_s: 235 },
  ]);
  const html = views.formulaBody({ part: "F2", formula: "A2004" }, { formulas, tests: swelling, curveDate: null, curves: [] });
  assert.doesNotMatch(html, /mdr-plot|mdr-date|mdr-curve-zoom/);
  assert.doesNotMatch(html, />ts2/);
  assert.match(html, />MH</, "no unit for swelling values");
  assert.match(html, /34,131/);
  assert.match(html, /1,134\.9/, "SD of MH: STDEV(34131, 32526)");
  assert.match(views.formulaBody({ part: "F2", formula: "Z9" }, { formulas, tests: [], curveDate: null, curves: [] }), /ไม่พบผลทดสอบการพองตัวของยางของสูตร “Z9”/);
});

test("upload result: added per test set, duplicates, and every skipped file grouped by its reason", () => {
  const html = views.uploadResult({ added: { F1: 3, F2: 0 }, duplicates: 2, failed: null, skipped: [{ reason: model.SKIP.noSuffix, files: ["B0005$111.ini", "B0005$112.ini"] }] });
  assert.match(visibleText(html), /เพิ่มผลใหม่ 3 ครั้ง \(ทดสอบการสุกของยาง 3\)/);
  assert.match(html, /มีอยู่แล้ว 2 ครั้ง/);
  assert.match(html, /<summary>ข้าม 2 ไฟล์<\/summary>/);
  assert.match(html, /ชื่อสูตรไม่ลงท้ายด้วย F1 หรือ F2<\/strong> · 2 ไฟล์/);
  assert.match(html, /B0005\$111\.ini, B0005\$112\.ini/);
  const failed = views.uploadResult({ added: { F1: 0, F2: 0 }, duplicates: 0, failed: "อัปโหลดไม่สำเร็จ 4 ครั้ง: <b>", skipped: [] });
  assert.match(failed, /&lt;b&gt;/, "error text is escaped");
  assert.doesNotMatch(failed, /<details/);
});

test("chart: grid in minutes and dNm, one path per test with its colour, a t90 mark, and geometry for the pointer", () => {
  const { svg, geometry } = views.chartSvg([{ id: "1", color: "#4ea8ff", curve, t90: 160 }, { id: "2", color: "#ff8a3d", curve: curve.slice(0, 601), t90: null }], 800);
  assert.equal(count(svg, /class="lab-mdr-line"/g), 2);
  assert.equal(count(svg, /class="lab-mdr-t90"/g), 1);
  assert.match(svg, /--line-color:#4ea8ff/);
  assert.match(svg, />นาที<\/text>/);
  assert.match(svg, />dNm<\/text>/);
  assert.match(svg, />30<\/text>/, "the time axis reaches 30 minutes");
  assert.equal(geometry.seconds, 1800);
  assert.equal(geometry.width, 800);
  assert.equal(views.niceStep(9, 5), 2);
  const tip = views.tipHtml([{ color: "#fff", machineId: "112", t90: 166 }, { color: "#000", machineId: "113", t90: null }]);
  assert.match(tip, /t90 \(นาที:วินาที\)[\s\S]*ID 112<b>2:46<\/b>/, "the tooltip shows each test t90, not the torque at the pointer");
  assert.match(tip, /ID 113<b>–<\/b>/, "a test that never reached 90% shows a dash");
  assert.doesNotMatch(views.chartSvg([{ id: "1", color: "#fff", curve, t90: 160 }], 800).svg, /mdr-cross/, "no vertical pointer line: the tooltip no longer depends on the pointer time");
});

test("swelling trend chart: one value at a time (MH−ML or t90), a dot per test, a daily AVG line, and a normal band from the formula history", () => {
  const swelling = model.normalizeTests([
    { id: 1, machine_id: "111", test_date: "2026-11-03", test_time: "15:12", ml: 8444, mh: 34131, t90_s: 261 },
    { id: 2, machine_id: "112", test_date: "2026-11-03", test_time: "15:49", ml: 9170, mh: 32526, t90_s: 235 },
    { id: 3, machine_id: "111", test_date: "2026-11-12", test_time: "09:00", ml: 6938, mh: 33776, t90_s: 396 },
    { id: 4, machine_id: "112", test_date: "2026-11-12", test_time: "09:30", ml: 7356, mh: 35009, t90_s: null },
  ]);
  const page = views.formulaBody({ part: "F2", formula: "A2004" }, { formulas, tests: swelling, curveDate: null, curves: [] });
  assert.match(page, /id="mdr-trend"/);
  assert.match(page, /data-trend="delta" aria-pressed="true">MH−ML</);
  assert.match(page, /data-trend="t90_s" aria-pressed="false">t90</);
  assert.doesNotMatch(page, /data-trend="ts2_s"/, "swelling files have no ts2, so no ts2 button");
  const cure = views.formulaBody({ part: "F1", formula: "A2004" }, { formulas, tests, curveDate: "2026-11-02", curves: [{ id: 1, curve }] });
  assert.ok(cure.indexOf('id="mdr-plot"') < cure.indexOf('id="mdr-trend"'), "cure keeps the torque chart of one day first, then the daily trend");
  assert.match(cure, /data-trend="delta" aria-pressed="true">MH−ML<\/button><button[^>]*data-trend="ts2_s"[^>]*>ts2<\/button><button[^>]*data-trend="t90_s"/);
  const days = model.groupByDate(swelling);
  const delta = views.trendSvg(days, "delta", 600, "F2").svg;
  assert.equal(count(delta, /class="lab-mdr-dot/g), 4, "a dot per test");
  assert.equal(count(delta, /class="lab-mdr-avg-pt"/g), 2, "an AVG point per day");
  assert.doesNotMatch(delta, /lab-mdr-band/, "4 tests are not enough for a normal band");
  assert.ok(delta.indexOf("3 พ.ย.") < delta.indexOf("12 พ.ย."), "oldest day on the left");
  assert.match(delta, /ID 111 15:12 · MH−ML 25,687/);
  const time = views.trendSvg(days, "t90_s", 600, "F2").svg;
  assert.equal(count(time, /class="lab-mdr-dot/g), 3, "a test without t90 is left out, not drawn as zero");
  assert.match(time, />[0-9]+:[0-5][05]<\/text>/, "time ticks are m:ss");
  assert.match(views.trendSvg([], "t90_s", 600, "F2").note, /ไม่มีค่า t90/);
  assert.equal(views.trendSvg(days, "delta", 600, "F2").note, "ยังไม่มีช่วงปกติ: มีผล MH−ML 4 ครั้ง ต้องมีอย่างน้อย 10 ครั้ง");
  const one = views.trendSvg(model.groupByDate(swelling.slice(0, 1)), "delta", 600, "F2");
  assert.doesNotMatch(one.svg, /lab-mdr-band/, "one test: no normal band");
  assert.match(one.note, /^ยังไม่มีช่วงปกติ: มีผล MH−ML 1 ครั้ง/);
  const spread = model.normalizeTests([10, 300, 15, 12].map((t90, i) => ({ id: i, machine_id: String(i), test_date: "2026-11-0" + (i + 1), test_time: "08:00", ml: 1, mh: 2, t90_s: t90 })));
  assert.doesNotMatch(views.trendSvg(model.groupByDate(spread), "t90_s", 400, "F2").svg, />-d|y="-/, "no negative axis or band for values that cannot be negative");
  const many = model.normalizeTests(Array.from({ length: 11 }, (_, i) => ({ id: i, machine_id: "1", test_date: "2026-11-" + String(i + 1).padStart(2, "0"), test_time: "08:00", ml: 1, mh: 2 + i, t90_s: 100 })));
  const xs = [...views.trendSvg(model.groupByDate(many), "delta", 400, "F2").svg.matchAll(/<text class="lab-tick" x="([d.]+)" y="[d.]+" text-anchor="middle">/g)].map((m) => Number(m[1]));
  assert.ok(xs.every((x, i) => i === 0 || x - xs[i - 1] >= 60), "date labels never crowd each other");
});

// 40 วันที่ทดสอบ (ต.ค.–พ.ย.) วันละ 2 ครั้ง ค่า MH−ML เพิ่มทีละวัน: ใช้ทดสอบช่วงวัน
const longRun = model.normalizeTests(Array.from({ length: 40 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
  return [0, 1].map((k) => ({ id: i * 2 + k, machine_id: String(110 + k), test_date: date, test_time: `0${8 + k}:00`, ml: 1, mh: 2 + i + k * 0.1, ts2_s: 30, t90_s: 100 + i }));
}).flat());

test("trend range: the latest 30 test days by default, all, months, and the table follows the range", () => {
  const days = model.groupByDate(longRun);
  assert.deepEqual(views.trendRange({ kind: "latest" }, days), { start: 10, end: 40 }, "the latest 30 days");
  assert.deepEqual(views.trendRange(undefined, days), { start: 10, end: 40 });
  assert.deepEqual(views.trendRange({ kind: "all" }, days), { start: 0, end: 40 });
  assert.deepEqual(views.trendRange({ kind: "months", from: "2026-11", to: "2026-11" }, days), { start: 31, end: 40 }, "November = 1–9 Nov");
  assert.deepEqual(views.trendRange({ kind: "custom", start: 38, end: 39 }, days), { start: 37, end: 40 }, "never narrower than 3 days");
  assert.deepEqual(views.trendRange({ kind: "latest" }, days.slice(0, 16)), { start: 0, end: 16 }, "fewer days than 30: all of them");
  const shown = views.rangeDays(days, { start: 37, end: 40 });
  assert.deepEqual(shown.map((day) => day.date), ["2026-11-09", "2026-11-08", "2026-11-07"], "newest first, like the table");
  assert.equal(views.rangeAnnouncement(days, { start: 37, end: 40 }), "แสดง 7 พ.ย. 2569 ถึง 9 พ.ย. 2569 3 จาก 40 วันที่ทดสอบ");
  assert.equal(views.formatMonth("2026-10"), "ต.ค. 2569");
  const page = views.formulaBody({ part: "F2", formula: "A2004" }, { formulas, tests: longRun, curveDate: null, curves: [] }, { kind: "custom", start: 37, end: 40 });
  assert.equal(count(page, /class="lab-mdr-day-row/g), 3, "the table lists only the days in the range");
  assert.match(page, /id="mdr-zoom"[^>]*hidden/, "the bar waits for the page script to paint its state");
  assert.match(page, />ล่าสุด 30 วัน</);
  assert.match(page, />ทั้งหมด</);
  assert.match(page, /id="mdr-month-from" data-native-select/, "native month selects: tappable on iPhone, no app popup");
  assert.equal(count(page, /class="lab-step" data-step="(back|forward|out|in)"/g), 4);
});

test("trend chart over a range: only the days in range are drawn, the normal band still comes from every test", () => {
  const days = model.groupByDate(longRun);
  const all = views.trendSvg(days, "delta", 800, "F1");
  const part = views.trendSvg(days, "delta", 800, "F1", { start: 37, end: 40 });
  assert.equal(count(part.svg, /class="lab-mdr-avg-pt"/g), 3, "an AVG point per day in range");
  assert.equal(count(part.svg, /class="lab-mdr-dot/g), 6);
  assert.equal(part.note, all.note, "same normal band whatever the range");
  assert.notEqual(part.note, views.trendSvg(views.rangeDays(days, { start: 37, end: 40 }), "delta", 800, "F1").note, "a band of the range alone would differ");
  assert.match(views.trendSvg(days, "ts2_s", 800, "F1").svg, /lab-mdr-dot/, "cure trend can show ts2");
  const noValue = model.normalizeTests([{ id: 1, machine_id: "1", test_date: "2026-11-01", test_time: "08:00", ml: 1, mh: 2, t90_s: 100 }, { id: 2, machine_id: "1", test_date: "2026-11-05", test_time: "08:00", ml: 1, mh: 2, t90_s: null }]);
  assert.match(views.trendSvg(model.groupByDate(noValue), "t90_s", 600, "F1", { start: 1, end: 2 }).note, /ไม่มีค่า t90 ในช่วงวันที่เลือก/);
  assert.deepEqual(views.trendModes(model.groupByDate(noValue)).map((mode) => mode.key), ["delta", "t90_s"]);
});

test("torque chart range: the latest test day by default, one day at least, links and the table's button mean one day", () => {
  const days = model.groupByDate(longRun);
  assert.equal(views.CURVE_DEFAULT_DAYS, 1);
  assert.deepEqual(views.curveRange({ kind: "latest" }, days), { start: 39, end: 40 }, "today's view: the newest day only");
  assert.deepEqual(views.curveRange({ kind: "all" }, days), { start: 0, end: 40 });
  assert.deepEqual(views.curveRange({ kind: "custom", start: 20, end: 20 }, days), { start: 20, end: 21 }, "never narrower than one day");
  assert.deepEqual(views.curveZoomFor(days, "2026-11-02"), { kind: "dates", from: "2026-11-02", to: "2026-11-02" }, "?date= = that day, kept as a date");
  assert.deepEqual(views.curveRange(views.curveZoomFor(days, "2026-11-02"), days), { start: 32, end: 33 });
  assert.deepEqual(views.curveZoomFor(days, "2026-11-09"), { kind: "latest" }, "the newest day = the latest button (follows new uploads)");
  assert.deepEqual(views.curveZoomFor(days, "2020-01-01"), { kind: "latest" }, "an unknown day falls back to the latest");
  assert.deepEqual(views.curveRangeDates(days, { start: 37, end: 40 }), ["2026-11-07", "2026-11-08", "2026-11-09"], "oldest first");
  const page = views.formulaBody({ part: "F1", formula: "A2004" }, { formulas, tests: longRun, curveDate: "2026-11-09", curves: [] }, undefined, { kind: "all" });
  assert.match(page, /id="mdr-curve-zoom" role="toolbar" aria-label="ช่วงวันของกราฟแรงบิด" hidden/, "the torque bar is named for its chart");
  assert.match(page, /id="mdr-zoom" role="toolbar" aria-label="ช่วงวันของกราฟแนวโน้มและตาราง" hidden/, "the trend bar keeps its own name");
  assert.match(page, />วันล่าสุด</, "the torque bar's latest button");
  assert.match(page, /id="mdr-curve-month-from" data-native-select/);
  assert.equal(count(page, /lab-mdr-day-flag/g), 30, "every day of the torque range shown in the table is marked as charted");
  assert.match(page, /<span class="lab-mdr-chart-when" id="mdr-curve-when"><\/span>/, "several days: no date in the heading (the day keys carry them)");
  const trendCut = views.formulaBody({ part: "F1", formula: "A2004" }, { formulas, tests: longRun, curveDate: "2026-11-09", curves: [] }, { kind: "latest" }, { kind: "custom", start: 37, end: 38, follow: false });
  assert.match(trendCut, /data-show-date="2026-11-09"/, "days outside the torque range offer their chart");
  assert.equal(count(trendCut, /lab-mdr-day-flag/g), 1);
});

test("torque chart over several days: a colour and a key per day, the tooltip lists each day's average t90", () => {
  const days = model.groupByDate(tests);
  const short = Array.from({ length: 361 }, (_, i) => Math.min(8.6, 2.2 + i * 0.1));
  const curves = [{ id: 1, curve: short }, { id: 2, curve: short }, { id: 3, curve: short }, { id: 99, curve: short }];
  const one = views.curveView(days, ["2026-11-02"], curves);
  assert.equal(one.multi, false);
  assert.deepEqual(one.series.map((item) => [item.id, item.color]), [["1", views.LINE_COLORS[0]], ["2", views.LINE_COLORS[1]]], "one day: a colour per test, curves of other days left out");
  assert.match(one.legend, /data-test="1"[\s\S]*ID 111<\/span><small>15:49<\/small>/);
  const both = views.curveView(days, ["2026-11-02", "2026-11-03"], curves, 5);
  assert.equal(both.multi, true);
  assert.deepEqual(both.series.map((item) => [item.id, item.day, item.color, item.step]), [
    ["1", "2026-11-02", views.LINE_COLORS[0], 5], ["2", "2026-11-02", views.LINE_COLORS[0], 5], ["3", "2026-11-03", views.LINE_COLORS[1], 5],
  ], "several days: one colour per day, oldest day first; a curve without a test (id 99) is not drawn");
  assert.equal(count(both.legend, /class="lab-mdr-key"/g), 2, "a key per day");
  assert.match(both.legend, /data-day="2026-11-02"[\s\S]*2 พ.ย. 2569<\/span><small>2 ครั้ง<\/small>/, "day key = date + count");
  const rows = views.dayTipRows(both.series);
  assert.deepEqual(rows.map((row) => [row.date, row.t90]), [["2026-11-02", 172], ["2026-11-03", 170]], "average t90 per day: (177 + 166) / 2 rounds to 172");
  assert.match(views.dayTipHtml(rows), /t90 เฉลี่ย \(นาที:วินาที\)[\s\S]*2 พ.ย. 2569<b>2:52<\/b>/);
  assert.equal(views.dayTipRows([{ day: "2026-11-02", color: "#fff", t90: null }])[0].t90, null, "a day where no test reached 90%: no average");
  const manyRows = Array.from({ length: 20 }, (_, i) => ({ color: "#fff", date: `2026-10-${String(i + 1).padStart(2, "0")}`, t90: 160 }));
  const longTip = views.dayTipHtml(manyRows);
  assert.equal(count(longTip, /lab-mdr-tip-row/g), 8, "the tooltip never grows taller than the chart: the latest 8 days");
  assert.match(longTip, /วันก่อนหน้าอีก 12 วัน/);
  assert.match(longTip, /20 ต.ค. 2569/);
  assert.doesNotMatch(longTip, />1 ต.ค. 2569</);
  const { svg, geometry } = views.chartSvg(both.series, 800);
  assert.equal(geometry.seconds, 1800, "361 points every 5 s still span 30 minutes");
  assert.match(svg, />30<\/text>/, "same 0–30 min axis");
  assert.equal(count(svg, /data-day="2026-11-02"/g), 2, "lines carry their day for the day keys");
  assert.match(svg, /<circle class="lab-mdr-t90" cx="[\d.]+" cy="[\d.]+" r="3.5"\/>/, "t90 marked at the nearest sampled point");
  assert.match(views.plotLabel(["2026-11-02", "2026-11-03"]), /2 วัน ตั้งแต่ 2 พ.ย. 2569 ถึง 3 พ.ย. 2569 สีตามวัน/);
});

// ต.ค. มี 2 วันที่ทดสอบ (27, 28) แล้ว พ.ย. 5 วัน: กรณีที่ผู้ใช้เลือก ต.ค. → ต.ค. แล้วระบบเติม 2 พ.ย. เอง
const twoOctoberDays = model.normalizeTests(["2026-10-27", "2026-10-28", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]
  .map((date, i) => ({ id: i + 1, machine_id: "111", test_date: date, test_time: "08:00", set_minutes: 30, temperature_c: 155, ml: 1, mh: 6 + i * 0.1, ts2_s: 30, t90_s: 150 })));

test("A: a month pick shows exactly the test days of the chosen months, even fewer than the zoom minimum", () => {
  const days = model.groupByDate(twoOctoberDays);
  assert.deepEqual(views.trendRange({ kind: "months", from: "2026-10", to: "2026-10" }, days), { start: 0, end: 2 }, "27 and 28 Oct only, no 2 Nov added");
  assert.deepEqual(views.rangeDays(days, views.trendRange({ kind: "months", from: "2026-10", to: "2026-10" }, days)).map((day) => day.date), ["2026-10-28", "2026-10-27"]);
  const oneDay = model.groupByDate(twoOctoberDays.filter((test) => test.test_date !== "2026-10-27"));
  assert.deepEqual(views.trendRange({ kind: "months", from: "2026-10", to: "2026-10" }, oneDay), { start: 0, end: 1 }, "a month with one test day = that one day");
  assert.deepEqual(views.curveRange({ kind: "months", from: "2026-10", to: "2026-10" }, days), { start: 0, end: 2 }, "the torque chart's month pick too");
  assert.deepEqual(views.trendRange({ kind: "custom", start: 5, end: 6 }, days), { start: 4, end: 7 }, "the + button still stops at 3 days");
  const svg = views.trendSvg(days, "delta", 600, "F1", views.trendRange({ kind: "months", from: "2026-10", to: "2026-10" }, days)).svg;
  assert.equal(count(svg, /class="lab-mdr-avg-pt"/g), 2, "the chart draws the two October days only");
  assert.doesNotMatch(svg, /2 พ.ย./);
});

test("B: the table shows the set time once, and a day with two set times gets two labelled AVG/SD blocks; the trend follows one condition", () => {
  const mixed = model.normalizeTests([
    ...[["111", 30, 7.24], ["112", 30, 7.16], ["113", 30, 7.12], ["121", 20, 8.03], ["122", 20, 8.15], ["123", 20, 7.71]].map(([id, minutes, mh], i) => ({ id: i + 1, machine_id: id, test_date: "2026-11-10", test_time: `1${i}:00`, set_minutes: minutes, temperature_c: 155, ml: 1.95, mh, t90_s: 160, result: "OK" })),
    { id: 7, machine_id: "111", test_date: "2026-11-11", test_time: "09:00", set_minutes: 30, temperature_c: 155, ml: 1.9, mh: 7.2, t90_s: 158, result: "OK" },
  ]);
  const days = model.groupByDate(mixed);
  const html = views.resultsTable("F1", days, []);
  const text = visibleText(html);
  assert.equal(count(html, /class="lab-mdr-stat"/g), 3, "two AVG rows on 10 Nov (30 and 20 min), one on 11 Nov");
  assert.equal(count(html, /class="lab-mdr-cond-row"/g), 2, "each block on 10 Nov has its own heading");
  assert.match(text, /30 นาที · 155 °C 3 ครั้ง .* 20 นาที · 155 °C 3 ครั้ง/);
  assert.match(html, /AVG<span class="sr-only"> 20 นาที · 155 °C<\/span>/, "the AVG row names its condition for screen readers");
  assert.match(html, /<td class="num">5.22<\/td>/, "AVG MH−ML of the 30-minute tests");
  assert.match(html, /<td class="num">6.01<\/td>/, "AVG MH−ML of the 20-minute tests");
  assert.match(html, /<span class="lab-mdr-day-cond">30 นาที · 155 °C<\/span>/, "11 Nov has one condition: said once in its day row");
  assert.equal(count(visibleText(html.replace(/<span class="sr-only">[^<]*<\/span>/g, "")), /30 นาที/g), 2, "seen once per day, not on every test row");
  assert.doesNotMatch(html, /อุณหภูมิ \(°C\)|Result/, "no temperature column (it is part of the condition) and no Result column when every test is OK");
  const single = views.resultsTable("F1", model.groupByDate(mixed.slice(0, 3)), []);
  assert.match(single, /<p class="lab-mdr-cond-all">ทุกครั้งทดสอบ 30 นาที · 155 °C<\/p>/, "one condition in the whole table: stated once above it");
  assert.doesNotMatch(single, /lab-mdr-day-cond|lab-mdr-cond-row/);
  const bad = views.resultsTable("F1", model.groupByDate([{ ...mixed[0], result: "NG" }, mixed[1]]), []);
  assert.match(bad, /ผลของเครื่อง \(Result\)/);
  assert.match(bad, /<td class="lab-mdr-result-bad">NG<\/td>/, "a result that is not OK is shown");
  const thirty = views.trendSvg(days, "delta", 600, "F1", null, "30|155").svg;
  assert.equal(count(thirty, /class="lab-mdr-dot/g), 4, "the trend draws only the chosen condition");
  assert.equal(views.trendCondition(mixed, null), "30|155", "default condition = the one with most tests");
  assert.equal(views.trendCondition(mixed, "20|155"), "20|155");
  assert.equal(views.trendCondition(mixed, "99|155"), "30|155", "a condition no longer in the data falls back");
  const card = views.trendCard({ formula: "A2004" }, days, "20|155");
  assert.match(card, /<option value="20\|155" selected>20 นาที · 155 °C \(3 ครั้ง\)<\/option>/);
  assert.doesNotMatch(views.trendCard({ formula: "A2004" }, model.groupByDate(mixed.slice(0, 3)), "30|155"), /id="mdr-cond"/, "one condition: no picker");
});

test("C: t90 of a test that did not swell shows a dash with the reason and stays out of the trend", () => {
  const f2 = model.applyDisplayRules(model.normalizeTests([
    { id: 1, machine_id: "111", test_date: "2026-11-14", test_time: "09:00", set_minutes: 30, temperature_c: 155, ml: 6092, mh: 6097, t50_s: 1793, t90_s: 1797 },
    { id: 2, machine_id: "112", test_date: "2026-11-14", test_time: "09:40", set_minutes: 30, temperature_c: 155, ml: 8444, mh: 34131, t50_s: 61, t90_s: 261 },
  ]), "F2");
  const days = model.groupByDate(f2);
  const html = views.resultsTable("F2", days, []);
  assert.match(html, /<td class="num">6,092<\/td><td class="num">6,097<\/td>/, "ML and MH stay visible");
  assert.match(html, /<td class="num lab-mdr-unmeasured" title="ยางไม่พองตัว[^"]*">–/);
  assert.match(html, /lab-mdr-swell-note/, "the dash is explained once above the table");
  assert.match(html, /<td class="num">4:21<\/td>/, "the test that swelled keeps its t90");
  assert.equal(count(views.trendSvg(days, "t90_s", 600, "F2").svg, /class="lab-mdr-dot/g), 1);
  const none = views.resultsTable("F2", model.groupByDate(f2.slice(0, 1)), []);
  assert.match(none, /t90 \(นาที:วินาที\)/, "the t90 column stays even when no test of the range swelled");
});

test("D: the normal band needs 10 tests of one condition and says how many it is based on", () => {
  const make = (n) => model.groupByDate(model.normalizeTests(Array.from({ length: n }, (_, i) => ({ id: i, machine_id: "1", test_date: `2026-11-${String(1 + (i % 9)).padStart(2, "0")}`, test_time: `0${i % 9}:00`, set_minutes: 30, temperature_c: 155, ml: 1, mh: 6 + (i % 3) * 0.2 }))));
  const nine = views.trendSvg(make(9), "delta", 600, "F1");
  assert.equal(nine.hasBand, false);
  assert.doesNotMatch(nine.svg, /lab-mdr-band/);
  assert.equal(nine.note, "ยังไม่มีช่วงปกติ: มีผล MH−ML 9 ครั้ง ต้องมีอย่างน้อย 10 ครั้ง");
  const ten = views.trendSvg(make(10), "delta", 600, "F1");
  assert.equal(ten.hasBand, true);
  assert.match(ten.svg, /lab-mdr-band/);
  assert.match(ten.note, /^ช่วงปกติ MH−ML [\d.]+ – [\d.]+ \(AVG ± 2SD จาก 10 ครั้ง\)$/);
  const page = views.formulaBody({ part: "F1", formula: "A2004" }, { formulas, tests, curveDate: null, curves: [] });
  assert.match(page, /<span class="lab-mdr-key-band" id="mdr-band-key" hidden>/, "the band key waits until a band is drawn");
});

test("E: a chosen range is kept as dates, so days uploaded before it do not move it", () => {
  const days = model.groupByDate(longRun);
  const zoom = views.toDayZoom({ kind: "custom", start: 32, end: 34, follow: false }, days);
  assert.deepEqual(zoom, { kind: "dates", from: "2026-11-02", to: "2026-11-03" });
  const older = model.groupByDate([...longRun, ...model.normalizeTests([{ id: 900, machine_id: "1", test_date: "2026-09-20", test_time: "08:00", ml: 1, mh: 2 }, { id: 901, machine_id: "1", test_date: "2026-09-21", test_time: "08:00", ml: 1, mh: 2 }])]);
  assert.deepEqual(views.curveRangeDates(older, views.curveRange(zoom, older)), ["2026-11-02", "2026-11-03"], "same two days after two older days arrive");
  assert.deepEqual(views.rangeDays(older, views.trendRange({ kind: "dates", from: "2026-10-05", to: "2026-10-20" }, older)).length, 16);
  assert.deepEqual(views.toDayZoom({ kind: "custom", start: 30, end: 40, follow: true }, days), { kind: "custom", start: 30, end: 40, follow: true }, "a range on the newest day keeps following new days");
  assert.deepEqual(views.fromDayZoom({ kind: "dates", from: "2020-01-01", to: "2020-02-01" }, days), { kind: "latest" }, "dates that are gone fall back to the latest");
});

test("F/G: many line keys fold behind one button, the t90 tooltip uses columns, colours do not repeat after 16", () => {
  const many = model.normalizeTests(Array.from({ length: 15 }, (_, i) => ({ id: i + 1, machine_id: String(200 + i), test_date: "2026-11-18", test_time: `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`, set_minutes: 30, temperature_c: 155, ml: 2, mh: 8, t90_s: 150 })));
  const view = views.curveView(model.groupByDate(many), ["2026-11-18"], many.map((test) => ({ id: test.id, curve })));
  assert.match(view.legend, /^<button type="button" class="lab-mdr-keys-toggle" id="mdr-keys-toggle" aria-expanded="false" aria-controls="mdr-legend-keys">/);
  assert.match(view.legend, /<div class="lab-mdr-keys" id="mdr-legend-keys" hidden>/);
  assert.equal(count(view.legend, /class="lab-mdr-key"/g), 15, "every key is still there behind the button");
  assert.doesNotMatch(views.curveView(model.groupByDate(tests), ["2026-11-02"], [{ id: 1, curve }, { id: 2, curve }]).legend, /keys-toggle/, "two keys stay open");
  const tip = views.tipHtml(view.series.map((item) => ({ color: item.color, machineId: item.machineId, t90: item.t90 })));
  assert.match(tip, /<span class="lab-mdr-tip-rows" style="--tip-rows:8">/, "15 rows = two columns of 8");
  assert.match(views.tipHtml([{ color: "#fff", machineId: "1", t90: 100 }]), /--tip-rows:1"/);
  const colours = Array.from({ length: 40 }, (_, i) => views.lineColor(i));
  assert.equal(new Set(colours).size, 40, "40 days in a range: 40 different colours");
  assert.equal(views.lineColor(3), views.LINE_COLORS[3]);
});
