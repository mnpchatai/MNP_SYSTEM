// RubberFlow MES (แผนก RB โหมดทดสอบ) — หน้าคุณภาพ: QC · NCR · CoA, SPC / Cpk และสืบย้อนกลับ
// ยกมาจาก pages/Quality.jsx, Spc.jsx, Trace.jsx ของต้นแบบ (กราฟ recharts → SVG ของ modules/rubberflow-ui.js)
// ลงทะเบียนใน window.MNP_RUBBERFLOW_PAGES / _DIALOGS กติกา event อยู่ที่ modules/module-rubberflow.js — โหลดหลัง modules/rubberflow-ui.js
(function (root) {
  const pages = (root.MNP_RUBBERFLOW_PAGES ??= {});
  const dialogs = (root.MNP_RUBBERFLOW_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);

  // ---------- QC · NCR · CoA ----------
  pages.quality = (ctx) => {
    const { data, ui, rules, params } = ctx;
    const { STAGE_LABEL, SPECS, fmtDate, fmtDateTime, fmtNum } = rules;
    const tab = ["hold", "records", "ncr", "coa"].includes(params.get("tab")) ? params.get("tab") : "hold";
    const decide = ctx.can("qcDecision");
    const held = data.lots.filter((lot) => lot.qc === "hold").sort((a, b) => b.createdAt - a.createdAt);
    const records = data.qcRecords;
    const fpy = records.length ? (records.filter((record) => record.result === "pass").length / records.length) * 100 : 100;
    const openNcr = data.ncrs.filter((ncr) => ncr.status === "open");
    const finLots = data.lots.filter((lot) => lot.stage === "finishing").sort((a, b) => b.createdAt - a.createdAt);
    const tabs = ui.tabs([{ id: "hold", label: "รอตัดสิน" }, { id: "records", label: "ผลตรวจทั้งหมด" }, { id: "ncr", label: `NCR / CAPA (${data.ncrs.length})` }, { id: "coa", label: "ใบรับรอง CoA" }], tab, (id) => ctx.pageUrl({ tab: id === "hold" ? null : id }));

    let section = "";
    if (tab === "hold") {
      section = ui.card(ui.table(["ล็อต", "ขั้นตอน", "สาเหตุที่กักกัน", { label: "ปริมาณ", className: "right" }, { label: "", className: "right" }], held.map((lot) => `<tr><td>${ui.mono(lot.id)}<div class="small muted">${esc(lot.orderId)}</div></td><td>${esc(STAGE_LABEL[lot.stage])}</td><td class="small">${esc((lot.holdReasons || []).join(", ") || "-")}</td><td class="right">${esc(`${fmtNum(lot.goodQty, 2)} ${lot.uom}`)}</td>
        <td class="right">${decide ? ui.openButton("ตรวจซ้ำ / ตัดสิน", "qcRecord", { lotId: lot.id }, { className: "small" }) : '<span class="small muted">เฉพาะ QC</span>'}</td></tr>`), { emptyText: "ไม่มีล็อตที่ถูกกักกัน" }), { flush: true });
    } else if (tab === "records") {
      section = ui.card(ui.table(["เลขที่", "ล็อต", "ผลทดสอบ", "ผล", "ผู้ตรวจ"], records.map((record) => `<tr><td>${ui.mono(record.id)}<div class="small muted">${esc(fmtDateTime(record.at))}</div></td><td class="rf-mono small">${esc(record.lotId)}<div class="muted">${esc(STAGE_LABEL[record.stage])}</div></td>
        <td class="small">${record.tests.map((test) => ui.badge(test.pass ? "" : "bad", `${SPECS.lab[test.key]?.label ?? test.key} ${test.value}`)).join(" ")}${record.note ? `<div class="muted">${esc(record.note)}</div>` : ""}</td><td>${ui.status(record.result)}</td><td class="small">${esc(record.inspector ?? "-")}</td></tr>`), { emptyText: "ยังไม่มีผลตรวจ" }), { flush: true });
    } else if (tab === "ncr") {
      section = data.ncrs.length ? `<div class="rf-stack">${data.ncrs.map((ncr) => ncrCard(ctx, ncr, decide)).join("")}</div>` : ui.card(ui.empty("ยังไม่มี NCR"));
    } else {
      section = ui.card(ui.table(["ล็อตสินค้าสำเร็จรูป", "ลูกค้า / สินค้า", { label: "จำนวน", className: "right" }, "QC", { label: "", className: "right" }], finLots.map((lot) => {
        const order = data.orders.find((row) => row.id === lot.orderId);
        return `<tr><td>${ui.mono(lot.id)}<div class="small muted">${esc(fmtDate(lot.createdAt))}</div></td><td>${esc(order?.customer ?? "")}<div class="small muted">${esc(order?.productName ?? "")}</div></td><td class="right">${esc(`${fmtNum(lot.goodQty)} ${lot.uom}`)}<div class="small muted">${esc(`${lot.boxes} กล่อง`)}</div></td><td>${ui.status(lot.qc)}</td><td class="right">${ui.openButton("เปิด CoA", "coa", { lotId: lot.id }, { className: "secondary small" })}</td></tr>`;
      }), { emptyText: "ยังไม่มีล็อตสินค้าสำเร็จรูป" }), { flush: true });
    }
    const actions = decide ? `${ui.openButton("เปิด NCR", "ncr", {}, { className: "secondary" })}${ui.openButton("บันทึกผลตรวจ", "qcRecord", {}, { className: "" })}` : "";
    const html = `${ui.pageHead("ควบคุมคุณภาพ · NCR · CoA", "ตัดสินล็อตที่ถูกกักกัน บันทึกผลทดสอบในแล็บ ติดตามปัญหาด้วย NCR / 5-Why และออกใบรับรองผล (CoA)", actions)}
      ${ui.stats([
        { label: "First Pass Yield (ผลตรวจ)", value: `${fpy.toFixed(1)}%`, sub: `${records.length} ครั้งที่บันทึก` },
        { label: "ล็อตรอตัดสิน (Hold)", value: String(held.length), tone: held.length ? "warn" : "" },
        { label: "NCR ที่เปิดอยู่", value: String(openNcr.length), tone: openNcr.length ? "bad" : "" },
        { label: "ล็อตพร้อมออก CoA", value: String(finLots.filter((lot) => lot.qc === "pass").length) },
      ])}${tabs}${section}`;
    return { html };
  };

  function ncrCard(ctx, ncr, canClose) {
    const { ui, rules } = ctx;
    const { STAGE_LABEL, fmtDateTime, fmtNum } = rules;
    const closeForm = ncr.status === "open" && canClose ? `<form class="rf-row" data-rf-form="closeNcr" data-rf-args='${esc(JSON.stringify({ id: ncr.id }))}' data-rf-success="ปิด NCR แล้ว"><div class="rf-grow">${ui.input("verification", { placeholder: "ผลการทวนสอบประสิทธิผล…" })}</div>${ui.submitButton("ปิดเคส")}</form>` : "";
    return ui.card(`<div class="rf-grid rf-g2">
        <div class="rf-stack">${ui.kv([["ขั้นตอนที่พบ", esc(STAGE_LABEL[ncr.stage] ?? ncr.stage)], ["ล็อต", ui.mono(ncr.lotId)], ["ชิ้นงานเสีย", esc(fmtNum(ncr.defectQty))], ["ผู้รับผิดชอบ", esc(ncr.owner ?? "-")], ["เปิดเมื่อ", esc(fmtDateTime(ncr.createdAt))], ncr.closedAt ? ["ปิดเมื่อ", esc(`${fmtDateTime(ncr.closedAt)} · ${ncr.closedBy ?? ""}`)] : null])}
          <div><strong class="small">วิเคราะห์ 5-Why</strong><ol class="small rf-whys">${ncr.whys.map((why) => `<li>${esc(why)}</li>`).join("")}</ol></div></div>
        <div class="rf-stack small">
          <div><strong>ควบคุมทันที (Containment)</strong><div>${esc(ncr.containment || "-")}</div></div>
          <div><strong>แก้ไข (Corrective)</strong><div>${esc(ncr.corrective || "-")}</div></div>
          <div><strong>ป้องกันซ้ำ (Preventive)</strong><div>${esc(ncr.preventive || "-")}</div></div>
          ${ncr.verification ? `<div><strong>ผลการทวนสอบ</strong><div>${esc(ncr.verification)}</div></div>` : ""}${closeForm}</div></div>`,
    { title: `${ui.mono(ncr.id)} ${esc(ncr.title)}`, actions: `${ui.status(ncr.severity)}${ui.status(ncr.status)}` });
  }

  dialogs.qcRecord = (ctx, { lotId = "" } = {}) => {
    const { data, ui, rules } = ctx;
    const { STAGE_LABEL, SPECS, specText } = rules;
    const target = data.lots.find((lot) => lot.id === lotId) ?? null;
    const options = [...data.lots].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60).map((lot) => ({ value: lot.id, label: `${lot.id} · ${STAGE_LABEL[lot.stage]} · ${ui.statusLabel(lot.qc)}` }));
    const body = `<div class="rf-grid rf-g2">
        ${ui.field("ล็อตที่ตรวจ *", ui.select("lotId", options, { value: lotId, placeholder: "เลือก…", extra: "required" }))}
        ${ui.field("ผลตัดสิน", ui.select("result", [{ value: "", label: "อัตโนมัติจากผลวัด" }, { value: "pass", label: "ผ่าน — ปลดกักกัน" }, { value: "hold", label: "กักกันต่อ" }, { value: "fail", label: "ไม่ผ่าน — ทิ้ง/Rework" }]), { hint: "เว้นว่างให้ระบบตัดสินจากค่าที่วัด" })}
      </div>${target?.holdReasons?.length ? ui.callout("warn", esc(`สาเหตุที่กักกัน: ${target.holdReasons.join(", ")}`)) : ""}
      <div class="rf-grid rf-g3">${Object.entries(SPECS.lab).map(([key, spec]) => ui.specInput(`values.${key}`, `${spec.label} · ${spec.method}`, spec)).join("")}</div>
      ${ui.field("หมายเหตุ", ui.textarea("note"))}<div class="small muted">สเปกอ้างอิง: ${esc(Object.values(SPECS.lab).map((spec) => `${spec.label} ${specText(spec)}`).join(" · "))}</div>`;
    const html = ui.dialog("qcRecord", "บันทึกผลตรวจคุณภาพ", `<form data-rf-form="addQcRecord" data-rf-success="บันทึกผลตรวจ {result} แล้ว" id="rf-qc-record">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-qc-record">บันทึกผล</button>`, wide: true });
    return { html };
  };

  dialogs.ncr = (ctx) => {
    const { data, ui, rules } = ctx;
    const { STAGES, STAGE_LABEL } = rules;
    const body = `<div class="rf-grid rf-g2">
        ${ui.field("หัวข้อปัญหา *", ui.input("title", { required: true }))}
        ${ui.field("ล็อตที่พบ *", `${ui.input("lotId", { list: "rf-ncr-lots", placeholder: "เช่น CU-…", required: true })}<datalist id="rf-ncr-lots">${data.lots.slice(0, 80).map((lot) => `<option value="${esc(lot.id)}"></option>`).join("")}</datalist>`, { hint: "ล็อตที่ผ่านแล้วจะถูกกักกันอัตโนมัติ" })}
        ${ui.field("ขั้นตอนที่พบ", ui.select("stage", STAGES.map((stage) => ({ value: stage, label: STAGE_LABEL[stage] })), { value: "curing" }))}
        <div class="rf-grid rf-g2">${ui.field("ความรุนแรง", ui.select("severity", [{ value: "critical", label: "Critical — หยุดไลน์" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" }], { value: "major" }))}${ui.field("จำนวนชิ้นงานเสีย", ui.input("defectQty", { type: "number", step: "any" }))}</div>
      </div>
      <div class="rf-stack rf-tight"><strong class="small">วิเคราะห์ 5-Why</strong>${[1, 2, 3, 4, 5].map((n) => ui.input("whys[]", { placeholder: `ทำไม ครั้งที่ ${n}` })).join("")}</div>
      <div class="rf-grid rf-g3">${ui.field("ควบคุมทันที", ui.textarea("containment"))}${ui.field("การแก้ไข", ui.textarea("corrective"))}${ui.field("การป้องกันซ้ำ", ui.textarea("preventive"))}</div>
      ${ui.badge("info", "ต้องกรอก “การแก้ไข” ก่อนจึงจะปิดเคสได้")}`;
    const html = ui.dialog("ncr", "เปิดรายงานข้อบกพร่อง (NCR)", `<form data-rf-form="createNcr" data-rf-success="เปิด {result} แล้ว" id="rf-ncr">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-ncr">เปิด NCR</button>`, wide: true });
    return { html };
  };

  // ---------- SPC / Cpk ----------
  // ค่าที่ติดตาม: มาจากไหนและใช้สเปกใด
  const spcChars = (rules) => {
    const { SPECS } = rules;
    return [
      ...["thickness", "width", "weightPerM"].map((key) => ({ id: `ex.${key}`, label: `ฉีด · ${SPECS.extrusion[key].label}`, spec: SPECS.extrusion[key], source: (d) => d.lots.filter((lot) => lot.stage === "extrusion").map((lot) => ({ id: lot.id, at: lot.createdAt, v: lot.params[key] })) })),
      ...["temp", "time", "pressure"].map((key) => ({ id: `cu.${key}`, label: `อบ · ${SPECS.curing[key].label}`, spec: SPECS.curing[key], source: (d) => d.lots.filter((lot) => lot.stage === "curing").map((lot) => ({ id: lot.id, at: lot.createdAt, v: lot.params[key] })) })),
      ...Object.entries(SPECS.lab).map(([key, spec]) => ({ id: `lab.${key}`, label: `แล็บ · ${spec.label}`, spec, source: (d) => d.qcRecords.flatMap((record) => record.tests.filter((test) => test.key === key).map((test) => ({ id: record.lotId, at: record.at, v: test.value }))) })),
      { id: "mx.dump", label: "ผสม · Dump temp (สูตร EPDM)", spec: { label: "Dump temp", unit: "°C", target: 140, tol: 6 }, source: (d) => d.lots.filter((lot) => lot.stage === "mixing" && lot.recipeId === "RC-EPDM-DS01").map((lot) => ({ id: lot.id, at: lot.createdAt, v: lot.params.dumpTemp })) },
    ];
  };

  pages.spc = (ctx) => {
    const { data, ui, rules, params } = ctx;
    const { stats, cpkVerdict, specLimits, specText, fmtDate } = rules;
    const chars = spcChars(rules);
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
    const picker = `<form class="rf-row" data-rf-pick><label class="sr-only" for="rf-spc-ch">ค่าที่ติดตาม</label>${ui.select("ch", chars.map((row) => ({ value: row.id, label: row.label })), { value: ch.id, id: "rf-spc-ch", className: "rf-spc-pick", extra: "data-rf-ch" })}</form>`;
    const html = `${ui.pageHead("SPC / ความสามารถของกระบวนการ", "แผนภูมิควบคุมค่ารายตัว (I-chart), ฮิสโตแกรม และดัชนี Cp / Cpk คำนวณจากข้อมูลการผลิตจริงในระบบ", picker)}
      ${ui.stats([
        { label: "Cpk", value: r(s?.cpk, 2), sub: verdict.text, tone: verdict.tone === "muted" ? "" : verdict.tone },
        { label: "Cp / Ppk", value: `${r(s?.cp, 2)} / ${r(s?.ppk, 2)}`, sub: "Ppk ใช้ σ รวมทั้งหมด" },
        { label: "ค่าเฉลี่ย / σ (MR)", value: `${r(s?.mean)} / ${r(s?.sdWithin)}`, sub: `n = ${s?.n ?? points.length} · สเปก ${specText(ch.spec)}` },
        { label: "จุดผิดปกติ", value: `${ooc.length} นอก CL · ${oos.length} นอกสเปก`, sub: `UCL ${r(s?.ucl)} · LCL ${r(s?.lcl)}` },
      ])}
      ${ui.card(points.length < 2 ? ui.empty("ข้อมูลไม่พอสำหรับคำนวณ") : ui.controlChart(points, { lsl, usl, stat: s, unit: ch.spec.unit }), { title: `I-chart · ${esc(ch.label)}` })}
      <div class="rf-grid rf-g2">
        ${ui.card(bins.length ? ui.histogram(bins, { unit: ch.spec.unit }) : ui.empty("ข้อมูลไม่พอ"), { title: "ฮิสโตแกรม" })}
        ${ui.card(ui.table(["ล็อต", "วันที่", { label: "ค่า", className: "right" }], oos.map((point) => `<tr><td class="rf-mono">${esc(point.id)}</td><td>${esc(point.label)}</td><td class="right">${ui.badge("bad", `${point.v} ${ch.spec.unit}`)}</td></tr>`), { emptyText: "ไม่มีค่าที่หลุดสเปก" }), { title: "ค่าที่หลุดสเปก", flush: true })}
      </div>`;
    const bind = (rootNode) => {
      rootNode.querySelector("[data-rf-ch]")?.addEventListener("change", (event) => { location.hash = ctx.pageUrl({ ch: event.target.value }); });
      rootNode.querySelector("[data-rf-pick]")?.addEventListener("submit", (event) => event.preventDefault());
    };
    return { html, bind };
  };

  // ---------- สืบย้อนกลับ ----------
  pages.trace = (ctx) => {
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
      if (treeNode.kind === "lot") { sub = `${STAGE_LABEL[it.stage]} · ${fmtNum(it.goodQty, 2)} ${it.uom} · ${fmtDateTime(it.createdAt)}`; statusValue = it.qc; }
      if (treeNode.kind === "box") { sub = `กล่อง · ${it.productName} · ${fmtNum(it.qty)} ${it.uom}`; statusValue = it.status; }
      if (treeNode.kind === "requisition") sub = `ใบเบิก · ${it.batches} batch · ${fmtNum(it.totalKg, 1)} kg`;
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
    const html = `${ui.pageHead("สืบย้อนกลับ (Traceability)", "ย้อนจากกล่องสินค้าไปถึงล็อตวัตถุดิบ หรือไล่ไปข้างหน้าจากล็อตวัตถุดิบว่าถูกใช้ในกล่องใดบ้าง (สำหรับกรณีเรียกคืนสินค้า)")}
      ${ui.card(`<form class="rf-search rf-search-wide" data-rf-search role="search"><label class="sr-only" for="rf-q">รหัส</label>${ui.input("q", { id: "rf-q", type: "search", value: query, placeholder: "สแกนหรือพิมพ์รหัสกล่อง ล็อต หรือล็อตวัตถุดิบ" })}<button class="btn rf-btn" type="submit">ค้นหา</button></form>
        <div class="rf-row small muted rf-samples">ตัวอย่าง: ${samples.map((sample) => ui.link(sample, ctx.pageUrl({ q: sample }), "rf-badge")).join("")}</div>`)}
      ${query && !hit ? ui.callout("bad", esc(`ไม่พบรหัส “${query}”`)) : ""}${note ? ui.callout("info", esc(note)) : ""}
      <div class="rf-grid rf-g2">
        ${backward ? ui.card(`<ul class="rf-tree rf-tree-root">${node(backward)}</ul>`, { title: "ย้อนกลับไปต้นทาง" }) : ""}
        ${forward ? ui.card(`<ul class="rf-tree rf-tree-root">${node(forward)}</ul>${forwardSummary(forward)}`, { title: "ไปข้างหน้า (ใช้ที่ไหนบ้าง)" }) : ""}
      </div>`;
    return { html };
  };
})(typeof window !== "undefined" ? window : globalThis);
