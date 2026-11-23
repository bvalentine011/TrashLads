import { createContext, useContext, useState, type ReactNode } from "react";
import type { BookingDraft } from "./types";

/** Holds the booking between the Book screen and Review & pay, and survives a reload. */
const KEY = "tl.draft";
const Ctx = createContext<{ draft: BookingDraft | null; setDraft: (d: BookingDraft | null) => void } | null>(null);

function load(): BookingDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BookingDraft) : null;
  } catch {
    return null;
  }
}

export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setState] = useState<BookingDraft | null>(load);
  const setDraft = (d: BookingDraft | null) => {
    setState(d);
    try {
      if (d) sessionStorage.setItem(KEY, JSON.stringify(d));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: keep it in memory */
    }
  };
  return <Ctx.Provider value={{ draft, setDraft }}>{children}</Ctx.Provider>;
}

export function useDraft() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDraft must be used inside DraftProvider");
  return c;
}
