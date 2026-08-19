-- ============================================================
-- WAITLESS — Stop anonymous users reading venue secrets
-- ============================================================
--
-- THE PROBLEM
--
--   Policy `venues_public_read` allows SELECT on every active venue, and
--   the `anon` role held table-wide SELECT with no column restriction.
--   Postgres RLS is ROW-level only — it cannot hide columns — so anyone
--   with the public anon key (which ships in every visitor's browser)
--   could read every column of every active venue, including:
--
--     square_access_token           -> charge/refund on that venue's Square
--     square_refresh_token          -> mint new access tokens indefinitely
--     square_webhook_signature_key  -> forge webhooks, mint free tickets
--     bartender_pin                 -> open bar/manager/door screens
--     owner_email                   -> PII
--
-- THE FIX
--
--   Column-level GRANTs, which PostgREST respects. `anon` keeps SELECT on
--   presentation columns only. The secret columns are simply not grantable
--   to the public role, so no query can reach them no matter how it's
--   written.
--
--   Admin screens use real Supabase Auth, so they run as `authenticated`
--   and are unaffected by this migration. Tightening `authenticated` (so
--   one venue owner cannot read another's token) is phase 2 — see the note
--   at the bottom.
--
-- ⚠ RUN ORDER MATTERS
--
--   Deploy the app FIRST. The current code calls select('*'), which will
--   fail for anonymous visitors the moment this runs. The deployed build
--   must already be asking for the explicit column list in
--   src/lib/barOrderService.js (PUBLIC_VENUE_COLUMNS).
--
--   Verify with: view any venue page logged out. If it loads, deploy is live.
-- ============================================================

begin;

-- ---- 1. Drop the over-broad grants -------------------------------------
-- anon and authenticated were granted INSERT/UPDATE/DELETE/TRUNCATE on the
-- venues table. Update and delete happen to be blocked by RLS today, and
-- TRUNCATE isn't reachable through PostgREST, but none of it should be
-- granted in the first place.
revoke all on public.venues from anon;

-- ---- 2. Re-grant SELECT, column by column ------------------------------
-- Mirrors PUBLIC_VENUE_COLUMNS in src/lib/barOrderService.js.
-- square_app_id / square_location_id are publishable identifiers the Square
-- browser SDK needs — not secrets.
grant select (
  id, slug, name, tagline, logo_url,
  brand_colors, patron_font,
  service_fee_percent, minimum_age, require_age_verification,
  category_order, refund_policy_override,
  is_active, owner_id,
  subscription_status, subscription_id, trial_ends_at,
  square_app_id, square_location_id, square_environment
) on public.venues to anon;

-- Signup creates a venue row, so anon still needs INSERT. RLS policy
-- `venues_insert` governs which rows are allowed.
grant insert on public.venues to anon;

commit;

-- ============================================================
-- VERIFY
-- ============================================================
-- Should list ONLY the columns granted above — no token, pin, or email:
select column_name
from information_schema.column_privileges
where table_name = 'venues' and grantee = 'anon' and privilege_type = 'SELECT'
order by column_name;

-- Should show INSERT and SELECT only (no UPDATE/DELETE/TRUNCATE):
select distinct privilege_type
from information_schema.role_table_grants
where table_name = 'venues' and grantee = 'anon';

-- ============================================================
-- PHASE 2 — still open after this migration
-- ============================================================
--
-- 1. `authenticated` still has full table SELECT, and `venues_public_read`
--    matches every active venue. So one signed-in venue owner can still
--    read ANOTHER venue's square_access_token. Much narrower than "anyone
--    on the internet", but still wrong. Fix: revoke broad SELECT from
--    authenticated, grant the same safe column list, and expose owner-only
--    secrets through a SECURITY DEFINER function that checks
--    `owner_id = auth.uid()`.
--
-- 2. `venues_insert` has no WITH CHECK shown. Confirm with:
--      select policyname, with_check from pg_policies
--      where tablename = 'venues' and cmd = 'INSERT';
--    If it's null/true, anyone can insert arbitrary venue rows.
--
-- 3. AUDIT THE OTHER TABLES — this pattern was almost certainly copied.
--    `tickets` is the urgent one: if anon can SELECT tickets.qr_token,
--    anyone can harvest valid ticket codes for an event and walk in free,
--    which defeats the entire ticketing product. Run for each of
--    tickets, ticket_orders, bar_orders, events, ticket_types:
--
--      select grantee, privilege_type
--      from information_schema.role_table_grants
--      where table_name = 'tickets' and grantee in ('anon','authenticated');
--
--      select policyname, roles, cmd, qual
--      from pg_policies where tablename = 'tickets';
-- ============================================================
