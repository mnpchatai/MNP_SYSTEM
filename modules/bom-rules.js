// BOM รายแผนก (โหมดทดสอบ) — กฎล้วน ไม่มี DOM/Supabase: รหัสชิ้นงาน หน่วยนับ อ่านตาราง BOM จาก Excel (วางเป็น TSV)
// ประกอบต้นไม้หลายชั้นจากชีตแบน (DATA ของ DATA BOM.xlsx / ไฟล์ Material_*.xlsm) ระเบิด BOM ของใบสั่งผลิต และสร้าง CSV
// ที่มาของกติกา: docs/BOM_SYSTEM_PLAN.md §1.2 (สูตรปริมาณของ BOMSHEET) เทสต์ด้วย node --test (scripts/tests/bom-rules.test.mjs)
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const DAY = 86400000;

  // ---------- ชนิดชิ้นงานและแผนกเจ้าของ ----------
  // KINDS: FG สินค้าสำเร็จรูป (PK) · SE ชิ้นยางย่อยที่ตัด/เจาะแล้ว (GR) · RB เส้นยาง (RB) · PT ชิ้นพลาสติก (PT) · BG กระเป๋า/เย็บ (BG) ·
  // PURCHASED ของซื้อ/คลัง (ST) · SUBPART ชิ้นที่แผนกทำเองโดยยังไม่มีรหัส (เจ้าของตามคู่ผู้ผลิต)
  const KINDS = Object.freeze({
    FG: { label: "สินค้าสำเร็จรูป", dept: "PK" },
    SE: { label: "ชิ้นยาง (ตัด/เจาะ)", dept: "GR" },
    RB: { label: "เส้นยาง", dept: "RB" },
    PT: { label: "ชิ้นพลาสติก", dept: "PT" },
    BG: { label: "กระเป๋า/งานเย็บ", dept: "BG" },
    PURCHASED: { label: "ของซื้อ/คลัง", dept: "ST" },
    SUBPART: { label: "ชิ้นทำเอง (ยังไม่มีรหัส)", dept: "PK" },
  });
  const MANUFACTURED = Object.freeze(["FG", "SE", "RB", "PT", "BG", "SUBPART"]);
  const DEPTS = Object.freeze(["PK", "GR", "RB", "PT", "BG", "ST"]);
  const DEPT_LABEL = Object.freeze({ PK: "PK · บรรจุ/ประกอบ", GR: "GR · ตัด/เจาะชิ้นยาง", RB: "RB · รีดเส้นยาง", PT: "PT · ฉีดพลาสติก", BG: "BG · กระเป๋า/เย็บ", ST: "ST · คลังวัตถุดิบ", SR: "SR · รับเข้าคลัง/QC", WH: "WH · คลังสินค้าสำเร็จรูป" });
  // ลำดับกำหนดเสร็จรายแผนกในหัวใบสั่งผลิต (MAIN ของไฟล์ Excel)
  const DUE_DEPTS = Object.freeze(["RB", "GR", "PT", "BG", "ST", "PK"]);
  // ลำดับการไหลของงาน (ต้นน้ำ → ปลายน้ำ) ใช้เรียงการ์ดในหน้า "สินค้า 1 ตัว → งานทุกแผนก"
  const FLOW_DEPTS = Object.freeze(["RB", "GR", "PT", "BG", "ST", "PK"]);

  // ---------- เลขที่ PI และกำหนดเสร็จเริ่มต้น ----------
  // เลข PI ตามไฟล์ Excel: YYMMDD-YYnnn (วันที่สั่งผลิต ค.ศ. 2 หลัก + ลำดับในปี 3 หลัก) เช่น 251003-25041 = สั่ง 3 ต.ค. 2025 ใบที่ 41 ของปี 2025
  function piNumber(orderedAt, seq) {
    const date = new Date(orderedAt);
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yy}${mm}${dd}-${yy}${String(seq).padStart(3, "0")}`;
  }
  const piYear = (orderedAt) => String(new Date(orderedAt).getFullYear()).slice(-2);
  // ระยะเวลาเผื่อ (วัน) ถอยหลังจากวันส่งมอบคลัง ตามใบ 25041: PK = WH − 1 · GR/PT/BG/ST = PK − 6 · RB = GR − 4 (ผู้ใช้แก้ทับได้ทุกช่อง)
  const LEAD_DAYS = Object.freeze({ PK: 1, GR: 6, PT: 6, BG: 6, ST: 6, RB: 4 });
  // ถอยเป็น "วันปฏิทิน" (setDate) ไม่ใช่ลบมิลลิวินาที จึงไม่คลาดในโซนเวลาที่มี DST
  function defaultDueDates(whDue) {
    const base = new Date(Number(whDue));
    if (Number.isNaN(base.getTime())) return {};
    const minus = (ms, days) => { const date = new Date(ms); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - days); return date.getTime(); };
    const pk = minus(base.getTime(), LEAD_DAYS.PK);
    const gr = minus(pk, LEAD_DAYS.GR);
    return { RB: minus(gr, LEAD_DAYS.RB), GR: gr, PT: minus(pk, LEAD_DAYS.PT), BG: minus(pk, LEAD_DAYS.BG), ST: minus(pk, LEAD_DAYS.ST), PK: pk };
  }

  // ---------- ใบพิมพ์รายสถานี (แทนธง P/O 8 คอลัมน์ + มาโคร Print_* ของ BOMSHEET และชีต BOMASKSHEET / WIP-RBGR / WIP-PTBG) ----------
  // "คู่ผู้ผลิต" ของบรรทัดแบบคอลัมน์ AF ของชีต: PK (ตัว FG) · RB · SE · BG · <ผู้ใช้>-PT (ชิ้นพลาสติก) · <ผู้ใช้>-ST (ของซื้อ) · <ผู้ใช้>-PK (ชิ้นทำเอง)
  function producerPair(line, consumerDept = "PK") {
    if (line.level === 0) return "PK";
    const consumer = consumerDept || "PK";
    switch (line.kind) {
      case "RB": return "RB";
      case "SE": return "SE";
      case "BG": return "BG";
      case "PT": return `${consumer}-PT`;
      case "PURCHASED": return `${consumer}-ST`;
      case "SUBPART": return `${consumer}-PK`;
      default: return String(line.kind);
    }
  }
  // ตารางกฎสถานี: ใบไหนต้องเห็นคู่ผู้ผลิตใด (แปลงจากสูตร IF ในคอลัมน์ AM–AT และตัวกรองของมาโคร) · layout = ชุดคอลัมน์ของใบ
  const SHEETS = Object.freeze([
    { id: "RB", title: "RB", name: "ใบงานแผนกรีดเส้นยาง", pairs: ["PK", "RB"], layout: "bom" },
    { id: "GR", title: "GR-SR-RB", name: "ใบงานคลังเส้นยาว / ตัด (GR)", pairs: ["PK", "RB", "SE"], layout: "bom" },
    { id: "SE", title: "GR คัดแยก - SE", name: "ใบงานคัดแยกชิ้นยาง (SE)", pairs: ["PK", "SE"], layout: "bom" },
    { id: "PT", title: "PT - คลังท่อ", name: "ใบงานแผนกฉีดพลาสติก (PT)", pairs: ["PK", "PK-PT"], layout: "bom" },
    { id: "ST01", title: "ST", name: "ใบเบิกคลังวัตถุดิบ (ST)", pairs: ["PK", "PK-ST", "BG"], layout: "bom" },
    { id: "ST02", title: "PP", name: "ใบรวมทุกชิ้นที่ส่งเข้า PK (PP)", pairs: ["PK", "PK-PT", "PK-ST", "SE", "BG", "RB"], layout: "bom" },
    { id: "BG", title: "BG", name: "ใบงานแผนกกระเป๋า/เย็บ (BG)", pairs: ["PK", "BG"], layout: "bom" },
    { id: "PK", title: "PK", name: "ใบประกอบ/บรรจุ (PK)", pairs: ["PK", "PK-PT", "PK-ST", "SE", "BG"], layout: "bom" },
    { id: "ASK", title: "ใบตรวจสอบชิ้นงานคงคลัง", name: "ใบตรวจสอบชิ้นงานคงคลัง (ให้คลังนับ)", pairs: ["PK", "RB", "SE"], layout: "ask" },
    { id: "WIP-RBGR", title: "WIP Stock RB/GR", name: "ใบงาน RB + GR พร้อมข้อมูลการตัด", pairs: ["RB", "SE"], layout: "wip-rbgr" },
    { id: "WIP-PTBG", title: "WIP Stock PT/BG", name: "ใบงาน PT + BG + คลัง + PK", pairs: ["PK", "PK-PT", "PT-ST", "PK-ST", "BG-PT", "BG-ST", "PK-BG", "PK-PK", "BG", "GR-ST", "ST"], layout: "wip-ptbg" },
  ].map((sheet) => Object.freeze({ ...sheet, pairs: Object.freeze(sheet.pairs) })));
  const sheetOf = (id) => SHEETS.find((sheet) => sheet.id === String(id ?? "").toUpperCase()) ?? null;
  // บรรทัดของใบหนึ่งจากผลระเบิดทั้งใบ: คู่ผู้ผลิตของแต่ละบรรทัดคิดจากแผนกของพ่อ (บรรทัดก่อนหน้าใน path)
  function sheetLines(sheet, explodedLines) {
    const deptOf = new Map(explodedLines.map((line) => [`${line.fgCode}|${line.itemCode}`, line.producerDept]));
    return explodedLines
      .map((line) => ({ ...line, pair: producerPair(line, line.parentCode ? deptOf.get(`${line.fgCode}|${line.parentCode}`) ?? "PK" : "PK") }))
      .filter((line) => sheet.pairs.includes(line.pair));
  }

  // ---------- รหัส ----------
  // รหัส canonical: ตัดช่องว่าง ยุบขีดซ้ำ ตัวพิมพ์ใหญ่ ("RB-B0005-02- -132-9-25" และ "RB-B0005-02--132-9-25" เป็นตัวเดียวกัน)
  const canonicalCode = (raw) => String(raw ?? "").replace(/\s+/g, "").replace(/-{2,}/g, "-").toUpperCase();
  const isBlankCode = (raw) => {
    const text = String(raw ?? "").trim();
    return text === "" || text === "-" || text === "0";
  };
  // ชนิดจากรหัส/แผนก: ใช้ตอนนำเข้า
  function kindOf({ code, deptKind, pair }) {
    const c = canonicalCode(code);
    const p = String(pair ?? "").trim().toUpperCase();
    if (c.startsWith("RB-") || deptKind === "RB") return "RB";
    if (c.startsWith("SE-") || deptKind === "SE" || p === "SE") return "SE";
    if (c.startsWith("PT-")) return "PT";
    if (p === "PK-BG" || deptKind === "BG") return "BG";
    if (deptKind === "PK" && !p.includes("-")) return "FG";
    if (isBlankCode(code)) return "SUBPART";
    return "PURCHASED";
  }
  // แผนกเจ้าของ: ตามชนิด ยกเว้นชิ้นทำเองใช้แผนกผู้ใช้ของคู่ (PK-PK → PK)
  const ownerDeptOf = (kind, pair = "") => (kind === "SUBPART" ? (String(pair).split("-")[0] || "PK").toUpperCase() : KINDS[kind]?.dept ?? "ST");

  // แยกส่วนของรหัส FG: MEGA-ST-01(P)-Y → ฐาน MEGA-ST-01 แพ็กเกจ P ชุดสี Y (รายการแพ็กเกจ/ชุดสีตามชีต ;}o ของไฟล์ MRP)
  const PACKAGES = Object.freeze(["B", "C", "P", "X", "K", "N", "B-N"]);
  const COLOR_SETS = Object.freeze(["A", "B", "C", "D", "E", "O", "S", "Y"]);
  function parseFgCode(code) {
    const text = String(code ?? "").trim();
    const match = text.match(/^(.*?)(?:\(([^)]*)\))?(?:-([A-Z]))?$/);
    return { base: match?.[1] ?? text, pkg: match?.[2] ?? "", colorSet: match?.[3] ?? "" };
  }
  // ประกอบรหัส FG จาก 3 ช่องแบบชีต ;}o: ฐาน + (แพ็กเกจ) + -ชุดสี (ช่องว่าง = ไม่ใส่ส่วนนั้น)
  const buildFgCode = (base, pkg = "", colorSet = "") => `${canonicalCode(base)}${String(pkg ?? "").trim() ? `(${String(pkg).trim().toUpperCase()})` : ""}${String(colorSet ?? "").trim() ? `-${String(colorSet).trim().toUpperCase()}` : ""}`;
  // รหัส RB: RB-<สูตรยาง>-<ประเภท>-<สี>-<ความยาว>-<รู/หนา>-<วงนอก>
  function parseRbCode(code) {
    const parts = canonicalCode(code).split("-");
    if (parts[0] !== "RB" || parts.length < 6) return null;
    const [, compound, type, ...rest] = parts;
    const nums = rest.slice(-3).map(Number);
    const color = rest.length > 3 ? rest.slice(0, rest.length - 3).join("-") : "";
    return { compound, type, color, lengthMm: nums[0], holeMm: nums[1], odMm: nums[2] };
  }
  // รหัส SE: SE-<สินค้า>-<สี>-<ความยาว>-<รู/หนา>-<วงนอก>
  function parseSeCode(code) {
    const parts = canonicalCode(code).split("-");
    if (parts[0] !== "SE" || parts.length < 5) return null;
    const [, product, ...rest] = parts;
    const nums = rest.slice(-3).map(Number);
    const color = rest.length > 3 ? rest.slice(0, rest.length - 3).join("-") : "";
    return { product, color, lengthMm: nums[0], holeMm: nums[1], odMm: nums[2] };
  }
  const buildRbCode = (r) => `RB-${r.compound}-${r.type}${r.color ? `-${r.color}` : ""}-${r.lengthMm}-${r.holeMm}-${r.odMm}`;
  const buildSeCode = (s) => `SE-${s.product}${s.color ? `-${s.color}` : ""}-${s.lengthMm}-${s.holeMm}-${s.odMm}`;

  // ---------- สี ชุดสี แพ็กเกจ ----------
  // สี = แม่สี 2 ตัวอักษร + เฉด 2 หลัก (OR01) ตามคอลัมน์ แม่สี/เฉดที่ ของ BOMSHEET · รายชื่อแม่สีที่พบในชีต
  const COLOR_MASTERS = Object.freeze({ RD: "แดง", OR: "ส้ม", YE: "เหลือง", GN: "เขียว", BL: "ฟ้า", NB: "น้ำเงิน", PU: "ม่วง", PK: "ชมพู", BK: "ดำ", WH: "ขาว", GY: "เทา", BR: "น้ำตาล", XX: "ไม่ระบุ" });
  const parseColorCode = (raw) => {
    const match = String(raw ?? "").trim().toUpperCase().match(/^([A-Z]{2})(\d{2})$/);
    return match ? { code: match[0], master: match[1], shade: match[2] } : null;
  };
  const colorName = (code, colors = []) => {
    const known = colors.find((entry) => entry.code === String(code ?? "").toUpperCase());
    if (known?.name) return known.name;
    const parsed = parseColorCode(code);
    return parsed ? `${COLOR_MASTERS[parsed.master] ?? parsed.master} ${parsed.shade}` : String(code ?? "");
  };
  // แยกรหัส SE/RB เป็นส่วนคงที่ (SE-<สินค้า> หรือ RB-<สูตร>-<ประเภท>) + สี + ตัวเลข 3 ช่วงท้าย โดยคงสตริงเดิม (065 ไม่กลายเป็น 65)
  // null = ไม่ใช่ SE/RB หรือสามช่วงท้ายไม่ใช่ตัวเลข (รหัสแบบนั้นไม่ถือว่ามีสีในรหัส)
  function splitColorCode(code) {
    const parts = canonicalCode(code).split("-");
    const fixed = parts[0] === "SE" ? 2 : parts[0] === "RB" ? 3 : 0;
    if (!fixed || parts.length < fixed + 3) return null;
    const tail = parts.slice(-3);
    if (!tail.every((part) => /^\d+(\.\d+)?$/.test(part))) return null;
    return { prefix: parts.slice(0, fixed).join("-"), color: parts.slice(fixed, -3).join("-"), tail: tail.join("-") };
  }
  // สีในรหัส SE/RB (ช่วงระหว่างส่วนคงที่กับตัวเลข 3 ช่วงท้าย) ว่าง = ชิ้นไม่ระบุสีในรหัส — นิยามเดียวกับ colorSlotKey/recolorCode
  const colorOfCode = (code) => splitColorCode(code)?.color ?? "";
  // กุญแจ "ช่องสี" = รหัส SE/RB ที่ถอดสีออก (SE-TP01-*-100-18-65) ใช้จับคู่ช่องเดียวกันข้ามชุดสี · null = ชิ้นที่ไม่มีสีในรหัส
  function colorSlotKey(code) {
    const split = splitColorCode(code);
    return split ? `${split.prefix}-*-${split.tail}` : null;
  }
  // รหัสเดิมแต่เปลี่ยนสี (SE-TP01-OR01-100-18-65 + RD01 → SE-TP01-RD01-100-18-65) รหัสที่ไม่ใช่ SE/RB หรือแยกส่วนไม่ได้คืนเดิม
  function recolorCode(code, color) {
    const c = String(color ?? "").trim().toUpperCase();
    const split = splitColorCode(code);
    if (!split) return canonicalCode(code);
    return `${split.prefix}${c ? `-${c}` : ""}-${split.tail}`;
  }
  // ชื่อชิ้นเมื่อเปลี่ยนสี: แทนรหัสสีเดิมและชื่อสีไทยในชื่อ (ลองทั้งชื่อที่ลงทะเบียนและชื่อแม่สีมาตรฐาน ยาวก่อน) ถ้าไม่พบต่อท้ายด้วยสีใหม่
  function renameColor(name, fromColor, toColor, colors = []) {
    let text = String(name ?? "");
    const from = String(fromColor ?? "").toUpperCase();
    const to = String(toColor ?? "").toUpperCase();
    if (!to || from === to) return text;
    let touched = false;
    if (from && text.includes(from)) { text = text.split(from).join(to); touched = true; }
    const stem = (code) => colorName(code, colors).replace(/\s*\d+$/, "");
    const masterName = (code) => COLOR_MASTERS[parseColorCode(code)?.master] ?? "";
    const toName = stem(to);
    const fromNames = from ? [...new Set([stem(from), masterName(from)].filter(Boolean))].sort((a, b) => b.length - a.length) : [];
    for (const fromName of fromNames) {
      if (!text.includes(fromName)) continue;
      if (fromName !== toName) text = text.split(fromName).join(toName);
      touched = true; // เฉดใหม่ของแม่สีเดิม (RD02 → RD01): ชื่อสีไทยถูกอยู่แล้ว ไม่ต่อท้ายซ้ำ
      break;
    }
    if (touched) return text.includes(to) ? text : `${text} ${to}`.trim();
    return `${text} ${toName} ${to}`.trim();
  }
  // ช่องสีของสินค้า: บรรทัดชั้นแรกที่เป็น SE หรือ RB เรียงตามลำดับบรรทัด ซ้ำกุญแจได้ (ลูกบอลสามสีคือ SE เดียวกันสามช่อง)
  // RB ที่อยู่ใต้ SE ไม่เป็นช่องของตัวเอง (ตาม BOMSHEET สี RB ตามแถว SE เหนือมัน)
  function colorSlotsOf(fgCode, { itemOf, approvedBomOf }) {
    const bom = approvedBomOf(fgCode);
    if (!bom) return [];
    const slots = [];
    bom.lines.forEach((line, lineIndex) => {
      const item = itemOf(line.childCode);
      if (!item || !["SE", "RB"].includes(item.kind)) return;
      const key = colorSlotKey(line.childCode);
      if (!key) return;
      slots.push({ key, color: String(item.rubber?.color || colorOfCode(line.childCode) || "").toUpperCase(), itemCode: line.childCode, lineIndex });
    });
    return slots;
  }
  // แผนเปลี่ยนสีจากต้นแบบไปชุดสีเป้าหมาย: จับคู่ตามกุญแจและลำดับที่พบ → plan [{ lineIndex, from, to, color }] และช่องที่ชุดสีไม่ได้กำหนด
  function colorChangePlan(sourceSlots, targetSlots) {
    const pools = new Map();
    for (const slot of targetSlots) (pools.get(slot.key) ?? pools.set(slot.key, []).get(slot.key)).push(String(slot.color ?? "").toUpperCase());
    const plan = [];
    const unmatched = [];
    for (const slot of sourceSlots) {
      const pool = pools.get(slot.key);
      const color = pool?.length ? pool.shift() : "";
      if (!color) { unmatched.push(slot); continue; }
      if (color === slot.color) continue;
      plan.push({ lineIndex: slot.lineIndex, from: slot.itemCode, to: recolorCode(slot.itemCode, color), color, fromColor: slot.color });
    }
    return { plan, unmatched };
  }

  // ---------- หน่วยนับ ----------
  // หน่วยในชีตมี 356 แบบสะกด (ชิ้น/pcs · ชิ้น/pcs. · ชิ้น(20g) · กก.(112pcs) · ม้วน(50M) · ม้วน (50M) …) → หน่วยมาตรฐาน + ขนาดแพ็ก/น้ำหนักต่อชิ้น
  const UOMS = Object.freeze({
    pcs: { label: "ชิ้น", kind: "count" }, set: { label: "ชุด", kind: "count" }, box: { label: "กล่อง", kind: "count" }, roll: { label: "ม้วน", kind: "pack" },
    rod: { label: "เส้น", kind: "count" }, ball: { label: "ลูก", kind: "count" }, pack: { label: "แพ็ก", kind: "pack" }, bucket: { label: "ถัง", kind: "pack" }, sheet: { label: "แผ่น", kind: "count" },
    kg: { label: "กก.", kind: "weight" }, g: { label: "กรัม", kind: "weight" }, m: { label: "เมตร", kind: "length" }, yd: { label: "หลา", kind: "length" }, cm: { label: "ซม.", kind: "length" },
    other: { label: "หน่วยอื่น", kind: "count" },
  });
  function normalizeUom(raw) {
    const text = String(raw ?? "").trim();
    const lower = text.toLowerCase();
    const paren = lower.match(/\(([^)]*)\)/)?.[1] ?? "";
    const base = lower.replace(/\([^)]*\)/g, "").replace(/\s+/g, "").replace(/\.$/, "");
    let code = "other";
    if (/^(ชิ้น|pcs|ชิ้น\/pcs|ชิ้น\/pcs\.|pc|ใบ)$/.test(base) || base.startsWith("ชิ้น")) code = "pcs"; // ใบ = คู่มือ/ใบแทรก นับเป็นชิ้น
    else if (base.startsWith("ชุด") || base.includes("set")) code = "set";
    else if (base.startsWith("กล่อง")) code = "box";
    else if (base.startsWith("ม้วน")) code = "roll";
    else if (base === "ถัง") code = "bucket"; // ถัง(18 kg) สีสกรีน
    else if (base === "เส้น") code = "rod";
    else if (base === "ลูก") code = "ball";
    else if (base.startsWith("แผ่น")) code = "sheet";
    else if (base.startsWith("แพ็ก") || base.startsWith("แพค") || base === "pack") code = "pack";
    else if (/^(กก|กิโลกรัม|kg|kgs)$/.test(base)) code = "kg";
    else if (/^(กรัม|g)$/.test(base)) code = "g";
    else if (/^(เมตร|m)$/.test(base)) code = "m";
    else if (base === "หลา" || base === "yd") code = "yd";
    else if (/^(ซม|cm)$/.test(base)) code = "cm";
    const result = { code, raw: text };
    const packMatch = paren.match(/^([\d.,]+)\s*(m|เมตร|y|yd|หลา|kg|kgs|กก|ชิ้น|pcs)\.?$/);
    if (packMatch) {
      const unit = packMatch[2];
      result.pack = { qty: Number(packMatch[1].replace(/,/g, "")), unit: /^(m|เมตร)$/.test(unit) ? "m" : /^(y|yd|หลา)$/.test(unit) ? "yd" : /^(kg|kgs|กก)$/.test(unit) ? "kg" : "pcs" };
    }
    const weightMatch = paren.match(/^([\d.]+)\s*g$/);
    if (weightMatch && code === "pcs") result.weightG = Number(weightMatch[1]);
    return result;
  }
  const uomLabel = (code) => UOMS[code]?.label ?? String(code ?? "");

  // ---------- ปริมาณ RB ต่อ SE (สูตร O ของ BOMSHEET) ----------
  // นับเป็นเส้น/ม้วน: 1 / (จำนวนชิ้น GR ที่ตัดได้ต่อเส้น × จำนวน SE ที่ได้ต่อ 1 GR) · นับเป็นกิโลกรัม: น้ำหนักชิ้นงาน (กรัม) / 1000
  function rbPerSe({ pcsPerRoll, sePerGr = 1, uom = "pcs", weightG = 0 }) {
    if (uom === "kg") return Number(weightG) > 0 ? Number(weightG) / 1000 : 0;
    const pcs = Number(pcsPerRoll) || 0;
    const per = Number(sePerGr) || 1;
    return pcs > 0 ? 1 / (pcs * per) : 0;
  }

  // ---------- อ่านตาราง TSV/CSV ที่วางมาจาก Excel ----------
  function parseDelimited(text) {
    const raw = String(text ?? "").replace(/^﻿/, "");
    const delimiter = raw.includes("\t") ? "\t" : ",";
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (quoted) {
        if (ch === '"' && raw[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === "") quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && raw[i + 1] === "\n") i += 1;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((cells) => cells.some((value) => String(value).trim() !== ""));
  }

  // คอลัมน์ที่รู้จักของชีต DATA (หัวคอลัมน์ต่างกันเล็กน้อยระหว่าง master กับไฟล์ต่อ PI จึงจับด้วยคำสำคัญ)
  // รองรับ 3 แบบ: master DATA BOM.xlsx · ชีต DATA ของไฟล์ต่อ PI · ชีต BOMSHEET / BOMSHEET (S) ของใบที่ออกแล้ว (หัวคอลัมน์ต่างคำ จึงมีหลายคำต่อช่อง)
  const COLUMNS = Object.freeze([
    ["item", /^ITEM/i], ["code", /^CODE|^รหัส FG\/RB/i], ["deptKind", /^รหัสแผนก/], ["compound", /สูตรยาง/], ["c1", /^สี ?SE|ยางกลมมีรู|ประเภทยาง/],
    ["c2", /^ความยาว ?SE/], ["c3", /^รู/], ["c4", /^วงนอก ?SE/], ["c5", /^วงนอก ?RB/], ["name", /^NAME|^ชื่อสินค้า|^ชื่อวัตถุดิบ/i],
    ["pair", /^แผนกผู้ผลิต/], ["qty", /^จำนวนที่ใช้ต่อชุด|^จำนวน ?SE\/ST/], ["cutLen", /^ความยาว ?(GR )?ตัด/], ["pcsPerRoll", /^จำนวนชิ้น.*ต่อเส้น|^จำนวน ?GR ?ตัดได้/],
    // น้ำหนัก (กรัม) ต่อเส้น/ม้วน RB อยู่คอลัมน์ "น้ำหนัก…ท่อนยาว" / "น.น ต่อเส้น RB" (BOMSHEET: "นน.ชิ้นงาน(กรัม)") — ไม่ใช่คอลัมน์ B ("น.น RB/g") ซึ่งเป็นเลขลำดับแถว
    ["sePerGr", /^จำนวนที่ได้.*1 ?GR|^จำนวน ?SE ?ที่ได้/], ["uom", /^หน่วยนับ|^หน่วยวัสดุ/], ["weight", /ท่อนยาว|^น\.น ต่อเส้น|^นน\.ชิ้นงาน/],
  ]);
  function detectHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
      const cells = rows[r].map((cell) => String(cell).trim());
      if (!cells.some((cell) => /^ITEM/i.test(cell)) || !cells.some((cell) => /^CODE|^รหัส FG\/RB/i.test(cell))) continue;
      const map = {};
      for (const [key, pattern] of COLUMNS) {
        const index = cells.findIndex((cell, i) => pattern.test(cell) && !Object.values(map).includes(i));
        if (index >= 0) map[key] = index;
      }
      // คอลัมน์สีของ BOMSHEET (R–W): แม่สี/เฉดที่ 3 คู่ เรียงซ้ายไปขวา จับคู่ตามลำดับ
      const masters = cells.map((cell, i) => (/^แม่สี/.test(cell) ? i : -1)).filter((i) => i >= 0);
      const shades = cells.map((cell, i) => (/^เฉด/.test(cell) ? i : -1)).filter((i) => i >= 0);
      const colors = masters.slice(0, 3).map((master, k) => [master, shades[k]]).filter(([, shade]) => shade !== undefined);
      if (map.item !== undefined && map.code !== undefined && map.name !== undefined) return { rowIndex: r, map, colors };
    }
    return null;
  }
  // สีของแถวจากคอลัมน์ แม่สี/เฉดที่: คู่ที่เป็นรหัสสีจริง (XX99) ต่อกันด้วย "-" ("XX"/ว่าง = ไม่มี) เช่น RD+01 → RD01 · YE+03, BK+01 → YE03-BK01
  function rowColor(row, colors = []) {
    return colors.filter(([master, shade]) => String(row[master] ?? "").trim() && String(row[shade] ?? "").trim()).map(([master, shade]) => parseColorCode(`${String(row[master] ?? "").trim()}${String(row[shade] ?? "").trim().padStart(2, "0")}`)).filter((parsed) => parsed && parsed.master !== "XX").map((parsed) => parsed.code).join("-");
  }
  const num = (value) => {
    const text = String(value ?? "").replace(/,/g, "").trim();
    if (text === "" || text === "-") return 0;
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  };
  const cellText = (row, index) => (index === undefined ? "" : String(row[index] ?? "").trim());

  // แปลงแถวของชีต DATA เป็นออบเจ็กต์กลาง (ยังไม่ประกอบต้นไม้)
  function readFlatRows(text) {
    const rows = parseDelimited(text);
    const header = detectHeader(rows);
    if (!header) throw new Error("ไม่พบแถวหัวคอลัมน์ (ต้องมี ITEM, CODE และ NAME/ชื่อสินค้า) — วางทั้งแถวหัวตารางมาด้วย");
    const { map, colors } = header;
    const out = [];
    for (const row of rows.slice(header.rowIndex + 1)) {
      const item = cellText(row, map.item);
      if (!item || item === "ITEM" || item === ".") continue; // "." = แถวเว้นของ BOMSHEET
      const name = cellText(row, map.name);
      const code = cellText(row, map.code);
      if (!name && isBlankCode(code)) continue;
      out.push({
        item, code, deptKind: cellText(row, map.deptKind).toUpperCase(), pair: cellText(row, map.pair).toUpperCase(), name,
        compound: cellText(row, map.compound), c1: cellText(row, map.c1), c2: cellText(row, map.c2), c3: cellText(row, map.c3), c4: cellText(row, map.c4), c5: cellText(row, map.c5),
        qty: num(row[map.qty]), cutLen: num(row[map.cutLen]), pcsPerRoll: num(row[map.pcsPerRoll]), sePerGr: num(row[map.sePerGr]) || 1,
        uom: cellText(row, map.uom), weightG: num(row[map.weight]), color: rowColor(row, colors),
      });
    }
    return out;
  }

  // ---------- ประกอบต้นไม้จากชีตแบน ----------
  // แต่ละ ITEM: แถว PK ที่รหัส = ฐานของ ITEM คือ FG · SE เป็นลูกของ FG · RB เป็นลูกของ SE ล่าสุด (ปริมาณจากสูตร rbPerSe ไม่ใช่ตัวเลขในชีตที่ซ้ำกับ SE) ·
  // คู่ PT-ST/BG-ST/BG-PT เป็นลูกของชิ้น PT/BG ล่าสุด · GR-ST ลูกของ SE ล่าสุด · คู่ PK-* ลูกของ FG · บรรทัดซ้ำ (ลูกเดียวกันใต้พ่อเดียวกัน) รวมปริมาณ
  // คืน { items: Map(code → item), boms: Map(parentCode → lines[]), report }
  function buildFromFlat(flatRows, { group = "TOY", subpartStart = 1 } = {}) {
    const items = new Map();
    const boms = new Map();
    const report = { fgCount: 0, lineCount: 0, merged: 0, subparts: 0, variants: 0, colored: 0, conflicts: [], unknownUom: new Set(), compounds: new Set() };
    let subpartSeq = subpartStart;
    const subpartByName = new Map();

    const ensureItem = (code, props, legacyRaw = code) => {
      const canonical = canonicalCode(code);
      let item = items.get(canonical);
      if (!item) {
        item = { code: canonical, kind: props.kind, name: props.name || canonical, ownerDept: ownerDeptOf(props.kind, props.pair), uom: props.uom, weightG: props.weightG || 0, group, legacyCodes: [], rubber: props.rubber ?? null, active: true };
        items.set(canonical, item);
      }
      const raw = String(legacyRaw).trim();
      if (raw && raw !== canonical && !item.legacyCodes.includes(raw)) { item.legacyCodes.push(raw); if (canonicalCode(raw) === canonical) report.variants += 1; } // รหัสไม่มีสีของชิ้นที่ได้สีจากคอลัมน์ ไม่นับเป็นสะกดต่าง
      if (!item.name && props.name) item.name = props.name;
      if (!item.weightG && props.weightG) item.weightG = props.weightG;
      if (props.rubber && item.rubber) {
        for (const key of ["cutLengthCm", "pcsPerRoll", "sePerGr"]) if (!item.rubber[key] && props.rubber[key]) item.rubber[key] = props.rubber[key];
      }
      return item;
    };
    const subpartFor = (row) => {
      const key = `${row.name}|${row.uom}`;
      if (!subpartByName.has(key)) {
        subpartByName.set(key, `XP-${String(subpartSeq).padStart(5, "0")}`);
        subpartSeq += 1;
        report.subparts += 1;
      }
      return subpartByName.get(key);
    };
    // บรรทัดซ้ำ: ใต้ FG เดียวกันรวมปริมาณ (สินค้าใช้ชิ้นเดิมสองตำแหน่ง) · ใต้พ่ออื่น (SE/PT/BG) ปริมาณเป็นอัตราส่วนต่อพ่อ จึงใช้ค่าแรกและรายงานถ้าต่างกัน
    const addLine = (parentCode, line, context) => {
      const lines = boms.get(parentCode) ?? [];
      const existing = lines.find((entry) => entry.childCode === line.childCode);
      if (existing) {
        // บรรทัดซ้ำที่ปริมาณ 0 เป็นแถวอธิบาย (MAM-03: แผ่นพลาสติกใส 4 แถว แถวแรกเก็บพื้นที่รวม แถวอื่นเป็น 0) จึงไม่นับเป็นข้อขัดแย้ง
        if (line.qty === 0) return;
        if (existing.qty === 0) { existing.qty = line.qty; return; }
        if (context.sameFg && context.parentIsFg) { existing.qty += line.qty; report.merged += 1; } else if (Math.abs(existing.qty - line.qty) > 1e-9 && report.conflicts.length < 200) {
          report.conflicts.push(`${parentCode} → ${line.childCode}: ปริมาณ ${existing.qty} (ครั้งแรก) กับ ${line.qty} (${context.item}) ไม่เท่ากัน ใช้ค่าแรก`);
        }
        return;
      }
      if (boms.has(parentCode) && !context.sameFg && context.parentSeen) {
        if (report.conflicts.length < 200) report.conflicts.push(`${parentCode}: มีลูก ${line.childCode} เฉพาะใน ${context.item} (ใช้ชุดแรกเป็นหลัก เพิ่มลูกใหม่ให้)`);
      }
      lines.push(line);
      boms.set(parentCode, lines);
    };

    const byItem = new Map();
    for (const row of flatRows) (byItem.get(row.item) ?? byItem.set(row.item, []).get(row.item)).push(row);
    const parentsSeenBefore = new Set();
    for (const [itemName, rows] of byItem) {
      report.fgCount += 1;
      const fgParsed = parseFgCode(itemName);
      // แถวหัวสินค้า = แถว PK (คู่ผู้ผลิตไม่มี "-") ที่รหัสตรงกับ ITEM หรือถ้าไม่มี ใช้แถวแรกของสินค้าเมื่อเป็นแถวแบบนั้น
      // (ใบ 25047: MEGA-BBL-06(P)-Y มีแถวหัวรหัส MEGA-BBL-06(P) และ MEGA-ENC-3(P)-Y ใช้รหัสลูกค้า SPORTIME-ENC-3) รหัสในแถวหัวเก็บเป็นรหัสเดิมของ FG
      const isHeaderRow = (row) => row?.deptKind === "PK" && !String(row.pair ?? "").includes("-");
      const matchedRow = rows.find((row) => isHeaderRow(row) && (canonicalCode(row.code) === canonicalCode(fgParsed.base) || canonicalCode(row.code) === canonicalCode(itemName)));
      const fallbackRow = !matchedRow && isHeaderRow(rows[0]) ? rows[0] : undefined;
      const fgRow = matchedRow ?? fallbackRow;
      const fgCode = canonicalCode(itemName);
      const fgUom = normalizeUom(fgRow?.uom || "ชุด");
      ensureItem(fgCode, { kind: "FG", name: fgRow?.name || `สินค้า ${itemName}`, uom: fgUom.code, pair: "PK" }, fallbackRow?.code || fgCode); // รหัสฐาน (MEGA-ST-01) ไม่เก็บเป็นรหัสเดิม
      const seenInThisFg = new Set([fgCode]);
      // พ่อล่าสุดของแต่ละชนิด พร้อม "จำนวนที่ใช้ต่อชุด" ของพ่อในสินค้านี้ — คอลัมน์นั้นเป็นปริมาณต่อ 1 FG ทั้งชีต
      // ลูกของ PT/BG/SE (เม็ดพลาสติก ผ้า ซิป ของสิ้นเปลือง) จึงต้องหารด้วยจำนวนพ่อต่อชุดให้เป็น "ต่อ 1 ชิ้นพ่อ" (เช่น เม็ด 0.006 กก./ชุด ÷ แกน 0.3 ชิ้น/ชุด = 0.02 กก./ชิ้น)
      let lastSe = null;
      let lastPt = null;
      let lastBg = null;
      const parentQty = {};
      const perParent = (parentCode, qty) => {
        const divisor = Number(parentQty[parentCode]) || 0;
        return divisor > 0 ? Math.round((qty / divisor) * 1e12) / 1e12 : qty;
      };
      for (const row of rows) {
        if (row === fgRow) continue;
        report.lineCount += 1;
        const kind = kindOf(row);
        const uom = normalizeUom(row.uom);
        if (uom.code === "other" && row.uom) report.unknownUom.add(row.uom);
        const rawCode = kind === "SUBPART" ? subpartFor(row) : row.code;
        // BOMSHEET: SE/RB ที่รหัสไม่มีสี (SE-SL01B--68-0-68) แต่คอลัมน์ แม่สี/เฉดที่ ระบุสี → รหัสมีสี (SE-SL01B-RD01-68-0-68)
        // บอลสามสีในใบเดียวจึงเป็นสามชิ้น ไม่ถูกรวมเป็นชิ้นเดียว · รหัสที่มีสีอยู่แล้วใช้สีในรหัส
        const colorFromColumns = (kind === "SE" || kind === "RB") && row.color && !colorOfCode(rawCode) && colorSlotKey(rawCode) ? row.color : "";
        const code = colorFromColumns ? recolorCode(rawCode, colorFromColumns) : canonicalCode(rawCode);
        if (colorFromColumns) report.colored += 1;
        const weightG = row.weightG || uom.weightG || 0;
        let rubber = null;
        if (kind === "RB") {
          const parsed = parseRbCode(code) ?? {};
          rubber = { compound: row.compound || parsed.compound || "", type: parsed.type ?? row.c1, color: parsed.color ?? row.c2, lengthMm: parsed.lengthMm ?? num(row.c3), holeMm: parsed.holeMm ?? num(row.c4), odMm: parsed.odMm ?? num(row.c5), cutLengthCm: row.cutLen, pcsPerRoll: row.pcsPerRoll, sePerGr: row.sePerGr || 1, kgPerRoll: uom.code === "kg" ? 0 : weightG / 1000 };
          if (rubber.compound) report.compounds.add(rubber.compound);
        } else if (kind === "SE") {
          const parsed = parseSeCode(code) ?? {};
          rubber = { product: parsed.product ?? row.compound, color: parsed.color ?? row.c1, lengthMm: parsed.lengthMm ?? num(row.c2), holeMm: parsed.holeMm ?? num(row.c3), odMm: parsed.odMm ?? num(row.c4) };
        }
        // ชื่อของชิ้นที่ได้สีจากคอลัมน์: ถ้าชื่อยังไม่มีรหัสสี ต่อท้ายด้วยชื่อสี (RB ชื่อเดียวกันสามสีจะได้ชื่อต่างกัน)
        const firstColor = colorFromColumns.split("-")[0];
        const thaiNames = colorFromColumns.split("-").map((c) => COLOR_MASTERS[parseColorCode(c)?.master] ?? "").filter(Boolean);
        const name = !colorFromColumns || !row.name || row.name.toUpperCase().includes(firstColor) ? row.name
          : thaiNames.length && thaiNames.every((thai) => row.name.includes(thai)) ? `${row.name} ${colorFromColumns}` // ชื่อมีสีไทยอยู่แล้ว ต่อเฉพาะรหัส
          : `${row.name} ${thaiNames.join("-")} ${colorFromColumns}`.replace(/\s+/g, " ").trim();
        const item = ensureItem(code, { kind, name, uom: uom.code, weightG, pair: row.pair, rubber }, rawCode); // ส่งรหัสตามชีตเพื่อเก็บสะกดเดิมเป็น legacy code
        // พ่อของบรรทัดนี้
        let parentCode = fgCode;
        let qty = row.qty;
        if (kind === "RB") {
          parentCode = lastSe ?? fgCode;
          qty = lastSe ? rbPerSe({ pcsPerRoll: row.pcsPerRoll, sePerGr: row.sePerGr || 1, uom: uom.code, weightG }) : row.qty;
          if (lastSe && qty === 0) { qty = row.qty; if (report.conflicts.length < 200) report.conflicts.push(`${code}: ไม่มีจำนวนชิ้นที่ตัดได้ต่อเส้น ใช้ปริมาณตามชีต (${row.qty}) ใต้ ${lastSe}`); }
        } else if (row.pair === "PT-ST") parentCode = lastPt ?? fgCode;
        else if (row.pair === "BG-ST" || row.pair === "BG-PT") parentCode = lastBg ?? fgCode;
        else if (row.pair === "GR-ST") parentCode = lastSe ?? fgCode;
        if (kind !== "RB" && parentCode !== fgCode) qty = perParent(parentCode, row.qty);
        if (kind === "SE") { lastSe = code; parentQty[code] = row.qty; }
        if (kind === "PT") { lastPt = code; parentQty[code] = row.qty; }
        if (kind === "BG") { lastBg = code; parentQty[code] = row.qty; }
        const consumerDept = parentCode === fgCode ? "PK" : items.get(parentCode)?.ownerDept ?? "PK";
        const line = { childCode: code, qty: Number(qty) || 0, uom: uom.code, consumerDept, producerDept: item.ownerDept, scrapPct: 0, flags: [], note: "" };
        const sameFg = seenInThisFg.has(parentCode);
        addLine(parentCode, line, { sameFg, item: itemName, parentSeen: parentsSeenBefore.has(parentCode), parentIsFg: parentCode === fgCode });
        seenInThisFg.add(parentCode);
      }
      for (const parent of seenInThisFg) parentsSeenBefore.add(parent);
    }
    report.unknownUom = [...report.unknownUom];
    report.compounds = [...report.compounds].sort();
    report.itemCount = items.size;
    report.bomCount = boms.size;
    return { items, boms, report };
  }

  // ---------- ระเบิด BOM ----------
  // approvedBomOf(code) → { id, revision, lines } หรือ null · itemOf(code) → item
  // คืนบรรทัดแบนเรียงแบบ BOMSHEET: แถว FG ก่อน แล้วลูกตามลำดับ (depth-first) พร้อม qtyPerFg และ required
  function explode(fgCode, fgQty, { itemOf, approvedBomOf, maxDepth = 8 }) {
    const lines = [];
    const missing = [];
    const walk = (code, qtyPerFg, level, path, parentCode, qtyPerParent) => {
      const item = itemOf(code);
      if (!item) { missing.push(code); return; }
      lines.push({ fgCode, level, path: [...path, code], itemCode: code, name: item.name, kind: item.kind, uom: item.uom, producerDept: item.ownerDept, parentCode, qtyPerParent, qtyPerFg, required: qtyPerFg * fgQty, bomId: null, revision: null });
      const row = lines.at(-1);
      if (level >= maxDepth) return;
      const bom = approvedBomOf(code);
      // RB เป็นชิ้นปลายทางของ BOM นี้ (สูตรคอมปาวด์อยู่ที่ RubberFlow) และชิ้นทำเองไม่บังคับมี BOM
      if (!bom) { if (MANUFACTURED.includes(item.kind) && !["SUBPART", "RB"].includes(item.kind)) row.noBom = true; return; }
      row.bomId = bom.id;
      row.revision = bom.revision;
      for (const line of bom.lines) {
        if (path.includes(line.childCode)) { missing.push(`${line.childCode} (วงจร)`); continue; }
        const factor = Number(line.qty) * (1 + (Number(line.scrapPct) || 0) / 100);
        walk(line.childCode, qtyPerFg * factor, level + 1, [...path, code], code, factor);
      }
    };
    walk(fgCode, 1, 0, [], null, 1);
    return { lines, missing: [...new Set(missing)] };
  }

  // ---------- โครงสร้างสินค้า: ขั้นตอนผลิต (routing) ต้นทุน และเวลา (จำลอง) ----------
  // แนวคิดจากเมนู "โครงสร้าง" ของ ERP เดิม (Utech): ต้นไม้สินค้ามีสองกิ่ง Bom = ส่วนประกอบ และ Build = WIP → Process (เวลา นาที/ชิ้น)
  // ที่นี่ BOM เดิมคือส่วนประกอบ ส่วนขั้นตอนผลิตเป็น routing ต่อชิ้นงาน (เก็บเป็น revision เหมือน BOM) แทนการแทรกแถว WIP/Process ลงในต้นไม้
  // ต้นทุนต่อหน่วย = วัตถุดิบ (ลูกใน BOM × ปริมาณ × (1 + % เผื่อเสีย) หรือราคาที่ตั้งเองถ้าไม่มี BOM) + ค่าแรง (นาที/ชิ้น × อัตราของแผนก)
  // ชิ้นที่ไม่มี BOM และยังไม่ตั้งราคา ทำให้ต้นทุนของพ่อทุกชั้น "ไม่ครบ" (complete=false) และอยู่ใน missingCost
  const DEFAULT_PROCESSES = Object.freeze([
    { code: "RB-EXT", name: "รีดเส้นยาง", dept: "RB" },
    { code: "RB-CURE", name: "อบ/คงรูปเส้นยาง", dept: "RB" },
    { code: "GR-CUT", name: "ตัดชิ้นยาง", dept: "GR" },
    { code: "GR-DRL", name: "เจาะรู", dept: "GR" },
    { code: "GR-GLUE", name: "ทากาว", dept: "GR" },
    { code: "GR-GRIND", name: "เจียร", dept: "GR" },
    { code: "GR-SORT", name: "คัดแยก", dept: "GR" },
    { code: "PT-INJ", name: "ฉีดพลาสติก", dept: "PT" },
    { code: "PT-CUT", name: "ตัดท่อ/แกน", dept: "PT" },
    { code: "BG-CUT", name: "ตัดผ้า", dept: "BG" },
    { code: "BG-SEW", name: "เย็บ", dept: "BG" },
    { code: "PK-ASM", name: "ประกอบ", dept: "PK" },
    { code: "PK-BAG", name: "ใส่สินค้าในกระเป๋า", dept: "PK" },
    { code: "PK-QC", name: "ตรวจคุณภาพ", dept: "PK" },
    { code: "PK-PACK", name: "บรรจุ", dept: "PK" },
  ].map((entry) => Object.freeze(entry)));
  // อัตราค่าแรงสาธิต (บาท/นาที) ต่อแผนก ไม่ใช่ตัวเลขจริงของบริษัท
  const LABOR_BAHT_PER_MIN = Object.freeze({ RB: 3, GR: 2.5, PT: 2, BG: 2.5, ST: 1.5, PK: 2 });
  const round = (n, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

  // ชิ้นที่ต้องผลิตก่อน (สายป้อนในมุมมองลำดับผลิต): ชิ้นที่แผนกเราทำเอง (ไม่ใช่ของซื้อ) แม้ยังไม่มี BOM/ขั้นตอน
  // เช่น เส้นยาง RB ที่มีได้แค่คอมปาวด์จาก RubberFlow · ของซื้อที่มี BOM หรือขั้นตอนก็นับด้วย
  const isFeed = (child) => child.kind !== "PURCHASED" || child.children.length > 0 || child.steps.length > 0;
  // ลำดับที่ชิ้นพร้อมให้พ่อใช้: เส้นยาง RB พร้อมหลังขั้น SR/QC รับเข้าคลัง (ลำดับถัดจากรีด) · ชิ้นอื่นพร้อมเมื่อผลิตเสร็จ
  const receiveOrder = (node) => (node.kind === "RB" && node.level > 0 ? node.order + 1 : null);
  const readyOrder = (node) => receiveOrder(node) ?? node.order;
  // คืน { root, rows (เรียงแบบต้นไม้ ลึกก่อน), minutesByDept (ต่อ 1 หน่วยราก), missingCost, missing }
  // routingOf(code) → { revision, steps: [{ processCode, minutesPerPc }] } | null · processOf(code) → { code, name, dept } | null
  function structureTree(rootCode, { itemOf, approvedBomOf, routingOf, processOf, rates = LABOR_BAHT_PER_MIN, maxDepth = 8 }) {
    const rows = [];
    const missing = [];
    const missingCost = new Set();
    const minutesByDept = {};
    const build = (code, level, path, line, qtyPerRoot) => {
      const item = itemOf(code);
      if (!item) { missing.push(code); return null; }
      const bom = level < maxDepth ? approvedBomOf(code) : null;
      const routing = routingOf(code);
      const steps = (routing?.steps ?? []).map((step) => {
        const process = processOf(step.processCode);
        const dept = process?.dept ?? item.ownerDept;
        const minutesPerPc = Number(step.minutesPerPc) || 0;
        minutesByDept[dept] = round((minutesByDept[dept] ?? 0) + minutesPerPc * qtyPerRoot);
        return { processCode: step.processCode, name: process?.name ?? step.processCode, dept, minutesPerPc, cost: round(minutesPerPc * (rates[dept] ?? 0)), inputs: Array.isArray(step.inputs) ? [...step.inputs] : [] };
      });
      const node = {
        itemCode: item.code, name: item.name, kind: item.kind, uom: item.uom, dept: item.ownerDept ?? KINDS[item.kind]?.dept ?? "ST", image: item.image ?? null, level, qtyPerParent: line?.qty ?? 1, scrapPct: Number(line?.scrapPct) || 0, step: Number.isInteger(Number(line?.step)) && line.step >= 1 && line.step <= 20 ? Number(line.step) : null, qtyPerRoot,
        bomRevision: bom?.revision ?? null, routingRevision: routing?.revision ?? null, steps, children: [], material: 0, labor: 0, unitCost: 0, complete: true, ownCost: null,
      };
      rows.push(node);
      if (bom) {
        for (const childLine of bom.lines) {
          if (path.includes(childLine.childCode)) { missing.push(`${childLine.childCode} (วงจร)`); node.complete = false; continue; }
          const factor = Number(childLine.qty) * (1 + (Number(childLine.scrapPct) || 0) / 100);
          const child = build(childLine.childCode, level + 1, [...path, childLine.childCode], childLine, qtyPerRoot * factor);
          if (!child) { node.complete = false; continue; }
          node.children.push(child);
          node.material += child.unitCost * factor;
          if (!child.complete) node.complete = false;
        }
      } else if (Number.isFinite(item.unitCost)) {
        node.ownCost = item.unitCost;
        node.material = item.unitCost;
      } else {
        node.complete = false;
        missingCost.add(item.code);
      }
      // ลำดับการผลิต: สายป้อนต้องเสร็จก่อนพ่อ จึง = 1 + ลำดับมากสุดของสายป้อน · สายที่ไม่ต่อกันได้เลขเดียวกัน (ทำพร้อมกันได้)
      // เส้นยาง RB ต้องผ่าน SR รับเข้าคลัง + QC ตรวจขนาด (receiveOrder) ก่อนแผนกถัดไปเบิกไปใช้
      node.order = 1 + Math.max(0, ...node.children.filter(isFeed).map(readyOrder));
      node.labor = steps.reduce((sum, step) => sum + step.cost, 0);
      node.material = round(node.material);
      node.labor = round(node.labor);
      node.unitCost = round(node.material + node.labor);
      node.costPerRoot = round(node.unitCost * qtyPerRoot);
      return node;
    };
    const root = build(rootCode, 0, [rootCode], null, 1);
    return { root, rows, minutesByDept, totalMinutes: round(Object.values(minutesByDept).reduce((sum, value) => sum + value, 0)), missingCost: [...missingCost], missing: [...new Set(missing)] };
  }

  // มุมมองลำดับผลิต (ขั้นแรกอยู่บน) ของโหนดหนึ่งใน structureTree: ลูกที่มี BOM หรือขั้นตอนผลิตของตัวเองเป็น "สายป้อน" (feeds) วางเหนือพ่อ
  // แล้วไล่ขั้นตอนของพ่อทีละขั้น ลูกเข้าที่ขั้นที่ routing ระบุใน step.inputs ก่อน ถ้าไม่ได้ระบุใช้ "ขั้นที่" ของบรรทัด BOM (child.step 1–20)
  // ไม่มีทั้งสองอย่าง = ขั้นแรก · จำนวนขั้น = มากสุดของขั้นตอนผลิตและเลขขั้นที่ของบรรทัด ขั้นที่ไม่มีขั้นตอนผลิตมี step เป็น null
  // stage.no = เลขขั้น (1 ขึ้นไป) ใช้แสดงเทียบกับช่อง "ขั้นที่" ของหน้าสร้าง BOM
  function flowOf(node) {
    const feeds = node.children.filter(isFeed);
    const stepIndex = new Map();
    node.steps.forEach((step, index) => (step.inputs ?? []).forEach((code) => { if (!stepIndex.has(code)) stepIndex.set(code, index); }));
    const indexOf = (child) => stepIndex.get(child.itemCode) ?? (child.step ? child.step - 1 : 0);
    const count = Math.max(node.steps.length, 1, ...node.children.map((child) => indexOf(child) + 1));
    const stages = Array.from({ length: count }, (_, index) => ({ no: index + 1, step: node.steps[index] ?? null, inputs: [] }));
    for (const child of node.children) stages[indexOf(child)].inputs.push(child);
    return { feeds, stages };
  }

  // รายการขั้นตอนเรียงตามลำดับ (มุมมอง "ขั้นตอนตามลำดับ") ตามผังงานของบริษัท:
  //   type "purchase" (order 0) = ST สั่ง/เบิกของซื้อทั้งหมด ยอดต่อสินค้า 1 หน่วย
  //   type "make" = ชิ้นที่ต้องผลิต ลำดับไหน แผนกไหน ใช้อะไรเท่าไร · type "receive" = SR รับเส้นยางเข้าคลัง + QC ตรวจขนาด (ต่อจากรีด)
  //   type "store" (ลำดับสุดท้าย) = WH รับสินค้าสำเร็จรูปจาก PK เข้าคลัง
  // รหัสเดียวกันที่อยู่หลายกิ่งรวมเป็นแถวเดียว (จำนวนต่อสินค้ารวมกัน ลำดับใช้ค่ามากสุด) · input.from = ลำดับที่ชิ้นนั้นพร้อมใช้ (null = ของซื้อ)
  // เรียงลำดับ → แผนกตาม FLOW_DEPTS → รหัส
  function productionSteps(tree) {
    const made = new Map();
    const bought = new Map();
    const add = (map, key, node, entry) => {
      const found = map.get(key);
      if (found) { found.order = Math.max(found.order, entry.order); found.qtyPerRoot = round(found.qtyPerRoot + node.qtyPerRoot); }
      else map.set(key, { ...entry, itemCode: node.itemCode, name: node.name, uom: node.uom, qtyPerRoot: round(node.qtyPerRoot) });
    };
    for (const node of tree.rows) {
      if (node.level > 0 && !isFeed(node)) { add(bought, node.itemCode, node, { type: "purchase", order: 0, dept: "ST" }); continue; }
      const inputs = node.children.map((child) => ({ itemCode: child.itemCode, name: child.name, kind: child.kind, uom: child.uom, qtyPerParent: child.qtyPerParent, scrapPct: child.scrapPct, from: isFeed(child) ? readyOrder(child) : null }));
      add(made, `make|${node.itemCode}`, node, { type: "make", order: node.order, dept: node.dept, steps: node.steps, inputs });
      if (receiveOrder(node) !== null) add(made, `receive|${node.itemCode}`, node, { type: "receive", order: receiveOrder(node), dept: "SR", steps: [], inputs: [] });
    }
    const deptRank = (dept) => (FLOW_DEPTS.includes(dept) ? FLOW_DEPTS.indexOf(dept) : FLOW_DEPTS.length);
    const rows = [...made.values()].sort((a, b) => a.order - b.order || deptRank(a.dept) - deptRank(b.dept) || a.itemCode.localeCompare(b.itemCode));
    // ชิ้นที่ใช้ในหลายกิ่งแล้วพร้อมคนละลำดับ: บอกลำดับที่พร้อมครบทุกชิ้น (มากสุด)
    const readyAt = new Map(rows.map((row) => [row.itemCode, row.order]));
    rows.forEach((row) => row.inputs.forEach((input) => { if (input.from !== null) input.from = readyAt.get(input.itemCode) ?? input.from; }));
    const root = tree.root;
    const purchase = { type: "purchase", order: 0, dept: "ST", itemCode: "", name: "", uom: "", qtyPerRoot: 0, steps: [], inputs: [...bought.values()].sort((a, b) => a.itemCode.localeCompare(b.itemCode)).map((entry) => ({ itemCode: entry.itemCode, name: entry.name, uom: entry.uom, qtyPerRoot: entry.qtyPerRoot, from: null })) };
    const store = { type: "store", order: root.order + 1, dept: "WH", itemCode: root.itemCode, name: root.name, uom: root.uom, qtyPerRoot: 1, steps: [], inputs: [] };
    // WH รับเฉพาะสินค้าสำเร็จรูป · เปิดโครงสร้างของชิ้นย่อย (PT, SE ฯลฯ) จบที่ชิ้นนั้น
    return [...(purchase.inputs.length ? [purchase] : []), ...rows, ...(root.kind === "FG" ? [store] : [])];
  }

  // ---------- ความต้องการสุทธิ (สูตร AK ของ BOMSHEET ยกมาคิดทั้งใบ) ----------
  // คิดต่อรหัสชิ้นงาน (รวมทุกบรรทัดของรหัสเดียวกันในใบ) ไล่จากชั้นบนลงล่าง:
  //   ขาด = ความต้องการ − คงคลังที่นับ · ต้องผลิต/สั่งซื้อ = ขาด (ไม่ติดลบ) · ของเกิน = คงคลังที่เหลือจากความต้องการ
  //   ความต้องการของชิ้นลูก = ปริมาณต่อพ่อ × ส่วนที่พ่อยังต้องผลิต (ไม่ใช่ความต้องการเต็มของพ่อ)
  // ตรงกับ Excel: RB ต้องรีด = O × (SE ต้องเบิก − สต๊อก SE) − สต๊อก RB · ต่างจาก Excel สองจุดโดยตั้งใจ:
  //   ของเกินของพ่อไม่ถูกส่งต่อเป็นค่าติดลบของลูก และคงคลังนับต่อรหัสครั้งเดียวทั้งใบ ไม่ใช่ต่อบรรทัด (ชีตคีย์ซ้ำทุกบรรทัด)
  // รหัสที่ไม่ได้นับ (undefined) ถือว่าไม่มีของ · คงคลังของตัว FG (ชั้น 0) ไม่ถูกใช้ เพราะใบสั่งผลิตต้องผลิตครบจำนวนสั่งเสมอ
  // คืนรายการเรียงตามชั้นลึกสุดแล้วตามรหัส
  function netRequirements(explodedLines, stockCounts = {}) {
    const entries = new Map();
    const edges = new Map(); // "พ่อ|ลูก" → ปริมาณลูกต่อ 1 พ่อ (รวมเศษ)
    for (const line of explodedLines) {
      const entry = entries.get(line.itemCode) ?? { itemCode: line.itemCode, name: line.name, kind: line.kind, uom: line.uom, dept: line.producerDept, level: 0, lines: 0, required: 0, fgCodes: new Set(), parents: new Set(), children: new Set() };
      entry.level = Math.max(entry.level, line.level);
      entry.lines += 1;
      entry.fgCodes.add(line.fgCode);
      if (line.level === 0) entry.required += line.required; // ความต้องการตั้งต้น = จำนวนสั่ง FG
      if (line.parentCode) {
        entry.parents.add(line.parentCode);
        entries.get(line.parentCode)?.children.add(line.itemCode);
        edges.set(`${line.parentCode}|${line.itemCode}`, Number(line.qtyPerParent) || 0);
      }
      entries.set(line.itemCode, entry);
    }
    // พ่อทุกตัวมีชั้นลึกสุดน้อยกว่าลูก (การระเบิดเดินทั้งต้นไม้ทุกครั้งที่พบพ่อ) จึงไล่ตามชั้นได้
    const ordered = [...entries.values()].sort((a, b) => a.level - b.level || a.itemCode.localeCompare(b.itemCode));
    const round = (n) => Math.round(n * 1e4) / 1e4;
    for (const entry of ordered) {
      const counted = entry.level > 0 && stockCounts[entry.itemCode] !== undefined && stockCounts[entry.itemCode] !== null && stockCounts[entry.itemCode] !== "";
      entry.stock = counted ? Number(stockCounts[entry.itemCode]) || 0 : undefined;
      entry.net = entry.required - (entry.stock ?? 0);
      entry.toMake = round(Math.max(entry.net, 0));
      entry.surplus = round(Math.max(-entry.net, 0));
      for (const child of entry.children) {
        const childEntry = entries.get(child);
        if (childEntry) childEntry.required += (edges.get(`${entry.itemCode}|${child}`) ?? 0) * entry.toMake;
      }
    }
    return ordered.map((entry) => ({
      ...entry, required: round(entry.required), net: round(entry.net), fgCodes: [...entry.fgCodes],
      parents: [...entry.parents].map((code) => ({ code, qtyPerParent: edges.get(`${code}|${entry.itemCode}`) ?? 0 })),
      children: [...entry.children].map((code) => ({ code, qtyPerParent: edges.get(`${entry.itemCode}|${code}`) ?? 0 })),
    }));
  }
  // จัดกลุ่มผล netRequirements ตามแผนกผู้ผลิต เรียงต้นน้ำ → ปลายน้ำ (แผนกที่ไม่อยู่ในรายการต่อท้าย) ข้ามแผนกที่ไม่มีงาน
  function groupByDept(entries) {
    const depts = [...FLOW_DEPTS, ...new Set(entries.map((entry) => entry.dept).filter((dept) => !FLOW_DEPTS.includes(dept)))];
    return depts.map((dept) => ({ dept, entries: entries.filter((entry) => entry.dept === dept) })).filter((group) => group.entries.length);
  }

  // รวมความต้องการต่อ (แผนกผู้ผลิต, ชิ้น) ของทั้งใบ → งานรายแผนก / รายการเบิก-สั่งซื้อ (ST)
  function aggregateRequirements(explodedLines) {
    const map = new Map();
    for (const line of explodedLines) {
      if (line.level === 0) continue; // ตัว FG เอง นับเป็นงาน PK ต่างหากจากรายการสินค้า
      const key = `${line.producerDept}|${line.itemCode}`;
      const entry = map.get(key) ?? { dept: line.producerDept, itemCode: line.itemCode, name: line.name, kind: line.kind, uom: line.uom, required: 0, fgCodes: new Set() };
      entry.required += line.required;
      entry.fgCodes.add(line.fgCode);
      map.set(key, entry);
    }
    return [...map.values()].map((entry) => ({ ...entry, fgCodes: [...entry.fgCodes] }));
  }
  const toMake = (required, stock) => Math.round((Number(required) - (Number(stock) || 0)) * 1e4) / 1e4;

  // ---------- CSV (เปิดใน Excel) ----------
  // ค่าที่ขึ้นต้นด้วย = + - @ ถูกนำหน้าด้วย ' กัน Excel ตีความเป็นสูตร (ชื่อจากชีต/ชื่อลูกค้าเป็นข้อความที่ผู้ใช้กรอก) ตัวเลขไม่ถูกแตะ
  const csvCell = (value) => {
    const text = typeof value === "number" ? String(value) : /^[=+\-@]/.test(String(value ?? "")) ? `'${value}` : String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;

  // ---------- จัดรูปแบบ ----------
  const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const fmtDate = (ms) => {
    if (!ms || !Number.isFinite(Number(ms))) return "-";
    const d = new Date(Number(ms));
    return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${String(d.getFullYear() + 543).slice(2)}`;
  };
  const fmtDateTime = (ms) => {
    if (!ms) return "-";
    const d = new Date(Number(ms));
    return `${fmtDate(ms)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  // ตัวเลขปริมาณ: จำนวนเต็มไม่มีทศนิยม เศษแสดงถึง 4 ตำแหน่ง (อัตราส่วน RB ต่อ SE เช่น 0.0323)
  const fmtQty = (n, digits = null) => {
    const value = Number(n);
    if (n === null || n === undefined || Number.isNaN(value)) return "-";
    const d = digits ?? (Number.isInteger(value) ? 0 : Math.abs(value) < 1 ? 4 : 2);
    return value.toLocaleString("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  // เวลา (นาที) และเงิน (บาท) ของโครงสร้างสินค้า: ไม่เติมศูนย์ท้าย
  const fmtNum = (n, maxDigits = 2) => {
    const value = Number(n);
    if (n === null || n === undefined || Number.isNaN(value)) return "-";
    return value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: maxDigits });
  };
  const toInputDate = (ms) => {
    if (!ms || !Number.isFinite(Number(ms))) return "";
    const d = new Date(Number(ms));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fromInputDate = (text) => {
    const [y, m, d] = String(text ?? "").split("-").map(Number);
    if (!y || !m || !d) return NaN;
    return new Date(y, m - 1, d).getTime();
  };
  const orderTypeOf = (country) => (/^(thailand|ไทย|th)$/i.test(String(country ?? "").trim()) ? "SA" : "EX");

  const api = {
    DAY, KINDS, MANUFACTURED, DEPTS, DEPT_LABEL, DUE_DEPTS, FLOW_DEPTS, UOMS, PACKAGES, COLOR_SETS, COLOR_MASTERS,
    piNumber, piYear, LEAD_DAYS, defaultDueDates, producerPair, SHEETS, sheetOf, sheetLines,
    canonicalCode, isBlankCode, kindOf, ownerDeptOf, parseFgCode, buildFgCode, parseRbCode, parseSeCode, buildRbCode, buildSeCode,
    parseColorCode, colorName, colorOfCode, colorSlotKey, recolorCode, renameColor, colorSlotsOf, colorChangePlan,
    normalizeUom, uomLabel, rbPerSe, parseDelimited, detectHeader, readFlatRows, buildFromFlat, explode, aggregateRequirements, netRequirements, groupByDept, toMake,
    DEFAULT_PROCESSES, LABOR_BAHT_PER_MIN, structureTree, flowOf, productionSteps,
    toCsv, fmtDate, fmtDateTime, fmtQty, fmtNum, toInputDate, fromInputDate, orderTypeOf,
  };
  if (isNode) module.exports = api;
  else root.MNP_BOM_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
