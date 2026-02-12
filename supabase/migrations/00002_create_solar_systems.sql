-- Solar systems table: one system per user (for now).
-- Run this in the Supabase SQL Editor after 00001.

create table public.solar_systems (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  site_id text not null,
  api_key text not null,
  system_name text not null,
  provider text not null default 'solaredge' check (provider in ('solaredge')),
  created_at timestamptz default now(),
  last_synced_at timestamptz
);

-- Enable RLS
alter table public.solar_systems enable row level security;

-- Users can read their own system
create policy "Users can read own system"
  on public.solar_systems for select using (auth.uid() = user_id);

-- Users can insert their own system
create policy "Users can insert own system"
  on public.solar_systems for insert with check (auth.uid() = user_id);

-- Users can update their own system
create policy "Users can update own system"
  on public.solar_systems for update using (auth.uid() = user_id);

-- Users can delete their own system
create policy "Users can delete own system"
  on public.solar_systems for delete using (auth.uid() = user_id);


-- Sync data table: stores fetched SolarEdge data snapshots.

create table public.sync_data (
  id uuid default gen_random_uuid() primary key,
  system_id uuid references public.solar_systems on delete cascade not null,
  sync_type text not null check (sync_type in ('overview', 'energy', 'power')),
  data jsonb not null default '{}',
  period_start date,
  period_end date,
  synced_at timestamptz default now()
);

-- Enable RLS
alter table public.sync_data enable row level security;

-- Users can read sync data for their own systems
create policy "Users can read own sync data"
  on public.sync_data for select using (
    exists (
      select 1 from public.solar_systems
      where solar_systems.id = sync_data.system_id
        and solar_systems.user_id = auth.uid()
    )
  );

-- Users can insert sync data for their own systems
create policy "Users can insert own sync data"
  on public.sync_data for insert with check (
    exists (
      select 1 from public.solar_systems
      where solar_systems.id = sync_data.system_id
        and solar_systems.user_id = auth.uid()
    )
  );

-- Users can delete sync data for their own systems
create policy "Users can delete own sync data"
  on public.sync_data for delete using (
    exists (
      select 1 from public.solar_systems
      where solar_systems.id = sync_data.system_id
        and solar_systems.user_id = auth.uid()
    )
  );

-- Index for fast lookup
create index idx_sync_data_system_id on public.sync_data (system_id);
create index idx_sync_data_type on public.sync_data (system_id, sync_type);

