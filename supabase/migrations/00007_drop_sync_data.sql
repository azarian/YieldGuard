-- Drop the legacy sync_data table now that we use equipment_telemetry and site_energy_daily.
-- The original table definition is preserved in 00002_create_solar_systems.sql for reference.
drop table if exists public.sync_data;
