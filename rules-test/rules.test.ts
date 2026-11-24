import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-trashlad", firestore: { rules: readFileSync("../firestore.rules", "utf8") } });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), { name: "Alice", stripeCustomerId: "cus_1" });
    await setDoc(doc(db, "bookings/b1"), { uid: "alice", status: "confirmed", price: { totalCents: 1400 } });
    await setDoc(doc(db, "refundRequests/r1"), { uid: "alice", bookingId: "b1", status: "pending_review" });
    await setDoc(doc(db, "webhookEvents/evt_1"), { status: "done" });
  });
});

const alice = () => env.authenticatedContext("alice").firestore();
const bob = () => env.authenticatedContext("bob").firestore();
const owner = () => env.authenticatedContext("olivia", { owner: true }).firestore();

describe("support requests", () => {
  it("lets residents file their own and only the owner change status", async () => {
    const ok = { uid: "alice", category: "missed_pickup", message: "My bags were not picked up last night.", status: "open", createdAt: "2026-11-23T14:00:00Z" };
    await assertSucceeds(setDoc(doc(alice(), "supportRequests/s1"), ok));
    await assertFails(setDoc(doc(alice(), "supportRequests/s2"), { ...ok, uid: "bob" }));
    await assertFails(setDoc(doc(alice(), "supportRequests/s3"), { ...ok, status: "resolved" }));
    await assertFails(setDoc(doc(alice(), "supportRequests/s4"), { ...ok, message: "short" }));
    await assertFails(getDoc(doc(bob(), "supportRequests/s1")));
    await assertFails(updateDoc(doc(alice(), "supportRequests/s1"), { status: "resolved" }));
    await assertSucceeds(updateDoc(doc(owner(), "supportRequests/s1"), { status: "resolved", ownerNote: "Refunded", updatedAt: "x" }));
    await assertFails(updateDoc(doc(owner(), "supportRequests/s1"), { message: "edited" }));
  });
});

describe("payments data is server-only", () => {
  it("lets residents read only their own bookings", async () => {
    await assertSucceeds(getDoc(doc(alice(), "bookings/b1")));
    await assertFails(getDoc(doc(bob(), "bookings/b1")));
    await assertSucceeds(getDoc(doc(owner(), "bookings/b1")));
  });

  it("blocks every client write to bookings, even the owner's", async () => {
    await assertFails(updateDoc(doc(alice(), "bookings/b1"), { status: "confirmed" }));
    await assertFails(updateDoc(doc(alice(), "bookings/b1"), { "price.totalCents": 1 }));
    await assertFails(setDoc(doc(alice(), "bookings/b2"), { uid: "alice", status: "confirmed" }));
    await assertFails(updateDoc(doc(owner(), "bookings/b1"), { status: "completed" }));
  });

  it("keeps Stripe ids and terms acceptance out of client reach", async () => {
    await assertSucceeds(updateDoc(doc(alice(), "users/alice"), { phone: "5550100100" }));
    await assertFails(updateDoc(doc(alice(), "users/alice"), { stripeCustomerId: "cus_evil" }));
    await assertFails(updateDoc(doc(alice(), "users/alice"), { registrationTerms: { version: "x" } }));
    await assertFails(getDoc(doc(bob(), "users/alice")));
  });

  it("hides refunds from other residents and blocks client writes", async () => {
    await assertSucceeds(getDoc(doc(alice(), "refundRequests/r1")));
    await assertFails(getDoc(doc(bob(), "refundRequests/r1")));
    await assertFails(updateDoc(doc(alice(), "refundRequests/r1"), { status: "approved" }));
    await assertFails(updateDoc(doc(owner(), "refundRequests/r1"), { status: "approved" }));
  });

  it("hides the webhook ledger from everyone", async () => {
    await assertFails(getDoc(doc(owner(), "webhookEvents/evt_1")));
    await assertFails(setDoc(doc(alice(), "webhookEvents/evt_2"), { status: "done" }));
  });
});
