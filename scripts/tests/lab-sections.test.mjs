import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sections = require("../../modules/lab-sections.js");
const model = require("../../modules/lab-mooney-model.js");

const params = (query) => new URLSearchParams(query);
const count = (text, pattern) => (text.match(pattern) ?? []).length;

test("MNP LAB has exactly four modules in the defined order", () => {
  assert.deepEqual(sections.SECTIONS.map((section) => [section.key, section.label]), [
    ["dashboard", "แดชบอร์ด"],
    ["chemical", "เปรียบเทียบเคมี"],
    ["mooney", "Mooney test report"],
    ["mdr", "MDR test report"],
  ]);
  assert.equal(sections.DEFAULT, "dashboard");
  assert.ok(Object.isFrozen(sections.SECTIONS));
});

test("only modules with a data source are open; the others say they are not set up yet", () => {
  assert.equal(sections.isReady("dashboard"), true);
  assert.equal(sections.isReady("mooney"), true);
  assert.equal(sections.isReady("chemical"), false);
  assert.equal(sections.isReady("mdr"), false);
  assert.equal(sections.isReady("unknown"), false);
});

test("the module comes from ?module=, the dashboard is the landing page, and old material links still open Mooney", () => {
  assert.equal(sections.readSection(params("")), "dashboard");
  assert.equal(sections.readSection(params("module=")), "dashboard");
  for (const key of ["dashboard", "chemical", "mooney", "mdr"]) assert.equal(sections.readSection(params(`module=${key}`)), key);
  assert.equal(sections.readSection(params("material=A1802")), "mooney", "links made before the modules were split");
  assert.equal(sections.readSection(params("module=mdr&material=A1802")), "mdr", "an explicit module wins");
  for (const key of ["MOONEY", "lab", "x", "constructor", "__proto__"]) assert.equal(sections.readSection(params(`module=${key}`)), null);
  assert.equal(sections.readSection(null), "dashboard");
});

test("module links stay on the one #/lab route and agree with the Mooney material links", () => {
  assert.equal(sections.sectionUrl("dashboard"), "#/lab");
  assert.equal(sections.sectionUrl("chemical"), "#/lab?module=chemical");
  assert.equal(sections.sectionUrl("mooney"), "#/lab?module=mooney");
  assert.equal(sections.sectionUrl("mdr"), "#/lab?module=mdr");
  assert.equal(sections.sectionUrl("unknown"), "#/lab");
  assert.equal(model.materialUrl(""), sections.sectionUrl("mooney"));
  assert.equal(sections.readSection(params(model.materialUrl("A1802").split("?")[1])), "mooney");
});

test("the module bar lists every module once and marks the open one as the current page", () => {
  const html = sections.navHtml("mooney");
  assert.match(html, /<nav class="filters lab-modules" aria-label="โมดูล MNP LAB">/);
  assert.equal(count(html, /<a /g), 4);
  assert.equal(count(html, /aria-current="page"/g), 1);
  assert.match(html, /<a class="filter active" href="#\/lab\?module=mooney" aria-current="page">Mooney test report<\/a>/);
  assert.match(html, /<a class="filter" href="#\/lab">แดชบอร์ด<\/a>/);
  assert.equal(count(sections.navHtml("unknown"), /aria-current/g), 0);
});

test("the open module is named once: the highlighted bar item, plus a screen-reader-only page heading", () => {
  const head = sections.headHtml("mdr", `<span id="extra"></span>`);
  assert.match(head, /<h1 class="sr-only">MDR test report<\/h1>/);
  assert.match(head, /<span id="extra"><\/span>/);
  const visible = head.replace(/<h1 class="sr-only">[^<]*<\/h1>/, "").replace(/<[^>]+>/g, " ");
  assert.equal(count(visible, /MDR test report/g), 1);
});

test("a module without a data source shows a not-set-up page that does not repeat its name", () => {
  for (const key of ["chemical", "mdr"]) {
    const page = sections.notReadyPage(key);
    assert.match(page, /ยังไม่เปิดใช้งาน/);
    assert.match(page, /aria-current="page">[^<]+<\/a>/);
    const label = sections.SECTIONS.find((section) => section.key === key).label;
    const visible = page.replace(/<h1 class="sr-only">[^<]*<\/h1>/, "").replace(/<[^>]+>/g, " ");
    assert.equal(count(visible, new RegExp(label, "g")), 1, `${label} appears only in the module bar`);
    assert.doesNotMatch(page, /id="lab-refresh"/, "nothing to refresh: no data is read");
  }
});
