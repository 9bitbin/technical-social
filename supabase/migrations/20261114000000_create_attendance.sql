create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  email text not null unique check (email = lower(trim(email))),
  linkedin text not null check (length(trim(linkedin)) > 0),
  website text,
  profession text,
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  date date not null default (timezone('utc', now())::date),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint attendance_user_date_unique unique (user_id, date)
);

create index attendance_date_idx on public.attendance (date);

alter table public.users enable row level security;
alter table public.attendance enable row level security;

revoke all on public.users, public.attendance from anon, authenticated;
grant select on public.users, public.attendance to authenticated;
grant insert on public.attendance to authenticated;

create policy "users can read their own profile by email claim"
  on public.users for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "users can read their own attendance by email claim"
  on public.attendance for select to authenticated
  using (
    exists (
      select 1
      from public.users as attendee
      where attendee.id = attendance.user_id
        and lower(attendee.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

create policy "users can record their own attendance by email claim"
  on public.attendance for insert to authenticated
  with check (
    exists (
      select 1
      from public.users as attendee
      where attendee.id = attendance.user_id
        and lower(attendee.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

create or replace function public.record_attendance(attendee_id uuid, attendance_date date)
returns void
language sql
set search_path = ''
as $$
  insert into public.attendance (user_id, date)
  values (attendee_id, attendance_date)
  on conflict (user_id, date) do nothing;
$$;

create or replace function public.register_and_attend(
  attendee_name text,
  attendee_email text,
  attendee_linkedin text,
  attendee_website text,
  attendee_profession text,
  attendance_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_user_id uuid;
begin
  insert into public.users (name, email, linkedin, website, profession)
  values (
    trim(attendee_name),
    lower(trim(attendee_email)),
    trim(attendee_linkedin),
    nullif(trim(attendee_website), ''),
    nullif(trim(attendee_profession), '')
  )
  returning id into new_user_id;

  insert into public.attendance (user_id, date)
  values (new_user_id, attendance_date);

  return new_user_id;
end;
$$;

revoke all on function public.record_attendance(uuid, date) from public, anon, authenticated;
revoke all on function public.register_and_attend(text, text, text, text, text, date) from public, anon, authenticated;
grant execute on function public.record_attendance(uuid, date) to service_role;
grant execute on function public.register_and_attend(text, text, text, text, text, date) to service_role;
