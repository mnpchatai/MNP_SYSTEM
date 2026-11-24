// โมดูล "ระบบสำนักงาน" ของ Pilot Web (#/office) — เมนูซ้ายต่อจาก MNP LAB
// เปิดแล้วเจอการ์ด IT SUPPORT กับ HR · IT SUPPORT มีใบแจ้งซ่อม IT (หน้าจริงอยู่ที่ modules/module-itrp.js) กับใบสั่งงาน IT (modules/module-itwo.js) · HR ยังไม่เปิด
// รายการ ลำดับ และ HTML ของหน้าอยู่ที่ office-sections.js ไฟล์นี้ดูแลเฉพาะการเชื่อมต่อ: ลงทะเบียนเมนู สิทธิ์ และข้อมูลบนการ์ด
//
// เป็นโมดูลแยก (standalone: true) เหมือน MNP LAB: มีเมนูของตัวเอง ไม่อยู่ในศูนย์คำร้อง
// โหมดทดสอบ (sandbox: true): เปิดเฉพาะเส้นทาง ระบบสำนักงาน › IT SUPPORT › ใบแจ้งซ่อม IT / ใบสั่งงาน IT เท่านั้น (modeAllowed ด้านล่างซ่อน HR ในโหมดนี้ตามเดิม)
// บัญชี lab-only ไม่เห็นเมนู (modules/lab-only-access.js ไม่มีรหัส OFFICE) และแผนกที่จำกัดโมดูลต้องมี OFFICE ในรายการอนุญาต (modules/department-access.js)
// OFFICE ในรายการอนุญาตแค่เปิดเมนู/หน้า hub ให้เข้าได้ — แต่ละการ์ดกรองตามรหัสโมดูลของตัวเอง (IT_COMPUTER_REPAIR, IT_WORK_ORDER, HR) ด้วย deptModuleAllowed
// แผนกที่ไม่เหลือการ์ดใดเลยไม่เห็นเมนู และเข้า URL ของระบบที่ไม่มีสิทธิ์ (เช่น ?module=hr) ถูกพากลับหน้าหลักเหมือนหน้าของโมดูลอื่น
//
// ใบแจ้งซ่อม IT บนการ์ดตอนนี้คือโมดูล itrp (ใบแจ้งซ่อมคอมพิวเตอร์ ตารางและ RPC ของตัวเอง) ไม่ใช่โมดูลคำร้องกลาง IT_REPAIR อีกต่อไป
// โมดูล IT_REPAIR เดิมยังอยู่ครบ (ลิงก์เก่า แจ้งเตือนเก่า) เพียงไม่มีการ์ดชี้ไป และการ์ดบนหน้าภาพรวม "คำร้อง" ยังซ่อนด้วยแฟลก hideFromOverview ใน module-it.js
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, renderNotFound, go,
// deptModuleAllowed, zoomIntoContent) เฉพาะตอนเปิดหน้า/ตอนผู้ใช้กด ไม่เรียกตอนโหลดไฟล์
(function registerOfficeModule() {
  const sections = window.MNP_OFFICE_SECTIONS;
  if (!sections) return;

  const PATH = "office";
  const TITLE = "ระบบสำนักงาน";
  const NAV_ICON = window.MNP_UI_ICONS?.icon("building") ?? "";

  let pageVersion = 0; // หน้าเก่าที่โหลดช้ากว่าหน้าใหม่ต้องไม่วาดทับ
  let zoomTo = null;

  // โหมดทดสอบของ admin: เหลือเฉพาะใบแจ้งซ่อม IT กับใบสั่งงาน IT (ฐานข้อมูลแยกข้อมูลทดสอบให้แล้ว) HR ยังซ่อนเหมือนเดิม
  // isSandboxMode เป็นของ app.js (อ้างตอนเรียกใช้เท่านั้น)
  const inSandbox = () => typeof isSandboxMode === "function" && isSandboxMode();
  // ทะเบียนอุปกรณ์ IT (IT_ASSET_REGISTER): นอกจากสิทธิ์แผนก ต้องเป็นผู้อยู่ใน allowlist ของโมดูล (window.MNP_ITAS.hasAccess = ผลของ app_itas_my_access ที่ resolveAccess ตรวจก่อนวาดหน้า) · ไม่มีผล/ล้ม = ซ่อน
  const modeAllowed = (code) => deptModuleAllowed(code)
    && (!inSandbox() || code === sections.WORK_ORDER_CODE || code === sections.REPAIR_CODE || code === sections.ASSET_CODE)
    && (code !== sections.ASSET_CODE || Boolean(window.MNP_ITAS?.hasAccess?.()));

  // การ์ดของโมดูลที่ประกาศตัวเองใน window.MNP_OFFICE_CARDS[<รหัสโมดูล>] = { version, loadCardSummary } (วิธีเพิ่มโมดูลใหม่ดูหัวไฟล์ office-sections.js)
  // คืน { <รหัสโมดูล>: { version, inDevelopment, openCount, waiting, title } } (inDevelopment = ป้าย "กำลังพัฒนา" การ์ดยังกดเข้าได้) เฉพาะการ์ดที่ผู้ใช้เห็น (สิทธิ์แผนก/โหมดทดสอบ) · ไม่ประกาศ = ไม่มีรายการ การ์ดไม่แสดงป้าย
  // loadCardSummary ล้ม/คืน null = openCount เป็น null (การ์ดแสดง "ดูสถานะ") · โมดูลที่ไม่มี loadCardSummary = ไม่มีป้ายตัวเลข
  // การ์ดทะเบียนอุปกรณ์ IT (ประกาศแค่เลขเวอร์ชัน/ป้ายกำลังพัฒนา ไม่มีตัวเลขงาน) เก็บข้อมูลไว้ก่อนโดยไม่รอผลสิทธิ์ · การแสดงจริงตัดสินที่ itSupportPage ด้วย modeAllowed (ไม่มีสิทธิ์ = ไม่แสดงการ์ด)
  const poolAllowed = (code) => (code === sections.ASSET_CODE ? deptModuleAllowed(code) : modeAllowed(code));
  async function loadDeclaredCards() {
    const declared = window.MNP_OFFICE_CARDS ?? {};
    const entries = await Promise.all(sections.visibleCards(poolAllowed).filter((card) => declared[card.code]).map(async (card) => {
      const provider = declared[card.code];
      const info = { version: provider.version || undefined, inDevelopment: Boolean(provider.inDevelopment) };
      if (typeof provider.loadCardSummary === "function") {
        const summary = await Promise.resolve().then(() => provider.loadCardSummary()).catch(() => null);
        info.openCount = Number.isFinite(summary?.openCount) ? summary.openCount : null;
        info.waiting = summary?.badge || "";
        info.title = summary?.title || "";
      }
      return [card.code, info];
    }));
    return Object.fromEntries(entries);
  }

  function paint(html, title, version) {
    if (version !== pageVersion) return;
    const zoom = zoomTo !== null && zoomTo === location.hash;
    zoomTo = null;
    app.innerHTML = shell(html, PATH, title);
    bindShell();
    document.querySelectorAll(".lab-module-card[href]").forEach((card) => card.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      zoomTo = card.hash; // การ์ดทุกใบในเมนูนี้ชี้ไปหน้า #/office?... ของตัวเอง (ไม่มีการ์ดไปหน้ารายการคำร้องแล้ว)
    }));
    if (zoom) zoomIntoContent();
  }

  async function renderOffice(params) {
    pageVersion += 1;
    const version = pageVersion;
    const section = sections.readSection(params);
    if (!section) return renderNotFound(); // ?module= ที่ไม่มีจริง = URL ที่ไม่มีอยู่
    // สิทธิ์ทะเบียนอุปกรณ์ IT ตรวจที่ฐานข้อมูล (app_itas_my_access) · เรียกเฉพาะหน้าที่เกี่ยวกับการ์ดนี้ และเฉพาะแผนกที่การ์ดนี้ไม่ถูกจำกัดไว้ · ผลเก็บไว้ในโมดูล itas (ต่อผู้ใช้/โหมด/persona 10 นาที ล้างเมื่อออกจากระบบ) ไม่ยิงซ้ำทุกครั้งที่เปิดเมนู
    // หน้าทะเบียน (ASSETS) และหน้าที่ทะเบียนเป็นการ์ดเดียวที่แผนกนี้มี ต้องรู้ผลก่อนตัดสินว่าเปิดได้ไหม จึงรอ (ส่วนใหญ่มีผลเก็บไว้แล้ว ไม่เสียเวลา)
    // หน้า IT SUPPORT ที่มีการ์ดอื่นอยู่แล้วไม่รอก่อนวาด: ขอสิทธิ์ขนานกับการโหลดตัวเลขบนการ์ด · หน้าเลือกระบบไม่แสดงการ์ดทะเบียน จึงไม่ต้องขอเลยถ้ามีระบบอื่นให้เห็น
    const itas = window.MNP_ITAS;
    const assetCheckAllowed = deptModuleAllowed(sections.ASSET_CODE);
    const assetDecidesPage = assetCheckAllowed && sections.visibleSections((code) => code !== sections.ASSET_CODE && modeAllowed(code)).length === 0;
    let accessCheck = null;
    if (assetCheckAllowed && (section === sections.ASSETS || (assetDecidesPage && [sections.HOME, "it-support"].includes(section)))) {
      await itas?.resolveAccess?.();
      if (version !== pageVersion) return; // ผู้ใช้ไปหน้าอื่นระหว่างรอ: ห้ามทำส่วนที่เหลือกับหน้าที่ออกไปแล้ว
    } else if (assetCheckAllowed && section === "it-support") {
      accessCheck = Promise.resolve(itas?.resolveAccess?.()).catch(() => false);
    }
    // ตรวจสิทธิ์ไม่ได้ชั่วคราว (เน็ตหลุด) ที่หน้าทะเบียน: ให้โมดูลแสดง "ตรวจสิทธิ์ไม่ได้ ลองใหม่" แทนการเด้งกลับเงียบ ๆ (ไม่มีสิทธิ์จริง = เด้งตามเดิมข้างล่าง)
    if (section === sections.ASSETS && assetCheckAllowed && itas?.accessStatus?.() === "error") return itas.render(params);
    // ระบบที่แผนกนี้ไม่มีสิทธิ์ (หรือไม่เหลือระบบใดเลย) พากลับหน้าหลักเหมือน routeAllowed ของหน้าโมดูลอื่น ก่อนเรียกข้อมูลใด ๆ
    // หน้าใบแจ้งซ่อม IT / ใบสั่งงาน IT (ย่อยของ IT SUPPORT) ดูจากรหัสโมดูล IT_COMPUTER_REPAIR / IT_WORK_ORDER ของมันเอง · โหมดทดสอบพากลับหน้าเลือกระบบ (หน้าหลักไม่อยู่ในโหมดนี้)
    const visible = sections.visibleSections(modeAllowed);
    const hidden = section === sections.HOME ? visible.length === 0
      : section === sections.WORK_ORDER ? !sections.workOrderVisible(modeAllowed)
        : section === sections.REPAIR ? !sections.repairVisible(modeAllowed)
          : section === sections.ASSETS ? !sections.assetsVisible(modeAllowed)
            : !visible.some((item) => item.key === section);
    if (hidden) {
      go(inSandbox() && visible.length ? "office" : "dashboard");
      return;
    }
    if (section === sections.WORK_ORDER) return window.MNP_ITWO.render(params);
    if (section === sections.REPAIR) return window.MNP_ITRP.render(params);
    if (section === sections.ASSETS) return window.MNP_ITAS.render(params);
    if (section === sections.HOME) return paint(sections.chooserPage({ allowed: modeAllowed }), TITLE, version);
    if (section === "it-support") {
      loadingShell(PATH, TITLE);
      // ข้อมูลบนการ์ดของโมดูลที่ประกาศตัวเองไว้ (เลขเวอร์ชัน จำนวนที่ยังไม่จบ ป้ายรอง) ถ้าอ่านไม่ได้การ์ดยังกดเข้าได้ ไม่ทำให้หน้าล้ม
      const modules = await loadDeclaredCards();
      if (accessCheck) await accessCheck; // ขอสิทธิ์ไปพร้อมกับตัวเลขบนการ์ด ไม่ต่อคิวกัน (paint ตรวจรุ่นหน้าให้อยู่แล้ว)
      return paint(sections.itSupportPage({ modules, allowed: modeAllowed }), "IT SUPPORT", version);
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
