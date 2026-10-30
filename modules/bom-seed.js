// BOM รายแผนก (โหมดทดสอบ) — ข้อมูลสาธิตสมมติทั้งชุด: บทบาท 8 คน สูตรยาง item master BOM อนุมัติ ใบสั่งผลิต 2 ใบ และงานรายแผนก
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

  function emptyState() {
    return { version: 4, counters: {}, users: USERS.map((user) => ({ ...user })), compounds: [], items: [], boms: [], orders: [], jobs: [], audit: [], colors: [], colorSets: [], packages: [], processes: rules().DEFAULT_PROCESSES.map((entry) => ({ ...entry })), routings: [] };
  }

  function buildSeed(now = Date.now()) {
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
      A.saveBom(d, { itemCode: parentCode, lines: lines.map(([childCode, qty]) => ({ childCode, qty })) }, at(t0 + 2 * DAY + index * 6 * 3600000, "planner"));
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
    const rbSteps = [["RB-EXT", 1.5], ["RB-CURE", 2]];
    [
      ...ITEMS.filter((item) => item.kind === "RB").map((item) => [item.code, rbSteps]),
      ["SE-TP01-OR01-100-18-65", [["GR-CUT", 0.2], ["GR-DRL", 0.3]]], ["SE-TP01-BK01-140-3-20", [["GR-CUT", 0.15], ["GR-DRL", 0.2]]],
      ["SE-TP01-OR01-75-3-30", [["GR-CUT", 0.1]]], ["SE-HL24-YE03-400-19-30", [["GR-CUT", 0.25]]],
      ["PT-00320", [["PT-INJ", 0.5]]], ["XP-00001", [["PT-CUT", 0.1]]], ["BG-0092", [["BG-CUT", 1, ["P-FAB-BL"]], ["BG-SEW", 4, ["P-ZIP-05", "P-ROPE-01"]]]],
      // วัตถุดิบเข้าที่ขั้นไหน (ลูกที่ไม่ระบุแสดงที่ขั้นแรก): ประกอบชิ้นยาง/แกน แล้วค่อยใส่สติ๊กเกอร์ ถุง ลัง ตอนบรรจุ
      ["DEMO-TP-01(P)-Y", [["PK-ASM", 1.5, ["XP-00001", "PT-00320", "SE-TP01-OR01-100-18-65", "SE-TP01-BK01-140-3-20", "SE-TP01-OR01-75-3-30"]], ["PK-QC", 0.3], ["PK-PACK", 0.5, ["P-STK-01", "P-BAG-01", "P-BOX-01"]]]],
      ["DEMO-HL-24(B)-A", [["PK-ASM", 2, ["SE-HL24-YE03-400-19-30", "BG-0092"]], ["PK-PACK", 0.5, ["P-STK-01", "P-BOX-01"]]]],
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
    // คงคลังที่นับลดงาน (กฎ AK ของ BOMSHEET): เส้นรัดผมมี 3 จาก 17.14 ที่ต้องใช้ → งาน RB เหลือ 14.14 · แกน PT มี 10 จาก 24 → งาน PT เหลือ 14
    A.setStockCount(d, { orderId: pi1, itemCode: "RB-DM02-02-BK01-225-3-20", qty: 3 }, at(now - 18 * DAY, "st"));
    A.setStockCount(d, { orderId: pi1, itemCode: "PT-00320", qty: 10 }, at(now - 18 * DAY + 60000, "st"));
    A.setStockCount(d, { orderId: pi1, itemCode: "P-BOX-01", qty: 10 }, at(now - 18 * DAY + 120000, "st"));
    A.releaseOrder(d, { orderId: pi1 }, at(now - 17 * DAY, "planner"));
    const job = (code) => d.jobs.find((entry) => entry.orderId === pi1 && entry.itemCode === code);
    A.reportJob(d, { jobId: job("RB-DM01-02-OR01-202-18-70").id, qtyDone: 5, note: "รอบรีดที่ 1" }, at(now - 10 * DAY, "rb"));
    A.reportJob(d, { jobId: job("RB-DM01-01-OR01-200-0-72").id, qtyDone: 4.8 }, at(now - 9 * DAY, "rb"));
    A.reportJob(d, { jobId: job("PT-00320").id, qtyDone: 14 }, at(now - 8 * DAY, "pt"));
    A.reportJob(d, { jobId: job("SE-TP01-BK01-140-3-20").id, qtyDone: 120, qtyReject: 4, note: "ครึ่งแรก" }, at(now - 5 * DAY, "gr"));
    A.setJobStatus(d, { jobId: job("BG-0092").id, status: "hold" }, at(now - 4 * DAY, "bg"));

    // ใบร่างที่ระเบิดแล้ว รอปล่อยผลิต
    const pi2 = A.createOrder(d, {
      pi: "DEMO-26002", customer: "ลูกค้าสาธิต กรุงเทพ", country: "Thailand", orderedAt: day(-2), whDue: day(40),
      due: { RB: day(10), GR: day(18), PK: day(35) }, note: "",
    }, at(now - 2 * DAY, "planner"));
    A.addOrderItem(d, { orderId: pi2, fgCode: "DEMO-HL-24(B)-A", qty: 192 }, at(now - 2 * DAY + 600000, "planner"));
    A.explodeOrder(d, { orderId: pi2 }, at(now - DAY, "planner"));
    return d;
  }

  const api = { USERS, COMPOUNDS, ITEMS, emptyState, buildSeed };
  if (isNode) module.exports = api;
  else root.MNP_BOM_SEED = api;
})(typeof window !== "undefined" ? window : globalThis);
