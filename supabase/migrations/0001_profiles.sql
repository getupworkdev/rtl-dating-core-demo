-- Profiles. The phone number comes from the verified sign-in (Supabase phone OTP), never from the
-- request body, and is never readable by other users.

create table profiles (
  id             uuid primary key,                 -- = auth.users.id
  phone_e164     text not null unique,
  display_name   text not null check (char_length(display_name) between 2 and 40),
  bio            text not null default '' check (char_length(bio) <= 500),
  gender         text not null check (gender in ('woman', 'man')),
  seeking        text[] not null check (cardinality(seeking) between 1 and 2 and seeking <@ array['woman', 'man']),
  age_min        int  not null default 18 check (age_min >= 18),
  age_max        int  not null default 99 check (age_max <= 99),
  city           text not null check (char_length(city) between 2 and 60),
  -- Set only by the verification webhook, never by the user:
  birth_date     date,
  verification_ref text unique,
  verified_at    timestamptz,
  status         text not null default 'pending_verification'
                 check (status in ('pending_verification', 'active', 'blocked_underage', 'banned')),
  is_admin       boolean not null default false,
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  check (age_min <= age_max)
);

-- Phone from the signed-in session (Supabase puts it in the JWT after OTP).
create or replace function request_phone() returns text
language sql stable as $$ select nullif(auth.jwt() ->> 'phone', '') $$;

-- Whole years, used everywhere an age is shown or filtered. Birth date itself is never exposed.
create or replace function age_of(p_birth date) returns int
language sql immutable as $$ select extract(year from age(current_date, p_birth))::int $$;

create or replace function register_profile(
  p_display_name text, p_gender text, p_seeking text[], p_age_min int, p_age_max int, p_city text, p_bio text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text := request_phone();
begin
  if auth.uid() is null or v_phone is null then raise exception 'sign in with your phone number first'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'profile already exists'; end if;
  insert into profiles (id, phone_e164, display_name, gender, seeking, age_min, age_max, city, bio)
  values (auth.uid(), v_phone, btrim(p_display_name), p_gender, p_seeking, p_age_min, p_age_max, btrim(p_city), coalesce(p_bio, ''));
end $$;

create or replace function update_my_profile(
  p_display_name text, p_bio text, p_seeking text[], p_age_min int, p_age_max int, p_city text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set display_name = btrim(p_display_name), bio = coalesce(p_bio, ''), seeking = p_seeking,
         age_min = p_age_min, age_max = p_age_max, city = btrim(p_city), last_active_at = now()
  where id = auth.uid();
  if not found then raise exception 'no profile'; end if;
end $$;

-- The owner's full view of their own profile (including phone and status).
create or replace function my_profile() returns table (
  id uuid, phone_e164 text, display_name text, bio text, gender text, seeking text[], age_min int, age_max int,
  city text, age int, status text, verified boolean
)
language sql stable security definer set search_path = public as $$
  select id, phone_e164, display_name, bio, gender, seeking, age_min, age_max, city,
         case when birth_date is null then null else age_of(birth_date) end, status, verified_at is not null
  from profiles where id = auth.uid()
$$;

alter table profiles enable row level security;
-- Reading other people's profiles goes through discover() / my_matches(); direct reads are self only for now.
create policy profiles_self on profiles for select to authenticated using (id = auth.uid());

-- Column-level privacy: even where a row is visible, phone, birth date, verification and admin flags are not.
revoke all on profiles from anon, authenticated;
grant select (id, display_name, bio, gender, city) on profiles to authenticated;

revoke execute on function register_profile(text, text, text[], int, int, text, text) from public, anon;
revoke execute on function update_my_profile(text, text, text[], int, int, text) from public, anon;
revoke execute on function my_profile() from public, anon;
grant execute on function register_profile(text, text, text[], int, int, text, text),
  update_my_profile(text, text, text[], int, int, text), my_profile() to authenticated;
