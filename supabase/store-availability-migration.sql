alter table public.store_settings
  add column if not exists is_open boolean not null default true;

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
end
$$;