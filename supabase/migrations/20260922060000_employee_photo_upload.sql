-- ให้พนักงานอัปโหลดรูปโปรไฟล์ของตนเองแทนตัวอักษรย่อในแถบข้าง

alter table public.employees add column if not exists photo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-photos',
  'employee-photos',
  true,
  3145728,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket: อ่านได้โดยไม่ต้องยืนยันตัวตน เพื่อให้ <img src> แสดงผลได้ตรง ๆ
create policy employee_photos_read on storage.objects for select
using (bucket_id = 'employee-photos');

-- เขียนได้เฉพาะโฟลเดอร์ของตัวเอง (พาธเก็บเป็น <employee_id>/<file>)
create policy employee_photos_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-photos'
  and owner_id = (select auth.uid())::text
  and ((storage.foldername(name))[1])::uuid = private.current_employee_id()
);

create policy employee_photos_update on storage.objects for update to authenticated
using (
  bucket_id = 'employee-photos'
  and ((storage.foldername(name))[1])::uuid = private.current_employee_id()
)
with check (
  bucket_id = 'employee-photos'
  and ((storage.foldername(name))[1])::uuid = private.current_employee_id()
);

create policy employee_photos_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-photos'
  and ((storage.foldername(name))[1])::uuid = private.current_employee_id()
);

-- employees ไม่มี grant UPDATE ให้ authenticated (ดู admin_account_editing.sql) จึงต้องผ่าน RPC นี้
create or replace function public.app_update_own_photo(p_photo_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_photo_url text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  v_photo_url := nullif(trim(coalesce(p_photo_url, '')), '');
  if v_photo_url is not null and char_length(v_photo_url) > 500 then
    raise exception 'INVALID_PHOTO_URL';
  end if;

  update public.employees
  set photo_url = v_photo_url
  where id = v_employee.id;

  return v_employee.id;
end;
$$;

revoke all on function public.app_update_own_photo(text) from public, anon;
grant execute on function public.app_update_own_photo(text) to authenticated;
