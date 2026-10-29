// RubberFlow MES (แผนก RB โหมดทดสอบ) — ข้อมูลตั้งต้นสมมติ (ผู้ใช้สาธิต วัตถุดิบ สูตร แม่พิมพ์) และประวัติการผลิตจำลอง 2 สัปดาห์
// ยกมาจาก prototypes/rubber-mes/src/data/seed.js ทั้งไฟล์ ประวัติสร้างโดยเรียก action จริงของ modules/rubberflow-actions.js
// ทุกรายการจึงสอดคล้องกันเอง (ตัวเลขสุ่มด้วย seed คงที่ ผลเหมือนกันทุกครั้งเมื่อ now เท่ากัน)
// ข้อมูลทั้งหมดเป็นข้อมูลสมมติ ไม่ใช่ข้อมูลจริงหรือข้อมูลลูกค้า ไม่มี DOM/Supabase เทสต์ด้วย node --test
(function (root) {
  // โหลดหลัง modules/rubberflow-rules.js และ rubberflow-actions.js (ใน Node เทสต์ตั้ง globalThis.MNP_RUBBERFLOW_RULES/_ACTIONS ก่อน require ไฟล์นี้)
  const isNode = typeof module !== "undefined" && module.exports;
  const rules = () => root.MNP_RUBBERFLOW_RULES;
  const actions = () => root.MNP_RUBBERFLOW_ACTIONS;

  // บทบาทสาธิต 9 คน (ชื่อสมมติ) — ใช้เลือก "ทำหน้าที่เป็น" ในโมดูล ไม่ใช่บัญชีผู้ใช้ของระบบ
  const USERS = Object.freeze([
    { id: "U01", username: "admin", name: "ปกรณ์ ศรีวัฒนา", role: "admin" },
    { id: "U02", username: "manager", name: "อรุณี ทองประเสริฐ", role: "manager" },
    { id: "U03", username: "planner", name: "ณัฐพล บุญมา", role: "planner" },
    { id: "U04", username: "store", name: "สมศักดิ์ แก้วใส", role: "store" },
    { id: "U05", username: "mixer", name: "วีระ คงดี", role: "mixer" },
    { id: "U06", username: "extruder", name: "สุนทร ใจงาม", role: "extruder" },
    { id: "U07", username: "curer", name: "มานพ ศักดิ์ดี", role: "curer" },
    { id: "U08", username: "finisher", name: "จันทร์เพ็ญ ดวงแก้ว", role: "finisher" },
    { id: "U09", username: "qc", name: "พิมพ์ชนก อินทร์แก้ว", role: "qc" },
  ].map((user) => Object.freeze(user)));

  const MATERIALS = Object.freeze([
    { code: "EPDM-55", name: "ยาง EPDM (ENB 5%, ML 55)", category: "โพลิเมอร์", storage: "โกดัง A-1 (แห้ง ≤ 35°C)" },
    { code: "NBR-33", name: "ยาง NBR (ACN 33%)", category: "โพลิเมอร์", storage: "โกดัง A-1 (แห้ง ≤ 35°C)" },
    { code: "NR-SVR10", name: "ยางธรรมชาติ SVR 10", category: "โพลิเมอร์", storage: "โกดัง A-2" },
    { code: "CB-N550", name: "เขม่าดำ N550", category: "สารตัวเติม", storage: "โกดัง B-1" },
    { code: "CB-N330", name: "เขม่าดำ N330", category: "สารตัวเติม", storage: "โกดัง B-1" },
    { code: "CACO3", name: "แคลเซียมคาร์บอเนต", category: "สารตัวเติม", storage: "โกดัง B-2" },
    { code: "OIL-PAR", name: "น้ำมันพาราฟินิก", category: "น้ำมัน", storage: "ห้องเก็บของเหลว C-1" },
    { code: "ZNO", name: "ซิงค์ออกไซด์", category: "สารกระตุ้น", storage: "ห้องเคมี D-1" },
    { code: "STA", name: "กรดสเตียริก", category: "สารกระตุ้น", storage: "ห้องเคมี D-1" },
    { code: "S-80", name: "กำมะถัน 80% มาสเตอร์แบตช์", category: "สารคงรูป", storage: "ห้องเคมีควบคุมความชื้น D-2" },
    { code: "CBS", name: "สารเร่ง CBS", category: "สารเร่ง", storage: "ห้องเคมีควบคุมความชื้น D-2" },
    { code: "TMTD", name: "สารเร่ง TMTD", category: "สารเร่ง", storage: "ห้องเคมีควบคุมความชื้น D-2" },
    { code: "AO-6PPD", name: "สารกันเสื่อม 6PPD", category: "สารกันเสื่อม", storage: "ห้องเคมี D-1" },
  ].map((material) => Object.freeze(material)));

  const RECIPES = [
    {
      id: "RC-EPDM-DS01", name: "EPDM ซีลประตูรถยนต์ Rev.3", productCode: "DS-1825", productName: "ซีลยางประตูรถยนต์ 18×2.5",
      uom: "m", batchKg: 60, dumpTemp: 140, dumpTol: 6, mixSec: 300, restHours: 4, yieldPerKg: 6.1, revision: 3,
      items: [
        { materialCode: "EPDM-55", phr: 100 }, { materialCode: "CB-N550", phr: 90 }, { materialCode: "OIL-PAR", phr: 50 },
        { materialCode: "CACO3", phr: 30 }, { materialCode: "ZNO", phr: 5 }, { materialCode: "STA", phr: 1 },
        { materialCode: "S-80", phr: 1.5 }, { materialCode: "TMTD", phr: 1 }, { materialCode: "CBS", phr: 1.5 },
      ],
    },
    {
      id: "RC-NBR-OR02", name: "NBR โอริงทนน้ำมัน Rev.2", productCode: "OR-4030", productName: "โอริง NBR 40×3 mm",
      uom: "pcs", batchKg: 40, dumpTemp: 120, dumpTol: 5, mixSec: 240, restHours: 4, yieldPerKg: 240, revision: 2,
      items: [
        { materialCode: "NBR-33", phr: 100 }, { materialCode: "CB-N330", phr: 60 }, { materialCode: "ZNO", phr: 5 },
        { materialCode: "STA", phr: 1 }, { materialCode: "S-80", phr: 1.8 }, { materialCode: "CBS", phr: 1.2 },
        { materialCode: "AO-6PPD", phr: 2 },
      ],
    },
    {
      id: "RC-NR-AM01", name: "NR ยางกันสะเทือน (ร่าง)", productCode: "AM-6040", productName: "ยางกันสะเทือนแท่นเครื่อง 60×40",
      uom: "pcs", batchKg: 50, dumpTemp: 130, dumpTol: 6, mixSec: 270, restHours: 6, yieldPerKg: 7.5, revision: 1,
      items: [
        { materialCode: "NR-SVR10", phr: 100 }, { materialCode: "CB-N330", phr: 45 }, { materialCode: "ZNO", phr: 5 },
        { materialCode: "STA", phr: 2 }, { materialCode: "S-80", phr: 2.5 }, { materialCode: "CBS", phr: 1.2 },
        { materialCode: "AO-6PPD", phr: 1.5 },
      ],
    },
  ];

  const MOLDS = [
    { id: "DIE-DS-01", name: "หัวดาย Door Seal 18×2.5", kind: "die", unit: "m", perCycle: 1, cleanEvery: 6000, pmLimit: 250000, totalUsage: 182400 },
    { id: "DIE-OR-03", name: "หัวดายเส้นกลม Ø3.2", kind: "die", unit: "pcs", perCycle: 1, cleanEvery: 60000, pmLimit: 2000000, totalUsage: 640000 },
    { id: "CL-UHF-01", name: "สายอบไมโครเวฟ UHF ไลน์ 1", kind: "line", unit: "m", perCycle: 1, cleanEvery: 7000, pmLimit: 400000, totalUsage: 301200 },
    { id: "MD-OR-24", name: "แม่พิมพ์โอริง 24 cavity", kind: "mold", unit: "shot", perCycle: 24, cleanEvery: 1200, pmLimit: 60000, totalUsage: 41800 },
    { id: "MD-OR-16", name: "แม่พิมพ์โอริง 16 cavity", kind: "mold", unit: "shot", perCycle: 16, cleanEvery: 1200, pmLimit: 60000, totalUsage: 58600 },
  ];

  // ตัวสุ่มแบบกำหนด seed ได้ (mulberry32) ชุดข้อมูลจึงเหมือนกันทุกครั้ง
  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function emptyState() {
    return {
      version: 1,
      counters: {},
      users: USERS.map((user) => ({ ...user })),
      materials: MATERIALS.map((material) => ({ ...material })),
      materialLots: [],
      recipes: [],
      orders: [],
      requisitions: [],
      lots: [],
      transfers: [],
      fgBoxes: [],
      qcRecords: [],
      ncrs: [],
      molds: [],
      audit: [],
    };
  }

  function buildSeed(now = Date.now()) {
    const { DAY, HOUR, recipeLines } = rules();
    const A = actions();
    const rnd = mulberry32(20261028);
    const gauss = (mean, sd) => {
      const u = 1 - rnd();
      const v = rnd();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const r1 = (x, digits = 1) => +x.toFixed(digits);
    const d = emptyState();
    const user = (role) => USERS.find((row) => row.role === role);
    const at = (t, role) => ({ now: Math.round(t), user: user(role) });

    d.molds = MOLDS.map((mold) => ({ ...mold, usageSinceClean: Math.round(mold.cleanEvery * (0.2 + rnd() * 0.4)), lastCleanAt: now - 9 * DAY }));
    d.recipes = RECIPES.map((recipe) => ({
      ...recipe, items: recipe.items.map((item) => ({ ...item })),
      status: recipe.id === "RC-NR-AM01" ? "draft" : "approved", createdAt: now - 120 * DAY, createdBy: user("qc").name,
      approvedBy: recipe.id === "RC-NR-AM01" ? undefined : user("manager").name, approvedAt: now - 110 * DAY,
    }));

    // ล็อตวัตถุดิบ: หมดอายุแล้วหนึ่ง ใกล้หมดอายุหนึ่ง ที่เหลือปกติ
    const suppliers = ["บจก. โพลีเคม ไทย", "บจก. สยามคาร์บอน", "บจก. เคมีภัณฑ์ตะวันออก"];
    const t0 = now - 20 * DAY;
    MATERIALS.forEach((material, i) => {
      const big = material.category === "โพลิเมอร์" || material.category === "สารตัวเติม" || material.category === "น้ำมัน";
      const plan = [
        { daysToExpiry: 25 + i, qty: big ? 260 : 18 },
        { daysToExpiry: 150 + i * 3, qty: big ? 900 : 60 },
        { daysToExpiry: 300 + i * 2, qty: big ? 700 : 45 },
      ];
      if (material.code === "NR-SVR10") plan.unshift({ daysToExpiry: -4, qty: 85 });
      plan.forEach((p, k) => {
        const ctx = at(t0 - (3 - k) * 7 * DAY, "store");
        A.receiveMaterial(d, {
          materialCode: material.code, qtyKg: p.qty, expiry: now + p.daysToExpiry * DAY, supplier: suppliers[(i + k) % 3], coa: true,
        }, { ...ctx, now: Math.min(ctx.now, now + p.daysToExpiry * DAY - DAY) });
      });
    });
    d.materialLots.find((lot) => lot.materialCode === "CBS" && lot.initialKg === 45).status = "hold";

    const weighAll = (reqId, t) => {
      const requisition = d.requisitions.find((row) => row.id === reqId);
      requisition.lines.forEach((line, i) => {
        const tol = Math.max(0.02, line.targetKg * 0.015);
        A.weighLine(d, { reqId, index: i, actualKg: r1(line.targetKg + (rnd() - 0.5) * tol, 3) }, at(t + i * 4 * 60000, "store"));
      });
    };

    // เดินหนึ่ง batch ผ่านสายผลิต หยุดหลังขั้น `until`
    const chain = (orderId, start, until = "finishing", opts = {}) => {
      const order = d.orders.find((row) => row.id === orderId);
      const recipe = d.recipes.find((row) => row.id === order.recipeId);
      const isM = order.uom === "m";
      const reqId = A.createRequisition(d, { orderId, batches: 1 }, at(start, "store"));
      if (until === "request") return { reqId };
      weighAll(reqId, start + 15 * 60000);
      if (until === "weighed") return { reqId };
      const kg = recipeLines(recipe).reduce((sum, line) => sum + line.kgPerBatch, 0);
      const mx = A.recordMixing(d, {
        reqId, machine: isM ? "KN-01 Kneader 75L" : "BM-02 Banbury 110L", shift: "D",
        dumpTemp: r1(gauss(recipe.dumpTemp, recipe.dumpTol / 3.2)), mixSec: Math.round(gauss(recipe.mixSec, 8)),
        outputKg: r1(kg * (0.985 + rnd() * 0.008), 2), scrapKg: r1(kg * 0.004, 2), scrapReason: "เศษติดใบโรเตอร์",
      }, at(start + HOUR, "mixer"));
      const mxLot = d.lots.find((lot) => lot.id === mx);
      if (mxLot.qc === "hold") A.addQcRecord(d, { lotId: mx, values: { t90: 3.3, hardness: 65 }, result: "pass", note: "ตรวจซ้ำ MDR ผ่าน ปล่อยใช้งาน" }, at(start + 3 * HOUR, "qc"));
      if (until === "mixing") return { mx };
      const tr1 = A.createTransfer(d, { lotId: mx, qty: mxLot.goodQty }, at(start + 6 * HOUR, "mixer"));
      A.receiveTransfer(d, { id: tr1, qtyReceived: mxLot.goodQty, condition: "ok" }, at(start + 6.3 * HOUR, "extruder"));
      const useKg = mxLot.goodQty;
      const yieldQty = Math.floor(useKg * recipe.yieldPerKg * (isM ? 0.97 : 0.96));
      const ex = A.recordExtrusion(d, {
        transferId: tr1, useKg, reworkKg: r1(useKg * 0.05, 2), machine: isM ? "EX-11 Extruder Ø90" : "EX-12 Extruder Ø60", shift: "D",
        dieId: isM ? "DIE-DS-01" : "DIE-OR-03",
        thickness: opts.badThickness ? 2.68 : r1(gauss(2.5, 0.032), 3), width: r1(gauss(18, 0.06), 2), weightPerM: r1(gauss(160, 1.6), 1),
        goodQty: yieldQty, scrapQty: Math.round(yieldQty * 0.02), scrapReason: "เศษช่วงเริ่มเดินเครื่อง",
      }, at(start + 7 * HOUR, "extruder"));
      if (until === "extrusion") return { ex };
      const exLot = d.lots.find((lot) => lot.id === ex);
      const tr2 = A.createTransfer(d, { lotId: ex, qty: exLot.goodQty }, at(start + 9 * HOUR, "extruder"));
      A.receiveTransfer(d, { id: tr2, qtyReceived: exLot.goodQty, condition: "ok" }, at(start + 9.4 * HOUR, "curer"));
      const scrapC = Math.round(exLot.goodQty * (0.01 + rnd() * 0.015));
      const cu = A.recordCuring(d, {
        transferId: tr2, useQty: exLot.goodQty, moldId: isM ? "CL-UHF-01" : "MD-OR-24", shift: "E",
        temp: r1(gauss(200, 1.6)), time: Math.round(gauss(150, 2.5)), pressure: Math.round(gauss(150, 4)),
        goodQty: exLot.goodQty - scrapC, scrapQty: scrapC, scrapReason: "ฟองอากาศที่ผิว",
      }, at(start + 10 * HOUR, "curer"));
      const cuLot = d.lots.find((lot) => lot.id === cu);
      if (cuLot.qc === "hold") A.addQcRecord(d, { lotId: cu, values: { hardness: 66 }, result: "pass", note: "ตรวจ 100% ผ่าน" }, at(start + 11 * HOUR, "qc"));
      A.addQcRecord(d, {
        lotId: cu,
        values: { hardness: Math.round(gauss(65, 1.2)), tensile: r1(gauss(12.4, 0.5)), elongation: Math.round(gauss(380, 15)), sg: r1(gauss(1.18, 0.006), 3), t90: r1(gauss(3.2, 0.12), 2) },
        note: "สุ่มตรวจตามแผน Control Plan",
      }, at(start + 11.5 * HOUR, "qc"));
      if (until === "curing") return { cu };
      const tr3 = A.createTransfer(d, { lotId: cu, qty: cuLot.goodQty }, at(start + 12 * HOUR, "curer"));
      if (until === "to-finishing") return { tr3 };
      A.receiveTransfer(d, { id: tr3, qtyReceived: cuLot.goodQty, condition: "ok" }, at(start + 12.5 * HOUR, "finisher"));
      const scrapF = Math.round(cuLot.goodQty * 0.008);
      const fn = A.recordFinishing(d, {
        transferId: tr3, useQty: cuLot.goodQty, passedQty: cuLot.goodQty - scrapF, scrapQty: scrapF,
        perBox: isM ? 100 : 2000, grade: "A", qcResult: "pass", shift: "E", scrapReason: "ครีบเกิน/รอยตัด",
      }, at(start + 13 * HOUR, "finisher"));
      return { fn };
    };

    const mkOrder = (p, t) => A.createOrder(d, p, at(t, "planner"));
    const release = (id, t) => A.setOrderStatus(d, { id, status: "released" }, at(t, "planner"));

    // ใบสั่งผลิต 1: เสร็จไปเมื่อสองสัปดาห์ก่อน
    const o1 = mkOrder({ customer: "บจก. ไทยออโต้พาร์ท", customerPo: "TAP-PO-55102", recipeId: "RC-EPDM-DS01", targetQty: 1600, color: "ดำ", startDate: now - 15 * DAY, dueDate: now - 6 * DAY, note: "ตัดยาวม้วนละ 100 m" }, now - 16 * DAY);
    release(o1, now - 15.5 * DAY);
    for (let i = 0; i < 5; i += 1) chain(o1, now - (15 - i * 1.6) * DAY);

    // ใบสั่งผลิต 2: กำลังเดินอยู่ มี WIP ทุกสถานี
    const o2 = mkOrder({ customer: "Siam Motor Components", customerPo: "SMC-24-0871", recipeId: "RC-EPDM-DS01", targetQty: 2400, color: "ดำ", startDate: now - 6 * DAY, dueDate: now + 2 * DAY, priority: "urgent", note: "ลูกค้าขอ CoA ทุกล็อต" }, now - 7 * DAY);
    release(o2, now - 6.5 * DAY);
    chain(o2, now - 6 * DAY);
    chain(o2, now - 4.5 * DAY);
    chain(o2, now - 3 * DAY);
    chain(o2, now - 1.2 * DAY, "to-finishing");
    const held = chain(o2, now - 20 * HOUR, "extrusion", { badThickness: true });
    chain(o2, now - 13 * HOUR, "curing");
    chain(o2, now - 1.5 * HOUR, "mixing");

    // ใบสั่งผลิต 3: โอริง NBR มีประวัติ และใบเบิกหนึ่งใบยังอยู่บนตาชั่ง
    const o3 = mkOrder({ customer: "บจก. อีสเทิร์นไฮดรอลิก", customerPo: "EH-7720", recipeId: "RC-NBR-OR02", targetQty: 40000, color: "ดำ", startDate: now - 5 * DAY, dueDate: now + 6 * DAY }, now - 6 * DAY);
    release(o3, now - 5.5 * DAY);
    chain(o3, now - 5 * DAY);
    chain(o3, now - 2.5 * DAY);
    const pending = chain(o3, now - 40 * 60000, "request");
    const pr = d.requisitions.find((row) => row.id === pending.reqId);
    pr.lines.slice(0, 2).forEach((line, i) => A.weighLine(d, { reqId: pr.id, index: i, actualKg: r1(line.targetKg, 3) }, at(now - 30 * 60000 + i * 60000, "store")));

    // ใบสั่งผลิต 4 และ 5: วางแผนไว้เท่านั้น
    const o4 = mkOrder({ customer: "บจก. ไทยออโต้พาร์ท", customerPo: "TAP-PO-55377", recipeId: "RC-EPDM-DS01", targetQty: 3000, color: "ดำ", startDate: now + 3 * DAY, dueDate: now + 12 * DAY }, now - 2 * DAY);
    mkOrder({ customer: "บจก. อีสเทิร์นไฮดรอลิก", customerPo: "EH-7781", recipeId: "RC-NBR-OR02", targetQty: 25000, color: "ดำ", startDate: now + 5 * DAY, dueDate: now + 15 * DAY }, now - DAY);
    release(o4, now - 1.5 * DAY);

    // กรณีคุณภาพ
    A.createNcr(d, {
      title: "ความหนาโปรไฟล์เกินสเปก (2.68 mm)", stage: "extrusion", lotId: held.ex, severity: "major", defectQty: 120,
      whys: ["ความหนาเกินสเปก", "แรงดึงสายพานลากช้ากว่าค่าตั้ง", "เซนเซอร์ความเร็วสายพานอ่านค่าคลาดเคลื่อน", "ไม่มีรอบสอบเทียบเซนเซอร์ในแผน PM", ""],
      containment: "กักกันล็อตทั้งหมด ติดป้ายแดง และวัดความหนา 100%",
      corrective: "สอบเทียบเซนเซอร์และตั้งค่าความเร็วสายพานใหม่", preventive: "เพิ่มการสอบเทียบเซนเซอร์ใน PM รายเดือน", owner: user("qc").name,
    }, at(now - 18 * HOUR, "qc"));
    const n2 = A.createNcr(d, {
      title: "ฟองอากาศบนผิวหลังอบ", stage: "curing", lotId: d.lots.filter((lot) => lot.stage === "curing").at(-1).id, severity: "minor", defectQty: 35,
      whys: ["มีฟองอากาศ", "ความชื้นในคอมปาวด์สูง", "CaCO3 ถูกเก็บในพื้นที่ชื้น", "", ""],
      containment: "คัดแยกชิ้นงานที่มีฟองออก", corrective: "ย้าย CaCO3 ไปห้องควบคุมความชื้น", preventive: "เพิ่มการตรวจความชื้นตอนรับเข้า", owner: user("qc").name,
    }, at(now - 13 * DAY, "qc"));
    A.closeNcr(d, { id: n2, verification: "ติดตาม 5 ล็อตถัดไปไม่พบฟองอากาศ" }, at(now - 10 * DAY, "qc"));
    // ล็อตของ NCR ที่ปิดแล้วถูกปล่อยไปแล้ว จึงคืนสถานะ
    const closedLot = d.lots.find((lot) => lot.id === d.ncrs.find((ncr) => ncr.id === n2).lotId);
    closedLot.qc = "pass";
    closedLot.holdReasons = [];

    return d;
  }

  const api = { USERS, MATERIALS, emptyState, buildSeed };
  if (isNode) module.exports = api;
  else root.MNP_RUBBERFLOW_SEED = api;
})(typeof window !== "undefined" ? window : globalThis);
