-- โรงงาน ขั้น 5: การตัดสินสามเรื่องเป็นของหัวหน้า QA (20261221010000_qa_head_decisions.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: private.qa_head (QA department_manager / assistant_department_manager · factory_manager / general_manager / admin
-- · ไม่ใช่ assistant_factory_manager ฝ่ายวางแผน หัวหน้า RB หรือพนักงาน QA) · โครงสร้างและสิทธิ์ของฟังก์ชัน
-- · A) ผล pass / fail บนล็อตที่กัก (RF_QA_HEAD_ONLY) · hold บนล็อตที่กักและผลใดก็ได้บนล็อตที่ไม่ได้กักยังเป็นของ QA ทุกบทบาท · ชนก่อนสิทธิ์ (RF_STALE)
--   · หัวหน้า RB ยังข้ามเวลาบ่มได้แต่ปล่อยล็อตไม่ได้
-- · B) decideRods (BOM_QA_HEAD_ONLY) · C) ปล่อยวัตถุดิบที่กัก hold -> available = หัวหน้า QA หรือหัวหน้า ST (private.material_release_ok
--   · RF_MATERIAL_RELEASE_HEAD_ONLY · คำสั่งเจ้าของ 2026-11-24 "ให้หัวหน้า ST ปลดได้ด้วย") · กักยังเป็นของกลุ่มวางแผน / ST / QA
--   · หัวหน้า ST ยังตัดสิน A และ B ไม่ได้
-- (authenticated อ่านตาราง rf_* / bom_* ตรงไม่ได้ จึงใส่ข้อมูลตั้งต้นด้วย reset role และอ่านผลผ่าน RPC ของ client เท่านั้น)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------------------------------
select ok(to_regprocedure('private.qa_head(public.employees)') is not null, 'the QA head helper exists');
select ok(to_regprocedure('private.material_release_ok(public.employees)') is not null, 'the material release helper exists');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.qa_head(public.employees)'::regprocedure, 'private.material_release_ok(public.employees)'::regprocedure,
                           'private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_rod_save_lots(public.employees,text,boolean,text,jsonb)'::regprocedure,
                           'private.rf_save_material_lots(uuid,boolean,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)),
  'the two helpers and the three replaced writers are security definer with an empty search_path');
select ok(not exists (
    select 1 from unnest(array['private.qa_head(public.employees)', 'private.material_release_ok(public.employees)',
                               'private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)',
                               'private.bom_rod_save_lots(public.employees,text,boolean,text,jsonb)',
                               'private.rf_save_material_lots(uuid,boolean,boolean,boolean,jsonb,bigint,bigint)']) f(sig)
    where has_function_privilege('anon', f.sig::regprocedure, 'execute') or has_function_privilege('authenticated', f.sig::regprocedure, 'execute')
       or has_function_privilege('public', f.sig::regprocedure, 'execute')),
  'clients cannot call the helpers or the writers directly');
select ok(not exists (select 1 from unnest(array['public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the two save RPCs keep their grants (signed-in users only)');
select ok(position('private.qa_head(p_actor)' in pg_get_functiondef('private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('private.qa_head(p_actor)' in pg_get_functiondef('private.bom_rod_save_lots(public.employees,text,boolean,text,jsonb)'::regprocedure)) > 0
      and position('private.material_release_ok(v_emp)' in pg_get_functiondef('private.rf_save_material_lots(uuid,boolean,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('private.qa_head(p_employee)' in pg_get_functiondef('private.material_release_ok(public.employees)'::regprocedure)) > 0,
  'the line-lot and rod writers ask the QA head helper; the material writer asks the release helper, which includes every QA head');
select ok(position('rf_box_uncredit' in pg_get_functiondef('private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('bom_rod_lot_create' in pg_get_functiondef('private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('receiveRodsOpening' in pg_get_functiondef('private.bom_rod_save_lots(public.employees,text,boolean,text,jsonb)'::regprocedure)) > 0,
  'the replaced writers keep the behaviour of their latest definitions (WH un-credit, rod lot creation, rods received outside an order)');
select ok(not private.bom_real_open(), 'the real-use switch is still off');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. บัญชีทดสอบ ---------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8f500000-0000-0000-0000-000000000001', 'qahead-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f500000-0000-0000-0000-000000000101', 'QAHEAD-ADMIN', 'Qahead', 'Admin', 'qahead-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f500000-0000-0000-0000-000000000001');
-- persona เพิ่ม (is_test): ผู้ดูแลระบบ ผู้ช่วยผู้จัดการแผนก QA (หัวหน้า QA ที่ไม่อยู่กลุ่มวางแผน) และผู้จัดการ / ผู้ช่วยผู้จัดการแผนก ST (หัวหน้า ST) ไม่มีในชุดตั้งต้น
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true),
  ('SBX-QA-AMGR-T', 'ทดสอบ', 'ผู้ช่วย ผจก. QA', 'sbx-qa-amgr-t@sandbox.local', 'ผู้ช่วย ผจก. QA (ทดสอบ)',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'assistant_department_manager'), false, true),
  ('SBX-ST-MGR-T', 'ทดสอบ', 'ผจก. ST', 'sbx-st-mgr-t@sandbox.local', 'ผจก. ST (ทดสอบ)',
   (select id from public.departments where code = 'ST'), (select id from public.roles where code = 'department_manager'), false, true),
  ('SBX-ST-AMGR-T', 'ทดสอบ', 'ผู้ช่วย ผจก. ST', 'sbx-st-amgr-t@sandbox.local', 'ผู้ช่วย ผจก. ST (ทดสอบ)',
   (select id from public.departments where code = 'ST'), (select id from public.roles where code = 'assistant_department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-QA-MGR' and d.code = 'QA' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-QA-AMGR-T' and d.code = 'QA' and r.code = 'assistant_department_manager')
                                or (e.employee_no = 'SBX-QA-STAFF' and d.code = 'QA' and r.code = 'staff')
                                or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP' and r.code = 'staff')
                                or (e.employee_no = 'SBX-RB-MGR' and d.code = 'RB' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB' and r.code = 'staff')
                                or (e.employee_no = 'SBX-ST-STAFF' and d.code = 'ST' and r.code = 'staff')
                                or (e.employee_no = 'SBX-ST-MGR-T' and d.code = 'ST' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-ST-AMGR-T' and d.code = 'ST' and r.code = 'assistant_department_manager')
                                or (e.employee_no = 'SBX-SR-STAFF' and d.code = 'SR' and r.code = 'staff')
                                or (e.employee_no = 'SBX-PK-MGR' and d.code = 'PK' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-FT-FM' and r.code = 'factory_manager')
                                or (e.employee_no = 'SBX-FT-AFM' and r.code = 'assistant_factory_manager')
                                or (e.employee_no = 'SBX-MGT-GM' and r.code = 'general_manager')
                                or (e.employee_no = 'SBX-ADMIN-T' and r.code = 'admin'))), 15,
  'the personas used below belong to the departments and roles the rules name');

-- หัวหน้า QA ตามบทบาท (เรียกในนามเจ้าของฐานข้อมูล ก่อนเปลี่ยนเป็น authenticated)
select is((select string_agg(e.employee_no, ',' order by e.employee_no) from public.employees e
           where e.is_test and e.employee_no like 'SBX-%' and private.qa_head(e)
             and e.employee_no in ('SBX-QA-MGR', 'SBX-QA-AMGR-T', 'SBX-QA-STAFF', 'SBX-PP-STAFF', 'SBX-RB-MGR', 'SBX-RB-STAFF', 'SBX-ST-STAFF',
                                   'SBX-SR-STAFF', 'SBX-PK-MGR', 'SBX-FT-FM', 'SBX-FT-AFM', 'SBX-MGT-GM', 'SBX-ADMIN-T')),
  'SBX-ADMIN-T,SBX-FT-FM,SBX-MGT-GM,SBX-QA-AMGR-T,SBX-QA-MGR',
  'QA heads: the QA department manager and assistant manager, the factory manager, the general manager and the admin');
select ok((select not private.qa_head(e) from public.employees e where e.employee_no = 'SBX-QA-STAFF'), 'ordinary QA staff are not QA heads');
select ok((select not private.qa_head(e) from public.employees e where e.employee_no = 'SBX-PP-STAFF')
      and (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-PP-STAFF'), 'planning (PP) is a planner but not a QA head');
select ok((select not private.qa_head(e) and private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-RB-MGR'), 'the RB head is not a QA head');
select ok((select not private.qa_head(e) and private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-PK-MGR'),
  'another department manager in the production line is not a QA head');
select ok((select not private.qa_head(e) and private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-FT-AFM'),
  'the assistant factory manager is not a QA head (the owner named the factory manager)');
select ok((select private.qa_head(e) and not private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-QA-AMGR-T'),
  'the QA assistant manager is a QA head outside the planner group');
select ok(not private.qa_head(null::public.employees), 'an unknown caller is not a QA head');
select ok((select not private.qa_head(e) from public.employees e where e.employee_no = 'SBX-ST-MGR-T')
      and (select not private.qa_head(e) from public.employees e where e.employee_no = 'SBX-ST-AMGR-T'), 'the ST heads are not QA heads');

-- ผู้ปล่อยวัตถุดิบที่กัก = หัวหน้า QA ทุกคน และหัวหน้า ST (ผู้จัดการ / ผู้ช่วยผู้จัดการแผนก ST)
select is((select string_agg(e.employee_no, ',' order by e.employee_no) from public.employees e
           where e.is_test and e.employee_no like 'SBX-%' and private.material_release_ok(e)
             and e.employee_no in ('SBX-QA-MGR', 'SBX-QA-AMGR-T', 'SBX-QA-STAFF', 'SBX-PP-STAFF', 'SBX-RB-MGR', 'SBX-RB-STAFF', 'SBX-ST-STAFF',
                                   'SBX-ST-MGR-T', 'SBX-ST-AMGR-T', 'SBX-SR-STAFF', 'SBX-PK-MGR', 'SBX-FT-FM', 'SBX-FT-AFM', 'SBX-MGT-GM', 'SBX-ADMIN-T')),
  'SBX-ADMIN-T,SBX-FT-FM,SBX-MGT-GM,SBX-QA-AMGR-T,SBX-QA-MGR,SBX-ST-AMGR-T,SBX-ST-MGR-T',
  'material releasers: every QA head plus the ST department manager and assistant manager');
select ok((select not private.material_release_ok(e) from public.employees e where e.employee_no = 'SBX-ST-STAFF'), 'ordinary ST staff cannot release a held material lot');
select ok(not private.material_release_ok(null::public.employees), 'an unknown caller cannot release a held material lot');

-- 3. ตัวช่วยของเทสต์ (schema แยก ลบพร้อม rollback): รันในฐานะผู้เรียก (authenticated) ผ่าน RPC สาธารณะเท่านั้น -------------------------------
create schema qh_t;
grant usage on schema qh_t to authenticated;
create function qh_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function qh_t.bver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function qh_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, qh_t.rver(), p_action)
$$;
create function qh_t.lot(p_id text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = p_id
$$;
create function qh_t.qc_row(p_id text, p_lot text, p_result text) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p_id, 'lotId', p_lot, 'orderId', 'WO-Q', 'stage', 'mixing',
    'tests', '[{"key":"hardness","value":65,"pass":true}]'::jsonb, 'result', p_result, 'note', '', 'inspector', 'x', 'at', 1)
$$;
create function qh_t.qc(p_id text, p_lot text, p_result text) returns jsonb language sql volatile as $$
  select qh_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(qh_t.qc_row(p_id, p_lot, p_result)))), 'addQcRecord')
$$;
create function qh_t.qc_at(p_id text, p_lot text, p_result text, p_base bigint) returns jsonb language sql volatile as $$
  select public.app_rf_save(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(qh_t.qc_row(p_id, p_lot, p_result)))), p_base, 'addQcRecord')
$$;
create function qh_t.inspector(p_id text) returns text language sql stable as $$
  select x ->> 'inspector' from jsonb_array_elements(public.app_rf_master() -> 'qcRecords') x where x ->> 'id' = p_id
$$;
create function qh_t.end_rest(p_lot text, p_reason text) returns jsonb language sql volatile as $$
  select qh_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
    qh_t.lot(p_lot) || jsonb_build_object('readyAt', (extract(epoch from now()) * 1000)::bigint,
                                          'params', (qh_t.lot(p_lot) -> 'params') || jsonb_build_object('skipRest', jsonb_build_object('reason', p_reason)))))), 'endRest')
$$;
create function qh_t.mlot(p_no text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_rf_master() -> 'materialLots') x where x ->> 'lotNo' = p_no
$$;
create function qh_t.mstatus(p_no text, p_status text) returns jsonb language sql volatile as $$
  select qh_t.rf(jsonb_build_object('materialLots', jsonb_build_object('upsert', jsonb_build_array(qh_t.mlot(p_no) || jsonb_build_object('status', p_status)))),
    'setMaterialLotStatus')
$$;
create function qh_t.rod(p_no text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'lotNo' = p_no
$$;
create function qh_t.decide(p_no text, p_decision text, p_note text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(jsonb_build_object('rodLots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'id', qh_t.rod(p_no) ->> 'id', 'decision', p_decision, 'decisionNote', p_note)))), qh_t.bver(), 'decideRods')
$$;

-- 4. ข้อมูลตั้งต้น: วัตถุดิบ สูตรอนุมัติ WO-Q (ขายเป็นสินค้า) ล็อตผสมที่กัก / ผ่าน · ชิ้น RB-Q ของ BOM และยางเส้นยาวที่ SR กัก ------------
select set_config('request.jwt.claims', '{"sub":"8f500000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.now_ms', (extract(epoch from now()) * 1000)::bigint::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select qh_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  '{"code":"MAT-A","name":"ยาง EPDM","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}'::jsonb))), 'saveMaterial');
select public.app_bom_save_master('{"items":{"upsert":[{"code":"RB-Q","kind":"RB","name":"เส้นยาง Q","ownerDept":"RB","uom":"pcs"}]}}'::jsonb,
  qh_t.bver(), 'importFlat');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select qh_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"RC-Q","revision":1,"productCode":"P-Q","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1}],"status":"draft"}'::jsonb))),
  'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select qh_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert',
  (select jsonb_agg(r || '{"status":"approved"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-Q'))), 'approveRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select qh_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"WO-Q","customer":"ACME","customerPo":"PO-Q","recipeId":"RC-Q","recipeRevision":1,"color":"ดำ","targetQty":1000,"targetKg":17.5,"kgPerUnit":0.125,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}'::jsonb))),
  'createOrder');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.ml', jsonb_build_object('lotNo', 'X', 'materialCode', 'MAT-A', 'qtyKg', 100, 'expiry', current_setting('test.now_ms')::bigint + 864000000,
  'supplier', 'บจก. โพลีเคม', 'location', 'A-1', 'status', 'available', 'coa', true)::text, true);
select qh_t.rf(jsonb_build_object('materialLots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ml')::jsonb || '{"lotNo":"RM-Q1"}'::jsonb, current_setting('test.ml')::jsonb || '{"lotNo":"RM-Q2"}'::jsonb,
  current_setting('test.ml')::jsonb || '{"lotNo":"RM-Q3"}'::jsonb))), 'receiveMaterial');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'materialLots') x where x ->> 'status' = 'available'), 3,
  'ST received three material lots');
reset role;
insert into public.rf_lots (is_test, lot_no, stage, order_no, recipe_code, uom, good_qty, qc, hold_reasons, transferred_qty, ready_at) values
  (true, 'MX-H1', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'hold', '["Dump temp นอกช่วง"]', 0, null),
  (true, 'MX-H2', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'hold', '["Dump temp นอกช่วง"]', 0, null),
  (true, 'MX-H3', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'hold', '["Dump temp นอกช่วง"]', 0, null),
  (true, 'MX-H4', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'hold', '["Dump temp นอกช่วง"]', 0, null),
  (true, 'MX-H5', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'hold', '["Dump temp นอกช่วง"]', 0, null),
  (true, 'MX-R1', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'hold', '["Dump temp นอกช่วง"]', 0, now() + interval '4 hours'),
  (true, 'MX-P1', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'pass', '[]', 0, null),
  (true, 'MX-P2', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'pass', '[]', 0, null),
  (true, 'MX-P3', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'pass', '[]', 0, null),
  (true, 'MX-P4', 'mixing', 'WO-Q', 'RC-Q', 'kg', 50, 'pass', '[]', 0, null);
update public.rf_master_state set version = version + 1 where is_test;
-- ยางเส้นยาวที่ SR รับนอกใบสั่งแล้วกักไว้ (ใส่ตรง: ทางปกติต้องผ่านสายผลิตทั้งสาย ซึ่ง bom_sr_rod_store.test.sql ตรวจแล้ว)
insert into public.bom_rod_lots (id, is_test, lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, spec, status,
                                 qty_received, qc, received_at, location, source, source_note)
select ('8f500000-0000-4000-8000-00000000000' || n)::uuid, true, 'QAH-R' || n, 'RB-Q', null, null, null, null, 'pcs', 10, null, 'held',
       10, '{"values":{"thickness":2.9},"result":"fail","note":"หนาเกินสเปก"}'::jsonb, now(), 'A-01', 'opening', 'รับเข้าทดสอบ'
from generate_series(1, 6) n;
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'qc' = 'hold'), 6, 'six mixing lots are held');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'status' = 'held'), 6, 'six rod lots are held at SR');

-- 5. A) ผลตรวจบนล็อตที่กัก: pass / fail = หัวหน้า QA เท่านั้น ----------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select qh_t.qc('QC-D1', 'MX-H1', 'pass') $$, 'RF_QA_HEAD_ONLY', 'QA staff cannot release a held lot');
select throws_ok($$ select qh_t.qc('QC-D2', 'MX-H1', 'fail') $$, 'RF_QA_HEAD_ONLY', 'nor fail a held lot');
select lives_ok($$ select qh_t.qc('QC-A1', 'MX-H1', 'hold') $$, 'QA staff still record a hold result on a held lot');
select is(qh_t.lot('MX-H1') ->> 'qc', 'hold', 'and the lot stays held');
select lives_ok($$ select qh_t.qc('QC-A2', 'MX-P1', 'fail') $$, 'QA staff still fail a lot that is not held');
select is(qh_t.lot('MX-P1') ->> 'qc', 'fail', 'the lot is failed');
select lives_ok($$ select qh_t.qc('QC-A3', 'MX-P2', 'pass') $$, 'QA staff still record a pass on a lot that is not held');
select lives_ok($$ select qh_t.qc('QC-A4', 'MX-P3', 'hold') $$, 'QA staff still put a passing lot on hold');
select is(qh_t.lot('MX-P3') ->> 'qc', 'hold', 'the lot is held');
select throws_ok($$ select qh_t.qc('QC-D3', 'MX-P3', 'pass') $$, 'RF_QA_HEAD_ONLY', 'but cannot release it again');
select throws_ok($$ select qh_t.qc('QC-D4', 'MX-P1', 'pass') $$, 'RF_INVALID_TRANSITION', 'a failed lot is still final (checked before the QA head rule)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select qh_t.qc('QC-D5', 'MX-H1', 'pass') $$, 'RF_QA_HEAD_ONLY', 'planning (PP) cannot release a held lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select qh_t.qc('QC-D6', 'MX-H1', 'pass') $$, 'RF_QA_HEAD_ONLY', 'nor another department manager of the production line');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select throws_ok($$ select qh_t.qc('QC-D7', 'MX-H1', 'fail') $$, 'RF_QA_HEAD_ONLY', 'nor the assistant factory manager');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select qh_t.qc('QC-D8', 'MX-H1', 'pass') $$, 'RF_FORBIDDEN', 'RB staff still cannot record a QC result at all');
select is(qh_t.lot('MX-H1') ->> 'qc', 'hold', 'every refused release left the lot held');

-- หัวหน้า RB: ข้ามเวลาบ่มได้เหมือนเดิม แต่ปล่อยล็อตที่กักไม่ได้
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select lives_ok($$ select qh_t.end_rest('MX-R1', 'ทดสอบความหนืดผ่านแล้ว') $$, 'the RB head still skips the ageing time');
select is(qh_t.lot('MX-R1') -> 'params' -> 'skipRest' ->> 'by', current_setting('test.n_sbx_rb_mgr'), 'with the RB head as the one who skipped it');
select throws_ok($$ select qh_t.qc('QC-D9', 'MX-R1', 'pass') $$, 'RF_QA_HEAD_ONLY', 'but the RB head cannot release the held lot');
select is(qh_t.lot('MX-R1') ->> 'qc', 'hold', 'the lot is still held');
-- หัวหน้า ST ปล่อยวัตถุดิบได้ (ข้อ 6) แต่ไม่ได้ตัดสินล็อตที่กักของสายผลิต
select public.app_sandbox_enter(current_setting('test.p_sbx_st_mgr_t')::uuid);
select throws_ok($$ select qh_t.qc('QC-D11', 'MX-H1', 'pass') $$, 'RF_QA_HEAD_ONLY', 'the ST head cannot release a held line lot');
select is(qh_t.lot('MX-H1') ->> 'qc', 'hold', 'the line lot stays held');

-- ชนก่อนสิทธิ์: ล็อตถูกกักหลังเวอร์ชันฐานของผู้เรียก = RF_STALE (ไม่ใช่ RF_QA_HEAD_ONLY)
select set_config('test.base', qh_t.rver()::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select lives_ok($$ select qh_t.qc('QC-A5', 'MX-P4', 'hold') $$, 'QA staff hold another passing lot');
select throws_ok($$ select qh_t.qc_at('QC-D10', 'MX-P4', 'pass', current_setting('test.base')::bigint) $$, 'RF_STALE',
  'a release asked from a copy taken before the hold is stale before it is refused');

-- ผู้ที่ทำได้: หัวหน้า QA (ผู้จัดการ / ผู้ช่วยผู้จัดการแผนก QA) ผู้จัดการโรงงาน ผู้จัดการทั่วไป ผู้ดูแลระบบ
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select lives_ok($$ select qh_t.qc('QC-H1', 'MX-H1', 'pass') $$, 'the QA head releases a held lot');
select is(qh_t.lot('MX-H1') ->> 'qc', 'pass', 'the lot passes');
select ok(qh_t.lot('MX-H1') -> 'holdReasons' = '[]'::jsonb, 'and its hold reasons are cleared');
select is(qh_t.inspector('QC-H1'), current_setting('test.n_sbx_qa_mgr'), 'the QA head is the inspector of the release');
select lives_ok($$ select qh_t.qc('QC-H2', 'MX-R1', 'pass') $$, 'the QA head releases the lot whose ageing the RB head skipped');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_amgr_t')::uuid);
select lives_ok($$ select qh_t.qc('QC-H3', 'MX-H2', 'fail') $$, 'the QA assistant manager fails a held lot');
select is(qh_t.lot('MX-H2') ->> 'qc', 'fail', 'the lot is failed');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select lives_ok($$ select qh_t.qc('QC-H4', 'MX-H3', 'pass') $$, 'the factory manager may act instead');
select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select lives_ok($$ select qh_t.qc('QC-H5', 'MX-H4', 'fail') $$, 'the general manager may act instead');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select lives_ok($$ select qh_t.qc('QC-H6', 'MX-H5', 'pass') $$, 'the admin may act instead');
select is((select string_agg(x ->> 'id' || ':' || (x ->> 'qc'), ',' order by x ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'lots') x
           where x ->> 'id' in ('MX-H1', 'MX-H2', 'MX-H3', 'MX-H4', 'MX-H5', 'MX-R1')),
  'MX-H1:pass,MX-H2:fail,MX-H3:pass,MX-H4:fail,MX-H5:pass,MX-R1:pass', 'each head decision set the lot');

-- 6. C) ปล่อยวัตถุดิบที่กัก hold -> available = หัวหน้า QA หรือหัวหน้า ST · กักยังเป็นของกลุ่มวางแผน / ST / QA ---------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q1', 'hold') $$, 'ST still holds a material lot');
select is(qh_t.mlot('RM-Q1') ->> 'status', 'hold', 'the lot is held');
select throws_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'RF_MATERIAL_RELEASE_HEAD_ONLY', 'ST staff cannot release it');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'RF_MATERIAL_RELEASE_HEAD_ONLY', 'nor can QA staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'RF_MATERIAL_RELEASE_HEAD_ONLY', 'nor planning (PP)');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'RF_MATERIAL_RELEASE_HEAD_ONLY', 'nor the RB head');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'RF_MATERIAL_RELEASE_HEAD_ONLY', 'nor another department manager of the production line');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'RF_FORBIDDEN', 'RB staff still have no right on material lots at all');
select is(qh_t.mlot('RM-Q1') ->> 'status', 'hold', 'every refused release left the material lot held');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'the QA head releases the material lot');
select is(qh_t.mlot('RM-Q1') ->> 'status', 'available', 'the lot is available again');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_mgr_t')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q1', 'hold') $$, 'the ST head holds a material lot');
select lives_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'and the ST head releases it (owner order 2026-11-24)');
select is(qh_t.mlot('RM-Q1') ->> 'status', 'available', 'the lot is available again after the ST head release');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q1', 'hold') $$, 'QA staff still hold a material lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q2', 'hold') $$, 'planning (PP) still holds a material lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q3', 'hold') $$, 'and so does ST');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q1', 'available') $$, 'the factory manager may release instead');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q2', 'available') $$, 'and so may the admin');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_amgr_t')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q3', 'available') $$, 'and the QA assistant manager');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q3', 'hold') $$, 'ST staff hold the lot once more');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_amgr_t')::uuid);
select lives_ok($$ select qh_t.mstatus('RM-Q3', 'available') $$, 'and the ST assistant manager releases it');
select is((select string_agg(x ->> 'lotNo' || ':' || (x ->> 'status'), ',' order by x ->> 'lotNo') from jsonb_array_elements(public.app_rf_master() -> 'materialLots') x),
  'RM-Q1:available,RM-Q2:available,RM-Q3:available', 'every material lot is available again');

-- 7. B) decideRods = หัวหน้า QA เท่านั้น ----------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select qh_t.decide('QAH-R1', 'accept', 'ab') $$, 'BOM_INVALID_ROD', 'the row shape is still checked first (a note of three characters)');
select throws_ok($$ select qh_t.decide('QAH-R1', 'accept', 'ใช้ตามสภาพ') $$, 'BOM_QA_HEAD_ONLY', 'QA staff cannot decide a held rod lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select qh_t.decide('QAH-R1', 'return', 'ส่งคืน RB แก้ไข') $$, 'BOM_QA_HEAD_ONLY', 'nor planning (PP)');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select qh_t.decide('QAH-R1', 'return', 'ส่งคืน RB แก้ไข') $$, 'BOM_QA_HEAD_ONLY', 'nor the RB head');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select throws_ok($$ select qh_t.decide('QAH-R1', 'scrap', 'เสียหายทั้งล็อต') $$, 'BOM_QA_HEAD_ONLY', 'nor the assistant factory manager');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select qh_t.decide('QAH-R1', 'accept', 'ใช้ตามสภาพ') $$, 'BOM_QA_HEAD_ONLY', 'nor SR staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_mgr_t')::uuid);
select throws_ok($$ select qh_t.decide('QAH-R1', 'accept', 'ใช้ตามสภาพ') $$, 'BOM_QA_HEAD_ONLY', 'nor the ST head (material release only)');
select is(qh_t.rod('QAH-R1') ->> 'status', 'held', 'every refused decision left the rod lot held');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select lives_ok($$ select qh_t.decide('QAH-R1', 'accept', 'ใช้ตามสภาพ') $$, 'the QA head accepts a held rod lot');
select is(qh_t.rod('QAH-R1') ->> 'status' || '/' || (qh_t.rod('QAH-R1') ->> 'decidedBy'), 'stored/' || current_setting('test.n_sbx_qa_mgr'),
  'the lot is stored with the QA head as the decider');
select throws_ok($$ select qh_t.decide('QAH-R1', 'scrap', 'ลองใหม่') $$, 'BOM_INVALID_TRANSITION', 'a decided lot cannot be decided again');
select lives_ok($$ select qh_t.decide('QAH-R2', 'return', 'ส่งคืน RB แก้ไข') $$, 'the QA head returns a held rod lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_amgr_t')::uuid);
select lives_ok($$ select qh_t.decide('QAH-R3', 'scrap', 'เสียหายทั้งล็อต') $$, 'the QA assistant manager scraps a held rod lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select lives_ok($$ select qh_t.decide('QAH-R4', 'return', 'ส่งคืน RB แก้ไข') $$, 'the factory manager may decide instead');
select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select lives_ok($$ select qh_t.decide('QAH-R5', 'scrap', 'เสียหายทั้งล็อต') $$, 'the general manager may decide instead');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select lives_ok($$ select qh_t.decide('QAH-R6', 'accept', 'ใช้ตามสภาพ') $$, 'the admin may decide instead');
select is((select string_agg(l ->> 'lotNo' || ':' || (l ->> 'status'), ',' order by l ->> 'lotNo') from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l
           where l ->> 'lotNo' like 'QAH-R%'),
  'QAH-R1:stored,QAH-R2:returned,QAH-R3:scrapped,QAH-R4:returned,QAH-R5:scrapped,QAH-R6:stored', 'each head decision set the rod lot');

-- 8. ไม่มี session -----------------------------------------------------------------------------------------------------------------
select set_config('test.claims', current_setting('request.jwt.claims'), true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"rodLots":{"upsert":[]}}'::jsonb, 0, 'decideRods') $$, 'AUTH_REQUIRED', 'deciding rods requires a session');
select set_config('request.jwt.claims', current_setting('test.claims'), true);

select * from finish();
rollback;
