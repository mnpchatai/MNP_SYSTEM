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
  const MAY = Object.freeze({
    master: (user) => Boolean(user.planner || user.rb), // วัตถุดิบ / สูตร (ร่าง) / เปิดใบสั่งผลิต: ฝ่ายวางแผนขึ้นไป หรือพนักงานแผนก RB
    approve: (user) => Boolean(user.rbHead), // อนุมัติสูตร: หัวหน้า RB ขึ้นไป
    release: (user) => Boolean(user.planner || user.rbHead), // ปล่อยผลิต
    work: (user) => Boolean(user.planner || user.rb), // สถานะอื่นของใบสั่งผลิต
    receiveMaterial: (user) => Boolean(user.st || user.role === "admin"), // รับวัตถุดิบเข้าคลัง (รวมรับเข้าตามใบสั่งซื้อ): แผนก ST เท่านั้น (admin ไว้แก้ปัญหา)
    holdMaterial: (user) => Boolean(user.planner || user.st || user.qa), // กักกัน/ปลดกักกันล็อตวัตถุดิบ: ST หรือ QA
    requisition: (user) => Boolean(user.planner || user.rb), // เบิกเคมี (สร้างใบเบิกและจ่ายทันที) / จ่ายใบเก่าที่ค้างชั่ง: แผนก RB
    station: (user) => Boolean(user.planner || user.rb), // ผสม ฉีด อบ ตกแต่ง ข้ามเวลาบ่ม ทำความสะอาดแม่พิมพ์: แผนก RB
    sendTransfer: (user) => Boolean(user.planner || user.rb), // สร้างใบส่งมอบ WIP: แผนก RB
    receiveTransfer: (user) => Boolean(user.planner || user.sr), // รับมอบ WIP: แผนก SR
    shipBoxes: (user) => Boolean(user.planner || user.wh), // ส่งมอบกล่องสินค้า: คลังสินค้า (WH)
    qc: (user) => Boolean(user.planner || user.qa), // ผลตรวจ เปิด/ปิด NCR: แผนก QA
    fillNcr: (user) => Boolean(user.planner || user.qa || user.rb), // กรอกการแก้ไข/ป้องกันของ NCR ที่เปิดอยู่: QA หรือ RB
    editMold: (user) => Boolean(user.planner || user.rb), // เพิ่ม/แก้แม่พิมพ์: แผนก RB
    purchase: (user) => Boolean(user.st || user.role === "admin"), // สั่งซื้อวัตถุดิบ (สร้างใบสั่งซื้อ): แผนก ST เท่านั้น (admin ไว้แก้ปัญหา)
    cancelPurchase: (user) => Boolean(user.st || user.role === "admin"), // ยกเลิกใบสั่งซื้อ: แผนก ST
  });
  const MAY_TEXT = Object.freeze({
    master: "แก้ข้อมูลหลักของ RubberFlow ได้โดยฝ่ายวางแผน ผู้จัดการ ผู้ดูแลระบบ หรือพนักงานแผนก RB",
    approve: "อนุมัติสูตรได้โดยผู้จัดการแผนก RB หรือผู้ช่วยผู้จัดการแผนก RB ผู้จัดการโรงงานขึ้นไป หรือผู้ดูแลระบบ",
    release: "ปล่อยผลิตได้โดยฝ่ายวางแผน ผู้จัดการ หรือผู้จัดการแผนก RB",
    work: "เปลี่ยนสถานะใบสั่งผลิตได้โดยฝ่ายวางแผน ผู้จัดการ หรือพนักงานแผนก RB",
    receiveMaterial: "รับวัตถุดิบเข้าคลังได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
    holdMaterial: "กักกัน/ปลดกักกันล็อตวัตถุดิบได้โดยแผนกคลังวัตถุดิบ (ST) หรือ QA",
    requisition: "เบิกเคมีได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    station: "บันทึกการผลิตของสถานีได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    sendTransfer: "สร้างใบส่งมอบ WIP ได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    receiveTransfer: "รับมอบ WIP ได้โดยแผนก SR หรือฝ่ายวางแผน",
    shipBoxes: "ส่งมอบกล่องสินค้าได้โดยแผนกคลังสินค้า (WH) หรือฝ่ายวางแผน",
    qc: "บันทึกผลตรวจและเปิด/ปิด NCR ได้โดยแผนก QA หรือฝ่ายวางแผน",
    fillNcr: "กรอกการแก้ไขและป้องกันของ NCR ได้โดยแผนก QA พนักงานแผนก RB หรือฝ่ายวางแผน",
    editMold: "เพิ่ม/แก้แม่พิมพ์ได้โดยพนักงานแผนก RB หรือฝ่ายวางแผน",
    purchase: "สั่งซื้อวัตถุดิบได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
    cancelPurchase: "ยกเลิกใบสั่งซื้อได้โดยแผนกคลังวัตถุดิบ (ST) เท่านั้น",
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
    needRight(ctx, "master");
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

  function recipeFields(p) {
    const items = (p.items ?? []).filter((item) => item.materialCode && Number(item.phr) > 0);
    if (!items.length) fail("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
    const productCode = String(p.productCode ?? "").trim();
    if (productCode.length > 60) fail("รหัสสินค้ายาวเกิน 60 ตัวอักษร");
    return {
      productCode,
      uom: p.uom || "m",
      batchKg: num(p.batchKg, "น้ำหนักต่อชุดผสม"),
      stages: rules().MIX_STAGES.map((stage) => stageValues((p.stages ?? []).find((row) => Number(row?.stage) === stage), stage)),
      dumpTol: Number(p.dumpTol) || 5,
      restHours: Number(p.restHours) || 4,
      yieldPerKg: num(p.yieldPerKg, "ผลผลิตต่อกิโลกรัม"),
      items: items.map((item) => ({ materialCode: item.materialCode, phr: Number(item.phr), stage: Number(item.stage) === 2 ? 2 : 1 })),
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
  function reservedByOpenRequisitions(d, ctx) {
    const reserved = {};
    d.requisitions.filter((requisition) => requisition.status === "weighing").forEach((requisition) =>
      requisition.lines.filter((line) => !ctx.remote || line.actualKg === null).forEach((line) => { reserved[line.lotNo] = (reserved[line.lotNo] || 0) + line.targetKg; }));
    return reserved;
  }

  // ล็อตของบรรทัดต้องใช้ได้และมีพอ แล้วหักสต็อกตามกิโลที่จ่าย (ฐานข้อมูลทำเองเช่นกัน)
  function takeFromLot(d, line, kg, ctx) {
    const { lotState } = rules();
    const lot = d.materialLots.find((row) => row.lotNo === line.lotNo);
    if (!lot || lotState(lot, ctx.now) !== "available") fail(`ล็อต ${line.lotNo} ใช้ไม่ได้แล้ว (หมดอายุ/กักกัน/หมด)`);
    if (lot.qtyKg < kg) fail(`ล็อต ${line.lotNo} คงเหลือไม่พอ`);
    return lot;
  }
  // หักแล้วติดลบ = หยุด ไม่ปัดเป็น 0 เงียบ ๆ (|| 0 กัน -0)
  const deduct = (lot, kg) => {
    if (kg > lot.qtyKg + 1e-9) fail(`ล็อต ${lot.lotNo} คงเหลือไม่พอ`);
    lot.qtyKg = +(lot.qtyKg - kg).toFixed(6) || 0;
  };

  // เบิก = สร้างใบเบิกและจ่ายทันที: ระเบิดสูตร จัดสรร FEFO หักสต็อกล็อตตามบรรทัด จ่ายตามสูตร (actualKg = targetKg) สถานะ issued พร้อมผสม · ไม่มีขั้นตอนชั่งรายบรรทัด
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
    const reserved = reservedByOpenRequisitions(d, ctx);
    const lines = [];
    const shortages = [];
    for (const item of recipeLines(recipe)) {
      const need = item.kgPerBatch * n;
      const { picks, shortage } = allocateFefo(d.materialLots, item.materialCode, need, ctx.now, reserved);
      if (shortage > 0.0001) shortages.push(`${item.materialCode} ขาด ${shortage.toFixed(2)} kg`);
      picks.forEach((pick) => {
        reserved[pick.lotNo] = (reserved[pick.lotNo] || 0) + pick.kg;
        lines.push({ materialCode: item.materialCode, stage: item.stage, lotNo: pick.lotNo, targetKg: pick.kg, actualKg: pick.kg, weighedAt: ctx.now, weighedBy: ctx.user?.name });
      });
    }
    if (shortages.length) fail(`สต็อกไม่พอตามหลัก FEFO: ${shortages.join(", ")}`);
    for (const line of lines) deduct(d.materialLots.find((row) => row.lotNo === line.lotNo), line.targetKg);
    const id = nextId(d, "REQ", ctx.now, ctx, d.requisitions, rowId);
    d.requisitions.unshift({
      id, orderId, recipeId: recipe.id, recipeRevision: recipe.revision, batches: n, totalKg: recipe.batchKg * n, lines,
      status: "issued", note: note || "", requestedBy: ctx.user?.name, createdAt: ctx.now, issuedAt: ctx.now, issuedBy: ctx.user?.name,
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
    const lot = takeFromLot(d, line, kg, ctx);
    line.actualKg = kg;
    line.weighedAt = ctx.now;
    line.weighedBy = ctx.user?.name;
    // โหมดฐานข้อมูล: ฐานข้อมูลหักสต็อกของล็อตทันทีที่ชั่งแต่ละรายการ (โหมดสาธิตหักตอนชั่งครบทุกรายการ)
    if (ctx.remote) deduct(lot, kg);
    if (requisition.lines.every((row) => row.actualKg !== null)) finishWeighing(d, requisition, ctx);
  }

  // จ่ายทั้งใบที่ค้างสถานะ weighing: ทุกบรรทัดที่ยังไม่ชั่งจ่ายตามสูตร (actualKg = targetKg) หักสต็อกเท่ากัน แล้วใบเป็น issued ในคราวเดียว
  function issueRequisition(d, { id }, ctx) {
    needRight(ctx, "requisition");
    const requisition = find(d.requisitions, id, "ใบเบิก");
    if (requisition.status !== "weighing") fail("ใบเบิกนี้จ่ายวัตถุดิบครบแล้ว");
    const open = requisition.lines.filter((line) => line.actualKg === null);
    // ตรวจทุกบรรทัดก่อนแก้อะไร (ล็อตเดียวกันอาจอยู่หลายบรรทัด จึงรวมกิโลต่อล็อต)
    const need = {};
    for (const line of open) takeFromLot(d, line, 0, ctx);
    for (const line of ctx.remote ? open : requisition.lines) need[line.lotNo] = (need[line.lotNo] || 0) + line.targetKg;
    for (const [lotNo, kg] of Object.entries(need)) {
      if (d.materialLots.find((row) => row.lotNo === lotNo).qtyKg < kg - 1e-9) fail(`ล็อต ${lotNo} คงเหลือไม่พอ`);
    }
    for (const line of open) {
      line.actualKg = line.targetKg;
      line.weighedAt = ctx.now;
      line.weighedBy = ctx.user?.name;
      if (ctx.remote) deduct(d.materialLots.find((row) => row.lotNo === line.lotNo), line.targetKg);
    }
    finishWeighing(d, requisition, ctx);
  }

  // ทุกบรรทัดจ่ายแล้ว: โหมดสาธิตหักสต็อกทั้งใบตอนนี้ (โหมดฐานข้อมูลหักไปแล้วรายบรรทัด) แล้วใบเป็น issued
  function finishWeighing(d, requisition, ctx) {
    if (!ctx.remote) {
      requisition.lines.forEach((row) => deduct(d.materialLots.find((item) => item.lotNo === row.lotNo), row.actualKg));
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
      lotNo, materialCode: material.code, qtyKg: qty, initialKg: qty, expiry: p.expiry, receivedAt: ctx.now,
      supplier: p.supplier || "-", location: p.location || material.storage, status: "available", coa: Boolean(p.coa),
    });
    audit(d, ctx, "รับวัตถุดิบเข้าคลัง", `${lotNo} ${qty} kg`);
    return lotNo;
  }

  // ---------- ใบสั่งซื้อวัตถุดิบ ----------
  // ใบสั่งซื้อ { id: PO-yyyymmdd-nn, status: ordered|received|cancelled, sourcePi, sourceRequisition, note, lines, createdAt, createdBy, cancelledAt }
  // บรรทัด { materialCode, source: rf|bom, uom: null|หน่วยของชิ้น, needKg, availableKg, shortageKg, safetyKg, qtyKg, receivedKg|null, lotNo|null, expiry|null, receivedAt|null, receivedBy|null }
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
  const isReceived = (line) => line.receivedKg !== null && line.receivedKg !== undefined;

  // lines: [{ materialCode, needKg, availableKg, shortageKg, safetyKg?, qtyKg }] (บรรทัดที่จำนวนสั่งเป็น 0 ถูกข้าม) · safety: { รหัสวัตถุดิบ: kg } = สต็อกขั้นต่ำที่แก้ในหน้าสั่งซื้อ บันทึกเข้าวัตถุดิบในคำสั่งเดียวกัน
  function createPurchaseOrder(d, p, ctx) {
    needRight(ctx, "purchase");
    d.purchaseOrders ??= [];
    const safety = p.safety && typeof p.safety === "object" ? p.safety : {};
    // สต็อกขั้นต่ำของเคมีแก้ได้เฉพาะผู้ที่แก้วัตถุดิบได้ (กลุ่มวางแผน / RB ตามประตูของ app_rf_save) · ผู้สั่งที่ไม่มีสิทธิ์นั้น (ST) สั่งด้วยค่าที่เก็บอยู่ ไม่แตะวัตถุดิบ
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
        // สต็อกขั้นต่ำของซื้อ (เก็บที่คลังของซื้อ) แก้ได้เฉพาะกลุ่มวางแผน: สมาชิก RB สั่งซื้อได้ต่อเมื่อค่าเท่าที่เก็บ (storedSafetyKg ที่หน้าต่างสั่งซื้อส่งมา) · ฐานข้อมูลตรวจซ้ำ (RF_FORBIDDEN)
        if (ctx.remote && !(ctx.user?.planner || ctx.user?.st)) {
          const wanted = partSafetyOf(Object.hasOwn(safety, code) ? safety[code] : line.safetyKg ?? 0, code);
          if (wanted !== partSafetyOf(line.storedSafetyKg ?? 0, code)) fail(`แก้สต็อกขั้นต่ำของของซื้อ ${code} ได้โดยฝ่ายวางแผนหรือคลังวัตถุดิบ (ST)`);
        }
        return {
          materialCode: code, source: "bom", uom, needKg: kgOf(line.needKg ?? 0, `ความต้องการของ ${code}`), availableKg: signedKgOf(line.availableKg ?? 0, `พร้อมใช้ของ ${code}`), shortageKg: kgOf(line.shortageKg ?? 0, `ส่วนที่ขาดของ ${code}`),
          safetyKg: partSafetyOf(Object.hasOwn(safety, code) ? safety[code] : line.safetyKg ?? 0, code), qtyKg: kgOf(line.qtyKg, `จำนวนสั่งของ ${code}`, { positive: true }),
          receivedKg: null, lotNo: null, expiry: null, receivedAt: null, receivedBy: null,
        };
      }
      const material = d.materials.find((row) => row.code === code) || fail(`ไม่พบวัตถุดิบ${ref(code)}`);
      if (material.active === false) fail(`วัตถุดิบ ${code} เลิกใช้แล้ว สั่งซื้อไม่ได้`);
      if (seen.has(code)) fail(`${code} ซ้ำในใบสั่งซื้อ`);
      seen.add(code);
      const safetyKg = maySafety ? kgOf(Object.hasOwn(safety, code) ? safety[code] : line.safetyKg ?? material.safetyKg ?? 0, `สต็อกขั้นต่ำของ ${code}`) : kgOf(material.safetyKg ?? 0, `สต็อกขั้นต่ำของ ${code}`);
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

  // ตรวจสอบรับเข้า: รับได้ครั้งเดียวต่อบรรทัด (ส่งมาไม่ครบ = รับเท่าที่มา ที่เหลือสั่งใหม่) สร้างล็อตวัตถุดิบ (พร้อมใช้ ผู้ขาย = เลขใบสั่งซื้อถ้าไม่กรอก ที่เก็บ = ที่จัดเก็บของวัตถุดิบ) และปิดบรรทัดในคำสั่งเดียวกัน · ทุกบรรทัดรับครบ = ใบเป็น received
  function receivePurchaseLine(d, { id, materialCode, qtyKg, expiry, supplier }, ctx) {
    needRight(ctx, "receiveMaterial");
    const order = find(d.purchaseOrders ?? [], id, "ใบสั่งซื้อ");
    if (order.status !== "ordered") fail(`ใบสั่งซื้อ ${order.id} ${order.status === "received" ? "รับครบแล้ว" : "ถูกยกเลิกแล้ว"} รับเข้าไม่ได้`);
    const line = order.lines.find((row) => row.materialCode === materialCode) || fail(`ไม่พบวัตถุดิบ${ref(materialCode)} ในใบสั่งซื้อ ${order.id}`);
    if (isReceived(line)) fail(`${materialCode} ในใบสั่งซื้อ ${order.id} รับเข้าแล้ว`);
    if (line.source === "bom") {
      // ของซื้อ: รับเฉพาะปริมาณจริง (ไม่มีล็อต/วันหมดอายุ) ยอดคงเหลือของ BOM เพิ่มที่ฐานข้อมูลในคำสั่งเดียวกัน
      const qty = kgOf(qtyKg, "ปริมาณที่รับ", { positive: true });
      line.receivedKg = qty;
      line.lotNo = null;
      line.expiry = null;
      line.receivedAt = ctx.now;
      line.receivedBy = ctx.user?.name ?? null;
      if (order.lines.every(isReceived)) order.status = "received";
      audit(d, ctx, "ตรวจสอบรับเข้าตามใบสั่งซื้อ", `${order.id} ${materialCode} ${qty} ${line.uom ?? ""}`.trim());
      return materialCode;
    }
    const lotNo = receiveMaterial(d, { materialCode, qtyKg, expiry, supplier: String(supplier ?? "").trim() || order.id }, ctx);
    const lot = d.materialLots.find((row) => row.lotNo === lotNo);
    line.receivedKg = lot.qtyKg;
    line.lotNo = lotNo;
    line.expiry = lot.expiry;
    line.receivedAt = ctx.now;
    line.receivedBy = ctx.user?.name ?? null;
    if (order.lines.every(isReceived)) order.status = "received";
    audit(d, ctx, "ตรวจสอบรับเข้าตามใบสั่งซื้อ", `${order.id} ${materialCode} ${lot.qtyKg} kg → ${lotNo}`);
    return lotNo;
  }

  // ยกเลิกได้เฉพาะใบ ordered ที่ยังไม่มีบรรทัดไหนรับเข้า (ฝ่ายวางแผน) · ใบสั่งซื้อไม่มีการแก้ไขหลังสร้าง
  function cancelPurchaseOrder(d, { id }, ctx) {
    needRight(ctx, "cancelPurchase");
    const order = find(d.purchaseOrders ?? [], id, "ใบสั่งซื้อ");
    if (order.status !== "ordered") fail(`ใบสั่งซื้อ ${order.id} ${order.status === "received" ? "รับครบแล้ว" : "ถูกยกเลิกไปแล้ว"} ยกเลิกไม่ได้`);
    if (order.lines.some(isReceived)) fail(`ใบสั่งซื้อ ${order.id} มีรายการที่รับเข้าแล้ว ยกเลิกไม่ได้`);
    order.status = "cancelled";
    order.cancelledAt = ctx.now;
    audit(d, ctx, "ยกเลิกใบสั่งซื้อ", order.id);
    return order.id;
  }

  function setMaterialLotStatus(d, { lotNo, status }, ctx) {
    needRight(ctx, "holdMaterial");
    if (!["hold", "available"].includes(status)) fail("สถานะล็อตไม่ถูกต้อง");
    const lot = d.materialLots.find((row) => row.lotNo === lotNo) || fail("ไม่พบล็อต");
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
  function needOrderOpen(d, orderId, ctx) {
    const order = d.orders.find((row) => row.id === orderId);
    if (!ctx.remote || !order || ["released", "in_progress", "on_hold"].includes(order.status)) return;
    const why = { planned: "ยังไม่ได้ปล่อยผลิต", completed: "ปิดแล้ว", cancelled: "ถูกยกเลิกแล้ว" }[order.status] ?? "ไม่อยู่ในสถานะที่ผลิตได้";
    fail(`ใบสั่งผลิต ${order.id} ${why} บันทึกการผลิตไม่ได้`);
  }

  function takeFromTransfer(d, transferId, stage, qty, ctx) {
    const transfer = find(d.transfers, transferId, "ใบส่งมอบ");
    if (transfer.to !== stage) fail("ใบส่งมอบนี้ไม่ได้ส่งมาที่สถานีนี้");
    needOrderOpen(d, transfer.orderId, ctx);
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

  // โหมดฐานข้อมูล: คำสั่งของพนักงาน RB ที่ฐานข้อมูลตั้งเวลาครบบ่มเป็นเวลาของเซิร์ฟเวอร์เอง (ไม่เชื่อเวลาของเครื่อง) และบันทึกในประวัติการใช้งาน
  function endRest(d, { lotId }, ctx) {
    needRight(ctx, "station");
    const lot = find(d.lots, lotId, "ล็อต");
    if (ctx.remote && !(lot.readyAt > ctx.now)) fail("ล็อตนี้บ่มครบเวลาแล้ว");
    lot.readyAt = ctx.now;
    audit(d, ctx, ctx.remote ? "ข้ามเวลาบ่ม" : "ข้ามเวลาบ่ม (โหมดสาธิต)", lotId);
  }

  function recordExtrusion(d, p, ctx) {
    needRight(ctx, "station");
    const { SPECS, inSpec } = rules();
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
    const reasons = ["thickness", "width", "weightPerM"]
      .filter((key) => !inSpec(params[key], SPECS.extrusion[key]))
      .map((key) => `${SPECS.extrusion[key].label} ${params[key]} ${SPECS.extrusion[key].unit} นอกสเปก`);
    const order = d.orders.find((row) => row.id === transfer.orderId);
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

  function recordFinishing(d, p, ctx) {
    needRight(ctx, "station");
    const useQty = num(p.useQty, "ปริมาณที่รับเข้าตกแต่ง");
    const transfer = takeFromTransfer(d, p.transferId, "finishing", useQty, ctx);
    const passed = num(p.passedQty, "จำนวนผ่าน QC");
    const scrap = Number(p.scrapQty) || 0;
    const perBox = num(p.perBox, "จำนวนต่อกล่อง");
    if (perBox <= 0) fail("จำนวนต่อกล่องต้องมากกว่า 0");
    if (passed + scrap > useQty + 1e-9) fail("งานผ่าน + ของเสีย ต้องไม่เกินปริมาณที่รับเข้า");
    const order = find(d.orders, transfer.orderId, "ใบสั่งผลิต");
    const result = p.qcResult || "pass";
    const lot = newLot(d, "finishing", "FN", {
      orderId: transfer.orderId, uom: order.uom, shift: p.shift, grade: p.grade || "A",
      sources: [{ type: "transfer", id: transfer.id, lotId: transfer.lotId, qty: useQty }],
      params: { perBox }, goodQty: passed, scrapQty: scrap, scrapReason: p.scrapReason || "",
      qc: result, holdReasons: result === "pass" ? [] : ["ผลตรวจตกแต่งไม่ผ่าน/รอตัดสิน"],
    }, ctx);
    let left = passed;
    let i = 0;
    while (left > 1e-9) {
      const qty = Math.min(perBox, left);
      i += 1;
      d.fgBoxes.unshift({
        id: `${lot.id.replace("FN", "BOX")}-${String(i).padStart(3, "0")}`, lotId: lot.id, orderId: order.id,
        recipeId: order.recipeId, productCode: order.productCode, qty: +qty.toFixed(3), uom: order.uom, grade: lot.grade,
        status: result === "pass" ? "in_stock" : "hold", createdAt: ctx.now,
      });
      left -= qty;
    }
    lot.boxes = i;
    lot.countedToOrder = result === "pass";
    if (result === "pass") addProduced(d, order.id, passed, ctx);
    audit(d, ctx, "บันทึกการตกแต่ง/บรรจุ", `${lot.id} ${passed} ${order.uom} → ${i} กล่อง`);
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
    if (ctx.remote && ["planned", "released", "cancelled"].includes(order.status)) fail(`ใบสั่งผลิต ${order.id} ${order.status === "planned" ? "ยังไม่ได้ปล่อยผลิต" : order.status === "released" ? "ยังไม่ได้เริ่มงาน" : "ถูกยกเลิกแล้ว"} บันทึกยอดผลิตเข้าใบไม่ได้`);
    order.producedQty = +(order.producedQty + add).toFixed(3);
    const mayClose = !ctx.remote || Boolean(ctx.user?.planner || ctx.user?.rb);
    if (mayClose && order.producedQty >= order.targetQty && order.status === "in_progress") {
      order.status = "completed";
      audit(d, ctx, "ปิดใบสั่งผลิต (ครบจำนวน)", order.id);
    }
  }

  function shipBoxes(d, { ids }, ctx) {
    needRight(ctx, "shipBoxes");
    if (!Array.isArray(ids) || !ids.length) fail("กรุณาเลือกกล่องที่จะส่งมอบ");
    ids.forEach((id) => {
      const box = find(d.fgBoxes, id, "กล่อง");
      if (box.status !== "in_stock") fail(`กล่อง ${id} ไม่พร้อมส่ง`);
      box.status = "shipped";
      box.shippedAt = ctx.now;
      box.shippedBy = ctx.user?.name;
    });
    audit(d, ctx, "ส่งมอบสินค้า", `${ids.length} กล่อง`);
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
    const id = nextId(d, "QC", ctx.now, ctx, d.qcRecords, rowId);
    d.qcRecords.unshift({ id, lotId: lot.id, orderId: lot.orderId, stage: lot.stage, tests, result, note: p.note || "", inspector: ctx.user?.name, at: ctx.now });
    lot.qc = result;
    if (result === "pass") lot.holdReasons = [];
    d.fgBoxes.filter((box) => box.lotId === lot.id && box.status !== "shipped").forEach((box) => {
      box.status = result === "pass" ? "in_stock" : "hold";
    });
    if (lot.stage === "finishing" && result === "pass" && !lot.countedToOrder) {
      // ล็อตตกแต่งที่เคยถูกกักกันนับเข้าใบสั่งผลิตเมื่อผ่านเท่านั้น
      lot.countedToOrder = true;
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
    ORDER_FLOW, createOrder, setOrderStatus, saveMaterial, createRecipe, saveRecipe, approveRecipe, createRequisition, weighLine, issueRequisition, receiveMaterial, createPurchaseOrder, receivePurchaseLine, cancelPurchaseOrder, setMaterialLotStatus,
    recordMixing, endRest, recordExtrusion, recordCuring, recordFinishing, shipBoxes, transferableQty, createTransfer, receiveTransfer,
    addQcRecord, createNcr, updateNcr, closeNcr, saveMold, cleanMold,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_RUBBERFLOW_ACTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
