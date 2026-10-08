-- ฝ่ายโรงงาน: ช่อง "รหัสอะไหล่" ของ Item (20261008030000_factory_item_part_code.sql)
-- ครอบคลุม: โครงสร้างและ constraint, สิทธิ์ของฟังก์ชัน, เพิ่ม/แก้/คงค่าเดิม/ล้างรหัสอะไหล่, ค่าที่ไม่ถูกต้อง, รหัสอะไหล่ซ้ำกันได้แต่รหัส Item ซ้ำไม่ได้,
-- ฟังก์ชันรุ่น 14 พารามิเตอร์เดิมไม่แตะรหัสอะไหล่, ข้อมูลหลักและประวัติมีรหัสอะไหล่, การแยกโหมดทดสอบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'factory_items' and column_name = 'part_code' and is_nullable = 'YES'),
  'items have an optional part code column');
select throws_ok($$insert into public.factory_items (code, name, item_type, category_code, brand, unit_code, procurement, part_code)
                   values ('PC-BAD-1', 'x', 'RM', 'rubber', 'MNP', 'KG', 'buy', ' padded ')$$, '23514', null, 'a part code with surrounding spaces is refused by the table');
select throws_ok($$insert into public.factory_items (code, name, item_type, category_code, brand, unit_code, procurement, part_code)
                   values ('PC-BAD-2', 'x', 'RM', 'rubber', 'MNP', 'KG', 'buy', '')$$, '23514', null, 'an empty part code is stored as null, never as an empty string');
select throws_ok($$insert into public.factory_items (code, name, item_type, category_code, brand, unit_code, procurement, part_code)
                   values ('PC-BAD-3', 'x', 'RM', 'rubber', 'MNP', 'KG', 'buy', repeat('p', 61))$$, '23514', null, 'a part code longer than 60 characters is refused by the table');
select ok(has_function_privilege('authenticated', 'public.app_factory_save_item(uuid,integer,text,text,text,text,text,text,text,text,text,boolean,numeric,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.app_factory_save_item(uuid,integer,text,text,text,text,text,text,text,text,text,boolean,numeric,text,text)', 'execute'),
  'the new save function is open to signed-in users only (it checks test mode itself)');
select ok(has_function_privilege('authenticated', 'public.app_factory_save_item(uuid,integer,text,text,text,text,text,text,text,text,text,boolean,numeric,text)', 'execute')
      and not has_function_privilege('anon', 'public.app_factory_save_item(uuid,integer,text,text,text,text,text,text,text,text,text,boolean,numeric,text)', 'execute'),
  'the old 14-parameter function keeps its privileges');

-- 2. บัญชีทดสอบและข้อมูลจริง ----------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('84000000-0000-0000-0000-000000000001', 'partcode-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id)
values ('84000000-0000-0000-0000-000000000101', 'PARTCODE-ADMIN', 'Part', 'Admin', 'partcode-admin@test.local',
        (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '84000000-0000-0000-0000-000000000001');
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement, part_code)
values ('84000000-0000-0000-0000-00000000f001', 'REAL-PC-01', 'Item จริงที่มีรหัสอะไหล่', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'REAL-PART-01');
select set_config('test.persona', (select id::text from public.employees where employee_no = 'SBX-PP-STAFF'), true);

create function pg_temp.items() returns jsonb language sql stable as $$ select public.app_factory_master_data() -> 'items' $$;
create function pg_temp.item(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(pg_temp.items()) x where x ->> 'code' = $1 $$;

-- 3. ใช้ได้เฉพาะโหมดทดสอบ -----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_save_item(null, null, 'PC-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '', 'P-1')$$,
  'FACTORY_TEST_MODE_ONLY', 'the part code cannot be saved outside test mode');
select public.app_sandbox_enter(current_setting('test.persona')::uuid);

-- 4. เพิ่ม Item พร้อมรหัสอะไหล่ --------------------------------------------------------
select set_config('test.a', public.app_factory_save_item(null, null, 'PC-A', 'อะไหล่ A สีส้ม', '', 'WIP', 'industrial', 'MNP', 'PCS', 'make', 'active', false, 0, '', '  SE-ST01-100-18-65  ')::text, true);
select is(pg_temp.item('PC-A') ->> 'part_code', 'SE-ST01-100-18-65', 'a new item stores the part code, trimmed');
select set_config('test.b', public.app_factory_save_item(null, null, 'PC-B', 'อะไหล่ A สีดำ', '', 'WIP', 'industrial', 'MNP', 'PCS', 'make', 'active', false, 0, '', 'SE-ST01-100-18-65')::text, true);
select is(pg_temp.item('PC-B') ->> 'part_code', 'SE-ST01-100-18-65', 'two items may share one part code (same part, different colour)');
select throws_ok($$select public.app_factory_save_item(null, null, 'PC-B', 'ซ้ำ', '', 'WIP', 'industrial', 'MNP', 'PCS', 'make', 'active', false, 0, '', 'OTHER')$$,
  'ITEM_CODE_TAKEN', 'the item code must still be unique even when the part codes differ');
select public.app_factory_save_item(null, null, 'PC-NONE', 'ไม่มีรหัสอะไหล่', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '', null);
select is(pg_temp.item('PC-NONE') -> 'part_code', 'null'::jsonb, 'a null part code means the item has none');
select public.app_factory_save_item(null, null, 'PC-EMPTY', 'ค่าว่าง', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '', '   ');
select is(pg_temp.item('PC-EMPTY') -> 'part_code', 'null'::jsonb, 'blank text is stored as no part code, not as an empty string');
select is(pg_temp.item('PC-A') ->> 'code', 'PC-A', 'the item code is not touched by the part code');

-- 5. ค่าที่ไม่ถูกต้อง -----------------------------------------------------------------
select throws_ok($$select public.app_factory_save_item(null, null, 'PC-LONG', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '', repeat('p', 61))$$,
  'INVALID_ITEM_PART_CODE', 'a part code over 60 characters is rejected');
select throws_ok(format($$select public.app_factory_save_item(null, null, 'PC-CTRL', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '', %L)$$, 'P' || chr(10) || '1'),
  'INVALID_ITEM_PART_CODE', 'a part code with a control character is rejected');
select lives_ok($$select public.app_factory_save_item(null, null, 'PC-SIXTY', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '', repeat('p', 60))$$, 'exactly 60 characters is allowed');
select lives_ok($$select public.app_factory_save_item(null, null, 'PC-BRK', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '', 'Mega-PPL-01-12(BN)-Y')$$,
  'brackets and mixed case are allowed in a part code (it is a reference, not an item code)');

-- 6. แก้ไข: เปลี่ยน / คงค่าเดิม / ล้าง ----------------------------------------------------
select set_config('test.a_id', pg_temp.item('PC-A') ->> 'id', true);
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 1, 'PC-A', 'อะไหล่ A สีส้ม', '', 'WIP', 'industrial', 'MNP', 'PCS', 'make', 'active', false, 0, '', 'SE-NEW-1')$$, current_setting('test.a_id')),
  'a part code can be changed');
select is(pg_temp.item('PC-A') ->> 'part_code', 'SE-NEW-1', 'the new part code is saved');
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 2, 'PC-A', 'ชื่อใหม่', '', 'WIP', 'industrial', 'MNP', 'PCS', 'make', 'active', false, 0, '', null)$$, current_setting('test.a_id')),
  'saving with a null part code edits the rest');
select is(pg_temp.item('PC-A') ->> 'part_code', 'SE-NEW-1', 'null keeps the stored part code');
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 3, 'PC-A', 'ชื่อใหม่', '', 'WIP', 'industrial', 'MNP', 'PCS', 'make', 'active', false, 0, '')$$, current_setting('test.a_id')),
  'the old 14-parameter call still works');
select is(pg_temp.item('PC-A') ->> 'part_code', 'SE-NEW-1', 'the old call leaves the part code alone');
select is((pg_temp.item('PC-A') ->> 'version')::integer, 4, 'every save still bumps the version once (create, change, null save, old call)');
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 4, 'PC-A', 'ชื่อใหม่', '', 'WIP', 'industrial', 'MNP', 'PCS', 'make', 'active', false, 0, '', '')$$, current_setting('test.a_id')),
  'an empty part code clears it');
select is(pg_temp.item('PC-A') -> 'part_code', 'null'::jsonb, 'the part code is gone after clearing');
select throws_ok(format($$select public.app_factory_save_item(%L::uuid, 1, 'PC-A', 'x', '', 'WIP', 'industrial', 'MNP', 'PCS', 'make', 'active', false, 0, '', 'LATE')$$, current_setting('test.a_id')),
  'ITEM_VERSION_CONFLICT', 'a stale window cannot overwrite the part code');

-- 7. ประวัติ และการแยกโหมด ---------------------------------------------------------------
select is(pg_temp.item('REAL-PC-01'), null, 'a real item (with a real part code) is invisible in test mode');
select public.app_sandbox_exit();
reset role;
select is((select count(*) from public.factory_item_history h join public.factory_items i on i.id = h.item_id
           where i.code = 'PC-A' and h.after_data ->> 'part_code' = 'SE-NEW-1')::integer, 3,
  'the history snapshots of the edits after the change carry the new part code (change, null save, old call)');
select is((select before_data ->> 'part_code' from public.factory_item_history h join public.factory_items i on i.id = h.item_id
           where i.code = 'PC-A' and h.version = 2), 'SE-ST01-100-18-65', 'the history keeps the part code from before the change');
select is((select part_code from public.factory_items where code = 'REAL-PC-01' and not is_test), 'REAL-PART-01', 'the real item and its part code are untouched');
select is((select count(*) from public.factory_items where is_test and part_code is not null)::integer, 3, 'three test items carry a part code (the cleared one does not)');
select is((select after_data ->> 'part_code' from public.factory_item_history where action = 'create' and after_data ->> 'code' = 'PC-B'), 'SE-ST01-100-18-65',
  'the creation history keeps the part code');

select * from finish();
rollback;
