// หน้าภาพรวมการผลิตของฝ่ายโรงงาน (#/factory) โหมดทดสอบ — ดูทั้ง workflow ในหน้าเดียว อ่านอย่างเดียว
//
// view "overview" (module-factory.js เรียกแทนหน้ารวมเดิมที่เป็นแค่การ์ดแผนก): ตัวเลขสรุป · ใบสั่งผลิตแยกตามขั้น (กดกรองรายการ) ·
// งานที่รอลงมือของแต่ละแผนก (ขั้น 1 ขาย · 2 วางแผน · 3 ST · 4–8 สายผลิต) · Item ที่ต่ำกว่าขั้นต่ำ · ความเคลื่อนไหวล่าสุด
// ตัวเลขบนการ์ดแผนกคือใบงานที่ถึงคิวของแผนก (ฝ่ายวางแผน = ใบสั่งผลิตที่รอดำเนินการ) ทุกตัวเลขคำนวณจากข้อมูลชุดเดียวกับหน้าอื่น
// (app_factory_master_data) ในหน้าเว็บ ตรรกะที่ทดสอบได้อยู่ที่ modules/factory-board-model.js ไม่มีการเขียนข้อมูลและไม่ใช่การควบคุมสิทธิ์
//
// โหลดหลัง modules/module-factory-job.js และก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (escapeHtml, formatDate) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerFactoryBoardView() {
  const model = window.MNP_FACTORY_BOARD_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const factory = window.MNP_FACTORY;
  const { loadData, qty, notice } = window.MNP_FACTORY_UI;

  const href = (link) => (link.dept ? (factory.find(link.dept) ? factory.url(link.dept) : menu.url("job-queue")) : menu.url(link.item, link.params ?? {}));
  const tile = (title, value, hint) => `<div class="summary"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong><small>${hint}</small></div>`;

  function boardHtml(data) {
    const stats = model.stats(data);
    const pipeline = model.pipeline(data.production);
    const groups = model.attention(data);
    const alerts = model.stockAlerts(data.items);
    const recent = model.recentActivity(data);
    const pipelineChips = pipeline.map((step) => `<a class="filter" href="${escapeHtml(menu.url("production-view", { status: step.status }))}">${escapeHtml(step.label)} (${step.count})</a>`).join("");
    const attentionRows = groups.map((group) => `<tr>
        <td><strong>${escapeHtml(group.title)}</strong></td>
        <td>${group.items.map((row) => `<a class="fm-board-chip${row.count ? " has-work" : ""}" href="${escapeHtml(href(row.link))}">${escapeHtml(row.label)} <strong>${row.count}</strong></a>`).join(" ")}</td>
        <td class="right">${group.total ? `<span class="badge pending_approval">${group.total} รอลงมือ</span>` : '<span class="muted small">ไม่มีงานค้าง</span>'}</td>
      </tr>`).join("");
    const alertRows = alerts.map((row) => `<tr><td><a href="${escapeHtml(menu.url("item-list", { id: row.item_id }))}"><strong>${escapeHtml(row.code)}</strong></a> <span class="muted small">${escapeHtml(row.name)}</span></td>
        <td class="right fm-short">${qty(row.stock)} ${escapeHtml(row.unit_code)}</td><td class="right">${qty(row.min_stock)}</td></tr>`).join("");
    const activityRows = recent.map((row) => `<tr><td>${formatDate(row.at, true)}</td><td>${escapeHtml(row.kind)} <a href="${escapeHtml(menu.url(row.link.item, row.link.params))}"><strong>${escapeHtml(row.code)}</strong></a></td>
        <td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.by ?? "—")}</td></tr>`).join("");
    return `<div class="summary-grid fm-summary">
        ${tile("ใบสั่งผลิตทั้งหมด", stats.ordersTotal, `ผลิตอยู่ ${stats.ordersRunning} · เสร็จแล้ว ${stats.ordersCompleted}`)}
        ${tile("ใบงานผลิตที่ยังไม่จบ", stats.jobsRunning, `เสร็จแล้ว ${stats.jobsCompleted} ใบ`)}
        ${tile("ใบสั่งวัตถุดิบรอดำเนินการ", stats.materialWaiting, "ฉบับร่างและสั่งแล้วรอรับของ")}
        ${tile("ต่ำกว่าสต็อกขั้นต่ำ", stats.lowStock, `<a href="${escapeHtml(menu.url("inventory-view"))}">ดูสินค้าคงคลัง →</a>`)}
      </div>
      <section class="card"><h2>ใบสั่งผลิตตามขั้น</h2>
        <nav class="filters" aria-label="ใบสั่งผลิตตามสถานะ">${pipelineChips}</nav></section>
      <section class="card"><h2>งานที่รอลงมือของแต่ละแผนก</h2>
        <p class="muted small">เรียงตามลำดับ workflow — กดตัวเลขเพื่อไปทำงานนั้น (สลับ “ทำหน้าที่เป็น” เป็นพนักงานแผนกนั้นก่อน)</p>
        <div class="table-wrap"><table><thead><tr><th>แผนก / ขั้น</th><th>งาน</th><th class="right">สรุป</th></tr></thead><tbody>${attentionRows}</tbody></table></div></section>
      <section class="card"><h2>ต่ำกว่าสต็อกขั้นต่ำ</h2>
        ${alertRows ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th class="right">คงเหลือทุกคลัง</th><th class="right">ขั้นต่ำ</th></tr></thead><tbody>${alertRows}</tbody></table></div>` : '<p class="muted small">ไม่มี Item ที่ต่ำกว่าขั้นต่ำ</p>'}</section>
      <section class="card"><h2>ความเคลื่อนไหวล่าสุด</h2>
        ${activityRows ? `<div class="table-wrap"><table><thead><tr><th>เวลา</th><th>เอกสาร</th><th>การกระทำ</th><th>ผู้ทำรายการ</th></tr></thead><tbody>${activityRows}</tbody></table></div>`
          : notice("ยังไม่มีความเคลื่อนไหว — เติมชุดทดลองที่ทะเบียนสินค้า แล้วเริ่มจากฝ่ายขายออกใบสั่งผลิต")}</section>`;
  }

  const VIEWS = {
    async overview({ frame }) {
      frame.loading();
      const data = await loadData();
      return frame.paint({ body: boardHtml(data), queueCounts: model.queueCounts(data.jobs, data.production) });
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
