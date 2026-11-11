begin;

create schema if not exists portal_private;
revoke all on schema portal_private from public;
grant usage on schema portal_private to authenticated;

create table public.portal_profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text not null default '' check (length(display_name) <= 100),
  role text not null default 'customer' check (role in ('customer','staff','owner')),
  permissions text[] not null default '{}' check (permissions <@ array['orders','documents','customers']::text[])
);
create table public.portal_cart (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  product_id text not null check (length(product_id) between 1 and 80),
  quantity integer not null check (quantity between 1 and 100),
  primary key (user_id, product_id)
);
create table public.portal_orders (
  id text primary key,
  user_id uuid not null references auth.users on delete restrict,
  items jsonb not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_status text not null default 'PENDING',
  fulfilment_status text not null default 'unfulfilled'
    check (fulfilment_status in ('unfulfilled','processing','dispatched','delivered','cancelled')),
  created_at timestamptz not null default now()
);
create index on public.portal_orders (user_id, created_at desc);
create table public.portal_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (length(title) between 1 and 150),
  object_path text not null unique,
  created_at timestamptz not null default now()
);
create index on public.portal_documents (user_id, created_at desc);
create table public.portal_role_history (
  id bigint generated always as identity primary key,
  changed_by uuid not null,
  account_id uuid not null,
  previous_role text not null,
  new_role text not null,
  previous_permissions text[] not null,
  new_permissions text[] not null,
  changed_at timestamptz not null default now()
);

create function portal_private.can_manage(permission text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2', false) and exists (
    select 1 from public.portal_profiles
    where user_id = (select auth.uid())
      and (role = 'owner' or (role = 'staff' and permission = any(permissions)))
  );
$$;
revoke all on function portal_private.can_manage(text) from public;
grant execute on function portal_private.can_manage(text) to authenticated;

create function public.portal_can_invite()
returns boolean language sql stable security invoker set search_path = ''
as $$ select portal_private.can_manage('roles'); $$;
revoke all on function public.portal_can_invite() from public, anon;
grant execute on function public.portal_can_invite() to authenticated;

alter table public.portal_profiles enable row level security;
alter table public.portal_cart enable row level security;
alter table public.portal_orders enable row level security;
alter table public.portal_documents enable row level security;
alter table public.portal_role_history enable row level security;

revoke all on public.portal_profiles, public.portal_cart, public.portal_orders, public.portal_documents from anon, authenticated;
grant select, insert on public.portal_profiles to authenticated;
grant update (role, permissions) on public.portal_profiles to authenticated;
grant select, insert, update, delete on public.portal_cart to authenticated;
grant select on public.portal_orders to authenticated;
grant update (fulfilment_status) on public.portal_orders to authenticated;
grant select, insert, delete on public.portal_documents to authenticated;
grant all on public.portal_profiles, public.portal_cart, public.portal_orders, public.portal_documents to service_role;
revoke all on public.portal_role_history from anon, authenticated;
grant select on public.portal_role_history to authenticated;
create policy portal_history_owner on public.portal_role_history for select to authenticated
  using ((select portal_private.can_manage('roles')));

create function portal_private.record_role_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and (old.role, old.permissions) is distinct from (new.role, new.permissions) then
    insert into public.portal_role_history
      (changed_by, account_id, previous_role, new_role, previous_permissions, new_permissions)
    values (auth.uid(), new.user_id, old.role, new.role, old.permissions, new.permissions);
  end if;
  return new;
end;
$$;
revoke all on function portal_private.record_role_change() from public;
create trigger portal_role_change after update of role, permissions on public.portal_profiles
  for each row execute function portal_private.record_role_change();

create policy portal_profiles_read on public.portal_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select portal_private.can_manage('customers')));
create policy portal_profiles_create on public.portal_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and role = 'customer' and permissions = '{}');
create policy portal_roles_change on public.portal_profiles for update to authenticated
  using (role <> 'owner' and (select portal_private.can_manage('roles')))
  with check (role <> 'owner' and (select portal_private.can_manage('roles')));
create policy portal_cart_own on public.portal_cart for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy portal_orders_read on public.portal_orders for select to authenticated
  using (user_id = (select auth.uid()) or (select portal_private.can_manage('orders')));
create policy portal_orders_fulfil on public.portal_orders for update to authenticated
  using ((select portal_private.can_manage('orders'))) with check ((select portal_private.can_manage('orders')));
create policy portal_documents_read on public.portal_documents for select to authenticated
  using (user_id = (select auth.uid()) or (select portal_private.can_manage('documents')));
create policy portal_documents_assign on public.portal_documents for insert to authenticated
  with check ((select portal_private.can_manage('documents')));
create policy portal_documents_revoke on public.portal_documents for delete to authenticated
  using ((select portal_private.can_manage('documents')));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-private-pdfs', 'portal-private-pdfs', false, 10485760, array['application/pdf']);
create policy portal_pdf_read on storage.objects for select to authenticated using (
  bucket_id = 'portal-private-pdfs' and (
    (select portal_private.can_manage('documents')) or exists (
      select 1 from public.portal_documents d where d.object_path = storage.objects.name and d.user_id = (select auth.uid())
    )
  )
);
create policy portal_pdf_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'portal-private-pdfs' and (select portal_private.can_manage('documents')));
create policy portal_pdf_delete on storage.objects for delete to authenticated
  using (bucket_id = 'portal-private-pdfs' and (select portal_private.can_manage('documents')));

commit;
