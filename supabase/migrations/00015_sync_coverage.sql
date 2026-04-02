-- Unified sync coverage tracking with 3-state model:
--   fetched: data was downloaded and stored
--   missing: API returned no data for this range (it doesn't exist)
-- Gaps between records are implicitly "not_fetched".

create table public.sync_coverage (
  id           uuid primary key default gen_random_uuid(),
  system_id    uuid not null references public.solar_systems(id) on delete cascade,
  source       text not null check (source in ('inverter', 'optimizer', 'site_energy')),
  period_start date not null,
  period_end   date not null,
  status       text not null default 'fetched' check (status in ('fetched', 'missing')),
  fetched_at   timestamptz default now(),
  check (period_end >= period_start)
);

alter table public.sync_coverage enable row level security;

create policy "Users can read own sync_coverage"
  on public.sync_coverage for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = sync_coverage.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own sync_coverage"
  on public.sync_coverage for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = sync_coverage.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can delete own sync_coverage"
  on public.sync_coverage for delete using (
    exists (select 1 from public.solar_systems where solar_systems.id = sync_coverage.system_id and solar_systems.user_id = auth.uid())
  );

create index idx_sync_coverage_system_source on public.sync_coverage (system_id, source, period_start);
