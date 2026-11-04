// ไอคอนเส้นชุดเดียวของ Pilot (viewBox 24, เส้น 1.8 ตามสี currentColor ผ่าน .ui-icon ใน styles.css) แทนอีโมจิและอักขระพิเศษ
// โหลดก่อนโมดูลอื่นและ app.js (index.html) — app.js ใช้ผ่าน uiIcon(), RubberFlow/BOM ใช้ผ่าน window.MNP_UI_ICONS ตอนวาด
// (หน้า /harness/ แทน app.js ด้วย stub จึงต้องอยู่ไฟล์แยก ไม่ใช่ใน app.js) เทสต์ที่ scripts/tests/ui-icons.test.mjs
(function (root) {
  const PATHS = Object.freeze({
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    document: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    approve: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 9.8"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    signout: '<path d="M9 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H9"/><path d="m15 16 4-4-4-4M19 12H9"/>',
    theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    building: '<path d="M4 21V5.5L12 3v18M12 8h8v13M2 21h20M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
    inbox: '<path d="M3 13.5 5.6 5.4A1.5 1.5 0 0 1 7 4.5h10a1.5 1.5 0 0 1 1.4.9L21 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>',
    // ประเภทคำร้อง/โมดูล (TYPE_ICONS ด้านล่าง)
    wrench: '<path d="M14.5 3.5a5 5 0 0 0-4.3 6.8l-6.4 6.4a2 2 0 0 0 2.8 2.8l6.4-6.4a5 5 0 0 0 6.8-4.3l-3.4-.9-.9-3.4z"/>',
    tag: '<path d="M3.5 4.5v6.4a1.5 1.5 0 0 0 .44 1.06l8.6 8.6a1.5 1.5 0 0 0 2.12 0l6.3-6.3a1.5 1.5 0 0 0 0-2.12l-8.6-8.6A1.5 1.5 0 0 0 11.3 3H5a1.5 1.5 0 0 0-1.5 1.5z"/><circle cx="8" cy="8" r="1.5"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16v4"/>',
    stamp: '<path d="M12 3a2.5 2.5 0 0 0-2.5 2.5c0 1.6 1 2.4 1 4V13h3V9.5c0-1.6 1-2.4 1-4A2.5 2.5 0 0 0 12 3z"/><path d="M5 14.5A1.5 1.5 0 0 1 6.5 13h11a1.5 1.5 0 0 1 1.5 1.5V17H5z"/><path d="M6 20.5h12"/>',
    "clipboard-check": '<rect x="5" y="4.5" width="14" height="16.5" rx="1.5"/><path d="M9 4.5V3h6v1.5"/><path d="m9 13 2 2 4-4"/>',
    "test-tube": '<path d="M8.5 3h7M10 3v14.5a2 2 0 0 0 4 0V3M10 13h4"/>',
    factory: '<path d="M3 21V10l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 17h2M12 17h2"/>',
    layers: '<path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
    // ช่องข้อมูลในหน้ารายละเอียดคำร้อง (requestFact)
    flag: '<path d="M5 21V4"/><path d="M5 4.5h12l-2.5 4 2.5 4H5"/>',
    machine: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="1.5"/><path d="M9 4.5V3h6v1.5"/><path d="M9 11h6M9 15h6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    // โทนแจ้งเตือนและหน้าของ RubberFlow/BOM
    error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    warning: '<path d="M10.7 4.2 2.9 17.8A1.5 1.5 0 0 0 4.2 20h15.6a1.5 1.5 0 0 0 1.3-2.2L13.3 4.2a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 9.5V14M12 17h.01"/>',
    dashboard: '<rect x="3.5" y="3.5" width="7" height="9" rx="1"/><rect x="13.5" y="3.5" width="7" height="5" rx="1"/><rect x="13.5" y="11.5" width="7" height="9" rx="1"/><rect x="3.5" y="15.5" width="7" height="5" rx="1"/>',
    flask: '<path d="M9 3h6M10 3v6.5L4.6 18.8A1.5 1.5 0 0 0 5.9 21h12.2a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3"/><path d="M7.2 15h9.6"/>',
    scale: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="m5 7-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
    mix: '<circle cx="12" cy="12" r="9"/><path d="M12 3a4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0 9"/>',
    ruler: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
    flame: '<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4.5-3.5-6.5-4.5-11.5-2.5 2-4 4.5-4 7.5-1.2-.6-2-1.8-2.2-3.3C5.8 9.6 5.5 12 5.5 14.5A6.5 6.5 0 0 0 12 21z"/>',
    cycle: '<path d="M20 11.5A8 8 0 0 0 5.6 7"/><path d="M5 3.5v4h4"/><path d="M4 12.5A8 8 0 0 0 18.4 17"/><path d="M19 20.5v-4h-4"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    chart: '<path d="M3.5 3.5v17h17"/><path d="m7.5 15 4-4 3 3 5-6"/>',
    warehouse: '<path d="M3 20.5v-12L12 4l9 4.5v12"/><path d="M7 20.5v-8h10v8M7 16.5h10"/>',
    mold: '<rect x="3.5" y="4" width="17" height="6" rx="1"/><rect x="3.5" y="14" width="17" height="6" rx="1"/><path d="M9 10v4M15 10v4"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4l3 2"/>',
    download: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 15v4.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
    camera: '<path d="M8.5 6 10 4h4l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.5"/>',
    hash: '<path d="M9.5 3.5l-2 17M16.5 3.5l-2 17M4.5 9h16M3.5 15h16"/>',
    tree: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c1 0 1.6-.7 1.6-1.6 0-1.1-.9-1.5-.9-2.5 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><path d="M7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01"/>',
  });

  // ไอคอนประจำประเภทคำร้อง/โมดูลตาม request_types.code — ประเภทที่ไม่อยู่ในรายการใช้ไอคอนเอกสาร
  const TYPE_ICONS = Object.freeze({
    MT_REPAIR: "wrench",
    NCR_CAR: "tag",
    IT_REPAIR: "monitor",
    MANAGEMENT: "stamp",
    QC: "clipboard-check",
    MNP_LAB: "test-tube",
    RUBBERFLOW: "factory",
    BOM: "layers",
  });

  const icon = (name) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
  const typeIconName = (code) => TYPE_ICONS[code] ?? "document";
  const typeIcon = (code) => icon(typeIconName(code));

  const api = Object.freeze({ PATHS, TYPE_ICONS, icon, typeIconName, typeIcon });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_UI_ICONS = api;
})(typeof window !== "undefined" ? window : globalThis);
