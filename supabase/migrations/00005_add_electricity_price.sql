-- Electricity sell price per kWh (in the user's local currency).
-- Used to calculate monetary losses from soiling/shading.

alter table public.solar_systems
  add column if not exists electricity_price_per_kwh double precision;
