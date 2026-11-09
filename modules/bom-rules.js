// BOM รายแผนก (โหมดทดสอบ) — กฎล้วน ไม่มี DOM/Supabase: รหัสชิ้นงาน หน่วยนับ อ่านตาราง BOM จาก Excel (วางเป็น TSV)
// ประกอบต้นไม้หลายชั้นจากชีตแบน (DATA ของ DATA BOM.xlsx / ไฟล์ Material_*.xlsm) ระเบิด BOM ของใบสั่งผลิต และสร้าง CSV
// ที่มาของกติกา: docs/BOM_SYSTEM_PLAN.md §1.2 (สูตรปริมาณของ BOMSHEET) เทสต์ด้วย node --test (scripts/tests/bom-rules.test.mjs)
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const DAY = 86400000;

  // ---------- ชนิดชิ้นงานและแผนกเจ้าของ ----------
  // KINDS: FG สินค้าสำเร็จรูป (PK) · SE ชิ้นยางย่อยที่ตัด/เจาะแล้ว (GR) · RB เส้นยาง (RB) · PT ชิ้นพลาสติก (PT) · BG กระเป๋า/เย็บ (BG) ·
  // PURCHASED ของซื้อ/คลัง (ST) · SUBPART ชิ้นที่แผนกทำเองโดยยังไม่มีรหัส (เจ้าของตามคู่ผู้ผลิต) ·
  // CP สูตรยาง/คอมปาวด์ (RB ผสม สูตร PHR อยู่ที่ RubberFlow) เป็นบรรทัดใต้เส้นยาง หน่วยกิโลกรัม ไม่มี BOM และไม่เป็นงานของแผนกในระบบนี้
  const KINDS = Object.freeze({
    FG: { label: "สินค้าสำเร็จรูป", dept: "PK" },
    SE: { label: "ชิ้นยาง (ตัด/เจาะ)", dept: "GR" },
    RB: { label: "เส้นยาง", dept: "RB" },
    PT: { label: "ชิ้นพลาสติก", dept: "PT" },
    BG: { label: "กระเป๋า/งานเย็บ", dept: "BG" },
    PURCHASED: { label: "ของซื้อ/คลัง", dept: "ST" },
    SUBPART: { label: "ชิ้นทำเอง (ยังไม่มีรหัส)", dept: "PK" },
    CP: { label: "สูตรยาง (คอมปาวด์)", dept: "RB" },
  });
  const MANUFACTURED = Object.freeze(["FG", "SE", "RB", "PT", "BG", "SUBPART"]);
  // ชิ้นที่ต้องมี BOM ก่อนปล่อยผลิต (ระเบิดแล้วไม่มี BOM = ปล่อยไม่ได้): ชิ้นที่ผลิตเอง ยกเว้นเส้นยาง (มีได้แค่สูตรยางจาก RubberFlow) และชิ้นทำเอง
  const NEEDS_BOM_KINDS = Object.freeze(MANUFACTURED.filter((kind) => !["SUBPART", "RB"].includes(kind)));
  // หมวดที่ผู้ใช้เลือกตอนสร้าง BOM (กลุ่มของชนิด): สินค้า · WIP · วัตถุดิบ · สูตรยาง
  // ชนิดเป็นตัวกำหนดพฤติกรรม (แผนก งาน ต้องมี BOM ไหม) หมวดจึงคำนวณจากชนิด ไม่เก็บแยก จะได้ไม่ขัดกัน
  const CATEGORIES = Object.freeze([
    { id: "PRODUCT", label: "สินค้า", long: "สินค้า", kinds: ["FG"] },
    { id: "WIP", label: "WIP", long: "WIP (งานระหว่างผลิต)", kinds: ["SE", "RB", "PT", "BG", "SUBPART"] },
    { id: "RAW", label: "วัตถุดิบ", long: "วัตถุดิบ", kinds: ["PURCHASED"] },
    { id: "COMPOUND", label: "สูตรยาง", long: "สูตรยาง", kinds: ["CP"] },
  ].map((entry) => Object.freeze({ ...entry, kinds: Object.freeze(entry.kinds) })));
  const categoryOf = (kind) => CATEGORIES.find((entry) => entry.kinds.includes(kind)) ?? null;
  // ชนิดที่ไม่มีส่วนประกอบ: ของซื้อ และสูตรยาง (สูตร PHR อยู่ที่ RubberFlow)
  const LEAF_KINDS = Object.freeze(["PURCHASED", "CP"]);
  // ชิ้นชนิด childKind อยู่ใต้ parentKind ได้ไหม: "" = ได้ · ข้อความ = เหตุผลที่ไม่ได้
  // เส้นยางมีลูกได้เฉพาะสูตรยาง และสูตรยางอยู่ได้เฉพาะใต้เส้นยาง (เส้นยางหนึ่งเส้นใช้สูตรเดียว ตรวจที่ saveBom)
  function childKindError(parentKind, childKind) {
    if (LEAF_KINDS.includes(parentKind)) return `${KINDS[parentKind]?.label ?? parentKind}ไม่มีส่วนประกอบ`;
    if (parentKind === "RB" && childKind !== "CP") return "เส้นยางมีส่วนประกอบได้เฉพาะสูตรยาง (สูตร PHR อยู่ที่ RubberFlow)";
    if (childKind === "CP" && parentKind !== "RB") return "สูตรยางใส่ได้เฉพาะใต้เส้นยาง (RB)";
    return "";
  }
  const DEPTS = Object.freeze(["PK", "GR", "RB", "PT", "BG", "ST"]);
  const DEPT_LABEL = Object.freeze({ PK: "PK · บรรจุ/ประกอบ", GR: "GR · ตัด/เจาะชิ้นยาง", RB: "RB · รีดเส้นยาง", PT: "PT · ฉีดพลาสติก", BG: "BG · กระเป๋า/เย็บ", ST: "ST · คลังวัตถุดิบ", SR: "SR · คลังยางเส้นยาว", QA: "QA · ตรวจขนาดยาง", WH: "WH · คลังสินค้าสำเร็จรูป", SA: "ฝ่ายขาย", PP: "ฝ่ายวางแผน" });
  // ลำดับกำหนดเสร็จรายแผนกในหัวใบสั่งผลิต (MAIN ของไฟล์ Excel)
  const DUE_DEPTS = Object.freeze(["RB", "GR", "PT", "BG", "ST", "PK"]);
  // ผังงานของบริษัท 11 ลำดับ (ใบสั่งผลิต → BOM/ใบสั่งงาน → วัตถุดิบ → ผลิต → คลัง) "ลำดับ" ของทุกหน้าโครงสร้างคือเลขนี้:
  // ชิ้นงานได้ลำดับตามแผนกเจ้าของ เลขน้อยทำก่อน เลขเดียวกันคือแผนกเดียวกัน (ลำดับภายในแผนกดูจากรายการ "ใช้")
  const PROCESS_FLOW = Object.freeze([
    { no: 1, dept: "SA", title: "ออกใบสั่งผลิตให้แผนกวางแผน" },
    { no: 2, dept: "PP", title: "ออก BOM และใบสั่งงานให้ฝ่ายผลิต", detail: "สำรวจยางคงคลังก่อนสั่งผลิต" },
    { no: 3, dept: "ST", title: "สั่งวัตถุดิบที่เกี่ยวข้องกับการผลิต" },
    { no: 4, dept: "RB", title: "ขึ้นรูปยาง", detail: "13 ขั้น: ชั่งเคมี → ตียาง/ใส่เคมี → พักยาง → … → ฉีด → อบ Oven/HCM → ตัดยางเส้นยาว" },
    { no: 5, dept: "SR", title: "รับยางเส้นยาวเข้าคลัง" },
    { no: 6, dept: "QA", title: "ตรวจเช็คขนาดยางขณะรับเข้าคลัง" },
    { no: 7, dept: "GR", title: "แปรรูปยาง", detail: "9 ขั้น: รีด → ปั๊ม → เปเปอร์ → ตัดยาง → ทากาว → เจียร์ (หยาบ/ละเอียด เฉพาะบางไซส์) → เจาะ" },
    { no: 8, dept: "PT", title: "ขึ้นรูปพลาสติก" },
    { no: 9, dept: "BG", title: "เย็บกระเป๋าใส่สินค้า" },
    { no: 10, dept: "PK", title: "ประกอบบรรจุภัณฑ์", detail: "ประกอบชิ้นจาก GR/PT → ใส่กระเป๋าจาก BG → บรรจุลงกล่อง" },
    { no: 11, dept: "WH", title: "รับสินค้าจาก PK เข้าคลังสินค้าสำเร็จรูป" },
  ].map((entry) => Object.freeze(entry)));
  const flowStepOf = (dept) => PROCESS_FLOW.find((entry) => entry.dept === dept)?.no ?? 10;
  // บรรทัด BOM เรียงตามลำดับแผนกผู้ผลิตของลูกในผังงาน (ของซื้อ ST 3 → เส้นยาง RB 4 → ชิ้นยาง GR 7 → พลาสติก PT 8 → กระเป๋า BG 9 → ชิ้นทำเอง PK 10)
  // ลำดับเท่ากันคงลำดับเดิม · ใช้ทุกจุดที่บันทึก BOM และตอนอัปเกรดข้อมูลเก่า (bom-store v5) ให้หน้าสร้าง BOM อ่านจากบนลงล่างตามผังงาน
  const lineDept = (line, itemOf) => { const item = itemOf?.(line.childCode); return item?.ownerDept ?? line.producerDept ?? KINDS[item?.kind]?.dept ?? "ST"; };
  const sortLinesByFlow = (lines, itemOf) => lines.map((line, index) => ({ line, index, rank: flowStepOf(lineDept(line, itemOf)) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ line }) => line);
  // ลำดับการไหลของงานรายแผนก (ลำดับ 3 → 11 ของผังงาน) ใช้เรียงการ์ดในหน้า "สินค้า 1 ตัว → งานทุกแผนก" และตารางเวลาผลิต
  const FLOW_DEPTS = Object.freeze(PROCESS_FLOW.filter((entry) => entry.no >= 3).map((entry) => entry.dept));

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
      case "CP": return "CP"; // สูตรยางใต้เส้นยาง: อยู่ในใบงาน RB เท่านั้น
      default: return String(line.kind);
    }
  }
  // ตารางกฎสถานี: ใบไหนต้องเห็นคู่ผู้ผลิตใด (แปลงจากสูตร IF ในคอลัมน์ AM–AT และตัวกรองของมาโคร) · layout = ชุดคอลัมน์ของใบ
  const SHEETS = Object.freeze([
    { id: "RB", title: "RB", name: "ใบงานแผนกรีดเส้นยาง", pairs: ["PK", "RB", "CP"], layout: "bom" },
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
      if (isBlankCode(name) && isBlankCode(code)) continue; // แถวว่างหรือแถวเลขศูนย์ของชีต (ชื่อและรหัสเป็น "", "-" หรือ "0") ไม่ใช่ข้อมูล
      out.push({
        item, code, deptKind: cellText(row, map.deptKind).toUpperCase(), pair: cellText(row, map.pair).toUpperCase(), name,
        compound: cellText(row, map.compound), c1: cellText(row, map.c1), c2: cellText(row, map.c2), c3: cellText(row, map.c3), c4: cellText(row, map.c4), c5: cellText(row, map.c5),
        qty: num(row[map.qty]), cutLen: num(row[map.cutLen]), pcsPerRoll: num(row[map.pcsPerRoll]), sePerGr: num(row[map.sePerGr]) || 1,
        uom: cellText(row, map.uom), weightG: num(row[map.weight]), color: rowColor(row, colors),
      });
    }
    return out;
  }

  // ---------- วางหลายบรรทัดจาก Excel ลงตารางสร้าง BOM ----------
  // อ่านข้อความที่ copy จากชีต (TSV หรือ CSV): คอลัมน์ รหัส · ปริมาณ · หน่วย · % เผื่อเสีย · หมายเหตุ (· ชื่อ เฉพาะเมื่อมีแถวหัว)
  // มีแถวหัว (ชื่อคอลัมน์ไทย/อังกฤษที่รู้จัก) = จับคอลัมน์ตามชื่อ · ไม่มี = ตามลำดับข้างบน · แถวแรกที่ช่องปริมาณไม่ใช่ตัวเลขแต่แถวถัดไปเป็นตัวเลข และช่องรหัสไม่ใช่ชิ้นงานที่มีอยู่ (isKnownCode) ถือเป็นแถวหัวที่ไม่รู้จัก ข้ามไป
  // คืน { header, truncated, rows: [{ line, code, qty, uom, scrapPct, note, name, error }] } error ว่าง = อ่านได้ (ยังไม่ตรวจกับ item master)
  const PASTE_MAX_ROWS = 500;
  const PASTE_HEADS = Object.freeze([["code", /^(code|part|รหัส)/i], ["qty", /^(qty|quantity|จำนวน|ปริมาณ)/i], ["uom", /^(uom|unit|หน่วย)/i], ["scrap", /^(scrap|%|เผื่อ)/i], ["note", /^(note|remark|หมายเหตุ)/i], ["name", /^(name|description|ชื่อ)/i]]);
  // ตัวเลขจากชีต: . กับ , อยู่ด้วยกัน = ตัวท้ายเป็นทศนิยม อีกตัวเป็นหลักพัน (ต้องจัดกลุ่ม 3 หลักให้ถูก) · มี , อย่างเดียว: ตามด้วย 3 หลักพอดีและส่วนหน้าเป็นหลักพันที่ถูกต้อง (1,500) = หลักพัน นอกนั้น (0,5 · 1,5 · 12,25) = ทศนิยม ·
  // มี . อย่างเดียวเป็นทศนิยมตามปกติ · รูปแบบอื่นที่กำกวมหรือผิด (0,500 · 1.000.000 · 1,2,3 · 1e3) = NaN ให้ผู้ใช้แก้เอง ไม่เดาเงียบๆ
  const pasteNumber = (value) => {
    const match = /^([+-]?)([\d.,]+)$/.exec(String(value ?? "").replace(/[\s%]/g, ""));
    if (!match) return NaN;
    const [, sign, body] = match;
    const grouped = (part, separator) => (separator === "," ? /^[1-9]\d{0,2}(,\d{3})+$/ : /^[1-9]\d{0,2}(\.\d{3})+$/).test(part);
    const dot = body.lastIndexOf(".");
    const comma = body.lastIndexOf(",");
    let canonical = "";
    if (dot >= 0 && comma >= 0) {
      const at = Math.max(dot, comma);
      const groupSep = at === dot ? "," : ".";
      const integer = body.slice(0, at);
      const fraction = body.slice(at + 1);
      if (!grouped(integer, groupSep) || !/^\d+$/.test(fraction)) return NaN;
      canonical = `${integer.replaceAll(groupSep, "")}.${fraction}`;
    } else if (comma >= 0) {
      if (grouped(body, ",")) canonical = body.replaceAll(",", "");
      else if (/^\d+,\d+$/.test(body) && !/,\d{3}$/.test(body)) canonical = body.replace(",", ".");
      else return NaN; // 0,500 · 1234,567 · 1,2,3 · ,5 · 5,
    } else if (/^(\d+(\.\d+)?|\.\d+)$/.test(body)) canonical = body;
    else return NaN;
    return Number(`${sign}${canonical}`);
  };
  function parseBomPaste(text, { isKnownCode = () => false } = {}) {
    const cells = parseDelimited(text);
    let map = { code: 0, qty: 1, uom: 2, scrap: 3, note: 4 };
    let start = 0;
    let header = false;
    if (cells.length) {
      const named = {};
      cells[0].forEach((cell, index) => { const found = PASTE_HEADS.find(([key, pattern]) => named[key] === undefined && pattern.test(String(cell).trim())); if (found) named[found[0]] = index; });
      if (named.code !== undefined && named.qty !== undefined && named.code !== named.qty) { map = named; start = 1; header = true; }
      // หัวที่ไม่รู้จัก: ช่องปริมาณของบรรทัดแรกอ่านเป็นตัวเลขไม่ได้ + บรรทัดถัดไปอ่านได้ + ช่องรหัสของบรรทัดแรกไม่ใช่รหัสชิ้นงานที่มีอยู่ (ไม่งั้นเป็นบรรทัดข้อมูลที่พิมพ์ปริมาณผิด ไม่ข้าม)
      else if (cells.length > 1 && Number.isNaN(pasteNumber(cells[0][1])) && !Number.isNaN(pasteNumber(cells[1][1])) && !isKnownCode(canonicalCode(String(cells[0][0] ?? "").trim()))) { start = 1; header = true; }
    }
    const body = cells.slice(start);
    const seen = new Set();
    const rows = body.slice(0, PASTE_MAX_ROWS).map((row, index) => {
      const at = (key) => (map[key] === undefined ? "" : String(row[map[key]] ?? "").trim());
      const code = canonicalCode(at("code"));
      const qty = pasteNumber(at("qty"));
      const scrapText = at("scrap");
      const scrapPct = scrapText === "" ? 0 : pasteNumber(scrapText);
      const uomText = at("uom");
      const uom = uomText && UOMS[uomText.toLowerCase()] ? uomText.toLowerCase() : uomText ? (normalizeUom(uomText).code !== "other" ? normalizeUom(uomText).code : "") : "";
      let error = "";
      if (!code || isBlankCode(code)) error = "ไม่มีรหัสชิ้นงาน";
      else if (!Number.isFinite(qty) || qty <= 0) error = at("qty") && !Number.isFinite(qty) ? "อ่านปริมาณไม่ได้หรือกำกวม ใช้จุดเป็นทศนิยม เช่น 0.5 และ 1,500 = หนึ่งพันห้าร้อย" : "ปริมาณต้องเป็นตัวเลขมากกว่า 0";
      else if (!Number.isFinite(scrapPct) || scrapPct < 0) error = "% เผื่อเสียต้องเป็นตัวเลขไม่ติดลบ";
      else if (seen.has(code)) error = "รหัสซ้ำกับบรรทัดก่อนหน้า (รวมปริมาณเป็นบรรทัดเดียว)";
      if (code) seen.add(code);
      return { line: start + index + 1, code, qty: Number.isFinite(qty) ? qty : 0, uom, scrapPct: Number.isFinite(scrapPct) ? scrapPct : 0, note: at("note").slice(0, 200), name: at("name").slice(0, 160), error };
    });
    return { header, truncated: body.length > PASTE_MAX_ROWS, rows };
  }

  // ---------- ตรวจข้อมูลก่อนปล่อยผลิต (หน้า "ตรวจข้อมูล") ----------
  // คำนวณจากข้อมูลในหน้า ด้วยกฎเดียวกับ action: ชิ้นต้องผลิตที่ถูกใช้ใน BOM แล้วแต่ไม่มี BOM (ระเบิดแล้วเป็น noBom ปล่อยผลิตไม่ได้) ·
  // เส้นยางไม่มีสูตรยาง (ช่องสูตร และ/หรือ บรรทัด CP) · สินค้าไม่มี BOM · หน่วย "หน่วยอื่น" · รหัสที่ระบบสร้างให้ (XP-)
  // ชิ้นที่เลิกใช้ไม่ถูกนับ ยกเว้นกลุ่มแรกเพราะ BOM ที่ใช้อยู่ยังอ้างถึงมัน · อัตราส่วน RB ของ SE ที่ใช้ร่วมกันตรวจไม่ได้ (ไม่ได้เก็บหลังนำเข้า)
  function auditMaster({ items = [], boms = [] }) {
    const byCode = new Map(items.map((item) => [item.code, item]));
    const approved = new Map();
    for (const bom of boms) if (bom.status === "approved") approved.set(bom.itemCode, bom);
    const usedIn = new Map();
    for (const bom of approved.values()) for (const line of bom.lines) usedIn.set(line.childCode, [...(usedIn.get(line.childCode) ?? []), bom.itemCode]);
    const out = { noBom: [], rbCompound: [], fgNoBom: [], uomOther: [], generated: [] };
    for (const item of items) {
      const bom = approved.get(item.code);
      const parents = usedIn.get(item.code) ?? [];
      if (item.kind !== "FG" && NEEDS_BOM_KINDS.includes(item.kind) && !bom && parents.length) out.noBom.push({ item, usedIn: parents });
      if (item.active === false) continue;
      if (item.kind === "FG" && !bom) out.fgNoBom.push({ item });
      // เส้นยางที่ไม่รู้สูตรเลย (ไม่มีทั้งช่องสูตรและบรรทัด CP) · ช่องสูตรอย่างเดียวพอ: ข้อมูลที่นำเข้าจาก Excel ไม่มีบรรทัด CP และการปล่อยผลิตไม่ต้องใช้
      if (item.kind === "RB" && !item.rubber?.compound && !bom?.lines.some((line) => byCode.get(line.childCode)?.kind === "CP")) {
        out.rbCompound.push({ item, reasons: ["noCompound"] });
      }
      if (item.uom === "other") out.uomOther.push({ item });
      if (/^XP-\d+/.test(item.code)) out.generated.push({ item });
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.item.code.localeCompare(b.item.code));
    return out;
  }

  // ตัวเลือกเลข XP- ของชิ้นที่ไม่มีรหัสตอนนำเข้า · ในเครื่อง = นับชิ้น SUBPART + 1 (เหมือนเดิม)
  // โหมดฐานข้อมูล (ส่งรหัสสุ่ม suffix มา) = เลขสูงสุดของ XP- ที่มีอยู่ + 1 และต่อ -suffix: ผู้วางแผนสองคนที่นำเข้าจากเวอร์ชันเดียวกันจึงไม่ได้รหัสซ้ำกัน (ซ้ำ = BOM_STALE ทั้งชุดถูกย้อนกลับ)
  function subpartOptions(items, suffix = "") {
    if (!suffix) return { subpartStart: items.filter((item) => item.kind === "SUBPART").length + 1 };
    const numbers = items.map((item) => /^XP-(\d+)/.exec(String(item.code ?? ""))).filter(Boolean).map((match) => Number(match[1]));
    return { subpartStart: Math.max(0, ...numbers) + 1, subpartSuffix: suffix };
  }

  // ---------- ประกอบต้นไม้จากชีตแบน ----------
  // แต่ละ ITEM: แถว PK ที่รหัส = ฐานของ ITEM คือ FG · SE เป็นลูกของ FG · RB เป็นลูกของ SE ล่าสุด (ปริมาณจากสูตร rbPerSe ไม่ใช่ตัวเลขในชีตที่ซ้ำกับ SE) ·
  // คู่ PT-ST/BG-ST/BG-PT เป็นลูกของชิ้น PT/BG ล่าสุด · GR-ST ลูกของ SE ล่าสุด · คู่ PK-* ลูกของ FG · บรรทัดซ้ำ (ลูกเดียวกันใต้พ่อเดียวกัน) รวมปริมาณ
  // คืน { items: Map(code → item), boms: Map(parentCode → lines[]), report }
  const MADE_FROM_PURCHASED = Object.freeze(["BG", "PT", "SE", "RB"]); // ชนิดที่แถวหลังยกระดับของซื้อให้ได้ (แผนกผลิตเอง)
  function buildFromFlat(flatRows, { group = "TOY", subpartStart = 1, subpartSuffix = "" } = {}) {
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
      } else if (item.kind === "PURCHASED" && MADE_FROM_PURCHASED.includes(props.kind)) {
        // รหัสเดียวกันเป็นของซื้อในสินค้าหนึ่ง (คู่ PK-ST) แต่อีกสินค้าบอกว่าแผนกผลิตเอง (คู่ PK-BG / รหัสแผนก): ใช้ชนิดที่ผลิตเอง
        // ไม่งั้นชิ้นนั้นมีส่วนประกอบ (ผ้า เทป) ทั้งที่เป็นของซื้อ ซึ่งฐานข้อมูลไม่รับ (BOM_INVALID_PARENT_KIND) และทั้งชุดถูกปฏิเสธ
        if (report.conflicts.length < 200) report.conflicts.push(`${canonical}: เป็นของซื้อในสินค้าหนึ่งแต่เป็น${KINDS[props.kind].label}ในอีกสินค้า ใช้${KINDS[props.kind].label}`);
        item.kind = props.kind;
        item.ownerDept = ownerDeptOf(props.kind, props.pair);
        if (props.rubber && !item.rubber) item.rubber = props.rubber; // ของซื้อไม่มีข้อมูลยาง: ยกเป็น RB/SE ต้องได้สูตร/ขนาดจากแถวนี้
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
        subpartByName.set(key, `XP-${String(subpartSeq).padStart(5, "0")}${subpartSuffix ? `-${subpartSuffix}` : ""}`.toUpperCase());
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
      // RB ไม่บังคับมี BOM (มีได้เฉพาะบรรทัดสูตรยาง สูตร PHR อยู่ที่ RubberFlow) และชิ้นทำเองไม่บังคับมี BOM
      if (!bom) { if (NEEDS_BOM_KINDS.includes(item.kind)) row.noBom = true; return; }
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
    // RB ตามผังงาน RB-01 ถึง RB-13 · ขั้นพักยางเป็นเวลารอ ไม่ใช่ค่าแรง (ใส่ 0 นาที/ชิ้น)
    { code: "RB-01", name: "ชั่งเคมี", dept: "RB" },
    { code: "RB-02", name: "ตียางเครื่อง Auto + ใส่เคมีขั้นที่ 1", dept: "RB" },
    { code: "RB-03", name: "ตียางเครื่อง 2 ลูกกลิ้ง ขั้นที่ 1", dept: "RB" },
    { code: "RB-04", name: "พักยาง 4 ชั่วโมง", dept: "RB" },
    { code: "RB-05", name: "ตียางเครื่อง Auto + ใส่เคมีขั้นที่ 2", dept: "RB" },
    { code: "RB-06", name: "ตียางเครื่อง 2 ลูกกลิ้ง ขั้นที่ 2", dept: "RB" },
    { code: "RB-07", name: "พักยาง 4 ชั่วโมง", dept: "RB" },
    { code: "RB-08", name: "แบ่งยาง 4 กก. ใส่เคมีขั้นที่ 3 (Auto เล็ก)", dept: "RB" },
    { code: "RB-09", name: "ผสมยางเคมีกับยางที่เหลือ (2 ลูกกลิ้ง)", dept: "RB" },
    { code: "RB-10", name: "ฉีดยาง", dept: "RB" },
    { code: "RB-11", name: "อบยางด้วย Oven", dept: "RB" },
    { code: "RB-12", name: "อบยางด้วย HCM", dept: "RB" },
    { code: "RB-13", name: "ตัดยางเส้นยาว", dept: "RB" },
    // GR ตาม STEP_ORDER ของแอป Grinding-GR (ยืนยันจากหน้างาน ส.ค. 2026) · เจียร์(หยาบ)/(ละเอียด) ทำเฉพาะบอลบางไซส์
    // PT/BG/PK ตามผังงานข้อ 8–10 (ขั้นที่ผังไม่แยกย่อยให้ตั้งเพิ่มเองได้)
    { code: "GR-01", name: "รีด", dept: "GR" },
    { code: "GR-02", name: "ปั๊ม", dept: "GR" },
    { code: "GR-03", name: "เปเปอร์", dept: "GR" },
    { code: "GR-04", name: "ตัดยาง", dept: "GR" },
    { code: "GR-05", name: "ทากาว", dept: "GR" },
    { code: "GR-06", name: "เจียร์", dept: "GR" },
    { code: "GR-07", name: "เจียร์(หยาบ)", dept: "GR" },
    { code: "GR-08", name: "เจียร์(ละเอียด)", dept: "GR" },
    { code: "GR-09", name: "เจาะ", dept: "GR" },
    { code: "PT-01", name: "ขึ้นรูปพลาสติก", dept: "PT" },
    { code: "PT-02", name: "ตัดท่อ/แกน", dept: "PT" },
    { code: "BG-01", name: "ตัดผ้า", dept: "BG" },
    { code: "BG-02", name: "เย็บกระเป๋าใส่สินค้า", dept: "BG" },
    { code: "PK-01", name: "ประกอบสินค้า (ชิ้นจาก GR/PT)", dept: "PK" },
    { code: "PK-02", name: "ใส่สินค้าในกระเป๋า (จาก BG)", dept: "PK" },
    { code: "PK-03", name: "บรรจุลงกล่อง", dept: "PK" },
  ].map((entry) => Object.freeze(entry)));
  // อัตราค่าแรงสาธิต (บาท/นาที) ต่อแผนก ไม่ใช่ตัวเลขจริงของบริษัท
  const LABOR_BAHT_PER_MIN = Object.freeze({ RB: 3, GR: 2.5, PT: 2, BG: 2.5, ST: 1.5, PK: 2 });
  const round = (n, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

  // ชิ้นที่ต้องผลิตก่อน (สายป้อนในมุมมองลำดับผลิต): ชิ้นที่แผนกเราทำเอง (ไม่ใช่ของซื้อ) แม้ยังไม่มี BOM/ขั้นตอน
  // เช่น เส้นยาง RB ที่มีได้แค่คอมปาวด์จาก RubberFlow · ของซื้อที่มี BOM หรือขั้นตอนก็นับด้วย
  // สูตรยาง (CP) เป็นวัตถุดิบที่เส้นยางรับจาก RubberFlow ไม่ใช่สายป้อนของตัวเอง เว้นแต่ผู้ใช้ให้ขั้นตอนผลิตกับมัน
  const isFeed = (child) => !LEAF_KINDS.includes(child.kind) || child.children.length > 0 || child.steps.length > 0;
  // เส้นยางที่ป้อนชิ้นอื่นต้องผ่าน SR รับเข้าคลัง (ลำดับ 5) และ QA ตรวจขนาด (ลำดับ 6) ก่อน · ชิ้นอื่นพร้อมเมื่อแผนกเจ้าของทำเสร็จ
  const receiveOrder = (node) => (node.kind === "RB" && node.level > 0 ? flowStepOf("SR") : null);
  const inspectOrder = (node) => (receiveOrder(node) === null ? null : flowStepOf("QA"));
  const readyOrder = (node) => inspectOrder(node) ?? node.order;
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
      // ลำดับการผลิต = ลำดับของแผนกเจ้าของในผังงานบริษัท (PROCESS_FLOW: RB 4 → SR 5 → QA 6 → GR 7 → PT 8 → BG 9 → PK 10)
      node.order = flowStepOf(node.dept);
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
  // สายป้อนเรียงตามลำดับผังงานของแผนกที่ทำ (RB/GR ก่อน PT ก่อน BG) ลำดับเท่ากันคงลำดับบรรทัด BOM
  function flowOf(node) {
    const feeds = node.children.filter(isFeed).map((child, index) => ({ child, index })).sort((a, b) => a.child.order - b.child.order || a.index - b.index).map(({ child }) => child);
    const stepIndex = new Map();
    node.steps.forEach((step, index) => (step.inputs ?? []).forEach((code) => { if (!stepIndex.has(code)) stepIndex.set(code, index); }));
    const indexOf = (child) => stepIndex.get(child.itemCode) ?? (child.step ? child.step - 1 : 0);
    const count = Math.max(node.steps.length, 1, ...node.children.map((child) => indexOf(child) + 1));
    const stages = Array.from({ length: count }, (_, index) => ({ no: index + 1, step: node.steps[index] ?? null, inputs: [] }));
    for (const child of node.children) stages[indexOf(child)].inputs.push(child);
    return { feeds, stages };
  }

  // รายการขั้นตอนเรียงตามลำดับ (มุมมอง "ขั้นตอนตามลำดับ") ตามผังงานของบริษัท 11 ลำดับ (PROCESS_FLOW):
  //   type "sales" (1) ฝ่ายขายออกใบสั่งผลิต · "plan" (2) ฝ่ายวางแผนออก BOM/ใบสั่งงาน · "purchase" (3) ST สั่งของซื้อทั้งหมด ยอดต่อสินค้า 1 หน่วย
  //   type "make" = ชิ้นที่ต้องผลิต (ลำดับของแผนกเจ้าของ) ใช้อะไรเท่าไร · "receive" (5) SR รับยางเส้นยาวเข้าคลัง · "inspect" (6) QA ตรวจขนาดขณะรับเข้า
  //   type "store" (11) = WH รับสินค้าสำเร็จรูปจาก PK เข้าคลัง (เฉพาะเมื่อรากเป็น FG)
  // รหัสเดียวกันที่อยู่หลายกิ่งรวมเป็นแถวเดียว (จำนวนต่อสินค้ารวมกัน) · input.from = ลำดับที่ชิ้นนั้นพร้อมใช้ (null = ของซื้อ)
  // แถวที่ไม่มีรายการ "ใช้" (receive/inspect/store) บอก fromOrder = ลำดับที่ส่งของมา · เรียงลำดับ → รหัส
  function productionSteps(tree) {
    const made = new Map();
    const bought = new Map();
    const add = (map, key, node, entry) => {
      const found = map.get(key);
      if (found) { found.order = Math.max(found.order, entry.order); found.level = Math.max(found.level, node.level); found.qtyPerRoot = round(found.qtyPerRoot + node.qtyPerRoot); }
      else map.set(key, { ...entry, itemCode: node.itemCode, name: node.name, uom: node.uom, level: node.level, qtyPerRoot: round(node.qtyPerRoot) });
    };
    for (const node of tree.rows) {
      // สูตรยางไม่ได้ซื้อผ่าน ST: แสดงเป็นวัตถุดิบของเส้นยาง (input.from = null) ไม่อยู่ในแถว "สั่ง/เบิกวัตถุดิบ"
      if (node.level > 0 && !isFeed(node)) { if (node.kind !== "CP") add(bought, node.itemCode, node, { type: "purchase", order: flowStepOf("ST"), dept: "ST" }); continue; }
      const inputs = node.children.map((child) => ({ itemCode: child.itemCode, name: child.name, kind: child.kind, uom: child.uom, qtyPerParent: child.qtyPerParent, scrapPct: child.scrapPct, from: isFeed(child) ? readyOrder(child) : null }));
      add(made, `make|${node.itemCode}`, node, { type: "make", order: node.order, dept: node.dept, steps: node.steps, inputs });
      if (receiveOrder(node) !== null) {
        add(made, `receive|${node.itemCode}`, node, { type: "receive", order: receiveOrder(node), fromOrder: node.order, dept: "SR", steps: [], inputs: [] });
        add(made, `inspect|${node.itemCode}`, node, { type: "inspect", order: inspectOrder(node), fromOrder: receiveOrder(node), dept: "QA", steps: [], inputs: [] });
      }
    }
    // ลำดับเท่ากัน (แผนกเดียวกัน): ชิ้นที่อยู่ลึกกว่าในต้นไม้มาก่อน (ชิ้นทำเองของ PK ก่อนตัวสินค้า) แล้วตามรหัส
    const rows = [...made.values()].sort((a, b) => a.order - b.order || b.level - a.level || a.itemCode.localeCompare(b.itemCode));
    const root = tree.root;
    const head = (no, extra = {}) => ({ type: extra.type, order: no, dept: PROCESS_FLOW[no - 1].dept, itemCode: "", name: PROCESS_FLOW[no - 1].title, detail: PROCESS_FLOW[no - 1].detail ?? "", uom: "", qtyPerRoot: 0, steps: [], inputs: [], ...extra });
    const purchase = head(3, { type: "purchase", inputs: [...bought.values()].sort((a, b) => a.itemCode.localeCompare(b.itemCode)).map((entry) => ({ itemCode: entry.itemCode, name: entry.name, uom: entry.uom, qtyPerRoot: entry.qtyPerRoot, from: null })) });
    const store = { type: "store", order: flowStepOf("WH"), fromOrder: root.order, dept: "WH", itemCode: root.itemCode, name: root.name, uom: root.uom, qtyPerRoot: 1, steps: [], inputs: [] };
    // ฝ่ายขาย/วางแผน/ST อยู่หัวรายการเสมอ (ST ว่างเมื่อไม่มีของซื้อ เพื่อให้เลขตรงกับมุมมองลำดับผลิต) · WH รับเฉพาะสินค้าสำเร็จรูป: เปิดโครงสร้างของชิ้นย่อย (PT, SE ฯลฯ) จบที่ชิ้นนั้น
    return [head(1, { type: "sales" }), head(2, { type: "plan" }), purchase, ...rows, ...(root.kind === "FG" ? [store] : [])];
  }

  // ---------- ความต้องการสุทธิ (สูตร AK ของ BOMSHEET ยกมาคิดทั้งใบ) ----------
  // คิดต่อรหัสชิ้นงาน (รวมทุกบรรทัดของรหัสเดียวกันในใบ) ไล่จากชั้นบนลงล่าง:
  //   ขาด = ความต้องการ − คงคลังที่นับ · ต้องผลิต/สั่งซื้อ = ขาด (ไม่ติดลบ) · ของเกิน = คงคลังที่เหลือจากความต้องการ
  //   ความต้องการของชิ้นลูก = ปริมาณต่อพ่อ × ส่วนที่พ่อยังต้องผลิต (ไม่ใช่ความต้องการเต็มของพ่อ)
  // ตรงกับ Excel: RB ต้องรีด = O × (SE ต้องเบิก − สต๊อก SE) − สต๊อก RB · ต่างจาก Excel สองจุดโดยตั้งใจ:
  //   ของเกินของพ่อไม่ถูกส่งต่อเป็นค่าติดลบของลูก และคงคลังนับต่อรหัสครั้งเดียวทั้งใบ ไม่ใช่ต่อบรรทัด (ชีตคีย์ซ้ำทุกบรรทัด)
  // รหัสที่ไม่ได้นับ (undefined) ถือว่าไม่มีของ · คงคลังของตัว FG (ชั้น 0) ไม่ถูกใช้ เพราะใบสั่งผลิตต้องผลิตครบจำนวนสั่งเสมอ
  // ของซื้อ (PURCHASED) ไม่ใช้ยอดนับตามใบ: สต็อกของซื้อเป็นยอดเดียวต่อรหัสที่หน้า "คลังของซื้อ" (partNeeds) จึงต้องการสุทธิ = ต้องการเต็ม และ ST เบิกจ่ายตามงานของซื้อที่ปล่อยผลิตสร้างไว้
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
      const counted = entry.level > 0 && entry.kind !== "PURCHASED" && stockCounts[entry.itemCode] !== undefined && stockCounts[entry.itemCode] !== null && stockCounts[entry.itemCode] !== "";
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

  // ---------- ของซื้อ: ความต้องการเทียบสต็อก (หน้าต่างสั่งซื้อ) ----------
  // งานของซื้อ = งาน dept ST ชนิด PURCHASED ที่ตอนปล่อยผลิตสร้างต่อรายการของซื้อของใบ (ยอด = ความต้องการเต็ม) · ST เบิกจ่ายครั้งเดียวต่อใบ ทำให้งานเสร็จและหักสต็อก
  // data = { jobs, orders, stock, purchaseOrders } (BOM: jobs orders stock · RubberFlow: purchaseOrders) · orderId = ใบ PI ที่ถามถึง
  // แต่ละรหัสที่ใบนี้ยังไม่ได้เบิกจ่าย: needQty ต้องใช้ (ส่วนที่เหลือของงาน) · onHandQty คงเหลือ · reservedQty จองแล้ว = ที่ใบ PI อื่นที่ปล่อยผลิตแล้วยังไม่ได้เบิกจ่ายต้องใช้
  // · onOrderQty สั่งค้างรับ (บรรทัดของซื้อของใบสั่งซื้อ ordered ที่ยังไม่รับ) · shortage = max(0, needQty − (onHandQty − reservedQty + onOrderQty)) · orderQty = ค่าตั้งต้นจำนวนสั่ง (ขาด + สต็อกขั้นต่ำ ไม่ขาด = 0)
  // ชื่อ/หน่วยมาจากงาน (ชื่อและหน่วยของชิ้น ณ ตอนปล่อยผลิต) · รูปเดียวกับ chemicalNeeds ของ RubberFlow: { rows, anyShort }
  const PART_OPEN_ORDER = Object.freeze(["released", "in_progress"]);
  const partRound3 = (n) => Math.round(n * 1e3) / 1e3;
  // งานของซื้อที่ยังไม่เบิกจ่ายของใบที่ปล่อยผลิตอยู่ (released / in_progress) · ส่วนที่เหลือของงาน = แผน - ที่เบิกจ่ายแล้ว
  const openPartJobs = (jobs, orders) => {
    const statusOf = new Map((orders ?? []).map((order) => [order.id, order.status]));
    return (jobs ?? []).filter((job) => job.dept === "ST" && job.kind === "PURCHASED" && job.status !== "done" && PART_OPEN_ORDER.includes(statusOf.get(job.orderId)));
  };
  const partLeft = (job) => Math.max(0, Number(job.qtyPlanned) - Number(job.qtyDone || 0));
  // จองแล้วต่อรหัส = ที่ใบ PI ที่ปล่อยผลิตแล้วยังไม่ได้เบิกจ่ายต้องใช้ (exceptOrderId = ข้ามใบนี้ ใช้ตอนคิดความต้องการของใบนั้นเอง)
  function partReserved(jobs, orders, exceptOrderId = null) {
    const reserved = new Map();
    for (const job of openPartJobs(jobs, orders)) if (job.orderId !== exceptOrderId) reserved.set(job.itemCode, (reserved.get(job.itemCode) || 0) + partLeft(job));
    return reserved;
  }
  // สั่งค้างรับต่อรหัส = บรรทัดของซื้อ (source bom) ของใบสั่งซื้อสถานะ ordered ที่ยังไม่รับ
  function partOnOrder(purchaseOrders) {
    const onOrder = new Map();
    for (const po of purchaseOrders ?? []) {
      if (po.status !== "ordered") continue;
      for (const line of po.lines ?? []) {
        if (line.source === "bom" && (line.receivedKg === null || line.receivedKg === undefined)) onOrder.set(line.materialCode, (onOrder.get(line.materialCode) || 0) + (Number(line.qtyKg) || 0));
      }
    }
    return onOrder;
  }
  // คืนของซื้อ: ยอดที่คืนไปแล้วของ (เลข PI, รหัส) = ผลรวมประวัติ 'return' ตั้งแต่ประวัติ 'issue' ล่าสุดของคู่นี้ (ตรงกับ private.bom_part_returned: หลังยกเลิกการเบิกจ่ายแล้วเบิกจ่ายใหม่ ของเหลือรอบก่อนไม่นับ)
  // stockMoves ต้องเรียงตามลำดับเกิดเหตุการณ์ (เก่า → ใหม่) เหมือน snapshot ของฐานข้อมูล
  function partReturned(stockMoves, piNo, itemCode) {
    let total = 0;
    for (const move of stockMoves ?? []) {
      if (move.ref !== piNo || move.itemCode !== itemCode) continue;
      if (move.kind === "issue") total = 0;
      else if (move.kind === "return") total += Number(move.qty) || 0;
    }
    return Math.round(total * 1e4) / 1e4;
  }
  // รายการของซื้อที่เบิกจ่ายแล้วของใบ (งาน ST / PURCHASED ที่ done รวมต่อรหัส) พร้อมยอดที่คืนไปแล้วและที่ยังคืนได้ · เรียงตามรหัส
  function partReturnLines(data, orderId) {
    const { jobs = [], stockMoves = [] } = data ?? {};
    const byItem = new Map();
    for (const job of jobs) {
      if (job.orderId !== orderId || job.dept !== "ST" || job.kind !== "PURCHASED" || job.status !== "done") continue;
      const line = byItem.get(job.itemCode) ?? { itemCode: job.itemCode, name: job.name, uom: job.uom, issued: 0 };
      line.issued += Number(job.qtyDone) || 0;
      byItem.set(job.itemCode, line);
    }
    return [...byItem.values()].sort((a, b) => (a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0)).map((line) => {
      const issued = Math.round(line.issued * 1e4) / 1e4;
      const returned = partReturned(stockMoves, orderId, line.itemCode);
      return { ...line, issued, returned, returnable: Math.max(0, Math.round((issued - returned) * 1e4) / 1e4) };
    });
  }
  function partNeeds(data, orderId) {
    const { jobs = [], orders = [], stock = [], purchaseOrders = [] } = data ?? {};
    const need = new Map();
    const meta = new Map();
    for (const job of openPartJobs(jobs, orders).filter((entry) => entry.orderId === orderId)) {
      need.set(job.itemCode, (need.get(job.itemCode) || 0) + partLeft(job));
      meta.set(job.itemCode, { name: job.name, uom: job.uom });
    }
    const reserved = partReserved(jobs, orders, orderId);
    const onOrder = partOnOrder(purchaseOrders);
    const rows = [...need.keys()].filter((code) => partRound3(need.get(code)) > 0).sort().map((code) => {
      const row = stock.find((entry) => entry.itemCode === code);
      const needQty = partRound3(need.get(code));
      const onHandQty = partRound3(Number(row?.qty) || 0);
      const reservedQty = partRound3(reserved.get(code) || 0);
      const onOrderQty = partRound3(onOrder.get(code) || 0);
      const shortage = partRound3(Math.max(0, needQty - (onHandQty - reservedQty + onOrderQty)));
      const safetyQty = Math.max(0, Number(row?.safetyQty) || 0);
      return { itemCode: code, name: meta.get(code)?.name ?? "", uom: meta.get(code)?.uom ?? "", needQty, onHandQty, reservedQty, onOrderQty, shortage, safetyQty, orderQty: shortage > 0 ? partRound3(shortage + safetyQty) : 0 };
    });
    return { rows, anyShort: rows.some((row) => row.shortage > 0) };
  }

  // ---------- CSV (เปิดใน Excel) ----------
  // ค่าที่ขึ้นต้นด้วย = + - @ ถูกนำหน้าด้วย ' กัน Excel ตีความเป็นสูตร (ชื่อจากชีต/ชื่อลูกค้าเป็นข้อความที่ผู้ใช้กรอก) ตัวเลขไม่ถูกแตะ
  const csvCell = (value) => {
    const text = typeof value === "number" ? String(value) : /^[=+\-@]/.test(String(value ?? "")) ? `'${value}` : String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;

  // ---------- จัดรูปแบบ ----------
  // วันที่แบบเดียวกับ formatDate ของระบบหลัก: วัน เดือนย่อ ปี พ.ศ. 4 หลัก (เช่น 6 พ.ย. 2569)
  const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const fmtDate = (ms) => {
    if (!ms || !Number.isFinite(Number(ms))) return "-";
    const d = new Date(Number(ms));
    return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
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
    DAY, KINDS, MANUFACTURED, NEEDS_BOM_KINDS, CATEGORIES, categoryOf, LEAF_KINDS, childKindError, DEPTS, DEPT_LABEL, DUE_DEPTS, PROCESS_FLOW, flowStepOf, sortLinesByFlow, FLOW_DEPTS, UOMS, PACKAGES, COLOR_SETS, COLOR_MASTERS,
    piNumber, piYear, LEAD_DAYS, defaultDueDates, producerPair, SHEETS, sheetOf, sheetLines,
    canonicalCode, isBlankCode, kindOf, ownerDeptOf, parseFgCode, buildFgCode, parseRbCode, parseSeCode, buildRbCode, buildSeCode,
    parseColorCode, colorName, colorOfCode, colorSlotKey, recolorCode, renameColor, colorSlotsOf, colorChangePlan,
    normalizeUom, uomLabel, rbPerSe, parseDelimited, detectHeader, readFlatRows, parseBomPaste, auditMaster, buildFromFlat, subpartOptions, explode, aggregateRequirements, netRequirements, groupByDept, toMake, partNeeds, partReserved, partOnOrder, partReturned, partReturnLines,
    DEFAULT_PROCESSES, LABOR_BAHT_PER_MIN, structureTree, flowOf, productionSteps,
    toCsv, fmtDate, fmtDateTime, fmtQty, fmtNum, toInputDate, fromInputDate, orderTypeOf,
  };
  if (isNode) module.exports = api;
  else root.MNP_BOM_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
