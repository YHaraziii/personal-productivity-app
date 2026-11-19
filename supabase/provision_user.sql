-- Run in the Supabase SQL Editor AFTER creating your user under
-- Authentication > Users > "Add user" (with "Auto Confirm User" ticked).
-- Replace the e-mail below with yours. Nothing secret is stored here.
--
-- This adds the account to the allowlist. Without this step the account can
-- sign in but cannot read or write any data.

insert into public.app_users (user_id)
select id from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;

-- Check: should return exactly one row with your e-mail.
select u.email, a.created_at as enabled_at
from public.app_users a join auth.users u on u.id = a.user_id;
