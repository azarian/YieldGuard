-- Remove portal credential columns (per-optimizer sync via portal is not feasible)
alter table public.solar_systems
  drop column if exists se_portal_username,
  drop column if exists se_portal_password_encrypted;
