/**
 * Firestore Security Rules tests (T11-T14 + tournaments/admin).
 * NOT run in the build sandbox (no emulator / no network there).
 * Run locally:
 *   cd functions && npm install
 *   npx firebase emulators:exec --only firestore --project demo-es-trainers "node --test tests/rules.test.js"
 */
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, getDocs, collection, updateDoc, deleteDoc } = require("firebase/firestore");

let env;
test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-es-trainers",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") }
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "tournaments/t1"), { title: "T", status: "registration_open", entryFee: "₹200 / team" });
    await setDoc(doc(db, "registrations/r1"), { teamName: "Team Alpha", status: "pending" });
    await setDoc(doc(db, "privateRegistrations/r1"), { player1Email: "a@b.co", player1Phone: "9876543210" });
    await setDoc(doc(db, "teamNames/t1_abc"), { tournamentId: "t1", status: "pending" });
  });
});
test.after(async () => env && env.cleanup());

const anon = () => env.unauthenticatedContext().firestore();
const user = () => env.authenticatedContext("u1").firestore();
const admin = () => env.authenticatedContext("a1", { admin: true }).firestore();

test("tournaments: public READ allowed (get + list)", async () => {
  await assertSucceeds(getDoc(doc(anon(), "tournaments/t1")));
  await assertSucceeds(getDocs(collection(anon(), "tournaments")));
});
test("tournaments: public / signed-in-non-admin WRITE denied", async () => {
  await assertFails(setDoc(doc(anon(), "tournaments/t1"), { status: "live" }));
  await assertFails(updateDoc(doc(user(), "tournaments/t1"), { entryFee: "₹1" }));
  await assertFails(deleteDoc(doc(anon(), "tournaments/t1")));
});
test("T11 registrations: public direct READ denied (get + list)", async () => {
  await assertFails(getDoc(doc(anon(), "registrations/r1")));
  await assertFails(getDocs(collection(anon(), "registrations")));
  await assertFails(getDoc(doc(user(), "registrations/r1")));
});
test("T12 registrations: public direct WRITE denied (create / update / delete)", async () => {
  await assertFails(setDoc(doc(anon(), "registrations/new"), { teamName: "x", status: "confirmed", paymentStatus: "paid" }));
  await assertFails(updateDoc(doc(anon(), "registrations/r1"), { paymentStatus: "paid" }));
  await assertFails(deleteDoc(doc(anon(), "registrations/r1")));
});
test("T13 privateRegistrations: public READ and WRITE denied", async () => {
  await assertFails(getDoc(doc(anon(), "privateRegistrations/r1")));
  await assertFails(getDocs(collection(anon(), "privateRegistrations")));
  await assertFails(getDoc(doc(user(), "privateRegistrations/r1")));
  await assertFails(setDoc(doc(anon(), "privateRegistrations/r2"), { player1Email: "x@y.z" }));
});
test("T14 teamNames: public READ and WRITE denied", async () => {
  await assertFails(getDoc(doc(anon(), "teamNames/t1_abc")));
  await assertFails(getDocs(collection(anon(), "teamNames")));
  await assertFails(setDoc(doc(anon(), "teamNames/t1_zzz"), { tournamentId: "t1" }));
  await assertFails(deleteDoc(doc(anon(), "teamNames/t1_abc")));
});
test("unknown collections are locked", async () => {
  await assertFails(getDoc(doc(anon(), "payments/p1")));
  await assertFails(setDoc(doc(anon(), "payments/p1"), { x: 1 }));
});
test("future admin (custom claim admin:true): may read registration data and write tournaments; still cannot write registrations", async () => {
  await assertSucceeds(getDoc(doc(admin(), "registrations/r1")));
  await assertSucceeds(getDoc(doc(admin(), "privateRegistrations/r1")));
  await assertSucceeds(getDoc(doc(admin(), "teamNames/t1_abc")));
  await assertSucceeds(updateDoc(doc(admin(), "tournaments/t1"), { status: "live" }));
  await assertFails(setDoc(doc(admin(), "registrations/r9"), { x: 1 }));
});
