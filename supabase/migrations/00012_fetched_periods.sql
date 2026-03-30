-- Track which date ranges have been successfully fetched for each equipment.
-- This prevents re-fetching historical data that we already have.

create table public.fetched_periods (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references public.equipment(id) on delete cascade,
  source        text not null check (source in ('public_api', 'portal_api')),
  period_start  date not null,
  period_end    date not null,
  fetched_at    timestamptz default now(),
  check (period_end >= period_start)
);

alter table public.fetched_periods enable row level security;

create policy "Users can read own fetched_periods"
  on public.fetched_periods for select using (
    exists (
      select 1 from public.equipment e
      join public.solar_systems s on s.id = e.system_id
      where e.id = fetched_periods.equipment_id and s.user_id = auth.uid()
    )
  );

create policy "Users can insert own fetched_periods"
  on public.fetched_periods for insert with check (
    exists (
      select 1 from public.equipment e
      join public.solar_systems s on s.id = e.system_id
      where e.id = fetched_periods.equipment_id and s.user_id = auth.uid()
    )
  );

create policy "Users can delete own fetched_periods"
  on public.fetched_periods for delete using (
    exists (
      select 1 from public.equipment e
      join public.solar_systems s on s.id = e.system_id
      where e.id = fetched_periods.equipment_id and s.user_id = auth.uid()
    )
  );

create index idx_fetched_periods_equip on public.fetched_periods (equipment_id, source);

-- Helper function: merge overlapping/adjacent periods for an equipment+source.
-- Call after inserting new periods to keep the table compact.
create or replace function public.merge_fetched_periods(p_equipment_id uuid, p_source text)
returns void as $$
declare
  merged record;
  cur_start date;
  cur_end date;
  first_row boolean := true;
begin
  -- Collect merged ranges
  create temp table _merged_periods (period_start date, period_end date) on commit drop;

  for merged in
    select period_start, period_end
    from public.fetched_periods
    where equipment_id = p_equipment_id and source = p_source
    order by period_start
  loop
    if first_row then
      cur_start := merged.period_start;
      cur_end := merged.period_end;
      first_row := false;
    elsif merged.period_start <= cur_end + 1 then
      -- Overlapping or adjacent — extend
      if merged.period_end > cur_end then
        cur_end := merged.period_end;
      end if;
    else
      -- Gap — save current range and start new one
      insert into _merged_periods values (cur_start, cur_end);
      cur_start := merged.period_start;
      cur_end := merged.period_end;
    end if;
  end loop;

  if not first_row then
    insert into _merged_periods values (cur_start, cur_end);
  end if;

  -- Replace old rows with merged ones
  delete from public.fetched_periods
  where equipment_id = p_equipment_id and source = p_source;

  insert into public.fetched_periods (equipment_id, source, period_start, period_end)
  select p_equipment_id, p_source, period_start, period_end
  from _merged_periods;
end;
$$ language plpgsql security definer;
