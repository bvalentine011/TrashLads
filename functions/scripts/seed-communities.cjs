// Adds or updates the communities listed in communities.json at the repo root.
// Communities not in the file are left as they are (set "enabled": false to pause one).
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("node:fs");
const path = require("node:path");

function check(c, i) {
  const where = `communities.json item ${i + 1}`;
  if (!/^[a-z0-9-]{2,60}$/.test(c.id || "")) throw new Error(`${where}: "id" must be lowercase letters, numbers and dashes, like "sample-commons".`);
  if (!c.name || typeof c.name !== "string") throw new Error(`${where}: add a "name".`);
  if (c.placementStartMinutes !== undefined && !(Number.isInteger(c.placementStartMinutes) && c.placementStartMinutes >= 960 && c.placementStartMinutes <= 1080)) {
    throw new Error(`${where}: "placementStartMinutes" must be between 960 (4 PM) and 1080 (6 PM).`);
  }
  if (c.buildings !== undefined && !Array.isArray(c.buildings)) throw new Error(`${where}: "buildings" must be a list.`);
}

async function main() {
  const file = path.join(__dirname, "..", "..", "communities.json");
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(list) || !list.length) throw new Error("communities.json should be a list of communities.");
  list.forEach(check);
  initializeApp();
  const db = getFirestore();
  for (const c of list) {
    const { id, ...data } = c;
    await db.collection("properties").doc(id).set({ approved: true, enabled: true, ...data }, { merge: false });
    console.log(`Saved ${c.name} (${id})${data.enabled === false ? " — paused" : ""}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
