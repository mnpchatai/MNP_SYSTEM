// โมดูลย่อยของ MNP LAB — รายการโมดูล การอ่านจาก URL และแถบเลือกโมดูลที่หัวทุกหน้า ข้อความ HTML ล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/lab-sections.test.mjs
//
// MNP LAB มี 4 โมดูลตามลำดับนี้: แดชบอร์ด · เปรียบเทียบเคมี · Mooney test report · MDR test report
// ทุกโมดูลอยู่ใต้ #/lab (path เดียว จึงไม่ต้องแก้สิทธิ์ของบัญชี lab-only หรือการไฮไลต์เมนูข้าง): #/lab = แดชบอร์ด,
// #/lab?module=<key> = โมดูลอื่น และหน้าวัสดุของ Mooney คือ #/lab?module=mooney&material=<วัสดุ> (ดู lab-mooney-model.js)
// ลิงก์เดิมก่อนแยกโมดูล (#/lab?material=<วัสดุ>) ยังเปิดหน้าวัสดุของ Mooney ได้
//
// แถบเลือกโมดูลเป็นทั้งตัวสลับและชื่อหน้า (โมดูลที่เปิดอยู่ไฮไลต์ และเป็น h1 สำหรับโปรแกรมอ่านหน้าจอ) จึงไม่มีหัวข้อซ้ำบนหน้า
// โมดูลที่ ready: false ยังไม่มีแหล่งข้อมูล หน้าเว็บแสดงว่ายังไม่เปิดใช้งาน และไม่เรียกข้อมูลใด ๆ
(function (root) {
  const SECTIONS = Object.freeze([
    Object.freeze({ key: "dashboard", label: "แดชบอร์ด", ready: true }),
    Object.freeze({ key: "chemical", label: "เปรียบเทียบเคมี", ready: false }),
    Object.freeze({ key: "mooney", label: "Mooney test report", ready: true }),
    Object.freeze({ key: "mdr", label: "MDR test report", ready: false }),
  ]);
  const DEFAULT = "dashboard";

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const find = (key) => SECTIONS.find((section) => section.key === key) ?? null;

  // โมดูลจาก query string: ไม่ระบุ = แดชบอร์ด (หรือ Mooney ถ้าเป็นลิงก์วัสดุแบบเดิม) ระบุค่าที่ไม่มีจริง = null (หน้า "ไม่พบ")
  function readSection(params) {
    const key = params?.get?.("module");
    if (key === null || key === undefined || key === "") return params?.get?.("material") ? "mooney" : DEFAULT;
    return find(key)?.key ?? null;
  }

  function sectionUrl(key) {
    const section = find(key);
    return !section || section.key === DEFAULT ? "#/lab" : `#/lab?module=${encodeURIComponent(section.key)}`;
  }

  function navHtml(active) {
    const links = SECTIONS.map((section) => {
      const current = section.key === active;
      return `<a class="filter${current ? " active" : ""}" href="${esc(sectionUrl(section.key))}"${current ? ` aria-current="page"` : ""}>${esc(section.label)}</a>`;
    }).join("");
    return `<nav class="filters lab-modules" aria-label="โมดูล MNP LAB">${links}</nav>`;
  }

  // หัวหน้าของแต่ละโมดูล: แถบเลือกโมดูล + ส่วนท้ายของหัว (เช่น เวลาอ่านชีตกับปุ่มรีเฟรช)
  function headHtml(active, extra = "") {
    const section = find(active);
    return `<div class="lab-head">
        <h1 class="sr-only">${esc(section?.label ?? "MNP LAB")}</h1>
        ${navHtml(active)}
        ${extra}
      </div>`;
  }

  // ชื่อโมดูลอยู่ที่แถบเลือกแล้ว ข้อความในหน้าจึงบอกเฉพาะสถานะ
  function notReadyPage(key) {
    return `<div class="lab-page">
      ${headHtml(key)}
      <section class="card"><div class="empty"><h2>ยังไม่เปิดใช้งาน</h2><p>ยังไม่ได้เชื่อมแหล่งข้อมูลของโมดูลนี้</p></div></section>
    </div>`;
  }

  const api = { SECTIONS, DEFAULT, readSection, sectionUrl, isReady: (key) => find(key)?.ready === true, navHtml, headHtml, notReadyPage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_SECTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
