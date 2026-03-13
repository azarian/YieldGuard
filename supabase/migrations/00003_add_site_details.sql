-- Add site details columns fetched from SolarEdge site details API.
-- These are needed for irradiance-based loss analysis.

alter table public.solar_systems
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists peak_power_kwp double precision,
  add column if not exists azimuth double precision,
  add column if not exists tilt double precision;
