// BOM รายแผนก (โหมดทดสอบ) — กฎธุรกิจทั้งหมด: item master · BOM หลายชั้น (จุดสร้างจุดเดียว บันทึกแล้วใช้ได้ทันที เก็บเป็น revision) ·
// นำเข้าจากชีต · ใบสั่งผลิต (PI) ระเบิด/ปล่อยผลิต · งานรายแผนก · นับคงคลังตามใบ · สต็อกของซื้อ (นับ/เบิกจ่ายรายใบ) · ผูกสูตรยางกับ RubberFlow
// ทุก action รับ (draft, payload, ctx{now,user}) ทำบนร่างและ throw เมื่อกฎไม่ผ่าน (store บันทึกเฉพาะเมื่อผ่าน)
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
  const canCount = (user) => canPlan(user) || user?.role === "st" || user?.role === "wh"; // นับคงคลังของใบร่าง: ฝ่ายวางแผน ผู้จัดการ ผู้ดูแล หรือพนักงานแผนก ST / WH
  // ของซื้อ: งานของซื้อ (ST / PURCHASED) เปลี่ยนผลงานได้ทางเดียวคือ "เบิกจ่ายของซื้อ" ของใบ (issueOrderParts) · เบิกจ่าย = กลุ่มวางแผนหรือแผนก ST · สต็อกขั้นต่ำแก้ได้เฉพาะกลุ่มวางแผน
  const isPartJob = (job) => job?.dept === "ST" && job?.kind === "PURCHASED";
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
      const stack = [childCode];
      const visited = new Set();
      while (stack.length) {
        const code = stack.pop();
        if (code === parent.code) fail(`${parent.code}: ${childCode} มี ${parent.code} อยู่ข้างใต้ จะเป็นวงจร`);
        if (visited.has(code)) continue;
        visited.add(code);
        approvedBomOf(d, code)?.lines.forEach((line) => stack.push(line.childCode));
      }
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
  // ทุกจุดที่เขียน BOM เรียงบรรทัดตามผังงาน (rules.sortLinesByFlow) ผู้ใช้จึงลากย้ายได้เฉพาะภายในแผนกเดียวกัน
  const sortLines = (d, lines) => rules().sortLinesByFlow(lines, (code) => itemOf(d, code));
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
    const lines = sortLines(d, normalizeLines(d, parent, p.lines));
    // เส้นยาง: บรรทัดเดียวคือสูตรยางของมัน และต้องตรงกับช่องสูตรของเส้นยาง (รหัส RB ก็มีรหัสสูตรอยู่ในตัว)
    if (parent.kind === "RB") {
      if (lines.length > 1) fail(`เส้นยาง ${parent.code} ใช้สูตรยางได้สูตรเดียว`);
      const compound = parent.rubber?.compound ?? "";
      if (compound && R.canonicalCode(compound) !== lines[0].childCode) fail(`เส้นยาง ${parent.code} ระบุสูตร ${compound} แต่บรรทัดสูตรยางเป็น ${lines[0].childCode} แก้ให้ตรงกัน`);
    }
    const note = String(p.note ?? "").trim().slice(0, 300);
    const previous = approvedBomOf(d, parent.code);
    // ชิ้นที่เลิกใช้: BOM เดิมที่ใช้อยู่ยังบันทึกซ้ำได้ แต่เพิ่มเป็นบรรทัดใหม่ไม่ได้
    const retired = lines.map((line) => line.childCode).filter((code) => itemOf(d, code)?.active === false && !previous?.lines.some((line) => line.childCode === code));
    if (retired.length) fail(`${parent.code}: ${retired.join(", ")} เลิกใช้แล้ว เพิ่มเป็นส่วนประกอบใหม่ไม่ได้ (ลบบรรทัดนั้นออก หรือเปิดใช้ชิ้นงานอีกครั้งที่ “แก้ข้อมูลชิ้นงาน”)`);
    // เทียบกับ revision เดิมที่เรียงด้วยกฎปัจจุบัน: ถ้าแผนกเจ้าของของลูกเพิ่งเปลี่ยน ลำดับเก่าที่ค้างไม่นับเป็นการแก้ BOM
    if (previous && sameLines(sortLines(d, previous.lines), lines)) return { id: previous.id, revision: previous.revision, changed: false };
    const changes = previous ? diffText(previous.lines, lines) || (sameLinesAnyOrder(previous.lines, lines) ? "เรียงลำดับส่วนประกอบใหม่" : "แก้รายละเอียดบรรทัด (% เผื่อเสีย/หมายเหตุ/ขั้นที่)") : `สร้างใหม่ ${lines.length} บรรทัด`;
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
            if (!current || !sameLines(current.lines, sortLines(d, incoming))) fail(`${code} ปรากฏหลายที่ในต้นไม้ด้วยส่วนประกอบต่างกัน แก้ให้เหมือนกันหรือใช้รหัสคนละตัว`);
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
    if (started.length) fail(`แก้รายการไม่ได้ มีงานที่เริ่มแล้ว (${started.map((job) => `${job.dept} ${job.itemCode}`).slice(0, 3).join(", ")}${started.length > 3 ? " …" : ""}) ให้ปิดใบแล้วเปิดใบใหม่สำหรับส่วนที่เพิ่ม`);
    const removed = d.jobs.filter((job) => job.orderId === order.id).length;
    d.jobs = d.jobs.filter((job) => job.orderId !== order.id);
    order.status = "draft";
    order.revision = (order.revision ?? 0) + 1;
    delete order.releasedAt;
    delete order.releasedBy;
    order.explodedAt = null; // ยอดคงคลังที่นับไว้คงอยู่ (ของในคลังไม่เปลี่ยนเพราะแก้ใบ) และถูกหักอีกครั้งตอนปล่อยผลิตใหม่
    audit(d, ctx, "เปิดใบที่ปล่อยผลิตแล้วกลับมาแก้", `${order.id} REV.${order.revision} ลบงานรายแผนก ${removed} รายการ`);
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
      d.boms.push({ id: masterId(d, "BOM", ctx), itemCode: toCode, revision: 1, status: "approved", ownerDept: src.ownerDept, lines: sortLines(d, lines), createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: `เปลี่ยนสีจาก ${fromCode} Rev.${srcBom.revision} เป็น ${color}`, changeLog: [{ at: ctx.now, by: user.name, text: `เปลี่ยนสีจาก ${fromCode} Rev.${srcBom.revision} เป็น ${color}` }] });
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
    d.items.push({ code, kind: "FG", name: `${source.name}${label ? ` (${label})` : ""}`.slice(0, 160), ownerDept: "PK", uom: source.uom, weightG: source.weightG ?? 0, group: source.group ?? "TOY", legacyCodes: [], rubber: null, active: true, createdAt: ctx.now, clonedFrom: source.code });
    d.boms.push({ id: masterId(d, "BOM", ctx), itemCode: code, revision: 1, status: "approved", ownerDept: "PK", lines: sortLines(d, merged), createdBy: user.name, createdAt: ctx.now, approvedBy: user.name, approvedAt: ctx.now, note: log[0], changeLog: log.map((text) => ({ at: ctx.now, by: user.name, text })) });
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
    if (!siblings.length) fail(`ไม่มีฐานรหัส ${R.canonicalCode(p.base)} ที่มี BOM ในทะเบียนชิ้นงาน`);
    const source = (p.cloneFrom && siblings.find((item) => item.code === R.canonicalCode(p.cloneFrom))) ?? pickSibling(siblings, pkg, colorSet);
    cloneFg(d, code, source, { pkg, colorSet }, ctx);
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
      cloneFg(d, code, source, { pkg, colorSet }, ctx);
      fg = itemOf(d, code);
    }
    if (!fg) fail("ไม่พบสินค้า");
    if (fg.kind !== "FG") fail("เลือกได้เฉพาะสินค้าสำเร็จรูป (FG)");
    if (!approvedBomOf(d, fg.code)) fail(`${fg.code} ยังไม่มี BOM (สร้างได้ที่เมนู "สร้าง BOM")`);
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
    order.explosion = null;
    audit(d, ctx, "แก้จำนวนสินค้าในใบสั่งผลิต", `${order.id} ${code} ${before} → ${qty}`);
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
      // เส้นยางรีดเป็นเส้น/ม้วนเต็ม: แผนของงาน RB ปัดขึ้น (7.74 เส้น → 8 เส้น) · qtyRequired ยังเป็นยอดที่ใบต้องการจริง WO และเคมีจึงคิดจากเส้นเต็ม
      d.jobs.push({ id: masterId(d, "JOB", ctx), orderId: order.id, dept: entry.dept, itemCode: entry.itemCode, name: entry.name, kind: entry.kind, uom: entry.uom, qtyPlanned: R.wholeRods(entry.kind, entry.uom, entry.toMake), qtyRequired: entry.required, stockCounted: entry.stock ?? null, qtyDone: 0, qtyReject: 0, dueAt: order.due[entry.dept] ?? order.whDue, status: "queued", externalRef: null, fgCodes: entry.fgCodes, createdAt: ctx.now, reports: [] });
    }
    for (const item of order.items) {
      const fg = itemOf(d, item.fgCode);
      d.jobs.push({ id: masterId(d, "JOB", ctx), orderId: order.id, dept: "PK", itemCode: fg.code, name: fg.name, kind: "FG", uom: fg.uom, qtyPlanned: item.qty, qtyRequired: item.qty, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: order.due.PK ?? order.whDue, status: "queued", externalRef: null, fgCodes: [fg.code], createdAt: ctx.now, reports: [] });
    }
    // ของซื้อ: หนึ่งงาน ST ต่อรายการของซื้อที่ระเบิดได้ ยอด = ความต้องการเต็ม (ไม่หักยอดนับตามใบ สต็อกของซื้อเป็นยอดรวมต่อรหัส) · ST เบิกจ่ายครั้งเดียวต่อใบ (issueOrderParts)
    for (const entry of net) {
      if (entry.kind !== "PURCHASED" || !(entry.required > 0)) continue;
      d.jobs.push({ id: masterId(d, "JOB", ctx), orderId: order.id, dept: "ST", itemCode: entry.itemCode, name: entry.name, kind: "PURCHASED", uom: entry.uom, qtyPlanned: entry.required, qtyRequired: entry.required, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: order.due.ST ?? order.whDue, status: "queued", externalRef: null, fgCodes: entry.fgCodes, createdAt: ctx.now, reports: [] });
    }
    order.status = "released";
    order.releasedAt = ctx.now;
    order.releasedBy = user.name;
    audit(d, ctx, "ปล่อยผลิต", `${order.id} สร้างงาน ${d.jobs.filter((job) => job.orderId === order.id).length} รายการ${covered ? ` · ${covered} ชิ้นมีคงคลังพอ ไม่สร้างงาน` : ""}`);
    return order.id;
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
    if (!line) fail("ชิ้นงานนี้ไม่อยู่ในใบ (ระเบิด BOM ก่อน)");
    if (line.level === 0) fail("ตัวสินค้าสำเร็จรูปไม่นับคงคลังในใบ (ต้องผลิตครบจำนวนสั่ง)");
    if (line.kind === "PURCHASED") fail(`${code} เป็นของซื้อ นับที่เมนู “คลังของซื้อ” (ยอดรวมต่อรหัส) ไม่นับตามใบ`);
    const value = num(qty, "ยอดคงคลัง", { allowZero: true });
    order.stockCounts[code] = value;
    order.stockCountedAt = ctx.now;
    order.stockCountedBy = user.name;
    audit(d, ctx, "นับคงคลังตามใบ", `${order.id} ${code} = ${value}`);
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

  function cancelOrder(d, { orderId, reason }, ctx) {
    requirePlanner(ctx, "ยกเลิกใบ");
    const order = orderById(d, orderId);
    if (order.status === "completed") fail("ใบที่เสร็จแล้วยกเลิกไม่ได้");
    if (d.jobs.some((job) => job.orderId === order.id && job.qtyDone > 0)) fail("มีงานที่รายงานผลผลิตแล้ว ยกเลิกไม่ได้ ให้ปิดใบแทน");
    // WO ที่ยังเป็นแผนก/ปล่อยผลิต ฐานข้อมูลยกเลิกให้พร้อมใบ · ที่เริ่มแล้วต้องปิดหรือยกเลิกใน RubberFlow ก่อน
    const linked = d.jobs.filter((job) => job.orderId === order.id && woStarted(job, ctx.rfOrders));
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
  // รายงานผล/เปลี่ยนสถานะงาน: ฝ่ายวางแผน ผู้จัดการ ผู้ดูแล (ทุกแผนก) หรือพนักงานทุกบทบาทของแผนกเจ้าของงาน · แผนกอื่นดูได้อย่างเดียว
  const canWorkJob = (user, job) => canPlan(user) || (Boolean(user?.dept) && user.dept === job.dept);
  // ผูกงาน RB กับ RubberFlow: ฝ่ายวางแผน ผู้จัดการ ผู้ดูแล หรือแผนก RB
  const canLinkRubberflow = (user, job) => job?.dept === "RB" && (canPlan(user) || user?.dept === "RB");

  function reportJob(d, p, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, p.jobId);
    if (isPartJob(job)) fail("งานของซื้อ (ST) รายงานผลเองไม่ได้ ใช้ปุ่ม “เบิกจ่ายของซื้อ” ที่ใบสั่งผลิต");
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
    if (isPartJob(job)) fail("งานของซื้อ (ST) เปลี่ยนสถานะเองไม่ได้ ใช้ปุ่ม “เบิกจ่ายของซื้อ” ที่ใบสั่งผลิต");
    if (!canWorkJob(user, job)) fail(`เปลี่ยนสถานะได้โดยแผนก ${job.dept} หรือผู้จัดการ`);
    if (!["queued", "in_progress", "hold"].includes(status)) fail("สถานะไม่ถูกต้อง");
    if (job.status === "done") fail("งานที่เสร็จแล้วเปลี่ยนสถานะไม่ได้");
    if (!["released", "in_progress"].includes(orderById(d, job.orderId).status)) fail("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    job.status = status;
    audit(d, ctx, "เปลี่ยนสถานะงาน", `${job.id} → ${status}`);
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
      if (safety !== oldSafety && !canPlan(user)) fail("ตั้งสต็อกขั้นต่ำได้โดยฝ่ายวางแผนหรือผู้จัดการ");
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

  // แผนเบิกจ่ายของซื้อของใบ: ทุกงานของซื้อที่ยังไม่เสร็จ จ่ายเต็มส่วนที่เหลือ · short = รายการที่สต็อกไม่พอ (เบิกจ่ายไม่ได้ทั้งใบ) · ใช้ทั้งใน action และหน้าต่างยืนยัน
  function partIssuePlan(d, orderId) {
    const lines = d.jobs.filter((job) => job.orderId === orderId && isPartJob(job) && job.status !== "done").sort((a, b) => a.itemCode.localeCompare(b.itemCode))
      .map((job) => {
        const remaining = Math.max(0, qtyRound(Number(job.qtyPlanned) - Number(job.qtyDone || 0)));
        const onHand = stockRowOf(d, job.itemCode)?.qty ?? 0;
        return { job, itemCode: job.itemCode, name: job.name, uom: job.uom, remaining, onHand, short: Math.max(0, qtyRound(remaining - onHand)) };
      });
    return { lines, short: lines.filter((line) => line.short > 0), anyShort: lines.some((line) => line.short > 0) };
  }
  // เบิกจ่ายของซื้อของใบ PI ครั้งเดียว: ทุกรายการจ่ายเต็มส่วนที่เหลือและหักสต็อก ถ้ารายการใดสต็อกไม่พอ = ไม่จ่ายอะไรเลย (บอกที่ขาด)
  function issueOrderParts(d, { orderId }, ctx) {
    const user = requireUser(ctx);
    if (!canIssueParts(user)) fail("เบิกจ่ายของซื้อได้โดยคลังวัตถุดิบ (ST) ฝ่ายวางแผน หรือผู้จัดการ");
    const order = orderById(d, orderId);
    if (!["released", "in_progress"].includes(order.status)) fail("เบิกจ่ายของซื้อได้เฉพาะใบที่ปล่อยผลิตแล้ว");
    d.stock ??= [];
    const plan = partIssuePlan(d, order.id);
    if (!plan.lines.length) fail("ใบนี้ไม่มีของซื้อที่ต้องเบิกจ่าย (เบิกจ่ายครบแล้ว หรือปล่อยผลิตก่อนมีงานของซื้อ)");
    if (plan.anyShort) fail(`สต็อกของซื้อไม่พอ จึงไม่ได้เบิกจ่ายอะไรเลย: ${plan.short.map((line) => `${line.itemCode} ขาด ${qtyRound(line.short)} ${rules().uomLabel(line.uom)}`).join(", ")}`);
    for (const line of plan.lines) {
      const row = stockRowOf(d, line.itemCode);
      if (line.remaining > 0) {
        row.qty = qtyRound(row.qty - line.remaining);
        row.updatedAt = ctx.now;
        pushMove(d, ctx, line.itemCode, "issue", -line.remaining, row.qty, order.id);
      }
      line.job.qtyDone = line.job.qtyPlanned;
      line.job.status = "done";
      line.job.doneAt = ctx.now;
    }
    // โหมดฐานข้อมูล: ใบ released -> in_progress เป็นของเซิร์ฟเวอร์ (กติกางานเริ่ม) ไม่ส่งเป็นการแก้ใบ
    if (!ctx.remote && order.status === "released") order.status = "in_progress";
    audit(d, ctx, "เบิกจ่ายของซื้อ", `${order.id} ${plan.lines.length} รายการ`);
    return { issued: plan.lines.length, summary: `${plan.lines.length} รายการ` };
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
    for (const job of d.jobs) {
      if (job.orderId !== order.id || !isPartJob(job) || job.status !== "done") continue;
      job.status = "queued";
      job.qtyDone = 0;
      delete job.doneAt;
    }
    audit(d, ctx, "ยกเลิกการเบิกจ่ายของซื้อ", `${order.id} ${lines.length} รายการ · ${why}`);
    return { returned: moves, summary: `${lines.length} รายการ`, request: { orderId: order.id, mode: "undo", reason: why } };
  }
  // คืนของเหลือ: lines [{ itemCode, qty }] คืนรายการละจำนวนที่พิมพ์ (ไม่เกินที่คืนได้) งานยังเป็น done ใบยังนับว่าเบิกจ่ายแล้ว · ทั้งชุดผ่านหรือไม่ผ่านพร้อมกัน
  function returnOrderParts(d, { orderId, lines, reason }, ctx) {
    const user = requireUser(ctx);
    if (!canIssueParts(user)) fail("คืนของซื้อได้โดยคลังวัตถุดิบ (ST) ฝ่ายวางแผน หรือผู้จัดการ");
    const why = returnReason(reason);
    const order = orderById(d, orderId);
    if (!["released", "in_progress", "completed"].includes(order.status)) fail("คืนของเหลือได้เฉพาะใบที่ปล่อยผลิตแล้ว (ใบที่ยกเลิกคืนไม่ได้)");
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
      const qty = qtyRound(num(entry.qty, "จำนวนที่คืน"));
      if (qty > 1e9) fail("ตัวเลขใหญ่เกินไป");
      if (qty > line.returnable) fail(`${code} คืนได้อีกไม่เกิน ${rules().fmtQty(line.returnable)} (เบิกจ่าย ${rules().fmtQty(line.issued)} คืนไปแล้ว ${rules().fmtQty(line.returned)})`);
      return { code, qty };
    }).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    for (const { code, qty } of plan) addReturn(d, ctx, order, code, qty, why);
    audit(d, ctx, "คืนของเหลือของซื้อ", `${order.id} ${plan.length} รายการ · ${why}`);
    return { returned: plan.length, summary: `${plan.length} รายการ`, request: { orderId: order.id, mode: "leftover", reason: why, lines: plan.map(({ code, qty }) => ({ itemCode: code, qty })) } };
  }

  function linkJobToRubberFlow(d, { jobId, woId, kg }, ctx) {
    const user = requireUser(ctx);
    const job = jobById(d, jobId);
    if (job.dept !== "RB") fail("เชื่อม RubberFlow ได้เฉพาะงานของแผนก RB");
    if (!canLinkRubberflow(user, job)) fail("เชื่อม RubberFlow ได้โดยแผนก RB ฝ่ายวางแผน หรือผู้จัดการ");
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
    if (cancelled.length) parts.push(`ยกเลิก WO ${cancelled.join(", ")} ด้วย`);
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
    saveCustomer, createOrder, addOrderItem, removeOrderItem, updateOrderItem, explodeOrder, releaseOrder, setStockCount, setStockCounts, cancelOrder, completeOrder,
    reportJob, setJobStatus, linkJobToRubberFlow, saveRouting, saveProcess, setItemCost, setItemImage, countPartStock, issueOrderParts, undoOrderParts, returnOrderParts,
    helpers: { customerName, customerKey, startedJobs, isPartJob, canIssueParts, partIssuePlan, stockRowOf, itemOf, approvedBomOf, routingOf, processOf, processesOf, bomById, canPlan, canCount, canWorkJob, canLinkRubberflow, isBoss, rbJobKg, rubberflowNotice, siblingsOf, pickSibling, colorSetOf, packageOf, NO_BOM_KINDS },
  };
  if (isNode) module.exports = api;
  else root.MNP_BOM_ACTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
