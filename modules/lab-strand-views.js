// ส่วนแสดงผลข้อมูลยางเส้นของโมดูล MNP LAB (ออเดอร์ ขนาดวงนอก/รูใน สเปก) — สร้างเป็นข้อความ HTML ล้วนจากข้อมูลที่ model แปลงแล้ว ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/lab-strand-views.test.mjs
//
// module-lab.js เรียกที่นี่เพื่อได้ HTML ของการ์ดบนหน้าวัสดุ แล้วเป็นผู้ผูกเหตุการณ์ เรียก RPC และจัดการสิทธิ์เอง
// ข้อความที่ผู้ใช้กรอกหรือมาจากชีต (ออเดอร์ ID) ถูก escape ทุกจุดก่อนใส่ใน HTML
//
// หลักของการ์ด: ข้อมูลแต่ละอย่างแสดงที่เดียว — ค่าที่วัดได้ของวงนอก/รูใน ธงเทียบสเปก และช่วงสเปก อยู่ในเซลล์เดียวกันของตาราง
// คำอธิบายของปุ่ม/ช่องอยู่ที่ label, title และ aria-label ไม่เป็นข้อความถาวรบนหน้า (data-label ใช้เฉพาะมือถือที่ตารางเรียงเป็นการ์ดต่อ ID)
(function (root) {
  const strand = root.MNP_LAB_STRAND;
  if (!strand) return;

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // ช่องกรอกขนาด (มม.) ข้อความ + inputmode ทศนิยม ไม่ใช้ type=number เพราะเบราว์เซอร์ตรวจ step/ตัวคั่นทศนิยมต่างกันและเมาส์เลื่อนค่าเอง
  // ตรวจค่าด้วย model.parseSize ที่เดียวทั้งหน้า (ฟอร์มปิด validation ของเบราว์เซอร์: novalidate)
  const sizeField = (id, name, label) => `<div class="field"><label for="${id}">${esc(label)}</label><input class="input" id="${id}" name="${name}" type="text" inputmode="decimal" autocomplete="off" maxlength="9"></div>`;

  // การ์ดบนหน้าวัสดุ: หัวการ์ด + ปุ่มเพิ่ม + ฟอร์ม (ซ่อนอยู่จนกดเพิ่ม/แก้ไข) + ตาราง (module-lab.js เติมตาราง ตัวเลือก ID และข้อความ)
  // ซ่อนทั้งการ์ดไว้ก่อน เพราะฐานข้อมูลที่ยังไม่มีส่วนนี้ต้องไม่เห็นการ์ดว่างๆ
  function strandCard() {
    return `<section class="card flush lab-strand-card" id="lab-strand-card" aria-labelledby="lab-strand-title" hidden>
      <div class="card-heading">
        <div class="lab-table-head"><h2 id="lab-strand-title">ออเดอร์และขนาดยางเส้น</h2></div>
        <div class="lab-card-actions"><button class="btn secondary small" type="button" id="lab-strand-add">เพิ่มข้อมูล</button></div>
      </div>
      <p class="small lab-strand-note" id="lab-strand-note" role="status" aria-live="polite" hidden></p>
      <form class="lab-strand-form" id="lab-strand-form" novalidate hidden>
        <h3 class="lab-strand-form-title" id="lab-strand-form-title"></h3>
        <div class="lab-strand-top">
          <div class="field"><label for="lab-strand-id">ID</label><select class="select" id="lab-strand-id" name="sample_id"></select></div>
          <div class="field"><label for="lab-strand-order">ออเดอร์</label><input class="input" id="lab-strand-order" name="order_no" type="text" maxlength="${strand.MAX_ORDER_LENGTH}" autocomplete="off" placeholder="เลขที่ออเดอร์ที่ใช้ยางเส้นนี้"></div>
        </div>
        <div class="lab-strand-groups">
          <fieldset class="lab-strand-group"><legend>วงนอก (มม.)</legend><div class="lab-strand-sizes">
            ${sizeField("lab-strand-outer", "outer_mm", "วัดได้")}${sizeField("lab-strand-outer-min", "outer_min_mm", "สเปกต่ำสุด")}${sizeField("lab-strand-outer-max", "outer_max_mm", "สเปกสูงสุด")}
          </div></fieldset>
          <fieldset class="lab-strand-group"><legend>รูใน (มม.)</legend><div class="lab-strand-sizes">
            ${sizeField("lab-strand-inner", "inner_mm", "วัดได้")}${sizeField("lab-strand-inner-min", "inner_min_mm", "สเปกต่ำสุด")}${sizeField("lab-strand-inner-max", "inner_max_mm", "สเปกสูงสุด")}
          </div></fieldset>
        </div>
        <p class="lab-strand-error" id="lab-strand-error" role="alert" hidden></p>
        <div class="form-actions">
          <button class="btn" type="submit" id="lab-strand-save">บันทึก</button>
          <button class="btn secondary" type="button" id="lab-strand-cancel">ยกเลิก</button>
          <button class="btn danger" type="button" id="lab-strand-delete" hidden>ลบข้อมูล</button>
        </div>
      </form>
      <div class="lab-table-scroll lab-strand-scroll" id="lab-strand-scroll" tabindex="0" role="region" aria-labelledby="lab-strand-title"></div>
      <p class="muted small lab-strand-empty" id="lab-strand-empty" hidden></p>
    </section>`;
  }

  // แก้ไข = ไม่ซ้ำเลข ID ที่ช่อง ID ที่ล็อกไว้ในฟอร์มเดียวกันบอกอยู่แล้ว
  const formTitle = (editing) => (editing ? "แก้ไขข้อมูล" : "เพิ่มข้อมูลยางเส้น");

  // ตัวเลือก ID ของฟอร์ม: เพิ่มใหม่ = ID ที่ยังไม่มีข้อมูล (ต้องเลือก) แก้ไข = ID เดียวที่ล็อกไว้
  function idOptions(choices, selected = "") {
    const options = choices.map((id) => `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(id)}</option>`).join("");
    return selected && choices.length === 1 ? options : `<option value="">เลือก ID</option>${options}`;
  }

  // เซลล์ขนาด: ค่าที่วัดได้ + ธงเทียบสเปก (ข้อความ ไม่ใช้สีอย่างเดียว) + ช่วงสเปก ใต้ค่าเดียวกัน
  function sizeCell(label, actual, min, max) {
    const status = strand.specStatus(actual, min, max);
    const flag = status ? `<span class="lab-size-flag is-${status}">${esc(strand.STATUS_LABELS[status])}</span>` : "";
    const hasLimits = [min, max].some((value) => typeof value === "number");
    const limits = hasLimits ? `<span class="lab-size-limits">สเปก ${esc(strand.formatLimits(min, max))}</span>` : "";
    return `<td class="lab-size" data-label="${esc(label)}"><span class="lab-size-main">${esc(strand.formatSize(actual))}</span>${flag}${limits}</td>`;
  }

  // ตารางข้อมูลของ ID ที่แสดง (items เรียงแล้ว) ปุ่มแก้ไขอ้าง ID ผ่าน data-strand-edit ให้โค้ดหน้าหยิบจากรายการของตัวเอง
  function strandTable({ items, material }) {
    const rows = items.map((item) => `<tr class="lab-strand-row" data-id="${esc(item.sampleId)}">
        <th scope="row" class="sticky">${esc(item.sampleId)}</th>
        <td class="lab-order-no" data-label="ออเดอร์">${item.orderNo ? esc(item.orderNo) : '<span class="lab-none">—</span>'}</td>
        ${sizeCell("วงนอก", item.outer, item.outerMin, item.outerMax)}
        ${sizeCell("รูใน", item.inner, item.innerMin, item.innerMax)}
        <td class="lab-strand-actions"><button class="btn secondary small" type="button" data-strand-edit="${esc(item.sampleId)}" aria-label="${esc(`แก้ไขข้อมูลของ ID ${item.sampleId}`)}">แก้ไข</button></td>
      </tr>`).join("");
    return `<table class="lab-table lab-strands"><caption class="sr-only">ออเดอร์และขนาดยางเส้นของ ${esc(material)}</caption><thead><tr><th scope="col" class="lab-th sticky">ID</th><th scope="col" class="lab-th">ออเดอร์</th><th scope="col" class="lab-th">วงนอก (มม.)</th><th scope="col" class="lab-th">รูใน (มม.)</th><th scope="col" class="lab-th"><span class="sr-only">แก้ไข</span></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ข้อความเมื่อไม่มีแถวให้แสดง: กำลังดู ID เดียวแล้วยังไม่มีข้อมูลของ ID นั้น (ไม่ซ้ำเลข ID ที่ตัวเลือกหัวหน้าบอกอยู่) / ทั้งวัสดุยังไม่มีข้อมูลเลย
  const emptyText = (filtered) => (filtered ? "ID นี้ยังไม่มีข้อมูลออเดอร์และขนาด" : "ยังไม่มีข้อมูลออเดอร์และขนาดของวัสดุนี้");

  const api = { strandCard, formTitle, idOptions, sizeCell, strandTable, emptyText };
  root.MNP_LAB_STRAND_VIEWS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
