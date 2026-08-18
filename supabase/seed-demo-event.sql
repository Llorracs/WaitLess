-- ============================================================
-- WAITLESS — Seed the demo ticketing event
-- ============================================================
--
-- Run this ONCE in the Supabase SQL Editor.
--
-- Creates a published event on the 'demo' venue with two ticket
-- types (General $15, Early Bird $10), in a time window where the
-- door scanner will actually accept check-ins.
--
-- Safe to re-run: it upserts on (venue_id, slug) and resets the
-- window, so running it again just refreshes the demo.
--
-- WHY THE ODD TIMES:
--   process_checkin rejects a scan with 'doors_not_open' if doors_at
--   is still in the future, and 'event_ended' once ends_at has passed.
--   So the demo event has to be already-open-but-not-over for the scan
--   to genuinely turn green. doors_at is set 1 hour ago, starts_at 2
--   hours out (so it still reads as upcoming to a visitor), ends_at 10
--   hours out.
--
--   netlify/functions/demo-comp-ticket.js rolls these three columns
--   forward automatically whenever they drift out of that window, so
--   this seed does not need to be re-run on a schedule.
-- ============================================================

-- ---- 1. The event ----
insert into events (
  venue_id, slug, name, description, status,
  doors_at, starts_at, ends_at,
  location_name, location_address
)
select
  v.id,
  'demo-night',
  'Waitless Demo Night',
  'A sample event so you can see paperless ticketing end to end — pick a ticket, get a real QR, then scan it at the door.',
  'published',
  now() - interval '1 hour',
  now() + interval '2 hours',
  now() + interval '10 hours',
  'The Demo Room',
  '123 Example Ave'
from venues v
where v.slug = 'demo'
on conflict (venue_id, slug) do update set
  name        = excluded.name,
  description = excluded.description,
  status      = 'published',
  doors_at    = excluded.doors_at,
  starts_at   = excluded.starts_at,
  ends_at     = excluded.ends_at;

-- ---- 2. General Admission — $15, unlimited ----
insert into ticket_types (
  event_id, name, description, price_cents,
  quantity_total, quantity_sold, active, sort_order
)
select
  e.id, 'General Admission', 'Standard entry for the night.', 1500,
  null, 0, true, 1
from events e
join venues v on v.id = e.venue_id
where v.slug = 'demo' and e.slug = 'demo-night'
on conflict do nothing;

-- ---- 3. Early Bird — $10, limited (shows the scarcity badge) ----
insert into ticket_types (
  event_id, name, description, price_cents,
  quantity_total, quantity_sold, active, sort_order
)
select
  e.id, 'Early Bird', 'Discounted advance ticket — limited run.', 1000,
  25, 18, true, 0
from events e
join venues v on v.id = e.venue_id
where v.slug = 'demo' and e.slug = 'demo-night'
on conflict do nothing;

-- ---- 4. Confirm it worked ----
select
  e.name        as event_name,
  e.status,
  e.doors_at,
  e.starts_at,
  tt.name       as tier,
  tt.price_cents,
  tt.quantity_total,
  tt.quantity_sold
from events e
join venues v       on v.id = e.venue_id
left join ticket_types tt on tt.event_id = e.id
where v.slug = 'demo' and e.slug = 'demo-night'
order by tt.sort_order;
