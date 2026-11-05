alter table public.store_settings
  add column if not exists accept_online boolean not null default false,
  add column if not exists accept_offline boolean not null default true,
  add column if not exists upi_id text not null default '',
  add column if not exists upi_name text not null default '',
  add column if not exists upi_note text not null default '';

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('cash', 'upi', 'payzapi_fampay'));