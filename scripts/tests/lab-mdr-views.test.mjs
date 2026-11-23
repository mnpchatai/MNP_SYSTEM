import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
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
  const html = views.formulaBody({ part: "F1", formula: "A2004" }, { formulas, tests, curveDate: "2026-11-02", curves: [{ id: 1, curve }, { id: 2, curve }] });
  assert.match(html, /id="mdr-formula"/);
  assert.match(html, /<option value="A2004" selected>A2004<\/option>/);
  assert.match(html, /<option value="2026-11-02" selected>2 พ.ย. 2569<\/option>/);
  assert.equal(count(html, /class="lab-mdr-key"/g), 2, "a key per test drawn on the chart");
  assert.equal(count(html, /class="lab-mdr-stat"/g), 2, "an AVG row per date");
  assert.equal(count(html, /lab-mdr-sd/g), 2, "an SD row per date");
  assert.match(html, /<span class="lab-mdr-day-flag">กราฟด้านบน<\/span>/, "the charted day is marked, not repeated");
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
  assert.doesNotMatch(html, /mdr-plot|mdr-date/);
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
  assert.match(views.tipHtml(166, [{ color: "#fff", machineId: "112", torque: 7.9 }]), /2:46 นาที[\s\S]*ID 112<b>7\.90<\/b>/);
});
