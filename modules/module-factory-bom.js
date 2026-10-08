// โครงสร้างสินค้า (BOM) ของฝ่ายโรงงาน (โหมดทดสอบ): ดู · สร้างฉบับร่าง · แก้ไข · ส่งขออนุมัติ · อนุมัติ/ไม่อนุมัติ
//
// view ที่ไฟล์นี้วาดให้รายการในเมนู Item master › โครงสร้าง (modules/factory-item-master.js):
//   bom           โครงสร้างสินค้า-ดู      ดูสูตร คำนวณปริมาณตามจำนวนผลิต ประวัติ และปุ่มตามสถานะ (ส่ง/ถอน/อนุมัติ/ไม่อนุมัติ)
//   bom-new       โครงสร้างสินค้า-ใหม่    ฟอร์มสร้างฉบับร่าง · &bom=<id> แก้ฉบับร่าง · &from=<id> ออก Revision ใหม่จากฉบับที่มีอยู่
//   bom-drafts    โครงสร้างสินค้า-แก้ไข   รายการฉบับร่างที่แก้ได้ (ฉบับที่ถูกส่งกลับขึ้นก่อน พร้อมเหตุผลของผู้อนุมัติ)
//   bom-approvals โครงสร้างสินค้า-อนุมัติ คิวรออนุมัติ และผลการพิจารณาล่าสุด
//
// ขั้นตอน: ฉบับร่าง → ส่งขออนุมัติ → (ผู้ดูแลระบบ) อนุมัติ | ไม่อนุมัติ+เหตุผล (กลับเป็นฉบับร่าง) · ถอนกลับมาแก้ได้ก่อนตัดสิน
// ทุกขั้นเรียก RPC ใน supabase/migrations/20261007010000_factory_bom_draft_approval.sql ซึ่งตรวจสิทธิ์ โหมดทดสอบ สถานะ
// version สูตรวนซ้ำ และค่าทุกช่องเอง หน้านี้ตรวจฟอร์มเพื่อความสะดวกเท่านั้น (ตรรกะที่ทดสอบได้อยู่ที่ modules/factory-master-model.js)
// ผู้อนุมัติคือผู้ดูแลระบบตัวจริงเบื้องหลัง persona — โหมดทดสอบไม่ส่งแจ้งเตือน จึงเห็นรายการรออนุมัติที่หน้า "-อนุมัติ" และแบนเนอร์
//
// โหลดหลัง modules/module-factory-master.js (ใช้ helper ผ่าน window.MNP_FACTORY_UI) และก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (sb, escapeHtml, formatDate, showToast, friendlyError, setFormBusy, renderRoute) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// ทุก dropdown เป็น <select> ของเบราว์เซอร์ (แตะบน iPhone ได้ ไม่ต้องมีโค้ดปิด popup)
(function registerFactoryBomViews() {
  const model = window.MNP_FACTORY_MASTER_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const { loadData, qty, label, options, notice, docStatus, typeBadge } = window.MNP_FACTORY_UI;

  // ลำดับสำคัญ: friendlyError ใช้คีย์แรกที่ปรากฏอยู่ในข้อความ จึงต้องวางรหัสที่ยาวกว่าไว้ก่อนรหัสที่เป็นส่วนต้นของมัน
  const ERROR_MESSAGES = {
    INVALID_BOM_LINE_QUANTITY: "ปริมาณของส่วนประกอบต้องมากกว่า 0 และไม่เกิน 1,000,000,000",
    INVALID_BOM_LINE_SCRAP: "เผื่อสูญเสียต้องตั้งแต่ 0 ถึงต่ำกว่า 100",
    INVALID_BOM_LINES: "รายการส่วนประกอบไม่ถูกต้อง (มีได้ไม่เกิน 100 บรรทัด)",
    INVALID_BOM_LINE: "รายการส่วนประกอบไม่ถูกต้อง กรุณาเลือกส่วนประกอบให้ครบทุกบรรทัด",
    INVALID_BOM_OUTPUT_QTY: "ผลผลิตต่อสูตรต้องมากกว่า 0 และไม่เกิน 1,000,000,000",
    INVALID_BOM_EFFECTIVE_DATE: "วันที่เริ่มมีผลไม่ถูกต้อง",
    INVALID_BOM_NOTE: "หมายเหตุยาวได้ไม่เกิน 1,000 ตัวอักษร",
    INVALID_BOM_DECISION: "การตัดสินไม่ถูกต้อง",
    BOM_PARENT_NOT_FOUND: "ไม่พบสินค้าหลักนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    BOM_PARENT_INVALID: "สินค้าหลักต้องเป็น Item ที่ใช้งานอยู่ ประเภทงานระหว่างผลิตหรือสินค้าสำเร็จรูป และผลิตเองได้",
    BOM_OPEN_REVISION_EXISTS: "สินค้านี้มีโครงสร้างฉบับร่างหรือรออนุมัติอยู่แล้ว กรุณาแก้ฉบับนั้น หรือรอผลการอนุมัติก่อน",
    BOM_REVISION_EXHAUSTED: "สินค้านี้ใช้ Revision ครบ A–Z แล้ว",
    BOM_NOT_FOUND: "ไม่พบโครงสร้างสินค้านี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    BOM_VERSION_CONFLICT: "โครงสร้างนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจรายการล่าสุดแล้วทำอีกครั้ง",
    BOM_NOT_EDITABLE: "แก้ไขได้เฉพาะฉบับร่าง (ถ้ารออนุมัติอยู่ให้ถอนกลับมาแก้ไขก่อน)",
    BOM_NOT_DRAFT: "ส่งขออนุมัติได้เฉพาะฉบับร่าง",
    BOM_NOT_PENDING: "โครงสร้างนี้ไม่ได้อยู่ในสถานะรออนุมัติแล้ว",
    BOM_LOCKED_FIELDS: "เปลี่ยนสินค้าหลักของฉบับร่างไม่ได้",
    BOM_NO_LINES: "ต้องมีส่วนประกอบอย่างน้อย 1 บรรทัดก่อนส่งขออนุมัติ",
    BOM_SELF_REFERENCE: "ส่วนประกอบเป็นสินค้าหลักเองไม่ได้",
    BOM_DUPLICATE_COMPONENT: "มีส่วนประกอบซ้ำกันในสูตรเดียวกัน",
    BOM_COMPONENT_NOT_FOUND: "ไม่พบส่วนประกอบที่เลือก (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    BOM_COMPONENT_INACTIVE: "มีส่วนประกอบที่หยุดใช้งานแล้ว กรุณาเปลี่ยนหรือเปิดใช้งาน Item นั้นก่อน",
    BOM_CIRCULAR: "สูตรวนซ้ำ: ส่วนประกอบนี้ใช้สินค้าหลักเป็นส่วนประกอบย้อนกลับ (ผ่านสูตรของส่วนประกอบอื่น) กรุณาตรวจสูตรที่เกี่ยวข้อง",
    BOM_SELF_APPROVAL: "อนุมัติใบที่ตนเองส่งไม่ได้",
    BOM_REJECT_NOTE_REQUIRED: "กรุณาระบุเหตุผลที่ไม่อนุมัติ",
  };
  Object.assign(window.MNP_FACTORY_ERRORS, ERROR_MESSAGES);

  // ปริมาณในสูตรเก็บ 4 ทศนิยม (qty() ของ Item master แสดงแค่ 3)
  const q4 = (value) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 4 });
  const bomLabel = (bom) => `${bom.code} · ${bom.name} (Rev. ${bom.revision} · ${label(model.DOCUMENT_STATUSES, bom.status)})`;
  const linesOf = (data, bomId) => (data.bom_lines ?? []).filter((line) => line.bom_id === bomId);
  const openBomOf = (data, itemId) => (data.boms ?? []).find((bom) => bom.item_id === itemId && model.OPEN_BOM_STATUSES.includes(bom.status)) ?? null;
  const approvedBomOf = (data, itemId) => (data.boms ?? []).find((bom) => bom.item_id === itemId && bom.status === "approved") ?? null;
  const viewUrl = (bomId) => menu.url("structure-view", { bom: bomId });
  const editUrl = (bomId) => menu.url("structure-new", { bom: bomId });
  const person = (name, at) => (name || at ? `${escapeHtml(name ?? "—")}${at ? ` · ${formatDate(at, true)}` : ""}` : "—");

  // แบนเนอร์บอกว่ามีโครงสร้างรออนุมัติ — โหมดทดสอบไม่ส่งแจ้งเตือน ผู้อนุมัติต้องเห็นจากหน้าเหล่านี้
  function pendingBanner(data, { link = true } = {}) {
    const count = model.pendingBoms(data.boms).length;
    if (!count) return "";
    return `<p class="fm-notice" role="status">มีโครงสร้างสินค้ารออนุมัติ <strong>${count}</strong> รายการ${link ? ` — <a href="${escapeHtml(menu.url("structure-approve"))}">ไปที่หน้าอนุมัติ</a>` : ""}</p>`;
  }

  // ปุ่มเรียก RPC หนึ่งครั้ง: ปิดปุ่มระหว่างทำ สำเร็จแล้ววาดหน้าใหม่ ผิดพลาดแจ้งเตือนและวาดใหม่เมื่อสถานะในหน้าล้าสมัย
  const STALE_CODES = ["BOM_VERSION_CONFLICT", "BOM_NOT_PENDING", "BOM_NOT_DRAFT", "BOM_NOT_EDITABLE", "BOM_NOT_FOUND"];
  async function runAction(root, rpc, args, successMessage) {
    const buttons = root.querySelectorAll("[data-bom-action], .fm-decision button");
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const { error } = await sb.rpc(rpc, args);
      if (error) throw error;
      showToast(successMessage);
      await renderRoute();
    } catch (error) {
      showToast(friendlyError(error), "error");
      if (STALE_CODES.some((code) => String(error?.message ?? "").includes(code))) await renderRoute();
      else buttons.forEach((button) => { button.disabled = false; });
    }
  }

  // ---------- ดูโครงสร้าง ----------
  function historyTable(entries) {
    if (!entries.length) return '<p class="muted small">ยังไม่มีประวัติ (สูตรตัวอย่างยังไม่เคยแก้ผ่านหน้าจอ)</p>';
    return `<div class="table-wrap"><table>
        <thead><tr><th>เวลา</th><th>การกระทำ</th><th>รุ่น</th><th>ผู้ทำรายการ</th><th>หมายเหตุ / เหตุผล</th></tr></thead>
        <tbody>${entries.map((entry) => `<tr>
          <td>${formatDate(entry.created_at, true)}</td>
          <td>${escapeHtml(label(model.BOM_HISTORY_ACTIONS, entry.action))}</td>
          <td>${escapeHtml(entry.version)}</td>
          <td>${escapeHtml(entry.changed_by_name ?? "—")}</td>
          <td class="fm-pre">${escapeHtml(entry.note || "—")}</td>
        </tr>`).join("")}</tbody></table></div>`;
  }

  function statusNotice(data, bom) {
    if (bom.status === "approved") return "";
    if (bom.status === "pending_approval") return notice("ส่งขออนุมัติแล้ว รอผู้ดูแลระบบพิจารณา ระหว่างนี้แก้ไขไม่ได้ (ถอนกลับมาแก้ไขได้ก่อนตัดสิน) ยังไม่ใช้ผลิตจริง");
    if (bom.status === "obsolete") {
      const current = approvedBomOf(data, bom.item_id);
      return notice(`ฉบับนี้เลิกใช้แล้ว${current ? ` (แทนที่ด้วย Rev. ${current.revision})` : ""}`);
    }
    const returned = bom.decision_note ? ` ผู้อนุมัติส่งกลับพร้อมเหตุผล: “${bom.decision_note}”` : "";
    return notice(`ฉบับร่าง ยังไม่ใช้ผลิตจริง ต้องส่งขออนุมัติก่อน${returned}`);
  }

  function bomActionsHtml(data, bom) {
    const actions = model.bomActions(bom);
    const buttons = [];
    if (actions.includes("edit")) buttons.push(`<a class="btn secondary" href="${escapeHtml(editUrl(bom.id))}">แก้ไขฉบับร่าง</a>`);
    if (actions.includes("submit")) buttons.push('<button class="btn" type="button" data-bom-action="submit">ส่งขออนุมัติ</button>');
    if (actions.includes("withdraw")) buttons.push('<button class="btn secondary" type="button" data-bom-action="withdraw">ถอนกลับมาแก้ไข</button>');
    if (actions.includes("revise")) {
      const open = openBomOf(data, bom.item_id);
      buttons.push(open
        ? `<a class="btn secondary" href="${escapeHtml(viewUrl(open.id))}">มีฉบับ Rev. ${escapeHtml(open.revision)} (${escapeHtml(label(model.DOCUMENT_STATUSES, open.status))}) อยู่แล้ว</a>`
        : `<a class="btn secondary" href="${escapeHtml(menu.url("structure-new", { from: bom.id }))}">สร้าง Revision ใหม่จากฉบับนี้</a>`);
    }
    return buttons.length ? `<div class="fm-actions">${buttons.join("")}</div>` : "";
  }

  function decisionPanelHtml(data, bom) {
    if (!model.bomActions(bom).includes("approve")) return "";
    const current = approvedBomOf(data, bom.item_id);
    return `<section class="card fm-decision" aria-labelledby="fm-decision-title">
        <h2 id="fm-decision-title">พิจารณาโครงสร้างนี้</h2>
        <p class="muted small">ตรวจส่วนประกอบ ปริมาณ และเผื่อสูญเสียในตารางด้านบนก่อนตัดสิน · ส่งโดย ${person(bom.submitted_by_name, bom.submitted_at)}
          ${current ? `<br>การอนุมัติจะเลิกใช้ Rev. ${escapeHtml(current.revision)} ที่ใช้อยู่เดิมของ ${escapeHtml(bom.code)}` : ""}</p>
        <div class="field"><label for="fm-decision-note">หมายเหตุ / เหตุผล</label>
          <textarea class="textarea" id="fm-decision-note" rows="3" maxlength="1000"></textarea>
          <small>จำเป็นเมื่อไม่อนุมัติ (ผู้ส่งจะเห็นเหตุผลนี้และแก้ไขแล้วส่งใหม่ได้) · ไม่จำเป็นเมื่ออนุมัติ</small></div>
        <div class="fm-actions">
          <button class="btn success" type="button" id="fm-approve">อนุมัติ</button>
          <button class="btn danger" type="button" id="fm-reject">ไม่อนุมัติ (ส่งกลับให้แก้ไข)</button>
        </div>
      </section>`;
  }

  // ---------- ต้นไม้โครงสร้าง (แตกสูตรทุกชั้น อ่านอย่างเดียว) ----------
  // ตรรกะอยู่ที่ model.bomTree: ปริมาณ per = ต่อสินค้าหลัก 1 หน่วย หน้าจอคูณด้วยจำนวนที่ต้องการผลิต (คำนวณใหม่เมื่อเปลี่ยนจำนวน)
  const treeQty = (per, produce) => q4(Math.round(per * produce * 1e4) / 1e4);
  const minutes = (value) => (value > 0 ? `${q4(value)} นาที` : "—");

  function treeNodeHtml(node, produce) {
    const bomTag = node.bom
      ? `<span class="muted small">สูตร Rev. ${escapeHtml(node.bom.revision)} · ${docStatus(node.bom.status)}</span>`
      : "";
    const flags = [
      node.scrap_percent ? `<span class="muted small">เผื่อสูญเสีย ${q4(node.scrap_percent)}%</span>` : "",
      node.cycle ? '<span class="badge rejected">สูตรวน ไม่แตกต่อ</span>' : "",
      node.too_deep ? '<span class="badge rejected">ลึกเกินกำหนด ไม่แตกต่อ</span>' : "",
    ].join(" ");
    const row = `${node.item_type ? typeBadge(node.item_type) : ""} <strong>${escapeHtml(node.code)}</strong> <span class="fm-tree-name">${escapeHtml(node.name)}</span>
        <span class="fm-tree-qty"><strong data-tree-per="${escapeHtml(node.per)}">${treeQty(node.per, produce)}</strong> ${escapeHtml(node.unit_code)}</span> ${bomTag} ${flags}`;
    const steps = node.steps.map((step) => `<li class="fm-tree-step"><span class="fm-tree-row"><span aria-hidden="true">⚙</span>
        <strong>${escapeHtml(step.name)}</strong> <span class="muted small">${escapeHtml(step.work_center || "—")} · ตั้งเครื่อง ${minutes(step.setup_minutes)} · ผลิต ${minutes(step.run_minutes)}</span></span></li>`).join("");
    const children = node.children.map((child) => treeNodeHtml(child, produce)).join("");
    if (!steps && !children) return `<li class="fm-tree-node"><div class="fm-tree-row">${row}</div></li>`;
    return `<li class="fm-tree-node"><details open><summary class="fm-tree-row">${row}</summary>
        <ul class="fm-tree-list">${steps}${children}</ul></details></li>`;
  }

  function treeSectionHtml(data, bom, produce) {
    const tree = model.bomTree(data, bom.id);
    if (!tree) return "";
    return `<section class="card fm-tree-card" aria-labelledby="fm-tree-title">
        <div class="fm-detail-head"><h2 id="fm-tree-title">ต้นไม้โครงสร้าง (แตกสูตรทุกชั้น)</h2>
          <span class="fm-actions"><button class="btn secondary small" type="button" data-tree-toggle="open">ขยายทั้งหมด</button>
            <button class="btn secondary small" type="button" data-tree-toggle="close">ย่อทั้งหมด</button></span></div>
        <p class="muted small">${tree.nodes} รายการ · ลึก ${tree.depth} ชั้น · ปริมาณคำนวณตามจำนวนที่ต้องการผลิตด้านบน (รวมเผื่อสูญเสียทุกชั้น) ·
          แถวสีแดง ⚙ คือขั้นตอนการผลิตของชิ้นงานนั้นจาก Routing (ดูหน้า “ขั้นตอนการผลิต-ดู”) · ส่วนประกอบที่ไม่มีสูตรเป็นปลายกิ่ง</p>
        ${tree.unapproved ? notice("ต้นไม้นี้มีสูตรที่ยังไม่อนุมัติ (ร่าง/รออนุมัติ) ปนอยู่ ดูป้ายสถานะข้างแถว") : ""}
        <ul class="fm-tree" role="tree" aria-label="ต้นไม้โครงสร้างสินค้า">${treeNodeHtml(tree.root, produce)}</ul>
      </section>`;
  }

  function bomHtml(data, params) {
    const boms = data.boms ?? [];
    const banner = pendingBanner(data);
    if (!boms.length) {
      return `${banner}<section class="card"><div class="empty">ยังไม่มีโครงสร้างสินค้าในโหมดทดสอบ<br>
        <a class="btn secondary small" href="${escapeHtml(menu.url("structure-new"))}">สร้างโครงสร้างสินค้าใหม่</a>
        <a class="btn secondary small" href="${escapeHtml(menu.url("item-list"))}">หรือเติมข้อมูลตัวอย่างที่ทะเบียนสินค้า</a></div></section>`;
    }
    const bom = boms.find((row) => row.id === params.get("bom")) ?? boms[0];
    const fromUrl = Number(params.get("qty"));
    const produce = Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : Number(bom.output_qty);
    const lines = linesOf(data, bom.id);
    const timeline = model.bomTimeline(data.bom_history, bom.id);
    const decided = bom.decided_at || bom.decision_note;
    return `${banner}${statusNotice(data, bom)}
      <section class="card">
        <div class="field-row">
          <div class="field"><label for="fm-bom">เลือกสูตรการผลิต</label><select class="select" id="fm-bom">${options(boms.map((row) => [row.id, bomLabel(row)]), bom.id)}</select></div>
          <div class="field"><label for="fm-produce">ปริมาณที่ต้องการผลิต (${escapeHtml(bom.unit_code)})</label><input class="input" id="fm-produce" type="number" inputmode="decimal" min="0.001" step="any" value="${escapeHtml(produce)}"></div>
        </div>
        <div class="fm-detail-head"><h2>${escapeHtml(bom.name)}</h2><span>Revision ${escapeHtml(bom.revision)} · ${docStatus(bom.status)}${bom.status === "draft" && bom.decision_note ? ' <span class="badge rejected">ถูกส่งกลับ</span>' : ""}</span></div>
        <p class="muted small">สูตรตั้งต้นต่อ ${q4(bom.output_qty)} ${escapeHtml(bom.unit_code)} · มีผล ${formatDate(bom.effective_date)} · เผื่อสูญเสียเพิ่มจากปริมาณสุทธิ · ต้นไม้ด้านล่างแตกสูตรทุกชั้น ส่วนตารางสรุปท้ายหน้าแสดงเฉพาะชั้นแรก (WIP ไม่แตกสูตรต่อ)</p>
        ${bom.note ? `<p class="fm-pre">${escapeHtml(bom.note)}</p>` : ""}
        <dl class="definition-grid">
          <div class="definition"><dt>สร้างโดย</dt><dd>${person(bom.created_by_name, bom.created_at)}</dd></div>
          <div class="definition"><dt>ส่งขออนุมัติ</dt><dd>${person(bom.submitted_by_name, bom.submitted_at)}</dd></div>
          ${decided ? `<div class="definition"><dt>ผลการพิจารณา</dt><dd>${person(bom.decided_by_name, bom.decided_at)}${bom.decision_note ? `<br><span class="fm-pre">${escapeHtml(bom.decision_note)}</span>` : ""}</dd></div>` : ""}
        </dl>
        ${bomActionsHtml(data, bom)}
      </section>
      ${treeSectionHtml(data, bom, produce)}
      <section class="card fm-detail">
        <details class="fm-lines"${lines.length ? "" : " open"}>
          <summary><h3>ตารางสรุปส่วนประกอบระดับเดียว (ชุดเดียวกับชั้นแรกของต้นไม้)</h3></summary>
          <div class="table-wrap"><table>
            <thead><tr><th>ส่วนประกอบ</th><th>ปริมาณ / สูตร</th><th>เผื่อสูญเสีย</th><th class="right">ปริมาณรวมที่ต้องใช้</th></tr></thead>
            <tbody>${lines.length ? lines.map((line) => `<tr>
              <td><a href="${escapeHtml(menu.url("item-list", { id: line.component_id }))}"><strong>${escapeHtml(line.code)}</strong></a><br><span class="muted small">${escapeHtml(line.name)}</span></td>
              <td>${q4(line.quantity)} ${escapeHtml(line.unit_code)}</td>
              <td>${q4(line.scrap_percent)}%</td>
              <td class="right"><strong data-bom-line="${escapeHtml(line.id)}"></strong> ${escapeHtml(line.unit_code)}</td>
            </tr>`).join("") : '<tr><td colspan="4" class="muted">ยังไม่มีส่วนประกอบในฉบับร่างนี้</td></tr>'}</tbody></table></div>
        </details>
      </section>
      ${decisionPanelHtml(data, bom)}
      <section class="card fm-detail"><h3>ประวัติของฉบับนี้</h3>${historyTable(timeline)}</section>`;
  }

  function bindBom(root, data, params) {
    const select = root.querySelector("#fm-bom");
    const input = root.querySelector("#fm-produce");
    if (!select || !input) return;
    const bom = (data.boms ?? []).find((row) => row.id === select.value);
    const lines = linesOf(data, bom?.id);
    const recalc = () => {
      for (const line of lines) {
        const cell = root.querySelector(`[data-bom-line="${CSS.escape(line.id)}"]`);
        const need = model.bomRequirement(line.quantity, line.scrap_percent, input.value, bom.output_qty);
        if (cell) cell.textContent = need === null ? "—" : qty(need);
      }
    };
    const recalcTree = () => {
      const produce = Number(input.value);
      root.querySelectorAll("[data-tree-per]").forEach((cell) => {
        cell.textContent = Number.isFinite(produce) && produce > 0 ? treeQty(Number(cell.dataset.treePer), produce) : "—";
      });
    };
    input.addEventListener("input", () => { recalc(); recalcTree(); });
    root.querySelectorAll("[data-tree-toggle]").forEach((button) => button.addEventListener("click", () => {
      const open = button.dataset.treeToggle === "open";
      root.querySelectorAll(".fm-tree details").forEach((details) => { details.open = open; });
    }));
    select.addEventListener("change", () => { location.hash = menu.url(params.get("item"), { bom: select.value }).slice(1); });
    recalc();

    const args = { p_id: bom.id, p_version: bom.version };
    root.querySelector('[data-bom-action="submit"]')?.addEventListener("click", () => {
      runAction(root, "app_factory_submit_bom", args, `ส่ง ${bom.code} Rev. ${bom.revision} ให้ผู้ดูแลระบบอนุมัติแล้ว`);
    });
    root.querySelector('[data-bom-action="withdraw"]')?.addEventListener("click", () => {
      if (!confirm(`ถอน ${bom.code} Rev. ${bom.revision} กลับมาเป็นฉบับร่างเพื่อแก้ไข?`)) return;
      runAction(root, "app_factory_withdraw_bom", args, "ถอนกลับมาเป็นฉบับร่างแล้ว");
    });
    const note = root.querySelector("#fm-decision-note");
    root.querySelector("#fm-approve")?.addEventListener("click", () => {
      const current = approvedBomOf(data, bom.item_id);
      const replaced = current ? `\n\nRev. ${current.revision} ที่ใช้อยู่เดิมจะถูกเลิกใช้` : "";
      if (!confirm(`อนุมัติ ${bom.code} Rev. ${bom.revision}?${replaced}`)) return;
      runAction(root, "app_factory_decide_bom", { ...args, p_decision: "approve", p_note: note.value }, `อนุมัติ ${bom.code} Rev. ${bom.revision} แล้ว`);
    });
    root.querySelector("#fm-reject")?.addEventListener("click", () => {
      if (!note.value.trim()) {
        showToast(ERROR_MESSAGES.BOM_REJECT_NOTE_REQUIRED, "error");
        note.focus();
        return;
      }
      runAction(root, "app_factory_decide_bom", { ...args, p_decision: "reject", p_note: note.value }, `ส่ง ${bom.code} Rev. ${bom.revision} กลับให้แก้ไขแล้ว`);
    });
  }

  // ---------- ฟอร์มสร้าง/แก้ไขฉบับร่าง ----------
  const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

  const itemOption = (item) => [item.id, `${item.code} · ${item.name} (${item.unit_code})`];

  // ขั้นตอนหนึ่งขั้นของโครงสร้าง: ประเภท (RM/WIP/FG/PKG) กำหนดตอนเลือกจากเมนูคลิกขวา และกรองรายการส่วนประกอบให้ตรงประเภทนั้น
  // ลำดับบนจอ (บนสุด = ขั้นที่ 1) คือ line_no ที่ส่งเข้า RPC (unnest ... with ordinality จึงเรียงตามที่ส่ง)
  function lineRowHtml(line, index, components) {
    const component = components.find((item) => item.id === line.component_id);
    const type = line.type || component?.item_type || "";
    const choices = components.filter((item) => !type || item.item_type === type);
    const typeName = type ? label(model.ITEM_TYPES, type) : "ส่วนประกอบ";
    return `<li class="fm-node" data-bom-row data-type="${escapeHtml(type)}">
        <span class="fm-step-no" aria-hidden="true">${index + 1}</span>
        <div class="fm-node-body">
          <div class="fm-node-head">
            <strong>ขั้นตอนที่ ${index + 1}</strong>${type ? typeBadge(type) : ""}
            <span class="fm-node-tools">
              <button class="btn secondary small" type="button" data-add-after="${index}" aria-haspopup="menu" aria-label="เพิ่มขั้นตอนต่อจากขั้นตอนที่ ${index + 1}">➕ เพิ่มต่อ</button>
              <button class="btn danger small" type="button" data-remove-line aria-label="ลบขั้นตอนที่ ${index + 1}">ลบ</button>
            </span>
          </div>
          <div class="fm-node-fields">
            <div class="field fm-node-component"><label for="fm-line-c-${index}">${escapeHtml(typeName)}</label>
              <select class="select" id="fm-line-c-${index}" data-field="component_id"><option value="">— เลือก${escapeHtml(typeName)} —</option>${options(choices.map(itemOption), line.component_id)}</select></div>
            <div class="field"><label for="fm-line-q-${index}">ปริมาณ</label>
              <input class="input" id="fm-line-q-${index}" data-field="quantity" type="number" inputmode="decimal" min="0.0001" max="1000000000" step="any" value="${escapeHtml(line.quantity ?? "")}"></div>
            <div class="field"><label>หน่วย</label><span class="fm-node-unit" data-unit>${escapeHtml(component?.unit_code ?? "—")}</span></div>
            <div class="field"><label for="fm-line-s-${index}">เผื่อสูญเสีย (%)</label>
              <input class="input" id="fm-line-s-${index}" data-field="scrap_percent" type="number" inputmode="decimal" min="0" max="99.99" step="any" value="${escapeHtml(line.scrap_percent ?? 0)}"></div>
          </div>
        </div>
      </li>`;
  }

  // เมนูเลือกประเภทของขั้นตอนถัดไป (คลิกขวา หรือกดปุ่ม ➕ สำหรับจอสัมผัส/คีย์บอร์ด) — วางในกรอบเดียวกับโครงสร้างตามกฎ data-popup ของ app.js
  const typeMenuHtml = () => `<div class="fm-struct-menu" id="fm-struct-menu" role="menu" aria-label="เลือกประเภทของขั้นตอนถัดไป" data-popup hidden>
      <div class="fm-struct-menu-title" id="fm-struct-menu-title"></div>
      ${Object.entries(model.ITEM_TYPES).map(([type, name]) => `<button class="fm-struct-menu-item" type="button" role="menuitem" data-menu-type="${escapeHtml(type)}"><span class="badge fm-type fm-type-${escapeHtml(type)}">${escapeHtml(type)}</span><span>${escapeHtml(name)}</span></button>`).join("")}
    </div>`;

  function formHtml(data, ctx) {
    const { existing, parentId, lines, copiedFrom } = ctx;
    const editing = Boolean(existing);
    const choices = model.bomParentChoices(data.items, data.boms);
    const parentItems = editing
      ? (data.items ?? []).filter((item) => item.id === existing.item_id)
      : choices.available;
    const parent = (data.items ?? []).find((item) => item.id === parentId);
    const blocked = editing ? [] : choices.blocked;
    const components = model.componentChoices(data.items, parentId);
    const emptyParents = !editing && parentItems.length === 0;
    return `${pendingBanner(data)}
      ${copiedFrom ? notice(`คัดลอกส่วนประกอบจาก Rev. ${copiedFrom.revision} ของ ${copiedFrom.code} แล้ว ตรวจและแก้ไขก่อนบันทึก (ระบบกำหนด Revision ใหม่ให้เมื่อบันทึก)`) : ""}
      ${editing && existing.decision_note ? notice(`ผู้อนุมัติส่งกลับพร้อมเหตุผล: “${existing.decision_note}”`) : ""}
      <section class="card">
        ${emptyParents ? `<div class="empty">ไม่มีสินค้าหลักที่สร้างโครงสร้างใหม่ได้<br><small>ต้องเป็น Item ที่ใช้งานอยู่ ประเภทงานระหว่างผลิตหรือสินค้าสำเร็จรูป วิธีจัดหา “ผลิตเอง” หรือ “ซื้อ / ผลิต” และยังไม่มีฉบับร่าง/รออนุมัติ</small><br>
          <a class="btn secondary small" href="${escapeHtml(menu.url("item-new"))}">➕ เพิ่ม Item ใหม่</a></div>` : `
        <form class="fm-form" id="fm-bom-form" novalidate>
          <p class="muted small">ช่องที่มี * จำเป็นต้องกรอก · บันทึกเป็นฉบับร่างก่อน แล้วส่งให้ผู้ดูแลระบบอนุมัติ ฉบับร่างยังไม่ใช้ผลิตจริง</p>
          <div class="fm-form-error" id="fm-form-error" role="alert" hidden></div>
          <div class="field-row">
            <div class="field"><label for="fm-bom-item">สินค้าหลัก *</label>
              <select class="select" id="fm-bom-item" name="item_id" required${editing ? " disabled" : ""}>${editing ? "" : '<option value="">— เลือกสินค้าหลัก —</option>'}${options(parentItems.map(itemOption), parentId ?? "")}</select>
              <small id="fm-bom-item-hint"></small></div>
            <div class="field"><label for="fm-bom-output">ผลผลิตต่อสูตร * (<span id="fm-bom-output-unit">${escapeHtml(parent?.unit_code ?? "หน่วยของสินค้าหลัก")}</span>)</label>
              <input class="input" id="fm-bom-output" name="output_qty" type="number" inputmode="decimal" required min="0.0001" max="1000000000" step="any" value="${escapeHtml(ctx.outputQty)}">
              <small>จำนวนที่สูตรนี้ผลิตได้หนึ่งชุด (ปริมาณส่วนประกอบด้านล่างคือปริมาณต่อผลผลิตนี้)</small></div>
            <div class="field"><label for="fm-bom-date">วันที่เริ่มมีผล *</label>
              <input class="input" id="fm-bom-date" name="effective_date" type="date" required min="2000-01-01" max="2100-12-31" value="${escapeHtml(ctx.effectiveDate)}"></div>
            <div class="field"><label for="fm-bom-note">หมายเหตุ</label>
              <textarea class="textarea" id="fm-bom-note" name="note" rows="2" maxlength="1000">${escapeHtml(ctx.note)}</textarea></div>
          </div>
          <h3>โครงสร้างส่วนประกอบ</h3>
          <p class="muted small">เรียงจากบนลงล่าง ขั้นตอนที่ 1 อยู่บนสุด · <strong>คลิกขวา</strong>ที่สินค้าหลักหรือขั้นตอนใดๆ เพื่อเลือกประเภท (RM / WIP / FG / PKG) ของขั้นตอนถัดไป · บนมือถือหรือคีย์บอร์ดใช้ปุ่ม “➕ เพิ่มต่อ”</p>
          <div class="fm-struct" id="fm-struct">
            <div class="fm-node fm-node-root" data-struct-root tabindex="0">
              <span class="fm-step-no fm-root-mark" aria-hidden="true">★</span>
              <div class="fm-node-body">
                <div class="fm-node-head"><strong id="fm-root-title">${parent ? escapeHtml(`${parent.code} · ${parent.name}`) : "เลือกสินค้าหลักด้านบนก่อน"}</strong><span class="muted small">สินค้าหลัก</span>
                  <span class="fm-node-tools"><button class="btn secondary small" type="button" data-add-after="-1" aria-haspopup="menu">➕ เพิ่มขั้นตอนที่ 1</button></span></div>
              </div>
            </div>
            <ol class="fm-struct-list" id="fm-bom-lines">${lines.map((line, index) => lineRowHtml(line, index, components)).join("")}</ol>
            <p class="fm-struct-empty muted small" id="fm-struct-empty"${lines.length ? " hidden" : ""}>ยังไม่มีขั้นตอน — คลิกขวาที่สินค้าหลักหรือกดปุ่ม ➕ เพื่อเลือกประเภทของขั้นตอนที่ 1</p>
            ${typeMenuHtml()}
          </div>
          <div class="fm-actions"><button class="btn secondary small" type="button" id="fm-add-line" aria-haspopup="menu">➕ เพิ่มขั้นตอนถัดไป</button></div>
          <p class="muted small">ปริมาณของแต่ละขั้นตอนเป็นหน่วยนับฐานของส่วนประกอบนั้น (ระบบไม่แปลงหน่วยในสูตร) · เผื่อสูญเสียเป็นแบบบวกเพิ่มจากปริมาณสุทธิ · ห้ามเลือกสินค้าหลักเป็นส่วนประกอบ ห้ามซ้ำ และห้ามสูตรวนซ้ำกับสูตรอื่น (ระบบตรวจตอนบันทึก)</p>
          <div class="fm-actions">
            <button class="btn secondary" type="submit" data-intent="draft">บันทึกฉบับร่าง</button>
            <button class="btn" type="submit" data-intent="submit">บันทึกและส่งขออนุมัติ</button>
            <a class="btn secondary" href="${escapeHtml(editing ? viewUrl(existing.id) : menu.url("structure-view"))}">ยกเลิก</a>
          </div>
        </form>`}
        ${blocked.length ? `<div class="fm-detail"><h3>Item ที่มีฉบับร่าง/รออนุมัติอยู่แล้ว</h3><p class="muted small">แต่ละ Item มีฉบับที่เปิดอยู่ได้ครั้งละ 1 ฉบับ — เปิดฉบับนั้นเพื่อแก้ไขหรือรอผลอนุมัติ</p>
          <div class="fm-actions">${blocked.map(({ item, bom }) => `<a class="btn secondary small" href="${escapeHtml(viewUrl(bom.id))}">${escapeHtml(item.code)} · Rev. ${escapeHtml(bom.revision)} (${escapeHtml(label(model.DOCUMENT_STATUSES, bom.status))})</a>`).join("")}</div></div>` : ""}
      </section>`;
  }

  // บรรทัดในฟอร์มตอนนี้ (อ่านจาก DOM) — ใช้ก่อนวาดบรรทัดใหม่และตอนบันทึก
  const readLines = (root) => [...root.querySelectorAll("[data-bom-row]")].map((row) => ({
    type: row.dataset.type,
    component_id: row.querySelector('[data-field="component_id"]').value,
    quantity: row.querySelector('[data-field="quantity"]').value,
    scrap_percent: row.querySelector('[data-field="scrap_percent"]').value,
  }));

  function bindForm(root, data, ctx) {
    const form = root.querySelector("#fm-bom-form");
    if (!form) return;
    const errorBox = root.querySelector("#fm-form-error");
    const parentSelect = form.querySelector("#fm-bom-item");
    const body = form.querySelector("#fm-bom-lines");
    const editing = Boolean(ctx.existing);
    let parentId = ctx.parentId ?? "";
    let intent = "draft";

    const showErrors = (messages) => {
      errorBox.replaceChildren(...messages.map((message) => Object.assign(document.createElement("div"), { textContent: message })));
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: "nearest" });
    };
    const syncParent = () => {
      const item = (data.items ?? []).find((row) => row.id === parentId);
      form.querySelector("#fm-bom-output-unit").textContent = item?.unit_code ?? "หน่วยของสินค้าหลัก";
      form.querySelector("#fm-root-title").textContent = item ? `${item.code} · ${item.name}` : "เลือกสินค้าหลักด้านบนก่อน";
      const approved = parentId ? approvedBomOf(data, parentId) : null;
      form.querySelector("#fm-bom-item-hint").textContent = approved && !editing
        ? `Item นี้มีโครงสร้างที่อนุมัติแล้ว (Rev. ${approved.revision}) การอนุมัติฉบับใหม่จะเลิกใช้ Rev. ${approved.revision}`
        : approved ? `ฉบับที่อนุมัติอยู่เดิม: Rev. ${approved.revision} (จะเลิกใช้เมื่อฉบับนี้ได้รับอนุมัติ)` : "";
    };
    // วาดบรรทัดใหม่ (เพิ่ม/ลบ/เปลี่ยนสินค้าหลัก) โดยเก็บค่าที่กรอกไว้ ส่วนประกอบที่กลายเป็นสินค้าหลักถูกล้างออก
    const redrawLines = (lines) => {
      const components = model.componentChoices(data.items, parentId);
      const safe = lines.map((line) => (line.component_id === parentId ? { ...line, component_id: "" } : line));
      body.innerHTML = safe.map((line, index) => lineRowHtml(line, index, components)).join("");
      syncEmpty();
    };

    parentSelect.addEventListener("change", () => {
      const lines = readLines(root);
      parentId = parentSelect.value;
      syncParent();
      redrawLines(lines);
    });
    // เมนูเลือกประเภท: เปิดจากคลิกขวา/ปุ่ม ➕ แล้วแทรกขั้นตอนใหม่ต่อจากขั้นตอนที่เลือก (afterIndex -1 = ขั้นตอนที่ 1)
    const struct = form.querySelector("#fm-struct");
    const typeMenu = form.querySelector("#fm-struct-menu");
    const emptyHint = form.querySelector("#fm-struct-empty");
    let menuAfter = -1;
    let menuReturn = null;
    const menuItems = () => [...typeMenu.querySelectorAll("[data-menu-type]")];
    const syncEmpty = () => { emptyHint.hidden = body.children.length > 0; };
    const closeMenu = ({ restoreFocus = false } = {}) => {
      if (typeMenu.hidden) return;
      closePopup(typeMenu);
      if (restoreFocus) menuReturn?.focus();
    };
    const openMenu = (afterIndex, x, y, returnTo) => {
      const count = body.children.length;
      menuAfter = Math.min(Math.max(afterIndex, -1), count - 1);
      menuReturn = returnTo ?? null;
      typeMenu.querySelector("#fm-struct-menu-title").textContent = menuAfter < 0
        ? "เพิ่มเป็นขั้นตอนที่ 1 (ประเภท)"
        : `เพิ่มเป็นขั้นตอนที่ ${menuAfter + 2} ต่อจากขั้นตอนที่ ${menuAfter + 1} (ประเภท)`;
      typeMenu.hidden = false;
      const box = struct.getBoundingClientRect();
      const left = Math.max(4, Math.min(x - box.left, box.width - typeMenu.offsetWidth - 4));
      typeMenu.style.left = `${left}px`;
      typeMenu.style.top = `${Math.max(0, y - box.top)}px`;
      menuItems()[0]?.focus();
    };
    const openFromElement = (element, afterIndex) => {
      const rect = element.getBoundingClientRect();
      openMenu(afterIndex, rect.left, rect.bottom + 4, element);
    };
    // data-add-after = ปุ่ม ➕ ของแต่ละขั้นตอน/สินค้าหลัก · #fm-add-line = ต่อท้ายสุด (ใช้แทนคลิกขวาบนจอสัมผัส)
    struct.addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-after]");
      if (button) openFromElement(button, Number(button.dataset.addAfter));
    });
    form.querySelector("#fm-add-line").addEventListener("click", (event) => openFromElement(event.currentTarget, body.children.length - 1));
    struct.addEventListener("contextmenu", (event) => {
      // ช่องกรอก/รายการเลือกคงเมนูของเบราว์เซอร์ (คัดลอก/วาง) คลิกขวาที่อื่นของโครงสร้างจึงเลือกประเภทได้
      if (event.target.closest("input, select, textarea, .fm-struct-menu")) return;
      const node = event.target.closest("[data-bom-row], [data-struct-root]");
      event.preventDefault();
      const rows = [...body.children];
      const afterIndex = node?.hasAttribute("data-struct-root") ? -1 : node ? rows.indexOf(node) : rows.length - 1;
      // คีย์เมนู (Shift+F10) ส่งพิกัด 0,0 จึงใช้ตำแหน่งของ node แทน
      if (event.clientX === 0 && event.clientY === 0 && node) return openFromElement(node, afterIndex);
      openMenu(afterIndex, event.clientX, event.clientY, node?.querySelector("[data-add-after]") ?? null);
    });
    // กรอบเดียวกับเมนูจึงไม่ถูกกฎ closePopup ของ app.js ปิดให้ ปิดเองเมื่อแตะ/คลิกนอกเมนูหรือกด Esc/Tab (ไม่ปิดด้วย blur)
    struct.addEventListener("pointerdown", (event) => { if (!typeMenu.contains(event.target)) closeMenu(); });
    typeMenu.addEventListener("keydown", (event) => {
      const items = menuItems();
      const at = items.indexOf(document.activeElement);
      if (event.key === "Escape") { event.preventDefault(); closeMenu({ restoreFocus: true }); }
      else if (event.key === "Tab") closeMenu();
      else if (event.key === "ArrowDown") { event.preventDefault(); items[(at + 1) % items.length].focus(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
      else if (event.key === "Home") { event.preventDefault(); items[0].focus(); }
      else if (event.key === "End") { event.preventDefault(); items[items.length - 1].focus(); }
    });
    typeMenu.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-menu-type]");
      if (!choice) return;
      const lines = readLines(root);
      closeMenu();
      if (lines.length >= model.BOM_MAX_LINES) return showErrors([`ส่วนประกอบมีได้ไม่เกิน ${model.BOM_MAX_LINES} ขั้นตอน`]);
      lines.splice(menuAfter + 1, 0, { type: choice.dataset.menuType, component_id: "", quantity: "", scrap_percent: 0 });
      redrawLines(lines);
      body.children[menuAfter + 1]?.querySelector("select")?.focus();
    });
    body.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-line]");
      if (!button) return;
      const rows = [...body.querySelectorAll("[data-bom-row]")];
      const remove = rows.indexOf(button.closest("[data-bom-row]"));
      redrawLines(readLines(root).filter((_, index) => index !== remove));
    });
    body.addEventListener("change", (event) => {
      if (event.target.dataset.field !== "component_id") return;
      const component = (data.items ?? []).find((item) => item.id === event.target.value);
      event.target.closest("[data-bom-row]").querySelector("[data-unit]").textContent = component?.unit_code ?? "—";
    });
    form.querySelectorAll("[data-intent]").forEach((button) => button.addEventListener("click", () => { intent = button.dataset.intent; }));
    syncParent();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const values = Object.fromEntries(new FormData(form).entries());
      values.item_id = parentSelect.value;
      values.lines = readLines(root);
      const payload = model.bomPayload(values, ctx.existing);
      const problems = model.validateBomPayload(payload, data.items, { requireLines: intent === "submit" });
      if (problems.length) return showErrors(problems);
      setFormBusy(form, true);
      try {
        const { data: saved, error } = await sb.rpc("app_factory_save_bom_draft", payload);
        if (error) throw error;
        if (intent === "submit") {
          // บันทึกและส่งเป็นสองขั้นที่ฐานข้อมูล (แต่ละขั้นทำงานเต็มธุรกรรมและตรวจ version) ถ้าขั้นส่งไม่สำเร็จ ฉบับร่างที่บันทึกแล้วยังอยู่
          const { error: submitError } = await sb.rpc("app_factory_submit_bom", { p_id: saved.id, p_version: saved.version });
          if (submitError) {
            showToast(`บันทึกฉบับร่างแล้ว แต่ส่งขออนุมัติไม่สำเร็จ: ${friendlyError(submitError)}`, "error");
            location.hash = viewUrl(saved.id).slice(1);
            return;
          }
          showToast(`ส่ง ${saved.code} Rev. ${saved.revision} ให้ผู้ดูแลระบบอนุมัติแล้ว`);
        } else {
          showToast(`บันทึกฉบับร่าง ${saved.code} Rev. ${saved.revision} แล้ว`);
        }
        location.hash = viewUrl(saved.id).slice(1);
      } catch (error) {
        setFormBusy(form, false);
        if (editing) parentSelect.disabled = true;
        showErrors([friendlyError(error)]);
      }
    });
  }

  // ค่าเริ่มต้นของฟอร์ม: แก้ฉบับร่าง (bom) · คัดลอกจากฉบับอื่น (from) · ว่าง
  function formContext(data, params) {
    const blank = { existing: null, parentId: "", outputQty: 1, effectiveDate: todayIso(), note: "", lines: [], copiedFrom: null };
    const toLines = (bomId, items) => {
      const itemById = new Map((items ?? []).map((item) => [item.id, item]));
      const active = new Set((items ?? []).filter((item) => item.status === "active").map((item) => item.id));
      return linesOf(data, bomId).filter((line) => active.has(line.component_id))
        .map((line) => ({ type: itemById.get(line.component_id)?.item_type ?? "", component_id: line.component_id, quantity: line.quantity, scrap_percent: line.scrap_percent }));
    };
    const editId = params.get("bom");
    if (editId) {
      const existing = (data.boms ?? []).find((bom) => bom.id === editId);
      if (!existing) return { missing: true };
      if (existing.status !== "draft") return { notDraft: existing };
      return { ...blank, existing, parentId: existing.item_id, outputQty: existing.output_qty, effectiveDate: existing.effective_date, note: existing.note, lines: toLines(existing.id, data.items) };
    }
    const fromId = params.get("from");
    if (fromId) {
      const source = (data.boms ?? []).find((bom) => bom.id === fromId);
      if (!source) return { missing: true };
      const open = openBomOf(data, source.item_id);
      if (open) return { blockedBy: open };
      const lines = toLines(source.id, data.items);
      return { ...blank, parentId: source.item_id, outputQty: source.output_qty, note: "", lines, copiedFrom: source };
    }
    return blank;
  }

  // ---------- รายการฉบับร่าง (โครงสร้างสินค้า-แก้ไข) ----------
  function draftsHtml(data) {
    const drafts = model.draftBoms(data.boms);
    const create = `<a class="btn" href="${escapeHtml(menu.url("structure-new"))}">➕ สร้างโครงสร้างสินค้าใหม่</a>`;
    if (!drafts.length) {
      return `${pendingBanner(data)}<section class="card"><div class="empty">ไม่มีฉบับร่างที่รอแก้ไข<br><small>ฉบับที่รออนุมัติแก้ไม่ได้ (ถอนกลับมาเป็นฉบับร่างได้ที่หน้าดู) · ฉบับที่อนุมัติแล้วออก Revision ใหม่ได้จากหน้าดู</small>
        <div class="fm-actions">${create}</div></div></section>`;
    }
    return `${pendingBanner(data)}
      <section class="card">
        <p class="muted small">ฉบับร่างที่แก้ไขได้ ${drafts.length} รายการ · ฉบับที่ผู้อนุมัติส่งกลับจะอยู่ก่อนพร้อมเหตุผล</p>
        <div class="table-wrap"><table>
          <thead><tr><th>สินค้าหลัก</th><th>Revision</th><th>ผลผลิตต่อสูตร</th><th>ส่วนประกอบ</th><th>แก้ไขล่าสุด</th><th class="right">จัดการ</th></tr></thead>
          <tbody>${drafts.map((bom) => `<tr>
            <td><a class="fm-item-link" href="${escapeHtml(viewUrl(bom.id))}"><strong>${escapeHtml(bom.code)}</strong><span>${escapeHtml(bom.name)}</span></a>
              ${bom.decision_note ? `<span class="badge rejected">ถูกส่งกลับ</span> <span class="muted small">${escapeHtml(bom.decision_note)}</span>` : ""}</td>
            <td>Rev. ${escapeHtml(bom.revision)}</td>
            <td>${q4(bom.output_qty)} ${escapeHtml(bom.unit_code)}</td>
            <td>${linesOf(data, bom.id).length} บรรทัด</td>
            <td>${formatDate(bom.updated_at, true)}</td>
            <td class="right"><a class="btn secondary small" href="${escapeHtml(editUrl(bom.id))}" aria-label="แก้ไข ${escapeHtml(bom.code)} Rev. ${escapeHtml(bom.revision)}">แก้ไข</a></td>
          </tr>`).join("")}</tbody></table></div>
        <div class="fm-actions">${create}</div>
      </section>`;
  }

  // ---------- คิวรออนุมัติ (โครงสร้างสินค้า-อนุมัติ) ----------
  function approvalsHtml(data) {
    const pending = model.pendingBoms(data.boms);
    const counts = model.countBomsByStatus(data.boms);
    const decisions = (data.bom_history ?? []).filter((entry) => ["approve", "reject", "obsolete"].includes(entry.action)).slice(0, 15);
    const rows = pending.map((bom) => `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(viewUrl(bom.id))}"><strong>${escapeHtml(bom.code)}</strong><span>${escapeHtml(bom.name)}</span></a></td>
        <td>Rev. ${escapeHtml(bom.revision)}</td>
        <td>${q4(bom.output_qty)} ${escapeHtml(bom.unit_code)}</td>
        <td>${linesOf(data, bom.id).length} บรรทัด</td>
        <td>${person(bom.submitted_by_name, bom.submitted_at)}</td>
        <td class="right"><a class="btn small" href="${escapeHtml(viewUrl(bom.id))}" aria-label="ตรวจและตัดสิน ${escapeHtml(bom.code)} Rev. ${escapeHtml(bom.revision)}">ตรวจและตัดสิน</a></td>
      </tr>`).join("");
    return `<div class="summary-grid fm-summary">
        <div class="summary"><span>รออนุมัติ</span><strong>${counts.pending_approval}</strong><small>รอผู้ดูแลระบบพิจารณา</small></div>
        <div class="summary"><span>ฉบับร่าง</span><strong>${counts.draft}</strong><small><a href="${escapeHtml(menu.url("structure-edit"))}">ดูฉบับที่แก้ไขได้ →</a></small></div>
        <div class="summary"><span>อนุมัติแล้ว</span><strong>${counts.approved}</strong><small>ฉบับที่ใช้อยู่</small></div>
        <div class="summary"><span>เลิกใช้</span><strong>${counts.obsolete}</strong><small>ถูกแทนที่ด้วย Revision ใหม่</small></div>
      </div>
      ${notice("โหมดทดสอบไม่ส่งแจ้งเตือน (อีเมล/LINE) ผู้ส่งขออนุมัติและผู้อนุมัติเห็นรายการจากหน้านี้ ผู้ตัดสินคือผู้ดูแลระบบตัวจริงที่อยู่เบื้องหลังบัญชีทดสอบ")}
      <section class="card">
        <h2>รออนุมัติ</h2>
        ${pending.length ? `<div class="table-wrap"><table>
          <thead><tr><th>สินค้าหลัก</th><th>Revision</th><th>ผลผลิตต่อสูตร</th><th>ส่วนประกอบ</th><th>ส่งโดย</th><th class="right">จัดการ</th></tr></thead>
          <tbody>${rows}</tbody></table></div>` : '<div class="empty">ไม่มีโครงสร้างสินค้ารออนุมัติ</div>'}
      </section>
      <section class="card">
        <h2>ผลการพิจารณาล่าสุด</h2>
        ${decisions.length ? `<div class="table-wrap"><table>
          <thead><tr><th>เวลา</th><th>สินค้าหลัก</th><th>การพิจารณา</th><th>ผู้ทำรายการ</th><th>หมายเหตุ / เหตุผล</th></tr></thead>
          <tbody>${decisions.map((entry) => `<tr>
            <td>${formatDate(entry.created_at, true)}</td>
            <td><a href="${escapeHtml(viewUrl(entry.bom_id))}"><strong>${escapeHtml(entry.code)}</strong></a> Rev. ${escapeHtml(entry.revision)}</td>
            <td>${escapeHtml(label(model.BOM_HISTORY_ACTIONS, entry.action))}</td>
            <td>${escapeHtml(entry.changed_by_name ?? "—")}</td>
            <td class="fm-pre">${escapeHtml(entry.note || "—")}</td>
          </tr>`).join("")}</tbody></table></div>` : '<div class="empty">ยังไม่มีผลการพิจารณา</div>'}
      </section>`;
  }

  const messageCard = (text, href, linkLabel) => `<section class="card"><div class="empty">${escapeHtml(text)}<br>
      <a class="btn secondary small" href="${escapeHtml(href)}">${escapeHtml(linkLabel)}</a></div></section>`;

  const VIEWS = {
    async bom({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const root = frame.paint({ body: bomHtml(data, params) });
      bindBom(root, data, params);
    },
    async "bom-new"({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const ctx = formContext(data, params);
      const back = { href: menu.url("structure-view"), label: "‹ กลับโครงสร้างสินค้า" };
      if (ctx.missing) return frame.paint({ back, body: messageCard(ERROR_MESSAGES.BOM_NOT_FOUND, menu.url("structure-view"), "ไปที่ โครงสร้างสินค้า-ดู") });
      if (ctx.notDraft) {
        return frame.paint({ back, body: messageCard(`${ctx.notDraft.code} Rev. ${ctx.notDraft.revision} อยู่ในสถานะ “${label(model.DOCUMENT_STATUSES, ctx.notDraft.status)}” แก้ไขได้เฉพาะฉบับร่าง`, viewUrl(ctx.notDraft.id), "เปิดดูฉบับนี้") });
      }
      if (ctx.blockedBy) {
        return frame.paint({ back, body: messageCard(`${ctx.blockedBy.code} มีฉบับ Rev. ${ctx.blockedBy.revision} (${label(model.DOCUMENT_STATUSES, ctx.blockedBy.status)}) อยู่แล้ว สร้างฉบับใหม่ซ้อนไม่ได้`, viewUrl(ctx.blockedBy.id), "เปิดดูฉบับนั้น") });
      }
      const root = frame.paint({
        back: ctx.existing ? { href: viewUrl(ctx.existing.id), label: "‹ กลับรายละเอียด" } : back,
        subtitle: ctx.existing ? `แก้ไข ${ctx.existing.code} Rev. ${ctx.existing.revision}` : null,
        body: formHtml(data, ctx),
      });
      bindForm(root, data, ctx);
    },
    async "bom-drafts"({ frame }) {
      frame.loading();
      const data = await loadData();
      frame.paint({ body: draftsHtml(data) });
    },
    async "bom-approvals"({ frame }) {
      frame.loading();
      const data = await loadData();
      frame.paint({ body: approvalsHtml(data) });
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
