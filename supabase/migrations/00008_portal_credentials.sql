alter table public.solar_systems
  add column if not exists se_portal_username text,
  add column if not exists se_portal_password_encrypted text;
