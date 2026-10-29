// BOM รายแผนก (โหมดทดสอบ) — กฎธุรกิจทั้งหมด: item master · BOM หลายชั้นมี revision/อนุมัติ · นำเข้าจากชีต · ใบสั่งผลิต (PI) ระเบิด/ปล่อยผลิต ·
// งานรายแผนก · นับคงคลังตามใบ · ผูกสูตรยางกับ RubberFlow ทุก action รับ (draft, payload, ctx{now,user}) ทำบนร่างและ throw เมื่อกฎไม่ผ่าน
// (store บันทึกเฉพาะเมื่อผ่าน) "สิทธิ์" ในไฟล์นี้คือบทบาทสาธิต ไม่ใช่การควบคุมสิทธิ์ของระบบจริง — ดู docs/BOM_SYSTEM_PLAN.md §3
// โหลดหลัง modules/bom-rules.js เทสต์ด้วย node --test (scripts/tests/bom-actions.test.mjs)
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const rules = () => root.MNP_BOM_RULES;

  const fail = (message) => { throw new Error(message); };
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

  // ---------- สิทธิ์ (บทบาทสาธิต) ----------
  const isBoss = (user) => Boolean(user) && (user.role === "admin" || user.role === "manager");
  const canEditDept = (user, dept) => isBoss(user) || (Boolean(user) && user.dept === dept);
  // ชั้น FG อนุมัติโดยผู้จัดการฝ่ายโรงงาน ชั้นอื่นหัวหน้าแผนกเจ้าของอนุมัติได้
  const canApprove = (user, bom) => isBoss(user) || (Boolean(user) && bom.ownerDept !== "PK" && user.dept === bom.ownerDept);
  const canPlan = (user) => isBoss(user) || user?.role === "planner";
  const canCount = (user) => isBoss(user) || user?.role === "planner" || user?.role === "st";
  const requireUser = (ctx) => ctx.user ?? fail("กรุณาเลือกบทบาทสาธิตก่อน");

  const itemOf = (d, code) => d.items.find((item) => item.code === rules().canonicalCode(code)) ?? null;
  const approvedBomOf = (d, code) => d.boms.find((bom) => bom.itemCode === code && bom.status === "approved") ?? null;
  const openBomOf = (d, code) => d.boms.find((bom) => bom.itemCode === code && (bom.status === "draft" || bom.status === "pending")) ?? null;
  const bomById = (d, id) => d.boms.find((bom) => bom.id === id) ?? fail("ไม่พบ BOM revision นี้");
  const orderById = (d, id) => d.orders.find((order) => order.id === id) ?? fail("ไม่พบใบสั่งผลิต");
  const jobById = (d, id) => d.jobs.find((job) => job.id === id) ?? fail("ไม่พบงานของแผนก");

  // ---------- Item master ----------
  function saveItem(d, p, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const code = R.canonicalCode(text(p.code, "รหัสชิ้นงาน", 60));
    const kind = R.KINDS[p.kind] ? p.kind : fail("ชนิดชิ้นงานไม่ถูกต้อง");
    const ownerDept = R.DEPTS.includes(p.ownerDept) ? p.ownerDept : R.ownerDeptOf(kind, p.pair);
    if (!canEditDept(user, ownerDept)) fail(`เฉพาะแผนก ${ownerDept} (หรือผู้จัดการ) จึงแก้ชิ้นงานของแผนกนี้ได้`);
    const uom = R.UOMS[p.uom] ? p.uom : fail("หน่วยนับไม่ถูกต้อง");
    const name = text(p.name, "ชื่อชิ้นงาน", 160);
    const existing = itemOf(d, code);
    const rubber = p.rubber && typeof p.rubber === "object" ? { ...p.rubber } : existing?.rubber ?? null;
    if (kind === "RB" && rubber) {
      for (const key of ["cutLengthCm", "pcsPerRoll", "sePerGr", "kgPerRoll", "lengthMm", "holeMm", "odMm"]) if (rubber[key] !== undefined && rubber[key] !== "") rubber[key] = num(rubber[key], key, { allowZero: true });
      if (!rubber.compound) fail("เส้นยางต้องระบุรหัสสูตรยาง (คอมปาวด์)");
      if (!d.compounds.some((entry) => entry.code === rubber.compound)) d.compounds.push({ code: rubber.compound, name: rubber.compound, recipeId: null, createdAt: ctx.now });
    }
    const item = existing ?? { code, legacyCodes: [], createdAt: ctx.now, active: true, group: p.group || "TOY" };
    if (existing && existing.kind !== kind && approvedBomOf(d, code)) fail("เปลี่ยนชนิดชิ้นงานที่มี BOM อนุมัติแล้วไม่ได้");
    Object.assign(item, { kind, name, ownerDept, uom, weightG: p.weightG === undefined || p.weightG === "" ? item.weightG ?? 0 : num(p.weightG, "น้ำหนัก (กรัม)", { allowZero: true }), rubber, active: p.active === undefined ? item.active !== false : p.active !== false && p.active !== "false", updatedAt: ctx.now });
    if (!existing) d.items.push(item);
    audit(d, ctx, existing ? "แก้ชิ้นงาน" : "เพิ่มชิ้นงาน", `${code} ${name}`);
    return code;
  }

  // ---------- BOM revision ----------
  function normalizeLines(d, parent, rawLines) {
    const R = rules();
    if (!Array.isArray(rawLines) || !rawLines.length) fail("BOM ต้องมีอย่างน้อย 1 บรรทัด");
    const seen = new Set();
    return rawLines.map((raw, index) => {
      const childCode = R.canonicalCode(raw.childCode);
      const child = itemOf(d, childCode) ?? fail(`บรรทัด ${index + 1}: ไม่พบชิ้นงาน ${childCode} (เพิ่มใน item master ก่อน)`);
      if (child.code === parent.code) fail(`บรรทัด ${index + 1}: ชิ้นงานเป็นลูกของตัวเองไม่ได้`);
      if (seen.has(childCode)) fail(`บรรทัด ${index + 1}: ${childCode} ซ้ำ รวมปริมาณเป็นบรรทัดเดียว`);
      seen.add(childCode);
      // กันวงจร: ลูกตัวนี้ (ตาม BOM อนุมัติ) ห้ามมีพ่ออยู่ข้างใต้
      const stack = [childCode];
      const visited = new Set();
      while (stack.length) {
        const code = stack.pop();
        if (code === parent.code) fail(`บรรทัด ${index + 1}: ${childCode} มี ${parent.code} อยู่ข้างใต้ จะเป็นวงจร`);
        if (visited.has(code)) continue;
        visited.add(code);
        approvedBomOf(d, code)?.lines.forEach((line) => stack.push(line.childCode));
      }
      return {
        childCode, qty: num(raw.qty, `บรรทัด ${index + 1}: ปริมาณต่อหน่วยพ่อ`), uom: child.uom, consumerDept: parent.ownerDept, producerDept: child.ownerDept,
        scrapPct: raw.scrapPct === undefined || raw.scrapPct === "" ? 0 : num(raw.scrapPct, `บรรทัด ${index + 1}: % เผื่อเสีย`, { allowZero: true }),
        flags: Array.isArray(raw.flags) ? raw.flags.map(String).slice(0, 10) : [], note: String(raw.note ?? "").trim().slice(0, 200),
      };
    });
  }

  // บันทึกร่าง: ชิ้นหนึ่งมีร่าง/รออนุมัติได้ครั้งละหนึ่ง (แก้ทับร่างเดิม) revision = อนุมัติล่าสุด + 1
  function saveBomDraft(d, p, ctx) {
    const user = requireUser(ctx);
    const parent = itemOf(d, p.itemCode) ?? fail("ไม่พบชิ้นงานพ่อ");
    if (!canEditDept(user, parent.ownerDept)) fail(`BOM ของ ${parent.code} เป็นของแผนก ${parent.ownerDept} แก้ได้เฉพาะแผนกนั้นหรือผู้จัดการ`);
    const lines = normalizeLines(d, parent, p.lines);
    let bom = openBomOf(d, parent.code);
    if (bom?.status === "pending" && !canApprove(user, bom)) fail("revision นี้รออนุมัติอยู่ ถอนกลับเป็นร่างก่อนจึงแก้ได้");
    const approved = approvedBomOf(d, parent.code);
    if (!bom) {
      bom = { id: nextId(d, "BOM", ctx.now), itemCode: parent.code, revision: (approved?.revision ?? 0) + 1, status: "draft", ownerDept: parent.ownerDept, lines: [], createdBy: user.name, createdAt: ctx.now, note: "", changeLog: [] };
      d.boms.unshift(bom);
    }
    bom.lines = lines;
    bom.status = "draft";
    bom.note = String(p.note ?? "").trim().slice(0, 300);
    bom.updatedAt = ctx.now;
    bom.changeLog.push({ at: ctx.now, by: user.name, text: `บันทึกร่าง ${lines.length} บรรทัด${bom.note ? ` — ${bom.note}` : ""}` });
    audit(d, ctx, "บันทึกร่าง BOM", `${bom.id} ${parent.code} Rev.${bom.revision}`);
    return bom.id;
  }

  function submitBom(d, { bomId }, ctx) {
    const user = requireUser(ctx);
    const bom = bomById(d, bomId);
    if (bom.status !== "draft") fail("ส่งอนุมัติได้เฉพาะร่าง");
    if (!canEditDept(user, bom.ownerDept)) fail("เฉพาะแผนกเจ้าของ BOM จึงส่งอนุมัติได้");
    bom.status = "pending";
    bom.submittedBy = user.name;
    bom.submittedAt = ctx.now;
    bom.changeLog.push({ at: ctx.now, by: user.name, text: "ส่งอนุมัติ" });
    audit(d, ctx, "ส่งอนุมัติ BOM", `${bom.id} ${bom.itemCode} Rev.${bom.revision}`);
    return bom.id;
  }

  function approveBom(d, { bomId }, ctx) {
    const user = requireUser(ctx);
    const bom = bomById(d, bomId);
    if (bom.status !== "pending") fail("อนุมัติได้เฉพาะ revision ที่รออนุมัติ");
    if (!canApprove(user, bom)) fail(bom.ownerDept === "PK" ? "ชั้นสินค้าสำเร็จรูปอนุมัติโดยผู้จัดการฝ่ายโรงงานเท่านั้น" : `อนุมัติได้โดยหัวหน้าแผนก ${bom.ownerDept} หรือผู้จัดการ`);
    const previous = approvedBomOf(d, bom.itemCode);
    if (previous) { previous.status = "superseded"; previous.supersededAt = ctx.now; }
    bom.status = "approved";
    bom.approvedBy = user.name;
    bom.approvedAt = ctx.now;
    bom.changeLog.push({ at: ctx.now, by: user.name, text: previous ? `อนุมัติ แทน Rev.${previous.revision}` : "อนุมัติ" });
    audit(d, ctx, "อนุมัติ BOM", `${bom.id} ${bom.itemCode} Rev.${bom.revision}`);
    return bom.id;
  }

  function rejectBom(d, { bomId, reason }, ctx) {
    const user = requireUser(ctx);
    const bom = bomById(d, bomId);
    if (bom.status !== "pending") fail("ตีกลับได้เฉพาะ revision ที่รออนุมัติ");
    if (!canApprove(user, bom) && !canEditDept(user, bom.ownerDept)) fail("ไม่มีสิทธิ์ตีกลับ revision นี้");
    bom.status = "draft";
    bom.changeLog.push({ at: ctx.now, by: user.name, text: `ตีกลับเป็นร่าง${reason ? `: ${String(reason).trim().slice(0, 200)}` : ""}` });
    audit(d, ctx, "ตีกลับ BOM", `${bom.id} ${bom.itemCode}`);
    return bom.id;
  }

  function discardBom(d, { bomId }, ctx) {
    const user = requireUser(ctx);
    const bom = bomById(d, bomId);
    if (bom.status !== "draft") fail("ลบได้เฉพาะร่าง");
    if (!canEditDept(user, bom.ownerDept)) fail("เฉพาะแผนกเจ้าของจึงลบร่างได้");
    d.boms = d.boms.filter((entry) => entry.id !== bom.id);
    audit(d, ctx, "ลบร่าง BOM", `${bom.id} ${bom.itemCode}`);
    return true;
  }

  // ---------- สูตรยาง ↔ RubberFlow ----------
  function linkCompound(d, p, ctx) {
    const user = requireUser(ctx);
    if (!(isBoss(user) || user.role === "rb" || user.role === "planner")) fail("ผูกสูตรยางได้โดยแผนก RB ฝ่ายวางแผน หรือผู้จัดการ");
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
  // items: [item] · boms: [{ parentCode, lines }] · ชิ้นที่มีแล้วรวม legacy codes · พ่อที่มี BOM อนุมัติแล้วไม่ทับ (นับเป็น skipped)
  function importFlat(d, p, ctx) {
    const user = requireUser(ctx);
    if (!canPlan(user)) fail("นำเข้า BOM ได้โดยฝ่ายวางแผนหรือผู้จัดการ");
    const R = rules();
    const items = Array.isArray(p.items) ? p.items : fail("ไม่มีรายการชิ้นงานให้นำเข้า");
    const boms = Array.isArray(p.boms) ? p.boms : [];
    if (!items.length) fail("ไม่มีรายการชิ้นงานให้นำเข้า");
    const stats = { itemsAdded: 0, itemsMerged: 0, bomsAdded: 0, bomsSkipped: 0 };
    for (const raw of items) {
      const code = R.canonicalCode(raw.code);
      if (!code || !R.KINDS[raw.kind]) continue;
      const existing = itemOf(d, code);
      if (existing) {
        for (const legacy of raw.legacyCodes ?? []) if (!existing.legacyCodes.includes(legacy)) existing.legacyCodes.push(legacy);
        if (!existing.weightG && raw.weightG) existing.weightG = raw.weightG;
        if (!existing.rubber && raw.rubber) existing.rubber = raw.rubber;
        stats.itemsMerged += 1;
      } else {
        d.items.push({ code, kind: raw.kind, name: String(raw.name ?? code).slice(0, 160), ownerDept: R.DEPTS.includes(raw.ownerDept) ? raw.ownerDept : R.ownerDeptOf(raw.kind), uom: R.UOMS[raw.uom] ? raw.uom : "other", weightG: Number(raw.weightG) || 0, group: raw.group || p.group || "TOY", legacyCodes: [...(raw.legacyCodes ?? [])], rubber: raw.rubber ?? null, active: true, createdAt: ctx.now, importedFrom: p.source || "Excel" });
        stats.itemsAdded += 1;
        if (raw.rubber?.compound && !d.compounds.some((entry) => entry.code === raw.rubber.compound)) d.compounds.push({ code: raw.rubber.compound, name: raw.rubber.compound, recipeId: null, createdAt: ctx.now });
      }
    }
    for (const entry of boms) {
      const parent = itemOf(d, entry.parentCode);
      if (!parent || !Array.isArray(entry.lines) || !entry.lines.length) continue;
      if (approvedBomOf(d, parent.code) || openBomOf(d, parent.code)) { stats.bomsSkipped += 1; continue; }
      const lines = entry.lines.filter((line) => itemOf(d, line.childCode) && Number(line.qty) > 0).map((line) => ({ childCode: R.canonicalCode(line.childCode), qty: Number(line.qty), uom: itemOf(d, line.childCode).uom, consumerDept: parent.ownerDept, producerDept: itemOf(d, line.childCode).ownerDept, scrapPct: 0, flags: line.flags ?? [], note: "" }));
      if (!lines.length) continue;
      d.boms.push({ id: nextId(d, "BOM", ctx.now), itemCode: parent.code, revision: 1, status: "approved", ownerDept: parent.ownerDept, lines, createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: `นำเข้าจาก ${p.source || "Excel"} (อนุมัติย้อนหลังตามข้อมูลเดิม)`, changeLog: [{ at: ctx.now, by: user.name, text: `นำเข้าจาก ${p.source || "Excel"}` }] });
      stats.bomsAdded += 1;
    }
    const summary = `ชิ้นงานใหม่ ${stats.itemsAdded} (มีอยู่แล้ว ${stats.itemsMerged}) · BOM ใหม่ ${stats.bomsAdded} ข้าม ${stats.bomsSkipped}`;
    audit(d, ctx, "นำเข้า BOM จากชีต", `${p.source || "Excel"}: ${summary}`);
    return { ...stats, summary }; // summary = ข้อความสำหรับ toast (module-bom.js ใช้ result.summary เมื่อมี)
  }

  // ---------- ใบสั่งผลิต (PI) ----------
  function createOrder(d, p, ctx) {
    const user = requireUser(ctx);
    if (!canPlan(user)) fail("เปิดใบสั่งผลิตได้โดยฝ่ายวางแผนหรือผู้จัดการ");
    const R = rules();
    const id = text(p.pi, "เลขที่ PI", 40).toUpperCase();
    if (d.orders.some((order) => order.id === id)) fail(`มีใบสั่งผลิต ${id} อยู่แล้ว`);
    const orderedAt = Number(p.orderedAt);
    const whDue = Number(p.whDue);
    if (!Number.isFinite(orderedAt) || !Number.isFinite(whDue)) fail("กรุณาระบุวันที่สั่งผลิตและวันส่งมอบคลัง");
    if (whDue < orderedAt) fail("วันส่งมอบคลังต้องไม่ก่อนวันที่สั่งผลิต");
    const due = {};
    for (const dept of R.DUE_DEPTS) {
      const value = p.due?.[dept];
      if (value === undefined || value === "" || value === null) continue;
      const ms = Number(value);
      if (!Number.isFinite(ms)) fail(`กำหนดเสร็จ ${dept} ไม่ถูกต้อง`);
      if (ms > whDue) fail(`กำหนดเสร็จ ${dept} ต้องไม่หลังวันส่งมอบคลัง`);
      due[dept] = ms;
    }
    const country = text(p.country, "ประเทศ", 60);
    d.orders.unshift({
      id, customer: text(p.customer, "ชื่อลูกค้า", 120), country, orderType: R.orderTypeOf(country), orderedAt, whDue, due, revision: 0,
      status: "draft", items: [], explosion: null, explodedAt: null, stockCounts: {}, note: String(p.note ?? "").trim().slice(0, 300), createdBy: user.name, createdAt: ctx.now,
    });
    audit(d, ctx, "เปิดใบสั่งผลิต", `${id} ${p.customer}`);
    return id;
  }

  const editable = (order) => { if (order.status !== "draft") fail("แก้รายการได้เฉพาะใบที่ยังเป็นร่าง (ยังไม่ปล่อยผลิต)"); };

  function addOrderItem(d, p, ctx) {
    const user = requireUser(ctx);
    if (!canPlan(user)) fail("แก้รายการสินค้าได้โดยฝ่ายวางแผนหรือผู้จัดการ");
    const order = orderById(d, p.orderId);
    editable(order);
    const fg = itemOf(d, p.fgCode) ?? fail("ไม่พบสินค้า");
    if (fg.kind !== "FG") fail("เลือกได้เฉพาะสินค้าสำเร็จรูป (FG)");
    if (!approvedBomOf(d, fg.code)) fail(`${fg.code} ยังไม่มี BOM ที่อนุมัติ`);
    const qty = num(p.qty, "จำนวนสั่ง");
    const existing = order.items.find((item) => item.fgCode === fg.code);
    if (existing) existing.qty += qty;
    else order.items.push({ fgCode: fg.code, qty, colorSet: String(p.colorSet ?? rules().parseFgCode(fg.code).colorSet).trim().slice(0, 10), note: String(p.note ?? "").trim().slice(0, 120) });
    order.explosion = null;
    audit(d, ctx, "เพิ่มสินค้าในใบสั่งผลิต", `${order.id} ${fg.code} × ${qty}`);
    return order.id;
  }

  function removeOrderItem(d, { orderId, fgCode }, ctx) {
    const user = requireUser(ctx);
    if (!canPlan(user)) fail("แก้รายการสินค้าได้โดยฝ่ายวางแผนหรือผู้จัดการ");
    const order = orderById(d, orderId);
    editable(order);
    const before = order.items.length;
    order.items = order.items.filter((item) => item.fgCode !== rules().canonicalCode(fgCode));
    if (order.items.length === before) fail("ไม่พบสินค้านี้ในใบ");
    order.explosion = null;
    audit(d, ctx, "ลบสินค้าออกจากใบสั่งผลิต", `${order.id} ${fgCode}`);
    return order.id;
  }

  // ระเบิด BOM ทุกสินค้าในใบด้วย revision ที่อนุมัติ ณ ตอนนี้ (ร่างระเบิดซ้ำได้ ปล่อยผลิตแล้วล็อก)
  function explodeOrder(d, { orderId }, ctx) {
    const user = requireUser(ctx);
    if (!canPlan(user)) fail("ระเบิด BOM ได้โดยฝ่ายวางแผนหรือผู้จัดการ");
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
    if (missing.size) fail(`ระเบิดไม่ครบ ไม่พบชิ้นงาน: ${[...missing].join(", ")}`);
    order.explosion = lines;
    order.explodedAt = ctx.now;
    audit(d, ctx, "ระเบิด BOM", `${order.id} ${lines.length} บรรทัด`);
    return lines.length;
  }

  // ปล่อยผลิต: ระเบิดใหม่ให้ตรง BOM ล่าสุด ล็อก revision แล้วสร้างงานรายแผนก (หนึ่งงานต่อ แผนก × ชิ้น รวมทุกสินค้าในใบ) + งาน PK ต่อสินค้า
  function releaseOrder(d, { orderId }, ctx) {
    const user = requireUser(ctx);
    if (!canPlan(user)) fail("ปล่อยผลิตได้โดยฝ่ายวางแผนหรือผู้จัดการ");
    const order = orderById(d, orderId);
    editable(order);
    explodeOrder(d, { orderId }, ctx);
    const R = rules();
    const noBom = order.explosion.filter((line) => line.noBom).map((line) => line.itemCode);
    if (noBom.length) fail(`ชิ้นที่ต้องผลิตแต่ยังไม่มี BOM อนุมัติ: ${[...new Set(noBom)].join(", ")}`);
    const requirements = R.aggregateRequirements(order.explosion);
    for (const entry of requirements) {
      if (!R.MANUFACTURED.includes(entry.kind)) continue; // ของซื้อ (ST) อยู่ในรายการเบิก/สั่งซื้อ ไม่ใช่งานผลิต
      d.jobs.push({ id: nextId(d, "JOB", ctx.now), orderId: order.id, dept: entry.dept, itemCode: entry.itemCode, name: entry.name, kind: entry.kind, uom: entry.uom, qtyPlanned: Math.round(entry.required * 1e4) / 1e4, qtyDone: 0, qtyReject: 0, dueAt: order.due[entry.dept] ?? order.whDue, status: "queued", externalRef: null, fgCodes: entry.fgCodes, createdAt: ctx.now, reports: [] });
    }
    for (const item of order.items) {
      const fg = itemOf(d, item.fgCode);
      d.jobs.push({ id: nextId(d, "JOB", ctx.now), orderId: order.id, dept: "PK", itemCode: fg.code, name: fg.name, kind: "FG", uom: fg.uom, qtyPlanned: item.qty, qtyDone: 0, qtyReject: 0, dueAt: order.due.PK ?? order.whDue, status: "queued", externalRef: null, fgCodes: [fg.code], createdAt: ctx.now, reports: [] });
    }
    order.status = "released";
    order.releasedAt = ctx.now;
    order.releasedBy = user.name;
    audit(d, ctx, "ปล่อยผลิต", `${order.id} สร้างงาน ${d.jobs.filter((job) => job.orderId === order.id).length} รายการ`);
    return order.id;
  }

  function setStockCount(d, { orderId, itemCode, qty }, ctx) {
    const user = requireUser(ctx);
    if (!canCount(user)) fail("บันทึกยอดคงคลังได้โดยคลัง (ST) ฝ่ายวางแผน หรือผู้จัดการ");
    const order = orderById(d, orderId);
    if (["completed", "cancelled"].includes(order.status)) fail("ใบนี้ปิดแล้ว");
    const code = rules().canonicalCode(itemCode);
    if (!order.explosion?.some((line) => line.itemCode === code)) fail("ชิ้นงานนี้ไม่อยู่ในใบ (ระเบิด BOM ก่อน)");
    const value = num(qty, "ยอดคงคลัง", { allowZero: true });
    order.stockCounts[code] = value;
    order.stockCountedAt = ctx.now;
    order.stockCountedBy = user.name;
    audit(d, ctx, "นับคงคลังตามใบ", `${order.id} ${code} = ${value}`);
    return code;
  }

  function cancelOrder(d, { orderId, reason }, ctx) {
    const user = requireUser(ctx);
    if (!canPlan(user)) fail("ยกเลิกใบได้โดยฝ่ายวางแผนหรือผู้จัดการ");
    const order = orderById(d, orderId);
    if (order.status === "completed") fail("ใบที่เสร็จแล้วยกเลิกไม่ได้");
    if (d.jobs.some((job) => job.orderId === order.id && job.qtyDone > 0)) fail("มีงานที่รายงานผลผลิตแล้ว ยกเลิกไม่ได้ ให้ปิดใบแทน");
    order.status = "cancelled";
    order.cancelledAt = ctx.now;
    order.cancelReason = String(reason ?? "").trim().slice(0, 200);
    d.jobs = d.jobs.filter((job) => job.orderId !== order.id);
    audit(d, ctx, "ยกเลิกใบสั่งผลิต", `${order.id}${order.cancelReason ? ` — ${order.cancelReason}` : ""}`);
    return order.id;
  }

  function completeOrder(d, { orderId }, ctx) {
    const user = requireUser(ctx);
    if (!canPlan(user)) fail("ปิดใบได้โดยฝ่ายวางแผนหรือผู้จัดการ");
    const order = orderById(d, orderId);
    if (!["released", "in_progress"].includes(order.status)) fail("ปิดได้เฉพาะใบที่ปล่อยผลิตแล้ว");
    const pkJobs = d.jobs.filter((job) => job.orderId === order.id && job.dept === "PK");
    if (pkJobs.some((job) => job.status !== "done")) fail("งานบรรจุ (PK) ยังไม่เสร็จครบทุกสินค้า");
    order.status = "completed";
    order.completedAt = ctx.now;
    audit(d, ctx, "ปิดใบสั่งผลิต", order.id);
    return order.id;
  }

  // ---------- งานรายแผนก ----------
  const canWorkJob = (user, job) => isBoss(user) || user?.dept === job.dept || (job.dept === "PK" && user?.role === "planner");

  function reportJob(d, p, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, p.jobId);
    if (!canWorkJob(user, job)) fail(`รายงานผลได้โดยแผนก ${job.dept} หรือผู้จัดการ`);
    if (job.status === "done") fail("งานนี้เสร็จแล้ว");
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

  function setJobStatus(d, { jobId, status }, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, jobId);
    if (!canWorkJob(user, job)) fail(`เปลี่ยนสถานะได้โดยแผนก ${job.dept} หรือผู้จัดการ`);
    if (!["queued", "in_progress", "hold"].includes(status)) fail("สถานะไม่ถูกต้อง");
    if (job.status === "done") fail("งานที่เสร็จแล้วเปลี่ยนสถานะไม่ได้");
    job.status = status;
    audit(d, ctx, "เปลี่ยนสถานะงาน", `${job.id} → ${status}`);
    return job.id;
  }

  // บันทึกเลข WO ของ RubberFlow ที่สร้างจากงาน RB (ตัวสร้าง WO อยู่ที่หน้า เพราะเป็นอีก store)
  function linkJobToRubberFlow(d, { jobId, woId, kg }, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, jobId);
    if (job.dept !== "RB") fail("เชื่อม RubberFlow ได้เฉพาะงานของแผนก RB");
    if (!canWorkJob(user, job) && user.role !== "planner") fail("เชื่อม RubberFlow ได้โดยแผนก RB ฝ่ายวางแผน หรือผู้จัดการ");
    job.externalRef = { system: "rubberflow", woId: text(woId, "เลข WO", 40), kg: Number(kg) || 0, linkedAt: ctx.now, by: user.name };
    if (job.status === "queued") job.status = "in_progress";
    const order = orderById(d, job.orderId);
    if (order.status === "released") order.status = "in_progress";
    audit(d, ctx, "เชื่อมงาน RB กับ RubberFlow", `${job.id} → ${job.externalRef.woId}`);
    return job.id;
  }

  // ---------- helper ให้หน้า/เทสต์ ----------
  // กิโลกรัมคอมปาวด์ที่งาน RB ต้องใช้: หน่วย kg = ตามจำนวน · เส้น/ม้วน = จำนวน × kg ต่อเส้น · ชิ้น = จำนวน × น้ำหนักชิ้น/1000 (เผื่อ scrapPct)
  function rbJobKg(job, item, { scrapPct = 0 } = {}) {
    if (!item) return 0;
    const qty = Math.max(0, Number(job.qtyPlanned) - Number(job.qtyDone || 0));
    let kg = 0;
    if (item.uom === "kg") kg = qty;
    else if (item.rubber?.kgPerRoll) kg = qty * Number(item.rubber.kgPerRoll);
    else if (item.weightG) kg = qty * Number(item.weightG) / 1000;
    return Math.round(kg * (1 + scrapPct / 100) * 100) / 100;
  }

  const api = {
    saveItem, saveBomDraft, submitBom, approveBom, rejectBom, discardBom, linkCompound, importFlat,
    createOrder, addOrderItem, removeOrderItem, explodeOrder, releaseOrder, setStockCount, cancelOrder, completeOrder,
    reportJob, setJobStatus, linkJobToRubberFlow,
    // helpers (ไม่ใช่ action)
    helpers: { itemOf, approvedBomOf, openBomOf, canEditDept, canApprove, canPlan, canCount, canWorkJob, isBoss, rbJobKg },
  };
  if (isNode) module.exports = api;
  else root.MNP_BOM_ACTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
