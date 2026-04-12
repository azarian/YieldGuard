-- Pipeline architecture: reconciliation-based workers with desired-state vs actual-state model.
-- Replaces: fetched_periods, sync_coverage (overlapping tracking), site_energy_daily (dead code).
-- Adds: pipeline_workers, data_coverage, worker_state, work_units, analysis_results, daily_energy.

-- ── 1. Worker registry ──────────────────────────────────────────────────────

create table public.pipeline_workers (
  id              text primary key,
  display_name    text not null,
  description     text,
  worker_type     text not null check (worker_type in ('raw', 'derived', 'analysis')),
  depends_on      text[] default '{}',
  trigger_type    text not null check (trigger_type in ('data', 'schedule', 'manual')),
  schedule_cron   text,
  enabled         boolean default true
);

insert into public.pipeline_workers values
  ('inverter_telemetry',  'Equipment Telemetry',    'Per-inverter 15-min power/voltage/current from SolarEdge public API',   'raw',      '{}',                                        'data',     null, true),
  ('optimizer_telemetry', 'Per-Panel Telemetry',     'Per-optimizer power from SolarEdge portal',                             'raw',      '{}',                                        'data',     null, true),
  ('site_energy_15min',   'Site Energy (15-min)',     'Aggregated site energy at 15-min intervals',                            'derived',  '{inverter_telemetry}',                      'data',     null, true),
  ('daily_energy',        'Daily Energy',             'Daily energy totals derived from 15-min telemetry',                     'derived',  '{inverter_telemetry}',                      'data',     null, true),
  ('soiling_analysis',    'Soiling Analysis',         'Soiling ratio, loss estimation, cleaning events',                       'analysis', '{site_energy_15min}',                       'schedule', null, true),
  ('panel_comparison',    'Panel Comparison',         'Per-panel performance deviation analysis',                              'analysis', '{inverter_telemetry,optimizer_telemetry}',  'schedule', null, true);

-- ── 2. Unified data coverage (replaces fetched_periods + sync_coverage) ─────

create table public.data_coverage (
  id            uuid primary key default gen_random_uuid(),
  system_id     uuid not null references public.solar_systems(id) on delete cascade,
  worker_id     text not null references public.pipeline_workers(id),
  equipment_id  uuid references public.equipment(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'fetched' check (status in ('fetched', 'missing', 'error')),
  record_count  int default 0,
  fetched_at    timestamptz default now(),
  check (period_end >= period_start)
);

create index idx_data_coverage_lookup on public.data_coverage (system_id, worker_id);
create index idx_data_coverage_equipment on public.data_coverage (equipment_id) where equipment_id is not null;

alter table public.data_coverage enable row level security;

create policy "Users can read own data_coverage"
  on public.data_coverage for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = data_coverage.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own data_coverage"
  on public.data_coverage for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = data_coverage.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can delete own data_coverage"
  on public.data_coverage for delete using (
    exists (select 1 from public.solar_systems where solar_systems.id = data_coverage.system_id and solar_systems.user_id = auth.uid())
  );

-- Migrate existing sync_coverage data
insert into public.data_coverage (system_id, worker_id, period_start, period_end, status, fetched_at)
select system_id,
       case source
         when 'inverter'    then 'inverter_telemetry'
         when 'optimizer'   then 'optimizer_telemetry'
         when 'site_energy' then 'site_energy_15min'
       end,
       period_start, period_end, status, fetched_at
from public.sync_coverage;

-- ── 3. Worker run state (per system × worker) ───────────────────────────────

create table public.worker_state (
  system_id     uuid not null references public.solar_systems(id) on delete cascade,
  worker_id     text not null references public.pipeline_workers(id),
  status        text not null default 'idle' check (status in ('idle', 'running', 'paused', 'error')),
  last_run_at   timestamptz,
  next_run_at   timestamptz,
  progress      jsonb default '{}',
  error_message text,
  coverage_hash text,
  updated_at    timestamptz default now(),
  primary key (system_id, worker_id)
);

alter table public.worker_state enable row level security;

create policy "Users can read own worker_state"
  on public.worker_state for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = worker_state.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own worker_state"
  on public.worker_state for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = worker_state.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can update own worker_state"
  on public.worker_state for update using (
    exists (select 1 from public.solar_systems where solar_systems.id = worker_state.system_id and solar_systems.user_id = auth.uid())
  );

-- ── 4. Work units (chunk queue for workers) ─────────────────────────────────

create table public.work_units (
  id            uuid primary key default gen_random_uuid(),
  system_id     uuid not null references public.solar_systems(id) on delete cascade,
  worker_id     text not null references public.pipeline_workers(id),
  equipment_id  uuid references public.equipment(id) on delete cascade,
  period_start  date,
  period_end    date,
  status        text not null default 'pending' check (status in ('pending', 'running', 'done', 'error', 'skipped')),
  error_message text,
  records_stored int default 0,
  created_at    timestamptz default now(),
  processed_at  timestamptz
);

create index idx_work_units_pending on public.work_units (system_id, worker_id, status)
  where status = 'pending';

alter table public.work_units enable row level security;

create policy "Users can read own work_units"
  on public.work_units for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = work_units.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own work_units"
  on public.work_units for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = work_units.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can update own work_units"
  on public.work_units for update using (
    exists (select 1 from public.solar_systems where solar_systems.id = work_units.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can delete own work_units"
  on public.work_units for delete using (
    exists (select 1 from public.solar_systems where solar_systems.id = work_units.system_id and solar_systems.user_id = auth.uid())
  );

-- ── 5. Analysis results cache ───────────────────────────────────────────────

create table public.analysis_results (
  id              uuid primary key default gen_random_uuid(),
  system_id       uuid not null references public.solar_systems(id) on delete cascade,
  worker_id       text not null references public.pipeline_workers(id),
  data_start      date not null,
  data_end        date not null,
  coverage_hash   text not null,
  summary         jsonb not null default '{}',
  daily_data      jsonb,
  events          jsonb,
  computed_at     timestamptz default now(),
  unique (system_id, worker_id)
);

alter table public.analysis_results enable row level security;

create policy "Users can read own analysis_results"
  on public.analysis_results for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = analysis_results.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own analysis_results"
  on public.analysis_results for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = analysis_results.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can update own analysis_results"
  on public.analysis_results for update using (
    exists (select 1 from public.solar_systems where solar_systems.id = analysis_results.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can delete own analysis_results"
  on public.analysis_results for delete using (
    exists (select 1 from public.solar_systems where solar_systems.id = analysis_results.system_id and solar_systems.user_id = auth.uid())
  );

-- ── 6. Daily energy (replaces dead site_energy_daily) ───────────────────────

drop table if exists public.site_energy_daily;

create table public.daily_energy (
  system_id   uuid not null references public.solar_systems(id) on delete cascade,
  date        date not null,
  energy_wh   double precision not null,
  source      text not null default 'computed',
  computed_at timestamptz default now(),
  primary key (system_id, date)
);

alter table public.daily_energy enable row level security;

create policy "Users can read own daily_energy"
  on public.daily_energy for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = daily_energy.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own daily_energy"
  on public.daily_energy for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = daily_energy.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can update own daily_energy"
  on public.daily_energy for update using (
    exists (select 1 from public.solar_systems where solar_systems.id = daily_energy.system_id and solar_systems.user_id = auth.uid())
  );
