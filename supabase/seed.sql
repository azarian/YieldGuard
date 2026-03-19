-- Seed data for local development.
-- Creates a test user and sample solar system so developers can
-- start working immediately after `supabase start`.
--
-- Test credentials:
--   Email:    dev@yieldguard.local
--   Password: password123

-- Create a test user in Supabase Auth
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, raw_app_meta_data, raw_user_meta_data,
  is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'authenticated', 'authenticated', 'dev@yieldguard.local',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '', '{"provider":"email","providers":["email"]}',
  '{"role":"owner","full_name":"Dev User"}',
  false
);

-- The handle_new_user trigger creates the profile automatically.

-- Create a sample solar system (SolarEdge demo site)
insert into public.solar_systems (
  id, user_id, site_id, api_key, system_name, provider, installation_date
) values (
  'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '1353684',
  'DEMO_API_KEY',
  'Dev Test System',
  'solaredge',
  '2023-01-15'
);
