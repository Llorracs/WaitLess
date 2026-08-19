-- ============================================================
-- WAITLESS — Per-role staff PINs, STEP 1
--            ADD COLUMNS + FUNCTION  (safe — removes no access)
-- ============================================================
--
-- Run this any time. It only ADDS two nullable columns and CREATES one
-- function. It revokes nothing and drops nothing, so it cannot break a
-- running service — including the currently deployed build, which still
-- calls `verify_bartender_pin` (left in place on purpose, see step 3).
--
-- WHY THIS EXISTS
--
--   Every PIN-gated staff screen — the manager queue and the door
--   scanner — checks the same single `venues.bartender_pin`. One shared
--   code means one shared identity, which is why `bar_orders` still has
--   to sit behind `SELECT | true` and `UPDATE | true`: the database
--   cannot tell a bartender from a stranger, so the permissive policy is
--   the only thing letting staff mark a drink ready.
--
--   Splitting the PIN by role is the first step towards a staff session
--   those policies can actually be scoped to.
--
-- WHAT THIS DOES NOT DO
--
--   No per-*person* accountability. Every door person still shares one
--   door PIN, and you cannot revoke one without changing it for
--   everyone. That is phase 2 (`staff_pins` table) in
--   docs/plan-per-role-staff-pins.md.
-- ============================================================

begin;

-- ---- 1. The new columns ------------------------------------------------
-- Nullable on purpose: an existing venue keeps working untouched, because
-- an unset role PIN falls back to bartender_pin (see the function below).
alter table public.venues
  add column if not exists manager_pin text,
  add column if not exists door_pin    text;

-- NOTE ON GRANTS: nothing to do here, and that is the point.
-- harden-venues-access.sql revoked table-wide SELECT from `anon` and
-- re-granted a column list. A newly added column is NOT covered by that
-- list, so `anon` cannot read manager_pin or door_pin. Never add either
-- one to that grant. `authenticated` still has table-wide SELECT, which
-- is how the admin screen reads them back.

-- ---- 2. Role-aware verification ----------------------------------------
-- Same shape as verify_bartender_pin: the client sends a PIN and gets a
-- boolean, never the stored value.
--
-- Fallback rule: when the role's own PIN is unset (null or blank), the
-- check falls through to bartender_pin. That is what makes this migration
-- a no-op for existing venues.
--
-- Deliberately NOT a master code: once manager_pin is set, bartender_pin
-- stops opening the manager screen. Otherwise "set a separate manager
-- PIN" would not actually restrict anything. The owner can always read
-- and change every PIN from Admin -> Settings.
create or replace function public.verify_staff_pin(
  p_venue_id uuid,
  p_pin      text,
  p_role     text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue    venues%rowtype;
  v_expected text;
begin
  if p_venue_id is null or p_pin is null or btrim(p_pin) = '' then
    return false;
  end if;

  select * into v_venue from venues where id = p_venue_id;
  if not found then
    return false;
  end if;

  v_expected := case lower(coalesce(p_role, ''))
    when 'manager' then v_venue.manager_pin
    when 'door'    then v_venue.door_pin
    else                v_venue.bartender_pin   -- 'bartender', 'kitchen', unknown
  end;

  -- Role PIN unset -> fall back to the legacy shared PIN.
  if v_expected is null or btrim(v_expected) = '' then
    v_expected := v_venue.bartender_pin;
  end if;

  if v_expected is null or btrim(v_expected) = '' then
    return false;
  end if;

  return btrim(v_expected) = btrim(p_pin);
end;
$$;

revoke all on function public.verify_staff_pin(uuid, text, text) from public;
grant execute on function public.verify_staff_pin(uuid, text, text) to anon, authenticated;

commit;

-- ============================================================
-- VERIFY
-- ============================================================
-- Both new columns present:
--   select column_name from information_schema.columns
--   where table_name = 'venues' and column_name in ('manager_pin','door_pin');
--
-- anon must NOT be able to read them (expect zero rows):
--   select column_name from information_schema.column_privileges
--   where table_name = 'venues' and grantee = 'anon'
--     and column_name in ('manager_pin','door_pin','bartender_pin');
--
-- Behaves before any role PIN is set — with <venue-id> and its real PIN,
-- every one of these should return true:
--   select public.verify_staff_pin('<venue-id>', '<bartender_pin>', 'manager');
--   select public.verify_staff_pin('<venue-id>', '<bartender_pin>', 'door');
--   select public.verify_staff_pin('<venue-id>', '<bartender_pin>', 'bartender');
--
-- And after setting one, the shared PIN should stop opening that role:
--   update venues set manager_pin = '5678' where id = '<venue-id>';
--   select public.verify_staff_pin('<venue-id>', '5678', 'manager');            -- true
--   select public.verify_staff_pin('<venue-id>', '<bartender_pin>', 'manager'); -- false
--   select public.verify_staff_pin('<venue-id>', '<bartender_pin>', 'door');    -- true

-- ============================================================
-- STEP 3 — after the app is deployed and verified
-- ============================================================
--
-- `verify_bartender_pin` is intentionally left in place so an older
-- cached bundle keeps working through the deploy. The new client also
-- falls back to it if this migration has not run yet.
--
-- Once waitless.events is serving a build that calls verify_staff_pin
-- (grep the live bundle for 'verify_staff_pin'), it can go:
--
--   drop function if exists public.verify_bartender_pin(uuid, text);
--
-- Do not drop it before then — it is the only PIN check the old bundle
-- knows, and dropping it locks staff out of the manager and door screens
-- mid-service.
--
-- ============================================================
-- STILL OPEN AFTER THIS MIGRATION
-- ============================================================
--
-- 1. PIN STORAGE IS PLAINTEXT. All three columns hold the PIN as typed.
--    Verification is already an RPC, so the client never needs the
--    value — the columns can be hashed without breaking the auth path.
--    The blocker is the admin UI, which displays the current PIN; that
--    has to become set-only ("enter a new PIN") first, the same pattern
--    AdminView already uses for the Square token.
--
-- 2. NO RATE LIMIT. A 4-digit PIN is 10,000 guesses and this RPC is
--    callable by `anon` as fast as the network allows.
--
-- 3. `bar_orders` IS STILL OPEN. Per-role PINs are a UI-side identity;
--    the screens still talk to Postgres as `anon`, so the policies
--    cannot be scoped to a role yet. That needs phase 2's staff session.
--    See docs/plan-per-role-staff-pins.md.
-- ============================================================
