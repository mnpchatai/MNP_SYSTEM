// ส่วนคำนวณของใบตรวจ QC (ฟอร์ม QA01-PM11) ใน Pilot Web — ฟังก์ชันล้วน ไม่แตะ DOM/Supabase
// เพื่อให้ Node ทดสอบได้ (scripts/tests/qc-model.test.mjs) หน้าจอที่ใช้อยู่ที่ modules/module-qc.js
//
// กติกาคำนวณ/ตัดสินต้องตรงกับฐานข้อมูล (supabase/migrations/20261027010000_qc_inspection_reports.sql):
//   private.qc_judge   ไม่มีทั้ง MIN และ MAX = NA · มีจุดใดต่ำกว่า MIN หรือสูงกว่า MAX = N · นอกนั้น O
//   app_qc_save_report min / max / average (ปัด 4 ตำแหน่ง) คำนวณใน RPC ไม่รับจาก client ยอมรับรายการที่ N เป็น AC ได้ต้องมีหมายเหตุ ≥ 5 ตัวอักษร
//   private.qc_result  'ng' ถ้ามี N · 'accept' ถ้าไม่มี N แต่มี AC · 'ok' นอกนั้น
// ที่นี่คำนวณเพื่อแสดงสดตอนกรอกเท่านั้น ฐานข้อมูลคำนวณซ้ำและเป็นตัวตัดสินจริง
(function registerQcModel(root) {
  const MAX_POINTS = 5;
  const MAX_LOTS = 10;
  const MAX_ITEMS = 30;
  const NUMBER_LIMIT = 1000000000;
  const BANGKOK_OFFSET = "+07:00";

  const STATUS_LABELS = {
    draft: "ร่าง",
    pending_qa_manager: "รอ ผจก.QA",
    pending_factory_manager: "รอ ผจก.โรงงาน",
    pending_general_manager: "รอ ผจก.ทั่วไป",
    approved: "อนุมัติแล้ว",
    rejected: "ไม่อนุมัติ",
    cancelled: "ยกเลิก",
  };
  const STATUS_BADGE_CLASS = {
    draft: "in_progress",
    pending_qa_manager: "pending_approval",
    pending_factory_manager: "pending_approval",
    pending_general_manager: "pending_approval",
    approved: "completed",
    rejected: "rejected",
    cancelled: "rejected",
  };
  const RESULT_LABELS = { ok: "ผ่าน (OK)", ng: "ไม่ผ่าน (Reject)", accept: "ยอมรับ (Accept)" };
  // Judge ตามฟอร์ม: O = OK, N = NG, AC = ACCEPT (NA = รายการที่ไม่มีสเปก ไม่ตัดสิน)
  const JUDGE_LABELS = { O: "OK", N: "NG", AC: "ACCEPT", NA: "ไม่มีสเปก" };
  const JUDGE_CLASSES = { O: "qc-judge-o", N: "qc-judge-n", AC: "qc-judge-ac", NA: "qc-judge-na" };
  // ขั้นลงนามของใบ (step_order 1..3) ตรงกับ qc_inspection_approvals.step_code
  const STEPS = [
    { order: 1, code: "qa_manager", key: "qa", label: "manager QA", pending: "pending_qa_manager" },
    { order: 2, code: "factory_manager", key: "factory", label: "factory manager", pending: "pending_factory_manager" },
    { order: 3, code: "general_manager", key: "gm", label: "General Manager Approved", pending: "pending_general_manager" },
  ];
  const HISTORY_LABELS = {
    create: "สร้างใบตรวจ", update: "แก้ไขฉบับร่าง", submit: "ส่งอนุมัติ", approve: "อนุมัติ", reject: "ไม่อนุมัติ",
    reopen: "เปิดแก้ไขใหม่", cancel: "ยกเลิกใบ", ncr: "เปิด NCR",
  };
  // หน่วยของ NCR ต้องตรงกับ app_ncr_issue (20261002020000_ncr_phase1.sql) และ UNITS ใน module-ncr.js
  const NCR_UNITS = ["ชุด", "ชิ้น", "เซต", "ม้วน", "เส้น", "กก.", "ท่อน", "เมตร", "ลูก", "ใบ", "รายการ"];

  // ลำดับสำคัญ: friendlyError (app.js) ใช้คีย์แรกที่ปรากฏอยู่ในข้อความ — รหัสใหม่ต้องไม่เป็นส่วนหนึ่งของรหัสอื่นที่ลงทะเบียนไว้ก่อนหน้า
  // (เทสต์ตรวจไว้) รหัสกลางอย่าง NOT_AUTHORIZED ใช้ข้อความของ app.js และรหัส INVALID_NCR_* ของการออก NCR ใช้ข้อความของ module-ncr.js
  const ERROR_MESSAGES = {
    QC_TEST_MODE_ONLY: "ใบตรวจ QC ใช้ได้เฉพาะในโหมดทดสอบเท่านั้น",
    QC_INVALID_PAYLOAD: "ข้อมูลไม่ถูกต้อง กรุณาตรวจทุกช่อง (Part Number เว้นว่างได้แต่ไม่เกิน 60, Part Name 1–200, หมายเหตุไม่เกิน 2,000 ตัวอักษร) แล้วลองอีกครั้ง",
    QC_INVALID_ITEM: "รายการตรวจไม่ถูกต้อง: ITEM No. เป็น A–Z 1–2 ตัวและห้ามซ้ำ · ชื่อรายการ 1–100 ตัวอักษร · MIN ต้องไม่เกิน MAX · ค่าที่วัดมี 1–5 จุดและเป็นตัวเลข",
    QC_PART_NUMBER_TAKEN: "มีแม่แบบของ Part Number นี้อยู่แล้ว กรุณาเปิดแม่แบบเดิมเพื่อแก้ไข (Part Number เว้นว่างได้เมื่อเป็นชิ้นงานเดี่ยวที่ไม่มีเลข Part)",
    QC_NOT_FOUND: "ไม่พบใบตรวจ/แม่แบบนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    QC_VERSION_CONFLICT: "รายการนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจข้อมูลล่าสุดแล้วทำอีกครั้ง",
    QC_INVALID_LOT: "Lot ยางผสมไม่ถูกต้อง: ใส่ได้ไม่เกิน 10 Lot แต่ละ Lot 1–60 ตัวอักษรและห้ามซ้ำ",
    QC_TEMPLATE_NOT_FOUND: "ไม่พบแม่แบบตรวจของ Part ที่เลือก (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    QC_NOT_DRAFT: "แก้ไขหรือส่งได้เฉพาะใบที่ยังเป็นฉบับร่าง",
    QC_INVALID_JUDGE: "ยอมรับ (AC) ได้เฉพาะรายการที่ผลเป็น N (ไม่ผ่านสเปก)",
    QC_ACCEPT_NOTE_REQUIRED: "รายการที่ยอมรับ (AC) ต้องระบุหมายเหตุอย่างน้อย 5 ตัวอักษร",
    QC_NO_ITEMS: "ใบนี้ยังไม่มีรายการตรวจ บันทึกรายการก่อนส่งอนุมัติ",
    QC_INVALID_DECISION: "ผลการพิจารณาไม่ถูกต้อง",
    QC_STEP_NOT_CURRENT: "ใบนี้ไม่ได้รอการอนุมัติขั้นนี้แล้ว (อาจมีผู้อื่นดำเนินการไปแล้ว)",
    QC_SELF_APPROVAL: "ผู้ตรวจหรือผู้สร้างใบอนุมัติใบตรวจของตัวเองไม่ได้",
    QC_REJECT_COMMENT_REQUIRED: "กรุณาระบุเหตุผลที่ไม่อนุมัติอย่างน้อย 5 ตัวอักษร",
    QC_NOT_REJECTED: "เปิดแก้ไขใหม่ได้เฉพาะใบที่ไม่อนุมัติ",
    QC_CANCEL_NOTE_REQUIRED: "กรุณาระบุเหตุผลที่ยกเลิกอย่างน้อย 5 ตัวอักษร",
    QC_NOT_CANCELLABLE: "ยกเลิกได้เฉพาะใบที่เป็นฉบับร่างหรือไม่อนุมัติ",
    QC_NCR_EXISTS: "ใบนี้เปิด NCR ไปแล้ว",
    QC_NOT_ACTIVE: "ใบนี้ถูกยกเลิกแล้ว เปิด NCR ไม่ได้",
    QC_NOT_SUBMITTED: "เปิด NCR ได้หลังส่งอนุมัติแล้วเท่านั้น (ใบฉบับร่างหรือที่ไม่อนุมัติเปิดไม่ได้)",
    QC_NCR_LINKED: "ใบนี้เปิด NCR ไปแล้ว ยกเลิกใบไม่ได้ (ยกเลิกที่ NCR แทน)",
    QC_NOT_NG: "เปิด NCR ได้เฉพาะใบที่ผลรวมเป็นไม่ผ่าน (Reject)",
  };

  const text = (value) => (value === null || value === undefined ? "" : String(value));
  const trimmed = (value) => text(value).trim();

  // ตัวเลขจากช่องกรอก: ว่าง = null · ไม่ใช่ตัวเลข/เกินช่วง = undefined (ไม่รับ NaN, Infinity, e-notation ที่ผิดรูป)
  function parseNumber(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return Number.isFinite(raw) && Math.abs(raw) <= NUMBER_LIMIT ? raw : undefined;
    const value = String(raw).trim();
    if (value === "") return null;
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value)) return undefined;
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= NUMBER_LIMIT ? number : undefined;
  }

  // ปัด 4 ตำแหน่งแบบเดียวกับ round(numeric, 4) ในฐานข้อมูล (ปัดออกจากศูนย์เมื่อลงตัวครึ่งพอดี)
  const round4 = (value) => (value < 0 ? -1 : 1) * Math.round(Math.abs(value) * 10000 + 1e-7) / 10000;

  // points = ค่าที่กรอก (สตริง/ตัวเลข) ช่องว่างหรือที่ไม่ใช่ตัวเลขถูกข้าม · ไม่มีค่าเลย judge = null (ยังตัดสินไม่ได้)
  function computeItem({ points = [], spec_min: specMin = null, spec_max: specMax = null } = {}) {
    const values = (points ?? []).map(parseNumber).filter((value) => typeof value === "number");
    const min = parseNumber(specMin);
    const max = parseNumber(specMax);
    const lower = typeof min === "number" ? min : null;
    const upper = typeof max === "number" ? max : null;
    if (!values.length) return { min: null, max: null, avg: null, judge: null };
    let judge = "O";
    if (lower === null && upper === null) judge = "NA";
    else if (values.some((value) => (lower !== null && value < lower) || (upper !== null && value > upper))) judge = "N";
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: round4(values.reduce((sum, value) => sum + value, 0) / values.length),
      judge,
    };
  }

  // items = รายการที่มี judge (ผลจริง O/N/AC/NA) หรือสตริง judge ล้วน · ไม่มีรายการ = null
  function computeResult(items) {
    const judges = (items ?? []).map((item) => (typeof item === "string" ? item : item?.judge)).filter(Boolean);
    if (!judges.length) return null;
    if (judges.includes("N")) return "ng";
    if (judges.includes("AC")) return "accept";
    return "ok";
  }

  // ---------- วันที่ (เวลาไทย) ----------
  const bangkokParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  function bangkokFields(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = Object.fromEntries(bangkokParts.formatToParts(date).map((part) => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  // "YYYY-MM-DD HH:mm" ตามเวลาไทย ('' ถ้าไม่มี/อ่านไม่ได้)
  function bangkokStamp(value) {
    const fields = bangkokFields(value);
    return fields ? `${fields.date} ${fields.time}` : "";
  }
  // ค่าเริ่มต้นของช่อง <input type="datetime-local"> (เวลาไทย) — ไม่ส่ง value = ตอนนี้
  function bangkokInputValue(value = new Date()) {
    const fields = bangkokFields(value);
    return fields ? `${fields.date}T${fields.time}` : "";
  }
  // ค่าจากช่อง datetime-local (เวลาไทย) → ISO พร้อม offset · ว่าง = null · อ่านไม่ได้ = undefined
  function bangkokInstant(value) {
    const raw = trimmed(value);
    if (!raw) return null;
    const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
    const iso = local ? `${raw}:00${BANGKOK_OFFSET}` : raw;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : iso;
  }

  // ---------- ตรวจฟอร์ม → payload ของ RPC ----------
  const fail = (error) => ({ error });

  function validateLots(lots) {
    const list = Array.isArray(lots) ? lots.map(trimmed) : [];
    if (list.length > MAX_LOTS) return fail(`ใส่ Lot ยางผสมได้ไม่เกิน ${MAX_LOTS} Lot`);
    if (list.some((lot) => lot.length < 1 || lot.length > 60)) return fail("Lot ยางผสมแต่ละค่าต้องยาว 1–60 ตัวอักษร");
    if (new Set(list).size !== list.length) return fail("Lot ยางผสมซ้ำกัน");
    return { lots: list };
  }

  // ค่าที่วัด point 1..5: ช่องว่างท้ายแถวข้ามได้ แต่เว้นช่องกลางแถวไม่ได้ (ลำดับ point มีความหมายในฟอร์ม)
  function readPoints(rawPoints, label) {
    const raw = Array.isArray(rawPoints) ? rawPoints : [];
    if (raw.length > MAX_POINTS) return fail(`${label}: วัดได้ไม่เกิน ${MAX_POINTS} จุด`);
    const points = [];
    let blankSeen = false;
    for (const cell of raw) {
      const value = parseNumber(cell);
      if (value === undefined) return fail(`${label}: ค่าที่วัดต้องเป็นตัวเลข`);
      if (value === null) {
        blankSeen = true;
      } else {
        if (blankSeen) return fail(`${label}: กรอกค่าเรียงจากจุดที่ 1 โดยไม่เว้นช่อง`);
        points.push(value);
      }
    }
    if (!points.length) return fail(`${label}: กรอกค่าที่วัดได้อย่างน้อย 1 จุด`);
    return { points };
  }

  // formValues = { id?, version?, template_id, part_number, part_name, customer, order_no, code, sample_label,
  //   inspected_at, remark, compound_lots[], items: [{ item_no, points[], note, accept }] }
  // templateItems = สเปกของแต่ละรายการที่แสดงในฟอร์ม [{ item_no, name, instrument, unit, spec_min, spec_std, spec_max }]
  // คืน { payload } (ตรงกับ p_payload ของ app_qc_save_report) หรือ { error } ภาษาไทย — ฐานข้อมูลตรวจซ้ำทุกข้อ
  function reportPayload(formValues, templateItems) {
    const form = formValues ?? {};
    const partNumber = trimmed(form.part_number);
    const partName = trimmed(form.part_name);
    if (partNumber.length > 60) return fail("Part Number ต้องไม่เกิน 60 ตัวอักษร");
    if (partName.length < 1 || partName.length > 200) return fail("กรุณากรอก Part Name (1–200 ตัวอักษร)");
    const limits = [["customer", "customer", 100], ["order_no", "Order No.", 60], ["code", "Code", 60], ["sample_label", "Sample", 30], ["remark", "REMARK", 2000]];
    for (const [key, label, max] of limits) {
      if (trimmed(form[key]).length > max) return fail(`${label} ต้องไม่เกิน ${max} ตัวอักษร`);
    }
    const lots = validateLots(form.compound_lots);
    if (lots.error) return lots;
    const inspectedAt = bangkokInstant(form.inspected_at);
    if (inspectedAt === undefined) return fail("วันที่ตรวจ (inspection Date) ไม่ถูกต้อง");

    const specs = Array.isArray(templateItems) ? templateItems : [];
    if (!specs.length) return fail("ใบตรวจต้องมีรายการตรวจอย่างน้อย 1 รายการ (เลือก Part ที่มีแม่แบบ)");
    if (specs.length > MAX_ITEMS) return fail(`ใบตรวจมีรายการตรวจได้ไม่เกิน ${MAX_ITEMS} รายการ`);
    const entries = new Map((Array.isArray(form.items) ? form.items : []).map((entry) => [text(entry?.item_no), entry]));

    const items = [];
    for (const spec of specs) {
      const label = `รายการ ${text(spec.item_no)}`;
      const entry = entries.get(text(spec.item_no)) ?? {};
      const name = trimmed(spec.name);
      if (!/^[A-Z]{1,2}$/.test(text(spec.item_no)) || name.length < 1 || name.length > 100) return fail(`${label}: ITEM No. หรือชื่อรายการไม่ถูกต้อง`);
      const specMin = parseNumber(spec.spec_min);
      const specStd = parseNumber(spec.spec_std);
      const specMax = parseNumber(spec.spec_max);
      if (specMin === undefined || specStd === undefined || specMax === undefined) return fail(`${label}: สเปกต้องเป็นตัวเลข`);
      if (specMin !== null && specMax !== null && specMin > specMax) return fail(`${label}: MIN ต้องไม่เกิน MAX`);
      const read = readPoints(entry.points, label);
      if (read.error) return read;
      const note = trimmed(entry.note);
      if (note.length > 500) return fail(`${label}: หมายเหตุต้องไม่เกิน 500 ตัวอักษร`);
      const item = {
        item_no: text(spec.item_no), name, instrument: trimmed(spec.instrument), unit: trimmed(spec.unit),
        spec_min: specMin, spec_std: specStd, spec_max: specMax, points: read.points, note,
      };
      // ยอมรับ (AC) ใช้ได้เมื่อผลของรายการเป็น N เท่านั้น — ถ้าค่าถูกแก้จนผ่านสเปกแล้ว ไม่ส่งการยอมรับไป
      if (entry.accept === true && computeItem({ points: read.points, spec_min: specMin, spec_max: specMax }).judge === "N") {
        if (note.length < 5) return fail(`${label}: ยอมรับ (AC) ต้องระบุหมายเหตุอย่างน้อย 5 ตัวอักษร`);
        item.judge_override = "AC";
      }
      items.push(item);
    }

    const payload = {
      part_number: partNumber, part_name: partName, customer: trimmed(form.customer), order_no: trimmed(form.order_no),
      code: trimmed(form.code), sample_label: trimmed(form.sample_label), remark: trimmed(form.remark),
      compound_lots: lots.lots, items,
    };
    if (trimmed(form.template_id)) payload.template_id = trimmed(form.template_id);
    if (inspectedAt) payload.inspected_at = inspectedAt;
    if (form.id) {
      const version = Number(form.version);
      if (!Number.isInteger(version) || version < 1) return fail("ไม่พบรุ่น (version) ของใบ กรุณาเปิดหน้านี้ใหม่");
      payload.id = form.id;
      payload.version = version;
    }
    return { payload };
  }

  // formValues = { id?, version?, part_number, part_name, customer, drawing_note, status, items: [{ item_no, name, instrument,
  //   unit, spec_min, spec_std, spec_max, points_required }] } → payload ของ app_qc_save_template
  function templatePayload(formValues) {
    const form = formValues ?? {};
    const partNumber = trimmed(form.part_number);
    const partName = trimmed(form.part_name);
    if (partNumber.length > 60) return fail("Part Number ต้องไม่เกิน 60 ตัวอักษร");
    if (partName.length < 1 || partName.length > 200) return fail("กรุณากรอก Part Name (1–200 ตัวอักษร)");
    if (trimmed(form.customer).length > 100) return fail("customer ต้องไม่เกิน 100 ตัวอักษร");
    if (trimmed(form.drawing_note).length > 500) return fail("คำอธิบายจุดวัดต้องไม่เกิน 500 ตัวอักษร");
    const status = trimmed(form.status) || "active";
    if (!["active", "inactive"].includes(status)) return fail("สถานะแม่แบบไม่ถูกต้อง");
    const rows = Array.isArray(form.items) ? form.items : [];
    if (!rows.length) return fail("แม่แบบต้องมีรายการตรวจอย่างน้อย 1 รายการ");
    if (rows.length > MAX_ITEMS) return fail(`แม่แบบมีรายการตรวจได้ไม่เกิน ${MAX_ITEMS} รายการ`);

    const seen = new Set();
    const items = [];
    for (const [index, row] of rows.entries()) {
      const label = `แถวที่ ${index + 1}`;
      const itemNo = trimmed(row?.item_no).toUpperCase();
      if (!/^[A-Z]{1,2}$/.test(itemNo)) return fail(`${label}: ITEM No. ต้องเป็นตัวอักษร A–Z 1–2 ตัว`);
      if (seen.has(itemNo)) return fail(`${label}: ITEM No. ${itemNo} ซ้ำกัน`);
      seen.add(itemNo);
      const name = trimmed(row.name);
      if (name.length < 1 || name.length > 100) return fail(`${label}: กรุณากรอกชื่อรายการ (1–100 ตัวอักษร)`);
      if (trimmed(row.instrument).length > 100) return fail(`${label}: เครื่องมือวัดต้องไม่เกิน 100 ตัวอักษร`);
      if (trimmed(row.unit).length > 20) return fail(`${label}: หน่วยต้องไม่เกิน 20 ตัวอักษร`);
      const specMin = parseNumber(row.spec_min);
      const specStd = parseNumber(row.spec_std);
      const specMax = parseNumber(row.spec_max);
      if (specMin === undefined || specStd === undefined || specMax === undefined) return fail(`${label}: MIN, STD, MAX ต้องเป็นตัวเลข`);
      if (specMin !== null && specMax !== null && specMin > specMax) return fail(`${label}: MIN ต้องไม่เกิน MAX`);
      const required = trimmed(row.points_required) === "" ? MAX_POINTS : parseNumber(row.points_required);
      if (!Number.isInteger(required) || required < 1 || required > MAX_POINTS) return fail(`${label}: จำนวนจุดวัดต้องเป็นจำนวนเต็ม 1–${MAX_POINTS}`);
      items.push({
        item_no: itemNo, name, instrument: trimmed(row.instrument), unit: trimmed(row.unit),
        spec_min: specMin, spec_std: specStd, spec_max: specMax, points_required: required,
      });
    }
    const payload = {
      part_number: partNumber, part_name: partName, customer: trimmed(form.customer),
      drawing_note: trimmed(form.drawing_note), status, items,
    };
    if (form.id) {
      const version = Number(form.version);
      if (!Number.isInteger(version) || version < 1) return fail("ไม่พบรุ่น (version) ของแม่แบบ กรุณาเปิดหน้านี้ใหม่");
      payload.id = form.id;
      payload.version = version;
    }
    return { payload };
  }

  // ฟอร์มเปิด NCR จากใบที่ผลเป็น Reject → อาร์กิวเมนต์ที่เหลือของ app_qc_issue_ncr (ผู้เรียกเติม p_id / p_version)
  // กติกาเดียวกับ app_ncr_issue: ทั้งสองจำนวน > 0 และจำนวนเสียไม่เกินจำนวนตรวจ · คำอธิบาย 10–4,000 ตัวอักษร
  function ncrArgs(values) {
    const form = values ?? {};
    const total = parseNumber(form.qty_total);
    const defect = parseNumber(form.qty_defect);
    if (typeof total !== "number" || total <= 0) return fail("กรุณากรอกจำนวนที่ตรวจให้มากกว่า 0");
    if (typeof defect !== "number" || defect <= 0) return fail("กรุณากรอกจำนวนเสียให้มากกว่า 0");
    if (defect > total) return fail("จำนวนเสียต้องไม่เกินจำนวนที่ตรวจ");
    if (!NCR_UNITS.includes(trimmed(form.unit))) return fail("กรุณาเลือกหน่วย");
    if (!trimmed(form.defect_type_code)) return fail("กรุณาเลือกประเภทข้อบกพร่อง");
    const description = trimmed(form.description);
    if (description.length < 10 || description.length > 4000) return fail("คำอธิบายความไม่ผ่านต้องยาว 10–4,000 ตัวอักษร");
    return { args: { p_defect_type_code: trimmed(form.defect_type_code), p_qty_total: total, p_qty_defect: defect, p_unit: trimmed(form.unit), p_description: description } };
  }

  // ---------- สำเนาไปชีต / ส่งออก Excel ----------
  const defaultNameOf = (person) => [person?.first_name, person?.last_name].map(trimmed).filter(Boolean).join(" ");
  const numberOrNull = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

  // report = ผลของ app_qc_report · nameOf(คน) → ชื่อ (ค่าตั้งต้นต่อ first_name + last_name) · ฟิลด์แบนตามที่ Apps Script
  // (apps-script/qc-sheet/Code.gs) ใช้ทั้งสำเนาลงชีตและวาดฟอร์ม Excel · ใบทดสอบ = เลขที่ขึ้นต้น TEST-
  function buildSheetRecord(report, { nameOf = defaultNameOf } = {}) {
    const approvals = Object.fromEntries(STEPS.map((step) => {
      const row = (report.approvals ?? []).find((item) => item.step_order === step.order) ?? {};
      const acted = row.status === "approved" || row.status === "rejected";
      return [step.key, {
        status: text(row.status),
        name: acted ? text(nameOf(row)) : "",
        date: acted ? bangkokStamp(row.acted_at) : "",
        comment: text(row.comment),
      }];
    }));
    const reportNo = text(report.report_no);
    return {
      id: text(report.id),
      reportNo,
      isTest: reportNo.startsWith("TEST-"),
      status: text(report.status),
      statusLabel: STATUS_LABELS[report.status] ?? text(report.status),
      result: text(report.result),
      resultLabel: RESULT_LABELS[report.result] ?? "",
      partNumber: text(report.part_number),
      partName: text(report.part_name),
      customer: text(report.customer),
      orderNo: text(report.order_no),
      code: text(report.code),
      sampleLabel: text(report.sample_label),
      lots: (report.compound_lots ?? []).join(", "),
      inspector: text(report.inspector ? nameOf(report.inspector) : report.inspector_name),
      inspectedAt: bangkokStamp(report.inspected_at),
      approvals,
      remark: text(report.remark),
      items: (report.items ?? []).map((item) => ({
        itemNo: text(item.item_no),
        name: text(item.name),
        instrument: text(item.instrument),
        unit: text(item.unit),
        specMin: numberOrNull(item.spec_min),
        specStd: numberOrNull(item.spec_std),
        specMax: numberOrNull(item.spec_max),
        points: (item.points ?? []).map(Number),
        min: numberOrNull(item.point_min),
        max: numberOrNull(item.point_max),
        avg: numberOrNull(item.point_avg),
        judge: text(item.judge),
        note: text(item.note),
      })),
      ncrNo: text(report.ncr_no),
      updatedAt: bangkokStamp(report.updated_at),
    };
  }

  // Part Number ไม่บังคับ (ชิ้นงานเดี่ยวไม่มีเลข Part): ฟอร์มกระดาษ QA01-PM11 ใส่ "-" ส่วนที่เป็นป้ายชื่อใช้ Part Name อย่างเดียว
  const partNumberText = (partNumber) => trimmed(partNumber) || "-";
  const partLabel = (partNumber, partName) => (trimmed(partNumber) ? `${trimmed(partNumber)} · ${text(partName)}` : text(partName));

  const safeFileName = (docNumber) => `${text(docNumber).replace(/[^\p{L}\p{N}_-]+/gu, "-") || "QA01-PM11"}.xlsx`;

  // payload ที่ส่งให้ Apps Script วาดฟอร์ม QA01-PM11 เป็น .xlsx (ไม่ใช่แผนที่เซลล์ — สคริปต์วาดฟอร์มเองจาก record)
  function buildFormExport(report, options) {
    return { form: "qc", fileName: safeFileName(report.report_no), record: buildSheetRecord(report, options) };
  }

  const api = {
    MAX_POINTS, MAX_LOTS, MAX_ITEMS, STATUS_LABELS, RESULT_LABELS, JUDGE_LABELS, JUDGE_CLASSES, STEPS, HISTORY_LABELS, NCR_UNITS, ERROR_MESSAGES,
    partNumberText, partLabel, parseNumber, round4, computeItem, computeResult, bangkokStamp, bangkokInputValue, bangkokInstant,
    statusBadgeClass: (status) => STATUS_BADGE_CLASS[status] ?? "",
    reportPayload, templatePayload, ncrArgs, buildSheetRecord, buildFormExport, safeFileName,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_QC_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
