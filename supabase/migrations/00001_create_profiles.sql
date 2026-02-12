-- Create the profiles table to store user roles and metadata.
-- Run this in the Supabase SQL Editor (or via the Supabase CLI).

create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  role text not null check (role in ('owner', 'provider', 'admin')),
  full_name text,
  created_at timestamptz default now()
);

-- Enable Row-Level Security
alter table public.profiles enable row level security;

-- Users can read their own profile
create policy "Users can read own profile"
  on public.profiles for select using (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Trigger function: automatically create a profile row when a new user signs up.
-- It reads role and full_name from the user's raw_user_meta_data (passed during signUp).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'owner'),
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Fire the trigger after every new row in auth.users
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
