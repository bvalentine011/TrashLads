import { Link } from "react-router-dom";
import { bookableDates, clock, money, PRICING, SCHEDULE, totalFor } from "../data/rules";
import { Bags, Timeline } from "../components/ui";

const STEPS = [
  { t: "Book by 8 PM", b: "Pick your community, unit, bags and a weeknight. Same-day booking closes at 8 PM." },
  { t: "Pay when you book", b: "Card, Apple Pay or Google Pay. Your pickup is confirmed as soon as payment goes through." },
  { t: "Bags out by 6 PM", b: "Tie them and set them right outside your door, no earlier than 5 PM." },
  { t: "We take them down", b: "Between 6 and 11 PM a Trash Lad carries them to your community's dumpster." },
];

export function Home() {
  const today = bookableDates()[0];
  const sameDayOpen = today?.isToday && today.available;
  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-h">
        <div>
          <h1 id="hero-h">Trash pickup on your schedule.</h1>
          <p className="lede">We carry your bags from your door to your community's dumpster, Monday to Friday nights.</p>
          <div className="cta">
            <Link to="/book" className="btn btn-primary btn-lg">Book a pickup</Link>
            <p>{sameDayOpen ? `Same-day pickup open until ${clock(SCHEDULE.sameDayCutoffMinutes)}` : "Same-day booking is closed. Choose a later night."}</p>
          </div>
        </div>
        <img className="hero-logo" src="/logo.webp" alt="Trash Lads: trash collection, reliable and friendly" width={260} height={260} />
        <Timeline animate windowCaption="We pick up, weeknights" />
      </section>

      <section aria-labelledby="price-h">
        <h2 id="price-h" className="sec-title" style={{ marginBottom: ".75rem" }}>Pricing</h2>
        <div className="strip">
          {PRICING.bagCounts.map((n) => (
            <div key={n}>
              <span className="row" style={{ gap: ".6rem" }}>
                <Bags count={n} />
                <b>{n} bag{n > 1 ? "s" : ""}</b>
              </span>
              <span className="price">{money(totalFor(n))}</span>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: ".75rem" }}>
          {money(PRICING.baseFeeCents)} per pickup plus {money(PRICING.perBagCents)} a bag, up to 3 bags. Cancel before 5 PM on the night for a full refund.
        </p>
      </section>

      <section aria-labelledby="how-h">
        <h2 id="how-h" className="sec-title" style={{ marginBottom: "1.25rem" }}>How it works</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.t}>
              <span className="step-n" aria-hidden>{i + 1}</span>
              <p style={{ fontWeight: 800 }}>{s.t}</p>
              <p className="muted small" style={{ marginTop: ".25rem" }}>{s.b}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
