-- Admin panel backend: moderation queue, ban, resolve reports. Every action is written to an
-- append-only audit log. Admin rights come from profiles.is_admin, which no user can set.

create table audit_log (
  id      bigserial primary key,
  actor   uuid,
  action  text not null,
  target  uuid,
  detail  jsonb not null default '{}',
  at      timestamptz not null default clock_timestamp()
);
alter table audit_log enable row level security;
revoke all on audit_log from anon, authenticated;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid() and status = 'active'), false)
$$;

-- Open reports, under-18 reports first, with how many open reports each user has.
create or replace function admin_report_queue() returns table (
  report_id uuid, reported uuid, reported_name text, reason text, details text, open_reports_on_user int, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  return query
    select r.id, r.reported, p.display_name, r.reason, r.details,
           (select count(*)::int from reports x where x.reported = r.reported and x.status = 'open'), r.created_at
    from reports r left join profiles p on p.id = r.reported
    where r.status = 'open'
    order by (r.reason = 'underage') desc, r.created_at;
end $$;

create or replace function admin_ban(p_user uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if p_user = auth.uid() then raise exception 'cannot ban yourself'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'a note is required'; end if;
  update profiles set status = 'banned' where id = p_user and status <> 'banned';
  if not found then raise exception 'user not found or already banned'; end if;
  update matches set ended_at = now(), ended_reason = 'ban' where p_user in (user_a, user_b) and ended_at is null;
  update reports set status = 'actioned' where reported = p_user and status = 'open';
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'ban', p_user, jsonb_build_object('note', p_note));
end $$;

create or replace function admin_dismiss_report(p_report uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update reports set status = 'dismissed' where id = p_report and status = 'open';
  if not found then raise exception 'report is not open'; end if;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'dismiss_report', p_report, jsonb_build_object('note', p_note));
end $$;

create or replace function admin_audit(p_limit int default 50) returns setof audit_log
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  return query select * from audit_log order by id desc limit least(p_limit, 500);
end $$;

-- Audit rows can never be changed, even by an admin through SQL from the app.
create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin raise exception 'audit log is append-only'; end $$;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_append_only();

revoke execute on function is_admin(), admin_report_queue(), admin_ban(uuid, text), admin_dismiss_report(uuid, text), admin_audit(int) from public, anon;
grant execute on function is_admin(), admin_report_queue(), admin_ban(uuid, text), admin_dismiss_report(uuid, text), admin_audit(int) to authenticated;
