// RubberFlow MES (แผนก RB โหมดทดสอบ) — dialog เอกสาร: สแกนรหัส (รวมกล้อง BarcodeDetector) · ป้ายติดตามงาน (Traveler Tag) ·
// ใบรับรองผลวิเคราะห์ (CoA) · รายการแจ้งเตือน ยกมาจาก components/Documents.jsx และส่วนแจ้งเตือนของ App.jsx ของต้นแบบ
// ป้ายใช้บาร์โค้ด Code 39 (modules/rubberflow-ui.js) แทน QR พิมพ์ด้วย window.print() (CSS @media print ซ่อนทุกอย่างนอก .rf-printable)
// ลงทะเบียนใน window.MNP_RUBBERFLOW_DIALOGS กติกา event อยู่ที่ modules/module-rubberflow.js — โหลดหลัง modules/rubberflow-ui.js
(function (root) {
  const dialogs = (root.MNP_RUBBERFLOW_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);

  const COMPANY = Object.freeze({ name: "บริษัท รับเบอร์โฟลว์ อินดัสทรี จำกัด (ข้อมูลสาธิต)", address: "99/9 หมู่ 4 นิคมอุตสาหกรรมตัวอย่าง จ.ชลบุรี 20000" });
  const KIND_LABEL = Object.freeze({ order: "ใบสั่งผลิต", lot: "ล็อตงานระหว่างผลิต", box: "กล่องสินค้าสำเร็จรูป", material: "ล็อตวัตถุดิบ", requisition: "ใบเบิกวัตถุดิบ", transfer: "ใบส่งมอบ WIP", mold: "แม่พิมพ์/หัวดาย" });
  const KIND_PAGE = Object.freeze({ order: "orders", lot: "trace", box: "trace", material: "warehouse", requisition: "requisition", transfer: "wip", mold: "molds" });
  const KIND_PARAM = Object.freeze({ order: "q", lot: "q", box: "q", material: "q", requisition: "sel", transfer: "q", mold: null });
  const codeOf = (hit) => hit.item.id || hit.item.lotNo;
  const printButton = (ui, text = "พิมพ์") => `<button class="btn rf-btn" type="button" data-rf-print>${esc(text)}</button>`;
  const bindPrint = (dialog) => dialog.querySelector("[data-rf-print]")?.addEventListener("click", () => window.print());

  // ---------- สแกน ----------
  function scanSummary(ctx, hit) {
    const { data, now, ui, rules } = ctx;
    const { STAGE_LABEL, lotState, fmtDate, fmtDateTime, fmtNum } = rules;
    const it = hit.item;
    if (hit.kind === "material") {
      const material = data.materials.find((row) => row.code === it.materialCode);
      return ui.kv([["วัตถุดิบ", esc(material?.name ?? "-")], ["คงเหลือ", esc(`${fmtNum(it.qtyKg, 2)} kg`)], ["หมดอายุ", esc(fmtDate(it.expiry))], ["สถานะ", ui.status(lotState(it, now))], ["ที่เก็บ", esc(it.location)]]);
    }
    if (hit.kind === "lot") return ui.kv([["ขั้นตอน", esc(STAGE_LABEL[it.stage])], ["ใบสั่งผลิต", ui.mono(it.orderId)], ["งานดี", esc(`${fmtNum(it.goodQty, 2)} ${it.uom}`)], ["QC", ui.status(it.qc)], ["บันทึกเมื่อ", esc(`${fmtDateTime(it.createdAt)} · ${it.operator ?? "-"}`)]]);
    if (hit.kind === "box") return ui.kv([["สินค้า", esc(it.productName)], ["จำนวน", esc(`${fmtNum(it.qty)} ${it.uom}`)], ["เกรด", esc(it.grade)], ["สถานะ", ui.status(it.status)], ["ล็อตต้นทาง", ui.mono(it.lotId)]]);
    if (hit.kind === "order") return ui.kv([["ลูกค้า", esc(it.customer)], ["สินค้า", esc(it.productName)], ["ความคืบหน้า", esc(`${fmtNum(it.producedQty)} / ${fmtNum(it.targetQty)} ${it.uom}`)], ["สถานะ", ui.status(it.status)]]);
    if (hit.kind === "transfer") return ui.kv([["เส้นทาง", esc(`${STAGE_LABEL[it.from]} → ${STAGE_LABEL[it.to]}`)], ["ล็อต", ui.mono(it.lotId)], ["จำนวน", esc(`${it.qtySent} ${it.uom}`)], ["สถานะ", ui.status(it.status)]]);
    if (hit.kind === "requisition") return ui.kv([["ใบสั่งผลิต", ui.mono(it.orderId)], ["จำนวน", esc(`${it.batches} batch · ${fmtNum(it.totalKg, 2)} kg`)], ["สถานะ", ui.status(it.status)]]);
    return ui.kv([["ชื่อ", esc(it.name)], ["รอบตั้งแต่ล้าง", esc(`${fmtNum(it.usageSinceClean)} / ${fmtNum(it.cleanEvery)}`)]]);
  }

  function scanResult(ctx, query) {
    const { data, ui, derive } = ctx;
    const hit = query ? derive.lookupCode(data, query) : null;
    if (query && !hit) return ui.callout("bad", esc(`ไม่พบรหัส “${query}” ในระบบ ตรวจสอบป้ายบาร์โค้ดอีกครั้ง`));
    if (!hit) return "";
    const page = KIND_PAGE[hit.kind];
    const param = KIND_PARAM[hit.kind];
    const open = ctx.canSee(page) ? `<a class="btn rf-btn" href="${esc(ctx.url(page, param ? { [param]: codeOf(hit) } : {}))}" data-rf-close>เปิดดูรายละเอียด</a>` : "";
    const print = ["lot", "box", "material", "order", "requisition", "transfer"].includes(hit.kind) ? ui.openButton("พิมพ์ป้าย", "tag", { kind: hit.kind, id: codeOf(hit) }, { className: "secondary" }) : "";
    return `<div class="card rf-card rf-scan-hit"><div class="rf-row rf-between"><div><div class="small muted">${esc(KIND_LABEL[hit.kind])}</div><h3 class="rf-mono">${esc(codeOf(hit))}</h3></div><div class="rf-row">${print}${open}</div></div>${scanSummary(ctx, hit)}</div>`;
  }

  dialogs.scan = (ctx, { code = "" } = {}) => {
    const { data, ui } = ctx;
    const samples = [data.fgBoxes[0]?.id, data.lots.find((lot) => lot.stage === "mixing")?.id, data.materialLots[0]?.lotNo, data.orders[0]?.id].filter(Boolean);
    const hasCamera = typeof root.BarcodeDetector === "function" && Boolean(root.navigator?.mediaDevices?.getUserMedia);
    const body = `<form class="rf-row rf-scan-form" data-rf-scan-form><div class="rf-grow">${ui.input("code", { value: code, placeholder: "ใช้เครื่องสแกนยิงรหัส หรือพิมพ์แล้วกด Enter" })}</div><button class="btn rf-btn" type="submit">ค้นหา</button>${hasCamera ? `<button class="btn rf-btn secondary" type="button" data-rf-camera>เปิดกล้อง</button>` : ""}</form>
      <div data-rf-camera-box hidden></div>
      <div class="rf-row small muted rf-samples">ตัวอย่างรหัส: ${samples.map((sample) => `<button class="rf-badge" type="button" data-rf-sample="${esc(sample)}">${esc(sample)}</button>`).join("")}</div>
      <div data-rf-scan-result>${scanResult(ctx, code)}</div>`;
    const html = ui.dialog("scan", "สแกนบาร์โค้ด / QR", body, { wide: true });
    const bind = (dialog, context) => {
      const form = dialog.querySelector("[data-rf-scan-form]");
      const input = form.querySelector('[name="code"]');
      const result = dialog.querySelector("[data-rf-scan-result]");
      const cameraBox = dialog.querySelector("[data-rf-camera-box]");
      let stop = null;
      const show = (value) => {
        input.value = value;
        result.innerHTML = scanResult(context, String(value ?? "").trim().slice(0, 60));
        root.MNP_RUBBERFLOW_BIND?.(result, context);
        result.querySelectorAll("[data-rf-close]").forEach((link) => link.addEventListener("click", () => dialog.close()));
      };
      form.addEventListener("submit", (event) => { event.preventDefault(); show(input.value); });
      dialog.querySelectorAll("[data-rf-sample]").forEach((button) => button.addEventListener("click", () => show(button.dataset.rfSample)));
      dialog.querySelector("[data-rf-camera]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        if (stop) { stop(); stop = null; cameraBox.hidden = true; button.textContent = "เปิดกล้อง"; return; }
        cameraBox.hidden = false;
        cameraBox.innerHTML = `<video class="rf-camera" muted playsinline></video>`;
        const video = cameraBox.querySelector("video");
        let stream = null;
        let halted = false;
        try {
          const detector = new root.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
          stream = await root.navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          video.srcObject = stream;
          await video.play();
          const tick = async () => {
            if (halted) return;
            try {
              const codes = await detector.detect(video);
              if (codes[0]) { show(codes[0].rawValue); stop?.(); stop = null; cameraBox.hidden = true; button.textContent = "เปิดกล้อง"; return; }
            } catch { /* เฟรมยังไม่พร้อม */ }
            root.requestAnimationFrame(tick);
          };
          tick();
          button.textContent = "ปิดกล้อง";
          stop = () => { halted = true; stream?.getTracks().forEach((track) => track.stop()); };
          dialog.addEventListener("close", () => stop?.(), { once: true });
        } catch {
          cameraBox.innerHTML = ui.callout("warn", "เปิดกล้องไม่ได้ (ไม่ได้รับอนุญาตหรือไม่มีกล้อง)");
        }
      });
      result.querySelectorAll("[data-rf-close]").forEach((link) => link.addEventListener("click", () => dialog.close()));
    };
    return { html, bind };
  };

  // ---------- ป้ายติดตามงาน ----------
  dialogs.tag = (ctx, { kind, id }) => {
    const { data, ui, rules, derive } = ctx;
    const { STAGE_LABEL, fmtDate, fmtDateTime, fmtNum } = rules;
    const hit = derive.lookupCode(data, id);
    if (!hit || !KIND_LABEL[kind]) return null;
    const it = hit.item;
    const order = data.orders.find((row) => row.id === (it.orderId || it.id));
    const rows = [];
    if (kind === "lot") rows.push(["ขั้นตอน", STAGE_LABEL[it.stage]], ["จำนวนงานดี", `${fmtNum(it.goodQty, 2)} ${it.uom}`], ["QC", String(it.qc).toUpperCase()], ["ล็อตต้นทาง", derive.parentLotIds(data, it).join(", ") || (it.sources?.[0]?.id ?? "-")]);
    if (kind === "box") rows.push(["สินค้า", it.productName], ["จำนวน", `${fmtNum(it.qty)} ${it.uom}`], ["เกรด", it.grade], ["ล็อตตกแต่ง", it.lotId]);
    if (kind === "material") { const material = data.materials.find((row) => row.code === it.materialCode); rows.push(["วัตถุดิบ", material?.name ?? "-"], ["รับเข้า", `${fmtNum(it.initialKg, 2)} kg`], ["หมดอายุ", fmtDate(it.expiry)], ["ผู้ขาย", it.supplier]); }
    if (kind === "requisition") rows.push(["จำนวน", `${it.batches} batch · ${fmtNum(it.totalKg, 2)} kg`], ["รายการ", `${it.lines.length} ล็อตวัตถุดิบ`]);
    if (kind === "transfer") rows.push(["เส้นทาง", `${STAGE_LABEL[it.from]} → ${STAGE_LABEL[it.to]}`], ["ล็อต", it.lotId], ["จำนวนส่ง", `${it.qtySent} ${it.uom}`]);
    if (kind === "order") rows.push(["ลูกค้า", it.customer], ["จำนวน", `${fmtNum(it.targetQty)} ${it.uom}`], ["กำหนดส่ง", fmtDate(it.dueDate)]);
    const code = codeOf(hit);
    const body = `<div class="rf-tag rf-printable"><div class="rf-stack rf-tight">
        <div class="small">${esc(COMPANY.name)}</div><div class="rf-tag-code rf-mono">${esc(code)}</div>
        <div><strong>${esc(KIND_LABEL[kind])}</strong>${order && kind !== "order" ? ` · ${esc(order.id)}` : ""}</div>
        ${order ? `<div class="small">${esc(`${order.productName} · ${order.customer}`)}</div>` : ""}
        <table class="rf-tag-table small"><tbody>${rows.map(([key, value]) => `<tr><td>${esc(key)}</td><td><strong>${esc(value ?? "-")}</strong></td></tr>`).join("")}</tbody></table>
        <div class="small">พิมพ์เมื่อ ${esc(fmtDateTime(Date.now()))}</div></div>${ui.barcode(code)}</div>`;
    const html = ui.dialog("tag", "ป้ายติดตามงาน (Traveler Tag)", body, { footer: `${ui.closeButton("ปิด")}${printButton(ui)}` });
    return { html, bind: bindPrint };
  };

  // ---------- ใบรับรองผลวิเคราะห์ ----------
  dialogs.coa = (ctx, { lotId }) => {
    const { data, ui, rules, derive } = ctx;
    const { SPECS, specText, fmtDate } = rules;
    const lot = data.lots.find((row) => row.id === lotId);
    if (!lot) return null;
    const order = data.orders.find((row) => row.id === lot.orderId);
    const recipe = data.recipes.find((row) => row.id === order?.recipeId);
    // รวบรวมผลแล็บจากล็อตนี้และทุกล็อตต้นทาง
    const chain = [];
    const walk = (current) => { chain.push(current); derive.parentLotIds(data, current).forEach((parentId) => { const parent = data.lots.find((row) => row.id === parentId); if (parent) walk(parent); }); };
    walk(lot);
    const records = data.qcRecords.filter((record) => chain.some((item) => item.id === record.lotId));
    const latest = {};
    records.forEach((record) => record.tests.forEach((test) => { if (!latest[test.key] || latest[test.key].at < record.at) latest[test.key] = { ...test, at: record.at, lotId: record.lotId }; }));
    const curing = chain.find((item) => item.stage === "curing");
    const allPass = Object.values(latest).every((test) => test.pass) && lot.qc === "pass";
    const boxes = data.fgBoxes.filter((box) => box.lotId === lot.id);
    const body = `<div class="rf-doc rf-printable rf-stack">
        <div class="rf-row rf-between"><div><h2>CERTIFICATE OF ANALYSIS</h2><div class="small">${esc(COMPANY.name)}<br>${esc(COMPANY.address)}</div></div>${ui.barcode(lot.id, { height: 36 })}</div>
        ${ui.kv([["ลูกค้า", esc(`${order?.customer ?? "-"} (PO ${order?.customerPo || "-"})`)], ["สินค้า", esc(`${order?.productCode ?? "-"} · ${order?.productName ?? "-"}`)], ["สูตร", esc(`${recipe?.id ?? "-"} Rev.${recipe?.revision ?? "-"}`)], ["ล็อต", `${ui.mono(lot.id)} ${esc(`(ผลิต ${fmtDate(lot.createdAt)})`)}`],
          ["จำนวน", esc(`${rules.fmtNum(lot.goodQty)} ${lot.uom} · ${boxes.length} กล่อง · เกรด ${lot.grade || "A"}`)], curing ? ["สภาวะอบ", esc(`${curing.params.temp}°C · ${curing.params.time} s · ${curing.params.pressure} bar (${curing.id})`)] : null])}
        ${ui.table(["รายการทดสอบ", "วิธีทดสอบ", "สเปก", "ผลทดสอบ", "ผล"], Object.entries(SPECS.lab).map(([key, spec]) => `<tr><td>${esc(spec.label)}</td><td>${esc(spec.method)}</td><td>${esc(specText(spec))}</td><td>${esc(latest[key] ? `${latest[key].value} ${spec.unit}` : "ไม่ได้ทดสอบ")}</td><td>${esc(latest[key] ? (latest[key].pass ? "PASS" : "FAIL") : "-")}</td></tr>`), { className: "rf-doc-table" })}
        <div><strong>${esc(`สรุปผล: ${allPass ? "ผ่านเกณฑ์ (ACCEPTED)" : "ยังไม่สามารถรับรองได้"}`)}</strong></div>
        ${allPass ? "" : ui.badge("bad", "มีรายการไม่ผ่านหรือล็อตยังถูกกักกัน")}
        <div class="rf-row rf-between small rf-doc-sign"><div>ผู้ตรวจสอบ: ${esc(records[0]?.inspector || "-")}<br>วันที่ออก: ${esc(fmtDate(Date.now()))}</div><div>________________________<br>ผู้อนุมัติ (QA)</div></div></div>`;
    const html = ui.dialog("coa", `ใบรับรองผลวิเคราะห์ (CoA) · ${lot.id}`, body, { footer: `${ui.closeButton("ปิด")}${printButton(ui, "พิมพ์ / บันทึก PDF")}`, wide: true });
    return { html, bind: bindPrint };
  };

  // ---------- การแจ้งเตือน ----------
  dialogs.alerts = (ctx) => {
    const { data, now, ui, derive } = ctx;
    const alerts = derive.buildAlerts(data, now);
    const body = alerts.length ? `<div class="rf-stack">${alerts.map((alert) => ui.callout(alert.tone, `<div class="rf-row rf-between rf-grow"><div><strong>${esc(alert.title)}</strong><br>${esc(alert.text)}</div>${ctx.canSee(alert.module) ? `<a class="btn rf-btn secondary small" href="${esc(ctx.url(alert.module))}" data-rf-close>ไปที่หน้า</a>` : ""}</div>`)).join("")}</div>` : `<p class="muted">ไม่มีการแจ้งเตือน</p>`;
    const html = ui.dialog("alerts", `การแจ้งเตือน (${alerts.length})`, body);
    return { html };
  };
})(typeof window !== "undefined" ? window : globalThis);
