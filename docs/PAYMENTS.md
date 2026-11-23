# Payments (Stripe, test mode)

This package adds card payments to Trash Lad: credit and debit cards, Apple Pay and Google Pay, and optional saved cards. It's built on Stripe's **Payment Element** and **Firebase Cloud Functions**.

The browser only collects card details, and Stripe holds them. Every decision that involves money runs on the server: price, capacity, terms, booking confirmation and refunds. No card numbers ever touch Firebase.

Payments run in **Stripe test mode** only. The server refuses a live key until every go-live step below is done and recorded.

## What's inside

| Path | What it is |
| --- | --- |
| `functions/src/config.ts` | Price, capacity, schedule, terms versions, hold time. The only place these live. |
| `functions/src/services/` | Booking checkout, webhook processing, refunds, saved cards, terms |
| `functions/src/adapters/` | Firestore store (transactions), Stripe gateway, live-mode guard |
| `functions/src/index.ts` | Cloud Functions: 12 callables (including the owner's route actions), the Stripe webhook, and a 5-minute hold cleaner |
| `functions/test/` | 54 tests against an in-memory store and a fake Stripe |
| `firestore.rules`, `firestore.indexes.json`, `firebase.json` | Rules that keep payment data server-only; the indexes the queries need |
| `rules-test/` | Emulator tests for the rules (run locally, see below) |
| `web/src/payments/` | React components: checkout, account terms prompt, saved cards |

## How a booking is paid

1. **Review & pay step loads.** `getCheckoutSetup` returns the server's prices, the current service-terms version, the saved-card consent text and a Stripe CustomerSession, so saved cards can appear. It fails with `registration-terms-required` if the resident hasn't accepted the current account terms; the component then shows `RegistrationTermsPrompt`.
2. **The Payment Element shows right away.** It uses Stripe's deferred-intent mode for $11, $14 or $17. Apple Pay and Google Pay appear only on browsers and devices that support them (`wallets: "auto"`).
3. **The resident ticks the service terms** (required) and, separately, **"Save this card"** (optional). Then they press Pay.
4. **`startBookingPayment` re-checks everything on the server:**
   - the account terms and service terms versions, and the placement rules
   - that the community exists, is approved and is enabled
   - the date: weeknight, not a holiday, within 3 weeks, and same-day only before 8 PM Eastern
   - 1 to 3 bags, the unit format, the phone number and the email
   - the night's capacity (25 stops, 60 bags) and one booking per unit per night, checked in a single Firestore transaction
   - the price, computed by the server, which ignores any price the client sends

   It then holds the slot for 30 minutes and creates a PaymentIntent for the server's amount. `setup_future_usage: on_session` is set only if the resident consented to saving the card.
5. **`stripe.confirmPayment`** runs in the browser. Any 3-D Secure check happens here.
6. **The `payment_intent.succeeded` webhook confirms the booking.** It only does so after re-reading the PaymentIntent from Stripe and checking four things:
   - its status is `succeeded`
   - the amount matches exactly
   - the currency matches
   - the customer matches

   Until then the booking stays `pending_payment`, and the browser just watches it.

### Statuses

`pending_payment` → `confirmed` → `in_progress` → `completed`, or `missed`.

Side exits: `canceled`, and `expired` (an unpaid hold released). Only `confirmed` and later put a stop on the route.

### Webhook idempotency

- **Each Stripe event id is claimed once,** in a Firestore transaction.
- **Repeats are skipped.** A repeat delivery returns `duplicate`.
- **Failures get retried.** If processing fails, the claim is released, so Stripe's retry runs it again.
- **Every handler is also guarded by status.** Running one twice changes nothing.
- **Refunds are counted per Stripe refund id.** The same refund is never subtracted twice.
- **Mode mismatches are ignored.** A live event reaching a test deployment, or the reverse, is not acted on.

## Refund policy (in `services/refunds.ts`)

| Situation | What happens |
| --- | --- |
| Resident cancels before 5 PM Eastern on the pickup date | Booking canceled, slot freed, full automatic refund |
| Resident cancels after the cutoff | Nothing is canceled; they can request an exception instead |
| Resident requests an exception (missed bag, problem on the night) | Request waits as `pending_review`; nothing is refunded until the owner acts |
| Owner reviews | Approve full or partial (capped at what's left to refund), or deny with a reason the resident sees |
| Owner refunds directly (e.g. the crew missed a stop) | Refund with a required reason, capped at what's left |
| Payment arrives after a hold expired | Full automatic refund, since the night may have filled |
| Dispute opened | Booking flagged `disputed`; respond in the Stripe Dashboard |

Every action is written to `auditLog` with who did it.

## Set up (test mode)

1. **Stripe test keys.** In the Stripe Dashboard, turn on **Test mode** and copy the `sk_test_…` and `pk_test_…` keys.
2. **Server secrets:**
   ```sh
   firebase functions:secrets:set STRIPE_SECRET_KEY        # sk_test_…
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET    # whsec_… from step 4
   ```
3. **Deploy:** `firebase deploy --only functions,firestore`. The predeploy step typechecks and runs the tests first.
4. **Webhook.** In Stripe, go to Developers → Webhooks → Add endpoint, with the `stripeWebhook` function URL and these events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
   - `refund.created`
   - `refund.updated`
   - `charge.dispute.created`
   - `setup_intent.succeeded`

   For local work, use `stripe listen --forward-to <emulator URL>/stripeWebhook`.
5. **Owner account:** set the custom claim once from a trusted script: `admin.auth().setCustomUserClaims(ownerUid, { owner: true })`.
6. **App Check.** The callables use `enforceAppCheck: true`. Set up App Check (reCAPTCHA Enterprise on web) before testing, or set it to `false` in `index.ts` while you develop locally.
7. **Web:** set `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…`.
8. **Apple Pay in test mode** needs your domain registered under Settings → Payment method domains, and must be served over HTTPS. Google Pay works in Chrome with any card saved to the Google account.

### Where it's wired into the app

- **Review & pay** (`web/src/screens/Review.tsx`) renders `CheckoutPayment` in live mode, and a pretend card form in demo mode.
- **Confirmation** (`/confirmation/:id`) is also the `return_url` after a bank redirect. It watches the booking and shows "Confirming…" until the webhook marks it `confirmed`.
- **Sign-up** records account-terms acceptance on the server.
- **Account** shows saved cards.
- **My Pickups** cancels before the cutoff, and requests a refund after it.
- **Owner dashboard** reviews refund requests and issues direct refunds.

## Test cards (test mode only)

| Card | Result |
| --- | --- |
| 4242 4242 4242 4242 | Succeeds |
| 4000 0025 0000 3155 | Asks for 3-D Secure, then succeeds |
| 4000 0000 0000 9995 | Declined: insufficient funds (the hold stays; retry with another card) |
| 4000 0000 0000 0002 | Declined: generic |

Use any future expiry date, any CVC and any ZIP. For Apple Pay and Google Pay in test mode, real cards in the wallet return test tokens and are never charged.

## Run the tests

```sh
cd functions && npm install && npm test        # 54 tests: pricing, dates, booking checks, webhooks, refunds, saved cards, live-mode guard
cd rules-test && npm install && npm test       # Firestore rules against the emulator (needs Java)
```

## Go live: payments stay off until all of these are done

The server refuses a `sk_live_` key unless `LIVE_PAYMENTS_ENABLED=true` **and** all four gates are `"true"`. The browser refuses a `pk_live_` key unless `VITE_LIVE_PAYMENTS_ENABLED=true`. Set each gate only after doing that step.

| Gate (function environment variable) | Step |
| --- | --- |
| `GO_LIVE_STRIPE_ACCOUNT_APPROVED` | Stripe account activated: business details, bank account, identity verified, payouts on |
| `GO_LIVE_PAYMENT_DOMAINS_REGISTERED` | Production domain registered under Payment method domains in **live** mode; Apple Pay and Google Pay tested on it |
| `GO_LIVE_WEBHOOK_CONFIGURED` | Live webhook endpoint created with the events above; live `STRIPE_WEBHOOK_SECRET` set; a test delivery returned 200 |
| `GO_LIVE_SECURITY_REVIEWED` | Rules tests and function tests pass; App Check enforced; owner claim limited to real owners; keys stored only as secrets; restricted key considered |

Also before launch:
- Have a lawyer review the account terms, the service terms and the refund policy.
- Decide on sales tax with an accountant. `PRICING.taxRateBasisPoints` is 0, and Stripe Tax is the recommended way to add it.
- Bump the terms versions in `config.ts` and `RegistrationTerms.tsx` whenever the text changes.

## Not covered here

- **The demo site.** The demo artifact can't run payments: its host blocks Stripe's scripts, and it has no server.
- **Running against real Stripe.** These tests use a fake Stripe. Run the flows above in your own test-mode account before go-live.
- **Off-session charging.** Charging a saved card without the resident present (for example, automatic rebooking) isn't supported. Saved cards are set up for `on_session` use only, which matches customer-initiated booking.
