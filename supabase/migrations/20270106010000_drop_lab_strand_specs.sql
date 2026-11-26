-- ============================================================================
-- ลบตาราง lab_strand_specs และ RPC ของมันที่ค้างอยู่บน production
--
-- ที่มา: PR #196 (ออเดอร์/ขนาดวงนอก-รูใน/สเปกของยางเส้นต่อ ID) ถูกปิดโดยไม่ merge ตามคำสั่งเจ้าของ (2026-11-26)
-- แต่ production มีตาราง public.lab_strand_specs และฟังก์ชัน app_lab_strand_spec* บางตัวอยู่แล้ว
-- โดยไม่มีแถวใน supabase_migrations.schema_migrations (มีคนรัน SQL ของ PR นั้นเอง อาจไม่ครบทุกส่วน)
-- ไม่มีโค้ดใน main เรียกตารางหรือฟังก์ชันเหล่านี้
--
-- กันข้อมูลหาย: ถ้าตารางยังมีแถวอยู่ migration นี้จะหยุดด้วย LAB_STRAND_SPECS_NOT_EMPTY และไม่ลบอะไรเลย
-- (ข้อมูลในตารางเป็นข้อมูลที่คนพิมพ์เข้าไป ต้องสำรองและให้เจ้าของตัดสินก่อน)
-- ฐานข้อมูลที่ไม่มีวัตถุเหล่านี้ (local / CI) รันผ่านได้โดยไม่ทำอะไร
-- trigger sandbox_guard และ policy ของตารางถูกลบไปพร้อมกับตาราง
-- แถวใน audit_logs (LAB_STRAND_SPEC_*) ถ้ามี ยังเก็บไว้เป็นประวัติ
--
-- Rollback: ไม่มีข้อมูลถูกลบ (ตารางต้องว่างจึงลบได้) ถ้าต้องการคืน ให้รัน
-- supabase/migrations/20261019010000_lab_strand_specs.sql จาก branch claude/sleepy-dijkstra-hhu4co เป็น migration ใหม่
-- ============================================================================

do $$
declare
  v_rows bigint;
  v_fn regprocedure;
begin
  if to_regclass('public.lab_strand_specs') is not null then
    execute 'select count(*) from public.lab_strand_specs' into v_rows;
    if v_rows > 0 then
      raise exception 'LAB_STRAND_SPECS_NOT_EMPTY: % rows, back them up and get the owner''s decision first', v_rows;
    end if;
  end if;

  -- ลบทุก overload ของชื่อเหล่านี้ (เวอร์ชันที่รันเองอาจมีลายเซ็นต่างจากในไฟล์ของ PR)
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_lab_strand_specs', 'app_lab_strand_spec_save', 'app_lab_strand_spec_delete')
  loop
    execute format('drop function %s', v_fn);
  end loop;
end;
$$;

drop table if exists public.lab_strand_specs;
