-- Read-only checks to run in the Supabase SQL Editor after applying the
-- migrations (and after any later schema change). Every query should return
-- the result described in its comment.

-- 1. RLS is enabled on every table in the public schema.  Expect: 0 rows.
select relname as table_without_rls
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;

-- 2. The anon role (signed-out visitors) has no privileges on any table.  Expect: 0 rows.
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon';

-- 3. The anon role cannot execute any function in public.  Expect: 0 rows.
select p.proname
from pg_proc p
where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute');

-- 4. Every policy restricts rows to the caller AND the allowlist.  Expect: 0 rows.
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and coalesce(qual, with_check) not like '%auth.uid()%is_app_user()%';

-- 5. Signed-in roles cannot hard-delete data (soft deletes only), except the
--    idempotency ledger.  Expect: exactly one row: applied_mutations.
select table_name
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'DELETE';

-- 6. Allowlisted accounts.  Expect: only your own account.
select u.email from public.app_users a join auth.users u on u.id = a.user_id;

-- 7. All accounts.  Expect: only your own account. Any other row means
--    someone registered; check that sign-ups are disabled (README, step 4).
select email, created_at, last_sign_in_at from auth.users order by created_at;
