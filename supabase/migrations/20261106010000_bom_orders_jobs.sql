-- ============================================================================
-- โมดูล BOM รายแผนก (โหมดทดสอบ) ขั้น 4 ตอนที่ 2: ใบสั่งผลิต (PI), งานรายแผนก, นับคงคลังตามใบ, ลูกค้า, audit และล้างข้อมูลทดสอบ
-- ย้ายส่วนที่เหลือใน localStorage (modules/bom-store.js state v6: orders, jobs, audit, counters) เข้า Supabase ต่อจาก 20261105010000_bom_master_data.sql
--
-- ขอบเขต
--   ตารางใหม่ (ทดสอบเท่านั้น แยกโหมดด้วย is_test เหมือนข้อมูลหลัก): bom_customers (ลูกค้า), bom_orders (ใบสั่งผลิต PI), bom_jobs (งานรายแผนก)
--   ใช้กลไกเดียวกับข้อมูลหลัก ไม่แตกสายใหม่: ตัวนับ bom_master_state ตัวเดียว, changed_version ต่อแถว (trigger bom_stamp_version),
--   ชนรายระเบียนด้วย BOM_STALE, delta/หลุมฝังศพ (bom_deleted_keys), RLS deny-all + ถอนสิทธิ์ + lab-only, อ่าน/เขียนผ่าน RPC security definer เท่านั้น
--   ไม่ย้ายใบสั่งผลิตเก่าจากเบราว์เซอร์ (เริ่มจากว่างเหมือนข้อมูลหลัก) ไม่ออกเลข PI ที่ฐานข้อมูล: client ออกเลข YYMMDD-YYnnn จากเลขสูงสุดใน snapshot + 1
--   pi_no เป็นกุญแจ (unique ต่อโหมด) ใบที่ pi_no ซ้ำกับของคนอื่นที่เพิ่งสร้างหลัง p_base_version = BOM_STALE (client ตามทันแล้วกดบันทึกใหม่ ได้เลขถัดไป)
--     หมายเหตุ: payload เป็นเรคอร์ดเต็มโดยไม่มีธงว่า "สร้างใหม่" ฐานข้อมูลจึงแยก "สร้างใหม่ที่ pi_no ซ้ำกับของเก่า (changed_version <= base)" ออกจาก "แก้ใบเดิม"
--     ไม่ได้ (เป็นการแก้ใบเดิมตามกฎสิทธิ์/สถานะด้านล่าง ไม่ใช่ BOM_CONFLICT) client ตรวจเลขซ้ำใน snapshot ของตัวเองก่อนส่งอยู่แล้ว
--
-- RPC
--   public.app_bom_master() / public.app_bom_master_since(bigint): นิยามเดิมของ 20261105010000 ไม่เปลี่ยน (เรียก private.bom_snapshot / bom_delta)
--     รูป snapshot / delta ได้อีก 3 ชุด: customers, orders, jobs (รวมสิบเอ็ดชุดเสมอ) เรียงแบบกำหนดได้: orders ตาม orderedAt มากไปน้อยแล้ว id,
--     jobs ตาม orderId, dept, itemCode, id (collate "C"), customers ตามชื่อ · delete ของ jobs ในรูป { id, code } (ค่าเดียวกัน = รหัส JOB-…)
--     ชุดอื่นนอก colorSets/packages/jobs ไม่มี delete (ใบสั่งผลิตและลูกค้าลบไม่ได้ ยกเลิกเท่านั้น)
--   public.app_bom_save_master(p_changes, p_base_version, p_action, p_audit default '[]', p_epoch default null): แทนที่ฟังก์ชัน 3 อาร์กิวเมนต์เดิม (drop แล้วสร้างใหม่
--     ไม่ทำ overload เพราะ overload ทำให้การเรียก 3 อาร์กิวเมนต์กำกวม) การเรียกแบบ 3 อาร์กิวเมนต์ของ Pilot รุ่นเดิมยังทำงานได้ผ่านค่าเริ่มต้นของอาร์กิวเมนต์ที่ 4 และ 5
--     p_audit = [{action, detail}] ไม่เกิน 20 รายการ (action <= 80, detail <= 300 ตัวอักษร) เก็บใน metadata.entries ของแถว audit_logs แถวเดียวของการบันทึก
--       (ข้อความของ client เป็นข้อมูลประกอบ ไม่ใช่หลักฐาน: app_bom_audit แสดง client_action และจำนวนที่เซิร์ฟเวอร์บันทึกเป็นบรรทัดหลัก)
--     p_epoch = epoch ที่ client ถือ (ได้จาก snapshot / delta) ถ้าไม่ตรงกับของฐานข้อมูล (มีการล้างข้อมูลทดสอบหลังจากนั้น) = BOM_RESET ไม่เขียนอะไร (null = ไม่ตรวจ ไว้ให้ Pilot รุ่นเดิม)
--   epoch (bom_master_state.epoch): รหัสรอบข้อมูลของโหมดทดสอบ เปลี่ยนเฉพาะตอนล้างข้อมูลทดสอบ · snapshot และ delta ทุกแบบคืน epoch มาด้วย client ที่เห็น epoch ต่างจากที่ถือต้องโหลดทั้งชุดใหม่
--     (ตัวนับ version ไม่ถูกตั้งกลับเป็น 0 ตอนล้าง จึงไม่มี client ที่ถือ version เก่าแล้วพลาดแถวที่สร้างหลังล้าง หรือเอาระเบียนที่ลบไปแล้วกลับมา)
--     delete ของ jobs รับ "JOB-…" เป็นข้อความ หรือ { id } หรือ { code }
--   public.app_bom_audit(p_limit integer default 200) -> [{ at, user, action, detail, entries }] ใหม่สุดก่อน จากแถว audit_logs ของ BOM ในโหมดทดสอบ (persona ทุกตัวอ่านได้)
--     action / detail = ที่เซิร์ฟเวอร์บันทึกเอง (ชื่อ action + จำนวนระเบียนต่อส่วน) · entries = ข้อความของ client เป็นหมายเหตุรอง
--   public.app_sandbox_purge_bom() -> { deleted } admin จริงที่อยู่ในโหมดทดสอบเท่านั้น (แบบเดียวกับ app_sandbox_purge_ncr / app_sandbox_purge_qc)
--     ลบทุกแถว is_test ของตาราง bom_* ทั้งหมด เปลี่ยน epoch (ตัวนับ version เดินต่อ ไม่ตั้งกลับ) และเขียน audit (แถว audit_logs เดิมคงไว้ ประวัติการใช้งานจึงยังอ่านได้) ไม่แตะข้อมูลจริง
--     client ที่ถือ epoch เดิมเห็น epoch ใหม่ตอนขอ delta แล้วโหลดทั้งชุดใหม่ ถ้าบันทึกก่อนรู้ก็ได้ BOM_RESET
--
-- สิทธิ์ (ตัวบังคับจริงคือ RPC หน้าเว็บซ่อนปุ่มอย่างเดียว) ทุกอย่างเปิดเฉพาะโหมดทดสอบ (private.bom_actor)
--   กลุ่มวางแผน (private.bom_can_edit): แผนก PP ทุกบทบาท หรือ department_manager / assistant_factory_manager / factory_manager / general_manager / admin
--   - ข้อมูลหลัก (items ... routings), ลูกค้า, สร้าง/แก้/ปล่อย/ปิด/ยกเลิกใบสั่งผลิต, สร้างและลบงาน: กลุ่มวางแผนเท่านั้น ไม่เช่นนั้น BOM_FORBIDDEN
--   - นับคงคลัง (order.stockCounts) เฉพาะใบ draft และเปลี่ยนเฉพาะ stockCounts: กลุ่มวางแผน หรือพนักงานแผนก ST / WH (ทุกบทบาท)
--   - งาน (update): กลุ่มวางแผนแก้ได้ทุกช่อง · พนักงานแผนกเดียวกับ job.dept (ทุกบทบาท) แก้ได้เฉพาะ status, qtyDone, qtyReject, reports, doneAt
--     (รายงานผลต่อท้ายเท่านั้น: รายการเดิมห้ามแก้ รายการใหม่เซิร์ฟเวอร์ตั้ง by = ชื่อ persona และ at = เวลาเซิร์ฟเวอร์ ยอด qtyDone/qtyReject ที่เพิ่ม
--     ต้องเท่าผลรวม good/reject ของรายการใหม่ ลดไม่ได้ งานที่ done แล้วพนักงานแผนกแก้ไม่ได้) doneAt เซิร์ฟเวอร์ตั้ง
--     externalRef (ผูก WO ของ RubberFlow): กลุ่มวางแผน หรือพนักงานแผนก RB เฉพาะงานแผนก RB ที่ยังไม่ผูก · แผนกอื่นแก้ช่องอื่น (ชื่อ จำนวนแผน วันครบกำหนด ฯลฯ) = BOM_FORBIDDEN
--     ใบต้องเป็น released / in_progress ถึงแก้งานได้ (ไม่เช่นนั้น BOM_INVALID_TRANSITION) · เพิ่มงานได้เฉพาะใบที่ปล่อยผลิตในคำสั่งเดียวกัน
--   - ใบจากสถานะ released เป็น in_progress อัตโนมัติเมื่อมีงานเริ่ม (ฐานข้อมูลตั้งเองในคำสั่งที่แก้งาน) พนักงานแผนกจึงไม่ต้องแก้ใบ
--     (ถ้า client ส่งใบ released -> in_progress มาพร้อมงานของใบนั้นก็ยอมรับโดยข้าม ไม่ถือว่าแก้ใบ)
--   การเปลี่ยนสถานะใบ (ตรวจจากสถานะในฐานข้อมูล ผิด = BOM_INVALID_TRANSITION)
--     draft -> released (ต้องมีสินค้า + ระเบิด BOM แล้ว + มีงานอย่างน้อย 1 งานในคำสั่งเดียวกัน) · draft -> cancelled
--     released/in_progress -> completed (งาน PK ทุกงานต้อง done) · released/in_progress -> cancelled (ห้ามถ้ามีงานที่รายงานยอดดี หรือผูก WO แล้ว; ลบงานของใบ)
--     released/in_progress -> draft (เปิดใบกลับมาแก้) เฉพาะเมื่อไม่มีงานใดเริ่ม: ทุกงานสถานะ queued, ไม่มีรายงาน, qtyDone = qtyReject = 0, ไม่มี externalRef
--     ฐานข้อมูลลบงานทั้งหมดของใบ (จดหลุมฝังศพ) revision + 1 ยอดนับคงคลังคงอยู่ · อย่างอื่นไม่ได้ ใบ completed/cancelled เป็นสถานะสุดท้าย
--     ใบที่ไม่ใช่ draft แก้เนื้อหา (สินค้า ระเบิด ลูกค้า วันที่ นับคงคลัง ฯลฯ) ไม่ได้ ยกเว้นเปิดกลับเป็น draft
--     เวลา/ผู้ทำ (createdAt/createdBy, releasedAt/By, completedAt, cancelledAt, explodedAt, stockCountedAt/By) เซิร์ฟเวอร์ตั้งเอง ไม่เชื่อ client
--   audit: ผู้กระทำในแถว audit_logs = admin จริงเบื้องหลัง persona เหมือนเดิม ชื่อ persona อยู่ใน metadata.persona_name
--
-- ข้อควรทราบ: งานของพนักงานแผนกและ auto in_progress ทำให้ changed_version ของใบขยับ คนที่ถือใบนั้นอยู่จะได้ BOM_STALE ตอนบันทึกแล้วตามทันตามปกติ
-- ลำดับการตรวจของตัวเขียนใบสั่งผลิต/งาน: ชน (BOM_STALE: แถวถูกแก้หลังเวอร์ชันฐาน หรืองานถูกลบหลังเวอร์ชันฐาน) มาก่อนการเทียบสิทธิ์/เนื้อหาเสมอ
--   สำเนาเก่าของ client ต่างจากแถวล่าสุดเป็นเรื่องปกติ ต้องไม่ถูกตัดสินว่าแก้ช่องที่ไม่มีสิทธิ์ (BOM_FORBIDDEN) ไม่เช่นนั้น client ไม่ตามทันแล้วค้าง
--
-- รหัสข้อผิดพลาดใหม่ (นอกจากของ 20261105010000): BOM_INVALID_CUSTOMER BOM_INVALID_ORDER BOM_INVALID_JOB BOM_INVALID_TRANSITION
--
-- นิยามที่ replace ในไฟล์นี้ (เริ่มจากนิยามล่าสุดใน 20261105010000_bom_master_data.sql ทั้งหมด)
--   private.sandbox_unguarded_tables() (เพิ่ม bom_customers, bom_orders, bom_jobs) · private.bom_client_actions() (เพิ่มชื่อ action ของใบสั่งผลิต งาน นับคงคลัง ลูกค้า)
--   private.bom_records(bigint) และ private.bom_delta(bigint) (เพิ่ม 3 ชุด และ epoch) · private.bom_snapshot() (เพิ่ม epoch) · public.app_bom_save_master (ดูข้างบน)
--   เพิ่มคอลัมน์ bom_master_state.epoch
--   check ของ bom_deleted_keys.list (เพิ่ม 'jobs')
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ (modules/bom-*.js) เรียก RPC ที่ไฟล์นี้เพิ่ม/เปลี่ยน (app_bom_save_master 4 อาร์กิวเมนต์,
--   app_bom_audit, app_sandbox_purge_bom และรูป snapshot ที่มี orders/jobs/customers) จึงต้อง apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้) ก่อน merge PR
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของ private.sandbox_unguarded_tables, private.bom_client_actions, private.bom_records, private.bom_snapshot, private.bom_delta,
--   public.app_bom_save_master ที่ production กับนิยามใน 20261105010000_bom_master_data.sql (ถ้ามี migration อื่นแก้ไปแล้ว ต้องเริ่มจากนิยามล่าสุด)
--   Pilot Web รุ่นเดิม (PR #306) ยังทำงานกับฐานใหม่ได้: เรียก app_bom_save_master แบบ 3 อาร์กิวเมนต์ได้ และอ่านเฉพาะแปดชุดเดิมจาก delta
--
-- Rollback (ตาราง bom_orders / bom_jobs / bom_customers มีแต่ข้อมูลทดสอบ):
--   1) drop function public.app_bom_audit(integer), public.app_sandbox_purge_bom(), public.app_bom_save_master(jsonb, bigint, text, jsonb, text);
--   2) drop function private.bom_staff_actions(), bom_dept_of(public.employees), bom_started_jobs(uuid), bom_delete_order_jobs(uuid),
--      bom_delete_jobs(boolean, jsonb, bigint, bigint), bom_parse_order_items(jsonb), bom_parse_stock_counts(jsonb), bom_parse_due(jsonb),
--      bom_parse_explosion(jsonb), bom_parse_reports(jsonb, jsonb, text), bom_parse_external_ref(jsonb), bom_save_customers(uuid, jsonb, bigint, bigint),
--      bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint), bom_save_jobs(public.employees, text, boolean, jsonb, uuid[], bigint, bigint);
--   3) delete from public.bom_deleted_keys where list = 'jobs'; alter table public.bom_deleted_keys drop constraint bom_deleted_keys_list_check;
--      alter table public.bom_deleted_keys add constraint bom_deleted_keys_list_check check (list in ('colorSets', 'packages'));
--   4) drop table public.bom_jobs, public.bom_orders, public.bom_customers (ลูกก่อนแม่)
--   5) alter table public.bom_master_state drop column epoch;
--   6) คืนนิยามของ 20261105010000_bom_master_data.sql ของ private.sandbox_unguarded_tables(), private.bom_client_actions(), private.bom_records(bigint),
--      private.bom_snapshot(), private.bom_delta(bigint) และ public.app_bom_save_master(jsonb, bigint, text) (รัน create or replace จากไฟล์นั้น รวม revoke/grant ท้ายไฟล์)
-- ============================================================================

-- 1. ตาราง (แยกโหมดด้วย is_test) ----------------------------------------------------------
-- รหัสรอบข้อมูล: เปลี่ยนเมื่อล้างข้อมูลทดสอบ (ตัวนับ version ไม่ถูกตั้งกลับ) แถวที่มีอยู่ได้รหัสสุ่มของตัวเอง
alter table public.bom_master_state add column epoch uuid not null default gen_random_uuid();
comment on column public.bom_master_state.epoch is 'รหัสรอบข้อมูล เปลี่ยนเฉพาะตอนล้างข้อมูลทดสอบ (app_sandbox_purge_bom) client ที่ถือ epoch เก่าต้องโหลดทั้งชุดใหม่';

-- ลูกค้า: กุญแจ = ชื่อ (ตัดช่องว่างซ้ำ ไม่แยกตัวพิมพ์เล็ก/ใหญ่)
create table public.bom_customers (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  name text not null check (char_length(name) between 1 and 120),
  country text not null default '' check (char_length(country) <= 60),
  order_type text check (order_type is null or order_type in ('SA', 'EX')),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test)
);
create unique index bom_customers_name_idx on public.bom_customers (lower(name), is_test);
comment on table public.bom_customers is 'ลูกค้าของใบสั่งผลิต (ข้อมูลหลัก): ชื่อ ประเทศ ประเภทออร์เดอร์ SA/EX ที่ใช้เติมในใบ';

create table public.bom_orders (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  -- เลข PI เช่น 251202-25047 หรือ YYMMDD-YYnnn (client ออกเลข หรือผู้ใช้พิมพ์เอง) เป็นกุญแจของใบ
  pi_no text not null check (char_length(pi_no) between 1 and 40),
  customer text not null check (char_length(customer) between 1 and 120),
  country text not null check (char_length(country) between 1 and 60),
  order_type text not null check (order_type in ('SA', 'EX')),
  -- วันที่เป็นมิลลิวินาทีแบบ Date.now() ที่ client ใช้ (ไม่แปลง จึงไม่คลาดเคลื่อน)
  ordered_at bigint not null check (ordered_at > 0 and ordered_at <= 100000000000000),
  wh_due bigint not null check (wh_due >= ordered_at and wh_due <= 100000000000000),
  -- { RB, GR, PT, BG, ST, PK: ms } กำหนดเสร็จรายแผนก
  due jsonb not null default '{}'::jsonb check (jsonb_typeof(due) = 'object'),
  -- แผนกที่ช่องกำหนดเสร็จเป็นค่าเริ่มต้นจาก lead time
  due_defaults jsonb not null default '[]'::jsonb check (jsonb_typeof(due_defaults) = 'array' and jsonb_array_length(due_defaults) <= 10),
  revision integer not null default 0 check (revision >= 0),
  status text not null default 'draft' check (status in ('draft', 'released', 'in_progress', 'completed', 'cancelled')),
  -- [{fgCode, qty, colorSet, note}]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 500),
  -- ผลระเบิด BOM ที่ client คำนวณ (rules.explode) ตรวจรูปและขนาดใน RPC ผู้ตั้งค่าคือผู้วางแผนที่มีสิทธิ์ตั้งตัวเลขเหล่านี้อยู่แล้ว
  explosion jsonb check (explosion is null or (jsonb_typeof(explosion) = 'array' and jsonb_array_length(explosion) <= 5000)),
  exploded_at timestamptz,
  -- { รหัสชิ้น: ยอดคงคลังที่นับ }
  stock_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(stock_counts) = 'object'),
  note text not null default '' check (char_length(note) <= 300),
  stock_counted_at timestamptz,
  stock_counted_by uuid references public.employees(id) on delete set null,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.employees(id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text not null default '' check (char_length(cancel_reason) <= 200),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (pi_no, is_test)
);
create index bom_orders_status_idx on public.bom_orders (is_test, status);
comment on table public.bom_orders is 'ใบสั่งผลิต (PI) draft -> released -> in_progress -> completed / cancelled เปลี่ยนสถานะผ่าน app_bom_save_master เท่านั้น';

create table public.bom_jobs (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  -- รหัสงานที่ client ออก เช่น JOB-69-0001-k3x9ab (ต่อรหัสสุ่มท้ายรหัสเหมือน BOM/RT)
  job_no text not null check (job_no ~ '^[A-Za-z0-9._-]{1,40}$'),
  order_pk uuid not null,
  dept text not null references public.departments(code),
  item_code text not null,
  name text not null check (char_length(name) between 1 and 160),
  kind text not null check (kind in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP')),
  uom text not null check (uom in ('pcs', 'set', 'box', 'roll', 'rod', 'ball', 'pack', 'bucket', 'sheet', 'kg', 'g', 'm', 'yd', 'cm', 'other')),
  qty_planned numeric not null check (qty_planned >= 0 and qty_planned <= 1000000000),
  qty_required numeric not null check (qty_required >= 0 and qty_required <= 1000000000),
  stock_counted numeric check (stock_counted is null or (stock_counted >= 0 and stock_counted <= 1000000000)),
  qty_done numeric not null default 0 check (qty_done >= 0 and qty_done <= 1000000000),
  qty_reject numeric not null default 0 check (qty_reject >= 0 and qty_reject <= 1000000000),
  due_at bigint check (due_at is null or (due_at > 0 and due_at <= 100000000000000)),
  status text not null default 'queued' check (status in ('queued', 'in_progress', 'done', 'hold')),
  -- { system: 'rubberflow', woId, kg, linkedAt, by } หรือ null
  external_ref jsonb check (external_ref is null or jsonb_typeof(external_ref) = 'object'),
  fg_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(fg_codes) = 'array' and jsonb_array_length(fg_codes) <= 500),
  -- [{at, by, good, reject, note}] ต่อท้ายเท่านั้น
  reports jsonb not null default '[]'::jsonb check (jsonb_typeof(reports) = 'array' and jsonb_array_length(reports) <= 1000),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (order_pk, is_test) references public.bom_orders(id, is_test),
  foreign key (item_code, is_test) references public.bom_items(code, is_test),
  unique (id, is_test),
  unique (job_no, is_test),
  -- หนึ่งงานต่อ แผนก × ชิ้นงาน ในหนึ่งใบ (รวมทุกสินค้าในใบ)
  unique (order_pk, dept, item_code)
);
create index bom_jobs_order_idx on public.bom_jobs (is_test, order_pk);
comment on table public.bom_jobs is 'งานรายแผนกที่สร้างตอนปล่อยผลิต (หนึ่งงานต่อ แผนก × ชิ้นงาน ต่อใบ)';

-- หลุมฝังศพของงานที่ถูกลบ (เปิดใบกลับมาแก้ / ยกเลิกใบ) ใช้ base = '' และ code = รหัสงาน
alter table public.bom_deleted_keys drop constraint bom_deleted_keys_list_check;
alter table public.bom_deleted_keys add constraint bom_deleted_keys_list_check check (list in ('colorSets', 'packages', 'jobs'));

create index bom_customers_changed_idx on public.bom_customers (is_test, changed_version);
create index bom_orders_changed_idx on public.bom_orders (is_test, changed_version);
create index bom_jobs_changed_idx on public.bom_jobs (is_test, changed_version);
comment on column public.bom_customers.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู bom_items.changed_version)';
comment on column public.bom_orders.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด รวมที่เซิร์ฟเวอร์ตั้งเอง เช่น เปลี่ยนเป็น in_progress เมื่องานเริ่ม (ดู bom_items.changed_version)';
comment on column public.bom_jobs.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู bom_items.changed_version)';

-- แยกโหมด + ประทับเวอร์ชัน (ฟังก์ชัน trigger เดิมของ 20261105010000)
do $$
declare
  v_table text;
begin
  foreach v_table in array array['bom_customers', 'bom_orders', 'bom_jobs'] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.sandbox_row_scope()', v_table || '_sandbox_scope', v_table);
    execute format(
      'create trigger %I before insert or update on public.%I '
      'for each row execute function private.bom_stamp_version()', v_table || '_stamp_version', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;

select private.lab_only_guard_table('public.bom_customers');
select private.lab_only_guard_table('public.bom_orders');
select private.lab_only_guard_table('public.bom_jobs');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (นิยามจาก 20261105010000_bom_master_data.sql ทุกชื่อ แล้วเพิ่ม bom_customers, bom_orders, bom_jobs)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 2. ฟังก์ชันช่วย (private) -----------------------------------------------------------------
-- ชื่อ action ของ client (modules/bom-actions.js api) ที่เขียนข้อมูลได้ ใช้ตรวจ p_action (นิยามจาก 20261105010000 แล้วเพิ่มของใบสั่งผลิต งาน นับคงคลัง ลูกค้า)
create or replace function private.bom_client_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['saveItem', 'saveBom', 'saveBomTree', 'linkCompound', 'importFlat',
    'saveColor', 'saveColorSet', 'removeColorSet', 'learnColorSet', 'savePackage', 'removePackage', 'createVariant',
    'saveRouting', 'saveProcess', 'setItemCost', 'setItemImage',
    'createOrder', 'addOrderItem', 'removeOrderItem', 'updateOrderItem', 'explodeOrder', 'releaseOrder',
    'setStockCount', 'setStockCounts', 'cancelOrder', 'completeOrder',
    'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'saveCustomer']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- action ที่คนนอกกลุ่มวางแผนเรียกได้ (นับคงคลัง ST/WH, รายงานงานของแผนก) action อื่นที่ไม่ใช่กลุ่มวางแผน = BOM_FORBIDDEN ทันที
-- เป็นด่านหยาบ: สิทธิ์จริงตรวจรายส่วนและรายช่องใน app_bom_save_master
create or replace function private.bom_staff_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['setStockCount', 'setStockCounts', 'reportJob', 'setJobStatus', 'linkJobToRubberFlow']
$$;
revoke all on function private.bom_staff_actions() from public, anon, authenticated;

-- รหัสแผนกของพนักงาน (ใช้ตรวจ "พนักงานแผนก X")
create or replace function private.bom_dept_of(p_employee public.employees)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.code from public.departments d where d.id = p_employee.department_id
$$;
revoke all on function private.bom_dept_of(public.employees) from public, anon, authenticated;

-- งานของใบที่ "เริ่มแล้ว" (กฎเดียวกับ startedJobs ใน modules/bom-actions.js): สถานะไม่ใช่ queued หรือมีรายงาน ยอดดี/เสีย หรือผูก WO
create or replace function private.bom_started_jobs(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bom_jobs j
    where j.is_test and j.order_pk = p_order
      and (j.status <> 'queued' or j.qty_done > 0 or j.qty_reject > 0 or jsonb_array_length(j.reports) > 0 or j.external_ref is not null))
$$;
revoke all on function private.bom_started_jobs(uuid) from public, anon, authenticated;

-- ลบงานทั้งหมดของใบ (ยกเลิก / เปิดใบกลับมาแก้) พร้อมจดหลุมฝังศพให้ delta คืนจำนวนที่ลบ
create or replace function private.bom_delete_order_jobs(p_order uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with d as (delete from public.bom_jobs j where j.is_test and j.order_pk = p_order returning j.job_no)
  insert into public.bom_deleted_keys (is_test, list, base, code)
  select true, 'jobs', '', d.job_no from d
  on conflict (list, base, code, is_test) do update set deleted_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.bom_delete_order_jobs(uuid) from public, anon, authenticated;

-- รายการสินค้าในใบ: [{fgCode, qty, colorSet, note}] ชิ้นต้องมีอยู่และเป็น FG ซ้ำในใบเดียวกันไม่ได้
create or replace function private.bom_parse_order_items(p_node jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_code text;
  v_qty numeric;
  v_kind text;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' or jsonb_array_length(p_node) > 500 then
    raise exception 'BOM_INVALID_ORDER';
  end if;
  for v_item in select value from jsonb_array_elements(p_node) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
    v_code := private.bom_code(private.bom_text(v_item, 'fgCode', 60, 1, 'BOM_INVALID_ORDER'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_ORDER'; end if;
    v_seen := v_seen || v_code;
    v_qty := private.bom_num(v_item -> 'qty', 'BOM_INVALID_ORDER', 0, 1000000000);
    if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_ORDER'; end if;
    select i.kind into v_kind from public.bom_items i where i.is_test and i.code = v_code;
    if not found then raise exception 'BOM_ITEM_NOT_FOUND'; end if;
    if v_kind <> 'FG' then raise exception 'BOM_INVALID_ITEM'; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'fgCode', v_code, 'qty', v_qty,
      'colorSet', private.bom_text(v_item, 'colorSet', 10, 0, 'BOM_INVALID_ORDER'),
      'note', private.bom_text(v_item, 'note', 120, 0, 'BOM_INVALID_ORDER')));
  end loop;
  return v_out;
end;
$$;
revoke all on function private.bom_parse_order_items(jsonb) from public, anon, authenticated;

-- ยอดคงคลังที่นับ: { รหัสชิ้น: ยอด >= 0 } ไม่เกิน 5,000 รหัส
create or replace function private.bom_parse_stock_counts(p_node jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
  v_out jsonb := '{}'::jsonb;
  v_code text;
  v_qty numeric;
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(p_node) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
  if (select count(*) from jsonb_object_keys(p_node)) > 5000 then raise exception 'BOM_TOO_MANY'; end if;
  for v_key, v_val in select key, value from jsonb_each(p_node) loop
    v_code := private.bom_code(v_key);
    if char_length(v_code) not between 1 and 60 or (v_out -> v_code) is not null then raise exception 'BOM_INVALID_ORDER'; end if;
    v_qty := private.bom_num(v_val, 'BOM_INVALID_ORDER', 0, 1000000000);
    if v_qty is null then raise exception 'BOM_INVALID_ORDER'; end if;
    v_out := v_out || jsonb_build_object(v_code, v_qty);
  end loop;
  return v_out;
end;
$$;
revoke all on function private.bom_parse_stock_counts(jsonb) from public, anon, authenticated;

-- กำหนดเสร็จรายแผนก: { RB: ms, ... } คีย์เป็นรหัสแผนก 2 ตัวอักษร ค่าเป็นจำนวนเต็มมิลลิวินาที
create or replace function private.bom_parse_due(p_node jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
  v_out jsonb := '{}'::jsonb;
  v_ms numeric;
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(p_node) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
  for v_key, v_val in select key, value from jsonb_each(p_node) loop
    if v_key !~ '^[A-Z]{2}$' then raise exception 'BOM_INVALID_ORDER'; end if;
    if jsonb_typeof(v_val) = 'null' then continue; end if;
    v_ms := private.bom_num(v_val, 'BOM_INVALID_ORDER', 1, 100000000000000);
    if v_ms <> trunc(v_ms) then raise exception 'BOM_INVALID_ORDER'; end if;
    v_out := v_out || jsonb_build_object(v_key, v_ms::bigint);
  end loop;
  return v_out;
end;
$$;
revoke all on function private.bom_parse_due(jsonb) from public, anon, authenticated;

-- ผลระเบิด BOM: null หรืออาร์เรย์ไม่เกิน 5,000 บรรทัด แต่ละบรรทัดเป็น object มี itemCode (ข้อความ) ไม่เกิน 4,000 ตัวอักษร รวมไม่เกิน 3,000,000
create or replace function private.bom_parse_explosion(p_node jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line jsonb;
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then return null; end if;
  if jsonb_typeof(p_node) <> 'array' or jsonb_array_length(p_node) > 5000 then raise exception 'BOM_INVALID_ORDER'; end if;
  if octet_length(p_node::text) > 3000000 then raise exception 'BOM_TOO_LARGE'; end if;
  for v_line in select value from jsonb_array_elements(p_node) loop
    if jsonb_typeof(v_line) <> 'object' or jsonb_typeof(v_line -> 'itemCode') is distinct from 'string'
       or char_length(v_line ->> 'itemCode') not between 1 and 60 or octet_length(v_line::text) > 4000 then
      raise exception 'BOM_INVALID_ORDER';
    end if;
  end loop;
  return p_node;
end;
$$;
revoke all on function private.bom_parse_explosion(jsonb) from public, anon, authenticated;

-- รายงานผลของงาน: ต่อท้ายเท่านั้น รายการเดิมต้องเหมือนเดิมทุกช่อง (BOM_FORBIDDEN) รายการใหม่: good/reject >= 0 ไม่ใช่ศูนย์ทั้งคู่ note <= 200
-- by = ชื่อ persona และ at = เวลาเซิร์ฟเวอร์ (ไม่เชื่อ client)
create or replace function private.bom_parse_reports(p_node jsonb, p_old jsonb, p_actor_name text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_node jsonb := p_node;
  v_old_n integer := coalesce(jsonb_array_length(p_old), 0);
  v_entry jsonb;
  v_i bigint;
  v_out jsonb := '[]'::jsonb;
  v_good numeric;
  v_reject numeric;
begin
  if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
  if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 1000 then raise exception 'BOM_INVALID_JOB'; end if;
  if jsonb_array_length(v_node) < v_old_n then raise exception 'BOM_FORBIDDEN'; end if;
  for v_entry, v_i in select t.value, t.ord from jsonb_array_elements(v_node) with ordinality as t(value, ord) loop
    if jsonb_typeof(v_entry) <> 'object' then raise exception 'BOM_INVALID_JOB'; end if;
    v_good := coalesce(private.bom_num(v_entry -> 'good', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_reject := coalesce(private.bom_num(v_entry -> 'reject', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    if v_i <= v_old_n then
      -- รายการเดิม: ต้องเท่าของเดิมทุกช่อง
      if v_good <> (p_old -> (v_i - 1)::integer ->> 'good')::numeric
         or v_reject <> (p_old -> (v_i - 1)::integer ->> 'reject')::numeric
         or private.bom_text(v_entry, 'note', 200, 0, 'BOM_INVALID_JOB') <> coalesce(p_old -> (v_i - 1)::integer ->> 'note', '')
         or private.bom_text(v_entry, 'by', 120, 0, 'BOM_INVALID_JOB') <> coalesce(p_old -> (v_i - 1)::integer ->> 'by', '')
         or private.bom_num(v_entry -> 'at', 'BOM_INVALID_JOB', 0, 1000000000000000) is distinct from (p_old -> (v_i - 1)::integer ->> 'at')::numeric then
        raise exception 'BOM_FORBIDDEN';
      end if;
      v_out := v_out || jsonb_build_array(p_old -> (v_i - 1)::integer);
    else
      if v_good = 0 and v_reject = 0 then raise exception 'BOM_INVALID_JOB'; end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'at', private.bom_ms(now()), 'by', p_actor_name, 'good', v_good, 'reject', v_reject,
        'note', private.bom_text(v_entry, 'note', 200, 0, 'BOM_INVALID_JOB')));
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function private.bom_parse_reports(jsonb, jsonb, text) from public, anon, authenticated;

-- การผูก WO ของ RubberFlow: null หรือ { system: 'rubberflow', woId, kg } (linkedAt / by เซิร์ฟเวอร์ตั้งตอนผูกครั้งแรก)
create or replace function private.bom_parse_external_ref(p_node jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then return null; end if;
  if jsonb_typeof(p_node) <> 'object' or private.bom_text(p_node, 'system', 40, 1, 'BOM_INVALID_JOB') <> 'rubberflow' then
    raise exception 'BOM_INVALID_JOB';
  end if;
  return jsonb_build_object(
    'system', 'rubberflow',
    'woId', private.bom_text(p_node, 'woId', 40, 1, 'BOM_INVALID_JOB'),
    'kg', coalesce(private.bom_num(p_node -> 'kg', 'BOM_INVALID_JOB', 0, 1000000000), 0));
end;
$$;
revoke all on function private.bom_parse_external_ref(jsonb) from public, anon, authenticated;

-- 3. ตัวเขียนลูกค้า ใบสั่งผลิต งาน (เรียกจาก app_bom_save_master เท่านั้น) ----------------------------
-- ลูกค้า (กลุ่มวางแผนเท่านั้น ตรวจก่อนเรียก): เขียนซ้ำค่าเดิมทุกช่อง = ไม่ทำอะไร (ผู้วางแผนสองคนเพิ่มลูกค้าชื่อเดียวกันพร้อมกันไม่ชนกัน)
create or replace function private.bom_save_customers(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_name text;
  v_key text;
  v_country text;
  v_type text;
  v_note text;
  v_seen text[] := '{}';
  v_old public.bom_customers%rowtype;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_CUSTOMER'; end if;
    v_name := btrim(regexp_replace(private.bom_text(v_row, 'name', 120, 1, 'BOM_INVALID_CUSTOMER'), '\s+', ' ', 'g'));
    v_key := lower(v_name);
    if v_key = any (v_seen) then raise exception 'BOM_INVALID_CUSTOMER'; end if;
    v_seen := v_seen || v_key;
    v_country := private.bom_text(v_row, 'country', 60, 0, 'BOM_INVALID_CUSTOMER');
    v_type := upper(private.bom_text(v_row, 'orderType', 2, 0, 'BOM_INVALID_CUSTOMER'));
    if v_type not in ('', 'SA', 'EX') then raise exception 'BOM_INVALID_CUSTOMER'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_CUSTOMER');

    select * into v_old from public.bom_customers c where c.is_test and lower(c.name) = v_key;
    if found then
      if v_old.name = v_name and v_old.country = v_country and v_old.order_type is not distinct from nullif(v_type, '') and v_old.note = v_note then
        continue;
      end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
      update public.bom_customers set
        name = v_name, country = v_country, order_type = nullif(v_type, ''), note = v_note, updated_by = p_actor, updated_at = now()
      where id = v_old.id;
    else
      insert into public.bom_customers (is_test, name, country, order_type, note, created_by, updated_by)
      values (true, v_name, v_country, nullif(v_type, ''), v_note, p_actor, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.bom_save_customers(uuid, jsonb, bigint, bigint) from public, anon, authenticated;

-- ใบสั่งผลิต: สิทธิ์รายช่อง + กฎเปลี่ยนสถานะ (ดูหัวไฟล์) คืนรหัสแถวของใบที่ draft -> released ในคำสั่งนี้ (ใช้ตรวจว่ามีงาน และอนุญาตให้เพิ่มงาน)
-- p_planner = กลุ่มวางแผน · p_job_rows = งานที่ส่งมา (upsert) ในคำสั่งเดียวกัน ใช้ยอมรับ released -> in_progress ที่มาพร้อมงาน
create or replace function private.bom_save_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_job_rows jsonb, p_base bigint, p_cur bigint)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_seen text[] := '{}';
  v_released uuid[] := '{}';
  v_dept text := private.bom_dept_of(p_actor);
  v_pi text;
  v_customer text;
  v_country text;
  v_type text;
  v_ordered numeric;
  v_wh numeric;
  v_due jsonb;
  v_defaults jsonb;
  v_items jsonb;
  v_expl jsonb;
  v_counts jsonb;
  v_note text;
  v_status text;
  v_reason text;
  v_old public.bom_orders%rowtype;
  v_content boolean;
  v_counts_changed boolean;
  v_status_changed boolean;
  v_revision integer;
  v_reopen boolean;
  v_has_job boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
    v_pi := upper(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ORDER'));
    if v_pi ~ '[[:cntrl:]]' or v_pi = any (v_seen) then raise exception 'BOM_INVALID_ORDER'; end if;
    v_seen := v_seen || v_pi;
    -- ชื่อลูกค้าบนใบใช้การจัดรูปเดียวกับตาราง bom_customers (ช่องว่างซ้ำรวมเป็นช่องเดียว ตัดหัวท้าย) client ใช้กฎเดียวกันกับกุญแจ
    v_customer := btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'BOM_INVALID_ORDER'), '\s+', ' ', 'g'));
    v_country := private.bom_text(v_row, 'country', 60, 1, 'BOM_INVALID_ORDER');
    v_type := upper(private.bom_text(v_row, 'orderType', 2, 1, 'BOM_INVALID_ORDER'));
    if v_type not in ('SA', 'EX') then raise exception 'BOM_INVALID_ORDER'; end if;
    v_ordered := private.bom_num(v_row -> 'orderedAt', 'BOM_INVALID_ORDER', 1, 100000000000000);
    v_wh := private.bom_num(v_row -> 'whDue', 'BOM_INVALID_ORDER', 1, 100000000000000);
    if v_ordered is null or v_wh is null or v_ordered <> trunc(v_ordered) or v_wh <> trunc(v_wh) or v_wh < v_ordered then
      raise exception 'BOM_INVALID_ORDER';
    end if;
    v_due := private.bom_parse_due(v_row -> 'due');
    v_node := v_row -> 'dueDefaults';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 10 then raise exception 'BOM_INVALID_ORDER'; end if;
    v_defaults := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or (v_el #>> '{}') !~ '^[A-Z]{2}$' then raise exception 'BOM_INVALID_ORDER'; end if;
      v_defaults := v_defaults || jsonb_build_array(v_el);
    end loop;
    v_items := private.bom_parse_order_items(v_row -> 'items');
    v_expl := private.bom_parse_explosion(v_row -> 'explosion');
    v_counts := private.bom_parse_stock_counts(v_row -> 'stockCounts');
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_ORDER');
    v_reason := private.bom_text(v_row, 'cancelReason', 200, 0, 'BOM_INVALID_ORDER');
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_ORDER');
    if v_status not in ('draft', 'released', 'in_progress', 'completed', 'cancelled') then raise exception 'BOM_INVALID_ORDER'; end if;

    select * into v_old from public.bom_orders o where o.is_test and o.pi_no = v_pi;
    if not found then
      -- ใบใหม่: กลุ่มวางแผนเท่านั้น เริ่มที่ draft เสมอ (revision 0, ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_orders (
        is_test, pi_no, customer, country, order_type, ordered_at, wh_due, due, due_defaults, revision, status, items, explosion,
        exploded_at, stock_counts, note, stock_counted_at, stock_counted_by, created_by)
      values (
        true, v_pi, v_customer, v_country, v_type, v_ordered::bigint, v_wh::bigint, v_due, v_defaults, 0, 'draft', v_items, v_expl,
        case when v_expl is null then null else now() end, v_counts, v_note,
        case when v_counts = '{}'::jsonb then null else now() end,
        case when v_counts = '{}'::jsonb then null else p_actor.id end, p_actor.id);
      continue;
    end if;

    -- ชนก่อนเสมอ: ใบถูกคนอื่นแก้หลังเวอร์ชันฐาน = ฝั่ง client ถือสำเนาเก่า (เทียบสิทธิ์/เนื้อหากับแถวล่าสุดไม่ได้ ไม่งั้นสำเนาเก่าถูกมองเป็นการแก้ที่ไม่มีสิทธิ์) ให้ตามทันแล้วทำใหม่
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;

    v_content := v_old.customer <> v_customer or v_old.country <> v_country or v_old.order_type <> v_type
      or v_old.ordered_at <> v_ordered::bigint or v_old.wh_due <> v_wh::bigint or v_old.due <> v_due
      or v_old.due_defaults <> v_defaults or v_old.items <> v_items or v_old.explosion is distinct from v_expl or v_old.note <> v_note;
    v_counts_changed := v_old.stock_counts <> v_counts;
    v_status_changed := v_old.status <> v_status;
    if not (v_content or v_counts_changed or v_status_changed) then continue; end if;

    -- released -> in_progress เกิดเองเมื่องานเริ่ม (ตั้งตอนบันทึกงาน) ยอมรับเมื่อมาพร้อมงานของใบนี้ ข้ามไม่เขียน
    if v_status_changed and v_old.status = 'released' and v_status = 'in_progress' and not v_content and not v_counts_changed then
      v_has_job := exists (select 1 from jsonb_array_elements(p_job_rows) j where upper(btrim(coalesce(j.value ->> 'orderId', ''))) = v_pi);
      if not v_has_job then raise exception 'BOM_INVALID_TRANSITION'; end if;
      continue;
    end if;

    -- สิทธิ์: กลุ่มวางแผนแก้ได้ทุกอย่าง · ST/WH แก้ได้เฉพาะ stockCounts ของใบ draft · คนอื่นแก้ไม่ได้
    if not p_planner then
      if v_content or v_status_changed or v_dept is null or v_dept not in ('ST', 'WH') then raise exception 'BOM_FORBIDDEN'; end if;
    end if;

    -- นับคงคลังได้เฉพาะใบ draft · ใบที่ไม่ใช่ draft แก้เนื้อหาไม่ได้ (เว้นแต่เปิดกลับเป็น draft)
    if v_counts_changed and v_old.status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_content and v_old.status <> 'draft' and v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;

    v_reopen := false;
    v_revision := v_old.revision;
    if v_status_changed then
      if v_old.status = 'draft' and v_status = 'released' then
        if jsonb_array_length(v_items) = 0 or v_expl is null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        v_released := v_released || v_old.id;
      elsif v_old.status = 'draft' and v_status = 'cancelled' then
        null;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'completed' then
        if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_old.id and j.dept = 'PK' and j.status <> 'done') then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'cancelled' then
        if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_old.id and (j.qty_done > 0 or j.external_ref is not null)) then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
        perform private.bom_delete_order_jobs(v_old.id);
      elsif v_old.status in ('released', 'in_progress') and v_status = 'draft' then
        -- เปิดใบกลับมาแก้ได้เมื่อไม่มีงานใดเริ่ม (ตรวจจากสถานะในฐานข้อมูล) งานทั้งหมดถูกลบ revision + 1 ยอดนับคงคลังคงอยู่
        if private.bom_started_jobs(v_old.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
        perform private.bom_delete_order_jobs(v_old.id);
        v_reopen := true;
        v_revision := v_old.revision + 1;
      else
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
    end if;

    update public.bom_orders set
      customer = v_customer, country = v_country, order_type = v_type, ordered_at = v_ordered::bigint, wh_due = v_wh::bigint,
      due = v_due, due_defaults = v_defaults, items = v_items, explosion = v_expl,
      exploded_at = case when v_reopen or v_expl is null then null
                         when v_old.explosion is distinct from v_expl or v_old.exploded_at is null then now()
                         else v_old.exploded_at end,
      stock_counts = v_counts,
      stock_counted_at = case when v_counts_changed then now() else v_old.stock_counted_at end,
      stock_counted_by = case when v_counts_changed then p_actor.id else v_old.stock_counted_by end,
      note = v_note, status = v_status, revision = v_revision,
      released_at = case when v_status = 'released' and v_status_changed then now() when v_reopen then null else v_old.released_at end,
      released_by = case when v_status = 'released' and v_status_changed then p_actor.id when v_reopen then null else v_old.released_by end,
      completed_at = case when v_status = 'completed' and v_status_changed then now() else v_old.completed_at end,
      cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else v_old.cancelled_at end,
      cancel_reason = case when v_status = 'cancelled' and v_status_changed then v_reason else v_old.cancel_reason end,
      updated_at = now()
    where id = v_old.id;
  end loop;
  return v_released;
end;
$$;
revoke all on function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;

-- ลบงานตรง ๆ (กลุ่มวางแผนเท่านั้น): ที่เซิร์ฟเวอร์ลบไปแล้วในคำสั่งเดียวกัน (ยกเลิก/เปิดใบกลับมาแก้) ข้ามได้ · งานที่เริ่มแล้วลบไม่ได้
create or replace function private.bom_delete_jobs(p_planner boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_no text;
  v_job public.bom_jobs%rowtype;
  v_n integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
    if jsonb_typeof(v_row) = 'string' then
      v_no := btrim(v_row #>> '{}');
    elsif jsonb_typeof(v_row) = 'object' then
      v_no := coalesce(nullif(private.bom_text(v_row, 'id', 40, 0, 'BOM_INVALID_JOB'), ''), private.bom_text(v_row, 'code', 40, 0, 'BOM_INVALID_JOB'));
    else
      raise exception 'BOM_INVALID_JOB';
    end if;
    if v_no is null or v_no !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'BOM_INVALID_JOB'; end if;
    select * into v_job from public.bom_jobs j where j.is_test and j.job_no = v_no;
    if not found then
      -- ถูกลบในคำสั่งเดียวกัน (changed_version > p_cur) = ข้าม · ถูกคนอื่นลบหลังเวอร์ชันฐาน = BOM_STALE · ไม่เคยมี = BOM_NOT_FOUND
      if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no and k.changed_version > p_cur) then
        continue;
      end if;
      if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no
                 and k.changed_version > p_base and k.changed_version <= p_cur) then
        raise exception 'BOM_STALE';
      end if;
      raise exception 'BOM_NOT_FOUND';
    end if;
    if v_job.changed_version > p_base and v_job.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    if v_job.status <> 'queued' or v_job.qty_done > 0 or v_job.qty_reject > 0 or jsonb_array_length(v_job.reports) > 0 or v_job.external_ref is not null then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    delete from public.bom_jobs where id = v_job.id;
    insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'jobs', '', v_no)
    on conflict (list, base, code, is_test) do update set deleted_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_delete_jobs(boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- งานรายแผนก: เพิ่มงาน = กลุ่มวางแผน เฉพาะใบที่ปล่อยผลิตในคำสั่งเดียวกัน (p_released) · แก้งานตามสิทธิ์รายช่อง (ดูหัวไฟล์)
-- คืนรหัสแถวของใบที่ต้องเปลี่ยนจาก released เป็น in_progress (มีงานเริ่มแล้ว)
create or replace function private.bom_save_jobs(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_released uuid[], p_base bigint, p_cur bigint)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_seen text[] := '{}';
  v_started uuid[] := '{}';
  v_dept_actor text := private.bom_dept_of(p_actor);
  v_no text;
  v_ord public.bom_orders%rowtype;
  v_dept text;
  v_item text;
  v_name text;
  v_kind text;
  v_uom text;
  v_planned numeric;
  v_required numeric;
  v_stock numeric;
  v_done numeric;
  v_reject numeric;
  v_due numeric;
  v_status text;
  v_fg jsonb;
  v_ext jsonb;
  v_reports jsonb;
  v_old public.bom_jobs%rowtype;
  v_struct boolean;
  v_work boolean;
  v_ext_changed boolean;
  v_good numeric;
  v_rej numeric;
  v_ext_stored jsonb;
  v_done_at timestamptz;
  v_present boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_JOB'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_JOB');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' or v_no = any (v_seen) then raise exception 'BOM_INVALID_JOB'; end if;
    v_seen := v_seen || v_no;
    select * into v_ord from public.bom_orders o
    where o.is_test and o.pi_no = upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_JOB'));
    if not found then raise exception 'BOM_INVALID_JOB'; end if;
    v_dept := private.bom_dept(private.bom_text(v_row, 'dept', 10, 1, 'BOM_INVALID_DEPT'));
    v_item := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_JOB'));
    v_name := private.bom_text(v_row, 'name', 160, 1, 'BOM_INVALID_JOB');
    v_kind := private.bom_text(v_row, 'kind', 20, 1, 'BOM_INVALID_JOB');
    if v_kind not in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP') then raise exception 'BOM_INVALID_JOB'; end if;
    v_uom := private.bom_text(v_row, 'uom', 20, 1, 'BOM_INVALID_JOB');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_JOB'; end if;
    v_planned := private.bom_num(v_row -> 'qtyPlanned', 'BOM_INVALID_JOB', 0, 1000000000);
    v_required := private.bom_num(v_row -> 'qtyRequired', 'BOM_INVALID_JOB', 0, 1000000000);
    if v_planned is null or v_required is null then raise exception 'BOM_INVALID_JOB'; end if;
    v_stock := private.bom_num(v_row -> 'stockCounted', 'BOM_INVALID_JOB', 0, 1000000000);
    v_done := coalesce(private.bom_num(v_row -> 'qtyDone', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_reject := coalesce(private.bom_num(v_row -> 'qtyReject', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_due := private.bom_num(v_row -> 'dueAt', 'BOM_INVALID_JOB', 1, 100000000000000);
    if v_due is not null and v_due <> trunc(v_due) then raise exception 'BOM_INVALID_JOB'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_JOB');
    if v_status not in ('queued', 'in_progress', 'done', 'hold') then raise exception 'BOM_INVALID_JOB'; end if;
    v_node := v_row -> 'fgCodes';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 500 then raise exception 'BOM_INVALID_JOB'; end if;
    v_fg := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or char_length(btrim(v_el #>> '{}')) not between 1 and 60 then raise exception 'BOM_INVALID_JOB'; end if;
      v_fg := v_fg || jsonb_build_array(private.bom_code(v_el #>> '{}'));
    end loop;
    v_ext := private.bom_parse_external_ref(v_row -> 'externalRef');

    select * into v_old from public.bom_jobs j where j.is_test and j.job_no = v_no;
    -- ชนก่อนสิทธิ์/รูปเสมอ: งานถูกคนอื่นแก้หลังเวอร์ชันฐาน หรือถูกลบหลังเวอร์ชันฐาน (เปิดใบกลับมาแก้ / ยกเลิก) = ฝั่ง client ถือสำเนาเก่า
    -- เทียบกับแถวล่าสุดแล้วตัดสินว่าไม่มีสิทธิ์ไม่ได้ (สองคนในแผนกเดียวกันรายงานงานเดียวกันจากฐานเดียวกัน คนที่สองต้องได้ BOM_STALE ไม่ใช่ BOM_FORBIDDEN)
    v_present := found;
    if v_present then
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    elsif exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no
                  and k.changed_version > p_base and k.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    if not v_present then
      -- งานใหม่: เกิดตอนปล่อยผลิตเท่านั้น (ใบ draft -> released ในคำสั่งเดียวกัน) เริ่มที่ queued ว่าง
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if not (v_ord.id = any (p_released)) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_status <> 'queued' or v_done <> 0 or v_reject <> 0 or v_ext is not null
         or jsonb_array_length(private.bom_parse_reports(v_row -> 'reports', '[]'::jsonb, p_actor_name)) > 0 then
        raise exception 'BOM_INVALID_JOB';
      end if;
      delete from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no;
      insert into public.bom_jobs (
        is_test, job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required, stock_counted, due_at, fg_codes, created_by)
      values (true, v_no, v_ord.id, v_dept, v_item, v_name, v_kind, v_uom, v_planned, v_required, v_stock, v_due::bigint, v_fg, p_actor.id);
      continue;
    end if;

    v_reports := private.bom_parse_reports(v_row -> 'reports', v_old.reports, p_actor_name);
    v_struct := v_old.dept <> v_dept or v_old.item_code <> v_item or v_old.name <> v_name
      or v_old.kind <> v_kind or v_old.uom <> v_uom or v_old.qty_planned <> v_planned or v_old.qty_required <> v_required
      or v_old.stock_counted is distinct from v_stock or v_old.due_at is distinct from v_due::bigint or v_old.fg_codes <> v_fg;
    v_work := v_old.status <> v_status or v_old.qty_done <> v_done or v_old.qty_reject <> v_reject or v_old.reports <> v_reports;
    v_ext_changed := (v_old.external_ref is null) <> (v_ext is null)
      or (v_ext is not null and (v_old.external_ref - 'linkedAt' - 'by') <> v_ext);
    if not (v_struct or v_work or v_ext_changed) then continue; end if;

    -- สิทธิ์รายช่อง
    if not p_planner then
      -- แผนกอื่นแก้ชื่อ จำนวนแผน วันครบกำหนด ชิ้นงาน ใบ ฯลฯ ไม่ได้
      if v_struct then raise exception 'BOM_FORBIDDEN'; end if;
      -- รายงาน/สถานะ/ยอด: พนักงานแผนกเดียวกับงาน (ทุกบทบาท)
      if v_work and v_dept_actor is distinct from v_old.dept then raise exception 'BOM_FORBIDDEN'; end if;
      -- ผูก WO: พนักงานแผนก RB เฉพาะงานที่ยังไม่ผูก
      if v_ext_changed and (v_dept_actor is distinct from 'RB' or v_old.external_ref is not null or v_ext is null) then
        raise exception 'BOM_FORBIDDEN';
      end if;
    end if;
    if v_old.order_pk <> v_ord.id then raise exception 'BOM_INVALID_JOB'; end if; -- ย้ายงานไปใบอื่นไม่ได้
    -- แก้งานได้เฉพาะใบที่ปล่อยผลิตแล้วและยังไม่ปิด (อ่านสถานะล่าสุดหลังเปลี่ยนสถานะใบในคำสั่งนี้)
    select * into v_ord from public.bom_orders o where o.id = v_old.order_pk;
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_ext_changed and v_ext is not null and v_old.dept <> 'RB' then raise exception 'BOM_INVALID_JOB'; end if;

    if not p_planner and v_work then
      -- งานที่ done แล้วพนักงานแผนกแก้ไม่ได้ · ยอดเพิ่มได้อย่างเดียวและต้องมาพร้อมรายงาน (ผลรวมดี/เสียของรายการใหม่เท่าส่วนที่เพิ่ม)
      if v_old.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_done < v_old.qty_done or v_reject < v_old.qty_reject then raise exception 'BOM_INVALID_JOB'; end if;
      select coalesce(sum((t.value ->> 'good')::numeric), 0), coalesce(sum((t.value ->> 'reject')::numeric), 0)
      into v_good, v_rej
      from jsonb_array_elements(v_reports) with ordinality as t(value, ord)
      where t.ord > jsonb_array_length(v_old.reports);
      if abs((v_done - v_old.qty_done) - v_good) > 0.001 or abs((v_reject - v_old.qty_reject) - v_rej) > 0.001 then
        raise exception 'BOM_INVALID_JOB';
      end if;
    end if;

    v_done_at := case when v_status = 'done' then coalesce(v_old.done_at, now()) else null end;
    v_ext_stored := case
      when not v_ext_changed then v_old.external_ref
      when v_ext is null then null
      else v_ext || jsonb_build_object('linkedAt', private.bom_ms(now()), 'by', p_actor_name) end;
    update public.bom_jobs set
      dept = v_dept, item_code = v_item, name = v_name, kind = v_kind, uom = v_uom, qty_planned = v_planned, qty_required = v_required,
      stock_counted = v_stock, due_at = v_due::bigint, fg_codes = v_fg, status = v_status, qty_done = v_done, qty_reject = v_reject,
      reports = v_reports, external_ref = v_ext_stored, done_at = v_done_at, updated_at = now()
    where id = v_old.id;

    -- งานเริ่มแล้ว (ไม่ใช่ queued ว่าง) -> ใบ released เปลี่ยนเป็น in_progress
    if v_ord.status = 'released'
       and (v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0 or v_ext_stored is not null) then
      v_started := v_started || v_ord.id;
    end if;
  end loop;
  return v_started;
end;
$$;
revoke all on function private.bom_save_jobs(public.employees, text, boolean, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;

-- 4. snapshot / delta (นิยามจาก 20261105010000 แล้วเพิ่ม customers, orders, jobs) -------------------
-- ระเบียนที่ changed_version > p_since ในรูป state v6 (camelCase) แยกตามชุด เรียงแบบกำหนดได้ · p_since = -1 ได้ทั้งหมด (snapshot)
create or replace function private.bom_records(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', i.code, 'kind', i.kind, 'name', i.name, 'ownerDept', i.owner_dept, 'uom', i.uom,
          'weightG', i.weight_g, 'rubber', i.rubber, 'legacyCodes', i.legacy_codes, 'active', i.active,
          'group', i.item_group, 'createdAt', private.bom_ms(i.created_at), 'updatedAt', private.bom_ms(i.updated_at))
        || case when i.unit_cost is null then '{}'::jsonb else jsonb_build_object('unitCost', i.unit_cost) end
        || case when i.image is null then '{}'::jsonb else jsonb_build_object('image', i.image) end
        || case when i.imported_from is null then '{}'::jsonb else jsonb_build_object('importedFrom', i.imported_from) end
        || case when i.cloned_from is null then '{}'::jsonb else jsonb_build_object('clonedFrom', i.cloned_from) end
        order by i.code collate "C")
      from public.bom_items i where i.is_test and i.changed_version > p_since), '[]'::jsonb),
    'compounds', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'name', c.name, 'recipeId', c.recipe_id, 'recipeName', c.recipe_name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_compounds c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'master', substr(c.code, 1, 2), 'shade', substr(c.code, 3, 2), 'name', c.name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_colors c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'colorSets', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', s.base, 'code', s.code, 'name', s.name, 'note', s.note, 'slots', s.slots,
          'createdAt', private.bom_ms(s.created_at), 'createdBy', coalesce(private.bom_person(s.created_by), ''),
          'updatedAt', private.bom_ms(s.updated_at), 'updatedBy', coalesce(private.bom_person(s.updated_by), ''))
        order by s.base collate "C", s.code collate "C")
      from public.bom_color_sets s where s.is_test and s.changed_version > p_since), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', p.base, 'code', p.code, 'name', p.name, 'lines', p.lines,
          'createdAt', private.bom_ms(p.created_at), 'createdBy', coalesce(private.bom_person(p.created_by), ''),
          'updatedAt', private.bom_ms(p.updated_at), 'updatedBy', coalesce(private.bom_person(p.updated_by), ''))
        order by p.base collate "C", p.code collate "C")
      from public.bom_packages p where p.is_test and p.changed_version > p_since), '[]'::jsonb),
    'boms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.bom_id, 'itemCode', b.item_code, 'revision', b.revision, 'status', b.status, 'ownerDept', b.owner_dept,
          'lines', private.bom_lines_json(b.id), 'createdBy', coalesce(private.bom_person(b.created_by), ''),
          'createdAt', private.bom_ms(b.created_at), 'approvedBy', coalesce(private.bom_person(b.approved_by), ''),
          'approvedAt', private.bom_ms(b.approved_at), 'note', b.note, 'changeLog', b.change_log)
        || case when b.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(b.superseded_at)) end
        order by b.bom_id collate "C")
      from public.bom_boms b where b.is_test and b.changed_version > p_since), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'dept', p.dept) order by p.code collate "C")
      from public.bom_processes p where p.is_test and p.changed_version > p_since), '[]'::jsonb),
    'routings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.routing_id, 'itemCode', r.item_code, 'revision', r.revision, 'status', r.status, 'steps', r.steps,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        order by r.routing_id collate "C")
      from public.bom_routings r where r.is_test and r.changed_version > p_since), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'name', c.name, 'country', c.country, 'orderType', c.order_type, 'note', c.note,
          'createdAt', private.bom_ms(c.created_at)) order by lower(c.name) collate "C", c.name collate "C")
      from public.bom_customers c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.pi_no, 'customer', o.customer, 'country', o.country, 'orderType', o.order_type,
          'orderedAt', o.ordered_at, 'whDue', o.wh_due, 'due', o.due, 'dueDefaults', o.due_defaults,
          'revision', o.revision, 'status', o.status, 'items', o.items, 'explosion', o.explosion,
          'explodedAt', private.bom_ms(o.exploded_at), 'stockCounts', o.stock_counts, 'note', o.note,
          'createdBy', coalesce(private.bom_person(o.created_by), ''), 'createdAt', private.bom_ms(o.created_at))
        || case when o.stock_counted_at is null then '{}'::jsonb
                else jsonb_build_object('stockCountedAt', private.bom_ms(o.stock_counted_at),
                                        'stockCountedBy', coalesce(private.bom_person(o.stock_counted_by), '')) end
        || case when o.released_at is null then '{}'::jsonb
                else jsonb_build_object('releasedAt', private.bom_ms(o.released_at),
                                        'releasedBy', coalesce(private.bom_person(o.released_by), '')) end
        || case when o.completed_at is null then '{}'::jsonb else jsonb_build_object('completedAt', private.bom_ms(o.completed_at)) end
        || case when o.cancelled_at is null then '{}'::jsonb
                else jsonb_build_object('cancelledAt', private.bom_ms(o.cancelled_at), 'cancelReason', o.cancel_reason) end
        order by o.ordered_at desc, o.pi_no collate "C")
      from public.bom_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', j.job_no, 'orderId', o.pi_no, 'dept', j.dept, 'itemCode', j.item_code, 'name', j.name, 'kind', j.kind, 'uom', j.uom,
          'qtyPlanned', j.qty_planned, 'qtyRequired', j.qty_required, 'stockCounted', j.stock_counted,
          'qtyDone', j.qty_done, 'qtyReject', j.qty_reject, 'dueAt', j.due_at, 'status', j.status,
          'externalRef', j.external_ref, 'fgCodes', j.fg_codes, 'reports', j.reports, 'createdAt', private.bom_ms(j.created_at))
        || case when j.done_at is null then '{}'::jsonb else jsonb_build_object('doneAt', private.bom_ms(j.done_at)) end
        order by o.pi_no collate "C", j.dept collate "C", j.item_code collate "C", j.job_no collate "C")
      from public.bom_jobs j join public.bom_orders o on o.id = j.order_pk
      where j.is_test and j.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

-- ส่วนต่างหลังเวอร์ชัน p_since: { version, epoch, changes: { <ชุด>: { upsert, delete } } } ครบทั้งสิบเอ็ดชุดเสมอ
-- delete ของ colorSets/packages = {base, code} · ของ jobs = {id, code} (ค่าเดียวกัน = รหัสงาน) · ชุดอื่นเป็น []
create or replace function private.bom_delta(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((select s.version from public.bom_master_state s where s.is_test), 0),
    'epoch', (select s.epoch from public.bom_master_state s where s.is_test),
    'changes', (
      select jsonb_object_agg(l.list, jsonb_build_object(
        'upsert', r.records -> l.list,
        'delete', case
          when l.list in ('colorSets', 'packages') then coalesce((
            select jsonb_agg(jsonb_build_object('base', k.base, 'code', k.code) order by k.base collate "C", k.code collate "C")
            from public.bom_deleted_keys k where k.is_test and k.list = l.list and k.changed_version > p_since), '[]'::jsonb)
          when l.list = 'jobs' then coalesce((
            select jsonb_agg(jsonb_build_object('id', k.code, 'code', k.code) order by k.code collate "C")
            from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.changed_version > p_since), '[]'::jsonb)
          else '[]'::jsonb end))
      from (values ('items'), ('compounds'), ('colors'), ('colorSets'), ('packages'), ('boms'), ('processes'), ('routings'),
                   ('customers'), ('orders'), ('jobs')) as l(list)
      cross join (select private.bom_records(p_since) as records) r))
$$;
revoke all on function private.bom_delta(bigint) from public, anon, authenticated;

-- snapshot ทั้งชุด: { version, epoch, items, ..., jobs } (นิยามจาก 20261105010000 แล้วเพิ่ม epoch)
create or replace function private.bom_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('version', coalesce((select s.version from public.bom_master_state s where s.is_test), 0),
                            'epoch', (select s.epoch from public.bom_master_state s where s.is_test))
         || private.bom_records(-1)
$$;
revoke all on function private.bom_snapshot() from public, anon, authenticated;

-- 5. RPC สาธารณะ -------------------------------------------------------------------------------
-- app_bom_master() และ app_bom_master_since(bigint) ใช้นิยามเดิมของ 20261105010000 (ผ่าน bom_snapshot / bom_delta ที่เพิ่มสามชุดข้างบน)

-- บันทึกชุดการเปลี่ยนแปลงในธุรกรรมเดียว (นิยามจาก 20261105010000 แล้วเพิ่มสามส่วน สิทธิ์รายส่วน/รายช่อง และ p_audit)
-- ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย คืน delta ตั้งแต่ p_base_version: { version, epoch, changes }
-- ไม่มีการเปลี่ยนแปลงเลย (ทุกส่วนว่าง) = คืน delta โดยไม่เพิ่ม version และไม่เขียน audit
drop function public.app_bom_save_master(jsonb, bigint, text);
create or replace function public.app_bom_save_master(
  p_changes jsonb, p_base_version bigint, p_action text, p_audit jsonb default '[]'::jsonb, p_epoch text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_actor_name text;
  v_planner boolean;
  v_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings',
                                      'customers', 'orders', 'jobs'];
  -- ส่วนที่เขียนได้เฉพาะกลุ่มวางแผน (orders / jobs ตรวจรายช่องในตัวเขียน)
  v_planner_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings',
                                              'customers'];
  v_key text;
  v_sub text;
  v_sec jsonb;
  v_node jsonb;
  v_n integer;
  v_total integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_audit jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_version bigint;
  v_epoch uuid;
  v_row jsonb;
  v_dbase text;
  v_dcode text;
  v_row_version bigint;
  v_item_codes text[] := '{}';
  v_roots text[] := '{}';
  v_touched text[];
  v_released uuid[] := '{}';
  v_started uuid[] := '{}';
  v_bad text;
begin
  perform private.lab_only_block();
  v_actor := private.bom_actor();
  v_planner := private.bom_can_edit(v_actor);
  -- ด่านหยาบ: คนนอกกลุ่มวางแผนเรียกได้เฉพาะ action ของนับคงคลัง/รายงานงาน (สิทธิ์จริงตรวจรายส่วนและรายช่องข้างล่าง)
  if not v_planner and (p_action is null or not (p_action = any (private.bom_staff_actions()))) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_action is null or not (p_action = any (private.bom_client_actions())) then raise exception 'BOM_INVALID_ACTION'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_base_version is null or p_base_version < 0 then
    raise exception 'BOM_INVALID_PAYLOAD';
  end if;

  -- audit ของ client: [{action, detail}] ไม่เกิน 20 รายการ
  if p_audit is not null and jsonb_typeof(p_audit) <> 'null' then
    if jsonb_typeof(p_audit) <> 'array' or jsonb_array_length(p_audit) > 20 then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_entry in select value from jsonb_array_elements(p_audit) loop
      if jsonb_typeof(v_entry) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'action', private.bom_text(v_entry, 'action', 80, 1, 'BOM_INVALID_PAYLOAD'),
        'detail', private.bom_text(v_entry, 'detail', 300, 0, 'BOM_INVALID_PAYLOAD')));
    end loop;
  end if;

  -- รูปของ payload: ส่วนที่รู้จัก, upsert (ทุกส่วน) / delete (เฉพาะ colorSets, packages และ jobs), เป็นอาร์เรย์ไม่เกิน 5,000 เรคอร์ดต่อส่วน
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_sections)) then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    v_sec := p_changes -> v_key;
    if jsonb_typeof(v_sec) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_sub in select jsonb_object_keys(v_sec) loop
      if not (v_sub = 'upsert' or (v_sub = 'delete' and v_key in ('colorSets', 'packages', 'jobs'))) then
        raise exception 'BOM_INVALID_PAYLOAD';
      end if;
      v_node := v_sec -> v_sub;
      if jsonb_typeof(v_node) <> 'array' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_n := jsonb_array_length(v_node);
      if v_n > 5000 then raise exception 'BOM_TOO_MANY'; end if;
      -- ข้อมูลหลักและลูกค้าเขียนได้เฉพาะกลุ่มวางแผน
      if v_n > 0 and v_key = any (v_planner_sections) and not v_planner then raise exception 'BOM_FORBIDDEN'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ล็อกตัวนับก่อนตรวจชน: บันทึกพร้อมกันต่อคิวกัน คนที่สองเห็นเวอร์ชันของระเบียนที่คนแรกเพิ่งแก้ (changed_version) แล้วได้ BOM_STALE เฉพาะที่ชนกัน
  -- v_version = เวอร์ชันก่อนบันทึกนี้ (p_cur ของตัวเขียน) ระเบียนที่แก้ในคำสั่งนี้ได้ v_version + 1 จึงไม่ถูกนับว่าเป็นของคนอื่น
  insert into public.bom_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version, s.epoch into v_version, v_epoch from public.bom_master_state s where s.is_test for update;
  -- client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร (ระเบียนที่มันถืออยู่ไม่มีแล้ว การบันทึกจะสร้างระเบียนที่ถูกล้างกลับมา)
  if p_epoch is not null and p_epoch <> v_epoch::text then raise exception 'BOM_RESET'; end if;
  if p_base_version > v_version then raise exception 'BOM_INVALID_PAYLOAD'; end if;
  if v_total = 0 then return private.bom_delta(p_base_version); end if;

  v_actor_name := v_actor.first_name || ' ' || v_actor.last_name;

  begin
    perform private.bom_save_compounds(v_actor.id, coalesce(p_changes #> '{compounds,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_colors(v_actor.id, coalesce(p_changes #> '{colors,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_processes(v_actor.id, coalesce(p_changes #> '{processes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_item_codes := private.bom_save_items(v_actor.id, coalesce(p_changes #> '{items,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลบก่อนเขียน (ลบแล้วสร้างใหม่รหัสเดิมในคำสั่งเดียวกันได้) ไม่พบ = BOM_NOT_FOUND แต่ถ้าคนอื่นเพิ่งลบหลังเวอร์ชันฐาน = BOM_STALE
    -- แถวที่คนอื่นแก้หลังเวอร์ชันฐานลบไม่ได้ (BOM_STALE) · ที่ลบแล้วจดหลุมฝังศพไว้ให้ delta
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{colorSets,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_COLOR_SET'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR_SET'));
      select s.changed_version into v_row_version from public.bom_color_sets s where s.is_test and s.base = v_dbase and s.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'colorSets' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_color_sets where is_test and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'colorSets', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{packages,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_PACKAGE'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_PACKAGE'));
      select p.changed_version into v_row_version from public.bom_packages p where p.is_test and p.base = v_dbase and p.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'packages' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_packages where is_test and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'packages', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;

    perform private.bom_save_color_sets(v_actor.id, coalesce(p_changes #> '{colorSets,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_packages(v_actor.id, coalesce(p_changes #> '{packages,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_roots := private.bom_save_boms(v_actor.id, v_actor_name, coalesce(p_changes #> '{boms,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_routings(v_actor.id, coalesce(p_changes #> '{routings,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลูกค้า → ใบสั่งผลิต (รวมเปลี่ยนสถานะ ลบงานของใบที่ยกเลิก/เปิดกลับมาแก้) → ลบงานตรง ๆ → งาน (เพิ่ม/แก้) ตามลำดับนี้เสมอ
    perform private.bom_save_customers(v_actor.id, coalesce(p_changes #> '{customers,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_released := private.bom_save_orders(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb),
                                          coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_delete_jobs(v_planner, coalesce(p_changes #> '{jobs,delete}', '[]'::jsonb), p_base_version, v_version);
    v_started := private.bom_save_jobs(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb),
                                       v_released, p_base_version, v_version);
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปล่อยผลิตต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้)
    if exists (select 1 from unnest(v_released) r(id) where not exists (select 1 from public.bom_jobs j where j.order_pk = r.id)) then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;

    -- ตรวจกฎ BOM หลังเขียนเฉพาะส่วนที่เกี่ยว: BOM ที่ approved ของชิ้นที่ถูกแก้/มี revision ใหม่ และ BOM ที่ใช้ชิ้นที่ถูกแก้เป็นลูก
    v_touched := v_item_codes || v_roots;
    if cardinality(v_touched) > 0 then
      -- ชนิดพ่อ/ลูก (rules.childKindError)
      select case when p.kind in ('PURCHASED', 'CP') then 'BOM_INVALID_PARENT_KIND' else 'BOM_INVALID_CHILD_KIND' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code
      join public.bom_bom_lines l on l.bom_pk = b.id
      join public.bom_items c on c.is_test and c.code = l.child_code
      where b.is_test and b.status = 'approved'
        and (b.item_code = any (v_touched) or l.child_code = any (v_touched))
        and (p.kind in ('PURCHASED', 'CP')
             or (p.kind = 'RB' and c.kind <> 'CP')
             or (c.kind = 'CP' and p.kind <> 'RB'))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;

      -- เส้นยาง: บรรทัดสูตรยางได้บรรทัดเดียว และต้องตรงกับ rubber.compound ของชิ้น (ถ้าระบุ)
      select case when x.n <> 1 then 'BOM_RB_ONE_COMPOUND' else 'BOM_RB_COMPOUND_MISMATCH' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code and p.kind = 'RB'
      cross join lateral (
        select count(*) as n, min(l.child_code) as child
        from public.bom_bom_lines l where l.bom_pk = b.id) x
      where b.is_test and b.status = 'approved' and b.item_code = any (v_touched)
        and (x.n <> 1
             or (coalesce(p.rubber ->> 'compound', '') <> '' and private.bom_code(p.rubber ->> 'compound') <> x.child))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;

    -- วงจร: เดินจากพ่อของ revision ใหม่ลงไปตาม BOM ที่ approved (วงจรใหม่เกิดจากเส้นใหม่เท่านั้น) เพดาน 30 ชั้น
    if cardinality(v_roots) > 0 then
      with recursive walk(code, path) as (
        select l.child_code, array[r.root, l.child_code]
        from unnest(v_roots) as r(root)
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = r.root
        join public.bom_bom_lines l on l.bom_pk = b.id
        union all
        select l.child_code, w.path || l.child_code
        from walk w
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = w.code
        join public.bom_bom_lines l on l.bom_pk = b.id
        where cardinality(w.path) < 30
          and not (w.code = any (w.path[1:cardinality(w.path) - 1]))
      )
      select case
               when bool_or(w.code = any (w.path[1:cardinality(w.path) - 1])) then 'BOM_CYCLE'
               when max(cardinality(w.path)) >= 30 then 'BOM_TOO_DEEP'
             end
      into v_bad
      from walk w;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;
  exception
    when unique_violation then
      raise exception 'BOM_CONFLICT';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation or datetime_field_overflow then
      -- ข้อความกลาง ๆ ไม่คืนค่าหรือชื่อ constraint กลับไป
      raise exception 'BOM_INVALID_DATA';
  end;

  v_version := v_version + 1;
  update public.bom_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit));
  return private.bom_delta(p_base_version);
end;
$$;

-- ประวัติการใช้งาน BOM ของโหมดทดสอบ (ใหม่สุดก่อน) จากแถว audit_logs ของ BOM: หนึ่งแถว audit_logs = หนึ่งบรรทัด
-- action / detail เป็นสิ่งที่เซิร์ฟเวอร์บันทึกเอง: ชื่อ action ของ client (ผ่านรายการที่อนุญาต) และจำนวนระเบียนที่เปลี่ยนต่อส่วน (เช่น "orders +1, jobs +3 -1" = เพิ่ม/แก้ 1 ใบ เพิ่ม/แก้ 3 งาน ลบ 1 งาน)
-- entries = ข้อความไทยที่ client ส่งมาเอง (ผู้บันทึกคนใดก็เขียนอะไรก็ได้) แสดงเป็นหมายเหตุรอง ไม่ใช่หลักฐาน · แถวล้างข้อมูลทดสอบเซิร์ฟเวอร์เขียนเองทั้งหมด · persona ทุกตัวอ่านได้
create or replace function public.app_bom_audit(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  perform private.lab_only_block();
  perform private.bom_actor();
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', t.at, 'user', t.usr, 'action', t.action, 'detail', t.detail, 'entries', t.entries) order by t.id desc)
    from (
      select a.id, private.bom_ms(a.created_at) as at,
             coalesce(a.metadata ->> 'persona_name', a.metadata ->> 'persona_employee_no', '') as usr,
             case when a.action = 'BOM_SANDBOX_PURGE' then 'ล้างข้อมูล BOM ทดสอบ' else coalesce(a.metadata ->> 'client_action', a.action) end as action,
             case when a.action = 'BOM_SANDBOX_PURGE' then 'ลบ ' || coalesce(a.metadata ->> 'deleted', '0') || ' แถว'
                  else coalesce((
                    select string_agg(c.key || coalesce(' +' || nullif(c.value ->> 'upsert', '0'), '') || coalesce(' -' || nullif(c.value ->> 'delete', '0'), ''), ', ' order by c.key)
                    from jsonb_each(case when jsonb_typeof(a.metadata -> 'counts') = 'object' then a.metadata -> 'counts' else '{}'::jsonb end) c
                    where jsonb_typeof(c.value) = 'object'
                      and (coalesce(c.value ->> 'upsert', '0') <> '0' or coalesce(c.value ->> 'delete', '0') <> '0')), '') end as detail,
             case when a.action = 'BOM_MASTER_SAVE' and jsonb_typeof(a.metadata -> 'entries') = 'array' then a.metadata -> 'entries' else '[]'::jsonb end as entries
      from public.audit_logs a
      where a.action in ('BOM_MASTER_SAVE', 'BOM_SANDBOX_PURGE') and a.metadata ->> 'is_test' = 'true'
      order by a.id desc
      limit v_limit
    ) t), '[]'::jsonb);
end;
$$;

-- ล้างข้อมูล BOM ทดสอบ (admin จริงที่อยู่ในโหมดทดสอบ แบบเดียวกับ app_sandbox_purge_ncr / app_sandbox_purge_qc)
-- ลบทุกแถว is_test ของตาราง bom_* (ลูกก่อนแม่) เปลี่ยน epoch (ตัวนับ version เดินต่อ) เขียน audit (audit_logs เดิมคงไว้) ไม่แตะข้อมูลจริง
create or replace function public.app_sandbox_purge_bom()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_persona public.employees%rowtype;
  v_table text;
  v_n integer;
  v_deleted integer := 0;
  v_version bigint;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  foreach v_table in array array[
    'bom_jobs', 'bom_orders', 'bom_customers', 'bom_bom_lines', 'bom_boms', 'bom_routings', 'bom_color_sets', 'bom_packages',
    'bom_colors', 'bom_processes', 'bom_compounds', 'bom_items', 'bom_deleted_keys'
  ] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;
  -- ไม่ตั้ง version กลับเป็น 0: ตัวนับเดินต่อ แถวที่สร้างหลังล้างจึงได้เวอร์ชันใหม่กว่าที่ client ใดเคยถือ · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
  update public.bom_master_state set epoch = gen_random_uuid(), updated_at = now(), updated_by = null where is_test returning version into v_version;
  if not found then
    insert into public.bom_master_state (is_test, version) values (true, 0);
    v_version := 0;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'BOM_SANDBOX_PURGE', 'bom_master', v_version::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'persona_name', v_persona.first_name || ' ' || v_persona.last_name,
                             'entries', jsonb_build_array(jsonb_build_object(
                               'action', 'ล้างข้อมูล BOM ทดสอบ', 'detail', 'ลบ ' || v_deleted || ' แถว'))));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) from public, anon;
revoke all on function public.app_bom_audit(integer) from public, anon;
revoke all on function public.app_sandbox_purge_bom() from public, anon;
grant execute on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) to authenticated;
grant execute on function public.app_bom_audit(integer) to authenticated;
grant execute on function public.app_sandbox_purge_bom() to authenticated;
