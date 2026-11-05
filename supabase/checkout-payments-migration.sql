alter table public.store_settings
  add column if not exists accept_online boolean not null default false,
  add column if not exists accept_offline boolean not null default true;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  customer_name text not null,
  customer_phone text not null,
  customer_room text not null,
  payment_method text not null check (payment_method in ('cash', 'payzapi_fampay')),
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

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_rate_limits enable row level security;

grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant all on public.orders, public.order_items to service_role;

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