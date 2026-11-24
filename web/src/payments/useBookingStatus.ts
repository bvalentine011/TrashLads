import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";

export type BookingStatus =
  | "pending_payment" | "confirmed" | "in_progress" | "completed" | "missed" | "canceled" | "payment_failed" | "expired";

/**
 * Watches a booking until the server confirms it. The browser never decides a
 * booking is paid: only the verified Stripe webhook moves it to "confirmed".
 */
export function useBookingStatus(bookingId: string | null, timeoutMs = 60_000) {
  const [status, setStatus] = useState<BookingStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), timeoutMs);
    const unsub = onSnapshot(doc(getFirestore(), "bookings", bookingId), (snap) => {
      const s = snap.get("status") as BookingStatus | undefined;
      if (s) setStatus(s);
      if (s && s !== "pending_payment") clearTimeout(timer);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [bookingId, timeoutMs]);

  return { status, timedOut };
}
