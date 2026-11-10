// แดชบอร์ด MT/NCR พับคำอธิบายวิธีนับใต้หัวการ์ด (modules/dashboard-notes.js) แต่ไม่พับย่อหน้าที่เป็นข้อมูล และไม่กลืนมาร์กอัปข้ามการ์ด
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

await import("../../modules/dashboard-notes.js");
const { fold } = globalThis.MNP_DASHBOARD_NOTES;
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("a counting note under a card title is folded into วิธีนับ", () => {
  assert.equal(fold('<div class="nd-head"><h2>งานค้างอยู่ที่ใคร</h2><p>นับทุกใบที่ยังไม่จบ</p></div>'),
    '<div class="nd-head"><h2>งานค้างอยู่ที่ใคร</h2><details class="nd-about"><summary>วิธีนับ</summary><p>นับทุกใบที่ยังไม่จบ</p></details></div>');
  // ย่อหน้าที่มีแท็กซ้อน (ตัวหนา) พับทั้งย่อหน้า
  assert.match(fold('<div class="nd-head"><h2>A</h2><p>ทั้งหมด <b>3</b> ใบ</p></div>'), /<summary>วิธีนับ<\/summary><p>ทั้งหมด <b>3<\/b> ใบ<\/p><\/details>/);
});

test("a paragraph that carries the card's figures stays visible", () => {
  const html = '<div class="nd-head"><h2>รายการ</h2><p class="nd-keep">ทั้งหมด <b>12</b> ใบ</p></div>';
  assert.equal(fold(html), html);
});

test("a head without a paragraph is left alone and never swallows the next card", () => {
  const html = '<div class="nd-head"><h2>การ์ดหนึ่ง</h2><div class="nd-chips"></div></div><section><div class="nd-head nd-head-row"><h2>สอง</h2><p>หมายเหตุ</p></div></section>';
  assert.equal(fold(html), html);
  const two = fold('<div class="nd-head"><h2>X</h2><span>a</span></div><div class="nd-head"><h2>Y</h2><p>นับแบบนี้</p></div>');
  assert.match(two, /<h2>X<\/h2><span>a<\/span>/, "the first card is untouched");
  assert.match(two, /<h2>Y<\/h2><details class="nd-about">/);
});

test("both dashboards use the one helper, and their figure paragraphs are marked to stay", () => {
  for (const file of ["modules/module-mt-dashboard.js", "modules/module-ncr-dashboard.js"]) {
    const source = read(file);
    assert.match(source, /window\.MNP_DASHBOARD_NOTES\?\.fold \?\? \(\(html\) => html\)\)\(pageBody\(\)\)/, file);
    assert.doesNotMatch(source, /const foldCardNotes/, `${file} has no private copy`);
  }
  const ncr = read("modules/module-ncr-dashboard.js");
  // เหลือย่อหน้าตัวเลขเดียว (จำนวนใบของรายการ) · การ์ดความสูญเสียแยกประเภทไม่ทวนยอดรวมที่อยู่ในการ์ดตัวเลขแล้ว
  assert.equal((ncr.match(/<p class="nd-keep">/g) ?? []).length, 1);
  const index = read("index.html");
  assert.ok(index.indexOf("modules/dashboard-notes.js") > 0 && index.indexOf("modules/dashboard-notes.js") < index.indexOf("modules/module-mt-dashboard.js"), "loaded before the dashboards");
});
