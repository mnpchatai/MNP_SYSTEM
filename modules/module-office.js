// โมดูล "ระบบสำนักงาน" ของ Pilot Web (#/office) — เมนูซ้ายต่อจาก MNP LAB
// เปิดแล้วเจอการ์ด IT SUPPORT กับ HR · IT SUPPORT มีใบแจ้งซ่อม IT (ใบสั่งงาน IT กำลังย้ายระบบ) · HR ยังไม่เปิด
// รายการ ลำดับ และ HTML ของหน้าอยู่ที่ office-sections.js ไฟล์นี้ดูแลเฉพาะการเชื่อมต่อ: ลงทะเบียนเมนู สิทธิ์ และหาประเภทคำร้องของใบแจ้งซ่อม IT
//
// เป็นโมดูลแยก (standalone: true) เหมือน MNP LAB: มีเมนูของตัวเอง ไม่อยู่ในศูนย์คำร้อง และไม่รองรับโหมดทดสอบ (ไม่ประกาศ sandbox)
// บัญชี lab-only ไม่เห็นเมนู (modules/lab-only-access.js ไม่มีรหัส OFFICE) และแผนกที่จำกัดโมดูลต้องมี OFFICE ในรายการอนุญาต (modules/department-access.js)
//
// ใบแจ้งซ่อม IT (IT_REPAIR) ยังเป็นโมดูลคำร้องกลางทุกอย่าง (รายการ ฟอร์ม แจ้งเตือน ลิงก์เก่า) การ์ดที่นี่แค่พาไปหน้ารายการเดิม #/requests?type=<id>
// ส่วนการ์ดบนหน้าภาพรวม "คำร้อง" ถูกซ่อนด้วยแฟลก hideFromOverview ใน module-it.js
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, renderNotFound,
// deptModuleAllowed, requestTypeCounts, queueModuleZoom, zoomIntoContent) เฉพาะตอนเปิดหน้า/ตอนผู้ใช้กด ไม่เรียกตอนโหลดไฟล์
(function registerOfficeModule() {
  const sections = window.MNP_OFFICE_SECTIONS;
  if (!sections) return;

  const PATH = "office";
  const TITLE = "ระบบสำนักงาน";
  const NAV_ICON = window.MNP_UI_ICONS?.icon("building") ?? "";

  let pageVersion = 0; // หน้าเก่าที่โหลดช้ากว่าหน้าใหม่ต้องไม่วาดทับ
  let zoomTo = null;

  // การ์ดใบแจ้งซ่อม IT: แสดงเมื่อแผนกมีสิทธิ์ IT_REPAIR และฐานข้อมูลเปิดประเภทคำร้องนี้อยู่ (RPC สร้างคำร้องตรวจซ้ำเองอีกชั้น)
  // นับใบที่ยังไม่จบแบบเดียวกับการ์ดเดิมบนหน้าคำร้อง ถ้านับไม่ได้แสดงแค่ "ดูสถานะ" ไม่ให้หน้าล้มเพราะตัวเลข
  async function loadRepairCard() {
    const entry = window.MNP_REQUEST_MODULES?.IT_REPAIR;
    if (!entry?.enabled || !deptModuleAllowed("IT_REPAIR")) return null;
    const { data, error } = await sb.from("request_types").select("id,code").eq("code", "IT_REPAIR").eq("is_active", true).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    let count = null;
    try {
      count = (await requestTypeCounts([data], false)).get(data.id) ?? null;
    } catch { /* นับไม่ได้ก็ยังเปิดรายการได้ */ }
    return { href: window.MNP_REQUEST_CENTER.url(new URLSearchParams(), { type: data.id }), count };
  }

  function paint(html, title, version) {
    if (version !== pageVersion) return;
    const zoom = zoomTo !== null && zoomTo === location.hash;
    zoomTo = null;
    app.innerHTML = shell(html, PATH, title);
    bindShell();
    document.querySelectorAll(".lab-module-card[href]").forEach((card) => card.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (card.hash.startsWith("#/requests")) queueModuleZoom(card.hash); // หน้ารายการเล่นเอฟเฟกต์เข้าโมดูลเอง
      else zoomTo = card.hash;
    }));
    if (zoom) zoomIntoContent();
  }

  async function renderOffice(params) {
    pageVersion += 1;
    const version = pageVersion;
    const section = sections.readSection(params);
    if (!section) return renderNotFound(); // ?module= ที่ไม่มีจริง = URL ที่ไม่มีอยู่
    if (section === sections.HOME) return paint(sections.chooserPage(), TITLE, version);
    if (section === "it-support") {
      loadingShell(PATH, TITLE);
      const repair = await loadRepairCard();
      return paint(sections.itSupportPage({ repair }), "IT SUPPORT", version);
    }
    return paint(sections.notReadyPage(section), TITLE, version);
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.OFFICE = {
    code: "OFFICE",
    enabled: true,
    standalone: true,
    label: TITLE,
    palette: "st",
    // ผู้ใช้ทุกคนที่เห็นเมนูคำร้องเห็นเมนูนี้ การซ่อนตามแผนก/บัญชี lab-only/โหมดทดสอบทำที่ requestModuleNavLinks ของ app.js
    navAllowed: (employee) => Boolean(employee),
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON }],
    pages: { [PATH]: renderOffice },
  };
})();
