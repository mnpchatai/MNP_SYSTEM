-- NCR attachments in Admin Sandbox. Test files use their own private bucket.
-- Read/upload permissions follow the current persona and the report's mode.
-- Cleanup explicitly enables test-file deletion for the real Admin, then resets it.
-- Files are removed through Storage API before SQL removes reports; a failed/partial
-- removal keeps the reports and can be retried, including any unregistered uploads.
-- Existing function bodies come from the latest definitions on main.
-- Recovery: disable the new UI, remove test files through Storage API, purge test
-- reports, restore the replaced functions/policies from the prior migrations,
-- drop the new helpers/RPCs and session column, then remove the empty test bucket.

alter table public.sandbox_sessions
  add column ncr_files_cleanup_until timestamptz;

create or replace function private.ncr_test_files_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.sandbox_persona()).id is not null
$$;
revoke all on function private.ncr_test_files_allowed() from public, anon;
grant execute on function private.ncr_test_files_allowed() to authenticated;

create or replace function private.ncr_test_cleanup_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.ncr_test_files_allowed() and exists (
    select 1 from public.sandbox_sessions
    where admin_auth_user_id = auth.uid() and ncr_files_cleanup_until > now()
  )
$$;
revoke all on function private.ncr_test_cleanup_allowed() from public, anon;
grant execute on function private.ncr_test_cleanup_allowed() to authenticated;

create or replace function private.ncr_files_mode_matches(p_ncr_id uuid, p_is_test boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access_ncr(p_ncr_id) and exists (
    select 1 from public.ncr_reports where id = p_ncr_id and is_test = p_is_test
  )
$$;
revoke all on function private.ncr_files_mode_matches(uuid, boolean) from public, anon;
grant execute on function private.ncr_files_mode_matches(uuid, boolean) to authenticated;

create or replace function private.can_upload_ncr_attachment(p_ncr_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_ncr(p_ncr_id)
    and exists (
      select 1 from public.ncr_reports n
      where n.id = p_ncr_id and n.status not in ('closed', 'cancelled') and not private.ncr_test_cleanup_allowed()
    )
$$;
revoke all on function private.can_upload_ncr_attachment(uuid) from public, anon;
grant execute on function private.can_upload_ncr_attachment(uuid) to authenticated;

create or replace function private.ncr_child_sandbox_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test boolean;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select n.is_test into v_test
  from public.ncr_reports n
  where n.id = case when tg_op = 'DELETE' then old.ncr_id else new.ncr_id end;
  -- ไม่พบใบแม่ = กำลังลบต่อเนื่อง (cascade) จากใบที่ถูกลบไปแล้ว
  if v_test is not null and v_test is distinct from ((private.sandbox_persona()).id is not null) then
    raise exception 'SANDBOX_SCOPE_MISMATCH';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.ncr_child_sandbox_scope() from public, anon, authenticated;

-- Preserve private buckets, MIME limits and the existing 20 MB limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ncr-test-attachments', 'ncr-test-attachments', false, 20971520,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The live bucket must reject a test report even after test uploads become allowed.
drop policy ncr_files_read on storage.objects;
create policy ncr_files_read on storage.objects for select to authenticated
using (bucket_id = 'ncr-attachments'
  and private.ncr_files_mode_matches(private.ncr_folder_id(name), false));
drop policy ncr_files_upload on storage.objects;
create policy ncr_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'ncr-attachments' and owner_id = (select auth.uid())::text
  and private.ncr_files_mode_matches(private.ncr_folder_id(name), false)
  and private.can_upload_ncr_attachment(private.ncr_folder_id(name)));
drop policy ncr_files_delete_unregistered on storage.objects;
create policy ncr_files_delete_unregistered on storage.objects for delete to authenticated
using (bucket_id = 'ncr-attachments' and owner_id = (select auth.uid())::text
  and not private.ncr_test_files_allowed()
  and not exists (select 1 from public.ncr_attachments a where a.storage_path = name));

create policy ncr_test_files_read on storage.objects for select to authenticated
using (bucket_id = 'ncr-test-attachments' and private.ncr_test_files_allowed()
  and (private.ncr_test_cleanup_allowed()
    or private.ncr_files_mode_matches(private.ncr_folder_id(name), true)));
create policy ncr_test_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'ncr-test-attachments' and owner_id = (select auth.uid())::text
  and private.ncr_test_files_allowed()
  and private.ncr_files_mode_matches(private.ncr_folder_id(name), true)
  and private.can_upload_ncr_attachment(private.ncr_folder_id(name)));
create policy ncr_test_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'ncr-test-attachments' and private.ncr_test_files_allowed()
  and (private.ncr_test_cleanup_allowed()
    or (owner_id = (select auth.uid())::text
      and private.ncr_files_mode_matches(private.ncr_folder_id(name), true)
      and not exists (select 1 from public.ncr_attachments a where a.storage_path = name))));

create or replace function public.app_ncr_add_attachment(
  p_ncr_id uuid,
  p_section text,
  p_storage_path text,
  p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_status text;
  v_is_test boolean;
  v_object storage.objects%rowtype;
  v_size bigint;
  v_id uuid;
begin
  v_employee := private.ncr_current_employee();
  if p_section is null or p_section not in ('report', 'response', 'followup') then
    raise exception 'INVALID_ATTACHMENT';
  end if;
  if char_length(trim(coalesce(p_file_name, ''))) not between 1 and 255
     or p_storage_path is null or p_storage_path not like p_ncr_id::text || '/%' then
    raise exception 'INVALID_ATTACHMENT';
  end if;

  select status, is_test into v_status, v_is_test from public.ncr_reports where id = p_ncr_id for update;
  if v_status is null or not private.can_access_ncr(p_ncr_id) then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_status in ('closed', 'cancelled') then
    raise exception 'NCR_LOCKED';
  end if;

  if v_is_test and private.ncr_test_cleanup_allowed() then
    raise exception 'NCR_FILES_CLEANUP_ACTIVE';
  end if;

  select * into v_object
  from storage.objects
  where bucket_id = case when v_is_test then 'ncr-test-attachments' else 'ncr-attachments' end
    and name = p_storage_path and owner_id = auth.uid()::text;
  if v_object.id is null then
    raise exception 'ATTACHMENT_NOT_UPLOADED';
  end if;
  v_size := coalesce((v_object.metadata->>'size')::bigint, 0);
  if v_size <= 0 or v_size > 20971520 then
    raise exception 'INVALID_ATTACHMENT';
  end if;

  insert into public.ncr_attachments (ncr_id, section, uploader_id, storage_path, file_name, content_type, size_bytes)
  values (p_ncr_id, p_section, v_employee.id, p_storage_path, left(trim(p_file_name), 255),
          coalesce(nullif(v_object.metadata->>'mimetype', ''), 'application/octet-stream'), v_size)
  returning id into v_id;
  perform private.ncr_log(p_ncr_id, v_status, v_status, 'attachment', left(trim(p_file_name), 255), v_employee.id);
  return v_id;
end;
$$;
revoke all on function public.app_ncr_add_attachment(uuid, text, text, text) from public, anon;
grant execute on function public.app_ncr_add_attachment(uuid, text, text, text) to authenticated;

-- The caller explicitly starts cleanup; normal persona reads remain scoped to NCR.
-- Enumerate storage.objects as well as registered files, so failed uploads are covered.
create or replace function public.app_sandbox_begin_ncr_file_cleanup()
returns text[] language plpgsql security definer set search_path = '' as $$
begin
  perform private.sandbox_admin();
  if not private.ncr_test_files_allowed() then raise exception 'SANDBOX_NOT_ACTIVE'; end if;
  update public.sandbox_sessions set ncr_files_cleanup_until = now() + interval '5 minutes'
  where admin_auth_user_id = auth.uid();
  if not found then raise exception 'SANDBOX_NOT_ACTIVE'; end if;
  return coalesce((select array_agg(name order by name) from storage.objects
    where bucket_id = 'ncr-test-attachments'), '{}'::text[]);
end;
$$;
revoke all on function public.app_sandbox_begin_ncr_file_cleanup() from public, anon;
grant execute on function public.app_sandbox_begin_ncr_file_cleanup() to authenticated;

create or replace function public.app_sandbox_finish_ncr_file_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.sandbox_admin();
  update public.sandbox_sessions set ncr_files_cleanup_until = null where admin_auth_user_id = auth.uid();
end;
$$;
revoke all on function public.app_sandbox_finish_ncr_file_cleanup() from public, anon;
grant execute on function public.app_sandbox_finish_ncr_file_cleanup() to authenticated;

create or replace function public.app_sandbox_purge_ncr()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_deleted integer;
begin
  v_admin := private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- Storage API must remove every test object first, including unregistered uploads.
  if exists (select 1 from storage.objects where bucket_id = 'ncr-test-attachments') then
    raise exception 'NCR_FILES_REMAIN';
  end if;

  delete from public.ncr_reports where is_test;
  get diagnostics v_deleted = row_count;
  delete from public.document_counters where department_code = 'NCR-TEST';

  update public.sandbox_sessions set ncr_files_cleanup_until = null where admin_auth_user_id = auth.uid();

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_NCR', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_ncr', v_deleted));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;
revoke all on function public.app_sandbox_purge_ncr() from public, anon;
grant execute on function public.app_sandbox_purge_ncr() to authenticated;
