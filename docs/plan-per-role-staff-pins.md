# Plan — Per-role staff PINs

**Status:** phase 1 BUILT (2026-08-18), pending the migration + a deploy.
Phases 2 and 3 still open.
**Priority: raised — this is now a security prerequisite, not just a feature.**

## To finish phase 1

1. Run `supabase/staff-pins-step1-per-role.sql` in the Supabase SQL Editor.
   It only adds columns and a function, so it's safe to run any time.
2. Deploy. Order doesn't matter either way: the new client falls back to
   `verify_bartender_pin` if the migration hasn't run, and the migration
   leaves that function in place for older cached bundles.
3. Verify the deploy shipped, then drop the old function — step 3 at the
   bottom of that SQL file.

## Why the priority changed

`bar_orders` currently has:

```
"Anyone can read orders"   SELECT | true
"Staff can update orders"  UPDATE | true
```

So every bar order (including `patron_phone`) is publicly readable, and **any
anonymous user can UPDATE any order's status.**

That can't simply be locked down. The bartender, kitchen and manager screens
are PIN-gated in the *UI* but run as `anon` at the database — that permissive
UPDATE policy is exactly what lets a bartender mark a drink ready. Revoking it
without giving staff a real identity takes the bar offline mid-service.

**So this work is what unblocks closing `bar_orders`.** Build it first, then
scope those policies to a real staff session.

## Current state

There turned out to be only **two** PIN gates in the app, not three:

- `BartenderView` in `src/App.jsx` — despite the name, this is what the
  `/manager` route renders. Now gates on role `manager`.
- `CheckInView` — the door scanner. Now gates on role `door`.

The `/bartender` and `/kitchen` routes render `KitchenDisplay`, which has **no
PIN gate at all** — it's a read-only queue board. Worth deciding whether that's
intended; it's a wall-mounted display in practice, but it does show
`patron_phone`-adjacent order detail to anyone who loads the URL.

Worth noting: `CheckInView` passes `p_checked_in_by: venue.owner_id` to
`process_checkin` regardless of who is actually scanning, so there is **no real
accountability today even in principle** — it always logs the owner. Phase 2 is
what fixes that.

## Phase 1 — per-role PINs — BUILT

- `supabase/staff-pins-step1-per-role.sql` adds nullable `manager_pin` and
  `door_pin` to `venues`, and creates `verify_staff_pin(p_venue_id, p_pin,
  p_role)`. Unset role PIN → falls back to `bartender_pin`, so the migration
  is a no-op for existing venues. `verify_bartender_pin` is left in place for
  now (see step 3 in that file).
  The new columns are **not** in the `anon` column grant from
  `harden-venues-access.sql`, so anonymous browsers can't read them. Never add
  them to that list.
- `verifyStaffPin(venueId, pin, role)` in `src/lib/barOrderService.js` replaces
  `verifyBartenderPin`, with a `PGRST202` fallback to the old RPC so deploying
  ahead of the migration can't lock staff out. Delete that branch once the
  migration has run.
- `getVenueOwnerSettings` now reads the two new columns back for the admin UI.
- Admin → Settings has optional Manager PIN and Door PIN fields; blank writes
  `NULL`, which is what triggers the fallback.

**Deliberate choice:** once a role PIN is set, `bartender_pin` stops opening
that screen. A master-code fallback would mean setting a manager PIN didn't
actually restrict anything. The owner can read and reset every PIN in admin, so
a forgotten PIN isn't a lockout.

**Limitation:** still no per-*staff* accountability. Every door person shares
one door PIN, and you can't revoke one person without changing it for everyone.

**Also still true after phase 1:** the PINs are stored in plaintext and the RPC
has no rate limit — 4 digits is 10,000 guesses, callable by `anon` as fast as
the network allows. See the security note at the bottom.

## Phase 2 — per-staff PINs (only if you want an audit trail)

- New table `staff_pins (id, venue_id, name, role, pin, active, created_at)`,
  unique on `(venue_id, pin)`.
- `verify_staff_pin` returns the matching `staff_id`/`name` (still falling back
  to the legacy `bartender_pin` for unmigrated venues), which lets
  `CheckInView` finally pass the real staff member as `p_checked_in_by`
  instead of always logging the owner.
- New "Staff PINs" admin screen to add/rename/deactivate staff — this is most
  of the added work versus phase 1.
- Keep `venues.bartender_pin` indefinitely as a break-glass master code.

**Watch out:** 4-digit PINs give only 10,000 combinations per venue. Fine for a
handful of staff; a large roster will start colliding against the unique
constraint, at which point longer PINs are needed.

## Phase 3 — close `bar_orders`

Once staff screens have a real session, scope the `bar_orders` policies to it
and drop the `true` policies. See the note at the bottom of
`supabase/tickets-step2-lock-down.sql`.

## Security note on PIN storage

Check whether `bartender_pin` is stored in plaintext. `verify_bartender_pin` is
already an RPC, so the client never needs the value — which means the column
can be hashed without breaking the auth path. The admin UI currently displays
the PIN, so hashing means switching that to set-only ("enter a new PIN"),
the same pattern used for the Square token in `AdminView`.
