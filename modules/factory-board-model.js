// ตรรกะของหน้าภาพรวมการผลิตของฝ่ายโรงงาน (โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-board-model.test.mjs)
//
// อ่านอย่างเดียวจากข้อมูลชุดเดียวกับหน้าอื่น (app_factory_master_data) แล้วสรุปให้เห็นทั้ง workflow ในหน้าเดียว:
// ใบสั่งผลิตอยู่ขั้นไหนกี่ใบ · งานของแต่ละแผนกที่รอลงมือ (ขั้น 1 ขาย · 2 วางแผน · 3 ST · 4–8 สายผลิต) · ของที่ต่ำกว่าขั้นต่ำ · ความเคลื่อนไหวล่าสุด
// ไม่เปลี่ยนข้อมูลและไม่ใช่การควบคุมสิทธิ์ ใช้ตารางสำรวจคงคลัง/ใบงานจาก factory-production-model.js, factory-material-model.js และ
// factory-job-model.js (โหลดก่อนไฟล์นี้ใน index.html เทสต์ใน Node ต้องตั้ง globalThis.MNP_FACTORY_*_MODEL ก่อนเรียกฟังก์ชันที่ใช้)
(function (root) {
  const production = () => root.MNP_FACTORY_PRODUCTION_MODEL;
  const materials = () => root.MNP_FACTORY_MATERIAL_MODEL;
  const jobs = () => root.MNP_FACTORY_JOB_MODEL;
  const master = () => root.MNP_FACTORY_MASTER_MODEL;

  // แผนกสายผลิตตามลำดับ workflow (RB → SR → QA(QC) → GR · PT · BG → PK → WH) พร้อมชื่อที่แสดง
  const LINE_DEPARTMENTS = Object.freeze([
    Object.freeze({ code: "RB", name: "ขึ้นรูปยาง" }),
    Object.freeze({ code: "SR", name: "รับยางเส้นยาวเข้าคลัง" }),
    Object.freeze({ code: "QA", name: "ตรวจสอบขนาด (QC)" }),
    Object.freeze({ code: "GR", name: "แปรรูปยาง" }),
    Object.freeze({ code: "PT", name: "ขึ้นรูปพลาสติก" }),
    Object.freeze({ code: "BG", name: "เย็บกระเป๋า" }),
    Object.freeze({ code: "PK", name: "ประกอบและบรรจุ" }),
    Object.freeze({ code: "WH", name: "รับสินค้าสำเร็จรูปเข้าคลัง" }),
  ]);
  const ACTIVE_ORDER = Object.freeze(["released", "in_progress"]);

  // จำนวนใบสั่งผลิตต่อสถานะตามลำดับขั้น (ทุกสถานะมีคีย์เสมอ) status = คีย์ที่ใช้กรองรายการ
  function pipeline(orders) {
    const counts = production().countByStatus(orders);
    return Object.entries(production().ORDER_STATUSES).map(([status, label]) => ({ status, label, count: counts[status] }));
  }

  // งานที่ถึงคิวของแต่ละแผนก: { RB: 2, SR: 0, ... } (ใช้โชว์ตัวเลขบนการ์ดแผนก) สายผลิต = ใบงานที่ขั้นถัดไปเป็นของแผนกนั้น
  // PP (ถ้าส่งใบสั่งผลิตมาด้วย) = ใบสั่งผลิตที่รอรับ กำลังวางแผน หรือรอออกใบสั่งงาน เพราะฝ่ายวางแผนไม่มีขั้นในใบงาน
  function queueCounts(jobList, orders = null) {
    const counts = {};
    for (const row of LINE_DEPARTMENTS) counts[row.code] = jobs().deptQueue(jobList, row.code).ready.length;
    if (orders) {
      const byStatus = production().countByStatus(orders);
      counts.PP = byStatus.submitted + byStatus.planning + byStatus.planned;
    }
    return counts;
  }

  // งานที่รอลงมือของแต่ละแผนก เรียงตามลำดับ workflow แต่ละกลุ่มมี items { label, count, link } (link = { item, params } หรือ { dept })
  // กลุ่มที่ไม่มีงานเลย (count ทั้งหมดเป็น 0) ยังอยู่ในผลเพื่อให้เห็นว่า "ไม่มีงานค้าง" total = ผลรวมของกลุ่ม
  function attention(data) {
    const orders = data.production ?? [];
    const active = orders.filter((order) => ACTIVE_ORDER.includes(order.status));
    const counts = production().countByStatus(orders);
    const returned = orders.filter((order) => order.status === "draft" && order.return_note).length;
    const needsJobs = active.filter((order) => jobs().jobSuggestions(data, order).some((row) => row.qty > 0)).length;
    const needsMaterial = active.filter((order) => (materials().materialNeeds(data, order) ?? []).some((need) => need.suggest > 0)).length;
    const materialCounts = materials().countByStatus(data.material_orders);
    const ready = queueCounts(data.jobs);
    const groups = [
      { dept: "SA", title: "ฝ่ายขาย (ขั้น 1)", items: [
        { label: "ใบที่ฝ่ายวางแผนส่งกลับให้แก้", count: returned, link: { item: "production-view", params: { status: "draft" } } },
        { label: "ฉบับร่างที่ยังไม่ได้ส่ง", count: counts.draft - returned, link: { item: "production-view", params: { status: "draft" } } },
      ] },
      { dept: "PP", title: "ฝ่ายวางแผน (ขั้น 2 และออกใบงาน)", items: [
        { label: "ใบสั่งผลิตรอรับ", count: counts.submitted, link: { item: "production-planning" } },
        { label: "กำลังสำรวจคงคลัง/เลือก BOM", count: counts.planning, link: { item: "production-planning" } },
        { label: "วางแผนแล้ว รอออกใบสั่งงาน", count: counts.planned, link: { item: "production-planning" } },
        { label: "ใบสั่งผลิตที่ยังมีชิ้นงานรอออกใบงาน", count: needsJobs, link: { item: "job-new" } },
      ] },
      { dept: "ST", title: "แผนก ST สั่งวัตถุดิบ (ขั้น 3)", items: [
        { label: "ใบสั่งผลิตที่ยังต้องสั่งวัตถุดิบเพิ่ม", count: needsMaterial, link: { item: "material-new" } },
        { label: "ใบสั่งวัตถุดิบฉบับร่าง รอสั่ง", count: materialCounts.draft, link: { item: "material-view", params: { status: "draft" } } },
        { label: "สั่งแล้ว รอรับของเข้าคลัง", count: materialCounts.ordered, link: { item: "material-view", params: { status: "ordered" } } },
      ] },
      ...LINE_DEPARTMENTS.map((row) => ({ dept: row.code, title: `${row.code} ${row.name} (ขั้น 4–8)`, items: [
        { label: "ใบงานที่ถึงคิว", count: ready[row.code], link: { dept: row.code } },
      ] })),
    ];
    return groups.map((group) => ({ ...group, total: group.items.reduce((sum, row) => sum + row.count, 0) }));
  }

  // ตัวเลขสรุปบนหัวหน้า
  function stats(data) {
    const orders = production().countByStatus(data.production);
    const jobCounts = jobs().countByStatus(data.jobs);
    const materialCounts = materials().countByStatus(data.material_orders);
    return {
      ordersTotal: (data.production ?? []).length, ordersRunning: orders.released + orders.in_progress, ordersCompleted: orders.completed,
      jobsRunning: jobCounts.open + jobCounts.in_progress, jobsCompleted: jobCounts.completed,
      materialWaiting: materialCounts.draft + materialCounts.ordered,
      lowStock: master().lowStockItems(data.items).length,
    };
  }

  // Item ที่ต่ำกว่าขั้นต่ำ (ขาดมากสุดก่อน) จำกัดจำนวน
  function stockAlerts(items, limit = 8) {
    return master().lowStockItems(items)
      .map((item) => ({ item_id: item.id, code: item.code, name: item.name, unit_code: item.unit_code, stock: Number(item.stock), min_stock: Number(item.min_stock), gap: Number(item.min_stock) - Number(item.stock) }))
      .sort((a, b) => b.gap - a.gap || String(a.code).localeCompare(String(b.code)))
      .slice(0, limit);
  }

  // ความเคลื่อนไหวล่าสุดรวมใบสั่งผลิต/ใบสั่งวัตถุดิบ/ใบงาน ใหม่สุดก่อน (ประวัติแต่ละชุดเรียงใหม่สุดก่อนอยู่แล้ว)
  function recentActivity(data, limit = 12) {
    const rows = [];
    const add = (kind, entries, labels, link) => {
      (entries ?? []).forEach((entry, order) => rows.push({
        kind, at: entry.created_at, order, id: entry.id, code: entry.code, label: labels[entry.action] ?? entry.action, by: entry.changed_by_name ?? null, note: entry.note ?? "",
        link: link(entry),
      }));
    };
    add("ใบสั่งผลิต", data.production_history, production().HISTORY_ACTIONS, (entry) => ({ item: "production-view", params: { po: entry.order_id } }));
    add("ใบสั่งวัตถุดิบ", data.material_history, materials().HISTORY_ACTIONS, (entry) => ({ item: "material-view", params: { mo: entry.order_id } }));
    add("ใบงานผลิต", data.job_history, jobs().HISTORY_ACTIONS, (entry) => ({ item: "job-view", params: { jb: entry.job_id } }));
    return rows
      .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")) || a.order - b.order || String(a.kind).localeCompare(String(b.kind)))
      .slice(0, limit);
  }

  const api = { LINE_DEPARTMENTS, pipeline, queueCounts, attention, stats, stockAlerts, recentActivity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_BOARD_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
