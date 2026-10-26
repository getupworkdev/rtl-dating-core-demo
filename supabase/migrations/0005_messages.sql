-- Chat: only between the two people in an active match. Enforced by RLS, so it holds for any
-- client, including Supabase Realtime subscriptions (Realtime applies the same policies).

create table messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references matches(id) on delete cascade,
  sender     uuid not null references profiles(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  read_at    timestamptz
);
create index messages_by_match on messages (match_id, created_at);

create or replace function in_active_match(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches m
    join profiles a on a.id = m.user_a join profiles b on b.id = m.user_b
    where m.id = p_match and m.ended_at is null and auth.uid() in (m.user_a, m.user_b)
      and a.status = 'active' and b.status = 'active'
  )
$$;
revoke execute on function in_active_match(uuid) from public, anon;
grant execute on function in_active_match(uuid) to authenticated;

alter table messages enable row level security;
create policy messages_read on messages for select to authenticated using (in_active_match(match_id));
create policy messages_send on messages for insert to authenticated with check (
  sender = auth.uid() and read_at is null and in_active_match(match_id)
);

revoke all on messages from anon, authenticated;
grant select on messages to authenticated;
grant insert (match_id, sender, body) on messages to authenticated;

-- Read receipts: only the recipient can mark messages as read, and only that column changes.
create or replace function mark_read(p_match uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not in_active_match(p_match) then raise exception 'not your conversation'; end if;
  update messages set read_at = now() where match_id = p_match and sender <> auth.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function mark_read(uuid) from public, anon;
grant execute on function mark_read(uuid) to authenticated;
