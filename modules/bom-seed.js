// BOM รายแผนก (โหมดทดสอบ) — ข้อมูลสาธิตสมมติทั้งชุด: บทบาท 12 คน สูตรยาง item master BOM อนุมัติ ใบสั่งผลิต งานรายแผนก คลังแท่งยาว (SR) แปรรูปยาง (GR)
// และขั้นตอนรายแผนกของ PT / BG / PK พร้อมการส่งงาน PT / BG → PK · PK → WH (โรงงาน ขั้น 7)
// รหัส/ชื่อเลียนโครงสร้างจริงของชีต DATA BOM (FG → SE → RB · FG → PT → เม็ดพลาสติก · FG → BG → ผ้า/ซิป) แต่เป็นรหัส DEMO ไม่ใช่ข้อมูลลูกค้า
// ประวัติสร้างโดยเรียก action จริงของ modules/bom-actions.js จึงสอดคล้องกันเอง (ผลเหมือนกันทุกครั้งเมื่อ now เท่ากัน)
// โหลดหลัง modules/bom-rules.js และ bom-actions.js (ใน Node ตั้ง globalThis.MNP_BOM_RULES/_ACTIONS ก่อน require)
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const rules = () => root.MNP_BOM_RULES;
  const actions = () => root.MNP_BOM_ACTIONS;

  const USERS = Object.freeze([
    { id: "B01", role: "admin", dept: "AD", name: "ปกรณ์ ศรีวัฒนา" },
    { id: "B02", role: "manager", dept: "FT", name: "อรุณี ทองประเสริฐ" },
    { id: "B03", role: "planner", dept: "PK", name: "ณัฐพล บุญมา" },
    { id: "B04", role: "rb", dept: "RB", name: "วีระ คงดี" },
    { id: "B05", role: "gr", dept: "GR", name: "สุนทร ใจงาม" },
    { id: "B06", role: "pt", dept: "PT", name: "มานพ ศักดิ์ดี" },
    { id: "B07", role: "bg", dept: "BG", name: "จันทร์เพ็ญ ดวงแก้ว" },
    { id: "B08", role: "st", dept: "ST", name: "สมศักดิ์ แก้วใส" },
    { id: "B09", role: "wh", dept: "WH", name: "สุดา คลังสินค้า" },
    { id: "B10", role: "manager", dept: "WH", name: "ประเสริฐ ผู้จัดการคลังสินค้า" },
    // คลังแท่งยาว (SR) รับแท่งเข้าคลังและจ่ายให้ GR · ตรวจคุณภาพ (QA) ตัดสินล็อตที่กัก
    { id: "B11", role: "sr", dept: "SR", name: "ศิริ รับมอบ" },
    { id: "B12", role: "qa", dept: "QA", name: "ธนา ตรวจสอบ" },
  ].map((user) => Object.freeze(user)));

  // สูตรยางสาธิต: DM01/DM02 ผูกกับสูตร PHR ของชุดสาธิต RubberFlow (rubberflow-seed.js) DM03 ยังไม่ผูก
  const COMPOUNDS = Object.freeze([
    { code: "DM01", name: "EPDM ส้ม 60 Shore A", recipeId: "RC-EPDM-DS01", recipeName: "EPDM ซีลประตูรถยนต์ Rev.3" },
    { code: "DM02", name: "NBR ดำ 70 Shore A", recipeId: "RC-NBR-OR02", recipeName: "NBR โอริงทนน้ำมัน Rev.2" },
    { code: "DM03", name: "NR เหลือง แผ่น", recipeId: null, recipeName: null },
  ]);

  // item master สาธิต (uom = รหัสใน rules.UOMS)
  const ITEMS = Object.freeze([
    // ของซื้อ (ST)
    { code: "P-BOX-01", kind: "PURCHASED", name: "กล่องนอก 40 × 60 × 30 ซม. (ลัง 40 ชุด)", uom: "box" },
    { code: "P-STK-01", kind: "PURCHASED", name: "สติ๊กเกอร์ CE บาร์โค้ด", uom: "pcs" },
    { code: "P-BAG-01", kind: "PURCHASED", name: "ถุงพลาสติก IPP 9 × 13 นิ้ว (112 ชิ้น/กก.)", uom: "kg" },
    { code: "P-PEL-BK", kind: "PURCHASED", name: "เม็ดพลาสติก PE-LD สีดำ", uom: "kg" },
    { code: "P-FAB-BL", kind: "PURCHASED", name: "ผ้าตาข่ายสีฟ้า หน้ากว้าง 60 นิ้ว", uom: "yd" },
    { code: "P-ZIP-05", kind: "PURCHASED", name: "ผ้าซิป No.5 สีฟ้า", uom: "m" },
    { code: "P-ROPE-01", kind: "PURCHASED", name: "เชือกถัก PP No.6", uom: "kg" },
    // เส้นยาง (RB): น้ำหนักต่อเส้น ความยาวตัด ชิ้นที่ตัดได้ต่อเส้น SE ต่อ 1 GR
    { code: "RB-DM01-02-OR01-202-18-70", kind: "RB", name: "ยางกลมมีรู ตัวตอปิโด ส้ม OR01 Ø70 รู 18", uom: "rod", weightG: 1530, rubber: { compound: "DM01", type: "02", color: "OR01", lengthMm: 202, holeMm: 18, odMm: 70, kgPerRoll: 1.53, cutLengthCm: 6.5, pcsPerRoll: 31, sePerGr: 1 } },
    { code: "RB-DM01-01-OR01-200-0-72", kind: "RB", name: "ยางกลมตัน หัวตอปิโด ส้ม OR01 Ø72", uom: "rod", weightG: 1405, rubber: { compound: "DM01", type: "01", color: "OR01", lengthMm: 200, holeMm: 0, odMm: 72, kgPerRoll: 1.405, cutLengthCm: 4, pcsPerRoll: 50, sePerGr: 1 } },
    { code: "RB-DM02-02-BK01-225-3-20", kind: "RB", name: "ยางกลมมีรู 3 ร่อง แกนหางตอปิโด ดำ BK01 Ø20", uom: "rod", weightG: 170, rubber: { compound: "DM02", type: "02", color: "BK01", lengthMm: 225, holeMm: 3, odMm: 20, kgPerRoll: 0.17, cutLengthCm: 14, pcsPerRoll: 14, sePerGr: 1 } },
    { code: "RB-DM03-03-YE03-3000-3-130", kind: "RB", name: "ยางแผ่นปีกตอปิโด เหลือง YE03 หนา 3 กว้าง 130 (ม้วน 30 ม.)", uom: "roll", weightG: 1120, rubber: { compound: "DM03", type: "03", color: "YE03", lengthMm: 3000, holeMm: 3, odMm: 130, kgPerRoll: 1.12, cutLengthCm: 17, pcsPerRoll: 176, sePerGr: 10 } },
    { code: "RB-DM02-02-YE03-204-19-34", kind: "RB", name: "ยางกลมมีรู ปลอกห่วงฮูล่า เหลือง YE03 Ø34 รู 19", uom: "rod", weightG: 245, rubber: { compound: "DM02", type: "02", color: "YE03", lengthMm: 204, holeMm: 19, odMm: 34, kgPerRoll: 0.245, cutLengthCm: 40.5, pcsPerRoll: 5, sePerGr: 1 } },
    // ชิ้นยาง (SE = GR ตัด/เจาะ)
    { code: "SE-TP01-OR01-100-18-65", kind: "SE", name: "ลูกตอปิโด TP-01 ส้ม OR01 ยาว 100", uom: "pcs", weightG: 49, rubber: { product: "TP01", color: "OR01", lengthMm: 100, holeMm: 18, odMm: 65 } },
    { code: "SE-TP01-BK01-140-3-20", kind: "SE", name: "แกนหาง 3 ร่อง ตอปิโด TP-01 ดำ BK01 ยาว 140", uom: "pcs", weightG: 12, rubber: { product: "TP01", color: "BK01", lengthMm: 140, holeMm: 3, odMm: 20 } },
    { code: "SE-TP01-OR01-75-3-30", kind: "SE", name: "ปีกหางตอปิโด TP-01 ส้ม OR01 ยาว 75", uom: "pcs", weightG: 6, rubber: { product: "TP01", color: "OR01", lengthMm: 75, holeMm: 3, odMm: 30 } },
    { code: "SE-HL24-YE03-400-19-30", kind: "SE", name: "ปลอกห่วงฮูล่า HL-24 เหลือง YE03 ยาว 400", uom: "pcs", weightG: 49, rubber: { product: "HL24", color: "YE03", lengthMm: 400, holeMm: 19, odMm: 30 } },
    { code: "SE-BL60-RD01-60-0-60", kind: "SE", name: "บอลยาง 60 มม. แดง RD01 (ร่าง)", uom: "pcs", weightG: 41, rubber: { product: "BL60", color: "RD01", lengthMm: 60, holeMm: 0, odMm: 60 } },
    // ชิ้นพลาสติก (PT) และงานเย็บ (BG)
    { code: "PT-00320", kind: "PT", name: "แกนตอปิโด ท่อดำ 150 ซม. (20 ก./ชิ้น)", uom: "pcs", weightG: 20 },
    { code: "BG-0092", kind: "BG", name: "กระเป๋าตาข่าย HL-24 กุ้น-ซิป-หูล็อก", uom: "pcs" },
    // ชิ้นที่ PK ทำเอง (ยังไม่มีรหัสในชีต → ระบบออก XP-)
    { code: "XP-00001", kind: "SUBPART", name: "แกนตอปิโด ตัดยาว 14 ซม.", uom: "pcs", ownerDept: "PK" },
    // สินค้าสำเร็จรูป (FG)
    { code: "DEMO-TP-01(P)-Y", kind: "FG", name: "ตอปิโดยาง TP-01 แพ็กถุง ชุดสี Y (3 ชิ้น/ชุด)", uom: "set" },
    { code: "DEMO-HL-24(B)-A", kind: "FG", name: "ห่วงฮูล่า HL-24 นิ้ว กล่อง ชุดสี A", uom: "set" },
    { code: "DEMO-BL-60(K)-Z", kind: "FG", name: "บอลยาง 60 มม. แพ็ก K ชุดสี Z (ยังไม่มี BOM อนุมัติ)", uom: "set" },
  ]);

  // BOM อนุมัติ (ชั้นละแผนก): [พ่อ, [[ลูก, ปริมาณต่อหน่วยพ่อ], ...]] ปริมาณ RB ต่อ SE ใช้สูตร rbPerSe จากข้อมูลการตัด
  const rbQty = (code) => {
    const item = ITEMS.find((entry) => entry.code === code);
    return rules().rbPerSe({ pcsPerRoll: item.rubber.pcsPerRoll, sePerGr: item.rubber.sePerGr, uom: item.uom, weightG: item.weightG });
  };
  const BOMS = () => [
    ["SE-TP01-OR01-100-18-65", [["RB-DM01-02-OR01-202-18-70", rbQty("RB-DM01-02-OR01-202-18-70")], ["RB-DM01-01-OR01-200-0-72", rbQty("RB-DM01-01-OR01-200-0-72")]]],
    ["SE-TP01-BK01-140-3-20", [["RB-DM02-02-BK01-225-3-20", rbQty("RB-DM02-02-BK01-225-3-20")]]],
    ["SE-TP01-OR01-75-3-30", [["RB-DM03-03-YE03-3000-3-130", rbQty("RB-DM03-03-YE03-3000-3-130")]]],
    ["SE-HL24-YE03-400-19-30", [["RB-DM02-02-YE03-204-19-34", rbQty("RB-DM02-02-YE03-204-19-34")]]],
    ["PT-00320", [["P-PEL-BK", 0.02]]],
    ["BG-0092", [["P-FAB-BL", 0.59], ["P-ZIP-05", 0.53], ["P-ROPE-01", 0.0036]]],
    ["DEMO-TP-01(P)-Y", [["XP-00001", 1], ["PT-00320", 0.3], ["P-STK-01", 1], ["P-BAG-01", 0.01], ["P-BOX-01", 0.025], ["SE-TP01-OR01-100-18-65", 3], ["SE-TP01-BK01-140-3-20", 3], ["SE-TP01-OR01-75-3-30", 9]]],
    ["DEMO-HL-24(B)-A", [["SE-HL24-YE03-400-19-30", 3], ["BG-0092", 1], ["P-STK-01", 1], ["P-BOX-01", 0.125]]],
  ];

  // ใบสาธิตที่งาน RB ผูก WO ของชุดสาธิต RubberFlow: [เลข PI, จำนวนสั่ง, สถานะที่ WO เดินถึง] · WO เปิดเมื่อ WO_DAYS_AGO วันก่อน ลำดับ 01, 02 ของวันนั้น
  // (ชุดสาธิต RubberFlow ไม่มี WO อื่นในวันนั้น เลขจึงตรงกัน · รูปเลขเดียวกับ nextId ของ modules/rubberflow-actions.js ในโหมดสาธิต)
  const DEMO_RF_ORDERS = Object.freeze([["DEMO-26006", 60, "running"], ["DEMO-26007", 30, "issued"]]);
  const WO_DAYS_AGO = 3;
  const ymd = (ms) => { const day = new Date(ms); return `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`; };
  const demoWoId = (now, index) => `WO-${ymd(now - WO_DAYS_AGO * rules().DAY)}-${String(index + 1).padStart(2, "0")}`;

  function emptyState() {
    return { version: 6, counters: {}, users: USERS.map((user) => ({ ...user })), compounds: [], items: [], boms: [], orders: [], jobs: [], audit: [], colors: [], colorSets: [], packages: [], processes: rules().DEFAULT_PROCESSES.map((entry) => ({ ...entry })), routings: [], stock: [], stockMoves: [], rodLots: [], rodMoves: [],
      grConfig: [], grPlans: [], grRecords: [], rodRequests: [], grHandovers: [], grWorkers: [] };
  }

  // คลังแท่งยาว (SR) สาธิต: แท่งของงาน RB ที่ผูก WO ของใบ DEMO-26006 (ฮูล่า 60 ชุด ต้องใช้ 36 เส้น) และสต็อกกลางจากใบ DEMO-26008 ที่ปิดแล้ว
  // L0 = ใบ DEMO-26008 รับเข้า 6 เส้นหลังงาน RB ของใบเสร็จแล้ว (เป็นสต็อกกลางทั้งหมด) · L1 = รับเข้าผ่านแล้ว 20 เส้น (เป็นของใบ งาน RB ได้ 20/36)
  // L2 / L3 = รอ SR รับเข้า (12 และ 8 เส้น มีสเปกขนาด): รับ L2 ผ่าน → งาน 32/36 · วัด L3 นอกสเปก → กักรอ QA → ให้ใช้ → 4 เส้นเป็นของใบ อีก 4 เป็นสต็อกกลาง งานครบ
  // แล้ว SR จ่ายแท่งให้ GR ของใบ DEMO-26006 (ถังของใบก่อน แล้วสต็อกกลาง ล็อตเก่าก่อน) · เลขล็อตตกแต่งเป็นเลขสาธิต (-9x) ไม่มีล็อตจริงในชุดสาธิต RubberFlow
  // ตำแหน่งจัดเก็บ (20261204010000): L0 = A-01 · L1 = A-02 · ล็อตรอรับยังไม่มีตำแหน่ง · L4 = รับนอกใบสั่ง (ยกยอดจากการนับ) 15 เส้นของ RB-DM02-02-BK01-225-3-20 ที่ B-01 เป็นสต็อกกลาง
  const ROD_SPEC = Object.freeze({ thickness: { target: 7.5, tol: 0.3 }, width: { target: 34, tol: 0.5 }, weightPerM: { target: 1200, tol: 40 } });
  const rodId = (n) => `5e1d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  function addRodDemo(d, now) {
    const { DAY } = rules();
    const HOUR = 3600000;
    const sr = USERS.find((user) => user.role === "sr").name;
    const rbJob = (pi) => d.jobs.find((entry) => entry.orderId === pi && entry.dept === "RB");
    const live = rbJob("DEMO-26006");
    const closed = rbJob("DEMO-26008");
    if (!live || !closed || !live.externalRef?.woId) return;
    const lot = (n, job, woNo, fields) => ({
      id: rodId(n), lotNo: `FN-${ymd(fields.createdAt)}-${90 + n}`, itemCode: job.itemCode, orderId: job.orderId, jobNo: job.id, woNo, recipeCode: "RC-NBR-OR02", uom: job.uom,
      spec: JSON.parse(JSON.stringify(ROD_SPEC)), status: "pending", qtyReceived: null, qc: null, receivedBy: null, receivedAt: null, decision: null, decisionNote: null, decidedBy: null, decidedAt: null,
      location: "", source: "order", sourceNote: null, ...fields,
    });
    const received = (at, qty, values) => ({ status: "stored", qtyReceived: qty, qc: { values, result: "pass", note: "" }, receivedBy: sr, receivedAt: at });
    const move = (n, row, at) => ({ id: rodId(100 + n), reversesId: null, note: "", at, by: sr, forOrderId: null, ...row });
    const t0 = now - 5 * DAY;
    const l0 = lot(0, closed, `WO-${ymd(now - 10 * DAY)}-90`, { qtySent: 6, createdAt: t0 - HOUR, location: "A-01", ...received(t0, 6, { thickness: 7.45, width: 34.2, weightPerM: 1210 }) });
    const t1 = now - DAY;
    const l1 = lot(1, live, live.externalRef.woId, { qtySent: 20, createdAt: t1 - HOUR, location: "A-02", ...received(t1, 20, { thickness: 7.52, width: 34.1, weightPerM: 1195 }) });
    // รับนอกใบสั่ง: ไม่มีใบ งาน WO สเปก หรือผลตรวจ (เหมือน receiveRodsOpening) · รหัสอื่นของ DEMO-26001 จึงไม่เปลี่ยนตัวเลขของ RB-DM02-02-YE03
    const t4 = now - 3 * DAY;
    const openingItem = d.items.find((item) => item.code === "RB-DM02-02-BK01-225-3-20");
    const l4 = openingItem ? { id: rodId(4), lotNo: `OP-${ymd(t4)}-01`, itemCode: openingItem.code, orderId: null, jobNo: null, woNo: null, recipeCode: null, uom: openingItem.uom, qtySent: 15, spec: null,
      status: "stored", qtyReceived: 15, qc: null, receivedBy: sr, receivedAt: t4, decision: null, decisionNote: null, decidedBy: null, decidedAt: null, createdAt: t4,
      location: "B-01", source: "opening", sourceNote: "ยกยอดจากการนับคลังครั้งแรก" } : null;
    d.rodLots.push(l0, l1,
      lot(2, live, live.externalRef.woId, { qtySent: 12, createdAt: now - 3 * HOUR }),
      lot(3, live, live.externalRef.woId, { qtySent: 8, createdAt: now - 2 * HOUR }));
    if (l4) d.rodLots.push(l4);
    d.rodMoves.push(
      move(0, { lotId: l0.id, itemCode: l0.itemCode, kind: "receive", qty: 6, ownerOrderId: null }, t0),
      move(1, { lotId: l1.id, itemCode: l1.itemCode, kind: "receive", qty: 20, ownerOrderId: live.orderId }, t1));
    if (l4) d.rodMoves.push(move(4, { lotId: l4.id, itemCode: l4.itemCode, kind: "receive", qty: 15, ownerOrderId: null, note: l4.sourceNote }, t4));
    live.reports = [...(live.reports ?? []), { at: t1, by: sr, good: 20, reject: 0, note: `รับเข้าคลัง SR ผ่านตรวจ ล็อต ${l1.lotNo}` }];
    live.qtyDone = 20;
  }

  // แปรรูปยาง GR สาธิต (20261216010000): งานปลอกห่วงฮูล่า SE-HL24-YE03-400-19-30 ของใบ DEMO-26001 (ต้องทำ 120) ตั้งขั้นตอนจาก routing (ตัดยาง → ทากาว → เจียร์ → เจาะ)
  // ผลรายวันสี่วันของพนักงานสมมติสามคน (ชื่อสาธิต) · เป้าชิ้น/ชม. สองขั้น · คำขอเบิกยางเส้นยาวที่ยังเปิดหนึ่งรายการ · ส่งให้ PK สองครั้ง (PK รับแล้วหนึ่ง รอรับหนึ่ง)
  // งาน SE-TP01-BK01-140-3-20 คงเป็นงานที่รายงานยอดแบบเดิม (ไม่มีขั้นตอน) · งานลูกตอปิโดยังไม่ตั้งขั้นตอน (ตั้งจาก routing ได้)
  const GR_WORKERS = Object.freeze([
    { id: "B05", name: "สุนทร ใจงาม" },
    { id: "GR-DEMO-2", name: "กมล ทดลองดี" },
    { id: "GR-DEMO-3", name: "รัตนา สมมุติ" },
  ].map((worker) => Object.freeze(worker)));
  const grDemoId = (kind, n) => `6e1d0000-0000-4000-800${kind}-${String(n + 1).padStart(12, "0")}`;
  function addGrDemo(d, now) {
    const R = rules();
    const A = actions();
    const HOUR = 3600000;
    const user = (role) => USERS.find((row) => row.role === role);
    const at = (t, role) => ({ now: Math.round(t), user: user(role) });
    const job = d.jobs.find((entry) => entry.orderId === "DEMO-26001" && entry.itemCode === "SE-HL24-YE03-400-19-30");
    if (!job) return;
    // GR ก่อน (ลำดับเดียวกับฐานข้อมูล) ตามด้วยพนักงานของ PT / BG / PK ที่ buildSeed ใส่ไว้
    d.grWorkers = [...GR_WORKERS.map((worker) => ({ ...worker })), ...(d.grWorkers ?? []).filter((worker) => worker.dept && worker.dept !== "GR")];
    // เวลาบันทึก: วันก่อนหน้า k วัน เวลา 17:00 (เวลาไทย)
    const evening = (k) => Date.parse(`${R.grDay(now, -k)}T17:00:00+07:00`);
    const config = R.grConfig(d);
    A.saveGrConfig(d, { steps: config.steps, reasons: config.reasons, targets: [
      { itemCode: job.itemCode, stepCode: "GR-04", perHour: 20 }, { itemCode: job.itemCode, stepCode: "GR-09", perHour: 12 },
    ] }, at(evening(6), "planner"));
    A.setGrJobSteps(d, { jobId: job.id, steps: R.grDefaultSteps(d, job) }, at(evening(6) + 60000, "planner"));
    // หัวหน้า / ฝ่ายวางแผนบันทึกแทนพนักงานย้อนหลัง k วัน
    const record = (k, workerId, stepCode, hours, good, reject = 0, reason = "") =>
      A.addGrRecord(d, { jobId: job.id, workDate: R.grDay(now, -k), workerId, stepCode, hours, people: 1, good, reject, reason }, at(evening(k), "planner"));
    // พนักงาน GR (B05) บันทึกผลของตัวเอง ณ เวลา t สำหรับวันนั้นหรือวันก่อน (offset 0 / −1)
    const own = (t, offset, stepCode, hours, good, reject = 0, reason = "") =>
      A.addGrRecord(d, { jobId: job.id, workDate: R.grDay(t, offset), stepCode, hours, people: 1, good, reject, reason }, at(t, "gr"));
    record(4, "GR-DEMO-2", "GR-04", 8, 60, 2, "ขนาดไม่ได้");
    record(4, "GR-DEMO-3", "GR-05", 8, 50);
    record(3, "GR-DEMO-2", "GR-04", 8, 55);
    record(3, "GR-DEMO-3", "GR-06", 7.5, 45, 3, "เจียร์เกิน");
    record(2, "B05", "GR-09", 8, 30);
    A.sendGrToPk(d, { jobId: job.id, qty: 30, note: "ปลอกห่วงชุดแรก" }, at(evening(2) + HOUR, "planner"));
    A.receiveGrAtPk(d, { handoverId: d.grHandovers.at(-1).id }, at(evening(2) + 2 * HOUR, "planner"));
    record(1, "GR-DEMO-3", "GR-06", 8, 50);
    // พนักงาน GR บันทึกผลของตัวเองเมื่อวานและวันนี้
    own(now - 2 * HOUR, -1, "GR-09", 8, 35, 1, "เจาะผิดตำแหน่ง");
    A.requestRods(d, { jobId: job.id, itemCode: "RB-DM02-02-YE03-204-19-34", qty: 10, note: "เส้นยางหมดที่โต๊ะตัด" }, at(now - 90 * 60000, "gr"));
    own(now - HOUR, 0, "GR-05", 4, 25);
    A.sendGrToPk(d, { jobId: job.id, qty: 25 }, at(now - 30 * 60000, "planner"));
    // id ของแถวคงที่ (ชุดสาธิตเหมือนกันทุกครั้งเมื่อ now เท่ากัน): แถวเหล่านี้ไม่ถูกอ้างจากที่อื่นแล้ว
    fixGrDemoIds(d);
  }
  const fixGrDemoIds = (d) => {
    d.grRecords.forEach((row, index) => { row.id = grDemoId(1, index); });
    d.rodRequests.forEach((row, index) => { row.id = grDemoId(2, index); });
    d.grHandovers.forEach((row, index) => { row.id = grDemoId(3, index); });
  };

  // ขั้นตอนรายแผนก PT / BG / PK สาธิต (20261224010000_bom_dept_steps.sql) · พนักงานสมมติของแต่ละแผนก (ชื่อสาธิต) ในชุด grWorkers (dept)
  // PT: งานแกน PT-00320 ของใบ DEMO-26001 บันทึกด้วยขั้นตอน (buildSeed) แล้วส่งให้ PK 10 ชิ้น รอ PK รับ
  // BG: งานกระเป๋า BG-0092 ของใบ DEMO-26006 ตั้งขั้นตอนเย็บ มีผลสองวัน ส่งให้ PK 20 ใบ PK รับแล้ว
  // PK: งานฮูล่าของใบ DEMO-26006 สามขั้น ประกอบ 15 → ใส่กระเป๋า 12 → บรรจุกล่อง 10 · ส่งให้ WH 6 ชุด WH ยังไม่รับ
  const DEPT_WORKERS = Object.freeze([
    { id: "B06", name: "มานพ ศักดิ์ดี", dept: "PT" }, { id: "PT-DEMO-2", name: "สมพร ทดลองฉีด", dept: "PT" },
    { id: "B07", name: "จันทร์เพ็ญ ดวงแก้ว", dept: "BG" }, { id: "BG-DEMO-2", name: "ลำดวน ทดลองเย็บ", dept: "BG" },
    { id: "PK-DEMO-1", name: "ปรีชา ทดลองบรรจุ", dept: "PK" }, { id: "PK-DEMO-2", name: "อำไพ ทดลองประกอบ", dept: "PK" },
  ].map((worker) => Object.freeze(worker)));
  function addDeptDemo(d, now) {
    const R = rules();
    const A = actions();
    const HOUR = 3600000;
    const user = (role) => USERS.find((row) => row.role === role);
    const at = (t, role) => ({ now: Math.round(t), user: user(role) });
    const evening = (k) => Date.parse(`${R.grDay(now, -k)}T17:00:00+07:00`);
    const record = (job, k, workerId, stepCode, hours, good, reject = 0, reason = "") =>
      A.addGrRecord(d, { jobId: job.id, workDate: R.grDay(now, -k), workerId, stepCode, hours, people: 1, good, reject, reason }, at(evening(k), "planner"));
    const pt = d.jobs.find((entry) => entry.orderId === "DEMO-26001" && entry.itemCode === "PT-00320");
    if (pt && R.grPlanOf(d, pt.id)) A.sendToPk(d, { jobId: pt.id, qty: 10, note: "แกนรอบแรก" }, at(now - 2 * HOUR, "planner"));
    const bg = d.jobs.find((entry) => entry.orderId === "DEMO-26006" && entry.dept === "BG");
    if (bg) {
      A.setGrJobSteps(d, { jobId: bg.id, steps: R.grDefaultSteps(d, bg) }, at(evening(3), "planner"));
      record(bg, 2, "B07", "BG-02", 8, 25);
      record(bg, 1, "BG-DEMO-2", "BG-02", 8, 20, 1, "ฝีเข็มไม่สวย/หลุด");
      A.sendToPk(d, { jobId: bg.id, qty: 20, note: "กระเป๋าชุดแรก" }, at(evening(1) + HOUR, "planner"));
      A.receiveAtPk(d, { handoverId: d.grHandovers.at(-1).id }, at(evening(1) + 2 * HOUR, "planner"));
    }
    const pk = d.jobs.find((entry) => entry.orderId === "DEMO-26006" && entry.dept === "PK" && entry.kind === "FG");
    if (pk) {
      A.setGrJobSteps(d, { jobId: pk.id, steps: R.grDefaultSteps(d, pk) }, at(evening(2), "planner"));
      record(pk, 1, "PK-DEMO-2", "PK-01", 8, 15);
      record(pk, 1, "PK-DEMO-1", "PK-02", 4, 12);
      record(pk, 1, "PK-DEMO-1", "PK-03", 4, 10, 1, "กระเป๋า/กล่องเสียหาย");
      A.sendPkToWh(d, { jobId: pk.id, qty: 6, note: "กล่องชุดแรก" }, at(now - HOUR, "planner"));
    }
    fixGrDemoIds(d);
  }

  // parts = false: ไม่มีการเบิกจ่ายของซื้อสาธิตของ DEMO-26001 (เทสต์ขั้นตอนเบิก / คืนของซื้อเริ่มจากใบที่ยังไม่เบิกเลย)
  function buildSeed(now = Date.now(), { rods = true, gr = true, parts = true } = {}) {
    const { DAY } = rules();
    const A = actions();
    const d = emptyState();
    const user = (role) => USERS.find((row) => row.role === role);
    const at = (t, role) => ({ now: Math.round(t), user: user(role) });
    const t0 = now - 30 * DAY;

    d.compounds = COMPOUNDS.map((compound) => ({ ...compound, createdAt: t0 }));
    // item master และ BOM: ฝ่ายวางแผนสร้างทั้งหมดจากจุดเดียว (แผนกเจ้าของตามชนิดชิ้น ใช้แยกงานตอนปล่อยผลิต)
    ITEMS.forEach((item, index) => {
      A.saveItem(d, { ...item, ownerDept: item.ownerDept ?? rules().KINDS[item.kind].dept, group: "TOY", create: true }, at(t0 + index * 3600000, "planner"));
    });
    BOMS().forEach(([parentCode, lines], index) => {
      // ข้อมูลสาธิตไม่มีลำดับที่ผู้ใช้จัด: เรียงตามผังงานเหมือน BOM ที่นำเข้าจาก Excel (saveBom เก็บลำดับตามที่ส่งมา)
      const ordered = rules().sortLinesByFlow(lines.map(([childCode, qty]) => ({ childCode, qty })), (code) => d.items.find((entry) => entry.code === code) ?? null);
      A.saveBom(d, { itemCode: parentCode, lines: ordered }, at(t0 + 2 * DAY + index * 6 * 3600000, "planner"));
    });
    // สี ชุดสี และแพ็กเกจเป็นข้อมูล (แทนการแก้สีมือในชีต Edit DATA): สีที่ใช้ในชุดสาธิต · ชุด Y เรียนรู้จากสินค้าที่มี · ชุด A นิยามใหม่ (ลูก/ปีกแดง แกนดำ)
    // แพ็กเกจของตอปิโด: P = ถุง + ลังรวม 40 ชุด · B = กล่องเดี่ยว (ลัง 12 กล่อง)
    [["OR01", "ส้ม"], ["RD01", "แดง"], ["BK01", "ดำ"], ["YE03", "เหลืองสด"], ["BL02", "ฟ้า"], ["GN05", "เขียว"]].forEach(([code, name], index) => A.saveColor(d, { code, name }, at(t0 + 3 * DAY + index * 60000, "planner")));
    A.learnColorSet(d, { fgCode: "DEMO-TP-01(P)-Y" }, at(t0 + 3 * DAY + 3600000, "planner"));
    A.saveColorSet(d, { base: "DEMO-TP-01", code: "A", name: "แดง-ดำ", slots: [{ key: "SE-TP01-*-100-18-65", color: "RD01" }, { key: "SE-TP01-*-140-3-20", color: "BK01" }, { key: "SE-TP01-*-75-3-30", color: "RD01" }] }, at(t0 + 3 * DAY + 7200000, "planner"));
    A.savePackage(d, { base: "DEMO-TP-01", code: "P", name: "ถุงพลาสติก + ลังรวม 40 ชุด", lines: [{ childCode: "P-BAG-01", qty: 0.01 }, { childCode: "P-BOX-01", qty: 0.025 }] }, at(t0 + 3 * DAY + 7260000, "planner"));
    A.savePackage(d, { base: "DEMO-TP-01", code: "B", name: "กล่องเดี่ยว (ลัง 12 กล่อง)", lines: [{ childCode: "P-BOX-01", qty: 1 / 12 }] }, at(t0 + 3 * DAY + 7320000, "planner"));
    // แก้ BOM ครั้งหนึ่งให้มีประวัติ revision (ลูกตอปิโดเปลี่ยนอัตราส่วนเส้นหัว) และ FG บอลยางที่ยังไม่มี BOM
    A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [["RB-DM01-02-OR01-202-18-70", rbQty("RB-DM01-02-OR01-202-18-70")], ["RB-DM01-01-OR01-200-0-72", rbQty("RB-DM01-01-OR01-200-0-72")]].map(([childCode, qty]) => ({ childCode, qty, note: childCode.endsWith("72") ? "ตัด 4 ซม." : "" })), note: "ระบุความยาวตัดของเส้นหัว" }, at(now - 3 * DAY, "planner"));

    // โครงสร้างสินค้า (จำลอง): ราคาต้นทุนสาธิตของชิ้นที่ไม่มี BOM (บาทต่อหน่วยนับ) และขั้นตอนผลิต (นาที/ชิ้น)
    // XP-00001 จงใจไม่ตั้งราคา เพื่อให้เห็นคำเตือนต้นทุนไม่ครบ
    [["P-BOX-01", 25], ["P-STK-01", 0.5], ["P-BAG-01", 120], ["P-PEL-BK", 45], ["P-FAB-BL", 30], ["P-ZIP-05", 8], ["P-ROPE-01", 90],
      ["RB-DM01-02-OR01-202-18-70", 130], ["RB-DM01-01-OR01-200-0-72", 119.4], ["RB-DM02-02-BK01-225-3-20", 16.2], ["RB-DM03-03-YE03-3000-3-130", 89.6], ["RB-DM02-02-YE03-204-19-34", 23.3],
    ].forEach(([code, unitCost], index) => A.setItemCost(d, { code, unitCost }, at(t0 + 4 * DAY + index * 60000, "planner")));
    // RB ตามผังงาน 13 ขั้น รวม 3.5 นาที/เส้น · ขั้นพักยาง (RB-04, RB-07) 0 นาที
    const rbSteps = [["RB-01", 0.2], ["RB-02", 0.3], ["RB-03", 0.3], ["RB-04", 0], ["RB-05", 0.3], ["RB-06", 0.3], ["RB-07", 0], ["RB-08", 0.2], ["RB-09", 0.4], ["RB-10", 0.5], ["RB-11", 0.4], ["RB-12", 0.4], ["RB-13", 0.2]];
    [
      ...ITEMS.filter((item) => item.kind === "RB").map((item) => [item.code, rbSteps]),
      // GR ตามลำดับของ Grinding-GR: ตัดยาง GR-04 → ทากาว GR-05 → เจียร์ GR-06 → เจาะ GR-09 (ชิ้นที่ไม่ต้องทากาว/เจียร์ข้ามขั้นนั้น)
      ["SE-TP01-OR01-100-18-65", [["GR-04", 0.3], ["GR-05", 0.2], ["GR-06", 0.4], ["GR-09", 0.2]]], ["SE-TP01-BK01-140-3-20", [["GR-04", 0.15], ["GR-06", 0.2], ["GR-09", 0.1]]],
      ["SE-TP01-OR01-75-3-30", [["GR-04", 0.1], ["GR-09", 0.05]]], ["SE-HL24-YE03-400-19-30", [["GR-04", 0.25], ["GR-05", 0.3], ["GR-06", 0.2], ["GR-09", 0.1]]],
      ["PT-00320", [["PT-01", 0.5]]], ["XP-00001", [["PT-02", 0.1]]], ["BG-0092", [["BG-01", 1, ["P-FAB-BL"]], ["BG-02", 4, ["P-ZIP-05", "P-ROPE-01"]]]],
      // วัตถุดิบเข้าที่ขั้นไหน (ลูกที่ไม่ระบุแสดงที่ขั้นแรก): ประกอบชิ้นยาง/แกน แล้วค่อยใส่สติ๊กเกอร์ ถุง ลัง ตอนบรรจุ
      ["DEMO-TP-01(P)-Y", [["PK-01", 1.5, ["XP-00001", "PT-00320", "SE-TP01-OR01-100-18-65", "SE-TP01-BK01-140-3-20", "SE-TP01-OR01-75-3-30"]], ["PK-03", 0.5, ["P-STK-01", "P-BAG-01", "P-BOX-01"]]]],
      // PK ตามผังงาน: ประกอบ → ใส่สินค้าในกระเป๋า (กระเป๋าจาก BG เข้าขั้นนี้) → บรรจุลงกล่อง
      ["DEMO-HL-24(B)-A", [["PK-01", 2, ["SE-HL24-YE03-400-19-30"]], ["PK-02", 0.5, ["BG-0092"]], ["PK-03", 0.5, ["P-STK-01", "P-BOX-01"]]]],
    ].forEach(([itemCode, steps], index) => A.saveRouting(d, { itemCode, steps: steps.map(([processCode, minutesPerPc, inputs = []]) => ({ processCode, minutesPerPc, inputs })) }, at(t0 + 4 * DAY + 3600000 + index * 60000, "planner")));

    // ใบสั่งผลิตที่ปล่อยแล้วและมีความคืบหน้า
    const day = (n) => new Date(now + n * DAY).setHours(0, 0, 0, 0);
    const pi1 = A.createOrder(d, {
      pi: "DEMO-26001", customer: "ลูกค้าสาธิต เบลเยียม", country: "Belgium", orderedAt: day(-20), whDue: day(25),
      due: { RB: day(2), GR: day(9), PT: day(9), BG: day(9), ST: day(9), PK: day(20) }, note: "ใบสาธิต: ตอปิโด 80 ชุด + ฮูล่า 40 ชุด",
    }, at(now - 20 * DAY, "planner"));
    A.addOrderItem(d, { orderId: pi1, fgCode: "DEMO-TP-01(P)-Y", qty: 80 }, at(now - 20 * DAY + 600000, "planner"));
    A.addOrderItem(d, { orderId: pi1, fgCode: "DEMO-HL-24(B)-A", qty: 40 }, at(now - 20 * DAY + 900000, "planner"));
    A.explodeOrder(d, { orderId: pi1 }, at(now - 19 * DAY, "planner"));
    // คงคลังที่นับลดงาน (กฎ AK ของ BOMSHEET): แกน PT มี 10 จาก 24 → งาน PT เหลือ 14 · เส้นยางไม่นับตามใบแล้ว (ใช้จากคลังแท่งยาว SR ที่ขั้นตรวจของ)
    A.setStockCount(d, { orderId: pi1, itemCode: "PT-00320", qty: 10 }, at(now - 18 * DAY + 60000, "st"));
    // ของซื้อนับที่หน้า "คลังของซื้อ" (ยอดรวมต่อรหัส ไม่นับตามใบ): กล่องมี 5 ไม่พอใบนี้ (ต้องใช้ 7) ส่วนที่เหลือพอ ให้เห็นตอนเบิกจ่ายแล้วสั่งซื้อส่วนที่ขาด
    A.countPartStock(d, { counts: [{ itemCode: "P-BOX-01", qty: 5 }, { itemCode: "P-STK-01", qty: 400 }, { itemCode: "P-BAG-01", qty: 10 }, { itemCode: "P-FAB-BL", qty: 50 }, { itemCode: "P-PEL-BK", qty: 5 }, { itemCode: "P-ROPE-01", qty: 5 }, { itemCode: "P-ZIP-05", qty: 100 }] }, at(now - 18 * DAY + 120000, "st"));
    A.countPartStock(d, { counts: [{ itemCode: "P-BOX-01", safetyQty: 10 }] }, at(now - 18 * DAY + 180000, "planner"));
    A.releaseOrder(d, { orderId: pi1 }, at(now - 17 * DAY, "planner"));
    const job = (code) => d.jobs.find((entry) => entry.orderId === pi1 && entry.itemCode === code);
    A.reportJob(d, { jobId: job("RB-DM01-02-OR01-202-18-70").id, qtyDone: 5, note: "รอบรีดที่ 1" }, at(now - 10 * DAY, "rb"));
    A.reportJob(d, { jobId: job("RB-DM01-01-OR01-200-0-72").id, qtyDone: 4.8 }, at(now - 9 * DAY, "rb"));
    // PT ขึ้นรูปแกน 14 ชิ้นด้วยขั้นตอนรายแผนก (20261224010000): ฝ่ายวางแผนตั้งขั้นตอน PT-01 แล้วบันทึกผลแทนพนักงาน PT (ยอดถึงแผน = เสร็จ)
    d.grWorkers = DEPT_WORKERS.map((worker) => ({ ...worker }));
    const ptJob = job("PT-00320");
    A.setGrJobSteps(d, { jobId: ptJob.id, steps: rules().grDefaultSteps(d, ptJob) }, at(now - 8 * DAY - 3600000, "planner"));
    A.addGrRecord(d, { jobId: ptJob.id, stepCode: "PT-01", workDate: rules().grDay(now - 8 * DAY), workerId: "B06", hours: 6, people: 1, good: 14, reject: 0 }, at(now - 8 * DAY, "planner"));
    A.reportJob(d, { jobId: job("SE-TP01-BK01-140-3-20").id, qtyDone: 120, qtyReject: 4, note: "ครึ่งแรก" }, at(now - 5 * DAY, "gr"));
    A.setJobStatus(d, { jobId: job("BG-0092").id, status: "hold", reason: "รอผ้าตาข่ายล็อตใหม่" }, at(now - 4 * DAY, "bg"));


    // ใบร่างที่ระเบิดแล้ว รอปล่อยผลิต
    const pi2 = A.createOrder(d, {
      pi: "DEMO-26002", customer: "ลูกค้าสาธิต กรุงเทพ", country: "Thailand", orderedAt: day(-2), whDue: day(40),
      due: { RB: day(10), GR: day(18), PK: day(35) }, note: "",
    }, at(now - 2 * DAY, "planner"));
    A.addOrderItem(d, { orderId: pi2, fgCode: "DEMO-HL-24(B)-A", qty: 192 }, at(now - 2 * DAY + 600000, "planner"));
    A.explodeOrder(d, { orderId: pi2 }, at(now - DAY, "planner"));

    // ใบที่งาน RB ผูก WO ของชุดสาธิต RubberFlow (rubberflow-seed.js เปิด WO เลขเดียวกันผ่าน demoRfLinks เมื่อโหลดคู่กัน): ลองยกเลิกใบหลังเริ่มผลิตและรับเคมีคืน
    // DEMO-26006: WO กำลังผลิต (ผสมและฉีดแล้ว) · DEMO-26007: WO ปล่อยผลิตแล้ว เบิกเคมีแล้วรอผสม
    DEMO_RF_ORDERS.forEach(([pi, qty], index) => {
      const id = A.createOrder(d, {
        pi, customer: "ลูกค้าสาธิต ระยอง", country: "Thailand", orderedAt: day(-5), whDue: day(30),
        due: { RB: day(4), GR: day(12), BG: day(12), ST: day(12), PK: day(25) }, note: index ? "ใบสาธิต: WO เบิกเคมีแล้วรอผสม" : "ใบสาธิต: WO กำลังผลิต",
      }, at(now - 5 * DAY + index * 60000, "planner"));
      A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty }, at(now - 5 * DAY + 600000 + index * 60000, "planner"));
      A.explodeOrder(d, { orderId: id }, at(now - 4 * DAY + index * 60000, "planner"));
      A.releaseOrder(d, { orderId: id }, at(now - 4 * DAY + 3600000 + index * 60000, "planner"));
      const rb = d.jobs.find((entry) => entry.orderId === id && entry.dept === "RB");
      const item = d.items.find((entry) => entry.code === rb?.itemCode);
      if (!rb || !item) return;
      const kg = A.helpers.rbJobKg(rb, item, { scrapPct: 5, bom: A.helpers.approvedBomOf(d, item.code) });
      A.linkJobToRubberFlow(d, { jobId: rb.id, woId: demoWoId(now, index), kg }, at(now - WO_DAYS_AGO * DAY, "planner")); // WO เปิดโดยฝ่ายวางแผนเท่านั้น (โรงงานขั้น 6)
    });
    // ใบที่ผลิต รับเข้าคลัง และส่งมอบครบแล้ว (ลองย้อนด้วยผู้จัดการแผนกคลังสินค้า): DEMO-26008 ฮูล่า 20 ชุด ทุกแผนกรายงานครบ · WH รับเข้า 8 แล้ว 12 (ใบปิดเอง) · ส่งมอบ 20
    // ย้อนรับเข้าได้หลังย้อนการส่งมอบก่อน · ย้อนรับเข้าแล้วของไม่ครบ ใบเปิดกลับเป็นกำลังผลิต · งานของซื้อของใบที่ปิดแล้วไม่เป็นงานค้าง
    const pi8 = A.createOrder(d, {
      pi: "DEMO-26008", customer: "ลูกค้าสาธิต ระยอง", country: "Thailand", orderedAt: day(-12), whDue: day(5),
      due: { RB: day(-9), GR: day(-7), BG: day(-7), ST: day(-7), PK: day(-5) }, note: "ใบสาธิต: ส่งมอบครบแล้ว ลองย้อนการส่งมอบ / การรับเข้าคลัง",
    }, at(now - 12 * DAY, "planner"));
    A.addOrderItem(d, { orderId: pi8, fgCode: "DEMO-HL-24(B)-A", qty: 20 }, at(now - 12 * DAY + 600000, "planner"));
    A.explodeOrder(d, { orderId: pi8 }, at(now - 11 * DAY, "planner"));
    A.releaseOrder(d, { orderId: pi8 }, at(now - 11 * DAY + 3600000, "planner"));
    d.jobs.filter((entry) => entry.orderId === pi8 && !(entry.dept === "ST" && entry.kind === "PURCHASED")).forEach((entry, index) => {
      A.reportJob(d, { jobId: entry.id, qtyDone: Math.max(0, Number(entry.qtyPlanned) - Number(entry.qtyDone || 0)) }, at(now - 7 * DAY + index * 60000, "planner"));
    });
    // PK ส่งให้ WH ก่อน (20261224010000: WH รับได้ไม่เกินที่ PK ส่ง)
    const pk8 = d.jobs.find((entry) => entry.orderId === pi8 && entry.dept === "PK" && entry.kind === "FG" && entry.itemCode === "DEMO-HL-24(B)-A");
    A.sendPkToWh(d, { jobId: pk8.id, qty: Number(pk8.qtyDone) || 0, note: "ส่งครบ" }, at(now - 6 * DAY - 60000, "planner"));
    A.receiveFg(d, { orderId: pi8, lines: [{ fgCode: "DEMO-HL-24(B)-A", qty: 8 }] }, at(now - 6 * DAY, "wh"));
    A.receiveFg(d, { orderId: pi8, lines: [{ fgCode: "DEMO-HL-24(B)-A", qty: 12 }] }, at(now - 5 * DAY, "wh"));
    A.deliverFg(d, { orderId: pi8, lines: [{ fgCode: "DEMO-HL-24(B)-A", qty: 20 }] }, at(now - 4 * DAY, "wh"));
    // ST จ่ายวัตถุดิบบางส่วนของใบ DEMO-26001 ให้เห็นในหน้า "วัตถุดิบจาก ST" ของ PT / BG (จำนวน วันที่ ผู้จ่าย): เม็ดพลาสติกของแกน PT 0.2 kg · ผ้าตาข่ายของกระเป๋า BG 10 หลา
    if (parts) A.issueOrderParts(d, { orderId: pi1, lines: [{ itemCode: "P-PEL-BK", qty: 0.2 }, { itemCode: "P-FAB-BL", qty: 10 }] }, at(now - 3 * DAY, "st"));
    if (rods) addRodDemo(d, now);
    if (gr) addGrDemo(d, now);
    if (gr) addDeptDemo(d, now);
    return d;
  }

  // งาน RB ของใบสาธิตที่ผูก WO → ข้อมูลที่ชุดสาธิต RubberFlow ใช้เปิด WO เลขเดียวกัน (สร้างชุด BOM ด้วย now เดียวกันแล้วอ่านงานที่ผูก)
  // mode: running = เดินสายผลิตถึงขั้นฉีด (WO กำลังผลิต) · issued = เบิกเคมีแล้วรอผสม · สูตรของ WO = สูตร PHR ที่สูตรยางของเส้นยางผูกไว้ (ไม่ผูก = ข้าม)
  function demoRfLinks(now = Date.now()) {
    // ยอดของ WO = ส่วนที่งาน RB ยังขาดตอนเปิด WO (ก่อนแท่งสาธิตของคลังแท่งยาวเข้า)
    const d = buildSeed(now, { rods: false, gr: false });
    return DEMO_RF_ORDERS.map(([pi, , mode]) => {
      const job = d.jobs.find((entry) => entry.orderId === pi && entry.dept === "RB" && entry.externalRef?.woId);
      if (!job) return null;
      const item = d.items.find((entry) => entry.code === job.itemCode);
      const compound = COMPOUNDS.find((entry) => entry.code === item?.rubber?.compound);
      const order = d.orders.find((entry) => entry.id === pi);
      return {
        orderId: pi, customer: order?.customer ?? "", jobId: job.id, woId: job.externalRef.woId, recipeId: compound?.recipeId ?? null,
        qty: Math.max(0, Number(job.qtyPlanned) - Number(job.qtyDone || 0)), uom: job.uom, kg: Number(job.externalRef.kg) || 0, color: item?.rubber?.color || "ดำ", dueAt: job.dueAt, mode,
      };
    }).filter((link) => link && link.recipeId && link.qty > 0);
  }

  const api = { USERS, COMPOUNDS, ITEMS, GR_WORKERS, DEPT_WORKERS, emptyState, buildSeed, demoRfLinks, demoWoId };
  if (isNode) module.exports = api;
  else root.MNP_BOM_SEED = api;
})(typeof window !== "undefined" ? window : globalThis);
