-- Add altitude column needed by the pvlib clear-sky model.
-- Defaults to 0 (sea level) which has negligible effect on results.
alter table public.solar_systems
  add column if not exists altitude double precision default 0;
