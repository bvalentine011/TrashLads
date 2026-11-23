// Gives (or removes) owner access for an existing account.
// Usage: node scripts/set-owner.cjs owner@example.com [--remove]
// Credentials come from GOOGLE_APPLICATION_CREDENTIALS (set by the GitHub workflow).
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

async function main() {
  const email = (process.argv[2] || "").trim();
  const remove = process.argv.includes("--remove");
  if (!email.includes("@")) throw new Error("Give the email address of an account that already exists in the app.");
  initializeApp();
  const auth = getAuth();
  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) throw new Error(`No account for ${email}. Create it in the app first (Sign in, then Create an account).`);
  const claims = { ...(user.customClaims || {}) };
  if (remove) delete claims.owner;
  else claims.owner = true;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`${remove ? "Removed owner access from" : "Gave owner access to"} ${email}. Sign out and back in to see the change.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
