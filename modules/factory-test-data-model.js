// ตรรกะของหน้า "จัดการข้อมูลทดสอบ" ฝ่ายโรงงาน (โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-test-data-model.test.mjs)
//
// แนวคิดจาก ERPNext (demo data + Transaction Deletion Record) นำมาแค่แนวคิด ไม่ได้คัดลอกโค้ด:
//   1. เห็นว่าตอนนี้มีข้อมูลทดสอบอะไรเท่าไร และชุดข้อมูลตัวอย่างไหนเติมแล้ว ก่อนกดอะไร
//   2. ก่อนล้าง แสดงรายการที่จะลบพร้อมจำนวนให้ตรวจ แล้วจึงยืนยัน (ไม่ใช้กล่อง confirm ที่ไม่บอกจำนวน)
//   3. หลังล้าง ฐานข้อมูลบันทึกจำนวนที่ลบจริงแยกตามประเภทไว้ใน audit_logs
// ข้อมูลมาจาก RPC app_sandbox_factory_test_data และ app_sandbox_purge_factory
// (supabase/migrations/20261014030000_factory_sandbox_test_data_summary.sql) key ของ GROUPS ต้องตรงกับ counts ของ RPC
(function (root) {
  // ประเภทข้อมูลทดสอบ เรียงตามลำดับที่ผู้ใช้คุ้น (เอกสารหลัก → คลัง → ข้อมูลตั้งต้น → รายการย่อย)
  const GROUPS = Object.freeze([
    { key: "items", label: "Item สินค้า", unit: "รายการ" },
    { key: "boms", label: "โครงสร้างสินค้า (BOM)", unit: "ฉบับ" },
    { key: "routings", label: "ขั้นตอนการผลิต (Routing)", unit: "ฉบับ" },
    { key: "production_orders", label: "ใบสั่งผลิต", unit: "ใบ" },
    { key: "material_orders", label: "ใบสั่งวัตถุดิบ", unit: "ใบ" },
    { key: "jobs", label: "ใบงานผลิต", unit: "ใบ" },
    { key: "inventory_movements", label: "ความเคลื่อนไหวคลัง", unit: "รายการ" },
    { key: "lots", label: "ล็อต", unit: "ล็อต" },
    { key: "attachments", label: "ไฟล์แนบ", unit: "ไฟล์" },
    { key: "work_centers", label: "ศูนย์งาน", unit: "แห่ง" },
    { key: "warehouses", label: "คลัง", unit: "คลัง" },
    { key: "details", label: "รายการย่อยและประวัติ", unit: "แถว" },
  ].map((group) => Object.freeze(group)));

  // ชุดข้อมูลตัวอย่าง: rpc = ฟังก์ชันที่เติม · action = ข้อความบนปุ่ม · flag = ค่าใน sets ของ RPC สรุป · link = รายการเมนูที่ควรเปิดดูหลังเติม
  // sample เติมได้เฉพาะตอนทะเบียนสินค้าว่าง (ฐานข้อมูลตัดสินด้วย sample_available) ชุดอื่นเติมได้ครั้งเดียวจนกว่าจะล้าง
  const SETS = Object.freeze([
    {
      key: "sample", rpc: "app_sandbox_seed_factory", availableFlag: "sample_available",
      name: "ชุดตัวอย่างเริ่มต้น", action: "เติมชุดตัวอย่าง",
      description: "Item ตัวอย่าง 16 รายการ พร้อม BOM, Routing, ใบสั่งผลิต และยอดยกมา สำหรับลองดูหน้าทะเบียนและคลัง",
      includes: ["16 Item", "BOM", "Routing", "ยอดยกมา"],
      link: "item-list", linkLabel: "เปิดทะเบียนสินค้า",
    },
    {
      key: "trial", rpc: "app_sandbox_seed_factory_trial", loadedFlag: "trial_loaded",
      name: "ชุดทดลอง 5 สินค้า", action: "เติมชุดทดลอง",
      description: "ตาม workflow การผลิต RB → SR/QC → GR · PT · BG → PK → WH ใช้ลองออกใบสั่งผลิต สั่งวัตถุดิบ และเดินใบงานทีละแผนก",
      includes: ["5 สินค้า", "BOM หลายชั้น", "Routing ตามแผนก", "ใบสั่งผลิต", "ยอดยกมา"],
      link: "production-view", linkLabel: "เปิดใบสั่งผลิต",
    },
    {
      key: "megaform", rpc: "app_sandbox_seed_factory_megaform", loadedFlag: "megaform_loaded",
      name: "ชุด MEGAFORM (ใบคำนวณวัตถุดิบ 260702-26031)", action: "เติมชุด MEGAFORM",
      description: "สินค้า 14 รายการจากใบคำนวณวัตถุดิบ ออกใบสั่งงานแล้ว พร้อมใบงานทุกแผนกตามกำหนดเสร็จ ใช้ดูตารางการผลิต (Gantt)",
      includes: ["14 สินค้า", "BOM อนุมัติแล้ว", "ใบสั่งผลิต 14 ใบ", "ใบงาน RB · GR · PT · BG · PK"],
      link: "schedule-gantt", linkLabel: "เปิดตาราง Gantt",
    },
  ].map((set) => Object.freeze({ ...set, includes: Object.freeze(set.includes) })));

  // จำนวนจาก RPC ถือเป็นข้อมูลที่ยังไม่ตรวจ: ค่าที่ไม่ใช่จำนวนเต็มไม่ติดลบนับเป็น 0
  const toCount = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  };

  const formatCount = (value) => toCount(value).toLocaleString("th-TH");

  // ทุกประเภทพร้อมจำนวน (รวมประเภทที่เป็น 0 เพื่อให้หน้าสรุปมีโครงเดิมเสมอ)
  function rows(counts) {
    return GROUPS.map((group) => ({ ...group, count: toCount(counts?.[group.key]) }));
  }

  // รายการที่จะลบ: เฉพาะประเภทที่มีข้อมูล ตามลำดับเดิม
  function purgePlan(counts) {
    return rows(counts).filter((row) => row.count > 0);
  }

  function total(counts) {
    return rows(counts).reduce((sum, row) => sum + row.count, 0);
  }

  // สถานะของชุดข้อมูลตัวอย่าง: loaded = เติมแล้ว · ready = เติมได้ · blocked = ต้องล้างข้อมูลทดสอบก่อน
  function setState(set, sets) {
    if (set.loadedFlag) return sets?.[set.loadedFlag] === true ? "loaded" : "ready";
    return sets?.[set.availableFlag] === true ? "ready" : "blocked";
  }

  const SET_STATE_LABELS = Object.freeze({ loaded: "เติมแล้ว", ready: "พร้อมเติม", blocked: "ต้องล้างก่อน" });

  // ข้อความหลังเติม (คงข้อความเดิมของปุ่มในทะเบียนสินค้า ผู้ใช้จึงเห็นแบบเดียวกัน)
  function seedMessage(key, data) {
    if (!data?.seeded) {
      return {
        sample: "มีข้อมูลทดสอบอยู่แล้ว ไม่ได้เติมซ้ำ",
        trial: "มีชุดทดลองอยู่แล้ว ไม่ได้เติมซ้ำ",
        megaform: "มีชุด MEGAFORM อยู่แล้ว ไม่ได้เติมซ้ำ",
      }[key] ?? "มีข้อมูลชุดนี้อยู่แล้ว ไม่ได้เติมซ้ำ";
    }
    if (key === "sample") return `เติมข้อมูลตัวอย่างแล้ว ${data.items} รายการ`;
    if (key === "trial") return `เติมชุดทดลองแล้ว ${data.items} Item · ${data.boms} BOM · ${data.steps} ขั้นตอนการผลิต`;
    if (key === "megaform") {
      return `เติมชุด MEGAFORM แล้ว ${data.items} Item${data.reused_items ? ` (ใช้ Item เดิมที่รหัสซ้ำ ${data.reused_items})` : ""} · ${data.boms} BOM · ใบสั่งผลิต ${data.orders} ใบ · ใบงาน ${data.jobs} ใบ`;
    }
    return "เติมข้อมูลตัวอย่างแล้ว";
  }

  // ข้อความหลังล้าง: 3 ประเภทแรกที่มีข้อมูล + จำนวนที่เหลือรวมกัน (toast ต้องสั้น รายละเอียดครบอยู่ใน audit)
  // ฐานข้อมูลรุ่นก่อน 20261014030000 คืนแค่ deleted จึงถอยไปแสดงจำนวน Item
  function purgeMessage(result) {
    if (!result?.counts) return `ล้างข้อมูลทดสอบแล้ว ${toCount(result?.deleted)} Item`;
    const plan = purgePlan(result.counts);
    if (!plan.length) return "ไม่มีข้อมูลทดสอบให้ล้าง";
    const shown = plan.slice(0, 3).map((row) => `${row.label} ${formatCount(row.count)}`);
    const rest = plan.slice(3).reduce((sum, row) => sum + row.count, 0);
    return `ล้างข้อมูลทดสอบแล้ว ${shown.join(" · ")}${rest ? ` และอื่น ๆ อีก ${formatCount(rest)} แถว` : ""}`;
  }

  const api = { GROUPS, SETS, SET_STATE_LABELS, toCount, formatCount, rows, purgePlan, total, setState, seedMessage, purgeMessage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_TEST_DATA_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
