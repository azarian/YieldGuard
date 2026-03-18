alter table public.solar_systems
  add column if not exists currency text not null default 'ILS';
