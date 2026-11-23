import { clock, money, PRICING, SCHEDULE } from "../data/rules";

/**
 * DRAFT legal text. It states how the app actually works so the pages exist and
 * checkout can link to them, but it has not been reviewed by a lawyer. Have it
 * reviewed before taking real payments, then bump the versions in
 * functions/src/config.ts and web/src/data/rules.ts.
 */
function DraftNotice() {
  return <p className="tl-pay-test" style={{ marginTop: "1rem" }}>Draft for review. These terms haven't been reviewed by a lawyer yet.</p>;
}

export function AccountTerms() {
  return (
    <article className="card pad stack" style={{ maxWidth: 760 }}>
      <h1 className="page-title">Account terms</h1>
      <p className="muted">Version 2026-11-01</p>
      <DraftNotice />
      <h2 className="sec-title">Your account</h2>
      <p>You need an account to book pickups. Keep your password private and your contact details current, because we use them to reach you about your pickups.</p>
      <h2 className="sec-title">Payments</h2>
      <p>Payments are processed by Stripe. Trash Lads never sees or stores your full card number. If you choose to save a card, Stripe keeps it and we only charge it when you book.</p>
      <h2 className="sec-title">Your information</h2>
      <p>We use your name, phone, email and pickup location to provide the service and contact you about it. We don't sell your information.</p>
      <h2 className="sec-title">Closing your account</h2>
      <p>Contact us through Help to close your account. Saved cards are removed when it's closed.</p>
    </article>
  );
}

export function ServiceTerms() {
  return (
    <article className="card pad stack" style={{ maxWidth: 760 }}>
      <h1 className="page-title">Pickup service terms</h1>
      <p className="muted">Version 2026-11-01</p>
      <DraftNotice />
      <h2 className="sec-title">The service</h2>
      <p>On the night you book, Monday to Friday, a Trash Lad collects tied bags from outside your door between {clock(SCHEDULE.windowStartMinutes)} and {clock(SCHEDULE.windowEndMinutes)} and takes them to your community's dumpster. There's no exact arrival time.</p>
      <h2 className="sec-title">Price</h2>
      <p>{money(PRICING.baseFeeCents)} per pickup plus {money(PRICING.perBagCents)} a bag, up to 3 bags, plus any tax that applies. You pay when you book, and the booking is confirmed once payment goes through.</p>
      <h2 className="sec-title">Your part</h2>
      <p>Put tied bags right outside your door, no earlier than your community's start time (usually {clock(SCHEDULE.defaultPlacementStartMinutes)}) and by {clock(SCHEDULE.windowStartMinutes)}. We can't take loose trash, boxes, furniture, liquids, hazardous waste, or bags over about 30 lb, and we leave anything unsafe behind.</p>
      <h2 className="sec-title">Cancellations and refunds</h2>
      <p>Cancel in My Pickups before {clock(SCHEDULE.cancelCutoffMinutes)} on the pickup date for a full refund. After that, you can request a refund and the owner will review it. If we miss a pickup that was set out correctly, we'll refund it.</p>
    </article>
  );
}
