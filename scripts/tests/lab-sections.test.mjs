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

// WCAG relative luminance และ contrast กับตัวอักษรขาว
const luminance = (hex) => {
  const [r, g, b] = hex.match(/\w\w/g).map((part) => parseInt(part, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

// CSS filter saturate(s) และ brightness(b) ตามสูตรของ Filter Effects spec (คำนวณบนค่า sRGB แล้วตัดให้อยู่ 0–255)
const filtered = (hex, saturate, brightness = 1) => {
  const [r, g, b] = hex.match(/\w\w/g).map((part) => parseInt(part, 16));
  const s = saturate;
  const rows = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  return `#${rows.map((row) => Math.max(0, Math.min(255, Math.round((row[0] * r + row[1] * g + row[2] * b) * brightness))).toString(16).padStart(2, "0")).join("")}`;
};

test("MNP LAB has exactly four modules in the defined order", () => {
  assert.deepEqual(sections.SECTIONS.map((section) => [section.key, section.label]), [
    ["dashboard", "แดชบอร์ด"],
    ["chemical", "เปรียบเทียบเคมี"],
    ["mooney", "Mooney test report"],
    ["mdr", "MDR test report"],
  ]);
  assert.ok(Object.isFrozen(sections.SECTIONS));
});

test("every module colour keeps white card text readable (contrast ≥ 4.5:1 at both ends) and each module has its own colour", () => {
  for (const section of sections.SECTIONS) {
    assert.equal(section.theme.length, 2);
    for (const hex of section.theme) {
      assert.match(hex, /^#[0-9a-f]{6}$/);
      assert.ok(contrastWithWhite(hex) >= 4.5, `${section.key} ${hex} is ${contrastWithWhite(hex).toFixed(2)}:1`);
    }
  }
  assert.equal(new Set(sections.SECTIONS.map((section) => section.theme[0])).size, sections.SECTIONS.length);
});

test("the muted colour of a module that is not open still keeps white text at ≥ 4.5:1, using the filters styles.css really applies", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const filters = [...css.matchAll(/lab-module-header\.is-off \{ filter: ([^;]+); \}/g)].map((match) => match[1]);
  assert.equal(filters.length, 2, "one rule for the light theme and one for the dark theme");
  for (const filter of filters) {
    const saturate = Number(/saturate\(([\d.]+)\)/.exec(filter)?.[1]);
    const brightness = Number(/brightness\(([\d.]+)\)/.exec(filter)?.[1] ?? 1);
    assert.ok(Number.isFinite(saturate) && Number.isFinite(brightness), filter);
    assert.equal(filter.replace(/saturate\([\d.]+\)|brightness\([\d.]+\)|\s/g, ""), "", `only saturate/brightness are modelled: ${filter}`);
    for (const section of sections.SECTIONS) {
      for (const hex of section.theme) {
        const muted = filtered(hex, saturate, brightness);
        assert.ok(contrastWithWhite(muted) >= 4.5, `${section.key} ${hex} → ${muted} under ${filter} is ${contrastWithWhite(muted).toFixed(2)}:1`);
      }
    }
  }
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
    assert.ok(page.includes(`background:linear-gradient(135deg, ${section.theme[0]}, ${section.theme[1]})`), `${section.key} wears its colour`);
  }
  assert.match(page, /<a class="type-card request-type-card lab-module-card" href="#\/lab\?module=dashboard"/);
  assert.match(page, /<a class="type-card request-type-card lab-module-card" href="#\/lab\?module=mooney"/);
  assert.doesNotMatch(page, /href="#\/lab\?module=(chemical|mdr)"/, "a module with nothing to open is not a link");
  assert.equal(count(page, /lab-module-card is-off"/g), 2);
  assert.doesNotMatch(page, /aria-disabled/, "a plain card is not a control; its text states that it is not open");
  assert.equal(count(page, /ยังไม่เปิดใช้งาน/g), 2, "the status is said once per card");
  assert.doesNotMatch(page, /ยังไม่มีแหล่งข้อมูล/);
  assert.equal(count(page, /<svg /g), 4, "each card badge has the module icon");
  assert.equal(count(sections.chooserPage(() => true), /is-off/g), 0);
  assert.equal(count(sections.chooserPage(() => "yes"), /is-off/g), 4, "only an explicit true opens a card");
});

test("a module page opens with a back link and a banner in the module's colour that names it once", () => {
  const head = sections.moduleHead("mooney", { extra: `<span id="extra"></span>` });
  assert.match(head, /<a class="request-back-link" href="#\/lab" aria-label="ย้อนกลับไปเลือกโมดูล">‹ ย้อนกลับ<\/a>/);
  assert.match(head, /class="page-heading request-module-header lab-module-header" style="background:linear-gradient\(135deg, #2563eb, #1e40af\)"/);
  assert.match(head, /<span class="type-card-badge"><svg[^]*?<\/svg><\/span><h1>Mooney test report<\/h1><\/div>/);
  assert.doesNotMatch(head, /eyebrow|<p>|MNP LAB/, "no eyebrow or description repeating the breadcrumb or the title");
  assert.match(head, /<span id="extra"><\/span>/);
  assert.equal(count(visibleText(head), /Mooney test report/g), 1);
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
