-- ============================================================
-- WAITLESS — Ticket access hardening, STEP 2 of 2
--            REVOKE PUBLIC ACCESS  (⚠ do not run early)
-- ============================================================
--
-- ⚠ BEFORE RUNNING, ALL THREE MUST BE TRUE:
--
--   1. tickets-step1-add-functions.sql has been run.
--   2. The app is deployed with the build that calls those functions
--      (fetchTicketOrderPublic / fetchCheckinStats in
--      src/lib/barOrderService.js).
--   3. You have re-tested a real confirmation page and a real check-in
--      against the deployed site, and both worked.
--
--   Until this runs, the old public policies are still in place, so the
--   app works either way — that's deliberate, it's what makes step 1
--   safe to verify before anything is taken away.
--
-- WHAT THIS CLOSES
--
--   tickets.qr_token was readable by any anonymous visitor, meaning
--   anyone could harvest valid ticket codes for any event. Buyer name,
--   email and phone on ticket_orders were readable the same way.
--
-- WHAT KEEPS WORKING
--
--   - Buyers: confirmation page reads via get_ticket_order_public.
--   - Door scanner: counts via get_checkin_stats; scanning already went
--     through the process_checkin / find_tickets_for_checkin functions.
--   - Staff/owners: unaffected — the tickets_select_staff and
--     ticket_orders_select_staff policies stay exactly as they are, and
--     admin screens run authenticated.
--   - Server functions: unaffected, they use the service role key.
-- ============================================================

begin;

-- ---- tickets -----------------------------------------------------------
-- Drop the blanket public read. The staff policy stays.
drop policy if exists tickets_select_public_by_order on public.tickets;

-- anon never needs direct table access: buyers go through
-- get_ticket_order_public, the door goes through process_checkin,
-- find_tickets_for_checkin and get_checkin_stats.
revoke all on public.tickets from anon;

-- ---- ticket_orders -----------------------------------------------------
drop policy if exists ticket_orders_select_public_by_id on public.ticket_orders;

-- Orders are created server-side by create-ticket-checkout (service role),
-- never by the browser, so anon needs nothing here either.
revoke all on public.ticket_orders from anon;

commit;

-- ============================================================
-- VERIFY — anon should have NO privileges on either table
-- ============================================================
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_name in ('tickets', 'ticket_orders')
  and grantee = 'anon';
-- Expect: zero rows.

select tablename, policyname, cmd, qual::text
from pg_policies
where tablename in ('tickets', 'ticket_orders')
order by tablename, policyname;
-- Expect: only the *_select_staff policies (and any insert policies).
-- No policy with qual = true should remain.

-- ============================================================
-- ROLLBACK, if something turns out to be broken
-- ============================================================
-- Puts things back exactly as they were. Safe to run.
--
--   grant select on public.tickets to anon;
--   grant select on public.ticket_orders to anon;
--   create policy tickets_select_public_by_order on public.tickets
--     for select using (true);
--   create policy ticket_orders_select_public_by_id on public.ticket_orders
--     for select using (true);

-- ============================================================
-- STILL OPEN AFTER THIS — bar_orders
-- ============================================================
--   "Anyone can read orders"  SELECT | true
--   "Staff can update orders" UPDATE | true
--
--   So every bar order (incl. patron_phone) is publicly readable, and
--   anyone can UPDATE any order's status.
--
--   Deliberately NOT fixed here. The bartender, kitchen and manager
--   screens are PIN-gated in the UI but run as `anon` at the database —
--   that UPDATE policy is what lets a bartender mark a drink ready.
--   Locking it without giving staff a real identity would take the bar
--   offline mid-service.
--
--   The correct fix is the per-role staff PIN work (Task 5): give staff
--   screens a real session, then scope these policies to it. Do that
--   before this one.
-- ============================================================
