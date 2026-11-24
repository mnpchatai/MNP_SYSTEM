-- RubberFlow: เปิดใบสั่งผลิตยางใหม่และปล่อยผลิตเป็นของฝ่ายวางแผนเท่านั้น (20261223010000_rf_orders_planning_only.sql · คำสั่งเจ้าของ 2026-11-24)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: ฝ่ายวางแผน (PP) ผู้จัดการโรงงาน และผู้จัดการแผนก RB (อยู่ในกลุ่มวางแผน) เปิดใบใหม่และปล่อยผลิตได้
-- · พนักงาน RB และผู้ช่วยผู้จัดการแผนก RB (หัว RB นอกกลุ่มวางแผน) เปิดใบใหม่ไม่ได้ ปล่อยผลิตไม่ได้ (RF_FORBIDDEN)
-- · ไม่เปลี่ยน: RB ยังเริ่ม (released -> in_progress) พัก (on_hold) เดินต่อ ปิด (completed) และยกเลิกใบ planned ได้ตามเดิม
-- (authenticated อ่านตาราง rf_* / bom_* ตรงไม่ได้ จึงอ่านผลผ่าน app_rf_master)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------------------------------
select ok(to_regprocedure('private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)') is not null, 'the order writer exists');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
           from pg_proc p where p.oid = 'private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)'::regprocedure),
  'the order writer is security definer with an empty search_path');
select ok(not (has_function_privilege('anon', 'private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)', 'execute')
               or has_function_privilege('authenticated', 'private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)', 'execute')
               or has_function_privilege('public', 'private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)', 'execute')),
  'clients cannot call the order writer directly');
-- เหลือ "not (p_planner or p_rb)" ที่เดียว = ใบเดิม (RB ยังเปลี่ยนสถานะใบเดิมได้) · "not p_planner" สองที่ = ปล่อยผลิตและใบใหม่
select ok(position('not (p_planner or p_head)' in pg_get_functiondef('private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) = 0
      and (select (length(d) - length(replace(d, 'not (p_planner or p_rb)', ''))) / length('not (p_planner or p_rb)') = 1
                  and (length(d) - length(replace(d, 'not p_planner then', ''))) / length('not p_planner then') = 2
           from (select pg_get_functiondef('private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)'::regprocedure) as d) s),
  'opening and releasing no longer accept an RB member or an RB head outside the planner group (changing an existing order still does)');
select ok(position('rf_unlink_job' in pg_get_functiondef('private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('RF_STALE' in pg_get_functiondef('private.rf_save_orders(public.employees,text,boolean,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0,
  'the rest of the writer is unchanged (collision check, cancelling a linked work order clears its job)');
select ok(not private.bom_real_open(), 'the real-use switch is still off');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. บัญชีทดสอบ ---------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8f600000-0000-0000-0000-000000000001', 'plonly-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f600000-0000-0000-0000-000000000101', 'PLONLY-ADMIN', 'Plonly', 'Admin', 'plonly-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f600000-0000-0000-0000-000000000001');
-- persona เพิ่ม (is_test): ผู้ช่วยผู้จัดการแผนก RB (หัว RB ที่ไม่อยู่กลุ่มวางแผน) ไม่มีใน migration จึงใส่เองในเทสต์
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-RB-AMGR-T', 'ทดสอบ', 'ผู้ช่วย ผจก. RB', 'sbx-rb-amgr-t@sandbox.local', 'ผู้ช่วย ผจก. RB (ทดสอบ)',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'assistant_department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP' and r.code = 'staff')
                                or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB' and r.code = 'staff')
                                or (e.employee_no = 'SBX-RB-MGR' and d.code = 'RB' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-RB-AMGR-T' and d.code = 'RB' and r.code = 'assistant_department_manager')
                                or (e.employee_no = 'SBX-FT-FM' and r.code = 'factory_manager'))), 5,
  'the personas used below belong to the departments and roles the rules name');

-- กลุ่มวางแผนตามบทบาท (เรียกในนามเจ้าของฐานข้อมูล ก่อนเปลี่ยนเป็น authenticated)
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-PP-STAFF'), 'PP staff are in the planner group');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-FT-FM'), 'the factory manager is in the planner group');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-RB-MGR'), 'the RB department manager is in the planner group');
select ok((select not private.bom_can_edit(e) and private.rf_is_rb(e) from public.employees e where e.employee_no = 'SBX-RB-STAFF'), 'RB staff are RB members outside the planner group');
select ok((select not private.bom_can_edit(e) and private.rf_is_rb(e) and private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-RB-AMGR-T'),
  'the RB assistant manager is an RB head outside the planner group');

-- 3. ตัวช่วยของเทสต์ (schema แยก ลบพร้อม rollback): รันในฐานะผู้เรียก (authenticated) ผ่าน RPC สาธารณะเท่านั้น -------------------------------
create schema pl_t;
grant usage on schema pl_t to authenticated;
create function pl_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function pl_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, pl_t.rver(), p_action)
$$;
create function pl_t.wo(p_no text) returns jsonb language sql stable as $$
  select w from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = p_no
$$;
create function pl_t.status(p_no text) returns text language sql stable as $$ select pl_t.wo(p_no) ->> 'status' $$;
-- เปิดใบใหม่ (planned) · แม่แบบเรคอร์ดของ WO ขายเป็นสินค้า ไม่ผูกงาน BOM
create function pl_t.open_wo(p_no text) returns jsonb language sql volatile as $$
  select pl_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object('id', p_no, 'customer', 'ACME', 'customerPo', 'PO-' || p_no, 'recipeId', 'RC-P', 'recipeRevision', 1, 'color', 'ดำ',
      'targetQty', 1000, 'targetKg', 17.5, 'kgPerUnit', 0.125, 'producedQty', 0, 'startDate', 1762387200000, 'dueDate', 1765065600000,
      'priority', 'normal', 'note', '', 'status', 'planned')))), 'createOrder')
$$;
create function pl_t.set_status(p_no text, p_status text) returns jsonb language sql volatile as $$
  select pl_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(pl_t.wo(p_no) || jsonb_build_object('status', p_status)))), 'setOrderStatus')
$$;

-- 4. ข้อมูลตั้งต้น: วัตถุดิบ และสูตรอนุมัติ RC-P (สองขั้นผสม) --------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8f600000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select pl_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  '{"code":"MAT-A","name":"ยาง EPDM","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}'::jsonb,
  '{"code":"MAT-B","name":"สารตัวเร่ง","category":"วัตถุดิบ","storage":"A-2","uom":"kg","active":true}'::jsonb))), 'saveMaterial');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select pl_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"RC-P","revision":1,"productCode":"P-P","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":5,"stage":2}],"status":"draft"}'::jsonb))),
  'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select pl_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert',
  (select jsonb_agg(r || '{"status":"approved"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-P'))), 'approveRecipe');
select is((select r ->> 'status' from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-P'), 'approved', 'the recipe is approved for the work orders below');

-- 5. เปิดใบใหม่: ฝ่ายวางแผนทำได้ พนักงาน RB และผู้ช่วยผู้จัดการแผนก RB ทำไม่ได้ ------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(pl_t.open_wo('WO-PL1') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'planned', 'PP staff (the planner group) open a planned work order');
select is(pl_t.wo('WO-PL1') ->> 'createdBy', current_setting('test.n_sbx_pp_staff'), 'the creator is the persona');
select is(pl_t.open_wo('WO-PL2') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'planned', 'and a second one');
select is(pl_t.open_wo('WO-PL3') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'planned', 'and a third (cancelled by RB further down)');

select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select is(pl_t.open_wo('WO-FM1') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'planned', 'the factory manager opens a planned work order');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select is(pl_t.open_wo('WO-RM1') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'planned', 'the RB department manager (in the planner group) opens a planned work order');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.v_before', public.app_rf_master() ->> 'version', true);
select throws_ok($$ select pl_t.open_wo('WO-RB1') $$, 'RF_FORBIDDEN', 'RB staff cannot open a work order any more');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_amgr_t')::uuid);
select throws_ok($$ select pl_t.open_wo('WO-RB2') $$, 'RF_FORBIDDEN', 'the RB assistant manager (an RB head outside the planner group) cannot open a work order');
select is(public.app_rf_master() ->> 'version', current_setting('test.v_before'), 'the refused calls wrote nothing');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' in ('WO-RB1', 'WO-RB2')), 0, 'and left no work order behind');
-- ใบใหม่ที่ขอสถานะอื่นก็ยังถูกปฏิเสธที่สิทธิ์ก่อน (ไม่มีทางเปิดใบ released ทางลัด)
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  jsonb_build_object('id', 'WO-RB3', 'customer', 'ACME', 'customerPo', '', 'recipeId', 'RC-P', 'recipeRevision', 1, 'color', 'ดำ', 'targetQty', 10,
    'producedQty', 0, 'startDate', 1762387200000, 'dueDate', 1765065600000, 'priority', 'normal', 'note', '', 'status', 'released')))),
  pl_t.rver(), 'createOrder') $$, 'RF_FORBIDDEN', 'the RB assistant manager cannot open a work order that is already released either');

-- 6. ปล่อยผลิต: ฝ่ายวางแผนและ ผจก. แผนก RB ทำได้ พนักงาน RB และผู้ช่วยผู้จัดการแผนก RB ทำไม่ได้ ---------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.v_before', public.app_rf_master() ->> 'version', true);
select throws_ok($$ select pl_t.set_status('WO-PL1', 'released') $$, 'RF_FORBIDDEN', 'RB staff cannot release a work order');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_amgr_t')::uuid);
select throws_ok($$ select pl_t.set_status('WO-PL1', 'released') $$, 'RF_FORBIDDEN', 'the RB assistant manager cannot release a work order any more');
select is(pl_t.status('WO-PL1'), 'planned', 'the refused releases left the work order planned');
select is(public.app_rf_master() ->> 'version', current_setting('test.v_before'), 'and wrote nothing');
-- เลื่อนสถานะที่ผิดกฎยังได้ผลเดิม: ผู้ช่วยฯ ปล่อยใบที่ปิดไปแล้วได้ RF_FORBIDDEN (สิทธิ์ก่อนกฎสถานะ) ดูใบที่ยกเลิกด้านล่าง

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(pl_t.set_status('WO-PL1', 'released') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'PP staff release the work order');
select is(pl_t.wo('WO-PL1') ->> 'releasedBy', current_setting('test.n_sbx_pp_staff'), 'the releaser is the persona');
select ok(pl_t.wo('WO-PL1') ? 'releasedAt', 'the release time is set by the server');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select is(pl_t.set_status('WO-PL2', 'released') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'the RB department manager (in the planner group) releases a work order');
select is(pl_t.wo('WO-PL2') ->> 'releasedBy', current_setting('test.n_sbx_rb_mgr'), 'the releaser is the persona');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select is(pl_t.set_status('WO-FM1', 'released') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'the factory manager releases a work order');

-- 7. RB ยังทำส่วนที่เหลือได้ตามเดิม: เริ่ม พัก เดินต่อ ปิด และยกเลิกใบ planned -----------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(pl_t.set_status('WO-PL1', 'in_progress') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'an RB member still starts a released work order');
select is(pl_t.set_status('WO-PL1', 'on_hold') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'on_hold', 'an RB member still puts it on hold');
select is(pl_t.set_status('WO-PL1', 'in_progress') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'and resumes it');
select is(pl_t.set_status('WO-PL1', 'completed') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'and completes it');
select throws_ok($$ select pl_t.set_status('WO-PL1', 'cancelled') $$, 'RF_INVALID_TRANSITION', 'a completed work order is still final');
select is(pl_t.set_status('WO-PL3', 'cancelled') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'an RB member still cancels a planned work order');
select throws_ok($$ select pl_t.set_status('WO-PL3', 'released') $$, 'RF_FORBIDDEN', 'RB staff cannot release a cancelled work order either (the permission is checked first)');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_amgr_t')::uuid);
select is(pl_t.set_status('WO-PL2', 'in_progress') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'the RB assistant manager still starts a released work order');
select is(pl_t.set_status('WO-PL2', 'on_hold') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'on_hold', 'and puts it on hold');
select is(pl_t.set_status('WO-FM1', 'on_hold') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'on_hold', 'a released work order can be put on hold straight away');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select pl_t.set_status('WO-PL3', 'released') $$, 'RF_INVALID_TRANSITION', 'a cancelled work order is final even for the RB department manager');

-- 8. คนนอก RB และนอกกลุ่มวางแผนยังเขียนใบไม่ได้เหมือนเดิม ----------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select pl_t.open_wo('WO-ST1') $$, 'RF_FORBIDDEN', 'ST staff still cannot open a work order');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select pl_t.open_wo('WO-QA1') $$, 'RF_FORBIDDEN', 'QA staff still cannot open a work order');

-- 9. ไม่มี session -----------------------------------------------------------------------------------------------------------------
select set_config('test.claims', current_setting('request.jwt.claims'), true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_save('{"orders":{"upsert":[]}}'::jsonb, 0, 'createOrder') $$, 'AUTH_REQUIRED', 'opening a work order requires a session');
select set_config('request.jwt.claims', current_setting('test.claims'), true);

select * from finish();
rollback;
