# WaitLess — where things stand

Last updated: 2026-08-18. Keep this current; it's the handoff point for a new
coding session.

## Next up, in order

1. **Per-role staff PINs** — `docs/plan-per-role-staff-pins.md`.
   Promoted to a security prerequisite: it's what makes closing `bar_orders`
   possible without taking the bar offline mid-service.
2. **Close `bar_orders` RLS** — phase 3 of that same plan.
3. **Offline order queue** — `docs/plan-offline-order-queue.md`. Owner's stated
   priority. Build on a branch; it rewrites the live payment path.

## Open issues

- **`bar_orders` is publicly readable and publicly updatable.**
  `"Anyone can read orders" SELECT | true` and
  `"Staff can update orders" UPDATE | true`. Blocked on per-role staff PINs —
  see above. This is the last known open hole.
- **`authenticated` can still read other venues' secrets.** One signed-in venue
  owner can read another venue's `square_access_token`. Much narrower than the
  anonymous exposure that was closed, but still wrong. Fix documented at the
  bottom of `supabase/harden-venues-access.sql` (phase 2): revoke broad SELECT
  from `authenticated`, grant the safe column list, expose owner-only secrets
  through a `SECURITY DEFINER` function checking `owner_id = auth.uid()`.
- **`venues_insert` policy has no visible WITH CHECK.** Confirm whether anyone
  can insert arbitrary venue rows:
  `select policyname, with_check from pg_policies where tablename='venues' and cmd='INSERT';`
- **npm audit**: 1 moderate, 1 high. Never reviewed.
- **Dead duplicate files in `src/`**: `src/ticket-webhook.js` is a stale copy of
  `netlify/functions/ticket-webhook.cjs` and is never bundled. It's a footgun —
  `src/stripe-billing.js` was the same, and it was being edited while the real
  endpoint didn't exist. Consider deleting.

## Closed recently (Aug 2026)

- **All Netlify functions were returning 502 in production.** `package.json` has
  `"type": "module"`, so the CommonJS `.js` function files were parsed as ESM
  and crashed on load. Renamed to `.cjs`. This had taken down payments and
  ticket issuance for an unknown period.
- **`stripe-billing` was never deployed as a function** — it lived in `src/`,
  so billing checkout 404'd. Moved to `netlify/functions/`, and `stripe` added
  to root `package.json`.
- **Anonymous users could read every venue's secrets** — Square access/refresh
  tokens, webhook signing key, `bartender_pin`, `owner_email`. Closed via
  column-level grants (`supabase/harden-venues-access.sql`).
- **Anonymous users could read every ticket's `qr_token`** and every buyer's
  PII. Closed via `SECURITY DEFINER` functions plus revoking anon access
  (`supabase/tickets-step1-add-functions.sql`, then `...step2-lock-down.sql`).
- Scanner failing on repeat scans — presentation-based dedupe plus a camera
  watchdog that detects a frozen feed.
- Two-tier pricing, landing page repositioning, ticketing cost comparison,
  demo ticketing + ordering walkthroughs.

## Things worth knowing

- **Local dev needs `.env.local`** with `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`, or React won't mount at all — it throws
  `supabaseUrl is required`.
- **Verifying a deploy actually shipped:** fetch the live bundle and grep it for
  a string unique to the change. Beats guessing.
  ```
  idx=$(curl -s https://waitless.events/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
  curl -s "https://waitless.events$idx" | grep -c "some-new-string"
  ```
- **Staff screens run as `anon`.** Bartender, kitchen, manager and door are
  PIN-gated in the UI only; the database can't tell them from a stranger.
  That's the root cause behind the remaining RLS problems.
- **Admin screens do use real Supabase Auth**, so they're the `authenticated`
  role — which is why the venues lockdown didn't break them.
- **SQL migrations live in `supabase/`** and are written to be run by hand in
  the Supabase SQL Editor, in the order named in the filenames.
