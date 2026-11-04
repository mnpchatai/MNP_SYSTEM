// เป้ากดบนจอสัมผัส (critique G P2): ปุ่มและตัวควบคุมบนเส้นทางหลักสูงอย่างน้อย 44px สำหรับนิ้วสวมถุงมือ
// และการ์ดทะเบียนบนจอแคบแตะได้ทั้งใบ — จอที่ใช้เมาส์คงความแน่นเดิม
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// เนื้อหาของ @media ที่ระบุ (กติกาชั้นเดียว) เป็น Map selector → declarations
function mediaRules(query) {
  const start = css.lastIndexOf(`@media ${query} {`);
  assert.ok(start >= 0, `@media ${query} exists`);
  let depth = 0, end = start;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && --depth === 0) { end = i; break; }
  }
  const body = css.slice(css.indexOf("{", start) + 1, end);
  const rules = new Map();
  for (const [, selectors, declarations] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // แยกด้วยจุลภาคระดับบนเท่านั้น (จุลภาคใน :is(...) เป็นส่วนของ selector เดียว)
    const parts = [];
    let depth = 0, from = 0;
    for (let i = 0; i < selectors.length; i += 1) {
      if (selectors[i] === "(") depth += 1;
      else if (selectors[i] === ")") depth -= 1;
      else if (selectors[i] === "," && depth === 0) { parts.push(selectors.slice(from, i)); from = i + 1; }
    }
    parts.push(selectors.slice(from));
    for (const selector of parts.map((part) => part.trim().replace(/\s+/g, " "))) {
      rules.set(selector, `${rules.get(selector) ?? ""};${declarations}`);
    }
  }
  return { rules, start };
}

test("on touch screens the main-path controls reach 44px", () => {
  const { rules, start } = mediaRules("(pointer: coarse), (max-width: 760px)");
  for (const selector of [".btn", ".btn.small", ".filter", ".view-tab", ".request-back-link", ".link-button", ".tech-option", ".parts-table .input", ".board-search .input", ".board-search .select", ".list-filter .select"]) {
    assert.match(rules.get(selector) ?? "", /min-height: 44px/, `${selector} min-height`);
  }
  // ลิงก์ดาวน์โหลด: พื้นที่แตะ 19 + 13 + 13 = 45px โดยไม่ทำให้ไทล์สูงขึ้น (margin ติดลบเท่า padding)
  assert.match(rules.get(".attachment-download:not([hidden])") ?? "", /margin: -13px -8px; padding: 13px 8px;/);
  // แถบข้างย่อ (761–1040px) มีคอลัมน์เดียว: คอลัมน์ 44px ของปุ่มออกจากระบบใช้เฉพาะแถบเต็มกว้าง
  assert.equal(rules.has(".sidebar-user"), false, "the collapsed sidebar keeps its single column");
  const wide = mediaRules("(pointer: coarse) and (min-width: 1041px)").rules;
  assert.match(wide.get(".sidebar-user") ?? "", /grid-template-columns: 34px minmax\(0, 1fr\) 44px/);
  for (const selector of [".icon-button", ".request-detail-menu > .icon-button", ".mobile-nav-toggle"]) {
    assert.match(rules.get(selector) ?? "", /width: 44px; height: 44px/, `${selector} is 44×44`);
  }
  // ท้ายไฟล์: ชนะกติกาความเจาะจงเท่ากันที่ประกาศก่อน (เช่น .mobile-nav-toggle 36px ใน @media ของจอแคบ)
  assert.ok(start > css.lastIndexOf(".mobile-nav-toggle { position: fixed;"), "declared after the narrow-screen nav toggle rule");
  // ลิงก์ดาวน์โหลดที่ซ่อนอยู่ (ยังไม่ได้ลิงก์จริง) ต้องยังซ่อน
  assert.equal(rules.has(".attachment-download"), false, "only the visible download link changes display");
});

test("register cards on narrow screens open from anywhere on the card", () => {
  const { rules } = mediaRules("(max-width: 760px)");
  assert.match(rules.get(".register-table tr") ?? "", /position: relative/);
  assert.match(rules.get(".register-table a.register-title::after") ?? "", /content: ""; position: absolute; inset: 0/);
  // ลิงก์/ปุ่มอื่นในการ์ดอยู่เหนือพื้นที่แตะของการ์ด
  assert.match(rules.get(".register-table tr :is(a:not(.register-title), button, select, input)") ?? "", /z-index: 1/);
  assert.match(rules.get(".register-table tr:has(a.register-title:focus-visible)") ?? "", /outline: 2px solid var\(--primary\)/, "keyboard focus outlines the whole card");
});
