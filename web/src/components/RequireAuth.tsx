import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useData } from "../data/DataContext";

export function RequireAuth({ children, owner }: { children: ReactNode; owner?: boolean }) {
  const { user, ready } = useData();
  const loc = useLocation();
  if (!ready) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (owner && !user.isOwner) return <Navigate to="/" replace />;
  return <>{children}</>;
}
