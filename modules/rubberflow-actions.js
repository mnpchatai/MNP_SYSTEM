// RubberFlow MES (แผนก RB โหมดทดสอบ) — กฎธุรกิจทั้งหมดของสายผลิตยาง 4 สถานี ยกมาจาก prototypes/rubber-mes/src/data/actions.js ทั้งไฟล์
// ไม่มี DOM/Supabase เทสต์ด้วย node --test (scripts/tests/rubberflow-actions.test.mjs)
//
// ทุก action แก้ไข "ร่าง" ของ state ที่ clone มาแล้ว: action(draft, payload, ctx) โดย ctx = { now, user, remote?, idSuffix? }
// ถ้ากฎใดไม่ผ่านจะ throw Error ข้อความภาษาไทย (modules/rubberflow-store.js จับไปแสดง toast และไม่บันทึกร่างนั้น)
// ในเบราว์เซอร์จริงข้อมูลทุกชุดอยู่ในฐานข้อมูล (ctx.remote) ซึ่งตัดสินสิทธิ์ สถานะ และตัวเลขที่คำนวณเอง (สต็อกล็อตหลังชั่ง ยอดส่งต่อ/คงเหลือของใบส่งมอบ ยอดผลิตของใบ การใช้แม่พิมพ์) อีกครั้ง
// ตรงนี้คำนวณสำเนาของตัวเองให้หน้าจอเห็นทันที (ส่วนต่างที่ฐานข้อมูลตอบกลับแก้ให้ตรง) · โหมดสาธิตอยู่ใน localStorage (ข้อมูลสมมติ) กฎส่วนนั้นเป็นกฎของเดโม ไม่ใช่การควบคุมสิทธิ์ของระบบจริง — ดูหัวข้อ "RubberFlow MES" ใน README
// โหลดหลัง modules/rubberflow-rules.js (ใน Node เทสต์ตั้ง globalThis.MNP_RUBBERFLOW_RULES ก่อน require ไฟล์นี้)
(function (root) {
  const rules = () => root.MNP_RUBBERFLOW_RULES;

  // เลขเอกสาร <prefix>-<yyyymmdd>-<nn>: โหมดฐานข้อมูลออกจากเลขสูงสุดของวันนั้นในรายการที่มี + 1 (เครื่องอื่นออกซ้ำ = ฐานข้อมูลตอบ RF_STALE แล้วบันทึกอีกครั้งได้) · โหมดสาธิตใช้ตัวนับในเครื่อง
  function nextId(d, prefix, now, ctx, rows, idOf) {
    const key = `${prefix}-${rules().ymd(now)}`;
    if (ctx?.remote) {
      const top = (rows ?? []).reduce((max, row) => {
        const id = String(idOf(row));
        const tail = id.startsWith(`${key}-`) ? id.slice(key.length + 1) : "";
        return /^\d+$/.test(tail) ? Math.max(max, Number(tail)) : max;
      }, 0);
      return `${key}-${String(top + 1).padStart(2, "0")}`;
    }
    d.counters[key] = (d.counters[key] || 0) + 1;
    return `${key}-${String(d.counters[key]).padStart(2, "0")}`;
  }
  const rowId = (row) => row.id;

  function audit(d, ctx, action, detail) {
    d.audit.unshift({ at: ctx.now, user: ctx.user?.name || "ระบบ", action, detail });
    if (d.audit.length > 400) d.audit.length = 400;
  }

  function fail(message) {
    throw new Error(message);
  }

  // ค่าที่ขาด (undefined / null / ว่าง) ไม่พิมพ์เป็นคำว่า undefined ในข้อความ: ใช้คำกลางแทน · คืนมีช่องว่างนำหน้าเมื่อมีค่า (ต่อท้ายชื่อสิ่งที่หาไม่พบ)
  const ref = (value, fallback = "ที่เลือก") => (value === undefined || value === null || String(value).trim() === "" ? fallback : ` ${String(value).trim()}`);

  function num(value, label) {
    const n = Number(value);
    if (value === "" || value === null || value === undefined || Number.isNaN(n)) fail(`กรุณาระบุ${label}`);
    return n;
  }

  // รหัสวัตถุดิบ / รหัสสูตร ใช้รูปแบบเดียวกับฐานข้อมูล (rf_materials.code, rf_recipes.recipe_code) เพื่อบอกผู้ใช้ก่อนส่ง
  const MATERIAL_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
  const RECIPE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

  const find = (rows, id, label) => rows.find((row) => row.id === id) || fail(`ไม่พบ${label}${ref(id)}`);

  function startOrderIfReleased(d, orderId, ctx) {
    const order = d.orders.find((row) => row.id === orderId);
    if (order && order.status === "released") {
      order.status = "in_progress";
      audit(d, ctx, "เริ่มผลิต", order.id);
    }
  }

  // ---------- ใบสั่งผลิต ----------

  // โหมดฐานข้อมูล (ctx.remote): ผู้ใช้คือบัญชีทดสอบที่มี flags planner / rb / rbHead (modules/rubberflow-store.js personaUser) · ฐานข้อมูลตัดสินสิทธิ์จริงอีกครั้ง
  // ตรงนี้ปฏิเสธก่อนส่งเพื่อให้ได้ข้อความไทย · โหมดสาธิต (localStorage) ไม่ตรวจสิทธิ์ในคำสั่ง เหมือนเดิม
  // ฝ่ายวางแผนคลังเคมี (ตรงกับ private.rf_chem_planner ของ 20261220010000 และ modules/rubberflow-store.js): แผนก PP หรือ admin / ผู้ช่วยผู้จัดการโรงงานขึ้นไป
  // ไม่ใช่ user.planner (รวมผู้จัดการแผนกทุกแผนกในสายผลิต) · นับคลัง RB = กลุ่มนี้ หรือผู้จัดการแผนก (department_manager) ของแผนก RB
  const CHEM_PLAN_ROLE_CODES = Object.freeze(["admin", "assistant_factory_manager", "factory_manager", "general_manager"]);
  const isChemPlanner = (user) => Boolean(user) && (user.role === "admin" || CHEM_PLAN_ROLE_CODES.includes(user.roleCode) || String(user.dept ?? "").toUpperCase() === "PP");
  const isRbCountHead = (user) => Boolean(user?.rb) && user.roleCode === "department_manager";
  const MAY = Object.freeze({
    master: (user) => Boolean(user.planner || user.rb), // วัตถุดิบ / สูตร (ร่าง) / เปิดใบสั่งผลิต: ฝ่ายวางแผนขึ้นไป หรือพนักงานแผนก RB
    approve: (user) => Boolean(user.rbHead), // อนุมัติสูตร: หัวหน้า RB ขึ้นไป
    // เปิดใบสั่งผลิตใหม่ และปล่อยผลิต (planned → released) = กลุ่มวางแผนเท่านั้น (โรงงานขั้น 6 · ทำที่โมดูล BOM) · แผนก RB และหัวหน้า RB เริ่มงาน พัก ผลิตต่อ ปิดงานได้ตามเดิม (work)
    openOrder: (user) => Boolean(user.planner),
    release: (user) => Boolean(user.planner), // ปล่อยผลิต
    work: (user) => Boolean(user.planner || user.rb), // สถานะอื่นของใบสั่งผลิต
    closePurchaseLine: (user) => Boolean(user.st || user.role === "admin"), // ปิดยอดที่เหลือของใบสั่งซื้อ: สิทธิ์เดียวกับรับเข้า (ST) ข้อความปฏิเสธของตัวเอง
    receiveMaterial: (user) => Boolean(user.st || user.role === "admin"), // รับวัตถุดิบเข้าคลัง (รวมรับเข้าตามใบสั่งซื้อ): แผนก ST เท่านั้น (admin ไว้แก้ปัญหา)
    holdMaterial: (user) => Boolean(user.planner || user.st || user.qa), // กักกันล็อตวัตถุดิบ: ST หรือ QA (ปลดกักกัน = releaseMaterial)
    requisition: (user) => Boolean(user.planner || user.rb), // เบิกเคมี (สร้างใบเบิกและจ่ายทันที) / จ่ายใบเก่าที่ค้างชั่ง: แผนก RB
    station: (user) => Boolean(user.planner || user.rb), // ผสม ฉีด อบ ตกแต่ง ข้ามเวลาบ่ม ทำความสะอาดแม่พิมพ์: แผนก RB
    sendTransfer: (user) => Boolean(user.planner || user.rb), // สร้างใบส่งมอบ WIP: แผนก RB
    receiveTransfer: (user) => Boolean(user.planner || user.rb), // รับมอบ WIP ระหว่างสถานี: แผนก RB (20261204010000 · เดิมแผนก SR)
    // กล่องสินค้า (20261207010000): รับเข้าคลัง / ส่งมอบให้ลูกค้า = แผนก WH ทุกบทบาท หรือ admin (กลุ่มวางแผนดูอย่างเดียว) · ย้อน = ผู้จัดการแผนก WH หรือ admin
    receiveBoxes: (user) => Boolean(user.wh || user.role === "admin"),
    shipBoxes: (user) => Boolean(user.wh || user.role === "admin"),
    reverseBoxes: (user) => Boolean(user.whHead || user.role === "admin"),
    qc: (user) => Boolean(user.planner || user.qa), // ผลตรวจ เปิด/ปิด NCR: แผนก QA
    qaRelease: (user) => Boolean(rules().canQaRelease?.(user)), // ผลตรวจผ่าน/ไม่ผ่านของล็อตที่กัก: หัวหน้า QA หรือผู้จัดการโรงงานขึ้นไป (นิยามเดียว rules.canQaRelease · ฐานข้อมูล RF_QA_HEAD_ONLY)
    releaseMaterial: (user) => Boolean(rules().canReleaseMaterial?.(user)), // ปลดกักกันวัตถุดิบ: หัวหน้า QA หรือหัวหน้า ST หรือผู้จัดการโรงงานขึ้นไป (นิยามเดียว rules.canReleaseMaterial · ฐานข้อมูล RF_MATERIAL_RELEASE_HEAD_ONLY)
    fillNcr: (user) => Boolean(user.planner || user.qa || user.rb), // กรอกการแก้ไข/ป้องกันของ NCR ที่เปิดอยู่: QA หรือ RB
    editMold: (user) => Boolean(user.planner || user.rb), // เพิ่ม/แก้แม่พิมพ์: แผนก RB
    purchase: (user) => Boolean(user.st || user.role === "admin"), // สั่งซื้อวัตถุดิบ (สร้างใบสั่งซื้อ): แผนก ST เท่านั้น (admin ไว้แก้ปัญหา)
    cancelPurchase: (user) => Boolean(user.st || user.role === "admin"), // ยกเลิกใบสั่งซื้อ: แผนก ST
    skipRest: (user) => Boolean(user.rbHead || user.qa), // ข้ามเวลาบ่ม: หัวหน้า RB (รวมผู้ช่วยผู้จัดการโรงงานขึ้นไปและ admin) หรือแผนก QA พร้อมเหตุผล (20261128010000)
    returnRequisition: (user) => Boolean(user.st || user.role === "admin"), // รับเคมีที่เบิกไปแล้วคืนเข้าล็อตเดิม (WO ถูกยกเลิก): แผนก ST (admin ไว้แก้ปัญหา)
    // คลังเคมี ST / RB (20261220010000 · ตรงกับ private.rf_save_chem_docs)
    requestChem: (user) => Boolean(isChemPlanner(user) || user.rb), // ขอเบิกเคมีจาก ST / ยกเลิกใบที่ยังไม่จ่าย / คืนเคมีให้ ST / คืนใบเบิกคลัง RB ของ WO ที่ยกเลิก: แผนก RB หรือฝ่ายวางแผนคลังเคมี
    issueChem: (user) => Boolean(user.st || user.role === "admin"), // จ่ายเคมีตามใบขอเบิก / ปิดยอดที่เหลือ / รับคืน / ปฏิเสธใบคืน
    countRb: (user) => Boolean(isChemPlanner(user) || isRbCountHead(user)), // นับ / ปรับยอดคลัง RB: ผู้จัดการแผนก RB หรือฝ่ายวางแผนคลังเคมี
  });
  const MAY_TEXT = Object.freeze({
    master: "แก้ข้อมูลหลักของ RubberFlow ได้โดยฝ่ายวางแผน ผู้จัดการ ผู้ดูแลระบบ หรือพนักงานแผนก RB",
    approve: "อนุมัติสูตรได้โดยผู้จัดการแผนก RB หรือผู้ช่วยผู้จัดการแผนก RB ผู้จัดการโรงงานขึ้นไป หรือผู้ดูแลระบบ",
    openOrder: "เปิดใบสั่งผลิตได้โดยฝ่ายวางแผนหรือผู้จัดการ (ที่โมดูล BOM)",
    release: "ปล่อยผลิตได้โดยฝ่ายวางแผนหรือผู้จัดการ (ที่โมดูล BOM)",
    work: "เปลี่ยนสถานะใบสั่งผลิตได้โดยฝ่ายวางแผน ผู้จัดการ หรือพนักงานแผนก RB",
    receiveMaterial: "รับวัตถุดิบเข้าคลังได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
    closePurchaseLine: "ปิดยอดที่เหลือของใบสั่งซื้อได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
    holdMaterial: "กักกันล็อตวัตถุดิบได้โดยแผนกคลังวัตถุดิบ (ST) หรือ QA",
    requisition: "เบิกเคมีได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    station: "บันทึกการผลิตของสถานีได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    sendTransfer: "สร้างใบส่งมอบ WIP ได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    receiveTransfer: "รับมอบ WIP ได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    receiveBoxes: "รับกล่องเข้าคลังได้โดยแผนกคลังสินค้าสำเร็จรูป (WH) หรือผู้ดูแลระบบเท่านั้น",
    shipBoxes: "ส่งมอบกล่องสินค้าได้โดยแผนกคลังสินค้าสำเร็จรูป (WH) หรือผู้ดูแลระบบเท่านั้น",
    reverseBoxes: "ย้อนการรับเข้าหรือการส่งมอบกล่องได้โดยผู้จัดการแผนกคลังสินค้าสำเร็จรูป (WH) หรือผู้ดูแลระบบเท่านั้น",
    qc: "บันทึกผลตรวจและเปิด/ปิด NCR ได้โดยแผนก QA หรือฝ่ายวางแผน",
    qaRelease: "ปล่อยล็อตที่กักหรือตัดสินผ่าน/ไม่ผ่านได้เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ · พนักงาน QA บันทึกกักต่อ/ตรวจซ้ำได้",
    releaseMaterial: "ปลดกักกันวัตถุดิบได้เฉพาะหัวหน้า QA หัวหน้า ST หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ",
    fillNcr: "กรอกการแก้ไขและป้องกันของ NCR ได้โดยแผนก QA พนักงานแผนก RB หรือฝ่ายวางแผน",
    editMold: "เพิ่ม/แก้แม่พิมพ์ได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    purchase: "สั่งซื้อวัตถุดิบได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
    cancelPurchase: "ยกเลิกใบสั่งซื้อได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
    skipRest: "ข้ามเวลาบ่มได้โดยผู้จัดการแผนก RB หรือผู้ช่วยผู้จัดการแผนก RB ผู้ช่วยผู้จัดการโรงงานขึ้นไป หรือแผนก QA เท่านั้น",
    returnRequisition: "รับเคมีคืนเข้าคลังได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
    requestChem: "ขอเบิกเคมีจากคลัง ST และคืนเคมีให้ ST ได้โดยพนักงานแผนก RB ฝ่ายวางแผน (PP) หรือผู้ช่วยผู้จัดการโรงงานขึ้นไป",
    issueChem: "จ่ายเคมี ปิดยอดใบขอเบิก และรับเคมีคืนได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
    countRb: "นับและปรับยอดคลังเคมี RB ได้โดยผู้จัดการแผนก RB ฝ่ายวางแผน (PP) หรือผู้ช่วยผู้จัดการโรงงานขึ้นไปเท่านั้น",
  });
  function needRight(ctx, right) {
    if (!ctx.remote) return;
    if (!ctx.user) fail("ไม่พบบัญชีผู้ใช้ทดสอบ");
    if (!MAY[right](ctx.user)) fail(`บัญชีนี้ไม่มีสิทธิ์: ${MAY_TEXT[right]}`);
  }

  // เลขใบสั่งผลิต: โหมดฐานข้อมูลออกจากเลขสูงสุดของวันนั้นในข้อมูลที่มี + 1 (เครื่องอื่นออกซ้ำ = ฐานข้อมูลตอบ RF_STALE แล้วบันทึกอีกครั้งได้) · โหมดสาธิตใช้ตัวนับในเครื่อง
  function nextOrderId(d, ctx) {
    if (!ctx.remote) return nextId(d, "WO", ctx.now);
    const key = `WO-${rules().ymd(ctx.now)}`;
    const top = d.orders.reduce((max, order) => {
      const match = /^WO-(\d{8})-(\d+)$/.exec(String(order.id));
      return match && `WO-${match[1]}` === key ? Math.max(max, Number(match[2])) : max;
    }, 0);
    return `${key}-${String(top + 1).padStart(2, "0")}`;
  }

  // ---------- ใบสั่งผลิต ----------

  function createOrder(d, p, ctx) {
    needRight(ctx, "openOrder");
    const { currentRecipe, approvedRecipes } = rules();
    if (!String(p.recipeId ?? "").trim()) fail(approvedRecipes(d.recipes).length ? "กรุณาเลือกสินค้า / สูตร" : "ยังไม่มีสูตรที่อนุมัติ ต้องอนุมัติสูตรก่อนจึงเปิดใบสั่งผลิตได้");
    const recipe = currentRecipe(d.recipes, p.recipeId) || fail(`ไม่พบสูตร${ref(p.recipeId)}`);
    // สูตรที่ใช้เปิดใบ = revision ที่อนุมัติแล้วของรหัสนั้น (ใบผูก revision ที่เปิดไว้)
    if (recipe.status !== "approved") fail("สูตรนี้ยังไม่ได้รับอนุมัติ ใช้เปิดใบสั่งผลิตไม่ได้");
    if (!p.customer?.trim()) fail("กรุณาระบุชื่อลูกค้า");
    const targetQty = num(p.targetQty, "จำนวนเป้าหมาย");
    if (targetQty <= 0) fail("จำนวนเป้าหมายต้องมากกว่า 0");
    if (!Number.isFinite(p.startDate) || !Number.isFinite(p.dueDate)) fail("กรุณาระบุวันเริ่มผลิตและวันกำหนดส่ง");
    if (p.dueDate < p.startDate) fail("วันส่งมอบต้องไม่ก่อนวันเริ่มผลิต");
    const id = nextOrderId(d, ctx);
    const order = {
      id,
      customer: p.customer.trim(),
      customerPo: p.customerPo?.trim() || "",
      recipeId: recipe.id,
      recipeRevision: recipe.revision,
      productCode: recipe.productCode || "",
      uom: recipe.uom,
      color: p.color || "ดำ",
      targetQty,
      producedQty: 0,
      startDate: p.startDate,
      dueDate: p.dueDate,
      priority: p.priority || "normal",
      note: p.note || "",
      status: "planned",
      createdAt: ctx.now,
      createdBy: ctx.user?.name,
    };
    // ใบที่สร้างจากงาน RB ของ BOM: หน่วยของงาน (เส้น/ชิ้น) พร้อมกิโลกรัมคอมปาวด์ · ฐานข้อมูลตรวจงานและผูกงานให้ในคำสั่งเดียวกัน
    if (p.sourceJobId) {
      const kg = Number(p.targetKg);
      order.sourceJobId = String(p.sourceJobId).trim();
      order.uom = String(p.uom || recipe.uom);
      if (Number.isFinite(kg) && kg > 0) {
        order.targetKg = kg;
        order.kgPerUnit = Number(p.kgPerUnit) > 0 ? Number(p.kgPerUnit) : kg / targetQty;
      }
    }
    d.orders.unshift(order);
    audit(d, ctx, "เปิดใบสั่งผลิต", `${id} ${rules().recipeLabel(recipe)} ${targetQty} ${order.uom}`);
    return id;
  }

  const ORDER_FLOW = Object.freeze({
    planned: ["released", "cancelled"],
    released: ["in_progress", "on_hold", "cancelled"],
    in_progress: ["on_hold", "completed"],
    on_hold: ["in_progress"],
  });

  // producedQty: ปริมาณผลิตจริงตอนปิดใบ (หน่วยของใบ) ใช้เฉพาะโหมดสาธิต · โหมดฐานข้อมูลยอดผลิตมาจากล็อตตกแต่งที่นับแล้ว ฐานข้อมูลคำนวณเองและไม่รับค่าจากหน้าจอ
  // (ยอดดีของล็อตตกแต่งที่ผ่าน QC ส่งกลับงาน BOM ทีละล็อตตอนที่ล็อตผ่าน ไม่ใช่ตอนปิดใบ จึงปิดใบที่ผูกงาน BOM ได้โดยไม่ต้องมียอดผลิต)
  function setOrderStatus(d, { id, status, producedQty }, ctx) {
    const order = find(d.orders, id, "ใบสั่งผลิต");
    if (!(ORDER_FLOW[order.status] || []).includes(status)) fail(`เปลี่ยนสถานะจาก ${order.status} เป็น ${status} ไม่ได้`);
    needRight(ctx, status === "released" ? "release" : "work");
    if (status === "completed") {
      if (!ctx.remote) {
        if (producedQty !== undefined && producedQty !== null && producedQty !== "") {
          const produced = Number(producedQty);
          if (!Number.isFinite(produced) || produced < 0) fail("ปริมาณผลิตจริงต้องเป็นตัวเลขไม่ติดลบ");
          order.producedQty = produced;
        }
        if (order.sourceJobId && !(Number(order.producedQty) > 0)) fail("ใบสั่งผลิตนี้มาจากงาน BOM กรุณาระบุปริมาณผลิตจริง (มากกว่า 0) ก่อนปิดใบ");
      }
      order.completedAt = ctx.now;
    } else if (status === "released") {
      order.releasedAt = ctx.now;
      order.releasedBy = ctx.user?.name;
    } else if (status === "cancelled") order.cancelledAt = ctx.now;
    order.status = status;
    audit(d, ctx, "เปลี่ยนสถานะใบสั่งผลิต", `${id} → ${status}`);
  }

  // ---------- วัตถุดิบ (ข้อมูลหลัก) ----------

  // เพิ่มหรือแก้วัตถุดิบ (รหัสแก้ไม่ได้) · ลบไม่ได้ ใช้ active=false แทน · ระเบียนที่ไม่มี active (ชุดสาธิต) ถือว่าใช้งานอยู่
  function saveMaterial(d, p, ctx) {
    needRight(ctx, "master");
    const code = String(p.code ?? "").trim();
    if (!code) fail("กรุณาระบุรหัสวัตถุดิบ");
    if (!MATERIAL_CODE.test(code)) fail("รหัสวัตถุดิบใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง (ไม่มีช่องว่าง) ขึ้นต้นด้วยตัวอักษรหรือตัวเลข ยาวไม่เกิน 40 ตัวอักษร");
    const name = String(p.name ?? "").trim();
    if (!name) fail("กรุณาระบุชื่อวัตถุดิบ");
    const existing = d.materials.find((row) => row.code === code);
    // สต็อกขั้นต่ำ (kg, 0–1e9) และอายุการเก็บ (วัน, จำนวนเต็ม 1–3650) · ไม่ส่ง/เว้นว่าง = คงค่าเดิม (วัตถุดิบใหม่ 0 และ 180)
    const blank = (value) => value === undefined || value === null || String(value).trim() === "";
    const safetyKg = blank(p.safetyKg) ? existing?.safetyKg ?? 0 : Number(p.safetyKg);
    if (!Number.isFinite(safetyKg) || safetyKg < 0 || safetyKg > 1e9) fail("สต็อกขั้นต่ำต้องเป็นตัวเลข 0 ขึ้นไป");
    const shelfLifeDays = blank(p.shelfLifeDays) ? existing?.shelfLifeDays ?? 180 : Number(p.shelfLifeDays);
    if (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 1 || shelfLifeDays > 3650) fail("อายุการเก็บ (วัน) ต้องเป็นจำนวนเต็ม 1–3650");
    const fields = {
      name: name.slice(0, 120),
      category: String(p.category ?? "").trim().slice(0, 60),
      storage: String(p.storage ?? "").trim().slice(0, 120),
      uom: String(p.uom ?? "").trim().slice(0, 12) || "kg",
      active: p.active === undefined ? true : !(p.active === false || p.active === "0" || p.active === "false"),
      safetyKg,
      shelfLifeDays,
    };
    if (existing) {
      Object.assign(existing, fields);
      audit(d, ctx, "แก้ข้อมูลวัตถุดิบ", `${code}${fields.active ? "" : " (เลิกใช้)"}`);
    } else {
      d.materials.push({ code, ...fields, createdAt: ctx.now, createdBy: ctx.user?.name });
      audit(d, ctx, "เพิ่มวัตถุดิบ", code);
    }
    return code;
  }

  // ---------- สูตรยาง ----------

  // ค่าที่ฟอร์มสูตรกรอก (ใช้ทั้งสร้างและออก revision ใหม่) · รหัสสูตรไม่อยู่ในนี้
  // ผสมสองขั้น: อุณหภูมิ 0–1000 °C เวลา (นาที) มากกว่า 0 ถึง 1440 · ใช้ทั้งค่าตามสูตรและค่าที่บันทึกที่สถานีผสม
  function stageValues(row, stage, { requireTime = true } = {}) {
    const temp = (value, label) => {
      const n = num(value, `${label} ขั้น ${stage}`);
      if (n < 0 || n > 1000) fail(`${label} ขั้น ${stage} ต้องอยู่ระหว่าง 0–1000 °C`);
      return n;
    };
    const mixerTemp = temp(row?.mixerTemp, "อุณหภูมิเครื่องผสม");
    const dumpTemp = temp(row?.dumpTemp, "อุณหภูมิปล่อยยาง");
    const mixMin = num(row?.mixMin, `เวลาผสม ขั้น ${stage}`);
    if (requireTime && (mixMin <= 0 || mixMin > 1440)) fail(`เวลาผสม ขั้น ${stage} ต้องมากกว่า 0 และไม่เกิน 1,440 นาที`);
    return { stage, mixerTemp, dumpTemp, mixMin };
  }

  // สเปกมิติการฉีดของสูตร (20261129010000 · ตรงกับ private.rf_parse_extrusion_spec): ต่อค่า (ความหนา ความกว้าง น้ำหนักต่อเมตร) ไม่กรอกทั้งคู่ = ไม่มีสเปกของค่านั้น
  // กรอกต้องครบทั้งค่ามาตรฐาน (> 0) และค่าเผื่อ (>= 0) ไม่เกิน 1,000,000 · ไม่มีค่าใดเลย = undefined (สูตรไม่มีสเปก ล็อตฉีดไม่ถูกกักตามมิติ)
  const SPEC_MAX = 1000000;
  function extrusionSpecField(raw) {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "object" || Array.isArray(raw)) fail("สเปกการฉีดไม่ถูกต้อง");
    const { EXTRUSION_KEYS, SPECS } = rules();
    const blank = (value) => value === undefined || value === null || String(value).trim() === "";
    const out = {};
    for (const key of EXTRUSION_KEYS) {
      const row = raw[key] ?? {};
      if (blank(row.target) && blank(row.tol)) continue;
      const label = SPECS.extrusion[key].label;
      if (blank(row.target) || blank(row.tol)) fail(`สเปกการฉีด: กรอก${label}ทั้งค่ามาตรฐานและค่าเผื่อ หรือเว้นว่างทั้งคู่`);
      const target = Number(row.target);
      const tol = Number(row.tol);
      if (!Number.isFinite(target) || target <= 0 || target > SPEC_MAX) fail(`สเปกการฉีด: ค่ามาตรฐานของ${label}ต้องมากกว่า 0 และไม่เกิน 1,000,000`);
      if (!Number.isFinite(tol) || tol < 0 || tol > SPEC_MAX) fail(`สเปกการฉีด: ค่าเผื่อของ${label}ต้องไม่ติดลบและไม่เกิน 1,000,000`);
      out[key] = { target, tol };
    }
    return Object.keys(out).length ? out : undefined;
  }

  // รายการวัตถุดิบของสูตร (ตรงกับ private.rf_parse_items): สูตรแบบน้ำหนัก (ทุกบรรทัดใส่ kg) หรือสูตรเดิมแบบ PHR · ปนกันไม่ได้ · รหัสวัตถุดิบซ้ำไม่ได้ · ไม่เกิน 100 รายการ
  // แบบน้ำหนัก: บรรทัดคือ { materialCode, stage 0..3, kg (กิโลกรัม: 0 หรือ 0.001–10000 ไม่เกิน 4 ตำแหน่ง), unit kg|g (หน่วยที่กรอก), phr = kg } · kg = 0 เก็บไว้เป็นบรรทัด "ไม่ใส่" (ไม่เบิก ไม่ชั่ง) · ต้องมีอย่างน้อยหนึ่งบรรทัดที่ kg > 0
  const blankValue = (value) => value === undefined || value === null || String(value).trim() === "";
  const MAX_RECIPE_ITEMS = 100;
  function recipeItems(p) {
    const { PARTS, weightBatchKg } = rules();
    const raw = (Array.isArray(p.items) ? p.items : []).filter((item) => item && typeof item === "object");
    const weight = raw.some((item) => item.kg !== undefined);
    const items = [];
    for (const item of raw) {
      const code = String(item.materialCode ?? "").trim();
      if (!weight) {
        if (code && Number(item.phr) > 0) items.push({ materialCode: code, phr: Number(item.phr), stage: Number(item.stage) === 2 ? 2 : 1 });
        continue;
      }
      if (!code && blankValue(item.kg)) continue;
      if (!code) fail("มีปริมาณที่ยังไม่ได้เลือกวัตถุดิบ");
      if (item.kg === undefined) fail("สูตรต้องใส่เป็นน้ำหนักทุกรายการ ผสมกับ PHR ไม่ได้");
      if (blankValue(item.kg)) fail(`กรุณาระบุปริมาณของ ${code} (ไม่ใส่ให้กรอก 0)`);
      const kg = Number(item.kg);
      if (!Number.isFinite(kg) || kg < 0 || kg > 10000) fail(`ปริมาณของ ${code} ต้องเป็นตัวเลข 0 ขึ้นไปและไม่เกิน 10,000 kg`);
      if (Math.abs(kg * 1e4 - Math.round(kg * 1e4)) > 1e-6) fail(`ปริมาณของ ${code} ใส่ได้ไม่เกิน 4 ตำแหน่งทศนิยมของกิโลกรัม`);
      if (kg > 0 && kg < 0.001) fail(`ปริมาณของ ${code} ถ้าใส่ต้องไม่น้อยกว่า 0.001 kg (1 g) ไม่ใส่ให้กรอก 0`);
      const unit = blankValue(item.unit) ? "kg" : String(item.unit);
      if (unit !== "kg" && unit !== "g") fail(`หน่วยของ ${code} ต้องเป็น kg หรือ g`);
      const stage = blankValue(item.stage) ? 1 : Number(item.stage);
      if (!PARTS.includes(stage)) fail(`ขั้นของ ${code} ต้องเป็นขั้นเตรียมวัตถุดิบ หรือขั้น 1–3`);
      const rounded = Math.round(kg * 1e4) / 1e4;
      items.push({ materialCode: code, stage, kg: rounded, unit, phr: rounded });
    }
    if (!items.length) fail("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
    if (items.length > MAX_RECIPE_ITEMS) fail(`สูตรมีวัตถุดิบได้ไม่เกิน ${MAX_RECIPE_ITEMS} รายการ`);
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.materialCode)) fail(`วัตถุดิบ ${item.materialCode} ซ้ำในสูตร`);
      seen.add(item.materialCode);
    }
    if (weight && !items.some((item) => item.kg > 0)) fail("สูตรต้องมีวัตถุดิบที่ใส่ปริมาณมากกว่า 0 อย่างน้อย 1 รายการ");
    return { items, batchKg: weight ? weightBatchKg(items) : null };
  }

  // ค่าที่เป็น 0 ได้ (ค่าเผื่ออุณหภูมิปล่อยยาง · เวลาบ่มขั้นต่ำ): ว่าง / ไม่ส่ง = ค่าเริ่มต้น · 0 = 0 จริง (เดิม 0 ถูกแทนด้วยค่าเริ่มต้น) · ช่วงเดียวกับฐานข้อมูล (private.rf_save_recipes)
  function zeroOk(value, fallback, max, label) {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > max) fail(`${label}ต้องเป็นตัวเลข 0 ถึง ${max}`);
    return number;
  }

  function recipeFields(p) {
    const { items, batchKg } = recipeItems(p);
    const productCode = String(p.productCode ?? "").trim();
    if (productCode.length > 60) fail("รหัสสินค้ายาวเกิน 60 ตัวอักษร");
    const extrusionSpec = extrusionSpecField(p.extrusionSpec);
    return {
      ...(extrusionSpec ? { extrusionSpec } : {}),
      productCode,
      uom: p.uom || "m",
      batchKg: batchKg ?? num(p.batchKg, "น้ำหนักต่อชุดผสม"),
      stages: rules().MIX_STAGES.map((stage) => stageValues((p.stages ?? []).find((row) => Number(row?.stage) === stage), stage)),
      dumpTol: zeroOk(p.dumpTol, 5, 100, "ค่าเผื่ออุณหภูมิปล่อยยาง"),
      restHours: zeroOk(p.restHours, 4, 1000, "เวลาบ่มขั้นต่ำ"),
      yieldPerKg: num(p.yieldPerKg, "ผลผลิตต่อกิโลกรัม"),
      items,
    };
  }

  function createRecipe(d, p, ctx) {
    needRight(ctx, "master");
    if (!p.id?.trim()) fail("กรุณากรอกรหัสสูตร");
    if (!RECIPE_CODE.test(p.id.trim())) fail("รหัสสูตรใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง (ไม่มีช่องว่าง) ขึ้นต้นด้วยตัวอักษรหรือตัวเลข ยาวไม่เกิน 60 ตัวอักษร");
    if (d.recipes.some((recipe) => recipe.id === p.id.trim())) fail("รหัสสูตรนี้มีอยู่แล้ว");
    d.recipes.push({
      id: p.id.trim(),
      ...recipeFields(p),
      revision: 1,
      status: "draft",
      createdAt: ctx.now,
      createdBy: ctx.user?.name,
    });
    audit(d, ctx, "สร้างสูตรใหม่", p.id);
  }

  // แก้สูตร: revision ที่อนุมัติแล้วแก้ตรงๆ ไม่ได้ → ออก revision ใหม่ (revision + 1) เป็นร่างของรหัสเดิม · มีร่างค้างอยู่แล้ว = แก้ร่างนั้น
  // คืนเลข revision ที่ถูกแก้/ออกใหม่
  function saveRecipe(d, p, ctx) {
    needRight(ctx, "master");
    const { revisionsOf } = rules();
    const id = String(p.id ?? "").trim();
    const history = revisionsOf(d.recipes, id);
    if (!history.length) fail(`ไม่พบสูตร${ref(id)}`);
    const fields = recipeFields({ ...p, id });
    const draft = history.find((recipe) => recipe.status === "draft");
    if (draft) {
      Object.assign(draft, fields);
      if (!fields.extrusionSpec) delete draft.extrusionSpec; // ล้างสเปกในฟอร์ม = ร่างไม่มีสเปก
      audit(d, ctx, "แก้ร่างสูตร", `${id} Rev.${draft.revision}`);
      return draft.revision;
    }
    const revision = history[0].revision + 1;
    d.recipes.push({ id, ...fields, revision, status: "draft", createdAt: ctx.now, createdBy: ctx.user?.name });
    audit(d, ctx, "ออกสูตร revision ใหม่", `${id} Rev.${revision}`);
    return revision;
  }

  // อนุมัติร่าง (revision ที่ระบุ ไม่ระบุ = ร่างล่าสุด) · revision ที่อนุมัติอยู่เดิมของรหัสเดียวกันถูกแทนที่ (superseded) ในคำสั่งเดียวกัน
  function approveRecipe(d, { id, revision }, ctx) {
    needRight(ctx, "approve");
    const { revisionsOf } = rules();
    const history = revisionsOf(d.recipes, id);
    if (!history.length) fail(`ไม่พบสูตร${ref(id)}`);
    const recipe = revision === undefined || revision === null || revision === "" ? history.find((row) => row.status === "draft") : history.find((row) => Number(row.revision) === Number(revision));
    if (!recipe) fail(history.some((row) => row.status === "approved") ? "สูตรนี้อนุมัติแล้ว" : "ไม่มีร่างสูตรที่รออนุมัติ");
    if (recipe.status === "approved") fail("สูตรนี้อนุมัติแล้ว");
    if (recipe.status !== "draft") fail("สูตรฉบับแก้ไขนี้ถูกแทนที่แล้ว อนุมัติไม่ได้");
    for (const previous of history) {
      if (previous.status === "approved") {
        previous.status = "superseded";
        previous.supersededAt = ctx.now;
      }
    }
    recipe.status = "approved";
    recipe.approvedBy = ctx.user?.name;
    recipe.approvedAt = ctx.now;
    audit(d, ctx, "อนุมัติสูตร", `${id} Rev.${recipe.revision}`);
  }

  // ---------- เบิกเคมี ----------

  // ใบเบิกที่ยังค้างสถานะ weighing (ข้อมูลเก่าก่อนมีการจ่ายทันที) จองสต็อกของบรรทัดที่ยังไม่จ่าย · โหมดสาธิตหักสต็อกตอนจ่ายครบ จึงจองทุกบรรทัดของใบที่ยังไม่จ่ายครบ
  // store = คลังที่ถาม (20261220010000): ใบ weighing เดิมเป็นของคลัง ST จึงจองยอดคลัง ST เท่านั้น
  const reservedByOpenRequisitions = (d, ctx, store = "ST") => rules().weighingReservedKg(d.requisitions, store, { remote: Boolean(ctx.remote) });

  // ล็อตของบรรทัดต้องใช้ได้และมีพอในคลังของใบ แล้วหักสต็อกตามกิโลที่จ่าย (ฐานข้อมูลทำเองเช่นกัน) · store "ST" = qtyKg · "RB" = rbKg
  function takeFromLot(d, line, kg, ctx, store = "ST") {
    const { lotState, lotKg } = rules();
    const lot = d.materialLots.find((row) => row.lotNo === line.lotNo);
    if (!lot || lotState(lot, ctx.now, store) !== "available") fail(`ล็อต ${line.lotNo} ใช้ไม่ได้แล้ว (หมดอายุ/กักกัน/หมด)`);
    if (lotKg(lot, store) < kg) fail(`ล็อต ${line.lotNo} คงเหลือไม่พอ`);
    return lot;
  }
  // หักแล้วติดลบ = หยุด ไม่ปัดเป็น 0 เงียบ ๆ (|| 0 กัน -0)
  const STORE_FIELD = Object.freeze({ ST: "qtyKg", RB: "rbKg" });
  const deduct = (lot, kg, store = "ST") => {
    const field = STORE_FIELD[store];
    const have = Number(lot[field]) || 0;
    if (kg > have + 1e-9) fail(`ล็อต ${lot.lotNo} คงเหลือไม่พอ`);
    lot[field] = +(have - kg).toFixed(6) || 0;
  };
  const addKg = (lot, kg, store) => {
    const field = STORE_FIELD[store];
    lot[field] = +((Number(lot[field]) || 0) + kg).toFixed(6) || 0;
  };

  // เบิก = สร้างใบเบิกและจ่ายทันที: ระเบิดสูตร จัดสรร FEFO หักสต็อกล็อตตามบรรทัด จ่ายตามสูตร (actualKg = targetKg) สถานะ issued พร้อมผสม · ไม่มีขั้นตอนชั่งรายบรรทัด
  // คลังเคมีของ RB (20261220010000): ใบใหม่จัดสรร FEFO และตัดยอดคลัง RB (rbKg) ของล็อต store "RB" · คลัง RB ไม่พอ = ขอเบิกจาก ST ก่อน (requestChemicals)
  // จำนวน batch ไม่ได้กรอก: คำนวณจาก WO (ที่ WO ต้องใช้ − ที่ใบเบิกก่อนหน้าเบิกไปแล้ว ปัดขึ้นเป็น batch · ใบละไม่เกิน 10) ค่า batches ที่ส่งมาเมิน · WO ที่เบิกครบแล้วเบิกอีกไม่ได้
  // ctx.history (เฉพาะตัวสร้างข้อมูลสาธิต modules/rubberflow-seed.js ที่จำลองประวัติเบิกทีละ batch) ใช้ batches ที่ส่งมาโดยไม่ตรวจยอดที่เบิกแล้ว
  function createRequisition(d, { orderId, batches, note }, ctx) {
    needRight(ctx, "requisition");
    const { recipeLines, allocateFefo } = rules();
    const order = find(d.orders, orderId, "ใบสั่งผลิต");
    if (!["released", "in_progress"].includes(order.status)) fail('ใบสั่งผลิตต้องอยู่ในสถานะ "ปล่อยผลิต" หรือ "กำลังผลิต"');
    const recipe = rules().recipeOf(d.recipes, order.recipeId, order.recipeRevision) || fail(`ไม่พบสูตร${ref(order.recipeId)}`);
    const n = ctx.history ? num(batches, "จำนวนชุดผสม") : rules().nextRequisitionBatches(order, recipe, d.requisitions);
    if (ctx.history && (!Number.isInteger(n) || n < 1 || n > 10)) fail("จำนวนชุดผสมต้องเป็นจำนวนเต็ม 1–10");
    if (n < 1) fail(`${order.id} เบิกเคมีครบตามที่ใบสั่งผลิตต้องใช้แล้ว`);
    // จองสต็อกที่ใบเบิกเก่าที่ค้างอยู่สัญญาไว้แล้ว ใบเบิกสองใบจึงไม่หยิบกิโลเดียวกัน
    const reserved = reservedByOpenRequisitions(d, ctx, "RB");
    const lines = [];
    const shortages = [];
    for (const item of recipeLines(recipe)) {
      if (!(item.kgPerBatch > 0)) continue; // บรรทัด "ไม่ใส่" (kg = 0) ไม่เบิกและไม่ชั่ง
      const need = item.kgPerBatch * n;
      const { picks, shortage } = allocateFefo(d.materialLots, item.materialCode, need, ctx.now, reserved, "RB");
      if (shortage > 0.0001) shortages.push(`${item.materialCode} ขาด ${shortage.toFixed(2)} kg`);
      picks.forEach((pick) => {
        reserved[pick.lotNo] = (reserved[pick.lotNo] || 0) + pick.kg;
        lines.push({ materialCode: item.materialCode, stage: item.stage, lotNo: pick.lotNo, targetKg: pick.kg, actualKg: pick.kg, weighedAt: ctx.now, weighedBy: ctx.user?.name });
      });
    }
    if (shortages.length) fail(`สต็อกไม่พอตามหลัก FEFO: ${shortages.join(", ")} (คลังเคมี RB · ขอเบิกจาก ST ก่อน)`);
    for (const line of lines) deduct(d.materialLots.find((row) => row.lotNo === line.lotNo), line.targetKg, "RB");
    const id = nextId(d, "REQ", ctx.now, ctx, d.requisitions, rowId);
    d.requisitions.unshift({
      id, orderId, recipeId: recipe.id, recipeRevision: recipe.revision, batches: n, totalKg: recipe.batchKg * n, lines,
      status: "issued", note: note || "", requestedBy: ctx.user?.name, createdAt: ctx.now, issuedAt: ctx.now, issuedBy: ctx.user?.name, store: "RB",
    });
    audit(d, ctx, "เบิกเคมีและจ่ายวัตถุดิบ", `${id} (${order.id}, ${n} batch)`);
    return id;
  }

  // ใบเก่าที่ค้างชั่งทีละบรรทัด (ข้อมูลก่อนมีการจ่ายทันที): ยังชั่งต่อได้ครบเหมือนเดิม
  function weighLine(d, { reqId, index, actualKg }, ctx) {
    needRight(ctx, "requisition");
    const { weighTolerance } = rules();
    const requisition = find(d.requisitions, reqId, "ใบเบิก");
    if (requisition.status !== "weighing") fail("ใบเบิกนี้ชั่งครบแล้ว");
    const line = requisition.lines[index] || fail("ไม่พบรายการชั่ง");
    const kg = num(actualKg, "น้ำหนักที่ชั่งได้");
    const tol = weighTolerance(line.targetKg);
    if (Math.abs(kg - line.targetKg) > tol + 1e-9) fail(`น้ำหนักอยู่นอกเกณฑ์ ±${tol.toFixed(3)} kg ระบบไม่ให้บันทึก`);
    // ตัดคลังของใบ (ใบเดิมเป็นของคลัง ST · 20261220010000)
    const store = rules().requisitionStore(requisition);
    const lot = takeFromLot(d, line, kg, ctx, store);
    line.actualKg = kg;
    line.weighedAt = ctx.now;
    line.weighedBy = ctx.user?.name;
    // โหมดฐานข้อมูล: ฐานข้อมูลหักสต็อกของล็อตทันทีที่ชั่งแต่ละรายการ (โหมดสาธิตหักตอนชั่งครบทุกรายการ)
    if (ctx.remote) deduct(lot, kg, store);
    if (requisition.lines.every((row) => row.actualKg !== null)) finishWeighing(d, requisition, ctx);
  }

  // จ่ายทั้งใบที่ค้างสถานะ weighing: ทุกบรรทัดที่ยังไม่ชั่งจ่ายตามสูตร (actualKg = targetKg) หักสต็อกเท่ากัน แล้วใบเป็น issued ในคราวเดียว
  function issueRequisition(d, { id }, ctx) {
    needRight(ctx, "requisition");
    const requisition = find(d.requisitions, id, "ใบเบิก");
    if (requisition.status !== "weighing") fail("ใบเบิกนี้จ่ายวัตถุดิบครบแล้ว");
    const store = rules().requisitionStore(requisition);
    const open = requisition.lines.filter((line) => line.actualKg === null);
    // ตรวจทุกบรรทัดก่อนแก้อะไร (ล็อตเดียวกันอาจอยู่หลายบรรทัด จึงรวมกิโลต่อล็อต)
    const need = {};
    for (const line of open) takeFromLot(d, line, 0, ctx, store);
    for (const line of ctx.remote ? open : requisition.lines) need[line.lotNo] = (need[line.lotNo] || 0) + line.targetKg;
    for (const [lotNo, kg] of Object.entries(need)) {
      if (rules().lotKg(d.materialLots.find((row) => row.lotNo === lotNo), store) < kg - 1e-9) fail(`ล็อต ${lotNo} คงเหลือไม่พอ`);
    }
    for (const line of open) {
      line.actualKg = line.targetKg;
      line.weighedAt = ctx.now;
      line.weighedBy = ctx.user?.name;
      if (ctx.remote) deduct(d.materialLots.find((row) => row.lotNo === line.lotNo), line.targetKg, store);
    }
    finishWeighing(d, requisition, ctx);
  }

  // ทุกบรรทัดจ่ายแล้ว: โหมดสาธิตหักสต็อกทั้งใบตอนนี้ (โหมดฐานข้อมูลหักไปแล้วรายบรรทัด) แล้วใบเป็น issued
  function finishWeighing(d, requisition, ctx) {
    if (!ctx.remote) {
      const store = rules().requisitionStore(requisition);
      requisition.lines.forEach((row) => deduct(d.materialLots.find((item) => item.lotNo === row.lotNo), row.actualKg, store));
    }
    requisition.status = "issued";
    requisition.issuedAt = ctx.now;
    requisition.issuedBy = ctx.user?.name;
    audit(d, ctx, "จ่ายวัตถุดิบครบ", requisition.id);
  }

  function receiveMaterial(d, p, ctx) {
    needRight(ctx, "receiveMaterial");
    const material = d.materials.find((row) => row.code === p.materialCode) || fail("กรุณาเลือกวัตถุดิบ");
    if (material.active === false) fail("วัตถุดิบนี้เลิกใช้แล้ว รับเข้าคลังไม่ได้");
    const qty = num(p.qtyKg, "ปริมาณรับเข้า");
    if (qty <= 0) fail("ปริมาณต้องมากกว่า 0");
    if (!p.expiry || p.expiry <= ctx.now) fail("วันหมดอายุต้องเป็นวันในอนาคต");
    const lotNo = nextId(d, `RM-${material.code}`, ctx.now, ctx, d.materialLots, (row) => row.lotNo);
    d.materialLots.push({
      lotNo, materialCode: material.code, qtyKg: qty, rbKg: 0, initialKg: qty, expiry: p.expiry, receivedAt: ctx.now,
      supplier: p.supplier || "-", location: p.location || material.storage, status: "available", coa: Boolean(p.coa),
    });
    audit(d, ctx, "รับวัตถุดิบเข้าคลัง", `${lotNo} ${qty} kg`);
    return lotNo;
  }

  // ---------- ใบสั่งซื้อวัตถุดิบ ----------
  // ใบสั่งซื้อ { id: PO-yyyymmdd-nn, status: ordered|received|cancelled, sourcePi, sourceRequisition, note, lines, createdAt, createdBy, cancelledAt }
  // บรรทัด { materialCode, source: rf|bom, uom: null|หน่วยของชิ้น, needKg, availableKg, shortageKg, safetyKg, qtyKg, receivedKg|null, lotNo|null, expiry|null, receivedAt|null, receivedBy|null, receipts?, closedRemainder? }
  // รับได้หลายครั้งต่อบรรทัด (20261128020000): receivedKg = ยอดรับสะสม · receipts = [{ kg, lotNo, expiry, at, by }] ทีละครั้ง · lotNo / expiry / receivedAt / receivedBy = ของครั้งล่าสุด
  // closedRemainder = { kg, reason, at, by } เมื่อ ST ปิดยอดที่เหลือ · ฐานข้อมูลคำนวณยอดครั้งนี้จากส่วนต่างของยอดสะสมเอง และสร้าง receipts / closedRemainder เอง (ค่าของ client เมิน)
  // กฎค้างรับ / ครบ อยู่ที่ modules/rubberflow-rules.js (poLineReceived / poLineOpen / poLineDone)
  // source "rf" = เคมี (kg สร้างล็อต + วันหมดอายุตอนรับ) · "bom" = ของซื้อจาก BOM (ชื่อช่อง ...Kg ใช้ต่อกันแต่หน่วยเป็น uom ของชิ้น รับเข้าเพิ่มยอดคงเหลือของ BOM ไม่มีล็อต ไม่มีวันหมดอายุ)
  // ฐานข้อมูลตรวจรหัสของซื้อกับ item master และตั้งหน่วยเอง · โหมดในเครื่อง RubberFlow และ BOM แยกที่เก็บ จึงรับของซื้อแล้วยอดคงเหลือของ BOM ไม่เปลี่ยน (เปลี่ยนเฉพาะโหมดฐานข้อมูล)
  // ฐานข้อมูลตรวจซ้ำทุกข้อและประทับเวลา/ผู้บันทึกเอง · สร้างได้เฉพาะ ordered ที่ยังไม่มีข้อมูลการรับ
  const PO_MAX_LINES = 100;
  const kgOf = (value, label, { positive = false, digits = 3 } = {}) => {
    const n = Number(value);
    if (value === "" || value === null || value === undefined || !Number.isFinite(n) || n < 0 || n > 1e9 || (positive && n <= 0)) fail(`${label}ต้องเป็นตัวเลข${positive ? "มากกว่า 0" : "0 ขึ้นไป"}`);
    const scale = 10 ** digits;
    return Math.round(n * scale) / scale;
  };
  // สต็อกขั้นต่ำของซื้อ: ความละเอียดเดียวกับหน้าคลังของซื้อของ BOM (4 ตำแหน่ง) ค่าที่เก็บจึงเทียบกับฐานข้อมูลได้ตรงตัว
  const partSafetyOf = (value, code) => kgOf(value, `สต็อกขั้นต่ำของ ${code}`, { digits: 4 });
  // พร้อมใช้ติดลบได้ (ฐานข้อมูลรับ ±1e9)
  const signedKgOf = (value, label) => {
    const n = Number(value);
    if (value === "" || value === null || value === undefined || !Number.isFinite(n) || Math.abs(n) > 1e9) fail(`${label}ต้องเป็นตัวเลข`);
    return Math.round(n * 1000) / 1000;
  };
  const round9 = (value) => Math.round(Number(value) * 1e9) / 1e9;
  // ต่อท้ายการรับหนึ่งครั้ง: ยอดสะสมใหม่ = ยอดสะสมที่เก็บ + ครั้งนี้ (ฐานข้อมูลคิดยอดครั้งนี้จากส่วนต่างนี้) · ช่องของบรรทัด = ของครั้งล่าสุด
  function appendReceipt(line, kg, lotNo, expiry, ctx) {
    const by = ctx.user?.name ?? null;
    line.receipts = [...(Array.isArray(line.receipts) ? line.receipts : []), { kg, lotNo, expiry, at: ctx.now, by }];
    line.receivedKg = round9((Number(line.receivedKg) || 0) + kg);
    line.lotNo = lotNo;
    line.expiry = expiry;
    line.receivedAt = ctx.now;
    line.receivedBy = by;
  }
  const lineDoneText = (order, line) => `${line.materialCode} ในใบสั่งซื้อ ${order.id} ${line.closedRemainder ? "ปิดยอดที่เหลือแล้ว" : "รับครบแล้ว"}`;

  // lines: [{ materialCode, needKg, availableKg, shortageKg, safetyKg?, qtyKg }] (บรรทัดที่จำนวนสั่งเป็น 0 ถูกข้าม) · safety: { รหัสวัตถุดิบ: kg } = สต็อกขั้นต่ำที่แก้ในหน้าสั่งซื้อ บันทึกเข้าวัตถุดิบในคำสั่งเดียวกัน
  function createPurchaseOrder(d, p, ctx) {
    needRight(ctx, "purchase");
    d.purchaseOrders ??= [];
    const safety = p.safety && typeof p.safety === "object" ? p.safety : {};
    // สต็อกขั้นต่ำของเคมีแก้ได้โดยผู้ที่แก้วัตถุดิบได้ (กลุ่มวางแผน / RB) และแผนก ST ที่เป็นผู้สั่งซื้อ (ตามประตูของ app_rf_save ใน 20261120010000) · ผู้สั่งที่ไม่มีสิทธิ์นั้น (ST) สั่งด้วยค่าที่เก็บอยู่ ไม่แตะวัตถุดิบ
    const maySafety = !ctx.remote || MAY.master(ctx.user) || Boolean(ctx.user?.st);
    const given = (Array.isArray(p.lines) ? p.lines : []).filter((line) => Number(line?.qtyKg) > 0);
    if (!given.length) fail("กรุณาระบุจำนวนสั่งอย่างน้อย 1 รายการ");
    if (given.length > PO_MAX_LINES) fail(`ใบสั่งซื้อมีได้ไม่เกิน ${PO_MAX_LINES} รายการ`);
    const seen = new Set();
    const lines = given.map((line) => {
      const code = String(line.materialCode ?? "").trim();
      if (line.source === "bom") {
        // ของซื้อ: สต็อกขั้นต่ำเก็บที่คลังของซื้อของ BOM (ฐานข้อมูลบันทึกให้ในคำสั่งเดียวกัน) ไม่ใช่ที่วัตถุดิบ
        if (!code) fail("ไม่พบรหัสของซื้อ");
        if (seen.has(code)) fail(`${code} ซ้ำในใบสั่งซื้อ`);
        seen.add(code);
        const uom = String(line.uom ?? "").trim().slice(0, 20);
        if (!uom) fail(`ไม่ทราบหน่วยของ ${code}`);
        // สต็อกขั้นต่ำของซื้อ (เก็บที่คลังของซื้อ) แก้ได้โดยกลุ่มวางแผนและแผนก ST: สมาชิก RB สั่งซื้อได้ต่อเมื่อค่าเท่าที่เก็บ (storedSafetyKg ที่หน้าต่างสั่งซื้อส่งมา) · ฐานข้อมูลตรวจซ้ำ (RF_FORBIDDEN)
        if (ctx.remote && !(ctx.user?.planner || ctx.user?.st)) {
          const wanted = partSafetyOf(Object.hasOwn(safety, code) ? safety[code] : line.safetyKg ?? 0, code);
          if (wanted !== partSafetyOf(line.storedSafetyKg ?? 0, code)) fail(`แก้สต็อกขั้นต่ำของของซื้อ ${code} ได้โดยฝ่ายวางแผนหรือคลังวัตถุดิบ (ST)`);
        }
        return {
          materialCode: code, source: "bom", uom, needKg: kgOf(line.needKg ?? 0, `ความต้องการของ ${code}`), availableKg: signedKgOf(line.availableKg ?? 0, `พร้อมใช้ของ ${code}`), shortageKg: kgOf(line.shortageKg ?? 0, `ส่วนที่ขาดของ ${code}`),
          safetyKg: partSafetyOf(Object.hasOwn(safety, code) ? safety[code] : line.safetyKg ?? 0, code), qtyKg: kgOf(line.qtyKg, `จำนวนสั่งของ ${code}`, { positive: true }),
          receivedKg: null, lotNo: null, expiry: null, receivedAt: null, receivedBy: null,
          // ค่าที่หน้าต่างแสดงตอนเปิด: ฐานข้อมูลใช้ตัดสินว่าผู้สั่งแก้ช่องสต็อกขั้นต่ำจริงหรือไม่ (ไม่แก้ = ไม่เขียนทับค่าที่ผู้อื่นเพิ่งตั้ง) แล้วไม่เก็บช่องนี้
          ...(ctx.remote && line.storedSafetyKg !== undefined && String(line.storedSafetyKg).trim() !== "" ? { storedSafetyKg: partSafetyOf(line.storedSafetyKg, code) } : {}),
        };
      }
      const material = d.materials.find((row) => row.code === code) || fail(`ไม่พบวัตถุดิบ${ref(code)}`);
      if (material.active === false) fail(`วัตถุดิบ ${code} เลิกใช้แล้ว สั่งซื้อไม่ได้`);
      if (seen.has(code)) fail(`${code} ซ้ำในใบสั่งซื้อ`);
      seen.add(code);
      const safetyKg = maySafety ? kgOf(Object.hasOwn(safety, code) ? safety[code] : material.safetyKg ?? 0, `สต็อกขั้นต่ำของ ${code}`) : kgOf(material.safetyKg ?? 0, `สต็อกขั้นต่ำของ ${code}`);
      if (maySafety && safetyKg !== (Number(material.safetyKg) || 0)) {
        material.safetyKg = safetyKg;
        audit(d, ctx, "แก้สต็อกขั้นต่ำ", `${code} = ${safetyKg} kg`);
      }
      return {
        materialCode: code, source: "rf", uom: null, needKg: kgOf(line.needKg ?? 0, `ความต้องการของ ${code}`), availableKg: signedKgOf(line.availableKg ?? 0, `พร้อมใช้ของ ${code}`), shortageKg: kgOf(line.shortageKg ?? 0, `ส่วนที่ขาดของ ${code}`),
        safetyKg, qtyKg: kgOf(line.qtyKg, `จำนวนสั่งของ ${code}`, { positive: true }),
        receivedKg: null, lotNo: null, expiry: null, receivedAt: null, receivedBy: null,
      };
    });
    // สต็อกขั้นต่ำที่แก้ไว้ของวัตถุดิบที่ไม่ได้สั่งครั้งนี้ก็บันทึกเข้าวัตถุดิบด้วย
    for (const [code, value] of Object.entries(safety)) {
      if (!maySafety) break;
      const material = seen.has(code) ? null : d.materials.find((row) => row.code === code);
      if (!material || material.active === false) continue;
      const safetyKg = kgOf(value, `สต็อกขั้นต่ำของ ${code}`);
      if (safetyKg === (Number(material.safetyKg) || 0)) continue;
      material.safetyKg = safetyKg;
      audit(d, ctx, "แก้สต็อกขั้นต่ำ", `${code} = ${safetyKg} kg`);
    }
    const id = nextId(d, "PO", ctx.now, ctx, d.purchaseOrders, rowId);
    d.purchaseOrders.unshift({
      id, status: "ordered", sourcePi: String(p.sourcePi ?? "").trim().slice(0, 40) || null, sourceRequisition: String(p.sourceRequisition ?? "").trim().slice(0, 40) || null,
      note: String(p.note ?? "").trim().slice(0, 300), lines, createdAt: ctx.now, createdBy: ctx.user?.name, cancelledAt: null,
    });
    audit(d, ctx, "สั่งซื้อวัตถุดิบ", `${id} ${lines.length} รายการ`);
    return id;
  }

  // ตรวจสอบรับเข้า: รับได้หลายครั้งต่อบรรทัดจนกว่าจะครบหรือปิดยอดที่เหลือ (20261128020000 · ส่งมาไม่ครบ = รับเท่าที่มา ที่เหลือยังค้างรับ)
  // เคมี: สร้างล็อตวัตถุดิบใหม่หนึ่งล็อตต่อครั้ง (พร้อมใช้ ผู้ขาย = เลขใบสั่งซื้อถ้าไม่กรอก ที่เก็บ = ที่จัดเก็บของวัตถุดิบ) · ทุกบรรทัดครบ = ใบเป็น received · รับเกินยอดสั่งได้
  // รับเกินยอดที่ค้างรับ (ผู้ใช้ตัดสิน 2026-11-18 · N9): รับได้แต่ต้องติ๊กยืนยัน (overConfirm) ในหน้าต่างรับเข้า · ฐานข้อมูลไม่มีเพดาน ด่านนี้อยู่ที่หน้าจอ
  const confirmedOver = (value) => value === true || ["1", "on", "true"].includes(String(value ?? ""));
  function receivePurchaseLine(d, { id, materialCode, qtyKg, expiry, supplier, overConfirm }, ctx) {
    needRight(ctx, "receiveMaterial");
    const R = rules();
    const order = find(d.purchaseOrders ?? [], id, "ใบสั่งซื้อ");
    if (order.status !== "ordered") fail(`ใบสั่งซื้อ ${order.id} ${order.status === "received" ? "รับครบแล้ว" : "ถูกยกเลิกแล้ว"} รับเข้าไม่ได้`);
    const line = order.lines.find((row) => row.materialCode === materialCode) || fail(`ไม่พบวัตถุดิบ${ref(materialCode)} ในใบสั่งซื้อ ${order.id}`);
    if (R.poLineDone(line)) fail(`${lineDoneText(order, line)} รับเข้าอีกไม่ได้`);
    const over = Number(qtyKg) - R.poLineOpen(line);
    if (Number.isFinite(over) && over > 1e-9 && !confirmedOver(overConfirm)) {
      const unit = line.source === "bom" ? R.unitText(line.uom) : "kg";
      fail(`จำนวนที่รับเกินยอดค้างรับ ${+over.toFixed(4)}${unit ? ` ${unit}` : ""} ติ๊กยืนยันการรับเกินก่อน`);
    }
    // ข้อความบันทึกการใช้งานหลังรับ: ยอดสะสมและยอดที่ยังค้าง
    const total = () => `รับแล้ว ${R.poLineReceived(line)} จาก ${line.qtyKg}${R.poLineOpen(line) > 0 ? ` ค้างรับ ${R.poLineOpen(line)}` : ""}`;
    if (line.source === "bom") {
      // ของซื้อ: รับเฉพาะปริมาณจริง (ไม่มีล็อต/วันหมดอายุ) ยอดคงเหลือของ BOM เพิ่มเฉพาะครั้งนี้ที่ฐานข้อมูลในคำสั่งเดียวกัน
      const qty = kgOf(qtyKg, "ปริมาณที่รับ", { positive: true });
      appendReceipt(line, qty, null, null, ctx);
      if (order.lines.every(R.poLineDone)) order.status = "received";
      audit(d, ctx, "ตรวจสอบรับเข้าตามใบสั่งซื้อ", `${order.id} ${materialCode} ${qty} ${line.uom ?? ""} · ${total()}`);
      return materialCode;
    }
    const lotNo = receiveMaterial(d, { materialCode, qtyKg, expiry, supplier: String(supplier ?? "").trim() || order.id }, ctx);
    const lot = d.materialLots.find((row) => row.lotNo === lotNo);
    appendReceipt(line, lot.qtyKg, lotNo, lot.expiry, ctx);
    if (order.lines.every(R.poLineDone)) order.status = "received";
    audit(d, ctx, "ตรวจสอบรับเข้าตามใบสั่งซื้อ", `${order.id} ${materialCode} ${lot.qtyKg} kg → ${lotNo} · ${total()}`);
    return lotNo;
  }

  // ปิดยอดที่เหลือ (20261128020000): แผนก ST (admin ไว้แก้ปัญหา) ปิดบรรทัดที่ยังไม่ครบเมื่อผู้ขายจะไม่ส่งส่วนที่เหลือ · ต้องมีเหตุผล 3-300 ตัวอักษร
  // ไม่เปลี่ยนสต็อกหรือล็อต · ส่วนที่เหลือเลิกนับเป็นสั่งแล้วรอรับ · ทุกบรรทัดครบหรือปิดแล้ว = ใบเป็น received
  const PO_REASON_MIN = 3;
  const PO_REASON_MAX = 300;
  function closePurchaseLine(d, { id, materialCode, reason }, ctx) {
    needRight(ctx, "closePurchaseLine");
    const R = rules();
    const order = find(d.purchaseOrders ?? [], id, "ใบสั่งซื้อ");
    if (order.status !== "ordered") fail(`ใบสั่งซื้อ ${order.id} ${order.status === "received" ? "รับครบแล้ว" : "ถูกยกเลิกแล้ว"} ปิดยอดไม่ได้`);
    const line = order.lines.find((row) => row.materialCode === materialCode) || fail(`ไม่พบวัตถุดิบ${ref(materialCode)} ในใบสั่งซื้อ ${order.id}`);
    if (R.poLineDone(line)) fail(`${lineDoneText(order, line)} ไม่มียอดที่เหลือให้ปิด`);
    const text = typeof reason === "string" ? reason.trim() : "";
    if (text.length < PO_REASON_MIN) fail(`กรุณาระบุเหตุผลที่ปิดยอดที่เหลือ (อย่างน้อย ${PO_REASON_MIN} ตัวอักษร)`);
    if (text.length > PO_REASON_MAX) fail(`เหตุผลยาวเกิน ${PO_REASON_MAX} ตัวอักษร`);
    const kg = R.poLineOpen(line);
    line.closedRemainder = { kg, reason: text, at: ctx.now, by: ctx.user?.name ?? null };
    if (order.lines.every(R.poLineDone)) order.status = "received";
    audit(d, ctx, "ปิดยอดที่เหลือของใบสั่งซื้อ", `${order.id} ${materialCode} ไม่รับอีก ${kg} ${line.source === "bom" ? line.uom ?? "" : "kg"} — ${text}`);
    return materialCode;
  }

  // ยกเลิกได้เฉพาะใบ ordered ที่ยังไม่มีบรรทัดไหนรับเข้าหรือปิดยอด (แผนก ST) · ใบสั่งซื้อไม่มีการแก้ไขหลังสร้าง
  function cancelPurchaseOrder(d, { id }, ctx) {
    needRight(ctx, "cancelPurchase");
    const order = find(d.purchaseOrders ?? [], id, "ใบสั่งซื้อ");
    if (order.status !== "ordered") fail(`ใบสั่งซื้อ ${order.id} ${order.status === "received" ? "รับครบแล้ว" : "ถูกยกเลิกไปแล้ว"} ยกเลิกไม่ได้`);
    if (rules().poTouched(order)) fail(`ใบสั่งซื้อ ${order.id} มีรายการที่รับเข้าหรือปิดยอดแล้ว ยกเลิกไม่ได้ ปิดยอดที่เหลือของบรรทัดที่ยังค้างแทน`);
    order.status = "cancelled";
    order.cancelledAt = ctx.now;
    audit(d, ctx, "ยกเลิกใบสั่งซื้อ", order.id);
    return order.id;
  }

  function setMaterialLotStatus(d, { lotNo, status }, ctx) {
    needRight(ctx, "holdMaterial");
    if (!["hold", "available"].includes(status)) fail("สถานะล็อตไม่ถูกต้อง");
    const lot = d.materialLots.find((row) => row.lotNo === lotNo) || fail("ไม่พบล็อต");
    // ปลดกักกัน (hold → available) = หัวหน้า QA หรือหัวหน้า ST เท่านั้น · กักกันยังเป็นของ ST / QA / ฝ่ายวางแผนตามเดิม
    if (lot.status === "hold" && status === "available") needRight(ctx, "releaseMaterial");
    lot.status = status;
    audit(d, ctx, status === "hold" ? "กักกันล็อตวัตถุดิบ" : "ปลดกักกันล็อตวัตถุดิบ", lotNo);
  }

  // ---------- บันทึกของแต่ละสถานี ----------

  function newLot(d, stage, prefix, base, ctx) {
    const id = nextId(d, prefix, ctx.now, ctx, d.lots, rowId);
    const lot = { id, stage, transferredQty: 0, createdAt: ctx.now, operator: ctx.user?.name, ...base };
    d.lots.unshift(lot);
    return lot;
  }

  // โหมดฐานข้อมูล: บันทึกล็อตของสถานีไหนก็ได้เฉพาะใบสั่งผลิตที่ปล่อยผลิต กำลังผลิต หรือพักงาน (ฐานข้อมูลปฏิเสธนอกนี้ด้วย RF_INVALID_TRANSITION)
  // 20261227010000: ล็อตตกแต่งของ WO ที่ยกเลิกพร้อมใบที่ฝ่ายวางแผนเลือกหยุด (ctx.salesStopped) บันทึกได้ · สถานีอื่นและ WO ที่ยกเลิกทางอื่นยังไม่ได้
  // ctx.salesStopped(order): true = หยุด · false = ไม่ใช่ · null = ยังไม่รู้ (BOM ยังไม่โหลด) → หน้าไม่ห้ามเอง เซิร์ฟเวอร์ตัดสิน (rf_save_lots)
  const maySalesStopped = (ctx, order) => {
    if (order.status !== "cancelled" || !order.sourceJobId || typeof ctx.salesStopped !== "function") return false;
    const stopped = ctx.salesStopped(order);
    return stopped === true || stopped === null;
  };
  function needOrderOpen(d, orderId, ctx, stage = "") {
    const order = d.orders.find((row) => row.id === orderId);
    if (!ctx.remote || !order || ["released", "in_progress", "on_hold"].includes(order.status)) return;
    if (stage === "finishing" && maySalesStopped(ctx, order)) return;
    const why = { planned: "ยังไม่ได้ปล่อยผลิต", completed: "ปิดแล้ว", cancelled: "ถูกยกเลิกแล้ว" }[order.status] ?? "ไม่อยู่ในสถานะที่ผลิตได้";
    fail(`ใบสั่งผลิต ${order.id} ${why} บันทึกการผลิตไม่ได้`);
  }

  function takeFromTransfer(d, transferId, stage, qty, ctx) {
    const transfer = find(d.transfers, transferId, "ใบส่งมอบ");
    if (transfer.to !== stage) fail("ใบส่งมอบนี้ไม่ได้ส่งมาที่สถานีนี้");
    needOrderOpen(d, transfer.orderId, ctx, stage);
    if (transfer.status !== "received") fail("ด่านรับมอบ: ต้องกดรับมอบงานก่อนจึงจะเริ่มผลิตได้");
    if (qty <= 0) fail("ปริมาณที่ใช้ต้องมากกว่า 0");
    if (qty > transfer.remaining + 1e-9) fail(`ปริมาณเกินที่รับมา (คงเหลือ ${transfer.remaining})`);
    transfer.remaining = +(transfer.remaining - qty).toFixed(3);
    return transfer;
  }

  function recordMixing(d, p, ctx) {
    needRight(ctx, "station");
    const { HOUR } = rules();
    const requisition = find(d.requisitions, p.reqId, "ใบเบิก");
    if (requisition.status !== "issued") fail("ใบเบิกยังจ่ายวัตถุดิบไม่ครบ หรือถูกใช้ไปแล้ว");
    needOrderOpen(d, requisition.orderId, ctx);
    const recipe = rules().recipeOf(d.recipes, requisition.recipeId, requisition.recipeRevision) || fail(`ไม่พบสูตร${ref(requisition.recipeId)}`);
    // บันทึกทั้งสองขั้น (อุณหภูมิเครื่องผสม Dump temp เวลาเป็นนาที)
    const stages = rules().MIX_STAGES.map((stage) => stageValues((p.stages ?? []).find((row) => Number(row?.stage) === stage), stage));
    const outputKg = num(p.outputKg, "น้ำหนักยางที่ได้");
    const scrapKg = Number(p.scrapKg) || 0;
    const issued = requisition.lines.reduce((sum, line) => sum + line.actualKg, 0);
    if (outputKg + scrapKg > issued + 0.5) fail(`น้ำหนักยางรวมเกินวัตถุดิบที่จ่าย (${issued.toFixed(2)} kg)`);
    const reasons = [];
    // Dump temp ของแต่ละขั้นเทียบกับค่าของสูตรในขั้นนั้นด้วยค่าเผื่อเดียวกัน (dumpTol) ขั้นไหนหลุด = ล็อตถูก QC Hold
    for (const row of stages) {
      const standard = rules().recipeStage(recipe, row.stage);
      // สูตรที่ไม่มีค่ามาตรฐานของขั้นนี้ (ข้อมูลรูปเก่า) บันทึกไม่ได้ แทนที่จะปล่อยผ่านโดยไม่เทียบ
      if (!standard) fail(`สูตร ${recipe.id} ไม่มีค่ามาตรฐานขั้น ${row.stage} กรุณาออกฉบับแก้ไขใหม่ของสูตรก่อน`);
      if (Math.abs(row.dumpTemp - standard.dumpTemp) > recipe.dumpTol) {
        reasons.push(`Dump temp ขั้น ${row.stage} ${row.dumpTemp}°C นอกช่วง ${standard.dumpTemp}±${recipe.dumpTol}`);
      }
    }
    const lot = newLot(d, "mixing", "MX", {
      orderId: requisition.orderId, recipeId: recipe.id, uom: "kg", machine: p.machine, shift: p.shift,
      sources: [{ type: "requisition", id: requisition.id }],
      params: { stages, batches: requisition.batches },
      goodQty: outputKg, scrapQty: scrapKg, scrapReason: p.scrapReason || "",
      qc: reasons.length ? "hold" : "pass", holdReasons: reasons,
      readyAt: ctx.now + recipe.restHours * HOUR,
    }, ctx);
    requisition.status = "consumed";
    requisition.consumedBy = lot.id;
    startOrderIfReleased(d, requisition.orderId, ctx);
    audit(d, ctx, "บันทึกการผสม", `${lot.id} ${outputKg} kg${reasons.length ? " (QC Hold อัตโนมัติ)" : ""}`);
    return lot.id;
  }

  // ข้ามเวลาบ่ม (ตรงกับ rf_save_lots ของ 20261128010000): หัวหน้า RB หรือแผนก QA พร้อมเหตุผล 3-300 ตัวอักษร · ล็อตเก็บ { by, reason, at } ไว้ที่ params.skipRest
  // โหมดฐานข้อมูล: เซิร์ฟเวอร์ตั้งเวลาครบบ่มเป็นเวลาของเซิร์ฟเวอร์และประทับผู้ข้าม/เวลาเอง (ส่งได้แค่เหตุผล) · โหมดสาธิตเขียนเองในเครื่อง
  const SKIP_REASON_MIN = 3;
  const SKIP_REASON_MAX = 300;
  function endRest(d, { lotId, reason }, ctx) {
    needRight(ctx, "skipRest");
    const lot = find(d.lots, lotId, "ล็อต");
    if (ctx.remote && !(lot.readyAt > ctx.now)) fail("ล็อตนี้บ่มครบเวลาแล้ว");
    const why = typeof reason === "string" ? reason.trim() : "";
    if (why.length < SKIP_REASON_MIN) fail(`กรุณาระบุเหตุผลที่ข้ามเวลาบ่ม (อย่างน้อย ${SKIP_REASON_MIN} ตัวอักษร)`);
    if (why.length > SKIP_REASON_MAX) fail(`เหตุผลยาวเกิน ${SKIP_REASON_MAX} ตัวอักษร`);
    lot.readyAt = ctx.now;
    lot.params = { ...(lot.params ?? {}), skipRest: { by: ctx.user?.name ?? "", reason: why, at: ctx.now } };
    audit(d, ctx, ctx.remote ? "ข้ามเวลาบ่ม" : "ข้ามเวลาบ่ม (โหมดสาธิต)", `${lotId} — ${why}`);
  }

  // รับเคมีที่เบิกไปแล้วคืนเข้าล็อตเดิม (ตรงกับ private.rf_return_requisitions ของ 20261128010000): ใบเบิกที่จ่ายแล้วและยังไม่ได้ผสมของ WO ที่ถูกยกเลิก · แผนก ST
  // kgs = ยอดที่คืนจริงตามลำดับบรรทัด (บรรทัดที่จ่ายไปต้องกรอก ไม่มีคืนใส่ 0) 0..ที่จ่าย · คืนไม่ครบต้องมีเหตุผล 3-300 · รับคืนได้ครั้งเดียวต่อใบ
  // ยอดคืนบวกเข้าล็อตเดิมของบรรทัด (ไม่เกินยอดรับเข้าของล็อต) ล็อตคงวันหมดอายุและสถานะเดิม (ล็อตที่หมดอายุแล้วยังหมดอายุ FEFO ข้ามเหมือนเดิม)
  // คลังของใบ (20261220010000): ใบเดิมของคลัง ST = กติกาเดิม (ST รับคืนเข้า qtyKg) · ใบเบิกคลัง RB = กลุ่มวางแผน / RB คืนเข้า rbKg ของล็อตเดิม
  // เพดานของล็อต: คลัง ST + คลัง RB + ที่คืนระหว่างทาง + ที่คืนครั้งนี้ ไม่เกินยอดรับเข้า
  function returnRequisition(d, { id, kgs, note }, ctx) {
    const requisition = find(d.requisitions, id, "ใบเบิก");
    const store = rules().requisitionStore(requisition);
    needRight(ctx, store === "RB" ? "requestChem" : "returnRequisition");
    const state = rules().requisitionReturnState(d, requisition);
    if (state === "returned") fail(`ใบเบิก ${requisition.id} รับคืนแล้ว (รับคืนได้ครั้งเดียว)`);
    if (state !== "pending") fail("รับคืนได้เฉพาะใบเบิกที่จ่ายแล้วและยังไม่ได้ผสม ของใบสั่งผลิตที่ถูกยกเลิก");
    const list = Array.isArray(kgs) ? kgs : [];
    let short = false;
    const amounts = requisition.lines.map((line, index) => {
      const issued = typeof line.actualKg === "number" ? line.actualKg : 0;
      if (!(issued > 0)) return 0;
      const raw = list[index];
      if (raw === undefined || raw === null || String(raw).trim() === "") fail(`กรุณาระบุจำนวนที่คืนของ ${line.materialCode} (ล็อต ${line.lotNo}) ไม่มีของคืนใส่ 0`);
      const kg = Number(raw);
      if (!Number.isFinite(kg) || kg < 0) fail(`จำนวนที่คืนของ ${line.materialCode} ต้องเป็นตัวเลขไม่ติดลบ`);
      // ไม่ปัดทศนิยม: ใบเบิกเก่าที่ชั่งเองอาจจ่ายเกิน 4 ตำแหน่ง ช่องกรอกตั้งต้นที่ยอดจ่ายจริงจึงคืนเต็มยอดได้ (ตรงกับฐานข้อมูล)
      if (kg > issued + 1e-9) fail(`${line.materialCode} คืนได้ไม่เกินที่จ่ายไป ${issued} kg`);
      if (kg < issued - 1e-9) short = true;
      return kg;
    });
    const why = typeof note === "string" ? note.trim() : "";
    if (short && why.length < 3) fail("คืนไม่ครบตามที่จ่ายไป กรุณาระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)");
    if (why.length > 300) fail("เหตุผลยาวเกิน 300 ตัวอักษร");
    const R = rules();
    const added = new Map();
    requisition.lines.forEach((line, index) => {
      if (!(amounts[index] > 0)) return;
      const lot = d.materialLots.find((row) => row.lotNo === line.lotNo) || fail(`ไม่พบล็อต ${line.lotNo}`);
      const more = (added.get(lot.lotNo) ?? 0) + amounts[index];
      if (R.lotKg(lot, "ST") + R.lotKg(lot, "RB") + R.lotInTransitKg(d, lot.lotNo) + more > Number(lot.initialKg) + 1e-6) fail(`ล็อต ${lot.lotNo} รับคืนเกินยอดที่รับเข้าคลัง (${lot.initialKg} kg) ไม่ได้`);
      added.set(lot.lotNo, more);
    });
    for (const [lotNo, kg] of added) addKg(d.materialLots.find((row) => row.lotNo === lotNo), kg, store);
    requisition.lines = requisition.lines.map((line, index) => ({ ...line, returnedKg: amounts[index], returnedAt: ctx.now, returnedBy: ctx.user?.name ?? "", returnNote: why }));
    requisition.returnNote = why;
    const total = amounts.reduce((sum, kg) => sum + kg, 0);
    audit(d, ctx, store === "RB" ? "คืนเคมีของใบเบิกเข้าคลัง RB" : "รับเคมีคืนเข้าล็อตเดิม", `${requisition.id} (${requisition.orderId}) คืน ${+total.toFixed(4)} kg${why ? ` — ${why}` : ""}`);
    return requisition.id;
  }

  // ---------- คลังเคมี ST (กลาง) / คลังเคมีของ RB (20261220010000 · ตรงกับ private.rf_save_chem_docs และ mock ของ harness) ----------
  // เอกสาร chemDocs: ใบขอเบิก CR (RB ขอ → ST จ่าย FEFO ย้าย qtyKg → rbKg) · ใบคืน CT (rbKg → รอ ST รับทั้งใบเข้า qtyKg หรือปฏิเสธกลับ rbKg) · ใบนับคลัง RB CC
  // รูปเอกสารและกฎสถานะอยู่ที่ modules/rubberflow-rules.js (chemDocsOf …) · ฐานข้อมูลจัดสรรล็อตและคำนวณยอดเองอีกครั้ง (ค่าที่นี่เป็นสำเนาให้หน้าจอเห็นทันที)
  const CHEM_MAX_LINES = 100;
  const round6 = (value) => Math.round(Number(value) * 1e6) / 1e6;
  const blankKg = (value) => value === undefined || value === null || String(value).trim() === "";
  const chemList = (d) => (d.chemDocs ??= []);
  const CHEM_KIND_TEXT = Object.freeze({ request: "ใบขอเบิกเคมี", return: "ใบคืนเคมี", count: "ใบนับคลังเคมี RB" });
  function findChem(d, id, kind) {
    const doc = chemList(d).find((row) => row.id === id) || fail(`ไม่พบ${CHEM_KIND_TEXT[kind]}${ref(id)}`);
    if (doc.kind !== kind) fail(`${doc.id} ไม่ใช่${CHEM_KIND_TEXT[kind]}`);
    return doc;
  }
  function chemText(value, label, min) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text.length < min) fail(`กรุณาระบุ${label} (อย่างน้อย ${min} ตัวอักษร)`);
    if (text.length > rules().CHEM_REASON_MAX) fail(`${label}ยาวเกิน ${rules().CHEM_REASON_MAX} ตัวอักษร`);
    return text;
  }
  const chemLinesOf = (lines, label) => {
    const list = Array.isArray(lines) ? lines : [];
    if (list.length > CHEM_MAX_LINES) fail(`${label}มีได้ไม่เกิน ${CHEM_MAX_LINES} รายการ`);
    return list;
  };
  const doneBy = (doc, ctx) => { doc.doneAt = ctx.now; doc.doneBy = ctx.user?.name ?? ""; };
  const requestStatusText = (doc) => ({ done: "จ่ายครบแล้ว", closed: "ปิดยอดแล้ว", cancelled: "ถูกยกเลิกแล้ว" }[doc.status] ?? "อยู่ในสถานะที่ทำรายการนี้ไม่ได้");

  // RB ขอเบิกเคมีจาก ST (ไม่ผูก WO): lines [{ materialCode, qtyKg }] (จำนวนว่าง / 0 ถูกข้าม) รหัสไม่ซ้ำ วัตถุดิบต้องใช้งานอยู่ · note ไม่บังคับ · คืนเลข CR-
  function requestChemicals(d, { lines, note }, ctx) {
    needRight(ctx, "requestChem");
    const given = chemLinesOf(lines, "ใบขอเบิก").filter((line) => !blankKg(line?.qtyKg) && Number(line.qtyKg) !== 0);
    if (!given.length) fail("กรุณาระบุเคมีและจำนวนที่ขอเบิกอย่างน้อย 1 รายการ");
    const seen = new Set();
    const rows = given.map((line) => {
      const code = String(line.materialCode ?? "").trim();
      const material = d.materials.find((row) => row.code === code) || fail(`ไม่พบวัตถุดิบ${ref(code)}`);
      if (material.active === false) fail(`วัตถุดิบ ${code} เลิกใช้แล้ว ขอเบิกไม่ได้`);
      if (seen.has(code)) fail(`${code} ซ้ำในใบขอเบิก`);
      seen.add(code);
      return { materialCode: code, qtyKg: kgOf(line.qtyKg, `จำนวนที่ขอเบิกของ ${code}`, { positive: true }), issuedKg: 0, issues: [] };
    });
    const id = nextId(d, "CR", ctx.now, ctx, chemList(d), rowId);
    chemList(d).unshift({ id, kind: "request", status: "open", lines: rows, note: chemText(note ?? "", "หมายเหตุ", 0), reason: "", createdAt: ctx.now, createdBy: ctx.user?.name ?? "" });
    audit(d, ctx, "ขอเบิกเคมีจาก ST", `${id} ${rows.map((row) => `${row.materialCode} ${row.qtyKg} kg`).join(", ")}`.slice(0, 300));
    return id;
  }

  // ยกเลิกใบขอเบิกที่ยังไม่ได้จ่ายเลย (open): กลุ่มวางแผน / RB · reason ไม่บังคับ · จ่ายไปบางส่วนแล้ว = ให้ ST ปิดยอดที่เหลือแทน
  function cancelChemicalRequest(d, { id, reason }, ctx) {
    needRight(ctx, "requestChem");
    const doc = findChem(d, id, "request");
    if (doc.status === "partial" || (doc.lines ?? []).some((line) => Number(line.issuedKg) > 0)) fail(`${doc.id} จ่ายไปแล้วบางส่วน ยกเลิกไม่ได้ ให้ ST ปิดยอดที่เหลือแทน`);
    if (doc.status !== "open") fail(`${doc.id} ${requestStatusText(doc)} ยกเลิกไม่ได้`);
    doc.status = "cancelled";
    doc.reason = chemText(reason ?? "", "เหตุผลที่ยกเลิก", 0);
    doneBy(doc, ctx);
    audit(d, ctx, "ยกเลิกใบขอเบิกเคมี", `${doc.id}${doc.reason ? ` — ${doc.reason}` : ""}`);
    return doc.id;
  }

  // ST จ่ายตามใบขอเบิก: kgs = จำนวนจ่ายครั้งนี้ตามลำดับบรรทัด (ว่าง / 0 = ไม่จ่ายบรรทัดนี้) ไม่เกินยอดคงค้าง อย่างน้อยหนึ่งบรรทัด
  // จัดสรร FEFO จากคลัง ST (ข้ามล็อตกักกัน / หมดอายุ · rules.chemIssuePreview ให้หน้าจอแสดงก่อนยืนยัน) แล้วย้าย qtyKg → rbKg ทันที · ครบทุกบรรทัด = done ไม่ครบ = partial
  function issueChemicals(d, { id, kgs }, ctx) {
    needRight(ctx, "issueChem");
    const R = rules();
    const doc = findChem(d, id, "request");
    if (!R.chemRequestOpen(doc)) fail(`${doc.id} ${requestStatusText(doc)} จ่ายไม่ได้`);
    const list = Array.isArray(kgs) ? kgs : [];
    // ใบเบิกเดิมของคลัง ST ที่ค้างชั่งจองยอดของล็อตไว้ (จ่ายส่วนนั้นให้ RB ไม่ได้)
    const reserved = reservedByOpenRequisitions(d, ctx, "ST");
    const plan = doc.lines.map((line, index) => {
      const raw = list[index];
      if (blankKg(raw)) return null;
      const kg = kgOf(raw, `จำนวนจ่ายของ ${line.materialCode}`);
      if (kg === 0) return null;
      const open = R.chemLineOpenKg(line);
      if (kg > open + 1e-9) fail(`${line.materialCode} จ่ายได้ไม่เกินที่ค้าง ${+open.toFixed(4)} kg`);
      const { picks, shortage } = R.allocateFefo(d.materialLots, line.materialCode, Math.min(kg, open), ctx.now, reserved, "ST");
      if (shortage > 1e-9) fail(`คลัง ST มี ${line.materialCode} พร้อมจ่ายไม่พอ (ขาด ${+shortage.toFixed(4)} kg ไม่นับล็อตกักกันหรือหมดอายุ)`);
      return { line, kg: Math.min(kg, open), picks };
    });
    if (!plan.some(Boolean)) fail("กรุณาระบุจำนวนที่จ่ายอย่างน้อย 1 รายการ");
    const by = ctx.user?.name ?? "";
    for (const item of plan.filter(Boolean)) {
      for (const pick of item.picks) {
        const lot = d.materialLots.find((row) => row.lotNo === pick.lotNo);
        const kg = round6(pick.kg);
        deduct(lot, kg, "ST");
        addKg(lot, kg, "RB");
        item.line.issues = [...(Array.isArray(item.line.issues) ? item.line.issues : []), { lotNo: pick.lotNo, kg, at: ctx.now, by }];
      }
      item.line.issuedKg = round6((Number(item.line.issuedKg) || 0) + item.kg);
    }
    const done = doc.lines.every((line) => (Number(line.issuedKg) || 0) >= (Number(line.qtyKg) || 0));
    doc.status = done ? "done" : "partial";
    if (done) doneBy(doc, ctx);
    audit(d, ctx, "จ่ายเคมีให้ RB", `${doc.id} ${plan.filter(Boolean).map((item) => `${item.line.materialCode} ${+item.kg.toFixed(4)} kg`).join(", ")}${done ? " (ครบ)" : ""}`.slice(0, 300));
    return doc.id;
  }

  // ST ปิดยอดที่เหลือของใบขอเบิก (open / partial) พร้อมเหตุผล 3-300 ตัวอักษร · ไม่ย้ายเคมี
  function closeChemicalRequest(d, { id, reason }, ctx) {
    needRight(ctx, "issueChem");
    const doc = findChem(d, id, "request");
    if (!rules().chemRequestOpen(doc)) fail(`${doc.id} ${requestStatusText(doc)} ปิดยอดไม่ได้`);
    doc.reason = chemText(reason, "เหตุผลที่ปิดยอดที่เหลือ", rules().CHEM_REASON_MIN);
    doc.status = "closed";
    doneBy(doc, ctx);
    audit(d, ctx, "ปิดยอดใบขอเบิกเคมี", `${doc.id} — ${doc.reason}`);
    return doc.id;
  }

  // นับ / ปรับยอดคลัง RB รายล็อต (กลุ่มวางแผนเท่านั้น รวมผู้จัดการแผนก RB): lines [{ lotNo, countedKg }] (ว่างถูกข้าม) ล็อตไม่ซ้ำ · reason 3-300 · note ไม่บังคับ
  // ยอดนับไม่เกินยอดรับเข้า − คลัง ST − ที่คืนระหว่างทาง (rules.rbCountCapKg) · ตั้ง rbKg = ยอดนับ · ใบ CC เสร็จทันที
  function countRbStock(d, { lines, reason, note }, ctx) {
    needRight(ctx, "countRb");
    const R = rules();
    const given = chemLinesOf(lines, "ใบนับ").filter((line) => !blankKg(line?.countedKg));
    if (!given.length) fail("กรุณาระบุยอดนับอย่างน้อย 1 ล็อต");
    const why = chemText(reason, "เหตุผลของการนับ / ปรับยอด", R.CHEM_REASON_MIN);
    const seen = new Set();
    const rows = given.map((line) => {
      const lot = d.materialLots.find((row) => row.lotNo === line.lotNo) || fail(`ไม่พบล็อต${ref(line.lotNo)}`);
      if (seen.has(lot.lotNo)) fail(`ล็อต ${lot.lotNo} ซ้ำในใบนับ`);
      seen.add(lot.lotNo);
      const counted = kgOf(line.countedKg, `ยอดนับของล็อต ${lot.lotNo}`, { digits: 4 });
      const cap = R.rbCountCapKg(d, lot);
      if (counted > cap + 1e-6) fail(`ยอดนับของล็อต ${lot.lotNo} เกินที่ล็อตอยู่นอกคลัง ST ได้ (${+cap.toFixed(4)} kg)`);
      return { lot, counted };
    });
    const id = nextId(d, "CC", ctx.now, ctx, chemList(d), rowId);
    const docLines = rows.map(({ lot, counted }) => {
      const beforeKg = R.lotKg(lot, "RB");
      lot.rbKg = counted;
      return { lotNo: lot.lotNo, materialCode: lot.materialCode, beforeKg, countedKg: counted };
    });
    const doc = { id, kind: "count", status: "done", lines: docLines, note: chemText(note ?? "", "หมายเหตุ", 0), reason: why, createdAt: ctx.now, createdBy: ctx.user?.name ?? "" };
    doneBy(doc, ctx);
    chemList(d).unshift(doc);
    audit(d, ctx, "นับคลังเคมี RB", `${id} ${docLines.length} ล็อต — ${why}`.slice(0, 300));
    return id;
  }

  // RB คืนเคมีที่ไม่ใช้ให้ ST รายล็อต: lines [{ lotNo, kg }] (ว่าง / 0 ถูกข้าม) ไม่เกินยอดคลัง RB ของล็อต · หัก rbKg ทันที ใบ CT รอ ST รับ · note ไม่บังคับ
  function returnChemicals(d, { lines, note }, ctx) {
    needRight(ctx, "requestChem");
    const R = rules();
    const given = chemLinesOf(lines, "ใบคืน").filter((line) => !blankKg(line?.kg) && Number(line.kg) !== 0);
    if (!given.length) fail("กรุณาระบุล็อตและจำนวนที่คืนอย่างน้อย 1 รายการ");
    const seen = new Set();
    const rows = given.map((line) => {
      const lot = d.materialLots.find((row) => row.lotNo === line.lotNo) || fail(`ไม่พบล็อต${ref(line.lotNo)}`);
      if (seen.has(lot.lotNo)) fail(`ล็อต ${lot.lotNo} ซ้ำในใบคืน`);
      seen.add(lot.lotNo);
      const have = R.lotKg(lot, "RB");
      // คืนทั้งหมดของล็อต: ค่าที่กรอกห่างจากยอดคลัง RB ไม่ถึง 0.0001 ส่งเป็นยอดเต็ม (ไม่เหลือเศษทศนิยม)
      const kg = Math.abs(Number(line.kg) - have) < 1e-4 ? have : kgOf(line.kg, `จำนวนคืนของล็อต ${lot.lotNo}`, { positive: true, digits: 4 });
      if (kg > have + 1e-9) fail(`ล็อต ${lot.lotNo} คืนได้ไม่เกินยอดในคลัง RB ${+have.toFixed(4)} kg`);
      return { lot, kg };
    });
    const id = nextId(d, "CT", ctx.now, ctx, chemList(d), rowId);
    for (const { lot, kg } of rows) deduct(lot, kg, "RB");
    chemList(d).unshift({
      id, kind: "return", status: "pending", lines: rows.map(({ lot, kg }) => ({ lotNo: lot.lotNo, materialCode: lot.materialCode, kg, receivedKg: null })),
      note: chemText(note ?? "", "หมายเหตุ", 0), reason: "", createdAt: ctx.now, createdBy: ctx.user?.name ?? "",
    });
    audit(d, ctx, "คืนเคมีให้ ST", `${id} ${rows.map(({ lot, kg }) => `${lot.lotNo} ${+kg.toFixed(4)} kg`).join(", ")}`.slice(0, 300));
    return id;
  }

  // ST รับเคมีคืนทั้งใบตามยอดที่ RB ส่ง (ไม่มีรับบางส่วน) เข้าคลัง ST ของล็อตเดิม
  function receiveChemicalReturn(d, { id }, ctx) {
    needRight(ctx, "issueChem");
    const doc = findChem(d, id, "return");
    if (doc.status !== "pending") fail(`${doc.id} ${doc.status === "received" ? "รับคืนแล้ว" : "ถูกปฏิเสธแล้ว"} รับคืนไม่ได้`);
    for (const line of doc.lines) {
      addKg(d.materialLots.find((row) => row.lotNo === line.lotNo) || fail(`ไม่พบล็อต ${line.lotNo}`), Number(line.kg) || 0, "ST");
      line.receivedKg = line.kg;
    }
    doc.status = "received";
    doneBy(doc, ctx);
    audit(d, ctx, "รับเคมีคืนจาก RB", doc.id);
    return doc.id;
  }

  // ST ปฏิเสธใบคืนพร้อมเหตุผล 3-300 ตัวอักษร: ยอดกลับเข้าคลัง RB ของล็อตเดิม
  function rejectChemicalReturn(d, { id, reason }, ctx) {
    needRight(ctx, "issueChem");
    const doc = findChem(d, id, "return");
    if (doc.status !== "pending") fail(`${doc.id} ${doc.status === "received" ? "รับคืนแล้ว" : "ถูกปฏิเสธแล้ว"} ปฏิเสธไม่ได้`);
    doc.reason = chemText(reason, "เหตุผลที่ไม่รับคืน", rules().CHEM_REASON_MIN);
    for (const line of doc.lines) addKg(d.materialLots.find((row) => row.lotNo === line.lotNo) || fail(`ไม่พบล็อต ${line.lotNo}`), Number(line.kg) || 0, "RB");
    doc.status = "rejected";
    doneBy(doc, ctx);
    audit(d, ctx, "ไม่รับเคมีคืน (กลับคลัง RB)", `${doc.id} — ${doc.reason}`);
    return doc.id;
  }

  function recordExtrusion(d, p, ctx) {
    needRight(ctx, "station");
    const { SPECS, orderExtrusionSpec, extrusionHoldReasons } = rules();
    const useKg = num(p.useKg, "น้ำหนักยางที่ใช้");
    const reworkKg = Number(p.reworkKg) || 0;
    const pct = (reworkKg / (useKg + reworkKg)) * 100;
    if (pct > SPECS.extrusion.reworkMaxPct) fail(`สัดส่วนยางหมุนเวียน ${pct.toFixed(1)}% เกิน ${SPECS.extrusion.reworkMaxPct}%`);
    const transfer = takeFromTransfer(d, p.transferId, "extrusion", useKg, ctx);
    const die = find(d.molds, p.dieId, "หัวดาย");
    const params = {
      thickness: num(p.thickness, "ความหนา"),
      width: num(p.width, "ความกว้าง"),
      weightPerM: num(p.weightPerM, "น้ำหนักต่อเมตร"),
      reworkKg, reworkPct: +pct.toFixed(2), useKg,
    };
    const good = num(p.goodQty, "ปริมาณงานดี");
    const order = d.orders.find((row) => row.id === transfer.orderId);
    // สเปกมิติของสูตร (revision ที่ WO ผูก): กักเฉพาะค่าที่สูตรกำหนด · สูตรไม่มีสเปก = บันทึกค่าที่วัดโดยไม่กักตามมิติ (ตรงกับ rf_save_lots ของ 20261129010000)
    const reasons = extrusionHoldReasons(params, orderExtrusionSpec(d.recipes, order));
    const lot = newLot(d, "extrusion", "EX", {
      orderId: transfer.orderId, uom: order?.uom || "m", machine: p.machine, shift: p.shift, dieId: die.id,
      sources: [{ type: "transfer", id: transfer.id, lotId: transfer.lotId, qty: useKg }],
      params, goodQty: good, scrapQty: Number(p.scrapQty) || 0, scrapReason: p.scrapReason || "",
      qc: reasons.length ? "hold" : "pass", holdReasons: reasons,
    }, ctx);
    die.usageSinceClean += good;
    die.totalUsage += good;
    audit(d, ctx, "บันทึกการฉีด", `${lot.id} ${good} ${lot.uom}${reasons.length ? " (QC Hold อัตโนมัติ)" : ""}`);
    return lot.id;
  }

  function recordCuring(d, p, ctx) {
    needRight(ctx, "station");
    const { SPECS, inSpec } = rules();
    const useQty = num(p.useQty, "ปริมาณที่นำเข้าอบ");
    const transfer = takeFromTransfer(d, p.transferId, "curing", useQty, ctx);
    const mold = find(d.molds, p.moldId, "แม่พิมพ์/สายอบ");
    const params = { temp: num(p.temp, "อุณหภูมิ"), time: num(p.time, "เวลาอบ"), pressure: num(p.pressure, "ความดัน") };
    const good = num(p.goodQty, "ปริมาณงานดี");
    const scrap = Number(p.scrapQty) || 0;
    if (good + scrap > useQty + 1e-9) fail("งานดี + ของเสีย ต้องไม่เกินปริมาณที่นำเข้าอบ");
    const reasons = ["temp", "time", "pressure"]
      .filter((key) => !inSpec(params[key], SPECS.curing[key]))
      .map((key) => `${SPECS.curing[key].label} ${params[key]} ${SPECS.curing[key].unit} นอกสเปก`);
    const order = d.orders.find((row) => row.id === transfer.orderId);
    const lot = newLot(d, "curing", "CU", {
      orderId: transfer.orderId, uom: order?.uom || "m", shift: p.shift, moldId: mold.id, machine: mold.name,
      sources: [{ type: "transfer", id: transfer.id, lotId: transfer.lotId, qty: useQty }],
      params, goodQty: good, scrapQty: scrap, scrapReason: p.scrapReason || "",
      qc: reasons.length ? "hold" : "pass", holdReasons: reasons,
    }, ctx);
    const shots = Math.ceil((good + scrap) / (mold.perCycle || 1));
    mold.usageSinceClean += shots;
    mold.totalUsage += shots;
    audit(d, ctx, "บันทึกการอบ", `${lot.id} ${good} ${lot.uom}${reasons.length ? " (QC Hold อัตโนมัติ)" : ""}`);
    return lot.id;
  }

  // ปลายทางของล็อตตกแต่งที่ผ่าน (rf_lots.destination ของ 20261207010000)
  const FINISH_DESTINATIONS = Object.freeze(["sr", "customer"]);

  function recordFinishing(d, p, ctx) {
    needRight(ctx, "station");
    const useQty = num(p.useQty, "ปริมาณที่รับเข้าตกแต่ง");
    const transfer = takeFromTransfer(d, p.transferId, "finishing", useQty, ctx);
    const passed = num(p.passedQty, "จำนวนผ่าน QC");
    const scrap = Number(p.scrapQty) || 0;
    const order = find(d.orders, transfer.orderId, "ใบสั่งผลิต");
    const result = p.qcResult || "pass";
    // ปลายทางของงานที่ผ่าน (ตรงกับ rf_save_lots ของ 20261207010000): sr = คลังยางเส้นยาว (เฉพาะ WO ที่มาจากงาน RB ของ BOM) · customer = ส่งมอบให้ลูกค้าผ่านคลังสินค้าสำเร็จรูป (WH)
    // ไม่ระบุ = WO ที่ผูกงานไป sr · WO ที่ไม่ผูกงานไป customer เสมอ (หน้าฟอร์มให้ WO ที่ผูกงานเลือกเอง) · งานที่กักรอ QC ยังไม่มีปลายทาง
    const linked = Boolean(order.sourceJobId);
    let destination = String(p.destination ?? "").trim() || null;
    // WO ที่ยกเลิกพร้อมใบ (ฝ่ายวางแผนเลือกหยุด): ผลที่ผ่านไปคลังยางเส้นยาว (SR) เท่านั้น เป็นสต็อกกลาง · ส่งมอบให้ลูกค้าไม่ได้ (ตรงกับ rf_save_lots: RF_INVALID_LOT)
    if (order.status === "cancelled" && destination && destination !== "sr") fail("ใบสั่งผลิตนี้ถูกยกเลิกแล้ว ส่งมอบให้ลูกค้าไม่ได้ ยางเส้นยาวเข้าคลังยางเส้นยาว (SR) เป็นสต็อกกลางเท่านั้น");
    if (result === "pass") {
      destination = destination ?? (linked ? "sr" : "customer");
      if (!FINISH_DESTINATIONS.includes(destination)) fail("ปลายทางของงานที่ผ่านไม่ถูกต้อง");
      if (destination === "sr" && !linked) fail("ใบสั่งผลิตนี้ไม่ได้มาจากงาน BOM ส่งเข้าคลังยางเส้นยาว (SR) ไม่ได้ ให้ส่งมอบให้ลูกค้าผ่านคลังสินค้าสำเร็จรูป (WH)");
    } else if (destination) {
      fail("งานที่กักรอ QC ยังไม่มีปลายทาง");
    }
    // กล่องเกิดเมื่อของไปหาลูกค้า (WO ที่ไม่ผูกงานทุกผล หรือ WO ที่ผูกงานที่เลือกส่งมอบให้ลูกค้า): จำนวนต่อกล่องบังคับ · ยางเส้นยาวที่ไป SR และล็อตกักของ WO ที่ผูกงานไม่มีกล่อง
    const boxed = !linked || destination === "customer";
    const perBox = !boxed && String(p.perBox ?? "").trim() === "" ? null : num(p.perBox, "จำนวนต่อกล่อง");
    if (perBox !== null && perBox <= 0) fail("จำนวนต่อกล่องต้องมากกว่า 0");
    if (passed + scrap > useQty + 1e-9) fail("งานผ่าน + ของเสีย ต้องไม่เกินปริมาณที่รับเข้า");
    const lot = newLot(d, "finishing", "FN", {
      orderId: transfer.orderId, uom: order.uom, shift: p.shift, grade: p.grade || "A",
      sources: [{ type: "transfer", id: transfer.id, lotId: transfer.lotId, qty: useQty }],
      params: perBox === null ? {} : { perBox }, goodQty: passed, scrapQty: scrap, scrapReason: p.scrapReason || "",
      qc: result, holdReasons: result === "pass" ? [] : ["ผลตรวจตกแต่งไม่ผ่าน/รอตัดสิน"], destination, whCredit: null,
    }, ctx);
    // กล่อง: ผ่าน = รอคลังสินค้าสำเร็จรูป (WH) รับเข้า (pending_wh) · กัก = hold · ติดลูกค้าและเลข PO / PI ของใบสั่งผลิตไว้กับกล่อง (WH ส่งมอบให้ลูกค้ารายนั้น)
    let left = boxed ? passed : 0;
    let i = 0;
    while (left > 1e-9) {
      const qty = Math.min(perBox, left);
      i += 1;
      d.fgBoxes.unshift({
        id: `${lot.id.replace("FN", "BOX")}-${String(i).padStart(3, "0")}`, lotId: lot.id, orderId: order.id,
        recipeId: order.recipeId, productCode: order.productCode, qty: +qty.toFixed(3), uom: order.uom, grade: lot.grade,
        status: result === "pass" ? "pending_wh" : "hold", createdAt: ctx.now, customer: order.customer ?? "", customerPo: order.customerPo ?? "", moves: [],
      });
      left -= qty;
    }
    lot.boxes = i;
    lot.countedToOrder = result === "pass";
    if (result === "pass") addProduced(d, order.id, passed, ctx);
    const where = destination === "sr" ? `คลังยางเส้นยาว (SR) ของงาน ${order.sourceJobId}`
      : destination === "customer" ? `${i} กล่อง รอคลังสินค้าสำเร็จรูป (WH) รับเข้า` : `${i} กล่อง กักรอ QC`;
    audit(d, ctx, "บันทึกการตกแต่ง/บรรจุ", `${lot.id} ${passed} ${order.uom} → ${where}`);
    return lot.id;
  }

  // ยอดผลิตเข้าใบ: เพิ่มได้อย่างเดียว (ใบที่ปิดแล้วก็เพิ่มได้ ผลิตเกิน / ปล่อยของช้า) ฐานข้อมูลปฏิเสธการลดยอด และการเพิ่มยอดของใบที่ยังไม่ปล่อยผลิตหรือถูกยกเลิก
  // โหมดฐานข้อมูล: QA เพิ่มยอดผ่านการบันทึกผลตรวจ (addQcRecord) ได้อย่างเดียว ปิดใบเองไม่ได้ (เปลี่ยนสถานะเป็นสิทธิ์ของฝ่ายวางแผนและพนักงาน RB)
  function addProduced(d, orderId, qty, ctx) {
    const order = d.orders.find((row) => row.id === orderId);
    if (!order) return;
    const add = Number(qty);
    if (!(add > 0)) return;
    // ฐานข้อมูลรับยอดเฉพาะใบ in_progress / on_hold / completed (ใบ released ต้องเริ่มงานก่อน)
    if (ctx.remote && (["planned", "released"].includes(order.status) || (order.status === "cancelled" && !maySalesStopped(ctx, order)))) fail(`ใบสั่งผลิต ${order.id} ${order.status === "planned" ? "ยังไม่ได้ปล่อยผลิต" : order.status === "released" ? "ยังไม่ได้เริ่มงาน" : "ถูกยกเลิกแล้ว"} บันทึกยอดผลิตเข้าใบไม่ได้`);
    order.producedQty = +(order.producedQty + add).toFixed(3);
    const mayClose = !ctx.remote || Boolean(ctx.user?.planner || ctx.user?.rb);
    if (mayClose && order.producedQty >= order.targetQty && order.status === "in_progress") {
      order.status = "completed";
      audit(d, ctx, "ปิดใบสั่งผลิต (ครบจำนวน)", order.id);
    }
  }

  // ---------- กล่องสินค้า: คลังสินค้าสำเร็จรูป (WH) รับเข้า ส่งมอบให้ลูกค้า และย้อน (20261207010000) ----------
  // ทาง: pending_wh (รอ WH รับ) → in_stock (รับเข้า ทั้งล็อต) → shipped (ส่งมอบ รายกล่อง) · ย้อนรับเข้า in_stock → pending_wh (ทั้งล็อต ไม่มีกล่องที่ส่งแล้ว / กัก)
  // ย้อนส่งมอบ shipped → in_stock (รายกล่อง) · ย้อนต้องมีเหตุผล 3-300 ตัวอักษร (ฐานข้อมูลอ่านจากรายการท้ายของ moves ที่ส่งไป) · ทุกการเปลี่ยนต่อท้าย moves
  // ฐานข้อมูลนับยอดเข้างาน RB ของใบเมื่อรับล็อต customer ของ WO ที่ผูกงาน และถอนยอดเมื่อย้อนรับเข้า (หน้าจอไม่แตะงาน BOM: ส่วนต่างของ BOM มาเอง)
  const BOX_REASON_MIN = 3;
  const BOX_REASON_MAX = 300;
  const boxMove = (kind, note, ctx) => ({ kind, at: ctx.now, by: ctx.user?.name ?? "", note });
  function boxReason(value) {
    const note = String(value ?? "").trim();
    if (note.length < BOX_REASON_MIN) fail(`กรุณาระบุเหตุผลอย่างน้อย ${BOX_REASON_MIN} ตัวอักษร`);
    if (note.length > BOX_REASON_MAX) fail(`เหตุผลยาวได้ไม่เกิน ${BOX_REASON_MAX} ตัวอักษร`);
    return note;
  }

  // รับกล่องของล็อตเข้าคลังสินค้าสำเร็จรูปทีเดียวทั้งล็อต (ทุกกล่องที่รอ WH รับ) ไม่มีตำแหน่งจัดเก็บ
  function receiveBoxes(d, { lotId }, ctx) {
    needRight(ctx, "receiveBoxes");
    const lot = find(d.lots, lotId, "ล็อต");
    const boxes = d.fgBoxes.filter((box) => box.lotId === lot.id && box.status === "pending_wh");
    if (!boxes.length) fail(`ล็อต ${lot.id} ไม่มีกล่องที่รอคลังสินค้าสำเร็จรูป (WH) รับเข้า`);
    boxes.forEach((box) => {
      box.status = "in_stock";
      box.receivedAt = ctx.now;
      box.receivedBy = ctx.user?.name ?? "";
      box.moves = [...(box.moves ?? []), boxMove("receive", "", ctx)];
    });
    audit(d, ctx, "รับกล่องเข้าคลังสินค้าสำเร็จรูป (WH)", `${lot.id} ${boxes.length} กล่อง`);
    return lot.id;
  }

  function shipBoxes(d, { ids }, ctx) {
    needRight(ctx, "shipBoxes");
    if (!Array.isArray(ids) || !ids.length) fail("กรุณาเลือกกล่องที่จะส่งมอบ");
    ids.forEach((id) => {
      const box = find(d.fgBoxes, id, "กล่อง");
      if (box.status !== "in_stock") fail(`กล่อง ${id} ไม่พร้อมส่ง${box.status === "pending_wh" ? " (รอคลังสินค้าสำเร็จรูปรับเข้าก่อน)" : ""}`);
      box.status = "shipped";
      box.shippedAt = ctx.now;
      box.shippedBy = ctx.user?.name;
      box.moves = [...(box.moves ?? []), boxMove("ship", "", ctx)];
    });
    audit(d, ctx, "ส่งมอบสินค้า", `${ids.length} กล่อง`);
  }

  // ย้อนการรับเข้าทั้งล็อต (รับผิดล็อต): กล่องกลับไปรอ WH รับ · ล็อตที่มีกล่องส่งมอบแล้วหรือถูกกักย้อนไม่ได้ (ย้อนส่งมอบ / รอ QA ก่อน)
  function reverseBoxReceipt(d, { lotId, note }, ctx) {
    needRight(ctx, "reverseBoxes");
    const reason = boxReason(note);
    const lot = find(d.lots, lotId, "ล็อต");
    const boxes = d.fgBoxes.filter((box) => box.lotId === lot.id);
    if (boxes.some((box) => box.status === "shipped" || box.status === "hold")) {
      fail(`ล็อต ${lot.id} มีกล่องที่ส่งมอบแล้วหรือถูกกักรอ QC ย้อนการรับเข้าไม่ได้ (ย้อนการส่งมอบกล่องนั้นก่อน)`);
    }
    const inStock = boxes.filter((box) => box.status === "in_stock");
    if (!inStock.length) fail(`ล็อต ${lot.id} ไม่มีกล่องที่รับเข้าคลังแล้ว`);
    inStock.forEach((box) => {
      box.status = "pending_wh";
      delete box.receivedAt;
      delete box.receivedBy;
      box.moves = [...(box.moves ?? []), boxMove("unreceive", reason, ctx)];
    });
    audit(d, ctx, "ย้อนการรับกล่องเข้าคลังสินค้าสำเร็จรูป (WH)", `${lot.id} ${inStock.length} กล่อง: ${reason}`);
    return lot.id;
  }

  // ย้อนการส่งมอบรายกล่อง (ส่งผิด / ลูกค้าคืน): กล่องกลับเข้าคลัง
  function reverseBoxShip(d, { ids, note }, ctx) {
    needRight(ctx, "reverseBoxes");
    const reason = boxReason(note);
    if (!Array.isArray(ids) || !ids.length) fail("กรุณาเลือกกล่องที่จะย้อนการส่งมอบ");
    ids.forEach((id) => {
      const box = find(d.fgBoxes, id, "กล่อง");
      if (box.status !== "shipped") fail(`กล่อง ${id} ยังไม่ได้ส่งมอบ`);
      box.status = "in_stock";
      delete box.shippedAt;
      delete box.shippedBy;
      box.moves = [...(box.moves ?? []), boxMove("unship", reason, ctx)];
    });
    audit(d, ctx, "ย้อนการส่งมอบสินค้า", `${ids.length} กล่อง: ${reason}`);
  }

  // ---------- ส่งมอบ WIP (Gatekeeper) ----------

  function transferableQty(lot, now) {
    const { NEXT_STAGE } = rules();
    if (lot.qc !== "pass") return 0;
    if (lot.stage === "mixing" && lot.readyAt > now) return 0;
    if (!NEXT_STAGE[lot.stage]) return 0;
    return Math.max(0, +(lot.goodQty - lot.transferredQty).toFixed(3));
  }

  function createTransfer(d, { lotId, qty, note }, ctx) {
    needRight(ctx, "sendTransfer");
    const { NEXT_STAGE } = rules();
    const lot = find(d.lots, lotId, "ล็อต");
    if (!NEXT_STAGE[lot.stage]) fail("ล็อตนี้เป็นขั้นตอนสุดท้ายแล้ว");
    if (lot.qc !== "pass") fail("ด่านรับมอบ: ล็อตยังไม่ผ่าน QC ส่งต่อไม่ได้");
    if (lot.stage === "mixing" && lot.readyAt > ctx.now) fail("ด่านรับมอบ: ยางยังบ่มไม่ครบเวลา");
    const q = num(qty, "ปริมาณส่งมอบ");
    const available = transferableQty(lot, ctx.now);
    if (q <= 0 || q > available + 1e-9) fail(`ปริมาณส่งมอบต้องอยู่ระหว่าง 0–${available}`);
    lot.transferredQty = +(lot.transferredQty + q).toFixed(3);
    const id = nextId(d, "TR", ctx.now, ctx, d.transfers, rowId);
    d.transfers.unshift({
      id, lotId, orderId: lot.orderId, from: lot.stage, to: NEXT_STAGE[lot.stage], uom: lot.uom,
      qtySent: q, qtyReceived: null, remaining: 0, condition: null, note: note || "",
      status: "in_transit", createdAt: ctx.now, createdBy: ctx.user?.name,
    });
    audit(d, ctx, "ส่งมอบ WIP", `${id} ${lotId} ${q} ${lot.uom}`);
    return id;
  }

  // รับมอบ WIP ระหว่างสถานีไม่แตะงาน BOM (ฐานข้อมูลป้อนผลผลิตกลับงาน BOM เฉพาะเมื่อล็อตตกแต่งที่ QC ผ่านนับเข้าใบสั่งผลิต) หน้าจอไม่แตะงาน BOM
  function receiveTransfer(d, { id, qtyReceived, condition }, ctx) {
    needRight(ctx, "receiveTransfer");
    const transfer = find(d.transfers, id, "ใบส่งมอบ");
    if (transfer.status !== "in_transit") fail("ใบส่งมอบนี้รับไปแล้ว");
    const q = num(qtyReceived, "จำนวนที่รับจริง");
    if (q < 0 || q > transfer.qtySent * 1.02) fail("จำนวนรับจริงต้องไม่เกินจำนวนที่ส่ง (+2%)");
    transfer.qtyReceived = q;
    transfer.remaining = q;
    transfer.condition = condition || "ok";
    transfer.status = "received";
    transfer.receivedAt = ctx.now;
    transfer.receivedBy = ctx.user?.name;
    audit(d, ctx, "รับมอบ WIP", `${id} รับ ${q}/${transfer.qtySent} ${transfer.uom}`);
  }

  // ---------- คุณภาพ ----------

  function addQcRecord(d, p, ctx) {
    needRight(ctx, "qc");
    const { SPECS, inSpec } = rules();
    const lot = find(d.lots, p.lotId, "ล็อต");
    const values = p.values ?? {};
    const tests = Object.entries(SPECS.lab)
      .filter(([key]) => values[key] !== "" && values[key] !== undefined && values[key] !== null)
      .map(([key, spec]) => ({ key, value: Number(values[key]), pass: inSpec(values[key], spec) }));
    if (!tests.length) fail("กรุณากรอกผลทดสอบอย่างน้อย 1 รายการ");
    const allPass = tests.every((test) => test.pass);
    const result = p.result || (allPass ? "pass" : "hold");
    if (!["pass", "hold", "fail"].includes(result)) fail("ผลตัดสินไม่ถูกต้อง");
    if (result === "pass" && !allPass) fail('มีค่าทดสอบนอกสเปก ตัดสินเป็น "ผ่าน" ไม่ได้');
    // ล็อตที่กักอยู่ตัดสินเป็นผ่านหรือไม่ผ่าน = ปล่อยล็อต: หัวหน้า QA เท่านั้น · กักต่อ/ตรวจซ้ำ และผลของล็อตที่ไม่ได้กัก ยังเป็นของ QA ทุกคน
    if (lot.qc === "hold" && result !== "hold") needRight(ctx, "qaRelease");
    const id = nextId(d, "QC", ctx.now, ctx, d.qcRecords, rowId);
    d.qcRecords.unshift({ id, lotId: lot.id, orderId: lot.orderId, stage: lot.stage, tests, result, note: p.note || "", inspector: ctx.user?.name, at: ctx.now });
    lot.qc = result;
    if (result === "pass") lot.holdReasons = [];
    // กล่อง (ตรงกับ rf_save_qc ของ 20261207010000): ผ่าน = เฉพาะกล่องที่กักไว้กลับที่เดิม (WH รับเข้าแล้ว = in_stock · ยังไม่รับ = pending_wh) · อื่น = กล่องที่ยังไม่ส่งมอบเป็น hold
    // ล็อต fail ที่นับยอดเข้างาน RB ไว้: ฐานข้อมูลถอนยอดนั้นและล้าง whCredit (งาน BOM มาเองทางส่วนต่างของ BOM) · QA บันทึก fail ได้เสมอ
    // ใบ BOM ที่ปิดแล้ว (หน้านี้ไม่รู้สถานะใบ) ฐานข้อมูลไม่ถอนและคง whCredit ไว้ แถวล็อตจากส่วนต่างหลังบันทึกแทนค่านี้
    d.fgBoxes.filter((box) => box.lotId === lot.id && (result === "pass" ? box.status === "hold" : box.status !== "shipped")).forEach((box) => {
      box.status = result !== "pass" ? "hold" : box.receivedAt ? "in_stock" : "pending_wh";
    });
    if (result === "fail" && lot.whCredit) lot.whCredit = null;
    if (lot.stage === "finishing" && result === "pass" && !lot.countedToOrder) {
      // ล็อตตกแต่งที่เคยถูกกักกันนับเข้าใบสั่งผลิตเมื่อผ่านเท่านั้น · ปลายทางที่ยังว่าง: WO ที่ผูกงาน BOM ไปคลังยางเส้นยาว (SR) · ที่ไม่ผูกงานส่งมอบให้ลูกค้าผ่าน WH
      lot.countedToOrder = true;
      if (!lot.destination) lot.destination = d.orders.find((row) => row.id === lot.orderId)?.sourceJobId ? "sr" : "customer";
      addProduced(d, lot.orderId, lot.goodQty, ctx);
    }
    audit(d, ctx, "บันทึกผล QC", `${id} ${lot.id} → ${result}`);
    return id;
  }

  function createNcr(d, p, ctx) {
    needRight(ctx, "qc");
    if (!p.title?.trim()) fail("กรุณาระบุหัวข้อปัญหา");
    if (!p.lotId?.trim()) fail("กรุณาระบุล็อตที่พบปัญหา");
    const id = nextId(d, "NCR", ctx.now, ctx, d.ncrs, rowId);
    const lot = d.lots.find((row) => row.id === p.lotId.trim());
    if (lot && lot.qc === "pass") {
      lot.qc = "hold";
      lot.holdReasons = [...(lot.holdReasons || []), `เปิด ${id}`];
    }
    d.ncrs.unshift({
      id, title: p.title.trim(), stage: p.stage, lotId: p.lotId.trim(), severity: p.severity || "major",
      defectQty: Number(p.defectQty) || 0, whys: (p.whys || []).filter(Boolean), containment: p.containment || "",
      corrective: p.corrective || "", preventive: p.preventive || "", owner: p.owner || ctx.user?.name,
      status: "open", createdAt: ctx.now, createdBy: ctx.user?.name,
    });
    audit(d, ctx, "เปิด NCR", `${id} ${p.title}`);
    return id;
  }

  // แผนก RB (และ QA) กรอกการแก้ไข/ป้องกันของ NCR ที่เปิดอยู่ได้ ไม่ต้องมีสิทธิ์ปิดเคส · ช่องที่ไม่ส่งมาไม่ถูกแตะ
  function updateNcr(d, { id, corrective, preventive }, ctx) {
    needRight(ctx, "fillNcr");
    const ncr = find(d.ncrs, id, "NCR");
    if (ncr.status === "closed") fail("NCR นี้ปิดแล้ว แก้ไขไม่ได้");
    const next = { corrective: corrective === undefined ? undefined : String(corrective).trim(), preventive: preventive === undefined ? undefined : String(preventive).trim() };
    if (next.corrective === undefined && next.preventive === undefined) fail("กรุณากรอกการแก้ไข (Corrective) หรือการป้องกัน (Preventive)");
    if (!next.corrective && !next.preventive && !(ncr.corrective || ncr.preventive)) fail("กรุณากรอกการแก้ไข (Corrective) หรือการป้องกัน (Preventive)");
    if (next.corrective !== undefined) ncr.corrective = next.corrective;
    if (next.preventive !== undefined) ncr.preventive = next.preventive;
    audit(d, ctx, "บันทึกการแก้ไข/ป้องกัน NCR", id);
  }

  function closeNcr(d, { id, verification }, ctx) {
    needRight(ctx, "qc");
    const ncr = find(d.ncrs, id, "NCR");
    if (ncr.status === "closed") fail("NCR นี้ปิดแล้ว");
    if (!ncr.corrective?.trim()) fail("ต้องมีการแก้ไข (Corrective action) ก่อนปิดเคส");
    // ฐานข้อมูลปิดเคสได้เมื่อมีทั้งการแก้ไขและการป้องกัน (โหมดสาธิตตรวจแค่การแก้ไขเหมือนเดิม)
    if (ctx.remote && !ncr.preventive?.trim()) fail("ต้องมีการป้องกัน (Preventive action) ก่อนปิดเคส");
    ncr.status = "closed";
    ncr.closedAt = ctx.now;
    ncr.closedBy = ctx.user?.name;
    ncr.verification = verification || "";
    audit(d, ctx, "ปิด NCR", id);
  }

  // ---------- แม่พิมพ์และหัวดาย ----------

  const MOLD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
  const MOLD_KINDS = Object.freeze(["die", "mold", "line"]);
  const MOLD_UNITS = Object.freeze(["m", "pcs", "shot"]);
  // เพิ่มหรือแก้แม่พิมพ์/หัวดาย/สายอบ (รหัสแก้ไม่ได้) · ยอดใช้งานสะสมนับจากการบันทึกผลิตเท่านั้น แก้ด้วยมือไม่ได้
  function saveMold(d, p, ctx) {
    needRight(ctx, "editMold");
    const id = String(p.id ?? "").trim();
    if (!id) fail("กรุณาระบุรหัสแม่พิมพ์");
    if (!MOLD_ID.test(id)) fail("รหัสแม่พิมพ์ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง (ไม่มีช่องว่าง) ยาวไม่เกิน 40 ตัวอักษร");
    const name = String(p.name ?? "").trim();
    if (!name) fail("กรุณาระบุชื่อ");
    const kind = String(p.kind ?? "");
    const unit = String(p.unit ?? "");
    if (!MOLD_KINDS.includes(kind)) fail("ชนิดไม่ถูกต้อง");
    if (!MOLD_UNITS.includes(unit)) fail("หน่วยนับไม่ถูกต้อง");
    const perCycle = num(p.perCycle, "จำนวนช่องแม่พิมพ์ต่อรอบ");
    const cleanEvery = num(p.cleanEvery, "รอบทำความสะอาด");
    const pmLimit = num(p.pmLimit, "อายุสะสมก่อน PM ใหญ่");
    if (!Number.isInteger(perCycle) || perCycle < 1) fail("จำนวนช่องแม่พิมพ์ต่อรอบต้องเป็นจำนวนเต็มตั้งแต่ 1");
    if (!(cleanEvery > 0) || !(pmLimit > 0)) fail("รอบทำความสะอาดและอายุสะสมก่อน PM ใหญ่ต้องมากกว่า 0");
    const fields = { name: name.slice(0, 120), kind, unit, perCycle, cleanEvery, pmLimit };
    const existing = d.molds.find((row) => row.id === id);
    if (existing) {
      Object.assign(existing, fields);
      audit(d, ctx, "แก้แม่พิมพ์/หัวดาย", id);
    } else {
      d.molds.push({ id, ...fields, usageSinceClean: 0, totalUsage: 0, lastCleanAt: ctx.now });
      audit(d, ctx, "เพิ่มแม่พิมพ์/หัวดาย", id);
    }
    return id;
  }

  function cleanMold(d, { id }, ctx) {
    needRight(ctx, "station");
    const mold = find(d.molds, id, "แม่พิมพ์");
    mold.usageSinceClean = 0;
    mold.lastCleanAt = ctx.now;
    audit(d, ctx, "บันทึกทำความสะอาดแม่พิมพ์/หัวดาย", id);
  }

  const api = {
    ORDER_FLOW, createOrder, setOrderStatus, saveMaterial, createRecipe, saveRecipe, approveRecipe, createRequisition, weighLine, issueRequisition, receiveMaterial, createPurchaseOrder, receivePurchaseLine, closePurchaseLine, cancelPurchaseOrder, setMaterialLotStatus,
    recordMixing, endRest, returnRequisition, recordExtrusion, recordCuring, recordFinishing, shipBoxes, transferableQty, createTransfer, receiveTransfer,
    receiveBoxes, reverseBoxReceipt, reverseBoxShip, FINISH_DESTINATIONS,
    addQcRecord, createNcr, updateNcr, closeNcr, saveMold, cleanMold,
    requestChemicals, cancelChemicalRequest, issueChemicals, closeChemicalRequest, countRbStock, returnChemicals, receiveChemicalReturn, rejectChemicalReturn,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_RUBBERFLOW_ACTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
