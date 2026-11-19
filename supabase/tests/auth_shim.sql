-- Minimal stand-in for the parts of a Supabase project that the migrations
-- depend on. Used ONLY by the automated tests (PGlite, an in-process Postgres).
-- Never run this against a real Supabase project: it already provides these.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text
);

-- Same contract as Supabase: the user id comes from the verified JWT claims
-- that PostgREST places in the request.jwt.claims setting.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
