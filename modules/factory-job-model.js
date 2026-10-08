// ตรรกะของใบงานผลิต ขั้น 4–8 ของ workflow การผลิต (สายผลิตทุกแผนก โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-job-model.test.mjs)
//
// ใบงานผลิต = งานผลิต Item หนึ่งของใบสั่งผลิตหนึ่งใบตาม Routing: ฝ่ายวางแผน (PP) ออกใบงาน → แต่ละแผนกทำขั้นของตนตามลำดับ
// (ขั้นแรกเสร็จ = ตัดวัตถุดิบตาม BOM · ขั้นสุดท้ายเสร็จ = รับผลผลิตเข้าคลัง) กติกาตรงกับ RPC ใน
// supabase/migrations/20261007050000_factory_job_workflow.sql ฐานข้อมูลตรวจสิทธิ์/สถานะ/ลำดับ/ค่าทุกช่องเอง
// ที่นี่ใช้เลือกปุ่ม จัดคิวงานของแต่ละแผนก เสนอใบงานที่ควรออก และแสดงวัตถุดิบที่ต้องใช้เพื่อความสะดวกเท่านั้น (ซ่อนปุ่มไม่ใช่การควบคุมสิทธิ์)
(function (root) {
  const PLANNING_DEPARTMENT = "PP";
  const MAX_QUANTITY = 1000000000;

  const JOB_STATUSES = Object.freeze({
    open: "ออกใบงานแล้ว รอเริ่ม",
    in_progress: "กำลังผลิต",
    completed: "เสร็จแล้ว รับเข้าคลังแล้ว",
    cancelled: "ยกเลิก",
  });
  // class ของ .badge ใน styles.css ที่ใกล้เคียงที่สุด (เตือน = รอเริ่ม, ฟ้า = กำลังผลิต, เขียว = เสร็จ, แดง = ยกเลิก)
  const BADGE_CLASS = Object.freeze({ open: "pending_approval", in_progress: "in_progress", completed: "completed", cancelled: "cancelled" });
  const STEP_STATUSES = Object.freeze({ pending: "รอทำ", done: "เสร็จแล้ว" });
  const HISTORY_ACTIONS = Object.freeze({ create: "ออกใบงาน", step: "ทำขั้นตอนเสร็จ", complete: "ทำขั้นสุดท้ายเสร็จ รับเข้าคลัง", cancel: "ยกเลิกใบงาน", qc_fail: "ตรวจ QC ไม่ผ่าน (ออก NCR)", schedule: "กำหนด/เลื่อนตารางเวลา" });
  const ACTIVE_STATUSES = Object.freeze(["open", "in_progress"]);

  const isActive = (job) => ACTIVE_STATUSES.includes(job?.status);
  const stepsOf = (job) => (job?.steps ?? []).slice().sort((a, b) => a.sequence - b.sequence);

  // ขั้นถัดไปที่ต้องทำ = ขั้นแรกที่ยังรอทำ (ใบงานที่ไม่ active ไม่มี)
  function nextStep(job) {
    if (!isActive(job)) return null;
    return stepsOf(job).find((step) => step.status === "pending") ?? null;
  }
  const isLastPending = (job, step) => stepsOf(job).filter((row) => row.status === "pending").length === 1 && step?.status === "pending";

  // ทำขั้นนี้ได้เมื่อ: ใบงาน active · เป็นขั้นถัดไป · แผนกของผู้ใช้ตรงกับแผนกของขั้น (ฐานข้อมูลตรวจซ้ำ)
  function canRunStep(job, step, dept) {
    const next = nextStep(job);
    return Boolean(next && step && next.sequence === step.sequence && dept && step.department_code === dept);
  }

  // ใบงานที่ฝ่ายวางแผนทำได้: ยกเลิกได้ทั้งที่ยังไม่เริ่ม (open) และที่เริ่มแล้วแต่ผลผลิตยังไม่เข้าคลัง (in_progress)
  // ใบที่เริ่มแล้วคืนวัตถุดิบที่ตัดไปเข้าคลังเดิมในธุรกรรมเดียวกัน (20261007060000) ใบที่เสร็จแล้วยกเลิกไม่ได้
  const jobActions = (job, dept) => (dept === PLANNING_DEPARTMENT && isActive(job) ? ["cancel"] : []);

  // คิวของแผนก: ใบงานที่ขั้นถัดไปเป็นของแผนกนี้ (เก่าสุดก่อน) · งานที่กำลังจะมา = แผนกนี้ยังมีขั้นรอทำแต่ยังไม่ถึงคิว
  function deptQueue(jobs, dept) {
    const byOldest = (a, b) => String(a.job.created_at ?? "").localeCompare(String(b.job.created_at ?? "")) || String(a.job.code).localeCompare(String(b.job.code));
    const ready = [];
    const upcoming = [];
    for (const job of jobs ?? []) {
      const next = nextStep(job);
      if (!next) continue;
      if (next.department_code === dept) ready.push({ job, step: next });
      else {
        const mine = stepsOf(job).find((step) => step.status === "pending" && step.department_code === dept);
        if (mine) upcoming.push({ job, step: next, mine });
      }
    }
    return { ready: ready.sort(byOldest), upcoming: upcoming.sort(byOldest) };
  }

  const countByStatus = (jobs) => {
    const counts = Object.fromEntries(Object.keys(JOB_STATUSES).map((status) => [status, 0]));
    for (const job of jobs ?? []) if (job.status in counts) counts[job.status] += 1;
    return counts;
  };
  const jobsOf = (jobs, productionOrderId) => (jobs ?? []).filter((job) => job.production_order_id === productionOrderId);

  // ความคืบหน้าของใบงาน: ขั้นที่เสร็จ/ทั้งหมด
  function progress(job) {
    const steps = stepsOf(job);
    const done = steps.filter((step) => step.status === "done").length;
    return { done, total: steps.length, percent: steps.length ? Math.round((done / steps.length) * 100) : 0 };
  }

  const round4 = (value) => Math.round(value * 10000) / 10000;

  // วัตถุดิบที่ใบงานต้องใช้ตอนเริ่ม (BOM ที่อนุมัติของ Item × จำนวนของใบงาน เผื่อสูญเสียแบบบวกเพิ่ม ปัด 4 ทศนิยมต่อบรรทัด เหมือนฐานข้อมูล)
  // เทียบยอดคงคลังรวมทุกคลัง คืน null ถ้าไม่มี BOM ที่อนุมัติหรือจำนวนไม่ใช่จำนวนบวก
  function jobRequirements(data, itemId, quantity) {
    const bom = (data.boms ?? []).find((row) => row.item_id === itemId && row.status === "approved");
    const produce = Number(quantity);
    if (!bom || !Number.isFinite(produce) || produce <= 0) return null;
    const items = new Map((data.items ?? []).map((item) => [item.id, item]));
    const rows = (data.bom_lines ?? []).filter((line) => line.bom_id === bom.id).slice().sort((a, b) => a.line_no - b.line_no).map((line) => {
      const item = items.get(line.component_id);
      const need = round4((Number(line.quantity) * produce / Number(bom.output_qty)) * (1 + Number(line.scrap_percent) / 100));
      const stock = Number(item?.stock ?? 0);
      return { item_id: line.component_id, code: line.code ?? item?.code ?? "?", name: line.name ?? item?.name ?? "", unit_code: line.unit_code ?? item?.unit_code ?? "", need, stock, short: need > stock };
    }).filter((row) => row.need > 0);
    return { bom, rows, ready: rows.every((row) => !row.short) };
  }

  // ปริมาณที่ออกใบงานไปแล้วและยังไม่เสร็จ (open/in_progress) ของ Item หนึ่งในใบสั่งผลิตเดียว — ใบที่เสร็จนับในคงคลังแล้ว ใบที่ยกเลิกไม่นับ
  function inJobsQty(jobs, productionOrderId, itemId) {
    return round4(jobsOf(jobs, productionOrderId).filter((job) => isActive(job) && job.item_id === itemId).reduce((sum, job) => sum + Number(job.qty), 0));
  }

  // ใบงานที่ควรออกให้ใบสั่งผลิตที่ออกใบสั่งงานแล้ว: ชิ้นงานที่ต้องผลิตเองตามผลสำรวจคงคลัง (WIP ที่มี BOM อนุมัติและยังขาด) + สินค้าสำเร็จรูปของใบสั่งผลิต
  //   qty = ที่ขาด (หรือที่ยังไม่ได้ผลิต) − ที่ออกใบงานไว้แล้วยังไม่เสร็จ (ไม่ติดลบ) · เรียง WIP ก่อน FG (FG ใช้ชิ้นงานเหล่านั้น)
  // ต้องใช้ตารางสำรวจคงคลังของ modules/factory-production-model.js (เทสต์ใน Node ต้องตั้ง globalThis.MNP_FACTORY_PRODUCTION_MODEL ก่อน)
  function jobSuggestions(data, productionOrder) {
    const production = root.MNP_FACTORY_PRODUCTION_MODEL;
    const survey = production.surveyRequirements(data, productionOrder.item_id, productionOrder.planned_qty);
    const items = new Map((data.items ?? []).map((item) => [item.id, item]));
    const make = [];
    for (const row of survey?.rows ?? []) {
      if (!row.hasBom || row.net <= 0) continue;
      const open = inJobsQty(data.jobs, productionOrder.id, row.item_id);
      make.push({ item_id: row.item_id, code: row.code, name: row.name, unit_code: row.unit_code, item_type: row.item_type, kind: "wip", need: row.net, inJobs: open, qty: Math.max(0, round4(row.net - open)) });
    }
    const remaining = round4(Number(productionOrder.planned_qty) - Number(productionOrder.completed_qty ?? 0));
    const fg = items.get(productionOrder.item_id);
    const fgOpen = inJobsQty(data.jobs, productionOrder.id, productionOrder.item_id);
    const all = make.sort((a, b) => a.code.localeCompare(b.code));
    if (fg && remaining > 0) {
      all.push({ item_id: fg.id, code: fg.code, name: fg.name, unit_code: fg.unit_code, item_type: fg.item_type, kind: "fg", need: remaining, inJobs: fgOpen, qty: Math.max(0, round4(remaining - fgOpen)) });
    }
    return all;
  }

  // คลังปลายทางที่เสนอให้: Routing ที่มีขั้น SR- (รับเข้าคลังยางเส้นยาว) → SR · สินค้าสำเร็จรูป → FG · อื่นๆ → WIP (เลือกเปลี่ยนได้)
  function defaultWarehouse(data, item, routingId) {
    const hasSr = (data.steps ?? []).some((step) => step.routing_id === routingId && /^SR-/.test(String(step.name)));
    if (hasSr) return "SR";
    return item?.item_type === "FG" ? "FG" : "WIP";
  }

  // Item ที่ออกใบงานได้: WIP/FG ที่ใช้งานอยู่ ผลิตเอง/ซื้อ-ผลิต และมี BOM ที่อนุมัติ
  function jobItems(data) {
    const approved = new Set((data.boms ?? []).filter((bom) => bom.status === "approved").map((bom) => bom.item_id));
    return (data.items ?? []).filter((item) => item.status === "active" && ["WIP", "FG"].includes(item.item_type) && ["make", "both"].includes(item.procurement) && approved.has(item.id))
      .slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  // ใบสั่งผลิตที่ออกใบงานได้: ออกใบสั่งงานแล้ว (released/in_progress) ใหม่สุดก่อน
  const orderableOrders = (orders) => (orders ?? []).filter((order) => ["released", "in_progress"].includes(order.status)).slice().sort((a, b) => String(b.code).localeCompare(String(a.code)));

  const toNumber = (value) => {
    const text = String(value ?? "").trim();
    return text === "" ? null : Number(text);
  };

  // ค่าจากฟอร์ม -> พารามิเตอร์ของ app_factory_create_job
  function jobPayload(values) {
    return {
      p_production_order_id: String(values?.production_order_id ?? "").trim() || null,
      p_item_id: String(values?.item_id ?? "").trim() || null,
      p_qty: toNumber(values?.qty),
      p_warehouse_code: String(values?.warehouse_code ?? "").trim().toUpperCase(),
      p_note: String(values?.note ?? "").trim(),
    };
  }

  function validateJobPayload(payload, data) {
    const problems = [];
    const order = (data.production ?? []).find((row) => row.id === payload.p_production_order_id);
    if (!payload.p_production_order_id) problems.push("กรุณาเลือกใบสั่งผลิต");
    else if (!order || !["released", "in_progress"].includes(order.status)) problems.push("ใบสั่งผลิตต้องออกใบสั่งงานแล้ว");
    if (!payload.p_item_id) problems.push("กรุณาเลือกชิ้นงาน/สินค้าที่จะผลิต");
    else if (!jobItems(data).some((item) => item.id === payload.p_item_id)) problems.push("ชิ้นงาน/สินค้าต้องเป็น WIP หรือ FG ที่ผลิตเองได้และมี BOM ที่อนุมัติแล้ว");
    const quantity = payload.p_qty;
    if (quantity === null || !Number.isFinite(quantity) || Math.round(quantity * 10000) / 10000 <= 0 || quantity > MAX_QUANTITY) {
      problems.push(`จำนวนที่ผลิตต้องมากกว่า 0 และไม่เกิน ${MAX_QUANTITY.toLocaleString("en-US")}`);
    }
    if (!(data.warehouses ?? []).some((warehouse) => warehouse.code === payload.p_warehouse_code)) problems.push("กรุณาเลือกคลังที่รับผลผลิต");
    if (payload.p_note.length > 1000) problems.push("หมายเหตุยาวได้ไม่เกิน 1,000 ตัวอักษร");
    return problems;
  }

  // จำนวนผลิตจริงตอนทำขั้นสุดท้าย: ว่าง = ตามจำนวนของใบงาน (ส่ง null) · ไม่ใช่จำนวนบวกคืน { error }
  function outputQty(value) {
    const quantity = toNumber(value);
    if (quantity === null) return { value: null };
    if (!Number.isFinite(quantity) || Math.round(quantity * 10000) / 10000 <= 0 || quantity > MAX_QUANTITY) return { error: `จำนวนผลิตจริงต้องมากกว่า 0 และไม่เกิน ${MAX_QUANTITY.toLocaleString("en-US")}` };
    return { value: quantity };
  }

  // ---------- ตรวจ QC (20261007070000): ขั้นศูนย์งาน QC ปิดได้ทางบันทึกผลตรวจเท่านั้น ----------
  const QC_CENTER = "QC";
  const isQcStep = (step) => step?.work_center_code === QC_CENTER;
  // ผลตรวจของใบงานหนึ่ง ใหม่สุดก่อน (ข้อมูลเข้ามาใหม่สุดก่อนอยู่แล้ว เรียงซ้ำเผื่อลำดับต่างกัน)
  const inspectionsOf = (inspections, jobId) => (inspections ?? []).filter((row) => row.job_id === jobId).slice()
    .sort((a, b) => String(b.inspected_at ?? "").localeCompare(String(a.inspected_at ?? "")) || String(b.id).localeCompare(String(a.id)));
  // ขั้น QC ที่ถึงคิวและผลตรวจล่าสุดของขั้นนั้นไม่ผ่าน = รอตรวจซ้ำ (คืนผลตรวจนั้น มิฉะนั้น null)
  function qcHold(job, inspections) {
    const next = nextStep(job);
    if (!isQcStep(next)) return null;
    const latest = inspectionsOf(inspections, job.id).find((row) => row.step_sequence === next.sequence);
    return latest?.result === "fail" ? latest : null;
  }
  // ตรวจฟอร์มบันทึกผลตรวจ QC เพื่อความสะดวก (ฐานข้อมูลตรวจซ้ำทุกค่า) คืน { args } หรือ { error }
  function qcPayload(values, last) {
    const result = String(values?.result ?? "");
    if (!["pass", "fail"].includes(result)) return { error: "กรุณาเลือกผลตรวจ ผ่านหรือไม่ผ่าน" };
    const checked = toNumber(values.qty_checked);
    if (checked === null || !Number.isFinite(checked) || Math.round(checked * 10000) / 10000 <= 0 || checked > MAX_QUANTITY) {
      return { error: `จำนวนที่ตรวจต้องมากกว่า 0 และไม่เกิน ${MAX_QUANTITY.toLocaleString("en-US")}` };
    }
    const measurement = String(values.measurement ?? "").trim();
    if (measurement.length > 1000) return { error: "บันทึกผลวัดยาวได้ไม่เกิน 1,000 ตัวอักษร" };
    if (result === "pass") {
      const output = last ? outputQty(values.output_qty) : { value: null };
      if (output.error) return { error: output.error };
      return { args: { p_result: "pass", p_qty_checked: checked, p_qty_defect: 0, p_measurement: measurement, p_defect_type_code: null, p_description: "", p_output_qty: output.value } };
    }
    const defect = toNumber(values.qty_defect);
    if (defect === null || !Number.isFinite(defect) || Math.round(defect * 10000) / 10000 <= 0 || defect > checked) {
      return { error: "จำนวนที่ไม่ผ่านต้องมากกว่า 0 และไม่เกินจำนวนที่ตรวจ" };
    }
    const defectType = String(values.defect_type_code ?? "").trim();
    if (!defectType) return { error: "กรุณาเลือกประเภทข้อบกพร่อง (ใช้ออก NCR)" };
    const description = String(values.description ?? "").trim();
    if (description.length < 10 || description.length > 4000) return { error: "กรุณาอธิบายความไม่ผ่านอย่างน้อย 10 ตัวอักษร (ไม่เกิน 4,000) ใช้เป็นรายละเอียดของ NCR" };
    return { args: { p_result: "fail", p_qty_checked: checked, p_qty_defect: defect, p_measurement: measurement, p_defect_type_code: defectType, p_description: description, p_output_qty: null } };
  }

  // ประวัติของใบเดียว เก่าสุดก่อน (ข้อมูลเข้ามาใหม่สุดก่อน)
  const jobTimeline = (history, jobId) => (history ?? []).filter((entry) => entry.job_id === jobId).slice().reverse();

  const api = {
    PLANNING_DEPARTMENT, MAX_QUANTITY, JOB_STATUSES, BADGE_CLASS, STEP_STATUSES, HISTORY_ACTIONS, ACTIVE_STATUSES,
    isActive, stepsOf, nextStep, isLastPending, canRunStep, jobActions, deptQueue, countByStatus, jobsOf, progress,
    jobRequirements, inJobsQty, jobSuggestions, defaultWarehouse, jobItems, orderableOrders, jobPayload, validateJobPayload, outputQty, jobTimeline,
    isQcStep, inspectionsOf, qcHold, qcPayload,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_JOB_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
