-- ============================================================
-- WAITLESS — Ticket access hardening, STEP 1 of 2
--            ADD FUNCTIONS  (safe — changes no permissions)
-- ============================================================
--
-- Run this FIRST, any time. It only CREATES functions. It removes no
-- access and changes no policy, so nothing can break by running it.
--
-- Step 2 (tickets-step2-lock-down.sql) is the one that actually revokes
-- public access, and must not run until the app is deployed and verified.
--
-- WHY THIS EXISTS
--
--   Policies `tickets_select_public_by_order` and
--   `ticket_orders_select_public_by_id` are both `SELECT ... USING (true)`.
--   `true` means every anonymous visitor can read every row, so:
--     - every ticket's qr_token is harvestable -> forge/replay any ticket
--     - every buyer's name, email and phone is readable -> PII leak
--
--   These functions give the two legitimate anonymous readers a narrow
--   path, so those policies can be dropped in step 2.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A buyer's own order + its tickets, keyed on the order UUID.
--
--    The UUID is the credential here: only the buyer gets it, in their
--    redirect URL and confirmation email. That's the same model the
--    emailed ticket link already relies on.
-- ------------------------------------------------------------
create or replace function public.get_ticket_order_public(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   ticket_orders%rowtype;
  v_tickets jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_id');
  end if;

  select * into v_order from ticket_orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
    into v_tickets
    from tickets t
   where t.order_id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'order', to_jsonb(v_order),
    'tickets', v_tickets
  );
end;
$$;

revoke all on function public.get_ticket_order_public(uuid) from public;
grant execute on function public.get_ticket_order_public(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. Check-in counters for the door scanner.
--
--    Returns counts only — no ticket rows, no tokens, no names. The
--    scanner is PIN-gated in the UI but runs as `anon` at the database,
--    so it needs a path that doesn't require reading the table.
-- ------------------------------------------------------------
create or replace function public.get_checkin_stats(p_event_id uuid, p_venue_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total',      count(*) filter (where status <> 'refunded'),
    'checked_in', count(*) filter (where status = 'checked_in')
  )
  from tickets
  where event_id = p_event_id
    and venue_id = p_venue_id;
$$;

revoke all on function public.get_checkin_stats(uuid, uuid) from public;
grant execute on function public.get_checkin_stats(uuid, uuid) to anon, authenticated;

-- ============================================================
-- VERIFY (both should return a row)
-- ============================================================
select 'functions created' as status,
       count(*) as found
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_ticket_order_public', 'get_checkin_stats');
