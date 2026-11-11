// คำอธิบายที่ไม่ต้องอ่านทุกครั้งอยู่หลังปุ่ม ⓘ ตัวเดียวกันทุกหน้า (modules/dashboard-notes.js):
// แดชบอร์ดพับคำอธิบายวิธีนับใต้หัวการ์ดเข้าปุ่ม แต่ไม่พับย่อหน้าที่เป็นข้อมูล และไม่กลืนมาร์กอัปข้ามการ์ด
// หน้า RubberFlow/BOM และหน้าหลักใช้ปุ่มเดียวกันแทนย่อหน้าถาวร
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

await import("../../modules/dashboard-notes.js");
const { fold, toggle, heading } = globalThis.MNP_NOTES;
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("a counting note under a card title goes behind one ⓘ button named for that card", () => {
  const html = fold('<div class="nd-head"><h2>งานค้างอยู่ที่ใคร</h2><p>นับทุกใบที่ยังไม่จบ</p></div>');
  assert.match(html, /^<div class="nd-head"><div class="note-row"><h2>งานค้างอยู่ที่ใคร<\/h2><button type="button" class="note-toggle" data-note-toggle aria-expanded="false" aria-controls="(note-\d+)" aria-label="วิธีนับ: งานค้างอยู่ที่ใคร" title="วิธีนับ">/);
  const id = html.match(/aria-controls="(note-\d+)"/)[1];
  assert.match(html, new RegExp(`<div class="note-body" id="${id}" hidden><p>นับทุกใบที่ยังไม่จบ</p></div></div>$`));
  assert.doesNotMatch(html, />วิธีนับ</, "the word is the button's name, not printed text repeated on every card");
  // ย่อหน้าที่มีแท็กซ้อน (ตัวหนา) พับทั้งย่อหน้า
  assert.match(fold('<div class="nd-head"><h2>A</h2><p>ทั้งหมด <b>3</b> ใบ</p></div>'), /hidden><p>ทั้งหมด <b>3<\/b> ใบ<\/p><\/div>/);
  // คำอธิบายใต้ชื่อกราฟ (nd-sub h3) ก็พับแบบเดียวกัน
  assert.match(fold('<div class="nd-sub"><h3>จำนวน NCR</h3><p>แยกสีตามแผนก</p>'), /<div class="nd-sub"><div class="note-row"><h3>จำนวน NCR<\/h3><button[^>]*aria-label="วิธีนับ: จำนวน NCR"/);
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
  assert.match(two, /<h2>Y<\/h2><button type="button" class="note-toggle"/);
});

test("each toggle gets its own id, and labels are plain attribute text", () => {
  const a = toggle("ชื่อ <b>หนา</b> \"คำพูด\"", "<p>x</p>");
  const b = toggle("อีกอัน", "<p>y</p>");
  assert.notEqual(a.body.match(/id="([^"]+)"/)[1], b.body.match(/id="([^"]+)"/)[1]);
  assert.match(a.button, /aria-label="คำอธิบาย: ชื่อ หนา &quot;คำพูด&quot;"/);
  assert.equal(heading("h1", "ไม่มีคำอธิบาย", ""), "<h1>ไม่มีคำอธิบาย</h1>");
});

test("both dashboards, RubberFlow/BOM page heads and the main screens use the one helper", () => {
  for (const file of ["modules/module-mt-dashboard.js", "modules/module-ncr-dashboard.js"]) {
    const source = read(file);
    assert.match(source, /window\.MNP_DASHBOARD_NOTES\?\.fold \?\? \(\(html\) => html\)\)\(pageBody\(\)\)/, file);
    assert.doesNotMatch(source, /const foldCardNotes/, `${file} has no private copy`);
  }
  assert.match(read("modules/rubberflow-ui.js"), /root\.MNP_NOTES\.heading\("h1"/, "RubberFlow page descriptions sit behind ⓘ");
  assert.match(read("modules/bom-pages.js"), /ctx\.ui\.headingWithNote\(title, desc\)/, "BOM uses the RubberFlow page head");
  assert.match(read("modules/module-ncr.js"), /window\.MNP_NOTES\?\.heading\("h2", "ไฟล์หลักฐาน"/);
  const ncr = read("modules/module-ncr-dashboard.js");
  // เหลือย่อหน้าตัวเลขเดียว (จำนวนใบของรายการ) · การ์ดความสูญเสียแยกประเภทไม่ทวนยอดรวมที่อยู่ในการ์ดตัวเลขแล้ว
  assert.equal((ncr.match(/<p class="nd-keep">/g) ?? []).length, 1);
  const index = read("index.html");
  assert.ok(index.indexOf("modules/ui-icons.js") < index.indexOf("modules/dashboard-notes.js"), "the info icon is loaded first");
  assert.ok(index.indexOf("modules/dashboard-notes.js") > 0 && index.indexOf("modules/dashboard-notes.js") < index.indexOf("modules/module-mt-dashboard.js"), "loaded before the dashboards");
  assert.ok(index.indexOf("modules/dashboard-notes.js") < index.indexOf("modules/rubberflow-ui.js"), "loaded before RubberFlow");
});

test("the main screens carry no long permanent instructions", () => {
  const app = read("app.js");
  const mt = read("modules/module-mt.js");
  assert.doesNotMatch(mt, /ถ้าคาดว่าจะเสร็จไม่ทัน แก้วันที่ได้/, "the expected-date note moved into the button title");
  assert.doesNotMatch(mt, /กด "บันทึกข้อมูล" เพื่อบันทึกไว้ทำต่อภายหลัง/, "the finish form's two buttons explain themselves");
  assert.match(mt, /<label for="verify-note">หมายเหตุ \(จำเป็นเมื่อไม่ผ่าน\)<\/label>/);
  assert.doesNotMatch(app, /เปิดรายละเอียดได้ \$\{openable\}/, "the board does not restate its own row count");
  assert.doesNotMatch(app, /audit log ตามปกติ/);
  const hint = read("modules/attachment-image.js");
  assert.match(hint, /const HINT_SHORT = `ไม่เกิน \$\{MAX_BATCH_FILES\} ไฟล์ รวม/);
  for (const file of ["app.js", "modules/module-mt.js", "modules/ncr-attachments.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /<small>\$\{ATTACHMENT_HINT\}<\/small>/, `${file}: the long upload rules are in the button title, not under every field`);
    assert.doesNotMatch(source, /รูปจากโทรศัพท์ทุกรุ่นใช้ได้ ระบบแปลงให้เอง/, `${file}: one upload hint wording`);
  }
});
