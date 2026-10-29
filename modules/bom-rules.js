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
  const DEPT_LABEL = Object.freeze({ PK: "PK · บรรจุ/ประกอบ", GR: "GR · ตัด/เจาะชิ้นยาง", RB: "RB · รีดเส้นยาง", PT: "PT · ฉีดพลาสติก", BG: "BG · กระเป๋า/เย็บ", ST: "ST · คลังวัตถุดิบ" });
  // ลำดับกำหนดเสร็จรายแผนกในหัวใบสั่งผลิต (MAIN ของไฟล์ Excel)
  const DUE_DEPTS = Object.freeze(["RB", "GR", "PT", "BG", "ST", "PK"]);

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

  // แยกส่วนของรหัส FG: MEGA-ST-01(P)-Y → ฐาน MEGA-ST-01 แพ็กเกจ P ชุดสี Y
  function parseFgCode(code) {
    const text = String(code ?? "").trim();
    const match = text.match(/^(.*?)(?:\(([^)]*)\))?(?:-([A-Z]))?$/);
    return { base: match?.[1] ?? text, pkg: match?.[2] ?? "", colorSet: match?.[3] ?? "" };
  }
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

  // ---------- หน่วยนับ ----------
  // หน่วยในชีตมี 356 แบบสะกด (ชิ้น/pcs · ชิ้น/pcs. · ชิ้น(20g) · กก.(112pcs) · ม้วน(50M) · ม้วน (50M) …) → หน่วยมาตรฐาน + ขนาดแพ็ก/น้ำหนักต่อชิ้น
  const UOMS = Object.freeze({
    pcs: { label: "ชิ้น", kind: "count" }, set: { label: "ชุด", kind: "count" }, box: { label: "กล่อง", kind: "count" }, roll: { label: "ม้วน", kind: "pack" },
    rod: { label: "เส้น", kind: "count" }, ball: { label: "ลูก", kind: "count" }, pack: { label: "แพ็ก", kind: "pack" }, sheet: { label: "แผ่น", kind: "count" },
    kg: { label: "กก.", kind: "weight" }, g: { label: "กรัม", kind: "weight" }, m: { label: "เมตร", kind: "length" }, yd: { label: "หลา", kind: "length" }, cm: { label: "ซม.", kind: "length" },
    other: { label: "หน่วยอื่น", kind: "count" },
  });
  function normalizeUom(raw) {
    const text = String(raw ?? "").trim();
    const lower = text.toLowerCase();
    const paren = lower.match(/\(([^)]*)\)/)?.[1] ?? "";
    const base = lower.replace(/\([^)]*\)/g, "").replace(/\s+/g, "").replace(/\.$/, "");
    let code = "other";
    if (/^(ชิ้น|pcs|ชิ้น\/pcs|ชิ้น\/pcs\.|pc)$/.test(base) || base.startsWith("ชิ้น")) code = "pcs";
    else if (base.startsWith("ชุด") || base.includes("set")) code = "set";
    else if (base.startsWith("กล่อง")) code = "box";
    else if (base.startsWith("ม้วน")) code = "roll";
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
  const COLUMNS = Object.freeze([
    ["item", /^ITEM/i], ["code", /^CODE/i], ["deptKind", /^รหัสแผนก/], ["compound", /สูตรยาง/], ["c1", /^สี ?SE|ยางกลมมีรู|ประเภทยาง/],
    ["c2", /^ความยาว ?SE/], ["c3", /^รู/], ["c4", /^วงนอก ?SE/], ["c5", /^วงนอก ?RB/], ["name", /^NAME|^ชื่อสินค้า|^ชื่อวัตถุดิบ/i],
    ["pair", /^แผนกผู้ผลิต/], ["qty", /^จำนวนที่ใช้ต่อชุด/], ["cutLen", /^ความยาว ?(GR )?ตัด/], ["pcsPerRoll", /^จำนวนชิ้น.*ต่อเส้น/],
    // น้ำหนัก (กรัม) ต่อเส้น/ม้วน RB อยู่คอลัมน์ "น้ำหนัก…ท่อนยาว" / "น.น ต่อเส้น RB" — ไม่ใช่คอลัมน์ B ("น.น RB/g" / "น.น ชิ้นงาน…ต่อเส้น") ซึ่งเป็นเลขลำดับแถว
    ["sePerGr", /^จำนวนที่ได้.*1 ?GR/], ["uom", /^หน่วยนับ/], ["weight", /ท่อนยาว|^น\.น ต่อเส้น/],
  ]);
  function detectHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
      const cells = rows[r].map((cell) => String(cell).trim());
      if (!cells.some((cell) => /^ITEM/i.test(cell)) || !cells.some((cell) => /^CODE/i.test(cell))) continue;
      const map = {};
      for (const [key, pattern] of COLUMNS) {
        const index = cells.findIndex((cell, i) => pattern.test(cell) && !Object.values(map).includes(i));
        if (index >= 0) map[key] = index;
      }
      if (map.item !== undefined && map.code !== undefined && map.name !== undefined) return { rowIndex: r, map };
    }
    return null;
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
    const { map } = header;
    const out = [];
    for (const row of rows.slice(header.rowIndex + 1)) {
      const item = cellText(row, map.item);
      if (!item || item === "ITEM") continue;
      const name = cellText(row, map.name);
      const code = cellText(row, map.code);
      if (!name && isBlankCode(code)) continue;
      out.push({
        item, code, deptKind: cellText(row, map.deptKind).toUpperCase(), pair: cellText(row, map.pair).toUpperCase(), name,
        compound: cellText(row, map.compound), c1: cellText(row, map.c1), c2: cellText(row, map.c2), c3: cellText(row, map.c3), c4: cellText(row, map.c4), c5: cellText(row, map.c5),
        qty: num(row[map.qty]), cutLen: num(row[map.cutLen]), pcsPerRoll: num(row[map.pcsPerRoll]), sePerGr: num(row[map.sePerGr]) || 1,
        uom: cellText(row, map.uom), weightG: num(row[map.weight]),
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
    const report = { fgCount: 0, lineCount: 0, merged: 0, subparts: 0, variants: 0, conflicts: [], unknownUom: new Set(), compounds: new Set() };
    let subpartSeq = subpartStart;
    const subpartByName = new Map();

    const ensureItem = (code, props) => {
      const canonical = canonicalCode(code);
      let item = items.get(canonical);
      if (!item) {
        item = { code: canonical, kind: props.kind, name: props.name || canonical, ownerDept: ownerDeptOf(props.kind, props.pair), uom: props.uom, weightG: props.weightG || 0, group, legacyCodes: [], rubber: props.rubber ?? null, active: true };
        items.set(canonical, item);
      }
      const raw = String(code).trim();
      if (raw && raw !== canonical && !item.legacyCodes.includes(raw)) { item.legacyCodes.push(raw); report.variants += 1; }
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
      const fgRow = rows.find((row) => row.deptKind === "PK" && !row.pair.includes("-") && (canonicalCode(row.code) === canonicalCode(fgParsed.base) || canonicalCode(row.code) === canonicalCode(itemName)));
      const fgCode = canonicalCode(itemName);
      const fgUom = normalizeUom(fgRow?.uom || "ชุด");
      ensureItem(fgCode, { kind: "FG", name: fgRow?.name || `สินค้า ${itemName}`, uom: fgUom.code, pair: "PK" });
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
        const code = canonicalCode(rawCode);
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
        const item = ensureItem(rawCode, { kind, name: row.name, uom: uom.code, weightG, pair: row.pair, rubber }); // ส่งรหัสตามชีตเพื่อเก็บสะกดเดิมเป็น legacy code
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
    const walk = (code, qtyPerFg, level, path, parentCode) => {
      const item = itemOf(code);
      if (!item) { missing.push(code); return; }
      lines.push({ fgCode, level, path: [...path, code], itemCode: code, name: item.name, kind: item.kind, uom: item.uom, producerDept: item.ownerDept, parentCode, qtyPerFg, required: qtyPerFg * fgQty, bomId: null, revision: null });
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
        walk(line.childCode, qtyPerFg * factor, level + 1, [...path, code], code);
      }
    };
    walk(fgCode, 1, 0, [], null);
    return { lines, missing: [...new Set(missing)] };
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
    DAY, KINDS, MANUFACTURED, DEPTS, DEPT_LABEL, DUE_DEPTS, UOMS,
    canonicalCode, isBlankCode, kindOf, ownerDeptOf, parseFgCode, parseRbCode, parseSeCode, buildRbCode,
    normalizeUom, uomLabel, rbPerSe, parseDelimited, detectHeader, readFlatRows, buildFromFlat, explode, aggregateRequirements, toMake,
    toCsv, fmtDate, fmtDateTime, fmtQty, toInputDate, fromInputDate, orderTypeOf,
  };
  if (isNode) module.exports = api;
  else root.MNP_BOM_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
