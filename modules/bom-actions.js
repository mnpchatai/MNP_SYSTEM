// BOM รายแผนก (โหมดทดสอบ) — กฎธุรกิจทั้งหมด: item master · BOM หลายชั้น (จุดสร้างจุดเดียว บันทึกแล้วใช้ได้ทันที เก็บเป็น revision) ·
// นำเข้าจากชีต · ใบสั่งผลิต (PI) ระเบิด/ปล่อยผลิต · งานรายแผนก · นับคงคลังตามใบ · สต็อกของซื้อ (นับ/เบิกจ่ายรายใบ) · ผูกสูตรยางกับ RubberFlow
// ทุก action รับ (draft, payload, ctx{now,user}) ทำบนร่างและ throw เมื่อกฎไม่ผ่าน (store บันทึกเฉพาะเมื่อผ่าน)
// รับสินค้าสำเร็จรูปเข้าคลัง / ส่งมอบลูกค้า / ปิดใบ = แผนก WH หรือผู้ดูแลระบบ (canHandleFg) · ใบปิดเองเมื่อรับครบและทุกงานผลิตเสร็จแล้ว · รับครบก่อนงานผลิตเสร็จ = WH กดปิดใบเมื่องานเสร็จครบ
// ย้อนการรับเข้า / ส่งมอบที่บันทึกผิด (reverseFg) = ผู้จัดการแผนกคลังสินค้า (WH) หรือผู้ดูแลระบบ (canReverseFg) พร้อมเหตุผล (20261128020000)
// งานที่จะไม่มีใครรายงานแล้ว ฝ่ายวางแผนปิดงานพร้อมเหตุผล (setJobStatus status done) · งานของใบที่ปิดแล้วไม่ค้างและไม่เลยกำหนด (helpers.isOpenJob)
// ส่วนที่ PK ผลิตเกินจำนวนสั่งรับเข้าคลังเป็นสต็อกสินค้าสำเร็จรูปได้แม้ใบปิดแล้ว · ใบร่างที่สั่งสินค้าเดียวกันใช้สต็อกนั้นลดงานผลิต (ฝ่ายวางแผนตั้งที่ขั้นตรวจของ หักจริงตอนปล่อยผลิต: ใบที่ปล่อยก่อนได้ก่อน) · ยกเลิก/เปิดใบกลับมาแก้ = คืนสต็อก
// สิทธิ์ (บทบาทสาธิต ไม่ใช่การควบคุมสิทธิ์ของระบบจริง): สร้าง/แก้ item และ BOM ทุกชั้น = ฝ่ายวางแผน ผู้จัดการ ผู้ดูแล · ไม่มีขั้นอนุมัติ (ตามที่ผู้ใช้ตัดสิน
// 29 ต.ค. 2026 ให้เหมือน Excel) · "แผนกเจ้าของ" ของชิ้นงานใช้แยกงานรายแผนกตอนปล่อยผลิตเท่านั้น — ดู docs/BOM_SYSTEM_PLAN.md §3
// โหลดหลัง modules/bom-rules.js เทสต์ด้วย node --test (scripts/tests/bom-actions.test.mjs)
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const rules = () => root.MNP_BOM_RULES;

  const fail = (message) => { throw new Error(message); };
  // ค่าที่ขาด (ว่าง / undefined / null) ไม่พิมพ์ลงในข้อความผิดพลาด: ใช้คำกลางแทน · คืนมีช่องว่างนำหน้าเมื่อมีค่า (ต่อท้ายชื่อสิ่งที่หาไม่พบ)
  const ref = (value, fallback = "ที่ระบุ") => (value === undefined || value === null || String(value).trim() === "" ? fallback : ` ${String(value).trim()}`);
  const num = (value, label, { min = 0, allowZero = false } = {}) => {
    const n = Number(value);
    if (!Number.isFinite(n)) fail(`${label}ต้องเป็นตัวเลข`);
    if (n < min || (!allowZero && n === 0)) fail(`${label}ต้องมากกว่า ${min}`);
    return n;
  };
  const text = (value, label, max = 120) => {
    const t = String(value ?? "").trim();
    if (!t) fail(`กรุณาระบุ${label}`);
    if (t.length > max) fail(`${label}ยาวเกิน ${max} ตัวอักษร`);
    return t;
  };
  function audit(d, ctx, action, detail) {
    d.audit.unshift({ at: ctx.now, user: ctx.user?.name ?? "ระบบ", action, detail });
    if (d.audit.length > 500) d.audit.length = 500;
  }
  function nextId(d, prefix, now) {
    const year = String(new Date(now).getFullYear() + 543).slice(2);
    const key = `${prefix}-${year}`;
    d.counters[key] = (d.counters[key] ?? 0) + 1;
    return `${key}-${String(d.counters[key]).padStart(4, "0")}`;
  }
  // รหัส BOM / routing ที่ลงข้อมูลหลักร่วมกัน: โหมดฐานข้อมูล (store ส่ง ctx.idSuffix) ต่อท้ายด้วยรหัสสุ่มสั้นๆ เพราะตัวนับอยู่ในเครื่อง
  // ผู้วางแผนสองคนที่เริ่มจากเวอร์ชันเดียวกันจึงไม่ได้เลขซ้ำกัน (ซ้ำ = ฐานข้อมูลตอบ BOM_STALE) · โหมดในเครื่องไม่มี ctx.idSuffix ใช้เลขนับล้วนเหมือนเดิม
  function masterId(d, prefix, ctx) {
    const id = nextId(d, prefix, ctx.now);
    return typeof ctx.idSuffix === "function" ? `${id}-${ctx.idSuffix()}` : id;
  }

  // ---------- สิทธิ์ (บทบาทสาธิต) ----------
  const isBoss = (user) => Boolean(user) && (user.role === "admin" || user.role === "manager");
  const canPlan = (user) => isBoss(user) || user?.role === "planner"; // สร้าง/แก้ item, BOM, ใบสั่งผลิต
  // สต็อกขั้นต่ำของของซื้อ: กลุ่มวางแผน หรือแผนก ST (ตรงกับ private.bom_save_stock ใน 20261120010000_st_sets_safety_stock.sql) · WH นับได้อย่างเดียว
  const canSetSafety = (user) => canPlan(user) || user?.role === "st";
  const canCount = (user) => canPlan(user) || user?.role === "st" || user?.role === "wh"; // นับคงคลังของใบร่าง: ฝ่ายวางแผน ผู้จัดการ ผู้ดูแล หรือพนักงานแผนก ST / WH
  // ของซื้อ: งานของซื้อ (ST / PURCHASED) เปลี่ยนผลงานได้ทางเดียวคือ "เบิกจ่ายของซื้อ" ของใบ (issueOrderParts) · เบิกจ่าย = กลุ่มวางแผนหรือแผนก ST · สต็อกขั้นต่ำแก้ได้เฉพาะกลุ่มวางแผน
  const isPartJob = (job) => job?.dept === "ST" && job?.kind === "PURCHASED";
  // งานที่ยังต้องทำ (กติกาเดียวของงานของฉัน ขั้น 4 ของหน้าใบ หน้างานของแผนก และภาพรวม): ยังไม่ done และใบยังไม่ปิดหรือถูกยกเลิก · งานทุกงานของใบที่ปิดแล้ว (completed)
  // หรือยกเลิกแล้ว (cancelled: ยกเลิกไม่ลบงานแล้ว งานคงยอดไว้) ไม่นับ เพราะแก้หรือรายงานไม่ได้อีก จึงไม่ค้างและไม่เลยกำหนด
  // (แถวของงานนั้นแสดง "ใบปิดแล้ว" / "ใบยกเลิกแล้ว" · บรรทัดของซื้อที่เบิกไปแล้วคืนของเหลือได้ที่หน้าใบ)
  const CLOSED_ORDER = Object.freeze(["completed", "cancelled"]);
  const isOpenJob = (d, job) => job.status !== "done" && !CLOSED_ORDER.includes(d.orders.find((order) => order.id === job.orderId)?.status);
  // งานที่ผูก WO ของ RubberFlow: ยอดดี / เสียมาจาก RubberFlow เท่านั้น (ล็อตตกแต่งที่ผ่าน QC) รายงานผลด้วยมือไม่ได้ (ตรงกับ bom_save_jobs ของ 20261128010000)
  const isLinkedJob = (job) => Boolean(job?.externalRef?.woId);
  const canIssueParts = (user) => canPlan(user) || user?.role === "st";
  const requireUser = (ctx) => ctx.user ?? fail("กรุณาเลือกบทบาทสาธิตก่อน");
  const requirePlanner = (ctx, what) => { const user = requireUser(ctx); if (!canPlan(user)) fail(`${what} ได้โดยฝ่ายวางแผนหรือผู้จัดการเท่านั้น`); return user; };

  // แปลงรหัสครั้งเดียวก่อนไล่หา (เดิมแปลงซ้ำทุกชิ้นที่ไล่ผ่าน) · งานที่ค้นเป็นพันครั้ง เช่น importFlat ใช้ดัชนี Map แทน
  const itemOf = (d, code) => {
    const key = rules().canonicalCode(code);
    return d.items.find((item) => item.code === key) ?? null;
  };
  const approvedBomOf = (d, code) => d.boms.find((bom) => bom.itemCode === code && bom.status === "approved") ?? null;
  const bomById = (d, id) => d.boms.find((bom) => bom.id === id) ?? fail("ไม่พบ BOM ฉบับแก้ไขนี้");
  const orderById = (d, id) => d.orders.find((order) => order.id === id) ?? fail("ไม่พบใบสั่งผลิต");
  const jobById = (d, id) => d.jobs.find((job) => job.id === id) ?? fail("ไม่พบงานของแผนก");
  // ชนิดที่ไม่มีส่วนประกอบ ต้องตรงกับ rules.LEAF_KINDS (เทสต์ตรวจ) · เส้นยางมีได้เฉพาะบรรทัดสูตรยาง (rules.childKindError)
  const NO_BOM_KINDS = Object.freeze(["PURCHASED", "CP"]);

  // ---------- Item master ----------
  // ชนิด/ชื่อ/หน่วย/น้ำหนัก และข้อมูลยาง (RB/SE) แผนกเจ้าของตามชนิดถ้าไม่ระบุ · create:true = เพิ่มใหม่เท่านั้น (รหัสซ้ำถูกปฏิเสธ)
  // options (เรียกภายในเท่านั้น store.run ส่งแค่ d, p, ctx): compoundLineFollows = บรรทัดสูตรยางของเส้นยางถูกบันทึกต่อในคำสั่งเดียวกัน
  function saveItem(d, p, ctx, options = {}) {
    const user = requirePlanner(ctx, "เพิ่ม/แก้ชิ้นงาน");
    const R = rules();
    const code = R.canonicalCode(text(p.code, "รหัสชิ้นงาน", 60));
    const kind = Object.hasOwn(R.KINDS, String(p.kind ?? "")) ? p.kind : fail("ชนิดชิ้นงานไม่ถูกต้อง");
    if (p.ownerDept !== undefined && p.ownerDept !== "" && !R.DEPTS.includes(p.ownerDept)) fail("แผนกเจ้าของไม่ถูกต้อง");
    const existing = itemOf(d, code);
    if (existing && p.create) fail(`มีรหัส ${code} อยู่แล้ว (${existing.name})`);
    const ownerDept = R.DEPTS.includes(p.ownerDept) ? p.ownerDept : existing?.ownerDept ?? R.ownerDeptOf(kind, p.pair);
    const uom = R.UOMS[p.uom] ? p.uom : fail("หน่วยนับไม่ถูกต้อง");
    const name = text(p.name, "ชื่อชิ้นงาน", 160);
    // ข้อมูลยาง: ช่องที่ส่งมาว่าง = ล้างค่า ช่องที่ไม่ส่ง (undefined) คงค่าเดิม
    const incoming = p.rubber && typeof p.rubber === "object" ? Object.fromEntries(Object.entries(p.rubber).filter(([, value]) => value !== undefined && value !== null)) : null;
    const rubber = incoming ? { ...(existing?.rubber ?? {}), ...incoming } : existing?.rubber ?? null;
    if (rubber && (kind === "RB" || kind === "SE")) {
      for (const key of ["cutLengthCm", "pcsPerRoll", "sePerGr", "kgPerRoll", "lengthMm", "holeMm", "odMm"]) {
        if (rubber[key] === "") delete rubber[key];
        else if (rubber[key] !== undefined) rubber[key] = num(rubber[key], key, { allowZero: true });
      }
      for (const key of ["compound", "type", "color", "product"]) if (rubber[key] !== undefined) rubber[key] = String(rubber[key]).trim().toUpperCase().slice(0, 20);
    }
    // เลิกใช้ (active:false) ทำได้แม้ข้อมูลเส้นยางยังไม่ครบ ชิ้นที่ข้อมูลผิดจึงเก็บออกจากตัวเลือกได้
    if (kind === "RB" && p.active !== false && p.active !== "false") {
      if (!rubber?.compound) fail(`เส้นยาง ${code} ต้องระบุรหัสสูตรยาง (คอมปาวด์)`);
      if (!d.compounds.some((entry) => entry.code === rubber.compound)) d.compounds.push({ code: rubber.compound, name: rubber.compound, recipeId: null, createdAt: ctx.now });
    }
    // สูตรยางเป็นชิ้นงานได้ด้วย (บรรทัดใต้เส้นยาง): รหัสชิ้นงาน = รหัสสูตรยาง จึงลงทะเบียนในรายการสูตรยางให้ผูก RubberFlow ได้
    if (kind === "CP") {
      // ช่องสูตรของเส้นยางและรายการสูตรยางเก็บรหัสได้ 20 ตัวอักษร รหัสสูตรยางที่ยาวกว่านั้นจะผูกกับเส้นยางไม่ได้
      if (code.length > 20) fail(`รหัสสูตรยาง ${code} ยาวเกิน 20 ตัวอักษร`);
      const entry = d.compounds.find((row) => row.code === code);
      if (!entry) d.compounds.push({ code, name: name.slice(0, 120), recipeId: null, createdAt: ctx.now });
      else if (entry.name === entry.code) entry.name = name.slice(0, 120); // ชื่อชั่วคราวที่ระบบตั้งจากรหัส
    }
    const item = existing ?? { code, legacyCodes: [], createdAt: ctx.now, active: true, group: p.group || "TOY" };
    if (existing && existing.kind !== kind && approvedBomOf(d, code)) fail(`เปลี่ยนชนิดของ ${code} ที่มี BOM แล้วไม่ได้`);
    // ชิ้นที่เป็นลูกใน BOM อยู่แล้ว: ชนิดใหม่ต้องอยู่ใต้พ่อเดิมได้ (เช่น สูตรยางอยู่ได้เฉพาะใต้เส้นยาง เส้นยางมีลูกได้เฉพาะสูตรยาง)
    if (existing && existing.kind !== kind) {
      for (const bom of d.boms.filter((entry) => entry.status === "approved" && entry.lines.some((line) => line.childCode === code))) {
        const parent = itemOf(d, bom.itemCode);
        const error = parent ? R.childKindError(parent.kind, kind) : "";
        if (error) fail(`เปลี่ยน ${code} เป็น${R.KINDS[kind].label}ไม่ได้ เพราะอยู่ใน BOM ของ ${parent.code} (${error})`);
      }
    }
    // เส้นยางที่มีบรรทัดสูตรยางแล้ว: ช่องสูตรต้องตรงกับบรรทัดนั้น (ต้นไม้ที่แก้ทั้งสองอย่างพร้อมกันตรวจที่ saveBom แทน)
    const compoundLine = kind === "RB" ? approvedBomOf(d, code)?.lines[0]?.childCode : null;
    if (compoundLine && !options.compoundLineFollows && rubber?.compound && R.canonicalCode(rubber.compound) !== compoundLine) fail(`เส้นยาง ${code} ใช้บรรทัดสูตรยาง ${compoundLine} ใน BOM เปลี่ยนสูตรที่ปุ่ม “แก้ข้อมูลเส้นยาง” ในหน้าของเส้นยาง (ช่องสูตรและบรรทัดสูตรยางเปลี่ยนพร้อมกัน)`);
    if (existing && existing.ownerDept !== ownerDept) d.boms.filter((bom) => bom.itemCode === code).forEach((bom) => { bom.ownerDept = ownerDept; bom.changeLog.push({ at: ctx.now, by: user.name, text: `ย้ายแผนกเจ้าของ ${existing.ownerDept} → ${ownerDept}` }); });
    Object.assign(item, { kind, name, ownerDept, uom, weightG: p.weightG === undefined || p.weightG === "" ? item.weightG ?? 0 : num(p.weightG, "น้ำหนัก (กรัม)", { allowZero: true }), rubber: kind === "RB" || kind === "SE" ? rubber : null, active: p.active === undefined ? item.active !== false : p.active !== false && p.active !== "false", updatedAt: ctx.now });
    if (!existing) d.items.push(item);
    audit(d, ctx, existing ? "แก้ชิ้นงาน" : "เพิ่มชิ้นงาน", `${code} ${name}`);
    return code;
  }

  // ---------- BOM ----------
  function normalizeLines(d, parent, rawLines) {
    const R = rules();
    if (!Array.isArray(rawLines) || !rawLines.length) fail(`BOM ของ ${parent.code} ต้องมีอย่างน้อย 1 บรรทัด`);
    const seen = new Set();
    return rawLines.map((raw, index) => {
      const childCode = R.canonicalCode(raw.childCode);
      const child = itemOf(d, childCode) ?? fail(`${parent.code} บรรทัด ${index + 1}: ไม่พบชิ้นงาน${ref(childCode)}`);
      if (child.code === parent.code) fail(`${parent.code}: ชิ้นงานเป็นลูกของตัวเองไม่ได้`);
      const kindError = R.childKindError(parent.kind, child.kind);
      if (kindError) fail(`${parent.code} → ${childCode}: ${kindError}`);
      if (seen.has(childCode)) fail(`${parent.code}: ${childCode} ซ้ำ รวมปริมาณเป็นบรรทัดเดียว`);
      seen.add(childCode);
      if (R.reachedFrom(childCode, new Set([parent.code]), (code) => approvedBomOf(d, code))) fail(`${parent.code}: ${childCode} มี ${parent.code} อยู่ข้างใต้ จะเป็นวงจร`);
      // ขั้นที่ (1–20) = ลำดับขั้นผลิตของพ่อที่ชิ้นนี้เข้า · ว่าง = ขั้นแรก · เก็บเฉพาะเมื่อระบุ (บรรทัดเดิมจึงเท่ากับบรรทัดใหม่ที่ไม่ระบุ)
      const step = raw.step === undefined || raw.step === null || String(raw.step).trim() === "" ? null : Number(raw.step);
      if (step !== null && !(Number.isInteger(step) && step >= 1 && step <= 20)) fail(`${parent.code} → ${childCode}: ขั้นที่ต้องเป็นจำนวนเต็ม 1–20`);
      return {
        ...(step ? { step } : {}),
        childCode, qty: num(raw.qty, `${parent.code} → ${childCode}: ปริมาณต่อหน่วยพ่อ`), uom: child.uom, consumerDept: parent.ownerDept, producerDept: child.ownerDept,
        scrapPct: raw.scrapPct === undefined || raw.scrapPct === "" ? 0 : num(raw.scrapPct, `${childCode}: % เผื่อเสีย`, { allowZero: true }),
        flags: Array.isArray(raw.flags) ? raw.flags.map(String).slice(0, 10) : [], note: String(raw.note ?? "").trim().slice(0, 200),
      };
    });
  }
  // ปริมาณที่ต่างกันน้อยกว่า 1e-6 ถือว่าเท่ากัน (ฟอร์มแสดงอัตราส่วนเช่น 1/31 ด้วยทศนิยม 6 ตำแหน่ง การบันทึกซ้ำจึงไม่สร้าง revision ลอย)
  const QTY_EPS = 1e-6;
  // ลำดับบรรทัดนับเป็นการเปลี่ยนแปลงด้วย (ผู้ใช้ลากเรียงส่วนประกอบได้ ลำดับใช้แสดงในต้นไม้และใบงาน)
  const sameLine = (line, other) => other.childCode === line.childCode && Math.abs(other.qty - line.qty) <= QTY_EPS && (other.scrapPct || 0) === (line.scrapPct || 0) && (other.note || "") === (line.note || "") && (Number(other.step) || null) === (Number(line.step) || null);
  // ลำดับตามผังงาน (rules.sortLinesByFlow) เป็นลำดับตั้งต้นเฉพาะตอนนำเข้า Excel (ชีตไม่มีลำดับที่ผู้ใช้จัด)
  // ที่เหลือเก็บลำดับตามที่ผู้ใช้ให้ (เลื่อนขึ้น/ลง ลากในตารางสร้าง BOM ข้ามแผนกได้ ทั้ง BOM ใหม่และที่มีแล้ว) · เปลี่ยนสี/คัดลอก FG คงลำดับของต้นทาง · บรรทัดที่เพิ่มใหม่ต่อท้าย
  const sameLines = (a, b) => a.length === b.length && a.every((line, index) => sameLine(line, b[index]));
  const sameLinesAnyOrder = (a, b) => a.length === b.length && a.every((line) => b.some((other) => sameLine(line, other)));
  function diffText(before, after) {
    const R = rules();
    const parts = [];
    for (const line of after) {
      const old = before.find((entry) => entry.childCode === line.childCode);
      if (!old) parts.push(`+${line.childCode} ${R.fmtQty(line.qty)}`);
      else if (Math.abs(old.qty - line.qty) > QTY_EPS) parts.push(`${line.childCode} ${R.fmtQty(old.qty)}→${R.fmtQty(line.qty)}`);
    }
    for (const line of before) if (!after.some((entry) => entry.childCode === line.childCode)) parts.push(`−${line.childCode}`);
    return parts.join(" · ");
  }

  // บันทึก BOM ของพ่อหนึ่งตัว: ใช้ได้ทันที (revision ใหม่ ตัวเก่า superseded) ถ้าบรรทัดเหมือนเดิมไม่สร้าง revision ซ้ำ
  function saveBom(d, p, ctx) {
    const user = requirePlanner(ctx, "บันทึก BOM");
    const R = rules();
    const parent = itemOf(d, p.itemCode) ?? fail("ไม่พบชิ้นงานพ่อ");
    if (parent.kind === "PURCHASED") fail(`${parent.code} เป็นของซื้อ ไม่มีส่วนประกอบ`);
    if (parent.kind === "CP") fail(`${parent.code} เป็นสูตรยาง ไม่มีส่วนประกอบในระบบนี้ (สูตร PHR อยู่ที่ RubberFlow)`);
    const previous = approvedBomOf(d, parent.code);
    const given = normalizeLines(d, parent, p.lines);
    const lines = given;
    // เส้นยาง: บรรทัดเดียวคือสูตรยางของมัน และต้องตรงกับช่องสูตรของเส้นยาง (รหัส RB ก็มีรหัสสูตรอยู่ในตัว)
    if (parent.kind === "RB") {
      if (lines.length > 1) fail(`เส้นยาง ${parent.code} ใช้สูตรยางได้สูตรเดียว`);
      const compound = parent.rubber?.compound ?? "";
      if (compound && R.canonicalCode(compound) !== lines[0].childCode) fail(`เส้นยาง ${parent.code} ระบุสูตร ${compound} แต่บรรทัดสูตรยางเป็น ${lines[0].childCode} แก้ให้ตรงกัน`);
    }
    const note = String(p.note ?? "").trim().slice(0, 300);
    // ชิ้นที่เลิกใช้: BOM เดิมที่ใช้อยู่ยังบันทึกซ้ำได้ แต่เพิ่มเป็นบรรทัดใหม่ไม่ได้
    const retired = lines.map((line) => line.childCode).filter((code) => itemOf(d, code)?.active === false && !previous?.lines.some((line) => line.childCode === code));
    if (retired.length) fail(`${parent.code}: ${retired.join(", ")} เลิกใช้แล้ว เพิ่มเป็นส่วนประกอบใหม่ไม่ได้ (ลบบรรทัดนั้นออก หรือเปิดใช้ชิ้นงานอีกครั้งที่ “แก้ข้อมูลชิ้นงาน”)`);
    // เทียบตามลำดับที่เก็บไว้: สลับลำดับอย่างเดียวก็นับเป็นการแก้ (ได้ revision ใหม่ "เรียงลำดับส่วนประกอบใหม่")
    if (previous && sameLines(previous.lines, lines)) return { id: previous.id, revision: previous.revision, changed: false };
    const changes = previous ? diffText(previous.lines, lines) || (sameLinesAnyOrder(previous.lines, lines) ? "เรียงลำดับส่วนประกอบใหม่" : "แก้รายละเอียดบรรทัด (% เผื่อเสีย/หมายเหตุ/ขั้นที่)") : `สร้างใหม่ ${lines.length} บรรทัด`;
    // แก้ในฉบับเดิม (ผู้ใช้ตัดสิน 2026-11-18 · U9 · ตรงกับ private.bom_save_boms ของ 20261129010000): คนที่อนุมัติฉบับล่าสุดแก้ซ้ำในวันเดียวกัน (เวลาไทย)
    // และยังไม่มีใบสั่งผลิตที่ไม่ใช่ร่างใช้ฉบับนั้น = แทนบรรทัดและหมายเหตุในฉบับเดิม ต่อท้ายประวัติหนึ่งรายการ (id และเลข revision เดิม) · อย่างอื่นออก revision ใหม่เหมือนเดิม
    if (previous && previous.approvedBy === user.name && R.bangkokDay(previous.approvedAt) === R.bangkokDay(ctx.now) && !R.bomRevisionLocked(d.orders, previous.id)) {
      previous.lines = lines;
      if (note) previous.note = note; // ช่องหมายเหตุของการแก้ว่าง = หมายเหตุเดิมของฉบับคงไว้
      previous.changeLog = [...(previous.changeLog ?? []), { at: ctx.now, by: user.name, text: `${changes}${note ? ` — ${note}` : ""}`.slice(0, 1000) }];
      audit(d, ctx, "บันทึก BOM", `${parent.code} Rev.${previous.revision} (แก้ในฉบับเดิม): ${changes}`);
      return { id: previous.id, revision: previous.revision, changed: true, inPlace: true };
    }
    if (previous) { previous.status = "superseded"; previous.supersededAt = ctx.now; }
    const bom = { id: masterId(d, "BOM", ctx), itemCode: parent.code, revision: (previous?.revision ?? 0) + 1, status: "approved", ownerDept: parent.ownerDept, lines, createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note, changeLog: [{ at: ctx.now, by: user.name, text: `${changes}${note ? ` — ${note}` : ""}`.slice(0, 1000) }] }; // ฐานข้อมูลรับข้อความ changeLog ไม่เกิน 1,000 ตัวอักษร
    d.boms.unshift(bom);
    audit(d, ctx, "บันทึก BOM", `${parent.code} Rev.${bom.revision}: ${changes}`);
    return { id: bom.id, revision: bom.revision, changed: true };
  }

  // จุดสร้างจุดเดียว: บันทึกต้นไม้ทั้งก้อนในครั้งเดียว
  // p = { code (FG หรือพ่อระดับบน), item?: {name, uom, kind?, weightG} สำหรับสร้างพ่อใหม่, note?,
  //       nodes: [{ code, qty, scrapPct?, note?, newItem?: {kind, name, uom, weightG?, rubber?}, patch?: {name?, weightG?, rubber?}, children?: [...] }] }
  // ลูกที่ยังไม่มีใน item master ถูกสร้างจาก newItem · patch แก้ชิ้นที่มีอยู่ (เช่น ข้อมูลการตัดของ RB) · บรรทัดที่มี children ได้ BOM ของตัวเอง
  function saveBomTree(d, p, ctx) {
    requirePlanner(ctx, "บันทึก BOM");
    const R = rules();
    const rootCode = R.canonicalCode(text(p.code, "รหัสสินค้า", 60));
    // เส้นยางเป็นพ่อ: รหัสสูตรของมันคือบรรทัดสูตรยางชั้นแรก (ใช้ทั้งตอนสร้างใหม่และตอนเปลี่ยนสูตรของเส้นยางที่มีอยู่)
    const auditBefore = d.audit.length;
    const rootCompound = (p.nodes ?? []).map((node) => ({ code: R.canonicalCode(node.code), kind: itemOf(d, node.code)?.kind ?? node.newItem?.kind })).find((node) => node.kind === "CP")?.code || "";
    if (!itemOf(d, rootCode)) {
      if (!p.item?.name) fail(`ยังไม่มีชิ้นงาน${ref(rootCode)} กรุณาระบุชื่อและหน่วยเพื่อสร้าง`);
      // ชนิดของพ่อที่เลือกในขั้นที่ 1 (ไม่ระบุ = สินค้า) · วัตถุดิบ/สูตรยางไม่มีส่วนประกอบ จึงสร้างผ่านต้นไม้ไม่ได้
      const rootKind = p.item.kind || "FG";
      if (!Object.hasOwn(R.KINDS, rootKind)) fail("ชนิดชิ้นงานไม่ถูกต้อง");
      if (NO_BOM_KINDS.includes(rootKind)) fail(`${R.KINDS[rootKind].label}ไม่มีส่วนประกอบ บันทึกเป็นชิ้นงานแทน`);
      saveItem(d, { code: rootCode, kind: rootKind, name: p.item.name, uom: p.item.uom || "set", weightG: p.item.weightG, rubber: rootKind === "RB" ? { compound: rootCompound } : undefined, create: true }, ctx);
    } else {
      const current = itemOf(d, rootCode);
      const changed = p.item && ((p.item.name && p.item.name.trim() !== current.name) || (p.item.uom && p.item.uom !== current.uom) || (p.item.weightG !== undefined && p.item.weightG !== "" && Number(p.item.weightG) !== Number(current.weightG || 0)));
      const newCompound = current.kind === "RB" && rootCompound && rootCompound !== current.rubber?.compound ? rootCompound : "";
      // เปลี่ยนสูตรของเส้นยางที่เป็นพ่อ: ช่องสูตรตามบรรทัดสูตรยางใหม่ แล้ว saveBom ข้างล่างบันทึกบรรทัดนั้นในคำสั่งเดียวกัน
      // ข้อมูลการตัดของเส้นยางที่เป็นพ่อ (p.item.rubber จากหน้าต่าง "ข้อมูลเส้นยาง" ของหน้าสินค้า): ส่งเฉพาะช่องที่ต่างจากที่เก็บ ช่องว่าง = ล้างค่า · ช่องสูตรไม่รับจากตรงนี้ มาจากบรรทัดสูตรยางเท่านั้น
      const cut = current.kind === "RB" && p.item?.rubber && typeof p.item.rubber === "object"
        ? Object.fromEntries(Object.entries(p.item.rubber).filter(([key, value]) => key !== "compound" && value !== undefined && value !== null && String(value) !== String(current.rubber?.[key] ?? "")))
        : {};
      const rubber = { ...cut, ...(newCompound ? { compound: newCompound } : {}) };
      if (changed || Object.keys(rubber).length) saveItem(d, { code: rootCode, kind: current.kind, name: p.item?.name || current.name, uom: p.item?.uom || current.uom, weightG: p.item?.weightG, rubber: Object.keys(rubber).length ? rubber : undefined }, ctx, { compoundLineFollows: Boolean(newCompound) });
    }
    const saved = [];
    const created = [];
    const patched = [];
    const seenPath = new Set();
    const walk = (parentCode, nodes, path) => {
      if (!Array.isArray(nodes) || !nodes.length) fail(`${parentCode}: ต้องมีส่วนประกอบอย่างน้อย 1 บรรทัด`);
      const lines = [];
      for (const node of nodes) {
        const code = R.canonicalCode(node.code);
        if (!code) fail(`${parentCode}: มีบรรทัดที่ไม่มีรหัสชิ้นงาน`);
        if (path.includes(code)) fail(`${code} ซ้อนอยู่ใต้ตัวเอง`);
        let child = itemOf(d, code);
        // เส้นยางที่มีบรรทัดสูตรยางข้างใต้แต่ช่องสูตรว่าง: ใช้รหัสสูตรจากบรรทัดนั้น (ไม่ต้องพิมพ์ซ้ำสองที่)
        const compoundLine = (node.children ?? []).map((entry) => ({ code: R.canonicalCode(entry.code), kind: itemOf(d, entry.code)?.kind ?? entry.newItem?.kind })).find((entry) => entry.kind === "CP")?.code ?? "";
        const withCompound = (rubber) => (compoundLine && !String(rubber?.compound ?? "").trim() ? { ...(rubber ?? {}), compound: compoundLine } : rubber);
        if (!child) {
          const spec = node.newItem ?? fail(`ไม่พบชิ้นงาน${ref(code)} — ระบุชนิด ชื่อ และหน่วยเพื่อสร้าง`);
          saveItem(d, { code, kind: spec.kind, name: spec.name, uom: spec.uom, weightG: spec.weightG, ownerDept: spec.ownerDept, rubber: spec.kind === "RB" ? withCompound(spec.rubber) : spec.rubber, create: true }, ctx);
          child = itemOf(d, code);
          created.push(code);
        } else if (node.patch && Object.keys(node.patch).length) {
          saveItem(d, { code, kind: child.kind, name: node.patch.name || child.name, uom: node.patch.uom || child.uom, weightG: node.patch.weightG, rubber: child.kind === "RB" && node.patch.rubber ? withCompound(node.patch.rubber) : node.patch.rubber }, ctx, { compoundLineFollows: Boolean(node.children?.length) });
          patched.push(code);
        }
        if (Array.isArray(node.children) && node.children.length) {
          if (NO_BOM_KINDS.includes(child.kind)) fail(`${code} (${R.KINDS[child.kind].label}) มีส่วนประกอบไม่ได้`);
          // ชิ้นเดียวกันอยู่หลายที่ในต้นไม้: BOM ของมันบันทึกจากที่แรก ที่อื่นต้องมีลูกชุดเดียวกัน
          if (!seenPath.has(code)) { walk(code, node.children, [...path, code]); seenPath.add(code); } else {
            const current = approvedBomOf(d, code);
            const incoming = node.children.map((entry) => ({ childCode: R.canonicalCode(entry.code), qty: Number(entry.qty), scrapPct: Number(entry.scrapPct) || 0, note: String(entry.note ?? "").trim(), step: Number(entry.step) || null }));
            if (!current || !sameLinesAnyOrder(current.lines, incoming)) fail(`${code} ปรากฏหลายที่ในต้นไม้ด้วยส่วนประกอบต่างกัน แก้ให้เหมือนกันหรือใช้รหัสคนละตัว`);
          }
        }
        lines.push({ childCode: code, qty: node.qty, scrapPct: node.scrapPct, note: node.note, step: node.step, flags: node.flags });
      }
      const result = saveBom(d, { itemCode: parentCode, lines, note: p.note }, ctx);
      if (result.changed) saved.push(`${parentCode} Rev.${result.revision}`);
    };
    walk(rootCode, p.nodes, [rootCode]);
    const rootChanged = d.audit.length > auditBefore && d.audit.slice(0, d.audit.length - auditBefore).some((entry) => entry.action === "แก้ชิ้นงาน" && entry.detail.startsWith(`${rootCode} `));
    const parts = [saved.length ? `BOM: ${saved.join(", ")}` : "", created.length ? `สร้างชิ้นใหม่: ${created.join(", ")}` : "", patched.length ? `แก้ข้อมูลชิ้น: ${patched.join(", ")}` : "", rootChanged && !created.includes(rootCode) ? `แก้ข้อมูลสินค้า ${rootCode}` : ""].filter(Boolean);
    const changed = parts.length > 0;
    if (changed) audit(d, ctx, "บันทึกต้นไม้ BOM", `${rootCode}: ${parts.join(" · ")}`);
    return { code: rootCode, saved, created, patched, changed, summary: changed ? `บันทึกแล้ว — ${parts.join(" · ")}` : "ไม่มีการเปลี่ยนแปลง" };
  }

  // ---------- โครงสร้างสินค้า: ขั้นตอนผลิต (routing) และราคาต้นทุน (จำลอง) ----------
  // routing ต่อชิ้นงานเก็บเป็น revision แบบเดียวกับ BOM: บันทึกแล้วใช้ทันที ตัวเก่า superseded (ไม่แก้ทับของที่อาจถูกใช้ไปแล้ว)
  const routingOf = (d, code) => (d.routings ?? []).find((routing) => routing.itemCode === code && routing.status === "approved") ?? null;
  // ขั้นตอนมาตรฐานที่เลือกได้ = ที่เก็บในข้อมูล + ขั้นตอนเริ่มต้นใน bom-rules ที่ข้อมูลยังไม่มี (เช่น GR รีด/ปั๊ม/เปเปอร์/เจียร์(หยาบ), PK ใส่กระเป๋า ที่เพิ่มทีหลัง)
  // ไม่เพิ่มลงข้อมูลที่เก็บและไม่เปลี่ยนรุ่น state เพื่อให้แท็บที่ยังเปิดโค้ดรุ่นก่อนอ่านข้อมูลเดิมได้ (รุ่นที่ไม่รู้จักจะถูกแทนด้วยชุดสาธิต)
  const processesOf = (d) => {
    const stored = d.processes ?? [];
    const known = new Set(stored.map((process) => process.code));
    return [...stored, ...rules().DEFAULT_PROCESSES.filter((entry) => !known.has(entry.code)).map((entry) => ({ ...entry }))];
  };
  const processOf = (d, code) => processesOf(d).find((process) => process.code === code) ?? null;
  // วัตถุดิบของขั้นเทียบเป็นเซต: ฟอร์มส่งตามลำดับบรรทัด BOM ปัจจุบัน ลำดับต่างกันไม่ใช่การแก้ขั้นตอน
  const sameInputs = (a = [], b = []) => a.length === b.length && [...a].sort().every((code, index) => code === [...b].sort()[index]);
  // JSON ที่ไม่ขึ้นกับลำดับกุญแจ (ฐานข้อมูลเก็บ jsonb ซึ่งเรียงกุญแจใหม่) ใช้เทียบว่าข้อมูลสองก้อนเท่ากัน
  const stableJson = (value) => JSON.stringify(value, (_, node) => (node && typeof node === "object" && !Array.isArray(node) ? Object.fromEntries(Object.entries(node).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : node));
  const sameSteps = (a, b) => a.length === b.length && a.every((step, index) => step.processCode === b[index].processCode && Math.abs(step.minutesPerPc - b[index].minutesPerPc) <= QTY_EPS && (step.note || "") === (b[index].note || "") && sameInputs(step.inputs, b[index].inputs));
  // step.inputs = ลูกใน BOM ปัจจุบันที่เข้าที่ขั้นนี้ (ลูกหนึ่งตัวเข้าได้ขั้นเดียว) ลูกที่ไม่ระบุแสดงที่ขั้นแรก · เวลา 0 = ยังไม่ระบุเวลา
  function saveRouting(d, p, ctx) {
    const user = requirePlanner(ctx, "บันทึกขั้นตอนผลิต");
    const item = itemOf(d, p.itemCode) ?? fail("ไม่พบชิ้นงาน");
    if (item.kind === "PURCHASED") fail(`${item.code} เป็นของซื้อ ไม่มีขั้นตอนผลิต`);
    if (item.kind === "CP") fail(`${item.code} เป็นสูตรยาง ขั้นตอนผสมอยู่ในขั้นตอนของเส้นยาง (RB-01 ถึง RB-09) และสูตรอยู่ที่ RubberFlow`);
    const raw = Array.isArray(p.steps) ? p.steps : [];
    if (raw.length > 20) fail("ขั้นตอนผลิตได้ไม่เกิน 20 ขั้น");
    const children = new Set((approvedBomOf(d, item.code)?.lines ?? []).map((line) => line.childCode));
    const seen = new Set();
    const placed = new Set();
    const steps = raw.map((step, index) => {
      const process = processOf(d, String(step.processCode ?? "").trim()) ?? fail(`ขั้นที่ ${index + 1}: ไม่พบขั้นตอน ${step.processCode || "(ว่าง)"}`);
      if (seen.has(process.code)) fail(`${item.code}: ขั้นตอน ${process.code} ซ้ำ (ใส่เวลารวมเป็นขั้นเดียว)`);
      seen.add(process.code);
      const inputs = (Array.isArray(step.inputs) ? step.inputs : []).map((code) => rules().canonicalCode(code)).filter(Boolean);
      for (const code of inputs) {
        if (!children.has(code)) fail(`${process.code}: ${code} ไม่ได้อยู่ใน BOM ของ ${item.code}`);
        if (placed.has(code)) fail(`${code} ถูกกำหนดให้เข้ามากกว่าหนึ่งขั้น`);
        placed.add(code);
      }
      return { processCode: process.code, minutesPerPc: num(step.minutesPerPc, `ขั้นที่ ${index + 1} (${process.name}): เวลา นาที/ชิ้น`, { allowZero: true }), note: String(step.note ?? "").trim().slice(0, 120), inputs };
    });
    const previous = routingOf(d, item.code);
    if (!previous && !steps.length) fail("ใส่ขั้นตอนผลิตอย่างน้อย 1 ขั้น");
    if (previous && sameSteps(previous.steps, steps)) return { id: previous.id, revision: previous.revision, changed: false, summary: "ไม่มีการเปลี่ยนแปลง" };
    if (previous) { previous.status = "superseded"; previous.supersededAt = ctx.now; }
    const routing = { id: masterId(d, "RT", ctx), itemCode: item.code, revision: (previous?.revision ?? 0) + 1, status: "approved", steps, createdBy: user.name, createdAt: ctx.now };
    d.routings.unshift(routing);
    const text = steps.length ? steps.map((step) => `${step.processCode} ${rules().fmtNum(step.minutesPerPc)}`).join(" → ") : "ไม่มีขั้นตอน";
    audit(d, ctx, "บันทึกขั้นตอนผลิต", `${item.code} Rev.${routing.revision}: ${text}`);
    return { id: routing.id, revision: routing.revision, changed: true, summary: `${item.code} Rev.${routing.revision}` };
  }
  // ขั้นตอนผลิตมาตรฐาน (process master): เพิ่มหรือแก้ชื่อ/แผนก รหัสเดิมแก้ชื่อได้ ไม่ลบเพราะ routing เก่าอ้างอยู่
  function saveProcess(d, p, ctx) {
    requirePlanner(ctx, "เพิ่ม/แก้ขั้นตอนผลิต");
    const code = text(p.code, "รหัสขั้นตอน", 60);
    const dept = rules().DEPTS.includes(p.dept) ? p.dept : fail("แผนกของขั้นตอนไม่ถูกต้อง");
    const name = text(p.name, "ชื่อขั้นตอน", 80);
    const existing = (d.processes ?? []).find((process) => process.code === code);
    if (existing) Object.assign(existing, { name, dept });
    else d.processes.push({ code, name, dept });
    audit(d, ctx, existing ? "แก้ขั้นตอนผลิต" : "เพิ่มขั้นตอนผลิต", `${code} ${name} (${dept})`);
    return { summary: code };
  }
  // ราคาต้นทุนตั้งเองได้เฉพาะชิ้นที่ไม่มี BOM (ของซื้อ เส้นยาง ชิ้นทำเองที่ยังไม่ลง BOM) · ค่าว่าง = ล้างราคา
  function setItemCost(d, { code, unitCost }, ctx) {
    requirePlanner(ctx, "ตั้งราคาต้นทุน");
    const item = itemOf(d, code) ?? fail("ไม่พบชิ้นงาน");
    if (approvedBomOf(d, item.code)) fail(`${item.code} มี BOM แล้ว ต้นทุนคำนวณจากส่วนประกอบและขั้นตอนผลิต`);
    if (unitCost === "" || unitCost === null || unitCost === undefined) delete item.unitCost;
    else item.unitCost = num(unitCost, "ราคาต้นทุนต่อหน่วย", { allowZero: true });
    audit(d, ctx, "ตั้งราคาต้นทุน", `${item.code} = ${item.unitCost === undefined ? "ไม่ระบุ" : `${rules().fmtNum(item.unitCost)} บาท/${rules().uomLabel(item.uom)}`}`);
    return { summary: item.code };
  }
  // รูปชิ้นงาน (จำลอง): รูปย่อที่เบราว์เซอร์ย่อแล้วเป็น data URL เก็บใน state ของเบราว์เซอร์ · ระบบจริงใช้ Supabase Storage แบบ private
  // ค่าว่าง = ลบรูป · รับเฉพาะ PNG/JPEG/WebP base64 ไม่เกิน 80,000 ตัวอักษร
  const IMAGE_MAX = 80000;
  const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
  function setItemImage(d, { code, image }, ctx) {
    requirePlanner(ctx, "เปลี่ยนรูปชิ้นงาน");
    const item = itemOf(d, code) ?? fail("ไม่พบชิ้นงาน");
    const value = String(image ?? "").trim();
    if (!value) delete item.image;
    else {
      if (!IMAGE_RE.test(value)) fail("รูปต้องเป็นไฟล์ PNG, JPEG หรือ WebP");
      if (value.length > IMAGE_MAX) fail("รูปใหญ่เกินไป ลองรูปที่เล็กลง");
      item.image = value;
    }
    audit(d, ctx, value ? "เปลี่ยนรูปชิ้นงาน" : "ลบรูปชิ้นงาน", item.code);
    return { summary: item.code };
  }

  // ---------- สูตรยาง ↔ RubberFlow ----------
  function linkCompound(d, p, ctx) {
    const user = requireUser(ctx);
    if (!(canPlan(user) || user.role === "rb")) fail("ผูกสูตรยางได้โดยแผนก RB ฝ่ายวางแผน หรือผู้จัดการ");
    const code = text(p.code, "รหัสสูตรยาง", 20).toUpperCase();
    let compound = d.compounds.find((entry) => entry.code === code);
    if (!compound) { compound = { code, name: code, recipeId: null, createdAt: ctx.now }; d.compounds.push(compound); }
    if (p.name !== undefined) compound.name = String(p.name).trim().slice(0, 120) || code;
    compound.recipeId = String(p.recipeId ?? "").trim() || null;
    compound.recipeName = String(p.recipeName ?? "").trim().slice(0, 120) || null;
    audit(d, ctx, "ผูกสูตรยาง", `${code} → ${compound.recipeId ?? "ไม่ผูก"}`);
    return code;
  }

  // ---------- นำเข้าจากชีต (ผลของ rules.buildFromFlat ที่แปลง Map เป็นอาร์เรย์แล้ว) ----------
  // กลุ่มสินค้า: p.group (ที่เลือกตอนกดนำเข้า) ชนะกลุ่มที่ติดมากับชิ้นตอนตรวจสอบ · ใช้กับชิ้นใหม่เท่านั้น ชิ้นที่มีอยู่แล้วไม่ถูกแตะ
  function importFlat(d, p, ctx) {
    const user = requirePlanner(ctx, "นำเข้า BOM");
    const R = rules();
    const items = Array.isArray(p.items) ? p.items : fail("ไม่มีรายการชิ้นงานให้นำเข้า");
    const boms = Array.isArray(p.boms) ? p.boms : [];
    if (!items.length) fail("ไม่มีรายการชิ้นงานให้นำเข้า");
    const stats = { itemsAdded: 0, itemsMerged: 0, bomsAdded: 0, bomsSkipped: 0, linesSkipped: 0, cycleLinesSkipped: 0 };
    // ดัชนีครั้งเดียว: ชีต DATA ทั้งไฟล์มีหลายพันชิ้นและหลายหมื่นบรรทัด ถ้าไล่หาใน d.items ทุกบรรทัด (itemOf) หน้าค้างหลายนาที
    // ผลเท่ากับ itemOf/approvedBomOf: ชิ้นแรกของรหัสนั้น · BOM อนุมัติของพ่อ · ของที่เพิ่มในคำสั่งนี้เข้าดัชนีทันที
    const byCode = new Map();
    for (const item of d.items) if (!byCode.has(item.code)) byCode.set(item.code, item);
    const lookup = (code) => byCode.get(R.canonicalCode(code)) ?? null;
    const approvedParents = new Set(d.boms.filter((bom) => bom.status === "approved").map((bom) => bom.itemCode));
    const compoundCodes = new Set(d.compounds.map((entry) => entry.code));
    for (const raw of items) {
      const code = R.canonicalCode(raw.code);
      if (!code || !R.KINDS[raw.kind]) continue;
      const existing = byCode.get(code) ?? null;
      if (existing) {
        for (const legacy of raw.legacyCodes ?? []) if (!existing.legacyCodes.includes(legacy)) existing.legacyCodes.push(legacy);
        if (!existing.weightG && raw.weightG) existing.weightG = raw.weightG;
        if (!existing.rubber && raw.rubber) existing.rubber = raw.rubber;
        stats.itemsMerged += 1;
      } else {
        const added = { code, kind: raw.kind, name: String(raw.name ?? code).slice(0, 160), ownerDept: R.DEPTS.includes(raw.ownerDept) ? raw.ownerDept : R.ownerDeptOf(raw.kind), uom: R.UOMS[raw.uom] ? raw.uom : "other", weightG: Number(raw.weightG) || 0, group: p.group || raw.group || "TOY", legacyCodes: [...(raw.legacyCodes ?? [])], rubber: raw.rubber ?? null, active: true, createdAt: ctx.now, importedFrom: p.source || "Excel" };
        d.items.push(added);
        byCode.set(code, added);
        stats.itemsAdded += 1;
        if (raw.rubber?.compound && !compoundCodes.has(raw.rubber.compound)) {
          d.compounds.push({ code: raw.rubber.compound, name: raw.rubber.compound, recipeId: null, createdAt: ctx.now });
          compoundCodes.add(raw.rubber.compound);
        }
      }
    }
    // ลูกของ BOM ที่อนุมัติแล้ว (ของเดิม + ที่เพิ่มในคำสั่งนี้) ใช้ตรวจวงจร: บรรทัดที่ลูกคือพ่อเอง หรือเดินลงจากลูกแล้วเจอพ่อ = วนกลับมาหาตัวเอง
    // ฐานข้อมูลปฏิเสธทั้งส่วนที่ส่งด้วย BOM_CYCLE (ไฟล์จริงมี เช่น PT-00224 ใช้ PT-00224 เป็นส่วนประกอบ) จึงข้ามบรรทัดนั้นแล้วบอกผู้ใช้
    // เร็วพอสำหรับชีตทั้งไฟล์ไม่ว่าเรียงลำดับไหน: พ่อที่ยังไม่เคยเป็นลูกของ BOM ใดวนกลับมาหาตัวเองไม่ได้ (ไม่ต้องเดินเลย ชีตที่เรียงลูกก่อนพ่อเป็นแบบนี้ทั้งหมด)
    // ส่วนพ่อที่เป็นลูกอยู่แล้ว ทุกบรรทัดของพ่อเดียวกันใช้ชุด seen ร่วมกัน (โหนดที่เดินแล้วไม่เจอพ่อ บรรทัดถัดไปก็ไม่เจอ) จึงเดินแต่ละโหนดครั้งเดียวต่อ BOM
    const childrenOf = new Map();
    const usedAsChild = new Set();
    const addEdges = (parentCode, children) => {
      childrenOf.set(parentCode, children);
      for (const child of children) usedAsChild.add(child);
    };
    for (const bom of d.boms) if (bom.status === "approved") addEdges(bom.itemCode, bom.lines.map((line) => line.childCode));
    const loopCheck = (target) => {
      if (!usedAsChild.has(target)) return (from) => from === target;
      const seen = new Set();
      return (from) => {
        const stack = [from];
        while (stack.length) {
          const code = stack.pop();
          // เจอพ่อ = หยุดกลางทาง โหนดใน seen บางตัวยังเดินลูกไม่ครบ ล้างทิ้งก่อน ไม่งั้นบรรทัดถัดไปของพ่อเดียวกันอาจข้ามโหนดนั้นแล้วตอบว่าไม่วนผิด ๆ
          if (code === target) { seen.clear(); return true; }
          if (seen.has(code)) continue;
          seen.add(code);
          for (const child of childrenOf.get(code) ?? []) stack.push(child);
        }
        return false;
      };
    };
    for (const entry of boms) {
      const parent = lookup(entry.parentCode);
      if (!parent || !Array.isArray(entry.lines) || !entry.lines.length) continue;
      if (approvedParents.has(parent.code)) { stats.bomsSkipped += 1; continue; }
      const reaches = loopCheck(parent.code);
      const lines = entry.lines.map((line) => ({ line, child: lookup(line.childCode) })).filter(({ line, child }) => {
        if (!child || !(Number(line.qty) > 0)) return false;
        // ชนิดพ่อ/ลูกที่ฐานข้อมูลไม่รับ (ของซื้อมีส่วนประกอบ เส้นยางมีลูกที่ไม่ใช่สูตรยาง): ข้ามบรรทัดนั้น ไม่ให้บรรทัดเดียวทำให้ทั้งชุดถูกปฏิเสธ (BOM_INVALID_PARENT_KIND / _CHILD_KIND)
        if (R.childKindError(parent.kind, child.kind)) { stats.linesSkipped += 1; return false; }
        if (reaches(child.code)) { stats.cycleLinesSkipped += 1; return false; }
        return true;
      }).map(({ line, child }) => ({ childCode: R.canonicalCode(line.childCode), qty: Number(line.qty), uom: child.uom, consumerDept: parent.ownerDept, producerDept: child.ownerDept, scrapPct: 0, flags: line.flags ?? [], note: "" }));
      if (!lines.length) continue;
      addEdges(parent.code, lines.map((line) => line.childCode));
      d.boms.push({ id: masterId(d, "BOM", ctx), itemCode: parent.code, revision: 1, status: "approved", ownerDept: parent.ownerDept, lines: R.sortLinesByFlow(lines, lookup), createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: `นำเข้าจาก ${p.source || "Excel"}`, changeLog: [{ at: ctx.now, by: user.name, text: `นำเข้าจาก ${p.source || "Excel"}` }] });
      approvedParents.add(parent.code);
      stats.bomsAdded += 1;
    }
    const summary = `ชิ้นงานใหม่ ${stats.itemsAdded} (มีอยู่แล้ว ${stats.itemsMerged}) · BOM ใหม่ ${stats.bomsAdded} ข้าม ${stats.bomsSkipped}${stats.linesSkipped ? ` · ข้าม ${stats.linesSkipped} บรรทัดที่ชนิดพ่อ/ลูกไม่เข้ากัน` : ""}${stats.cycleLinesSkipped ? ` · ข้าม ${stats.cycleLinesSkipped} บรรทัดที่วนกลับมาใช้ตัวเองเป็นส่วนประกอบ` : ""}`;
    audit(d, ctx, "นำเข้า BOM จากชีต", `${p.source || "Excel"}: ${summary}`);
    return { ...stats, summary };
  }

  // ---------- ใบสั่งผลิต (PI) ----------
  function createOrder(d, p, ctx) {
    const user = requirePlanner(ctx, "เปิดใบสั่งผลิต");
    const R = rules();
    const orderedAt = p.orderedAt === null || p.orderedAt === "" ? NaN : Number(p.orderedAt);
    const whDue = p.whDue === null || p.whDue === "" ? NaN : Number(p.whDue);
    if (!Number.isFinite(orderedAt) || !Number.isFinite(whDue) || orderedAt <= 0 || whDue <= 0) fail("กรุณาระบุวันที่สั่งผลิตและวันส่งมอบคลัง");
    if (whDue < orderedAt) fail("วันส่งมอบคลังต้องไม่ก่อนวันที่สั่งผลิต");
    // เลข PI: ว่าง = ออกให้อัตโนมัติ YYMMDD-YYnnn (ลำดับต่อปีจากวันที่สั่งผลิต ข้ามเลขที่มีอยู่แล้ว เช่น ใบที่พิมพ์เลขเอง)
    let id = String(p.pi ?? "").trim().toUpperCase();
    if (!id && ctx.remote) {
      // โหมดฐานข้อมูล: ลำดับถัดจากเลข -YYnnn สูงสุดของปีนั้นในใบที่หน้าเห็น (ไม่ใช้ตัวนับในเครื่อง) · ผู้วางแผนสองคนที่เปิดใบพร้อมกันได้เลขเดียวกัน ฐานข้อมูลปฏิเสธใบที่สองด้วย BOM_STALE แล้วกดบันทึกใหม่จะได้เลขถัดไป
      const year = R.piYear(orderedAt);
      let seq = d.orders.reduce((max, order) => { const match = /-(\d{2})(\d{3,})$/.exec(String(order.id)); return match && match[1] === year ? Math.max(max, Number(match[2])) : max; }, 0);
      do { seq += 1; id = R.piNumber(orderedAt, seq); } while (d.orders.some((order) => order.id === id));
    } else if (!id) {
      const key = `PI-${R.piYear(orderedAt)}`;
      do { d.counters[key] = (d.counters[key] ?? 0) + 1; id = R.piNumber(orderedAt, d.counters[key]); } while (d.orders.some((order) => order.id === id));
    } else {
      id = text(id, "เลขที่ PI", 40).toUpperCase();
      if (d.orders.some((order) => order.id === id)) fail(`มีใบสั่งผลิต ${id} อยู่แล้ว`);
    }
    // กำหนดเสร็จรายแผนก: ที่กรอกมาใช้ตามนั้น · autoDue = เติมช่องว่างด้วยค่าเริ่มต้นจาก lead time (ถอยจากวันส่งมอบคลัง ไม่ก่อนวันสั่งผลิต)
    const due = {};
    const defaults = p.autoDue ? R.defaultDueDates(whDue) : {};
    for (const dept of R.DUE_DEPTS) {
      const value = p.due?.[dept];
      if (value === undefined || value === "" || value === null) {
        if (defaults[dept] !== undefined) due[dept] = Math.max(defaults[dept], new Date(orderedAt).setHours(0, 0, 0, 0));
        continue;
      }
      const ms = Number(value);
      if (!Number.isFinite(ms)) fail(`กำหนดเสร็จ ${dept} ไม่ถูกต้อง`);
      if (ms > whDue) fail(`กำหนดเสร็จ ${dept} ต้องไม่หลังวันส่งมอบคลัง`);
      due[dept] = ms;
    }
    const country = text(p.country, "ประเทศ", 60);
    // ประเภทออร์เดอร์: ที่เลือกมาใช้ตามนั้น (SA/EX) ไม่ส่งมา = เดาจากประเทศเหมือนเดิม
    const typeRaw = String(p.orderType ?? "").trim().toUpperCase();
    const orderType = typeRaw === "" ? R.orderTypeOf(country) : ["SA", "EX"].includes(typeRaw) ? typeRaw : fail("ประเภทออร์เดอร์ไม่ถูกต้อง (SA หรือ EX)");
    // ลูกค้า: ชื่อที่ตรงกับลูกค้าที่มีอยู่ (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) ใช้ชื่อตามรายการลูกค้า · ชื่อใหม่ถูกเพิ่มเข้ารายการลูกค้าพร้อมกับใบ
    const typedCustomer = text(customerName(p.customer), "ชื่อลูกค้า", 120);
    d.customers ??= [];
    const knownCustomer = d.customers.find((entry) => customerKey(entry.name) === customerKey(typedCustomer));
    if (!knownCustomer) d.customers.push({ name: typedCustomer, country, orderType, note: "" });
    d.orders.unshift({
      id, customer: knownCustomer?.name ?? typedCustomer, country, orderType, orderedAt, whDue, due, dueDefaults: p.autoDue ? R.DUE_DEPTS.filter((dept) => !p.due?.[dept] && due[dept] !== undefined) : [], revision: 0,
      status: "draft", items: [], explosion: null, explodedAt: null, stockCounts: {}, note: String(p.note ?? "").trim().slice(0, 300), createdBy: user.name, createdAt: ctx.now,
    });
    audit(d, ctx, "เปิดใบสั่งผลิต", `${id} ${knownCustomer?.name ?? typedCustomer}${p.pi ? "" : " (ออกเลขอัตโนมัติ)"}${knownCustomer ? "" : " · เพิ่มลูกค้าใหม่"}`);
    return id;
  }

  // ---------- ลูกค้า ----------
  // ชื่อเป็นกุญแจ (ตัดช่องว่างหัวท้าย ไม่สนตัวพิมพ์) · เพิ่มหรือแก้ได้ ไม่มีลบ (ใบสั่งผลิตเดิมยังอ้างชื่อ) · create:true = เพิ่มใหม่เท่านั้น
  // ฐานข้อมูลใช้กฎเดียวกัน (ช่องว่างซ้ำรวมเป็นช่องเดียว ตัดหัวท้าย) · modules/bom-store.js มีสำเนาของกฎนี้สำหรับกุญแจลูกค้า (เทสต์ตรวจว่าตรงกัน)
  const customerName = (name) => String(name ?? "").replace(/\s+/g, " ").trim();
  const customerKey = (name) => customerName(name).toLowerCase();
  function saveCustomer(d, p, ctx) {
    requirePlanner(ctx, "เพิ่ม/แก้ลูกค้า");
    const R = rules();
    const name = text(customerName(p.name), "ชื่อลูกค้า", 120);
    const country = text(p.country, "ประเทศ", 60);
    const typeRaw = String(p.orderType ?? "").trim().toUpperCase();
    const orderType = typeRaw === "" ? R.orderTypeOf(country) : ["SA", "EX"].includes(typeRaw) ? typeRaw : fail("ประเภทออร์เดอร์ไม่ถูกต้อง (SA หรือ EX)");
    d.customers ??= [];
    const existing = d.customers.find((entry) => customerKey(entry.name) === customerKey(name));
    if (existing && p.create) fail(`มีลูกค้า ${existing.name} อยู่แล้ว`);
    const record = existing ?? { name };
    Object.assign(record, { name, country, orderType, note: String(p.note ?? "").trim().slice(0, 300) });
    if (!existing) d.customers.push(record);
    audit(d, ctx, existing ? "แก้ลูกค้า" : "เพิ่มลูกค้า", `${name} · ${country} (${orderType})`);
    return name;
  }

  const editable = (order) => { if (order.status !== "draft") fail("แก้รายการได้เฉพาะใบที่ยังเป็นร่าง (ยังไม่ปล่อยผลิต)"); };
  // งานของใบที่เริ่มแล้ว (แผนกกดเริ่ม/พักงาน รายงานผลผลิต/ของเสีย หรือสร้าง WO ใน RubberFlow) ทำให้แก้รายการสินค้าไม่ได้ เพราะงานรายแผนกคำนวณจากรายการตอนปล่อยผลิต
  // งานที่ผูก WO นับว่าเริ่มแล้วเมื่อ WO เลย "ปล่อยผลิต" ไปแล้ว (กำลังผลิต พัก เสร็จ) หรือหา WO ไม่พบ · WO ที่ยังเป็นแผนก/ปล่อยผลิต (รวม WO ที่เปิดอัตโนมัติตอนปล่อยใบ) ยังไม่นับ
  // rfOrders = รายการ WO จาก RubberFlow ที่โหลดอยู่ (ctx.rfOrders) · ไม่มี (โหมดในเครื่อง หรือ RubberFlow ยังไม่โหลด) = ผูก WO แล้วนับว่าเริ่ม ตามกฎเดิม
  const WO_STARTED = Object.freeze(["in_progress", "on_hold", "completed"]);
  const woStarted = (job, rfOrders) => {
    if (!job.externalRef) return false;
    if (!Array.isArray(rfOrders)) return true;
    // WO ต้องชี้กลับมาที่งานนี้ด้วย (ตรงกับฐานข้อมูล) ไม่งั้นถือว่าไม่พบ = เริ่มแล้ว
    const wo = rfOrders.find((row) => row.id === job.externalRef.woId && row.sourceJobId === job.id);
    return !wo || WO_STARTED.includes(wo.status);
  };
  const startedJobs = (d, order, rfOrders = null) => d.jobs.filter((job) => job.orderId === order.id && (job.status !== "queued" || job.qtyDone > 0 || job.qtyReject > 0 || job.reports?.length || woStarted(job, rfOrders)));
  // แก้รายการสินค้า: ใบร่างแก้ได้เลย · ใบที่ปล่อยผลิตแล้วแต่ยังไม่มีงานเริ่ม กลับเป็นร่าง (ลบงานรายแผนก REV. +1) แล้วต้องระเบิด/ปล่อยผลิตใหม่
  function editableItems(d, order, ctx) {
    if (order.status === "draft") return;
    if (!["released", "in_progress"].includes(order.status)) fail("ใบที่ปิดหรือยกเลิกแล้วแก้รายการสินค้าไม่ได้");
    const started = startedJobs(d, order, ctx?.rfOrders);
    if (started.length) fail(`แก้รายการไม่ได้ มีงานที่เริ่มแล้ว (${started.map((job) => `${job.dept} ${job.itemCode}`).slice(0, 3).join(", ")}${started.length > 3 ? " …" : ""}) ให้เปิดใบใหม่สำหรับส่วนที่เพิ่ม (ใบนี้ปิดเมื่อคลังสินค้ารับเข้าครบ)`);
    // แท่งที่คลังแท่งยาว (SR) จ่ายให้ GR ตามใบนี้แล้ว = งานเริ่มแล้ว (ตรงกับ bom_save_orders ของ 20261202010000: BOM_INVALID_TRANSITION)
    const issuedRods = rules().rodIssued(d, order.id);
    if (issuedRods > 1e-9) fail(`แก้รายการไม่ได้ คลังยางเส้นยาว (SR) จ่ายยางเส้นยาวให้ GR ตามใบนี้แล้ว ${rules().fmtQty(issuedRods)} เส้น (นับว่างานเริ่มแล้ว) ให้ SR ย้อนการจ่ายก่อน หรือเปิดใบใหม่สำหรับส่วนที่เพิ่ม`);
    const returned = returnFgStock(d, ctx, order); // สินค้าที่ใบนี้ได้จากสต็อกคืนกลับให้ใบต้นทาง (ยอดที่ตั้งใช้จากสต็อกในใบคงไว้)
    // แท่งที่ใบนี้หยิบจากคลัง SR ตอนปล่อยผลิตกลับเข้าสต็อกกลาง (ไม่เกินที่ใบยังถืออยู่) · ยอดที่ตั้งใช้ในใบคงไว้ หักใหม่ตอนปล่อยผลิตครั้งหน้า
    for (const take of rules().rodTaken(d, order.id)) {
      pushRodMove(d, ctx, { lotId: take.lotId, itemCode: take.itemCode, kind: "transfer", qty: -take.qty, ownerOrderId: order.id, forOrderId: order.id });
      pushRodMove(d, ctx, { lotId: take.lotId, itemCode: take.itemCode, kind: "transfer", qty: take.qty, ownerOrderId: null, forOrderId: order.id });
    }
    const removed = d.jobs.filter((job) => job.orderId === order.id).length;
    d.jobs = d.jobs.filter((job) => job.orderId !== order.id);
    order.status = "draft";
    order.revision = (order.revision ?? 0) + 1;
    delete order.releasedAt;
    delete order.releasedBy;
    order.explodedAt = null; // ยอดคงคลังที่นับไว้คงอยู่ (ของในคลังไม่เปลี่ยนเพราะแก้ใบ) และถูกหักอีกครั้งตอนปล่อยผลิตใหม่
    audit(d, ctx, "เปิดใบที่ปล่อยผลิตแล้วกลับมาแก้", `${order.id} REV.${order.revision} ลบงานรายแผนก ${removed} รายการ${returned.length ? ` · คืนสต็อกสินค้าสำเร็จรูป ${returned.length} รายการ` : ""}`);
  }
  // ใบที่ส่งมอบแล้วยกเลิกไม่ได้: ทางที่ทำได้จริงคือฝ่ายวางแผนปิดงานที่เหลือพร้อมเหตุผล แล้วคลังสินค้า (WH) ปิดใบรับไม่ครบ
  const DELIVERED_TEXT = "ใบนี้ส่งมอบสินค้าให้ลูกค้าแล้ว ยกเลิกหรือเปิดกลับมาแก้ไม่ได้ ให้ฝ่ายวางแผนปิดงานที่เหลือพร้อมเหตุผล แล้วให้คลังสินค้า (WH) กด “ปิดใบ (รับไม่ครบ)” แทน";
  // คืนสินค้าสำเร็จรูปที่ใบนี้ได้จากสต็อก (ยกเลิกใบ / เปิดใบกลับมาแก้): ห้ามถ้าส่งมอบให้ลูกค้าแล้วหรือให้ใบอื่นไปแล้ว · ที่เหลือคืนให้ใบต้นทางทั้งหมดที่ได้สุทธิ (untransfer)
  // โหมดในเครื่องเขียนประวัติเอง · โหมดฐานข้อมูลเซิร์ฟเวอร์เขียน (ตรงกับ app_bom_save_master) ฝั่งนี้ตรวจให้ผู้ใช้เห็นเหตุผลก่อนส่ง
  function returnFgStock(d, ctx, order) {
    const lock = rules().fgStockLock(d, order);
    if (lock.delivered) fail(DELIVERED_TEXT);
    if (lock.givenAway.length) fail(`ใบนี้ให้สินค้าจากสต็อกแก่ใบอื่นไปแล้ว (${[...new Set(lock.givenAway.map((entry) => entry.orderId))].join(", ")}) ยกเลิกหรือเปิดกลับมาแก้ไม่ได้ จนกว่าใบนั้นจะคืนสต็อก`);
    if (!ctx.remote && lock.took.length) pushFgMoves(d, ctx, order, "untransfer", lock.took, "");
    return lock.took;
  }

  function siblingsOf(d, base) {
    const R = rules();
    const key = R.canonicalCode(base);
    return d.items.filter((item) => item.kind === "FG" && R.parseFgCode(item.code).base === key && approvedBomOf(d, item.code));
  }
  function pickSibling(siblings, pkg, colorSet) {
    const R = rules();
    const parsed = siblings.map((item) => ({ item, ...R.parseFgCode(item.code) }));
    return (parsed.find((entry) => entry.pkg === pkg && entry.colorSet === colorSet) ?? parsed.find((entry) => entry.pkg === pkg) ?? parsed.find((entry) => entry.colorSet === colorSet) ?? parsed[0])?.item ?? null;
  }
  // ---------- สี ชุดสี แพ็กเกจ (แทนการแก้สีมือในชีต Edit DATA) ----------
  const colorSetOf = (d, base, code) => (d.colorSets ?? []).find((entry) => entry.base === base && entry.code === code) ?? null;
  const packageOf = (d, base, code) => (d.packages ?? []).find((entry) => entry.base === base && entry.code === code) ?? null;
  // ลงทะเบียนสีที่ยังไม่รู้จัก (ชื่อจากแม่สีมาตรฐาน) เหมือนคอมปาวด์
  function ensureColor(d, code, ctx) {
    const R = rules();
    const parsed = R.parseColorCode(code) ?? fail(`รหัสสี${ref(code)} ไม่ถูกต้อง (แม่สี 2 ตัวอักษร + เฉด 2 หลัก เช่น OR01)`);
    d.colors ??= [];
    if (!d.colors.some((entry) => entry.code === parsed.code)) d.colors.push({ code: parsed.code, master: parsed.master, shade: parsed.shade, name: R.colorName(parsed.code), createdAt: ctx.now });
    return parsed.code;
  }
  function saveColor(d, p, ctx) {
    requirePlanner(ctx, "เพิ่ม/แก้สี");
    const code = ensureColor(d, text(p.code, "รหัสสี", 4), ctx);
    const color = d.colors.find((entry) => entry.code === code);
    if (p.name !== undefined && String(p.name).trim()) color.name = String(p.name).trim().slice(0, 60);
    audit(d, ctx, "บันทึกสี", `${code} ${color.name}`);
    return code;
  }
  // ชุดสีของฐานรหัส: รหัสชุด (A B C … Y) + สีของแต่ละช่อง (กุญแจ = รหัส SE/RB ถอดสี เรียงตามบรรทัดของ BOM ต้นแบบ)
  function saveColorSet(d, p, ctx) {
    const user = requirePlanner(ctx, "บันทึกชุดสี");
    const R = rules();
    const base = R.canonicalCode(text(p.base, "ฐานรหัสสินค้า", 60));
    const code = text(p.code, "รหัสชุดสี", 4).toUpperCase();
    // ตัวอักษรเดียว ให้ตรงกับท้ายรหัส FG ที่ parseFgCode อ่าน (-Y) มิฉะนั้นรุ่นที่สร้างจะไม่ถูกนับเป็นรุ่นของฐานเดียวกัน
    if (!/^[A-Z]$/.test(code)) fail("รหัสชุดสีต้องเป็นตัวอักษร A–Z ตัวเดียว เช่น A หรือ Y (ตามท้ายรหัสสินค้า)");
    const slots = (Array.isArray(p.slots) ? p.slots : []).map((slot) => ({ key: String(slot.key ?? "").trim().toUpperCase(), color: String(slot.color ?? "").trim().toUpperCase() })).filter((slot) => slot.key);
    if (!slots.length) fail("ชุดสีต้องมีอย่างน้อย 1 ช่องสี");
    for (const slot of slots) {
      if (!/^(SE|RB)-[A-Z0-9-]+-\*-/.test(slot.key)) fail(`กุญแจช่องสี ${slot.key} ไม่ถูกต้อง`);
      if (slot.color) ensureColor(d, slot.color, ctx);
    }
    d.colorSets ??= [];
    const existing = colorSetOf(d, base, code);
    const entry = existing ?? { base, code, createdAt: ctx.now, createdBy: user.name };
    Object.assign(entry, { slots, name: String(p.name ?? entry.name ?? "").trim().slice(0, 60), note: String(p.note ?? "").trim().slice(0, 300), updatedAt: ctx.now, updatedBy: user.name });
    if (!existing) d.colorSets.push(entry);
    audit(d, ctx, existing ? "แก้ชุดสี" : "เพิ่มชุดสี", `${base} ชุด ${code}: ${slots.map((slot) => `${slot.key}=${slot.color || "-"}`).join(" ")}${entry.note ? ` · ${entry.note}` : ""}`);
    return `${base} ${code}`;
  }
  function removeColorSet(d, { base, code }, ctx) {
    requirePlanner(ctx, "ลบชุดสี");
    const key = rules().canonicalCode(base);
    const before = (d.colorSets ?? []).length;
    d.colorSets = (d.colorSets ?? []).filter((entry) => !(entry.base === key && entry.code === String(code ?? "").toUpperCase()));
    if (d.colorSets.length === before) fail("ไม่พบชุดสีนี้");
    audit(d, ctx, "ลบชุดสี", `${key} ชุด ${code}`);
    return true;
  }
  // บันทึกชุดสีจากสินค้าที่มีอยู่ (เรียนรู้สีของช่องจาก BOM ปัจจุบัน) เช่น DEMO-TP-01(P)-Y → ชุด Y ของฐาน DEMO-TP-01
  function learnColorSet(d, { fgCode }, ctx) {
    const R = rules();
    const fg = itemOf(d, fgCode) ?? fail("ไม่พบสินค้า");
    const { base, colorSet } = R.parseFgCode(fg.code);
    if (!colorSet) fail(`${fg.code} ไม่มีรหัสชุดสีท้ายรหัส`);
    const all = R.colorSlotsOf(fg.code, { itemOf: (c) => itemOf(d, c), approvedBomOf: (c) => approvedBomOf(d, c) }).filter((slot) => slot.color);
    // ช่องที่สีไม่ตรงรูปแบบ XX99 (เช่น "ORANGE" จากชีตเก่า) ถูกเว้นว่างไว้ให้ผู้ใช้เลือกเอง ไม่ทำให้ทั้งชุดบันทึกไม่ได้
    const skipped = all.filter((slot) => !R.parseColorCode(slot.color));
    const slots = all.map((slot) => ({ key: slot.key, color: R.parseColorCode(slot.color) ? slot.color : "" }));
    if (!slots.length) fail(`${fg.code} ไม่มีชิ้น SE/RB ที่ระบุสีในชั้นแรก`);
    const note = skipped.length ? `สีของ ${skipped.map((slot) => `${slot.itemCode}=${slot.color}`).join(", ")} ไม่ตรงรูปแบบ XX99 เว้นว่างไว้ให้เลือกเอง` : "";
    return saveColorSet(d, { base, code: colorSet, slots, name: `จาก ${fg.code}`, note }, ctx);
  }
  // แพ็กเกจของฐานรหัส: รหัสแพ็กเกจ (B C P X K N) + บรรทัดบรรจุภัณฑ์ (ชิ้น × ปริมาณต่อ 1 FG) ใช้แทนบรรทัดบรรจุภัณฑ์ของต้นแบบตอนสร้างรุ่นใหม่
  function savePackage(d, p, ctx) {
    const user = requirePlanner(ctx, "บันทึกแพ็กเกจ");
    const R = rules();
    const base = R.canonicalCode(text(p.base, "ฐานรหัสสินค้า", 60));
    const code = text(p.code, "รหัสแพ็กเกจ", 4).toUpperCase();
    if (!/^[A-Z0-9-]{1,4}$/.test(code)) fail("รหัสแพ็กเกจต้องเป็นตัวอักษร/ตัวเลข 1–4 ตัว เช่น P หรือ B-N");
    const seen = new Set();
    const lines = (Array.isArray(p.lines) ? p.lines : []).map((raw, index) => {
      const child = itemOf(d, raw.childCode) ?? fail(`แพ็กเกจ ${code} บรรทัด ${index + 1}: ไม่พบชิ้นงาน${ref(R.canonicalCode(raw.childCode))}`);
      // บรรจุภัณฑ์เป็นของซื้อเท่านั้น: ชิ้นที่ผลิตเอง (SE/RB/PT/BG) ถ้าใส่ได้ ตอนสลับแพ็กเกจจะถูกถอดออกจาก BOM ของรุ่นใหม่โดยไม่รู้ตัว
      if (child.kind !== "PURCHASED") fail(`แพ็กเกจ ${code}: ${child.code} เป็น${R.KINDS[child.kind]?.label ?? child.kind} บรรจุภัณฑ์ต้องเป็นของซื้อ/คลัง`);
      if (seen.has(child.code)) fail(`แพ็กเกจ ${code}: ${child.code} ซ้ำ`);
      seen.add(child.code);
      return { childCode: child.code, qty: num(raw.qty, `แพ็กเกจ ${code} → ${child.code}: ปริมาณต่อ 1 FG`) };
    });
    if (!lines.length) fail("แพ็กเกจต้องมีอย่างน้อย 1 บรรทัด");
    d.packages ??= [];
    const existing = packageOf(d, base, code);
    const entry = existing ?? { base, code, createdAt: ctx.now, createdBy: user.name };
    Object.assign(entry, { lines, name: String(p.name ?? entry.name ?? "").trim().slice(0, 60), updatedAt: ctx.now, updatedBy: user.name });
    if (!existing) d.packages.push(entry);
    audit(d, ctx, existing ? "แก้แพ็กเกจ" : "เพิ่มแพ็กเกจ", `${base} แพ็กเกจ ${code}: ${lines.map((line) => `${line.childCode}×${line.qty}`).join(" ")}`);
    return `${base} ${code}`;
  }
  function removePackage(d, { base, code }, ctx) {
    requirePlanner(ctx, "ลบแพ็กเกจ");
    const key = rules().canonicalCode(base);
    const before = (d.packages ?? []).length;
    d.packages = (d.packages ?? []).filter((entry) => !(entry.base === key && entry.code === String(code ?? "").toUpperCase()));
    if (d.packages.length === before) fail("ไม่พบแพ็กเกจนี้");
    audit(d, ctx, "ลบแพ็กเกจ", `${key} แพ็กเกจ ${code}`);
    return true;
  }
  // ชิ้น SE/RB สีใหม่จากชิ้นต้นแบบ (ชื่อ หน่วย น้ำหนัก ข้อมูลยาง) · SE ที่เปลี่ยนสีได้ BOM ของตัวเอง โดย RB ลูกที่สีในรหัสตรงกับสีเดิมของ SE
  // เปลี่ยนสีตาม (RB สีอื่น เช่น แกนดำในลูกบอลสี หรือ RB ที่รหัสไม่มีสี คงเดิม)
  function ensureRecoloredItem(d, fromCode, color, ctx, user, log) {
    const R = rules();
    const toCode = R.recolorCode(fromCode, color);
    if (toCode === fromCode) return fromCode;
    const src = itemOf(d, fromCode) ?? fail(`ไม่พบชิ้นงาน${ref(fromCode)}`);
    // สีเดิมของ SE: ใช้ทั้งที่อยู่ในรหัสและใน rubber.color (แก้แยกกันได้) RB ลูกที่สีตรงกับตัวใดตัวหนึ่งถือว่าเป็นสีเดียวกับ SE
    const fromColors = [...new Set([R.colorOfCode(fromCode), String(src.rubber?.color ?? "")].map((value) => String(value).toUpperCase()).filter(Boolean))];
    const fromColor = fromColors[0] ?? "";
    if (!itemOf(d, toCode)) {
      d.items.push({ ...src, code: toCode, name: R.renameColor(src.name, fromColor, color, d.colors ?? []), rubber: { ...(src.rubber ?? {}), color }, legacyCodes: [], createdAt: ctx.now, updatedAt: ctx.now, clonedFrom: fromCode });
      log.push(`สร้าง ${toCode} จาก ${fromCode}`);
    }
    const srcBom = approvedBomOf(d, fromCode);
    if (srcBom && !approvedBomOf(d, toCode)) {
      const lines = srcBom.lines.map((line) => {
        const child = itemOf(d, line.childCode);
        const childColor = R.colorOfCode(line.childCode);
        const recolor = child?.kind === "RB" && childColor && fromColors.includes(childColor);
        if (child?.kind === "RB" && childColor && !recolor) log.push(`${line.childCode} ใต้ ${toCode} คงสี ${childColor} (ไม่ใช่สี ${fromColors.join("/") || "-"} ของ SE เดิม)`);
        return { ...line, flags: [...(line.flags ?? [])], childCode: recolor ? ensureRecoloredItem(d, line.childCode, color, ctx, user, log) : line.childCode };
      });
      d.boms.push({ id: masterId(d, "BOM", ctx), itemCode: toCode, revision: 1, status: "approved", ownerDept: src.ownerDept, lines, createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: `เปลี่ยนสีจาก ${fromCode} Rev.${srcBom.revision} เป็น ${color}`, changeLog: [{ at: ctx.now, by: user.name, text: `เปลี่ยนสีจาก ${fromCode} Rev.${srcBom.revision} เป็น ${color}` }] });
    }
    return toCode;
  }
  // สร้างรุ่นสินค้าใหม่จากต้นแบบฐานรหัสเดียวกัน: คัดลอก BOM แล้วใช้นิยามชุดสี (เปลี่ยนสี SE/RB ชั้นแรกและ RB ใต้ SE) และแพ็กเกจ (สลับบรรทัดบรรจุภัณฑ์)
  // ถ้าฐานรหัสยังไม่มีนิยาม ทำแบบเดิม (คัดลอกตรง) และบันทึกไว้ใน changeLog ว่าสียังเป็นของต้นแบบ
  // ชื่อ: name ที่ผู้ใช้ตั้ง (ตรวจแล้ว) ไม่มี = R.suggestFgName (ไม่ต่อป้ายท้ายชื่อต้นแบบที่บรรยายแพ็กและสีของตัวมันเองอยู่แล้ว)
  function cloneFg(d, code, source, { pkg, colorSet, name }, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const sourceBom = approvedBomOf(d, source.code) ?? fail(`${source.code} ยังไม่มี BOM`);
    const { base, pkg: sourcePkg, colorSet: sourceSet } = R.parseFgCode(source.code);
    let lines = sourceBom.lines.map((line) => ({ ...line, flags: [...(line.flags ?? [])] }));
    const log = [`คัดลอกจาก ${source.code} Rev.${sourceBom.revision}`];
    const set = colorSet ? colorSetOf(d, base, colorSet) : null;
    if (set) {
      const sourceSlots = R.colorSlotsOf(source.code, { itemOf: (c) => itemOf(d, c), approvedBomOf: (c) => approvedBomOf(d, c) });
      const { plan, unmatched } = R.colorChangePlan(sourceSlots, set.slots);
      const created = [];
      for (const step of plan) lines[step.lineIndex] = { ...lines[step.lineIndex], childCode: ensureRecoloredItem(d, step.from, step.color, ctx, user, created) };
      if (plan.length) log.push(`ชุดสี ${colorSet}: ${plan.map((step) => `${step.from} → ${step.to}`).join(", ")}`);
      else log.push(`ชุดสี ${colorSet}: สีตรงกับต้นแบบอยู่แล้ว`);
      if (created.length) log.push(created.join(", "));
      if (unmatched.length) log.push(`ชุดสี ${colorSet} ไม่ได้กำหนดสีของ ${[...new Set(unmatched.map((slot) => slot.key))].join(", ")} ใช้สีของต้นแบบ`);
    } else if (colorSet && colorSet !== sourceSet) log.push(`ยังไม่มีนิยามชุดสี ${colorSet} ของฐาน ${base} สี SE/RB ยังเป็นของ ${source.code} (นิยามได้ที่เมนู "ชุดสี / แพ็กเกจ")`);
    const pkgDef = pkg ? packageOf(d, base, pkg) : null;
    if (pkgDef) {
      // ถอดบรรทัดที่เป็นบรรจุภัณฑ์ของแพ็กเกจใดก็ตามของฐานนี้ (ต้นแบบอาจเป็นแพ็กเกจอื่น) แล้วใส่ของแพ็กเกจที่เลือก
      // บรรทัดที่ถูกถอดแต่ไม่อยู่ในแพ็กเกจเป้าหมายถูกบอกไว้ชัด เผื่อผู้ใช้นิยามแพ็กเกจไม่ครบ
      const packaging = new Set((d.packages ?? []).filter((entry) => entry.base === base).flatMap((entry) => entry.lines.map((line) => line.childCode)));
      const target = new Set(pkgDef.lines.map((line) => line.childCode));
      const removedLines = lines.filter((line) => packaging.has(line.childCode));
      const removed = removedLines.map((line) => line.childCode);
      const dropped = removed.filter((code) => !target.has(code));
      // ขั้นที่ของบรรจุภัณฑ์ใหม่: ของรหัสเดียวกันในต้นแบบ ไม่เช่นนั้นขั้นที่บรรจุภัณฑ์เดิมใช้
      const packStep = (code) => removedLines.find((line) => line.childCode === code)?.step ?? removedLines.find((line) => line.step)?.step;
      lines = lines.filter((line) => !packaging.has(line.childCode));
      for (const line of pkgDef.lines) {
        const child = itemOf(d, line.childCode) ?? fail(`แพ็กเกจ ${pkg}: ไม่พบชิ้นงาน${ref(line.childCode)}`);
        const step = packStep(child.code);
        lines.push({ ...(step ? { step } : {}), childCode: child.code, qty: line.qty, uom: child.uom, consumerDept: "PK", producerDept: child.ownerDept, scrapPct: 0, flags: [], note: `แพ็กเกจ ${pkg}` });
      }
      log.push(`แพ็กเกจ ${pkg}: ${removed.length ? `ถอด ${removed.join(", ")} ` : ""}ใส่ ${pkgDef.lines.map((line) => `${line.childCode} × ${R.fmtQty(line.qty)}`).join(", ")}`);
      if (dropped.length) log.push(`บรรจุภัณฑ์ของต้นแบบที่ไม่อยู่ในแพ็กเกจ ${pkg} ถูกถอด: ${dropped.join(", ")} (ถ้าต้องใช้ เพิ่มในนิยามแพ็กเกจ ${pkg})`);
    } else if (pkg && pkg !== sourcePkg) log.push(`ยังไม่มีนิยามแพ็กเกจ ${pkg} ของฐาน ${base} บรรจุภัณฑ์ยังเป็นของ ${source.code}`);
    // ช่องสองช่องที่กลายเป็นชิ้นเดียวกัน (สีเดียวกัน) รวมเป็นบรรทัดเดียว
    const merged = [];
    for (const line of lines) {
      const same = merged.find((entry) => entry.childCode === line.childCode);
      if (same) same.qty += line.qty;
      else merged.push(line);
    }
    d.items.push({ code, kind: "FG", name: String(name ?? "").trim() || R.suggestFgName(source, pkg, colorSet).slice(0, 160), ownerDept: "PK", uom: source.uom, weightG: source.weightG ?? 0, group: source.group ?? "TOY", legacyCodes: [], rubber: null, active: true, createdAt: ctx.now, clonedFrom: source.code });
    d.boms.push({ id: masterId(d, "BOM", ctx), itemCode: code, revision: 1, status: "approved", ownerDept: "PK", lines: merged, createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: log[0], changeLog: log.map((text) => ({ at: ctx.now, by: user.name, text })) });
    audit(d, ctx, "สร้างสินค้าจากฐานรหัสเดียวกัน", `${code} ← ${source.code} Rev.${sourceBom.revision}${log.length > 1 ? ` · ${log.slice(1).join(" · ")}` : ""}`);
  }
  // ชื่อสินค้าใหม่ที่ผู้ใช้ตั้งตอนสร้างรุ่น (1-120 ตัวอักษรหลังตัดช่องว่าง) · ไม่ส่งมา (ว่าง) = ใช้ชื่อที่ระบบแนะนำ
  const newName = (p) => (String(p.name ?? "").trim() ? text(p.name, "ชื่อสินค้าใหม่", 120) : "");
  // สร้างรุ่นสินค้า (ฐาน + แพ็กเกจ + ชุดสี) โดยไม่ต้องผ่านใบสั่งผลิต — จุดเดียวกับที่ addOrderItem ใช้
  function createVariant(d, p, ctx) {
    requirePlanner(ctx, "สร้างรุ่นสินค้า");
    const R = rules();
    const pkg = String(p.pkg ?? "").trim().toUpperCase();
    const colorSet = String(p.colorSet ?? "").trim().toUpperCase();
    const code = R.buildFgCode(text(p.base, "ฐานรหัสสินค้า", 60), pkg, colorSet);
    if (itemOf(d, code)) fail(`มี ${code} อยู่แล้ว`);
    const siblings = siblingsOf(d, p.base);
    if (!siblings.length) fail(`ไม่มีฐานรหัส ${R.canonicalCode(p.base)} ที่มี BOM ในทะเบียนชิ้นงาน`);
    const source = (p.cloneFrom && siblings.find((item) => item.code === R.canonicalCode(p.cloneFrom))) ?? pickSibling(siblings, pkg, colorSet);
    // หน้าชุดสี/แพ็กเกจไม่มีช่องตั้งชื่อ: ไม่ส่งชื่อมา = ชื่อต้นแบบต่อป้ายรุ่นแบบเดิม (ชื่อสินค้าไม่หายเหลือแค่ฐานรหัส) · หน้าใบสั่งผลิตให้ผู้ใช้ยืนยันชื่อเอง
    cloneFg(d, code, source, { pkg, colorSet, name: newName(p) || R.suggestFgName(source, pkg, colorSet, { keepName: true }).slice(0, 160) }, ctx);
    return code;
  }

  // เลือกสินค้าด้วยรหัสเต็ม (fgCode) หรือ 3 ช่องแบบชีต ;}o (base + pkg + colorSet) — รหัสเต็มที่ยังไม่มีแต่มีฐานรหัสเดียวกัน จะสร้างจากต้นแบบให้
  function addOrderItem(d, p, ctx) {
    requirePlanner(ctx, "แก้รายการสินค้า");
    const order = orderById(d, p.orderId);
    editableItems(d, order, ctx);
    const R = rules();
    const byParts = !p.fgCode && p.base;
    const pkg = String(p.pkg ?? "").trim().toUpperCase();
    const colorSet = String(p.colorSet ?? "").trim().toUpperCase();
    const code = byParts ? R.buildFgCode(text(p.base, "ฐานรหัสสินค้า", 60), pkg, colorSet) : R.canonicalCode(p.fgCode);
    let fg = itemOf(d, code);
    if (!fg && byParts) {
      const siblings = siblingsOf(d, p.base);
      if (!siblings.length) fail(`ไม่มีฐานรหัส ${R.canonicalCode(p.base)} ที่มี BOM ในทะเบียนชิ้นงาน`);
      const source = (p.cloneFrom && siblings.find((item) => item.code === R.canonicalCode(p.cloneFrom))) ?? pickSibling(siblings, pkg, colorSet);
      cloneFg(d, code, source, { pkg, colorSet, name: newName(p) }, ctx);
      fg = itemOf(d, code);
    }
    if (!fg) fail("ไม่พบสินค้า");
    if (fg.kind !== "FG") fail("เลือกได้เฉพาะสินค้าสำเร็จรูป (FG)");
    if (!approvedBomOf(d, fg.code)) fail(`${fg.code} ยังไม่มี BOM (สร้างได้ที่หน้า “สินค้า” เปิดสินค้าแล้วเพิ่มบรรทัดในแท็บโครงสร้าง)`);
    const qty = num(p.qty, "จำนวนสั่ง");
    const existing = order.items.find((item) => item.fgCode === fg.code);
    if (fg.active === false && !existing) fail(`${fg.code} เลิกใช้แล้ว เพิ่มในใบสั่งผลิตใหม่ไม่ได้`);
    if (existing) existing.qty += qty;
    else order.items.push({ fgCode: fg.code, qty, colorSet: (colorSet || R.parseFgCode(fg.code).colorSet).slice(0, 10), note: String(p.note ?? "").trim().slice(0, 120) });
    order.explosion = null;
    audit(d, ctx, "เพิ่มสินค้าในใบสั่งผลิต", `${order.id} ${fg.code} × ${qty}`);
    return order.id;
  }

  function removeOrderItem(d, { orderId, fgCode }, ctx) {
    requirePlanner(ctx, "แก้รายการสินค้า");
    const order = orderById(d, orderId);
    const code = rules().canonicalCode(fgCode);
    if (!order.items.some((item) => item.fgCode === code)) fail("ไม่พบสินค้านี้ในใบ");
    editableItems(d, order, ctx);
    order.items = order.items.filter((item) => item.fgCode !== code);
    // สินค้าที่ลบออกไม่ใช้สต็อกสินค้าสำเร็จรูปแล้ว: ล้างยอดที่ตั้งไว้ของรหัสนั้น
    if (order.stockCounts && Object.hasOwn(order.stockCounts, code)) { const rest = { ...order.stockCounts }; delete rest[code]; order.stockCounts = rest; }
    order.explosion = null;
    audit(d, ctx, "ลบสินค้าออกจากใบสั่งผลิต", `${order.id} ${code}`);
    return order.id;
  }

  // แก้จำนวนสั่ง/หมายเหตุของสินค้าในใบ (เปลี่ยนตัวสินค้า = ลบแล้วเพิ่มใหม่)
  function updateOrderItem(d, p, ctx) {
    requirePlanner(ctx, "แก้รายการสินค้า");
    const order = orderById(d, p.orderId);
    const code = rules().canonicalCode(p.fgCode);
    const line = order.items.find((item) => item.fgCode === code) ?? fail("ไม่พบสินค้านี้ในใบ");
    const qty = num(p.qty, "จำนวนสั่ง");
    const note = p.note === undefined ? line.note ?? "" : String(p.note).trim().slice(0, 120);
    editableItems(d, order, ctx); // ใบที่ล็อกบอกเหตุผลก่อน · ถ้าค่าเท่าเดิม fail ด้านล่างและ store ทิ้งร่างทั้งชุด
    if (qty === line.qty && note === (line.note ?? "")) fail("จำนวนและหมายเหตุเท่าเดิม");
    const before = line.qty;
    line.qty = qty;
    line.note = note;
    // ยอดที่ตั้งใช้จากสต็อกสินค้าสำเร็จรูปเกินจำนวนสั่งใหม่ไม่ได้: ตัดลงให้เท่าจำนวนสั่ง (ไม่งั้นขั้น 3 บอกว่าได้ครบจากสต็อกแต่ปล่อยผลิตไม่ผ่าน)
    if (Number(order.stockCounts?.[code]) > qty) order.stockCounts = { ...order.stockCounts, [code]: qty };
    order.explosion = null;
    audit(d, ctx, "แก้จำนวนสินค้าในใบสั่งผลิต", `${order.id} ${code} ${before} → ${qty}`);
    return order.id;
  }

  function explodeOrder(d, { orderId }, ctx) {
    requirePlanner(ctx, "คำนวณวัตถุดิบ");
    const order = orderById(d, orderId);
    editable(order);
    if (!order.items.length) fail("ใบยังไม่มีสินค้า");
    const R = rules();
    const lines = [];
    const missing = new Set();
    for (const item of order.items) {
      const result = R.explode(item.fgCode, item.qty, { itemOf: (code) => itemOf(d, code), approvedBomOf: (code) => approvedBomOf(d, code) });
      result.lines.forEach((line) => lines.push({ ...line, fgQty: item.qty }));
      result.missing.forEach((code) => missing.add(code));
    }
    if (missing.size) fail(`คำนวณไม่ครบ ไม่พบชิ้นงาน: ${[...missing].join(", ")}`);
    // ลำดับในคิวจองของใบร่าง (rules.draftBefore ใช้ explodedAt): กด "คำนวณใหม่" แล้วได้ผลเท่าเดิม = คงลำดับเดิม · ผลต่างจากเดิม (BOM หรือจำนวนเปลี่ยน) หรือใบที่ถูกแก้ (explosion ถูกล้าง) = ไปต่อท้ายคิว
    // เหมือนฐานข้อมูล (bom_save_orders: exploded_at เปลี่ยนเมื่อผลต่างจากเดิมหรือยังว่าง) จึงตรงกับค่าที่ฐานข้อมูลตอบกลับ
    const sameExplosion = Boolean(order.explodedAt) && Array.isArray(order.explosion) && stableJson(order.explosion) === stableJson(lines);
    order.explosion = lines;
    if (!sameExplosion) order.explodedAt = ctx.now;
    audit(d, ctx, "คำนวณวัตถุดิบ", `${order.id} ${lines.length} บรรทัด`);
    return lines.length;
  }

  function releaseOrder(d, { orderId }, ctx) {
    const user = requirePlanner(ctx, "ปล่อยผลิต");
    const order = orderById(d, orderId);
    editable(order);
    explodeOrder(d, { orderId }, ctx);
    const R = rules();
    const noBom = order.explosion.filter((line) => line.noBom).map((line) => line.itemCode);
    if (noBom.length) fail(`ชิ้นที่ต้องผลิตแต่ยังไม่มี BOM: ${[...new Set(noBom)].join(", ")}`);
    // ปริมาณงาน = ความต้องการสุทธิหลังหักคงคลังที่นับ ไล่ชั้นแบบคอลัมน์ AK ของ BOMSHEET (SE ที่มีในคลังลดเส้น RB ที่ต้องรีด)
    // งาน PK ของตัว FG = จำนวนสั่ง − ที่ใช้จากสต็อกสินค้าสำเร็จรูป (ฝ่ายวางแผนตั้งที่ขั้นตรวจของ) · ได้ครบจากสต็อก = ไม่มีงาน PK ของสินค้านั้น
    const net = R.netRequirements(order.explosion, order.stockCounts);
    const taking = fgTaking(d, order);
    // เส้นยางที่ตั้งใช้จากคลังแท่งยาว (SR) ที่ขั้นตรวจของ: หักจากสต็อกกลางตอนปล่อย ล็อตเก่าก่อน (ใบที่ปล่อยก่อนได้ก่อน) · งาน RB ลดตามยอดนี้แล้ว (netRequirements)
    const rods = rodTaking(d, order);
    let covered = 0;
    for (const entry of net) {
      if (!R.MANUFACTURED.includes(entry.kind) || entry.kind === "FG") continue;
      if (entry.toMake <= 0) { covered += 1; continue; }
      // เส้นยางรีดเป็นเส้น/ม้วนเต็ม: แผนของงาน RB ปัดขึ้น (7.74 เส้น → 8 เส้น) · qtyRequired ยังเป็นยอดที่ใบต้องการจริง WO และเคมีจึงคิดจากเส้นเต็ม
      d.jobs.push({ id: masterId(d, "JOB", ctx), orderId: order.id, dept: entry.dept, itemCode: entry.itemCode, name: entry.name, kind: entry.kind, uom: entry.uom, qtyPlanned: R.wholeRods(entry.kind, entry.uom, entry.toMake), qtyRequired: entry.required, stockCounted: entry.stock ?? null, qtyDone: 0, qtyReject: 0, dueAt: order.due[entry.dept] ?? order.whDue, status: "queued", externalRef: null, fgCodes: entry.fgCodes, createdAt: ctx.now, reports: [] });
    }
    for (const item of order.items) {
      const fg = itemOf(d, item.fgCode);
      const taken = taking.find((entry) => entry.fgCode === item.fgCode)?.n ?? 0;
      const planned = qtyRound(item.qty - taken);
      if (planned <= 1e-9) continue; // ได้ครบจากสต็อก ไม่มีงานบรรจุของสินค้านี้
      const counted = order.stockCounts?.[item.fgCode];
      d.jobs.push({ id: masterId(d, "JOB", ctx), orderId: order.id, dept: "PK", itemCode: fg.code, name: fg.name, kind: "FG", uom: fg.uom, qtyPlanned: planned, qtyRequired: item.qty, stockCounted: counted === undefined || counted === null || counted === "" ? null : Number(counted) || 0, qtyDone: 0, qtyReject: 0, dueAt: order.due.PK ?? order.whDue, status: "queued", externalRef: null, fgCodes: [fg.code], createdAt: ctx.now, reports: [] });
    }
    // ของซื้อ: หนึ่งงาน ST ต่อรายการของซื้อที่ระเบิดได้ ยอด = ความต้องการเต็ม (ไม่หักยอดนับตามใบ สต็อกของซื้อเป็นยอดรวมต่อรหัส) · ST เบิกจ่ายตามงานนี้ (issueOrderParts เลือกบรรทัดและจำนวนได้ หลายครั้งจนครบ)
    for (const entry of net) {
      if (entry.kind !== "PURCHASED" || !(entry.required > 0)) continue;
      d.jobs.push({ id: masterId(d, "JOB", ctx), orderId: order.id, dept: "ST", itemCode: entry.itemCode, name: entry.name, kind: "PURCHASED", uom: entry.uom, qtyPlanned: entry.required, qtyRequired: entry.required, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: order.due.ST ?? order.whDue, status: "queued", externalRef: null, fgCodes: entry.fgCodes, createdAt: ctx.now, reports: [] });
    }
    order.status = "released";
    order.releasedAt = ctx.now;
    order.releasedBy = user.name;
    // ได้ครบทุกสินค้าจากสต็อก = ใบปิดทันทีในคำสั่งเดียวกัน (ไม่มีงานผลิต ไปที่ส่งมอบลูกค้า) · โหมดในเครื่องเขียนประวัติโอนและปิดใบเอง
    // โหมดฐานข้อมูลเซิร์ฟเวอร์เขียนประวัติโอนและปิดใบ (ใบที่ส่งขึ้นไปเป็น released เพราะการตั้งใบเป็น completed ฝั่ง client ถูกปฏิเสธ) แล้วส่งกลับมาในคำตอบ
    const fromStock = order.items.length > 0 && order.items.every((item) => (taking.find((entry) => entry.fgCode === item.fgCode)?.n ?? 0) + 1e-9 >= item.qty);
    if (!ctx.remote) {
      const rows = taking.flatMap((entry) => entry.sources.map((source) => ({ fgCode: entry.fgCode, qty: source.qty, fromOrderId: source.fromOrderId })));
      if (rows.length) pushFgMoves(d, ctx, order, "transfer", rows, "");
      if (fromStock) closeOrderNow(order, ctx);
    }
    for (const take of rods) {
      for (const row of take.rows) {
        pushRodMove(d, ctx, { lotId: row.lotId, itemCode: take.itemCode, kind: "transfer", qty: -row.qty, ownerOrderId: row.owner, forOrderId: order.id });
        pushRodMove(d, ctx, { lotId: row.lotId, itemCode: take.itemCode, kind: "transfer", qty: row.qty, ownerOrderId: order.id, forOrderId: order.id });
      }
    }
    const stockText = taking.length ? ` · ใช้สต็อกสินค้าสำเร็จรูป ${taking.length} รายการ${fromStock ? " ได้ครบทุกสินค้า ไม่มีงานผลิต" : ""}` : "";
    const rodText = rods.length ? ` · ใช้ยางเส้นยาวจากคลัง SR ${rods.map((take) => `${take.itemCode} × ${R.fmtQty(take.n)}`).join(", ")}` : "";
    audit(d, ctx, "ปล่อยผลิต", `${order.id} สร้างงาน ${d.jobs.filter((job) => job.orderId === order.id).length} รายการ${covered ? ` · ${covered} ชิ้นมีคงคลังพอ ไม่สร้างงาน` : ""}${stockText}${rodText}`);
    return order.id;
  }
  // สินค้าที่ใบร่างตั้งใช้จากสต็อกสินค้าสำเร็จรูป (stockCounts[รหัสสินค้า] > 0) พร้อมใบต้นทางที่จะได้ของ (ใบที่ปล่อยผลิตก่อนมาก่อน ตามที่ฐานข้อมูลหัก)
  // ตรวจตอนปล่อยผลิต: ไม่เกินจำนวนสั่ง และสต็อกต้องพอ (ใบอื่นปล่อยผลิตไปก่อนและหักไปแล้ว = ตัวเลขเปลี่ยน ต้องกลับไปตั้งยอดใหม่ที่ขั้นตรวจของ)
  function fgTaking(d, order) {
    const R = rules();
    const free = R.fgFreeList(d);
    const wanted = new Map();
    for (const item of order.items) wanted.set(item.fgCode, qtyRound((wanted.get(item.fgCode) ?? 0) + (Number(item.qty) || 0)));
    const taking = [];
    for (const [fgCode, ordered] of wanted) {
      const n = qtyRound(Math.max(0, Number(order.stockCounts?.[fgCode]) || 0));
      if (n <= 0) continue;
      if (n > ordered + 1e-9) fail(`${fgCode} ตั้งใช้จากสต็อกสินค้าสำเร็จรูป ${R.fmtQty(n)} เกินจำนวนสั่ง ${R.fmtQty(ordered)} กลับไปแก้ที่ขั้นตรวจของ`);
      const sources = [];
      let left = n;
      for (const source of free.get(fgCode) ?? []) {
        if (left <= 1e-9) break;
        const qty = qtyRound(Math.min(source.free, left));
        if (qty > 0) sources.push({ fromOrderId: source.orderId, qty });
        left = qtyRound(left - qty);
      }
      if (left > 1e-9) fail(`ตัวเลขเปลี่ยนไปแล้ว: สต็อกสินค้าสำเร็จรูปของ ${fgCode} ไม่พอที่ใบนี้ตั้งใช้ ${R.fmtQty(n)} (เหลือ ${R.fmtQty(n - left)} ใบอื่นอาจปล่อยผลิตไปก่อน) กลับไปตั้งยอดใหม่ที่ขั้นตรวจของ`);
      taking.push({ fgCode, n, sources });
    }
    return taking;
  }

  // นับได้เฉพาะใบร่าง: งานรายแผนกถูกสร้างจากยอดสุทธิตอนปล่อยผลิตครั้งเดียว ยอดที่นับทีหลังจะไม่เปลี่ยนงาน
  const requireDraftForCount = (order) => { if (order.status !== "draft") fail(`นับคงคลังได้เฉพาะใบร่าง (ใบนี้${order.status === "completed" || order.status === "cancelled" ? "ปิดแล้ว" : "ปล่อยผลิตแล้ว งานรายแผนกไม่เปลี่ยนตาม"})`); };
  function setStockCount(d, { orderId, itemCode, qty }, ctx) {
    const user = requireUser(ctx);
    if (!canCount(user)) fail("บันทึกยอดคงคลังได้โดยคลัง (ST/WH) ฝ่ายวางแผน หรือผู้จัดการ");
    const order = orderById(d, orderId);
    // นับได้เฉพาะใบร่าง: งานรายแผนกถูกสร้างจากยอดสุทธิตอนปล่อยผลิตครั้งเดียว ยอดที่นับทีหลังจะไม่เปลี่ยนงาน
    requireDraftForCount(order);
    const code = rules().canonicalCode(itemCode);
    const line = order.explosion?.find((entry) => entry.itemCode === code);
    if (!line) fail("ชิ้นงานนี้ไม่อยู่ในใบ (คำนวณวัตถุดิบก่อน)");
    if (line.kind === "PURCHASED") fail(`${code} เป็นของซื้อ นับที่เมนู “คลังของซื้อ” (ยอดรวมต่อรหัส) ไม่นับตามใบ`);
    // ตัวสินค้าของใบ = ยอดที่ใช้จากสต็อกสินค้าสำเร็จรูป: ฝ่ายวางแผนตั้ง ไม่เกินจำนวนสั่งและไม่เกินสต็อกที่ใช้ได้ของใบนี้ (หักจากสต็อกจริงตอนปล่อยผลิต) · ST / WH นับชิ้นอื่นของใบได้ แต่ไม่ตั้งยอดนี้
    const product = order.items.some((item) => item.fgCode === code);
    // เส้นยาง (RB) = ใช้จากคลังแท่งยาว (SR): ไม่เกินแท่งที่ใบต้องใช้ (เส้นเต็ม) และสต็อกกลางที่ใช้ได้กับใบนี้ (rules.rodStockForDraft) · หักจริงตอนปล่อยผลิต
    const rod = !product && line.kind === "RB";
    const value = num(qty, product || rod ? "ยอดที่ใช้จากสต็อก" : "ยอดคงคลัง", { allowZero: true });
    if (rod) {
      // ตั้งได้เฉพาะกลุ่มวางแผน (ฐานข้อมูลปฏิเสธ ST / WH ที่ตั้งคีย์รหัส RB ด้วย BOM_FORBIDDEN เหมือนคีย์สินค้า)
      if (!canPlan(user)) fail("ตั้งยอดที่ใช้จากคลังยางเส้นยาว (SR) ได้โดยฝ่ายวางแผนหรือผู้จัดการเท่านั้น");
      const row = rules().rodStockForDraft(d, order).find((entry) => entry.itemCode === code);
      if (row && value > row.max + 1e-9) fail(value > row.available + 1e-9 ? `${code} คลังยางเส้นยาว (SR) มีสต็อกกลางที่ใช้ได้กับใบนี้ ${rules().fmtQty(row.available)}${row.taken > 0 ? ` (ใบร่างที่คำนวณก่อนใบนี้ตั้งใช้ไว้ ${rules().fmtQty(row.taken)})` : ""} ใช้ ${rules().fmtQty(value)} ไม่ได้` : `${code} ใบนี้ต้องใช้ไม่เกิน ${rules().fmtQty(row.max)} ${rules().uomLabel(row.uom)}`);
    }
    if (product) {
      if (!canPlan(user)) fail("ตั้งยอดที่ใช้จากสต็อกสินค้าสำเร็จรูปได้โดยฝ่ายวางแผนหรือผู้จัดการเท่านั้น");
      const row = rules().fgStockForDraft(d, order).find((entry) => entry.fgCode === code);
      if (value > row.ordered + 1e-9) fail(`${code} ใช้จากสต็อกได้ไม่เกินจำนวนสั่ง ${rules().fmtQty(row.ordered)}`);
      if (value > row.available + 1e-9) fail(`${code} สต็อกสินค้าสำเร็จรูปที่ใช้ได้กับใบนี้มี ${rules().fmtQty(row.available)}${row.taken > 0 ? ` (ใบร่างที่คำนวณก่อนใบนี้ตั้งใช้ไว้ ${rules().fmtQty(row.taken)})` : ""} ใช้ ${rules().fmtQty(value)} ไม่ได้`);
    }
    order.stockCounts[code] = value;
    order.stockCountedAt = ctx.now;
    order.stockCountedBy = user.name;
    audit(d, ctx, product ? rules().FG_STOCK_AUDIT_TEXT : rod ? rules().ROD_STOCK_AUDIT_TEXT : "นับคงคลังตามใบ", `${order.id} ${code} = ${value}`);
    return code;
  }

  // นับหลายรายการในครั้งเดียว (หน้า "นับคงคลัง" บนมือถือ): ช่องที่เว้นว่างไม่แตะยอดเดิม · ทั้งชุดผ่านหรือไม่ผ่านพร้อมกัน (store.run ทำบนร่าง)
  function setStockCounts(d, { orderId, counts }, ctx) {
    const user = requireUser(ctx);
    if (!canCount(user)) fail("บันทึกยอดคงคลังได้โดยคลัง (ST/WH) ฝ่ายวางแผน หรือผู้จัดการ"); // ก่อนข้ามยอดเท่าเดิม
    const order = orderById(d, orderId);
    requireDraftForCount(order);
    const list = (Array.isArray(counts) ? counts : []).filter((entry) => String(entry?.qty ?? "").trim() !== "");
    if (!list.length) fail("ยังไม่ได้กรอกยอดที่นับ");
    let changed = 0;
    const seen = new Set();
    for (const entry of list) {
      const code = rules().canonicalCode(entry.itemCode);
      if (seen.has(code)) fail(`${code} ซ้ำในรายการ`);
      seen.add(code);
      // ยอดเท่าเดิม (ฟอร์มเติมค่าที่นับไว้แล้ว) ไม่บันทึกซ้ำ จึงไม่เขียน audit ล้น
      if (order.stockCounts?.[code] !== undefined && Number(entry.qty) === order.stockCounts[code]) continue;
      setStockCount(d, { orderId, itemCode: code, qty: entry.qty }, ctx);
      changed += 1;
    }
    return { changed, summary: changed ? `${changed} รายการ` : "0 รายการ (ยอดเท่าเดิมทั้งหมด)" };
  }

  // ยกเลิกใบ (ตรงกับ private.bom_save_orders ของ 20261128010000): ฝ่ายวางแผนยกเลิกใบร่าง / ปล่อยผลิตแล้ว / กำลังผลิต ได้ทุกเมื่อพร้อมเหตุผล 3-200 ตัวอักษร
  // งานที่มียอดแล้วไม่กันการยกเลิก · งานของใบคงอยู่พร้อมยอดและรายงาน (แก้ต่อไม่ได้ ไม่ค้างในงานของฉัน: isOpenJob) · ส่งมอบแล้ว / ให้สต็อกใบอื่นไปแล้ว = ยกเลิกไม่ได้
  // โหมดฐานข้อมูล: เซิร์ฟเวอร์ยกเลิก WO ที่ยังไม่เริ่มและหยุด WO ที่กำลังผลิต / พักอยู่ (WO ที่ปิดแล้วคงเดิม) · เคมีที่เบิกไปแล้ว ST รับคืน · ของซื้อที่เบิกแล้วคืนด้วย "คืนของเหลือ"
  // สินค้าที่ใบนี้รับเข้าคลังเองเป็นสต็อกสินค้าสำเร็จรูป (rules.fgFreeList นับใบที่ยกเลิก สั่ง = 0)
  const CANCEL_REASON_MIN = 3;
  const CANCEL_REASON_MAX = 200;
  function cancelOrder(d, { orderId, reason }, ctx) {
    requirePlanner(ctx, "ยกเลิกใบ");
    const order = orderById(d, orderId);
    if (order.status === "completed") fail("ใบที่เสร็จแล้วยกเลิกไม่ได้");
    if (order.status === "cancelled") fail("ใบนี้ถูกยกเลิกแล้ว");
    const why = typeof reason === "string" ? reason.trim() : "";
    if (why.length < CANCEL_REASON_MIN) fail(`กรุณาระบุเหตุผลที่ยกเลิก (อย่างน้อย ${CANCEL_REASON_MIN} ตัวอักษร)`);
    if (why.length > CANCEL_REASON_MAX) fail(`เหตุผลยาวเกิน ${CANCEL_REASON_MAX} ตัวอักษร`);
    const returned = returnFgStock(d, ctx, order); // สินค้าที่ใบนี้ได้จากสต็อกคืนกลับให้ใบต้นทาง
    order.status = "cancelled";
    order.cancelledAt = ctx.now;
    order.cancelReason = why;
    audit(d, ctx, "ยกเลิกใบสั่งผลิต", `${order.id} — ${why}${returned.length ? ` · คืนสต็อกสินค้าสำเร็จรูป ${returned.length} รายการ` : ""}`);
    return order.id;
  }

  // ---------- สินค้าสำเร็จรูป (FG): คลังสินค้า (WH) รับเข้า · ใบปิดเองเมื่อรับครบ · ปิดใบ (รับครบ) · ปิดรับไม่ครบด้วยเหตุผล · ส่งมอบลูกค้า ----------
  // ไม่มี completeOrder ของฝ่ายวางแผนอีกต่อไป · ผู้ทำ = แผนก WH ทุกบทบาท หรือผู้ดูแลระบบ (ไม่ใช่ฝ่ายวางแผน)
  // ใบปิดได้ทุกทางเมื่อทุกงานผลิตเสร็จเท่านั้น (งานผลิต = ทุกงานยกเว้นการเบิกของซื้อ ST / PURCHASED): รับครบตอนงานยังเปิด ใบเปิดต่อ แล้ว WH กด "ปิดใบ" (closeOrder) เมื่องานเสร็จครบ
  // ลำดับตรวจเหมือนฐานข้อมูล (app_bom_save_master): รูปคำขอ → สิทธิ์ → สถานะใบ → ยอด · โหมดฐานข้อมูลคืน request ที่ store ส่งในส่วน fgMoves (เซิร์ฟเวอร์เขียนประวัติและปิดใบเอง)
  // โหมดในเครื่อง action เขียน d.fgMoves และปิดใบเอง
  const canHandleFg = (user) => Boolean(user) && (user.role === "admin" || user.dept === "WH");
  // ย้อนรับเข้า / ส่งมอบ (20261128020000): admin หรือผู้จัดการแผนก (department_manager) ของแผนก WH · พนักงาน WH และกลุ่มวางแผนแผนกอื่นไม่ได้ (ฐานข้อมูลตรวจซ้ำ: BOM_FORBIDDEN)
  // โหมดฐานข้อมูลเทียบรหัสบทบาทของบัญชีทดสอบ (bom-store personaUser.roleCode) · โหมดสาธิตในเครื่องไม่มีรหัสบทบาท ใช้บทบาท manager ของแผนก WH
  const canReverseFg = (user) => Boolean(user) && (user.role === "admin" || (user.dept === "WH" && (user.roleCode ? user.roleCode === "department_manager" : user.role === "manager")));
  const FG_MAX_LINES = 500;
  const FG_NOTE_MAX = 300;
  const FG_REASON_MIN = 3;
  // ข้อความของแถว close เมื่อปิดใบที่รับครบ (เซิร์ฟเวอร์เขียนข้อความเดียวกันใน private.bom_fg_move ของ 20261125010000)
  const FULL_CLOSE_NOTE = "รับครบ ปิดใบโดยคลังสินค้า";
  // แผนกที่ยังมีงานผลิตเปิด: ชื่อไทยก่อน ตัวย่อในวงเล็บ เช่น "รีดเส้นยาง (RB), ตัด/เจาะชิ้นยาง (GR)"
  const deptText = (dept) => `${String(rules().DEPT_LABEL?.[dept] ?? dept).replace(/^\w+ · /, "")} (${dept})`;
  const openDeptsText = (position) => position.openDepts.map(deptText).join(", ");
  const fgRead = (d, ctx, p, kind, full = false) => {
    const user = requireUser(ctx);
    // เลข PI เก็บเป็นตัวพิมพ์ใหญ่เสมอ (createOrder) · ตัดช่องว่างและทำเป็นตัวพิมพ์ใหญ่ก่อนหาเหมือน private.bom_fg_move (upper + ตัดช่องว่าง)
    const order = orderById(d, String(p?.orderId ?? "").trim().toUpperCase());
    const R = rules();
    const note = p?.note === undefined || p?.note === null ? "" : typeof p.note === "string" ? p.note.trim() : fail("หมายเหตุต้องเป็นข้อความ");
    if (note.length > FG_NOTE_MAX) fail(`หมายเหตุยาวเกิน ${FG_NOTE_MAX} ตัวอักษร`);
    let lines = [];
    if (kind === "close") {
      if (Array.isArray(p?.lines) && p.lines.length) fail("การปิดใบไม่ระบุรายการสินค้า");
      if (full && note) fail("การปิดใบที่รับครบไม่ต้องระบุเหตุผล");
      if (!full && note.length < FG_REASON_MIN) fail(`กรุณาระบุเหตุผลที่ปิดใบ (อย่างน้อย ${FG_REASON_MIN} ตัวอักษร)`);
    } else {
      const label = kind === "receive" ? "จำนวนที่รับ" : "จำนวนที่ส่งมอบ";
      const entries = (Array.isArray(p?.lines) ? p.lines : []).filter((entry) => filled(entry?.qty));
      if (!entries.length) fail(kind === "receive" ? "ยังไม่ได้กรอกจำนวนที่รับเข้าคลัง" : "ยังไม่ได้กรอกจำนวนที่ส่งมอบ");
      if (entries.length > FG_MAX_LINES) fail(`ทำได้ไม่เกิน ${FG_MAX_LINES} รายการต่อครั้ง`);
      const seen = new Set();
      lines = entries.map((entry) => {
        const code = R.canonicalCode(entry.fgCode);
        if (seen.has(code)) fail(`${code} ซ้ำในรายการ`);
        seen.add(code);
        if (!order.items.some((item) => item.fgCode === code)) fail(`${code} ไม่ได้อยู่ในใบ ${order.id}`);
        const qty = qtyRound(num(entry.qty, label));
        // จำนวนเล็กมากที่ปัดแล้วเป็น 0 ส่งไปฐานข้อมูลไม่ได้ (ฐานข้อมูลรับเฉพาะ qty > 0)
        if (qty <= 0) fail(`${label}ต้องมากกว่า 0`);
        if (qty > 1e9) fail("ตัวเลขใหญ่เกินไป");
        return { fgCode: code, qty };
      });
    }
    if (!canHandleFg(user)) fail(kind === "receive" ? "รับสินค้าเข้าคลังได้โดยคลังสินค้า (WH) หรือผู้ดูแลระบบเท่านั้น" : kind === "deliver" ? "บันทึกการส่งมอบได้โดยคลังสินค้า (WH) หรือผู้ดูแลระบบเท่านั้น" : full ? "ปิดใบได้โดยคลังสินค้า (WH) หรือผู้ดูแลระบบเท่านั้น" : "ปิดใบที่รับไม่ครบได้โดยคลังสินค้า (WH) หรือผู้ดูแลระบบเท่านั้น");
    return { user, order, lines, note, position: R.fgPosition(d, order) };
  };
  const fgRequest = (order, kind, lines, note) => ({ orderId: order.id, kind, ...(kind === "close" ? {} : { lines: lines.map(({ fgCode, qty }) => ({ fgCode, qty })) }), ...(note || kind === "close" ? { note } : {}) });
  // lines ของ transfer / untransfer มี fromOrderId (ใบต้นทางของสต็อก) ด้วย · แถวอื่นไม่มี
  function pushFgMoves(d, ctx, order, kind, lines, note) {
    d.fgMoves ??= [];
    const rows = kind === "close" ? [{ fgCode: "", qty: 0 }] : lines;
    rows.forEach((line) => d.fgMoves.push({ id: `local-${ctx.now}-${d.fgMoves.length + 1}`, orderId: order.id, fgCode: line.fgCode, kind, qty: line.qty, note, at: ctx.now, by: ctx.user?.name ?? "", ...(line.fromOrderId ? { fromOrderId: line.fromOrderId } : {}) }));
  }
  function closeOrderNow(order, ctx) {
    order.status = "completed";
    order.completedAt = ctx.now;
  }
  const fgSummary = (lines) => `${lines.length} รายการ`;
  function receiveFg(d, p, ctx) {
    const { order, lines, note, position } = fgRead(d, ctx, p, "receive");
    // ใบที่ปิดแล้วรับเข้าได้เฉพาะส่วนที่ PK ผลิตเกินจำนวนสั่ง (กลายเป็นสต็อกสินค้าสำเร็จรูป) · ยอดรับ ≤ ที่ PK รายงาน เทียบกับที่รับจากงานของใบนี้เอง (ไม่รวมที่ได้จากสต็อก)
    if (!["released", "in_progress", "completed"].includes(order.status)) fail("รับสินค้าเข้าคลังได้เฉพาะใบที่ปล่อยผลิตแล้ว");
    for (const line of lines) {
      const product = position.products.find((entry) => entry.fgCode === line.fgCode);
      if (line.qty > product.receivable + 1e-9) fail(`${line.fgCode} รับได้อีกไม่เกิน ${rules().fmtQty(product.receivable)} (PK ส่งมอบแล้ว ${rules().fmtQty(product.pkDone)} รับเข้าคลังไปแล้ว ${rules().fmtQty(product.own)})`);
    }
    // ใบปิดเองเมื่อทุกสินค้ามีของครบตามที่สั่ง รับเอง + ได้จากสต็อก และทุกงานผลิตเสร็จแล้ว (โหมดฐานข้อมูล: เซิร์ฟเวอร์ทำเองและส่งใบกลับมา · ฝั่งนี้ทำล่วงหน้าให้หน้าแสดงทันที) · ใบที่ปิดแล้วไม่ปิดซ้ำ
    // รับครบแต่ยังมีงานผลิตเปิด: ใบเปิดต่อ คลังสินค้า (WH) ปิดใบเมื่อทุกแผนกปิดงานแล้ว (closeOrder)
    const full = order.status !== "completed" && position.products.every((product) => product.have + (lines.find((line) => line.fgCode === product.fgCode)?.qty ?? 0) + 1e-9 >= product.ordered);
    const closes = full && position.productionDone;
    if (!ctx.remote) pushFgMoves(d, ctx, order, "receive", lines, note);
    if (closes) closeOrderNow(order, ctx);
    audit(d, ctx, "รับสินค้าเข้าคลัง", `${order.id} ${lines.map((line) => `${line.fgCode} × ${line.qty}`).join(", ")}${closes ? " · รับครบ ใบปิดอัตโนมัติ" : full ? ` · รับครบ ใบยังไม่ปิด รองานของแผนก ${openDeptsText(position)}` : ""}`);
    return { received: lines.length, closed: closes, summary: fgSummary(lines), request: fgRequest(order, "receive", lines, note) };
  }
  function deliverFg(d, p, ctx) {
    const { order, lines, note, position } = fgRead(d, ctx, p, "deliver");
    if (!["released", "in_progress", "completed"].includes(order.status)) fail("ส่งมอบได้เฉพาะใบที่ปล่อยผลิตแล้ว");
    for (const line of lines) {
      const product = position.products.find((entry) => entry.fgCode === line.fgCode);
      if (line.qty > product.deliverable + 1e-9) fail(`${line.fgCode} ส่งมอบได้อีกไม่เกิน ${rules().fmtQty(product.deliverable)} (มีของในใบ ${rules().fmtQty(product.have)}${product.givenAway > 0 ? ` ให้ใบอื่นไปแล้ว ${rules().fmtQty(product.givenAway)}` : ""} ส่งมอบไปแล้ว ${rules().fmtQty(product.delivered)})`);
    }
    // ส่งมอบเกินจำนวนที่สั่ง (ผู้ใช้ตัดสิน 2026-11-18 · N5): ส่งได้ (ส่วนเกินคือสต็อกสินค้าสำเร็จรูปของใบ) แต่ต้องติ๊กยืนยันในฟอร์ม (p.overConfirm) · ฐานข้อมูลไม่มีด่านนี้
    const over = lines.map((line) => {
      const product = position.products.find((entry) => entry.fgCode === line.fgCode);
      return { fgCode: line.fgCode, qty: qtyRound(line.qty - Math.max(0, product.ordered - product.delivered)) };
    }).filter((row) => row.qty > 1e-9);
    if (over.length && p?.overConfirm !== true && !["1", "on", "true"].includes(String(p?.overConfirm ?? ""))) {
      fail(`ส่งมอบเกินจำนวนที่สั่ง ${over.map((row) => `${row.fgCode} ${rules().fmtQty(row.qty)}`).join(", ")} ติ๊กยืนยันการส่งมอบเกินก่อน`);
    }
    if (!ctx.remote) pushFgMoves(d, ctx, order, "deliver", lines, note);
    audit(d, ctx, "ส่งมอบสินค้าให้ลูกค้า", `${order.id} ${lines.map((line) => `${line.fgCode} × ${line.qty}`).join(", ")}`);
    return { delivered: lines.length, summary: fgSummary(lines), request: fgRequest(order, "deliver", lines, note) };
  }
  // ข้อความเมื่อยังมีงานผลิตเปิด: บอกแผนกและทางออก (แผนกรายงานให้เสร็จ หรือฝ่ายวางแผนปิดงานที่ไม่ทำต่อ)
  const productionOpenText = (position) => `งานของแผนก ${openDeptsText(position)} ยังไม่เสร็จ ให้แผนกนั้นรายงานผลให้เสร็จ หรือฝ่ายวางแผนกด “ปิดงานนี้” ที่งานที่จะไม่ทำต่อ`;
  // ปิดใบที่รับไม่ครบ: ทุกงานผลิตเสร็จ (รวมงาน PK) ของที่ PK ทำรับเข้าครบแล้ว และยังมีสินค้าที่รับน้อยกว่าที่สั่ง · ต้องมีเหตุผล
  function closeOrderShort(d, p, ctx) {
    const { order, note, position } = fgRead(d, ctx, p, "close");
    if (!["released", "in_progress"].includes(order.status)) fail("ปิดใบได้เฉพาะใบที่ปล่อยผลิตแล้วและยังไม่ปิด");
    if (!position.hasPkJobs) fail("ใบนี้ไม่มีงานบรรจุ (PK) ให้ปิดแบบรับไม่ครบ");
    if (!position.pkAllDone) fail("งานบรรจุ (PK) ยังไม่เสร็จครบทุกสินค้า");
    if (!position.productionDone) fail(productionOpenText(position));
    if (position.products.some((product) => product.receivable > 1e-9)) fail("ยังมีสินค้าที่ PK ทำเสร็จแต่ยังไม่ได้รับเข้าคลัง รับเข้าให้ครบก่อน");
    if (!position.products.some((product) => product.have + 1e-9 < product.ordered)) fail("มีสินค้าครบตามที่สั่งแล้ว ไม่ต้องปิดแบบรับไม่ครบ ใช้ “ปิดใบ” แทน");
    if (!ctx.remote) pushFgMoves(d, ctx, order, "close", [], note);
    closeOrderNow(order, ctx);
    audit(d, ctx, "ปิดใบสั่งผลิต (รับไม่ครบ)", `${order.id} — ${note}`);
    return { summary: order.id, request: fgRequest(order, "close", [], note) };
  }
  // ปิดใบ (รับครบ): ใช้เมื่อรับครบไปแล้วตอนที่ยังมีงานผลิตเปิดอยู่ (ใบจึงไม่ได้ปิดเองตอนรับ) · ทุกงานผลิตเสร็จแล้ว ไม่ต้องมีเหตุผล
  // คำขอ { orderId, kind: "close" } ไม่มีรายการและเหตุผล (เซิร์ฟเวอร์เขียนแถว close ด้วยข้อความของตัวเอง)
  function closeOrder(d, p, ctx) {
    const { order, position } = fgRead(d, ctx, p, "close", true);
    if (!["released", "in_progress"].includes(order.status)) fail("ปิดใบได้เฉพาะใบที่ปล่อยผลิตแล้วและยังไม่ปิด");
    if (!position.productionDone) fail(`ยังปิดใบไม่ได้: ${productionOpenText(position)}`);
    if (!position.allReceived) fail("ยังรับสินค้าเข้าคลังไม่ครบตามที่สั่ง ถ้าจะปิดโดยรับเท่าที่มี ใช้ “ปิดใบ (รับไม่ครบ)”");
    if (!ctx.remote) pushFgMoves(d, ctx, order, "close", [], FULL_CLOSE_NOTE);
    closeOrderNow(order, ctx);
    audit(d, ctx, "ปิดใบสั่งผลิต (รับครบ)", order.id);
    return { summary: order.id, request: { orderId: order.id, kind: "close" } };
  }

  // ย้อนรับเข้าคลัง / ย้อนส่งมอบหนึ่งรายการทั้งรายการ (20261128020000 · ตรงกับ private.bom_fg_reverse): { orderId, moveId, note } · เหตุผล 3-300 ตัวอักษร
  // ย้อนได้ตามกฎ rules.fgReverseBlock (ย้อนแล้ว / ใบยกเลิก / ส่งมอบไปแล้ว / ใบอื่นใช้สต็อกไปแล้ว = ไม่ได้) · ตัวเลขที่ถูกบันทึกใหม่ด้วยรับเข้าคลัง / ส่งมอบตามปกติ
  // ใบที่ปิดแล้วซึ่งของไม่ครบหลังย้อนรับเข้า = เปิดกลับเป็นกำลังผลิต (แถวปิดใบเดิมอยู่ในประวัติ) · โหมดฐานข้อมูล: เซิร์ฟเวอร์เขียนแถวย้อนและเปิดใบเอง ฝั่งนี้ทำล่วงหน้าให้หน้าแสดงทันที
  function reverseFg(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const order = orderById(d, String(p?.orderId ?? "").trim().toUpperCase());
    const note = p?.note === undefined || p?.note === null ? "" : typeof p.note === "string" ? p.note.trim() : fail("เหตุผลต้องเป็นข้อความ");
    if (note.length < FG_REASON_MIN) fail(`กรุณาระบุเหตุผลที่ย้อน (อย่างน้อย ${FG_REASON_MIN} ตัวอักษร)`);
    if (note.length > FG_NOTE_MAX) fail(`เหตุผลยาวเกิน ${FG_NOTE_MAX} ตัวอักษร`);
    if (!canReverseFg(user)) fail("ย้อนการรับเข้าคลังหรือการส่งมอบได้โดยผู้จัดการแผนกคลังสินค้า (WH) หรือผู้ดูแลระบบเท่านั้น");
    const moveId = String(p?.moveId ?? "").trim();
    const move = (d.fgMoves ?? []).find((row) => row.id === moveId) ?? fail("ไม่พบรายการที่จะย้อน");
    const blocked = R.fgReverseBlock(d, order, move);
    if (blocked) fail(blocked);
    const reopens = R.fgReverseReopens(d, order, move);
    const kind = move.kind === "receive" ? "unreceive" : "undeliver";
    if (!ctx.remote) {
      d.fgMoves.push({ id: `local-${ctx.now}-${d.fgMoves.length + 1}`, orderId: order.id, fgCode: move.fgCode, kind, qty: move.qty, note, at: ctx.now, by: ctx.user?.name ?? "", reversesId: move.id });
    }
    if (reopens) {
      order.status = "in_progress";
      delete order.completedAt;
    }
    audit(d, ctx, kind === "unreceive" ? "ย้อนรับสินค้าเข้าคลัง" : "ย้อนการส่งมอบสินค้า", `${order.id} ${move.fgCode} × ${move.qty} — ${note}${reopens ? " · ใบเปิดกลับเป็นกำลังผลิต" : ""}`);
    return { reopened: reopens, summary: `${move.fgCode} × ${R.fmtQty(move.qty)}`, request: { orderId: order.id, kind: "reverse", moveId: move.id, note } };
  }

  // ---------- งานรายแผนก ----------
  // รายงานผล/เปลี่ยนสถานะงาน: ฝ่ายวางแผน ผู้จัดการ ผู้ดูแล (ทุกแผนก) หรือพนักงานทุกบทบาทของแผนกเจ้าของงาน · แผนกอื่นดูได้อย่างเดียว
  const canWorkJob = (user, job) => canPlan(user) || (Boolean(user?.dept) && user.dept === job.dept);
  // ผูกงาน RB กับ RubberFlow: ฝ่ายวางแผน ผู้จัดการ ผู้ดูแล หรือแผนก RB
  // สร้าง WO ของงาน RB / ผูกงานกับ WO = ฝ่ายวางแผนและผู้จัดการเท่านั้น (โรงงานขั้น 6: เปิดใบสั่งผลิตยางย้ายมาที่ฝ่ายวางแผน · แผนก RB เริ่มงานของ WO ที่ปล่อยแล้ว)
  const canLinkRubberflow = (user, job) => job?.dept === "RB" && canPlan(user);

  function reportJob(d, p, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, p.jobId);
    if (isPartJob(job)) fail("งานของซื้อ (ST) รายงานผลเองไม่ได้ ใช้ปุ่ม “เบิกจ่ายของซื้อ” ที่ใบสั่งผลิต");
    if (isLinkedJob(job)) fail(`งานนี้ผูกกับ ${job.externalRef.woId} ของ RubberFlow ยอดมาจาก RubberFlow เมื่อล็อตตกแต่งผ่าน QC รายงานผลที่นี่ไม่ได้`);
    // งาน GR ที่ตั้งขั้นตอนแล้ว: ยอดมาจากผลรายวัน (addGrRecord) เท่านั้น ไม่พิมพ์ยอดซ้ำ (ฐานข้อมูลปฏิเสธด้วย trigger bom_jobs_gr_guard ของ 20261216010000)
    if (isGrPlanned(d, job)) fail("งาน GR นี้ตั้งขั้นตอนแล้ว ยอดมาจาก “บันทึกผลรายวัน” รายงานผลที่นี่ไม่ได้");
    if (!canWorkJob(user, job)) fail(`รายงานผลได้โดยแผนก ${job.dept} หรือผู้จัดการ`);
    if (job.status === "done") fail("งานนี้เสร็จแล้ว");
    if (job.status === "hold") fail("งานนี้พักอยู่ กด ทำต่อ ก่อนรายงานผล");
    const order = orderById(d, job.orderId);
    if (!["released", "in_progress"].includes(order.status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    const good = p.qtyDone === undefined || p.qtyDone === "" ? 0 : num(p.qtyDone, "จำนวนดี", { allowZero: true });
    const reject = p.qtyReject === undefined || p.qtyReject === "" ? 0 : num(p.qtyReject, "จำนวนเสีย", { allowZero: true });
    if (good === 0 && reject === 0) fail("กรุณาระบุจำนวนดีหรือจำนวนเสีย");
    job.qtyDone = Math.round((job.qtyDone + good) * 1e4) / 1e4;
    job.qtyReject = Math.round((job.qtyReject + reject) * 1e4) / 1e4;
    job.reports.push({ at: ctx.now, by: user.name, good, reject, note: String(p.note ?? "").trim().slice(0, 200) });
    job.status = job.qtyDone + 1e-9 >= job.qtyPlanned ? "done" : "in_progress";
    if (job.status === "done") job.doneAt = ctx.now;
    if (order.status === "released") order.status = "in_progress";
    audit(d, ctx, "รายงานผลผลิต", `${job.id} ${job.itemCode} ดี ${good} เสีย ${reject}`);
    return job.id;
  }

  // ปิดงานที่จะไม่มีใครรายงานแล้ว (status "done" + reason): ฝ่ายวางแผน ผู้จัดการ หรือผู้ดูแลระบบเท่านั้น · ไม่เพิ่มยอด (ยอด PK ที่ WH รับไปแล้วจึงไม่ลด)
  // เก็บเหตุผลเป็นรายการรายงานยอด 0 ของงาน (ฐานข้อมูลรับรายการยอด 0 เฉพาะกรณีนี้: private.bom_save_jobs ของ 20261125010000) และอยู่ในบันทึกการใช้งาน
  const JOB_CLOSE_MIN = 3;
  const JOB_CLOSE_MAX = 200;
  // งานที่ฝ่ายวางแผนปิด: งานเสร็จที่รายการรายงานล่าสุดเป็นยอด 0 → { reason, by, at } · อื่นๆ = null
  const jobCloseNote = (job) => {
    // รายการของผลรายวัน GR (kind gr · ยอดลดเขียนเป็นยอด 0) และเหตุผลการพัก (kind hold) ไม่ใช่เหตุผลของการปิดงาน
    const last = job?.status === "done" && Array.isArray(job.reports) ? job.reports.filter((entry) => entry?.kind !== "gr" && entry?.kind !== "hold").at(-1) : null;
    return last && !(Number(last.good) || 0) && !(Number(last.reject) || 0) && String(last.note ?? "").trim() ? { reason: String(last.note).trim(), by: last.by ?? "", at: last.at } : null;
  };
  function closeJob(d, job, reason, ctx, user) {
    if (!canPlan(user)) fail("ปิดงานที่ไม่ทำต่อได้โดยฝ่ายวางแผนหรือผู้จัดการเท่านั้น");
    if (job.status === "done") fail("งานนี้เสร็จแล้ว");
    const order = orderById(d, job.orderId);
    if (!["released", "in_progress"].includes(order.status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    const note = typeof reason === "string" ? reason.trim() : "";
    if (note.length < JOB_CLOSE_MIN) fail(`กรุณาระบุเหตุผลที่ปิดงาน (อย่างน้อย ${JOB_CLOSE_MIN} ตัวอักษร)`);
    if (note.length > JOB_CLOSE_MAX) fail(`เหตุผลยาวเกิน ${JOB_CLOSE_MAX} ตัวอักษร`);
    job.reports.push({ at: ctx.now, by: user.name, good: 0, reject: 0, note });
    job.status = "done";
    job.doneAt = ctx.now;
    if (order.status === "released") order.status = "in_progress";
    audit(d, ctx, "ปิดงาน (ไม่รายงานยอดเพิ่ม)", `${job.id} ${job.itemCode} — ${note}`);
    return job.id;
  }
  // พักงานต้องมีเหตุผล (ตรงกับ private.bom_save_jobs ของ 20261128010000): เก็บเป็นรายการรายงานยอด 0 ของงาน (เครื่องหมาย kind = hold) ประวัติของงานจึงเห็นเหตุผล
  // เหตุผลการพักล่าสุดของงานที่ยังพักอยู่ → { reason, by, at } · อื่นๆ = null
  const jobHoldNote = (job) => {
    if (job?.status !== "hold" || !Array.isArray(job.reports)) return null;
    const last = [...job.reports].reverse().find((entry) => entry?.kind === "hold");
    return last && String(last.note ?? "").trim() ? { reason: String(last.note).trim(), by: last.by ?? "", at: last.at } : null;
  };
  function setJobStatus(d, { jobId, status, reason }, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, jobId);
    if (isPartJob(job)) fail("งานของซื้อ (ST) เปลี่ยนสถานะเองไม่ได้ ใช้ปุ่ม “เบิกจ่ายของซื้อ” ที่ใบสั่งผลิต");
    if (status === "done") return closeJob(d, job, reason, ctx, user);
    if (!canWorkJob(user, job)) fail(`เปลี่ยนสถานะได้โดยแผนก ${job.dept} หรือผู้จัดการ`);
    if (!["queued", "in_progress", "hold"].includes(status)) fail("สถานะไม่ถูกต้อง");
    if (job.status === "done") fail("งานที่เสร็จแล้วเปลี่ยนสถานะไม่ได้");
    if (!["released", "in_progress"].includes(orderById(d, job.orderId).status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    // งาน GR ที่มีผลรายวันแล้ว (รวมผลที่ยกเลิก) คืนคิวไม่ได้ · ตรงกับ trigger bom_jobs_gr_guard ของ 20261216010000
    if (status === "queued" && job.status !== "queued" && hasGrRecords(d, job)) fail("งานนี้มีผลรายวันของ GR แล้ว คืนคิวไม่ได้ (พักงานแทนได้)");
    let note = "";
    if (status === "hold" && job.status !== "hold") {
      note = typeof reason === "string" ? reason.trim() : "";
      if (note.length < JOB_CLOSE_MIN) fail(`กรุณาระบุเหตุผลที่พักงาน (อย่างน้อย ${JOB_CLOSE_MIN} ตัวอักษร)`);
      if (note.length > JOB_CLOSE_MAX) fail(`เหตุผลยาวเกิน ${JOB_CLOSE_MAX} ตัวอักษร`);
      job.reports.push({ at: ctx.now, by: user.name, good: 0, reject: 0, note, kind: "hold" });
    }
    job.status = status;
    audit(d, ctx, "เปลี่ยนสถานะงาน", `${job.id} → ${status}${note ? ` — ${note}` : ""}`);
    return job.id;
  }

  // ---------- สต็อกของซื้อ (หน้า "คลังของซื้อ") ----------
  // หนึ่งแถวต่อรหัสของซื้อ { itemCode, qty, safetyQty, countedAt, countedBy, updatedAt } + ประวัติ stockMoves { id, itemCode, kind: count|receive|issue|return, qty (มีเครื่องหมาย), balance, ref, at, by, note (เหตุผลของการคืน | null) }
  // โหมดฐานข้อมูล: ประวัติและการหักสต็อกตอนเบิกจ่ายเป็นของเซิร์ฟเวอร์ (client ส่งเฉพาะแถว stock ของ countPartStock) ฝั่งนี้คำนวณไว้แสดงทันทีแล้วใช้ค่าจากเซิร์ฟเวอร์ทับ
  const qtyRound = (n) => Math.round(n * 1e4) / 1e4;
  const stockRowOf = (d, code) => (d.stock ?? []).find((row) => row.itemCode === code) ?? null;
  function pushMove(d, ctx, itemCode, kind, qty, balance, ref, note = null) {
    d.stockMoves ??= [];
    if (ctx.remote) return; // โหมดฐานข้อมูล: ประวัติเซิร์ฟเวอร์เขียนเอง มากับคำตอบของการบันทึก
    d.stockMoves.push({ id: `local-${ctx.now}-${d.stockMoves.length + 1}`, itemCode, kind, qty, balance, ref: ref ?? null, at: ctx.now, by: ctx.user?.name ?? "", note });
  }
  const filled = (value) => String(value ?? "").trim() !== "";
  // counts: [{ itemCode, qty?, safetyQty? }] ช่องที่เว้นว่างไม่แตะค่าเดิม · ยอดที่เปลี่ยนต้องเป็นคลัง (ST/WH) ฝ่ายวางแผน หรือผู้จัดการ · สต็อกขั้นต่ำต้องเป็นฝ่ายวางแผนหรือผู้จัดการ · ทั้งชุดผ่านหรือไม่ผ่านพร้อมกัน
  function countPartStock(d, { counts }, ctx) {
    const user = requireUser(ctx);
    d.stock ??= [];
    const list = (Array.isArray(counts) ? counts : []).filter((entry) => filled(entry?.qty) || filled(entry?.safetyQty));
    if (!list.length) fail("ยังไม่ได้กรอกยอดที่นับ");
    const seen = new Set();
    let changed = 0;
    for (const entry of list) {
      const code = rules().canonicalCode(entry.itemCode);
      if (seen.has(code)) fail(`${code} ซ้ำในรายการ`);
      seen.add(code);
      const item = itemOf(d, code) ?? fail(`ไม่พบชิ้นงาน${ref(code)}`);
      if (item.kind !== "PURCHASED") fail(`${code} ไม่ใช่ของซื้อ (นับได้เฉพาะของซื้อ)`);
      const row = stockRowOf(d, code);
      const oldQty = row?.qty ?? 0;
      const oldSafety = row?.safetyQty ?? 0;
      const qty = filled(entry.qty) ? qtyRound(num(entry.qty, "ยอดที่นับ", { allowZero: true })) : oldQty;
      const safety = filled(entry.safetyQty) ? qtyRound(num(entry.safetyQty, "สต็อกขั้นต่ำ", { allowZero: true })) : oldSafety;
      if (qty > 1e9 || safety > 1e9) fail("ตัวเลขใหญ่เกินไป");
      if (qty === oldQty && safety === oldSafety) continue;
      if (qty !== oldQty && !canCount(user)) fail("นับสต็อกของซื้อได้โดยคลัง (ST/WH) ฝ่ายวางแผน หรือผู้จัดการ");
      if (safety !== oldSafety && !canSetSafety(user)) fail("ตั้งสต็อกขั้นต่ำได้โดยฝ่ายวางแผน ผู้จัดการ หรือคลังวัตถุดิบ (ST)");
      const target = row ?? { itemCode: code, qty: 0, safetyQty: 0, countedAt: null, countedBy: "", updatedAt: ctx.now };
      if (!row) d.stock.push(target);
      target.qty = qty;
      target.safetyQty = safety;
      target.updatedAt = ctx.now;
      if (qty !== oldQty) {
        target.countedAt = ctx.now;
        target.countedBy = user.name;
        pushMove(d, ctx, code, "count", qtyRound(qty - oldQty), qty, null);
        audit(d, ctx, "นับสต็อกของซื้อ", `${code} ${oldQty} → ${qty}`);
      }
      if (safety !== oldSafety) audit(d, ctx, "ตั้งสต็อกขั้นต่ำของซื้อ", `${code} ${oldSafety} → ${safety}`);
      changed += 1;
    }
    return { changed, summary: changed ? `${changed} รายการ` : "0 รายการ (ยอดเท่าเดิมทั้งหมด)" };
  }

  // แผนเบิกจ่ายของซื้อของใบ: งานของซื้อที่ยังเบิกไม่ครบ (queued / in_progress) หนึ่งบรรทัดต่องาน · remaining = ส่วนที่ยังต้องเบิก (แผน - เบิกแล้ว) เป็นค่าเริ่มของจำนวนที่เบิก
  // issued = เบิกไปแล้ว · onHand = คงเหลือในสต็อก · short = ส่วนที่ remaining เกินคงเหลือ (บรรทัดนี้เบิกเต็มส่วนที่เหลือไม่ได้ แต่เบิกเท่าที่มีได้) · ใช้ทั้งใน action และหน้าต่างเบิกจ่าย
  function partIssuePlan(d, orderId) {
    const lines = d.jobs.filter((job) => job.orderId === orderId && isPartJob(job) && job.status !== "done").sort((a, b) => a.itemCode.localeCompare(b.itemCode))
      .map((job) => {
        const issued = qtyRound(Number(job.qtyDone) || 0);
        const remaining = Math.max(0, qtyRound(Number(job.qtyPlanned) - issued));
        const onHand = stockRowOf(d, job.itemCode)?.qty ?? 0;
        return { job, itemCode: job.itemCode, name: job.name, uom: job.uom, planned: Number(job.qtyPlanned), issued, remaining, onHand, short: Math.max(0, qtyRound(remaining - onHand)) };
      });
    return { lines, short: lines.filter((line) => line.short > 0), anyShort: lines.some((line) => line.short > 0) };
  }
  // เบิกจ่ายของซื้อของใบ PI: lines [{ itemCode, qty }] = บรรทัดที่เลือกและจำนวนที่เบิกครั้งนี้ (> 0 ไม่เกินคงเหลือ · เกินส่วนที่ยังต้องเบิกได้)
  // ไม่ส่ง lines = ทุกบรรทัดที่ยังเปิดเต็มส่วนที่เหลือ (แบบเดิม) · ยอดสะสมถึงแผน = งาน done ไม่ถึง = in_progress (เบิกส่วนที่เหลือครั้งหน้าได้) · บรรทัดที่ไม่ได้เลือกไม่ถูกแตะ
  // ทั้งชุดผ่านหรือไม่ผ่านพร้อมกัน: บรรทัดใดเกินสต็อก = ไม่จ่ายอะไรเลย (บอกที่ขาด) · หักสต็อกและเขียนประวัติ issue ตามที่เบิกจริง (โหมดฐานข้อมูล: เซิร์ฟเวอร์ทำเองจากแถวงาน)
  function issueOrderParts(d, { orderId, lines }, ctx) {
    const user = requireUser(ctx);
    if (!canIssueParts(user)) fail("เบิกจ่ายของซื้อได้โดยคลังวัตถุดิบ (ST) ฝ่ายวางแผน หรือผู้จัดการ");
    const order = orderById(d, orderId);
    if (!["released", "in_progress"].includes(order.status)) fail("เบิกจ่ายของซื้อได้เฉพาะใบที่ปล่อยผลิตแล้ว");
    d.stock ??= [];
    const plan = partIssuePlan(d, order.id);
    if (!plan.lines.length) fail("ใบนี้ไม่มีของซื้อที่ต้องเบิกจ่าย (เบิกจ่ายครบแล้ว หรือปล่อยผลิตก่อนมีงานของซื้อ)");
    const picks = lines === undefined ? plan.lines.map((line) => ({ itemCode: line.itemCode, qty: line.remaining })) : Array.isArray(lines) ? lines : [];
    if (!picks.length) fail("เลือกรายการที่จะเบิกอย่างน้อยหนึ่งรายการ");
    if (picks.length > 500) fail("เบิกได้ไม่เกิน 500 รายการต่อครั้ง");
    const open = new Map(plan.lines.map((line) => [line.itemCode, line]));
    const seen = new Set();
    const issue = picks.map((entry) => {
      const code = rules().canonicalCode(entry?.itemCode);
      if (seen.has(code)) fail(`${code} ซ้ำในรายการ`);
      seen.add(code);
      const line = open.get(code) ?? fail(`${code} ไม่มีของซื้อที่ต้องเบิกในใบนี้ (เบิกครบแล้ว หรือไม่ใช่ของซื้อของใบนี้)`);
      const qty = qtyRound(num(entry.qty, `จำนวนที่เบิก ${code} `));
      if (!(qty > 0)) fail(`จำนวนที่เบิก ${code} ต้องมากกว่า 0`); // เล็กกว่าทศนิยม 4 ตำแหน่ง
      if (qty > 1e9) fail("ตัวเลขใหญ่เกินไป");
      return { line, qty };
    }).sort((a, b) => (a.line.itemCode < b.line.itemCode ? -1 : a.line.itemCode > b.line.itemCode ? 1 : 0));
    const short = issue.filter(({ line, qty }) => qty > line.onHand);
    if (short.length) fail(`สต็อกของซื้อไม่พอ จึงไม่ได้เบิกจ่ายอะไรเลย: ${short.map(({ line, qty }) => `${line.itemCode} ขาด ${qtyRound(qty - line.onHand)} ${rules().uomLabel(line.uom)}`).join(", ")}`);
    for (const { line, qty } of issue) {
      const row = stockRowOf(d, line.itemCode);
      row.qty = qtyRound(row.qty - qty);
      row.updatedAt = ctx.now;
      pushMove(d, ctx, line.itemCode, "issue", -qty, row.qty, order.id);
      const total = qtyRound(line.issued + qty);
      line.job.qtyDone = total;
      if (total >= Number(line.job.qtyPlanned)) {
        line.job.status = "done";
        line.job.doneAt = ctx.now;
      } else line.job.status = "in_progress";
    }
    // โหมดฐานข้อมูล: ใบ released -> in_progress เป็นของเซิร์ฟเวอร์ (กติกางานเริ่ม) ไม่ส่งเป็นการแก้ใบ
    if (!ctx.remote && order.status === "released") order.status = "in_progress";
    audit(d, ctx, "เบิกจ่ายของซื้อ", `${order.id} ${issue.length} รายการ`);
    return { issued: issue.length, summary: `${issue.length} รายการ` };
  }

  // ---------- คืนของซื้อเข้าสต็อก ----------
  // ผู้ทำ = คนเดียวกับที่เบิกจ่ายได้ (ST / ฝ่ายวางแผน / ผู้จัดการ) · ต้องระบุเหตุผล (เก็บในประวัติสต็อก) · ผลคืนค่า request = แถว partReturns ที่โหมดฐานข้อมูลส่งไปให้เซิร์ฟเวอร์คำนวณเอง (ไม่ส่งสำเนาที่คำนวณในเครื่อง)
  // ยอดที่คืนได้ต่อรายการ = ยอดเบิกจ่าย - ยอดที่คืนไปแล้วตั้งแต่การเบิกจ่ายล่าสุด (rules.partReturnLines)
  const returnReason = (value) => text(value, "เหตุผล", 200);
  function addReturn(d, ctx, order, itemCode, qty, reason) {
    let row = stockRowOf(d, itemCode);
    if (!row) { row = { itemCode, qty: 0, safetyQty: 0, countedAt: null, countedBy: "", updatedAt: ctx.now }; d.stock.push(row); }
    row.qty = qtyRound(row.qty + qty);
    row.updatedAt = ctx.now;
    pushMove(d, ctx, itemCode, "return", qty, row.qty, order.id, reason);
  }
  // ยกเลิกการเบิกจ่ายของซื้อทั้งใบ: ของที่เบิกจ่ายแล้วคืนสต็อก (ส่วนที่ยังไม่เคยคืนเป็นของเหลือ) งานของซื้อกลับไปรอเบิกจ่าย ใบไม่เปลี่ยนสถานะ
  function undoOrderParts(d, { orderId, reason }, ctx) {
    const user = requireUser(ctx);
    if (!canIssueParts(user)) fail("ยกเลิกการเบิกจ่ายของซื้อได้โดยคลังวัตถุดิบ (ST) ฝ่ายวางแผน หรือผู้จัดการ");
    const why = returnReason(reason);
    const order = orderById(d, orderId);
    if (!["released", "in_progress"].includes(order.status)) fail("ยกเลิกการเบิกจ่ายได้เฉพาะใบที่ปล่อยผลิตแล้วและยังไม่ปิด");
    d.stock ??= [];
    const lines = rules().partReturnLines(d, order.id);
    if (!lines.length) fail("ใบนี้ยังไม่ได้เบิกจ่ายของซื้อ");
    let moves = 0;
    for (const line of lines) {
      if (line.returnable > 0) { addReturn(d, ctx, order, line.itemCode, line.returnable, why); moves += 1; }
    }
    // งานที่เบิกแล้ว (ครบ หรือบางส่วน: qtyDone > 0) กลับไปรอเบิก · ตรงกับ private.bom_return_parts ของ 20261123020000
    for (const job of d.jobs) {
      if (job.orderId !== order.id || !isPartJob(job) || !(job.status === "done" || Number(job.qtyDone) > 0)) continue;
      job.status = "queued";
      job.qtyDone = 0;
      delete job.doneAt;
    }
    audit(d, ctx, "ยกเลิกการเบิกจ่ายของซื้อ", `${order.id} ${lines.length} รายการ · ${why}`);
    return { returned: moves, summary: `${lines.length} รายการ`, request: { orderId: order.id, mode: "undo", reason: why } };
  }
  // คืนของเหลือ: lines [{ itemCode, qty }] คืนรายการละจำนวนที่พิมพ์ (ไม่เกินที่คืนได้ ซึ่งรวมยอดที่เบิกเกินแผน) งานยังเป็น done ใบยังนับว่าเบิกจ่ายแล้ว · ทั้งชุดผ่านหรือไม่ผ่านพร้อมกัน
  // บรรทัดที่ยังเบิกไม่ครบของใบที่ยังเปิด (partial) คืนของเหลือไม่ได้: เบิกส่วนที่เหลือให้ครบก่อน หรือยกเลิกการเบิกจ่าย
  // ใบที่ปิดแล้ว (completed) คืนของเหลือของบรรทัดที่เบิกไม่ครบได้ ไม่เกินที่เบิกไปแล้ว - ที่คืนไปแล้ว (rules.partReturnLines · ตรงกับ private.bom_return_parts)
  function returnOrderParts(d, { orderId, lines, reason }, ctx) {
    const user = requireUser(ctx);
    if (!canIssueParts(user)) fail("คืนของซื้อได้โดยคลังวัตถุดิบ (ST) ฝ่ายวางแผน หรือผู้จัดการ");
    const why = returnReason(reason);
    const order = orderById(d, orderId);
    // ใบที่ยกเลิกแล้วคืนของเหลือได้เหมือนใบที่ปิดแล้ว (ตรงกับ private.bom_return_parts ของ 20261128010000)
    if (!["released", "in_progress", "completed", "cancelled"].includes(order.status)) fail("คืนของเหลือได้เฉพาะใบที่ปล่อยผลิตแล้ว");
    d.stock ??= [];
    const issued = new Map(rules().partReturnLines(d, order.id).map((line) => [line.itemCode, line]));
    const entries = (Array.isArray(lines) ? lines : []).filter((entry) => filled(entry?.qty));
    if (!entries.length) fail("ยังไม่ได้กรอกจำนวนที่คืน");
    if (entries.length > 100) fail("คืนได้ไม่เกิน 100 รายการต่อครั้ง");
    const seen = new Set();
    const plan = entries.map((entry) => {
      const code = rules().canonicalCode(entry.itemCode);
      if (seen.has(code)) fail(`${code} ซ้ำในรายการ`);
      seen.add(code);
      const line = issued.get(code) ?? fail(`${code} ไม่ได้เบิกจ่ายให้ใบนี้`);
      if (line.partial) fail(`${code} ยังเบิกไม่ครบ คืนของเหลือได้เมื่อเบิกครบแล้ว (หรือกด “ยกเลิกการเบิกจ่าย” เพื่อคืนทั้งหมด)`);
      const qty = qtyRound(num(entry.qty, "จำนวนที่คืน"));
      if (qty > 1e9) fail("ตัวเลขใหญ่เกินไป");
      if (qty > line.returnable) fail(`${code} คืนได้อีกไม่เกิน ${rules().fmtQty(line.returnable)} (เบิกจ่าย ${rules().fmtQty(line.issued)} คืนไปแล้ว ${rules().fmtQty(line.returned)})`);
      return { code, qty };
    }).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    for (const { code, qty } of plan) addReturn(d, ctx, order, code, qty, why);
    audit(d, ctx, "คืนของเหลือของซื้อ", `${order.id} ${plan.length} รายการ · ${why}`);
    return { returned: plan.length, summary: `${plan.length} รายการ`, request: { orderId: order.id, mode: "leftover", reason: why, lines: plan.map(({ code, qty }) => ({ itemCode: code, qty })) } };
  }

  // ---------- คลังแท่งยาว SR (ขั้น 05–06 · 20261202010000_bom_sr_rod_store.sql) ----------
  // ล็อตแท่ง (rodLots) เกิดเมื่อล็อตตกแต่งของ WO ที่ผูกงาน RB ผ่าน QC ใน RubberFlow (เซิร์ฟเวอร์สร้าง · โหมดในเครื่องไม่มี) · ประวัติแท่ง (rodMoves) เซิร์ฟเวอร์เขียน
  // ผู้ทำ: รับเข้า / รับนอกใบสั่ง / ย้ายตำแหน่ง / จ่ายให้ GR / ย้อนการจ่าย / ปรับยอดสต็อกกลาง = แผนก SR หรือกลุ่มวางแผน · ตัดสินล็อตที่กัก = แผนก QA หรือกลุ่มวางแผน
  // (ปรับยอด: SR ทำได้ตั้งแต่ 20261204010000_bom_sr_store_module.sql เดิมกลุ่มวางแผนเท่านั้น)
  // โหมดฐานข้อมูลคืน request = แถวคำขอที่ store ส่งในส่วน rodLots / rodMoves (section) · โหมดในเครื่องเขียนผล (ล็อต ประวัติ งาน) เอง
  const canStoreRods = (user) => canPlan(user) || user?.dept === "SR";
  // เห็นล็อตที่กักรอตัดสิน (การ์ดงานของ QA): แผนก QA ทุกตำแหน่งหรือกลุ่มวางแผน · ตัดสินจริง (ปุ่มและคำสั่ง decideRods) = หัวหน้า QA หรือผู้จัดการโรงงาน/ผู้ดูแลระบบเท่านั้น (เจ้าของสั่ง 2026-11-24 · ฐานข้อมูล BOM_QA_HEAD_ONLY)
  // นิยามเดียวกับการปล่อยล็อตของ RubberFlow: rules.canQaRelease (modules/rubberflow-rules.js) · ไม่มีกฎ (ไม่ได้โหลด RubberFlow) = ตัดสินไม่ได้
  const canSeeRodHolds = (user) => canPlan(user) || user?.dept === "QA";
  const canDecideRods = (user) => Boolean(root.MNP_RUBBERFLOW_RULES?.canQaRelease?.(user));
  const canAdjustRods = (user) => canStoreRods(user);
  const ROD_NOTE_MAX = 300;
  const ROD_REASON_MIN = 3;
  const ROD_MAX_ROWS = 50;
  // รหัสของแถวคำขอ (uuid: คอลัมน์ id ของ bom_rod_lots / bom_rod_moves) · ใช้ crypto.randomUUID ถ้ามี
  function newUuid() {
    try { if (typeof root.crypto?.randomUUID === "function") return root.crypto.randomUUID(); } catch { /* ใช้ทางสำรองด้านล่าง */ }
    const bytes = new Uint8Array(16);
    try { root.crypto.getRandomValues(bytes); } catch { for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256); }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const rodLotOf = (d, id) => (d.rodLots ?? []).find((lot) => lot.id === String(id ?? "").trim()) ?? fail("ไม่พบล็อตยางเส้นยาวนี้ (อาจมีผู้อื่นทำรายการไปก่อน)");
  const rodNote = (value, label, { required = false } = {}) => {
    const note = value === undefined || value === null ? "" : typeof value === "string" ? value.trim() : fail(`${label}ต้องเป็นข้อความ`);
    if (note.length > ROD_NOTE_MAX) fail(`${label}ยาวเกิน ${ROD_NOTE_MAX} ตัวอักษร`);
    if (required && note.length < ROD_REASON_MIN) fail(`กรุณาระบุ${label} (อย่างน้อย ${ROD_REASON_MIN} ตัวอักษร)`);
    return note;
  };
  const lotText = (lot) => `ล็อต ${lot.lotNo}`;
  // ตำแหน่งจัดเก็บ (จำเป็น) ที่ SR พิมพ์เอง เช่น A-01: ข้อความ 1-40 ตัวอักษรหลังตัดช่องว่าง (ตรงกับ bom_text ของ 20261204010000)
  const rodLocation = (value) => {
    const location = value === undefined || value === null ? "" : typeof value === "string" ? value.trim() : fail("ตำแหน่งจัดเก็บต้องเป็นข้อความ");
    if (!location) fail("กรุณาระบุตำแหน่งจัดเก็บ (เช่น A-01)");
    if (location.length > rules().ROD_LOCATION_MAX) fail(`ตำแหน่งจัดเก็บยาวเกิน ${rules().ROD_LOCATION_MAX} ตัวอักษร`);
    return location;
  };
  // โหมดในเครื่อง: เขียนแถวประวัติแท่ง (โหมดฐานข้อมูลเซิร์ฟเวอร์เขียน มากับคำตอบของการบันทึก)
  function pushRodMove(d, ctx, row) {
    d.rodMoves ??= [];
    if (ctx.remote) return;
    d.rodMoves.push({ id: row.id ?? newUuid(), lotId: row.lotId, itemCode: row.itemCode, kind: row.kind, qty: qtyRound(row.qty), ownerOrderId: row.ownerOrderId ?? null, forOrderId: row.forOrderId ?? null, reversesId: row.reversesId ?? null, note: row.note ?? "", at: ctx.now, by: ctx.user?.name ?? "" });
  }
  // รับแท่งเข้าคลังที่ผ่าน (รับผ่าน หรือ QA ให้ใช้): ถ้าใบยังผลิตอยู่และงาน RB ยังไม่เสร็จ แท่งเท่าที่งานยังขาด (แผน − ทำแล้ว) เป็นของใบ ส่วนเกินเป็นสต็อกกลาง
  // งาน RB นับยอดทั้งหมดที่รับ (รายงานยอดดีแบบเดียวกับ rf_apply_feedback) · ใบปิด / ยกเลิก / ร่าง หรืองานเสร็จแล้ว = เข้าสต็อกกลางทั้งหมด งานไม่เปลี่ยน
  // โหมดฐานข้อมูลเซิร์ฟเวอร์ทำเองในธุรกรรมเดียวกัน ฝั่งนี้ปรับงานและใบล่วงหน้าให้หน้าแสดงทันที (ประวัติแท่งมากับคำตอบ)
  function creditRods(d, lot, qty, ctx) {
    const order = d.orders.find((entry) => entry.id === lot.orderId) ?? null;
    const job = d.jobs.find((entry) => entry.id === lot.jobNo && entry.orderId === lot.orderId) ?? null;
    const q = qtyRound(qty);
    if (order && ["released", "in_progress"].includes(order.status) && job && job.status !== "done") {
      const need = Math.max(0, qtyRound(Number(job.qtyPlanned) - Number(job.qtyDone || 0)));
      const owned = qtyRound(Math.min(q, need));
      const extra = qtyRound(q - owned);
      if (owned > 0) pushRodMove(d, ctx, { lotId: lot.id, itemCode: lot.itemCode, kind: "receive", qty: owned, ownerOrderId: order.id });
      if (extra > 0) pushRodMove(d, ctx, { lotId: lot.id, itemCode: lot.itemCode, kind: "receive", qty: extra, ownerOrderId: null });
      job.reports = [...(job.reports ?? []), { at: ctx.now, by: ctx.user?.name ?? "", good: q, reject: 0, note: `รับเข้าคลัง SR ผ่านตรวจ ${lotText(lot)}${extra > 0 ? ` · เกิน ${rules().fmtQty(extra)} เข้าสต็อกกลาง` : ""}` }];
      job.qtyDone = qtyRound(Number(job.qtyDone || 0) + q);
      job.status = job.qtyDone + 1e-9 >= Number(job.qtyPlanned) ? "done" : "in_progress";
      if (job.status === "done") job.doneAt = job.doneAt ?? ctx.now;
      if (order.status === "released") order.status = "in_progress";
      return { owned, extra, job };
    }
    pushRodMove(d, ctx, { lotId: lot.id, itemCode: lot.itemCode, kind: "receive", qty: q, ownerOrderId: null });
    return { owned: 0, extra: q, job: null };
  }
  // ค่าที่วัดตอนรับเข้า: ตัวเลข > 0 เฉพาะคีย์ ความหนา / ความกว้าง / น้ำหนักต่อเมตร (ช่องว่าง = ไม่ได้วัด)
  function rodValues(raw) {
    const out = {};
    if (raw === undefined || raw === null) return out;
    if (typeof raw !== "object" || Array.isArray(raw)) fail("ค่าที่วัดไม่ถูกต้อง");
    for (const [key, value] of Object.entries(raw)) {
      if (!rules().ROD_SPEC_KEYS.includes(key)) fail("ค่าที่วัดไม่ถูกต้อง");
      if (value === undefined || value === null || String(value).trim() === "") continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) fail(`${rules().ROD_SPEC_LABEL[key].label}ต้องเป็นตัวเลขมากกว่า 0`);
      if (n > 1e9) fail("ตัวเลขใหญ่เกินไป");
      out[key] = n;
    }
    return out;
  }
  // SR รับแท่งเข้าคลังและบันทึกผลตรวจขนาด: { lotId, qtyReceived, values, result?, note?, location } · ล็อตต้องรอรับ (pending) · ตำแหน่งจัดเก็บจำเป็น (20261204010000)
  // มีสเปก = ต้องกรอกทุกค่าของสเปก ผลคำนวณจากสเปก (ส่ง result ต่างจากที่คำนวณได้ = ปฏิเสธ) · ไม่มีสเปก = SR เลือกผ่าน / ไม่ผ่านเอง (จำเป็น)
  // ผ่าน = เข้าคลัง (stored) แล้วนับเข้างาน RB · ไม่ผ่าน = กัก (held) ต้องมีหมายเหตุ ไม่นับยอด รอ QA ตัดสิน
  function receiveRods(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const lot = rodLotOf(d, p?.lotId);
    if (!canStoreRods(user)) fail("รับยางเส้นยาวเข้าคลังได้โดยคลังยางเส้นยาว (SR) หรือฝ่ายวางแผนเท่านั้น");
    if (lot.status !== "pending") fail(`${lotText(lot)} ${R.ROD_STATUS_LABEL[lot.status] ?? lot.status}แล้ว รับซ้ำไม่ได้`);
    const qty = qtyRound(num(p?.qtyReceived, "จำนวนที่รับ"));
    if (qty <= 0) fail("จำนวนที่รับต้องมากกว่า 0");
    if (qty > Number(lot.qtySent) + 1e-9) fail(`จำนวนที่รับต้องไม่เกินที่ส่งมา ${R.fmtQty(lot.qtySent)}`);
    const values = rodValues(p?.values);
    const verdict = R.qcVerdict(lot.spec, values);
    let result;
    if (verdict.rows.length) {
      if (verdict.missing.length) fail(`กรอกค่าที่วัดให้ครบ: ${verdict.missing.map((key) => R.ROD_SPEC_LABEL[key].label).join(", ")}`);
      result = verdict.result;
      if (p?.result !== undefined && p?.result !== null && p.result !== "" && p.result !== result) fail(`ผลตรวจไม่ตรงกับค่าที่วัด (ตามสเปกคือ${result === "pass" ? "ผ่าน" : "ไม่ผ่าน"})`);
    } else {
      result = p?.result;
      if (!["pass", "fail"].includes(result)) fail("เลือกผลตรวจ ผ่าน หรือ ไม่ผ่าน (ล็อตนี้ไม่มีสเปกขนาด)");
    }
    const note = rodNote(p?.note, result === "fail" ? "หมายเหตุว่าไม่ผ่านเพราะอะไร" : "หมายเหตุ", { required: result === "fail" });
    const location = rodLocation(p?.location);
    const qc = { values, result, note };
    Object.assign(lot, { qtyReceived: qty, qc, receivedBy: user.name, receivedAt: ctx.now, location, status: result === "pass" ? "stored" : "held" });
    const credit = result === "pass" ? creditRods(d, lot, qty, ctx) : null;
    audit(d, ctx, result === "pass" ? "รับยางเส้นยาวเข้าคลัง SR" : "รับยางเส้นยาวเข้าคลัง SR (ไม่ผ่าน กักรอ QA)", `${lotText(lot)} ${lot.itemCode} × ${R.fmtQty(qty)} · ใบ ${lot.orderId}${credit?.extra > 0 && credit.job ? ` · เกิน ${R.fmtQty(credit.extra)} เข้าสต็อกกลาง` : ""}${note ? ` — ${note}` : ""}`);
    return { status: lot.status, summary: `${lotText(lot)} × ${R.fmtQty(qty)}`, section: "rodLots", request: [{ id: lot.id, qtyReceived: qty, location, qc: { values, result, note } }] };
  }
  // SR (หรือฝ่ายวางแผน) รับยางเส้นยาวที่ไม่ได้มาจากใบสั่งผลิตเข้าเป็นสต็อกกลาง: { lotNo, itemCode, qty, location, note }
  // เลขล็อต 1-40 ตัวพิมพ์ใหญ่ ไม่ซ้ำ ห้ามขึ้นต้น FN- · รหัสต้องเป็นเส้นยาง (RB) ในทะเบียน · ที่มา / เหตุผล 3-300 จำเป็น · ล็อตอยู่ในคลังทันที (ไม่มีผลตรวจขนาด) พร้อมแถวรับเข้าสต็อกกลาง
  function receiveRodsOpening(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    if (!canStoreRods(user)) fail("รับยางเส้นยาวนอกใบสั่งได้โดยคลังยางเส้นยาว (SR) หรือฝ่ายวางแผนเท่านั้น");
    const lotNo = String(p?.lotNo ?? "").trim().toUpperCase();
    if (!lotNo) fail("กรุณาระบุเลขล็อต");
    if (lotNo.length > R.ROD_LOT_NO_MAX) fail(`เลขล็อตยาวเกิน ${R.ROD_LOT_NO_MAX} ตัวอักษร`);
    if (lotNo.startsWith(R.ROD_RESERVED_LOT_PREFIX)) fail(`เลขล็อตที่ขึ้นต้นด้วย ${R.ROD_RESERVED_LOT_PREFIX} เป็นของล็อตตกแต่งใน RubberFlow ใช้เลขอื่น`);
    if ((d.rodLots ?? []).some((lot) => String(lot.lotNo ?? "").toUpperCase() === lotNo)) fail(`ล็อต ${lotNo} มีอยู่แล้ว ใช้เลขล็อตอื่น`);
    const item = itemOf(d, p?.itemCode) ?? fail(`ไม่พบรหัส${ref(p?.itemCode)}`);
    if (item.kind !== "RB") fail(`${item.code} ไม่ใช่เส้นยาง (RB)`);
    const qty = qtyRound(num(p?.qty, "จำนวนที่รับ"));
    if (qty <= 0) fail("จำนวนที่รับต้องมากกว่า 0");
    if (qty > 1e9) fail("ตัวเลขใหญ่เกินไป");
    const location = rodLocation(p?.location);
    const note = rodNote(p?.note, "ที่มาหรือเหตุผลที่รับเข้า", { required: true });
    const id = newUuid();
    d.rodLots ??= [];
    const lot = { id, lotNo, itemCode: item.code, orderId: null, jobNo: null, woNo: null, recipeCode: null, uom: item.uom, qtySent: qty, spec: null, status: "stored", qtyReceived: qty, qc: null,
      receivedBy: user.name, receivedAt: ctx.now, decision: null, decisionNote: null, decidedBy: null, decidedAt: null, createdAt: ctx.now, location, source: "opening", sourceNote: note };
    d.rodLots.push(lot);
    pushRodMove(d, ctx, { lotId: id, itemCode: item.code, kind: "receive", qty, ownerOrderId: null, note });
    audit(d, ctx, "รับยางเส้นยาวนอกใบสั่ง", `${lotText(lot)} ${item.code} × ${R.fmtQty(qty)} ที่ ${location} — ${note}`);
    return { id, summary: `${lotText(lot)} × ${R.fmtQty(qty)}`, section: "rodLots", request: [{ id, lotNo, itemCode: item.code, qty, location, note }] };
  }
  // ย้ายตำแหน่งจัดเก็บของล็อต: { lotId, location } · ล็อตที่อยู่ในคลัง (stored) หรือกักรอ QA (held) เท่านั้น · แก้เฉพาะตำแหน่ง ไม่มีแถวประวัติสต็อก
  function setRodLocation(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    if (!canStoreRods(user)) fail("ย้ายตำแหน่งยางเส้นยาวได้โดยคลังยางเส้นยาว (SR) หรือฝ่ายวางแผนเท่านั้น");
    const lot = rodLotOf(d, p?.lotId);
    if (!["held", "stored"].includes(lot.status)) fail(`${lotText(lot)} ไม่ได้อยู่ในคลัง (${R.ROD_STATUS_LABEL[lot.status] ?? lot.status}) ย้ายตำแหน่งไม่ได้`);
    const location = rodLocation(p?.location);
    const before = String(lot.location ?? "");
    lot.location = location;
    audit(d, ctx, "ย้ายตำแหน่งยางเส้นยาว", `${lotText(lot)} ${lot.itemCode} ${before || "-"} → ${location}`);
    return { summary: `${lotText(lot)} → ${location}`, section: "rodLots", request: [{ id: lot.id, location }] };
  }
  // QA ตัดสินล็อตที่กัก: { lotId, decision: accept | return | scrap, note } เหตุผล 3-300 · ให้ใช้ = เข้าคลังและนับเข้างาน RB ด้วยยอดที่ SR รับ · คืน RB / ทิ้ง = ไม่มีแท่งเข้าคลัง
  function decideRods(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const lot = rodLotOf(d, p?.lotId);
    if (!canDecideRods(user)) fail("ตัดสินล็อตที่กักได้เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ");
    if (lot.status !== "held") fail(`${lotText(lot)} ไม่ได้กักรออยู่ (${R.ROD_STATUS_LABEL[lot.status] ?? lot.status})`);
    const decision = String(p?.decision ?? "");
    if (!Object.hasOwn(R.ROD_DECISION_LABEL, decision)) fail("เลือกผลตัดสิน: ใช้ได้ตามสภาพ คืน RB แก้ไข หรือทิ้ง");
    const note = rodNote(p?.note, "เหตุผล", { required: true });
    Object.assign(lot, { decision, decisionNote: note, decidedBy: user.name, decidedAt: ctx.now, status: decision === "accept" ? "stored" : decision === "return" ? "returned" : "scrapped" });
    if (decision === "accept") creditRods(d, lot, lot.qtyReceived, ctx);
    audit(d, ctx, "ตัดสินล็อตยางเส้นยาวที่กัก", `${lotText(lot)} ${lot.itemCode} → ${R.ROD_DECISION_LABEL[decision]} — ${note}`);
    return { status: lot.status, summary: `${lotText(lot)} ${R.ROD_DECISION_LABEL[decision]}`, section: "rodLots", request: [{ id: lot.id, decision, decisionNote: note }] };
  }
  // SR จ่ายแท่งให้ GR ตามใบ: { orderId, itemCode, qty } · ระบบเลือกล็อตเก่าก่อน (FIFO) จากถังของใบนี้ก่อน แล้วสต็อกกลาง (rules.rodFifo) · ใบต้องปล่อยผลิตอยู่
  // หนึ่งแถว issue ต่อถังที่หยิบ (qty ติดลบ) ไม่เกิน 50 แถว · ทั้งชุดผ่านหรือไม่ผ่านพร้อมกัน
  function issueRods(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const order = orderById(d, String(p?.orderId ?? "").trim().toUpperCase());
    const code = R.canonicalCode(p?.itemCode);
    if (!canStoreRods(user)) fail("จ่ายยางเส้นยาวได้โดยคลังยางเส้นยาว (SR) หรือฝ่ายวางแผนเท่านั้น");
    if (!["released", "in_progress"].includes(order.status)) fail("จ่ายยางเส้นยาวได้เฉพาะใบที่ปล่อยผลิตแล้วและยังไม่ปิด");
    if (!R.rodCodesOf(order).has(code)) fail(`${code} ไม่ใช่เส้นยางของใบ ${order.id}`);
    const qty = qtyRound(num(p?.qty, "จำนวนที่จ่าย"));
    if (qty <= 0) fail("จำนวนที่จ่ายต้องมากกว่า 0");
    const plan = R.rodFifo(d, code, qty, { own: order.id });
    if (plan.short > 1e-9) fail(`ยางเส้นยาว ${code} ในคลังไม่พอ: ใบนี้ถือ ${R.fmtQty(R.rodOwned(d, order.id, code))} สต็อกกลาง ${R.fmtQty(R.rodFree(d, code))} จ่าย ${R.fmtQty(qty)} ไม่ได้`);
    if (plan.rows.length > ROD_MAX_ROWS) fail(`จ่ายครั้งเดียวได้ไม่เกิน ${ROD_MAX_ROWS} ล็อต แบ่งจ่ายหลายครั้ง`);
    const rows = plan.rows.map((row) => ({ id: newUuid(), kind: "issue", lotId: row.lotId, ownerOrderId: row.owner, forOrderId: order.id, itemCode: code, qty: -row.qty }));
    for (const row of rows) pushRodMove(d, ctx, row);
    audit(d, ctx, "จ่ายยางเส้นยาวให้ GR", `${order.id} ${code} × ${R.fmtQty(qty)} จาก ${plan.rows.map((row) => `ล็อต ${row.lotNo} ${R.fmtQty(row.qty)}`).join(", ")}`);
    return { summary: `${code} × ${R.fmtQty(qty)}`, plan: plan.rows, section: "rodMoves", request: rows };
  }
  // ย้อนการจ่ายที่บันทึกผิดหนึ่งแถวทั้งแถว: { moveId, note } เหตุผล 3-300 · แถวต้องเป็นการจ่ายที่ยังไม่ถูกย้อน · แท่งกลับเข้าถังเดิม
  function reverseRodIssue(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    if (!canStoreRods(user)) fail("ย้อนการจ่ายยางเส้นยาวได้โดยคลังยางเส้นยาว (SR) หรือฝ่ายวางแผนเท่านั้น");
    const note = rodNote(p?.note, "เหตุผลที่ย้อน", { required: true });
    const move = (d.rodMoves ?? []).find((row) => row.id === String(p?.moveId ?? "").trim() && row.kind === "issue") ?? fail("ไม่พบรายการจ่ายที่จะย้อน");
    if (R.rodReversedIds(d.rodMoves).has(move.id)) fail("รายการนี้ถูกย้อนไปแล้ว");
    const row = { id: newUuid(), kind: "unissue", reversesId: move.id, note };
    pushRodMove(d, ctx, { ...row, lotId: move.lotId, itemCode: move.itemCode, qty: -Number(move.qty), ownerOrderId: move.ownerOrderId, forOrderId: move.forOrderId });
    audit(d, ctx, "ย้อนการจ่ายยางเส้นยาว", `${move.forOrderId} ${move.itemCode} × ${R.fmtQty(-Number(move.qty))} — ${note}`);
    return { summary: `${move.itemCode} × ${R.fmtQty(-Number(move.qty))}`, section: "rodMoves", request: [row] };
  }
  // ปรับยอดสต็อกกลางของล็อต (นับจริงไม่ตรง แท่งชำรุด): { lotId, qty (+/−, ไม่ใช่ 0), note } คลังยางเส้นยาว (SR) หรือกลุ่มวางแผน เหตุผลทุกครั้ง · ยอดสต็อกกลางของล็อตต้องไม่ติดลบ
  function adjustRods(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    if (!canAdjustRods(user)) fail("ปรับยอดยางเส้นยาวในคลังได้โดยคลังยางเส้นยาว (SR) หรือฝ่ายวางแผนเท่านั้น");
    const lot = rodLotOf(d, p?.lotId);
    if (lot.status !== "stored") fail(`${lotText(lot)} ไม่ได้อยู่ในคลัง ปรับยอดไม่ได้`);
    const qty = qtyRound(Number(p?.qty));
    if (!Number.isFinite(qty) || qty === 0) fail("จำนวนที่ปรับต้องเป็นตัวเลขที่ไม่ใช่ 0 (บวก = เพิ่ม ลบ = ลด)");
    if (Math.abs(qty) > 1e9) fail("ตัวเลขใหญ่เกินไป");
    const note = rodNote(p?.note, "เหตุผล", { required: true });
    const free = R.rodBalance(d.rodMoves, lot.id, null);
    if (free + qty < -1e-9) fail(`${lotText(lot)} มีสต็อกกลาง ${R.fmtQty(free)} ลด ${R.fmtQty(-qty)} ไม่ได้`);
    const row = { id: newUuid(), kind: "adjust", lotId: lot.id, qty, note };
    pushRodMove(d, ctx, { ...row, itemCode: lot.itemCode, ownerOrderId: null });
    audit(d, ctx, "ปรับยอดยางเส้นยาวในคลัง", `${lotText(lot)} ${lot.itemCode} ${qty > 0 ? "+" : ""}${R.fmtQty(qty)} — ${note}`);
    return { summary: `${lotText(lot)} ${qty > 0 ? "+" : ""}${R.fmtQty(qty)}`, section: "rodMoves", request: [row] };
  }
  // ใช้จากคลัง SR ตอนปล่อยผลิต: ทุกรหัสเส้นยางที่ stockCounts = n > 0 หยิบ n จากสต็อกกลาง FIFO (ไม่พอ = ปล่อยไม่ได้ ตัวเลขเปลี่ยนแล้ว)
  // คืน [{ itemCode, n, rows }] · โหมดในเครื่องเขียนแถว transfer คู่ (−k ถังต้นทาง +k ถังของใบนี้) · โหมดฐานข้อมูลเซิร์ฟเวอร์ทำเอง
  function rodTaking(d, order) {
    const R = rules();
    const codes = R.rodCodesOf(order);
    const taking = [];
    for (const code of [...codes].sort()) {
      const n = qtyRound(Math.max(0, Number(order.stockCounts?.[code]) || 0));
      if (n <= 0) continue;
      const plan = R.rodFifo(d, code, n);
      if (plan.short > 1e-9) fail(`ตัวเลขเปลี่ยนไปแล้ว: คลังยางเส้นยาว (SR) มี ${code} ว่าง ${R.fmtQty(plan.taken)} ไม่พอที่ใบนี้ตั้งใช้ ${R.fmtQty(n)} (ใบอื่นอาจปล่อยผลิตไปก่อน) กลับไปตั้งยอดใหม่ที่ขั้นตรวจของ`);
      taking.push({ itemCode: code, n, rows: plan.rows });
    }
    return taking;
  }

  // ---------- แปรรูปยาง GR (โรงงาน ขั้น 2 · 20261216010000_bom_gr_module.sql) ----------
  // ตั้งค่า (ขั้นตอน เหตุผลของเสีย เป้า) · ขั้นตอนของงาน · ผลรายวันต่อคน × ขั้น × วัน · ขอเบิกยางเส้นยาวจาก SR · ส่งงานให้ PK · กฎเดียวกับตัวเขียน private.bom_gr_save_* ของฐานข้อมูล
  // หัวหน้าแผนก = ผู้จัดการแผนก / ผู้ช่วยผู้จัดการแผนก (roleCode ของบัญชี) · บทบาทสาธิตในเครื่องที่ไม่มี roleCode ใช้บทบาท manager ของแผนกนั้น (แบบเดียวกับ canReverseFg)
  // ทุก action คืน request = แถวคำขอเดียวที่ store ส่งในส่วน section (GR_ACTIONS ของ bom-store.js) · ฝั่งนี้เขียนผลล่วงหน้า (แถวและยอดของงาน) ให้หน้าแสดงทันที ฐานข้อมูลคำนวณจริงในธุรกรรมเดียวกัน
  const DEPT_HEAD_ROLES = Object.freeze(["department_manager", "assistant_department_manager"]);
  const isDeptHead = (user, dept) => Boolean(user) && user.dept === dept && (user.roleCode ? DEPT_HEAD_ROLES.includes(user.roleCode) : user.role === "manager");
  // ตั้งค่า / ตั้งขั้นตอนของงาน / ส่งให้ PK / บันทึกและแก้ผลของทุกคนทุกวัน = หัวหน้า GR หรือฝ่ายวางแผน
  const canGrLead = (user) => canPlan(user) || isDeptHead(user, "GR");
  // บันทึกผลของตัวเอง / ขอเบิกยางเส้นยาว = พนักงานแผนก GR ทุกบทบาท หรือฝ่ายวางแผน
  const canGrRecord = (user) => canPlan(user) || user?.dept === "GR";
  // รับงานจาก GR = แผนก PK หรือฝ่ายวางแผน · ย้อนการรับ = หัวหน้า PK หรือฝ่ายวางแผน
  const canReceiveGr = (user) => canPlan(user) || user?.dept === "PK";
  const canReverseGrReceipt = (user) => canPlan(user) || isDeptHead(user, "PK");
  const GR_ACTIVE_ORDER = Object.freeze(["released", "in_progress"]);
  const grReason = (value, label) => {
    const note = value === undefined || value === null ? "" : typeof value === "string" ? value.trim() : fail(`${label}ต้องเป็นข้อความ`);
    if (note.length < rules().GR_LIMITS.reasonMin) fail(`กรุณาระบุ${label} (อย่างน้อย ${rules().GR_LIMITS.reasonMin} ตัวอักษร)`);
    if (note.length > rules().GR_LIMITS.reasonMax) fail(`${label}ยาวเกิน ${rules().GR_LIMITS.reasonMax} ตัวอักษร`);
    return note;
  };
  const grNote = (value) => {
    const note = value === undefined || value === null ? "" : typeof value === "string" ? value.trim() : fail("หมายเหตุต้องเป็นข้อความ");
    if (note.length > rules().GR_LIMITS.note) fail(`หมายเหตุยาวเกิน ${rules().GR_LIMITS.note} ตัวอักษร`);
    return note;
  };
  const grWhole = (value, label, { min = 0, max = rules().GR_LIMITS.qty } = {}) => {
    const n = value === undefined || value === null || value === "" ? 0 : Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) fail(`${label}ต้องเป็นจำนวนเต็ม`);
    if (n < min) fail(`${label}ต้องไม่น้อยกว่า ${min}`);
    if (n > max) fail(`${label}ต้องไม่เกิน ${R_fmt(max)}`);
    return n;
  };
  const R_fmt = (n) => rules().fmtQty(n);
  const grJobOf = (d, jobId) => {
    const job = jobById(d, String(jobId ?? "").trim());
    if (job.dept !== "GR") fail(`งาน ${job.id} ไม่ใช่งานของแผนก GR`);
    return job;
  };
  const isGrPlanned = (d, job) => Boolean(rules().grPlanOf(d, job?.id));
  // งานที่มีผลรายวันของ GR แล้ว (ทุกสถานะของผล): นับว่าเริ่มแล้ว คืนคิวไม่ได้ (ปุ่มที่พักอยู่ = ทำต่อ)
  const hasGrRecords = (d, job) => (d?.grRecords ?? []).some((record) => record.jobId === job?.id);
  const grRecordOf = (d, id) => (d.grRecords ?? []).find((record) => record.id === String(id ?? "").trim()) ?? fail("ไม่พบผลรายวันนี้ (อาจมีผู้อื่นทำรายการไปก่อน)");
  // งานที่ฝ่ายวางแผนปิดพร้อมเหตุผล = done ทั้งที่ยอดดีต่ำกว่าแผน (งานที่ done เพราะยอดถึงแผนไม่นับ: ยังรับผลตามกติกาปกติ) · ตรงกับ private.bom_gr_save_record
  const isGrClosedShort = (job) => job?.status === "done" && (Number(job.qtyDone) || 0) + 1e-9 < (Number(job.qtyPlanned) || 0);
  // เหตุที่งานนี้รับผลใหม่ไม่ได้ (null = รับได้) · ใช้ทั้ง action และหน้า (ซ่อน / ปิดปุ่มบันทึกผล)
  function grJobBlock(d, job, user, { adding = true } = {}) {
    const order = d.orders.find((entry) => entry.id === job?.orderId);
    if (!order || !GR_ACTIVE_ORDER.includes(order.status)) return "ใบสั่งผลิตไม่อยู่ในสถานะผลิต";
    if (isGrClosedShort(job) && !canPlan(user)) return "ฝ่ายวางแผนปิดงานนี้แล้ว แก้ผลได้โดยฝ่ายวางแผนเท่านั้น";
    if (adding && job.status === "hold") return "งานนี้พักอยู่ กด ทำต่อ ก่อนบันทึกผล";
    if (adding && !isGrPlanned(d, job)) return "งานนี้ยังไม่ได้ตั้งขั้นตอน ให้หัวหน้าแผนก GR ตั้งขั้นตอนก่อนบันทึกผล";
    return null;
  }
  // เหตุที่ผู้ใช้แก้ / ยกเลิกผลนี้ไม่ได้ (null = ได้): พนักงานแก้ได้เฉพาะผลของตัวเองที่บันทึกวันนี้ (เวลาไทย) · หัวหน้า GR / ฝ่ายวางแผน ได้ทุกผล
  function grRecordBlock(d, user, record, now) {
    if (!record || record.status !== "active") return "ผลนี้ถูกยกเลิกแล้ว";
    if (!canGrRecord(user)) return "แก้ผลรายวันได้โดยแผนก GR หรือฝ่ายวางแผนเท่านั้น";
    if (!canGrLead(user)) {
      if (record.workerId !== user.id) return "พนักงานแก้ได้เฉพาะผลของตัวเอง";
      if (rules().grDay(record.createdAt) !== rules().grDay(now)) return "พนักงานแก้ผลได้เฉพาะวันที่บันทึก ให้หัวหน้าแผนก GR แก้แทน";
    }
    const job = d.jobs.find((entry) => entry.id === record.jobId);
    return job ? grJobBlock(d, job, user, { adding: false }) : "ไม่พบงานของผลนี้";
  }
  // ยอดของงานจากผลรายวัน (สูตรเดียวกับ private.bom_gr_recompute) · ยอดเปลี่ยน = รายการรายงาน kind gr (ยอด >= 0 ยอดเดิม → ใหม่ในหมายเหตุ)
  function recomputeGrJob(d, job, ctx, label) {
    const R = rules();
    const totals = R.grJobTotals(d, job.id);
    if (!totals) return false;
    const hasRecord = (d.grRecords ?? []).some((record) => record.jobId === job.id);
    const planned = Number(job.qtyPlanned) || 0;
    const oldDone = Number(job.qtyDone) || 0;
    const oldReject = Number(job.qtyReject) || 0;
    const status = job.status === "hold" ? "hold"
      : job.status === "done" && oldDone + 1e-9 < planned ? "done"
      : hasRecord && totals.good + 1e-9 >= planned ? "done"
      : hasRecord || job.status !== "queued" ? "in_progress" : "queued";
    const dGood = Math.round((totals.good - oldDone) * 1e4) / 1e4;
    const dReject = Math.round((totals.reject - oldReject) * 1e4) / 1e4;
    if (dGood === 0 && dReject === 0 && status === job.status) return false;
    job.reports = Array.isArray(job.reports) ? job.reports : [];
    if ((dGood !== 0 || dReject !== 0) && job.reports.length < 1000) {
      job.reports.push({ at: ctx.now, by: ctx.user?.name ?? "", good: Math.max(dGood, 0), reject: Math.max(dReject, 0),
        note: `${label} · ยอดดี ${R.fmtQty(oldDone)} → ${R.fmtQty(totals.good)} เสีย ${R.fmtQty(oldReject)} → ${R.fmtQty(totals.reject)}`.slice(0, 200), kind: "gr" });
    }
    job.qtyDone = totals.good;
    job.qtyReject = totals.reject;
    job.status = status;
    if (status === "done") job.doneAt = job.doneAt ?? ctx.now; else delete job.doneAt;
    const order = d.orders.find((entry) => entry.id === job.orderId);
    if (order?.status === "released" && (status !== "queued" || totals.good > 0 || totals.reject > 0)) order.status = "in_progress";
    return true;
  }
  // ยอดดีของงานหลังคำสั่ง (records / steps = ผลรายวันและขั้นตอนหลังแก้) ต้องไม่ต่ำกว่าที่ส่งให้ PK แล้ว (ไม่นับยกเลิก) · ตรงกับ private.bom_gr_recompute (BOM_GR_EXCEEDS)
  function grKeepSent(d, job, records, steps, what) {
    const R = rules();
    const good = R.grJobTotals({ grRecords: records }, job.id, steps ?? R.grPlanOf(d, job.id)?.steps)?.good ?? 0;
    const { sent } = R.grHandoverSummary(d, job);
    if (good + 1e-9 < sent) fail(`${what}ไม่ได้: ยอดดีของงานจะเหลือ ${R.fmtQty(good)} ต่ำกว่าที่ส่งให้ PK แล้ว ${R.fmtQty(sent)} ยกเลิกการส่ง (หรือให้หัวหน้าแผนก PK ย้อนการรับ) ก่อน`);
  }

  // ตั้งค่า GR: { steps: [{ code?, name, kind: main | side, active }] (ลำดับในอาร์เรย์ = ลำดับขั้น), reasons: [ข้อความ], targets: [{ itemCode, stepCode, perHour }] }
  // ขั้นใหม่ที่ไม่ส่ง code ได้รหัส GR-<เลขถัดไป> · ขั้นที่มีผลบันทึกแล้วหรืออยู่ในขั้นตอนของงานใด ลบไม่ได้ (ตั้ง active = false แทน)
  function saveGrConfig(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const L = R.GR_LIMITS;
    if (!canGrLead(user)) fail("ตั้งค่าขั้นตอนและเป้าได้โดยหัวหน้าแผนก GR หรือฝ่ายวางแผนเท่านั้น");
    const rawSteps = Array.isArray(p?.steps) ? p.steps : fail("กรุณาระบุขั้นตอน");
    if (!rawSteps.length) fail("ต้องมีอย่างน้อย 1 ขั้นตอน");
    if (rawSteps.length > L.steps) fail(`ขั้นตอนได้ไม่เกิน ${L.steps} ขั้น`);
    const given = rawSteps.map((step) => String(step?.code ?? "").trim().toUpperCase()).filter(Boolean);
    let next = Math.max(12, ...given.map((code) => Number(/^GR-(\d+)$/.exec(code)?.[1]) || 0));
    const codes = new Set();
    const steps = rawSteps.map((step, index) => {
      let code = String(step?.code ?? "").trim().toUpperCase();
      if (!code) { next += 1; code = `GR-${String(next).padStart(2, "0")}`; }
      if (!R.GR_STEP_CODE.test(code)) fail(`รหัสขั้นตอน ${code} ต้องเป็นรูป GR- ตามด้วยตัวอักษรหรือตัวเลข 1-10 ตัว`);
      if (codes.has(code)) fail(`รหัสขั้นตอน ${code} ซ้ำ`);
      codes.add(code);
      const name = text(step?.name, `ชื่อขั้นตอนที่ ${index + 1}`, L.name);
      const kind = step?.kind === "side" ? "side" : step?.kind === "main" || step?.kind === undefined ? "main" : fail(`ขั้นตอน ${name}: เลือกสายหลักหรือขั้นเสริม`);
      return { code, name, kind, seq: index + 1, active: step?.active !== false };
    });
    const reasons = (Array.isArray(p?.reasons) ? p.reasons : fail("กรุณาระบุเหตุผลของเสีย")).map((reason) => String(reason ?? "").trim()).filter(Boolean);
    if (!reasons.length) fail("ต้องมีเหตุผลของเสียอย่างน้อย 1 ข้อ");
    if (reasons.length > L.reasons) fail(`เหตุผลของเสียได้ไม่เกิน ${L.reasons} ข้อ`);
    if (reasons.some((reason) => reason.length > L.name)) fail(`เหตุผลของเสียยาวเกิน ${L.name} ตัวอักษร`);
    if (new Set(reasons).size !== reasons.length) fail("เหตุผลของเสียซ้ำกัน");
    const rawTargets = Array.isArray(p?.targets) ? p.targets : [];
    if (rawTargets.length > L.targets) fail(`เป้าได้ไม่เกิน ${L.targets} รายการ`);
    const pairs = new Set();
    const targets = rawTargets.map((target) => {
      const itemCode = R.canonicalCode(target?.itemCode);
      const stepCode = String(target?.stepCode ?? "").trim().toUpperCase();
      if (!itemCode || !itemOf(d, itemCode)) fail(`ไม่พบชิ้นงาน${ref(target?.itemCode)} ของเป้า`);
      if (!codes.has(stepCode)) fail(`เป้าของ ${itemCode}: ไม่พบขั้นตอน${ref(stepCode)}`);
      if (pairs.has(`${itemCode}|${stepCode}`)) fail(`เป้าของ ${itemCode} ขั้น ${stepCode} ซ้ำ`);
      pairs.add(`${itemCode}|${stepCode}`);
      const perHour = Number(target?.perHour);
      if (!Number.isFinite(perHour) || perHour <= 0) fail(`เป้าของ ${itemCode} ขั้น ${stepCode} ต้องมากกว่า 0 ชิ้นต่อชั่วโมง`);
      if (perHour > L.perHour) fail(`เป้าของ ${itemCode} ขั้น ${stepCode} ต้องไม่เกิน ${R_fmt(L.perHour)} ชิ้นต่อชั่วโมง`);
      return { itemCode, stepCode, perHour };
    });
    // ขั้นที่ใช้อยู่ลบไม่ได้
    const config = R.grConfig(d);
    const used = new Set([...(d.grRecords ?? []).map((record) => record.stepCode), ...(d.grPlans ?? []).flatMap((plan) => (plan.steps ?? []).map((step) => step.code))]);
    const dropped = [...used].filter((code) => !codes.has(code));
    if (dropped.length) fail(`ขั้น ${dropped.map((code) => R.grStepName(config, code)).join(", ")} มีผลบันทึกแล้วหรืออยู่ในขั้นตอนของงาน ลบไม่ได้ ตั้งเป็นไม่ใช้แทน`);
    d.grConfig = [{ key: "gr", steps, reasons, targets, updatedBy: user.name, updatedAt: ctx.now }];
    audit(d, ctx, "ตั้งค่าขั้นตอนและเป้า (GR)", `${steps.length} ขั้น · เหตุผล ${reasons.length} ข้อ · เป้า ${targets.length} รายการ`);
    return { summary: `${steps.length} ขั้นตอน`, section: "grConfig", request: [{ steps, reasons, targets }] };
  }

  // ตั้งขั้นตอนของงาน GR: { jobId, steps: [{ code, qtyTarget }] } ตามลำดับ (ขั้นสุดท้าย = ขั้นที่นับเป็นยอดดีของงาน) · ค่าเริ่มต้นของหน้า = rules.grDefaultSteps
  function setGrJobSteps(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    if (!canGrLead(user)) fail("ตั้งขั้นตอนของงานได้โดยหัวหน้าแผนก GR หรือฝ่ายวางแผนเท่านั้น");
    const job = grJobOf(d, p?.jobId);
    const order = orderById(d, job.orderId);
    if (!GR_ACTIVE_ORDER.includes(order.status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    if (job.status === "done") fail("งานนี้เสร็จแล้ว ตั้งขั้นตอนไม่ได้");
    const old = R.grPlanOf(d, job.id);
    if (!old && (Number(job.qtyDone) > 0 || Number(job.qtyReject) > 0)) fail("งานนี้รายงานผลแบบเดิมไปแล้ว ตั้งขั้นตอนไม่ได้ (ยอดเดิมจะถูกคำนวณทับ)");
    const raw = Array.isArray(p?.steps) ? p.steps : fail("กรุณาเลือกขั้นตอน");
    if (!raw.length) fail("เลือกอย่างน้อย 1 ขั้นตอน");
    if (raw.length > R.GR_LIMITS.steps) fail(`ขั้นตอนได้ไม่เกิน ${R.GR_LIMITS.steps} ขั้น`);
    const config = R.grConfig(d);
    const oldCodes = new Set((old?.steps ?? []).map((step) => step.code));
    const seen = new Set();
    const steps = raw.map((step) => {
      const code = String(step?.code ?? "").trim().toUpperCase();
      const found = R.grStepOf(config, code) ?? fail(`ไม่พบขั้นตอน${ref(code)} ในตั้งค่า`);
      if (!found.active && !oldCodes.has(code)) fail(`ขั้นตอน ${found.name} ไม่ใช้แล้ว เพิ่มในงานไม่ได้`);
      if (seen.has(code)) fail(`ขั้นตอน ${found.name} ซ้ำ`);
      seen.add(code);
      return { code, qtyTarget: grWhole(step?.qtyTarget, `ต้องทำของขั้น ${found.name} `, { min: 1 }) };
    });
    const busy = [...new Set(R.grActiveRecords(d, job.id).map((record) => record.stepCode))].filter((code) => !seen.has(code));
    if (busy.length) fail(`ขั้น ${busy.map((code) => R.grStepName(config, code)).join(", ")} มีผลบันทึกแล้ว เอาออกจากงานไม่ได้ (ยกเลิกผลก่อน)`);
    grKeepSent(d, job, d.grRecords ?? [], steps, "เปลี่ยนขั้นตอน");
    d.grPlans ??= [];
    const plan = { jobId: job.id, orderId: job.orderId, steps, createdBy: old?.createdBy ?? user.name, createdAt: old?.createdAt ?? ctx.now, updatedBy: user.name, updatedAt: ctx.now };
    d.grPlans = [...d.grPlans.filter((entry) => entry.jobId !== job.id), plan];
    recomputeGrJob(d, job, ctx, "GR ตั้งขั้นตอนของงาน");
    audit(d, ctx, "ตั้งขั้นตอนของงาน (GR)", `${job.id} ${job.itemCode}: ${steps.map((step) => R.grStepName(config, step.code)).join(" → ")}`);
    return { summary: `${job.id} ${steps.length} ขั้น`, section: "grPlans", request: [{ jobId: job.id, steps }] };
  }

  // ตรวจและแปลงช่องของผลรายวัน (เพิ่ม / แก้) · base = ค่าเดิมของผล (แก้: ช่องที่ไม่ส่งใช้ค่าเดิม)
  function grRecordFields(d, p, ctx, user, job, base = null) {
    const R = rules();
    const L = R.GR_LIMITS;
    const pick = (key, fallback) => (p?.[key] === undefined ? fallback : p[key]);
    const config = R.grConfig(d);
    const plan = R.grPlanOf(d, job.id);
    const stepCode = String(pick("stepCode", base?.stepCode) ?? "").trim().toUpperCase();
    if (!stepCode) fail("กรุณาเลือกขั้นตอน");
    if (!(plan?.steps ?? []).some((step) => step.code === stepCode)) fail(`ขั้น ${R.grStepName(config, stepCode)} ไม่อยู่ในขั้นตอนของงานนี้`);
    const workDate = String(pick("workDate", base?.workDate ?? R.grDay(ctx.now)) ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || R.grDay(Date.parse(`${workDate}T12:00:00+07:00`)) !== workDate) fail("วันที่ทำงานไม่ถูกต้อง");
    const today = R.grDay(ctx.now);
    if (workDate > today) fail("วันที่ทำงานต้องไม่เกินวันนี้");
    const workerId = String(pick("workerId", base?.workerId ?? user.id) ?? "").trim();
    if (!workerId) fail("กรุณาเลือกผู้ทำ");
    const lead = canGrLead(user);
    if (!lead) {
      if (workerId !== user.id) fail("พนักงานบันทึกได้เฉพาะผลของตัวเอง");
      if (![today, R.grDay(ctx.now, -1)].includes(workDate)) fail("พนักงานบันทึกผลได้เฉพาะวันนี้หรือเมื่อวาน ให้หัวหน้าแผนก GR บันทึกแทน");
    }
    // ผู้ทำใหม่ (เพิ่มผล หรือเปลี่ยนผู้ทำของผลที่แก้) ต้องอยู่ในรายชื่อพนักงานแผนก GR (grWorkers) ทุกผู้เรียก รวมผู้บันทึกเอง · ตรงกับ private.bom_gr_save_record
    const workers = d.grWorkers ?? [];
    const worker = workers.find((entry) => entry.id === workerId) ?? null;
    if (workerId !== base?.workerId && !worker) fail(workerId === user.id ? "บัญชีนี้ไม่อยู่ในรายชื่อพนักงานแผนก GR กรุณาเลือกผู้ทำ" : "ผู้ทำต้องเป็นพนักงานแผนก GR");
    const workerName = worker?.name ?? (workerId === user.id ? user.name : workerId === base?.workerId ? base.workerName : String(p?.workerName ?? "").trim());
    const hours = Number(pick("hours", base?.hours));
    if (!Number.isFinite(hours) || hours <= 0) fail("ชั่วโมงทำงานต้องมากกว่า 0");
    if (hours > L.hours) fail(`ชั่วโมงทำงานต้องไม่เกิน ${L.hours}`);
    if (Math.round(hours * 100) / 100 !== hours) fail("ชั่วโมงทำงานมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
    const people = grWhole(pick("people", base?.people ?? 1), "จำนวนคน", { min: 1, max: L.people });
    const good = grWhole(pick("good", base?.good), "จำนวนดี");
    const reject = grWhole(pick("reject", base?.reject), "จำนวนเสีย");
    if (good + reject <= 0) fail("กรุณาระบุจำนวนดีหรือจำนวนเสีย");
    let reason = String(pick("reason", base?.reason) ?? "").trim();
    if (reject === 0) reason = "";
    else if (!reason) fail("มีของเสีย กรุณาเลือกเหตุผล");
    else if (!config.reasons.includes(reason)) fail(`เหตุผล ${reason} ไม่อยู่ในรายการของแผนก GR`);
    const note = grNote(pick("note", base?.note));
    return { stepCode, workDate, workerId, workerName, hours, people, good, reject, reason: reason || null, note };
  }
  const grRecordRequest = (record) => ({ stepCode: record.stepCode, workDate: record.workDate, workerId: record.workerId, hours: record.hours, people: record.people, good: record.good, reject: record.reject, reason: record.reason ?? "", note: record.note });

  // บันทึกผลรายวัน: { jobId, stepCode, workDate (YYYY-MM-DD ค่าเริ่มต้นวันนี้), workerId (ค่าเริ่มต้นตัวเอง), hours, people (ค่าเริ่มต้น 1), good, reject, reason, note }
  function addGrRecord(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    if (!canGrRecord(user)) fail("บันทึกผลรายวันได้โดยแผนก GR หรือฝ่ายวางแผนเท่านั้น");
    const job = grJobOf(d, p?.jobId);
    const blocked = grJobBlock(d, job, user);
    if (blocked) fail(blocked);
    const fields = grRecordFields(d, p, ctx, user, job);
    const id = newUuid();
    const record = { id, jobId: job.id, orderId: job.orderId, itemCode: job.itemCode, ...fields, status: "active", voidReason: null, edits: [],
      createdBy: user.name, createdById: user.id, createdAt: ctx.now, updatedBy: null, updatedAt: null };
    d.grRecords ??= [];
    d.grRecords.push(record);
    recomputeGrJob(d, job, ctx, `GR บันทึกผล ${fields.stepCode} ${fields.workDate}`);
    const config = R.grConfig(d);
    audit(d, ctx, "บันทึกผลรายวัน (GR)", `${job.id} ${R.grStepName(config, fields.stepCode)} ${fields.workDate} ${fields.workerName}: ดี ${fields.good} เสีย ${fields.reject}${fields.reason ? ` (${fields.reason})` : ""}`);
    return { id, summary: `${R.grStepName(config, fields.stepCode)} ดี ${R.fmtQty(fields.good)}`, section: "grRecords", request: [{ id, jobId: job.id, ...grRecordRequest(record) }] };
  }
  // แก้ผลรายวัน: { recordId, ...ช่องที่แก้ (ไม่ส่ง = ค่าเดิม), editReason } เหตุผล 3-200 ทุกครั้ง · ประวัติเก็บค่าก่อนแก้
  function editGrRecord(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const record = grRecordOf(d, p?.recordId ?? p?.id);
    const blocked = grRecordBlock(d, user, record, ctx.now);
    if (blocked) fail(blocked);
    const why = grReason(p?.editReason, "เหตุผลที่แก้");
    if ((record.edits ?? []).length >= R.GR_LIMITS.edits) fail(`ผลนี้แก้ครบ ${R.GR_LIMITS.edits} ครั้งแล้ว ยกเลิกแล้วบันทึกใหม่แทน`);
    const job = jobById(d, record.jobId);
    const fields = grRecordFields(d, p, ctx, user, job, record);
    grKeepSent(d, job, (d.grRecords ?? []).map((row) => (row === record ? { ...row, ...fields } : row)), undefined, "แก้ผลนี้");
    const before = { ...grRecordRequest(record), reason: record.reason ?? null };
    Object.assign(record, fields, { edits: [...(record.edits ?? []), { at: ctx.now, by: user.name, kind: "edit", reason: why, before }], updatedBy: user.name, updatedAt: ctx.now });
    recomputeGrJob(d, job, ctx, `GR แก้ไขผล ${before.stepCode} ${before.workDate}`);
    audit(d, ctx, "แก้ไขผลรายวัน (GR)", `${job.id} ${before.workDate} ${record.workerName}: ดี ${before.good} → ${fields.good} เสีย ${before.reject} → ${fields.reject} — ${why}`);
    return { id: record.id, summary: `ดี ${R.fmtQty(fields.good)} เสีย ${R.fmtQty(fields.reject)}`, section: "grRecords", request: [{ id: record.id, ...grRecordRequest(record), editReason: why }] };
  }
  // ยกเลิกผลรายวัน: { recordId, reason } เหตุผล 3-200 · ผลยังอยู่ในประวัติ (status void)
  function voidGrRecord(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const record = grRecordOf(d, p?.recordId ?? p?.id);
    const blocked = grRecordBlock(d, user, record, ctx.now);
    if (blocked) fail(blocked);
    const why = grReason(p?.reason, "เหตุผลที่ยกเลิก");
    if ((record.edits ?? []).length >= R.GR_LIMITS.edits) fail(`ผลนี้แก้ครบ ${R.GR_LIMITS.edits} ครั้งแล้ว`);
    const job = jobById(d, record.jobId);
    grKeepSent(d, job, (d.grRecords ?? []).map((row) => (row === record ? { ...row, status: "void" } : row)), undefined, "ยกเลิกผลนี้");
    const before = { ...grRecordRequest(record), reason: record.reason ?? null };
    Object.assign(record, { status: "void", voidReason: why, edits: [...(record.edits ?? []), { at: ctx.now, by: user.name, kind: "void", reason: why, before }], updatedBy: user.name, updatedAt: ctx.now });
    recomputeGrJob(d, job, ctx, `GR ยกเลิกผล ${before.stepCode} ${before.workDate}`);
    audit(d, ctx, "ยกเลิกผลรายวัน (GR)", `${job.id} ${before.workDate} ${record.workerName}: ดี ${before.good} เสีย ${before.reject} — ${why}`);
    return { id: record.id, summary: `ยกเลิกผล ${before.workDate}`, section: "grRecords", request: [{ id: record.id, reason: why }] };
  }

  // GR ขอเบิกยางเส้นยาวจาก SR: { jobId, itemCode, qty, note } · รหัสต้องเป็นเส้นยางที่งานนี้ตัด (rules.grRodCodesOf) · SR จ่ายด้วย issueRods ตามเดิม
  function requestRods(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    if (!canGrRecord(user)) fail("ขอเบิกยางเส้นยาวได้โดยแผนก GR หรือฝ่ายวางแผนเท่านั้น");
    const job = grJobOf(d, p?.jobId);
    const order = orderById(d, job.orderId);
    if (!GR_ACTIVE_ORDER.includes(order.status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    if (job.status === "done") fail("งานนี้เสร็จแล้ว");
    const itemCode = R.canonicalCode(p?.itemCode);
    if (!R.grRodCodesOf(order, job).includes(itemCode)) fail(`${itemCode || "รหัสที่ระบุ"} ไม่ใช่ยางเส้นยาวของงาน ${job.id}`);
    const qty = grWhole(p?.qty, "จำนวนที่ขอ", { min: 1, max: R.GR_LIMITS.requestQty });
    const note = grNote(p?.note);
    const id = newUuid();
    d.rodRequests ??= [];
    d.rodRequests.push({ id, orderId: order.id, jobId: job.id, itemCode, qty, note, status: "open", createdBy: user.name, createdById: user.id, createdAt: ctx.now, cancelledBy: null, cancelledAt: null, cancelReason: null });
    audit(d, ctx, "ขอเบิกยางเส้นยาวจาก SR (GR)", `${order.id} ${itemCode} × ${qty}${note ? ` — ${note}` : ""}`);
    return { id, summary: `${itemCode} × ${R.fmtQty(qty)}`, section: "rodRequests", request: [{ id, jobId: job.id, itemCode, qty, note }] };
  }
  // ยกเลิกคำขอเบิก: { requestId, reason } ผู้ขอ หัวหน้า GR หรือฝ่ายวางแผน · คำขอที่ยังเปิดอยู่เท่านั้น
  function cancelRodRequest(d, p, ctx) {
    const user = requireUser(ctx);
    const request = (d.rodRequests ?? []).find((row) => row.id === String(p?.requestId ?? p?.id ?? "").trim()) ?? fail("ไม่พบคำขอเบิกนี้ (อาจมีผู้อื่นทำรายการไปก่อน)");
    if (!(canGrLead(user) || request.createdById === user.id)) fail("ยกเลิกคำขอได้โดยผู้ขอ หัวหน้าแผนก GR หรือฝ่ายวางแผนเท่านั้น");
    if (request.status !== "open") fail("คำขอนี้ถูกยกเลิกแล้ว");
    const why = grReason(p?.reason, "เหตุผลที่ยกเลิก");
    Object.assign(request, { status: "cancelled", cancelledBy: user.name, cancelledAt: ctx.now, cancelReason: why });
    audit(d, ctx, "ยกเลิกคำขอเบิกยางเส้นยาว (GR)", `${request.orderId} ${request.itemCode} × ${request.qty} — ${why}`);
    return { id: request.id, summary: `${request.itemCode} × ${rules().fmtQty(request.qty)}`, section: "rodRequests", request: [{ id: request.id, reason: why }] };
  }

  // GR ส่งงานให้ PK: { jobId, qty, note } หัวหน้า GR หรือฝ่ายวางแผน · ส่งรวมได้ไม่เกินยอดดีของงาน (รอที่ GR = rules.grHandoverSummary().waitingAtGr)
  function sendGrToPk(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    if (!canGrLead(user)) fail("ส่งงานให้ PK ได้โดยหัวหน้าแผนก GR หรือฝ่ายวางแผนเท่านั้น");
    const job = grJobOf(d, p?.jobId);
    const order = orderById(d, job.orderId);
    if (!GR_ACTIVE_ORDER.includes(order.status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    const qty = grWhole(p?.qty, "จำนวนที่ส่ง", { min: 1 });
    const { waitingAtGr } = R.grHandoverSummary(d, job);
    if (qty > waitingAtGr + 1e-9) fail(`ส่งได้ไม่เกินของดีที่ยังไม่ได้ส่ง ${R.fmtQty(waitingAtGr)} ชิ้น`);
    const note = grNote(p?.note);
    const id = newUuid();
    d.grHandovers ??= [];
    d.grHandovers.push({ id, jobId: job.id, orderId: order.id, itemCode: job.itemCode, qty, status: "sent", note, sentBy: user.name, sentAt: ctx.now, receivedBy: null, receivedAt: null,
      cancelledBy: null, cancelledAt: null, cancelReason: null, moves: [{ kind: "send", at: ctx.now, by: user.name, note }] });
    audit(d, ctx, "ส่งงานให้ PK (GR)", `${job.id} ${job.itemCode} × ${qty}${note ? ` — ${note}` : ""}`);
    return { id, summary: `${job.itemCode} × ${R.fmtQty(qty)}`, section: "grHandovers", request: [{ id, jobId: job.id, qty, note }] };
  }
  const grHandoverOf = (d, id) => (d.grHandovers ?? []).find((row) => row.id === String(id ?? "").trim()) ?? fail("ไม่พบรายการส่งงานนี้ (อาจมีผู้อื่นทำรายการไปก่อน)");
  // PK รับงานจาก GR ทั้งรายการ: { handoverId } แผนก PK หรือฝ่ายวางแผน
  function receiveGrAtPk(d, p, ctx) {
    const user = requireUser(ctx);
    if (!canReceiveGr(user)) fail("รับงานจาก GR ได้โดยแผนก PK หรือฝ่ายวางแผนเท่านั้น");
    const row = grHandoverOf(d, p?.handoverId ?? p?.id);
    if (!GR_ACTIVE_ORDER.includes(orderById(d, row.orderId).status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    if (row.status !== "sent") fail(row.status === "received" ? "รายการนี้รับไปแล้ว" : "รายการนี้ถูกยกเลิกแล้ว");
    Object.assign(row, { status: "received", receivedBy: user.name, receivedAt: ctx.now, moves: [...(row.moves ?? []), { kind: "receive", at: ctx.now, by: user.name, note: "" }] });
    audit(d, ctx, "รับงานจาก GR (PK)", `${row.jobId} ${row.itemCode} × ${row.qty}`);
    return { id: row.id, summary: `${row.itemCode} × ${rules().fmtQty(row.qty)}`, section: "grHandovers", request: [{ id: row.id }] };
  }
  // ยกเลิกการส่ง (ยังไม่รับ: หัวหน้า GR) หรือย้อนการรับ (รับแล้ว: หัวหน้า PK → กลับเป็นรอ PK รับ) · ฝ่ายวางแผนทำได้ทั้งสอง · { handoverId, reason } เหตุผล 3-200
  function cancelGrHandover(d, p, ctx) {
    const user = requireUser(ctx);
    const row = grHandoverOf(d, p?.handoverId ?? p?.id);
    if (row.status === "cancelled") fail("รายการนี้ถูกยกเลิกแล้ว");
    const reversing = row.status === "received";
    if (reversing ? !canReverseGrReceipt(user) : !canGrLead(user)) fail(reversing ? "ย้อนการรับงานได้โดยหัวหน้าแผนก PK หรือฝ่ายวางแผนเท่านั้น" : "ยกเลิกการส่งงานได้โดยหัวหน้าแผนก GR หรือฝ่ายวางแผนเท่านั้น");
    if (!GR_ACTIVE_ORDER.includes(orderById(d, row.orderId).status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    const why = grReason(p?.reason, reversing ? "เหตุผลที่ย้อนการรับ" : "เหตุผลที่ยกเลิก");
    if (reversing) Object.assign(row, { status: "sent", receivedBy: null, receivedAt: null, moves: [...(row.moves ?? []), { kind: "unreceive", at: ctx.now, by: user.name, note: why }] });
    else Object.assign(row, { status: "cancelled", cancelledBy: user.name, cancelledAt: ctx.now, cancelReason: why, moves: [...(row.moves ?? []), { kind: "cancel", at: ctx.now, by: user.name, note: why }] });
    audit(d, ctx, reversing ? "ย้อนการรับงานจาก GR (PK)" : "ยกเลิกการส่งงานให้ PK (GR)", `${row.jobId} ${row.itemCode} × ${row.qty} — ${why}`);
    return { id: row.id, status: row.status, summary: `${row.itemCode} × ${rules().fmtQty(row.qty)}`, section: "grHandovers", request: [{ id: row.id, reason: why }] };
  }

  function linkJobToRubberFlow(d, { jobId, woId, kg }, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, jobId);
    if (job.dept !== "RB") fail("เชื่อม RubberFlow ได้เฉพาะงานของแผนก RB");
    if (!canLinkRubberflow(user, job)) fail("เชื่อม RubberFlow ได้โดยฝ่ายวางแผนหรือผู้จัดการ");
    if (job.externalRef?.woId) fail(`งานนี้ผูกกับ ${job.externalRef.woId} อยู่แล้ว`);
    if (!["released", "in_progress"].includes(orderById(d, job.orderId).status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    job.externalRef = { system: "rubberflow", woId: text(woId, "เลข WO", 40), kg: Number(kg) || 0, linkedAt: ctx.now, by: user.name };
    if (job.status === "queued") job.status = "in_progress";
    const order = orderById(d, job.orderId);
    if (order.status === "released") order.status = "in_progress";
    audit(d, ctx, "เชื่อมงาน RB กับ RubberFlow", `${job.id} → ${job.externalRef.woId}`);
    return job.id;
  }

  // กิโลกรัมคอมปาวด์ของงาน RB: ถ้าเส้นยางมีบรรทัดสูตรยางใน BOM ใช้ปริมาณและ % เผื่อเสียของบรรทัดนั้น
  // ไม่เช่นนั้นใช้ กก./เส้น หรือน้ำหนักต่อชิ้น แล้วเผื่อตาม scrapPct ที่ส่งมา
  function rbJobKg(job, item, { scrapPct = 0, bom = null } = {}) {
    if (!item) return 0;
    const qty = Math.max(0, Number(job.qtyPlanned) - Number(job.qtyDone || 0));
    const line = bom?.lines?.[0];
    const perKg = { kg: 1, g: 0.001 }[line?.uom];
    if (line && perKg && Number(line.qty) > 0) return Math.round(qty * Number(line.qty) * perKg * (1 + (Number(line.scrapPct) || 0) / 100) * 100) / 100;
    let kg = 0;
    if (item.uom === "kg") kg = qty;
    else if (item.rubber?.kgPerRoll) kg = qty * Number(item.rubber.kgPerRoll);
    else if (item.weightG) kg = qty * Number(item.weightG) / 1000;
    return Math.round(kg * (1 + scrapPct / 100) * 100) / 100;
  }

  // ผลที่ฐานข้อมูลเปิด/ยกเลิก WO ของ RubberFlow ให้ (มากับคำตอบของการบันทึก ปล่อยผลิต/ยกเลิก/เปิดใบกลับมาแก้) → ข้อความแจ้งผู้ใช้ · null = ไม่มีอะไรต้องแจ้ง
  // มีงานที่ยังเปิด WO ไม่ได้ = ข้อความค้างแบบเตือน (type error) ให้ผู้วางแผนอ่านเหตุผล · เหตุผลต่อเนื่องดูได้ที่แท็บงานรายแผนกของใบ
  const SKIP_SHOWN = 3;
  function rubberflowNotice(name, payload, info) {
    if (!info || typeof info !== "object") return null;
    const opened = Array.isArray(info.opened) ? info.opened : [];
    const skipped = Array.isArray(info.skipped) ? info.skipped : [];
    const cancelled = Array.isArray(info.cancelled) ? info.cancelled : [];
    const release = name === "releaseOrder";
    if (!skipped.length && !cancelled.length && !(release && opened.length)) return null;
    const parts = [];
    if (release) {
      parts.push(`ปล่อยผลิต ${payload?.orderId ?? ""} แล้ว`);
      if (opened.length) parts.push(`เปิด WO ใน RubberFlow ${opened.length} ใบ`);
    }
    // ยกเลิกใบ / เปิดใบกลับมาแก้: WO ที่ยังไม่เริ่มถูกยกเลิก ที่กำลังผลิตหรือพักอยู่ถูกหยุด (20261128010000)
    if (cancelled.length) parts.push(`ยกเลิกหรือหยุด WO ${cancelled.join(", ")} ใน RubberFlow ด้วย`);
    if (skipped.length) {
      const shown = skipped.slice(0, SKIP_SHOWN).map((row) => `${row.jobId} ${row.itemCode}: ${row.reason}`).join(" · ");
      parts.push(`ยังไม่ได้เปิด WO ${skipped.length} งาน (${shown}${skipped.length > SKIP_SHOWN ? ` · อีก ${skipped.length - SKIP_SHOWN} งาน` : ""})`);
    }
    // ปล่อยผลิตสำเร็จเสมอ จึงเป็นข้อความปกติแม้มีงานที่ข้าม (รายการที่ข้ามค้างอยู่ในคำเตือนบนใบ PI แล้ว)
    return { text: parts.join(" · "), type: "success" };
  }

  const api = {
    saveItem, saveBom, saveBomTree, linkCompound, importFlat,
    saveColor, saveColorSet, removeColorSet, learnColorSet, savePackage, removePackage, createVariant,
    saveCustomer, createOrder, addOrderItem, removeOrderItem, updateOrderItem, explodeOrder, releaseOrder, setStockCount, setStockCounts, cancelOrder, receiveFg, deliverFg, closeOrderShort, closeOrder, reverseFg, receiveRods, decideRods, issueRods, reverseRodIssue, adjustRods, receiveRodsOpening, setRodLocation,
    saveGrConfig, setGrJobSteps, addGrRecord, editGrRecord, voidGrRecord, requestRods, cancelRodRequest, sendGrToPk, receiveGrAtPk, cancelGrHandover,
    reportJob, setJobStatus, linkJobToRubberFlow, saveRouting, saveProcess, setItemCost, setItemImage, countPartStock, issueOrderParts, undoOrderParts, returnOrderParts,
    helpers: { customerName, customerKey, startedJobs, isPartJob, isOpenJob, isLinkedJob, jobCloseNote, jobHoldNote, deptText, canIssueParts, canHandleFg, canReverseFg, partIssuePlan, stockRowOf, itemOf, approvedBomOf, routingOf, processOf, processesOf, bomById, canPlan, canCount, canSetSafety, canWorkJob, canLinkRubberflow, isBoss, rbJobKg, rubberflowNotice, siblingsOf, pickSibling, colorSetOf, packageOf, NO_BOM_KINDS, canStoreRods, canDecideRods, canSeeRodHolds, canAdjustRods, newUuid,
      isDeptHead, canGrLead, canGrRecord, canReceiveGr, canReverseGrReceipt, isGrPlanned, isGrClosedShort, hasGrRecords, grJobBlock, grRecordBlock },
  };
  if (isNode) module.exports = api;
  else root.MNP_BOM_ACTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
