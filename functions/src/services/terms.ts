import { TERMS } from "../config";
import { AppError } from "../domain/errors";
import type { Caller, Ctx } from "./context";

/** Called at sign-up (and whenever the registration terms version changes). */
export async function acceptRegistrationTerms(ctx: Ctx, caller: Caller, version: unknown): Promise<{ version: string }> {
  if (version !== TERMS.registrationTermsVersion) {
    throw new AppError("failed-precondition", "These terms are out of date. Reload and try again.", "terms-outdated");
  }
  const user = await ctx.store.getUser(caller.uid);
  if (!user) throw new AppError("failed-precondition", "Finish creating your account first.", "account-required");
  const acceptedAt = ctx.now().toISOString();
  await ctx.store.setRegistrationTerms(caller.uid, version, acceptedAt);
  await ctx.store.audit({ at: acceptedAt, actor: caller.uid, action: "registration-terms-accepted", detail: { version } });
  return { version };
}

export async function requireCurrentRegistrationTerms(ctx: Ctx, uid: string): Promise<void> {
  const user = await ctx.store.getUser(uid);
  if (!user) throw new AppError("failed-precondition", "Finish creating your account first.", "account-required");
  if (user.registrationTerms?.version !== TERMS.registrationTermsVersion) {
    throw new AppError(
      "failed-precondition",
      "Accept the Trash Lad account terms before booking.",
      "registration-terms-required",
    );
  }
}
