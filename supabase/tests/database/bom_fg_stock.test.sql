-- สต็อกสินค้าสำเร็จรูปจากส่วนที่ผลิตเกิน ลดการผลิตของใบร่าง (20261123010000_bom_fg_stock.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้างตาราง (ชนิด transfer / untransfer, from_order_pk, foreign key คู่, ดัชนี) สิทธิ์ของตัวช่วยใหม่
-- รับส่วนเกินหลังปิดใบ (เพดานยอด PK) · สต็อกต่อรหัสจากใบเดียวและหลายใบ (free = have - out - max(สั่ง, ส่งมอบ)) · ปล่อยผลิตหยิบจากใบที่ปล่อยก่อน (released_at แล้วเลข PI)
-- BOM_INVALID_ORDER (หยิบเกินจำนวนสั่ง) · BOM_FG_EXCEEDS (สต็อกไม่พอ) · คีย์สินค้าใน stockCounts เป็นของกลุ่มวางแผน (ST / WH นับชิ้นอื่นได้)
-- ใบที่มาจากสต็อกทั้งหมด completed ตอนปล่อยโดยไม่มีงาน · เพดานส่งมอบของใบต้นทางและใบที่หยิบ · ยกเลิก / เปิดกลับคืนสต็อก และถูกปฏิเสธเมื่อส่งมอบแล้ว / ให้ใบอื่นไปแล้ว
-- ด่านของ #369 ยังเทียบกับ own · ปิดอัตโนมัติ / ปิดรับไม่ครบใช้ have · รูปเรคอร์ด fgMoves (fromOrderId) · จำนวนใน audit · ล้างข้อมูลทดสอบ
-- 20261124010000 (ข้อ 18): ใบที่ปล่อยผลิตแล้ว completed จากสต็อกมากับงานไม่ได้ · ผิดทั้งที่ใบและที่งานได้รหัสของใบก่อน · สองสินค้าได้ครบจากสต็อก
--   · สองใบในคำสั่งเดียวแย่งสต็อก (แถวแรกหยิบก่อน แถวที่สองได้ BOM_FG_EXCEEDS ทั้งคำสั่งไม่เขียน)
-- authenticated อ่านตาราง bom_* และเรียก private.* ตรงไม่ได้: ตัวช่วยของเทสต์ที่อ่านนิยาม (fgs_t.stock / fgs_t.free) เป็น security definer ของเจ้าของ schema เทสต์
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ --------------------------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_fg_moves'
                  and column_name = 'from_order_pk' and data_type = 'uuid' and is_nullable = 'YES'),
  'the move table has a nullable source order column');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_fg_moves'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(from_order_pk, is_test) REFERENCES %bom_orders(id, is_test)%'),
  'the source order is a foreign key paired with is_test');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_fg_moves'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(order_pk, is_test) REFERENCES %bom_orders(id, is_test)%'),
  'the order foreign key is kept');
select is((select count(*) from pg_indexes where schemaname = 'public'
           and indexname in ('bom_fg_moves_changed_idx', 'bom_fg_moves_order_idx', 'bom_fg_moves_from_order_idx')), 3::bigint,
  'the move table is indexed by version, by order and by source order');
select is((select count(*) from pg_class c where c.oid = 'public.bom_fg_moves'::regclass and c.relrowsecurity), 1::bigint, 'the move table keeps RLS');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.bom_fg_moves', p.priv)),
  'anon and authenticated still have no direct table privilege on the move table');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_fg_move(public.employees,text,jsonb)'::regprocedure,
                           'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure,
                           'private.bom_fg_return_stock(uuid,uuid)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the replaced functions and the stock return writer are security definer with an empty search_path');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.pronamespace = 'private'::regnamespace and p.proname in ('bom_fg_in', 'bom_fg_out', 'bom_fg_have', 'bom_fg_free', 'bom_fg_stock')),
  'the new read helpers have an empty search_path');
select is((select count(*) from pg_proc p
           where p.pronamespace = 'private'::regnamespace
             and p.proname in ('bom_fg_in', 'bom_fg_out', 'bom_fg_have', 'bom_fg_free', 'bom_fg_stock', 'bom_fg_return_stock')), 6::bigint,
  'the six new helpers exist');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('bom_fg_in', 'bom_fg_out', 'bom_fg_have', 'bom_fg_free', 'bom_fg_stock', 'bom_fg_return_stock', 'bom_fg_move', 'bom_save_orders', 'bom_records')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the stock helpers or the replaced private functions directly');
select ok(not has_function_privilege('anon', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute')
          and has_function_privilege('authenticated', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute'),
  'the save RPC keeps its grants (signed-in users only)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. ข้อจำกัดของตาราง (ใบจริงสองใบ ใส่ตรงด้วยสิทธิ์เจ้าของตาราง ยังไม่มี claims) ----------------------------------------------
insert into public.bom_orders (pi_no, customer, country, order_type, ordered_at, wh_due) values
  ('REAL-FGS-1', 'ลูกค้าจริง', 'TH', 'SA', 1762300000000, 1762400000000),
  ('REAL-FGS-2', 'ลูกค้าจริง', 'TH', 'SA', 1762300000000, 1762400000000);
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, 'X', 'transfer', 1 from public.bom_orders o where o.pi_no = 'REAL-FGS-1' $$,
  '23514', null, 'a transfer needs a source order');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, 'X', 'untransfer', 1 from public.bom_orders o where o.pi_no = 'REAL-FGS-1' $$,
  '23514', null, 'an untransfer needs a source order');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty) select o.id, o.id, 'X', 'transfer', 1 from public.bom_orders o where o.pi_no = 'REAL-FGS-1' $$,
  '23514', null, 'an order cannot take stock from itself');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty)
  select a.id, b.id, 'X', 'receive', 1 from public.bom_orders a, public.bom_orders b where a.pi_no = 'REAL-FGS-1' and b.pi_no = 'REAL-FGS-2' $$,
  '23514', null, 'a receive has no source order');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty)
  select a.id, b.id, 'X', 'deliver', 1 from public.bom_orders a, public.bom_orders b where a.pi_no = 'REAL-FGS-1' and b.pi_no = 'REAL-FGS-2' $$,
  '23514', null, 'a delivery has no source order');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty, note)
  select a.id, b.id, '', 'close', 0, 'เหตุผลครบ' from public.bom_orders a, public.bom_orders b where a.pi_no = 'REAL-FGS-1' and b.pi_no = 'REAL-FGS-2' $$,
  '23514', null, 'a close has no source order');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty)
  select a.id, b.id, '', 'transfer', 1 from public.bom_orders a, public.bom_orders b where a.pi_no = 'REAL-FGS-1' and b.pi_no = 'REAL-FGS-2' $$,
  '23514', null, 'a transfer needs a product code');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty)
  select a.id, b.id, 'X', 'transfer', 0 from public.bom_orders a, public.bom_orders b where a.pi_no = 'REAL-FGS-1' and b.pi_no = 'REAL-FGS-2' $$,
  '23514', null, 'a transfer needs a positive quantity');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty)
  select a.id, b.id, repeat('X', 61), 'untransfer', 1 from public.bom_orders a, public.bom_orders b where a.pi_no = 'REAL-FGS-1' and b.pi_no = 'REAL-FGS-2' $$,
  '23514', null, 'a product code above 60 characters is refused');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty)
  select o.id, '00000000-0000-0000-0000-000000000000', 'X', 'transfer', 1 from public.bom_orders o where o.pi_no = 'REAL-FGS-1' $$,
  '23503', null, 'the source order must exist');
select lives_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty)
  select a.id, b.id, 'X', 'transfer', 2 from public.bom_orders a, public.bom_orders b where a.pi_no = 'REAL-FGS-1' and b.pi_no = 'REAL-FGS-2' $$,
  'a well formed transfer is accepted by the table');
select lives_ok($$ insert into public.bom_fg_moves (order_pk, from_order_pk, fg_code, kind, qty)
  select a.id, b.id, 'X', 'untransfer', 2 from public.bom_orders a, public.bom_orders b where a.pi_no = 'REAL-FGS-1' and b.pi_no = 'REAL-FGS-2' $$,
  'a well formed untransfer is accepted by the table');
select lives_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty) select o.id, 'X', 'receive', 1 from public.bom_orders o where o.pi_no = 'REAL-FGS-1' $$,
  'a receive without a source is still accepted');
select is((select count(*) from public.bom_fg_moves where not is_test), 3::bigint, 'three real moves exist');

-- 3. บัญชีทดสอบ persona และตัวช่วยของเทสต์ ------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8e400000-0000-0000-0000-000000000001', 'bomfgs-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e400000-0000-0000-0000-000000000101', 'BOMFGS-ADMIN', 'Bomfgs', 'Admin', 'bomfgs-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e400000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select ok((select count(*) from public.employees e join public.departments d on d.id = e.department_id
           where e.is_test and ((e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-PK-STAFF' and d.code = 'PK') or (e.employee_no = 'SBX-ST-STAFF' and d.code = 'ST')
                                or (e.employee_no = 'SBX-QA-STAFF' and d.code = 'QA'))) = 5,
  'the personas used below belong to the departments the rules name');

create schema fgs_t;
grant usage on schema fgs_t to authenticated;
create function fgs_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function fgs_t.save(p_changes jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, coalesce(p_base, fgs_t.ver()), p_action)
$$;
create function fgs_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function fgs_t.order_status(p_no text) returns text language sql stable as $$ select fgs_t.order_row(p_no) ->> 'status' $$;
-- ใบหนึ่งใบในคำตอบของการบันทึก (delta อาจมีใบอื่นที่เปลี่ยนหลังเวอร์ชันฐานด้วย)
create function fgs_t.up_order(p_res jsonb, p_no text) returns jsonb language sql immutable as $$
  select o from jsonb_array_elements(p_res -> 'changes' -> 'orders' -> 'upsert') o where o ->> 'id' = p_no
$$;
create function fgs_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
-- พนักงานแผนกรายงานผลงานหนึ่งงาน: เพิ่มยอดดีพร้อมรายการรายงานต่อท้าย และตั้งสถานะ
create function fgs_t.report(p_no text, p_good numeric, p_status text) returns jsonb language sql volatile as $$
  select fgs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    fgs_t.job(p_no) || jsonb_build_object('status', p_status, 'qtyDone', (fgs_t.job(p_no) ->> 'qtyDone')::numeric + p_good,
      'reports', (fgs_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', p_good, 'reject', 0, 'note', '')))))), 'reportJob')
$$;
create function fgs_t.fg(p_row jsonb, p_action text) returns jsonb language sql volatile as $$
  select fgs_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action)
$$;
create function fgs_t.receive(p_order text, p_code text, p_qty numeric, p_note text default '') returns jsonb language sql volatile as $$
  select fgs_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'receive', 'lines', jsonb_build_array(jsonb_build_object('fgCode', p_code, 'qty', p_qty)), 'note', p_note), 'receiveFg')
$$;
create function fgs_t.deliver(p_order text, p_code text, p_qty numeric, p_note text default '') returns jsonb language sql volatile as $$
  select fgs_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'deliver', 'lines', jsonb_build_array(jsonb_build_object('fgCode', p_code, 'qty', p_qty)), 'note', p_note), 'deliverFg')
$$;
create function fgs_t.close_short(p_order text, p_note text) returns jsonb language sql volatile as $$
  select fgs_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'close', 'note', p_note), 'closeOrderShort')
$$;
-- แถวใบ: ปล่อยผลิต (ช่องเพิ่ม + งาน) / ตั้ง stockCounts / เปลี่ยนสถานะ
create function fgs_t.release(p_no text, p_extra jsonb, p_jobs jsonb default '[]'::jsonb) returns jsonb language sql volatile as $$
  select fgs_t.save(jsonb_build_object(
    'orders', jsonb_build_object('upsert', jsonb_build_array(fgs_t.order_row(p_no) || p_extra || '{"status":"released"}'::jsonb)),
    'jobs', jsonb_build_object('upsert', p_jobs)), 'releaseOrder')
$$;
create function fgs_t.counts(p_no text, p_counts jsonb) returns jsonb language sql volatile as $$
  select fgs_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
    fgs_t.order_row(p_no) || jsonb_build_object('stockCounts', p_counts)))), 'setStockCounts')
$$;
create function fgs_t.set_status(p_no text, p_status text, p_action text) returns jsonb language sql volatile as $$
  select fgs_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
    fgs_t.order_row(p_no) || jsonb_build_object('status', p_status, 'cancelReason', 'ทดสอบคืนสต็อก')))), p_action)
$$;
-- ประวัติ / จำนวนแถว / ผลรวมสุทธิของการหยิบ (in) ของใบ / บรรทัดล่าสุดของ audit (เซิร์ฟเวอร์นับเอง)
create function fgs_t.moves(p_order text default null) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(t.m order by t.ord), '[]'::jsonb)
  from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') with ordinality as t(m, ord)
  where p_order is null or t.m ->> 'orderId' = p_order
$$;
create function fgs_t.n() returns integer language sql stable as $$ select jsonb_array_length(public.app_bom_master() -> 'fgMoves') $$;
create function fgs_t.audit() returns text language sql stable as $$ select public.app_bom_audit(1) -> 0 ->> 'detail' $$;
-- นิยามฝั่งเซิร์ฟเวอร์ (private.* เรียกจาก authenticated ไม่ได้): security definer ของเจ้าของ schema เทสต์ อ่านอย่างเดียว
create function fgs_t.stock(p_code text) returns numeric language sql stable security definer set search_path = '' as $$
  select private.bom_fg_stock(p_code)
$$;
create function fgs_t.free(p_no text, p_code text) returns numeric language sql stable security definer set search_path = '' as $$
  select private.bom_fg_free((select o.id from public.bom_orders o where o.is_test and o.pi_no = p_no), p_code)
$$;

select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"PK":1764000000000},"dueDefaults":[],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"PK","itemCode":"FG-A","name":"แพ็กสินค้า","kind":"FG","uom":"set","qtyPlanned":10,"qtyRequired":10,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":[],"reports":[]}', true);

-- 4. ข้อมูลตั้งต้น: สินค้า 2 รายการ + ชิ้นยาง 1 รายการ · ใบ PI 6 ใบ (สองใบแรกปล่อยผลิตพร้อมงาน PK) ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"FG-B","kind":"FG","name":"สินค้า B","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"}]}}'::jsonb, 0, 'importFlat') ->> 'version', '1', 'the planner seeds the items');
select ok(fgs_t.save(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25001', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25002', 'items', '[{"fgCode":"FG-A","qty":4,"colorSet":"A","note":""},{"fgCode":"FG-B","qty":3,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":4,"required":4},{"itemCode":"FG-B","level":0,"fgQty":3,"required":3}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25003', 'items', '[{"fgCode":"FG-A","qty":6,"colorSet":"A","note":""},{"fgCode":"FG-B","qty":2,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":6,"required":6},{"itemCode":"FG-B","level":0,"fgQty":2,"required":2}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25004', 'items', '[{"fgCode":"FG-A","qty":9,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":9,"required":9}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25005', 'items', '[{"fgCode":"FG-A","qty":2,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":2,"required":2}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25006', 'items', '[{"fgCode":"FG-A","qty":5,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":5,"required":5}]'::jsonb)))), 'createOrder') is not null, 'the planner creates six draft orders');
select ok(fgs_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(fgs_t.order_row('251123-25001') || '{"status":"released"}'::jsonb,
                                                          fgs_t.order_row('251123-25002') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-1A","orderId":"251123-25001","itemCode":"FG-A"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2A","orderId":"251123-25002","itemCode":"FG-A","qtyPlanned":4,"qtyRequired":4}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2B","orderId":"251123-25002","itemCode":"FG-B","qtyPlanned":3,"qtyRequired":3}'::jsonb))), 'releaseOrder') is not null,
  'the planner releases the first two orders with their packing jobs');
select is(fgs_t.stock('FG-A'), 0::numeric, 'there is no finished-goods stock yet');

-- 5. รับส่วนเกินหลังปิดใบ (เพดานคือยอดที่ PK รายงาน) · สต็อกจากใบเดียว ---------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(fgs_t.report('JOB-1A', 20, 'done') is not null, 'PK packs 20 sets of A for an order of 10');
select ok(fgs_t.report('JOB-2A', 7, 'done') is not null, 'and 7 sets of A for an order of 4');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fgs_t.receive('251123-25003', 'FG-A', 1) $$, 'BOM_INVALID_TRANSITION', 'a draft still cannot receive goods');
select is(fgs_t.receive('251123-25001', 'FG-A', 10) -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'receiving the 10 ordered completes the order');
select is(fgs_t.free('251123-25001', 'FG-A'), 0::numeric, 'nothing beyond the order is free yet');
select set_config('test.v0', fgs_t.ver()::text, true);
select set_config('test.res', fgs_t.receive('251123-25001', 'FG-A', 10, 'ส่วนเกิน')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'receive', 'WH receives the 10 surplus sets after the order closed');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert', '[]'::jsonb, 'the completed order itself does not change');
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v0')::bigint + 1)::text, 'the version moved once');
select is(fgs_t.order_status('251123-25001'), 'completed', 'the order stays completed');
select is(fgs_t.audit(), 'fgMoves +1', 'the receipt after the close is audited as one move and no order');
select throws_ok($$ select fgs_t.receive('251123-25001', 'FG-A', 1) $$, 'BOM_FG_EXCEEDS', 'after the close the cap is still what PK reported (21 > 20)');
select is(fgs_t.free('251123-25001', 'FG-A'), 10::numeric, 'the 10 sets beyond the order are free');
select is(fgs_t.stock('FG-A'), 10::numeric, 'the stock of A comes from one order (10)');
select is(fgs_t.stock('FG-B'), 0::numeric, 'and B has none');

-- 6. สต็อกจากหลายใบ · ใบที่ยังเปิดก็เป็นต้นทางได้ · ส่งมอบน้อยกว่าที่สั่งไม่เปลี่ยนสต็อก --------------------------------------------
select is(fgs_t.receive('251123-25002', 'FG-A', 7) -> 'changes' -> 'orders' -> 'upsert', '[]'::jsonb, 'all 7 sets of A are received, B is still owed: the order stays open');
select is(fgs_t.order_status('251123-25002'), 'in_progress', 'the second order is in progress');
select is(fgs_t.free('251123-25002', 'FG-A'), 3::numeric, 'an open order has 3 free sets (7 - 4 ordered)');
select is(fgs_t.stock('FG-A'), 13::numeric, 'the stock of A comes from two orders (10 + 3)');
select ok(fgs_t.deliver('251123-25002', 'FG-A', 2) is not null, 'the second order delivers 2 of its 4 to its customer');
select is(fgs_t.free('251123-25002', 'FG-A'), 3::numeric, 'goods still owed to its own customer stay reserved (7 - max(4, 2))');
select is(fgs_t.stock('FG-A'), 13::numeric, 'so the stock does not change');
select is(fgs_t.free('251123-25003', 'FG-A'), 0::numeric, 'a draft holds no stock');

-- ใบที่สองปล่อยผลิตก่อน (released_at เก่ากว่า แม้เลข PI มากกว่า) · ในธุรกรรมเดียวกัน now() เท่ากันจึงเลื่อนด้วยสิทธิ์เจ้าของตาราง
reset role;
update public.bom_orders set released_at = released_at - interval '1 hour' where is_test and pi_no = '251123-25002';
set local role authenticated;
select ok((fgs_t.order_row('251123-25002') ->> 'releasedAt')::bigint < (fgs_t.order_row('251123-25001') ->> 'releasedAt')::bigint,
  'the second order is now the older release');

-- 7. ปล่อยผลิตหยิบสต็อกจากใบที่ปล่อยก่อน ---------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.v_d3', fgs_t.ver()::text, true);
select set_config('test.res', fgs_t.release('251123-25003', '{"stockCounts":{"FG-A":6}}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-3B","orderId":"251123-25003","itemCode":"FG-B","qtyPlanned":2,"qtyRequired":2}'::jsonb))::text, true);
select is(fgs_t.up_order(current_setting('test.res')::jsonb, '251123-25003') ->> 'status', 'released', 'A comes from stock, B is still made: the order is released');
select is(fgs_t.up_order(current_setting('test.res')::jsonb, '251123-25003') -> 'stockCounts', '{"FG-A":6}'::jsonb, 'the amount taken is kept in the stock counts');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert'), 2, 'one transfer per source order');
select is((select jsonb_agg(jsonb_build_array(m ->> 'kind', m ->> 'orderId', m ->> 'fromOrderId', m ->> 'fgCode', (m ->> 'qty')::numeric, m ->> 'note'))
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert') m),
  '[["transfer","251123-25003","251123-25002","FG-A",3,""],["transfer","251123-25003","251123-25001","FG-A",3,""]]'::jsonb,
  'the oldest release gives first (3 from 25002), the rest comes from the next one (3 from 25001)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'by', current_setting('test.n_sbx_pp_staff'), 'the transfer names the releaser');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0) k),
  array['at', 'by', 'fgCode', 'fromOrderId', 'id', 'kind', 'note', 'orderId', 'qty'], 'a transfer record has the contract fields plus fromOrderId');
select is(fgs_t.audit(), 'fgMoves +2, jobs +1, orders +1', 'the audit counts the two transfers as moves');
select is(fgs_t.stock('FG-A'), 7::numeric, 'the stock of A drops by 6 (13 - 6)');
select is(fgs_t.free('251123-25002', 'FG-A') || '/' || fgs_t.free('251123-25001', 'FG-A') || '/' || fgs_t.free('251123-25003', 'FG-A'), '0/7/0',
  'the older source is empty, the other has 7 left, and the taking order holds nothing free');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert'), 1, 'only the job for B was created');

-- 8. ใบต้นทาง: ส่งมอบของที่ใบอื่นหยิบไปไม่ได้ · ยกเลิก / เปิดกลับไม่ได้ ------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fgs_t.deliver('251123-25002', 'FG-A', 3) $$, 'BOM_FG_EXCEEDS',
  'the source cannot deliver what was taken (7 received - 3 taken - 2 delivered = 2 left)');
select ok(fgs_t.deliver('251123-25002', 'FG-A', 2) is not null, 'it delivers the 2 that are left');
select is(fgs_t.free('251123-25002', 'FG-A'), 0::numeric, 'and has nothing free');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.n0', fgs_t.n()::text, true);
select throws_ok($$ select fgs_t.set_status('251123-25002', 'cancelled', 'cancelOrder') $$, 'BOM_INVALID_TRANSITION', 'an order that gave stock away cannot be cancelled');
select throws_ok($$ select fgs_t.set_status('251123-25002', 'draft', 'updateOrderItem') $$, 'BOM_INVALID_TRANSITION', 'nor reopened');

-- 9. ใบที่หยิบ: ส่งมอบได้เท่าที่หยิบ · ส่งมอบแล้วยกเลิก / เปิดกลับไม่ได้ · ปิดเองเมื่อ have ครบ ------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fgs_t.receive('251123-25003', 'FG-A', 1) $$, 'BOM_FG_EXCEEDS', 'stock taken is not a receipt: A has no PK output to receive');
select throws_ok($$ select fgs_t.deliver('251123-25003', 'FG-A', 7) $$, 'BOM_FG_EXCEEDS', 'the taking order cannot deliver more than it took (6)');
select ok(fgs_t.deliver('251123-25003', 'FG-A', 6, 'ส่งจากสต็อก') is not null, 'it delivers the 6 it took');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select fgs_t.set_status('251123-25003', 'cancelled', 'cancelOrder') $$, 'BOM_INVALID_TRANSITION',
  'an order with a delivery cannot be cancelled (its only job has not started)');
select throws_ok($$ select fgs_t.set_status('251123-25003', 'draft', 'updateOrderItem') $$, 'BOM_INVALID_TRANSITION', 'nor reopened');
select is(fgs_t.n(), current_setting('test.n0')::integer + 1, 'the refusals wrote no untransfer (only the delivery of the 6 is new)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(fgs_t.report('JOB-3B', 2, 'done') is not null, 'PK packs the 2 sets of B');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select set_config('test.res', fgs_t.receive('251123-25003', 'FG-B', 2)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed',
  'receiving B completes the order: A counts what was taken from stock (have 6 of 6, own 0)');
select is(fgs_t.audit(), 'fgMoves +1, orders +1', 'the closing receipt is audited with the order');

-- 10. คีย์สินค้าใน stockCounts: กลุ่มวางแผนเท่านั้น · ST / WH นับชิ้นอื่นได้ (ใบ 25004 สั่ง A 9) -----------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select is(fgs_t.counts('251123-25004', '{"SE-A":5}'::jsonb) -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts', '{"SE-A":5}'::jsonb,
  'ST staff counts another item of a draft');
select throws_ok($$ select fgs_t.counts('251123-25004', '{"SE-A":5,"FG-A":1}'::jsonb) $$, 'BOM_FORBIDDEN', 'ST staff cannot set the amount of a product taken from stock');
select is(fgs_t.counts('251123-25004', '{"SE-A":5,"FG-B":1}'::jsonb) -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts', '{"FG-B":1,"SE-A":5}'::jsonb,
  'a finished good that is not a product of this order is just another counted item');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fgs_t.counts('251123-25004', '{"SE-A":6,"FG-B":1,"FG-A":1}'::jsonb) $$, 'BOM_FORBIDDEN', 'WH staff cannot set it either');
select is(fgs_t.counts('251123-25004', '{"SE-A":6,"FG-B":1}'::jsonb) -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts', '{"FG-B":1,"SE-A":6}'::jsonb,
  'WH staff still count the other items');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(fgs_t.counts('251123-25004', '{"SE-A":6,"FG-B":1,"FG-A":2}'::jsonb) -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts' -> 'FG-A', '2'::jsonb,
  'the planner sets the amount of A to take from stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select fgs_t.counts('251123-25004', '{"SE-A":7,"FG-B":1}'::jsonb) $$, 'BOM_FORBIDDEN', 'ST staff cannot clear the amount the planner set');
select is(fgs_t.counts('251123-25004', '{"SE-A":7,"FG-B":1,"FG-A":2}'::jsonb) -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts', '{"FG-A":2,"FG-B":1,"SE-A":7}'::jsonb,
  'ST staff may recount other items while the product amount stays as it is');

-- 11. ปล่อยผลิต: เกินจำนวนสั่ง / สต็อกไม่พอ / หยิบบางส่วนยังต้องมีงาน (ทุกกรณีไม่เขียนอะไร) ---------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.n1', fgs_t.n()::text, true);
select set_config('test.v1', fgs_t.ver()::text, true);
select throws_ok($$ select fgs_t.release('251123-25004', '{"stockCounts":{"SE-A":7,"FG-B":1,"FG-A":10}}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-4X","orderId":"251123-25004","qtyPlanned":1,"qtyRequired":9}'::jsonb)) $$,
  'BOM_INVALID_ORDER', 'taking more than the ordered quantity (10 > 9) is refused');
select throws_ok($$ select fgs_t.release('251123-25004', '{"stockCounts":{"SE-A":7,"FG-B":1,"FG-A":8}}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-4X","orderId":"251123-25004","qtyPlanned":1,"qtyRequired":9}'::jsonb)) $$,
  'BOM_FG_EXCEEDS', 'taking more than the stock (8 > 7) is refused');
select throws_ok($$ select fgs_t.release('251123-25004', '{}'::jsonb) $$, 'BOM_INVALID_TRANSITION',
  'an order that still has to make 7 of A cannot be released without a job');
select is(fgs_t.n(), current_setting('test.n1')::integer, 'none of the refused releases wrote a transfer');
select is(fgs_t.ver(), current_setting('test.v1')::bigint, 'nor moved the version');
select is(fgs_t.order_status('251123-25004') || ' ' || fgs_t.stock('FG-A'), 'draft 7', 'the order is still a draft and the stock is still 7');

-- 12. ยกเลิก / เปิดกลับคืนสต็อก (ใบ 25004 หยิบ A 2) -----------------------------------------------------------------------------
select set_config('test.res', fgs_t.release('251123-25004', '{}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-4A","orderId":"251123-25004","qtyPlanned":7,"qtyRequired":9,"stockCounted":2}'::jsonb))::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'the order is released with a job for the 7 it still makes');
select is((select jsonb_agg(jsonb_build_array(m ->> 'kind', m ->> 'fromOrderId', (m ->> 'qty')::numeric))
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert') m),
  '[["transfer","251123-25001",2]]'::jsonb, 'it takes 2 from the only order with free stock');
select is(fgs_t.stock('FG-A'), 5::numeric, 'the stock drops to 5');
select set_config('test.res', fgs_t.set_status('251123-25004', 'draft', 'updateOrderItem')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'draft', 'the order is reopened');
select is((select jsonb_agg(jsonb_build_array(m ->> 'kind', m ->> 'orderId', m ->> 'fromOrderId', m ->> 'fgCode', (m ->> 'qty')::numeric))
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert') m),
  '[["untransfer","251123-25004","251123-25001","FG-A",2]]'::jsonb, 'reopening writes an untransfer back to the source');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts' -> 'FG-A', '2'::jsonb, 'the amount to take is kept on the draft');
select is(fgs_t.audit(), 'fgMoves +1, orders +1', 'the untransfer is audited as a move');
select is(fgs_t.stock('FG-A'), 7::numeric, 'the stock is back to 7');
select ok(fgs_t.release('251123-25004', '{}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-4B","orderId":"251123-25004","qtyPlanned":7,"qtyRequired":9,"stockCounted":2}'::jsonb)) is not null,
  'the order is released again');
select is(fgs_t.stock('FG-A'), 5::numeric, 'and takes the 2 again');
select set_config('test.res', fgs_t.set_status('251123-25004', 'cancelled', 'cancelOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'then cancelled');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'untransfer', 'cancelling returns the stock too');
select is(fgs_t.stock('FG-A'), 7::numeric, 'the stock is 7 again');
select is((select jsonb_agg(m ->> 'kind') from jsonb_array_elements(fgs_t.moves('251123-25004')) m), '["transfer","untransfer","transfer","untransfer"]'::jsonb,
  'the history of the order shows both rounds');
select is(fgs_t.free('251123-25004', 'FG-A'), 0::numeric, 'a cancelled order holds no stock');

-- 13. ใบที่มาจากสต็อกทั้งหมด: completed ตอนปล่อยโดยไม่มีงาน (ใบ 25005 สั่ง A 2) ------------------------------------------------------
select set_config('test.res', fgs_t.release('251123-25005', '{"stockCounts":{"FG-A":2}}'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'an order fully covered by stock completes at release');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ?& array['releasedAt', 'completedAt'], 'with both the release and the completion time');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert', '[]'::jsonb, 'without any job');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'fromOrderId', '251123-25001', 'taking 2 from the order with free stock');
select is(fgs_t.audit(), 'fgMoves +1, orders +1', 'audited with the transfer and the order');
select is(fgs_t.stock('FG-A'), 5::numeric, 'the stock drops to 5');
select throws_ok($$ select fgs_t.set_status('251123-25005', 'cancelled', 'cancelOrder') $$, 'BOM_INVALID_TRANSITION', 'a completed order cannot be cancelled');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select fgs_t.receive('251123-25005', 'FG-A', 1) $$, 'BOM_FG_EXCEEDS', 'nothing can be received for it (no PK output)');
select ok(fgs_t.deliver('251123-25005', 'FG-A', 2) is not null, 'WH delivers the 2 it took');
select throws_ok($$ select fgs_t.deliver('251123-25005', 'FG-A', 1) $$, 'BOM_FG_EXCEEDS', 'and no more');

-- 14. ด่านของ #369 เทียบกับ own · ปิดรับไม่ครบใช้ have (ใบ 25006 สั่ง A 5 หยิบ 2) --------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(fgs_t.release('251123-25006', '{"stockCounts":{"FG-A":2}}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-6A","orderId":"251123-25006","qtyPlanned":3,"qtyRequired":5,"stockCounted":2}'::jsonb))
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'an order taking 2 of 5 from stock is released with a job for 3');
select is(fgs_t.stock('FG-A'), 3::numeric, 'the stock drops to 3');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(fgs_t.report('JOB-6A', 2, 'in_progress') is not null, 'PK reports 2 of the 3 planned');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
-- ปิดงานก่อนถึงยอดแผนต้องมีเหตุผลเสมอ (20261126010000): ฝ่ายวางแผนปิดงานด้วยรายการรายงานยอด 0 พร้อมเหตุผล
select ok(fgs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  fgs_t.job('JOB-6A') || jsonb_build_object('status', 'done', 'reports', (fgs_t.job('JOB-6A') -> 'reports') || '[{"at":1,"by":"x","good":0,"reject":0,"note":"ผลิตได้ไม่ครบ"}]'::jsonb)))), 'setJobStatus') is not null,
  'the planner closes the PK job at 2 of the 3 planned with a reason');
-- ตั้งแต่ 20261129010000 ไม่มีใครลดยอดได้โดยไม่มีรายงาน (ผลรวมของรายการใหม่ต้องเท่าส่วนที่เปลี่ยน) แม้ด่านยอด PK เทียบกับ own (0) จะยอมก็ตาม: bom_group2_rules.test.sql
select throws_ok($$ select fgs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(fgs_t.job('JOB-6A') || '{"qtyDone":1}'::jsonb))), 'reportJob') $$,
  'BOM_INVALID_JOB', 'nothing received yet, but the planner cannot lower the output without a report entry');
select is((fgs_t.job('JOB-6A') ->> 'qtyDone')::numeric, 2::numeric, 'the PK output stays at 2');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select is(fgs_t.receive('251123-25006', 'FG-A', 2) -> 'changes' -> 'orders' -> 'upsert', '[]'::jsonb, 'have 4 of 5 (2 made + 2 from stock): the order stays open');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select fgs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(fgs_t.job('JOB-6A') || '{"qtyDone":1}'::jsonb))), 'reportJob') $$,
  'BOM_INVALID_JOB', 'after the receipt the PK output cannot drop below own (1 < 2)');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select is(fgs_t.close_short('251123-25006', 'ผลิตได้ไม่ครบ') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed',
  'own equals the PK output and have (4) is below the order (5): WH closes it short');
select is(fgs_t.free('251123-25006', 'FG-A'), 0::numeric, 'a short order holds no stock');

-- 15. ส่วนเกินที่ไม่มีใครหยิบส่งให้ลูกค้าของใบเดิมได้ (ใบ 25001: รับ 20 สั่ง 10 ให้ไป 7) -----------------------------------------------
select is(fgs_t.stock('FG-A'), 3::numeric, 'the stock of A is what 25001 has left (20 - 7 taken - 10 ordered)');
select throws_ok($$ select fgs_t.deliver('251123-25001', 'FG-A', 14) $$, 'BOM_FG_EXCEEDS', 'the source delivers at most what it has minus what was taken (13)');
select ok(fgs_t.deliver('251123-25001', 'FG-A', 13, 'ส่งส่วนเกินให้ลูกค้าเดิม') is not null, 'it delivers 13, more than its order of 10');
select is(fgs_t.stock('FG-A'), 0::numeric, 'the stock is used up');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select fgs_t.release('251123-25004', '{}'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a cancelled order cannot be released (status first)');

-- 16. snapshot / delta ---------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 14::bigint, 'the snapshot still has fourteen lists');
select is((select array_agg(k order by k) from jsonb_object_keys((select m from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m where m ->> 'kind' = 'receive' limit 1)) k),
  array['at', 'by', 'fgCode', 'id', 'kind', 'note', 'orderId', 'qty'], 'a receive record keeps its eight fields (no fromOrderId)');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m where m ->> 'kind' in ('receive', 'deliver', 'close') and m ? 'fromOrderId'),
  'no receive, delivery or close carries a source order');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m
                      where m ->> 'kind' in ('transfer', 'untransfer') and coalesce(m ->> 'fromOrderId', '') !~ '^251123-2500[12]$'),
  'every transfer and untransfer names its source order');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m where m ->> 'kind' = 'transfer'), 6,
  'six transfers were written (two for 25003, two rounds for 25004, one each for 25005 and 25006)');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m where m ->> 'kind' = 'untransfer'), 2, 'and two untransfers');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master_since(current_setting('test.v_d3')::bigint) -> 'changes' -> 'fgMoves' -> 'upsert') m
           where m ->> 'kind' = 'transfer' and m ->> 'orderId' = '251123-25003'), 2, 'a delta from before the release carries its transfers');
select is(public.app_bom_master_since(0) -> 'changes' -> 'fgMoves', jsonb_build_object('upsert', public.app_bom_master() -> 'fgMoves', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the move snapshot');

-- 17. ความสอดคล้องของตาราง (นับด้วยสิทธิ์เจ้าของตาราง) -----------------------------------------------------------------------------
reset role;
select ok(not exists (select 1 from public.bom_fg_moves where is_test and ((kind in ('transfer', 'untransfer')) <> (from_order_pk is not null))),
  'exactly the transfers and untransfers have a source order');
select ok(not exists (
    select 1 from (
      select m.order_pk, m.from_order_pk, m.fg_code, sum(case when m.kind = 'transfer' then m.qty else -m.qty end) as net
      from public.bom_fg_moves m where m.is_test and m.kind in ('transfer', 'untransfer') group by 1, 2, 3) t
    where t.net < 0),
  'no order returned more than it took from a source');
select ok(not exists (
    select 1 from public.bom_orders o cross join lateral jsonb_array_elements(o.items) it
    where o.is_test and private.bom_fg_in(o.id, it ->> 'fgCode') > (it ->> 'qty')::numeric),
  'no order holds more from stock than it ordered');
select ok(not exists (
    select 1 from public.bom_orders o cross join lateral jsonb_array_elements(o.items) it
    where o.is_test and private.bom_fg_total(o.id, it ->> 'fgCode', 'deliver')
                        > private.bom_fg_have(o.id, it ->> 'fgCode') - private.bom_fg_out(o.id, it ->> 'fgCode')),
  'no order delivered more than it has minus what it gave away');
select is((select count(*) from public.bom_orders where is_test and status = 'completed'), 4::bigint,
  'four orders are completed (25001 and 25003 by receipt, 25005 from stock at release, 25006 short)');
select is((select count(*) from public.bom_fg_moves where not is_test), 3::bigint, 'the real moves are untouched');
set local role authenticated;

-- 18. ด่านของ 20261124010000 (หลังข้อ 16 / 17 ที่นับแถวและใบ จึงไม่กระทบตัวเลขข้างบน) -------------------------------------------------------
-- ใบที่ปล่อยผลิตแล้วได้ครบจากสต็อกต้องไม่มีงาน · ผิดทั้งที่ใบและที่งานได้รหัสของใบก่อน · สองสินค้าได้ครบจากสต็อก · สองใบในคำสั่งเดียวแย่งสต็อกเดียวกัน
-- ใบต้นทางใหม่ 25007 (สั่ง A 1 B 1 · PK ทำ A 4 B 3 · รับครบ) ให้สต็อก A 3 B 2 (ใบอื่นไม่เหลือสต็อกแล้วหลังข้อ 15)
select set_config('request.jwt.claims', '{"sub":"8e400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(fgs_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25007', 'items', '[{"fgCode":"FG-A","qty":1,"colorSet":"A","note":""},{"fgCode":"FG-B","qty":1,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":1,"required":1},{"itemCode":"FG-B","level":0,"fgQty":1,"required":1}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25008', 'items', '[{"fgCode":"FG-A","qty":2,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":2,"required":2}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25009', 'items', '[{"fgCode":"FG-A","qty":4,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":4,"required":4}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25010', 'items', '[{"fgCode":"FG-A","qty":1,"colorSet":"A","note":""},{"fgCode":"FG-B","qty":2,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":1,"required":1},{"itemCode":"FG-B","level":0,"fgQty":2,"required":2}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25011', 'items', '[{"fgCode":"FG-A","qty":2,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":2,"required":2}]'::jsonb),
    current_setting('test.ord')::jsonb || jsonb_build_object('id', '251123-25012', 'items', '[{"fgCode":"FG-A","qty":2,"colorSet":"A","note":""}]'::jsonb,
      'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":2,"required":2}]'::jsonb)))), 'createOrder') is not null,
  'the planner creates six more drafts');
select is(fgs_t.up_order(fgs_t.release('251123-25007', '{}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-7A","orderId":"251123-25007","itemCode":"FG-A","qtyPlanned":1,"qtyRequired":1}'::jsonb,
  current_setting('test.job')::jsonb || '{"id":"JOB-7B","orderId":"251123-25007","itemCode":"FG-B","qtyPlanned":1,"qtyRequired":1}'::jsonb)), '251123-25007') ->> 'status',
  'released', 'a new source order is released with its packing jobs');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(fgs_t.report('JOB-7A', 4, 'done') is not null, 'PK packs 4 sets of A for an order of 1');
select ok(fgs_t.report('JOB-7B', 3, 'done') is not null, 'and 3 sets of B for an order of 1');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select ok(fgs_t.receive('251123-25007', 'FG-A', 4) is not null, 'WH receives the 4 sets of A');
select is(fgs_t.up_order(fgs_t.receive('251123-25007', 'FG-B', 3), '251123-25007') ->> 'status', 'completed', 'and the 3 of B, which completes the order');
select is(fgs_t.stock('FG-A') || '/' || fgs_t.stock('FG-B'), '3/2', 'the stock is 3 sets of A and 2 of B, all from the new order');

-- 18.1 ปฏิเสธ: ใบที่การปล่อยผลิตปิดให้ (ได้ครบจากสต็อก) มากับงาน · ผิดทั้งที่ใบและที่งาน (ทุกกรณีไม่เขียนอะไร)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.n2', fgs_t.n()::text, true);
select set_config('test.v2', fgs_t.ver()::text, true);
select throws_ok($$ select fgs_t.release('251123-25008', '{"stockCounts":{"FG-A":2}}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-8A","orderId":"251123-25008","itemCode":"FG-A","qtyPlanned":2,"qtyRequired":2}'::jsonb)) $$,
  'BOM_INVALID_TRANSITION', 'an order the release completes from stock cannot carry a job (it could never be worked)');
select throws_ok($$ select fgs_t.release('251123-25008', '{"stockCounts":{"FG-A":3}}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-8A","orderId":"251123-25008","itemCode":"FG-A","qtyPlanned":2,"qtyRequired":2,"status":"done"}'::jsonb)) $$,
  'BOM_INVALID_ORDER', 'wrong at the order (3 for 2 ordered) and at the job (a new job that is done): the order''s code comes first');
select throws_ok($$ select fgs_t.release('251123-25009', '{"stockCounts":{"FG-A":4}}'::jsonb, jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-9A","orderId":"251123-25009","itemCode":"FG-A","qtyPlanned":1,"qtyRequired":4,"status":"done"}'::jsonb)) $$,
  'BOM_FG_EXCEEDS', 'more than the stock (4 > 3) with a new job sent as done: the stock''s code comes first');
select is(fgs_t.n() || '/' || fgs_t.ver(), current_setting('test.n2') || '/' || current_setting('test.v2'), 'none of them wrote a move or moved the version');
select is(fgs_t.order_status('251123-25008') || ' ' || fgs_t.order_status('251123-25009') || ' ' || fgs_t.stock('FG-A'), 'draft draft 3',
  'both orders are still drafts and the stock is still 3');
select ok(fgs_t.job('JOB-8A') is null and fgs_t.job('JOB-9A') is null, 'and no job was created');

-- 18.2 อนุญาต: สองสินค้าได้ครบจากสต็อก ใบปิดตอนปล่อยโดยไม่มีงาน (ใบ 25010 สั่ง A 1 B 2)
select set_config('test.res', fgs_t.release('251123-25010', '{"stockCounts":{"FG-A":1,"FG-B":2}}'::jsonb)::text, true);
select is(fgs_t.up_order(current_setting('test.res')::jsonb, '251123-25010') ->> 'status', 'completed', 'an order with two products, both covered by stock, completes at release');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert', '[]'::jsonb, 'without any job');
select is((select jsonb_agg(jsonb_build_array(m ->> 'fgCode', (m ->> 'qty')::numeric, m ->> 'fromOrderId') order by m ->> 'fgCode')
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert') m),
  '[["FG-A",1,"251123-25007"],["FG-B",2,"251123-25007"]]'::jsonb, 'one transfer per product, both from the new source');
select is(fgs_t.audit(), 'fgMoves +2, orders +1', 'audited with the two transfers and the order');
select is(fgs_t.stock('FG-A') || '/' || fgs_t.stock('FG-B'), '2/0', 'the stock drops to 2 sets of A and none of B');

-- 18.3 สองใบในคำสั่งเดียวแย่งสต็อก A 2: แถวแรก (25011 ใช้ 1 ผลิต 1) หยิบก่อน แถวที่สอง (25012 ใช้ 2) เหลือ 1 ไม่พอ ทั้งคำสั่งไม่เขียน
select set_config('test.n3', fgs_t.n()::text, true);
select set_config('test.v3', fgs_t.ver()::text, true);
select throws_ok($$ select fgs_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    fgs_t.order_row('251123-25011') || '{"status":"released","stockCounts":{"FG-A":1}}'::jsonb,
    fgs_t.order_row('251123-25012') || '{"status":"released","stockCounts":{"FG-A":2}}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-11A","orderId":"251123-25011","itemCode":"FG-A","qtyPlanned":1,"qtyRequired":2,"stockCounted":1}'::jsonb))), 'releaseOrder') $$,
  'BOM_FG_EXCEEDS', 'two orders released in one save: the first row takes 1 of the 2, the second needs 2 and finds 1 (each alone would fit)');
select is(fgs_t.n() || '/' || fgs_t.ver(), current_setting('test.n3') || '/' || current_setting('test.v3'), 'nothing of the whole save was written');
select is(fgs_t.order_status('251123-25011') || ' ' || fgs_t.order_status('251123-25012') || ' ' || fgs_t.stock('FG-A'), 'draft draft 2',
  'both orders are still drafts and the stock is still 2');
select ok(fgs_t.job('JOB-11A') is null, 'the job of the first row was not kept either');
select is(fgs_t.up_order(fgs_t.release('251123-25012', '{"stockCounts":{"FG-A":2}}'::jsonb), '251123-25012') ->> 'status', 'completed',
  'released alone, the second order takes the 2 and completes');
select is(fgs_t.stock('FG-A'), 0::numeric, 'the stock of A is used up');

-- 19. ล้างข้อมูลทดสอบ (ประวัติที่ชี้ใบต้นทางก็ลบก่อนใบ) -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8e400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok((public.app_sandbox_purge_bom() ->> 'deleted')::integer > 20, 'the purge deletes the test rows');
select is(public.app_bom_master() -> 'fgMoves', '[]'::jsonb, 'no move is left, transfers included');
select is(public.app_bom_master() -> 'orders', '[]'::jsonb, 'nor an order');
reset role;
select is((select count(*) from public.bom_fg_moves where is_test), 0::bigint, 'no test move is left in the table');
select is((select count(*) from public.bom_fg_moves where not is_test), 3::bigint, 'the real moves survive the purge');
select is((select count(*) from public.bom_orders where not is_test and pi_no like 'REAL-FGS-%'), 2::bigint, 'and so do the real orders');

select * from finish();
rollback;
