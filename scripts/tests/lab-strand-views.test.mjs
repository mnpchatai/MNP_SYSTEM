import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// HTML ของการ์ดข้อมูลยางเส้นเป็นข้อความล้วน (ไม่มี DOM) โหลดตรงๆ ได้: views อ่าน model จาก globalThis เหมือนที่อ่านจาก window ใน browser
const require = createRequire(import.meta.url);
const strand = require("../../modules/lab-strand-model.js");
globalThis.MNP_LAB_STRAND = strand;
const views = require("../../modules/lab-strand-views.js");

const XSS = `<img src=x onerror=alert(1)>`;
const spec = (overrides = {}) => strand.normalizeSpec({
  sample_id: "111", order_no: "PO-2610-001", outer_mm: 20.1, inner_mm: 3.05, outer_min_mm: 19.5, outer_max_mm: 20.5,
  inner_min_mm: 2.5, inner_max_mm: 3.5, version: 1, ...overrides,
});

test("the card is hidden until the controller knows the database supports it, and has the form fields the controller reads", () => {
  const html = views.strandCard();
  assert.match(html, /<section[^>]*id="lab-strand-card"[^>]*\shidden>/);
  for (const id of ["lab-strand-add", "lab-strand-note", "lab-strand-form", "lab-strand-form-title", "lab-strand-id", "lab-strand-order",
    "lab-strand-outer", "lab-strand-outer-min", "lab-strand-outer-max", "lab-strand-inner", "lab-strand-inner-min", "lab-strand-inner-max",
    "lab-strand-error", "lab-strand-cancel", "lab-strand-delete", "lab-strand-scroll", "lab-strand-empty"]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} exists`);
  }
  assert.match(html, /<form[^>]*id="lab-strand-form"[^>]*novalidate[^>]*\shidden>/, "the form is closed and uses our own validation");
  assert.match(html, /id="lab-strand-delete"[^>]*\shidden>/, "delete is only shown when editing");
  assert.match(html, /<legend>วงนอก \(มม\.\)<\/legend>/);
  assert.match(html, /<legend>รูใน \(มม\.\)<\/legend>/);
  assert.match(html, /id="lab-strand-error"[^>]*role="alert"/, "validation errors are announced");
  assert.doesNotMatch(html, /type="number"/, "sizes are parsed by the model, not the browser");
});

test("every form field has a visible label", () => {
  const html = views.strandCard();
  const ids = [...html.matchAll(/<(?:input|select)[^>]*\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 8);
  for (const id of ids) assert.match(html, new RegExp(`<label for="${id}">`), `${id} has a label`);
});

test("the table shows order, measured size, spec window and a verdict once per cell", () => {
  const html = views.strandTable({ items: [spec()], material: "A1802" });
  assert.match(html, /<th scope="row" class="sticky">111<\/th>/);
  assert.match(html, /PO-2610-001/);
  assert.match(html, /<span class="lab-size-main">20\.10<\/span><span class="lab-size-flag is-ok">ในสเปก<\/span><span class="lab-size-limits">สเปก 19\.50 – 20\.50<\/span>/);
  assert.match(html, /<span class="lab-size-main">3\.05<\/span>[^]*สเปก 2\.50 – 3\.50/);
  assert.match(html, /data-strand-edit="111"/);
  assert.match(html, /aria-label="แก้ไขข้อมูลของ ID 111"/);
  assert.match(html, /<caption class="sr-only">ออเดอร์และขนาดยางเส้นของ A1802<\/caption>/);
});

test("out-of-spec sizes carry a text label, not only a colour", () => {
  const html = views.strandTable({ items: [spec({ outer_mm: 21, inner_mm: 2 })], material: "A1802" });
  assert.match(html, /is-high">เกินสเปก</);
  assert.match(html, /is-low">ต่ำกว่าสเปก</);
});

test("missing values show a dash and no verdict is invented", () => {
  const html = views.strandTable({ items: [spec({ order_no: null, outer_mm: null, inner_mm: 3, outer_min_mm: 19.5, outer_max_mm: null, inner_min_mm: null, inner_max_mm: null })], material: "A" });
  assert.match(html, /<td class="lab-order-no" data-label="ออเดอร์"><span class="lab-none">—<\/span><\/td>/);
  assert.match(html, /<span class="lab-size-main">—<\/span><span class="lab-size-limits">สเปก ≥ 19\.50<\/span>/, "spec without a measurement has no flag");
  assert.match(html, /<span class="lab-size-main">3\.00<\/span><\/td>/, "a measurement without a spec has no flag and no limits line");
});

test("user text is escaped everywhere it is rendered", () => {
  const html = views.strandTable({ items: [spec({ sample_id: XSS, order_no: XSS })], material: XSS });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(views.idOptions([XSS], ""), /<img/);
});

test("idOptions asks to choose when adding and locks the single ID when editing", () => {
  assert.match(views.idOptions(["111", "112"], ""), /<option value="">เลือก ID<\/option><option value="111">111<\/option><option value="112">112<\/option>/);
  assert.match(views.idOptions(["111", "112"], "112"), /<option value="112" selected>/);
  assert.equal(views.idOptions(["111"], "111"), `<option value="111" selected>111</option>`, "editing offers no placeholder");
});

test("form title and empty text say which ID they are about", () => {
  assert.equal(views.formTitle(""), "เพิ่มข้อมูลยางเส้น");
  assert.equal(views.formTitle("111"), "แก้ไขข้อมูลของ ID 111");
  assert.equal(views.emptyText(""), "ยังไม่มีข้อมูลออเดอร์และขนาดของวัสดุนี้");
  assert.equal(views.emptyText("111"), "ID 111 ยังไม่มีข้อมูลออเดอร์และขนาด");
});
