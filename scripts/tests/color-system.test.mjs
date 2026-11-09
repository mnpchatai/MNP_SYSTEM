// ระบบสีเดียวของโมดูลและแผนก (PRODUCT.md "Brand Commitments", ผู้ใช้ตัดสิน 2026-11-09):
// ธีมสว่าง = อัญมณี (ก้อนไล่เฉด 700→900 ตัวขาว) · ธีมมืด = ฟ้าสาง (พื้นอ่อนอมสีโมดูล ตัวอักษรสว่างโทนโมดูล)
// ตรวจว่าทุกจานสีมีครบ ตัวอักษรทุกคู่บนพื้นผิวใหม่ผ่าน 4.5:1 ทั้งสองธีม (คำนวณจาก styles.css เอง ไม่ต้องเปิดเบราว์เซอร์)
// และว่า app.js/modules ใช้ data-module แทนสี inline
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\r\n/g, "\n");

// ---------- อ่านกฎ CSS ----------
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector.trim().replace(/\s+/g, " "),
  declarations: new Map(body.split(";").map((line) => line.split(/:(.*)/s).map((part) => part?.trim())).filter(([name, value]) => name && value)),
}));
const ruleBySelector = (selector) => rules.filter((rule) => rule.selector === selector);
const declared = (selector, property) => ruleBySelector(selector).map((rule) => rule.declarations.get(property)).filter(Boolean).at(-1);

const RAMP_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const RAMPS = new Map(); // ชื่อ (mt, ncr, … หรือ dept:RB) -> Map(--m50…)
for (const rule of rules) {
  if (!rule.declarations.has("--m700")) continue;
  for (const [, kind, key] of rule.selector.matchAll(/\[(data-module|data-dept-code)="([^"]+)"\]/g)) {
    RAMPS.set(kind === "data-module" ? key : `dept:${key}`, new Map([...rule.declarations].filter(([name]) => /^--(m\d+|p|p50)$/.test(name))));
  }
}

const SCOPE = ":is([data-module], [data-dept-code])";
const DARK_SCOPE = `:root[data-theme="dark"] ${SCOPE}`;
const ROOT_LIGHT = new Map(rules.filter((rule) => rule.selector === ":root").flatMap((rule) => [...rule.declarations]).filter(([name]) => name.startsWith("--")));
const ROOT_DARK = new Map([...ROOT_LIGHT, ...rules.filter((rule) => rule.selector === ':root[data-theme="dark"]').flatMap((rule) => [...rule.declarations]).filter(([name]) => name.startsWith("--"))]);

// ---------- คำนวณสี (var(), color-mix(in srgb …), #hex) ----------
function splitArgs(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    else if (text[i] === "," && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  return [...parts, text.slice(start).trim()];
}
function resolve(value, tokens) {
  const text = value.trim();
  if (text === "white") return [255, 255, 255];
  if (/^#[0-9a-f]{3}$/i.test(text)) return [...text.slice(1)].map((digit) => parseInt(digit + digit, 16));
  if (/^#[0-9a-f]{6}$/i.test(text)) return [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16));
  const variable = text.match(/^var\((--[\w-]+)\)$/);
  if (variable) {
    assert.ok(tokens.has(variable[1]), `ไม่พบ token ${variable[1]}`);
    return resolve(tokens.get(variable[1]), tokens);
  }
  const mix = text.match(/^color-mix\(in srgb,(.*)\)$/s);
  if (mix) {
    const [first, second] = splitArgs(mix[1]).map((part) => part.match(/^(.*?)(?:\s+([\d.]+)%)?$/s));
    const weight = first[2] !== undefined ? Number(first[2]) / 100 : second[2] !== undefined ? 1 - Number(second[2]) / 100 : 0.5;
    const a = resolve(first[1], tokens), b = resolve(second[1], tokens);
    return a.map((channel, i) => channel * weight + b[i] * (1 - weight));
  }
  assert.fail(`อ่านค่าสีไม่ได้: ${text}`);
}
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

// โทเคนของจานสีหนึ่งชุดในหนึ่งธีม: โทเคนราก + เฉด + ตัวแปร --mod-* ของธีมนั้น (ธีมมืดทับธีมสว่าง)
function tokensOf(ramp, theme) {
  const tokens = new Map([...(theme === "dark" ? ROOT_DARK : ROOT_LIGHT), ...ramp]);
  for (const rule of ruleBySelector(SCOPE)) for (const [name, value] of rule.declarations) if (name.startsWith("--")) tokens.set(name, value);
  if (theme === "dark") for (const rule of ruleBySelector(DARK_SCOPE)) for (const [name, value] of rule.declarations) if (name.startsWith("--")) tokens.set(name, value);
  return tokens;
}
const ratio = (tokens, foreground, background) => contrast(resolve(foreground, tokens), resolve(background, tokens));
function assertReadable(label, tokens, foreground, background) {
  const value = ratio(tokens, foreground, background);
  assert.ok(value >= 4.5, `${label}: ${foreground} บน ${background} = ${value.toFixed(2)}:1 ต่ำกว่า 4.5:1`);
}

test("every module and department has a full 50-950 ramp plus a paired colour", () => {
  for (const key of ["mt", "ncr", "mg", "it", "rf", "bom", "qa", "qc", "rb", "gr", "bg", "pt", "pk", "st"]) assert.ok(RAMPS.has(key), `module palette ${key}`);
  for (const code of ["RB", "GR", "BG", "PT", "PK", "QA", "ST", "SR", "FT", "MT", "AD", "ID"]) assert.ok(RAMPS.has(`dept:${code}`), `department palette ${code}`);
  for (const [key, ramp] of RAMPS) {
    for (const step of RAMP_STEPS) assert.match(ramp.get(`--m${step}`) ?? "", /^#[0-9a-f]{6}$/i, `${key} --m${step}`);
    for (const name of ["--p", "--p50"]) assert.match(ramp.get(name) ?? "", /^#[0-9a-f]{6}$/i, `${key} ${name}`);
  }
  // สี 700 กับ 900 ของโมดูลต่างกันทุกโมดูล (ไม่ซ้ำกันระหว่างโมดูลหลัก)
  const mains = ["mt", "ncr", "mg", "it", "rf", "bom"].map((key) => RAMPS.get(key).get("--m700"));
  assert.equal(new Set(mains).size, mains.length, "the six main modules have six different colours");
});

for (const theme of ["light", "dark"]) {
  test(`all text on the colour-system surfaces reaches 4.5:1 for every ramp (${theme})`, () => {
    for (const [key, ramp] of RAMPS) {
      const t = tokensOf(ramp, theme);
      const at = (label) => `${key} ${label} (${theme})`;
      if (theme === "light") {
        for (const end of ["--m700", "--m900"]) {
          assertReadable(at(`card/header text on ${end}`), t, "var(--mod-on)", `var(${end})`);
          assertReadable(at(`secondary text on ${end}`), t, "var(--mod-on-soft)", `var(${end})`);
          assertReadable(at(`table head on ${end}`), t, "var(--mod-head-ink)", `var(${end})`);
          assertReadable(at(`selected tab on ${end}`), t, "var(--mod-tab-on-ink)", `var(${end})`);
          // ปุ่มรองโปร่งแสงบนก้อนสี: ดำ 18% ทับเฉดปลายทาง (ขาวโปร่งใสทับเฉด 700 ของ NCR ได้แค่ 3.9:1)
          assertReadable(at(`secondary header button over ${end}`), t, "var(--mod-btn-ink)", `color-mix(in srgb, #000 18%, var(${end}))`);
        }
        assertReadable(at("count pill"), t, "var(--mod-pill-ink)", "var(--mod-pill)");
        assertReadable(at("primary header button"), t, "var(--mod-cta-ink)", "var(--mod-cta)");
        assertReadable(at("NCR part number"), t, "var(--mod-pill-ink)", "var(--mod-pill)");
        assertReadable(at("record number link on paper"), t, "var(--mod-link)", "var(--paper)");
        assertReadable(at("record number link on row hover"), t, "var(--mod-link)", "var(--mod-tint)");
        assertReadable(at("NCR accent on a tinted part"), t, "var(--m700)", "color-mix(in srgb, var(--m500) 7%, var(--paper))");
        assertReadable(at("tab on track"), t, "var(--mod-tab-ink)", "var(--mod-track)");
        assertReadable(at("tab on hover"), t, "var(--mod-tab-ink)", "var(--mod-tab-hover)");
        assertReadable(at("tab count"), t, "var(--mod-count-ink)", "var(--mod-count)");
        assertReadable(at("selected tab count"), t, "var(--mod-count-on-ink)", "var(--mod-count-on)");
        assertReadable(at("check mark on a department chip"), t, "var(--m800)", "#fff");
      } else {
        // ฟ้าสาง: พื้นอ่อนอมสีโมดูล จุดที่สว่างสุดคือแสงมุมขวาบน (เฉด 500 โปร่งใส 32% ทับพื้นเริ่มต้น)
        const start = "color-mix(in srgb, var(--m500) 16%, #0a1322)";
        const glow = `color-mix(in srgb, var(--m500) 32%, ${start})`;
        const end = "color-mix(in srgb, var(--p) 10%, #0a1322)";
        for (const surface of [start, glow, end]) {
          assertReadable(at(`title on wash ${surface}`), t, "var(--mod-on)", surface);
          assertReadable(at(`secondary on wash ${surface}`), t, "var(--mod-on-soft)", surface);
          assertReadable(at(`selected tab on wash ${surface}`), t, "var(--mod-tab-on-ink)", surface);
          assertReadable(at(`count pill over wash ${surface}`), t, "var(--mod-pill-ink)", `color-mix(in srgb, var(--paper) 70%, ${surface})`);
          assertReadable(at(`secondary button over wash ${surface}`), t, "var(--mod-btn-ink)", `color-mix(in srgb, var(--paper) 75%, ${surface})`);
        }
        for (const solid of ["--m700", "--m900"]) {
          assertReadable(at(`primary button on ${solid}`), t, "var(--mod-cta-ink)", `var(${solid})`);
          assertReadable(at(`selected tab count on ${solid}`), t, "var(--mod-count-on-ink)", `var(${solid})`);
        }
        assertReadable(at("table head on the 4 px bar row (m500 18%)"), t, "var(--mod-head-ink)", "color-mix(in srgb, var(--m500) 18%, var(--paper))");
        assertReadable(at("table head on the 4 px bar row (p 10%)"), t, "var(--mod-head-ink)", "color-mix(in srgb, var(--p) 10%, var(--paper))");
        assertReadable(at("record number link on paper"), t, "var(--mod-link)", "var(--paper)");
        assertReadable(at("record number link on row hover"), t, "var(--mod-link)", "var(--mod-tint)");
        assertReadable(at("NCR accent on a tinted part"), t, "var(--mod-link)", "color-mix(in srgb, var(--m500) 7%, var(--paper))");
        assertReadable(at("tab text on the page"), t, "var(--mod-tab-ink)", "var(--paper)");
        assertReadable(at("tab text on the page background"), t, "var(--mod-tab-ink)", "var(--bg)");
      }
    }
  });
}

test("the lab modules that are not open keep white text above 4.5:1 under the muted filter styles.css really applies", () => {
  const filters = [...css.matchAll(/(?:^|\n)\.lab-module-card\.is-off \{ filter: ([^;]+);/g), ...css.matchAll(/:root\[data-theme="dark"\] \.lab-module-card\.is-off \{ filter: ([^;]+);/g)].map((match) => match[1]);
  assert.equal(filters.length, 2, "one filter for the light theme and one for the dark theme");
  const filtered = (rgb, saturate, brightness) => {
    const [r, g, b] = rgb;
    const s = saturate;
    const rows = [
      [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
    return rows.map((row) => Math.max(0, Math.min(255, (row[0] * r + row[1] * g + row[2] * b) * brightness)));
  };
  for (const [index, filter] of filters.entries()) {
    const saturate = Number(/saturate\(([\d.]+)\)/.exec(filter)?.[1]);
    const brightness = Number(/brightness\(([\d.]+)\)/.exec(filter)?.[1] ?? 1);
    assert.ok(Number.isFinite(saturate) && Number.isFinite(brightness), filter);
    assert.equal(filter.replace(/saturate\([\d.]+\)|brightness\([\d.]+\)|\s/g, ""), "", `only saturate/brightness are modelled: ${filter}`);
    // ธีมสว่างตัวอักษรขาวบนเฉด 700/900 · ธีมมืดตัวอักษรเฉด 100 บนพื้นเริ่มต้นของฟ้าสาง
    for (const key of ["bom", "gr", "it", "pt"]) {
      const ramp = RAMPS.get(key);
      const bright = brightness;
      if (index === 0) {
        for (const step of ["--m700", "--m900"]) {
          const muted = filtered(resolve(ramp.get(step), new Map()), saturate, bright);
          assert.ok(contrast([255, 255, 255], muted) >= 4.5, `${key} ${step} muted (light) = ${contrast([255, 255, 255], muted).toFixed(2)}:1`);
        }
      } else {
        const t = tokensOf(ramp, "dark");
        const surfaces = ["color-mix(in srgb, var(--m500) 16%, #0a1322)", "color-mix(in srgb, var(--m500) 32%, color-mix(in srgb, var(--m500) 16%, #0a1322))", "color-mix(in srgb, var(--p) 10%, #0a1322)"];
        for (const surface of surfaces) {
          const text = filtered(resolve("var(--m100)", t), saturate, bright);
          const background = filtered(resolve(surface, t), saturate, bright);
          assert.ok(contrast(text, background) >= 4.5, `${key} muted (dark) ${surface} = ${contrast(text, background).toFixed(2)}:1`);
        }
      }
    }
  }
});

// ---------- ใช้จานสีผ่าน data-module ไม่ใช่ style inline ----------
test("cards, headers and chips take their colour from data-module, never from an inline gradient", () => {
  const app = read("app.js");
  assert.doesNotMatch(app, /requestTypeGradient/, "the inline-gradient helper is gone");
  assert.doesNotMatch(app, /style="background:/, "no inline background in app.js");
  assert.match(app, /function requestPalette\(code\)/);
  assert.match(app, /class="type-card" data-type-id="[^"]*" data-module="\$\{requestPalette\(type\.code\)\}"/);
  assert.match(app, /class="page-heading request-module-header" data-module="\$\{requestPalette\(selected\.code\)\}"/);
  assert.match(app, /class="request-card-type" data-module="\$\{requestPalette\(code\)\}"/);
  for (const file of ["modules/module-mt.js", "modules/module-mg.js", "modules/module-ncr.js", "modules/module-it.js", "modules/module-bom.js", "modules/module-rubberflow.js", "modules/module-qc.js"]) {
    const source = read(file);
    assert.match(source, /\bpalette: "[a-z]+",/, `${file} names its palette`);
    assert.doesNotMatch(source, /\btheme: /, `${file} no longer lists two gradient colours`);
  }
  assert.match(read("modules/module-mt.js"), /palette: "mt"/);
  assert.match(read("modules/module-ncr.js"), /palette: "ncr"/);
  assert.match(read("modules/module-mg.js"), /palette: "mg"/);
  assert.match(read("modules/module-it.js"), /palette: "it"/);
  assert.match(read("modules/module-rubberflow.js"), /data-module="rf"/);
  assert.match(read("modules/module-bom.js"), /data-module="bom"/);
});

test("the dark recipe is keyed on data-theme only, which app.js sets from the OS until the user toggles", () => {
  assert.doesNotMatch(css, /prefers-color-scheme/, "the stylesheet never reads the OS scheme itself");
  const app = read("app.js");
  assert.match(app, /const dark = saved \? saved === "dark" : Boolean\(darkSchemeQuery\?\.matches\);/);
  assert.match(app, /document\.documentElement\.dataset\.theme = dark \? "dark" : "light";/);
  assert.ok(rules.some((rule) => rule.selector === DARK_SCOPE), "dark recipe tokens exist");
  assert.ok(rules.some((rule) => rule.selector === SCOPE), "light recipe tokens exist");
});

test("RubberFlow and BOM use the shared tab, table head, header and badge rules, 44 px on touch, with no private accent", () => {
  assert.doesNotMatch(css, /--rf-accent/, "the private teal accent is gone");
  assert.equal([...css.matchAll(/\.rf-page \.btn \{ min-height: \d+px/g)].length, 1, "one .rf-page .btn size rule, not two");
  assert.equal([...css.matchAll(/(^|\n)\.rf-tab \{/g)].length, 1, "one .rf-tab rule");
  assert.match(css, /\.rf-tab \{[^}]*min-height: 44px/);
  assert.match(css, /\.rf-tabs\.is-scrollable \{[^}]*mask-image/, "tabs fade at the edge when they overflow");
  assert.doesNotMatch(css, /\.rf-page th \{[^}]*text-transform: uppercase/, "table heads are not upper-cased");
  assert.match(css, /\[data-module\] :is\(\.register-table, \.rf-table, \.qc-table\) thead \{ background: var\(--mod-head\); \}/);
  assert.match(css, /@media \(pointer: coarse\), \(max-width: 760px\) \{\s*\.rf-page \.btn, \.rf-page \.btn\.small, \.rf-page \.input, \.rf-page \.select[^{]*\{ min-height: 44px; \}/);
  // ป้าย RubberFlow ใช้รูปทรงของ .badge และสีสถานะทึบเดิม
  assert.match(css, /\.rf-badge \{[^}]*border-radius: var\(--radius-sm\)/);
  for (const tone of ["good", "warn", "bad", "info"]) assert.match(css, new RegExp(`\\.rf-badge\\.is-${tone} \\{ color: #fff; background: var\\(--(success|warning|danger|primary)-strong\\)`));
  assert.doesNotMatch(css, /\.rf-page \.rf-badge\.is-(accent|bad|warn) \{/, "no second badge colour set inside .rf-page");
});

test("the module header, type card and tab shapes keep a gradient surface (colour is not removed)", () => {
  assert.match(declared(SCOPE, "--mod-surface") ?? "", /linear-gradient\(135deg, var\(--m700\), var\(--m900\)\)/);
  assert.match(declared(DARK_SCOPE, "--mod-surface") ?? "", /radial-gradient[\s\S]*linear-gradient/);
  assert.match(declared(".type-card", "background") ?? "", /var\(--mod-surface\)/);
  assert.match(declared(".repair-department-card", "background") ?? "", /var\(--mod-surface\)/);
  assert.match(declared(".ncr-part-heading", "background") ?? "", /var\(--mod-surface\)/);
  assert.match(declared(".request-module-header, .rf-page .rf-pagehead", "background") ?? "", /var\(--mod-surface\)/);
});
