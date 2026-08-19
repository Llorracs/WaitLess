# Plan — Per-role staff PINs

**Status:** planned, not built.
**Priority: raised — this is now a security prerequisite, not just a feature.**

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

Every gated view — bartender queue, manager, and `CheckInView`'s door scanner —
calls the same `verifyBartenderPin(venue.id, pin)` → RPC `verify_bartender_pin`,
checked against one `venues.bartender_pin` column.

Worth noting: `CheckInView` passes `p_checked_in_by: venue.owner_id` to
`process_checkin` regardless of who is actually scanning, so there is **no real
accountability today even in principle** — it always logs the owner.

## Phase 1 — per-role PINs (small, do this first)

- Migration: `ALTER TABLE venues ADD COLUMN manager_pin text, ADD COLUMN door_pin text;`
  Nullable, so nothing breaks on deploy — existing venues keep using
  `bartender_pin` until the new ones are set.
- Replace `verify_bartender_pin` with a role-aware
  `verify_staff_pin(p_venue_id, p_pin, p_role)` that checks
  `manager_pin` / `door_pin` / `bartender_pin` by role, falling back to
  `bartender_pin` when the role-specific one is unset.
- Client: `verifyBartenderPin` → `verifyStaffPin(venueId, pin, role)`; each
  gated view passes its own role string. One line per call site.
- Admin UI: two more optional 4-digit PIN fields beside the existing one, with
  "leave blank to reuse the bartender PIN" hint text.

**Limitation:** still no per-*staff* accountability. Every door person shares
one door PIN, and you can't revoke one person without changing it for everyone.

Roughly 30–45 minutes of work plus a migration the owner runs in Supabase.

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
