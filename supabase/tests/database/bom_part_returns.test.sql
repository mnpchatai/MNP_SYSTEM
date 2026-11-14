-- คืนของซื้อเข้าสต็อก (20261112010000_bom_part_returns.sql): ยกเลิกการเบิกจ่ายทั้งใบ PI (undoOrderParts) และคืนของเหลือ (returnOrderParts)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง (kind 'return', note), รูป payload, รูปแถว/เหตุผล, ชนรายระเบียนก่อนสิทธิ์, สิทธิ์ (RB / WH ไม่ได้ ST / กลุ่มวางแผนได้), เพดานยอดที่คืนได้,
-- ทั้งชุดผ่านหรือไม่ผ่านพร้อมกัน, ยกเลิกการเบิกจ่ายแล้วงานกลับไปรอเบิกจ่าย / ยกเลิกใบได้ / เบิกจ่ายใหม่แล้วนับยอดคืนใหม่, ใบที่ปิดแล้วคืนของเหลือได้แต่ยกเลิกการเบิกจ่ายไม่ได้, ใบที่ยกเลิกคืนไม่ได้,
-- ประวัติมี note ใน snapshot · authenticated อ่านตาราง bom_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role (สิทธิ์เจ้าของตาราง) เท่านั้น
-- ข้อควรระวัง: ถ้าอ่านตารางตรงในนาม authenticated จะเกิด 42501 และทำให้ทั้งไฟล์ล้ม ("No plan found") ตรวจฝั่ง client ผ่าน RPC และตรวจ deny ด้วย throws_ok เท่านั้น
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและรายการ action ------------------------------------------------------------
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_stock_moves'::regclass and c.conname = 'bom_stock_moves_kind_check'
                  and pg_get_constraintdef(c.oid) like '%''return''%' and pg_get_constraintdef(c.oid) like '%''issue''%'),
  'the move kinds still include count, receive and issue, and now return');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_stock_moves' and column_name = 'note' and is_nullable = 'YES'),
  'the move table has a nullable note column');
select throws_ok($$ insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, note) values (true, 'CK-1', 'bogus', 1, 1, null) $$, '23514', null, 'an unknown move kind is still refused');
select throws_ok($$ insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, note) values (true, 'CK-1', 'count', 1, 1, 'เหตุผล') $$, '23514', null, 'only a return move carries a note');
select throws_ok($$ insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, note) values (true, 'CK-1', 'return', 1, 1, '') $$, '23514', null, 'an empty note is refused (null means none)');
select throws_ok($$ insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, note) values (true, 'CK-1', 'return', 1, 1, repeat('ก', 201)) $$, '23514', null, 'a note above 200 characters is refused');
select ok(array['undoOrderParts', 'returnOrderParts', 'issueOrderParts', 'countPartStock', 'reportJob'] <@ private.bom_client_actions()
          and array['undoOrderParts', 'returnOrderParts', 'issueOrderParts', 'countPartStock', 'reportJob'] <@ private.bom_staff_actions(),
  'both return actions are on the client and staff whitelists next to the earlier ones');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_return_parts(public.employees,text,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the return writer and the replaced RPC are security definer with an empty search_path');
select ok(not exists (select 1 from unnest(array['public.app_bom_save_master(jsonb,bigint,text,jsonb,text)']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the replaced RPC keeps its grants (signed-in users only)');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname in ('bom_return_parts', 'bom_part_returned', 'bom_stock_add_return')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the return helpers directly');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. บัญชีทดสอบ ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8e200000-0000-0000-0000-000000000001', 'bompr-admin@test.local', '{}'),
  ('8e200000-0000-0000-0000-000000000002', 'bompr-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e200000-0000-0000-0000-000000000101', 'BOMPR-ADMIN', 'Bompr', 'Admin', 'bompr-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e200000-0000-0000-0000-000000000001'),
  ('8e200000-0000-0000-0000-000000000102', 'BOMPR-STAFF-REAL', 'Bompr', 'Staff', 'bompr-staff@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8e200000-0000-0000-0000-000000000002');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;

-- ตัวช่วยของเทสต์ (schema แยก ลบพร้อม rollback): รันในฐานะผู้เรียก (authenticated) ผ่าน RPC สาธารณะเท่านั้น
create schema pr_t;
grant usage on schema pr_t to authenticated;
create function pr_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function pr_t.save(p_changes jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, coalesce(p_base, pr_t.ver()), p_action)
$$;
create function pr_t.count_stock(p_rows jsonb) returns jsonb language sql volatile as $$
  select pr_t.save(jsonb_build_object('stock', jsonb_build_object('upsert', p_rows)), 'countPartStock')
$$;
create function pr_t.qty(p_code text) returns numeric language sql stable as $$
  select (s ->> 'qty')::numeric from jsonb_array_elements(public.app_bom_master() -> 'stock') s where s ->> 'itemCode' = p_code
$$;
create function pr_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
create function pr_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function pr_t.order_status(p_no text) returns text language sql stable as $$ select pr_t.order_row(p_no) ->> 'status' $$;
create function pr_t.done(p_no text) returns jsonb language sql stable as $$
  select pr_t.job(p_no) || jsonb_build_object('status', 'done', 'qtyDone', (pr_t.job(p_no) ->> 'qtyPlanned')::numeric)
$$;
create function pr_t.issue(p_jobs jsonb) returns jsonb language sql volatile as $$
  select pr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', p_jobs)), 'issueOrderParts')
$$;
create function pr_t.ret(p_row jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select pr_t.save(jsonb_build_object('partReturns', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action, p_base)
$$;
create function pr_t.undo(p_reason text default 'เบิกผิดใบ', p_base bigint default null, p_order text default '251112-25001') returns jsonb language sql volatile as $$
  select pr_t.ret(jsonb_build_object('orderId', p_order, 'mode', 'undo', 'reason', p_reason), 'undoOrderParts', p_base)
$$;
create function pr_t.leftover(p_lines jsonb, p_reason text default 'ใช้ไม่หมด', p_base bigint default null, p_order text default '251112-25001') returns jsonb language sql volatile as $$
  select pr_t.ret(jsonb_build_object('orderId', p_order, 'mode', 'leftover', 'reason', p_reason, 'lines', p_lines), 'returnOrderParts', p_base)
$$;
create function pr_t.move_count(p_code text, p_kind text default null) returns integer language sql stable as $$
  select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m where m ->> 'itemCode' = p_code and (p_kind is null or m ->> 'kind' = p_kind)
$$;
create function pr_t.has_return(p_code text, p_qty numeric, p_balance numeric, p_ref text, p_by text, p_note text) returns boolean language sql stable as $$
  select exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m
                 where m ->> 'itemCode' = p_code and m ->> 'kind' = 'return' and (m ->> 'qty')::numeric = p_qty and (m ->> 'balance')::numeric = p_balance
                   and m ->> 'ref' = p_ref and m ->> 'by' = p_by and m ->> 'note' = p_note)
$$;

select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"ST":1763000000000,"PK":1764000000000},"dueDefaults":[],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"ST","itemCode":"P-1","name":"กล่อง","kind":"PURCHASED","uom":"box","qtyPlanned":30,"qtyRequired":30,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select set_config('test.expl', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10},{"itemCode":"P-1","level":1,"fgQty":10,"required":30},{"itemCode":"P-2","level":1,"fgQty":10,"required":12.5}]', true);

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"partReturns":{"upsert":[]}}'::jsonb, 0, 'undoOrderParts') $$, 'AUTH_REQUIRED', 'returning requires a session');
select set_config('request.jwt.claims', '{"sub":"8e200000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"partReturns":{"upsert":[{"orderId":"X","mode":"undo","reason":"x"}]}}'::jsonb, 0, 'undoOrderParts') $$, 'BOM_TEST_MODE_ONLY',
  'a real PP staff account cannot return parts (real mode is not open)');
select set_config('request.jwt.claims', '{"sub":"8e200000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"partReturns":{"upsert":[{"orderId":"X","mode":"undo","reason":"x"}]}}'::jsonb, 0, 'returnOrderParts') $$, 'BOM_TEST_MODE_ONLY',
  'an admin outside test mode cannot return parts');

-- 4. ข้อมูลตั้งต้น: ใบที่ปล่อยผลิตพร้อมงานของซื้อสองงาน ST นับสต็อกและเบิกจ่าย -----------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"},
  {"code":"P-2","kind":"PURCHASED","name":"เม็ดสี","ownerDept":"ST","uom":"kg"},
  {"code":"P-3","kind":"PURCHASED","name":"เทปกาว","ownerDept":"ST","uom":"roll"}]}}'::jsonb, 0, 'importFlat') ->> 'version', '1', 'the planner seeds the item master');
select ok(pr_t.save(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251112-25001"}'::jsonb))), 'createOrder') is not null, 'the planner creates the order');
select ok(pr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  pr_t.order_row('251112-25001') || jsonb_build_object('items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb)))), 'explodeOrder') is not null,
  'and explodes it');
select ok(pr_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(pr_t.order_row('251112-25001') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-ST-P1","orderId":"251112-25001","itemCode":"P-1"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-ST-P2","orderId":"251112-25001","itemCode":"P-2","name":"เม็ดสี","uom":"kg","qtyPlanned":12.5,"qtyRequired":12.5}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-PK-A","orderId":"251112-25001","dept":"PK","itemCode":"FG-A","name":"สินค้า A","kind":"FG","uom":"set","qtyPlanned":10,"qtyRequired":10}'::jsonb))),
  'releaseOrder') is not null, 'and releases it with two purchased-part jobs');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(pr_t.count_stock('[{"itemCode":"P-1","qty":100},{"itemCode":"P-2","qty":40}]'::jsonb) is not null, 'ST counts the stock (100 boxes, 40 kg of pigment)');
select set_config('test.v_pre', pr_t.ver()::text, true);
select ok(pr_t.issue(jsonb_build_array(pr_t.done('JOB-ST-P1'), pr_t.done('JOB-ST-P2'))) is not null, 'ST issues both part jobs');
select is(pr_t.qty('P-1'), 70::numeric, 'the first part dropped by 30');
select is(pr_t.qty('P-2'), 27.5::numeric, 'and the second by 12.5');
select is(pr_t.order_status('251112-25001'), 'in_progress', 'the order is in progress');

-- 5. ปฏิเสธ: รูป payload · รูปแถว · ไม่มีของให้คืน · เพดาน · ชน · สิทธิ์ -------------------------------------------
select set_config('test.v0', pr_t.ver()::text, true);
select set_config('test.s0', (select count(*) from jsonb_array_elements(public.app_bom_master() -> 'stockMoves'))::text, true);
-- 5.1 รูป payload
select throws_ok($$ select pr_t.save('{"partReturns":{"upsert":[{"orderId":"251112-25001","mode":"undo","reason":"x"}]}}'::jsonb, 'countPartStock') $$, 'BOM_INVALID_PAYLOAD', 'partReturns can only be sent with the return actions');
select throws_ok($$ select pr_t.save('{"partReturns":{"upsert":[{"orderId":"251112-25001","mode":"undo","reason":"x"}]}}'::jsonb, 'issueOrderParts') $$, 'BOM_INVALID_PAYLOAD', 'nor with the issue');
select throws_ok($$ select pr_t.save('{"partReturns":{"delete":[]}}'::jsonb, 'undoOrderParts') $$, 'BOM_INVALID_PAYLOAD', 'partReturns has no deletes');
select throws_ok($$ select pr_t.save(jsonb_build_object('partReturns', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('orderId', '251112-25001', 'mode', 'undo', 'reason', 'x'))),
  'customers', jsonb_build_object('upsert', '[{"name":"ZED"}]'::jsonb)), 'undoOrderParts') $$, 'BOM_INVALID_PAYLOAD', 'a return cannot carry another list');
select throws_ok($$ select pr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(pr_t.job('JOB-ST-P1')))), 'undoOrderParts') $$, 'BOM_INVALID_PAYLOAD',
  'an undo cannot send job rows (the server resets the jobs itself)');
select throws_ok($$ select pr_t.save(jsonb_build_object('stock', jsonb_build_object('upsert', '[{"itemCode":"P-1","qty":999}]'::jsonb)), 'returnOrderParts') $$, 'BOM_INVALID_PAYLOAD',
  'nor stock rows (the server computes the balances)');
-- 5.2 รูปแถว
select throws_ok($$ select pr_t.undo('') $$, 'BOM_INVALID_RETURN', 'a reason is required');
select throws_ok($$ select pr_t.undo('   ') $$, 'BOM_INVALID_RETURN', 'a blank reason is refused');
select throws_ok($$ select pr_t.undo(repeat('ก', 201)) $$, 'BOM_INVALID_RETURN', 'a reason above 200 characters is refused');
select throws_ok($$ select pr_t.ret('{"orderId":"251112-25001","mode":"bogus","reason":"x"}'::jsonb, 'undoOrderParts') $$, 'BOM_INVALID_RETURN', 'an unknown mode is refused');
select throws_ok($$ select pr_t.ret('{"orderId":"NOPE","mode":"undo","reason":"x"}'::jsonb, 'undoOrderParts') $$, 'BOM_INVALID_RETURN', 'an unknown order is refused');
select throws_ok($$ select pr_t.ret('{"mode":"undo","reason":"x"}'::jsonb, 'undoOrderParts') $$, 'BOM_INVALID_RETURN', 'a row without an order is refused');
select throws_ok($$ select pr_t.ret('{"orderId":"251112-25001","mode":"undo","reason":"x","lines":[{"itemCode":"P-1","qty":1}]}'::jsonb, 'undoOrderParts') $$, 'BOM_INVALID_RETURN', 'an undo carries no lines');
select throws_ok($$ select pr_t.save('{"partReturns":{"upsert":[{"orderId":"251112-25001","mode":"undo","reason":"a"},{"orderId":"251112-25001","mode":"undo","reason":"b"}]}}'::jsonb, 'undoOrderParts') $$,
  'BOM_INVALID_RETURN', 'one row per call');
select throws_ok($$ select pr_t.leftover('[]'::jsonb) $$, 'BOM_INVALID_RETURN', 'a leftover needs at least one line');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":0}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'a zero quantity is refused');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":-1}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'a negative quantity is refused');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":"2"}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'a quantity must be a number');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1"}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'a quantity is required');
select throws_ok($$ select pr_t.leftover('[{"qty":1}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'an item code is required');
select throws_ok($$ select pr_t.leftover('["P-1"]'::jsonb) $$, 'BOM_INVALID_RETURN', 'a line must be an object');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":1},{"itemCode":"p-1","qty":2}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'the same item twice is refused');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":1}]'::jsonb, '') $$, 'BOM_INVALID_RETURN', 'a leftover needs a reason too');
-- 5.3 เพดาน · รายการที่ไม่ได้เบิกจ่าย · ทั้งชุดผ่านหรือไม่ผ่านพร้อมกัน
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":30.5}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'more than was issued (30) is refused');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-3","qty":1}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'an item that was not issued to this PI is refused');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":1},{"itemCode":"P-2","qty":99}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'one bad line refuses the whole return');
select is(pr_t.qty('P-1'), 70::numeric, 'and the good line was not applied');
select is(pr_t.ver(), current_setting('test.v0')::bigint, 'nothing was written by the refused calls');
-- 5.4 ชนรายระเบียนก่อนสิทธิ์ · สิทธิ์
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":1}]'::jsonb, 'ใช้ไม่หมด', current_setting('test.v_pre')::bigint) $$, 'BOM_STALE',
  'the stale check comes before the permission check (an RB member holding a copy from before the issue)');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'with a current copy an RB member is simply not allowed');
select throws_ok($$ select pr_t.undo() $$, 'BOM_FORBIDDEN', 'RB staff cannot undo an issue');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select pr_t.undo() $$, 'BOM_FORBIDDEN', 'WH staff can count but cannot undo an issue');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":1}]'::jsonb) $$, 'BOM_FORBIDDEN', 'nor return leftovers');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select pr_t.undo('เบิกผิดใบ', current_setting('test.v_pre')::bigint) $$, 'BOM_STALE', 'ST holding a copy from before the issue gets a stale error, not a return');
select is(pr_t.ver(), current_setting('test.v0')::bigint, 'still nothing written');

-- 6. คืนของเหลือ (ST) ------------------------------------------------------------------------
select set_config('test.res', pr_t.leftover('[{"itemCode":"P-1","qty":5}]'::jsonb, ' ใช้ไม่หมด ')::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v0')::bigint + 1)::text, 'ST returns 5 boxes and the counter moves once');
select is(pr_t.qty('P-1'), 75::numeric, 'the balance rose by the typed quantity');
select ok(pr_t.has_return('P-1', 5, 75, '251112-25001', current_setting('test.n_sbx_st_staff'), 'ใช้ไม่หมด'),
  'the return move carries the quantity, the balance after it, the PI number, the person and the trimmed reason');
select is(pr_t.job('JOB-ST-P1') ->> 'status', 'done', 'the job stays done after a leftover return');
select is(pr_t.order_status('251112-25001'), 'in_progress', 'and the order keeps its status');
select ok(exists (select 1 from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'stockMoves' -> 'upsert') m where m ->> 'kind' = 'return' and m ->> 'note' = 'ใช้ไม่หมด'),
  'the reply carries the new move with its note');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'returnOrderParts' and a ->> 'user' = current_setting('test.n_sbx_st_staff')
                  and a ->> 'detail' like '%partReturns +1%' and a ->> 'detail' like '%stock +1%'), 'the history records the return with the stock row');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":25.5}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'the cap counts what was already returned (30 - 5 = 25)');
select is(pr_t.qty('P-1'), 75::numeric, 'a refused return changes nothing');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is((pr_t.leftover('[{"itemCode":"P-2","qty":2.5}]'::jsonb, 'เศษเม็ดสี') -> 'changes' -> 'stock' -> 'upsert' -> 0 ->> 'qty')::numeric, 30::numeric, 'the planner group returns too (a fraction)');
select ok(pr_t.has_return('P-2', 2.5, 30, '251112-25001', current_setting('test.n_sbx_pp_staff'), 'เศษเม็ดสี'), 'with its own reason');
select ok((select bool_and(m ? 'note') from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m)
          and (select bool_and(m -> 'note' = 'null'::jsonb) from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m where m ->> 'kind' <> 'return'),
  'every move in the snapshot has a note, null unless it is a return');

-- 7. ยกเลิกการเบิกจ่าย: คืนเฉพาะส่วนที่ยังไม่เคยคืนเป็นของเหลือ · งานกลับไปรอเบิกจ่าย ---------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.v1', pr_t.ver()::text, true);
select set_config('test.res', pr_t.undo('เบิกผิดใบ')::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v1')::bigint + 1)::text, 'ST undoes the issue and the counter moves once');
select is(pr_t.qty('P-1'), 100::numeric, 'the first part is back to the count (30 issued, 5 already returned, 25 given back)');
select is(pr_t.qty('P-2'), 40::numeric, 'the second part too (12.5 issued, 2.5 already returned, 10 given back)');
select ok(pr_t.has_return('P-1', 25, 100, '251112-25001', current_setting('test.n_sbx_st_staff'), 'เบิกผิดใบ'), 'the undo move for the first part carries the remainder and the reason');
select ok(pr_t.has_return('P-2', 10, 40, '251112-25001', current_setting('test.n_sbx_st_staff'), 'เบิกผิดใบ'), 'and for the second');
select is(pr_t.job('JOB-ST-P1') ->> 'status', 'queued', 'the part jobs wait for an issue again');
select is(pr_t.job('JOB-ST-P2') ->> 'qtyDone', '0', 'with nothing done');
select ok(not (pr_t.job('JOB-ST-P1') ? 'doneAt') and not (pr_t.job('JOB-ST-P2') ? 'doneAt'), 'and no done time');
select is(pr_t.order_status('251112-25001'), 'in_progress', 'the order status is unchanged');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'undoOrderParts' and a ->> 'detail' like '%partReturns +1%' and a ->> 'detail' like '%stock +2%'),
  'the history records the undo with two stock rows');
select throws_ok($$ select pr_t.undo() $$, 'BOM_INVALID_RETURN', 'nothing is issued now, so a second undo is refused');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":1}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'and so is a leftover return');

-- 8. เบิกจ่ายใหม่: ของเหลือรอบก่อนไม่นับกับรอบใหม่ · ยกเลิกการเบิกจ่ายอีกครั้ง ------------------------------------------
select ok(pr_t.issue(jsonb_build_array(pr_t.done('JOB-ST-P1'), pr_t.done('JOB-ST-P2'))) is not null, 'the PI can be issued again after an undo');
select is(pr_t.qty('P-1'), 70::numeric, 'and the stock drops again');
select ok(pr_t.leftover('[{"itemCode":"P-1","qty":30}]'::jsonb, 'รอบสอง') is not null, 'the whole issue of the first part can be returned as leftovers (the first round''s 5 and 25 do not count)');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":0.5}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'and then nothing is left of it');
select ok(pr_t.undo('ผิดใบอีกครั้ง') is not null, 'an undo after full leftovers returns only the other item');
select is(pr_t.qty('P-1'), 100::numeric, 'the first part is back to 100 with no extra move for it');
select is(pr_t.move_count('P-1', 'return'), 3, 'three return moves in all for the first part (5, 25 and 30; the last undo added none)');
select is(pr_t.qty('P-2'), 40::numeric, 'the second part is back to 40');

-- 9. ยกเลิกใบหลังยกเลิกการเบิกจ่าย แล้วคืนไม่ได้ ---------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(pr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(pr_t.order_row('251112-25001') || '{"status":"cancelled","cancelReason":"ทดสอบ"}'::jsonb))), 'cancelOrder')
          -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'after the undo the PI has no work with output and can be cancelled');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select pr_t.undo() $$, 'BOM_INVALID_TRANSITION', 'a cancelled PI cannot be undone');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":1}]'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a cancelled PI takes no leftover return');
select is(pr_t.qty('P-1'), 100::numeric, 'and the stock is as it was');

-- 10. ใบที่ปิดแล้ว: คืนของเหลือได้ แต่ยกเลิกการเบิกจ่ายไม่ได้ ------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(pr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251112-25002"}'::jsonb))), 'createOrder') is not null, 'the planner creates a second order');
select ok(pr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  pr_t.order_row('251112-25002') || jsonb_build_object('items', '[{"fgCode":"FG-A","qty":3,"colorSet":"A","note":""}]'::jsonb,
    'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":3,"required":3},{"itemCode":"P-1","level":1,"fgQty":3,"required":9}]'::jsonb)))), 'explodeOrder') is not null, 'and explodes it');
select ok(pr_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(pr_t.order_row('251112-25002') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB2-ST-P1","orderId":"251112-25002","itemCode":"P-1","qtyPlanned":9,"qtyRequired":9}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB2-PK-A","orderId":"251112-25002","dept":"PK","itemCode":"FG-A","name":"สินค้า A","kind":"FG","uom":"set","qtyPlanned":3,"qtyRequired":3}'::jsonb))),
  'releaseOrder') is not null, 'and releases it');
select is(pr_t.issue(jsonb_build_array(pr_t.done('JOB2-ST-P1'))) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done', 'the planner issues its part');
select is(pr_t.qty('P-1'), 91::numeric, 'and the stock follows (100 - 9)');
select ok(pr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  pr_t.job('JOB2-PK-A') || jsonb_build_object('status', 'done', 'qtyDone', 3, 'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 3, 'reject', 0, 'note', '')))))), 'reportJob') is not null,
  'the packing job is finished');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select is(pr_t.save('{"fgMoves":{"upsert":[{"orderId":"251112-25002","kind":"receive","lines":[{"fgCode":"FG-A","qty":3}]}]}}'::jsonb, 'receiveFg')
          -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'and WH receives all 3 sets, which completes the order');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select pr_t.undo('x', null, '251112-25002') $$, 'BOM_INVALID_TRANSITION', 'a completed PI cannot be undone');
select is((pr_t.leftover('[{"itemCode":"P-1","qty":2}]'::jsonb, 'เหลือหลังปิดใบ', null, '251112-25002') -> 'changes' -> 'stock' -> 'upsert' -> 0 ->> 'qty')::numeric, 93::numeric,
  'but it still takes leftovers (91 + 2)');
select throws_ok($$ select pr_t.leftover('[{"itemCode":"P-1","qty":7.5}]'::jsonb, 'เกิน', null, '251112-25002') $$, 'BOM_INVALID_RETURN', 'within the cap (9 issued, 2 returned)');

-- 11. snapshot / delta และตาราง --------------------------------------------------------------------
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 14::bigint, 'the snapshot has fourteen lists (partReturns is not one of them, fgMoves is)');
select is((select count(*) from jsonb_object_keys(public.app_bom_master_since(0) -> 'changes')), 14::bigint, 'the delta names fourteen lists');
select is(public.app_bom_master_since(0) -> 'changes' -> 'stockMoves', jsonb_build_object('upsert', public.app_bom_master() -> 'stockMoves', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the move snapshot, notes included');
reset role;
select ok(not exists (select 1 from public.bom_stock_moves where is_test and kind = 'return' and (note is null or ref is null or qty <= 0 or created_by is null)),
  'every return move has a reason, a PI number, a positive quantity and a person');
select ok(not exists (select 1 from public.bom_stock_moves where is_test and kind <> 'return' and note is not null), 'and no other move has a note');
select ok(not exists (select 1 from public.bom_stock_moves m where m.is_test and m.kind = 'return' and m.changed_version <= 0), 'every return move is stamped with the version that wrote it');
select ok((select bool_and(balance >= 0) from public.bom_stock_moves where is_test), 'no move leaves a negative balance');

select * from finish();
rollback;
