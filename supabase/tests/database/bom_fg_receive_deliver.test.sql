-- แผนก WH รับของสำเร็จรูปเข้าคลัง · ใบ PI ปิดอัตโนมัติเมื่อรับครบ · ปิดใบรับไม่ครบ · ส่งมอบลูกค้า (20261121010000_bom_fg_receive_deliver.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง/สิทธิ์ตาราง bom_fg_moves, รายการ action (completeOrder ถูกตัด), รูป payload (BOM_INVALID_FG), สิทธิ์ (WH ทุกบทบาทและ admin ได้
-- กลุ่มวางแผน / ผู้จัดการแผนกอื่น / แผนกอื่นไม่ได้ = BOM_FORBIDDEN) ลำดับตรวจ (รูป -> สิทธิ์ -> สถานะ -> ยอด) รับบางส่วนหลายครั้ง เพดานยอดที่ PK รายงาน (BOM_FG_EXCEEDS)
-- ปิดอัตโนมัติเมื่อรับครบ ปิดใบรับไม่ครบ (เงื่อนไขและเหตุผล) ส่งมอบ (เพดานรับสะสม ส่งหลังปิดใบได้) แถวใบที่จะเป็น completed ถูกปฏิเสธทุก action
-- snapshot / delta 14 ชุด (fgMoves) ฐานเวอร์ชันเก่า / epoch และล้างข้อมูลทดสอบ · authenticated อ่านตาราง bom_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role เท่านั้น
-- ข้อควรระวัง: ถ้าอ่านตารางตรงในนาม authenticated จะเกิด 42501 และทำให้ทั้งไฟล์ล้ม ("No plan found") ตรวจฝั่ง client ผ่าน RPC และตรวจ deny ด้วย throws_ok เท่านั้น
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและรายการ action ------------------------------------------------------------
select is((select count(*) from pg_class c where c.oid = 'public.bom_fg_moves'::regclass and c.relrowsecurity), 1::bigint, 'the finished-goods move table has RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.bom_fg_moves', p.priv)),
  'anon and authenticated have no direct table privilege on the move table');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.bom_fg_moves'::regclass and p.polname = 'bom_fg_moves_no_direct_access'), 'the move table has the deny-all policy');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.bom_fg_moves'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive),
  'the move table has the restrictive lab_only_no_access policy');
select ok(exists (select 1 from pg_trigger g where g.tgrelid = 'public.bom_fg_moves'::regclass and g.tgname = 'bom_fg_moves_sandbox_scope' and not g.tgisinternal)
      and exists (select 1 from pg_trigger g where g.tgrelid = 'public.bom_fg_moves'::regclass and g.tgname = 'bom_fg_moves_stamp_version' and not g.tgisinternal),
  'the move table enforces sandbox scope and stamps changed_version by trigger');
select ok('bom_fg_moves' = any (private.sandbox_unguarded_tables()) and 'bom_stock_moves' = any (private.sandbox_unguarded_tables())
          and 'rf_purchase_orders' = any (private.sandbox_unguarded_tables()) and 'client_error_logs' = any (private.sandbox_unguarded_tables())
          and 'ncr_reports' = any (private.sandbox_unguarded_tables()),
  'the move table is registered as sandbox aware and the redefined list keeps the earlier tables');
select is((select count(*) from pg_indexes where schemaname = 'public' and indexname in ('bom_fg_moves_changed_idx', 'bom_fg_moves_order_idx')), 2::bigint,
  'the move table is indexed by (is_test, changed_version) and by its order foreign key');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_fg_moves'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(order_pk, is_test) REFERENCES %bom_orders(id, is_test)%'),
  'a move references its order with a foreign key paired with is_test');
select ok(array['receiveFg', 'deliverFg', 'closeOrderShort'] <@ private.bom_client_actions()
          and array['receiveFg', 'deliverFg', 'closeOrderShort'] <@ private.bom_staff_actions(),
  'the three new actions are on the client and staff whitelists');
select ok(not ('completeOrder' = any (private.bom_client_actions())) and not ('completeOrder' = any (private.bom_staff_actions())),
  'completeOrder is no longer an action');
select ok(array['reportJob', 'setJobStatus', 'cancelOrder', 'releaseOrder', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts', 'countPartStock', 'setStockCounts'] <@ private.bom_client_actions()
          and array['reportJob', 'setJobStatus', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts', 'countPartStock', 'setStockCounts'] <@ private.bom_staff_actions(),
  'the earlier actions are still on the lists');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_fg_move(public.employees,text,jsonb)'::regprocedure,
                           'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure, 'private.bom_delta(bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure, 'public.app_sandbox_purge_bom()'::regprocedure)),
  'the new writer and the replaced functions are security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname in ('bom_fg_move', 'bom_fg_total', 'bom_fg_pk_done')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the finished-goods helpers directly');
select ok(not exists (select 1 from unnest(array['public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'public.app_sandbox_purge_bom()']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the replaced RPCs keep their grants (signed-in users only)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(position('bom_fg_moves' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0
      and position('request.jwt.claims' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0,
  'the BOM purge deletes the move table and still sets the JWT claims aside');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ -------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8e300000-0000-0000-0000-000000000001', 'bomfg-admin@test.local', '{}'),
  ('8e300000-0000-0000-0000-000000000002', 'bomfg-staff@test.local', '{}'),
  ('8e300000-0000-0000-0000-000000000003', 'mnplab001-bomfg@test.local', '{}'),
  ('8e300000-0000-0000-0000-000000000004', 'bomfg-wh@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e300000-0000-0000-0000-000000000101', 'BOMFG-ADMIN', 'Bomfg', 'Admin', 'bomfg-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e300000-0000-0000-0000-000000000001'),
  ('8e300000-0000-0000-0000-000000000102', 'BOMFG-STAFF-REAL', 'Bomfg', 'Staff', 'bomfg-staff@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8e300000-0000-0000-0000-000000000002'),
  ('8e300000-0000-0000-0000-000000000103', 'MNPLAB001', 'แล็บ', 'หนึ่ง', 'mnplab001-bomfg@test.local', 'LAB',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8e300000-0000-0000-0000-000000000003'),
  ('8e300000-0000-0000-0000-000000000104', 'BOMFG-WH-REAL', 'Bomfg', 'Warehouse', 'bomfg-wh@test.local', 'WH',
   (select id from public.departments where code = 'WH'), (select id from public.roles where code = 'staff'), '8e300000-0000-0000-0000-000000000004');
-- persona (is_test) เพิ่ม: ผจก. แผนก WH (บทบาทอื่นของแผนกเดียวกัน) และผู้ดูแลระบบ (ไม่มี persona บทบาท admin ในชุดตั้งต้น)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-WH-MGR-T', 'ทดสอบ', 'ผจก. WH', 'sbx-wh-mgr-t@sandbox.local', 'ผจก. แผนก WH (ทดสอบ)',
   (select id from public.departments where code = 'WH'), (select id from public.roles where code = 'department_manager'), false, true),
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select ok((select count(*) from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH') or (e.employee_no = 'SBX-WH-MGR-T' and d.code = 'WH' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-ADMIN-T' and r.code = 'admin') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-PK-STAFF' and d.code = 'PK') or (e.employee_no = 'SBX-ST-STAFF' and d.code = 'ST')
                                or (e.employee_no = 'SBX-QA-STAFF' and d.code = 'QA') or (e.employee_no = 'SBX-GR-AMGR' and d.code = 'GR')
                                or (e.employee_no = 'SBX-PK-MGR' and d.code = 'PK' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-RB-MGR' and d.code = 'RB' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-MGT-GM' and r.code = 'general_manager') or (e.employee_no = 'SBX-FT-FM' and r.code = 'factory_manager'))) = 12,
  'the personas used below belong to the departments and roles the rules name');

-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรง: โหมดทดสอบต้องมองไม่เห็นและ purge ไม่แตะ · ใช้ตรวจข้อจำกัดของตารางด้วย (ยังไม่มี claims จึง auth.uid() เป็น null)
insert into public.bom_master_state (is_test, version) values (false, 99);
insert into public.bom_orders (pi_no, customer, country, order_type, ordered_at, wh_due) values ('REAL-FG-PI', 'ลูกค้าจริง', 'TH', 'SA', 1762300000000, 1762400000000);
insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, 'REAL-ITEM', 'receive', 1 from public.bom_orders o where not o.is_test and o.pi_no = 'REAL-FG-PI';
select is((select count(*) from public.bom_fg_moves where not is_test), 1::bigint, 'the real move was inserted as a real (non-test) row');

-- ข้อจำกัดของตาราง (ใส่ตรงด้วยสิทธิ์เจ้าของตาราง ต้องถูกปฏิเสธ)
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, 'X', 'receive', 0 from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'a receive of zero is refused by the table');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, 'X', 'deliver', -1 from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'a negative quantity is refused by the table');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, 'X', 'receive', 1000000001 from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'a quantity above 1e9 is refused by the table');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, '', 'receive', 1 from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'a receive without a product code is refused by the table');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, 'X', 'bogus', 1 from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'an unknown move kind is refused by the table');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note) select o.id, 'X', 'receive', 1, repeat('ก', 301) from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'a note above 300 characters is refused by the table');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note) select o.id, '', 'close', 0, 'ab' from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'a close move needs a reason of at least three characters');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note) select o.id, 'X', 'close', 0, 'เหตุผลครบ' from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'a close move carries no product code');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note) select o.id, '', 'close', 1, 'เหตุผลครบ' from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23514', null, 'a close move carries no quantity');
select lives_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note) select o.id, '', 'close', 0, 'เหตุผลครบ' from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  'a well formed close move is accepted by the table');
select throws_ok($$ insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty) select true, o.id, 'X', 'receive', 1 from public.bom_orders o where o.pi_no = 'REAL-FG-PI' $$,
  '23503', null, 'a test-mode move cannot point at a real order (the foreign key is paired with is_test)');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) values ('00000000-0000-0000-0000-000000000000', 'X', 'receive', 1) $$,
  '23503', null, 'a move needs an existing order');

-- ตัวช่วยของเทสต์ (schema แยก ลบพร้อม rollback): รันในฐานะผู้เรียก (authenticated) ผ่าน RPC สาธารณะเท่านั้น
create schema fg_t;
grant usage on schema fg_t to authenticated;
create function fg_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function fg_t.save(p_changes jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, coalesce(p_base, fg_t.ver()), p_action)
$$;
create function fg_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function fg_t.order_status(p_no text) returns text language sql stable as $$ select fg_t.order_row(p_no) ->> 'status' $$;
create function fg_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
-- PK รายงานผลงานหนึ่งงาน: เพิ่มยอดดี p_good พร้อมรายการรายงานต่อท้าย และตั้งสถานะ
create function fg_t.report(p_no text, p_good numeric, p_status text) returns jsonb language sql volatile as $$
  select fg_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    fg_t.job(p_no) || jsonb_build_object('status', p_status, 'qtyDone', (fg_t.job(p_no) ->> 'qtyDone')::numeric + p_good,
      'reports', (fg_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', p_good, 'reject', 0, 'note', '')))))), 'reportJob')
$$;
create function fg_t.fg(p_row jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select fg_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action, p_base)
$$;
create function fg_t.receive(p_order text, p_lines jsonb, p_note text default '', p_base bigint default null) returns jsonb language sql volatile as $$
  select fg_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'receive', 'lines', p_lines, 'note', p_note), 'receiveFg', p_base)
$$;
create function fg_t.deliver(p_order text, p_lines jsonb, p_note text default '', p_base bigint default null) returns jsonb language sql volatile as $$
  select fg_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'deliver', 'lines', p_lines, 'note', p_note), 'deliverFg', p_base)
$$;
create function fg_t.close_short(p_order text, p_note text, p_base bigint default null) returns jsonb language sql volatile as $$
  select fg_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'close', 'note', p_note), 'closeOrderShort', p_base)
$$;
-- ประวัติของใบ (ตามลำดับที่เขียน) / ผลรวมต่อ (ใบ, รหัส, ชนิด) / ยอดคงคลังของสำเร็จรูปต่อรหัส (รับ - ส่งมอบ ทุกใบ) / จำนวนแถวทั้งหมด
create function fg_t.moves(p_order text default null) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(t.m order by t.ord), '[]'::jsonb)
  from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') with ordinality as t(m, ord)
  where p_order is null or t.m ->> 'orderId' = p_order
$$;
create function fg_t.total(p_order text, p_code text, p_kind text) returns numeric language sql stable as $$
  select coalesce(sum((m ->> 'qty')::numeric), 0) from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m
  where m ->> 'orderId' = p_order and m ->> 'fgCode' = p_code and m ->> 'kind' = p_kind
$$;
create function fg_t.onhand(p_code text) returns numeric language sql stable as $$
  select coalesce(sum(case m ->> 'kind' when 'receive' then (m ->> 'qty')::numeric when 'deliver' then -(m ->> 'qty')::numeric else 0 end), 0)
  from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m where m ->> 'fgCode' = p_code
$$;
create function fg_t.n() returns integer language sql stable as $$ select jsonb_array_length(public.app_bom_master() -> 'fgMoves') $$;

select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"PK":1764000000000},"dueDefaults":[],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"PK","itemCode":"FG-A","name":"แพ็กสินค้า","kind":"FG","uom":"set","qtyPlanned":10,"qtyRequired":10,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":[],"reports":[]}', true);

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"fgMoves":{"upsert":[]}}'::jsonb, 0, 'receiveFg') $$, 'AUTH_REQUIRED', 'receiving requires a session');
select set_config('request.jwt.claims', '{"sub":"8e300000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"fgMoves":{"upsert":[{"orderId":"X","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb, 0, 'receiveFg') $$, 'BOM_TEST_MODE_ONLY',
  'a real WH staff account cannot receive goods (real mode is not open)');
select set_config('request.jwt.claims', '{"sub":"8e300000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"fgMoves":{"upsert":[{"orderId":"X","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb, 0, 'receiveFg') $$, 'BOM_TEST_MODE_ONLY',
  'a real PP staff account cannot receive goods either');
select throws_ok('select count(*) from public.bom_fg_moves', '42501', null, 'clients cannot read the move table directly');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) values ('00000000-0000-0000-0000-000000000000', 'X', 'receive', 1) $$, '42501', null,
  'clients cannot write the move table directly');
select throws_ok($$ update public.bom_fg_moves set qty = 1 $$, '42501', null, 'clients cannot update the move table directly');
select throws_ok($$ delete from public.bom_fg_moves $$, '42501', null, 'clients cannot delete from the move table directly');
select set_config('request.jwt.claims', '{"sub":"8e300000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"fgMoves":{"upsert":[]}}'::jsonb, 0, 'receiveFg') $$, 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot receive goods');
select set_config('request.jwt.claims', '{"sub":"8e300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"fgMoves":{"upsert":[{"orderId":"X","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb, 0, 'receiveFg') $$, 'BOM_TEST_MODE_ONLY',
  'an admin outside test mode cannot receive goods');

-- 4. ข้อมูลตั้งต้น: สินค้า 2 รายการ ใบ PI 5 ใบ (สองใบแรกพร้อมงาน PK) ------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"FG-B","kind":"FG","name":"สินค้า B","ownerDept":"PK","uom":"set"}]}}'::jsonb, 0, 'importFlat') ->> 'version', '1', 'the planner seeds the finished goods');
select ok(fg_t.save(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251121-25001', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""},{"fgCode":"FG-B","qty":6,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10},{"itemCode":"FG-B","level":0,"fgQty":6,"required":6}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251121-25002', 'items', '[{"fgCode":"FG-A","qty":5,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":5,"required":5}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251121-25003', 'items', '[{"fgCode":"FG-A","qty":3,"colorSet":"A","note":""}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251121-25004', 'items', '[{"fgCode":"FG-A","qty":3,"colorSet":"A","note":""}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251121-25005', 'items', '[{"fgCode":"FG-A","qty":2,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":2,"required":2}]'::jsonb)))), 'createOrder') is not null, 'the planner creates five orders');
select is(fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25004') || '{"status":"cancelled","cancelReason":"ทดสอบ"}'::jsonb))), 'cancelOrder') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled',
  'one draft is cancelled');
select ok(fg_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(fg_t.order_row('251121-25001') || '{"status":"released"}'::jsonb,
                                                          fg_t.order_row('251121-25002') || '{"status":"released"}'::jsonb,
                                                          fg_t.order_row('251121-25005') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-1A","orderId":"251121-25001","itemCode":"FG-A"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1B","orderId":"251121-25001","itemCode":"FG-B","qtyPlanned":6,"qtyRequired":6}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2A","orderId":"251121-25002","itemCode":"FG-A","qtyPlanned":5,"qtyRequired":5}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-5A","orderId":"251121-25005","itemCode":"FG-A","qtyPlanned":2,"qtyRequired":2}'::jsonb))), 'releaseOrder') is not null,
  'the planner releases three orders with their packing jobs');
select is(fg_t.order_status('251121-25001') || ',' || fg_t.order_status('251121-25003'), 'released,draft', 'one order is released and one is still a draft');
select is(public.app_bom_master() -> 'fgMoves', '[]'::jsonb, 'no goods have been received yet');
select set_config('test.v_seed', fg_t.ver()::text, true);

-- 5. รูป payload / รูปแถว (WH staff: ผ่านด่านสิทธิ์ได้จึงเห็นข้อผิดรูปของตัวเขียน) ทุกกรณีไม่เขียนอะไร ---------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select lives_ok($$ select fg_t.save('{"fgMoves":{"upsert":[]}}'::jsonb, 'receiveFg') $$, 'an empty request is a no-op');
select is(fg_t.ver(), current_setting('test.v_seed')::bigint, 'and it does not move the version');
-- 5.1 ส่วน / action
select throws_ok($$ select fg_t.save('{"fgMoves":{"upsert":[{"orderId":"251121-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb, 'reportJob') $$, 'BOM_INVALID_FG',
  'the fgMoves section can only be sent with the three finished-goods actions');
select throws_ok($$ select fg_t.save('{"fgMoves":{"upsert":[{"orderId":"251121-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb, 'countPartStock') $$, 'BOM_INVALID_FG',
  'not even with a stock action');
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(fg_t.order_row('251121-25001')))), 'receiveFg') $$, 'BOM_INVALID_FG',
  'the receive action cannot carry an order row');
select throws_ok($$ select fg_t.save('{"stock":{"upsert":[{"itemCode":"P-1","qty":1}]}}'::jsonb, 'deliverFg') $$, 'BOM_INVALID_FG', 'the deliver action cannot carry a stock row');
select throws_ok($$ select fg_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(fg_t.job('JOB-1A')))), 'closeOrderShort') $$, 'BOM_INVALID_FG',
  'the close action cannot carry a job row');
select throws_ok($$ select fg_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(
  '{"orderId":"251121-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb)), 'jobs', jsonb_build_object('upsert', jsonb_build_array(fg_t.job('JOB-1A')))), 'receiveFg') $$, 'BOM_INVALID_FG',
  'nor can it carry a move together with another section');
select throws_ok($$ select fg_t.save('{"fgMoves":{"delete":[]}}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_PAYLOAD', 'moves cannot be deleted');
select throws_ok($$ select fg_t.save('{"fgMoves":{"upsert":{}}}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_PAYLOAD', 'the upsert list must be an array');
-- 5.2 รูปแถว
select throws_ok($$ select fg_t.save('{"fgMoves":{"upsert":[{"orderId":"251121-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]},{"orderId":"251121-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb, 'receiveFg') $$,
  'BOM_INVALID_FG', 'one request per call');
select throws_ok($$ select fg_t.save('{"fgMoves":{"upsert":["x"]}}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_FG', 'a request must be an object');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"deliver","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_FG', 'the kind must match the action (receive)');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb, 'deliverFg') $$, 'BOM_INVALID_FG', 'the kind must match the action (deliver)');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"close","note":"เหตุผลครบ"}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_FG', 'the kind must match the action (close)');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb, 'closeOrderShort') $$, 'BOM_INVALID_FG', 'a receive request is not a close request');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_FG', 'the kind is required');
select throws_ok($$ select fg_t.fg('{"kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_FG', 'the order is required');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"receive"}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_FG', 'a receive needs lines');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"receive","lines":[]}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_FG', 'with at least one line');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"receive","lines":{"fgCode":"FG-A","qty":1}}'::jsonb, 'receiveFg') $$, 'BOM_INVALID_FG', 'lines must be an array');
select throws_ok($$ select fg_t.fg(jsonb_build_object('orderId', '251121-25001', 'kind', 'receive',
  'lines', (select jsonb_agg(jsonb_build_object('fgCode', 'FG-A', 'qty', 1)) from generate_series(1, 501))), 'receiveFg') $$, 'BOM_INVALID_FG', 'and at most 500 lines');
select throws_ok($$ select fg_t.receive('251121-25001', '["x"]'::jsonb) $$, 'BOM_INVALID_FG', 'a line must be an object');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"qty":1}]'::jsonb) $$, 'BOM_INVALID_FG', 'a line needs a product code');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A"}]'::jsonb) $$, 'BOM_INVALID_FG', 'and a quantity');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":0}]'::jsonb) $$, 'BOM_INVALID_FG', 'a zero quantity is refused');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":-1}]'::jsonb) $$, 'BOM_INVALID_FG', 'a negative quantity is refused');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":"1"}]'::jsonb) $$, 'BOM_INVALID_FG', 'a quantity must be a number');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1000000001}]'::jsonb) $$, 'BOM_INVALID_FG', 'a quantity above 1e9 is refused');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1},{"fgCode":"fg-a","qty":2}]'::jsonb) $$, 'BOM_INVALID_FG', 'the same product twice is refused (codes are compared canonically)');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb, repeat('ก', 301)) $$, 'BOM_INVALID_FG', 'a note above 300 characters is refused');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"close","note":"เหตุผลครบ","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb, 'closeOrderShort') $$, 'BOM_INVALID_FG', 'a close request has no lines');
select throws_ok($$ select fg_t.fg('{"orderId":"251121-25001","kind":"close"}'::jsonb, 'closeOrderShort') $$, 'BOM_INVALID_FG', 'a close request needs a reason');
select throws_ok($$ select fg_t.close_short('251121-25001', '  ab  ') $$, 'BOM_INVALID_FG', 'a reason of two characters is refused (it is trimmed first)');
select throws_ok($$ select fg_t.close_short('251121-25001', repeat('ก', 301)) $$, 'BOM_INVALID_FG', 'a reason above 300 characters is refused');
select throws_ok($$ select fg_t.receive('251121-NOPE', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_INVALID_FG', 'an unknown order is refused');
select throws_ok($$ select fg_t.receive('251121-25002', '[{"fgCode":"FG-B","qty":1}]'::jsonb) $$, 'BOM_INVALID_FG', 'a product that is not on the order is refused');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-Z","qty":1}]'::jsonb) $$, 'BOM_INVALID_FG', 'an unknown product is refused');
select throws_ok($$ select fg_t.deliver('251121-25002', '[{"fgCode":"FG-B","qty":1}]'::jsonb) $$, 'BOM_INVALID_FG', 'the same product check applies to a delivery');
select is(fg_t.ver(), current_setting('test.v_seed')::bigint, 'none of the refused requests moved the version');
select is(public.app_bom_master() -> 'fgMoves', '[]'::jsonb, 'and none wrote a move');

-- 6. สิทธิ์: WH ทุกบทบาทและ admin ได้ กลุ่มวางแผน / ผู้จัดการแผนกอื่น / แผนกอื่นไม่ได้ (ตรวจก่อนสถานะและยอด) ------------------------------
-- รูปผิดมาก่อนสิทธิ์: พนักงาน PK ส่งจำนวน 0 = BOM_INVALID_FG ไม่ใช่ BOM_FORBIDDEN
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":0}]'::jsonb) $$, 'BOM_INVALID_FG', 'the shape is checked before the permission');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'PK staff cannot receive goods');
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'PK staff cannot record a delivery');
select throws_ok($$ select fg_t.close_short('251121-25001', 'ปิดใบรับไม่ครบ') $$, 'BOM_FORBIDDEN', 'PK staff cannot close an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'the planning group only views: no receiving');
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'the planning group cannot record a delivery');
select throws_ok($$ select fg_t.close_short('251121-25001', 'ปิดใบรับไม่ครบ') $$, 'BOM_FORBIDDEN', 'the planning group cannot close an order');
select throws_ok($$ select fg_t.receive('251121-NOPE', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'the permission is checked before the order is looked up');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'ST staff cannot receive goods');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'QA staff cannot receive goods');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'an assistant department manager of GR cannot receive goods');
-- ผู้จัดการแผนกอื่น / ผจก.ทั่วไป / ผจก.โรงงาน อยู่ในกลุ่มวางแผนตามบทบาท (แก้ข้อมูลหลักได้) แต่ไม่ใช่ WH จึงรับไม่ได้
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'the PK department manager cannot receive goods');
select throws_ok($$ select fg_t.close_short('251121-25001', 'ปิดใบรับไม่ครบ') $$, 'BOM_FORBIDDEN', 'nor close an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'the RB department manager cannot record a delivery');
select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'the general manager cannot receive goods');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'the factory manager cannot receive goods');
select is(fg_t.ver(), current_setting('test.v_seed')::bigint, 'no refusal moved the version');

-- 7. รับก่อน PK รายงาน = เกินเพดาน · PK รายงานแล้วรับบางส่วนหลายครั้ง ----------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'nothing can be received before PK has reported it');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select is(fg_t.report('JOB-1A', 4, 'in_progress') -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '4', 'PK reports 4 sets of A');
select is(fg_t.order_status('251121-25001'), 'in_progress', 'the order is in progress');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select set_config('test.v0', fg_t.ver()::text, true);
select set_config('test.res', fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":3}]'::jsonb, 'รอบเช้า')::text, true);
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert'), 1, 'WH receives 3 sets: one move comes back in the delta');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'delete', '[]'::jsonb, 'the delete list of the moves is always empty');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert', '[]'::jsonb, 'a partial receipt does not touch the order');
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v0')::bigint + 1)::text, 'the version moved once');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'orderId', '251121-25001', 'the move names the order');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'fgCode', 'FG-A', 'the product');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'receive', 'the kind');
select is((current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'qty')::numeric, 3::numeric, 'the quantity');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'note', 'รอบเช้า', 'and the note');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'by', current_setting('test.n_sbx_wh_staff'), 'the receiver is the persona');
select ok((current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'at')::bigint > 1700000000000, 'the time is the server time in milliseconds');
select ok((current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'the id is a uuid text');
select is(fg_t.order_status('251121-25001'), 'in_progress', 'the order stays in progress');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":2}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'received 3 + 2 is more than the 4 PK reported');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-B","qty":1}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'product B has no PK output yet');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1000000000}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'the largest allowed quantity is still capped by the PK output');
-- WH ผู้จัดการแผนก (บทบาทอื่นของแผนกเดียวกัน) รับได้ ครบเพดาน 4
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select is(fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'by', current_setting('test.n_sbx_wh_mgr_t'),
  'a WH department manager receives goods too (any role of the department)');
select is(fg_t.total('251121-25001', 'FG-A', 'receive'), 4::numeric, 'the received total of A is 4');
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'the cap is exactly what PK reported');
-- ทั้งคำสั่งผ่านหรือไม่ผ่านพร้อมกัน
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(fg_t.report('JOB-1B', 2, 'in_progress') is not null, 'PK reports 2 sets of B');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select set_config('test.n0', fg_t.n()::text, true);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-B","qty":1},{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FG_EXCEEDS',
  'one line over the cap refuses the whole request');
select is(fg_t.n(), current_setting('test.n0')::integer, 'and the valid line was not written either');
select is(fg_t.total('251121-25001', 'FG-B', 'receive'), 0::numeric, 'B is still unreceived');
-- admin (persona บทบาท admin) รับได้
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select is(fg_t.receive('251121-25001', '[{"fgCode":"FG-B","qty":2}]'::jsonb, 'โดยผู้ดูแลระบบ') -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'by', current_setting('test.n_sbx_admin_t'), 'an admin receives goods');
select is(fg_t.n(), current_setting('test.n0')::integer + 1, 'one more move exists');

-- 8. ส่งมอบ: เพดานคือรับสะสม (ต่อใบ ต่อสินค้า) · ใบที่ยังไม่ปล่อย / ยกเลิกแล้วรับหรือส่งมอบไม่ได้ ---------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":5}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'nothing above the 4 received can be delivered');
select throws_ok($$ select fg_t.deliver('251121-25002', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'the cap is per order: another order has received nothing');
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-B","qty":3}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'B: 3 is more than the 2 received');
select is(fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":2}]'::jsonb, 'ส่งรอบแรก') -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'deliver', 'WH delivers 2 sets of A');
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":3}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'delivered 2 + 3 is more than the 4 received');
select set_config('test.res', fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":2},{"fgCode":"FG-B","qty":1}]'::jsonb)::text, true);
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert'), 2, 'a delivery of two products writes two moves');
select is((select jsonb_agg(m ->> 'fgCode') from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert') m), '["FG-A","FG-B"]'::jsonb, 'in the order of the lines');
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'A is fully delivered');
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-B","qty":2}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'B: 1 + 2 is more than the 2 received');
select is(fg_t.total('251121-25001', 'FG-A', 'deliver'), 4::numeric, 'the delivered total of A is 4');
select is(fg_t.onhand('FG-A'), 0::numeric, 'the finished-goods stock of A is received minus delivered (0)');
select is(fg_t.onhand('FG-B'), 1::numeric, 'and of B (2 - 1)');
-- สถานะ: draft / cancelled ไม่ได้ทั้งรับ ส่งมอบ ปิด (ตรวจสถานะก่อนยอด)
select throws_ok($$ select fg_t.receive('251121-25003', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a draft cannot receive goods');
select throws_ok($$ select fg_t.deliver('251121-25003', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a draft cannot be delivered');
select throws_ok($$ select fg_t.close_short('251121-25003', 'ปิดใบรับไม่ครบ') $$, 'BOM_INVALID_TRANSITION', 'a draft cannot be closed');
select throws_ok($$ select fg_t.receive('251121-25004', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a cancelled order cannot receive goods');
select throws_ok($$ select fg_t.deliver('251121-25004', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a cancelled order cannot be delivered');
select throws_ok($$ select fg_t.close_short('251121-25004', 'ปิดใบรับไม่ครบ') $$, 'BOM_INVALID_TRANSITION', 'a cancelled order cannot be closed');

-- 9. ปิดใบรับไม่ครบก่อนเวลาไม่ได้ ใบปิดเองเมื่อรับครบทุกสินค้า ---------------------------------------------------------------
select throws_ok($$ select fg_t.close_short('251121-25001', 'ปิดก่อนเวลา') $$, 'BOM_INVALID_TRANSITION', 'a close is refused while a PK job is not done');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(fg_t.report('JOB-1A', 6, 'done') is not null, 'PK finishes A (10 in total)');
select ok(fg_t.report('JOB-1B', 4, 'done') is not null, 'PK finishes B (6 in total)');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select set_config('test.v1', fg_t.ver()::text, true);
select set_config('test.res', fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":6}]'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert', '[]'::jsonb, 'A is fully received but B is not: the order stays open');
select is(fg_t.order_status('251121-25001'), 'in_progress', 'still in progress');
select throws_ok($$ select fg_t.close_short('251121-25001', 'ปิดใบรับไม่ครบ') $$, 'BOM_INVALID_TRANSITION', 'a close is refused while PK output is still unreceived (B)');
select set_config('test.v2', fg_t.ver()::text, true);
select set_config('test.res', fg_t.receive('251121-25001', '[{"fgCode":"FG-B","qty":4}]'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'receiving the last product completes the order automatically');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'id', '251121-25001', 'the delta carries the closed order');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'completedAt', 'with the completion time');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert'), 1, 'and no other order');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert'), 1, 'the move comes back with it');
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v2')::bigint + 1)::text, 'the version moved once for the receipt and the closing together');
select is(fg_t.total('251121-25001', 'FG-A', 'receive') || '/' || fg_t.total('251121-25001', 'FG-B', 'receive'), '10/6', 'everything ordered is received');
-- ใบปิดแล้ว: รับ / ปิดซ้ำไม่ได้ ส่งมอบต่อได้จนครบรับสะสม
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a completed order takes no more receipts');
select throws_ok($$ select fg_t.close_short('251121-25001', 'ปิดใบรับไม่ครบ') $$, 'BOM_INVALID_TRANSITION', 'a completed order cannot be closed again');
select is(fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":6}]'::jsonb, 'ส่งหลังปิดใบ') -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'deliver', 'a completed order can still be delivered');
select throws_ok($$ select fg_t.deliver('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_FG_EXCEEDS', 'up to what was received');
select ok(fg_t.deliver('251121-25001', '[{"fgCode":"FG-B","qty":5}]'::jsonb) is not null, 'B is delivered in full (1 + 5 of 6)');
select is(fg_t.total('251121-25001', 'FG-A', 'deliver') || '/' || fg_t.total('251121-25001', 'FG-B', 'deliver'), '10/6', 'everything received is delivered');

-- 10. ปิดใบรับไม่ครบ: PK ทำได้น้อยกว่าที่สั่ง ---------------------------------------------------------------------------
select throws_ok($$ select fg_t.close_short('251121-25002', 'ลูกค้ารับเท่าที่ทำได้') $$, 'BOM_INVALID_TRANSITION', 'a close is refused while the PK job has not started');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(fg_t.report('JOB-2A', 3, 'done') is not null, 'PK finishes with 3 of the 5 ordered');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fg_t.close_short('251121-25002', 'ลูกค้ารับเท่าที่ทำได้') $$, 'BOM_INVALID_TRANSITION', 'a close is refused while what PK made (3) has not been received');
select ok(fg_t.receive('251121-25002', '[{"fgCode":"FG-A","qty":2}]'::jsonb, '', 1) is not null,
  'a save from an old base version is accepted: totals are judged on the server, not on the client copy');
select throws_ok($$ select fg_t.close_short('251121-25002', 'ลูกค้ารับเท่าที่ทำได้') $$, 'BOM_INVALID_TRANSITION', 'received 2 of the 3 PK made: still refused');
select throws_ok($$ select fg_t.receive('251121-25002', '[{"fgCode":"FG-A","qty":2}]'::jsonb, '', 1) $$, 'BOM_FG_EXCEEDS',
  'with an old base the caps are still judged on the server totals (a conflict to catch up on, not BOM_STALE)');
select ok(fg_t.receive('251121-25002', '[{"fgCode":"FG-A","qty":1}]'::jsonb) is not null, 'WH receives the last set PK made');
select is(fg_t.order_status('251121-25002'), 'in_progress', 'received 3 of 5: the order is not closed automatically');
select throws_ok($$ select fg_t.close_short('251121-25002', 'ab') $$, 'BOM_INVALID_FG', 'a two-character reason is refused');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select fg_t.close_short('251121-25002', 'ลูกค้ารับเท่าที่ทำได้') $$, 'BOM_FORBIDDEN', 'the planning group cannot close it');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select set_config('test.n1', fg_t.n()::text, true);
select set_config('test.v3', fg_t.ver()::text, true);
select set_config('test.res', fg_t.close_short('251121-25002', '  ลูกค้ารับเท่าที่ทำได้  ')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'WH closes the order with fewer sets than ordered');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'completedAt', 'with the completion time');
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v3')::bigint + 1)::text, 'the version moved once');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert'), 1, 'one close move is written');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'close', 'of kind close');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'fgCode', '', 'with no product');
select is((current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'qty')::numeric, 0::numeric, 'and no quantity');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'note', 'ลูกค้ารับเท่าที่ทำได้', 'the reason is the note, trimmed');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'by', current_setting('test.n_sbx_wh_staff'), 'by the persona');
select is(fg_t.n(), current_setting('test.n1')::integer + 1, 'and nothing else is written');
select throws_ok($$ select fg_t.receive('251121-25002', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a closed order takes no more receipts');
select throws_ok($$ select fg_t.close_short('251121-25002', 'ปิดซ้ำไม่ได้') $$, 'BOM_INVALID_TRANSITION', 'nor a second close');
select ok(fg_t.deliver('251121-25002', '[{"fgCode":"FG-A","qty":3}]'::jsonb) is not null, 'the 3 sets that were received are delivered after the close');
select is(fg_t.onhand('FG-A'), 0::numeric, 'the stock of A over all orders is received minus delivered (13 - 13)');

-- 11. แถวใบที่จะเป็น completed ถูกปฏิเสธทุก action ทุกผู้เรียก (ใบ 25005 ปล่อยผลิตแล้ว ยังไม่มีงานเสร็จ) -----------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25005') || '{"status":"completed"}'::jsonb))), 'updateOrderItem') $$, 'BOM_FORBIDDEN', 'a planner cannot complete an order by saving its row');
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25005') || '{"status":"completed"}'::jsonb))), 'completeOrder') $$, 'BOM_INVALID_ACTION', 'the old closing action is refused');
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25003') || '{"status":"completed"}'::jsonb))), 'releaseOrder') $$, 'BOM_FORBIDDEN', 'a draft cannot be moved to completed either');
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25005') || '{"status":" completed "}'::jsonb))), 'updateOrderItem') $$, 'BOM_FORBIDDEN', 'a status with spaces around it is read the same way');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25005') || '{"status":"completed"}'::jsonb))), 'updateOrderItem') $$, 'BOM_FORBIDDEN', 'an admin cannot complete an order by saving its row');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25005') || '{"status":"completed"}'::jsonb))), 'setStockCounts') $$, 'BOM_FORBIDDEN', 'a WH staff cannot either, through a staff action');
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25005') || '{"status":"completed"}'::jsonb))), 'completeOrder') $$, 'BOM_FORBIDDEN', 'the old action is not a staff action');
select is(fg_t.order_status('251121-25005'), 'released', 'the order is still released');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(fg_t.order_row('251121-25001')))), 'updateOrderItem') $$,
  'a copy of an order that is already completed (same as stored) is not refused');
select throws_ok($$ select fg_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  fg_t.order_row('251121-25001') || '{"note":"แก้หลังปิด"}'::jsonb))), 'updateOrderItem') $$, 'BOM_INVALID_TRANSITION', 'a completed order cannot change');
-- ใบ 25005: PK ทำครบ 2 ชุด แล้ว WH รับครบ = ปิดเองด้วยการรับ (ไม่ผ่านแถวใบ)
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(fg_t.report('JOB-5A', 2, 'done') is not null, 'PK finishes the last order (2 of 2)');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fg_t.close_short('251121-25005', 'ปิดใบรับไม่ครบ') $$, 'BOM_INVALID_TRANSITION', 'with nothing received yet (PK made 2) the close is refused');
select is(fg_t.receive('251121-25005', '[{"fgCode":"FG-A","qty":2}]'::jsonb) -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'receiving all 2 completes it (ordered 2)');
select throws_ok($$ select fg_t.close_short('251121-25005', 'ปิดใบรับไม่ครบ') $$, 'BOM_INVALID_TRANSITION', 'and a completed order is not closed again');

-- 12. ฐานเวอร์ชัน / epoch ------------------------------------------------------------------------------------
select throws_ok($$ select public.app_bom_save_master('{"fgMoves":{"upsert":[{"orderId":"251121-25005","kind":"deliver","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb,
  fg_t.ver() + 1, 'deliverFg') $$, 'BOM_INVALID_PAYLOAD', 'a base version above the counter is refused');
select throws_ok($$ select public.app_bom_save_master('{"fgMoves":{"upsert":[{"orderId":"251121-25005","kind":"deliver","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb,
  fg_t.ver(), 'deliverFg', '[]'::jsonb, '00000000-0000-0000-0000-000000000000') $$, 'BOM_RESET', 'a save that holds another epoch is refused');
select is(fg_t.total('251121-25005', 'FG-A', 'deliver'), 0::numeric, 'and wrote nothing');
select is(public.app_bom_save_master('{"fgMoves":{"upsert":[{"orderId":"251121-25005","kind":"deliver","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb,
  fg_t.ver(), 'deliverFg', '[{"action":"ส่งมอบ","detail":"251121-25005 FG-A 1"}]'::jsonb, public.app_bom_master() ->> 'epoch') -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'deliver',
  'a save with the current epoch and client audit text is accepted');

-- 13. snapshot / delta ----------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 14::bigint, 'any persona reads fourteen lists in the snapshot');
select is((select count(*) from jsonb_object_keys(public.app_bom_master_since(0) -> 'changes')), 14::bigint, 'and in the delta');
select is((select array_agg(k order by k) from jsonb_object_keys(public.app_bom_master() -> 'fgMoves' -> 0) k), array['at', 'by', 'fgCode', 'id', 'kind', 'note', 'orderId', 'qty'],
  'a move record has exactly the contract fields');
select is(public.app_bom_master_since(0) -> 'changes' -> 'fgMoves', jsonb_build_object('upsert', public.app_bom_master() -> 'fgMoves', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the move snapshot');
select is(jsonb_array_length(public.app_bom_master_since(current_setting('test.v3')::bigint) -> 'changes' -> 'fgMoves' -> 'upsert'), fg_t.n() - current_setting('test.n1')::integer,
  'a delta from an older version carries only the newer moves');
select is((select jsonb_agg(m ->> 'at' order by ord) from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') with ordinality as t(m, ord)),
  (select jsonb_agg(m ->> 'at' order by (m ->> 'at')::bigint, m ->> 'id') from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m),
  'the moves are listed by time');
select is((select jsonb_agg(m ->> 'kind') from jsonb_array_elements(fg_t.moves('251121-25002')) m), '["receive","receive","close","deliver"]'::jsonb,
  'the moves of an order are in the order they were written (two receipts, the close, the delivery)');
select is(fg_t.onhand('FG-A') || '/' || fg_t.onhand('FG-B'), '1/0', 'the finished-goods stock is received minus delivered over all orders (A: 15 - 14, B: 6 - 6)');
select is(fg_t.moves('251121-NOPE'), '[]'::jsonb, 'an unknown order has no moves');
select is(public.app_bom_master() -> 'fgMoves' -> 0 ->> 'by', current_setting('test.n_sbx_wh_staff'), 'the first move names its receiver');

-- audit: จำนวนต่อส่วนที่เซิร์ฟเวอร์บันทึกเอง
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'receiveFg' and a ->> 'detail' = 'fgMoves +1, orders +1'),
  'a receipt that completes the order is audited with the move and the order');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'receiveFg' and a ->> 'detail' = 'fgMoves +1'),
  'a partial receipt is audited with the move only');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'deliverFg' and a ->> 'detail' = 'fgMoves +2'),
  'a delivery of two products is audited with two moves');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'closeOrderShort' and a ->> 'detail' = 'fgMoves +1, orders +1'),
  'a short close is audited with the move and the order');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'deliverFg'
                  and a -> 'entries' = '[{"action":"ส่งมอบ","detail":"251121-25005 FG-A 1"}]'::jsonb),
  'the client text is kept apart as entries');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'completeOrder'), 'no order was ever closed through the old action');

-- 14. ตาราง: ค่าที่เซิร์ฟเวอร์ตั้ง / ความสอดคล้องของยอด (นับด้วยสิทธิ์เจ้าของตาราง) ------------------------------------------------
reset role;
select ok(not exists (select 1 from public.bom_fg_moves where is_test and (changed_version <= 0 or created_by is null)),
  'every test move is stamped with the version that wrote it and names a person');
select ok((select bool_and(m.changed_version <= (select s.version from public.bom_master_state s where s.is_test)) from public.bom_fg_moves m where m.is_test),
  'no move is stamped with a version beyond the counter');
select ok(not exists (select 1 from public.bom_fg_moves where is_test and ((kind = 'close' and (fg_code <> '' or qty <> 0 or char_length(note) < 3))
                                                                      or (kind <> 'close' and (fg_code = '' or qty <= 0)))),
  'every move has the shape of its kind');
select ok(not exists (
    select 1 from (
      select order_pk, fg_code,
             coalesce(sum(qty) filter (where kind = 'receive'), 0) as r, coalesce(sum(qty) filter (where kind = 'deliver'), 0) as d
      from public.bom_fg_moves where is_test and kind <> 'close' group by order_pk, fg_code) t
    where t.d > t.r),
  'no order has delivered more of a product than it received');
select ok(not exists (
    select 1 from (
      select m.order_pk, m.fg_code, sum(m.qty) as r
      from public.bom_fg_moves m where m.is_test and m.kind = 'receive' group by m.order_pk, m.fg_code) t
    where t.r > (select coalesce(sum(j.qty_done), 0) from public.bom_jobs j where j.is_test and j.order_pk = t.order_pk and j.dept = 'PK' and j.kind = 'FG' and j.item_code = t.fg_code)),
  'no order has received more of a product than PK reported');
select is((select count(*) from public.bom_orders where is_test and status = 'completed'), 3::bigint, 'three orders are completed (25001 and 25005 by receipt, 25002 by a short close)');
select is((select count(*) from public.bom_fg_moves where not is_test), 2::bigint, 'the real moves are untouched (the receive and the close from the structure checks)');
set local role authenticated;

-- 15. ล้างข้อมูลทดสอบ (ลบประวัติก่อนใบ) ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8e300000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_purge_bom()', 'NOT_AUTHORIZED', 'a non-admin cannot purge');
select set_config('request.jwt.claims', '{"sub":"8e300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.pre_epoch', public.app_bom_master() ->> 'epoch', true);
select set_config('test.purge', public.app_sandbox_purge_bom()::text, true);
select ok((current_setting('test.purge')::jsonb ->> 'deleted')::integer > 10, 'the purge reports the deleted rows');
select is(public.app_bom_master() -> 'fgMoves', '[]'::jsonb, 'no move is left in the test master');
select is(public.app_bom_master() -> 'orders', '[]'::jsonb, 'nor an order (the moves were deleted before the orders)');
select isnt(public.app_bom_master() ->> 'epoch', current_setting('test.pre_epoch'), 'the purge changed the epoch');
reset role;
select is((select count(*) from public.bom_fg_moves where is_test), 0::bigint, 'no test move is left in the table');
select is((select count(*) from public.bom_fg_moves where not is_test), 2::bigint, 'the real moves survive the purge');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fg_t.receive('251121-25001', '[{"fgCode":"FG-A","qty":1}]'::jsonb) $$, 'BOM_INVALID_FG', 'after the purge the order is gone');

select * from finish();
rollback;
