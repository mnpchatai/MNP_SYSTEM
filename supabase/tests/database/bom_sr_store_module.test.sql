-- โมดูลคลังยางเส้นยาว SR (โรงงาน ขั้น 1) ของ BOM โหมดทดสอบ (20261204010000_bom_sr_store_module.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้างของ bom_rod_lots (location / source / source_note, ล็อตนอกใบสั่งไม่มีใบ / งาน / WO) สิทธิ์ตารางเดิม รายการ action
-- · receiveRodsOpening (SR / กลุ่มวางแผน · GR RB WH QA ไม่ได้ · ชิ้นต้องเป็น RB · เลขล็อตไม่ซ้ำ ไม่ขึ้นต้น FN- · ตำแหน่งและที่มาจำเป็น)
-- · receiveRods ต้องมีตำแหน่งจัดเก็บ · setRodLocation (SR / กลุ่มวางแผน · ล็อต held / stored เท่านั้น) · adjustRods (SR ทำได้แล้ว GR / RB ไม่ได้)
-- · ล็อตนอกใบสั่งจ่ายให้ใบได้ และปล่อยผลิตหยิบล็อตเก่าก่อน · RubberFlow: แผนก RB (และกลุ่มวางแผน) รับมอบใบส่งมอบ WIP แผนก SR ไม่ได้แล้ว
-- ข้อควรระวัง: ถ้าอ่านตารางตรงในนาม authenticated จะเกิด 42501 และทำให้ทั้งไฟล์ล้ม ("No plan found") อ่านตารางด้วย reset role เท่านั้น
begin;
-- กฎการใช้งานจริงของไฟล์นี้ทดสอบเมื่อเปิดใช้จริงแล้ว: เปิดสวิตช์ในธุรกรรมของเทสต์ (rollback ท้ายไฟล์) · สวิตช์ปิดทดสอบใน bom_rf_sandbox_lock.test.sql
create or replace function private.bom_real_open() returns boolean language sql stable set search_path = '' as $$ select true $$;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้าง สิทธิ์ และรายการ action -------------------------------------------------------------------------------------------
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ', ' order by a.attname)
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
           where a.attrelid = 'public.bom_rod_lots'::regclass and a.attname in ('location', 'source', 'source_note') and not a.attisdropped),
  'location:text:true:''''::text, source:text:true:''order''::text, source_note:text:false:-',
  'the lot table has location (not null, empty by default), source (order by default) and an optional source note');
select is((select string_agg(a.attname, ', ' order by a.attname) from pg_attribute a
           where a.attrelid = 'public.bom_rod_lots'::regclass and a.attname in ('order_pk', 'job_no', 'wo_no', 'recipe_code') and not a.attnotnull and not a.attisdropped),
  'job_no, order_pk, recipe_code, wo_no', 'the order, job, work order and recipe of a lot may be empty (a lot taken in outside an order)');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_rod_lots'::regclass and c.conname = 'bom_rod_lots_source_fields_check')
      and exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_rod_lots'::regclass and c.conname = 'bom_rod_lots_state_check'),
  'the lot table checks the source and the state');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_rod_lots'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(order_pk, is_test) REFERENCES %bom_orders(id, is_test)%'),
  'the lot keeps its foreign key to the order paired with is_test');
select is((select count(*) from pg_class c where c.oid in ('public.bom_rod_lots'::regclass, 'public.bom_rod_moves'::regclass) and c.relrowsecurity), 2::bigint,
  'both store tables still have RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['public.bom_rod_lots', 'public.bom_rod_moves']) t(name),
                  unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, t.name, p.priv)),
  'anon and authenticated still have no direct table privilege on the store tables');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.bom_rod_lots'::regclass and p.polname = 'bom_rod_lots_no_direct_access')
      and exists (select 1 from pg_policy p where p.polrelid = 'public.bom_rod_lots'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive),
  'the lot table keeps the deny-all and the restrictive lab-only policies');
select ok(array['receiveRodsOpening', 'setRodLocation', 'adjustRods', 'receiveRods'] <@ private.bom_client_actions()
          and array['receiveRodsOpening', 'setRodLocation', 'adjustRods', 'receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue'] <@ private.bom_staff_actions(),
  'the two new actions are on both lists and adjustRods is now a staff action');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_rod_save_lots(public.employees,text,boolean,text,jsonb)'::regprocedure,
                           'private.bom_rod_save_moves(public.employees,boolean,text,jsonb)'::regprocedure,
                           'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the replaced writers and readers are still security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and (p.proname like 'bom\_rod\_%' or p.proname in ('bom_client_actions', 'bom_staff_actions', 'bom_records'))
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the store writers or the redefined lists directly');
select ok(not exists (select 1 from unnest(array['public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the replaced RPCs keep their grants (signed-in users only)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(position('v_sr' in pg_get_functiondef('public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure)) = 0,
  'the RubberFlow writer no longer gives the SR department any right');

-- 2. ข้อจำกัดของตาราง (ใส่ตรง ข้อมูลจริง ยังไม่มี claims) ------------------------------------------------------------------------------
insert into public.bom_orders (pi_no, customer, country, order_type, ordered_at, wh_due) values ('REAL-SM-PI', 'ลูกค้าจริง', 'TH', 'SA', 1762300000000, 1762400000000);
select lives_ok($$ insert into public.bom_rod_lots (lot_no, item_code, uom, qty_sent, status, qty_received, received_at, location, source, source_note)
  values ('OP-REAL-1', 'REAL-RB', 'pcs', 5, 'stored', 5, now(), 'A-01', 'opening', 'ยกยอดจากการนับ') $$,
  'a stored lot taken in outside an order needs no order, job, work order, recipe or QC result');
select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, order_pk, uom, qty_sent, status, qty_received, received_at, source, source_note)
  select 'OP-BAD-1', 'REAL-RB', o.id, 'pcs', 5, 'stored', 5, now(), 'opening', 'ยกยอด' from public.bom_orders o where o.pi_no = 'REAL-SM-PI' $$,
  '23514', null, 'a lot taken in outside an order has no order');
select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, order_pk, wo_no, recipe_code, uom, qty_sent)
  select 'FN-BAD-1', 'REAL-RB', o.id, 'W', 'R', 'pcs', 5 from public.bom_orders o where o.pi_no = 'REAL-SM-PI' $$,
  '23514', null, 'a lot from an order needs its job');
select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, status, qty_received, received_at)
  select 'FN-BAD-2', 'REAL-RB', o.id, 'J', 'W', 'R', 'pcs', 5, 'stored', 5, now() from public.bom_orders o where o.pi_no = 'REAL-SM-PI' $$,
  '23514', null, 'a stored lot from an order still needs its QC result');
select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, uom, qty_sent, status, qty_received, received_at, location, source)
  values ('OP-BAD-2', 'REAL-RB', 'pcs', 5, 'stored', 5, now(), repeat('A', 41), 'opening') $$,
  '23514', null, 'a location is at most 40 characters');
select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, uom, qty_sent, status, qty_received, received_at, source)
  values ('OP-BAD-3', 'REAL-RB', 'pcs', 5, 'stored', 5, now(), 'gift') $$,
  '23514', null, 'an unknown source is refused');

-- 3. บัญชีทดสอบและตัวช่วยของเทสต์ -------------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8ec00000-0000-0000-0000-000000000001', 'srmodule-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8ec00000-0000-0000-0000-000000000101', 'SRMODULE-ADMIN', 'Srmodule', 'Admin', 'srmodule-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8ec00000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-SR-STAFF' and d.code = 'SR' and r.code = 'staff') or (e.employee_no = 'SBX-QA-STAFF' and d.code = 'QA')
                                or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB' and r.code = 'staff') or (e.employee_no = 'SBX-GR-STAFF' and d.code = 'GR')
                                or (e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-RB-MGR' and d.code = 'RB' and r.code = 'department_manager'))), 7,
  'the personas used below belong to the departments and roles the rules name');

create schema sm_t;
grant usage on schema sm_t to authenticated;
create function sm_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function sm_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, sm_t.ver(), p_action)
$$;
create function sm_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, (public.app_rf_master() ->> 'version')::bigint, p_action)
$$;
create function sm_t.lot(p_no text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'lotNo' = p_no
$$;
create function sm_t.lot_id(p_no text) returns text language sql stable as $$ select sm_t.lot(p_no) ->> 'id' $$;
create function sm_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function sm_t.bal(p_lot text, p_owner text) returns numeric language sql stable as $$
  select coalesce(sum((m ->> 'qty')::numeric), 0) from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m
  where m ->> 'lotId' = sm_t.lot_id(p_lot) and (m ->> 'ownerOrderId') is not distinct from p_owner
$$;
create function sm_t.audit() returns text language sql stable as $$ select public.app_bom_audit(1) -> 0 ->> 'detail' $$;
create function sm_t.lots(p_rows jsonb, p_action text) returns jsonb language sql volatile as $$
  select sm_t.save(jsonb_build_object('rodLots', jsonb_build_object('upsert', p_rows)), p_action)
$$;
create function sm_t.moves(p_rows jsonb, p_action text) returns jsonb language sql volatile as $$
  select sm_t.save(jsonb_build_object('rodMoves', jsonb_build_object('upsert', p_rows)), p_action)
$$;
-- แถวคำขอรับนอกใบสั่ง: { id, lotNo, itemCode, qty, location, note } (ส่วนที่ต่างส่งทับด้วย ||)
create function sm_t.opening(p_id text, p_extra jsonb) returns jsonb language sql volatile as $$
  select sm_t.lots(jsonb_build_array(jsonb_build_object('id', p_id, 'lotNo', 'OP-1', 'itemCode', 'RB-A', 'qty', 30, 'location', 'A-01',
                                                        'note', 'ยกยอดจากการนับคลัง') || p_extra), 'receiveRodsOpening')
$$;
create function sm_t.release(p_no text, p_extra jsonb, p_jobs jsonb) returns jsonb language sql volatile as $$
  select sm_t.save(jsonb_build_object(
    'orders', jsonb_build_object('upsert', jsonb_build_array(sm_t.order_row(p_no) || p_extra || '{"status":"released"}'::jsonb)),
    'jobs', jsonb_build_object('upsert', p_jobs)), 'releaseOrder')
$$;
-- รับมอบใบส่งมอบ WIP ของ RubberFlow ทั้งยอดที่ส่ง
create function sm_t.receive_tr(p_no text) returns jsonb language sql volatile as $$
  select sm_t.rf(jsonb_build_object('transfers', jsonb_build_object('upsert',
    (select jsonb_agg(x || jsonb_build_object('status', 'received', 'qtyReceived', (x ->> 'qtySent')::numeric))
     from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = p_no))), 'receiveTransfer')
$$;
create function sm_t.free(p_code text) returns numeric language sql stable security definer set search_path = '' as $$
  select private.bom_rod_free(p_code)
$$;

-- 4. ข้อมูลตั้งต้น: ชิ้น RB / SE / FG · ใบ 26001 ปล่อยผลิต 26002 ร่าง · WO ขายหนึ่งใบสำหรับใบส่งมอบ WIP ---------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8ec00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}],"explosion":[{"itemCode":"FG-A","kind":"FG","level":0,"fgQty":10,"required":10},{"itemCode":"SE-A","kind":"SE","level":1,"fgQty":10,"required":20},{"itemCode":"RB-A","kind":"RB","level":2,"fgQty":10,"required":40}],"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"RB","itemCode":"RB-A","name":"งานทดสอบ","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select sm_t.save('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-A","kind":"RB","name":"เส้นยาง A","ownerDept":"RB","uom":"pcs","rubber":{"compound":"CP-1","color":"BK01","lengthMm":1000}}]}}'::jsonb, 'importFlat');
select sm_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251204-26001"}'::jsonb,
  current_setting('test.ord')::jsonb || '{"id":"251204-26002"}'::jsonb))), 'createOrder');
select sm_t.release('251204-26001', '{}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-1-RB","orderId":"251204-26001"}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-1-GR","orderId":"251204-26001","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-1-PK","orderId":"251204-26001","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb));
select is(sm_t.order_row('251204-26001') ->> 'status' || '/' || (sm_t.order_row('251204-26002') ->> 'status'), 'released/draft', 'one order is released and the other stays a draft');

-- ล็อตของใบที่รอรับ / กัก / คืน RB ใส่ตรง (ข้ามสาย RubberFlow ที่ตรวจใน bom_sr_rod_store.test.sql)
reset role;
insert into public.bom_rod_lots (is_test, lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, status, qty_received, qc, received_at, decision, decision_note, decided_at)
select true, v.lot_no, 'RB-A', o.id, 'JOB-1-RB', 'WO-SM', 'RC-SM', 'pcs', v.qty, v.status, v.received, v.qc, v.received_at, v.decision, v.note, v.decided_at
from public.bom_orders o
cross join (values
  ('FN-PEND-1', 10::numeric, 'pending', null::numeric, null::jsonb, null::timestamptz, null::text, null::text, null::timestamptz),
  ('FN-HELD-1', 8, 'held', 8, '{"values":{},"result":"fail","note":"หนาเกิน"}'::jsonb, now(), null, null, null),
  ('FN-RET-1', 6, 'returned', 6, '{"values":{},"result":"fail","note":"หนาเกิน"}'::jsonb, now(), 'return', 'ส่งคืน RB แก้ไข', now())
) as v(lot_no, qty, status, received, qc, received_at, decision, note, decided_at)
where o.is_test and o.pi_no = '251204-26001';
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'rodLots')), 3, 'three lots of the order are in the test store');
select is(sm_t.lot('FN-PEND-1') ->> 'location' || '/' || (sm_t.lot('FN-PEND-1') ->> 'source') || '/' || coalesce(sm_t.lot('FN-PEND-1') ->> 'sourceNote', 'null'), '/order/null',
  'a lot of an order has no location yet, source order and no source note');

-- 5. receiveRodsOpening: ปฏิเสธ (สิทธิ์ รูปแถว ชิ้น เลขล็อต) ------------------------------------------------------------------------------
select set_config('test.op1', '00000000-0000-4000-8000-000000000101', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'GR staff cannot take rods into the SR store outside an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'nor can RB staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'nor WH staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'nor QA staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"itemCode":"SE-A"}'::jsonb) $$, 'BOM_INVALID_ROD', 'only an RB item is a long rubber rod');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"itemCode":"RB-NOPE"}'::jsonb) $$, 'BOM_INVALID_ROD', 'an unknown item is refused');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"qty":0}'::jsonb) $$, 'BOM_INVALID_ROD', 'a quantity of zero is refused');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"location":"  "}'::jsonb) $$, 'BOM_INVALID_ROD', 'the storage location is required');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), jsonb_build_object('location', repeat('A', 41))) $$, 'BOM_INVALID_ROD', 'a location is at most 40 characters');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"note":"ab"}'::jsonb) $$, 'BOM_INVALID_ROD', 'where the rods came from needs three characters');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"lotNo":""}'::jsonb) $$, 'BOM_INVALID_ROD', 'the lot number is required');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"lotNo":"fn-777"}'::jsonb) $$, 'BOM_INVALID_ROD',
  'a lot number of a RubberFlow finishing lot (FN-) is kept for rods of an order');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"lotNo":"FN-PEND-1"}'::jsonb) $$, 'BOM_INVALID_ROD', 'nor may it repeat a lot of an order');
select throws_ok($$ select sm_t.opening('not-a-uuid', '{}'::jsonb) $$, 'BOM_INVALID_ROD', 'the row id is a uuid');
select throws_ok($$ select sm_t.opening(sm_t.lot_id('FN-PEND-1'), '{"lotNo":"OP-9"}'::jsonb) $$, 'BOM_INVALID_ROD', 'the row id must be new');
select throws_ok($$ select sm_t.lots(jsonb_build_array(
  jsonb_build_object('id', current_setting('test.op1'), 'lotNo', 'OP-1', 'itemCode', 'RB-A', 'qty', 30, 'location', 'A-01', 'note', 'ยกยอด'),
  jsonb_build_object('id', '00000000-0000-4000-8000-000000000102', 'lotNo', 'OP-2', 'itemCode', 'RB-A', 'qty', 30, 'location', 'A-01', 'note', 'ยกยอด')), 'receiveRodsOpening') $$,
  'BOM_INVALID_ROD', 'one lot per call');
select throws_ok($$ select sm_t.save('{"rodLots":{"upsert":[]}}'::jsonb, 'receiveRodsOpening') $$, 'BOM_INVALID_ROD', 'an empty request is refused');
select throws_ok($$ select sm_t.moves('[{"id":"00000000-0000-4000-8000-000000000101"}]'::jsonb, 'receiveRodsOpening') $$, 'BOM_INVALID_ROD',
  'the opening receipt goes in the lot section only');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'rodLots')), 3, 'the refused calls wrote no lot');

-- 6. receiveRodsOpening: SR รับเข้าเป็นสต็อกกลาง ---------------------------------------------------------------------------------------------
select set_config('test.bv', sm_t.ver()::text, true);
select set_config('test.res', sm_t.opening(current_setting('test.op1'), '{"lotNo":" op-1 "}'::jsonb)::text, true);
select is(sm_t.lot('OP-1') ->> 'id', current_setting('test.op1'), 'SR takes rods in outside an order: the lot keeps the id the client sent and an upper-case lot number');
select is(jsonb_build_object('status', sm_t.lot('OP-1') ->> 'status', 'source', sm_t.lot('OP-1') ->> 'source', 'sourceNote', sm_t.lot('OP-1') ->> 'sourceNote',
                             'location', sm_t.lot('OP-1') ->> 'location', 'itemCode', sm_t.lot('OP-1') ->> 'itemCode', 'uom', sm_t.lot('OP-1') ->> 'uom',
                             'qtySent', (sm_t.lot('OP-1') ->> 'qtySent')::numeric, 'qtyReceived', (sm_t.lot('OP-1') ->> 'qtyReceived')::numeric),
  jsonb_build_object('status', 'stored', 'source', 'opening', 'sourceNote', 'ยกยอดจากการนับคลัง', 'location', 'A-01', 'itemCode', 'RB-A', 'uom', 'pcs', 'qtySent', 30, 'qtyReceived', 30),
  'the lot is stored at once as an opening lot with its location, its source note and the unit of the item');
select ok(sm_t.lot('OP-1') -> 'orderId' = 'null'::jsonb and sm_t.lot('OP-1') -> 'jobNo' = 'null'::jsonb and sm_t.lot('OP-1') -> 'woNo' = 'null'::jsonb
      and sm_t.lot('OP-1') -> 'recipeCode' = 'null'::jsonb and sm_t.lot('OP-1') -> 'spec' = 'null'::jsonb and sm_t.lot('OP-1') -> 'qc' = 'null'::jsonb,
  'it has no order, job, work order, recipe, spec or QC result');
select is(sm_t.lot('OP-1') ->> 'receivedBy', current_setting('test.n_sbx_sr_staff'), 'the receiver is the persona');
select ok(sm_t.lot('OP-1') ->> 'receivedAt' is not null, 'the receipt time is set by the server');
select is((select jsonb_agg(jsonb_build_object('kind', m ->> 'kind', 'qty', (m ->> 'qty')::numeric, 'owner', m ->> 'ownerOrderId', 'for', m ->> 'forOrderId', 'note', m ->> 'note'))
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'rodMoves' -> 'upsert') m),
  jsonb_build_array(jsonb_build_object('kind', 'receive', 'qty', 30, 'owner', null, 'for', null, 'note', 'ยกยอดจากการนับคลัง')),
  'one receive move into free central stock, with where the rods came from');
select is(sm_t.free('RB-A'), 30::numeric, 'free central stock is the 30 rods');
select is(sm_t.ver(), current_setting('test.bv')::bigint + 1, 'one BOM counter step');
select is(sm_t.audit(), 'rodLots +1, rodMoves +1', 'the history counts the lot and the move');
select throws_ok($$ select sm_t.opening('00000000-0000-4000-8000-000000000103', '{"lotNo":"op-1"}'::jsonb) $$, 'BOM_INVALID_ROD', 'a lot number is used once');
select throws_ok($$ select sm_t.opening(current_setting('test.op1'), '{"lotNo":"OP-8"}'::jsonb) $$, 'BOM_INVALID_ROD', 'and a row id once');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sm_t.opening('00000000-0000-4000-8000-000000000104', '{"lotNo":"OP-2","qty":20,"location":"B-02","note":"คืนจากลูกค้า"}'::jsonb) $$,
  'a planner takes rods in outside an order too');
select is(sm_t.free('RB-A'), 50::numeric, 'free central stock is 30 + 20');

-- 7. receiveRods ต้องมีตำแหน่งจัดเก็บ ----------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select set_config('test.recv', jsonb_build_object('id', sm_t.lot_id('FN-PEND-1'), 'qtyReceived', 10, 'qc', '{"values":{},"result":"pass","note":""}'::jsonb)::text, true);
select throws_ok($$ select sm_t.lots(jsonb_build_array(current_setting('test.recv')::jsonb), 'receiveRods') $$, 'BOM_INVALID_ROD', 'a receipt without a location is refused');
select throws_ok($$ select sm_t.lots(jsonb_build_array(current_setting('test.recv')::jsonb || '{"location":" "}'::jsonb), 'receiveRods') $$, 'BOM_INVALID_ROD',
  'a blank location is refused');
select throws_ok($$ select sm_t.lots(jsonb_build_array(current_setting('test.recv')::jsonb || jsonb_build_object('location', repeat('B', 41))), 'receiveRods') $$, 'BOM_INVALID_ROD',
  'a location longer than 40 characters is refused');
select is(sm_t.lot('FN-PEND-1') ->> 'status', 'pending', 'and the lot still waits');
select lives_ok($$ select sm_t.lots(jsonb_build_array(current_setting('test.recv')::jsonb || '{"location":" D-04 "}'::jsonb), 'receiveRods') $$, 'SR receives with a location');
select is(sm_t.lot('FN-PEND-1') ->> 'status' || '/' || (sm_t.lot('FN-PEND-1') ->> 'location'), 'stored/D-04', 'the lot is stored at the trimmed location');
select is(sm_t.bal('FN-PEND-1', '251204-26001'), 10::numeric, 'and credited to the bucket of its order as before');

-- 8. setRodLocation: ย้ายตำแหน่ง ---------------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select sm_t.lots(jsonb_build_array(jsonb_build_object('id', sm_t.lot_id('OP-1'), 'location', 'C-03')), 'setRodLocation') $$, 'BOM_FORBIDDEN',
  'GR staff cannot move a lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select sm_t.lots(jsonb_build_array(jsonb_build_object('id', sm_t.lot_id('FN-HELD-1'), 'location', 'Q-01')), 'setRodLocation') $$, 'BOM_FORBIDDEN',
  'nor can QA staff (not even a held lot)');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select sm_t.lots(jsonb_build_array(jsonb_build_object('id', sm_t.lot_id('OP-1'), 'location', '')), 'setRodLocation') $$, 'BOM_INVALID_ROD',
  'the new location is required');
select throws_ok($$ select sm_t.lots(jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-0000000001ff', 'location', 'C-03')), 'setRodLocation') $$, 'BOM_INVALID_ROD',
  'an unknown lot is refused');
select throws_ok($$ select sm_t.lots(jsonb_build_array(jsonb_build_object('id', sm_t.lot_id('FN-RET-1'), 'location', 'C-03')), 'setRodLocation') $$, 'BOM_INVALID_TRANSITION',
  'a lot returned to RB is no longer in the store');
select set_config('test.bv', sm_t.ver()::text, true);
select set_config('test.moves0', jsonb_array_length(public.app_bom_master() -> 'rodMoves')::text, true);
select lives_ok($$ select sm_t.lots(jsonb_build_array(jsonb_build_object('id', sm_t.lot_id('OP-1'), 'location', 'C-03')), 'setRodLocation') $$, 'SR moves a stored lot');
select is(sm_t.lot('OP-1') ->> 'location', 'C-03', 'the lot has its new location');
select is(sm_t.lot('OP-1') ->> 'status' || '/' || (sm_t.lot('OP-1') ->> 'qtyReceived') || '/' || (sm_t.lot('OP-1') ->> 'sourceNote'), 'stored/30/ยกยอดจากการนับคลัง',
  'and nothing else of the lot changes');
select is(jsonb_array_length(public.app_bom_master() -> 'rodMoves'), current_setting('test.moves0')::integer, 'a move of place writes no stock move');
select is(sm_t.audit(), 'rodLots +1', 'the history counts the lot');
select is(sm_t.ver(), current_setting('test.bv')::bigint + 1, 'one BOM counter step');
select lives_ok($$ select sm_t.lots(jsonb_build_array(jsonb_build_object('id', sm_t.lot_id('FN-HELD-1'), 'location', 'Q-01')), 'setRodLocation') $$, 'SR moves a held lot too');
select is(sm_t.lot('FN-HELD-1') ->> 'status' || '/' || (sm_t.lot('FN-HELD-1') ->> 'location'), 'held/Q-01', 'the held lot keeps waiting for QA at its new place');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sm_t.lots(jsonb_build_array(jsonb_build_object('id', sm_t.lot_id('OP-2'), 'location', 'B-03')), 'setRodLocation') $$, 'a planner moves a lot too');

-- 9. adjustRods: SR ปรับยอดเองได้ (เหตุผลทุกครั้ง สต็อกกลางเท่านั้น) ---------------------------------------------------------------------------------
select set_config('test.adj', jsonb_build_object('id', '00000000-0000-4000-8000-000000000201', 'kind', 'adjust', 'lotId', sm_t.lot_id('OP-1'), 'qty', -5, 'note', 'นับจริงขาด 5')::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select sm_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb), 'adjustRods') $$, 'BOM_FORBIDDEN', 'GR staff cannot adjust the store');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select sm_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb), 'adjustRods') $$, 'BOM_FORBIDDEN', 'nor can RB staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select sm_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb || '{"note":"ab"}'::jsonb), 'adjustRods') $$, 'BOM_INVALID_ROD', 'SR still needs a reason');
select throws_ok($$ select sm_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb || '{"ownerOrderId":"251204-26001"}'::jsonb), 'adjustRods') $$, 'BOM_INVALID_ROD',
  'SR adjusts free central stock only');
select throws_ok($$ select sm_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb || '{"qty":-31}'::jsonb), 'adjustRods') $$, 'BOM_ROD_EXCEEDS', 'free stock never goes below zero');
select throws_ok($$ select sm_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb || jsonb_build_object('lotId', sm_t.lot_id('FN-HELD-1'))), 'adjustRods') $$, 'BOM_INVALID_TRANSITION',
  'a held lot cannot be adjusted');
select lives_ok($$ select sm_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb), 'adjustRods') $$, 'SR adjusts the free stock of a lot with a reason');
select is(sm_t.bal('OP-1', null), 25::numeric, 'the free stock of the lot is 25');
select is((select m ->> 'by' from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m where m ->> 'id' = '00000000-0000-4000-8000-000000000201'),
  current_setting('test.n_sbx_sr_staff'), 'the adjustment is recorded under the SR persona');
select is(sm_t.audit(), 'rodMoves +1', 'the history counts the adjustment');

-- 10. ล็อตนอกใบสั่งจ่ายให้ใบได้ และปล่อยผลิตหยิบล็อตเก่าก่อน ------------------------------------------------------------------------------------
select lives_ok($$ select sm_t.moves(jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000301', 'kind', 'issue', 'lotId', sm_t.lot_id('OP-1'),
  'ownerOrderId', null, 'forOrderId', '251204-26001', 'itemCode', 'RB-A', 'qty', -10)), 'issueRods') $$, 'SR issues 10 rods of the opening lot to GR for an order');
select is(sm_t.bal('OP-1', null), 15::numeric, 'the opening lot has 15 left');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.res', sm_t.release('251204-26002', '{"stockCounts":{"RB-A":20}}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-2-RB","orderId":"251204-26002","qtyPlanned":20,"qtyRequired":40}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-2-GR","orderId":"251204-26002","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-2-PK","orderId":"251204-26002","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))::text, true);
select is(sm_t.order_row('251204-26002') ->> 'status', 'released', 'the draft is released taking 20 rods from the store');
select is(sm_t.bal('OP-1', '251204-26002') || '/' || sm_t.bal('OP-2', '251204-26002'), '15/5', 'oldest lot first: all 15 left of OP-1, then 5 of OP-2');
select is(sm_t.bal('OP-1', null) || '/' || sm_t.bal('OP-2', null), '0/15', 'the free buckets lost what was taken');
select is(sm_t.free('RB-A'), 15::numeric, 'free central stock is 15');

-- 11. RubberFlow: ใบส่งมอบ WIP ระหว่างสถานีของ RB รับโดยแผนก RB (หรือกลุ่มวางแผน) ไม่ใช่แผนก SR -------------------------------------------------
select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select set_config('test.rec', '{"id":"RC-SM","revision":1,"productCode":"P-1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":50,"stage":1},{"materialCode":"MAT-C","phr":10,"stage":2}],"status":"draft"}', true);
select set_config('test.wo', '{"id":"WO-SMU","customer":"ACME","customerPo":"PO-1","recipeId":"RC-SM","recipeRevision":1,"color":"ดำ","targetQty":1000,"targetKg":17.5,"kgPerUnit":0.125,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);
select sm_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ"}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"MAT-C","name":"สารตัวเร่ง"}'::jsonb))), 'saveMaterial');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select sm_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.rec')::jsonb))), 'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select sm_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert',
  (select jsonb_agg(r || '{"status":"approved"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-SM'))), 'approveRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select sm_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.wo')::jsonb))), 'createOrder');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select sm_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert',
  (select jsonb_agg(w || '{"status":"released"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-SMU'))), 'setOrderStatus');
reset role;
update public.rf_orders set status = 'in_progress' where is_test and wo_no = 'WO-SMU';
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, qc, transferred_qty) values (true, 'CU-SM1', 'curing', 'WO-SMU', 'pcs', 60, 'pass', 60);
insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent, remaining, status) values
  (true, 'TR-SM1', 'CU-SM1', 'WO-SMU', 'curing', 'finishing', 'pcs', 40, 0, 'in_transit'),
  (true, 'TR-SM2', 'CU-SM1', 'WO-SMU', 'curing', 'finishing', 'pcs', 20, 0, 'in_transit');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select sm_t.receive_tr('TR-SM1') $$, 'RF_FORBIDDEN', 'SR staff no longer receive a WIP transfer between RB stations');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select sm_t.receive_tr('TR-SM1') $$, 'RF_FORBIDDEN', 'nor do WH staff');
select is((select x ->> 'status' from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = 'TR-SM1'), 'in_transit', 'the refused receipts changed nothing');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.res', sm_t.receive_tr('TR-SM1')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'transfers' -> 'upsert' -> 0 ->> 'status', 'received', 'an RB member receives the WIP transfer');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'transfers' -> 'upsert' -> 0 ->> 'receivedBy', current_setting('test.n_sbx_rb_staff'), 'the receiver is the RB persona');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(sm_t.receive_tr('TR-SM2') -> 'changes' -> 'transfers' -> 'upsert' -> 0 ->> 'status', 'received', 'a planner receives a transfer too');

-- 12. ชุดเรคอร์ด -----------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(sm_t.lot('OP-1')) k),
  array['createdAt', 'decidedAt', 'decidedBy', 'decision', 'decisionNote', 'id', 'itemCode', 'jobNo', 'location', 'lotNo', 'orderId', 'qc', 'qtyReceived', 'qtySent',
        'receivedAt', 'receivedBy', 'recipeCode', 'source', 'sourceNote', 'spec', 'status', 'uom', 'woNo'],
  'an opening lot has the twenty-three fields of every rod lot');
select is(public.app_bom_master_since(0) -> 'changes' -> 'rodLots', jsonb_build_object('upsert', public.app_bom_master() -> 'rodLots', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the snapshot for the rod lots (opening lots included)');
select ok(sm_t.lot('OP-REAL-1') is null, 'test mode never sees the real opening lot');

select * from finish();
rollback;
