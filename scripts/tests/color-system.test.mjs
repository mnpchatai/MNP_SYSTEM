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

// ---------- ป้ายสถานะแยกจากสีโมดูลด้วยรูปทรงและสัญลักษณ์ (ผู้ใช้เลือก "แบบ 1" 2026-11-09) ----------
const STATUS_BADGES = ["pending_approval", "more_info", "pending_assign", "pending_verify", "approved", "in_progress", "assigned", "completed", "acknowledged", "rejected", "cancelled", "urgent-flag", "loss-pending-flag"];
const RF_TONES = ["is-good", "is-warn", "is-bad", "is-info", "is-accent"];
const glyphRules = rules.filter((rule) => rule.declarations.has("--badge-glyph"));
const hasGlyph = (base, name) => glyphRules.some((rule) => rule.selector.split(/,(?![^(]*\))/).some((part) => part.includes(base) && new RegExp(`\\.${name}(?![\\w-])`).test(part)));

test("every status badge and RubberFlow tone carries a glyph cut out of a white disc", () => {
  for (const name of STATUS_BADGES) assert.ok(hasGlyph(".badge", name), `.badge.${name} has a glyph`);
  for (const name of RF_TONES) assert.ok(hasGlyph(".rf-badge", name), `.rf-badge.${name} has a glyph`);
  for (const rule of glyphRules) assert.match(rule.declarations.get("--badge-glyph"), /^url\("data:image\/svg\+xml,%3Csvg [^"]*%3Cmask id='g'%3E[^"]*mask='url\(%23g\)'[^"]*"\)$/, `${rule.selector}: an SVG disc with the glyph masked out`);
  const disc = rules.find((rule) => rule.selector.endsWith("::before") && rule.declarations.get("mask")?.startsWith("var(--badge-glyph)"));
  assert.ok(disc, "the ::before disc is masked by the glyph");
  assert.equal(disc.declarations.get("-webkit-mask"), disc.declarations.get("mask"), "Safari gets the same mask");
  assert.equal(disc.declarations.get("background"), "#fff");
  for (const name of STATUS_BADGES) assert.ok(disc.selector.includes(`.${name}`), `the disc rule covers .${name}`);
  for (const name of RF_TONES) assert.ok(disc.selector.includes(`.${name}`), `the disc rule covers .rf-badge.${name}`);
  assert.match(css, /@media \(forced-colors: active\) \{ :is\(\.badge, \.rf-badge\)::before \{ forced-color-adjust: none; background: CanvasText; \} \}/);
});

test("the status colours stay readable as white text and as the glyph on the white disc", () => {
  for (const [theme, tokens] of [["light", ROOT_LIGHT], ["dark", ROOT_DARK]]) {
    for (const name of ["--warning-strong", "--primary-strong", "--success-strong", "--danger-strong"]) {
      const value = contrast([255, 255, 255], resolve(`var(${name})`, tokens));
      assert.ok(value >= 4.5, `${name} (${theme}) = ${value.toFixed(2)}:1`);
    }
  }
});

test("text on a soft status background reaches 4.5:1 in both themes", () => {
  let checked = 0;
  for (const rule of rules) {
    const soft = rule.declarations.get("background")?.match(/^var\(--(success|warning|danger|primary)-soft\)$/);
    const color = rule.declarations.get("color");
    if (!soft || !color?.startsWith("var(--")) continue;
    for (const [theme, tokens] of [["light", ROOT_LIGHT], ["dark", ROOT_DARK]]) {
      const value = contrast(resolve(color, tokens), resolve(rule.declarations.get("background"), tokens));
      assert.ok(value >= 4.5, `${rule.selector} (${theme}): ${color} on ${soft[0]} = ${value.toFixed(2)}:1`);
    }
    checked += 1;
  }
  assert.ok(checked >= 20, `checked ${checked} soft pairs`);
  assert.match(css, /\.ncr-loss-net dd \{ color: var\(--primary-ink\); \}/);
  assert.match(css, /\.ncr-owner-chip \{[^}]*color: var\(--ink\);[^}]*background: var\(--shell\);/, "the NCR owner box no longer borrows a status colour");
});

test("department chips: unselected chips are a light tint of the department colour, readable for every ramp", () => {
  assert.match(css, /:root:not\(\[data-theme="dark"\]\) \.repair-department-card:not\(\.active\) \{ color: var\(--m900\); background: linear-gradient\(135deg, var\(--m50\), var\(--m100\)\);/);
  for (const [key, ramp] of RAMPS) {
    for (const ink of ["--m900", "--m800"]) for (const ground of ["--m50", "--m100"]) {
      const value = contrast(resolve(ramp.get(ink), new Map()), resolve(ramp.get(ground), new Map()));
      assert.ok(value >= 4.5, `${key} ${ink} on ${ground} = ${value.toFixed(2)}:1`);
    }
  }
});

test("the request detail, create form, NCR detail, dashboards, home queue, filters and RubberFlow/BOM menu take the module colour", () => {
  const app = read("app.js");
  assert.match(app, /<header class="request-detail-head request-module-header\$\{canApprove \? " has-step-line" : ""\}" data-module="\$\{requestPalette\(type\?\.code\)\}">/);
  assert.match(app, /<div class="page-heading request-module-header" data-module="\$\{requestPalette\(selected\.code\)\}"><div class="request-module-title">\$\{typeCardMarkHtml\(selected\)\}/);
  assert.equal([...app.matchAll(/class="queue-item-icon" data-module="/g)].length, 3, "all three home queue icons carry data-module");
  assert.match(read("modules/module-ncr.js"), /class="page-heading request-module-header ncr-detail-head" data-module="ncr"/);
  assert.match(read("modules/module-mt-dashboard.js"), /class="page-heading request-module-header" data-module="mt"/);
  assert.match(read("modules/module-ncr-dashboard.js"), /class="page-heading request-module-header" data-module="ncr"/);
  assert.match(css, /\.queue-item-icon\[data-module\] \{ color: var\(--mod-on\); background: var\(--mod-surface\);/);
  assert.match(css, /\[data-module\] \.filter\.active \{ color: var\(--mod-tab-on-ink\); background: var\(--mod-tab-on\);/);
  assert.match(css, /\.rf-nav-item\.is-active \{ color: var\(--mod-tab-on-ink, var\(--primary-ink\)\); background: var\(--mod-tab-on, var\(--primary-soft\)\);/);
  assert.match(css, /\.request-detail-head\.request-module-header \{ z-index: 2; overflow: visible;/, "the detail menu can drop below the header");
  // โมดูลย่อยของ RubberFlow/BOM ใช้เฉดของจานสีแม่ ไม่มีสี hex ของตัวเอง
  assert.doesNotMatch(css, /\[data-rf-mod="[^"]+"\] \{ --rf-mod: #/);
  assert.doesNotMatch(css, /#cf3030|#1b8f4e/);
});

test("every badge class the code renders is one of the styled statuses (or the neutral badge)", () => {
  const sources = ["app.js", "modules/module-ncr.js", "modules/module-qc.js", "modules/qc-model.js", "modules/module-mt.js", "modules/module-mt-dashboard.js"].map(read);
  const used = new Set();
  for (const source of sources) {
    for (const [, name] of source.matchAll(/class="badge ([a-z_-]+)"/g)) used.add(name);
    for (const [, body] of source.matchAll(/(?:STATUS_BADGE_CLASS|statusBadgeClass|RESULT_BADGE) = \{([^}]*)\}/g)) for (const [, name] of body.matchAll(/:\s*"([a-z_-]+)"/g)) used.add(name);
  }
  const statusKeys = [...read("app.js").match(/const statusLabels = \{([^}]*)\}/)[1].matchAll(/^\s*([a-z_]+):/gm)].map(([, key]) => key);
  for (const key of statusKeys) if (key !== "draft") used.add(key);
  assert.ok(used.size >= 10, `found ${used.size} badge classes`);
  for (const name of used) assert.ok(STATUS_BADGES.includes(name), `badge class "${name}" has a colour and a glyph`);
});
