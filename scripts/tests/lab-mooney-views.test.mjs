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
    sample_id: id, test_date: date, test_time: `08:0${index}:00`, mh: mh + index, mv: 30 + index,
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

test("the sequence chart has an MH panel and an MV panel with one point per test in each", () => {
  const { items, groups } = seriesFixture();
  const result = chart.trendChart({ mode: "sequence", items, groups, width: 900, label: "A1802" });
  assert.equal(result.count, 10);
  assert.equal(count(result.html, /class="lab-panel lab-panel-/g), 2);
  assert.equal(count(result.html, /<svg /g), 2);
  assert.equal(count(result.html, /class="lab-pt lab-pt-mh"/g), 10);
  assert.equal(count(result.html, /class="lab-pt lab-pt-mv"/g), 10);
  assert.equal(count(result.html, /<circle class="lab-dot"/g), 10, "MH is a circle");
  assert.equal(count(result.html, /<rect class="lab-dot"/g), 10, "MV is a rotated square, so the two series also differ by shape");
  assert.match(result.html, /เฉลี่ย <b>[\d.]+<\/b> · SD <b>[\d.]+<\/b>/);
  const headers = result.html.match(/<span class="lab-panel-stats">.*?<\/span>/g).join("");
  assert.doesNotMatch(headers, /ช่วง/, "the range is read from the axis, not repeated as numbers in the panel header");
  noBadNumbers(result.html);
});

test("test groups with stats get one average mark per series; the group still waiting for stats gets none", () => {
  const { items, groups } = seriesFixture();
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 900 });
  assert.equal(count(html, /class="lab-avg lab-avg-mh"/g), 3);
  assert.equal(count(html, /class="lab-avg lab-avg-mv"/g), 3);
});

test("background bands alternate by test day and the newest day always keeps its date label", () => {
  const { items, groups } = seriesFixture();
  const { html } = chart.trendChart({ mode: "sequence", items, groups, width: 900 });
  assert.equal(count(html, /class="lab-band"/g), 2, "two days → one band per panel");
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
  assert.match(html, /MV <b>31\.00<\/b>/);
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
