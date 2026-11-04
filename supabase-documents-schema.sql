-- Run ONLY in the separate documents project. Transactional and safe to rerun.
begin;
create table if not exists public.documents (
  id uuid primary key,
  storage_path text not null unique,
  original_name text not null,
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  bytes integer not null check (bytes > 0 and bytes <= 10485760),
  vpin_lookup_hash text not null unique,
  vpin_hash text not null,
  ready boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;
revoke all on table public.documents from public, anon, authenticated;
grant all on public.documents to service_role;

create table if not exists public.docs_attempts (
  scope text not null,
  bucket timestamptz not null,
  attempts integer not null,
  primary key(scope,bucket)
);
alter table public.docs_attempts enable row level security;
revoke all on public.docs_attempts from public, anon, authenticated;
grant all on public.docs_attempts to service_role;

create or replace function public.docs_take_attempt(p_ip text,p_action text,p_pin text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  bucket_time timestamptz := date_trunc('hour',now()) + floor(extract(minute from now())/10)*interval '10 minutes';
  counter integer;
  global_counter integer;
  limit_count integer;
begin
  if length(p_ip)<>43 or p_action not in ('upload','verify','pin') or length(p_pin)>43 then return false; end if;
  insert into public.docs_attempts values ('global:'||p_action,bucket_time,1)
  on conflict(scope,bucket) do update set attempts=public.docs_attempts.attempts+1 returning attempts into global_counter;
  insert into public.docs_attempts values (p_action||':'||case when p_action='pin' then p_pin else p_ip end,bucket_time,1)
  on conflict(scope,bucket) do update set attempts=public.docs_attempts.attempts+1 returning attempts into counter;
  delete from public.docs_attempts where bucket < now()-interval '1 day';
  limit_count := case when p_action='upload' then 100 when p_action='pin' then 6 else 10 end;
  return counter<=limit_count and global_counter<=120;
end;
$$;
revoke all on function public.docs_take_attempt(text,text,text) from public, anon, authenticated;
grant execute on function public.docs_take_attempt(text,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('private-documents','private-documents',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No client table/Storage policies: only the backend's service key can access data.
commit;
