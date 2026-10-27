-- ============================================================================
-- ใบตรวจ QC (Data Inspection Report, ฟอร์ม QA01-PM11) — ฐานข้อมูล เปิดเฉพาะโหมดทดสอบ
--
-- ที่มา: ฟอร์มกระดาษ QA01-PM11 ของฝ่าย QA
--   หัวใบ  = Part Number, Part Name, customer, Order No., Code, Inspecter By, inspection Date, Results (OK / Reject / Accept)
--   ตาราง  = ITEM No. (A, B, C, D…), Inspection Item, Instrument, Specification MIN/STD/MAX,
--            Sample (2M) point 1..5, min, max, average, Judge (O = OK, N = NG, AC = ACCEPT)
--   ท้ายใบ = REMARK และช่องลายเซ็น Inspector / manager QA / factory manager / General Manager Approved
--
-- ขอบเขตรอบนี้ (ฐานข้อมูลอย่างเดียว ยังไม่มีหน้าเว็บ รูปแนบ MDR และยังไม่เปิดกับข้อมูลจริง)
--   1) แม่แบบตรวจต่อ Part (1 Part = 1 ชุดรายการ A/B/C/D…) บันทึกผ่าน app_qc_save_template
--   2) ใบตรวจ: ผู้ตรวจกรอกค่าที่วัดได้ 1-5 จุดต่อรายการ ฐานข้อมูลคำนวณ min / max / average (ปัด 4 ตำแหน่ง) และตัดสิน
--      O / N / NA ต่อรายการจากสเปก MIN-MAX เอง (ไม่รับ judge จาก client) ผู้ตรวจยอมรับรายการที่ N ได้เป็น AC
--      (judge_override = 'AC' ต้องมีหมายเหตุรายข้ออย่างน้อย 5 ตัวอักษร) ผลรวมของใบ: 'ng' ถ้ามี N, 'accept' ถ้าไม่มี N แต่มี AC, 'ok' นอกนั้น
--   3) สายอนุมัติ 3 ขั้น: manager QA -> factory manager -> General Manager (ผู้ตรวจ = คนส่งใบ ห้ามอนุมัติใบตัวเอง)
--      ไม่อนุมัติต้องมีเหตุผล ใบที่ไม่อนุมัติเปิดกลับเป็นฉบับร่างหรือยกเลิกได้
--   4) "Lot ยางผสม" ของใบเชื่อมกับผล Mooney ใน public.lab_mooney_results ด้วยคอลัมน์ใหม่ lot_number
--      (app_lab_mooney_import รับ lot_number เพิ่ม) app_qc_report คืนสรุปผล Mooney ต่อ Lot และ app_qc_lots ค้นรายการ Lot
--   5) ออก NCR จากใบที่ผลเป็น 'ng' ด้วย public.app_ncr_issue (แหล่งที่พบ final_fg) ในธุรกรรมเดียวกัน
--
-- เปิดเฉพาะโหมดทดสอบ (admin ที่ทำหน้าที่เป็น persona) เหมือนโมดูล factory_* ทุกประการ
--   ทุก RPC ปฏิเสธนอกโหมดทดสอบด้วย QC_TEST_MODE_ONLY (private.qc_actor) เมื่อจะเปิดใช้จริงต้องเปลี่ยน qc_actor ให้คืนพนักงานจริง
--   และเพิ่มเทสต์อนุญาต/ปฏิเสธของบทบาทจริง ในโหมดทดสอบสิทธิ์ตัดสินจากบทบาทของ persona:
--     - อ่าน (private.qc_can_read)  : แผนก QA ทุกบทบาท, factory_manager, assistant_factory_manager, general_manager, admin
--     - แก้/ส่ง/เปิดกลับ/ยกเลิก/ออก NCR (private.qc_can_edit) : แผนก QA ทุกบทบาท หรือ admin
--     - อนุมัติแต่ละขั้น (private.qc_step_allowed) : manager QA = ผู้จัดการ/ผู้ช่วยผู้จัดการแผนก QA,
--       factory manager = factory_manager, General Manager = general_manager
--   ตัวบังคับจริงคือ RPC หน้าเว็บใช้ app_qc_access แค่ซ่อน/แสดงปุ่ม
--
-- การแยกข้อมูลทดสอบ (ตามกติกาของโหมดทดสอบใน README)
--   1) ทุกตารางข้อมูลมี is_test ที่ trigger private.factory_sandbox_scope กำหนดจากโหมดของผู้ทำรายการ (ไม่รับจาก client)
--      และห้ามแก้/ลบแถวข้ามโหมด (SANDBOX_SCOPE_MISMATCH) foreign key ลูกเป็นแบบคู่ (id, is_test)
--   2) ผู้ทำรายการมาจาก private.sandbox_persona() ผ่าน private.qc_actor
--   3) เลขที่ใบออกจาก document_counters แยกชุด 'QC-TEST' ขึ้นต้น TEST-QC-<YY>-<NNN> (ชุดจริง 'QC' ไม่ถูกแตะ)
--   4) โมดูลนี้ไม่ส่งแจ้งเตือน (ใบ NCR ที่ออกเป็นใบทดสอบ ไม่มีผู้รับตามกติกาของ NCR ในโหมดทดสอบ)
--   5) ใช้ persona ชุดเดิม (SBX-*) และมี pgTAP ทั้งอนุญาต/ปฏิเสธที่ qc_inspection_reports.test.sql
--   ตารางลงทะเบียนใน private.sandbox_unguarded_tables() และ lab-only: ทุกตารางเรียก private.lab_only_guard_table
--   ทุก RPC ใน public ขึ้นต้นด้วย private.lab_only_block()
--
-- สิทธิ์: ทุกตารางปิด RLS แบบ deny-all และถอนสิทธิ์ anon/authenticated ทั้งหมด อ่าน/เขียนผ่าน RPC security definer
-- (search_path ว่าง) ที่ตรวจผู้ทำรายการเท่านั้น การแก้ใบใช้ version กันบันทึกทับ (select ... for update + เทียบ version
-- ในธุรกรรมเดียวกับการเขียนประวัติ) และบันทึก audit_logs ทุกครั้งโดยใช้ admin ตัวจริงเบื้องหลัง persona เป็นผู้กระทำ
--
-- นิยามที่ replace ในไฟล์นี้ (เริ่มจากนิยามล่าสุดของแต่ละตัว)
--   - public.app_lab_mooney_import(jsonb, boolean): จาก 20261016044946_lab_supabase_read_model.sql เพิ่มเฉพาะ lot_number
--   - private.sandbox_unguarded_tables(): จาก 20261009030000_factory_attachments.sql เพิ่ม qc_inspection_*
--
-- ลำดับ deploy: migration นี้ต้อง apply ที่ production ก่อน merge หน้าเว็บของโมดูลนี้ (PR ถัดไป) ตาม "Deployment order" ใน AGENTS.md
--
-- Rollback (ตาราง qc_* มีแต่ข้อมูลทดสอบ):
--   drop function public.app_qc_access(), app_qc_templates(), app_qc_save_template(jsonb), app_qc_reports(jsonb),
--   app_qc_report(uuid), app_qc_save_report(jsonb), app_qc_submit_report(uuid, integer),
--   app_qc_decide_report(uuid, integer, text, text), app_qc_reopen_report(uuid, integer),
--   app_qc_cancel_report(uuid, integer, text),
--   app_qc_issue_ncr(uuid, integer, text, numeric, numeric, text, text), app_qc_lots(text), app_sandbox_purge_qc();
--   drop function private.qc_actor(), qc_audit_actor_id(), qc_can_read(public.employees), qc_can_edit(public.employees),
--   qc_step_allowed(public.employees, text), next_qc_doc_number(), qc_judge(numeric[], numeric, numeric), qc_text(jsonb, text, integer, integer, text),
--   qc_num(jsonb, text), qc_result(uuid), qc_template_json(uuid), qc_report_json(uuid), qc_record(uuid, text, text, uuid, text);
--   drop table qc_inspection_history, qc_inspection_approvals, qc_inspection_items, qc_inspection_reports,
--   qc_inspection_template_items, qc_inspection_templates (ลูกก่อนแม่); delete from public.document_counters where department_code = 'QC-TEST';
--   drop index lab_mooney_results_lot_idx; alter table public.lab_mooney_results drop column lot_number;
--   แล้ว create or replace app_lab_mooney_import และ private.sandbox_unguarded_tables ด้วยนิยามเดิมจาก
--   20261016044946_lab_supabase_read_model.sql และ 20261009030000_factory_attachments.sql
-- ============================================================================

-- 1. Lot ยางผสมในผล Mooney ---------------------------------------------------------------
alter table public.lab_mooney_results
  add column lot_number text check (lot_number is null or char_length(lot_number) between 1 and 60);
create index lab_mooney_results_lot_idx on public.lab_mooney_results (lot_number, test_date desc)
  where lot_number is not null;
comment on column public.lab_mooney_results.lot_number is
  'Lot ยางผสมของตัวอย่าง (ว่างได้) ใบตรวจ QC อ้างด้วย qc_inspection_reports.compound_lots';

-- นิยามล่าสุดจาก 20261016044946_lab_supabase_read_model.sql เพิ่มเฉพาะ lot_number (รายการ Lot ในแถวที่นำเข้า)
create or replace function public.app_lab_mooney_import(p_rows jsonb, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_count integer;
  v_inserted integer;
  v_updated integer;
  v_stale integer;
  v_deleted integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'LAB_INVALID_PAYLOAD';
  end if;
  v_count := jsonb_array_length(p_rows);
  -- แถวว่างไม่ใช่ "ชีตว่าง": กันการอ่านชีตพลาดแล้วล้างตารางทั้งก้อน
  if v_count not between 1 and 20000 then
    raise exception 'LAB_INVALID_PAYLOAD';
  end if;

  -- นำเข้าทีละครั้ง ไม่ให้สองรอบลบแถวของกันและกัน
  perform pg_advisory_xact_lock(hashtext('lab_mooney_import'));

  begin
    with incoming as (
      select btrim(r.source_sheet) as source_sheet,
             btrim(r.sample_id) as sample_id,
             btrim(r.material) as material,
             r.test_date::date as test_date,
             r.test_time::time as test_time,
             r.temperature_c, r.test_minutes, r.mh, r.mv,
             r.avg_mh, r.sd_mh, r.avg_mv, r.sd_mv,
             nullif(btrim(r.lot_number), '') as lot_number
      from jsonb_to_recordset(p_rows) as r(
        source_sheet text, sample_id text, material text, test_date text, test_time text,
        temperature_c numeric, test_minutes numeric, mh numeric, mv numeric,
        avg_mh numeric, sd_mh numeric, avg_mv numeric, sd_mv numeric, lot_number text
      )
      -- รูปแบบวันที่/เวลาตายตัว ไม่พึ่งการตั้งค่า DateStyle ของ session
      where r.test_date ~ '^\d{4}-\d{2}-\d{2}$' and r.test_time ~ '^\d{1,2}:\d{2}(:\d{2})?$'
    ), upserted as (
      insert into public.lab_mooney_results (
        source_sheet, sample_id, material, test_date, test_time, temperature_c, test_minutes,
        mh, mv, avg_mh, sd_mh, avg_mv, sd_mv, lot_number, imported_at
      )
      select source_sheet, sample_id, material, test_date, test_time, temperature_c, test_minutes,
             mh, mv, avg_mh, sd_mh, avg_mv, sd_mv, lot_number, v_started
      from incoming
      on conflict (source_sheet, sample_id, test_date, test_time) do update set
        material = excluded.material,
        temperature_c = excluded.temperature_c,
        test_minutes = excluded.test_minutes,
        mh = excluded.mh,
        mv = excluded.mv,
        avg_mh = excluded.avg_mh,
        sd_mh = excluded.sd_mh,
        avg_mv = excluded.avg_mv,
        sd_mv = excluded.sd_mv,
        lot_number = excluded.lot_number,
        imported_at = excluded.imported_at
      returning (xmax = 0) as was_inserted
    )
    select count(*) filter (where was_inserted)::integer,
           count(*) filter (where not was_inserted)::integer
    into v_inserted, v_updated
    from upserted;

    -- แถวที่ถูกกรองทิ้งเพราะรูปแบบวันที่/เวลาผิด = ข้อมูลไม่ถูกต้อง ไม่ใช่ "แถวที่หายไป"
    if v_inserted + v_updated <> v_count then
      raise exception 'LAB_INVALID_ROW';
    end if;
  exception
    when check_violation or not_null_violation or invalid_text_representation
      or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
      or string_data_right_truncation or cardinality_violation then
      -- ข้อความกลางๆ ไม่คืนค่าในแถวที่ผิดกลับไป
      raise exception 'LAB_INVALID_ROW';
  end;

  select count(*)::integer into v_stale
  from public.lab_mooney_results
  where imported_at < v_started;

  -- ด่านกันลบเกินครึ่ง: ชีตที่อ่านมาไม่ครบ (เช่นขาดหลายแท็บ) จะไม่ล้างข้อมูลที่มีอยู่
  if not coalesce(p_force, false) and v_stale >= 10 and v_stale * 2 > v_stale + v_updated then
    raise exception 'LAB_IMPORT_TOO_DESTRUCTIVE';
  end if;

  delete from public.lab_mooney_results where imported_at < v_started;
  get diagnostics v_deleted = row_count;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null, 'IMPORT', 'lab_mooney_results', null,
    jsonb_build_object('rows', v_count, 'inserted', v_inserted, 'updated', v_updated,
                       'deleted', v_deleted, 'forced', coalesce(p_force, false))
  );

  return jsonb_build_object('rows', v_count, 'inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted);
end;
$$;
revoke all on function public.app_lab_mooney_import(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.app_lab_mooney_import(jsonb, boolean) to service_role;

-- 2. ตาราง (แยกโหมดด้วย is_test) ----------------------------------------------------------
create table public.qc_inspection_templates (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  part_number text not null check (char_length(part_number) between 1 and 60),
  part_name text not null check (char_length(part_name) between 1 and 200),
  customer text not null default '' check (char_length(customer) <= 100),
  drawing_note text not null default '' check (char_length(drawing_note) <= 500),
  status text not null default 'active' check (status in ('active', 'inactive')),
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (is_test, part_number)
);
comment on table public.qc_inspection_templates is
  'แม่แบบตรวจต่อ Part (1 Part = 1 ชุดรายการ) drawing_note คือคำอธิบายรูป/จุดวัด รูปแนบจริงอยู่ใน PR ถัดไป';
comment on column public.qc_inspection_templates.is_test is 'แถวโหมดทดสอบ: trigger กำหนดจากโหมดผู้ทำรายการ ไม่รับจาก client';

create table public.qc_inspection_template_items (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  template_id uuid not null,
  item_no text not null check (item_no ~ '^[A-Z]{1,2}$'),
  sort_order integer not null,
  name text not null check (char_length(name) between 1 and 100),
  instrument text not null default '' check (char_length(instrument) <= 100),
  unit text not null default '' check (char_length(unit) <= 20),
  spec_min numeric,
  spec_std numeric,
  spec_max numeric,
  points_required integer not null default 5 check (points_required between 1 and 5),
  foreign key (template_id, is_test) references public.qc_inspection_templates(id, is_test) on delete cascade,
  check (spec_min is null or spec_max is null or spec_min <= spec_max),
  unique (id, is_test),
  unique (template_id, item_no)
);
comment on table public.qc_inspection_template_items is
  'รายการตรวจของแม่แบบ (ITEM No. A, B, C…) สเปกว่างทั้ง MIN และ MAX = ไม่ตัดสิน (NA)';

create table public.qc_inspection_reports (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  report_no text not null,
  template_id uuid,
  part_number text not null check (char_length(part_number) between 1 and 60),
  part_name text not null check (char_length(part_name) between 1 and 200),
  customer text not null default '' check (char_length(customer) <= 100),
  order_no text not null default '' check (char_length(order_no) <= 60),
  code text not null default '' check (char_length(code) <= 60),
  -- Lot ยางผสมที่ผู้ตรวจระบุ เชื่อมกับ lab_mooney_results.lot_number (ความยาวแต่ละค่า 1-60 ตรวจใน RPC)
  compound_lots text[] not null default '{}'
    check (cardinality(compound_lots) <= 10
           and array_position(compound_lots, '') is null and array_position(compound_lots, null) is null),
  sample_label text not null default '2M' check (char_length(sample_label) <= 30),
  inspected_by uuid references public.employees(id) on delete set null,
  inspected_at timestamptz,
  -- คำนวณโดย RPC จากผลรายการ: 'ng' ถ้ามี N, 'accept' ถ้าไม่มี N แต่มี AC, 'ok' นอกนั้น (ว่าง = ยังไม่มีรายการ)
  result text check (result in ('ok', 'ng', 'accept')),
  status text not null default 'draft'
    check (status in ('draft', 'pending_qa_manager', 'pending_factory_manager', 'pending_general_manager',
                      'approved', 'rejected', 'cancelled')),
  -- 0 = ยังไม่ส่ง, 1..3 = ขั้นที่รอ (คงค่าขั้นสุดท้ายไว้เมื่ออนุมัติ/ไม่อนุมัติแล้ว)
  current_step integer not null default 0 check (current_step between 0 and 3),
  remark text not null default '' check (char_length(remark) <= 2000),
  version integer not null default 1 check (version >= 1),
  ncr_id uuid references public.ncr_reports(id) on delete set null,
  ncr_no text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  -- on delete set null (template_id): ตั้งเฉพาะคอลัมน์แม่แบบ ไม่แตะ is_test (not null)
  foreign key (template_id, is_test) references public.qc_inspection_templates(id, is_test) on delete set null (template_id),
  unique (id, is_test),
  unique (is_test, report_no)
);
create index qc_inspection_reports_status_idx on public.qc_inspection_reports (is_test, status, created_at desc);
create index qc_inspection_reports_part_idx on public.qc_inspection_reports (part_number);
create index qc_inspection_reports_lots_idx on public.qc_inspection_reports using gin (compound_lots);
comment on table public.qc_inspection_reports is '1 แถว = 1 ใบตรวจ QA01-PM11 เดินสายอนุมัติ 3 ขั้นผ่าน qc_inspection_approvals';

create table public.qc_inspection_items (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  report_id uuid not null,
  item_no text not null check (item_no ~ '^[A-Z]{1,2}$'),
  sort_order integer not null,
  -- สเปกเป็นภาพถ่าย ณ วันตรวจ (คัดจากแม่แบบ แก้ในใบได้)
  name text not null check (char_length(name) between 1 and 100),
  instrument text not null default '' check (char_length(instrument) <= 100),
  unit text not null default '' check (char_length(unit) <= 20),
  spec_min numeric,
  spec_std numeric,
  spec_max numeric,
  -- ค่าที่วัดจริง เรียงตาม point 1..5
  points numeric[] not null check (cardinality(points) between 1 and 5),
  point_min numeric,
  point_max numeric,
  point_avg numeric,
  judge text not null check (judge in ('O', 'N', 'AC', 'NA')),
  note text not null default '' check (char_length(note) <= 500),
  foreign key (report_id, is_test) references public.qc_inspection_reports(id, is_test) on delete cascade,
  check (spec_min is null or spec_max is null or spec_min <= spec_max),
  unique (id, is_test),
  unique (report_id, item_no)
);
comment on table public.qc_inspection_items is 'แถวตาราง A/B/C/D ของใบ: min/max/avg/judge คำนวณใน RPC ไม่รับจาก client';

create table public.qc_inspection_approvals (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  report_id uuid not null,
  step_order integer not null check (step_order between 1 and 3),
  step_code text not null check (step_code in ('qa_manager', 'factory_manager', 'general_manager')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  acted_by uuid references public.employees(id) on delete set null,
  acted_at timestamptz,
  comment text not null default '' check (char_length(comment) <= 1000),
  foreign key (report_id, is_test) references public.qc_inspection_reports(id, is_test) on delete cascade,
  unique (id, is_test),
  unique (report_id, step_order)
);
comment on table public.qc_inspection_approvals is 'ช่องลงนาม 3 ขั้น: 1 = manager QA, 2 = factory manager, 3 = General Manager';

create table public.qc_inspection_history (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  report_id uuid not null,
  action text not null check (action in ('create', 'update', 'submit', 'approve', 'reject', 'reopen', 'cancel', 'ncr')),
  status_after text,
  version integer,
  note text not null default '',
  -- ผลของ private.qc_report_json ตอนนั้น (ไม่รวมประวัติ)
  snapshot jsonb,
  changed_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (report_id, is_test) references public.qc_inspection_reports(id, is_test) on delete cascade,
  unique (id, is_test)
);
create index qc_inspection_history_report_idx on public.qc_inspection_history (report_id, created_at desc);
comment on table public.qc_inspection_history is 'ประวัติทุกการเปลี่ยนแปลงของใบพร้อม snapshot เขียนในธุรกรรมเดียวกับการเปลี่ยน';

-- 3. แยกโหมด: is_test มาจากโหมดของผู้ทำรายการ ห้ามแก้/ลบข้ามโหมด -----------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'qc_inspection_templates', 'qc_inspection_template_items', 'qc_inspection_reports',
    'qc_inspection_items', 'qc_inspection_approvals', 'qc_inspection_history'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.factory_sandbox_scope()', v_table || '_sandbox_scope', v_table);
  end loop;
end $$;

-- 4. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น ----------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'qc_inspection_templates', 'qc_inspection_template_items', 'qc_inspection_reports',
    'qc_inspection_items', 'qc_inspection_approvals', 'qc_inspection_history'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;
revoke all on sequence public.qc_inspection_history_id_seq from anon, authenticated;

-- บัญชี lab-only (MNPLAB001/002) ต้องมองไม่เห็นตารางของโมดูลนี้ (policy restrictive lab_only_no_access)
select private.lab_only_guard_table('public.qc_inspection_templates');
select private.lab_only_guard_table('public.qc_inspection_template_items');
select private.lab_only_guard_table('public.qc_inspection_reports');
select private.lab_only_guard_table('public.qc_inspection_items');
select private.lab_only_guard_table('public.qc_inspection_approvals');
select private.lab_only_guard_table('public.qc_inspection_history');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261009030000_factory_attachments.sql ทุกชื่อ แล้วเพิ่ม qc_inspection_*)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history','factory_bom_history',
    'factory_production_order_history',
    'factory_material_orders','factory_material_order_lines','factory_material_order_history',
    'factory_jobs','factory_job_steps','factory_job_history','factory_job_inspections',
    'factory_attachments',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 5. ฟังก์ชันช่วย (private) -----------------------------------------------------------------
-- ผู้ทำรายการ: เปิดเฉพาะโหมดทดสอบ (เหมือน private.factory_actor)
create or replace function private.qc_actor()
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
  -- sandbox_persona ตรวจทุกครั้งว่ายังเป็น admin ที่ active และอยู่ในโหมดทดสอบจริง
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'QC_TEST_MODE_ONLY';
  end if;
  return v_persona;
end;
$$;
revoke all on function private.qc_actor() from public, anon, authenticated;

-- ผู้กระทำใน audit_logs: admin ตัวจริงเบื้องหลัง persona (ถ้าไม่ได้อยู่ในโหมดทดสอบ = พนักงานของ session)
create or replace function private.qc_audit_actor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.admin_employee_id from public.sandbox_sessions s where s.admin_auth_user_id = auth.uid()),
    private.current_employee_id()
  )
$$;
revoke all on function private.qc_audit_actor_id() from public, anon, authenticated;

create or replace function private.qc_can_read(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_qa_department(p_employee.department_id), false)
      or coalesce(private.employee_role_code(p_employee.id) in
           ('factory_manager', 'assistant_factory_manager', 'general_manager', 'admin'), false)
$$;
revoke all on function private.qc_can_read(public.employees) from public, anon, authenticated;

create or replace function private.qc_can_edit(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_qa_department(p_employee.department_id), false)
      or coalesce(private.employee_role_code(p_employee.id) = 'admin', false)
$$;
revoke all on function private.qc_can_edit(public.employees) from public, anon, authenticated;

create or replace function private.qc_step_allowed(p_employee public.employees, p_step_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(case p_step_code
    when 'qa_manager' then
      coalesce(private.is_qa_department(p_employee.department_id), false)
      and private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager')
    when 'factory_manager' then private.employee_role_code(p_employee.id) = 'factory_manager'
    when 'general_manager' then private.employee_role_code(p_employee.id) = 'general_manager'
    else false
  end, false)
$$;
revoke all on function private.qc_step_allowed(public.employees, text) from public, anon, authenticated;

-- เลขที่ใบ: โหมดทดสอบใช้ตัวนับแยก 'QC-TEST' และขึ้นต้น TEST- (เหมือน private.next_ncr_doc_number)
create or replace function private.next_qc_doc_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_test boolean := (private.sandbox_persona()).id is not null;
  v_next integer;
begin
  insert into public.document_counters (department_code, year_key, last_number)
  values (case when v_test then 'QC-TEST' else 'QC' end, v_year, 1)
  on conflict (department_code, year_key) do update
    set last_number = public.document_counters.last_number + 1,
        updated_at = now()
  returning last_number into v_next;
  return case when v_test then 'TEST-' else '' end || 'QC-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;
revoke all on function private.next_qc_doc_number() from public, anon, authenticated;

-- ตัดสินรายการจากสเปก: ไม่มีทั้ง MIN และ MAX = NA, ทุกจุดอยู่ใน [MIN, MAX] (ด้านที่ว่างไม่ตรวจ) = O ไม่งั้น N
create or replace function private.qc_judge(p_points numeric[], p_min numeric, p_max numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_min is null and p_max is null then 'NA'
    when exists (
      select 1 from unnest(p_points) as v
      where (p_min is not null and v < p_min) or (p_max is not null and v > p_max)
    ) then 'N'
    else 'O'
  end
$$;
revoke all on function private.qc_judge(numeric[], numeric, numeric) from public, anon, authenticated;

-- อ่านข้อความจาก payload: ไม่มี/null = '' ไม่ใช่ข้อความหรือความยาวนอกช่วง = raise p_error (ไม่เชื่อ client)
create or replace function private.qc_text(p_obj jsonb, p_key text, p_max integer, p_min integer, p_error text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_node jsonb := p_obj -> p_key;
  v_text text;
begin
  if v_node is null or jsonb_typeof(v_node) = 'null' then
    v_text := '';
  elsif jsonb_typeof(v_node) <> 'string' then
    raise exception '%', p_error;
  else
    v_text := btrim(v_node #>> '{}');
  end if;
  if char_length(v_text) < p_min or char_length(v_text) > p_max then
    raise exception '%', p_error;
  end if;
  return v_text;
end;
$$;
revoke all on function private.qc_text(jsonb, text, integer, integer, text) from public, anon, authenticated;

-- อ่านตัวเลขจาก payload: ไม่มี/null = null, ต้องเป็น JSON number ขนาดไม่เกิน 1,000,000,000 (JSON ไม่มี NaN/Infinity)
create or replace function private.qc_num(p_node jsonb, p_error text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_node) <> 'number' then
    raise exception '%', p_error;
  end if;
  v_num := (p_node #>> '{}')::numeric;
  if abs(v_num) > 1000000000 then
    raise exception '%', p_error;
  end if;
  return v_num;
end;
$$;
revoke all on function private.qc_num(jsonb, text) from public, anon, authenticated;

-- ผลรวมของใบจากผลรายการ (ไม่มีรายการ = null)
create or replace function private.qc_result(p_report_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when count(*) = 0 then null
    when bool_or(i.judge = 'N') then 'ng'
    when bool_or(i.judge = 'AC') then 'accept'
    else 'ok'
  end
  from public.qc_inspection_items i
  where i.report_id = p_report_id
$$;
revoke all on function private.qc_result(uuid) from public, anon, authenticated;

create or replace function private.qc_template_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'part_number', t.part_number, 'part_name', t.part_name, 'customer', t.customer,
    'drawing_note', t.drawing_note, 'status', t.status, 'version', t.version,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'item_no', i.item_no, 'sort_order', i.sort_order, 'name', i.name, 'instrument', i.instrument,
          'unit', i.unit, 'spec_min', i.spec_min, 'spec_std', i.spec_std, 'spec_max', i.spec_max,
          'points_required', i.points_required
        ) order by i.sort_order, i.item_no)
      from public.qc_inspection_template_items i
      where i.template_id = t.id), '[]'::jsonb),
    'updated_at', t.updated_at)
  from public.qc_inspection_templates t
  where t.id = p_id
$$;
revoke all on function private.qc_template_json(uuid) from public, anon, authenticated;

-- ใบเต็ม: ฟิลด์ใบ + รายการ + ลงนาม + ผู้ตรวจ + ประวัติ 50 รายการล่าสุด + ผล Mooney ต่อ Lot
create or replace function private.qc_report_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'report_no', r.report_no, 'template_id', r.template_id,
    'part_number', r.part_number, 'part_name', r.part_name, 'customer', r.customer,
    'order_no', r.order_no, 'code', r.code, 'compound_lots', to_jsonb(r.compound_lots),
    'sample_label', r.sample_label, 'inspected_by', r.inspected_by, 'inspected_at', r.inspected_at,
    'inspector_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = r.inspected_by),
    'inspector', (select jsonb_build_object('first_name', e.first_name, 'last_name', e.last_name, 'job_title', e.job_title)
                  from public.employees e where e.id = r.inspected_by),
    'result', r.result, 'status', r.status, 'current_step', r.current_step, 'remark', r.remark,
    'version', r.version, 'ncr_id', r.ncr_id, 'ncr_no', r.ncr_no, 'created_by', r.created_by,
    'created_at', r.created_at, 'updated_at', r.updated_at, 'submitted_at', r.submitted_at,
    'completed_at', r.completed_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'item_no', i.item_no, 'sort_order', i.sort_order, 'name', i.name, 'instrument', i.instrument,
          'unit', i.unit, 'spec_min', i.spec_min, 'spec_std', i.spec_std, 'spec_max', i.spec_max,
          'points', to_jsonb(i.points), 'point_min', i.point_min, 'point_max', i.point_max,
          'point_avg', i.point_avg, 'judge', i.judge, 'note', i.note
        ) order by i.sort_order, i.item_no)
      from public.qc_inspection_items i
      where i.report_id = r.id), '[]'::jsonb),
    'approvals', coalesce((
      select jsonb_agg(jsonb_build_object(
          'step_order', a.step_order, 'step_code', a.step_code, 'status', a.status, 'acted_by', a.acted_by,
          'acted_at', a.acted_at, 'comment', a.comment,
          'first_name', e.first_name, 'last_name', e.last_name, 'job_title', e.job_title
        ) order by a.step_order)
      from public.qc_inspection_approvals a
      left join public.employees e on e.id = a.acted_by
      where a.report_id = r.id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'action', x.action, 'status_after', x.status_after, 'version', x.version,
            'note', x.note, 'changed_by', x.changed_by,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.qc_inspection_history x
        where x.report_id = r.id
        order by x.created_at desc, x.id desc
        limit 50
      ) h), '[]'::jsonb),
    'lab', coalesce((
      select jsonb_agg(jsonb_build_object(
          'lot_number', l.lot, 'found', m.tests > 0, 'material', m.material, 'tests', m.tests,
          'latest_test_date', m.latest_test_date, 'avg_mh', m.avg_mh, 'avg_mv', m.avg_mv
        ) order by l.ord)
      from unnest(r.compound_lots) with ordinality as l(lot, ord)
      cross join lateral (
        select count(*)::integer as tests,
               string_agg(distinct z.material, ', ') as material,
               max(z.test_date) as latest_test_date,
               round(coalesce(avg(z.avg_mh), avg(z.mh)), 2) as avg_mh,
               round(coalesce(avg(z.avg_mv), avg(z.mv)), 2) as avg_mv
        from public.lab_mooney_results z
        where z.lot_number = l.lot
      ) m), '[]'::jsonb)
  )
  from public.qc_inspection_reports r
  where r.id = p_id
$$;
revoke all on function private.qc_report_json(uuid) from public, anon, authenticated;

-- ประวัติ + audit ของใบ ในธุรกรรมเดียวกับการเปลี่ยน (snapshot ไม่รวมประวัติ)
create or replace function private.qc_record(
  p_report_id uuid, p_action text, p_note text, p_persona_id uuid, p_audit_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.qc_inspection_reports%rowtype;
begin
  select * into v_report from public.qc_inspection_reports where id = p_report_id;
  insert into public.qc_inspection_history (report_id, action, status_after, version, note, snapshot, changed_by)
  values (v_report.id, p_action, v_report.status, v_report.version, coalesce(p_note, ''),
          private.qc_report_json(v_report.id) - 'history', p_persona_id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.qc_audit_actor_id(), p_audit_action, 'qc_inspection_reports', v_report.id::text,
          jsonb_build_object('report_no', v_report.report_no, 'part_number', v_report.part_number,
                             'status', v_report.status, 'version', v_report.version, 'is_test', v_report.is_test,
                             'persona_employee_no', (select e.employee_no from public.employees e where e.id = p_persona_id),
                             'note', coalesce(p_note, '')));
end;
$$;
revoke all on function private.qc_record(uuid, text, text, uuid, text) from public, anon, authenticated;

-- 6. RPC สาธารณะ -------------------------------------------------------------------------------
-- สิทธิ์ของ persona ปัจจุบัน (ให้หน้าเว็บซ่อน/แสดงปุ่ม ตัวบังคับจริงคือ RPC แต่ละตัว)
create or replace function public.app_qc_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  return jsonb_build_object(
    'read', private.qc_can_read(v_actor),
    'edit', private.qc_can_edit(v_actor),
    'steps', coalesce((
      select jsonb_agg(s.code order by s.ord)
      from (values ('qa_manager', 1), ('factory_manager', 2), ('general_manager', 3)) as s(code, ord)
      where private.qc_step_allowed(v_actor, s.code)), '[]'::jsonb));
end;
$$;

create or replace function public.app_qc_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_read(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(private.qc_template_json(t.id) order by t.part_number)
    from public.qc_inspection_templates t
    where t.is_test), '[]'::jsonb);
end;
$$;

-- สร้าง/แก้แม่แบบ: มี id ต้องส่ง version ตรง ไม่งั้นสร้างใหม่ รายการแทนที่ทั้งชุด
create or replace function public.app_qc_save_template(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_id uuid;
  v_version integer;
  v_part_number text;
  v_part_name text;
  v_customer text;
  v_drawing_note text;
  v_status text;
  v_node jsonb;
  v_item jsonb;
  v_ord bigint;
  v_item_no text;
  v_seen text[] := '{}';
  v_min numeric;
  v_max numeric;
  v_required numeric;
  v_tpl public.qc_inspection_templates%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'QC_INVALID_PAYLOAD'; end if;

  begin
    v_id := nullif(p_payload ->> 'id', '')::uuid;
    v_version := nullif(p_payload ->> 'version', '')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'QC_INVALID_PAYLOAD';
  end;
  v_part_number := private.qc_text(p_payload, 'part_number', 60, 1, 'QC_INVALID_PAYLOAD');
  v_part_name := private.qc_text(p_payload, 'part_name', 200, 1, 'QC_INVALID_PAYLOAD');
  v_customer := private.qc_text(p_payload, 'customer', 100, 0, 'QC_INVALID_PAYLOAD');
  v_drawing_note := private.qc_text(p_payload, 'drawing_note', 500, 0, 'QC_INVALID_PAYLOAD');
  v_status := private.qc_text(p_payload, 'status', 20, 0, 'QC_INVALID_PAYLOAD');
  if v_status = '' then v_status := 'active'; end if;
  if v_status not in ('active', 'inactive') then raise exception 'QC_INVALID_PAYLOAD'; end if;
  v_node := p_payload -> 'items';
  if v_node is null or jsonb_typeof(v_node) <> 'array' then raise exception 'QC_INVALID_PAYLOAD'; end if;
  if jsonb_array_length(v_node) not between 1 and 30 then raise exception 'QC_INVALID_ITEM'; end if;

  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  if v_id is null then
    if v_version is not null then raise exception 'QC_INVALID_PAYLOAD'; end if;
    if exists (select 1 from public.qc_inspection_templates where is_test = v_test and part_number = v_part_number) then
      raise exception 'QC_PART_NUMBER_TAKEN';
    end if;
    insert into public.qc_inspection_templates (part_number, part_name, customer, drawing_note, status, created_by, updated_by)
    values (v_part_number, v_part_name, v_customer, v_drawing_note, v_status, v_actor.id, v_actor.id)
    returning * into v_tpl;
  else
    select * into v_tpl from public.qc_inspection_templates where id = v_id and is_test = v_test for update;
    if v_tpl.id is null then raise exception 'QC_NOT_FOUND'; end if;
    if v_version is null or v_version <> v_tpl.version then raise exception 'QC_VERSION_CONFLICT'; end if;
    if exists (select 1 from public.qc_inspection_templates
               where is_test = v_test and part_number = v_part_number and id <> v_tpl.id) then
      raise exception 'QC_PART_NUMBER_TAKEN';
    end if;
    update public.qc_inspection_templates
    set part_number = v_part_number, part_name = v_part_name, customer = v_customer, drawing_note = v_drawing_note,
        status = v_status, version = v_tpl.version + 1, updated_by = v_actor.id, updated_at = now()
    where id = v_tpl.id
    returning * into v_tpl;
    delete from public.qc_inspection_template_items where template_id = v_tpl.id;
  end if;

  for v_item, v_ord in select value, ordinality from jsonb_array_elements(v_node) with ordinality loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'QC_INVALID_ITEM'; end if;
    v_item_no := private.qc_text(v_item, 'item_no', 2, 1, 'QC_INVALID_ITEM');
    if v_item_no !~ '^[A-Z]{1,2}$' or v_item_no = any (v_seen) then raise exception 'QC_INVALID_ITEM'; end if;
    v_seen := v_seen || v_item_no;
    v_min := private.qc_num(v_item -> 'spec_min', 'QC_INVALID_ITEM');
    v_max := private.qc_num(v_item -> 'spec_max', 'QC_INVALID_ITEM');
    if v_min is not null and v_max is not null and v_min > v_max then raise exception 'QC_INVALID_ITEM'; end if;
    v_required := coalesce(private.qc_num(v_item -> 'points_required', 'QC_INVALID_ITEM'), 5);
    if v_required <> trunc(v_required) or v_required not between 1 and 5 then raise exception 'QC_INVALID_ITEM'; end if;
    insert into public.qc_inspection_template_items
      (template_id, item_no, sort_order, name, instrument, unit, spec_min, spec_std, spec_max, points_required)
    values (v_tpl.id, v_item_no, v_ord::integer,
            private.qc_text(v_item, 'name', 100, 1, 'QC_INVALID_ITEM'),
            private.qc_text(v_item, 'instrument', 100, 0, 'QC_INVALID_ITEM'),
            private.qc_text(v_item, 'unit', 20, 0, 'QC_INVALID_ITEM'),
            v_min, private.qc_num(v_item -> 'spec_std', 'QC_INVALID_ITEM'), v_max, v_required::integer);
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.qc_audit_actor_id(), 'QC_TEMPLATE_SAVE', 'qc_inspection_templates', v_tpl.id::text,
          jsonb_build_object('part_number', v_tpl.part_number, 'version', v_tpl.version, 'is_test', v_tpl.is_test,
                             'persona_employee_no', v_actor.employee_no));
  return private.qc_template_json(v_tpl.id);
end;
$$;

-- รายการใบ (ไม่รวมรายการตรวจ) ล่าสุด 200 ใบ กรองด้วย status, part_number (มีคำนี้อยู่ ไม่สนตัวพิมพ์), lot (ตรงทั้งค่า), result
create or replace function public.app_qc_reports(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
  v_status text;
  v_part text;
  v_lot text;
  v_result text;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_read(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if jsonb_typeof(v_filter) <> 'object' then raise exception 'QC_INVALID_PAYLOAD'; end if;
  v_status := private.qc_text(v_filter, 'status', 30, 0, 'QC_INVALID_PAYLOAD');
  v_part := private.qc_text(v_filter, 'part_number', 60, 0, 'QC_INVALID_PAYLOAD');
  v_lot := private.qc_text(v_filter, 'lot', 60, 0, 'QC_INVALID_PAYLOAD');
  v_result := private.qc_text(v_filter, 'result', 10, 0, 'QC_INVALID_PAYLOAD');
  if v_status not in ('', 'draft', 'pending_qa_manager', 'pending_factory_manager', 'pending_general_manager',
                      'approved', 'rejected', 'cancelled')
     or v_result not in ('', 'ok', 'ng', 'accept') then
    raise exception 'QC_INVALID_PAYLOAD';
  end if;

  return jsonb_build_object('reports', coalesce((
    select jsonb_agg(x.entry order by x.created_at desc, x.id desc)
    from (
      select r.id, r.created_at, jsonb_build_object(
          'id', r.id, 'report_no', r.report_no, 'part_number', r.part_number, 'part_name', r.part_name,
          'customer', r.customer, 'order_no', r.order_no, 'compound_lots', to_jsonb(r.compound_lots),
          'inspected_at', r.inspected_at,
          'inspector_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = r.inspected_by),
          'result', r.result, 'status', r.status, 'current_step', r.current_step, 'version', r.version,
          'ncr_no', r.ncr_no, 'created_at', r.created_at) as entry
      from public.qc_inspection_reports r
      where r.is_test
        and (v_status = '' or r.status = v_status)
        and (v_part = '' or strpos(lower(r.part_number), lower(v_part)) > 0)
        and (v_lot = '' or v_lot = any (r.compound_lots))
        and (v_result = '' or r.result = v_result)
      order by r.created_at desc, r.id desc
      limit 200
    ) x), '[]'::jsonb));
end;
$$;

create or replace function public.app_qc_report(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_read(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if not exists (select 1 from public.qc_inspection_reports where id = p_id and is_test) then
    raise exception 'QC_NOT_FOUND';
  end if;
  return private.qc_report_json(p_id);
end;
$$;

-- สร้าง/แก้ใบสถานะ draft เท่านั้น รายการตรวจแทนที่ทั้งชุด ฐานข้อมูลคำนวณ min/max/avg/judge/result เอง
create or replace function public.app_qc_save_report(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_id uuid;
  v_version integer;
  v_template_id uuid;
  v_inspected_at timestamptz;
  v_part_number text;
  v_part_name text;
  v_customer text;
  v_order_no text;
  v_code text;
  v_sample_label text;
  v_remark text;
  v_lots text[] := '{}';
  v_lot_node jsonb;
  v_lot jsonb;
  v_text text;
  v_node jsonb;
  v_item jsonb;
  v_ord bigint;
  v_seen text[] := '{}';
  v_item_no text;
  v_name text;
  v_instrument text;
  v_unit text;
  v_note text;
  v_min numeric;
  v_std numeric;
  v_max numeric;
  v_points numeric[];
  v_judge text;
  v_override text;
  v_action text;
  v_rep public.qc_inspection_reports%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'QC_INVALID_PAYLOAD'; end if;

  begin
    v_id := nullif(p_payload ->> 'id', '')::uuid;
    v_version := nullif(p_payload ->> 'version', '')::integer;
    v_template_id := nullif(p_payload ->> 'template_id', '')::uuid;
    v_inspected_at := nullif(p_payload ->> 'inspected_at', '')::timestamptz;
  exception
    when invalid_text_representation or numeric_value_out_of_range
      or invalid_datetime_format or datetime_field_overflow then
      raise exception 'QC_INVALID_PAYLOAD';
  end;
  if v_inspected_at is not null and not isfinite(v_inspected_at) then raise exception 'QC_INVALID_PAYLOAD'; end if;
  v_part_number := private.qc_text(p_payload, 'part_number', 60, 1, 'QC_INVALID_PAYLOAD');
  v_part_name := private.qc_text(p_payload, 'part_name', 200, 1, 'QC_INVALID_PAYLOAD');
  v_customer := private.qc_text(p_payload, 'customer', 100, 0, 'QC_INVALID_PAYLOAD');
  v_order_no := private.qc_text(p_payload, 'order_no', 60, 0, 'QC_INVALID_PAYLOAD');
  v_code := private.qc_text(p_payload, 'code', 60, 0, 'QC_INVALID_PAYLOAD');
  v_sample_label := private.qc_text(p_payload, 'sample_label', 30, 0, 'QC_INVALID_PAYLOAD');
  if v_sample_label = '' then v_sample_label := '2M'; end if;
  v_remark := private.qc_text(p_payload, 'remark', 2000, 0, 'QC_INVALID_PAYLOAD');

  -- Lot ยางผสม: ไม่เกิน 10 ค่า แต่ละค่า 1-60 ตัวอักษร ไม่ซ้ำ
  v_lot_node := p_payload -> 'compound_lots';
  if v_lot_node is not null and jsonb_typeof(v_lot_node) <> 'null' then
    if jsonb_typeof(v_lot_node) <> 'array' or jsonb_array_length(v_lot_node) > 10 then
      raise exception 'QC_INVALID_LOT';
    end if;
    for v_lot in select value from jsonb_array_elements(v_lot_node) loop
      if jsonb_typeof(v_lot) <> 'string' then raise exception 'QC_INVALID_LOT'; end if;
      v_text := btrim(v_lot #>> '{}');
      if char_length(v_text) not between 1 and 60 or v_text = any (v_lots) then raise exception 'QC_INVALID_LOT'; end if;
      v_lots := v_lots || v_text;
    end loop;
  end if;

  v_node := p_payload -> 'items';
  if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 30 then
    raise exception 'QC_INVALID_PAYLOAD';
  end if;

  if v_template_id is not null
     and not exists (select 1 from public.qc_inspection_templates where id = v_template_id and is_test = v_test) then
    raise exception 'QC_TEMPLATE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  if v_id is null then
    if v_version is not null then raise exception 'QC_INVALID_PAYLOAD'; end if;
    insert into public.qc_inspection_reports
      (report_no, template_id, part_number, part_name, customer, order_no, code, compound_lots, sample_label,
       inspected_by, inspected_at, remark, created_by)
    values (private.next_qc_doc_number(), v_template_id, v_part_number, v_part_name, v_customer, v_order_no, v_code,
            v_lots, v_sample_label, v_actor.id, v_inspected_at, v_remark, v_actor.id)
    returning * into v_rep;
    v_action := 'create';
  else
    select * into v_rep from public.qc_inspection_reports where id = v_id and is_test = v_test for update;
    if v_rep.id is null then raise exception 'QC_NOT_FOUND'; end if;
    if v_version is null or v_version <> v_rep.version then raise exception 'QC_VERSION_CONFLICT'; end if;
    if v_rep.status <> 'draft' then raise exception 'QC_NOT_DRAFT'; end if;
    update public.qc_inspection_reports
    set template_id = v_template_id, part_number = v_part_number, part_name = v_part_name, customer = v_customer,
        order_no = v_order_no, code = v_code, compound_lots = v_lots, sample_label = v_sample_label,
        inspected_at = v_inspected_at, remark = v_remark, version = v_rep.version + 1, updated_at = now()
    where id = v_rep.id
    returning * into v_rep;
    delete from public.qc_inspection_items where report_id = v_rep.id;
    v_action := 'update';
  end if;

  for v_item, v_ord in select value, ordinality from jsonb_array_elements(v_node) with ordinality loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'QC_INVALID_ITEM'; end if;
    v_item_no := private.qc_text(v_item, 'item_no', 2, 1, 'QC_INVALID_ITEM');
    if v_item_no !~ '^[A-Z]{1,2}$' or v_item_no = any (v_seen) then raise exception 'QC_INVALID_ITEM'; end if;
    v_seen := v_seen || v_item_no;
    v_name := private.qc_text(v_item, 'name', 100, 1, 'QC_INVALID_ITEM');
    v_instrument := private.qc_text(v_item, 'instrument', 100, 0, 'QC_INVALID_ITEM');
    v_unit := private.qc_text(v_item, 'unit', 20, 0, 'QC_INVALID_ITEM');
    v_note := private.qc_text(v_item, 'note', 500, 0, 'QC_INVALID_ITEM');
    v_min := private.qc_num(v_item -> 'spec_min', 'QC_INVALID_ITEM');
    v_std := private.qc_num(v_item -> 'spec_std', 'QC_INVALID_ITEM');
    v_max := private.qc_num(v_item -> 'spec_max', 'QC_INVALID_ITEM');
    if v_min is not null and v_max is not null and v_min > v_max then raise exception 'QC_INVALID_ITEM'; end if;

    if jsonb_typeof(v_item -> 'points') is distinct from 'array'
       or jsonb_array_length(v_item -> 'points') not between 1 and 5 then
      raise exception 'QC_INVALID_ITEM';
    end if;
    select array_agg(private.qc_num(t.x, 'QC_INVALID_ITEM') order by t.o) into v_points
    from jsonb_array_elements(v_item -> 'points') with ordinality as t(x, o);
    if array_position(v_points, null) is not null then raise exception 'QC_INVALID_ITEM'; end if;

    -- ตัดสินจากสเปก: ผู้ตรวจยอมรับรายการที่ N ได้เป็น AC เท่านั้น (ต้องมีหมายเหตุ)
    v_judge := private.qc_judge(v_points, v_min, v_max);
    v_override := private.qc_text(v_item, 'judge_override', 10, 0, 'QC_INVALID_JUDGE');
    if v_override <> '' then
      if v_override <> 'AC' or v_judge <> 'N' then raise exception 'QC_INVALID_JUDGE'; end if;
      if char_length(v_note) < 5 then raise exception 'QC_ACCEPT_NOTE_REQUIRED'; end if;
      v_judge := 'AC';
    end if;

    insert into public.qc_inspection_items
      (report_id, item_no, sort_order, name, instrument, unit, spec_min, spec_std, spec_max,
       points, point_min, point_max, point_avg, judge, note)
    select v_rep.id, v_item_no, v_ord::integer, v_name, v_instrument, v_unit, v_min, v_std, v_max,
           v_points, min(x), max(x), round(avg(x), 4), v_judge, v_note
    from unnest(v_points) as x;
  end loop;

  update public.qc_inspection_reports
  set result = private.qc_result(v_rep.id)
  where id = v_rep.id;

  perform private.qc_record(v_rep.id, v_action, '', v_actor.id, 'QC_REPORT_SAVE');
  return private.qc_report_json(v_rep.id);
end;
$$;

-- ส่งใบ: draft -> pending_qa_manager ผู้ส่ง = ผู้ตรวจ สร้างช่องลงนาม 3 ขั้น
create or replace function public.app_qc_submit_report(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_rep public.qc_inspection_reports%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  select * into v_rep from public.qc_inspection_reports where id = p_id and is_test = v_test for update;
  if v_rep.id is null then raise exception 'QC_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_rep.version then raise exception 'QC_VERSION_CONFLICT'; end if;
  if v_rep.status <> 'draft' then raise exception 'QC_NOT_DRAFT'; end if;
  if not exists (select 1 from public.qc_inspection_items where report_id = v_rep.id) then
    raise exception 'QC_NO_ITEMS';
  end if;

  update public.qc_inspection_reports
  set status = 'pending_qa_manager', current_step = 1, inspected_by = v_actor.id,
      inspected_at = coalesce(inspected_at, now()), submitted_at = now(), completed_at = null,
      version = v_rep.version + 1, updated_at = now()
  where id = v_rep.id
  returning * into v_rep;

  delete from public.qc_inspection_approvals where report_id = v_rep.id;
  insert into public.qc_inspection_approvals (report_id, step_order, step_code)
  values (v_rep.id, 1, 'qa_manager'), (v_rep.id, 2, 'factory_manager'), (v_rep.id, 3, 'general_manager');

  perform private.qc_record(v_rep.id, 'submit', '', v_actor.id, 'QC_REPORT_SUBMIT');
  return private.qc_report_json(v_rep.id);
end;
$$;

-- อนุมัติ/ไม่อนุมัติขั้นที่รออยู่ ผู้ตรวจอนุมัติใบตัวเองไม่ได้ ไม่อนุมัติต้องมีเหตุผล
create or replace function public.app_qc_decide_report(
  p_id uuid, p_version integer, p_decision text, p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_rep public.qc_inspection_reports%rowtype;
  v_appr public.qc_inspection_approvals%rowtype;
  v_step integer;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if p_decision is null or p_decision not in ('approve', 'reject') then raise exception 'QC_INVALID_DECISION'; end if;
  if char_length(v_comment) > 1000 then raise exception 'QC_INVALID_PAYLOAD'; end if;
  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  select * into v_rep from public.qc_inspection_reports where id = p_id and is_test = v_test for update;
  if v_rep.id is null then raise exception 'QC_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_rep.version then raise exception 'QC_VERSION_CONFLICT'; end if;
  if v_rep.status not in ('pending_qa_manager', 'pending_factory_manager', 'pending_general_manager') then
    raise exception 'QC_STEP_NOT_CURRENT';
  end if;
  select * into v_appr from public.qc_inspection_approvals
  where report_id = v_rep.id and step_order = v_rep.current_step and status = 'pending' for update;
  if v_appr.id is null then raise exception 'QC_STEP_NOT_CURRENT'; end if;
  if not private.qc_step_allowed(v_actor, v_appr.step_code) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_rep.inspected_by = v_actor.id then raise exception 'QC_SELF_APPROVAL'; end if;
  if p_decision = 'reject' and char_length(v_comment) < 5 then raise exception 'QC_REJECT_COMMENT_REQUIRED'; end if;

  v_step := v_rep.current_step;
  update public.qc_inspection_approvals
  set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
      acted_by = v_actor.id, acted_at = now(), comment = v_comment
  where id = v_appr.id;

  if p_decision = 'approve' then
    update public.qc_inspection_reports
    set status = case v_step when 1 then 'pending_factory_manager' when 2 then 'pending_general_manager' else 'approved' end,
        current_step = case when v_step < 3 then v_step + 1 else v_step end,
        completed_at = case when v_step < 3 then null else now() end,
        version = v_rep.version + 1, updated_at = now()
    where id = v_rep.id;
  else
    update public.qc_inspection_reports
    set status = 'rejected', completed_at = now(), version = v_rep.version + 1, updated_at = now()
    where id = v_rep.id;
  end if;

  perform private.qc_record(v_rep.id, p_decision, v_comment, v_actor.id,
    case when p_decision = 'approve' then 'QC_REPORT_APPROVE' else 'QC_REPORT_REJECT' end);
  return private.qc_report_json(v_rep.id);
end;
$$;

-- เปิดใบที่ไม่อนุมัติกลับเป็นฉบับร่างเพื่อแก้แล้วส่งใหม่ (ลบช่องลงนามเดิม ประวัติยังอยู่)
create or replace function public.app_qc_reopen_report(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_rep public.qc_inspection_reports%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  select * into v_rep from public.qc_inspection_reports where id = p_id and is_test = v_test for update;
  if v_rep.id is null then raise exception 'QC_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_rep.version then raise exception 'QC_VERSION_CONFLICT'; end if;
  if v_rep.status <> 'rejected' then raise exception 'QC_NOT_REJECTED'; end if;

  delete from public.qc_inspection_approvals where report_id = v_rep.id;
  update public.qc_inspection_reports
  set status = 'draft', current_step = 0, submitted_at = null, completed_at = null,
      version = v_rep.version + 1, updated_at = now()
  where id = v_rep.id;

  perform private.qc_record(v_rep.id, 'reopen', '', v_actor.id, 'QC_REPORT_REOPEN');
  return private.qc_report_json(v_rep.id);
end;
$$;

-- ยกเลิกใบ (ฉบับร่างหรือที่ไม่อนุมัติ) ต้องมีเหตุผลอย่างน้อย 5 ตัวอักษร
create or replace function public.app_qc_cancel_report(p_id uuid, p_version integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_note text := btrim(coalesce(p_note, ''));
  v_rep public.qc_inspection_reports%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if char_length(v_note) < 5 then raise exception 'QC_CANCEL_NOTE_REQUIRED'; end if;
  if char_length(v_note) > 1000 then raise exception 'QC_INVALID_PAYLOAD'; end if;
  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  select * into v_rep from public.qc_inspection_reports where id = p_id and is_test = v_test for update;
  if v_rep.id is null then raise exception 'QC_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_rep.version then raise exception 'QC_VERSION_CONFLICT'; end if;
  if v_rep.status not in ('draft', 'rejected') then raise exception 'QC_NOT_CANCELLABLE'; end if;

  update public.qc_inspection_reports
  set status = 'cancelled', completed_at = now(), version = v_rep.version + 1, updated_at = now()
  where id = v_rep.id;

  perform private.qc_record(v_rep.id, 'cancel', v_note, v_actor.id, 'QC_REPORT_CANCEL');
  return private.qc_report_json(v_rep.id);
end;
$$;

-- ออก NCR จากใบที่ผลเป็น 'ng' (ใบละ 1 NCR) ด้วย app_ncr_issue ในธุรกรรมเดียวกัน
create or replace function public.app_qc_issue_ncr(
  p_id uuid, p_version integer, p_defect_type_code text, p_qty_total numeric, p_qty_defect numeric,
  p_unit text, p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_desc text := btrim(coalesce(p_description, ''));
  v_rep public.qc_inspection_reports%rowtype;
  v_ncr jsonb;
  v_ncr_id uuid;
  v_ncr_no text;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if char_length(v_desc) not between 10 and 4000 then raise exception 'INVALID_NCR_DESCRIPTION'; end if;
  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  select * into v_rep from public.qc_inspection_reports where id = p_id and is_test = v_test for update;
  if v_rep.id is null then raise exception 'QC_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_rep.version then raise exception 'QC_VERSION_CONFLICT'; end if;
  if v_rep.ncr_id is not null then raise exception 'QC_NCR_EXISTS'; end if;
  if v_rep.status = 'cancelled' then raise exception 'QC_NOT_ACTIVE'; end if;
  if v_rep.result is distinct from 'ng' then raise exception 'QC_NOT_NG'; end if;

  -- ตรวจชนิดข้อบกพร่อง จำนวน และหน่วยด้วยกติกาเดิมของ app_ncr_issue
  v_ncr := public.app_ncr_issue(
    v_rep.part_name, p_qty_total, p_qty_defect, p_unit, 'final_fg', p_defect_type_code,
    'ใบตรวจ QC ' || v_rep.report_no || ': ' || v_desc,
    v_rep.part_number, nullif(v_rep.customer, ''), null, nullif(v_rep.order_no, ''),
    nullif(array_to_string(v_rep.compound_lots, ', '), ''), null, null);
  v_ncr_id := (v_ncr ->> 'id')::uuid;
  v_ncr_no := v_ncr ->> 'ncr_no';

  update public.qc_inspection_reports
  set ncr_id = v_ncr_id, ncr_no = v_ncr_no, version = v_rep.version + 1, updated_at = now()
  where id = v_rep.id;

  perform private.qc_record(v_rep.id, 'ncr', v_ncr_no, v_actor.id, 'QC_REPORT_NCR');
  return private.qc_report_json(v_rep.id) || jsonb_build_object('ncr_id', v_ncr_id, 'ncr_no', v_ncr_no);
end;
$$;

-- รายการ Lot จากผล Mooney (อ่านข้อมูลแล็บจริงได้ในโหมดทดสอบ เพราะอ่านอย่างเดียว) ค้นด้วยข้อความที่มีอยู่ใน Lot
create or replace function public.app_qc_lots(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_search text := btrim(coalesce(p_search, ''));
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_read(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if char_length(v_search) > 60 then raise exception 'QC_INVALID_PAYLOAD'; end if;
  return coalesce((
    select jsonb_agg(x.entry order by x.latest_test_date desc, x.lot_number)
    from (
      select z.lot_number, max(z.test_date) as latest_test_date, jsonb_build_object(
          'lot_number', z.lot_number, 'material', z.material, 'tests', count(*)::integer,
          'latest_test_date', max(z.test_date),
          'avg_mh', round(coalesce(avg(z.avg_mh), avg(z.mh)), 2),
          'avg_mv', round(coalesce(avg(z.avg_mv), avg(z.mv)), 2)) as entry
      from public.lab_mooney_results z
      where z.lot_number is not null
        and (v_search = '' or strpos(lower(z.lot_number), lower(v_search)) > 0)
      group by z.lot_number, z.material
      order by max(z.test_date) desc, z.lot_number
      limit 100
    ) x), '[]'::jsonb);
end;
$$;

-- ล้างข้อมูลทดสอบของใบตรวจ QC (admin ตัวจริงที่อยู่ในโหมดทดสอบ) ไม่แตะ NCR ทดสอบ — ล้างแยกด้วย app_sandbox_purge_ncr
create or replace function public.app_sandbox_purge_qc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_reports integer;
  v_templates integer;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ลูกก่อนแม่
  delete from public.qc_inspection_history where is_test;
  delete from public.qc_inspection_approvals where is_test;
  delete from public.qc_inspection_items where is_test;
  delete from public.qc_inspection_reports where is_test;
  get diagnostics v_reports = row_count;
  delete from public.qc_inspection_template_items where is_test;
  delete from public.qc_inspection_templates where is_test;
  get diagnostics v_templates = row_count;
  delete from public.document_counters where department_code = 'QC-TEST';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_QC', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_reports', v_reports, 'deleted_templates', v_templates));
  return jsonb_build_object('deleted', v_reports, 'deleted_reports', v_reports, 'deleted_templates', v_templates);
end;
$$;

revoke all on function public.app_qc_access() from public, anon;
revoke all on function public.app_qc_templates() from public, anon;
revoke all on function public.app_qc_save_template(jsonb) from public, anon;
revoke all on function public.app_qc_reports(jsonb) from public, anon;
revoke all on function public.app_qc_report(uuid) from public, anon;
revoke all on function public.app_qc_save_report(jsonb) from public, anon;
revoke all on function public.app_qc_submit_report(uuid, integer) from public, anon;
revoke all on function public.app_qc_decide_report(uuid, integer, text, text) from public, anon;
revoke all on function public.app_qc_reopen_report(uuid, integer) from public, anon;
revoke all on function public.app_qc_cancel_report(uuid, integer, text) from public, anon;
revoke all on function public.app_qc_issue_ncr(uuid, integer, text, numeric, numeric, text, text) from public, anon;
revoke all on function public.app_qc_lots(text) from public, anon;
revoke all on function public.app_sandbox_purge_qc() from public, anon;
grant execute on function public.app_qc_access() to authenticated;
grant execute on function public.app_qc_templates() to authenticated;
grant execute on function public.app_qc_save_template(jsonb) to authenticated;
grant execute on function public.app_qc_reports(jsonb) to authenticated;
grant execute on function public.app_qc_report(uuid) to authenticated;
grant execute on function public.app_qc_save_report(jsonb) to authenticated;
grant execute on function public.app_qc_submit_report(uuid, integer) to authenticated;
grant execute on function public.app_qc_decide_report(uuid, integer, text, text) to authenticated;
grant execute on function public.app_qc_reopen_report(uuid, integer) to authenticated;
grant execute on function public.app_qc_cancel_report(uuid, integer, text) to authenticated;
grant execute on function public.app_qc_issue_ncr(uuid, integer, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.app_qc_lots(text) to authenticated;
grant execute on function public.app_sandbox_purge_qc() to authenticated;
