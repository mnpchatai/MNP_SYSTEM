-- ============================================================================
-- RubberFlow (แผนก RB โหมดทดสอบ) ขึ้นฐานข้อมูล รอบที่ 1 จาก 2: วัตถุดิบ (materials), สูตรยาง PHR (recipes), ใบสั่งผลิต WO (orders),
-- บันทึกการใช้งาน (audit) และการเชื่อมกับงาน RB ของ BOM (bom_jobs)
-- ย้ายจาก localStorage ของเบราว์เซอร์ (modules/rubberflow-store.js คีย์ mnp-rubberflow-v1) เข้า Supabase ใช้กลไกเดียวกับ BOM
-- (20261105010000_bom_master_data.sql + 20261106010000_bom_orders_jobs.sql) ทุกประการ ไม่แตกสายใหม่
--
-- ขอบเขตรอบนี้
--   ตารางใหม่ (ทดสอบเท่านั้น แยกโหมดด้วย is_test): rf_master_state (ตัวนับ version + epoch), rf_materials, rf_recipes (ทุก revision), rf_orders,
--   rf_deleted_keys (หลุมฝังศพ สร้างไว้ให้รอบที่ 2 ยังว่างอยู่และไม่ถูกใช้)
--   ที่เหลือ (materialLots, requisitions, lots, transfers, fgBoxes, qcRecords, ncrs, molds) ยังอยู่ใน localStorage จนกว่ารอบที่ 2
--   เริ่มจากว่าง ไม่ย้ายข้อมูลจากเบราว์เซอร์ ไม่มีข้อมูลสาธิตในฐานข้อมูล
--
-- RPC (สัญญากับ Pilot Web) ทุกตัว security definer, search_path ว่าง, private.lab_only_block(), execute ให้ authenticated เท่านั้น
--   public.app_rf_master()                         -> { version, epoch, materials, recipes, orders } (recipes มีทุก revision) เรียงแบบกำหนดได้
--   public.app_rf_master_since(p_version)          -> delta { version, epoch, changes: { materials|recipes|orders: { upsert, delete: [] } } }
--   public.app_rf_save(p_changes, p_base_version, p_action, p_audit default '[]', p_epoch default null) -> delta ตั้งแต่ p_base_version
--     p_changes = { materials|recipes|orders: { upsert: [เรคอร์ดเต็ม] } } (ไม่มี delete: วัตถุดิบเลิกใช้ด้วย active=false ใบสั่งผลิตยกเลิกด้วยสถานะ)
--     ชนรายระเบียนด้วย RF_STALE ก่อนการตรวจสิทธิ์/เนื้อหาเสมอ (หลังตรวจรูปของ payload) · เขียนซ้ำค่าเดิมทุกช่อง = ไม่ทำอะไร: ไม่เพิ่ม version
--     ไม่เขียน audit คืน delta ตั้งแต่ p_base_version (ตรวจจากแถว rf_* ที่ changed_version > version ก่อนบันทึก และจำนวนแถว BOM ที่เขียน)
--   public.app_rf_audit(p_limit default 200)       -> [{ at, user, action, detail, entries }] ใหม่สุดก่อน (persona ทุกตัวอ่านได้)
--   public.app_sandbox_purge_rf()                  -> { deleted } admin จริงที่อยู่ในโหมดทดสอบเท่านั้น ลบทุกแถว is_test ของ rf_* เปลี่ยน epoch (version เดินต่อ)
--     ไม่แตะ BOM: external_ref ของงาน BOM ที่ชี้ไป WO ที่ถูกล้างจะค้างอยู่ (ข้อมูลทดสอบ ล้างด้วย app_sandbox_purge_bom)
--
-- สิทธิ์ (ตัวบังคับจริงคือ RPC; หน้าเว็บซ่อนปุ่มอย่างเดียว) เปิดเฉพาะโหมดทดสอบ: นอกโหมดทดสอบ = RF_TEST_MODE_ONLY (private.rf_actor = persona ของ sandbox)
--   - กลุ่มวางแผน = private.bom_can_edit (แผนก PP ทุกบทบาท หรือ department_manager / assistant_factory_manager / factory_manager / general_manager / admin)
--   - สมาชิก RB = พนักงานที่แผนกคือ RB (ทุกบทบาท) · หัว RB = สมาชิก RB ที่บทบาท department_manager / assistant_department_manager
--     หรือบทบาท assistant_factory_manager / factory_manager / general_manager / admin
--   - วัตถุดิบ: กลุ่มวางแผนหรือสมาชิก RB เพิ่ม/แก้ได้ ไม่มีลบ (active = false)
--   - สูตร PHR: กลุ่มวางแผนหรือสมาชิก RB สร้าง/แก้ "ร่าง" · หัว RB เท่านั้นอนุมัติ · revision ที่ approved/superseded แก้ไม่ได้ (RF_REVISION_IMMUTABLE)
--     แก้สูตรที่อนุมัติแล้ว = สร้างร่าง revision + 1 ของรหัสเดิม · อนุมัติร่างใหม่ = เซิร์ฟเวอร์ตั้งตัว approved เดิมเป็น superseded ในธุรกรรมเดียว
--     ดัชนี unique บางส่วน: approved ได้ตัวเดียวและ draft ได้ตัวเดียวต่อรหัสสูตร · revision ใหม่ต้องเป็น (revision สูงสุดของรหัส) + 1 และเริ่มเป็น draft เสมอ
--     ใช้ได้เฉพาะสูตร approved ใน WO · วัตถุดิบในสูตรต้องมีอยู่ใน rf_materials (ที่เลิกใช้แล้วใส่ใหม่ไม่ได้ เว้นแต่มีอยู่ใน revision ก่อนหน้า)
--     อนุมัติได้เฉพาะร่างที่เนื้อหาตรงกับที่เก็บ (แก้เนื้อหาพร้อมอนุมัติในคำสั่งเดียวไม่ได้)
--   - WO: สร้าง = กลุ่มวางแผนหรือสมาชิก RB (เริ่มที่ planned เสมอ producedQty 0 ใช้ได้เฉพาะสูตร approved · ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
--     สถานะตาม ORDER_FLOW ของ modules/rubberflow-actions.js: planned -> released | cancelled · released -> in_progress | on_hold | cancelled ·
--     in_progress -> on_hold | completed · on_hold -> in_progress อย่างอื่น = RF_INVALID_TRANSITION (completed/cancelled เป็นสถานะสุดท้าย)
--     planned -> released = กลุ่มวางแผนหรือหัว RB · สถานะอื่นทุกตัว = กลุ่มวางแผนหรือสมาชิก RB · ที่เหลือ RF_FORBIDDEN
--     เนื้อหาของ WO (ลูกค้า สูตร จำนวนเป้าหมาย วันที่ ฯลฯ) แก้หลังสร้างไม่ได้ (RF_INVALID_ORDER) producedQty เปลี่ยนได้เฉพาะ WO ที่ปล่อยแล้ว
--     (released / in_progress / on_hold) และสถานะใหม่เป็น in_progress / on_hold / completed · WO ที่ completed แล้วเพิ่ม producedQty ได้อย่างเดียว
--     (ผลิตเกิน / ปล่อยของช้า) ลดไม่ได้ (RF_INVALID_ORDER) · product/uom ได้จากสูตรหรืองาน BOM ไม่เชื่อ client
--     แผนก QA (ทุกบทบาท) เขียน WO ได้ทางเดียว: p_action = 'addQcRecord' ส่งใบเดิมที่ต่างจากที่เก็บแค่ producedQty ที่มากขึ้น (รวมใบ completed)
--     อย่างอื่นทุกอย่างของ QA = RF_FORBIDDEN (วัตถุดิบ สูตร ใบใหม่ เปลี่ยนสถานะ แก้เนื้อหา ลดยอด)
--
-- การเชื่อมกับ BOM (ข้ามโมดูล ธุรกรรมเดียวกับการบันทึก WO)
--   - สร้าง WO ที่มี sourceJobId (job_no ของ bom_jobs): ตรวจว่างานเป็นแผนก RB, ใบ PI เป็น released / in_progress, งานยังไม่ done และยังไม่มี external_ref
--     (หรือ external_ref ชี้ไป WO ที่ยกเลิกแล้ว) (ผิด = RF_INVALID_SOURCE_JOB) แล้วเขียน bom_jobs.external_ref = { system: "rubberflow", woId, kg (= targetKg หรือ 0), linkedAt, by } เหมือน linkJobToRubberFlow
--     ของ client: งาน queued เป็น in_progress และใบ released เป็น in_progress · WO ใช้หน่วย (uom) ของงาน
--   - WO ที่ผูกงาน BOM เปลี่ยนเป็น completed: ต้องมี producedQty > 0 (ไม่เช่นนั้น RF_INVALID_PRODUCED) แล้วเซิร์ฟเวอร์ต่อรายงานเข้างาน
--     { at, by, good = producedQty, reject = 0, note = "จาก WO ..." } (producedQty คือผลผลิตของ WO ใบนี้ ไม่ใช่ยอดรวมของงาน) ตั้ง
--     qty_done = qty_done เดิม + producedQty, status = done ถ้า >= qty_planned มิฉะนั้น in_progress, ใบ released เป็น in_progress
--     ข้ามไม่เขียน (WO ยังปิดได้) เมื่อใบ PI ไม่ใช่ released / in_progress แล้ว หรืองานนั้น done แล้ว หรือไม่พบงาน หรือ external_ref ของงานไม่ชี้มา WO นี้
--     ป้อนกลับครั้งเดียวต่อ WO: rf_orders.fed_back_at ถูกตั้งในธุรกรรมเดียวกับที่เขียนงาน (การเพิ่ม producedQty หลังปิด WO ไม่ป้อนกลับซ้ำ)
--   - ยกเลิก WO ที่ผูกงาน BOM: เซิร์ฟเวอร์ล้าง bom_jobs.external_ref ในธุรกรรมเดียวกัน (ยอด qty_done/รายงานเดิมคงไว้ สถานะงานไม่เปลี่ยน) และต่อรายงาน
--     { at, by, good = 0, reject = 0, note = "WO ... ถูกยกเลิก" } ให้ตัวนับ BOM เพิ่ม 1 งานนั้นผูกกับ WO ใบใหม่ได้ (rf_job_for_link รับงานที่ไม่มี external_ref
--     หรือที่ external_ref ชี้ไป WO ที่ยกเลิกแล้ว) ข้ามไม่เขียนเมื่อไม่พบงานหรือ external_ref ไม่ชี้มา WO นี้
--   - การเขียนฝั่ง BOM เพิ่ม bom_master_state.version อีก 1 ผ่านตัวนับ BOM และเขียนแถว audit BOM_MASTER_SAVE (client_action = 'rubberflow:<action>')
--     ให้ client ของ BOM ตามทันด้วย app_bom_master_since ตามปกติ (changed_version ของงาน/ใบถูกประทับโดย trigger bom_stamp_version)
--   - ลำดับล็อก (กัน deadlock) เป็นลำดับเดียวเสมอ: rf_master_state (for update) ก่อน แล้ว bom_master_state (for update) เฉพาะเมื่อมีการเขียนฝั่ง BOM
--     RPC ของ BOM ล็อกเฉพาะ bom_master_state และอ่าน rf_recipes แบบไม่ล็อก จึงไม่มีวงจรรอ
--   - private.bom_save_compounds: recipeId ที่ไม่ว่างและเปลี่ยนจากค่าที่เก็บไว้ ต้องเป็นรหัสที่มีอยู่ใน rf_recipes (BOM_INVALID_COMPOUND)
--     (ถ้าไม่เปลี่ยนจากค่าเดิมไม่ตรวจ เพื่อไม่ให้การบันทึกคอมปาวด์เดิมล้มเพราะข้อมูลที่ผูกไว้ก่อนมีตาราง) การเปลี่ยนสถานะของสูตรไม่ลบการผูก
--
-- ชื่อ action ของ client ที่อนุญาตใน p_action (rf_client_actions): saveMaterial createRecipe saveRecipe approveRecipe createOrder setOrderStatus
--   และ action ผลิตที่เปลี่ยนสถานะ/ยอดของ WO อัตโนมัติ (recordMixing recordExtrusion recordCuring recordFinishing addQcRecord) อย่างอื่น = RF_INVALID_ACTION
--
-- รหัสข้อผิดพลาด (raise exception ข้อความตายตัว)
--   RF_TEST_MODE_ONLY RF_FORBIDDEN RF_STALE RF_RESET RF_INVALID_PAYLOAD RF_INVALID_ACTION RF_TOO_MANY RF_CONFLICT RF_INVALID_DATA
--   RF_INVALID_MATERIAL RF_INVALID_RECIPE RF_INVALID_ORDER RF_INVALID_PRODUCED RF_INVALID_SOURCE_JOB RF_INVALID_TRANSITION RF_REVISION_IMMUTABLE RF_REVISION_ORDER
--
-- การแยกข้อมูลทดสอบ/สิทธิ์ตารางเหมือน BOM: is_test กำหนดโดย trigger private.sandbox_row_scope, changed_version ประทับโดย trigger private.rf_stamp_version,
--   RLS deny-all + ถอนสิทธิ์ anon/authenticated + lab-only (private.lab_only_guard_table), ลงทะเบียนใน private.sandbox_unguarded_tables(),
--   audit_logs 1 แถวต่อการบันทึก (action RF_SAVE) ผู้กระทำคือ admin จริงเบื้องหลัง persona (private.bom_audit_actor_id)
--   rf_orders ไม่มี foreign key ไป bom_jobs (source_job_no เป็นข้อความ) เพื่อให้ app_sandbox_purge_bom ลบงาน BOM ได้เสมอ
--
-- นิยามที่ replace ในไฟล์นี้ (เริ่มจากนิยามล่าสุดของแต่ละตัว)
--   - private.sandbox_unguarded_tables(): จาก 20261106010000_bom_orders_jobs.sql เพิ่ม rf_* ห้าตาราง
--   - private.bom_save_compounds(uuid, jsonb, bigint, bigint): จาก 20261105010000_bom_master_data.sql เพิ่มการตรวจ recipeId กับ rf_recipes
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ (modules/module-rubberflow.js, rubberflow-store.js และ BOM dialog ผูก WO) เรียก RPC ของไฟล์นี้
--   จึงต้อง apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้) ก่อน merge PR นี้ ตาม "Deployment order" ใน AGENTS.md
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของ private.sandbox_unguarded_tables และ private.bom_save_compounds ที่ production
--   กับนิยามใน 20261106010000_bom_orders_jobs.sql / 20261105010000_bom_master_data.sql (ถ้ามี migration อื่นแก้ไปแล้ว ต้องเริ่มจากนิยามล่าสุด)
--   ถ้า merge ก่อน apply หน้า #/rubberflow ในโหมดทดสอบจะเรียก RPC ที่ยังไม่มี
--
--   ตรวจนิยามและสิทธิ์หลัง apply ที่ production: เทียบ md5(pg_get_functiondef(oid)) ของฟังก์ชัน rf_* / app_rf_* / app_sandbox_purge_rf กับ local stack ที่ผ่าน db:test
--   และตรวจ has_function_privilege (anon ไม่ได้, authenticated เฉพาะ RPC สาธารณะห้าตัว) กับ relrowsecurity + policy ของตาราง rf_* ก่อนเปิดใช้งาน
--
-- Rollback (ตาราง rf_* มีแต่ข้อมูลทดสอบ) ลำดับสำคัญ: trigger ของตารางเรียก rf_stamp_version() และ rf_apply_feedback / rf_unlink_job รับชนิดแถวของ rf_orders
--   1) drop function public.app_rf_master(), public.app_rf_master_since(bigint), public.app_rf_save(jsonb, bigint, text, jsonb, text),
--      public.app_rf_audit(integer), public.app_sandbox_purge_rf();
--   2) drop function ที่เหลือยกเว้น rf_stamp_version(): private.rf_actor(), rf_is_rb(public.employees), rf_is_rb_head(public.employees), rf_is_qa(public.employees),
--      rf_client_actions(), rf_lock_bom(), rf_parse_items(jsonb, jsonb), rf_save_materials(uuid, jsonb, bigint, bigint),
--      rf_save_recipes(uuid, boolean, jsonb, bigint, bigint),
--      rf_save_orders(public.employees, text, boolean, boolean, boolean, boolean, text, jsonb, bigint, bigint), rf_job_for_link(text),
--      rf_link_job(public.bom_jobs, text, text, numeric), rf_apply_feedback(text, public.rf_orders), rf_unlink_job(text, public.rf_orders),
--      rf_records(bigint), rf_snapshot(), rf_delta(bigint);
--   3) drop table public.rf_orders, public.rf_recipes, public.rf_materials, public.rf_deleted_keys, public.rf_master_state (ลูกก่อนแม่)
--   4) drop function private.rf_stamp_version() (ท้ายสุด หลังตารางหายไปแล้ว)
--   5) คืนนิยามเดิมของ private.sandbox_unguarded_tables() (20261106010000_bom_orders_jobs.sql) และ private.bom_save_compounds (20261105010000_bom_master_data.sql)
--      ด้วยการรัน create or replace จากไฟล์นั้น รวม revoke ท้ายฟังก์ชัน
--   งานของ BOM ที่ผูกไว้แล้ว (external_ref) รายงานผลที่ต่อเข้างาน และการล้าง external_ref ตอนยกเลิก WO ไม่ถูกย้อนกลับ (เป็นข้อมูลของ BOM)
-- ============================================================================

-- 1. ตาราง (แยกโหมดด้วย is_test) ----------------------------------------------------------
-- ตัวนับเวอร์ชัน + รหัสรอบข้อมูลของ RubberFlow (1 แถวต่อโหมด) เหมือน bom_master_state
create table public.rf_master_state (
  is_test boolean primary key default false,
  version bigint not null default 0 check (version >= 0),
  epoch uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null
);
comment on table public.rf_master_state is 'ตัวนับเวอร์ชันข้อมูล RubberFlow (1 แถวต่อโหมด) เพิ่มทุกครั้งที่ app_rf_save สำเร็จ · epoch เปลี่ยนเฉพาะตอนล้างข้อมูลทดสอบ';
comment on column public.rf_master_state.is_test is 'แถวโหมดทดสอบ: trigger กำหนดจากโหมดผู้ทำรายการ ไม่รับจาก client';
comment on column public.rf_master_state.epoch is 'รหัสรอบข้อมูล เปลี่ยนเฉพาะตอนล้างข้อมูลทดสอบ (app_sandbox_purge_rf) client ที่ถือ epoch เก่าต้องโหลดทั้งชุดใหม่';

create table public.rf_materials (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  name text not null check (char_length(name) between 1 and 160),
  category text not null default '' check (char_length(category) <= 60),
  storage_location text not null default '' check (char_length(storage_location) <= 160),
  uom text not null default 'kg' check (char_length(uom) between 1 and 20),
  active boolean not null default true,
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (code, is_test)
);
-- รหัสวัตถุดิบไม่แยกตัวพิมพ์เล็ก/ใหญ่ (EPDM-55 กับ epdm-55 คือตัวเดียวกัน)
create unique index rf_materials_code_ci_idx on public.rf_materials (upper(code), is_test);
comment on table public.rf_materials is 'วัตถุดิบ (ข้อมูลหลัก) เพิ่ม/แก้ได้ ไม่ลบ เลิกใช้ด้วย active = false';

create table public.rf_recipes (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  -- รหัสสูตร เช่น RC-EPDM-DS01 (กุญแจของสูตร) + revision = กุญแจของแถว · BOM ผูกคอมปาวด์กับรหัสสูตร
  recipe_code text not null check (recipe_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  revision integer not null check (revision between 1 and 9999),
  name text not null check (char_length(name) between 1 and 160),
  product_code text not null check (char_length(product_code) between 1 and 60),
  product_name text not null check (char_length(product_name) between 1 and 160),
  uom text not null check (char_length(uom) between 1 and 20),
  batch_kg numeric not null check (batch_kg > 0 and batch_kg <= 1000000),
  dump_temp numeric not null check (dump_temp >= 0 and dump_temp <= 1000),
  dump_tol numeric not null default 5 check (dump_tol >= 0 and dump_tol <= 100),
  mix_sec numeric not null check (mix_sec > 0 and mix_sec <= 86400),
  rest_hours numeric not null default 4 check (rest_hours >= 0 and rest_hours <= 1000),
  yield_per_kg numeric not null check (yield_per_kg > 0 and yield_per_kg <= 1000000000),
  -- [{materialCode, phr}] 1-100 รายการ ตรวจใน RPC (วัตถุดิบต้องมีอยู่ ไม่ซ้ำ phr > 0)
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  status text not null check (status in ('draft', 'approved', 'superseded')),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references public.employees(id) on delete set null,
  approved_at timestamptz,
  superseded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (recipe_code, revision, is_test)
);
-- ต่อรหัสสูตร: approved ได้ตัวเดียว และมีร่างค้างได้ตัวเดียว
create unique index rf_recipes_one_approved_idx on public.rf_recipes (recipe_code, is_test) where status = 'approved';
create unique index rf_recipes_one_draft_idx on public.rf_recipes (recipe_code, is_test) where status = 'draft';
comment on table public.rf_recipes is '1 แถว = 1 revision ของสูตรยาง PHR · revision ที่ approved/superseded แก้ไม่ได้ (ยกเว้น approved -> superseded โดยเซิร์ฟเวอร์ตอนอนุมัติตัวใหม่)';

create table public.rf_orders (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  -- เลข WO เช่น WO-20261107-01 (client ออกเลขจากเลขสูงสุดของวันใน snapshot + 1) เป็นกุญแจของใบ
  wo_no text not null check (wo_no ~ '^[A-Za-z0-9._-]{1,40}$'),
  customer text not null check (char_length(customer) between 1 and 120),
  customer_po text not null default '' check (char_length(customer_po) <= 60),
  recipe_code text not null,
  recipe_revision integer not null,
  product_code text not null check (char_length(product_code) between 1 and 60),
  product_name text not null check (char_length(product_name) between 1 and 160),
  -- หน่วยของ targetQty/producedQty: หน่วยของงาน BOM (เส้น/ชิ้น) เมื่อสร้างจากงาน BOM ไม่เช่นนั้นหน่วยของสูตร
  uom text not null check (char_length(uom) between 1 and 20),
  color text not null default '' check (char_length(color) <= 40),
  target_qty numeric not null check (target_qty > 0 and target_qty <= 1000000000),
  target_kg numeric check (target_kg is null or (target_kg >= 0 and target_kg <= 1000000000)),
  kg_per_unit numeric check (kg_per_unit is null or (kg_per_unit >= 0 and kg_per_unit <= 1000000000)),
  produced_qty numeric not null default 0 check (produced_qty >= 0 and produced_qty <= 1000000000),
  -- วันที่เป็นมิลลิวินาทีแบบ Date.now() ที่ client ใช้
  start_date bigint not null check (start_date > 0 and start_date <= 100000000000000),
  due_date bigint not null check (due_date >= start_date and due_date <= 100000000000000),
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'planned' check (status in ('planned', 'released', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  -- job_no ของงาน RB ใน bom_jobs ที่ WO นี้ผูกอยู่ (ไม่มี foreign key: ดูหัวไฟล์)
  source_job_no text check (source_job_no is null or source_job_no ~ '^[A-Za-z0-9._-]{1,40}$'),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.employees(id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  -- เวลาที่ผลผลิตของ WO ถูกป้อนกลับเข้างาน BOM แล้ว (ตั้งครั้งเดียวในธุรกรรมเดียวกับที่เขียนงาน กันป้อนซ้ำ)
  fed_back_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (recipe_code, recipe_revision, is_test) references public.rf_recipes(recipe_code, revision, is_test),
  unique (id, is_test),
  unique (wo_no, is_test)
);
create index rf_orders_status_idx on public.rf_orders (is_test, status);
-- งาน BOM หนึ่งงานมี WO ที่ยังไม่ยกเลิกได้ใบเดียว
create unique index rf_orders_source_job_idx on public.rf_orders (source_job_no, is_test)
  where source_job_no is not null and status <> 'cancelled';
comment on table public.rf_orders is 'ใบสั่งผลิต RubberFlow (WO) planned -> released -> in_progress / on_hold -> completed / cancelled เปลี่ยนสถานะผ่าน app_rf_save เท่านั้น';

-- หลุมฝังศพ (สร้างไว้ให้รอบที่ 2 ยังไม่ถูกใช้ในรอบนี้)
create table public.rf_deleted_keys (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  list text not null check (char_length(list) between 1 and 40),
  key text not null check (char_length(key) between 1 and 120),
  deleted_at timestamptz not null default now(),
  unique (list, key, is_test)
);
comment on table public.rf_deleted_keys is 'หลุมฝังศพของระเบียน RubberFlow ที่ถูกลบ (ใช้ในรอบที่ 2 รอบนี้ว่างเสมอ)';

create index rf_materials_changed_idx on public.rf_materials (is_test, changed_version);
create index rf_recipes_changed_idx on public.rf_recipes (is_test, changed_version);
create index rf_orders_changed_idx on public.rf_orders (is_test, changed_version);
create index rf_deleted_keys_changed_idx on public.rf_deleted_keys (is_test, changed_version);
comment on column public.rf_materials.changed_version is 'เวอร์ชันของ rf_master_state ที่แก้แถวนี้ล่าสุด (trigger rf_stamp_version ตั้งให้ ไม่รับจาก client) ใช้ตรวจชนรายระเบียนและคำนวณ delta';
comment on column public.rf_recipes.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด รวมที่เซิร์ฟเวอร์ตั้ง superseded เอง (ดู rf_materials.changed_version)';
comment on column public.rf_orders.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู rf_materials.changed_version)';
comment on column public.rf_deleted_keys.changed_version is 'เวอร์ชันที่ลบ (ดู rf_materials.changed_version)';

-- ตัวนับเริ่มต้นของโหมดทดสอบ (migration ไม่มี auth.uid() trigger จึงไม่ทับ is_test)
insert into public.rf_master_state (is_test, version) values (true, 0);

-- ประทับเวอร์ชันที่แก้ล่าสุดทุกครั้งที่เพิ่ม/แก้แถว: version ของตัวนับ + 1 (RPC บันทึกล็อกแถวตัวนับไว้แล้วและเพิ่ม version ตอนท้ายธุรกรรม)
-- ใช้ trigger เพื่อให้รวมแถวที่เซิร์ฟเวอร์แก้เอง (revision เดิมถูกตั้ง superseded) · ชื่อ trigger เรียงหลัง *_sandbox_scope จึงเห็น is_test ที่ตั้งแล้ว
create or replace function private.rf_stamp_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.changed_version := coalesce((select s.version from public.rf_master_state s where s.is_test = new.is_test), 0) + 1;
  return new;
end;
$$;
revoke all on function private.rf_stamp_version() from public, anon, authenticated;

-- 2. แยกโหมด + ประทับเวอร์ชัน + ปิดการเข้าถึงตรง -------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['rf_master_state', 'rf_materials', 'rf_recipes', 'rf_orders', 'rf_deleted_keys'] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.sandbox_row_scope()', v_table || '_sandbox_scope', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
  foreach v_table in array array['rf_materials', 'rf_recipes', 'rf_orders', 'rf_deleted_keys'] loop
    execute format(
      'create trigger %I before insert or update on public.%I '
      'for each row execute function private.rf_stamp_version()', v_table || '_stamp_version', v_table);
  end loop;
end $$;

-- บัญชี lab-only (MNPLAB001/002) ต้องมองไม่เห็นตารางของโมดูลนี้ (policy restrictive lab_only_no_access)
select private.lab_only_guard_table('public.rf_master_state');
select private.lab_only_guard_table('public.rf_materials');
select private.lab_only_guard_table('public.rf_recipes');
select private.lab_only_guard_table('public.rf_orders');
select private.lab_only_guard_table('public.rf_deleted_keys');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (นิยามจาก 20261106010000_bom_orders_jobs.sql ทุกชื่อ แล้วเพิ่ม rf_*)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 3. ฟังก์ชันช่วย (private) -----------------------------------------------------------------
-- ผู้ทำรายการ: เปิดเฉพาะโหมดทดสอบ (persona ของ sandbox เหมือน private.bom_actor)
create or replace function private.rf_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_persona public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'RF_TEST_MODE_ONLY';
  end if;
  return v_persona;
end;
$$;
revoke all on function private.rf_actor() from public, anon, authenticated;

-- สมาชิก RB: พนักงานที่แผนกคือ RB (ทุกบทบาท)
create or replace function private.rf_is_rb(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.bom_dept_of(p_employee) = 'RB', false)
$$;
revoke all on function private.rf_is_rb(public.employees) from public, anon, authenticated;

-- หัว RB: สมาชิก RB ที่เป็น department_manager / assistant_department_manager หรือบทบาท assistant_factory_manager / factory_manager / general_manager / admin
create or replace function private.rf_is_rb_head(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce(private.bom_dept_of(p_employee) = 'RB', false)
          and coalesce(private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager'), false))
      or coalesce(private.employee_role_code(p_employee.id) in ('assistant_factory_manager', 'factory_manager', 'general_manager', 'admin'), false)
$$;
revoke all on function private.rf_is_rb_head(public.employees) from public, anon, authenticated;

-- สมาชิก QA: พนักงานที่แผนกคือ QA (ทุกบทบาท) เขียน WO ได้ทางเดียวคือเพิ่ม producedQty ผ่าน action addQcRecord
create or replace function private.rf_is_qa(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.bom_dept_of(p_employee) = 'QA', false)
$$;
revoke all on function private.rf_is_qa(public.employees) from public, anon, authenticated;

-- ชื่อ action ของ client ที่เขียนข้อมูลได้ ใช้ตรวจ p_action (saveMaterial / saveRecipe เป็นชื่อใหม่ของรอบนี้)
create or replace function private.rf_client_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['saveMaterial', 'createRecipe', 'saveRecipe', 'approveRecipe', 'createOrder', 'setOrderStatus',
    'recordMixing', 'recordExtrusion', 'recordCuring', 'recordFinishing', 'addQcRecord']
$$;
revoke all on function private.rf_client_actions() from public, anon, authenticated;

-- ล็อกแถวตัวนับ BOM (ลำดับล็อกเสมอ: rf_master_state ก่อน แล้วจึงเรียกฟังก์ชันนี้) เรียกซ้ำในธุรกรรมเดียวได้ คืน version ของ BOM ก่อนบันทึกนี้
create or replace function private.rf_lock_bom()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  insert into public.bom_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version into v_version from public.bom_master_state s where s.is_test for update;
  return v_version;
end;
$$;
revoke all on function private.rf_lock_bom() from public, anon, authenticated;

-- ส่วนผสมของสูตร: [{materialCode, phr}] 1-100 รายการ ไม่ซ้ำ phr > 0 วัตถุดิบต้องมีอยู่ใน rf_materials
-- วัตถุดิบที่เลิกใช้แล้ว (active = false) ใส่ได้เฉพาะที่มีอยู่ใน p_prev (items ของ revision ก่อนหน้า/ของแถวเดิม)
create or replace function private.rf_parse_items(p_node jsonb, p_prev jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_el jsonb;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_code text;
  v_phr numeric;
  v_active boolean;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' or jsonb_array_length(p_node) not between 1 and 100 then
    raise exception 'RF_INVALID_RECIPE';
  end if;
  for v_el in select value from jsonb_array_elements(p_node) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'RF_INVALID_RECIPE'; end if;
    v_code := private.bom_text(v_el, 'materialCode', 40, 1, 'RF_INVALID_RECIPE');
    if v_code = any (v_seen) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_seen := v_seen || v_code;
    v_phr := private.bom_num(v_el -> 'phr', 'RF_INVALID_RECIPE', 0, 100000);
    if v_phr is null or v_phr <= 0 then raise exception 'RF_INVALID_RECIPE'; end if;
    select m.active into v_active from public.rf_materials m where m.is_test and m.code = v_code;
    if not found then raise exception 'RF_INVALID_RECIPE'; end if;
    if not v_active and not exists (
         select 1 from jsonb_array_elements(coalesce(p_prev, '[]'::jsonb)) e where e ->> 'materialCode' = v_code) then
      raise exception 'RF_INVALID_RECIPE';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('materialCode', v_code, 'phr', v_phr));
  end loop;
  return v_out;
end;
$$;
revoke all on function private.rf_parse_items(jsonb, jsonb) from public, anon, authenticated;

-- 4. ตัวเขียนวัตถุดิบ สูตร ใบสั่งผลิต (เรียกจาก app_rf_save เท่านั้น) ---------------------------------------
-- วัตถุดิบ (กลุ่มวางแผนหรือสมาชิก RB ตรวจก่อนเรียก): เขียนซ้ำค่าเดิมทุกช่อง = ไม่ทำอะไร · ชนก่อนเนื้อหา/สิทธิ์
create or replace function private.rf_save_materials(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_code text;
  v_name text;
  v_category text;
  v_storage text;
  v_uom text;
  v_active boolean;
  v_seen text[] := '{}';
  v_old public.rf_materials%rowtype;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_MATERIAL'; end if;
    v_code := private.bom_text(v_row, 'code', 40, 1, 'RF_INVALID_MATERIAL');
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' or upper(v_code) = any (v_seen) then raise exception 'RF_INVALID_MATERIAL'; end if;
    v_seen := v_seen || upper(v_code);
    v_name := private.bom_text(v_row, 'name', 160, 1, 'RF_INVALID_MATERIAL');
    v_category := private.bom_text(v_row, 'category', 60, 0, 'RF_INVALID_MATERIAL');
    v_storage := private.bom_text(v_row, 'storage', 160, 0, 'RF_INVALID_MATERIAL');
    v_uom := coalesce(nullif(private.bom_text(v_row, 'uom', 20, 0, 'RF_INVALID_MATERIAL'), ''), 'kg');
    v_node := v_row -> 'active';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_active := true;
    elsif jsonb_typeof(v_node) <> 'boolean' then
      raise exception 'RF_INVALID_MATERIAL';
    else
      v_active := (v_node #>> '{}')::boolean;
    end if;

    select * into v_old from public.rf_materials m where m.is_test and upper(m.code) = upper(v_code);
    if found then
      -- รหัสต่างกันแค่ตัวพิมพ์ = ซ้ำกับของเดิม (รหัสเป็นกุญแจ แก้ไม่ได้)
      if v_old.code <> v_code then raise exception 'RF_CONFLICT'; end if;
      if v_old.name = v_name and v_old.category = v_category and v_old.storage_location = v_storage
         and v_old.uom = v_uom and v_old.active = v_active then
        continue;
      end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
      update public.rf_materials set
        name = v_name, category = v_category, storage_location = v_storage, uom = v_uom, active = v_active,
        updated_by = p_actor, updated_at = now()
      where id = v_old.id;
    else
      insert into public.rf_materials (is_test, code, name, category, storage_location, uom, active, created_by, updated_by)
      values (true, v_code, v_name, v_category, v_storage, v_uom, v_active, p_actor, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_materials(uuid, jsonb, bigint, bigint) from public, anon, authenticated;

-- สูตร PHR: กฎ revision ดูหัวไฟล์ (p_head = หัว RB อนุมัติได้) กลุ่มวางแผน/สมาชิก RB สร้าง/แก้ร่างได้ ตรวจก่อนเรียก
create or replace function private.rf_save_recipes(p_actor uuid, p_head boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_seen text[] := '{}';
  v_approving text[] := '{}';
  v_code text;
  v_rev numeric;
  v_name text;
  v_pcode text;
  v_pname text;
  v_uom text;
  v_batch numeric;
  v_dump numeric;
  v_tol numeric;
  v_mix numeric;
  v_rest numeric;
  v_yield numeric;
  v_items jsonb;
  v_status text;
  v_old public.rf_recipes%rowtype;
  v_latest public.rf_recipes%rowtype;
  v_found boolean;
  v_has_latest boolean;
  v_same boolean;
begin
  -- รหัสสูตรที่มีแถวกำลังจะเป็น approved ในคำสั่งนี้ (ใช้ยอมรับสำเนา superseded ของตัวเดิมที่ client ส่งมาด้วย)
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_RECIPE'; end if;
    if private.bom_text(v_row, 'status', 20, 0, 'RF_INVALID_RECIPE') = 'approved' then
      v_approving := v_approving || private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_RECIPE');
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_code := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_RECIPE');
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' then raise exception 'RF_INVALID_RECIPE'; end if;
    v_rev := private.bom_num(v_row -> 'revision', 'RF_INVALID_RECIPE', 1, 9999);
    if v_rev is null or v_rev <> trunc(v_rev) then raise exception 'RF_INVALID_RECIPE'; end if;
    if (v_code || '#' || v_rev::integer) = any (v_seen) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_seen := v_seen || (v_code || '#' || v_rev::integer);
    v_name := private.bom_text(v_row, 'name', 160, 1, 'RF_INVALID_RECIPE');
    v_pcode := coalesce(nullif(private.bom_text(v_row, 'productCode', 60, 0, 'RF_INVALID_RECIPE'), ''), v_code);
    v_pname := private.bom_text(v_row, 'productName', 160, 1, 'RF_INVALID_RECIPE');
    v_uom := coalesce(nullif(private.bom_text(v_row, 'uom', 20, 0, 'RF_INVALID_RECIPE'), ''), 'm');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_batch := private.bom_num(v_row -> 'batchKg', 'RF_INVALID_RECIPE', 0, 1000000);
    v_dump := private.bom_num(v_row -> 'dumpTemp', 'RF_INVALID_RECIPE', 0, 1000);
    v_tol := coalesce(private.bom_num(v_row -> 'dumpTol', 'RF_INVALID_RECIPE', 0, 100), 5);
    v_mix := private.bom_num(v_row -> 'mixSec', 'RF_INVALID_RECIPE', 0, 86400);
    v_rest := coalesce(private.bom_num(v_row -> 'restHours', 'RF_INVALID_RECIPE', 0, 1000), 4);
    v_yield := private.bom_num(v_row -> 'yieldPerKg', 'RF_INVALID_RECIPE', 0, 1000000000);
    if v_batch is null or v_batch <= 0 or v_dump is null or v_mix is null or v_mix <= 0 or v_yield is null or v_yield <= 0 then
      raise exception 'RF_INVALID_RECIPE';
    end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'RF_INVALID_RECIPE');
    if v_status not in ('draft', 'approved', 'superseded') then raise exception 'RF_INVALID_RECIPE'; end if;

    select * into v_old from public.rf_recipes r where r.is_test and r.recipe_code = v_code and r.revision = v_rev::integer;
    v_found := found;
    select * into v_latest from public.rf_recipes r where r.is_test and r.recipe_code = v_code order by r.revision desc limit 1;
    v_has_latest := found;
    v_node := case when v_found then v_old.items when v_has_latest then v_latest.items end;
    v_items := private.rf_parse_items(v_row -> 'items', v_node);

    if v_found then
      v_same := v_old.name = v_name and v_old.product_code = v_pcode and v_old.product_name = v_pname and v_old.uom = v_uom
        and v_old.batch_kg = v_batch and v_old.dump_temp = v_dump and v_old.dump_tol = v_tol and v_old.mix_sec = v_mix
        and v_old.rest_hours = v_rest and v_old.yield_per_kg = v_yield and v_old.items = v_items;
      -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน)
      if v_same and v_old.status = v_status then continue; end if;

      -- ชนก่อนสิทธิ์/กฎ revision เสมอ: แถวถูกคนอื่นแก้หลังเวอร์ชันฐาน = client ถือสำเนาเก่า
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      if v_old.status = 'draft' then
        if v_status = 'draft' then
          update public.rf_recipes set
            name = v_name, product_code = v_pcode, product_name = v_pname, uom = v_uom, batch_kg = v_batch, dump_temp = v_dump,
            dump_tol = v_tol, mix_sec = v_mix, rest_hours = v_rest, yield_per_kg = v_yield, items = v_items, updated_at = now()
          where id = v_old.id;
        elsif v_status = 'approved' then
          -- อนุมัติ: หัว RB เท่านั้น และเนื้อหาต้องตรงกับที่เก็บ (แก้พร้อมอนุมัติในคำสั่งเดียวไม่ได้)
          if not p_head then raise exception 'RF_FORBIDDEN'; end if;
          if not v_same then raise exception 'RF_INVALID_TRANSITION'; end if;
          update public.rf_recipes set status = 'superseded', superseded_at = now(), updated_at = now()
          where is_test and recipe_code = v_code and status = 'approved' and id <> v_old.id;
          update public.rf_recipes set status = 'approved', approved_by = p_actor, approved_at = now(), updated_at = now()
          where id = v_old.id;
        else
          raise exception 'RF_INVALID_TRANSITION';
        end if;
      elsif v_old.status = 'approved' then
        if not v_same then raise exception 'RF_REVISION_IMMUTABLE'; end if;
        -- approved -> superseded เกิดเองตอนอนุมัติ revision ใหม่ ยอมรับสำเนา superseded ที่มาพร้อมการอนุมัตินั้น (ข้าม) อย่างอื่นไม่ได้
        if v_status = 'superseded' and v_code = any (v_approving) then continue; end if;
        raise exception 'RF_INVALID_TRANSITION';
      else
        -- superseded เป็นสถานะสุดท้าย
        raise exception 'RF_REVISION_IMMUTABLE';
      end if;
      continue;
    end if;

    -- ระเบียนใหม่: เริ่มเป็นร่างเสมอ
    if v_status <> 'draft' then raise exception 'RF_INVALID_TRANSITION'; end if;
    if not v_has_latest then
      -- สูตรใหม่ทั้งรหัส: รหัสที่ต่างจากของเดิมแค่ตัวพิมพ์ = ซ้ำ · revision แรกต้องเป็น 1
      if exists (select 1 from public.rf_recipes r where r.is_test and upper(r.recipe_code) = upper(v_code)) then
        raise exception 'RF_CONFLICT';
      end if;
      if v_rev <> 1 then raise exception 'RF_REVISION_ORDER'; end if;
    else
      if v_rev::integer <> v_latest.revision + 1 then
        -- มีคนแก้สูตรนี้หลังเวอร์ชันฐาน = ถือสำเนาเก่า (ตามทันแล้วทำใหม่) ไม่เช่นนั้นข้ามลำดับเอง
        if exists (select 1 from public.rf_recipes r where r.is_test and r.recipe_code = v_code
                   and r.changed_version > p_base and r.changed_version <= p_cur) then
          raise exception 'RF_STALE';
        end if;
        raise exception 'RF_REVISION_ORDER';
      end if;
      -- มีร่างค้างอยู่แล้ว: ให้แก้ร่างนั้น ไม่เปิดร่างที่สอง
      if v_latest.status = 'draft' then raise exception 'RF_INVALID_TRANSITION'; end if;
    end if;
    insert into public.rf_recipes (
      is_test, recipe_code, revision, name, product_code, product_name, uom, batch_kg, dump_temp, dump_tol, mix_sec, rest_hours,
      yield_per_kg, items, status, created_by)
    values (true, v_code, v_rev::integer, v_name, v_pcode, v_pname, v_uom, v_batch, v_dump, v_tol, v_mix, v_rest,
            v_yield, v_items, 'draft', p_actor);
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- งาน RB ของ BOM ที่จะผูกกับ WO: ล็อกตัวนับ BOM (ต่อจาก rf_master_state) และงาน แล้วตรวจ · ผิด = RF_INVALID_SOURCE_JOB
create or replace function private.rf_job_for_link(p_job_no text)
returns public.bom_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
begin
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test and j.job_no = p_job_no for update;
  if not found or v_job.dept <> 'RB' or v_job.status = 'done' then
    raise exception 'RF_INVALID_SOURCE_JOB';
  end if;
  -- ผูกแล้วผูกซ้ำไม่ได้ เว้นแต่ WO เดิมถูกยกเลิก (ปกติยกเลิก WO ล้าง external_ref เองแล้ว กรณีนี้รับข้อมูลค้างจากก่อนหน้า)
  if v_job.external_ref is not null and not exists (
       select 1 from public.rf_orders o
       where o.is_test and o.wo_no = v_job.external_ref ->> 'woId' and o.status = 'cancelled') then
    raise exception 'RF_INVALID_SOURCE_JOB';
  end if;
  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk;
  if not found or v_ord.status not in ('released', 'in_progress') then
    raise exception 'RF_INVALID_SOURCE_JOB';
  end if;
  return v_job;
end;
$$;
revoke all on function private.rf_job_for_link(text) from public, anon, authenticated;

-- ผูกงาน BOM กับ WO (เหมือน linkJobToRubberFlow ของ client): external_ref, งาน queued -> in_progress, ใบ released -> in_progress
-- คืนจำนวนแถว BOM ที่เขียน { jobs, orders } (trigger bom_stamp_version ประทับเวอร์ชัน BOM ให้ delta)
create or replace function private.rf_link_job(p_job public.bom_jobs, p_actor_name text, p_wo text, p_kg numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orders integer;
begin
  update public.bom_jobs set
    external_ref = jsonb_build_object('system', 'rubberflow', 'woId', p_wo, 'kg', p_kg,
                                      'linkedAt', private.bom_ms(now()), 'by', p_actor_name),
    status = case when status = 'queued' then 'in_progress' else status end,
    updated_at = now()
  where id = p_job.id;
  update public.bom_orders set status = 'in_progress', updated_at = now() where id = p_job.order_pk and status = 'released';
  get diagnostics v_orders = row_count;
  return jsonb_build_object('jobs', 1, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_link_job(public.bom_jobs, text, text, numeric) from public, anon, authenticated;

-- ผลผลิตของ WO ที่ผูกงาน BOM กลับเข้างาน (WO เพิ่งเปลี่ยนเป็น completed): ต่อรายงาน good = producedQty ของ WO นี้ (ผลผลิตของ WO ไม่ใช่ยอดรวมของงาน)
-- qty_done = qty_done เดิม + producedQty ตั้งสถานะ ดันใบ released -> in_progress แล้วตั้ง fed_back_at (ป้อนกลับครั้งเดียวต่อ WO)
-- ข้ามไม่เขียนเมื่อป้อนไปแล้ว / ไม่พบงาน / external_ref ของงานไม่ชี้มา WO นี้ / ใบไม่ใช่ released-in_progress แล้ว / งาน done แล้ว คืน { jobs, orders }
create or replace function private.rf_apply_feedback(p_actor_name text, p_wo public.rf_orders)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_fed timestamptz;
  v_done numeric;
  v_status text;
  v_reports jsonb;
  v_orders integer := 0;
begin
  perform private.rf_lock_bom();
  select o.fed_back_at into v_fed from public.rf_orders o where o.id = p_wo.id for update;
  if v_fed is not null then return jsonb_build_object('jobs', 0, 'orders', 0); end if;
  select * into v_job from public.bom_jobs j where j.is_test and j.job_no = p_wo.source_job_no for update;
  if not found or (v_job.external_ref ->> 'woId') is distinct from p_wo.wo_no then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk for update;
  if v_ord.status not in ('released', 'in_progress') or v_job.status = 'done' then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;

  v_reports := v_job.reports;
  if p_wo.produced_qty > 0 then
    v_reports := v_reports || jsonb_build_array(jsonb_build_object(
      'at', private.bom_ms(now()), 'by', p_actor_name, 'good', p_wo.produced_qty, 'reject', 0, 'note', left('จาก WO ' || p_wo.wo_no, 200)));
  end if;
  v_done := v_job.qty_done + p_wo.produced_qty;
  v_status := case when v_done >= v_job.qty_planned then 'done' else 'in_progress' end;
  update public.bom_jobs set
    qty_done = v_done, reports = v_reports, status = v_status,
    done_at = case when v_status = 'done' then coalesce(v_job.done_at, now()) else null end,
    updated_at = now()
  where id = v_job.id;
  if v_ord.status = 'released' then
    update public.bom_orders set status = 'in_progress', updated_at = now() where id = v_ord.id;
    v_orders := 1;
  end if;
  update public.rf_orders set fed_back_at = now() where id = p_wo.id;
  return jsonb_build_object('jobs', 1, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_apply_feedback(text, public.rf_orders) from public, anon, authenticated;

-- ยกเลิก WO ที่ผูกงาน BOM: ล้าง external_ref ของงาน (คงยอดและรายงานเดิม) ต่อรายงานบอกว่า WO ถูกยกเลิก (good = 0, reject = 0) คืน { jobs, orders }
-- ข้ามไม่เขียนเมื่อไม่พบงานหรือ external_ref ของงานไม่ชี้มา WO นี้ (งานถูกผูกใหม่ไปแล้ว) · ตัวนับ BOM เพิ่มโดย app_rf_save
create or replace function private.rf_unlink_job(p_actor_name text, p_wo public.rf_orders)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
begin
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test and j.job_no = p_wo.source_job_no for update;
  if not found or (v_job.external_ref ->> 'woId') is distinct from p_wo.wo_no then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  update public.bom_jobs set
    external_ref = null,
    reports = v_job.reports || jsonb_build_array(jsonb_build_object(
      'at', private.bom_ms(now()), 'by', p_actor_name, 'good', 0, 'reject', 0, 'note', left('WO ' || p_wo.wo_no || ' ถูกยกเลิก', 200))),
    updated_at = now()
  where id = v_job.id;
  return jsonb_build_object('jobs', 1, 'orders', 0);
end;
$$;
revoke all on function private.rf_unlink_job(text, public.rf_orders) from public, anon, authenticated;

-- ใบสั่งผลิต WO: สิทธิ์ + กฎสถานะ + เชื่อม/ป้อนกลับ BOM (ดูหัวไฟล์) คืนจำนวนแถว BOM ที่เขียน { jobs, orders }
-- p_planner = กลุ่มวางแผน · p_rb = สมาชิก RB · p_head = หัว RB · p_qa = สมาชิก QA (เพิ่ม producedQty ผ่าน p_action = 'addQcRecord' เท่านั้น)
create or replace function private.rf_save_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rb boolean, p_head boolean, p_qa boolean, p_action text,
  p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_wo text;
  v_customer text;
  v_po text;
  v_rcode text;
  v_rrev numeric;
  v_color text;
  v_target numeric;
  v_tkg numeric;
  v_kpu numeric;
  v_prod numeric;
  v_start numeric;
  v_due numeric;
  v_priority text;
  v_note text;
  v_status text;
  v_src text;
  v_uom text;
  v_old public.rf_orders%rowtype;
  v_new public.rf_orders%rowtype;
  v_rec public.rf_recipes%rowtype;
  v_job public.bom_jobs%rowtype;
  v_content boolean;
  v_prod_changed boolean;
  v_status_changed boolean;
  v_flow boolean;
  v_res jsonb;
  v_bom_jobs integer := 0;
  v_bom_orders integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_ORDER'; end if;
    v_wo := private.bom_text(v_row, 'id', 40, 1, 'RF_INVALID_ORDER');
    if v_wo !~ '^[A-Za-z0-9._-]{1,40}$' or v_wo = any (v_seen) then raise exception 'RF_INVALID_ORDER'; end if;
    v_seen := v_seen || v_wo;
    v_customer := btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'RF_INVALID_ORDER'), '\s+', ' ', 'g'));
    v_po := private.bom_text(v_row, 'customerPo', 60, 0, 'RF_INVALID_ORDER');
    v_rcode := private.bom_text(v_row, 'recipeId', 60, 1, 'RF_INVALID_ORDER');
    v_rrev := private.bom_num(v_row -> 'recipeRevision', 'RF_INVALID_ORDER', 1, 9999);
    if v_rrev is not null and v_rrev <> trunc(v_rrev) then raise exception 'RF_INVALID_ORDER'; end if;
    v_color := private.bom_text(v_row, 'color', 40, 0, 'RF_INVALID_ORDER');
    v_target := private.bom_num(v_row -> 'targetQty', 'RF_INVALID_ORDER', 0, 1000000000);
    if v_target is null or v_target <= 0 then raise exception 'RF_INVALID_ORDER'; end if;
    v_tkg := private.bom_num(v_row -> 'targetKg', 'RF_INVALID_ORDER', 0, 1000000000);
    v_kpu := private.bom_num(v_row -> 'kgPerUnit', 'RF_INVALID_ORDER', 0, 1000000000);
    v_prod := coalesce(private.bom_num(v_row -> 'producedQty', 'RF_INVALID_ORDER', 0, 1000000000), 0);
    v_start := private.bom_num(v_row -> 'startDate', 'RF_INVALID_ORDER', 1, 100000000000000);
    v_due := private.bom_num(v_row -> 'dueDate', 'RF_INVALID_ORDER', 1, 100000000000000);
    if v_start is null or v_due is null or v_start <> trunc(v_start) or v_due <> trunc(v_due) or v_due < v_start then
      raise exception 'RF_INVALID_ORDER';
    end if;
    v_priority := coalesce(nullif(private.bom_text(v_row, 'priority', 10, 0, 'RF_INVALID_ORDER'), ''), 'normal');
    if v_priority not in ('normal', 'urgent') then raise exception 'RF_INVALID_ORDER'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_ORDER');
    v_status := private.bom_text(v_row, 'status', 20, 1, 'RF_INVALID_ORDER');
    if v_status not in ('planned', 'released', 'in_progress', 'on_hold', 'completed', 'cancelled') then raise exception 'RF_INVALID_ORDER'; end if;
    v_src := nullif(private.bom_text(v_row, 'sourceJobId', 40, 0, 'RF_INVALID_ORDER'), '');
    if v_src is not null and v_src !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'RF_INVALID_ORDER'; end if;

    select * into v_old from public.rf_orders o where o.is_test and o.wo_no = v_wo;
    if found then
      -- ใบเดิม: เนื้อหาแก้ไม่ได้หลังสร้าง (recipeRevision ที่ client ไม่ส่งมาไม่นับ) · producedQty และสถานะเปลี่ยนได้ตามกฎ
      v_content := v_old.customer <> v_customer or v_old.customer_po <> v_po or v_old.recipe_code <> v_rcode
        or (v_rrev is not null and v_old.recipe_revision <> v_rrev::integer) or v_old.color <> v_color
        or v_old.target_qty <> v_target or v_old.target_kg is distinct from v_tkg or v_old.kg_per_unit is distinct from v_kpu
        or v_old.start_date <> v_start::bigint or v_old.due_date <> v_due::bigint or v_old.priority <> v_priority
        or v_old.note <> v_note or v_old.source_job_no is distinct from v_src;
      v_prod_changed := v_old.produced_qty <> v_prod;
      v_status_changed := v_old.status <> v_status;
      -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน)
      if not (v_content or v_prod_changed or v_status_changed) then continue; end if;

      -- ชนก่อนสิทธิ์/กฎเสมอ: สำเนาที่ต่างจากแถวล่าสุดและแถวนั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = client ถือสำเนาเก่า
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      if not (p_planner or p_rb) then
        -- QA: ทำได้ทางเดียว = เพิ่ม producedQty ของใบเดิมผ่านการบันทึกผลตรวจ (addQcRecord) อย่างอื่นทุกอย่าง = RF_FORBIDDEN
        if not (p_qa and p_action = 'addQcRecord' and not v_content and not v_status_changed and v_prod > v_old.produced_qty) then
          raise exception 'RF_FORBIDDEN';
        end if;
      end if;
      if v_content then raise exception 'RF_INVALID_ORDER'; end if;
      -- ปล่อยผลิต: กลุ่มวางแผนหรือหัว RB (ตรวจสิทธิ์ก่อนความถูกต้องของสถานะ)
      if v_status_changed and v_status = 'released' and not (p_planner or p_head) then raise exception 'RF_FORBIDDEN'; end if;
      if v_status_changed then
        v_flow := case v_old.status
          when 'planned' then v_status in ('released', 'cancelled')
          when 'released' then v_status in ('in_progress', 'on_hold', 'cancelled')
          when 'in_progress' then v_status in ('on_hold', 'completed')
          when 'on_hold' then v_status = 'in_progress'
          else false end;
        if not v_flow then raise exception 'RF_INVALID_TRANSITION'; end if;
      end if;
      -- ยอดผลิตเปลี่ยนได้เฉพาะใบที่ปล่อยแล้ว และสถานะใหม่ยังผลิตอยู่/พักงาน/ปิดงาน · ใบ completed แล้วเพิ่มได้อย่างเดียว (ผลิตเกิน / ปล่อยของช้า)
      if v_prod_changed then
        if v_old.status = 'completed' then
          if v_prod < v_old.produced_qty then raise exception 'RF_INVALID_ORDER'; end if;
        elsif v_old.status not in ('released', 'in_progress', 'on_hold') or v_status not in ('in_progress', 'on_hold', 'completed') then
          raise exception 'RF_INVALID_ORDER';
        end if;
      end if;
      -- ปิด WO ที่ผูกงาน BOM ต้องมียอดผลิต
      if v_status_changed and v_status = 'completed' and v_old.source_job_no is not null and v_prod <= 0 then
        raise exception 'RF_INVALID_PRODUCED';
      end if;

      update public.rf_orders set
        status = v_status, produced_qty = v_prod,
        released_at = case when v_status = 'released' and v_status_changed then now() else released_at end,
        released_by = case when v_status = 'released' and v_status_changed then p_actor.id else released_by end,
        completed_at = case when v_status = 'completed' and v_status_changed then now() else completed_at end,
        cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else cancelled_at end,
        updated_at = now()
      where id = v_old.id
      returning * into v_new;
      if v_status_changed and v_status = 'completed' and v_new.source_job_no is not null then
        v_res := private.rf_apply_feedback(p_actor_name, v_new);
        v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
        v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
      end if;
      -- ยกเลิก WO ที่ผูกงาน BOM: ล้างการผูกของงาน (ผูกกับ WO ใบใหม่ได้) ในธุรกรรมเดียวกัน
      if v_status_changed and v_status = 'cancelled' and v_new.source_job_no is not null then
        v_res := private.rf_unlink_job(p_actor_name, v_new);
        v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
        v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
      end if;
      continue;
    end if;

    -- ใบใหม่: กลุ่มวางแผนหรือสมาชิก RB เริ่มที่ planned เสมอ ยอดผลิต 0
    if not (p_planner or p_rb) then raise exception 'RF_FORBIDDEN'; end if;
    if v_status <> 'planned' then raise exception 'RF_INVALID_TRANSITION'; end if;
    if v_prod <> 0 then raise exception 'RF_INVALID_ORDER'; end if;
    -- สูตร: ใช้ได้เฉพาะ approved (ไม่ระบุ revision = ตัวที่ approved อยู่) สูตรที่ถูกแก้หลังเวอร์ชันฐาน = ถือสำเนาเก่า
    if v_rrev is null then
      select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_rcode and r.status = 'approved';
    else
      select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_rcode and r.revision = v_rrev::integer;
    end if;
    if not found or v_rec.status <> 'approved' then
      if exists (select 1 from public.rf_recipes r where r.is_test and r.recipe_code = v_rcode
                 and r.changed_version > p_base and r.changed_version <= p_cur) then
        raise exception 'RF_STALE';
      end if;
      raise exception 'RF_INVALID_RECIPE';
    end if;
    v_uom := v_rec.uom;
    if v_src is not null then
      -- ตรวจและล็อกงาน BOM ก่อนเขียน WO (ผิด = RF_INVALID_SOURCE_JOB) WO ใช้หน่วยของงาน
      v_job := private.rf_job_for_link(v_src);
      v_uom := v_job.uom;
    end if;
    insert into public.rf_orders (
      is_test, wo_no, customer, customer_po, recipe_code, recipe_revision, product_code, product_name, uom, color,
      target_qty, target_kg, kg_per_unit, produced_qty, start_date, due_date, priority, note, status, source_job_no, created_by)
    values (
      true, v_wo, v_customer, v_po, v_rec.recipe_code, v_rec.revision, v_rec.product_code, v_rec.product_name, v_uom, v_color,
      v_target, v_tkg, v_kpu, 0, v_start::bigint, v_due::bigint, v_priority, v_note, 'planned', v_src, p_actor.id);
    if v_src is not null then
      v_res := private.rf_link_job(v_job, p_actor_name, v_wo, coalesce(v_tkg, 0));
      v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
      v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_bom_jobs, 'orders', v_bom_orders);
end;
$$;
revoke all on function private.rf_save_orders(public.employees, text, boolean, boolean, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. snapshot / delta -----------------------------------------------------------------------
-- ระเบียนที่ changed_version > p_since แยกตามชุด เรียงแบบกำหนดได้ · p_since = -1 ได้ทั้งหมด (snapshot)
create or replace function private.rf_records(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', m.code, 'name', m.name, 'category', m.category, 'storage', m.storage_location, 'uom', m.uom, 'active', m.active,
          'createdAt', private.bom_ms(m.created_at)) order by m.code collate "C")
      from public.rf_materials m where m.is_test and m.changed_version > p_since), '[]'::jsonb),
    'recipes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.recipe_code, 'revision', r.revision, 'name', r.name, 'productCode', r.product_code, 'productName', r.product_name,
          'uom', r.uom, 'batchKg', r.batch_kg, 'dumpTemp', r.dump_temp, 'dumpTol', r.dump_tol, 'mixSec', r.mix_sec,
          'restHours', r.rest_hours, 'yieldPerKg', r.yield_per_kg, 'items', r.items, 'status', r.status,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.approved_at is null then '{}'::jsonb
                else jsonb_build_object('approvedBy', coalesce(private.bom_person(r.approved_by), ''), 'approvedAt', private.bom_ms(r.approved_at)) end
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        order by r.recipe_code collate "C", r.revision)
      from public.rf_recipes r where r.is_test and r.changed_version > p_since), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.wo_no, 'customer', o.customer, 'customerPo', o.customer_po, 'recipeId', o.recipe_code, 'recipeRevision', o.recipe_revision,
          'productCode', o.product_code, 'productName', o.product_name, 'uom', o.uom, 'color', o.color,
          'targetQty', o.target_qty, 'producedQty', o.produced_qty, 'startDate', o.start_date, 'dueDate', o.due_date,
          'priority', o.priority, 'note', o.note, 'status', o.status,
          'createdBy', coalesce(private.bom_person(o.created_by), ''), 'createdAt', private.bom_ms(o.created_at))
        || case when o.target_kg is null then '{}'::jsonb else jsonb_build_object('targetKg', o.target_kg) end
        || case when o.kg_per_unit is null then '{}'::jsonb else jsonb_build_object('kgPerUnit', o.kg_per_unit) end
        || case when o.source_job_no is null then '{}'::jsonb else jsonb_build_object('sourceJobId', o.source_job_no) end
        || case when o.released_at is null then '{}'::jsonb
                else jsonb_build_object('releasedAt', private.bom_ms(o.released_at), 'releasedBy', coalesce(private.bom_person(o.released_by), '')) end
        || case when o.completed_at is null then '{}'::jsonb else jsonb_build_object('completedAt', private.bom_ms(o.completed_at)) end
        || case when o.cancelled_at is null then '{}'::jsonb else jsonb_build_object('cancelledAt', private.bom_ms(o.cancelled_at)) end
        order by o.created_at desc, o.wo_no collate "C" desc)
      from public.rf_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.rf_records(bigint) from public, anon, authenticated;

-- ส่วนต่างหลังเวอร์ชัน p_since: { version, epoch, changes: { <ชุด>: { upsert, delete } } } ครบสามชุดเสมอ (รอบนี้ delete เป็น [] ทุกชุด)
create or replace function private.rf_delta(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((select s.version from public.rf_master_state s where s.is_test), 0),
    'epoch', (select s.epoch from public.rf_master_state s where s.is_test),
    'changes', (
      select jsonb_object_agg(l.list, jsonb_build_object('upsert', r.records -> l.list, 'delete', '[]'::jsonb))
      from (values ('materials'), ('recipes'), ('orders')) as l(list)
      cross join (select private.rf_records(p_since) as records) r))
$$;
revoke all on function private.rf_delta(bigint) from public, anon, authenticated;

-- snapshot ทั้งชุด: { version, epoch, materials, recipes, orders }
create or replace function private.rf_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('version', coalesce((select s.version from public.rf_master_state s where s.is_test), 0),
                            'epoch', (select s.epoch from public.rf_master_state s where s.is_test))
         || private.rf_records(-1)
$$;
revoke all on function private.rf_snapshot() from public, anon, authenticated;

-- 6. RPC สาธารณะ -------------------------------------------------------------------------------
-- อ่านทั้งชุด: persona ทุกตัวอ่านได้
create or replace function public.app_rf_master()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.rf_actor();
  return private.rf_snapshot();
end;
$$;

-- ส่วนต่างหลังเวอร์ชัน p_version (อ่านอย่างเดียว ทุก persona) p_version ต้องไม่ว่าง 0 ถึง version ปัจจุบัน
create or replace function public.app_rf_master_since(p_version bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.rf_actor();
  if p_version is null or p_version < 0
     or p_version > coalesce((select s.version from public.rf_master_state s where s.is_test), 0) then
    raise exception 'RF_INVALID_PAYLOAD';
  end if;
  return private.rf_delta(p_version);
end;
$$;

-- บันทึกชุดการเปลี่ยนแปลงในธุรกรรมเดียว ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย คืน delta ตั้งแต่ p_base_version: { version, epoch, changes }
-- ไม่มีการเปลี่ยนแปลงเลย (ทุกส่วนว่าง) = คืน delta โดยไม่เพิ่ม version และไม่เขียน audit
create or replace function public.app_rf_save(
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
  v_rb boolean;
  v_head boolean;
  v_qa boolean;
  v_sections constant text[] := array['materials', 'recipes', 'orders'];
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
  v_bom jsonb := jsonb_build_object('jobs', 0, 'orders', 0);
  v_bom_version bigint;
begin
  perform private.lab_only_block();
  v_actor := private.rf_actor();
  v_planner := private.bom_can_edit(v_actor);
  v_rb := private.rf_is_rb(v_actor);
  v_head := private.rf_is_rb_head(v_actor);
  v_qa := private.rf_is_qa(v_actor);
  if p_action is null or not (p_action = any (private.rf_client_actions())) then raise exception 'RF_INVALID_ACTION'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_base_version is null or p_base_version < 0 then
    raise exception 'RF_INVALID_PAYLOAD';
  end if;

  -- audit ของ client: [{action, detail}] ไม่เกิน 20 รายการ
  if p_audit is not null and jsonb_typeof(p_audit) <> 'null' then
    if jsonb_typeof(p_audit) <> 'array' or jsonb_array_length(p_audit) > 20 then raise exception 'RF_INVALID_PAYLOAD'; end if;
    for v_entry in select value from jsonb_array_elements(p_audit) loop
      if jsonb_typeof(v_entry) <> 'object' then raise exception 'RF_INVALID_PAYLOAD'; end if;
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'action', private.bom_text(v_entry, 'action', 80, 1, 'RF_INVALID_PAYLOAD'),
        'detail', private.bom_text(v_entry, 'detail', 300, 0, 'RF_INVALID_PAYLOAD')));
    end loop;
  end if;

  -- รูปของ payload: ส่วนที่รู้จัก, upsert เท่านั้น (ไม่มีลบ), อาร์เรย์ไม่เกิน 5,000 เรคอร์ดต่อส่วน
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_sections)) then raise exception 'RF_INVALID_PAYLOAD'; end if;
    v_sec := p_changes -> v_key;
    if jsonb_typeof(v_sec) <> 'object' then raise exception 'RF_INVALID_PAYLOAD'; end if;
    for v_sub in select jsonb_object_keys(v_sec) loop
      if v_sub <> 'upsert' then raise exception 'RF_INVALID_PAYLOAD'; end if;
      v_node := v_sec -> v_sub;
      if jsonb_typeof(v_node) <> 'array' then raise exception 'RF_INVALID_PAYLOAD'; end if;
      v_n := jsonb_array_length(v_node);
      if v_n > 5000 then raise exception 'RF_TOO_MANY'; end if;
      -- เขียนได้เฉพาะกลุ่มวางแผนหรือสมาชิก RB · QA เฉพาะส่วน orders ผ่าน addQcRecord (สิทธิ์รายระเบียนตรวจในตัวเขียน)
      if v_n > 0 and not (v_planner or v_rb or (v_qa and v_key = 'orders' and p_action = 'addQcRecord')) then raise exception 'RF_FORBIDDEN'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ล็อกตัวนับ RF ก่อนตรวจชน (ลำดับล็อก: RF ก่อน BOM เสมอ) v_version = เวอร์ชันก่อนบันทึกนี้ (p_cur ของตัวเขียน)
  insert into public.rf_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version, s.epoch into v_version, v_epoch from public.rf_master_state s where s.is_test for update;
  -- client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร
  if p_epoch is not null and p_epoch <> v_epoch::text then raise exception 'RF_RESET'; end if;
  if p_base_version > v_version then raise exception 'RF_INVALID_PAYLOAD'; end if;
  if v_total = 0 then return private.rf_delta(p_base_version); end if;

  v_actor_name := v_actor.first_name || ' ' || v_actor.last_name;

  begin
    perform private.rf_save_materials(v_actor.id, coalesce(p_changes #> '{materials,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_recipes(v_actor.id, v_head, coalesce(p_changes #> '{recipes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom := private.rf_save_orders(v_actor, v_actor_name, v_planner, v_rb, v_head, v_qa, p_action,
                                    coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb), p_base_version, v_version);
  exception
    when unique_violation then
      raise exception 'RF_CONFLICT';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation or datetime_field_overflow then
      -- ข้อความกลาง ๆ ไม่คืนค่าหรือชื่อ constraint กลับไป
      raise exception 'RF_INVALID_DATA';
  end;

  -- ไม่มีแถวไหนเปลี่ยนจริง (ทุกเรคอร์ดตรงกับที่เก็บ): คืน delta โดยไม่เพิ่ม version ไม่เขียน audit
  -- แถวที่เขียนในคำสั่งนี้ถูก trigger ประทับ version ก่อนบันทึก + 1 จึงมี changed_version > v_version ส่วนฝั่ง BOM นับจาก v_bom
  if (v_bom ->> 'jobs')::integer + (v_bom ->> 'orders')::integer = 0
     and not exists (select 1 from public.rf_materials t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_recipes t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_orders t where t.is_test and t.changed_version > v_version) then
    return private.rf_delta(p_base_version);
  end if;

  v_version := v_version + 1;
  update public.rf_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test;

  -- เขียนฝั่ง BOM (ผูกงาน / ป้อนผลผลิตกลับ): เพิ่มตัวนับ BOM อีก 1 (ล็อกไว้แล้วตอนเขียนงาน) แถวที่แก้ถูกประทับเวอร์ชันนี้โดย trigger แล้ว
  -- เขียน audit ของ BOM ด้วย ให้ประวัติ BOM บอกว่างาน/ใบเปลี่ยนเพราะ RubberFlow
  if (v_bom ->> 'jobs')::integer + (v_bom ->> 'orders')::integer > 0 then
    update public.bom_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test
    returning version into v_bom_version;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_bom_version::text,
            jsonb_build_object('client_action', 'rubberflow:' || p_action, 'version', v_bom_version, 'base_version', v_bom_version - 1,
                               'counts', jsonb_strip_nulls(jsonb_build_object(
                                 'jobs', case when (v_bom ->> 'jobs')::integer > 0 then jsonb_build_object('upsert', (v_bom ->> 'jobs')::integer) end,
                                 'orders', case when (v_bom ->> 'orders')::integer > 0 then jsonb_build_object('upsert', (v_bom ->> 'orders')::integer) end)),
                               'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                               'entries', '[]'::jsonb));
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'bom_jobs', (v_bom ->> 'jobs')::integer, 'bom_orders', (v_bom ->> 'orders')::integer,
                             'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit));
  return private.rf_delta(p_base_version);
end;
$$;

-- ประวัติการใช้งาน RubberFlow ของโหมดทดสอบ (ใหม่สุดก่อน) หนึ่งแถว audit_logs = หนึ่งบรรทัด
-- action / detail เป็นสิ่งที่เซิร์ฟเวอร์บันทึกเอง: ชื่อ action ของ client (ผ่านรายการที่อนุญาต) และจำนวนระเบียนที่เปลี่ยนต่อส่วน
-- entries = ข้อความไทยที่ client ส่งมาเอง แสดงเป็นหมายเหตุรอง ไม่ใช่หลักฐาน · persona ทุกตัวอ่านได้
create or replace function public.app_rf_audit(p_limit integer default 200)
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
  perform private.rf_actor();
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', t.at, 'user', t.usr, 'action', t.action, 'detail', t.detail, 'entries', t.entries) order by t.id desc)
    from (
      select a.id, private.bom_ms(a.created_at) as at,
             coalesce(a.metadata ->> 'persona_name', a.metadata ->> 'persona_employee_no', '') as usr,
             case when a.action = 'RF_SANDBOX_PURGE' then 'ล้างข้อมูล RubberFlow ทดสอบ' else coalesce(a.metadata ->> 'client_action', a.action) end as action,
             case when a.action = 'RF_SANDBOX_PURGE' then 'ลบ ' || coalesce(a.metadata ->> 'deleted', '0') || ' แถว'
                  else coalesce((
                    select string_agg(c.key || coalesce(' +' || nullif(c.value ->> 'upsert', '0'), ''), ', ' order by c.key)
                    from jsonb_each(case when jsonb_typeof(a.metadata -> 'counts') = 'object' then a.metadata -> 'counts' else '{}'::jsonb end) c
                    where jsonb_typeof(c.value) = 'object' and coalesce(c.value ->> 'upsert', '0') <> '0'), '') end as detail,
             case when a.action = 'RF_SAVE' and jsonb_typeof(a.metadata -> 'entries') = 'array' then a.metadata -> 'entries' else '[]'::jsonb end as entries
      from public.audit_logs a
      where a.action in ('RF_SAVE', 'RF_SANDBOX_PURGE') and a.metadata ->> 'is_test' = 'true'
      order by a.id desc
      limit v_limit
    ) t), '[]'::jsonb);
end;
$$;

-- ล้างข้อมูล RubberFlow ทดสอบ (admin จริงที่อยู่ในโหมดทดสอบ แบบเดียวกับ app_sandbox_purge_bom)
-- ลบทุกแถว is_test ของตาราง rf_* (ลูกก่อนแม่) เปลี่ยน epoch (ตัวนับ version เดินต่อ) เขียน audit (audit_logs เดิมคงไว้) ไม่แตะข้อมูลจริง และไม่แตะ BOM
create or replace function public.app_sandbox_purge_rf()
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

  -- ล็อกแถวตัวนับก่อนลบ (เหมือน app_rf_save) การบันทึกที่กำลังทำอยู่จึงจบก่อน
  insert into public.rf_master_state (is_test, version) values (true, 0) on conflict (is_test) do nothing;
  perform 1 from public.rf_master_state s where s.is_test for update;

  foreach v_table in array array['rf_orders', 'rf_recipes', 'rf_materials', 'rf_deleted_keys'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;
  -- ไม่ตั้ง version กลับเป็น 0: ตัวนับเดินต่อ · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
  update public.rf_master_state set epoch = gen_random_uuid(), updated_at = now(), updated_by = null where is_test returning version into v_version;
  if not found then
    insert into public.rf_master_state (is_test, version) values (true, 0);
    v_version := 0;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'RF_SANDBOX_PURGE', 'rf_master', v_version::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'persona_name', v_persona.first_name || ' ' || v_persona.last_name,
                             'entries', jsonb_build_array(jsonb_build_object(
                               'action', 'ล้างข้อมูล RubberFlow ทดสอบ', 'detail', 'ลบ ' || v_deleted || ' แถว'))));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.app_rf_master() from public, anon;
revoke all on function public.app_rf_master_since(bigint) from public, anon;
revoke all on function public.app_rf_save(jsonb, bigint, text, jsonb, text) from public, anon;
revoke all on function public.app_rf_audit(integer) from public, anon;
revoke all on function public.app_sandbox_purge_rf() from public, anon;
grant execute on function public.app_rf_master() to authenticated;
grant execute on function public.app_rf_master_since(bigint) to authenticated;
grant execute on function public.app_rf_save(jsonb, bigint, text, jsonb, text) to authenticated;
grant execute on function public.app_rf_audit(integer) to authenticated;
grant execute on function public.app_sandbox_purge_rf() to authenticated;

-- 7. BOM: คอมปาวด์ผูกกับสูตร RubberFlow ได้เฉพาะรหัสสูตรที่มีอยู่ (นิยามจาก 20261105010000_bom_master_data.sql เพิ่มเฉพาะการตรวจ recipeId) -----
-- recipeId ที่ไม่ว่างและต่างจากค่าที่เก็บไว้ต้องมีใน rf_recipes (สถานะใดก็ได้ หน้าจอเสนอเฉพาะ approved) ไม่เช่นนั้น BOM_INVALID_COMPOUND
-- ค่าที่ไม่เปลี่ยนจากเดิมไม่ตรวจ จึงบันทึกคอมปาวด์เดิมซ้ำได้แม้สูตรที่ผูกไว้ถูกล้างไปแล้ว
create or replace function private.bom_save_compounds(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_code text;
  v_recipe text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COMPOUND'; end if;
    v_code := upper(private.bom_text(v_row, 'code', 20, 1, 'BOM_INVALID_COMPOUND'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_COMPOUND'; end if;
    v_seen := v_seen || v_code;
    if exists (select 1 from public.bom_compounds c where c.is_test and c.code = v_code
               and c.changed_version > p_base and c.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    v_recipe := nullif(private.bom_text(v_row, 'recipeId', 60, 0, 'BOM_INVALID_COMPOUND'), '');
    if v_recipe is not null
       and (select c.recipe_id from public.bom_compounds c where c.is_test and c.code = v_code) is distinct from v_recipe
       and not exists (select 1 from public.rf_recipes r where r.is_test and r.recipe_code = v_recipe) then
      raise exception 'BOM_INVALID_COMPOUND';
    end if;
    insert into public.bom_compounds (is_test, code, name, recipe_id, recipe_name)
    values (true, v_code,
            coalesce(nullif(private.bom_text(v_row, 'name', 120, 0, 'BOM_INVALID_COMPOUND'), ''), v_code),
            v_recipe,
            nullif(private.bom_text(v_row, 'recipeName', 120, 0, 'BOM_INVALID_COMPOUND'), ''))
    on conflict (code, is_test) do update set
      name = excluded.name, recipe_id = excluded.recipe_id, recipe_name = excluded.recipe_name, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.bom_save_compounds(uuid, jsonb, bigint, bigint) from public, anon, authenticated;
