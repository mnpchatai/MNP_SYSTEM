import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sections = require("../../modules/lab-sections.js");
const model = require("../../modules/lab-mooney-model.js");

const params = (query) => new URLSearchParams(query);
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const OPEN = new Set(["dashboard", "mooney"]);
const isOpen = (key) => OPEN.has(key);
const visibleText = (html) => html.replace(/<[^>]+>/g, " ");

test("MNP LAB has exactly four modules in the defined order", () => {
  assert.deepEqual(sections.SECTIONS.map((section) => [section.key, section.label]), [
    ["dashboard", "แดชบอร์ด"],
    ["chemical", "เปรียบเทียบเคมี"],
    ["mooney", "รายงานทดสอบ Mooney"],
    ["mdr", "รายงานทดสอบ MDR"],
  ]);
  assert.ok(Object.isFrozen(sections.SECTIONS));
});

test("every module names a palette of the shared colour system, and each module has its own", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  for (const section of sections.SECTIONS) {
    assert.match(section.palette, /^[a-z]+$/);
    assert.ok(css.includes(`[data-module="${section.palette}"]`), `${section.key} palette "${section.palette}" exists in styles.css`);
    assert.equal(section.theme, undefined, "the two-colour gradient array is gone");
  }
  assert.equal(new Set(sections.SECTIONS.map((section) => section.palette)).size, sections.SECTIONS.length);
});

test("#/lab is the module chooser, ?module= opens a module, and old material links still open Mooney", () => {
  assert.equal(sections.readSection(params("")), sections.HOME);
  assert.equal(sections.readSection(params("module=")), sections.HOME);
  assert.equal(sections.readSection(null), sections.HOME);
  for (const key of ["dashboard", "chemical", "mooney", "mdr"]) assert.equal(sections.readSection(params(`module=${key}`)), key);
  assert.equal(sections.readSection(params("material=A1802")), "mooney", "links made before the modules were split");
  assert.equal(sections.readSection(params("module=mdr&material=A1802")), "mdr", "an explicit module wins");
  for (const key of ["MOONEY", "home", "lab", "x", "constructor", "__proto__"]) assert.equal(sections.readSection(params(`module=${key}`)), null);
});

test("module links stay on the one #/lab route and agree with the Mooney material links", () => {
  assert.equal(sections.sectionUrl("dashboard"), "#/lab?module=dashboard");
  assert.equal(sections.sectionUrl("chemical"), "#/lab?module=chemical");
  assert.equal(sections.sectionUrl("mooney"), "#/lab?module=mooney");
  assert.equal(sections.sectionUrl("mdr"), "#/lab?module=mdr");
  assert.equal(sections.sectionUrl("unknown"), "#/lab");
  assert.equal(model.materialUrl(""), sections.sectionUrl("mooney"));
  assert.equal(sections.readSection(params(model.materialUrl("A1802").split("?")[1])), "mooney");
});

test("the chooser shows one gradient card per module; only open modules are links", () => {
  const page = sections.chooserPage(isOpen);
  assert.match(page, /<h1>เลือกโมดูล<\/h1>/);
  assert.doesNotMatch(visibleText(page), /MNP LAB|Laboratory|ห้องปฏิบัติการ/, "the breadcrumb and sidebar already name MNP LAB");
  assert.match(page, /<nav class="type-grid request-type-grid lab-module-grid" aria-label="โมดูล MNP LAB">/);
  assert.equal(count(page, /class="type-card request-type-card lab-module-card/g), 4);
  for (const section of sections.SECTIONS) {
    assert.equal(count(visibleText(page), new RegExp(section.label, "g")), 1, `${section.label} once`);
    assert.ok(page.includes(`data-module="${section.palette}"`), `${section.key} wears its palette`);
  }
  assert.match(page, /<a class="type-card request-type-card lab-module-card" href="#\/lab\?module=dashboard"/);
  assert.match(page, /<a class="type-card request-type-card lab-module-card" href="#\/lab\?module=mooney"/);
  assert.doesNotMatch(page, /href="#\/lab\?module=(chemical|mdr)"/, "a module with nothing to open is not a link");
  assert.equal(count(page, /lab-module-card is-off"/g), 2);
  assert.doesNotMatch(page, /style="/, "colours come from the stylesheet, not inline styles");
  assert.doesNotMatch(page, /aria-disabled/, "a plain card is not a control; its text states that it is not open");
  assert.equal(count(page, /ยังไม่เปิดใช้งาน/g), 2, "the status is said once per card");
  assert.doesNotMatch(page, /ยังไม่มีแหล่งข้อมูล/);
  assert.equal(count(page, /<svg /g), 8, "each card has the module icon in its badge and again as a watermark");
  assert.equal(count(sections.chooserPage(() => true), /is-off/g), 0);
  assert.equal(count(sections.chooserPage(() => "yes"), /is-off/g), 4, "only an explicit true opens a card");
});

test("a module page opens with a back link and the shared module header that names it once", () => {
  const head = sections.moduleHead("mooney", { extra: `<span id="extra"></span>` });
  assert.match(head, /<a class="request-back-link" href="#\/lab">‹ เลือกโมดูล<\/a>/, "the back link names the page it returns to");
  assert.doesNotMatch(head, /ย้อนกลับ|กลับ/);
  assert.match(head, /<div class="page-heading request-module-header lab-module-header" data-module="it">/);
  assert.doesNotMatch(head, /gradient|style="/, "the module colour comes from the palette, never inline");
  assert.match(head, /<div class="request-module-title"><span class="type-card-badge"><svg [^>]*>[\s\S]*?<\/svg><\/span><h1>รายงานทดสอบ Mooney<\/h1><\/div>/);
  assert.doesNotMatch(head, /eyebrow|<p>|MNP LAB/, "no eyebrow or description repeating the breadcrumb or the title");
  assert.match(head, /<span id="extra"><\/span>/);
  assert.equal(count(visibleText(head), /รายงานทดสอบ Mooney/g), 1);
  const off = sections.moduleHead("mdr", { open: false });
  assert.match(off, /lab-module-header is-off/);
  assert.doesNotMatch(off, /<p>/, "no description for a module that is not set up");
  assert.equal(sections.moduleHead("unknown"), "");
});

test("a module without a data source shows a not-set-up page that names the module only in its banner", () => {
  for (const key of ["chemical", "mdr"]) {
    const page = sections.notReadyPage(key);
    const label = sections.SECTIONS.find((section) => section.key === key).label;
    assert.match(page, /ยังไม่เปิดใช้งาน/);
    assert.match(page, new RegExp(`<h1>${label}</h1>`));
    assert.equal(count(visibleText(page), new RegExp(label, "g")), 1);
    assert.doesNotMatch(page, /id="lab-refresh"/, "nothing to refresh: no data is read");
  }
});
