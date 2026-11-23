import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { DataSource } from "./source";
import type { SessionUser } from "./types";

interface Ctx {
  data: DataSource;
  user: SessionUser | null;
  /** False until the first auth check finishes, so screens don't flash "signed out". */
  ready: boolean;
}

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(
    () =>
      source.onSession((u) => {
        setUser(u);
        setReady(true);
      }),
    [source],
  );
  return <DataCtx.Provider value={{ data: source, user, ready }}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useData must be used inside DataProvider");
  return c;
}

/** Subscribes to a live query and returns its latest value (undefined while loading). */
export function useLive<T>(subscribe: ((cb: (v: T) => void) => () => void) | null, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    setValue(undefined);
    if (!subscribe) return;
    return subscribe(setValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
