-- The discover deck and the match list. Both return only public fields (name, age, city, bio),
-- never phone, birth date or verification data.

create or replace function discover(p_limit int default 20) returns table (
  id uuid, display_name text, age int, city text, bio text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, age_of(p.birth_date), p.city, p.bio
  from profiles p
  where p.id <> auth.uid()
    and is_eligible(auth.uid(), p.id)
    and not exists (select 1 from swipes s where s.swiper = auth.uid() and s.target = p.id)
  order by p.last_active_at desc, p.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

create or replace function my_matches() returns table (
  match_id uuid, partner_id uuid, display_name text, age int, city text, matched_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.id, p.id, p.display_name, age_of(p.birth_date), p.city, m.created_at
  from matches m
  join profiles p on p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
  where auth.uid() in (m.user_a, m.user_b) and m.ended_at is null and p.status = 'active'
  order by m.created_at desc
$$;

-- A matched partner's public columns become readable; everyone else stays hidden.
drop policy profiles_self on profiles;
create policy profiles_self_or_match on profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from matches m
    where m.ended_at is null
      and ((m.user_a = auth.uid() and m.user_b = profiles.id) or (m.user_b = auth.uid() and m.user_a = profiles.id))
  )
);

revoke execute on function discover(int), my_matches() from public, anon;
grant execute on function discover(int), my_matches() to authenticated;
