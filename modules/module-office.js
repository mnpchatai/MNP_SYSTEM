// โมดูล "ระบบสำนักงาน" ของ Pilot Web (#/office) — เมนูซ้ายต่อจาก MNP LAB
// เปิดแล้วเจอการ์ด IT SUPPORT กับ HR · IT SUPPORT มีใบแจ้งซ่อม IT กับใบสั่งงาน IT (หน้าจริงอยู่ที่ modules/module-itwo.js) · HR ยังไม่เปิด
// รายการ ลำดับ และ HTML ของหน้าอยู่ที่ office-sections.js ไฟล์นี้ดูแลเฉพาะการเชื่อมต่อ: ลงทะเบียนเมนู สิทธิ์ และหาประเภทคำร้องของใบแจ้งซ่อม IT
//
// เป็นโมดูลแยก (standalone: true) เหมือน MNP LAB: มีเมนูของตัวเอง ไม่อยู่ในศูนย์คำร้อง
// โหมดทดสอบ (sandbox: true): เปิดเฉพาะเส้นทาง ระบบสำนักงาน › IT SUPPORT › ใบสั่งงาน IT เท่านั้น (modeAllowed ด้านล่างซ่อนใบแจ้งซ่อม IT และ HR ในโหมดนี้ตามเดิม)
// บัญชี lab-only ไม่เห็นเมนู (modules/lab-only-access.js ไม่มีรหัส OFFICE) และแผนกที่จำกัดโมดูลต้องมี OFFICE ในรายการอนุญาต (modules/department-access.js)
// OFFICE ในรายการอนุญาตแค่เปิดเมนู/หน้า hub ให้เข้าได้ — แต่ละการ์ดกรองตามรหัสโมดูลของตัวเอง (IT_REPAIR, IT_WORK_ORDER, HR) ด้วย deptModuleAllowed
// แผนกที่ไม่เหลือการ์ดใดเลยไม่เห็นเมนู และเข้า URL ของระบบที่ไม่มีสิทธิ์ (เช่น ?module=hr) ถูกพากลับหน้าหลักเหมือนหน้าของโมดูลอื่น
//
// ใบแจ้งซ่อม IT (IT_REPAIR) ยังเป็นโมดูลคำร้องกลางทุกอย่าง (รายการ ฟอร์ม แจ้งเตือน ลิงก์เก่า) การ์ดที่นี่แค่พาไปหน้ารายการเดิม #/requests?type=<id>
// ส่วนการ์ดบนหน้าภาพรวม "คำร้อง" ถูกซ่อนด้วยแฟลก hideFromOverview ใน module-it.js
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, renderNotFound, go,
// deptModuleAllowed, requestTypeCounts, queueModuleZoom, zoomIntoContent) เฉพาะตอนเปิดหน้า/ตอนผู้ใช้กด ไม่เรียกตอนโหลดไฟล์
(function registerOfficeModule() {
  const sections = window.MNP_OFFICE_SECTIONS;
  if (!sections) return;

  const PATH = "office";
  const TITLE = "ระบบสำนักงาน";
  const NAV_ICON = window.MNP_UI_ICONS?.icon("building") ?? "";

  let pageVersion = 0; // หน้าเก่าที่โหลดช้ากว่าหน้าใหม่ต้องไม่วาดทับ
  let zoomTo = null;

  // โหมดทดสอบของ admin: เหลือเฉพาะใบสั่งงาน IT (ฐานข้อมูลแยกข้อมูลทดสอบให้แล้ว) ใบแจ้งซ่อม IT และ HR ยังซ่อนเหมือนเดิม
  // isSandboxMode เป็นของ app.js (อ้างตอนเรียกใช้เท่านั้น)
  const inSandbox = () => typeof isSandboxMode === "function" && isSandboxMode();
  const modeAllowed = (code) => deptModuleAllowed(code) && (!inSandbox() || code === sections.WORK_ORDER_CODE);

  // การ์ดใบแจ้งซ่อม IT: แสดงเมื่อแผนกมีสิทธิ์ IT_REPAIR และฐานข้อมูลเปิดประเภทคำร้องนี้อยู่ (RPC สร้างคำร้องตรวจซ้ำเองอีกชั้น)
  // นับใบที่ยังไม่จบแบบเดียวกับการ์ดเดิมบนหน้าคำร้อง ถ้านับไม่ได้แสดงแค่ "ดูสถานะ" ไม่ให้หน้าล้มเพราะตัวเลข
  async function loadRepairCard() {
    const entry = window.MNP_REQUEST_MODULES?.IT_REPAIR;
    if (!entry?.enabled || !modeAllowed("IT_REPAIR")) return null;
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
    // ระบบที่แผนกนี้ไม่มีสิทธิ์ (หรือไม่เหลือระบบใดเลย) พากลับหน้าหลักเหมือน routeAllowed ของหน้าโมดูลอื่น ก่อนเรียกข้อมูลใด ๆ
    // หน้าใบสั่งงาน IT (ย่อยของ IT SUPPORT) ดูจากรหัสโมดูล IT_WORK_ORDER ของมันเอง · โหมดทดสอบพากลับหน้าเลือกระบบ (หน้าหลักไม่อยู่ในโหมดนี้)
    const visible = sections.visibleSections(modeAllowed);
    const hidden = section === sections.HOME ? visible.length === 0
      : section === sections.WORK_ORDER ? !sections.workOrderVisible(modeAllowed)
        : !visible.some((item) => item.key === section);
    if (hidden) {
      go(inSandbox() && visible.length ? "office" : "dashboard");
      return;
    }
    if (section === sections.WORK_ORDER) return window.MNP_ITWO.render(params);
    if (section === sections.HOME) return paint(sections.chooserPage({ allowed: modeAllowed }), TITLE, version);
    if (section === "it-support") {
      loadingShell(PATH, TITLE);
      // ตัวเลขงานที่รอฉันบนการ์ดใบสั่งงาน IT อ่านขนานกับการ์ดใบแจ้งซ่อม ถ้าอ่านไม่ได้การ์ดยังกดเข้าได้ ไม่ทำให้หน้าล้ม
      const [repair, workOrder] = await Promise.all([
        loadRepairCard(),
        sections.workOrderVisible(modeAllowed) ? window.MNP_ITWO.loadCardSummary().catch(() => null) : null,
      ]);
      return paint(sections.itSupportPage({ repair, workOrder, allowed: modeAllowed }), "IT SUPPORT", version);
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
    // โหมดทดสอบ: เห็นเมนูนี้เพื่อเข้าใบสั่งงาน IT เท่านั้น (route ที่ไม่ใช่ใบสั่งงาน IT พากลับหน้าเลือกระบบใน renderOffice)
    sandbox: true,
    // ผู้ใช้ที่ล็อกอินแล้วเห็นเมนูนี้ เมื่อมีระบบในเมนูให้เห็นอย่างน้อย 1 ระบบตามสิทธิ์แผนก (แผนก ID เหลือ IT SUPPORT)
    // การซ่อนตามบัญชี lab-only ทำที่ requestModuleNavLinks ของ app.js
    navAllowed: (employee) => Boolean(employee) && sections.hasVisibleSection(modeAllowed),
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON }],
    pages: { [PATH]: renderOffice },
  };
})();
