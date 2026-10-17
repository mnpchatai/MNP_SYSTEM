import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// กราฟและ HTML ของ MNP LAB เป็นข้อความล้วน (ไม่มี DOM) โหลดตรงๆ ได้: ไฟล์ chart/views อ่าน model จาก globalThis เหมือนที่อ่านจาก window ใน browser
// การโต้ตอบจริง (ชี้ แตะ คีย์บอร์ด ปรับขนาด) ตรวจด้วยเบราว์เซอร์แยกต่างหาก ที่นี่ตรวจรูปร่างของสิ่งที่วาดและความปลอดภัยของข้อความจากชีต
const require = createRequire(import.meta.url);
const model = require("../../modules/lab-mooney-model.js");
globalThis.MNP_LAB_MOONEY = model;
const chart = require("../../modules/lab-mooney-chart.js");
globalThis.MNP_LAB_CHART = chart;
const views = require("../../modules/lab-mooney-views.js");

const XSS = `<img src=x onerror=alert(1)>`;
const row = (overrides = {}) => ({
  source_sheet: "A1802", sample_id: "111", material: "A1802", test_date: "2026-09-21", test_time: "08:29:13",
  temperature_c: 100, test_minutes: 4, mh: 50, mv: 30, avg_mh: 50.5, sd_mh: 0.5, avg_mv: 30.5, sd_mv: 0.25, ...overrides,
});

// 3 ชุด (ชุดละ 3 แถว) กระจายใน 2 วัน + 1 แถวที่ยังไม่มี AVG/SD
function seriesFixture(extra = []) {
  const make = (ids, date, stats, mh) => ids.map((id, index) => row({
    sample_id: id, test_date: date, test_time: `08:0${index}:00`, mh: mh + index, mv: stats[2] - 1 + index,
    avg_mh: stats[0], sd_mh: stats[1], avg_mv: stats[2], sd_mv: stats[3],
  }));
  const rows = model.normalizeFeed({ rows: [
    ...make(["111", "112", "113"], "2026-09-21", [51, 1, 31, 1], 50),
    ...make(["121", "122", "123"], "2026-09-21", [61, 1, 36, 1], 60),
    ...make(["211", "212", "213"], "2026-09-22", [71, 1, 41, 1], 70),
    row({ sample_id: "311", test_date: "2026-09-22", test_time: "10:00:00", mh: 75, mv: 45, avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null }),
    ...extra,
  ] }).rows;
  return model.buildSeries(rows, "A1802");
}

const count = (text, pattern) => (text.match(pattern) ?? []).length;
const noBadNumbers = (text) => assert.doesNotMatch(text, /NaN|Infinity|undefined|null/);

/* ---------- กราฟ ---------- */

test("the sequence chart draws MH and MV together in one plot with one point per test in each", () => {
  const { items, groups } = seriesFixture();
  const result = chart.trendChart({ mode: "sequence", items, groups, width: 900, label: "A1802" });
  assert.equal(result.count, 10);
  assert.equal(count(result.html, /class="lab-panel"/g), 1, "one panel, not one per series");
  assert.equal(count(result.html, /<svg /g), 1, "one plot with a single value axis");
  assert.equal(count(result.html, /class="lab-cross"/g), 1);
  assert.equal(count(result.html, /class="lab-series"/g), 2, "the header names both series once and doubles as the legend");
  assert.equal(count(result.html, /class="lab-pt lab-pt-mh"/g), 10);
  assert.equal(count(result.html, /class="lab-pt lab-pt-mv"/g), 10);
  assert.equal(count(result.html, /<circle class="lab-dot"/g), 10, "MH is a circle");
  assert.equal(count(result.html, /<rect class="lab-dot"/g), 10, "MV is a rotated square, so the two series also differ by shape");
  assert.equal(count(result.html, /เฉลี่ย <b>[\d.]+<\/b> · SD <b>[\d.]+<\/b>/g), 2);
  const headers = result.html.match(/<span class="lab-panel-stats">.*?<\/span>/g).join("");
  assert.doesNotMatch(headers, /ช่วง/, "the range is read from the axis, not repeated as numbers in the panel header");
  noBadNumbers(result.html);
});

test("MH and MV share one value axis that covers both series", () => {
  const { items, groups } = seriesFixture();
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 900 });
  const ticks = [...html.matchAll(/<text class="lab-tick" x="[\d.]+" y="[\d.]+" text-anchor="end">([\d.]+)</g)].map((match) => Number(match[1]));
  assert.ok(ticks.length >= 3, "one set of value ticks");
  assert.equal(new Set(ticks).size, ticks.length, "no second axis repeating the ticks");
  assert.ok(Math.min(...ticks) <= 30 && Math.max(...ticks) >= 75, "the axis spans the lowest MV (30) to the highest MH (75)");
  const y = (series, index) => Number(html.match(new RegExp(`class="lab-pt lab-pt-${series}" data-i="${index}" transform="translate\\([\\d.]+ ([\\d.]+)\\)"`))[1]);
  assert.ok(y("mv", 0) > y("mh", 0), "MV (30) is drawn below MH (50) on the same scale");
});

test("groups with stats keep the sheet's solid AVG mark and the row still waiting for stats gets a dashed computed one", () => {
  const { items, groups } = seriesFixture();
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 900 });
  assert.equal(count(html, /class="lab-avg lab-avg-mh"/g), 3, "sheet values are drawn as solid marks");
  assert.equal(count(html, /class="lab-avg lab-avg-mv"/g), 3);
  assert.equal(count(html, /class="lab-avg lab-avg-mh is-calc"/g), 1, "the last row has no AVG in the sheet yet, so it gets a computed mark");
  assert.equal(count(html, /class="lab-avg lab-avg-mv is-calc"/g), 1);
  noBadNumbers(html);
});

/* ---------- ขีด AVG ต้องมีทุกครั้งที่ทดสอบ (เช่น เพิ่มสูตรใหม่ที่ชีตยังไม่มี AVG) ---------- */

const bare = (ids, date, overrides = {}) => ids.map((id, index) => row({
  sample_id: id, test_date: date, test_time: `09:0${index}:00`, mh: 40 + index, mv: 20 + index,
  avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null, ...overrides,
}));
const seriesOfRows = (rows) => model.buildSeries(model.normalizeFeed({ rows }).rows, "A1802");
// จำนวนขีดที่ครอบแต่ละครั้งที่ทดสอบ (ต้องเป็น 1 ทุกตำแหน่ง)
const coverage = (marks, total) => {
  const hits = Array(total).fill(0);
  for (const mark of marks) for (let index = mark.start; index < mark.start + mark.count; index += 1) hits[index] += 1;
  return hits;
};

test("a new formula with no AVG anywhere still gets an average mark over every test, in sets of three", () => {
  const { items, groups } = seriesOfRows(bare(["1", "2", "3", "4", "5", "6", "7"], "2026-10-06"));
  const marks = chart.averageMarks(groups);
  assert.deepEqual(marks.map((mark) => [mark.start, mark.count]), [[0, 3], [3, 3], [6, 1]]);
  assert.deepEqual(coverage(marks, items.length), Array(7).fill(1), "every test sits under exactly one mark");
  assert.ok(marks.every((mark) => mark.mh.computed && mark.mv.computed), "nothing here comes from the sheet");
  assert.equal(marks[0].mh.value, 41, "the mean of the three readings 40, 41, 42");
  assert.equal(marks[1].mv.value, 24);
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 900 });
  assert.equal(count(html, /class="lab-avg lab-avg-mh is-calc"/g), 3);
  assert.equal(count(html, /class="lab-avg lab-avg-mv is-calc"/g), 3);
  assert.equal(count(html, /class="lab-avg lab-avg-mh"/g), 0, "no solid mark: there is no sheet value to show");
  noBadNumbers(html);
});

test("the provisional set size follows the material's own sets in the sheet", () => {
  // ค่าที่อ่านได้เฉลี่ยออกมาเท่ากับ AVG ของชีต (ชุดละ 5 แถว: avg−2 … avg+2)
  const five = (ids, date, stats) => ids.map((id, index) => row({ sample_id: id, test_date: date, test_time: `08:0${index}:00`, mh: stats[0] - 2 + index, mv: stats[1] - 2 + index, avg_mh: stats[0], sd_mh: 1, avg_mv: stats[1], sd_mv: 1 }));
  const { items, groups } = seriesOfRows([
    ...five(["1", "2", "3", "4", "5"], "2026-10-01", [51, 31]),
    ...five(["6", "7", "8", "9", "10"], "2026-10-01", [61, 36]),
    ...bare(["11", "12", "13", "14", "15", "16", "17"], "2026-10-02"),
  ]);
  const marks = chart.averageMarks(groups);
  assert.deepEqual(marks.map((mark) => mark.count), [5, 5, 5, 2]);
  assert.equal(marks[0].mh.computed, false, "a set the sheet already averaged keeps the sheet value");
  assert.equal(marks[0].mh.value, 51);
  assert.deepEqual(coverage(marks, items.length), Array(items.length).fill(1));
});

test("provisional sets never span a test day or a sheet tab", () => {
  const rows = [
    ...bare(["1", "2"], "2026-10-05"),
    ...bare(["3", "4"], "2026-10-06"),
    ...bare(["5", "6"], "2026-10-06", { source_sheet: "B1802" }),
  ];
  const { items, groups } = seriesOfRows(rows);
  const marks = chart.averageMarks(groups);
  assert.deepEqual(marks.map((mark) => [mark.start, mark.count]), [[0, 2], [2, 2], [4, 2]]);
  assert.deepEqual(coverage(marks, items.length), Array(6).fill(1));
});

test("a set with only some sheet values fills the missing series from its own readings", () => {
  const rows = [0, 1, 2].map((index) => row({ sample_id: String(index + 1), test_time: `08:0${index}:00`, mh: 50 + index, mv: 30 + index, avg_mh: 51, sd_mh: 1, avg_mv: null, sd_mv: null }));
  const { groups } = seriesOfRows(rows);
  const [mark] = chart.averageMarks(groups);
  assert.deepEqual(mark.mh, { value: 51, computed: false });
  assert.deepEqual(mark.mv, { value: 31, computed: true });
});

// แถวจริงของแท็บ "E00030S B" (อ่านจากฐานข้อมูลจริง 17 ต.ค. 2026): ชีตมี AVG/SD ทุกแถว แต่ค่าไม่ใช่ค่าเฉลี่ยของแถวเหล่านั้น
// (AVG MH ราว 2.6 ทั้งที่ MH อ่านได้ 25–27, AVG MV = 0 / 4.9) และต่างกันทุกแถว ไม่ merge เป็นชุด — ขีดจากค่านี้ตกนอกกรอบกราฟจนมองไม่เห็น
const BAD_SHEET_ROWS = [
  ["111", "16:08:28", 25.36, 23.52, 2.65, 3.33, 0, 0],
  ["112", "16:20:22", 26.75, 23.42, 2.6, 3.18, 4.92, 5.48],
  ["113", "16:29:50", 24.98, 23, 2.27, 2.88, 4.68, 5.25],
  ["121", "16:39:21", 27, 24.29, 2.33, 3.18, 4.7, 5.27],
  ["122", "16:48:55", 26.33, 23.93, 2.35, 2.97, 4.62, 5.22],
  ["123", "16:56:59", 25.4, 24.16, 2.12, 2.75, 4.38, 4.95],
].map(([id, time, mh, mv, avgMh, sdMh, avgMv, sdMv]) => row({
  source_sheet: "E00030S B", material: "E00030S B", sample_id: id, test_date: "2026-10-06", test_time: time,
  mh, mv, avg_mh: avgMh, sd_mh: sdMh, avg_mv: avgMv, sd_mv: sdMv,
}));

test("sheet AVG values that cannot be the average of the set's readings are not drawn; the set gets a computed mark instead", () => {
  const { items, groups } = model.buildSeries(model.normalizeFeed({ rows: BAD_SHEET_ROWS }).rows, "E00030S B");
  const marks = chart.averageMarks(groups);
  assert.deepEqual(marks.map((mark) => [mark.start, mark.count]), [[0, 3], [3, 3]], "rows with unusable stats are grouped as provisional sets of three, not one mark per row");
  assert.ok(marks.every((mark) => mark.mh.computed && mark.mv.computed));
  assert.ok(Math.abs(marks[0].mh.value - (25.36 + 26.75 + 24.98) / 3) < 1e-9);
  assert.ok(Math.abs(marks[1].mv.value - (24.29 + 23.93 + 24.16) / 3) < 1e-9);
  assert.deepEqual(coverage(marks, items.length), Array(6).fill(1));
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 900 });
  assert.equal(count(html, /class="lab-avg lab-avg-mh"/g), 0, "no solid mark from the unusable sheet values");
  const plotted = [...html.matchAll(/class="lab-avg lab-avg-m[hv] is-calc" x1="[\d.]+" x2="[\d.]+" y1="([\d.-]+)"/g)].map((match) => Number(match[1]));
  assert.equal(plotted.length, 4);
  assert.ok(plotted.every((y) => y > 0 && y < 400), "every mark lands inside the plot instead of far below it");
});

test("a set whose sheet AVG fits only one series keeps the set but computes the other series", () => {
  const rows = [0, 1, 2].map((index) => row({ sample_id: String(index + 1), test_time: `08:0${index}:00`, mh: 50 + index, mv: 30 + index, avg_mh: 51, sd_mh: 1, avg_mv: 0, sd_mv: 0 }));
  const { groups } = seriesOfRows(rows);
  const marks = chart.averageMarks(groups);
  assert.equal(marks.length, 1, "the sheet's merge still defines the set");
  assert.deepEqual(marks[0].mh, { value: 51, computed: false });
  assert.deepEqual(marks[0].mv, { value: 31, computed: true });
});

test("a series with no readings in a set has no mark rather than a made-up value", () => {
  const { items, groups } = seriesOfRows(bare(["1", "2", "3"], "2026-10-06", { mv: null }));
  const [mark] = chart.averageMarks(groups);
  assert.ok(mark.mh);
  assert.equal(mark.mv, null);
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 600 });
  assert.equal(count(html, /class="lab-avg lab-avg-mv/g), 0);
  noBadNumbers(html);
  assert.deepEqual(chart.averageMarks([]), []);
});

test("background bands alternate every 6 points regardless of the test day, and the newest day always keeps its date label", () => {
  assert.equal(chart.BAND_SIZE, 6);
  const { items, groups } = seriesFixture();
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 900 });
  assert.equal(count(html, /class="lab-band"/g), 1, "10 points → one shaded band (points 1–6), points 7–10 stay on the plain background");
  const longRun = Array.from({ length: 40 }, (_, index) => row({ sample_id: String(300 + index), test_date: index < 20 ? "2026-09-21" : "2026-09-22", test_time: `08:${String(index).padStart(2, "0")}:00`, avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null }));
  const long = seriesFixture(longRun);
  const chartLong = chart.trendChart({ mode: "sequence", items: long.items, groups: long.groups, width: 900 });
  const bands = [...chartLong.html.matchAll(/class="lab-band" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((match) => [Number(match[1]), Number(match[2])]);
  const slot = (chartLong.xAt(1) - chartLong.xAt(0));
  const total = long.items.length;
  assert.equal(bands.length, Math.ceil(total / 12), "one shaded band per 12 points (6 shaded + 6 plain)");
  bands.forEach(([x, width], index) => {
    const start = index * 12;
    assert.ok(Math.abs(x - (chartLong.xAt(start) - slot / 2)) < 0.02, `band ${index} starts at point ${start + 1}`);
    assert.ok(Math.abs(width - Math.min(6, total - start) * slot) < 0.05, `band ${index} spans up to 6 points`);
  });
  assert.match(html, />21\/09</);
  assert.match(html, />22\/09</);
  const crowded = Array.from({ length: 40 }, (_, day) => row({ sample_id: String(100 + day), test_date: `2026-09-${String((day % 28) + 1).padStart(2, "0")}`, avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null }));
  const narrow = seriesFixture(crowded);
  const labels = chart.trendChart({ mode: "sequence", items: narrow.items, groups: narrow.groups, width: 320 }).html.match(/<text class="lab-tick"[^>]*text-anchor="(?:start|end)"[^>]*>\d\d\/\d\d</g) ?? [];
  assert.ok(labels.length >= 2 && labels.length <= 8, `date labels are thinned instead of overlapping (${labels.length})`);
});

test("pointer positions map to the nearest test and clamp at both ends", () => {
  const { items, groups } = seriesFixture();
  const result = chart.trendChart({ mode: "sequence", items, groups, width: 900 });
  assert.equal(result.indexAt(-50), 0);
  assert.equal(result.indexAt(0), 0);
  assert.equal(result.indexAt(10000), 9);
  for (let index = 0; index < 10; index += 1) assert.equal(result.indexAt(result.xAt(index)), index, `the centre of point ${index} maps back to itself`);
  assert.ok(result.xAt(1) > result.xAt(0));
  assert.equal(chart.trendChart({ items: [], width: 900 }).indexAt(100), -1);
});

test("the ID chart joins the points, marks the average and labels only the key readings", () => {
  const items = model.idSeries(seriesFixture().items.concat(seriesFixture().items), "111");
  const { html, count: n } = chart.trendChart({ mode: "id", items, width: 700 });
  assert.equal(n, 2);
  assert.equal(count(html, /<polyline class="lab-line/g), 2);
  assert.equal(count(html, /class="lab-mean lab-mean-/g), 2);
  assert.ok(count(html, /class="lab-val"/g) <= 6, "value labels are for the last, highest and lowest readings only");
  assert.equal(count(html, /class="lab-band"/g), 0, "bands belong to the all-tests view");
  noBadNumbers(html);
});

test("a single test, an empty list, missing readings and constant values still draw safely", () => {
  const one = seriesFixture().items.slice(0, 1);
  const single = chart.trendChart({ mode: "sequence", items: one, groups: [], width: 600 });
  assert.equal(count(single.html, /class="lab-pt /g), 2);
  noBadNumbers(single.html);
  assert.equal(chart.trendChart({ mode: "sequence", items: [], width: 600 }).html, "");
  const holes = seriesFixture().items.map((item, index) => (index === 2 ? { ...item, mh: null } : item));
  const gap = chart.trendChart({ mode: "id", items: holes.map((item, index) => ({ ...item, order: index + 1 })), width: 600 });
  assert.equal(count(gap.html, /class="lab-pt lab-pt-mh"/g), 9, "a missing reading is not drawn as zero");
  noBadNumbers(gap.html);
  const flat = seriesFixture().items.map((item) => ({ ...item, mh: 5, mv: 5 }));
  noBadNumbers(chart.trendChart({ mode: "sequence", items: flat, groups: [], width: 600 }).html);
  assert.match(chart.trendChart({ mode: "sequence", items: one, groups: [], width: 10 }).html, /width="280"/, "very narrow containers are clamped");
});

test("text from the sheet cannot inject markup into the chart", () => {
  const { items, groups } = seriesFixture();
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 600, label: XSS });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("sparklines need two readings and mark the latest one", () => {
  assert.equal(chart.sparkline([]), "");
  assert.equal(chart.sparkline([1]), "");
  assert.equal(chart.sparkline([1, null, "x"]), "");
  const spark = chart.sparkline([1, 3, 2, 5], { key: "mv" });
  assert.match(spark, /lab-spark-mv/);
  assert.match(spark, /aria-hidden="true"/);
  assert.equal(count(spark, /<circle /g), 1);
  noBadNumbers(chart.sparkline([4, 4, 4]));
  assert.equal(count(chart.sparkline([1, 2, 3]).match(/points="([^"]+)"/)[1], / /g), 2);
});

/* ---------- หน้ารวม ---------- */

test("the overview row shows the latest group with spread, change and trend, and links to the material", () => {
  const rows = model.normalizeFeed({ rows: [
    row({ sample_id: "111", test_date: "2026-10-14", avg_mh: 80, sd_mh: 1.5, avg_mv: 40, sd_mv: 0.5 }),
    row({ sample_id: "121", test_date: "2026-10-15", avg_mh: 82.5, sd_mh: 1.25, avg_mv: 39, sd_mv: 0.75 }),
  ] }).rows;
  const html = views.materialRows(model.buildMaterialSummaries(rows));
  assert.match(html, /href="#\/lab\?material=A1802"/);
  assert.match(html, /data-href="#\/lab\?material=A1802"/);
  assert.match(html, /<strong>82\.50<\/strong><span class="lab-sd">± 1\.25<\/span>/);
  assert.match(html, /Δ \+2\.50/);
  assert.match(html, /Δ −1\.00/);
  assert.match(html, /2 ผล/);
  assert.equal(count(html, /<svg /g), 2, "one trend line per series");
});

test("each overview fact appears once: the date is not repeated as an age and counts are not repeated as groups or days", () => {
  const rows = model.normalizeFeed({ rows: [row({ test_date: "2026-10-15" }), row({ sample_id: "112", test_date: "2026-10-16" })] }).rows;
  const html = views.materialRows(model.buildMaterialSummaries(rows));
  assert.equal(count(html, /16\/10\/2026/g), 1);
  assert.doesNotMatch(html, /เมื่อวาน|วันนี้|วันก่อน|ชุด ·|วัน</);
  const page = views.overviewPage(30);
  assert.doesNotMatch(page, /id="lab-summary"/, "no totals line: the list itself shows how many materials there are");
  assert.equal(count(page, /MH \/ MV = /g), 1, "the how-to-read key appears once");
});

test("overview rows are safe against hostile names and say so when only a single reading exists", () => {
  const rows = model.normalizeFeed({ rows: [row({ material: XSS, avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null })] }).rows;
  const html = views.materialRows(model.buildMaterialSummaries(rows));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /ค่าเดี่ยว/);
  assert.match(html, /material=%3Cimg/);
  assert.equal(views.materialRows([]), "");
});

test("the overview search is a combobox whose listbox popup sits in the same box as the field, closed at first", () => {
  const page = views.overviewPage(30);
  const box = page.match(/<div class="lab-search">[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
  const input = box.match(/<input[^>]*id="lab-search"[^>]*>/)?.[0] ?? "";
  assert.match(input, /role="combobox"/);
  assert.match(input, /aria-autocomplete="list"/);
  assert.match(input, /aria-controls="lab-search-list"/);
  assert.match(input, /aria-expanded="false"/);
  // AGENTS.md: popup อยู่กรอบเดียวกับช่อง (parent เดียวกัน) มี data-popup และเริ่มต้นปิด เพื่อให้กฎกลาง closePopup ของ app.js ดูแลการปิด
  assert.match(box, /<div class="ss-list" id="lab-search-list" role="listbox"[^>]*data-popup hidden><\/div>/);
  assert.equal(count(page, /id="lab-search-list"/g), 1);
});

test("search suggestions are one option per material, addressed by position, and safe against hostile names", () => {
  const html = views.materialSuggestions([{ material: "A1802" }, { material: XSS }]);
  assert.equal(count(html, /role="option"/g), 2);
  assert.match(html, /data-pos="0"[^>]*>A1802<\/button>/);
  assert.match(html, /data-pos="1"/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /data-material|href=/, "the page script picks the material from its own list, not from the DOM");
  assert.equal(count(html, /id="lab-search-o\d+"/g), 2, "every option has the id aria-activedescendant points to");
  assert.equal(views.materialSuggestions([]), "", "no match = no popup: the table and the counter already say nothing was found");
});

test("the LAB page script never closes a popup from blur or focusout (AGENTS.md: iPhone does not focus a tapped button)", () => {
  const source = readFileSync(new URL("../../modules/module-lab.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']blur["']|focusout|onblur/i);
  assert.match(source, /closePopup\(suggest\)/, "closing goes through the shared rule");
});

/* ---------- ตารางผล ---------- */

test("the results table merges AVG/SD once per group and starts at the newest test", () => {
  const series = seriesFixture();
  const html = views.resultsTable({ series, order: "newest", uniform: true });
  assert.equal(count(html, /rowspan="3"/g), 12, "3 groups × 4 stat columns");
  assert.equal(count(html, /class="num stat is-none"/g), 4, "the ungrouped row shows a dash in each stat column");
  assert.equal(count(html, /<tr class="lab-result-row/g), 10);
  assert.ok(html.indexOf('data-seq="10"') < html.indexOf('data-seq="1"'), "newest first");
  // เรียงใหม่สุดก่อน แถวแรกที่เห็นของชุด (แถวล่างสุดของชุดในชีต) ต้องเป็นแถวที่ถือเซลล์รวม
  const groupStart = html.slice(html.indexOf('data-seq="9"'), html.indexOf('data-seq="8"'));
  assert.match(groupStart, /rowspan="3"/);
  assert.doesNotMatch(html.slice(html.indexOf('data-seq="8"'), html.indexOf('data-seq="7"')), /rowspan/);
  const oldest = views.resultsTable({ series, order: "oldest", uniform: true });
  assert.ok(oldest.indexOf('data-seq="1"') < oldest.indexOf('data-seq="10"'));
  assert.match(oldest.slice(oldest.indexOf('data-seq="1"'), oldest.indexOf('data-seq="2"')), /rowspan="3"/);
});

test("the table has no running-number column and joins date and time in one cell", () => {
  const html = views.resultsTable({ series: seriesFixture(), uniform: true });
  const heads = [...html.matchAll(/<th scope="col"[^>]*>([^<]*(?:<i[^>]*><\/i>)?[^<]*)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));
  assert.deepEqual(heads, ["ID", "วันที่ · เวลา", "MH", "MV", "AVG MH", "SD MH", "AVG MV", "SD MV"]);
  assert.match(html, /21\/09\/2026 08:00:00/);
  assert.doesNotMatch(views.idTable({ rows: model.idSeries(seriesFixture().items, "111"), id: "111" }), /ครั้งที่|>ID</, "the ID and the running number are not repeated in one ID's history");
});

test("temperature and test-time columns appear only when the conditions differ between rows", () => {
  const series = seriesFixture();
  assert.doesNotMatch(views.resultsTable({ series, uniform: true }), /อุณหภูมิ/);
  assert.match(views.resultsTable({ series, uniform: false }), /อุณหภูมิ \(°C\)[\s\S]*เวลาทดสอบ \(นาที\)/);
  assert.equal(views.conditionsText(model.testConditions(series.items)), "100 °C / 4 นาที");
  assert.equal(views.conditionsText({ uniform: false, temperatures: [100, 145], minutes: [4] }), "");
});

test("the number of tests, groups and the shared conditions are stated once, beside the table title", () => {
  const series = seriesFixture();
  const conditions = model.testConditions(series.items);
  assert.equal(views.tableNote({ count: 1234, groupCount: 52, conditions }), "1,234 ครั้ง · 52 ชุด · 100 °C / 4 นาที");
  assert.equal(views.tableNote({ count: 4, conditions }), "4 ครั้ง · 100 °C / 4 นาที", "one ID's history has no group count");
  assert.equal(views.tableNote({ count: 4, groupCount: 2, conditions: { uniform: false, temperatures: [100, 145], minutes: [4] } }), "4 ครั้ง · 2 ชุด");
});

test("the active row is marked", () => {
  const html = views.resultsTable({ series: seriesFixture(), activeSeq: 4 });
  assert.match(html, /<tr class="lab-result-row[^"]*is-active" data-seq="4"/);
  assert.equal(count(html, /is-active/g), 1);
  assert.doesNotMatch(views.resultsTable({ series: seriesFixture(), activeSeq: null }), /is-active/);
});

test("sheet text is escaped everywhere in the tables", () => {
  const series = seriesFixture([row({ sample_id: XSS, test_date: "2026-09-23" })]);
  assert.doesNotMatch(views.resultsTable({ series }), /<img/);
  const history = model.idSeries(series.items, XSS);
  assert.doesNotMatch(views.idTable({ rows: history, id: XSS }), /<img/);
});

test("copied results repeat the merged AVG/SD on every row and split date and time so they paste cleanly into Excel", () => {
  const series = seriesFixture();
  const lines = views.resultsTsv({ series, order: "oldest", uniform: true }).split("\n");
  assert.equal(lines.length, 11);
  assert.equal(lines[0], "ID\tวันที่\tเวลา\tMH\tMV\tAVG MH\tSD MH\tAVG MV\tSD MV");
  assert.deepEqual(lines.slice(1, 4).map((line) => line.split("\t")[5]), ["51.00", "51.00", "51.00"]);
  assert.equal(lines[1].split("\t").length, lines[0].split("\t").length);
  assert.deepEqual(lines[1].split("\t").slice(0, 3), ["111", "21/09/2026", "08:00:00"]);
  assert.equal(lines[10].split("\t")[5], "—");
  const newest = views.resultsTsv({ series, order: "newest", uniform: true }).split("\n");
  assert.equal(newest[1].split("\t")[0], "311");
  assert.match(views.resultsTsv({ series, uniform: false }).split("\n")[0], /เวลา\tอุณหภูมิ \(°C\)\tเวลาทดสอบ \(นาที\)/);
});

test("one ID's history table shows the change from the previous test", () => {
  const series = seriesFixture();
  const history = model.idSeries(series.items.concat(series.items.map((item) => ({ ...item, mh: item.mh + 1, mv: item.mv - 0.5, testDate: "2026-09-25" }))), "111");
  const html = views.idTable({ rows: history, order: "oldest", uniform: true, id: "111" });
  assert.match(html, /Δ MH/);
  assert.match(html, /\+1\.00/);
  assert.match(html, /−0\.50/);
  assert.equal(views.idTsv({ rows: history, order: "oldest", uniform: true }).split("\n")[2].split("\t").slice(-2).join(), "+1.00,−0.50");
});

/* ---------- ป้ายค่าของจุดที่ชี้ ---------- */

test("the hover tip names the test and shows only that point's MH and MV (the group stats are on the highlighted table row)", () => {
  const series = seriesFixture();
  const item = series.items[4];
  const html = views.tooltip({ item });
  assert.match(html, /21\/09\/2026 08:01:00 · ID 122/);
  assert.match(html, /MH <b>61\.00<\/b>/);
  assert.match(html, /MV <b>36\.00<\/b>/);
  assert.doesNotMatch(html, /AVG|SD|#\d/, "no group stats and no running number");
  assert.equal(views.tooltip({ item: null }), "");
  assert.doesNotMatch(views.tooltip({ item: { ...series.items[0], sampleId: XSS } }), /<img/);
});

test("in one ID's history the tip leaves the ID out (already chosen above) and adds the change since the previous test", () => {
  const id = model.idSeries(seriesFixture().items.concat(seriesFixture().items), "111")[1];
  const html = views.tooltip({ item: id, mode: "id" });
  assert.doesNotMatch(html, /ID 111/);
  assert.match(html, /Δ \+0\.00|Δ 0\.00/);
  assert.equal(views.announcement({ item: seriesFixture().items[0] }), "21/09/2026 08:00:00 ID 111 MH 50.00 MV 30.00");
  assert.doesNotMatch(views.announcement({ item: id, mode: "id" }), /ID 111/);
  assert.equal(views.announcement({ item: null }), "");
});

/* ---------- โครงหน้า ---------- */

test("every element the page script looks up exists in the page it opens", () => {
  const source = readFileSync(new URL("../../modules/module-lab.js", import.meta.url), "utf8");
  const wanted = new Set([...source.matchAll(/"#(lab-[a-z-]+)"/g)].map((match) => match[1]));
  const pages = views.overviewPage(30) + views.materialPage("A1802", 30);
  assert.ok(wanted.size > 15, `found ${wanted.size} selectors`);
  for (const id of wanted) assert.ok(pages.includes(`id="${id}"`), `#${id} is missing from the page markup`);
  // หน้ารวมและหน้าวัสดุต้องมีแถบเวลา/รีเฟรชชุดเดียวกัน เพราะ bindLiveBar ผูกทั้งสองหน้า
  for (const page of [views.overviewPage(30), views.materialPage("A1802", 30)]) {
    for (const id of ["lab-updated", "lab-refresh", "lab-status"]) assert.ok(page.includes(`id="${id}"`), `${id} on every page`);
  }
});

test("the material page shows the material name once (the picker) and keeps no permanent copies of data the table already has", () => {
  const page = views.materialPage("A1802", 30);
  assert.equal(count(page, /A1802/g), 2, "the picker's option and the not-found message that is hidden until needed");
  assert.doesNotMatch(page, /lab-readout|lab-hint|lab-summary|lab-chart-title/);
  const visibleText = page.replace(/<[^>]+>/g, " ");
  assert.equal(count(visibleText, /อัตโนมัติ/g), 0, "the refresh interval lives in the button's title, not as page text");
  assert.equal(count(page, /อัตโนมัติทุก 30 วินาที/g), 2, "title and aria-label of the one refresh button");
});

test("the material page title is escaped and the refresh interval comes from the caller", () => {
  const page = views.materialPage(XSS, 45);
  assert.doesNotMatch(page, /<img/);
  assert.match(page, /อัตโนมัติทุก 45 วินาที/);
});

test("the pickers list the open material even when the sheet has none of it, without counts, and mark the selection", () => {
  const rows = model.normalizeFeed({ rows: [row(), row({ sample_id: "112" }), row({ material: "B0005", source_sheet: "B0005" })] }).rows;
  const summaries = model.buildMaterialSummaries(rows);
  const options = views.materialOptions(summaries, "B0005");
  assert.match(options, /<option value="A1802">A1802<\/option>/);
  assert.match(options, /<option value="B0005" selected>B0005<\/option>/);
  assert.match(views.materialOptions(summaries, "ZZZ"), /<option value="ZZZ" selected>ZZZ<\/option>/);
  const ids = views.idOptions(model.idsFor(model.buildSeries(rows, "A1802").items), "112");
  assert.match(ids, /<option value="">ทุก ID<\/option>/, "no total: the table title already says how many tests there are");
  assert.match(ids, /value="112" selected>112 \(1\)/);
});

test("there is no warning box listing unreadable sheet rows on either page", () => {
  for (const page of [views.overviewPage(30), views.materialPage("A1802", 30)]) {
    assert.doesNotMatch(page, /lab-problems|lab-warning|อ่านไม่ได้/);
  }
  assert.equal(views.problemsHtml, undefined);
});
