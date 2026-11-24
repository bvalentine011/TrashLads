import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile as updateAuthProfile,
} from "firebase/auth";
import {
  addDoc, collection, doc, getDoc, getDocs, getFirestore, onSnapshot, orderBy, query, setDoc, updateDoc, where, documentId,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import type { DataSource, SignUpInput } from "./source";
import type { Booking, BookingStatus, NightTotals, Property, RefundRequest, SupportCategory, SupportRequest, SupportStatus } from "./types";

function initFirebase(): FirebaseApp {
  const env = import.meta.env;
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  if (env.VITE_APPCHECK_SITE_KEY) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  return app;
}

const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

export function createFirebaseSource(): DataSource {
  const app = initFirebase();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const fns = getFunctions(app, "us-east1");
  const call = async <T = unknown>(name: string, data: unknown): Promise<T> => (await httpsCallable(fns, name)(data)).data as T;
  const uid = () => {
    const u = auth.currentUser;
    if (!u) throw new Error("Sign in to continue.");
    return u.uid;
  };

  return {
    mode: "live",

    onSession(cb) {
      let unsubUser: (() => void) | null = null;
      const unsubAuth = onAuthStateChanged(auth, async (u) => {
        unsubUser?.();
        unsubUser = null;
        if (!u) return cb(null);
        const token = await u.getIdTokenResult();
        unsubUser = onSnapshot(doc(db, "users", u.uid), (snap) => {
          const d = snap.data() ?? {};
          cb({
            uid: u.uid,
            email: u.email ?? d.email ?? "",
            name: d.name ?? u.displayName ?? "",
            phone: d.phone,
            isOwner: token.claims.owner === true,
            registrationTermsVersion: d.registrationTerms?.version,
            defaults: {
              propertyId: d.defaultPropertyId, buildingLabel: d.defaultBuildingLabel, unitLabel: d.defaultUnitLabel, instructions: d.defaultInstructions,
            },
          });
        });
      });
      return () => {
        unsubUser?.();
        unsubAuth();
      };
    },

    async signIn(email, password) {
      await signInWithEmailAndPassword(auth, email, password);
    },

    async signUp(input: SignUpInput) {
      const cred = await createUserWithEmailAndPassword(auth, input.email, input.password);
      await updateAuthProfile(cred.user, { displayName: input.name });
      await setDoc(doc(db, "users", cred.user.uid), { name: input.name, email: input.email, phone: input.phone });
      // Terms acceptance is recorded by the server, with its own timestamp.
      await call("acceptTerms", { version: input.acceptedTermsVersion });
    },

    async signOut() {
      await signOut(auth);
    },

    async sendPasswordReset(email) {
      await sendPasswordResetEmail(auth, email);
    },

    async acceptRegistrationTerms(version) {
      await call("acceptTerms", { version });
    },

    async updateProfile(patch) {
      const data: Record<string, unknown> = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.phone !== undefined) data.phone = patch.phone;
      if (patch.defaults) {
        data.defaultPropertyId = patch.defaults.propertyId ?? "";
        data.defaultBuildingLabel = patch.defaults.buildingLabel ?? "";
        data.defaultUnitLabel = patch.defaults.unitLabel ?? "";
        data.defaultInstructions = patch.defaults.instructions ?? "";
      }
      await setDoc(doc(db, "users", uid()), data, { merge: true });
    },

    async listProperties() {
      const snap = await getDocs(query(collection(db, "properties"), where("enabled", "==", true)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Property).filter((p) => p.approved).sort((a, b) => a.name.localeCompare(b.name));
    },

    async nightTotals(dates) {
      const out: Record<string, NightTotals> = {};
      for (let i = 0; i < dates.length; i += 30) {
        const snap = await getDocs(query(collection(db, "nights"), where(documentId(), "in", dates.slice(i, i + 30))));
        snap.docs.forEach((d) => (out[d.id] = { stops: d.get("stops") ?? 0, bags: d.get("bags") ?? 0 }));
      }
      return out;
    },

    watchMyBookings(cb) {
      return onSnapshot(query(collection(db, "bookings"), where("uid", "==", uid()), orderBy("serviceDate", "desc")), (s) =>
        cb(s.docs.map((d) => d.data() as Booking)),
      );
    },

    watchBooking(id, cb) {
      return onSnapshot(doc(db, "bookings", id), (s) => cb(s.exists() ? (s.data() as Booking) : null), () => cb(null));
    },

    async getBooking(id) {
      const s = await getDoc(doc(db, "bookings", id));
      return s.exists() ? (s.data() as Booking) : null;
    },

    cancelBooking: (id) => call("cancelMyBooking", { bookingId: id }),
    requestRefund: async (bookingId, reason) => {
      await call("requestRefund", { bookingId, reason });
    },

    watchMyRefundRequests(cb) {
      return onSnapshot(query(collection(db, "refundRequests"), where("uid", "==", uid())), (s) => cb(s.docs.map((d) => d.data() as RefundRequest).sort(byNewest)));
    },

    async createSupportRequest(input: { bookingId?: string; category: SupportCategory; message: string }) {
      const u = auth.currentUser!;
      const ref = await addDoc(collection(db, "supportRequests"), {
        uid: u.uid,
        ...(input.bookingId ? { bookingId: input.bookingId } : {}),
        category: input.category,
        message: input.message.trim(),
        contactName: u.displayName ?? "",
        contactEmail: u.email ?? "",
        status: "open",
        createdAt: new Date().toISOString(),
      });
      return ref.id;
    },

    watchMySupport(cb) {
      return onSnapshot(query(collection(db, "supportRequests"), where("uid", "==", uid())), (s) =>
        cb(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SupportRequest).sort(byNewest)),
      );
    },

    watchNight(date, cb) {
      return onSnapshot(query(collection(db, "bookings"), where("serviceDate", "==", date)), (s) => cb(s.docs.map((d) => d.data() as Booking)));
    },

    async ownerSetStatus(bookingId: string, status: BookingStatus, note?: string) {
      await call("ownerSetStatus", { bookingId, status, note });
    },

    async ownerStartNight(date) {
      return (await call<{ started: number }>("ownerStartNight", { serviceDate: date })).started;
    },

    watchRefundQueue(cb) {
      return onSnapshot(query(collection(db, "refundRequests"), where("status", "in", ["pending_review", "approved", "failed"])), (s) =>
        cb(s.docs.map((d) => d.data() as RefundRequest).sort(byNewest)),
      );
    },

    async ownerReviewRefund(id, decision, amountCents, note) {
      await call("ownerReviewRefund", { refundRequestId: id, decision, amountCents, note });
    },

    async ownerRefund(bookingId, reason, amountCents) {
      await call("ownerIssueRefund", { bookingId, reason, amountCents });
    },

    watchSupportQueue(cb) {
      return onSnapshot(query(collection(db, "supportRequests"), orderBy("createdAt", "desc")), (s) =>
        cb(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SupportRequest)),
      );
    },

    async ownerUpdateSupport(id: string, status: SupportStatus, note?: string) {
      await updateDoc(doc(db, "supportRequests", id), { status, ...(note !== undefined ? { ownerNote: note } : {}), updatedAt: new Date().toISOString() });
    },
  };
}
