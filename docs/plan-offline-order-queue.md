# Plan — Offline order queue

**Status:** planned, not built. Priority: high (owner's stated next build).

## The problem

Orders fail silently on bad wifi. `public/sw.js` intentionally skips caching
Supabase and Netlify requests, so a dropped connection during checkout just
throws and the patron sees an `alert()`.

## Where the real risk is

`handleCheckout` in `src/App.jsx` (~line 993). It makes **two sequential
network calls**:

1. `POST /.netlify/functions/process-payment` — charges the card via Square
2. `createBarOrder()` — inserts into Supabase `bar_orders`

If (1) succeeds and (2) fails on a network drop, **the patron is charged with
no order recorded anywhere.** That gap — not the ordinary "please retry" case —
is what this work exists to close.

## Design

1. **Generate the idempotency key once, before any network call, and persist
   it.** Today `idempotencyKey: crypto.randomUUID()` is generated inline at
   call time. A naive retry would mint a *new* key and could double-charge.
   The queue record must carry one fixed key for the life of the attempt.

2. **Write a pending-order record to IndexedDB immediately** when the patron
   taps place-order: cart contents, totals, patron info, the idempotency key,
   a local `orderAttemptId`, status `queued`.

3. **Attempt payment + order creation** if online.
   - Network failure calling `process-payment`: unknown whether Square
     processed it. Mark `payment-uncertain`, retry with the **same**
     idempotency key — Square dedupes server-side and returns the original
     result rather than charging twice.
   - Payment succeeds but `createBarOrder` fails: mark `paid-unconfirmed` and
     persist the returned `paymentId`/`orderId` immediately. Retry **only the
     insert**. Never re-run payment once confirmed.

4. **Retry triggers:** the `online` event, a short interval while queued items
   exist, and `visibilitychange` (app foregrounded). Do **not** rely on the
   Service Worker Background Sync API — unsupported in iOS Safari, which is
   the primary PWA target. A queued order cannot silently retry itself while
   the app is backgrounded or the phone is locked.

5. **UI:** replace the `alert()` with an honest "Reconnecting — we'll submit
   the moment you're back online" state, a manual "Retry now", and once
   payment is confirmed, make clear the charge already happened. Don't let
   them think cancelling undoes it.

6. **Expiry:** if a queued order sits unconfirmed past ~30 minutes (matching
   the existing `ACTIVE_ORDERS_TTL` at `src/App.jsx:759`), stop auto-retrying
   and tell the patron plainly to check their statement or ask the bar, rather
   than retrying forever.

7. **Survive reload:** on app load, resume leftover queued/uncertain records
   for this venue. Mirrors the existing `restoreOrders()` localStorage pattern
   at `src/App.jsx:775`.

8. Leave `public/sw.js`'s skip of Supabase/Netlify requests alone — that's
   intentional. The queue belongs at the app layer, not the SW cache layer.

## Risks to watch

- **Double-charge** if the idempotency key isn't fixed and reused (point 1).
- **"Charged, no order"** if `paymentId`/`orderId` aren't persisted the instant
  payment succeeds (point 3).
- **Silent infinite retry** with no expiry (point 6).
- **False confidence** that this works while backgrounded on iOS — it won't.
  The UI must say so rather than implying background magic.

## How to build it

Do it **on a branch**, not straight to `main`. This rewrites the live payment
path; the failure mode is double-charging real customers. Budget more time for
testing than for coding: deliberately kill the network at three moments —
mid-payment, after payment but before the Supabase insert, and during retry —
and confirm Square's idempotency actually dedupes rather than assuming it does.
Test in Square sandbox on a real phone, then watch the first live weekend.
