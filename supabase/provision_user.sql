-- Adds your account to the allowlist. Without this step the account can sign
-- in but cannot read or write any data. Nothing secret is stored here.
--
-- How to run:
--   1. Supabase dashboard > Authentication > Users > "Add user" >
--      "Create new user", with "Auto Confirm User" ticked.
--   2. Supabase dashboard > SQL Editor > New query. Paste this whole file.
--   3. On the line marked "<-- YOUR E-MAIL", replace you@example.com with the
--      e-mail of the user from step 1. Edit it only in the SQL Editor; do not
--      commit your real e-mail to the repository.
--   4. Click Run. You should see one row with your e-mail.
--
-- Running it again is harmless. It stops with an error, changing nothing, if
-- the placeholder was not replaced or no user has that e-mail.

do $$
declare
  target_email text := 'you@example.com';  -- <-- YOUR E-MAIL
  target_id uuid;
begin
  if lower(trim(target_email)) = 'you@example.com' then
    raise exception 'Replace you@example.com with your e-mail before running this script.';
  end if;

  select id into target_id from auth.users where lower(email) = lower(trim(target_email));
  if target_id is null then
    raise exception 'No user with e-mail % exists. Create it under Authentication > Users first.', target_email;
  end if;

  insert into public.app_users (user_id) values (target_id)
  on conflict (user_id) do nothing;
end
$$;

-- Check: lists every allowlisted account. Expect exactly one row: yours.
select u.email, a.created_at as enabled_at
from public.app_users a join auth.users u on u.id = a.user_id;
