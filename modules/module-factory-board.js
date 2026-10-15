// หน้าภาพรวมการผลิตของฝ่ายโรงงาน (#/factory) โหมดทดสอบ — ดูทั้ง workflow ในหน้าเดียว อ่านอย่างเดียว
//
// view "overview" (module-factory.js เรียกแทนหน้ารวมเดิมที่เป็นแค่ปุ่มแผนก): ตัวเลขสรุป · ใบสั่งผลิตแยกตามขั้น (กดกรองรายการ) ·
// งานที่รอลงมือ (แสดงเฉพาะแผนกที่มีงาน แผนกที่ว่างพับไว้) · Item ที่ต่ำกว่าขั้นต่ำ · ความเคลื่อนไหวล่าสุด 6 รายการ
// view "search" (#/factory?q=): ผลค้นหารวม หน้าในเมนู Item และเอกสารทุกชนิด จาก model.search
// ตัวเลขบนปุ่มแผนกคือใบงานที่ถึงคิวของแผนก (ฝ่ายวางแผน = ใบสั่งผลิตที่รอดำเนินการ) ทุกตัวเลขคำนวณจากข้อมูลชุดเดียวกับหน้าอื่น
// (app_factory_master_data) ในหน้าเว็บ ตรรกะที่ทดสอบได้อยู่ที่ modules/factory-board-model.js ไม่มีการเขียนข้อมูลและไม่ใช่การควบคุมสิทธิ์
//
// โหลดหลัง modules/module-factory-job.js และก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (escapeHtml, formatDate) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerFactoryBoardView() {
  const model = window.MNP_FACTORY_BOARD_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const factory = window.MNP_FACTORY;
  const { loadData, qty, notice, fold } = window.MNP_FACTORY_UI;

  const href = (link) => (link.dept ? (factory.find(link.dept) ? factory.url(link.dept) : menu.url("job-queue")) : menu.url(link.item, link.params ?? {}));
  const tile = (title, value, hint) => `<div class="summary"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong><small>${hint}</small></div>`;

  function boardHtml(data) {
    const stats = model.stats(data);
    const pipeline = model.pipeline(data.production);
    const groups = model.attention(data);
    const alerts = model.stockAlerts(data.items);
    const recent = model.recentActivity(data, 6);
    const pipelineChips = pipeline.map((step) => `<li><a class="fm-pipe${step.count ? " has-count" : ""}" href="${escapeHtml(menu.url("production-view", { status: step.status }))}">${escapeHtml(step.label)} (${step.count})</a></li>`).join("");
    const attentionRow = (group) => `<tr>
        <td><strong>${escapeHtml(group.title)}</strong></td>
        <td>${group.items.map((row) => `<a class="fm-board-chip${row.count ? " has-work" : ""}" href="${escapeHtml(href(row.link))}">${escapeHtml(row.label)} <strong>${row.count}</strong></a>`).join(" ")}</td>
        <td class="right">${group.total ? `<span class="badge pending_approval">${group.total} รอลงมือ</span>` : '<span class="muted small">ไม่มีงานค้าง</span>'}</td>
      </tr>`;
    const busy = groups.filter((group) => group.total);
    const idle = groups.filter((group) => !group.total);
    const attentionTable = (rows) => `<div class="table-wrap"><table class="fm-table"><thead><tr><th>แผนก / ขั้น</th><th>งาน</th><th class="right">สรุป</th></tr></thead><tbody>${rows.map(attentionRow).join("")}</tbody></table></div>`;
    const alertRows = alerts.map((row) => `<tr><td><a href="${escapeHtml(menu.url("item-list", { id: row.item_id }))}"><strong>${escapeHtml(row.code)}</strong></a> <span class="muted small">${escapeHtml(row.name)}</span></td>
        <td class="right fm-short" data-label="คงเหลือ">${qty(row.stock)} ${escapeHtml(row.unit_code)}</td><td class="right" data-label="ขั้นต่ำ">${qty(row.min_stock)}</td></tr>`).join("");
    const activityRows = recent.map((row) => `<li><span class="fm-feed-time">${formatDate(row.at, true)}</span>
        <span>${escapeHtml(row.kind)} <a href="${escapeHtml(menu.url(row.link.item, row.link.params))}"><strong>${escapeHtml(row.code)}</strong></a> · ${escapeHtml(row.label)}</span>
        <span class="muted small">${escapeHtml(row.by ?? "—")}</span></li>`).join("");
    return `<div class="summary-grid fm-summary">
        ${tile("ใบสั่งผลิตทั้งหมด", stats.ordersTotal, `ผลิตอยู่ ${stats.ordersRunning} · เสร็จแล้ว ${stats.ordersCompleted}`)}
        ${tile("ใบงานผลิตที่ยังไม่จบ", stats.jobsRunning, `เสร็จแล้ว ${stats.jobsCompleted} ใบ`)}
        ${tile("ใบสั่งวัตถุดิบรอดำเนินการ", stats.materialWaiting, "ฉบับร่างและสั่งแล้วรอรับของ")}
        ${tile("ต่ำกว่าสต็อกขั้นต่ำ", stats.lowStock, `<a href="${escapeHtml(menu.url("inventory-view", { status: "low" }))}">ดูสินค้าคงคลัง →</a>`)}
      </div>
      <section class="card"><h2>ใบสั่งผลิตตามขั้น</h2>
        <nav aria-label="ใบสั่งผลิตตามสถานะ"><ol class="fm-pipeline">${pipelineChips}</ol></nav></section>
      <section class="card"><h2>งานที่รอลงมือ</h2>
        <p class="muted small">กดตัวเลขเพื่อไปทำงานนั้น (สลับ “ทำหน้าที่เป็น” เป็นพนักงานแผนกนั้นก่อน)</p>
        ${busy.length ? attentionTable(busy) : '<p class="muted small">ทุกแผนกไม่มีงานค้าง</p>'}
        ${idle.length ? `<div class="fm-fold-group">${fold(`แผนกที่ไม่มีงานค้าง <span class="fm-count">${idle.length}</span>`, attentionTable(idle))}</div>` : ""}</section>
      <div class="fm-split">
        <section class="card"><h2>ต่ำกว่าสต็อกขั้นต่ำ</h2>
          ${alertRows ? `<div class="table-wrap"><table class="fm-table"><thead><tr><th>Item</th><th class="right">คงเหลือทุกคลัง</th><th class="right">ขั้นต่ำ</th></tr></thead><tbody>${alertRows}</tbody></table></div>` : '<p class="muted small">ไม่มี Item ที่ต่ำกว่าขั้นต่ำ</p>'}</section>
        <section class="card"><h2>ความเคลื่อนไหวล่าสุด</h2>
          ${activityRows ? `<ul class="fm-feed">${activityRows}</ul>`
            : notice("ยังไม่มีความเคลื่อนไหว — เติมชุดทดลองที่หน้าจัดการข้อมูลทดสอบ แล้วเริ่มจากฝ่ายขายออกใบสั่งผลิต")}</section>
      </div>`;
  }

  // ---------- ค้นหารวม (#/factory?q=) ----------
  const STATUS_SOURCES = {
    production: () => [window.MNP_FACTORY_PRODUCTION_MODEL?.ORDER_STATUSES, window.MNP_FACTORY_PRODUCTION_MODEL?.BADGE_CLASS],
    material: () => [window.MNP_FACTORY_MATERIAL_MODEL?.MATERIAL_STATUSES, window.MNP_FACTORY_MATERIAL_MODEL?.BADGE_CLASS],
    job: () => [window.MNP_FACTORY_JOB_MODEL?.JOB_STATUSES, window.MNP_FACTORY_JOB_MODEL?.BADGE_CLASS],
  };
  function resultBadge(status) {
    if (!status) return "";
    const [labels, classes] = STATUS_SOURCES[status.kind]?.() ?? [];
    return `<span class="badge ${escapeHtml(classes?.[status.value] ?? "")}">${escapeHtml(labels?.[status.value] ?? status.value)}</span>`;
  }

  function searchResultsHtml(data, q) {
    const groups = model.search(data, menu.FOLDERS, q);
    if (!groups.length) {
      return `<section class="card"><div class="empty">ไม่พบผลลัพธ์ของ “${escapeHtml(q)}”<br><small>ลองค้นด้วยเลขที่ใบ (เช่น MO, JB, MR) รหัสสินค้า ชื่อลูกค้า หรือชื่อเมนู</small></div></section>`;
    }
    return groups.map((group) => `<section class="card fm-results">
        <h2>${escapeHtml(group.title)} <span class="fm-count">${group.total}</span></h2>
        <ul class="fm-result-list">${group.rows.map((row) => `<li><a href="${escapeHtml(menu.url(row.link.item, row.link.params))}">
          <span class="fm-result-copy"><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.subtitle)}</span></span>${resultBadge(row.status)}</a></li>`).join("")}</ul>
        ${group.total > group.rows.length ? `<p class="muted small">แสดง ${group.rows.length} จาก ${group.total} รายการ — พิมพ์คำค้นให้เจาะจงขึ้น</p>` : ""}
      </section>`).join("");
  }

  const VIEWS = {
    async overview({ frame }) {
      frame.loading();
      const data = await loadData();
      return frame.paint({ body: boardHtml(data), queueCounts: model.queueCounts(data.jobs, data.production) });
    },
    async search({ q, frame }) {
      frame.loading();
      const data = await loadData();
      return frame.paint({ body: searchResultsHtml(data, q) });
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
