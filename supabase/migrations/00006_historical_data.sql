-- Equipment: inverters and optimizers discovered from SolarEdge
create table public.equipment (
  id              uuid primary key default gen_random_uuid(),
  system_id       uuid not null references public.solar_systems(id) on delete cascade,
  serial_number   text not null,
  equipment_type  text not null check (equipment_type in ('inverter','optimizer')),
  name            text,
  manufacturer    text,
  model           text,
  connected_to    text,
  unique (system_id, serial_number)
);

alter table public.equipment enable row level security;

create policy "Users can read own equipment"
  on public.equipment for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = equipment.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own equipment"
  on public.equipment for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = equipment.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can update own equipment"
  on public.equipment for update using (
    exists (select 1 from public.solar_systems where solar_systems.id = equipment.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can delete own equipment"
  on public.equipment for delete using (
    exists (select 1 from public.solar_systems where solar_systems.id = equipment.system_id and solar_systems.user_id = auth.uid())
  );

-- Equipment telemetry: 15-min per equipment (the bulk time-series table)
create table public.equipment_telemetry (
  equipment_id  uuid not null references public.equipment(id) on delete cascade,
  ts            timestamptz not null,
  power_w       double precision,
  voltage       double precision,
  current_a     double precision,
  energy_wh     double precision,
  temperature_c double precision,
  primary key (equipment_id, ts)
);

alter table public.equipment_telemetry enable row level security;

create policy "Users can read own telemetry"
  on public.equipment_telemetry for select using (
    exists (
      select 1 from public.equipment e
      join public.solar_systems s on s.id = e.system_id
      where e.id = equipment_telemetry.equipment_id and s.user_id = auth.uid()
    )
  );
create policy "Users can insert own telemetry"
  on public.equipment_telemetry for insert with check (
    exists (
      select 1 from public.equipment e
      join public.solar_systems s on s.id = e.system_id
      where e.id = equipment_telemetry.equipment_id and s.user_id = auth.uid()
    )
  );

create index idx_telemetry_ts on public.equipment_telemetry (ts);
create index idx_telemetry_equip_ts on public.equipment_telemetry (equipment_id, ts desc);

-- Site-level daily energy aggregate
create table public.site_energy_daily (
  system_id  uuid not null references public.solar_systems(id) on delete cascade,
  date       date not null,
  energy_wh  double precision,
  primary key (system_id, date)
);

alter table public.site_energy_daily enable row level security;

create policy "Users can read own daily energy"
  on public.site_energy_daily for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = site_energy_daily.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own daily energy"
  on public.site_energy_daily for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = site_energy_daily.system_id and solar_systems.user_id = auth.uid())
  );

-- Sync jobs: tracks backfill progress
create table public.sync_jobs (
  id               uuid primary key default gen_random_uuid(),
  system_id        uuid not null references public.solar_systems(id) on delete cascade,
  status           text not null default 'running' check (status in ('running','complete','error','paused')),
  total_chunks     int not null default 0,
  completed_chunks int not null default 0,
  current_equipment text,
  current_period    text,
  error_message    text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.sync_jobs enable row level security;

create policy "Users can read own sync jobs"
  on public.sync_jobs for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = sync_jobs.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own sync jobs"
  on public.sync_jobs for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = sync_jobs.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can update own sync jobs"
  on public.sync_jobs for update using (
    exists (select 1 from public.solar_systems where solar_systems.id = sync_jobs.system_id and solar_systems.user_id = auth.uid())
  );

-- Sync chunks: individual work items within a job
create table public.sync_chunks (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.sync_jobs(id) on delete cascade,
  equipment_id  uuid not null references public.equipment(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'pending' check (status in ('pending','done','error','skipped')),
  error_message text
);

alter table public.sync_chunks enable row level security;

create policy "Users can read own sync chunks"
  on public.sync_chunks for select using (
    exists (
      select 1 from public.sync_jobs j
      join public.solar_systems s on s.id = j.system_id
      where j.id = sync_chunks.job_id and s.user_id = auth.uid()
    )
  );
create policy "Users can insert own sync chunks"
  on public.sync_chunks for insert with check (
    exists (
      select 1 from public.sync_jobs j
      join public.solar_systems s on s.id = j.system_id
      where j.id = sync_chunks.job_id and s.user_id = auth.uid()
    )
  );
create policy "Users can update own sync chunks"
  on public.sync_chunks for update using (
    exists (
      select 1 from public.sync_jobs j
      join public.solar_systems s on s.id = j.system_id
      where j.id = sync_chunks.job_id and s.user_id = auth.uid()
    )
  );

create index idx_sync_chunks_pending on public.sync_chunks (job_id, status) where status = 'pending';

-- Add installation_date to solar_systems for determining backfill range
alter table public.solar_systems add column if not exists installation_date date;
