-- Site-level 15-min energy for soiling analysis.
-- Mirrors the SolarEdge site/{id}/energy?timeUnit=QUARTER_OF_AN_HOUR response.
-- Timestamps are in the site's LOCAL time (naive), matching the SolarEdge API format.
-- Data is fetched once on first analysis run and cached here for subsequent runs.

create table public.site_energy_15min (
  system_id  uuid not null references public.solar_systems(id) on delete cascade,
  ts         timestamp not null,
  energy_wh  double precision not null,
  primary key (system_id, ts)
);

alter table public.site_energy_15min enable row level security;

create policy "Users can read own 15min energy"
  on public.site_energy_15min for select using (
    exists (select 1 from public.solar_systems where solar_systems.id = site_energy_15min.system_id and solar_systems.user_id = auth.uid())
  );
create policy "Users can insert own 15min energy"
  on public.site_energy_15min for insert with check (
    exists (select 1 from public.solar_systems where solar_systems.id = site_energy_15min.system_id and solar_systems.user_id = auth.uid())
  );

create index idx_site_energy_15min_ts on public.site_energy_15min (system_id, ts);
