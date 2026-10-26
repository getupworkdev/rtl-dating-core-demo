-- Likes, passes and mutual matches.

create table blocks (
  blocker    uuid not null references profiles(id) on delete cascade,
  blocked    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create table swipes (
  swiper     uuid not null references profiles(id) on delete cascade,
  target     uuid not null references profiles(id) on delete cascade,
  direction  text not null check (direction in ('like', 'pass')),
  created_at timestamptz not null default now(),
  primary key (swiper, target)
);
create index swipes_reverse on swipes (target, swiper) where direction = 'like';

-- One row per pair, ever (user_a < user_b). Ending a match keeps the row, so the pair is not re-shown.
create table matches (
  id           uuid primary key default gen_random_uuid(),
  user_a       uuid not null references profiles(id) on delete cascade,
  user_b       uuid not null references profiles(id) on delete cascade,
  created_at   timestamptz not null default clock_timestamp(),
  ended_at     timestamptz,
  ended_reason text check (ended_reason in ('unmatch', 'block', 'ban')),
  check (user_a < user_b),
  unique (user_a, user_b)
);

-- Can these two people be shown to each other at all? Used by discover() and by swipe(),
-- so a modified app cannot like someone it was never shown.
create or replace function is_eligible(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_a <> p_b and exists (
    select 1 from profiles a, profiles b
    where a.id = p_a and b.id = p_b
      and a.status = 'active' and b.status = 'active'
      and a.verified_at is not null and b.verified_at is not null
      and b.gender = any (a.seeking) and a.gender = any (b.seeking)
      and age_of(b.birth_date) between a.age_min and a.age_max
      and age_of(a.birth_date) between b.age_min and b.age_max
  ) and not exists (
    select 1 from blocks where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a)
  )
$$;
revoke execute on function is_eligible(uuid, uuid) from public, anon, authenticated;

-- Swipe. Returns the match id when this like completes a mutual like, otherwise null.
-- Both profile rows are locked in id order, so two people liking each other at the same moment
-- are serialised: the second one sees the first like and creates the match, and the unique pair
-- constraint guarantees it exists once.
create or replace function swipe(p_target uuid, p_direction text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_status text; v_match uuid;
begin
  if p_direction not in ('like', 'pass') then raise exception 'bad direction'; end if;
  select status into v_status from profiles where id = v_me;
  if v_status is distinct from 'active' then raise exception 'verify your profile first'; end if;

  perform 1 from profiles where id in (v_me, p_target) order by id for update;
  if not is_eligible(v_me, p_target) then raise exception 'profile not available'; end if;

  insert into swipes (swiper, target, direction) values (v_me, p_target, p_direction)
  on conflict (swiper, target) do nothing;
  if not found then raise exception 'already swiped'; end if;
  update profiles set last_active_at = now() where id = v_me;

  if p_direction = 'like' and exists (
    select 1 from swipes where swiper = p_target and target = v_me and direction = 'like'
  ) then
    insert into matches (user_a, user_b) values (least(v_me, p_target), greatest(v_me, p_target))
    on conflict (user_a, user_b) do nothing
    returning id into v_match;
  end if;
  return v_match;
end $$;

alter table blocks  enable row level security;
alter table swipes  enable row level security;
alter table matches enable row level security;
-- You can see your own swipes and blocks, never who liked or blocked you.
create policy swipes_own  on swipes  for select to authenticated using (swiper = auth.uid());
create policy blocks_own  on blocks  for select to authenticated using (blocker = auth.uid());
create policy matches_own on matches for select to authenticated using (auth.uid() in (user_a, user_b));

revoke all on blocks, swipes, matches from anon, authenticated;
grant select on blocks, swipes, matches to authenticated;

revoke execute on function swipe(uuid, text) from public, anon;
grant execute on function swipe(uuid, text) to authenticated;
