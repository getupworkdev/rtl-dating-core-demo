-- Block, unmatch and report. A block ends any match at once, which closes the chat and hides
-- both profiles from each other everywhere (discover, match list, profile reads, messages).

create table reports (
  id         uuid primary key default gen_random_uuid(),
  reporter   uuid references profiles(id) on delete set null,
  reported   uuid references profiles(id) on delete set null,
  reason     text not null check (reason in ('fake_profile', 'harassment', 'underage', 'inappropriate_photos', 'scam', 'other')),
  details    text not null default '' check (char_length(details) <= 1000),
  status     text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);
alter table reports enable row level security;
create policy reports_own on reports for select to authenticated using (reporter = auth.uid());
revoke all on reports from anon, authenticated;
grant select (id, reported, reason, created_at) on reports to authenticated;

create or replace function block_user(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_target = auth.uid() then raise exception 'bad target'; end if;
  insert into blocks (blocker, blocked) values (auth.uid(), p_target) on conflict do nothing;
  update matches set ended_at = now(), ended_reason = 'block'
  where user_a = least(auth.uid(), p_target) and user_b = greatest(auth.uid(), p_target) and ended_at is null;
end $$;

create or replace function unmatch(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update matches set ended_at = now(), ended_reason = 'unmatch'
  where id = p_match and auth.uid() in (user_a, user_b) and ended_at is null;
  if not found then raise exception 'no active match'; end if;
end $$;

-- Reporting someone also blocks them, so the reporter never sees that person again.
-- An 'underage' report goes to the top of the moderation queue (see admin migration).
create or replace function report_user(p_target uuid, p_reason text, p_details text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or p_target = auth.uid() then raise exception 'bad target'; end if;
  if not exists (select 1 from profiles where id = p_target) then raise exception 'unknown user'; end if;
  if exists (select 1 from reports where reporter = auth.uid() and reported = p_target and status = 'open') then
    raise exception 'already reported';
  end if;
  insert into reports (reporter, reported, reason, details) values (auth.uid(), p_target, p_reason, coalesce(p_details, ''))
  returning id into v_id;
  perform block_user(p_target);
  return v_id;
end $$;

revoke execute on function block_user(uuid), unmatch(uuid), report_user(uuid, text, text) from public, anon;
grant execute on function block_user(uuid), unmatch(uuid), report_user(uuid, text, text) to authenticated;

-- Members see that a match ended, never whether it was an unmatch or a block.
revoke select on matches from authenticated;
grant select (id, user_a, user_b, created_at, ended_at) on matches to authenticated;
