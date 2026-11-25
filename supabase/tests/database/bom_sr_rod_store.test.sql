-- คลังแท่งยาว SR (ขั้น 05-06) ของ BOM โหมดทดสอบ (20261202010000_bom_sr_rod_store.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง / สิทธิ์ของ bom_rod_lots และ bom_rod_moves, รายการ action, ล็อตตกแต่งของ WO ที่ผูกงาน BOM เป็นแท่งรอรับ (ไม่มีกล่อง
-- ไม่ป้อนยอดให้งานตอนตกแต่ง) WO ที่ไม่ผูกงานยังมีกล่อง ล็อตที่ hold เกิดแท่งรอรับเมื่อ QA ตัดสิน pass (ครั้งเดียว) · receiveRods (SR / กลุ่มวางแผน ผ่าน = เครดิตงานและแยกส่วนเกิน
-- เข้าสต็อกกลาง ไม่ผ่าน = กัก) สเปกต้องตรงผลคำนวณ ล็อตไม่มีสเปกต้องมีผลของ SR · decideRods (หัวหน้า QA ตั้งแต่ 20261221010000) · issueRods (ยอดถัง ถังของใบอื่น ทั้งหมดหรือไม่เลย)
-- · reverseRodIssue (ย้อนครั้งเดียว) · adjustRods (SR / กลุ่มวางแผน ตั้งแต่ 20261204010000 · GR ไม่ได้) · ปล่อยผลิตหยิบสต็อกกลางล็อตเก่าก่อน (BOM_ROD_EXCEEDS) · เปิดกลับเป็นร่างคืน · ใบที่ปิดคืนถังเป็นสต็อกกลาง
-- · ชุด rodLots / rodMoves ใน snapshot / delta · audit · ล้างข้อมูลทดสอบ
-- ข้อควรระวัง: ถ้าอ่านตารางตรงในนาม authenticated จะเกิด 42501 และทำให้ทั้งไฟล์ล้ม ("No plan found") อ่านตารางด้วย reset role เท่านั้น
begin;
-- กฎการใช้งานจริงของไฟล์นี้ทดสอบเมื่อเปิดใช้จริงแล้ว: เปิดสวิตช์ในธุรกรรมของเทสต์ (rollback ท้ายไฟล์) · สวิตช์ปิดทดสอบใน bom_rf_sandbox_lock.test.sql
create or replace function private.bom_real_open() returns boolean language sql stable set search_path = '' as $$ select true $$;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้าง สิทธิ์ และรายการ action -------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c where c.oid in ('public.bom_rod_lots'::regclass, 'public.bom_rod_moves'::regclass) and c.relrowsecurity), 2::bigint,
  'both store tables have RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['public.bom_rod_lots', 'public.bom_rod_moves']) t(name),
                  unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, t.name, p.priv)),
  'anon and authenticated have no direct table privilege on the store tables');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.bom_rod_lots'::regclass and p.polname = 'bom_rod_lots_no_direct_access')
      and exists (select 1 from pg_policy p where p.polrelid = 'public.bom_rod_moves'::regclass and p.polname = 'bom_rod_moves_no_direct_access'),
  'both store tables have the deny-all policy');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.bom_rod_lots'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive)
      and exists (select 1 from pg_policy p where p.polrelid = 'public.bom_rod_moves'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive),
  'both store tables have the restrictive lab_only_no_access policy');
select is((select count(*) from pg_trigger g
           where g.tgrelid in ('public.bom_rod_lots'::regclass, 'public.bom_rod_moves'::regclass) and not g.tgisinternal
             and g.tgname in ('bom_rod_lots_sandbox_scope', 'bom_rod_lots_stamp_version', 'bom_rod_moves_sandbox_scope', 'bom_rod_moves_stamp_version')), 4::bigint,
  'both store tables enforce sandbox scope and stamp changed_version by trigger');
select ok('bom_rod_lots' = any (private.sandbox_unguarded_tables()) and 'bom_rod_moves' = any (private.sandbox_unguarded_tables())
          and 'bom_fg_moves' = any (private.sandbox_unguarded_tables()) and 'client_error_logs' = any (private.sandbox_unguarded_tables())
          and 'ncr_reports' = any (private.sandbox_unguarded_tables()),
  'the store tables are registered as sandbox aware and the redefined list keeps the earlier tables');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_rod_lots'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(order_pk, is_test) REFERENCES %bom_orders(id, is_test)%')
      and exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_rod_moves'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(lot_id, is_test) REFERENCES %bom_rod_lots(id, is_test)%')
      and exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_rod_moves'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(owner_order_pk, is_test) REFERENCES %bom_orders(id, is_test)%')
      and exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_rod_moves'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(reverses_id, is_test) REFERENCES %bom_rod_moves(id, is_test)%'),
  'lots and moves reference orders, lots and the reversed move with foreign keys paired with is_test');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bom_rod_moves_reverses_idx' and indexdef like 'CREATE UNIQUE INDEX%'),
  'a move can be reversed only once (unique index on reverses_id)');
select ok(array['receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue', 'adjustRods'] <@ private.bom_client_actions()
          and array['receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue', 'adjustRods'] <@ private.bom_staff_actions(),
  'the five store actions are on the client and the staff lists (SR adjusts since 20261204010000)');
select ok(array['receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg', 'releaseOrder', 'reportJob', 'issueOrderParts'] <@ private.bom_client_actions()
          and array['receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reportJob', 'issueOrderParts'] <@ private.bom_staff_actions()
          and not ('reverseFg' = any (private.bom_staff_actions())),
  'the earlier actions are still on the lists');
select is((select count(*)::integer from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'bom\_rod\_%'), 10, 'the ten store helpers exist');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.pronamespace = 'private'::regnamespace and p.proname like 'bom\_rod\_%'),
  'every store helper is security definer with an empty search_path');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure,
                           'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure, 'private.bom_delta(bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure, 'public.app_sandbox_purge_bom()'::regprocedure,
                           'private.bom_can_read(public.employees)'::regprocedure)),
  'the replaced functions are still security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and (p.proname like 'bom\_rod\_%' or p.proname in ('bom_client_actions', 'bom_staff_actions', 'bom_can_read', 'sandbox_unguarded_tables'))
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the store helpers or the redefined lists directly');
select ok(not exists (select 1 from unnest(array['public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)',
                                                 'public.app_sandbox_purge_bom()']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the replaced RPCs keep their grants (signed-in users only)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(position('bom_rod_moves' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0
      and position('bom_rod_lots' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0
      and position('request.jwt.claims' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0,
  'the BOM purge deletes the store tables and still sets the JWT claims aside');

-- 2. บัญชีทดสอบ ---------------------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8eb00000-0000-0000-0000-000000000001', 'srstore-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8eb00000-0000-0000-0000-000000000101', 'SRSTORE-ADMIN', 'Srstore', 'Admin', 'srstore-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8eb00000-0000-0000-0000-000000000001');
-- persona ผู้ดูแลระบบ (ไม่มี persona บทบาท admin ในชุดตั้งต้น)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-SR-STAFF' and d.code = 'SR' and r.code = 'staff')
                                or (e.employee_no = 'SBX-QA-STAFF' and d.code = 'QA' and r.code = 'staff')
                                or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB') or (e.employee_no = 'SBX-GR-STAFF' and d.code = 'GR')
                                or (e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-RB-MGR' and d.code = 'RB' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-ADMIN-T' and r.code = 'admin'))), 8,
  'the personas used below belong to the departments and roles the rules name');
select ok((select not private.bom_can_edit(e) and private.bom_can_read(e) from public.employees e where e.employee_no = 'SBX-SR-STAFF')
      and (select not private.bom_can_edit(e) and private.bom_can_read(e) from public.employees e where e.employee_no = 'SBX-QA-STAFF'),
  'SR and QA staff read BOM (new read rule) and are not planners');

-- 3. ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรง: โหมดทดสอบต้องมองไม่เห็นและ purge ไม่แตะ · ใช้ตรวจข้อจำกัดของตาราง (ยังไม่มี claims จึง auth.uid() เป็น null) ----------
insert into public.bom_orders (pi_no, customer, country, order_type, ordered_at, wh_due) values ('REAL-SR-PI', 'ลูกค้าจริง', 'TH', 'SA', 1762300000000, 1762400000000);
insert into public.bom_rod_lots (lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, status, qty_received, qc, received_at)
select 'FN-REAL-1', 'REAL-RB', o.id, 'REAL-JOB', 'REAL-WO', 'REAL-RC', 'pcs', 10, 'stored', 10, '{"values":{},"result":"pass","note":""}'::jsonb, now()
from public.bom_orders o where not o.is_test and o.pi_no = 'REAL-SR-PI';
insert into public.bom_rod_moves (lot_id, item_code, kind, qty) select l.id, 'REAL-RB', 'receive', 10 from public.bom_rod_lots l where not l.is_test and l.lot_no = 'FN-REAL-1';
select is((select count(*) from public.bom_rod_moves where not is_test), 1::bigint, 'the real move was inserted as a real (non-test) row');

select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, status, qty_received, qc, received_at)
  select 'FN-BAD-1', 'X', o.id, 'J', 'W', 'R', 'pcs', 5, 'stored', 6, '{}'::jsonb, now() from public.bom_orders o where o.pi_no = 'REAL-SR-PI' $$,
  '23514', null, 'more received than sent is refused by the table');
select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, qty_received)
  select 'FN-BAD-2', 'X', o.id, 'J', 'W', 'R', 'pcs', 5, 5 from public.bom_orders o where o.pi_no = 'REAL-SR-PI' $$,
  '23514', null, 'a pending lot carries no receipt');
select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, status)
  select 'FN-BAD-3', 'X', o.id, 'J', 'W', 'R', 'pcs', 5, 'lost' from public.bom_orders o where o.pi_no = 'REAL-SR-PI' $$,
  '23514', null, 'an unknown lot status is refused');
select throws_ok($$ insert into public.bom_rod_lots (lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent)
  select 'FN-REAL-1', 'X', o.id, 'J', 'W', 'R', 'pcs', 5 from public.bom_orders o where o.pi_no = 'REAL-SR-PI' $$,
  '23505', null, 'a finishing lot becomes at most one rod lot per mode');
select throws_ok($$ insert into public.bom_rod_moves (lot_id, item_code, kind, qty) select l.id, 'REAL-RB', 'receive', 0 from public.bom_rod_lots l where l.lot_no = 'FN-REAL-1' $$,
  '23514', null, 'a move of zero is refused');
select throws_ok($$ insert into public.bom_rod_moves (lot_id, item_code, kind, qty, for_order_pk)
  select l.id, 'REAL-RB', 'issue', 1, l.order_pk from public.bom_rod_lots l where l.lot_no = 'FN-REAL-1' $$,
  '23514', null, 'an issue takes rods out (negative)');
select throws_ok($$ insert into public.bom_rod_moves (lot_id, item_code, kind, qty, for_order_pk, note)
  select l.id, 'REAL-RB', 'unissue', 1, l.order_pk, 'ย้อนจ่าย' from public.bom_rod_lots l where l.lot_no = 'FN-REAL-1' $$,
  '23514', null, 'a reversal names the issue it reverses');
select throws_ok($$ insert into public.bom_rod_moves (lot_id, item_code, kind, qty, owner_order_pk, note)
  select l.id, 'REAL-RB', 'adjust', -1, l.order_pk, 'ปรับยอด' from public.bom_rod_lots l where l.lot_no = 'FN-REAL-1' $$,
  '23514', null, 'an adjustment changes the free stock only');
select throws_ok($$ insert into public.bom_rod_moves (lot_id, item_code, kind, qty, note)
  select l.id, 'REAL-RB', 'adjust', -1, 'ab' from public.bom_rod_lots l where l.lot_no = 'FN-REAL-1' $$,
  '23514', null, 'an adjustment needs a reason of three characters');
select throws_ok($$ insert into public.bom_rod_moves (is_test, lot_id, item_code, kind, qty) select true, l.id, 'REAL-RB', 'receive', 1 from public.bom_rod_lots l where l.lot_no = 'FN-REAL-1' $$,
  '23503', null, 'a test-mode move cannot point at a real lot (the foreign key is paired with is_test)');

-- 4. ตัวช่วยของเทสต์ (schema แยก ลบพร้อม rollback): รันในฐานะผู้เรียก (authenticated) ผ่าน RPC สาธารณะเท่านั้น -------------------------------
create schema sr_t;
grant usage on schema sr_t to authenticated;
create function sr_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function sr_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, sr_t.ver(), p_action)
$$;
create function sr_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, (public.app_rf_master() ->> 'version')::bigint, p_action)
$$;
create function sr_t.lot(p_no text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'lotNo' = p_no
$$;
create function sr_t.lot_id(p_no text) returns text language sql stable as $$ select sr_t.lot(p_no) ->> 'id' $$;
create function sr_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
create function sr_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
-- ยอดของถัง (ล็อต, เลข PI เจ้าของ | null = สต็อกกลาง) จากชุด rodMoves ที่ client อ่าน
create function sr_t.bal(p_lot text, p_owner text) returns numeric language sql stable as $$
  select coalesce(sum((m ->> 'qty')::numeric), 0) from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m
  where m ->> 'lotId' = sr_t.lot_id(p_lot) and (m ->> 'ownerOrderId') is not distinct from p_owner
$$;
create function sr_t.nmoves() returns integer language sql stable as $$ select jsonb_array_length(public.app_bom_master() -> 'rodMoves') $$;
create function sr_t.audit() returns text language sql stable as $$ select public.app_bom_audit(1) -> 0 ->> 'detail' $$;
create function sr_t.receive(p_no text, p_qty numeric, p_values jsonb, p_result text, p_note text) returns jsonb language sql volatile as $$
  select sr_t.save(jsonb_build_object('rodLots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'id', sr_t.lot_id(p_no), 'qtyReceived', p_qty, 'location', 'A-01', 'qc', jsonb_build_object('values', p_values, 'result', p_result, 'note', p_note))))), 'receiveRods')
$$;
create function sr_t.decide(p_no text, p_decision text, p_note text) returns jsonb language sql volatile as $$
  select sr_t.save(jsonb_build_object('rodLots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'id', sr_t.lot_id(p_no), 'decision', p_decision, 'decisionNote', p_note)))), 'decideRods')
$$;
create function sr_t.issue_row(p_id text, p_lot text, p_owner text, p_for text, p_qty numeric) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p_id, 'kind', 'issue', 'lotId', sr_t.lot_id(p_lot), 'ownerOrderId', p_owner, 'forOrderId', p_for, 'itemCode', 'RB-A', 'qty', p_qty)
$$;
create function sr_t.moves(p_rows jsonb, p_action text) returns jsonb language sql volatile as $$
  select sr_t.save(jsonb_build_object('rodMoves', jsonb_build_object('upsert', p_rows)), p_action)
$$;
create function sr_t.release(p_no text, p_extra jsonb, p_jobs jsonb) returns jsonb language sql volatile as $$
  select sr_t.save(jsonb_build_object(
    'orders', jsonb_build_object('upsert', jsonb_build_array(sr_t.order_row(p_no) || p_extra || '{"status":"released"}'::jsonb)),
    'jobs', jsonb_build_object('upsert', p_jobs)), 'releaseOrder')
$$;
-- นิยามฝั่งเซิร์ฟเวอร์ (private.* เรียกจาก authenticated ไม่ได้): security definer ของเจ้าของ schema เทสต์ อ่านอย่างเดียว
create function sr_t.free(p_code text) returns numeric language sql stable security definer set search_path = '' as $$
  select private.bom_rod_free(p_code)
$$;
create function sr_t.owned(p_no text, p_code text) returns numeric language sql stable security definer set search_path = '' as $$
  select private.bom_rod_owned((select o.id from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = p_no), p_code)
$$;

-- 5. ข้อมูลตั้งต้น: สูตรมีสเปก (RC-S) / ไม่มีสเปก (RC-N) · ใบ PI สามใบ (25001, 25002 ปล่อยผลิต · 25003 ร่าง) · WO ผูกงานสองใบ ไม่ผูกหนึ่งใบ ------------------
select set_config('request.jwt.claims', '{"sub":"8eb00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select set_config('test.rec', '{"id":"RC-S","revision":1,"productCode":"P-1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":50,"stage":1},{"materialCode":"MAT-C","phr":10,"stage":2}],"status":"draft"}', true);
select set_config('test.spec', '{"thickness":{"target":2.5,"tol":0.12},"width":{"target":18,"tol":0.25},"weightPerM":{"target":160,"tol":6}}', true);
select set_config('test.wo', '{"id":"X","customer":"ACME","customerPo":"PO-1","recipeId":"RC-S","recipeRevision":1,"color":"ดำ","targetQty":1000,"targetKg":17.5,"kgPerUnit":0.125,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);
select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}],"explosion":[{"itemCode":"FG-A","kind":"FG","level":0,"fgQty":10,"required":10},{"itemCode":"SE-A","kind":"SE","level":1,"fgQty":10,"required":20},{"itemCode":"RB-A","kind":"RB","level":2,"fgQty":10,"required":40}],"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"RB","itemCode":"RB-A","name":"งานทดสอบ","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select set_config('test.fn', '{"id":"X","stage":"finishing","orderId":"X","uom":"pcs","shift":"E","grade":"A","sources":[],"params":{},"goodQty":0,"scrapQty":0,"scrapReason":"","qc":"pass"}', true);
select set_config('test.qc', '{"id":"X","lotId":"X","orderId":"WO-S1","stage":"finishing","tests":[{"key":"hardness","value":65,"pass":true},{"key":"tensile","value":12,"pass":true},{"key":"elongation","value":380,"pass":true},{"key":"sg","value":1.18,"pass":true},{"key":"t90","value":3.2,"pass":true}],"result":"pass","note":"","inspector":"x","at":1}', true);
select set_config('test.pass', '{"thickness":2.55,"width":18.1,"weightPerM":158}', true);
select set_config('test.thick', '{"thickness":3,"width":18,"weightPerM":160}', true);

select sr_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ"}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"MAT-C","name":"สารตัวเร่ง"}'::jsonb))), 'saveMaterial');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select sr_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || jsonb_build_object('extrusionSpec', current_setting('test.spec')::jsonb),
  current_setting('test.rec')::jsonb || '{"id":"RC-N","productCode":"P-2"}'::jsonb))), 'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select sr_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert',
  (select jsonb_agg(r || '{"status":"approved"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' in ('RC-S', 'RC-N')))), 'approveRecipe');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'status' = 'approved'), 2, 'both recipes are approved');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select sr_t.save('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-A","kind":"RB","name":"เส้นยาง A","ownerDept":"RB","uom":"pcs"}]}}'::jsonb, 'importFlat');
select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251202-25001"}'::jsonb,
  current_setting('test.ord')::jsonb || '{"id":"251202-25002"}'::jsonb,
  current_setting('test.ord')::jsonb || '{"id":"251202-25003"}'::jsonb))), 'createOrder');
select sr_t.release('251202-25001', '{}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-1-RB","orderId":"251202-25001"}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-1-GR","orderId":"251202-25001","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-1-PK","orderId":"251202-25001","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb));
select sr_t.release('251202-25002', '{}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-2-RB","orderId":"251202-25002","qtyPlanned":50,"qtyRequired":50}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-2-GR","orderId":"251202-25002","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-2-PK","orderId":"251202-25002","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb));
select is(sr_t.order_row('251202-25001') ->> 'status' || '/' || (sr_t.order_row('251202-25002') ->> 'status') || '/' || (sr_t.order_row('251202-25003') ->> 'status'),
  'released/released/draft', 'two orders are released and the third stays a draft');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select sr_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-S1","sourceJobId":"JOB-1-RB"}'::jsonb,
  current_setting('test.wo')::jsonb || '{"id":"WO-N1","recipeId":"RC-N","sourceJobId":"JOB-2-RB"}'::jsonb,
  current_setting('test.wo')::jsonb || '{"id":"WO-U"}'::jsonb))), 'createOrder');
select is((sr_t.job('JOB-1-RB') -> 'externalRef' ->> 'woId') || '/' || (sr_t.job('JOB-2-RB') -> 'externalRef' ->> 'woId'), 'WO-S1/WO-N1',
  'WO-S1 and WO-N1 are linked to the RB jobs (WO-U is a work order for sale)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select sr_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert',
  (select jsonb_agg(w || '{"status":"released"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' in ('WO-S1', 'WO-N1', 'WO-U')))), 'setOrderStatus');

-- ล็อตอบและใบส่งมอบไปตกแต่ง ใส่ตรง (ข้ามสายผสม-ฉีด) · WO ทั้งสามเดินอยู่แล้ว
reset role;
update public.rf_orders set status = 'in_progress' where is_test and wo_no in ('WO-S1', 'WO-N1', 'WO-U');
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, qc, transferred_qty) values
  (true, 'CU-S1', 'curing', 'WO-S1', 'pcs', 175, 'pass', 175),
  (true, 'CU-N1', 'curing', 'WO-N1', 'pcs', 40, 'pass', 40),
  (true, 'CU-U1', 'curing', 'WO-U', 'pcs', 40, 'pass', 40);
insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent, remaining, status) values
  (true, 'TR-S1', 'CU-S1', 'WO-S1', 'curing', 'finishing', 'pcs', 175, 0, 'in_transit'),
  (true, 'TR-N1', 'CU-N1', 'WO-N1', 'curing', 'finishing', 'pcs', 40, 0, 'in_transit'),
  (true, 'TR-U1', 'CU-U1', 'WO-U', 'curing', 'finishing', 'pcs', 40, 0, 'in_transit');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select sr_t.rf(jsonb_build_object('transfers', jsonb_build_object('upsert',
  (select jsonb_agg(x || jsonb_build_object('status', 'received', 'qtyReceived', (x ->> 'qtySent')::numeric))
   from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' in ('TR-S1', 'TR-N1', 'TR-U1')))), 'receiveTransfer');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'status' = 'received'), 3, 'the three transfers reached finishing');

-- 6. RubberFlow: ล็อตตกแต่งของ WO ที่ผูกงาน = แท่งรอรับเข้าคลัง SR ไม่มีกล่อง ไม่ป้อนยอดให้งาน ---------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.bv0', sr_t.ver()::text, true);
select set_config('test.res', sr_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.fn')::jsonb || '{"id":"FN-S1","orderId":"WO-S1","goodQty":120,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-S1","lotId":"CU-S1","qty":120}]}'::jsonb))),
  'recordFinishing')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'lots' -> 'upsert' -> 0 ->> 'boxes', '0', 'a finishing lot of a work order linked to a BOM job makes no boxes');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'fgBoxes') b where b ->> 'lotId' = 'FN-S1'), 0,
  'so no ready-to-ship box exists for the internal rods (retest finding N8)');
select is(sr_t.lot('FN-S1') ->> 'status', 'pending', 'the passed lot becomes a pending rod lot of the SR store');
select is((sr_t.lot('FN-S1') ->> 'qtySent')::numeric, 120::numeric, 'with the good quantity of the finishing lot');
select is(sr_t.lot('FN-S1') -> 'spec', current_setting('test.spec')::jsonb, 'and the dimension spec of the recipe revision of the work order');
select is((sr_t.lot('FN-S1') ->> 'itemCode') || '/' || (sr_t.lot('FN-S1') ->> 'orderId') || '/' || (sr_t.lot('FN-S1') ->> 'jobNo') || '/' || (sr_t.lot('FN-S1') ->> 'woNo')
          || '/' || (sr_t.lot('FN-S1') ->> 'recipeCode') || '/' || (sr_t.lot('FN-S1') ->> 'uom'),
  'RB-A/251202-25001/JOB-1-RB/WO-S1/RC-S/pcs', 'traced to the RB code, the order, the job, the work order and the recipe');
select ok(sr_t.lot('FN-S1') -> 'qtyReceived' = 'null'::jsonb and sr_t.lot('FN-S1') -> 'qc' = 'null'::jsonb and sr_t.lot('FN-S1') -> 'receivedBy' = 'null'::jsonb,
  'a pending lot has no receipt yet (null fields)');
select is((sr_t.job('JOB-1-RB') ->> 'qtyDone')::numeric, 0::numeric, 'the RB job is no longer counted at finishing');
select is(jsonb_array_length(sr_t.job('JOB-1-RB') -> 'reports'), 0, 'and gets no report entry');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-S1'), '120',
  'the progress of the work order is still counted');
select is(sr_t.ver(), current_setting('test.bv0')::bigint + 1, 'the BOM counter moves once for the new rod lot');
select is((select a ->> 'detail' from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:recordFinishing' limit 1), 'rodLots +1',
  'the BOM history counts the rod lot');
reset role;
select is((select (metadata ->> 'bom_rod_lots')::integer from public.audit_logs where action = 'RF_SAVE' and entity_type = 'rf_master'
           and entity_id = (current_setting('test.res')::jsonb ->> 'version')), 1, 'the RubberFlow audit row counts the rod lot it made');
set local role authenticated;
select is(public.app_bom_master_since(current_setting('test.bv0')::bigint) -> 'changes' -> 'rodLots' -> 'upsert' -> 0 ->> 'lotNo', 'FN-S1',
  'a BOM client catches up on the new rod lot with the normal delta');

-- ล็อตที่ hold: ยังไม่เป็นแท่งรอรับ จน QA ตัดสิน pass (ครั้งเดียว)
select set_config('test.bv1', sr_t.ver()::text, true);
select sr_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.fn')::jsonb || '{"id":"FN-S2","orderId":"WO-S1","qc":"hold","goodQty":30,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-S1","lotId":"CU-S1","qty":30}]}'::jsonb))),
  'recordFinishing');
select ok(sr_t.lot('FN-S2') is null, 'a finishing lot on hold makes no rod lot');
select is(sr_t.ver(), current_setting('test.bv1')::bigint, 'and does not move the BOM counter');
-- ปล่อยล็อตที่กัก = หัวหน้า QA เท่านั้น (20261221010000_qa_head_decisions.sql · qa_head_decisions.test.sql)
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select sr_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.qc')::jsonb || '{"id":"QC-S1","lotId":"FN-S2","result":"pass"}'::jsonb))), 'addQcRecord');
select is(sr_t.lot('FN-S2') ->> 'status' || '/' || (sr_t.lot('FN-S2') ->> 'qtySent'), 'pending/30', 'QA passing the held lot makes the pending rod lot');
select is(sr_t.ver(), current_setting('test.bv1')::bigint + 1, 'with one BOM counter step');
select sr_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.qc')::jsonb || '{"id":"QC-S2","lotId":"FN-S2","result":"hold"}'::jsonb))), 'addQcRecord');
select sr_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.qc')::jsonb || '{"id":"QC-S3","lotId":"FN-S2","result":"pass"}'::jsonb))), 'addQcRecord');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'lotNo' = 'FN-S2'), 1,
  'a later pass of the same lot does not make a second rod lot');
select is(sr_t.ver(), current_setting('test.bv1')::bigint + 1, 'and does not move the BOM counter again');

-- WO ที่ผูกงานของสูตรไม่มีสเปก (perBox ไม่ต้องส่ง) · WO ขายเป็นสินค้า (ไม่ผูกงาน) ยังมีกล่องเหมือนเดิม
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select sr_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.fn')::jsonb || '{"id":"FN-N1","orderId":"WO-N1","goodQty":40,"sources":[{"type":"transfer","id":"TR-N1","lotId":"CU-N1","qty":40}]}'::jsonb))),
  'recordFinishing');
select is(sr_t.lot('FN-N1') ->> 'status', 'pending', 'a linked work order without perBox records its finishing lot');
select is(sr_t.lot('FN-N1') -> 'spec', 'null'::jsonb, 'a recipe without a dimension spec gives a rod lot without spec');
-- งานที่ผูก WO อื่นอยู่ (external_ref.woId ไม่ใช่ WO นี้) = ไม่สร้างล็อตแท่ง (เหมือน rf_apply_feedback เดิม) · ตั้งตรงชั่วคราวแล้วคืนค่า
reset role;
update public.bom_jobs set external_ref = external_ref || '{"woId":"WO-OTHER"}'::jsonb where is_test and job_no = 'JOB-2-RB';
update public.bom_master_state set version = version + 1 where is_test;
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, qc, transferred_qty) values (true, 'CU-N2', 'curing', 'WO-N1', 'pcs', 10, 'pass', 10);
insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent, remaining, status) values
  (true, 'TR-N2', 'CU-N2', 'WO-N1', 'curing', 'finishing', 'pcs', 10, 0, 'in_transit');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select sr_t.rf(jsonb_build_object('transfers', jsonb_build_object('upsert',
  (select jsonb_agg(x || jsonb_build_object('status', 'received', 'qtyReceived', (x ->> 'qtySent')::numeric))
   from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = 'TR-N2'))), 'receiveTransfer');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.bv4', sr_t.ver()::text, true);
select lives_ok($$ select sr_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.fn')::jsonb || '{"id":"FN-N2","orderId":"WO-N1","goodQty":10,"sources":[{"type":"transfer","id":"TR-N2","lotId":"CU-N2","qty":10}]}'::jsonb))),
  'recordFinishing') $$, 'a finishing lot of a work order whose job now points at another work order is recorded');
select ok(sr_t.lot('FN-N2') is null, 'a job linked to another WO gets no rod lot');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'fgBoxes') b where b ->> 'lotId' = 'FN-N2'), 0,
  'the work order still points at a BOM job, so the lot makes no boxes either');
select is(sr_t.ver(), current_setting('test.bv4')::bigint, 'and the BOM counter does not move');
reset role;
update public.bom_jobs set external_ref = external_ref || '{"woId":"WO-N1"}'::jsonb where is_test and job_no = 'JOB-2-RB';
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select sr_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.fn')::jsonb || '{"id":"FN-U0","orderId":"WO-U","goodQty":40,"sources":[{"type":"transfer","id":"TR-U1","lotId":"CU-U1","qty":40}]}'::jsonb))),
  'recordFinishing') $$, 'RF_INVALID_LOT', 'a work order for sale still needs perBox');
select set_config('test.bv2', sr_t.ver()::text, true);
select sr_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.fn')::jsonb || '{"id":"FN-U1","orderId":"WO-U","goodQty":40,"params":{"perBox":20},"sources":[{"type":"transfer","id":"TR-U1","lotId":"CU-U1","qty":40}]}'::jsonb))),
  'recordFinishing');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'fgBoxes') b where b ->> 'lotId' = 'FN-U1' and b ->> 'status' = 'pending_wh'), 2,
  'a work order sold as finished goods keeps its boxes (waiting for the WH receipt since 20261207010000)');
select ok(sr_t.lot('FN-U1') is null, 'and makes no rod lot');
select is(sr_t.ver(), current_setting('test.bv2')::bigint, 'nor moves the BOM counter');
select sr_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.fn')::jsonb || '{"id":"FN-S3","orderId":"WO-S1","goodQty":10,"sources":[{"type":"transfer","id":"TR-S1","lotId":"CU-S1","qty":10}]}'::jsonb,
  current_setting('test.fn')::jsonb || '{"id":"FN-S4","orderId":"WO-S1","goodQty":5,"sources":[{"type":"transfer","id":"TR-S1","lotId":"CU-S1","qty":5}]}'::jsonb,
  current_setting('test.fn')::jsonb || '{"id":"FN-S5","orderId":"WO-S1","goodQty":5,"sources":[{"type":"transfer","id":"TR-S1","lotId":"CU-S1","qty":5}]}'::jsonb,
  current_setting('test.fn')::jsonb || '{"id":"FN-S6","orderId":"WO-S1","goodQty":5,"sources":[{"type":"transfer","id":"TR-S1","lotId":"CU-S1","qty":5}]}'::jsonb))),
  'recordFinishing');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'status' = 'pending'), 7,
  'seven rod lots wait for SR (FN-S1 to FN-S6 and FN-N1)');

-- 7. receiveRods: ปฏิเสธ (สิทธิ์ รูปแถว สเปก) ------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.pass')::jsonb, 'pass', '') $$, 'BOM_FORBIDDEN', 'RB staff cannot receive rods into the SR store');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.pass')::jsonb, 'pass', '') $$, 'BOM_FORBIDDEN', 'GR staff cannot receive rods');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.pass')::jsonb, 'pass', '') $$, 'BOM_FORBIDDEN', 'WH staff cannot receive rods');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.pass')::jsonb, 'pass', '') $$, 'BOM_FORBIDDEN', 'QA staff cannot receive rods (QA decides held lots)');
select is(sr_t.lot('FN-S1') ->> 'status', 'pending', 'the refused receipts changed nothing');

select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select sr_t.receive('FN-S1', 0, current_setting('test.pass')::jsonb, 'pass', '') $$, 'BOM_INVALID_ROD', 'a receipt of zero rods is refused');
select throws_ok($$ select sr_t.receive('FN-S1', 121, current_setting('test.pass')::jsonb, 'pass', '') $$, 'BOM_INVALID_ROD', 'more than the finishing lot sent is refused');
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.pass')::jsonb, 'fail', 'ไม่ผ่านจริงหรือ') $$, 'BOM_INVALID_ROD',
  'a result that differs from the computed verdict is refused (values in spec, result fail)');
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.thick')::jsonb, 'pass', '') $$, 'BOM_INVALID_ROD',
  'a pass with a value out of spec is refused');
select throws_ok($$ select sr_t.receive('FN-S1', 120, '{"thickness":2.5,"width":18}'::jsonb, 'pass', '') $$, 'BOM_INVALID_ROD', 'every key of the spec needs a value');
select throws_ok($$ select sr_t.receive('FN-S1', 120, '{"thickness":2.5,"width":18,"weightPerM":160,"hardness":60}'::jsonb, 'pass', '') $$, 'BOM_INVALID_ROD',
  'an unknown measurement is refused');
select throws_ok($$ select sr_t.receive('FN-S1', 120, '{"thickness":-2.5,"width":18,"weightPerM":160}'::jsonb, 'pass', '') $$, 'BOM_INVALID_ROD', 'a negative measurement is refused');
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.pass')::jsonb, 'maybe', '') $$, 'BOM_INVALID_ROD', 'an unknown result is refused');
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.thick')::jsonb, 'fail', 'ab') $$, 'BOM_INVALID_ROD', 'a failed receipt needs a note of three characters');
select throws_ok($$ select sr_t.save(jsonb_build_object('rodLots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'id', '00000000-0000-4000-8000-0000000000ff', 'qtyReceived', 1, 'location', 'A-01', 'qc', '{"values":{},"result":"pass","note":""}'::jsonb)))), 'receiveRods') $$,
  'BOM_INVALID_ROD', 'an unknown lot is refused');
select throws_ok($$ select sr_t.save(jsonb_build_object('rodLots', jsonb_build_object('upsert', jsonb_build_array(
  jsonb_build_object('id', sr_t.lot_id('FN-S1'), 'qtyReceived', 1, 'location', 'A-01', 'qc', '{"values":{},"result":"pass","note":""}'::jsonb),
  jsonb_build_object('id', sr_t.lot_id('FN-N1'), 'qtyReceived', 1, 'location', 'A-01', 'qc', '{"values":{},"result":"pass","note":""}'::jsonb)))), 'receiveRods') $$,
  'BOM_INVALID_ROD', 'one lot per receipt');
select throws_ok($$ select sr_t.save('{"rodLots":{"upsert":[]}}'::jsonb, 'receiveRods') $$, 'BOM_INVALID_ROD', 'an empty request list is refused');
select throws_ok($$ select sr_t.save(jsonb_build_object('rodLots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('id', sr_t.lot_id('FN-S1'))))), 'issueRods') $$,
  'BOM_INVALID_ROD', 'the lot section goes with receiveRods / decideRods only');
select throws_ok($$ select sr_t.save(jsonb_build_object('rodLots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('id', sr_t.lot_id('FN-S1'))))), 'reportJob') $$,
  'BOM_INVALID_ROD', 'and not with another staff action');
select throws_ok($$ select sr_t.save('{"rodLots":{"delete":[]}}'::jsonb, 'receiveRods') $$, 'BOM_INVALID_PAYLOAD', 'the store sections have no delete list');
select is(sr_t.lot('FN-S1') ->> 'status', 'pending', 'and the refused calls changed nothing');

-- 8. receiveRods: ผ่าน = เครดิต (ส่วนที่งานยังต้องการเข้าถังของใบ ส่วนเกินเข้าสต็อกกลาง) ----------------------------------------------------------
select set_config('test.bv3', sr_t.ver()::text, true);
select set_config('test.res', sr_t.receive('FN-S1', 120, current_setting('test.pass')::jsonb, 'pass', '')::text, true);
select is(sr_t.lot('FN-S1') ->> 'status', 'stored', 'SR receives a lot that passes: it is stored');
select is((sr_t.lot('FN-S1') ->> 'qtyReceived')::numeric, 120::numeric, 'with the received quantity');
select is(sr_t.lot('FN-S1') -> 'qc', '{"values":{"thickness":2.55,"width":18.1,"weightPerM":158},"result":"pass","note":""}'::jsonb, 'and the measured QC');
select is(sr_t.lot('FN-S1') ->> 'receivedBy', current_setting('test.n_sbx_sr_staff'), 'the receiver is the persona');
select ok(sr_t.lot('FN-S1') ->> 'receivedAt' is not null, 'the receipt time is set by the server');
select is(sr_t.bal('FN-S1', '251202-25001'), 100::numeric, 'the job still needed 100 rods: they go to the bucket of the order');
select is(sr_t.bal('FN-S1', null), 20::numeric, 'the 20 beyond the need are free central stock');
select is((select count(*)::integer from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'rodMoves' -> 'upsert') m where m ->> 'kind' = 'receive'), 2,
  'two receive moves are written and returned');
select is((sr_t.job('JOB-1-RB') ->> 'qtyDone')::numeric, 120::numeric, 'the RB job counts the rods that entered the store');
select is(sr_t.job('JOB-1-RB') ->> 'status', 'done', 'and reaches its plan of 100');
select is((sr_t.job('JOB-1-RB') -> 'reports' -> -1) - 'at',
  jsonb_build_object('by', current_setting('test.n_sbx_sr_staff'), 'good', 120, 'reject', 0, 'note', 'รับเข้าคลัง SR ผ่านตรวจ ล็อต FN-S1 · เกิน 20 เข้าสต็อกกลาง'),
  'the report names SR, the lot and the surplus that went to central stock');
select is(sr_t.ver(), current_setting('test.bv3')::bigint + 1, 'one BOM counter step');
select is(sr_t.audit(), 'jobs +1, rodLots +1, rodMoves +2', 'the history counts the lot, the moves and the job');
select throws_ok($$ select sr_t.receive('FN-S1', 120, current_setting('test.pass')::jsonb, 'pass', '') $$, 'BOM_INVALID_TRANSITION', 'a stored lot cannot be received again');

-- ล็อตไม่มีสเปก: SR ต้องตัดสินด้วยตา
select throws_ok($$ select sr_t.receive('FN-N1', 40, '{}'::jsonb, null, '') $$, 'BOM_INVALID_ROD', 'a lot without a spec still needs the result of SR');
select lives_ok($$ select sr_t.receive('FN-N1', 40, '{}'::jsonb, 'pass', 'ดูด้วยตาแล้วผ่าน') $$, 'SR passes a lot without a spec by eye');
select is(sr_t.bal('FN-N1', '251202-25002'), 40::numeric, 'all 40 rods go to the bucket of the second order (its job needs 50)');
select is((sr_t.job('JOB-2-RB') ->> 'qtyDone') || '/' || (sr_t.job('JOB-2-RB') ->> 'status'), '40/in_progress', 'the job of the second order is fed and stays open');
select is(sr_t.audit(), 'jobs +1, rodLots +1, rodMoves +1', 'one move only (no surplus)');
-- รับไม่ครบที่ส่งมาได้ · งาน done แล้ว = ทั้งล็อตเข้าสต็อกกลาง งานไม่ถูกแตะ
select lives_ok($$ select sr_t.receive('FN-S2', 28, current_setting('test.pass')::jsonb, 'pass', 'ขาด 2 เส้น') $$, 'SR receives fewer rods than sent');
select is(sr_t.bal('FN-S2', null), 28::numeric, 'the job is done: every rod of the later lot is free central stock');
select is((sr_t.job('JOB-1-RB') ->> 'qtyDone')::numeric || '/' || jsonb_array_length(sr_t.job('JOB-1-RB') -> 'reports')::text, '120/1', 'and the finished job is untouched');
select is(sr_t.audit(), 'rodLots +1, rodMoves +1', 'the history has no job for it');

-- ไม่ผ่าน = กัก ไม่มีประวัติสต็อก ไม่มีเครดิต (กลุ่มวางแผนรับเข้าได้เหมือน SR)
select lives_ok($$ select sr_t.receive('FN-S3', 10, current_setting('test.thick')::jsonb, 'fail', 'หนาเกินสเปก') $$, 'SR records a failed receipt');
select is(sr_t.lot('FN-S3') ->> 'status', 'held', 'the failed lot is held');
select is(sr_t.lot('FN-S3') -> 'qc' ->> 'note', 'หนาเกินสเปก', 'with the note of SR');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m where m ->> 'lotId' = sr_t.lot_id('FN-S3')), 'a held lot has no stock move');
select is(sr_t.audit(), 'rodLots +1', 'and the history counts the lot only');
select lives_ok($$ select sr_t.receive('FN-S4', 5, current_setting('test.thick')::jsonb, 'fail', 'หนาเกินสเปก') $$, 'SR holds a second lot');
select lives_ok($$ select sr_t.receive('FN-S6', 5, current_setting('test.thick')::jsonb, 'fail', 'หนาเกินสเปก') $$, 'and a third');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sr_t.receive('FN-S5', 5, current_setting('test.thick')::jsonb, 'fail', 'หนาเกินสเปก') $$, 'a planner can receive too');
select is(sr_t.lot('FN-S5') ->> 'status', 'held', 'and the lot is held');

-- 9. decideRods: หัวหน้า QA ตัดสินล็อตที่กัก (20261221010000_qa_head_decisions.sql · เดิม QA ทุกบทบาทหรือกลุ่มวางแผน) ------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select sr_t.decide('FN-S3', 'accept', 'ใช้ตามสภาพ') $$, 'BOM_QA_HEAD_ONLY', 'SR cannot decide a held lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select sr_t.decide('FN-S3', 'accept', 'ใช้ตามสภาพ') $$, 'BOM_QA_HEAD_ONLY', 'RB staff cannot decide a held lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select sr_t.decide('FN-S3', 'accept', 'ab') $$, 'BOM_INVALID_ROD', 'a decision needs a note of three characters');
select throws_ok($$ select sr_t.decide('FN-S3', 'keep', 'ใช้ตามสภาพ') $$, 'BOM_INVALID_ROD', 'an unknown decision is refused');
select throws_ok($$ select sr_t.decide('FN-S3', 'accept', 'ใช้ตามสภาพ') $$, 'BOM_QA_HEAD_ONLY', 'QA staff cannot decide a held lot (QA head only)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select sr_t.decide('FN-S3', 'accept', 'ใช้ตามสภาพ') $$, 'BOM_QA_HEAD_ONLY', 'nor can a planner');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select throws_ok($$ select sr_t.decide('FN-S1', 'accept', 'ใช้ตามสภาพ') $$, 'BOM_INVALID_TRANSITION', 'a stored lot is not decided');
select throws_ok($$ select sr_t.decide('FN-N1', 'scrap', 'ทิ้งทั้งหมด') $$, 'BOM_INVALID_TRANSITION', 'nor is a lot that passed');
select lives_ok($$ select sr_t.decide('FN-S3', 'accept', 'ใช้ตามสภาพ') $$, 'the QA head accepts a held lot');
select is(sr_t.lot('FN-S3') ->> 'status' || '/' || (sr_t.lot('FN-S3') ->> 'decision') || '/' || (sr_t.lot('FN-S3') ->> 'decisionNote'), 'stored/accept/ใช้ตามสภาพ',
  'the accepted lot is stored with the decision');
select is(sr_t.lot('FN-S3') ->> 'decidedBy', current_setting('test.n_sbx_qa_mgr'), 'the decider is the persona');
select is(sr_t.bal('FN-S3', null), 10::numeric, 'an accepted lot is credited (the job is done: free central stock)');
select lives_ok($$ select sr_t.decide('FN-S4', 'return', 'ส่งคืน RB แก้ไข') $$, 'the QA head returns a held lot to RB');
select is(sr_t.lot('FN-S4') ->> 'status', 'returned', 'the lot is returned');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m where m ->> 'lotId' = sr_t.lot_id('FN-S4')), 'a returned lot has no stock move');
select throws_ok($$ select sr_t.decide('FN-S4', 'accept', 'ลองใหม่') $$, 'BOM_INVALID_TRANSITION', 'a decided lot cannot be decided again');
select lives_ok($$ select sr_t.decide('FN-S5', 'scrap', 'เสียหายทั้งล็อต') $$, 'the QA head scraps a held lot');
select is(sr_t.lot('FN-S5') ->> 'status', 'scrapped', 'the lot is scrapped');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m where m ->> 'lotId' = sr_t.lot_id('FN-S5')), 'a scrapped lot has no stock move');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select lives_ok($$ select sr_t.decide('FN-S6', 'return', 'ส่งคืน RB แก้ไข') $$, 'the factory manager decides instead of the QA head');
select is(sr_t.lot('FN-S6') ->> 'status' || '/' || (sr_t.lot('FN-S6') ->> 'decidedBy'), 'returned/' || current_setting('test.n_sbx_ft_fm'), 'the lot is returned by the factory manager');
select is(sr_t.free('RB-A'), 58::numeric, 'free central stock is 20 (FN-S1) + 28 (FN-S2) + 10 (FN-S3)');
select is(sr_t.owned('251202-25001', 'RB-A') || '/' || sr_t.owned('251202-25002', 'RB-A'), '100/40', 'and the order buckets hold 100 and 40');

-- 10. issueRods: SR จ่ายให้ GR ตามใบสั่งผลิต ----------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S1', '251202-25001', '251202-25001', -30)), 'issueRods') $$,
  'BOM_FORBIDDEN', 'GR staff cannot issue rods (SR does)');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select set_config('test.n0', sr_t.nmoves()::text, true);
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-N1', '251202-25002', '251202-25001', -5)), 'issueRods') $$,
  'BOM_INVALID_ROD', 'rods in the bucket of another open order cannot be issued for this order');
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S1', '251202-25001', '251202-25001', -101)), 'issueRods') $$,
  'BOM_ROD_EXCEEDS', 'more than the bucket holds is refused');
select throws_ok($$ select sr_t.moves(jsonb_build_array(
  sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S1', '251202-25001', '251202-25001', -10),
  sr_t.issue_row('00000000-0000-4000-8000-000000000002', 'FN-S2', null, '251202-25001', -29)), 'issueRods') $$,
  'BOM_ROD_EXCEEDS', 'one row over its bucket refuses the whole issue');
select is(sr_t.nmoves(), current_setting('test.n0')::integer, 'and nothing of it is written');
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S2', null, '251202-25003', -1)), 'issueRods') $$,
  'BOM_INVALID_TRANSITION', 'rods are issued only for a released or running order');
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S2', null, '251202-99999', -1)), 'issueRods') $$,
  'BOM_INVALID_ROD', 'an unknown order is refused');
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S4', null, '251202-25001', -1)), 'issueRods') $$,
  'BOM_INVALID_TRANSITION', 'a returned lot cannot be issued');
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S2', null, '251202-25001', -1) || '{"itemCode":"RB-X"}'::jsonb), 'issueRods') $$,
  'BOM_INVALID_ROD', 'the RB code must be the code of the lot');
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S2', null, '251202-25001', 1)), 'issueRods') $$,
  'BOM_INVALID_ROD', 'an issue takes rods out (negative quantity)');
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S2', null, '251202-25001', -1) || '{"kind":"adjust"}'::jsonb), 'issueRods') $$,
  'BOM_INVALID_ROD', 'the kind of the row must match the action');
select throws_ok($$ select sr_t.moves(jsonb_build_array(
  sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S2', null, '251202-25001', -1),
  sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S3', null, '251202-25001', -1)), 'issueRods') $$,
  'BOM_INVALID_ROD', 'a row id is used once per call');
select throws_ok($$ select sr_t.moves((select jsonb_agg(sr_t.issue_row(format('00000000-0000-4000-8000-%s', lpad(g::text, 12, '0')), 'FN-S2', null, '251202-25001', -0.1))
                                       from generate_series(1, 51) g), 'issueRods') $$,
  'BOM_INVALID_ROD', 'at most 50 rows per issue');
select throws_ok($$ select sr_t.moves('[]'::jsonb, 'issueRods') $$, 'BOM_INVALID_ROD', 'an empty issue is refused');
select set_config('test.res', sr_t.moves(jsonb_build_array(
  sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S1', '251202-25001', '251202-25001', -30),
  sr_t.issue_row('00000000-0000-4000-8000-000000000002', 'FN-S2', null, '251202-25001', -8) || '{"note":"จ่ายเพิ่มจากสต็อกกลาง"}'::jsonb), 'issueRods')::text, true);
select is(sr_t.bal('FN-S1', '251202-25001'), 70::numeric, 'SR issues 30 rods of the order bucket');
select is(sr_t.bal('FN-S2', null), 20::numeric, 'and 8 rods of free central stock for the same order');
select is((select jsonb_agg(jsonb_build_object('id', m ->> 'id', 'kind', m ->> 'kind', 'qty', (m ->> 'qty')::numeric, 'owner', m ->> 'ownerOrderId', 'for', m ->> 'forOrderId', 'by', m ->> 'by') order by m ->> 'id')
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'rodMoves' -> 'upsert') m where m ->> 'kind' = 'issue'),
  jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'kind', 'issue', 'qty', -30, 'owner', '251202-25001', 'for', '251202-25001', 'by', current_setting('test.n_sbx_sr_staff')),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000002', 'kind', 'issue', 'qty', -8, 'owner', null, 'for', '251202-25001', 'by', current_setting('test.n_sbx_sr_staff'))),
  'the issue rows keep the ids the client sent, the buckets and the order they serve');
select is(sr_t.audit(), 'rodMoves +2', 'the history counts the two issue rows');
select throws_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000001', 'FN-S2', null, '251202-25001', -1)), 'issueRods') $$,
  'BOM_INVALID_ROD', 'a row id that is already stored is refused');

-- 11. reverseRodIssue: ย้อนจ่ายครั้งเดียว ----------------------------------------------------------------------------------------------
select throws_ok($$ select sr_t.moves('[{"id":"00000000-0000-4000-8000-000000000011","kind":"unissue","reversesId":"00000000-0000-4000-8000-000000000001","note":"ab"}]'::jsonb, 'reverseRodIssue') $$,
  'BOM_INVALID_ROD', 'a reversal needs a reason of three characters');
select throws_ok($$ select sr_t.moves('[{"id":"00000000-0000-4000-8000-000000000011","kind":"unissue","reversesId":"00000000-0000-4000-8000-0000000000ff","note":"จ่ายผิดใบ"}]'::jsonb, 'reverseRodIssue') $$,
  'BOM_INVALID_ROD', 'an unknown issue cannot be reversed');
select throws_ok($$ select sr_t.moves(jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000011', 'kind', 'unissue', 'note', 'จ่ายผิดใบ',
  'reversesId', (select m ->> 'id' from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m where m ->> 'lotId' = sr_t.lot_id('FN-S1') and m ->> 'kind' = 'receive' limit 1))), 'reverseRodIssue') $$,
  'BOM_INVALID_ROD', 'only an issue row can be reversed');
select throws_ok($$ select sr_t.moves('[{"id":"00000000-0000-4000-8000-000000000011","kind":"unissue","reversesId":"00000000-0000-4000-8000-000000000001","note":"จ่ายผิดใบ"},{"id":"00000000-0000-4000-8000-000000000012","kind":"unissue","reversesId":"00000000-0000-4000-8000-000000000002","note":"จ่ายผิดใบ"}]'::jsonb, 'reverseRodIssue') $$,
  'BOM_INVALID_ROD', 'one reversal per call');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select sr_t.moves('[{"id":"00000000-0000-4000-8000-000000000011","kind":"unissue","reversesId":"00000000-0000-4000-8000-000000000001","note":"จ่ายผิดใบ"}]'::jsonb, 'reverseRodIssue') $$,
  'BOM_FORBIDDEN', 'GR staff cannot reverse an issue');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select set_config('test.res', sr_t.moves('[{"id":"00000000-0000-4000-8000-000000000011","kind":"unissue","reversesId":"00000000-0000-4000-8000-000000000001","note":"จ่ายผิดใบ"}]'::jsonb, 'reverseRodIssue')::text, true);
select is(sr_t.bal('FN-S1', '251202-25001'), 100::numeric, 'the reversal puts the 30 rods back in the order bucket');
select is((select jsonb_build_object('qty', (m ->> 'qty')::numeric, 'owner', m ->> 'ownerOrderId', 'for', m ->> 'forOrderId', 'reverses', m ->> 'reversesId', 'note', m ->> 'note')
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'rodMoves' -> 'upsert') m where m ->> 'kind' = 'unissue'),
  jsonb_build_object('qty', 30, 'owner', '251202-25001', 'for', '251202-25001', 'reverses', '00000000-0000-4000-8000-000000000001', 'note', 'จ่ายผิดใบ'),
  'the server copies the lot, the bucket and the order of the issue and the opposite quantity');
select throws_ok($$ select sr_t.moves('[{"id":"00000000-0000-4000-8000-000000000013","kind":"unissue","reversesId":"00000000-0000-4000-8000-000000000001","note":"ซ้ำ"}]'::jsonb, 'reverseRodIssue') $$,
  'BOM_INVALID_TRANSITION', 'an issue is reversed only once');

-- 12. adjustRods: SR หรือกลุ่มวางแผน (SR ตั้งแต่ 20261204010000 ดู bom_sr_store_module.test.sql) เฉพาะสต็อกกลาง ------------------------------------------------------------------------------------------
select set_config('test.adj', jsonb_build_object('id', '00000000-0000-4000-8000-000000000021', 'kind', 'adjust', 'lotId', sr_t.lot_id('FN-S3'), 'qty', -4, 'note', 'นับจริงขาด 4')::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select sr_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb), 'adjustRods') $$, 'BOM_FORBIDDEN', 'GR staff cannot adjust the stock (SR and planners do)');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select sr_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb), 'adjustRods') $$, 'BOM_FORBIDDEN', 'nor can QA staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select sr_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb || '{"ownerOrderId":"251202-25001"}'::jsonb), 'adjustRods') $$,
  'BOM_INVALID_ROD', 'an adjustment changes free central stock only');
select throws_ok($$ select sr_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb || '{"note":"ab"}'::jsonb), 'adjustRods') $$, 'BOM_INVALID_ROD', 'an adjustment needs a reason');
select throws_ok($$ select sr_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb || '{"qty":-11}'::jsonb), 'adjustRods') $$, 'BOM_ROD_EXCEEDS', 'free stock never goes below zero');
select lives_ok($$ select sr_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb), 'adjustRods') $$, 'a planner adjusts free central stock');
select is(sr_t.bal('FN-S3', null), 6::numeric, 'the free stock of the lot is 6');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select lives_ok($$ select sr_t.moves(jsonb_build_array(current_setting('test.adj')::jsonb || '{"id":"00000000-0000-4000-8000-000000000022","qty":1,"note":"พบเพิ่ม 1"}'::jsonb), 'adjustRods') $$,
  'an admin adjusts too');
select is(sr_t.free('RB-A'), 47::numeric, 'free central stock is 20 (FN-S1) + 20 (FN-S2) + 7 (FN-S3)');

-- 13. ปล่อยผลิตหยิบสต็อกกลาง ล็อตเก่าก่อน · เปิดกลับเป็นร่างคืน ------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.jobs3', jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-3-RB","orderId":"251202-25003","qtyPlanned":10,"qtyRequired":40}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-3-GR","orderId":"251202-25003","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-3-PK","orderId":"251202-25003","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb)::text, true);
select throws_ok($$ select sr_t.release('251202-25003', '{"stockCounts":{"RB-A":48}}'::jsonb, current_setting('test.jobs3')::jsonb) $$,
  'BOM_ROD_EXCEEDS', 'a release that wants more rods than free central stock is refused');
select is(sr_t.order_row('251202-25003') ->> 'status', 'draft', 'and the order stays a draft');
select set_config('test.res', sr_t.release('251202-25003', '{"stockCounts":{"RB-A":30}}'::jsonb, current_setting('test.jobs3')::jsonb)::text, true);
select is(sr_t.order_row('251202-25003') ->> 'status', 'released', 'the release takes 30 rods from the store');
select is(sr_t.bal('FN-S1', '251202-25003') || '/' || sr_t.bal('FN-S2', '251202-25003'), '20/10', 'oldest lot first: all 20 of FN-S1, then 10 of FN-S2');
select is(sr_t.bal('FN-S1', null) || '/' || sr_t.bal('FN-S2', null) || '/' || sr_t.bal('FN-S3', null), '0/10/7', 'the free buckets lost what was taken');
select is((select count(*)::integer from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'rodMoves' -> 'upsert') m
           where m ->> 'kind' = 'transfer' and m ->> 'forOrderId' = '251202-25003'), 4, 'two transfer rows per source bucket, all for the released order');
select is(sr_t.free('RB-A'), 17::numeric, 'free central stock is 17 after the take');
select ok(sr_t.audit() like '%rodMoves +4%', 'the history of the release counts the transfer rows');
select is(sr_t.order_row('251202-25003') -> 'stockCounts', '{"RB-A":30}'::jsonb, 'the amount taken is kept in the stock counts');
select set_config('test.res', sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"status":"draft"}'::jsonb))), 'updateOrderItem')::text, true);
select is(sr_t.order_row('251202-25003') ->> 'status', 'draft', 'the planner reopens the order');
select is(sr_t.bal('FN-S1', '251202-25003') || '/' || sr_t.bal('FN-S2', '251202-25003'), '0/0', 'reopening returns the rods it took');
select is(sr_t.bal('FN-S1', null) || '/' || sr_t.bal('FN-S2', null), '20/20', 'to the free buckets of the same lots');
select is(sr_t.free('RB-A'), 47::numeric, 'free central stock is whole again');
select ok(sr_t.audit() like '%rodMoves +4%', 'the history of the reopening counts the return rows');

-- 13b. ยอดใช้จากคลัง SR (stockCounts ของรหัส RB) ตั้งได้เฉพาะกลุ่มวางแผน · ST / WH ยังนับชิ้นอื่นของใบร่างได้ ---------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"stockCounts":{"RB-A":5}}'::jsonb))), 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'ST staff cannot set how many rods a draft takes from the SR store');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"stockCounts":{"RB-A":0}}'::jsonb))), 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'nor can WH staff (not even to zero)');
select throws_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"stockCounts":{}}'::jsonb))), 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'nor remove it');
select lives_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"stockCounts":{"RB-A":30,"SE-A":4}}'::jsonb))), 'setStockCounts') $$,
  'WH staff still count another part of the draft when the RB amount stays the same');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"stockCounts":{"RB-A":10,"SE-A":4}}'::jsonb))), 'setStockCounts') $$,
  'a planner sets the amount taken from the SR store');
select is(sr_t.order_row('251202-25003') -> 'stockCounts', '{"RB-A":10,"SE-A":4}'::jsonb, 'the draft keeps the counts of WH and the planner');
-- ST / WH นับได้เฉพาะบรรทัดผลระเบิดที่ไม่ใช่ RB และไม่ใช่สินค้าของใบ: ใบที่ยังไม่มีผลระเบิด หรือรหัสนอกผลระเบิด ตั้งไม่ได้ (คีย์คงอยู่หลังคำนวณใหม่)
select lives_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251202-25004","explosion":null}'::jsonb))), 'createOrder') $$, 'the planner opens a draft that is not exploded yet');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25004') || '{"stockCounts":{"RB-A":5}}'::jsonb))), 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'ST cannot pre-set an RB key on a draft without an explosion');
select throws_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25004') || '{"stockCounts":{"SE-A":5}}'::jsonb))), 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'nor any count before the explosion exists');
select throws_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"stockCounts":{"RB-A":10,"SE-A":4,"XX-1":2}}'::jsonb))), 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'nor a code that is not a line of the explosion');
select throws_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"stockCounts":{"RB-A":10,"SE-A":4,"FG-A":1}}'::jsonb))), 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'nor a product of the order (use from finished-goods stock)');
select lives_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"stockCounts":{"RB-A":10,"SE-A":6}}'::jsonb))), 'setStockCounts') $$,
  'ST still counts a normal line of an exploded draft');
select is(sr_t.order_row('251202-25004') -> 'stockCounts', '{}'::jsonb, 'the draft without an explosion has no count');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);

-- 13c. SR จ่ายแท่งตามใบแล้ว = งานเริ่มแล้ว เปิดกลับเป็นร่างไม่ได้จนกว่าจะย้อนการจ่าย ------------------------------------------------------------------
select set_config('test.jobs3b', jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-3B-RB","orderId":"251202-25003","qtyPlanned":30,"qtyRequired":40}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-3B-GR","orderId":"251202-25003","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-3B-PK","orderId":"251202-25003","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb)::text, true);
select lives_ok($$ select sr_t.release('251202-25003', '{}'::jsonb, current_setting('test.jobs3b')::jsonb) $$, 'the planner releases the draft again (10 rods from the store)');
select is(sr_t.bal('FN-S1', '251202-25003'), 10::numeric, 'the order holds 10 rods of the oldest lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select lives_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000041', 'FN-S1', '251202-25003', '251202-25003', -4)), 'issueRods') $$,
  'SR issues 4 rods to GR for the order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"status":"draft"}'::jsonb))), 'updateOrderItem') $$,
  'BOM_INVALID_TRANSITION', 'rods already handed to GR count as work started: the order cannot go back to draft');
select is(sr_t.order_row('251202-25003') ->> 'status', 'released', 'and the order stays released');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select lives_ok($$ select sr_t.moves('[{"id":"00000000-0000-4000-8000-000000000042","kind":"unissue","reversesId":"00000000-0000-4000-8000-000000000041","note":"จ่ายก่อนแก้ใบ"}]'::jsonb, 'reverseRodIssue') $$,
  'SR reverses the issue');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sr_t.order_row('251202-25003') || '{"status":"draft"}'::jsonb))), 'updateOrderItem') $$,
  'with nothing issued any more the planner reopens the order');
select is(sr_t.bal('FN-S1', '251202-25003') || '/' || sr_t.bal('FN-S1', null), '0/20', 'and the 10 rods go back to free central stock');

-- 14. ใบที่ปิดแล้ว: ถังของใบเป็นสต็อกกลาง (ไม่ต้องมีแถว) ------------------------------------------------------------------------------------------
reset role;
update public.bom_orders set status = 'completed', completed_at = now() where is_test and pi_no = '251202-25002';
set local role authenticated;
select is(sr_t.free('RB-A'), 87::numeric, 'the 40 rods left in the bucket of a completed order count as free central stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select lives_ok($$ select sr_t.moves(jsonb_build_array(sr_t.issue_row('00000000-0000-4000-8000-000000000031', 'FN-N1', '251202-25002', '251202-25001', -5)), 'issueRods') $$,
  'rods left in the bucket of a closed order can be issued for another order');
select is(sr_t.bal('FN-N1', '251202-25002'), 35::numeric, 'from that bucket');

-- 15. ชุดเรคอร์ด snapshot / delta และสิทธิ์อ่าน ------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(sr_t.lot('FN-S1')) k),
  array['createdAt', 'decidedAt', 'decidedBy', 'decision', 'decisionNote', 'id', 'itemCode', 'jobNo', 'location', 'lotNo', 'orderId', 'qc', 'qtyReceived', 'qtySent',
        'receivedAt', 'receivedBy', 'recipeCode', 'source', 'sourceNote', 'spec', 'status', 'uom', 'woNo'],
  'the rod lot record has its twenty-three fields (location, source, sourceNote since 20261204010000)');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys((select m from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m limit 1)) k),
  array['at', 'by', 'forOrderId', 'id', 'itemCode', 'kind', 'lotId', 'note', 'ownerOrderId', 'qty', 'reversesId'],
  'the rod move record has its eleven fields (by / at like fgMoves)');
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 23::bigint, 'the snapshot has twenty-three lists · six GR lists since 20261216010000 · orderRequests since 20261226010000');
select is((select count(*) from jsonb_object_keys(public.app_bom_master_since(0) -> 'changes')), 23::bigint, 'and so has the delta · six GR lists since 20261216010000 · orderRequests since 20261226010000');
select is(public.app_bom_master_since(0) -> 'changes' -> 'rodLots', jsonb_build_object('upsert', public.app_bom_master() -> 'rodLots', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the snapshot for the rod lots');
select is(public.app_bom_master_since(0) -> 'changes' -> 'rodMoves', jsonb_build_object('upsert', public.app_bom_master() -> 'rodMoves', 'delete', '[]'::jsonb),
  'and for the rod moves');
select ok(sr_t.lot('FN-REAL-1') is null, 'test mode never sees the real rod lot');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select ok(jsonb_array_length(public.app_bom_master() -> 'rodLots') > 0, 'a QA persona reads the store');

-- 16. ไม่มี session -----------------------------------------------------------------------------------------------------------------
select set_config('test.claims', current_setting('request.jwt.claims'), true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"rodLots":{"upsert":[]}}'::jsonb, 0, 'receiveRods') $$, 'AUTH_REQUIRED', 'receiving rods requires a session');
select throws_ok($$ select public.app_bom_save_master('{"rodMoves":{"upsert":[]}}'::jsonb, 0, 'issueRods') $$, 'AUTH_REQUIRED', 'issuing rods requires a session');
select set_config('request.jwt.claims', current_setting('test.claims'), true);

-- 17. ล้างข้อมูลทดสอบ: ตารางของคลังว่าง ข้อมูลจริงอยู่ครบ ---------------------------------------------------------------------------------------
select lives_ok('select public.app_sandbox_purge_bom()', 'the admin purges the BOM test data');
select is(public.app_bom_master() -> 'rodLots', '[]'::jsonb, 'no rod lot is left in the test master');
select is(public.app_bom_master() -> 'rodMoves', '[]'::jsonb, 'nor a rod move');
reset role;
select is((select count(*) from public.bom_rod_lots where is_test) + (select count(*) from public.bom_rod_moves where is_test), 0::bigint, 'the store tables hold no test row');
select is((select count(*) from public.bom_rod_lots where not is_test) + (select count(*) from public.bom_rod_moves where not is_test), 2::bigint, 'the real rows survive the purge');

select * from finish();
rollback;
