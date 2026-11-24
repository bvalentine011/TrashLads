# Trash Lads

Valet trash pickup for apartment communities. Residents book a weeknight, pay, and put their bags outside their door. A Trash Lad takes them down between 6 and 11 PM.

- **Residents:** book, pay by card, Apple Pay or Google Pay, manage pickups, and report problems.
- **The owner:** runs the night from a route sheet, reviews refunds, and answers support reports.

The web app is React + Vite. The backend is Firebase: Auth, Firestore and Cloud Functions. Payments go through Stripe, and are **test mode only** until the go-live checklist in [docs/PAYMENTS.md](docs/PAYMENTS.md) is done.

## Try it without any setup (demo mode)

```sh
cd web
npm install
npm run dev:demo
```

Open the address it prints. A yellow bar marks demo mode: sample data, pretend payments, and nothing leaves your browser. On **Sign in**, choose **Continue as a resident** or **Continue as the owner**.

## What's where

| Path | What it is |
| --- | --- |
| `web/` | The app. `src/screens/` has one file per screen; `src/data/` has the Firebase and demo data sources; `src/payments/` has the Stripe checkout |
| `web/src/styles/app.css` | The design system: Overpass, forest green, hi-vis orange, the pickup-night timeline, door-number plates |
| `functions/` | Cloud Functions: checkout, Stripe webhook, refunds, saved cards, owner route actions. `npm test` runs 54 tests |
| `firestore.rules` | Browsers can read their own records and file support reports; anything that involves money or status is written only by the server |
| `rules-test/` | Tests for the rules against the Firebase emulator |
| `docs/PAYMENTS.md` | How payments work, test cards, and the go-live checklist |

### Screens

| Screen | Who | Path |
| --- | --- | --- |
| Home, Help, terms | Everyone | `/`, `/help`, `/terms`, `/service-terms` |
| Sign in / create account | Everyone | `/signin` |
| Book a pickup | Everyone; sign in before paying | `/book` |
| Review & pay | Residents | `/review` |
| Confirmation | Residents | `/confirmation/:id` |
| My pickups (cancel, request refund) | Residents | `/pickups` |
| Account (details, saved cards) | Signed in | `/account` |
| Route: night summary, route sheet, refund review | Owner | `/owner` |
| Support desk | Owner | `/owner/support` |

## Set up the real app

You need a Firebase project on the **Blaze** plan (Cloud Functions require it; small usage stays in the free tier), a Stripe account in test mode, and Node 22.

1. **Firebase project.** Create one at console.firebase.google.com, then put its id in `.firebaserc`.
2. **Turn on:**
   - **Authentication** → Email/Password
   - **Firestore** (production mode)
   - **App Check** with reCAPTCHA Enterprise for the web app. The payment functions refuse calls without App Check.
3. **Web config.** Copy `web/.env.example` to `web/.env.local`, then fill in the Firebase web config, the App Check site key and your Stripe `pk_test_…` key.
4. **Stripe secrets and webhook:** follow "Set up (test mode)" in [docs/PAYMENTS.md](docs/PAYMENTS.md).
5. **Deploy:**
   ```sh
   npm install -g firebase-tools
   firebase login
   (cd functions && npm install) && (cd web && npm install)
   firebase deploy
   ```
   That deploys the app (Hosting), the functions, and the Firestore rules and indexes. Functions run their tests before deploying.
6. **Add your communities.** In Firestore, create documents in `properties`, for example `properties/sample-commons`:
   ```json
   { "name": "Sample Commons", "approved": true, "enabled": true,
     "placementStartMinutes": 1020,
     "buildings": [{ "label": "Building B", "units": ["101", "102", "203"] }] }
   ```
   - `placementStartMinutes` is when bags may go out (1020 = 5 PM; 1050 = 5:30 PM).
   - `buildings` is optional. Units not on the list are still accepted, but they're flagged "Check unit" on the route sheet.
7. **Make yourself the owner.** Create an account in the app, then run this once from a trusted machine with the Admin SDK:
   ```js
   admin.auth().setCustomUserClaims("<your uid>", { owner: true })
   ```
   Sign out and back in to see the Route and Support screens.

## Business rules

The server's copy of these rules is `functions/src/config.ts`. The web app shows a copy (`web/src/data/rules.ts`); keep the two in step.

- **Price:** $8 per pickup plus $3 a bag, 1 to 3 bags ($11, $14, $17), before any tax. Tax is off until you decide on it.
- **Schedule:** weeknights only. Same-day booking closes at 8 PM Eastern, and residents can book up to 3 weeks ahead. Holidays are listed in `closedDates`.
- **Capacity:** 25 stops and 60 bags a night, and one booking per unit per night.
- **Cancellation:** before 5 PM on the pickup date gives a full automatic refund. After that, the resident can request a refund for the owner to review.

## Before taking real payments

- **Terms.** The account and service terms pages are drafts that describe how the app works. Have a lawyer review them, then bump the versions in `functions/src/config.ts` and `web/src/data/rules.ts`.
- **Go-live checklist.** Work through the one in [docs/PAYMENTS.md](docs/PAYMENTS.md). The server refuses a live Stripe key until every step is marked done.
- **Reminders.** Texts and emails aren't sent yet. The confirmation screen shows the reminder schedule they'll follow once a messaging provider is connected.

## Checks

```sh
cd functions && npm test           # 54 tests: pricing, dates, booking checks, webhooks, refunds, saved cards, route actions, live-mode guard
cd web && npm run typecheck && npm run build:demo
cd rules-test && npm install && npm test   # needs Java for the Firestore emulator
```
