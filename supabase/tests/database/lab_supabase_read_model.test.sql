begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.app_lab_mooney_feed(text)', 'execute'), 'anon cannot read snapshots');
select ok(not has_function_privilege('authenticated', 'public.app_lab_mooney_publish(jsonb,jsonb,timestamptz)', 'execute'), 'users cannot publish');
select ok(not has_function_privilege('anon', 'public.app_lab_mooney_publish(jsonb,jsonb,timestamptz)', 'execute'), 'anon cannot publish');
select ok(has_function_privilege('service_role', 'public.app_lab_mooney_publish(jsonb,jsonb,timestamptz)', 'execute'), 'worker can publish');
select ok((select relrowsecurity from pg_class where oid='private.lab_mooney_snapshot'::regclass), 'snapshot metadata has RLS');
select ok(not has_table_privilege('authenticated','private.lab_mooney_snapshot','select'), 'metadata is not directly readable');

insert into auth.users(id,email,raw_user_meta_data) values
('82000000-0000-0000-0000-000000000001','lab-sync-admin@mnp.local','{}'),
('82000000-0000-0000-0000-000000000002','lab-sync-staff@mnp.local','{}');
update public.employees set auth_user_id='82000000-0000-0000-0000-000000000001' where id='50000000-0000-0000-0000-000000000001';
update public.employees set auth_user_id='82000000-0000-0000-0000-000000000002' where id='50000000-0000-0000-0000-000000000003';

create temporary table sync_fixture as select
jsonb_agg(jsonb_build_object('source_sheet','A','sample_id',n::text,'material',case when n=3 then 'B' else 'A' end,
 'test_date','2026-10-01','test_time',case when n=1 then '10:00:00' else '09:00:00' end,
 'temperature_c',100,'test_minutes',4,'mh',50+n+0.12345,'mv',30+n,
 'avg_mh',52,'sd_mh',1,'avg_mv',32,'sd_mv',1) order by n) as rows,
'[{"material":"A","resultCount":2},{"material":"B","resultCount":1}]'::jsonb as materials
from generate_series(1,3) n;
grant select on sync_fixture to service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.app_lab_mooney_feed()$$,'LAB_SYNC_NOT_READY','first sync is required, never silently empty');
reset role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public.app_lab_mooney_publish(rows,materials,now()-interval '2 minutes')->>'applied')::boolean,true,'valid snapshot publishes') from sync_fixture;
select is((public.app_lab_mooney_publish(rows,materials,now()-interval '3 minutes')->>'applied')::boolean,false,'older snapshot cannot overwrite') from sync_fixture;
select throws_ok($$select public.app_lab_mooney_publish('[]','[]',now())$$,'LAB_INVALID_PAYLOAD','empty reads cannot wipe data');
select throws_ok($$select public.app_lab_mooney_publish(rows,'[]',now()) from sync_fixture$$,'LAB_INVALID_PAYLOAD','mismatched summary is rejected');
select throws_ok($$select public.app_lab_mooney_publish(rows,materials,now()+interval '1 hour') from sync_fixture$$,'LAB_INVALID_PAYLOAD','future clock cannot freeze sync');
select is((public.app_lab_mooney_publish(rows,materials,now()-interval '1 minute')->>'changed')::boolean,false,'unchanged read updates freshness without rewriting') from sync_fixture;
select throws_ok($$select public.app_lab_mooney_publish(jsonb_set(rows,'{0,mh}','-1'),materials,now()) from sync_fixture$$,'LAB_INVALID_ROW','invalid measurement rolls the whole publish back');
reset role;
select is((select count(*) from public.audit_logs where entity_type='lab_mooney_results' and action='IMPORT'),1::bigint,'unchanged poll does not flood audit log');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is(jsonb_array_length(public.app_lab_mooney_feed()->'rows'),0,'overview sends no raw measurements');
select is(jsonb_array_length(public.app_lab_mooney_feed()->'materials'),2,'overview includes materials');
select is(jsonb_array_length(public.app_lab_mooney_feed('A')->'rows'),2,'material response contains only selected material');
select is(public.app_lab_mooney_feed('A')->'rows'->0->>'sample_id','1','sheet order preserved even when timestamp order differs');
select is(public.app_lab_mooney_feed('A')->'rows'->1->>'sample_id','2','second sheet row preserved');
select is(jsonb_array_length(public.app_lab_mooney_feed('missing')->'rows'),0,'unknown material is empty');
select throws_ok($$select public.app_lab_mooney_feed(repeat('x',61))$$,'LAB_INVALID_MATERIAL','invalid material refused');
select ok(public.app_lab_mooney_feed()->>'generated_at' is not null,'source-read timestamp returned');
select is((public.app_lab_mooney_feed('A')->'rows'->0->>'mh')::numeric,51.12345::numeric,'raw precision is preserved and failed publish did not change it');
reset role;

-- A material with more than the legacy 2,000-row limit must not silently truncate.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.app_lab_mooney_publish(
 (select jsonb_agg(jsonb_build_object('source_sheet','BIG','sample_id',n::text,'material','BIG',
  'test_date','2026-10-01','test_time','08:00:00','temperature_c',100,'test_minutes',4,'mh',50,'mv',30) order by n)
  from generate_series(1,2001) n),
 '[{"material":"BIG","resultCount":2001}]',now());
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is(jsonb_array_length(public.app_lab_mooney_feed('BIG')->'rows'),2001,'material reads are complete beyond 2,000 rows');

select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.app_lab_mooney_feed('A')$$,'NOT_AUTHORIZED','staff cannot read cached results');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.app_lab_mooney_feed()$$,'AUTH_REQUIRED','missing subject denied');
reset role;
update public.employees set is_active=false where id='50000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.app_lab_mooney_feed()$$,'NOT_AUTHORIZED','inactive admin immediately loses access');
reset role;

select * from finish();
rollback;
