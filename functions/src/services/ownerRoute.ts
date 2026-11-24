import { isIsoDate } from "../dates";
import { AppError } from "../domain/errors";
import type { Booking, BookingStatus } from "../domain/types";
import type { Caller, Ctx } from "./context";

/**
 * What the owner can do to a paid booking on the route.
 * Money is never moved here: refunds go through ownerRefund / reviewRefundRequest.
 */
const OWNER_MOVES: Record<string, BookingStatus[]> = {
  in_progress: ["confirmed"],
  completed: ["confirmed", "in_progress"],
  missed: ["confirmed", "in_progress"],
  canceled: ["confirmed"],
  // Undo a mistaken tap on the night.
  confirmed: ["in_progress", "completed", "missed"],
};

function requireOwner(caller: Caller): void {
  if (!caller.isOwner) throw new AppError("permission-denied", "Only the owner can do this.");
}

export async function ownerSetBookingStatus(
  ctx: Ctx,
  caller: Caller,
  input: { bookingId?: unknown; status?: unknown; note?: unknown },
): Promise<Booking> {
  requireOwner(caller);
  if (typeof input.bookingId !== "string") throw new AppError("invalid-argument", "Missing booking.");
  const to = input.status as BookingStatus;
  const from = OWNER_MOVES[to as string];
  if (!from) throw new AppError("invalid-argument", "That status can't be set from the route.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : undefined;
  if (to === "missed" && !note) throw new AppError("invalid-argument", "Add a short note on why the pickup was missed.");

  const nowIso = ctx.now().toISOString();
  const patch: Partial<Booking> & Record<string, unknown> = { status: to, updatedAt: nowIso };
  if (to === "completed") patch.completedAt = nowIso;
  if (note) patch.ownerNote = note;
  const updated = await ctx.store.transitionBooking(input.bookingId, from, patch);
  if (!updated) {
    const current = await ctx.store.getBooking(input.bookingId);
    if (!current) throw new AppError("not-found", "Booking not found.");
    throw new AppError("failed-precondition", `This pickup is ${current.status.replace("_", " ")}, so it can't be marked ${to.replace("_", " ")}.`);
  }
  await ctx.store.audit({ at: nowIso, actor: caller.uid, action: `owner-set-${to}`, bookingId: updated.id, detail: note ? { note } : undefined });
  return updated;
}

/** Moves every confirmed pickup on a night onto the route. */
export async function ownerStartRoute(ctx: Ctx, caller: Caller, input: { serviceDate?: unknown }): Promise<{ started: number }> {
  requireOwner(caller);
  if (!isIsoDate(input.serviceDate)) throw new AppError("invalid-argument", "Choose a night.");
  const nowIso = ctx.now().toISOString();
  const bookings = await ctx.store.listBookingsForDate(input.serviceDate);
  let started = 0;
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    if (await ctx.store.transitionBooking(b.id, ["confirmed"], { status: "in_progress", updatedAt: nowIso })) started++;
  }
  await ctx.store.audit({ at: nowIso, actor: caller.uid, action: "owner-start-route", detail: { serviceDate: input.serviceDate, started } });
  return { started };
}
