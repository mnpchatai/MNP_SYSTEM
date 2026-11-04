import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// ไอคอนเส้นชุดเดียวของ Pilot (modules/ui-icons.js): ทุกชื่อที่ถูกอ้างต้องมีจริง และแผนที่ไอคอนของโมดูลไม่มีอีโมจิ/อักขระพิเศษแทนไอคอน
const icons = createRequire(import.meta.url)("../../modules/ui-icons.js");
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
// อีโมจิและอักขระรูปทรง/ลูกศรที่เคยใช้แทนไอคอน (เช่น 🌀 ⚠️ ◎ ▤ ⚙ ◉ ↗ ◷ ⌕)
const GLYPH = /[\p{Extended_Pictographic}←-⇿⌀-⏿■-◿]/u;

test("every icon is a 24×24 line drawing made only of path, circle and rect", () => {
  assert.ok(Object.isFrozen(icons.PATHS));
  for (const [name, markup] of Object.entries(icons.PATHS)) {
    assert.match(name, /^[a-z]+(-[a-z]+)*$/, name);
    assert.ok(markup.length > 0, `${name} has a drawing`);
    const tags = [...markup.matchAll(/<(\w+)/g)].map((match) => match[1]);
    assert.ok(tags.length > 0 && tags.every((tag) => ["path", "circle", "rect"].includes(tag)), `${name} uses ${tags.join(", ")}`);
    assert.doesNotMatch(markup, /stroke-width|style=|<script|on\w+=/i, `${name} keeps the shared stroke from .ui-icon`);
  }
  assert.equal(icons.icon("home"), `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${icons.PATHS.home}</svg>`);
  assert.equal(icons.icon("no-such-icon"), '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"></svg>');
});

test("every live and sandbox request module has its own type icon, and unknown types fall back to the document icon", () => {
  const codes = ["MT_REPAIR", "NCR_CAR", "IT_REPAIR", "MANAGEMENT", "QC", "MNP_LAB", "RUBBERFLOW", "BOM"];
  for (const code of codes) {
    const name = icons.TYPE_ICONS[code];
    assert.ok(Object.hasOwn(icons.PATHS, name), `${code} → ${name} exists`);
    assert.equal(icons.typeIcon(code), icons.icon(name));
  }
  assert.equal(new Set(codes.map((code) => icons.TYPE_ICONS[code])).size, codes.length, "no two modules share an icon");
  assert.deepEqual(Object.keys(icons.TYPE_ICONS).sort(), [...codes].sort());
  assert.equal(icons.typeIconName("HR_LEAVE"), "document");
  // รหัสโมดูลในตารางต้องตรงกับที่โมดูลลงทะเบียนจริง
  for (const code of codes) {
    const registered = ["module-mt", "module-ncr", "module-it", "module-mg", "module-qc", "module-lab", "module-rubberflow", "module-bom"]
      .some((file) => read(`modules/${file}.js`).includes(`code: "${code}"`));
    assert.ok(registered, `${code} is a registered module code`);
  }
});

test("app.js uses the shared icon set instead of its own copy", () => {
  const app = read("app.js");
  assert.match(app, /const UI_ICON_PATHS = window\.MNP_UI_ICONS\.PATHS;/);
  assert.match(app, /const requestTypeIcon = window\.MNP_UI_ICONS\.typeIcon;/);
  assert.doesNotMatch(app, /home: '<path|const UI_ICON_PATHS = \{/, "no second copy of the paths");
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script defer src="\.\/([^"?]+)/g)].map((match) => match[1]);
  assert.equal(scripts[0], "modules/ui-icons.js", "loaded before every module and app.js");
});

test("request detail facts name an icon that exists instead of passing a text glyph", () => {
  const sources = ["app.js", "modules/module-mt.js", "modules/module-mg.js"].map((file) => [file, read(file)]);
  let seen = 0;
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/\bicon: "([^"]*)"/g)) {
      seen += 1;
      assert.ok(Object.hasOwn(icons.PATHS, match[1]), `${file}: icon "${match[1]}" is in the shared set`);
    }
  }
  assert.ok(seen >= 15, `found ${seen} fact icons`);
  const app = read("app.js");
  assert.match(app, /function requestFact\(label, value, \{ icon = "info",/);
  assert.match(app, /Object\.hasOwn\(UI_ICON_PATHS, icon\) \? uiIcon\(icon\) : escapeHtml\(icon\)/, "a caller that still passes text keeps working");
});

test("RubberFlow and BOM icon maps point at the shared set and hold no emoji", () => {
  for (const file of ["modules/rubberflow-ui.js", "modules/bom-pages.js"]) {
    const source = read(file);
    const map = /const ICONS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source)?.[1];
    assert.ok(map, `${file} has an ICONS map`);
    assert.doesNotMatch(map, GLYPH, `${file} ICONS has no emoji or glyph`);
    const names = [...map.matchAll(/(\w+): "([^"]+)"/g)];
    assert.ok(names.length >= 12, `${file} maps ${names.length} pages`);
    for (const [, key, name] of names) assert.ok(Object.hasOwn(icons.PATHS, name), `${file}: ${key} → ${name} exists`);
    assert.match(source, /root\.MNP_UI_ICONS\.icon\(/, `${file} draws with the shared set`);
  }
  const rubberflow = /const ICONS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(read("modules/rubberflow-ui.js"))[1];
  for (const tone of ["bad", "warn", "good", "info"]) assert.match(rubberflow, new RegExp(`\\b${tone}: "`), `callout tone ${tone} has an icon`);
});

test("LAB and QC headings show the module colour only as a dot, never as a gradient band", () => {
  for (const file of ["modules/lab-sections.js", "modules/module-qc.js"]) {
    const source = read(file);
    assert.match(source, /<span class="module-dot" style="--module-color:\$\{/, `${file} uses the module dot`);
    assert.doesNotMatch(source, /request-module-header/, `${file} no longer uses the coloured band`);
  }
  assert.doesNotMatch(read("modules/module-qc.js"), /linear-gradient/);
});
