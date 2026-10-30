// BOM รายแผนก (โหมดทดสอบ) — กฎธุรกิจทั้งหมด: item master · BOM หลายชั้น (จุดสร้างจุดเดียว บันทึกแล้วใช้ได้ทันที เก็บเป็น revision) ·
// นำเข้าจากชีต · ใบสั่งผลิต (PI) ระเบิด/ปล่อยผลิต · งานรายแผนก · นับคงคลังตามใบ · ผูกสูตรยางกับ RubberFlow
// ทุก action รับ (draft, payload, ctx{now,user}) ทำบนร่างและ throw เมื่อกฎไม่ผ่าน (store บันทึกเฉพาะเมื่อผ่าน)
// สิทธิ์ (บทบาทสาธิต ไม่ใช่การควบคุมสิทธิ์ของระบบจริง): สร้าง/แก้ item และ BOM ทุกชั้น = ฝ่ายวางแผน ผู้จัดการ ผู้ดูแล · ไม่มีขั้นอนุมัติ (ตามที่ผู้ใช้ตัดสิน
// 29 ต.ค. 2026 ให้เหมือน Excel) · "แผนกเจ้าของ" ของชิ้นงานใช้แยกงานรายแผนกตอนปล่อยผลิตเท่านั้น — ดู docs/BOM_SYSTEM_PLAN.md §3
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
  const canPlan = (user) => isBoss(user) || user?.role === "planner"; // สร้าง/แก้ item, BOM, ใบสั่งผลิต
  const canCount = (user) => canPlan(user) || user?.role === "st";
  const requireUser = (ctx) => ctx.user ?? fail("กรุณาเลือกบทบาทสาธิตก่อน");
  const requirePlanner = (ctx, what) => { const user = requireUser(ctx); if (!canPlan(user)) fail(`${what} ได้โดยฝ่ายวางแผนหรือผู้จัดการเท่านั้น`); return user; };

  const itemOf = (d, code) => d.items.find((item) => item.code === rules().canonicalCode(code)) ?? null;
  const approvedBomOf = (d, code) => d.boms.find((bom) => bom.itemCode === code && bom.status === "approved") ?? null;
  const bomById = (d, id) => d.boms.find((bom) => bom.id === id) ?? fail("ไม่พบ BOM revision นี้");
  const orderById = (d, id) => d.orders.find((order) => order.id === id) ?? fail("ไม่พบใบสั่งผลิต");
  const jobById = (d, id) => d.jobs.find((job) => job.id === id) ?? fail("ไม่พบงานของแผนก");
  const NO_BOM_KINDS = ["RB", "PURCHASED"];

  // ---------- Item master ----------
  // ชนิด/ชื่อ/หน่วย/น้ำหนัก และข้อมูลยาง (RB/SE) แผนกเจ้าของตามชนิดถ้าไม่ระบุ · create:true = เพิ่มใหม่เท่านั้น (รหัสซ้ำถูกปฏิเสธ)
  function saveItem(d, p, ctx) {
    const user = requirePlanner(ctx, "เพิ่ม/แก้ชิ้นงาน");
    const R = rules();
    const code = R.canonicalCode(text(p.code, "รหัสชิ้นงาน", 60));
    const kind = R.KINDS[p.kind] ? p.kind : fail("ชนิดชิ้นงานไม่ถูกต้อง");
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
    if (kind === "RB") {
      if (!rubber?.compound) fail(`เส้นยาง ${code} ต้องระบุรหัสสูตรยาง (คอมปาวด์)`);
      if (!d.compounds.some((entry) => entry.code === rubber.compound)) d.compounds.push({ code: rubber.compound, name: rubber.compound, recipeId: null, createdAt: ctx.now });
    }
    const item = existing ?? { code, legacyCodes: [], createdAt: ctx.now, active: true, group: p.group || "TOY" };
    if (existing && existing.kind !== kind && approvedBomOf(d, code)) fail(`เปลี่ยนชนิดของ ${code} ที่มี BOM แล้วไม่ได้`);
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
      const child = itemOf(d, childCode) ?? fail(`${parent.code} บรรทัด ${index + 1}: ไม่พบชิ้นงาน ${childCode}`);
      if (child.code === parent.code) fail(`${parent.code}: ชิ้นงานเป็นลูกของตัวเองไม่ได้`);
      if (seen.has(childCode)) fail(`${parent.code}: ${childCode} ซ้ำ รวมปริมาณเป็นบรรทัดเดียว`);
      seen.add(childCode);
      const stack = [childCode];
      const visited = new Set();
      while (stack.length) {
        const code = stack.pop();
        if (code === parent.code) fail(`${parent.code}: ${childCode} มี ${parent.code} อยู่ข้างใต้ จะเป็นวงจร`);
        if (visited.has(code)) continue;
        visited.add(code);
        approvedBomOf(d, code)?.lines.forEach((line) => stack.push(line.childCode));
      }
      return {
        childCode, qty: num(raw.qty, `${parent.code} → ${childCode}: ปริมาณต่อหน่วยพ่อ`), uom: child.uom, consumerDept: parent.ownerDept, producerDept: child.ownerDept,
        scrapPct: raw.scrapPct === undefined || raw.scrapPct === "" ? 0 : num(raw.scrapPct, `${childCode}: % เผื่อเสีย`, { allowZero: true }),
        flags: Array.isArray(raw.flags) ? raw.flags.map(String).slice(0, 10) : [], note: String(raw.note ?? "").trim().slice(0, 200),
      };
    });
  }
  // ปริมาณที่ต่างกันน้อยกว่า 1e-6 ถือว่าเท่ากัน (ฟอร์มแสดงอัตราส่วนเช่น 1/31 ด้วยทศนิยม 6 ตำแหน่ง การบันทึกซ้ำจึงไม่สร้าง revision ลอย)
  const QTY_EPS = 1e-6;
  const sameLines = (a, b) => a.length === b.length && a.every((line) => b.some((other) => other.childCode === line.childCode && Math.abs(other.qty - line.qty) <= QTY_EPS && (other.scrapPct || 0) === (line.scrapPct || 0) && (other.note || "") === (line.note || "")));
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
    const parent = itemOf(d, p.itemCode) ?? fail("ไม่พบชิ้นงานพ่อ");
    if (parent.kind === "RB") fail(`${parent.code} เป็นเส้นยาง ไม่มี BOM ในระบบนี้ (สูตรคอมปาวด์อยู่ที่ RubberFlow)`);
    if (parent.kind === "PURCHASED") fail(`${parent.code} เป็นของซื้อ ไม่มีส่วนประกอบ`);
    const lines = normalizeLines(d, parent, p.lines);
    const note = String(p.note ?? "").trim().slice(0, 300);
    const previous = approvedBomOf(d, parent.code);
    if (previous && sameLines(previous.lines, lines)) return { id: previous.id, revision: previous.revision, changed: false };
    const changes = previous ? diffText(previous.lines, lines) || "แก้รายละเอียดบรรทัด (% เผื่อเสีย/หมายเหตุ)" : `สร้างใหม่ ${lines.length} บรรทัด`;
    if (previous) { previous.status = "superseded"; previous.supersededAt = ctx.now; }
    const bom = { id: nextId(d, "BOM", ctx.now), itemCode: parent.code, revision: (previous?.revision ?? 0) + 1, status: "approved", ownerDept: parent.ownerDept, lines, createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note, changeLog: [{ at: ctx.now, by: user.name, text: `${changes}${note ? ` — ${note}` : ""}` }] };
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
    if (!itemOf(d, rootCode)) {
      if (!p.item?.name) fail(`ยังไม่มีชิ้นงาน ${rootCode} กรุณาระบุชื่อและหน่วยเพื่อสร้าง`);
      saveItem(d, { code: rootCode, kind: p.item.kind || "FG", name: p.item.name, uom: p.item.uom || "set", weightG: p.item.weightG, create: true }, ctx);
    } else if (p.item) {
      const current = itemOf(d, rootCode);
      const changed = (p.item.name && p.item.name.trim() !== current.name) || (p.item.uom && p.item.uom !== current.uom) || (p.item.weightG !== undefined && p.item.weightG !== "" && Number(p.item.weightG) !== Number(current.weightG || 0));
      if (changed) saveItem(d, { code: rootCode, kind: current.kind, name: p.item.name || current.name, uom: p.item.uom || current.uom, weightG: p.item.weightG }, ctx);
    }
    const auditBefore = d.audit.length;
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
        if (!child) {
          const spec = node.newItem ?? fail(`ไม่พบชิ้นงาน ${code} — ระบุชนิด ชื่อ และหน่วยเพื่อสร้าง`);
          saveItem(d, { code, kind: spec.kind, name: spec.name, uom: spec.uom, weightG: spec.weightG, rubber: spec.rubber, create: true }, ctx);
          child = itemOf(d, code);
          created.push(code);
        } else if (node.patch && Object.keys(node.patch).length) {
          saveItem(d, { code, kind: child.kind, name: node.patch.name || child.name, uom: node.patch.uom || child.uom, weightG: node.patch.weightG, rubber: node.patch.rubber }, ctx);
          patched.push(code);
        }
        if (Array.isArray(node.children) && node.children.length) {
          if (NO_BOM_KINDS.includes(child.kind)) fail(`${code} (${R.KINDS[child.kind].label}) มีส่วนประกอบไม่ได้`);
          // ชิ้นเดียวกันอยู่หลายที่ในต้นไม้: BOM ของมันบันทึกจากที่แรก ที่อื่นต้องมีลูกชุดเดียวกัน
          if (!seenPath.has(code)) { walk(code, node.children, [...path, code]); seenPath.add(code); } else {
            const current = approvedBomOf(d, code);
            const incoming = node.children.map((entry) => ({ childCode: R.canonicalCode(entry.code), qty: Number(entry.qty), scrapPct: Number(entry.scrapPct) || 0, note: String(entry.note ?? "").trim() }));
            if (!current || !sameLines(current.lines, incoming)) fail(`${code} ปรากฏหลายที่ในต้นไม้ด้วยส่วนประกอบต่างกัน แก้ให้เหมือนกันหรือใช้รหัสคนละตัว`);
          }
        }
        lines.push({ childCode: code, qty: node.qty, scrapPct: node.scrapPct, note: node.note });
      }
      const result = saveBom(d, { itemCode: parentCode, lines, note: p.note }, ctx);
      if (result.changed) saved.push(`${parentCode} Rev.${result.revision}`);
    };
    walk(rootCode, p.nodes, [rootCode]);
    const rootChanged = d.audit.length > auditBefore && d.audit.slice(0, d.audit.length - auditBefore).some((entry) => /ชิ้นงาน/.test(entry.action) && entry.detail.startsWith(rootCode));
    const parts = [saved.length ? `BOM: ${saved.join(", ")}` : "", created.length ? `สร้างชิ้นใหม่: ${created.join(", ")}` : "", patched.length ? `แก้ข้อมูลชิ้น: ${patched.join(", ")}` : "", rootChanged && !created.includes(rootCode) ? `แก้ข้อมูลสินค้า ${rootCode}` : ""].filter(Boolean);
    const changed = parts.length > 0;
    if (changed) audit(d, ctx, "บันทึกต้นไม้ BOM", `${rootCode}: ${parts.join(" · ")}`);
    return { code: rootCode, saved, created, patched, changed, summary: changed ? `บันทึกแล้ว — ${parts.join(" · ")}` : "ไม่มีการเปลี่ยนแปลง" };
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
  function importFlat(d, p, ctx) {
    const user = requirePlanner(ctx, "นำเข้า BOM");
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
      if (approvedBomOf(d, parent.code)) { stats.bomsSkipped += 1; continue; }
      const lines = entry.lines.filter((line) => itemOf(d, line.childCode) && Number(line.qty) > 0).map((line) => ({ childCode: R.canonicalCode(line.childCode), qty: Number(line.qty), uom: itemOf(d, line.childCode).uom, consumerDept: parent.ownerDept, producerDept: itemOf(d, line.childCode).ownerDept, scrapPct: 0, flags: line.flags ?? [], note: "" }));
      if (!lines.length) continue;
      d.boms.push({ id: nextId(d, "BOM", ctx.now), itemCode: parent.code, revision: 1, status: "approved", ownerDept: parent.ownerDept, lines, createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: `นำเข้าจาก ${p.source || "Excel"}`, changeLog: [{ at: ctx.now, by: user.name, text: `นำเข้าจาก ${p.source || "Excel"}` }] });
      stats.bomsAdded += 1;
    }
    const summary = `ชิ้นงานใหม่ ${stats.itemsAdded} (มีอยู่แล้ว ${stats.itemsMerged}) · BOM ใหม่ ${stats.bomsAdded} ข้าม ${stats.bomsSkipped}`;
    audit(d, ctx, "นำเข้า BOM จากชีต", `${p.source || "Excel"}: ${summary}`);
    return { ...stats, summary };
  }

  // ---------- ใบสั่งผลิต (PI) ----------
  function createOrder(d, p, ctx) {
    const user = requirePlanner(ctx, "เปิดใบสั่งผลิต");
    const R = rules();
    const id = text(p.pi, "เลขที่ PI", 40).toUpperCase();
    if (d.orders.some((order) => order.id === id)) fail(`มีใบสั่งผลิต ${id} อยู่แล้ว`);
    const orderedAt = p.orderedAt === null || p.orderedAt === "" ? NaN : Number(p.orderedAt);
    const whDue = p.whDue === null || p.whDue === "" ? NaN : Number(p.whDue);
    if (!Number.isFinite(orderedAt) || !Number.isFinite(whDue) || orderedAt <= 0 || whDue <= 0) fail("กรุณาระบุวันที่สั่งผลิตและวันส่งมอบคลัง");
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
    const parsed = R.parseColorCode(code) ?? fail(`รหัสสี ${code} ไม่ถูกต้อง (แม่สี 2 ตัวอักษร + เฉด 2 หลัก เช่น OR01)`);
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
      const child = itemOf(d, raw.childCode) ?? fail(`แพ็กเกจ ${code} บรรทัด ${index + 1}: ไม่พบชิ้นงาน ${R.canonicalCode(raw.childCode)}`);
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
    const src = itemOf(d, fromCode) ?? fail(`ไม่พบชิ้นงาน ${fromCode}`);
    const fromColor = String(src.rubber?.color || R.colorOfCode(fromCode) || "").toUpperCase();
    if (!itemOf(d, toCode)) {
      d.items.push({ ...src, code: toCode, name: R.renameColor(src.name, fromColor, color, d.colors ?? []), rubber: { ...(src.rubber ?? {}), color }, legacyCodes: [], createdAt: ctx.now, updatedAt: ctx.now, clonedFrom: fromCode });
      log.push(`สร้าง ${toCode} จาก ${fromCode}`);
    }
    const srcBom = approvedBomOf(d, fromCode);
    if (srcBom && !approvedBomOf(d, toCode)) {
      const lines = srcBom.lines.map((line) => {
        const child = itemOf(d, line.childCode);
        const childColor = R.colorOfCode(line.childCode);
        const recolor = child?.kind === "RB" && childColor && childColor === fromColor;
        if (child?.kind === "RB" && childColor && !recolor) log.push(`${line.childCode} ใต้ ${toCode} คงสี ${childColor} (ไม่ใช่สี ${fromColor || "-"} ของ SE เดิม)`);
        return { ...line, flags: [...(line.flags ?? [])], childCode: recolor ? ensureRecoloredItem(d, line.childCode, color, ctx, user, log) : line.childCode };
      });
      d.boms.push({ id: nextId(d, "BOM", ctx.now), itemCode: toCode, revision: 1, status: "approved", ownerDept: src.ownerDept, lines, createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: `เปลี่ยนสีจาก ${fromCode} Rev.${srcBom.revision} เป็น ${color}`, changeLog: [{ at: ctx.now, by: user.name, text: `เปลี่ยนสีจาก ${fromCode} Rev.${srcBom.revision} เป็น ${color}` }] });
    }
    return toCode;
  }
  // สร้างรุ่นสินค้าใหม่จากต้นแบบฐานรหัสเดียวกัน: คัดลอก BOM แล้วใช้นิยามชุดสี (เปลี่ยนสี SE/RB ชั้นแรกและ RB ใต้ SE) และแพ็กเกจ (สลับบรรทัดบรรจุภัณฑ์)
  // ถ้าฐานรหัสยังไม่มีนิยาม ทำแบบเดิม (คัดลอกตรง) และบันทึกไว้ใน changeLog ว่าสียังเป็นของต้นแบบ
  function cloneFg(d, code, source, { pkg, colorSet }, ctx) {
    const user = requireUser(ctx);
    const R = rules();
    const sourceBom = approvedBomOf(d, source.code) ?? fail(`${source.code} ยังไม่มี BOM`);
    const { base, pkg: sourcePkg, colorSet: sourceSet } = R.parseFgCode(source.code);
    const label = [pkg ? `แพ็กเกจ ${pkg}` : "", colorSet ? `ชุดสี ${colorSet}` : ""].filter(Boolean).join(" ");
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
      const removed = lines.filter((line) => packaging.has(line.childCode)).map((line) => line.childCode);
      const dropped = removed.filter((code) => !target.has(code));
      lines = lines.filter((line) => !packaging.has(line.childCode));
      for (const line of pkgDef.lines) {
        const child = itemOf(d, line.childCode) ?? fail(`แพ็กเกจ ${pkg}: ไม่พบชิ้นงาน ${line.childCode}`);
        lines.push({ childCode: child.code, qty: line.qty, uom: child.uom, consumerDept: "PK", producerDept: child.ownerDept, scrapPct: 0, flags: [], note: `แพ็กเกจ ${pkg}` });
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
    d.items.push({ code, kind: "FG", name: `${source.name}${label ? ` (${label})` : ""}`, ownerDept: "PK", uom: source.uom, weightG: source.weightG ?? 0, group: source.group ?? "TOY", legacyCodes: [], rubber: null, active: true, createdAt: ctx.now, clonedFrom: source.code });
    d.boms.push({ id: nextId(d, "BOM", ctx.now), itemCode: code, revision: 1, status: "approved", ownerDept: "PK", lines: merged, createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: log[0], changeLog: log.map((text) => ({ at: ctx.now, by: user.name, text })) });
    audit(d, ctx, "สร้างสินค้าจากฐานรหัสเดียวกัน", `${code} ← ${source.code} Rev.${sourceBom.revision}${log.length > 1 ? ` · ${log.slice(1).join(" · ")}` : ""}`);
  }
  // สร้างรุ่นสินค้า (ฐาน + แพ็กเกจ + ชุดสี) โดยไม่ต้องผ่านใบสั่งผลิต — จุดเดียวกับที่ addOrderItem ใช้
  function createVariant(d, p, ctx) {
    requirePlanner(ctx, "สร้างรุ่นสินค้า");
    const R = rules();
    const pkg = String(p.pkg ?? "").trim().toUpperCase();
    const colorSet = String(p.colorSet ?? "").trim().toUpperCase();
    const code = R.buildFgCode(text(p.base, "ฐานรหัสสินค้า", 60), pkg, colorSet);
    if (itemOf(d, code)) fail(`มี ${code} อยู่แล้ว`);
    const siblings = siblingsOf(d, p.base);
    if (!siblings.length) fail(`ไม่มีฐานรหัส ${R.canonicalCode(p.base)} ที่มี BOM ใน item master`);
    const source = (p.cloneFrom && siblings.find((item) => item.code === R.canonicalCode(p.cloneFrom))) ?? pickSibling(siblings, pkg, colorSet);
    cloneFg(d, code, source, { pkg, colorSet }, ctx);
    return code;
  }

  // เลือกสินค้าด้วยรหัสเต็ม (fgCode) หรือ 3 ช่องแบบชีต ;}o (base + pkg + colorSet) — รหัสเต็มที่ยังไม่มีแต่มีฐานรหัสเดียวกัน จะสร้างจากต้นแบบให้
  function addOrderItem(d, p, ctx) {
    requirePlanner(ctx, "แก้รายการสินค้า");
    const order = orderById(d, p.orderId);
    editable(order);
    const R = rules();
    const byParts = !p.fgCode && p.base;
    const pkg = String(p.pkg ?? "").trim().toUpperCase();
    const colorSet = String(p.colorSet ?? "").trim().toUpperCase();
    const code = byParts ? R.buildFgCode(text(p.base, "ฐานรหัสสินค้า", 60), pkg, colorSet) : R.canonicalCode(p.fgCode);
    let fg = itemOf(d, code);
    if (!fg && byParts) {
      const siblings = siblingsOf(d, p.base);
      if (!siblings.length) fail(`ไม่มีฐานรหัส ${R.canonicalCode(p.base)} ที่มี BOM ใน item master`);
      const source = (p.cloneFrom && siblings.find((item) => item.code === R.canonicalCode(p.cloneFrom))) ?? pickSibling(siblings, pkg, colorSet);
      cloneFg(d, code, source, { pkg, colorSet }, ctx);
      fg = itemOf(d, code);
    }
    if (!fg) fail("ไม่พบสินค้า");
    if (fg.kind !== "FG") fail("เลือกได้เฉพาะสินค้าสำเร็จรูป (FG)");
    if (!approvedBomOf(d, fg.code)) fail(`${fg.code} ยังไม่มี BOM (สร้างได้ที่เมนู "สร้าง BOM")`);
    const qty = num(p.qty, "จำนวนสั่ง");
    const existing = order.items.find((item) => item.fgCode === fg.code);
    if (existing) existing.qty += qty;
    else order.items.push({ fgCode: fg.code, qty, colorSet: (colorSet || R.parseFgCode(fg.code).colorSet).slice(0, 10), note: String(p.note ?? "").trim().slice(0, 120) });
    order.explosion = null;
    audit(d, ctx, "เพิ่มสินค้าในใบสั่งผลิต", `${order.id} ${fg.code} × ${qty}`);
    return order.id;
  }

  function removeOrderItem(d, { orderId, fgCode }, ctx) {
    requirePlanner(ctx, "แก้รายการสินค้า");
    const order = orderById(d, orderId);
    editable(order);
    const before = order.items.length;
    order.items = order.items.filter((item) => item.fgCode !== rules().canonicalCode(fgCode));
    if (order.items.length === before) fail("ไม่พบสินค้านี้ในใบ");
    order.explosion = null;
    audit(d, ctx, "ลบสินค้าออกจากใบสั่งผลิต", `${order.id} ${fgCode}`);
    return order.id;
  }

  function explodeOrder(d, { orderId }, ctx) {
    requirePlanner(ctx, "ระเบิด BOM");
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

  function releaseOrder(d, { orderId }, ctx) {
    const user = requirePlanner(ctx, "ปล่อยผลิต");
    const order = orderById(d, orderId);
    editable(order);
    explodeOrder(d, { orderId }, ctx);
    const R = rules();
    const noBom = order.explosion.filter((line) => line.noBom).map((line) => line.itemCode);
    if (noBom.length) fail(`ชิ้นที่ต้องผลิตแต่ยังไม่มี BOM: ${[...new Set(noBom)].join(", ")}`);
    // ปริมาณงาน = ความต้องการสุทธิหลังหักคงคลังที่นับ ไล่ชั้นแบบคอลัมน์ AK ของ BOMSHEET (SE ที่มีในคลังลดเส้น RB ที่ต้องรีด)
    // งาน PK ของตัว FG ใช้จำนวนสั่งเสมอ (ใบตรวจสอบคงคลังมีแถว FG แต่ของสำเร็จรูปในคลังไม่ลดงานบรรจุของใบนี้)
    const net = R.netRequirements(order.explosion, order.stockCounts);
    let covered = 0;
    for (const entry of net) {
      if (!R.MANUFACTURED.includes(entry.kind) || entry.kind === "FG") continue;
      if (entry.toMake <= 0) { covered += 1; continue; }
      d.jobs.push({ id: nextId(d, "JOB", ctx.now), orderId: order.id, dept: entry.dept, itemCode: entry.itemCode, name: entry.name, kind: entry.kind, uom: entry.uom, qtyPlanned: entry.toMake, qtyRequired: entry.required, stockCounted: entry.stock ?? null, qtyDone: 0, qtyReject: 0, dueAt: order.due[entry.dept] ?? order.whDue, status: "queued", externalRef: null, fgCodes: entry.fgCodes, createdAt: ctx.now, reports: [] });
    }
    for (const item of order.items) {
      const fg = itemOf(d, item.fgCode);
      d.jobs.push({ id: nextId(d, "JOB", ctx.now), orderId: order.id, dept: "PK", itemCode: fg.code, name: fg.name, kind: "FG", uom: fg.uom, qtyPlanned: item.qty, qtyRequired: item.qty, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: order.due.PK ?? order.whDue, status: "queued", externalRef: null, fgCodes: [fg.code], createdAt: ctx.now, reports: [] });
    }
    order.status = "released";
    order.releasedAt = ctx.now;
    order.releasedBy = user.name;
    audit(d, ctx, "ปล่อยผลิต", `${order.id} สร้างงาน ${d.jobs.filter((job) => job.orderId === order.id).length} รายการ${covered ? ` · ${covered} ชิ้นมีคงคลังพอ ไม่สร้างงาน` : ""}`);
    return order.id;
  }

  function setStockCount(d, { orderId, itemCode, qty }, ctx) {
    const user = requireUser(ctx);
    if (!canCount(user)) fail("บันทึกยอดคงคลังได้โดยคลัง (ST) ฝ่ายวางแผน หรือผู้จัดการ");
    const order = orderById(d, orderId);
    // นับได้เฉพาะใบร่าง: งานรายแผนกถูกสร้างจากยอดสุทธิตอนปล่อยผลิตครั้งเดียว ยอดที่นับทีหลังจะไม่เปลี่ยนงาน
    if (order.status !== "draft") fail(`นับคงคลังได้เฉพาะใบร่าง (ใบนี้${order.status === "completed" || order.status === "cancelled" ? "ปิดแล้ว" : "ปล่อยผลิตแล้ว งานรายแผนกไม่เปลี่ยนตาม"})`);
    const code = rules().canonicalCode(itemCode);
    const line = order.explosion?.find((entry) => entry.itemCode === code);
    if (!line) fail("ชิ้นงานนี้ไม่อยู่ในใบ (ระเบิด BOM ก่อน)");
    if (line.level === 0) fail("ตัวสินค้าสำเร็จรูปไม่นับคงคลังในใบ (ต้องผลิตครบจำนวนสั่ง)");
    const value = num(qty, "ยอดคงคลัง", { allowZero: true });
    order.stockCounts[code] = value;
    order.stockCountedAt = ctx.now;
    order.stockCountedBy = user.name;
    audit(d, ctx, "นับคงคลังตามใบ", `${order.id} ${code} = ${value}`);
    return code;
  }

  function cancelOrder(d, { orderId, reason }, ctx) {
    requirePlanner(ctx, "ยกเลิกใบ");
    const order = orderById(d, orderId);
    if (order.status === "completed") fail("ใบที่เสร็จแล้วยกเลิกไม่ได้");
    if (d.jobs.some((job) => job.orderId === order.id && job.qtyDone > 0)) fail("มีงานที่รายงานผลผลิตแล้ว ยกเลิกไม่ได้ ให้ปิดใบแทน");
    const linked = d.jobs.filter((job) => job.orderId === order.id && job.externalRef);
    if (linked.length) fail(`มีงานที่สร้าง WO ใน RubberFlow แล้ว (${linked.map((job) => job.externalRef.woId).join(", ")}) ยกเลิก WO ใน RubberFlow ก่อน`);
    order.status = "cancelled";
    order.cancelledAt = ctx.now;
    order.cancelReason = String(reason ?? "").trim().slice(0, 200);
    d.jobs = d.jobs.filter((job) => job.orderId !== order.id);
    audit(d, ctx, "ยกเลิกใบสั่งผลิต", `${order.id}${order.cancelReason ? ` — ${order.cancelReason}` : ""}`);
    return order.id;
  }

  function completeOrder(d, { orderId }, ctx) {
    requirePlanner(ctx, "ปิดใบ");
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
    if (!["released", "in_progress"].includes(orderById(d, job.orderId).status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    job.status = status;
    audit(d, ctx, "เปลี่ยนสถานะงาน", `${job.id} → ${status}`);
    return job.id;
  }

  function linkJobToRubberFlow(d, { jobId, woId, kg }, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, jobId);
    if (job.dept !== "RB") fail("เชื่อม RubberFlow ได้เฉพาะงานของแผนก RB");
    if (!canWorkJob(user, job) && user.role !== "planner") fail("เชื่อม RubberFlow ได้โดยแผนก RB ฝ่ายวางแผน หรือผู้จัดการ");
    if (job.externalRef?.woId) fail(`งานนี้ผูกกับ ${job.externalRef.woId} อยู่แล้ว`);
    if (!["released", "in_progress"].includes(orderById(d, job.orderId).status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    job.externalRef = { system: "rubberflow", woId: text(woId, "เลข WO", 40), kg: Number(kg) || 0, linkedAt: ctx.now, by: user.name };
    if (job.status === "queued") job.status = "in_progress";
    const order = orderById(d, job.orderId);
    if (order.status === "released") order.status = "in_progress";
    audit(d, ctx, "เชื่อมงาน RB กับ RubberFlow", `${job.id} → ${job.externalRef.woId}`);
    return job.id;
  }

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
    saveItem, saveBom, saveBomTree, linkCompound, importFlat,
    saveColor, saveColorSet, removeColorSet, learnColorSet, savePackage, removePackage, createVariant,
    createOrder, addOrderItem, removeOrderItem, explodeOrder, releaseOrder, setStockCount, cancelOrder, completeOrder,
    reportJob, setJobStatus, linkJobToRubberFlow,
    helpers: { itemOf, approvedBomOf, bomById, canPlan, canCount, canWorkJob, isBoss, rbJobKg, siblingsOf, pickSibling, colorSetOf, packageOf, NO_BOM_KINDS },
  };
  if (isNode) module.exports = api;
  else root.MNP_BOM_ACTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
