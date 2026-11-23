import { addDays, bookableDates, CAPACITY, canCancel, easternNow, PRICING, TERMS, totalFor } from "./rules";
import type { DataSource, SignUpInput } from "./source";
import type { Booking, BookingDraft, BookingStatus, NightTotals, Property, RefundRequest, SessionUser, SupportRequest, Unsubscribe } from "./types";

/**
 * In-memory stand-in for Firebase, for `npm run dev:demo`. Same rules as the
 * server where it matters to the screens (capacity, cutoffs, refunds), so the
 * whole app can be clicked through with no backend. Nothing leaves the browser.
 */

const PROPERTIES: Property[] = [
  { id: "sample-commons", name: "Sample Commons", approved: true, enabled: true, buildings: [{ label: "Building A" }, { label: "Building B", units: ["101", "102", "103", "201", "202", "203", "204", "207"] }] },
  { id: "example-lofts", name: "Example Lofts", approved: true, enabled: true, placementStartMinutes: 17 * 60 + 30, buildings: [{ label: "North" }, { label: "South" }] },
  { id: "placeholder-pointe", name: "Placeholder Pointe", approved: true, enabled: true },
];

const RESIDENT: SessionUser = {
  uid: "demo-resident", email: "resident@trashlads.test", name: "Jordan Rivera", phone: "5550100100", isOwner: false,
  registrationTermsVersion: TERMS.registrationTermsVersion,
  defaults: { propertyId: "sample-commons", buildingLabel: "Building B", unitLabel: "207", instructions: "" },
};
const OWNER: SessionUser = { uid: "demo-owner", email: "owner@trashlads.test", name: "Trash Lads owner", isOwner: true, registrationTermsVersion: TERMS.registrationTermsVersion };

function price(bags: number) {
  const bagSubtotalCents = PRICING.perBagCents * bags;
  return { currency: "usd", bagCount: bags, baseFeeCents: PRICING.baseFeeCents, perBagCents: PRICING.perBagCents, bagSubtotalCents, subtotalCents: totalFor(bags), taxCents: 0, totalCents: totalFor(bags) };
}

let seq = 100;
const id = (p: string) => `${p}_${(++seq).toString(36)}`;

function sampleBookings(): Booking[] {
  const dates = bookableDates().filter((d) => d.available).map((d) => d.date);
  const tonight = dates[0];
  const next = dates[1] ?? tonight;
  const past = addDays(easternNow().date, -7);
  const mk = (n: number, o: Partial<Booking> & Pick<Booking, "unitLabel" | "serviceDate" | "bagCount" | "status">): Booking => ({
    id: `bk_demo${String(n).padStart(2, "0")}`, uid: `demo-neighbor-${n}`, propertyId: "sample-commons", buildingLabel: "Building B", locationUnverified: false,
    contact: { name: `Neighbor ${n}`, phone: "5550100100" }, price: price(o.bagCount), paidAt: new Date().toISOString(), amountRefundedCents: 0, refundState: "none",
    createdAt: new Date(Date.now() - n * 3_600_000).toISOString(), ...o,
  });
  return [
    mk(1, { uid: RESIDENT.uid, contact: { name: RESIDENT.name, phone: RESIDENT.phone! }, unitLabel: "207", serviceDate: next, bagCount: 2, status: "confirmed" }),
    mk(2, { uid: RESIDENT.uid, contact: { name: RESIDENT.name, phone: RESIDENT.phone! }, unitLabel: "207", serviceDate: past, bagCount: 1, status: "completed", completedAt: past }),
    mk(3, { unitLabel: "101", serviceDate: tonight, bagCount: 1, status: "confirmed", buildingLabel: "Building B" }),
    mk(4, { unitLabel: "102", serviceDate: tonight, bagCount: 3, status: "confirmed", instructions: "Bags by the mat, not the stairs" }),
    mk(5, { unitLabel: "203", serviceDate: tonight, bagCount: 2, status: "confirmed" }),
    mk(6, { unitLabel: "204", serviceDate: tonight, bagCount: 2, status: "confirmed" }),
    mk(7, { unitLabel: "12", serviceDate: tonight, bagCount: 1, status: "confirmed", buildingLabel: "Building A" }),
    mk(8, { unitLabel: "3C", serviceDate: tonight, bagCount: 2, status: "confirmed", propertyId: "example-lofts", buildingLabel: "North", locationUnverified: true }),
    mk(9, { unitLabel: "5A", serviceDate: tonight, bagCount: 1, status: "canceled", propertyId: "example-lofts", buildingLabel: "South", refundState: "full", amountRefundedCents: 1100 }),
  ];
}

const STORE_KEY = "tl.demo.v1";
interface Saved { session: string | null; users: SessionUser[]; bookings: Booking[]; refunds: RefundRequest[]; support: SupportRequest[] }
function loadSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function createDemoSource(): DataSource {
  // Demo state lives in this browser tab only, so a reload keeps you signed in and keeps your bookings.
  const saved = loadSaved();
  const users = new Map<string, SessionUser>(saved ? saved.users.map((u) => [u.uid, u]) : [[RESIDENT.uid, { ...RESIDENT }], [OWNER.uid, { ...OWNER }]]);
  let session: SessionUser | null = saved?.session ? users.get(saved.session) ?? null : null;
  const bookings = new Map((saved?.bookings ?? sampleBookings()).map((b) => [b.id, b]));
  const refunds = new Map<string, RefundRequest>((saved?.refunds ?? []).map((r) => [r.id, r]));
  const support = new Map<string, SupportRequest>((saved?.support ?? []).map((r) => [r.id, r]));
  const persist = () => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ session: session?.uid ?? null, users: [...users.values()], bookings: [...bookings.values()], refunds: [...refunds.values()], support: [...support.values()] }));
    } catch {
      /* storage unavailable: the demo still works until reload */
    }
  };
  const seedSupport: SupportRequest = {
    id: "sr_demo01", uid: "demo-neighbor-3", bookingId: "bk_demo03", category: "missed_pickup", message: "I had two bags out by 5:45 and only one was taken.",
    contactName: "Neighbor 3", contactEmail: "neighbor3@trashlads.test", status: "open", createdAt: new Date(Date.now() - 5_400_000).toISOString(),
  };
  if (!saved) support.set(seedSupport.id, seedSupport);
  const seedRefund: RefundRequest = {
    id: "rr_demo01", bookingId: "bk_demo05", uid: "demo-neighbor-5", origin: "customer_exception", reason: "Rain soaked the bags and the crew skipped one. Could I get part of it back?",
    requestedCents: 1400, status: "pending_review", createdAt: new Date(Date.now() - 7_200_000).toISOString(),
  };
  if (!saved) refunds.set(seedRefund.id, seedRefund);

  const listeners = new Set<() => void>();
  const emit = () => {
    persist();
    listeners.forEach((l) => l());
  };
  const watch = <T>(get: () => T, cb: (v: T) => void): Unsubscribe => {
    const l = () => cb(get());
    listeners.add(l);
    queueMicrotask(l);
    return () => listeners.delete(l);
  };
  const sessionCbs = new Set<(u: SessionUser | null) => void>();
  const setSession = (u: SessionUser | null) => {
    session = u ? { ...u } : null;
    persist();
    sessionCbs.forEach((cb) => cb(session));
  };
  const me = () => {
    if (!session) throw new Error("Sign in to continue.");
    return session;
  };
  const owner = () => {
    if (!me().isOwner) throw new Error("Only the owner can do this.");
  };
  const wait = () => new Promise((r) => setTimeout(r, 350));
  const totals = (date: string): NightTotals => {
    let stops = 0, bags = 0;
    for (const b of bookings.values()) if (b.serviceDate === date && ["pending_payment", "confirmed", "in_progress", "completed"].includes(b.status)) { stops++; bags += b.bagCount; }
    return { stops, bags };
  };
  const refundBooking = (b: Booking, cents: number) => {
    b.amountRefundedCents = Math.min(b.price.totalCents, b.amountRefundedCents + cents);
    b.refundState = b.amountRefundedCents >= b.price.totalCents ? "full" : "partial";
  };

  return {
    mode: "demo",

    onSession(cb) {
      sessionCbs.add(cb);
      queueMicrotask(() => cb(session));
      return () => sessionCbs.delete(cb);
    },
    async signIn(email) {
      await wait();
      const u = [...users.values()].find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!u) throw new Error("No account with that email. In the demo, use one of the demo accounts.");
      setSession(u);
    },
    async signUp(input: SignUpInput) {
      await wait();
      if ([...users.values()].some((u) => u.email === input.email)) throw new Error("An account with that email already exists.");
      const u: SessionUser = { uid: id("demo-user"), email: input.email, name: input.name, phone: input.phone, isOwner: false, registrationTermsVersion: input.acceptedTermsVersion };
      users.set(u.uid, u);
      setSession(u);
    },
    async signOut() {
      setSession(null);
    },
    async sendPasswordReset() {
      await wait();
    },
    async acceptRegistrationTerms(version) {
      const u = users.get(me().uid)!;
      u.registrationTermsVersion = version;
      setSession(u);
    },
    async updateProfile(patch) {
      await wait();
      const u = users.get(me().uid)!;
      Object.assign(u, { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.phone !== undefined ? { phone: patch.phone } : {}), ...(patch.defaults ? { defaults: patch.defaults } : {}) });
      setSession(u);
    },

    async listProperties() {
      return PROPERTIES.filter((p) => p.approved && p.enabled);
    },
    async nightTotals(dates) {
      return Object.fromEntries(dates.map((d) => [d, totals(d)]));
    },

    watchMyBookings(cb) {
      return watch(() => [...bookings.values()].filter((b) => b.uid === session?.uid && b.status !== "expired").sort((a, b) => b.serviceDate.localeCompare(a.serviceDate)), cb);
    },
    watchBooking(bid, cb) {
      return watch(() => (bookings.get(bid) ? { ...bookings.get(bid)! } : null), cb);
    },
    async getBooking(bid) {
      return bookings.get(bid) ?? null;
    },
    async cancelBooking(bid) {
      await wait();
      const b = bookings.get(bid);
      if (!b || b.uid !== me().uid) throw new Error("Booking not found.");
      if (b.status !== "confirmed") throw new Error("This pickup can't be canceled.");
      if (!canCancel(b.serviceDate)) return { canceled: false, reason: "cutoff-passed" };
      b.status = "canceled";
      refundBooking(b, b.price.totalCents);
      emit();
      return { canceled: true };
    },
    async requestRefund(bookingId, reason) {
      await wait();
      const b = bookings.get(bookingId);
      if (!b || b.uid !== me().uid) throw new Error("Booking not found.");
      if ([...refunds.values()].some((r) => r.bookingId === bookingId && (r.status === "pending_review" || r.status === "approved"))) throw new Error("There's already a refund request for this pickup.");
      const r: RefundRequest = { id: id("rr"), bookingId, uid: b.uid, origin: "customer_exception", reason, requestedCents: b.price.totalCents - b.amountRefundedCents, status: "pending_review", createdAt: new Date().toISOString() };
      refunds.set(r.id, r);
      emit();
    },
    watchMyRefundRequests(cb) {
      return watch(() => [...refunds.values()].filter((r) => r.uid === session?.uid), cb);
    },

    async createSupportRequest(input) {
      await wait();
      const u = me();
      const r: SupportRequest = { id: id("sr"), uid: u.uid, ...input, contactName: u.name, contactEmail: u.email, status: "open", createdAt: new Date().toISOString() };
      support.set(r.id, r);
      emit();
      return r.id;
    },
    watchMySupport(cb) {
      return watch(() => [...support.values()].filter((r) => r.uid === session?.uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), cb);
    },

    async demoCheckout(draft: BookingDraft, opts) {
      await new Promise((r) => setTimeout(r, 900));
      const u = me();
      const t = totals(draft.serviceDate);
      if (t.stops + 1 > CAPACITY.maxStopsPerNight || t.bags + draft.bagCount > CAPACITY.maxBagsPerNight) throw new Error("That night is full. Choose another night.");
      const dupe = [...bookings.values()].some((b) => b.serviceDate === draft.serviceDate && b.propertyId === draft.propertyId && b.unitLabel === draft.unitLabel.toUpperCase() && ["confirmed", "in_progress", "completed"].includes(b.status));
      if (dupe) throw new Error("This unit already has a pickup that night.");
      const prop = PROPERTIES.find((p) => p.id === draft.propertyId);
      const known = prop?.buildings?.find((x) => x.label === draft.buildingLabel)?.units?.includes(draft.unitLabel.toUpperCase()) ?? false;
      const b: Booking = {
        id: `bk_${Math.random().toString(36).slice(2, 10)}`, uid: u.uid, propertyId: draft.propertyId, buildingLabel: draft.buildingLabel ?? "", unitLabel: draft.unitLabel.toUpperCase(),
        locationUnverified: !known, serviceDate: draft.serviceDate, bagCount: draft.bagCount, instructions: draft.instructions, contact: draft.contact, price: price(draft.bagCount),
        status: "confirmed", paidAt: new Date().toISOString(), amountRefundedCents: 0, refundState: "none", createdAt: new Date().toISOString(),
      };
      void opts;
      bookings.set(b.id, b);
      emit();
      return b.id;
    },

    watchNight(date, cb) {
      return watch(() => [...bookings.values()].filter((b) => b.serviceDate === date).map((b) => ({ ...b })), cb);
    },
    async ownerSetStatus(bid, status: BookingStatus, note) {
      owner();
      await wait();
      const b = bookings.get(bid)!;
      if (status === "missed" && !note) throw new Error("Add a short note on why the pickup was missed.");
      b.status = status;
      if (status === "completed") b.completedAt = new Date().toISOString();
      if (note) b.ownerNote = note;
      emit();
    },
    async ownerStartNight(date) {
      owner();
      await wait();
      let n = 0;
      for (const b of bookings.values()) if (b.serviceDate === date && b.status === "confirmed") { b.status = "in_progress"; n++; }
      emit();
      return n;
    },
    watchRefundQueue(cb) {
      return watch(() => [...refunds.values()].filter((r) => ["pending_review", "approved", "failed"].includes(r.status)), cb);
    },
    async ownerReviewRefund(rid, decision, amountCents, note) {
      owner();
      await wait();
      const r = refunds.get(rid)!;
      const b = bookings.get(r.bookingId)!;
      if (decision === "deny") {
        if (!note || note.trim().length < 5) throw new Error("Add a short reason for the resident.");
        r.status = "denied";
        r.reviewNote = note;
      } else {
        const max = b.price.totalCents - b.amountRefundedCents;
        const amt = amountCents ?? max;
        if (amt <= 0 || amt > max) throw new Error(`The most you can refund is $${(max / 100).toFixed(2)}.`);
        r.status = "refunded";
        r.approvedCents = amt;
        r.reviewNote = note;
        refundBooking(b, amt);
      }
      emit();
    },
    async ownerRefund(bid, reason, amountCents) {
      owner();
      await wait();
      const b = bookings.get(bid)!;
      const max = b.price.totalCents - b.amountRefundedCents;
      const amt = amountCents ?? max;
      if (!reason || reason.trim().length < 5) throw new Error("Add a reason for the refund.");
      if (amt <= 0 || amt > max) throw new Error(`The most you can refund is $${(max / 100).toFixed(2)}.`);
      const r: RefundRequest = { id: id("rr"), bookingId: bid, uid: b.uid, origin: "owner", reason, requestedCents: amt, approvedCents: amt, status: "refunded", createdAt: new Date().toISOString() };
      refunds.set(r.id, r);
      refundBooking(b, amt);
      emit();
    },
    watchSupportQueue(cb) {
      return watch(() => [...support.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), cb);
    },
    async ownerUpdateSupport(sid, status, note) {
      owner();
      await wait();
      const r = support.get(sid)!;
      r.status = status;
      if (note !== undefined) r.ownerNote = note;
      emit();
    },
  };
}

export const DEMO_ACCOUNTS = { resident: RESIDENT.email, owner: OWNER.email };
