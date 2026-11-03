// ค่าสีของธีมสว่าง/มืดใน styles.css: ตัวอักษรขาวบนปุ่มและป้ายทึบ และตัวอักษรรอง (--quiet, --muted) ต้องได้ ≥ 4.5:1 (WCAG AA)
// อ่าน token จาก :root และ :root[data-theme="dark"] แล้วคำนวณ var() และ color-mix(in srgb, …) เอง ไม่ต้องเปิดเบราว์เซอร์
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = (await readFile(new URL("../../styles.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
const DARK = ':root[data-theme="dark"]';

// กฎชั้นในสุดทุกตัว (กฎใน @media ก็ถูกเก็บด้วย ตามลำดับในไฟล์)
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selectors: selector.split(",").map((part) => part.trim().replace(/\s+/g, " ")),
  declarations: new Map(body.split(";").map((line) => line.split(/:(.*)/s).map((part) => part?.trim())).filter(([name, value]) => name && value)),
}));

function declaration(selector, ...properties) {
  let found = null;
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    for (const property of properties) if (rule.declarations.has(property)) found = rule.declarations.get(property);
  }
  return found;
}

function tokensFor(theme) {
  const tokens = new Map();
  for (const selector of theme === "dark" ? [":root", DARK] : [":root"]) {
    for (const rule of rules) {
      if (!rule.selectors.includes(selector)) continue;
      for (const [name, value] of rule.declarations) if (name.startsWith("--")) tokens.set(name, value);
    }
  }
  return tokens;
}

const THEMES = { light: tokensFor("light"), dark: tokensFor("dark") };

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

function luminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// ค่าที่ใช้จริงในธีมหนึ่ง: กฎ override ของธีมมืดชนะกฎปกติ
function ruleValue(selector, theme, ...properties) {
  if (theme === "dark") {
    const override = declaration(`${DARK} ${selector}`, ...properties) ?? declaration(`:where(${DARK}) ${selector}`, ...properties);
    if (override) return override;
  }
  const value = declaration(selector, ...properties);
  assert.ok(value, `ไม่พบ ${properties.join("/")} ของ ${selector}`);
  return value;
}

function assertReadable(label, foreground, background, theme) {
  const tokens = THEMES[theme];
  const ratio = contrast(resolve(foreground, tokens), resolve(background, tokens));
  assert.ok(ratio >= 4.5, `${label} (${theme}): ${foreground} บน ${background} = ${ratio.toFixed(2)}:1 ต่ำกว่า 4.5:1`);
}

const WHITE_ON_SOLID = [
  ".btn",
  ".btn:hover",
  ".btn.success",
  ".btn.success:hover",
  ".btn.danger-solid",
  ".btn.danger-solid:hover",
  ".nav-count",
  ".update-banner",
  '.nd-chip[aria-current="true"]',
  ".badge.pending_approval",
  ".badge.approved",
  ".badge.completed",
  ".badge.rejected",
  ".toast.success",
];

for (const theme of ["light", "dark"]) {
  test(`white text on solid buttons and badges reaches 4.5:1 (${theme})`, () => {
    for (const selector of WHITE_ON_SOLID) assertReadable(selector, "#fff", ruleValue(selector, theme, "background", "background-color"), theme);
  });

  test(`tinted buttons and labels reach 4.5:1 (${theme})`, () => {
    // หัวข้อ "รายละเอียดที่ผู้ขอแจ้ง" (.request-brief-label) เป็น --muted บนการ์ด จึงอยู่ในชุด muted ด้านล่างแล้ว
    for (const selector of [".btn.warning", ".btn.danger", ".btn.secondary", ".decision-line", ".decision-line.is-error"]) {
      assertReadable(selector, ruleValue(selector, theme, "color"), ruleValue(selector, theme, "background", "background-color"), theme);
    }
  });

  test(`muted and quiet text reach 4.5:1 on every surface (${theme})`, () => {
    // --primary-soft คือพื้นของการ์ดสรุปที่เลือกอยู่ (.summary-toggle[aria-expanded="true"])
    for (const surface of ["--paper", "--bg", "--shell", "--soft-line", "--primary-soft"]) {
      for (const text of ["--quiet", "--muted"]) assertReadable(text, `var(${text})`, `var(${surface})`, theme);
    }
  });
}

test("the summary tile and side stripes follow the dot-not-stripe rule", () => {
  assert.equal(declaration(".request-summary::before", "content"), null, "แถบสีข้างของ .request-summary ต้องไม่กลับมา");
  assert.doesNotMatch(declaration(".request-timeline-card", "background"), /gradient/, "การ์ดคำร้องไม่มีแถบสีข้าง");
});
