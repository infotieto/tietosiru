-- =============================================================================
-- 001_core.sql — Tietosiru Store core schema
-- Apply in Supabase SQL Editor or via `supabase db push`.
-- Requires: pgcrypto extension. Enable pg_cron manually in Dashboard if needed.
-- =============================================================================

-- Extensions
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Customers: allow-list for member login + billing data. Soft-delete for 6y retention.
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  company text,
  ytunnus text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_customers_email on public.customers (lower(email));
create index if not exists idx_customers_deleted_at on public.customers (deleted_at);

-- Products: managed in admin, visible only after member login (Finnish only)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  vat_percent integer not null default 24 check (vat_percent >= 0 and vat_percent <= 100),
  stock integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_active on public.products (active);

-- Orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'tilattu' check (status in ('tilattu','laskutettu','maksettu','hyvitetty')),
  total_cents integer not null check (total_cents >= 0),
  invoice_number text unique,
  invoice_pdf_url text,
  credit_note_number text unique,
  credit_note_url text,
  cancel_token uuid unique default gen_random_uuid(),
  cancel_token_expires_at timestamptz,
  cancelled_at timestamptz,
  cancel_method text check (cancel_method in ('customer_self_service','admin')),
  credited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_orders_customer on public.orders (customer_id);
create index if not exists idx_orders_invoice_number on public.orders (invoice_number);
create index if not exists idx_orders_cancel_token on public.orders (cancel_token);
create index if not exists idx_orders_created_at on public.orders (created_at);

-- Order items: price snapshot at order time
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  qty integer not null check (qty > 0),
  price_cents integer not null check (price_cents >= 0),
  vat_percent integer not null check (vat_percent >= 0 and vat_percent <= 100)
);
create index if not exists idx_order_items_order on public.order_items (order_id);

-- Admin users: link to auth.users
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- Cancel logs (single-use token attempts)
create table if not exists public.order_cancel_logs (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  ip text,
  user_agent text,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_cancel_logs_token on public.order_cancel_logs (token);
create index if not exists idx_cancel_logs_attempted_at on public.order_cancel_logs (attempted_at);

-- Per-year sequences
create table if not exists public.invoice_sequences (
  year integer primary key,
  next_number integer not null default 1
);
create table if not exists public.credit_note_sequences (
  year integer primary key,
  next_number integer not null default 1
);

-- ---------------------------------------------------------------------------
-- Helpers: updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Invoice numbering — per-year, gapless, thread-safe (PLAN §5.3)
-- ---------------------------------------------------------------------------
create or replace function public.generate_invoice_number()
returns text as $$
declare
  y integer := extract(year from now());
  n integer;
begin
  insert into public.invoice_sequences (year, next_number)
  values (y, 2)
  on conflict (year) do update set next_number = invoice_sequences.next_number + 1
  returning next_number - 1 into n;
  return y || '-' || lpad(n::text, 5, '0');
end;
$$ language plpgsql;

create or replace function public.generate_credit_note_number()
returns text as $$
declare
  y integer := extract(year from now());
  n integer;
begin
  insert into public.credit_note_sequences (year, next_number)
  values (y, 2)
  on conflict (year) do update set next_number = credit_note_sequences.next_number + 1
  returning next_number - 1 into n;
  return 'HYV-' || y || '-' || lpad(n::text, 5, '0');
end;
$$ language plpgsql;

create or replace function public.set_invoice_number()
returns trigger as $$
begin
  if new.invoice_number is null then
    new.invoice_number := public.generate_invoice_number();
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function public.set_credit_note_number()
returns trigger as $$
begin
  new.credit_note_number := public.generate_credit_note_number();
  return new;
end;
$$ language plpgsql;

drop trigger if exists orders_invoice_number_trigger on public.orders;
create trigger orders_invoice_number_trigger
  before insert on public.orders
  for each row execute function public.set_invoice_number();

drop trigger if exists orders_credit_note_number_trigger on public.orders;
create trigger orders_credit_note_number_trigger
  before update of status on public.orders
  for each row
  when (new.status = 'hyvitetty' and old.status != 'hyvitetty')
  execute function public.set_credit_note_number();

-- ---------------------------------------------------------------------------
-- Retention — soft-delete customers after 6 years without orders (PLAN §5.4)
-- ---------------------------------------------------------------------------
create or replace function public.delete_old_customer_data()
returns void as $$
begin
  update public.customers set deleted_at = now()
  where deleted_at is null
    and created_at < now() - interval '6 years'
    and id not in (
      select distinct customer_id from public.orders
      where customer_id is not null
        and created_at > now() - interval '6 years'
    );
end;
$$ language plpgsql;

-- Enable pg_cron in Dashboard > Database > Extensions, then schedule:
--   select cron.schedule('delete-old-customer-data', '0 3 1 1 *', 'select public.delete_old_customer_data()');
-- Optional: purge old accounting data after 6y (keep if needed for audit):
--   select cron.schedule('delete-old-orders', '0 3 2 1 *', $$delete from public.orders where created_at < now() - interval '6 years'$$);

-- ---------------------------------------------------------------------------
-- RLS — enable on all tables. Policies: default deny; admin + service_role
-- Service role bypasses RLS. Member auth is custom cookie -> server uses
-- service_role, so no anon policies needed except products (read active).
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_users enable row level security;
alter table public.order_cancel_logs enable row level security;
alter table public.invoice_sequences enable row level security;
alter table public.credit_note_sequences enable row level security;

-- Drop existing policies if re-running
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname='public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Customers: only admin can read/manage (member login uses service_role server-side)
create policy "admin manage customers" on public.customers
  for all using (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  ) with check (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );

-- Products: public can read active products (member pages are noindex but RLS allows)
-- Admin can manage all
create policy "anyone can read active products" on public.products
  for select using (active = true);
create policy "admin manage products" on public.products
  for all using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- Orders: admin only (customers never query orders via Supabase; server uses service_role)
create policy "admin manage orders" on public.orders
  for all using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "admin manage order_items" on public.order_items
  for all using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- Admin users: admin can read
create policy "admin read admin_users" on public.admin_users
  for select using (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- Cancel logs: admin read, anyone can insert (cancel endpoint logs anonymously via service_role anyway)
create policy "admin read cancel logs" on public.order_cancel_logs
  for select using (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- Sequences: admin only
create policy "admin manage invoice_sequences" on public.invoice_sequences
  for all using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));
create policy "admin manage credit_note_sequences" on public.credit_note_sequences
  for all using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage bucket: invoices (private)
-- Create via SQL if not exists (requires storage schema)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- Storage policies: admin can manage, service_role bypasses
do $$
begin
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='admin manage invoices') then
    drop policy "admin manage invoices" on storage.objects;
  end if;
end $$;

create policy "admin manage invoices"
on storage.objects for all
using (
  bucket_id = 'invoices'
  and exists (select 1 from public.admin_users where user_id = auth.uid())
)
with check (
  bucket_id = 'invoices'
  and exists (select 1 from public.admin_users where user_id = auth.uid())
);
