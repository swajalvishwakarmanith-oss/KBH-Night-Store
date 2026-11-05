create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  price numeric(10, 2) not null check (price >= 0),
  category text,
  description text check (description is null or char_length(description) <= 300),
  image_url text,
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.store_settings (
  id boolean primary key default true check (id),
  pickup_room text not null default '',
  is_open boolean not null default true,
  accept_online boolean not null default false,
  accept_offline boolean not null default true,
  upi_id text not null default '',
  upi_name text not null default '',
  upi_note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.store_settings
  add column if not exists is_open boolean not null default true,
  add column if not exists accept_online boolean not null default false,
  add column if not exists accept_offline boolean not null default true,
  add column if not exists upi_id text not null default '',
  add column if not exists upi_name text not null default '',
  add column if not exists upi_note text not null default '';

insert into public.store_settings (id, pickup_room, is_open)
values (true, '', true)
on conflict (id) do nothing;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  customer_name text not null,
  customer_phone text not null,
  customer_room text not null,
  payment_method text not null check (payment_method in ('cash', 'upi', 'payzapi_fampay')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'cancelled')),
  order_status text not null default 'received' check (order_status in ('received', 'preparing', 'ready', 'collected', 'cancelled')),
  total numeric(10, 2) not null check (total >= 0),
  payzapi_order_id text unique,
  payzapi_payable_amount numeric(10, 2),
  payzapi_utr text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 99),
  line_total numeric(10, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists order_items_order_id_idx on public.order_items (order_id);

create or replace function public.generate_customer_order_code(p_customer_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  customer_initial text;
  day_order_number integer;
begin
  customer_initial := upper(substr(regexp_replace(coalesce(p_customer_name, ''), '[^A-Za-z]', '', 'g'), 1, 1));
  if customer_initial = '' then
    customer_initial := 'X';
  end if;

  select coalesce(max(cast(split_part(o.order_code, '-', 2) as integer)), 0) + 1
  into day_order_number
  from public.orders o
  where o.created_at >= date_trunc('day', now())
    and o.created_at < date_trunc('day', now()) + interval '1 day'
    and upper(substr(regexp_replace(o.customer_name, '[^A-Za-z]', '', 'g'), 1, 1)) = customer_initial;

  return customer_initial || '-' || lpad(day_order_number::text, 3, '0');
end;
$$;

create or replace function public.set_order_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.order_code is null or trim(new.order_code) = '' then
    new.order_code := public.generate_customer_order_code(new.customer_name);
  end if;
  return new;
end;
$$;

create trigger orders_generate_code
before insert or update of customer_name on public.orders
for each row
when (new.order_code is null or trim(new.order_code) = '')
execute function public.set_order_code();

create or replace function public.get_customer_orders(p_customer_name text, p_customer_phone text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_name text := lower(trim(coalesce(p_customer_name, '')));
  normalized_phone text := regexp_replace(lower(trim(coalesce(p_customer_phone, ''))), '[^0-9]', '', 'g');
  result json;
begin
  if normalized_name = '' or normalized_phone = '' then
    return '[]'::json;
  end if;

  select json_agg(order_bundle order by order_bundle.created_at desc) into result
  from (
    select
      o.id,
      o.order_code,
      o.customer_name,
      o.customer_phone,
      o.customer_room,
      o.payment_method,
      o.payment_status,
      o.order_status,
      o.total,
      o.created_at,
      coalesce(
        (
          select json_agg(
            json_build_object(
              'product_name', item.product_name,
              'quantity', item.quantity,
              'unit_price', item.unit_price,
              'line_total', item.line_total
            )
            order by item.created_at
          )
          from public.order_items item
          where item.order_id = o.id
        ),
        '[]'::json
      ) as items
    from public.orders o
    where lower(trim(o.customer_name)) = normalized_name
      and regexp_replace(lower(trim(o.customer_phone)), '[^0-9]', '', 'g') = normalized_phone
    limit 10
  ) as order_bundle;

  return coalesce(result, '[]'::json);
end;
$$;

revoke all on function public.get_customer_orders(text, text) from public, anon, authenticated;
grant execute on function public.get_customer_orders(text, text) to anon, authenticated;

create table if not exists public.order_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

revoke all on public.order_rate_limits from public, anon, authenticated, service_role;

create or replace function public.consume_order_rate_limit(p_ip_hash text, p_limit integer default 15, p_window_seconds integer default 600)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 or p_window_seconds < 60 or p_window_seconds > 3600 then
    raise exception 'Invalid rate limit parameters';
  end if;

  delete from public.order_rate_limits
  where window_started_at < now() - interval '1 day';

  insert into public.order_rate_limits as limits (ip_hash, window_started_at, request_count)
  values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update set
    window_started_at = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else limits.request_count + 1
    end
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_order_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_order_rate_limit(text, integer, integer) to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.products enable row level security;
alter table public.admin_users enable row level security;
alter table public.store_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_rate_limits enable row level security;

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.admin_users to authenticated;
grant select on public.store_settings to anon, authenticated;
grant insert, update on public.store_settings to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant all on public.orders, public.order_items to service_role;

drop policy if exists "Anyone can read available products" on public.products;
create policy "Anyone can read available products"
  on public.products for select to anon, authenticated
  using (available = true);

drop policy if exists "Approved admins can manage products" on public.products;
create policy "Approved admins can manage products"
  on public.products for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read their own admin approval" on public.admin_users;
create policy "Users can read their own admin approval"
  on public.admin_users for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Anyone can read pickup settings" on public.store_settings;
create policy "Anyone can read pickup settings"
  on public.store_settings for select to anon, authenticated
  using (true);

drop policy if exists "Approved admins can add pickup settings" on public.store_settings;
create policy "Approved admins can add pickup settings"
  on public.store_settings for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Approved admins can update pickup settings" on public.store_settings;
create policy "Approved admins can update pickup settings"
  on public.store_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Approved admins can view orders" on public.orders;
create policy "Approved admins can view orders"
  on public.orders for select to authenticated
  using (public.is_admin());

drop policy if exists "Approved admins can update orders" on public.orders;
create policy "Approved admins can update orders"
  on public.orders for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Approved admins can view order items" on public.order_items;
create policy "Approved admins can view order items"
  on public.order_items for select to authenticated
  using (public.is_admin());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'store_settings'
    ) then
    alter publication supabase_realtime add table public.store_settings;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'products'
    ) then
    alter publication supabase_realtime add table public.products;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'orders'
    ) then
    alter publication supabase_realtime add table public.orders;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'order_items'
    ) then
    alter publication supabase_realtime add table public.order_items;
  end if;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[];

drop policy if exists "Anyone can view product images" on storage.objects;
create policy "Anyone can view product images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists "Approved admins can upload product images" on storage.objects;
create policy "Approved admins can upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Approved admins can update product images" on storage.objects;
create policy "Approved admins can update product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Approved admins can delete product images" on storage.objects;
create policy "Approved admins can delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());