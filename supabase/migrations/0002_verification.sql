-- Age verification and the under-18 block.
--
-- Neither iOS nor Android gives an app a device id that survives a reinstall, so "blocked on this
-- device" is a promise the app cannot keep. The block is anchored to what the backend can verify:
-- the phone number (OTP) and the verification vendor's identity reference. Only salted hashes are
-- kept, so the block survives account deletion without keeping a minor's phone number.

create table underage_registry (
  kind       text not null check (kind in ('phone', 'verification')),
  hash       text not null,
  created_at timestamptz not null default now(),
  primary key (kind, hash)
);
alter table underage_registry enable row level security;   -- no policies: invisible to app users
revoke all on underage_registry from anon, authenticated;

-- In production the salt lives in Vault / an Edge Function secret, not in a migration.
create or replace function registry_hash(p_value text) returns text
language sql immutable as $$
  select encode(sha256(convert_to('registry-salt-v1:' || p_value, 'UTF8')), 'hex')
$$;

create or replace function is_blocked_identity(p_phone text, p_ref text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from underage_registry where kind = 'phone' and hash = registry_hash(p_phone))
      or (p_ref is not null and exists (select 1 from underage_registry where kind = 'verification' and hash = registry_hash(p_ref)))
$$;
revoke execute on function is_blocked_identity(text, text) from public, anon, authenticated;

-- Registration refuses a phone number that previously verified as under 18.
create or replace function register_profile(
  p_display_name text, p_gender text, p_seeking text[], p_age_min int, p_age_max int, p_city text, p_bio text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text := request_phone();
begin
  if auth.uid() is null or v_phone is null then raise exception 'sign in with your phone number first'; end if;
  if is_blocked_identity(v_phone, null) then raise exception 'this phone number cannot be used'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'profile already exists'; end if;
  insert into profiles (id, phone_e164, display_name, gender, seeking, age_min, age_max, city, bio)
  values (auth.uid(), v_phone, btrim(p_display_name), p_gender, p_seeking, p_age_min, p_age_max, btrim(p_city), coalesce(p_bio, ''));
end $$;

-- Called only by the backend: the Edge Function that receives the vendor's signed webhook
-- (selfie + ID age check) calls this with the service key. The app can never call it.
create or replace function service_record_verification(
  p_user uuid, p_ref text, p_birth_date date, p_passed boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare v_p profiles;
begin
  select * into v_p from profiles where id = p_user for update;
  if not found then raise exception 'unknown user'; end if;
  if v_p.status in ('banned', 'blocked_underage') then return v_p.status; end if;
  if not p_passed then return 'failed'; end if;
  if exists (select 1 from profiles where verification_ref = p_ref and id <> p_user) then
    raise exception 'verification already used by another account';
  end if;

  if is_blocked_identity(v_p.phone_e164, p_ref) or age_of(p_birth_date) < 18 then
    insert into underage_registry (kind, hash) values
      ('phone', registry_hash(v_p.phone_e164)), ('verification', registry_hash(p_ref))
    on conflict do nothing;
    update profiles set status = 'blocked_underage', verified_at = now(), birth_date = null, verification_ref = null
    where id = p_user;
    return 'blocked_underage';
  end if;

  update profiles set status = 'active', verified_at = now(), birth_date = p_birth_date, verification_ref = p_ref
  where id = p_user;
  return 'active';
end $$;
revoke execute on function service_record_verification(uuid, text, date, boolean) from public, anon, authenticated;
grant execute on function service_record_verification(uuid, text, date, boolean) to service_role;
