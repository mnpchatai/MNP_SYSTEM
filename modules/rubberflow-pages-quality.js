// RubberFlow MES (แผนก RB โหมดทดสอบ) — ส่วนคุณภาพ: ผลตรวจ QC · NCR · CoA, SPC / Cpk และสืบย้อนกลับ
// ยกมาจาก pages/Quality.jsx, Spc.jsx, Trace.jsx ของต้นแบบ (กราฟ recharts → SVG ของ modules/rubberflow-ui.js)
// งาน QA ทั้งหมดย้ายไปโมดูล QA (#/qa · modules/qa-pages.js · โรงงานขั้น 5) ที่ใช้ส่วนวาดของไฟล์นี้ผ่าน window.MNP_RUBBERFLOW_VIEWS.quality (ที่เดียว ไม่มีสำเนาที่สอง)
// ที่เหลือใน RubberFlow: หน้า "NCR ที่ RB ต้องตอบ" (p=ncr: เฉพาะ NCR ที่เปิดอยู่ แผนก RB กรอกการแก้ไข/ป้องกัน) และ dialog qcRecord / ncr / coa ที่ปุ่มของ #/qa เปิดผ่านตัวผูกของ RubberFlow
// ลงทะเบียนใน window.MNP_RUBBERFLOW_PAGES / _DIALOGS กติกา event อยู่ที่ modules/module-rubberflow.js — โหลดหลัง modules/rubberflow-ui.js
(function (root) {
  const pages = (root.MNP_RUBBERFLOW_PAGES ??= {});
  const dialogs = (root.MNP_RUBBERFLOW_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);
  // หน่วยของ WO/ล็อต/กล่อง: ป้ายไทยของ BOM สำหรับรหัสหน่วยของ BOM (rules.unitText) · ไม่มีกฎ = รหัสเดิม
  const unitText = (code) => root.MNP_RUBBERFLOW_RULES?.unitText?.(code) ?? String(code ?? "");
  const views = {};

  // ---------- ผลตรวจ ----------
  views.qcRecordsTable = (ctx, { records = ctx.data.qcRecords, limit = 0 } = {}) => {
    const { ui, rules } = ctx;
    const { STAGE_LABEL, SPECS, fmtDateTime } = rules;
    const list = limit > 0 ? records.slice(0, limit) : records;
    return ui.table(["เลขที่", "ล็อต", "ผลทดสอบ", "ผล", "ผู้ตรวจ"], list.map((record) => `<tr><td>${ui.mono(record.id)}<div class="small muted">${esc(fmtDateTime(record.at))}</div></td><td class="rf-mono small">${esc(record.lotId)}<div class="muted">${esc(STAGE_LABEL[record.stage])}</div></td>
        <td class="small">${record.tests.map((test) => ui.badge(test.pass ? "" : "bad", `${SPECS.lab[test.key]?.label ?? test.key} ${test.value}`)).join(" ")}${record.note ? `<div class="muted">${esc(record.note)}</div>` : ""}</td><td>${ui.status(record.result)}</td><td class="small">${esc(record.inspector ?? "-")}</td></tr>`), { emptyText: "ยังไม่มีผลตรวจ" });
  };

  // ---------- NCR ----------
  // canClose = ปิดเคสได้ (QA) · fill = ช่องแก้ไข/ป้องกันที่แผนก RB และ QA กรอกได้ตามสิทธิ์ fillNcr (ปิดแล้วแสดงอย่างเดียว)
  function ncrCard(ctx, ncr, { canClose = false } = {}) {
    const { ui, rules } = ctx;
    const { STAGE_LABEL, fmtDateTime, fmtNum } = rules;
    const closeForm = ncr.status === "open" && canClose ? `<form novalidate class="rf-row" data-rf-form="closeNcr" data-rf-args='${esc(JSON.stringify({ id: ncr.id }))}' data-rf-success="ปิด NCR แล้ว"><div class="rf-grow">${ui.input("verification", { placeholder: "ผลการทวนสอบประสิทธิผล…" })}</div>${ui.submitButton("ปิดเคส")}</form>` : "";
    // แผนก RB และ QA กรอกการแก้ไข/ป้องกันของ NCR ที่เปิดอยู่ได้ (ปิดเคสเป็นของ QA) · ปิดแล้วแสดงอย่างเดียว
    const fillForm = ncr.status === "open" && ctx.can("fillNcr")
      ? `<form novalidate class="rf-stack" data-rf-form="updateNcr" data-rf-args='${esc(JSON.stringify({ id: ncr.id }))}' data-rf-success="บันทึกการแก้ไข/ป้องกันแล้ว">${ui.field("แก้ไข (Corrective)", ui.textarea("corrective", { value: ncr.corrective ?? "", rows: 2 }))}${ui.field("ป้องกันซ้ำ (Preventive)", ui.textarea("preventive", { value: ncr.preventive ?? "", rows: 2 }))}<div class="rf-row">${ui.submitButton("บันทึก", { className: "secondary" })}</div></form>`
      : "";
    return ui.card(`<div class="rf-grid rf-g2">
        <div class="rf-stack">${ui.kv([["ขั้นตอนที่พบ", esc(STAGE_LABEL[ncr.stage] ?? ncr.stage)], ["ล็อต", ui.mono(ncr.lotId)], ["ชิ้นงานเสีย", esc(fmtNum(ncr.defectQty))], ["ผู้รับผิดชอบ", esc(ncr.owner ?? "-")], ["เปิดเมื่อ", esc(fmtDateTime(ncr.createdAt))], ncr.closedAt ? ["ปิดเมื่อ", esc(`${fmtDateTime(ncr.closedAt)} · ${ncr.closedBy ?? ""}`)] : null])}
          <div><strong class="small">วิเคราะห์ทำไม 5 ครั้ง (5-Why)</strong><ol class="small rf-whys">${ncr.whys.map((why) => `<li>${esc(why)}</li>`).join("")}</ol></div></div>
        <div class="rf-stack small">
          <div><strong>ควบคุมทันที (Containment)</strong><div>${esc(ncr.containment || "-")}</div></div>
          ${fillForm || `<div><strong>แก้ไข (Corrective)</strong><div>${esc(ncr.corrective || "-")}</div></div>
          <div><strong>ป้องกันซ้ำ (Preventive)</strong><div>${esc(ncr.preventive || "-")}</div></div>`}
          ${ncr.verification ? `<div><strong>ผลการทวนสอบ</strong><div>${esc(ncr.verification)}</div></div>` : ""}${closeForm}</div></div>`,
    { title: `${ui.mono(ncr.id)} ${esc(ncr.title)}`, actions: `${ui.status(ncr.severity)}${ui.status(ncr.status)}` });
  }
  views.ncrCard = ncrCard;
  // เปิดอยู่ก่อน แล้วปิดแล้ว (ใหม่สุดก่อนในแต่ละกลุ่ม)
  views.ncrList = (ctx, { canClose = false, openOnly = false, emptyText = "ยังไม่มี NCR" } = {}) => {
    const { ui } = ctx;
    const list = ctx.data.ncrs.filter((ncr) => !openOnly || ncr.status === "open").slice().sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.createdAt - a.createdAt);
    return list.length ? `<div class="rf-stack">${list.map((ncr) => ncrCard(ctx, ncr, { canClose })).join("")}</div>` : ui.card(ui.empty(emptyText));
  };

  // ---------- CoA ----------
  // ล็อตสินค้าสำเร็จรูป (ล็อตตกแต่ง) ใหม่สุดก่อน · lotId = กรองเหลือล็อตเดียว (ลิงก์จากหน้าตกแต่ง) · q = ค้นหาล็อต ใบสั่งผลิต ลูกค้า · แสดงไม่เกิน limit ล็อตล่าสุด
  views.coaTable = (ctx, { lotId = "", q = "", limit = 100 } = {}) => {
    const { data, ui, rules } = ctx;
    const { fmtDate, fmtNum } = rules;
    const needle = String(q ?? "").trim().toLowerCase();
    const matches = (lot) => !needle || `${lot.id} ${lot.orderId} ${data.orders.find((row) => row.id === lot.orderId)?.customer ?? ""}`.toLowerCase().includes(needle);
    const finLots = data.lots.filter((lot) => lot.stage === "finishing" && (!lotId || lot.id === lotId) && matches(lot)).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    return ui.table(["ล็อตสินค้าสำเร็จรูป", "ลูกค้า / สินค้า", { label: "จำนวน", className: "right" }, "QC", { label: "", className: "right" }], finLots.map((lot) => {
      const order = data.orders.find((row) => row.id === lot.orderId);
      return `<tr><td>${ui.mono(lot.id)}<div class="small muted">${esc(fmtDate(lot.createdAt))}</div></td><td>${esc(order?.customer ?? "")}<div class="small muted">${esc(order ? rules.orderLabel(order) : "")}</div></td><td class="right">${esc(`${fmtNum(lot.goodQty)} ${unitText(lot.uom)}`)}<div class="small muted">${esc(`${lot.boxes} กล่อง`)}</div></td><td>${ui.status(lot.qc)}</td><td class="right">${ui.openButton("เปิด CoA", "coa", { lotId: lot.id }, { className: "secondary small" })}</td></tr>`;
    }), { emptyText: lotId ? "ไม่พบล็อตสินค้าสำเร็จรูปนี้" : "ยังไม่มีล็อตสินค้าสำเร็จรูป" });
  };

  // ---------- หน้า "NCR ที่ RB ต้องตอบ" (p=ncr) ----------
  // เฉพาะ NCR ที่เปิดอยู่ · แผนก RB (และฝ่ายวางแผน) กรอกการแก้ไข/ป้องกันซ้ำ (updateNcr · สิทธิ์ fillNcr) · เปิดและปิด NCR อยู่ที่โมดูล QA (#/qa?tab=ncr) ที่เดียว
  pages.ncr = (ctx) => {
    const { ui } = ctx;
    return { html: `${ui.pageHead("NCR ที่ RB ต้องตอบ", "NCR ที่ QA เปิดไว้และยังไม่ปิด: แผนก RB กรอกการแก้ไข (Corrective) และการป้องกันซ้ำ (Preventive) ที่นี่ QA เป็นผู้ปิดเคส")}${views.ncrList(ctx, { openOnly: true, emptyText: "ไม่มี NCR ที่รอ RB ตอบ" })}` };
  };

  dialogs.qcRecord = (ctx, { lotId = "" } = {}) => {
    const { data, ui, rules } = ctx;
    const { STAGE_LABEL, SPECS } = rules;
    const target = data.lots.find((lot) => lot.id === lotId) ?? null;
    // ล็อตที่กักอยู่: ตัดสินผ่าน/ไม่ผ่าน (ปล่อยล็อต) ได้เฉพาะหัวหน้า QA ขึ้นไป · พนักงาน QA เลือกได้แค่ "กักต่อ / ตรวจซ้ำ" (ฐานข้อมูลตรวจซ้ำ: RF_QA_HEAD_ONLY)
    const head = ctx.can("qaRelease");
    const restricted = (lot) => !head && lot?.qc === "hold";
    const options = [...data.lots].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60).map((lot) => ({ value: lot.id, label: `${lot.id} · ${STAGE_LABEL[lot.stage]} · ${ui.statusLabel(lot.qc)}` }));
    const locked = restricted(target);
    const results = [{ value: "", label: "อัตโนมัติจากผลวัด", gate: true }, { value: "pass", label: "ผ่าน — ปลดกักกัน", gate: true }, { value: "hold", label: "กักกันต่อ / ตรวจซ้ำ" }, { value: "fail", label: "ไม่ผ่าน — ทิ้ง/แก้ไขงาน (Rework)", gate: true }]
      .map((entry) => ({ value: entry.value, label: entry.label, disabled: Boolean(entry.gate && locked) }));
    const body = `<div class="rf-grid rf-g2">
        ${ui.field("ล็อตที่ตรวจ", ui.select("lotId", options, { value: lotId, placeholder: "เลือก…", extra: "required data-qc-lot" }), { required: true })}
        ${ui.field("ผลตัดสิน", ui.select("result", results, { value: locked ? "hold" : "", extra: "data-qc-result" }), { hint: "เว้นว่างให้ระบบตัดสินจากค่าที่วัด" })}
      </div><p class="small muted" role="note" data-qc-head-only${locked ? "" : " hidden"}>${esc(`ล็อตนี้กักอยู่ ตัดสินผ่านหรือไม่ผ่านได้${root.MNP_RUBBERFLOW_RULES?.QA_RELEASE_TEXT ?? "เฉพาะหัวหน้า QA"} · บัญชีนี้บันทึกกักต่อ/ตรวจซ้ำได้`)}</p>${target?.holdReasons?.length ? ui.callout("warn", esc(`สาเหตุที่กักกัน: ${target.holdReasons.join(", ")}`)) : ""}
      <div class="rf-grid rf-g3">${Object.entries(SPECS.lab).map(([key, spec]) => ui.specInput(`values.${key}`, `${spec.label} · ${spec.method}`, spec)).join("")}</div>
      ${ui.field("หมายเหตุ", ui.textarea("note"))}`;
    const html = ui.dialog("qcRecord", "บันทึกผลตรวจคุณภาพ", `<form novalidate data-rf-form="addQcRecord" data-rf-success="บันทึกผลตรวจ {result} แล้ว" id="rf-qc-record">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-qc-record">บันทึกผล</button>`, wide: true });
    // เปลี่ยนล็อตในช่องเลือก: ล็อตที่กักและบัญชีนี้ปล่อยไม่ได้ = เหลือแค่ "กักต่อ" (ข้อมูลล็อตมาจาก ctx ที่ dialog ถูกสร้าง)
    const bind = (dialog) => {
      const lotSelect = dialog.querySelector("[data-qc-lot]");
      const resultSelect = dialog.querySelector("[data-qc-result]");
      const note = dialog.querySelector("[data-qc-head-only]");
      if (!lotSelect || !resultSelect) return;
      const sync = () => {
        const lock = restricted(data.lots.find((lot) => lot.id === lotSelect.value));
        for (const option of resultSelect.options) option.disabled = lock && option.value !== "hold";
        if (lock) resultSelect.value = "hold";
        else if (resultSelect.selectedOptions?.[0]?.disabled) resultSelect.value = "";
        if (note) note.hidden = !lock;
      };
      lotSelect.addEventListener("change", sync);
      sync();
    };
    return { html, bind };
  };

  dialogs.ncr = (ctx) => {
    const { data, ui, rules } = ctx;
    const { STAGES, STAGE_LABEL } = rules;
    const body = `<div class="rf-grid rf-g2">
        ${ui.field("หัวข้อปัญหา", ui.input("title", { required: true }), { required: true })}
        ${ui.field("ล็อตที่พบ", `${ui.input("lotId", { list: "rf-ncr-lots", placeholder: "เช่น CU-…", required: true })}<datalist id="rf-ncr-lots">${data.lots.slice(0, 80).map((lot) => `<option value="${esc(lot.id)}"></option>`).join("")}</datalist>`, { hint: "ล็อตที่ผ่านแล้วจะถูกกักกันอัตโนมัติ", required: true })}
        ${ui.field("ขั้นตอนที่พบ", ui.select("stage", STAGES.map((stage) => ({ value: stage, label: STAGE_LABEL[stage] })), { value: "curing" }))}
        <div class="rf-grid rf-g2">${ui.field("ความรุนแรง", ui.select("severity", [{ value: "critical", label: "วิกฤต (Critical) — หยุดไลน์" }, { value: "major", label: "ร้ายแรง (Major)" }, { value: "minor", label: "เล็กน้อย (Minor)" }], { value: "major" }))}${ui.field("จำนวนชิ้นงานเสีย", ui.input("defectQty", { type: "number", step: "any" }))}</div>
      </div>
      <div class="rf-stack rf-tight"><strong class="small">วิเคราะห์ทำไม 5 ครั้ง (5-Why)</strong>${[1, 2, 3, 4, 5].map((n) => ui.input("whys[]", { placeholder: `ทำไม ครั้งที่ ${n}` })).join("")}</div>
      <div class="rf-grid rf-g3">${ui.field("ควบคุมทันที", ui.textarea("containment"))}${ui.field("การแก้ไข", ui.textarea("corrective"))}${ui.field("การป้องกันซ้ำ", ui.textarea("preventive"))}</div>
      ${ui.badge("info", "ต้องกรอก “การแก้ไข” ก่อนจึงจะปิดเคสได้")}`;
    const html = ui.dialog("ncr", "เปิดรายงานข้อบกพร่อง (NCR)", `<form novalidate data-rf-form="createNcr" data-rf-success="เปิด {result} แล้ว" id="rf-ncr">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-ncr">เปิด NCR</button>`, wide: true });
    return { html };
  };

  // ---------- SPC / Cpk ----------
  // มิติการฉีด: สเปกเป็นของสูตร (20261129010000) จึงแยกกราฟต่อสูตรและสเปก ล็อตใช้สเปกของ revision ที่ WO ผูก ล็อตที่สูตรไม่กำหนดค่านั้นไม่นับ
  // id = ex.<ค่า>.<รหัสสูตร> (สเปกที่สองขึ้นไปของสูตรเดียวกันต่อท้าย .2 .3 และบอกสเปกในชื่อ)
  function extrusionChars(rules, data) {
    const groups = new Map();
    for (const lot of data.lots.filter((row) => row.stage === "extrusion")) {
      const order = data.orders.find((row) => row.id === lot.orderId);
      const spec = rules.orderExtrusionSpec(data.recipes, order);
      for (const key of rules.EXTRUSION_KEYS) {
        if (!spec[key]) continue;
        const group = `${key}\u0000${order.recipeId}\u0000${spec[key].target}\u0000${spec[key].tol}`;
        if (!groups.has(group)) groups.set(group, { key, recipeId: order.recipeId, spec: spec[key], lots: [] });
        groups.get(group).lots.push(lot);
      }
    }
    const rows = [...groups.values()].sort((a, b) => rules.EXTRUSION_KEYS.indexOf(a.key) - rules.EXTRUSION_KEYS.indexOf(b.key) || (a.recipeId < b.recipeId ? -1 : a.recipeId > b.recipeId ? 1 : 0));
    const seen = new Map();
    return rows.map((row) => {
      const base = `ex.${row.key}.${row.recipeId}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const several = rows.filter((other) => other.key === row.key && other.recipeId === row.recipeId).length > 1;
      return {
        id: n > 1 ? `${base}.${n}` : base,
        label: `ฉีด · ${row.spec.label} · ${row.recipeId}${several ? ` (${rules.specText(row.spec)})` : ""}`,
        spec: row.spec,
        source: () => row.lots.map((lot) => ({ id: lot.id, at: lot.createdAt, v: lot.params?.[row.key] })),
      };
    });
  }
  // ค่าที่ติดตาม: มาจากไหนและใช้สเปกใด
  const spcChars = (rules, data) => {
    const { SPECS } = rules;
    return [
      ...extrusionChars(rules, data),
      ...["temp", "time", "pressure"].map((key) => ({ id: `cu.${key}`, label: `อบ · ${SPECS.curing[key].label}`, spec: SPECS.curing[key], source: (d) => d.lots.filter((lot) => lot.stage === "curing").map((lot) => ({ id: lot.id, at: lot.createdAt, v: lot.params[key] })) })),
      ...Object.entries(SPECS.lab).map(([key, spec]) => ({ id: `lab.${key}`, label: `แล็บ · ${spec.label}`, spec, source: (d) => d.qcRecords.flatMap((record) => record.tests.filter((test) => test.key === key).map((test) => ({ id: record.lotId, at: record.at, v: test.value }))) })),
      { id: "mx.dump", label: "ผสม · อุณหภูมิปล่อยยางขั้น 2 (สูตร EPDM)", spec: { label: "อุณหภูมิปล่อยยาง", unit: "°C", target: 140, tol: 6 }, source: (d) => d.lots.filter((lot) => lot.stage === "mixing" && lot.recipeId === "RC-EPDM-DS01").map((lot) => ({ id: lot.id, at: lot.createdAt, v: lot.params?.stages?.find((row) => Number(row.stage) === 2)?.dumpTemp })) },
    ];
  };
  views.spcChars = spcChars;

  // เนื้อหา SPC (หัวหน้าหน้าและช่องเลือกค่าที่ติดตามเป็นของหน้าที่เรียก): ctx.params.get("ch") เลือกค่า · ctx.pageUrl พาไปหน้าเดิมพร้อมค่าใหม่ · คืน { html, picker, bind }
  views.spc = (ctx) => {
    const { data, ui, rules, params } = ctx;
    const { stats, cpkVerdict, specLimits, specText, fmtDate } = rules;
    const chars = spcChars(rules, data);
    const ch = chars.find((row) => row.id === params.get("ch")) ?? chars[0];
    const { lsl, usl } = specLimits(ch.spec);
    const points = ch.source(data).filter((point) => Number.isFinite(point.v)).sort((a, b) => a.at - b.at).map((point, index) => ({ ...point, n: index + 1, label: fmtDate(point.at) }));
    const s = stats(points.map((point) => point.v), lsl, usl);
    const verdict = cpkVerdict(s?.cpk);
    let bins = [];
    if (s) {
      const lo = Math.min(s.min, lsl ?? s.min);
      const hi = Math.max(s.max, usl ?? s.max);
      const count = 10;
      const width = (hi - lo) / count || 1;
      bins = [...Array(count)].map((_, i) => { const center = lo + width * (i + 0.5); return { bin: +center.toPrecision(4), count: 0, oos: (usl !== undefined && center > usl) || (lsl !== undefined && center < lsl) }; });
      points.forEach((point) => { bins[Math.min(count - 1, Math.floor((point.v - lo) / width))].count += 1; });
    }
    const ooc = s ? points.filter((point) => point.v > s.ucl || point.v < s.lcl) : [];
    const oos = points.filter((point) => (usl !== undefined && point.v > usl) || (lsl !== undefined && point.v < lsl));
    const r = (x, digits = 3) => (x === undefined || x === null ? "-" : x.toFixed(digits));
    const picker = `<form novalidate class="rf-row" data-rf-pick><label class="sr-only" for="rf-spc-ch">ค่าที่ติดตาม</label>${ui.select("ch", chars.map((row) => ({ value: row.id, label: row.label })), { value: ch.id, id: "rf-spc-ch", className: "rf-spc-pick", extra: "data-rf-ch" })}</form>`;
    const html = `${ui.stats([
        { label: "Cpk", value: r(s?.cpk, 2), sub: verdict.text, tone: verdict.tone === "muted" ? "" : verdict.tone },
        { label: "Cp / Ppk", value: `${r(s?.cp, 2)} / ${r(s?.ppk, 2)}`, sub: "Ppk ใช้ σ รวมทั้งหมด" },
        { label: "ค่าเฉลี่ย / σ (MR)", value: `${r(s?.mean)} / ${r(s?.sdWithin)}`, sub: `n = ${s?.n ?? points.length} · สเปก ${specText(ch.spec)}` },
        { label: "จุดผิดปกติ", value: `${ooc.length} นอก CL · ${oos.length} นอกสเปก`, sub: `UCL ${r(s?.ucl)} · LCL ${r(s?.lcl)}` },
      ])}
      ${ui.card(points.length < 2 ? ui.empty("ข้อมูลไม่พอสำหรับคำนวณ") : ui.controlChart(points, { lsl, usl, stat: s, unit: ch.spec.unit }), { title: `แผนภูมิควบคุม · ${esc(ch.label)}` })}
      <div class="rf-grid rf-g2">
        ${ui.card(bins.length ? ui.histogram(bins, { unit: ch.spec.unit }) : ui.empty("ข้อมูลไม่พอ"), { title: "ฮิสโตแกรม" })}
        ${ui.card(ui.table(["ล็อต", "วันที่", { label: "ค่า", className: "right" }], oos.map((point) => `<tr><td class="rf-mono">${esc(point.id)}</td><td>${esc(point.label)}</td><td class="right">${ui.badge("bad", `${point.v} ${ch.spec.unit}`)}</td></tr>`), { emptyText: "ไม่มีค่าที่หลุดสเปก" }), { title: "ค่าที่หลุดสเปก", flush: true })}
      </div>`;
    const bind = (rootNode) => {
      rootNode.querySelector("[data-rf-ch]")?.addEventListener("change", (event) => { location.hash = ctx.pageUrl({ ch: event.target.value }); });
      rootNode.querySelector("[data-rf-pick]")?.addEventListener("submit", (event) => event.preventDefault());
    };
    return { html, picker, bind };
  };

  // ---------- สืบย้อนกลับ ----------
  // ช่องค้นหา (data-rf-search) ส่งไป ctx.pageUrl({ q }) ของหน้าที่เรียก
  views.trace = (ctx) => {
    const { data, ui, rules, derive } = ctx;
    const { STAGE_LABEL, fmtDateTime, fmtNum } = rules;
    const query = ctx.q;
    const hit = query ? derive.lookupCode(data, query) : null;
    const samples = [data.fgBoxes.find((box) => box.status === "in_stock")?.id, data.lots.find((lot) => lot.stage === "curing")?.id, data.requisitions.find((requisition) => requisition.status === "consumed")?.lines[0]?.lotNo].filter(Boolean);
    let backward = null;
    let forward = null;
    let note = "";
    if (hit?.kind === "box") {
      const lotTree = derive.backwardTree(data, hit.item.lotId);
      backward = { kind: "box", id: hit.item.id, item: hit.item, children: lotTree ? [lotTree] : [] };
    } else if (hit?.kind === "lot") {
      backward = derive.backwardTree(data, hit.item.id);
      forward = derive.forwardTree(data, hit);
    } else if (hit?.kind === "material") {
      forward = derive.forwardTree(data, hit);
    } else if (hit) note = "การสืบย้อนกลับรองรับรหัสกล่อง ล็อตงานระหว่างผลิต และล็อตวัตถุดิบ";

    const hitId = hit ? (hit.item.id || hit.item.lotNo) : null;
    const node = (treeNode) => {
      const it = treeNode.item;
      let sub = "";
      let statusValue = null;
      if (treeNode.kind === "lot") { sub = `${STAGE_LABEL[it.stage]} · ${fmtNum(it.goodQty, 2)} ${unitText(it.uom)} · ${fmtDateTime(it.createdAt)}`; statusValue = it.qc; }
      if (treeNode.kind === "box") { sub = `กล่อง · ${rules.orderLabel(it)} · ${fmtNum(it.qty)} ${unitText(it.uom)}`; statusValue = it.status; }
      if (treeNode.kind === "requisition") sub = `ใบเบิก · ${it.batches} ชุดผสม · ${fmtNum(it.totalKg, 1)} kg`;
      if (treeNode.kind === "material") { const material = data.materials.find((row) => row.code === it?.materialCode); sub = `วัตถุดิบ · ${material?.name ?? "-"}${treeNode.kg ? ` · ใช้ ${fmtNum(treeNode.kg, 3)} kg` : ""} · ${it?.supplier ?? "-"}`; }
      return `<li><div class="rf-node${treeNode.id === hitId ? " is-hit" : ""}"><div class="rf-row"><strong class="rf-mono">${esc(treeNode.id)}</strong>${statusValue ? ui.status(statusValue) : ""}</div><div class="small muted">${esc(sub)}</div></div>${treeNode.children?.length ? `<ul class="rf-tree">${treeNode.children.map(node).join("")}</ul>` : ""}</li>`;
    };
    const forwardSummary = (treeNode) => {
      const boxes = [];
      const walk = (n) => { if (n.kind === "box") boxes.push(n.item); (n.children || []).forEach(walk); };
      walk(treeNode);
      if (!boxes.length) return `<div class="small muted">ยังไม่ถูกบรรจุเป็นสินค้าสำเร็จรูป</div>`;
      return ui.callout("warn", esc(`ขอบเขตที่ได้รับผลกระทบ: ${boxes.length} กล่อง (${boxes.filter((box) => box.status === "shipped").length} กล่องส่งมอบลูกค้าแล้ว)`));
    };
    const html = `${ui.card(`<form novalidate class="rf-search rf-search-wide" data-rf-search role="search"><label class="sr-only" for="rf-q">รหัส</label>${ui.input("q", { id: "rf-q", type: "search", value: query, placeholder: "สแกนหรือพิมพ์รหัสกล่อง ล็อต หรือล็อตวัตถุดิบ" })}<button class="btn rf-btn" type="submit">ค้นหา</button></form>
        <div class="rf-row small muted rf-samples">ตัวอย่าง: ${samples.map((sample) => ui.link(sample, ctx.pageUrl({ q: sample }), "rf-badge")).join("")}</div>`)}
      ${query && !hit ? ui.callout("bad", esc(`ไม่พบรหัส “${query}”`)) : ""}${note ? ui.callout("info", esc(note)) : ""}
      <div class="rf-grid rf-g2">
        ${backward ? ui.card(`<ul class="rf-tree rf-tree-root">${node(backward)}</ul>`, { title: "ย้อนกลับไปต้นทาง" }) : ""}
        ${forward ? ui.card(`<ul class="rf-tree rf-tree-root">${node(forward)}</ul>${forwardSummary(forward)}`, { title: "ไปข้างหน้า (ใช้ที่ไหนบ้าง)" }) : ""}
      </div>`;
    return { html };
  };

  root.MNP_RUBBERFLOW_VIEWS = Object.freeze({ ...(root.MNP_RUBBERFLOW_VIEWS ?? {}), quality: Object.freeze(views) });
})(typeof window !== "undefined" ? window : globalThis);
