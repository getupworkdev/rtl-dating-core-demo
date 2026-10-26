-- In-app account deletion (required by Apple guideline 5.1.1(v) and Google Play).
-- Deletes the profile and, through ON DELETE CASCADE, the user's swipes, blocks, matches and the
-- messages in those matches. Reports the user filed or received are kept for moderation with the
-- user reference set to null. The under-18 registry is kept on purpose: it holds only hashes.
-- In production the Edge Function then deletes the auth.users row and the user's photos in Storage.

create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from profiles where id = auth.uid();
  if not found then raise exception 'no profile'; end if;
end $$;
revoke execute on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
