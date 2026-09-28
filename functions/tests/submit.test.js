/**
 * Backend logic tests for lib/submit.js — run with:  node --test tests/submit.test.js
 *
 * IMPORTANT — what this is and is not.
 * The real `firebase-admin` / `firebase-functions` packages are
 * replaced with small in-memory fakes so the REAL handler code can run
 * without network, credentials or the emulator. This proves the
 * handler's LOGIC (validation, uniqueness, idempotency, expiry, data
 * shape, per-game separation). It does NOT prove Firestore's own
 * transaction behaviour or a deployed function — for that run the
 * Local Emulator Suite (see tests/README.md) and deploy.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const path = require("path");

/* ---------------- in-memory Firestore fake ---------------- */
class Ts { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
const SERVER_TS = { __serverTimestamp: true };

function makeFakeDb() {
  const store = new Map(); // "col/id" -> data
  let autoId = 0;
  let queue = Promise.resolve(); // Firestore serialises conflicting transactions; model that.
  const materialise = (data, nowMs) =>
    Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === SERVER_TS ? new Ts(nowMs) : v]));
  const ref = (col, id) => ({ col, id, path: `${col}/${id}` });
  const snap = (r) => {
    const d = store.get(r.path);
    // Deep copy that keeps Timestamp instances (structuredClone would strip the class).
    const clone = (v) => (v instanceof Ts ? new Ts(v.ms) : Array.isArray(v) ? v.map(clone) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
    return { exists: d !== undefined, id: r.id, data: () => (d === undefined ? undefined : clone(d)) };
  };
  const db = {
    _store: store,
    collection: (col) => ({ doc: (id) => ref(col, id || `auto${++autoId}`) }),
    async runTransaction(fn) {
      const run = async () => {
        const writes = [];
        let wrote = false;
        const tx = {
          async get(r) { if (wrote) throw new Error("Firestore transactions require all reads to be executed before all writes."); return snap(r); },
          set(r, data) { wrote = true; writes.push(["set", r, data]); },
          update(r, data) { wrote = true; writes.push(["update", r, data]); }
        };
        await fn(tx);
        const now = Date.now();
        for (const [op, r, data] of writes) {
          if (op === "update" && !store.has(r.path)) throw new Error("update on missing doc");
          store.set(r.path, op === "set" ? materialise(data, now) : { ...store.get(r.path), ...materialise(data, now) });
        }
      };
      const p = queue.then(run, run);
      queue = p.catch(() => {});
      return p;
    },
    all: (col) => [...store.entries()].filter(([k]) => k.startsWith(col + "/")).map(([k, v]) => [k.slice(col.length + 1), v]),
    seed: (col, id, data) => store.set(`${col}/${id}`, data)
  };
  return db;
}

class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const noopLogger = { info() {}, warn() {}, error() {} };
const logged = [];
const capturingLogger = { info: (m, d) => logged.push([m, d]), warn: (m, d) => logged.push([m, d]), error: (m, d) => logged.push([m, d]) };

function loadHandler(fakeDb) {
  const admin = { apps: [1], initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => SERVER_TS }, Timestamp: { fromMillis: (ms) => new Ts(ms) } }) };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "firebase-admin") return admin;
    if (request === "firebase-functions/v2/https") return { HttpsError, onCall: (_o, h) => h };
    if (request === "firebase-functions/logger") return capturingLogger;
    return origLoad.call(this, request, ...rest);
  };
  const target = path.join(__dirname, "../lib/submit.js");
  delete require.cache[target];
  try { return require(target); } finally { Module._load = origLoad; }
}

/* ---------------- helpers ---------------- */
let n = 0;
const rid = () => `req-${String(++n).padStart(4, "0")}-abcdefghijklmnop`;
function payload(over = {}) {
  return {
    requestId: rid(), tournamentId: "bgmi-test-001", game: "bgmi", teamName: "Team Alpha",
    player1: { name: "Asha One", ign: "AshaX", uid: "1001", email: "Asha@Example.com", phone: "+91 98765 43210" },
    player2: { name: "Player Two", ign: "TwoX", uid: "1002" },
    player3: { name: "Player Three", ign: "ThreeX", uid: "1003" },
    player4: { name: "Player Four", ign: "FourX", uid: "1004" },
    player5: { enabled: false, name: "", ign: "", uid: "" },
    termsAccepted: true, ...over
  };
}
const openT = (over = {}) => ({ title: "T", status: "registration_open", maxTeams: 25, registeredTeams: 3, entryFee: "₹200 / team", ...over });

function env(game, tournaments = { "bgmi-test-001": openT(), "bgmi-test-002": openT() }) {
  const db = makeFakeDb();
  for (const [id, t] of Object.entries(tournaments)) db.seed("tournaments", id, t);
  const { handleSubmit, REASON } = loadHandler(db);
  const call = (data, now) => { process.env.GAME = game; return handleSubmit({ data }, now ? { now } : undefined); };
  return { db, call, REASON };
}
const reasonOf = async (p) => { try { await p; } catch (e) { return e.details && e.details.reason; } return "NO_ERROR"; };

/* ---------------- tests ---------------- */
test("T1 BGMI valid registration: written to the BGMI store with pending status", async () => {
  const { db, call } = env("bgmi");
  const res = await call(payload());
  assert.equal(res.success, true);
  assert.equal(res.status, "pending");
  const regs = db.all("registrations");
  assert.equal(regs.length, 1);
  const [id, reg] = regs[0];
  assert.equal(id, res.registrationId);
  assert.equal(reg.game, "bgmi");
  assert.equal(reg.status, "pending");
  assert.equal(reg.paymentStatus, "pending");
  assert.equal(reg.teamNumber, null);
  assert.equal(reg.teamName, "Team Alpha");
  assert.equal(reg.teamNameNormalized, "team alpha");
  assert.equal(reg.termsAccepted, true);
  assert.ok(reg.registeredAt instanceof Ts, "registeredAt must be a server timestamp");
  assert.equal(reg.player5.enabled, false);
  // private contact split, same ID, and NOT present in the registration doc
  const priv = db.all("privateRegistrations");
  assert.equal(priv.length, 1);
  assert.equal(priv[0][0], id);
  assert.equal(priv[0][1].player1Email, "asha@example.com");
  assert.equal(priv[0][1].player1Phone, "+91 98765 43210");
  const regJson = JSON.stringify(reg);
  assert.ok(!/asha@example|98765|email|phone/i.test(regJson), "no contact info in registrations doc");
  // registeredTeams untouched
  assert.equal(db._store.get("tournaments/bgmi-test-001").registeredTeams, 3);
});

test("T2 FF MAX valid registration lands in the FF MAX store; each deployment refuses the other game", async () => {
  const bgmi = env("bgmi");
  const ff = env("ffmax", { "ffmax-test-001": openT() });
  const res = await ff.call(payload({ game: "ffmax", tournamentId: "ffmax-test-001" }));
  assert.equal(res.success, true);
  assert.equal(ff.db.all("registrations")[0][1].game, "ffmax");
  assert.equal(bgmi.db.all("registrations").length, 0, "nothing leaked into the BGMI store");
  assert.equal(await reasonOf(bgmi.call(payload({ game: "ffmax" }))), "INVALID_GAME");
  assert.equal(await reasonOf(ff.call(payload({ game: "bgmi", tournamentId: "ffmax-test-001" }))), "INVALID_GAME");
  assert.equal(ff.db.all("registrations").length, 1);
});

test("missing GAME env fails closed", async () => {
  const { db, REASON } = env("bgmi");
  const { handleSubmit } = loadHandler(db);
  delete process.env.GAME;
  assert.equal(await reasonOf(handleSubmit({ data: payload() })), REASON.SERVER_MISCONFIGURED);
});

test("T3 duplicate team name, different case, is rejected", async () => {
  const { db, call } = env("bgmi");
  await call(payload({ teamName: "Team Alpha" }));
  assert.equal(await reasonOf(call(payload({ teamName: "team alpha" }))), "DUPLICATE_TEAM_NAME");
  assert.equal(await reasonOf(call(payload({ teamName: "TEAM ALPHA" }))), "DUPLICATE_TEAM_NAME");
  assert.equal(db.all("registrations").length, 1);
  assert.equal(db.all("teamNames").length, 1);
});

test("T4 duplicate team name with extra / leading / trailing spaces is rejected", async () => {
  const { db, call } = env("bgmi");
  await call(payload({ teamName: "Team Alpha" }));
  assert.equal(await reasonOf(call(payload({ teamName: "Team  Alpha" }))), "DUPLICATE_TEAM_NAME");
  assert.equal(await reasonOf(call(payload({ teamName: "  Team   ALPHA  " }))), "DUPLICATE_TEAM_NAME");
  assert.equal(db.all("registrations").length, 1);
});

test("T5 same team name in a DIFFERENT tournament is allowed", async () => {
  const { db, call } = env("bgmi");
  await call(payload({ tournamentId: "bgmi-test-001" }));
  const r2 = await call(payload({ tournamentId: "bgmi-test-002" }));
  assert.equal(r2.success, true);
  assert.equal(db.all("registrations").length, 2);
  assert.equal(db.all("teamNames").length, 2);
});

test("T6 duplicate player UID inside a team is rejected (incl. case/space variants and player 5)", async () => {
  const { db, call } = env("bgmi");
  const p = payload();
  p.player2.uid = "1001";
  assert.equal(await reasonOf(call(p)), "DUPLICATE_PLAYER_UID");
  const q = payload();
  q.player2.uid = " 1001 ";
  assert.equal(await reasonOf(call(q)), "DUPLICATE_PLAYER_UID");
  const r = payload({ player5: { enabled: true, name: "Sub Five", ign: "FiveX", uid: "1003" } });
  assert.equal(await reasonOf(call(r)), "DUPLICATE_PLAYER_UID");
  assert.equal(db.all("registrations").length, 0);
  assert.equal(db.all("teamNames").length, 0, "a rejected request must not leave a reservation");
});

test("T7 terms not accepted is rejected (false, missing, truthy string)", async () => {
  const { db, call } = env("bgmi");
  assert.equal(await reasonOf(call(payload({ termsAccepted: false }))), "TERMS_NOT_ACCEPTED");
  assert.equal(await reasonOf(call(payload({ termsAccepted: undefined }))), "TERMS_NOT_ACCEPTED");
  assert.equal(await reasonOf(call(payload({ termsAccepted: "true" }))), "TERMS_NOT_ACCEPTED");
  assert.equal(db.all("registrations").length, 0);
});

test("T8 registration closed is rejected (upcoming / live / completed / missing status)", async () => {
  for (const status of ["upcoming", "live", "completed", undefined]) {
    const { db, call } = env("bgmi", { "bgmi-test-001": openT({ status }) });
    assert.equal(await reasonOf(call(payload())), "TOURNAMENT_CLOSED", `status=${status}`);
    assert.equal(db.all("registrations").length, 0);
  }
});

test("T9 full tournament is rejected; one slot left is accepted", async () => {
  const full = env("bgmi", { "bgmi-test-001": openT({ maxTeams: 25, registeredTeams: 25 }) });
  assert.equal(await reasonOf(full.call(payload())), "TOURNAMENT_FULL");
  assert.equal(full.db.all("registrations").length, 0);
  const last = env("bgmi", { "bgmi-test-001": openT({ maxTeams: 25, registeredTeams: 24 }) });
  assert.equal((await last.call(payload())).success, true);
  assert.equal(last.db._store.get("tournaments/bgmi-test-001").registeredTeams, 24, "registeredTeams not incremented in phase 2.2");
});

test("T10 invalid / nonexistent / path-injecting tournament IDs are rejected cleanly", async () => {
  const { call } = env("bgmi");
  assert.equal(await reasonOf(call(payload({ tournamentId: "does-not-exist" }))), "TOURNAMENT_NOT_FOUND");
  assert.equal(await reasonOf(call(payload({ tournamentId: "a/b" }))), "TOURNAMENT_NOT_FOUND");
  assert.equal(await reasonOf(call(payload({ tournamentId: "" }))), "TOURNAMENT_NOT_FOUND");
  assert.equal(await reasonOf(call(payload({ tournamentId: null }))), "TOURNAMENT_NOT_FOUND");
  assert.equal(await reasonOf(call(payload({ tournamentId: { $ne: 1 } }))), "TOURNAMENT_NOT_FOUND");
});

test("T15a double submission with the same requestId creates ONE registration (sequential retry)", async () => {
  const { db, call } = env("bgmi");
  const p = payload();
  const a = await call(p);
  const b = await call(p);
  assert.equal(a.registrationId, b.registrationId);
  assert.equal(b.replayed, true);
  assert.equal(db.all("registrations").length, 1);
  assert.equal(db.all("privateRegistrations").length, 1);
  assert.equal(db.all("teamNames").length, 1);
});

test("T15b concurrent double submission (same requestId) creates ONE registration", async () => {
  const { db, call } = env("bgmi");
  const p = payload();
  const results = await Promise.allSettled([call(p), call(p), call(p)]);
  assert.ok(results.every((r) => r.status === "fulfilled"));
  assert.equal(new Set(results.map((r) => r.value.registrationId)).size, 1);
  assert.equal(db.all("registrations").length, 1);
});

test("T15c concurrent submissions of the SAME team name from different requests: exactly one wins", async () => {
  const { db, call } = env("bgmi");
  const names = ["Team Alpha", "team alpha", "TEAM  ALPHA", " Team Alpha ", "tEaM aLpHa", "Team Alpha"];
  const results = await Promise.allSettled(names.map((teamName) => call(payload({ teamName }))));
  const ok = results.filter((r) => r.status === "fulfilled");
  const bad = results.filter((r) => r.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(bad.length, names.length - 1);
  assert.ok(bad.every((r) => r.reason.details.reason === "DUPLICATE_TEAM_NAME"));
  assert.equal(db.all("registrations").length, 1);
  assert.equal(db.all("teamNames").length, 1);
});

test("team names with '/' or other odd characters do not break the reservation", async () => {
  const { db, call } = env("bgmi");
  assert.equal((await call(payload({ teamName: "Team/Alpha ♛" }))).success, true);
  assert.equal(await reasonOf(call(payload({ teamName: "team/alpha ♛" }))), "DUPLICATE_TEAM_NAME");
  assert.equal(db.all("teamNames").length, 1);
});

test("reservation shape: pending, scoped to tournament, has expiry; registration id matches", async () => {
  const { db, call } = env("bgmi");
  const t0 = Date.now();
  const res = await call(payload(), () => t0);
  const [rid_, r] = db.all("teamNames")[0];
  assert.ok(rid_.startsWith("bgmi-test-001_"));
  assert.equal(r.tournamentId, "bgmi-test-001");
  assert.equal(r.normalizedTeamName, "team alpha");
  assert.equal(r.registrationId, res.registrationId);
  assert.equal(r.status, "pending");
  assert.ok(r.reservedAt instanceof Ts);
  assert.equal(r.expiresAt.toMillis(), t0 + 30 * 60 * 1000);
});

test("a pending reservation still inside its window blocks the name", async () => {
  const { call } = env("bgmi");
  const t0 = Date.now();
  await call(payload(), () => t0);
  assert.equal(await reasonOf(call(payload(), () => t0 + 29 * 60 * 1000)), "DUPLICATE_TEAM_NAME");
});

test("an EXPIRED unpaid reservation is released: name reusable, old registration marked expired", async () => {
  const { db, call } = env("bgmi");
  const t0 = Date.now();
  const first = await call(payload(), () => t0);
  const second = await call(payload(), () => t0 + 31 * 60 * 1000);
  assert.equal(second.success, true);
  assert.notEqual(second.registrationId, first.registrationId);
  assert.equal(db._store.get(`registrations/${first.registrationId}`).status, "expired");
  assert.equal(db._store.get(`registrations/${second.registrationId}`).status, "pending");
  const res = db.all("teamNames");
  assert.equal(res.length, 1);
  assert.equal(res[0][1].registrationId, second.registrationId);
});

test("a CONFIRMED reservation never expires (future payment phase)", async () => {
  const { db, call } = env("bgmi");
  const t0 = Date.now();
  await call(payload(), () => t0);
  const [id, r] = db.all("teamNames")[0];
  db.seed("teamNames", id, { ...r, status: "confirmed" });
  assert.equal(await reasonOf(call(payload(), () => t0 + 365 * 24 * 3600 * 1000)), "DUPLICATE_TEAM_NAME");
});

test("client cannot override authoritative values", async () => {
  const { db, call } = env("bgmi");
  const p = payload({ status: "confirmed", paymentStatus: "paid", teamNumber: 7, registeredTeams: 0, maxTeams: 999, entryFee: "₹1", prizePool: "₹9" });
  await call(p);
  const reg = db.all("registrations")[0][1];
  assert.equal(reg.status, "pending");
  assert.equal(reg.paymentStatus, "pending");
  assert.equal(reg.teamNumber, null);
  for (const k of ["maxTeams", "registeredTeams", "entryFee", "prizePool"]) assert.ok(!(k in reg), `${k} must not be copied from the client`);
  const closed = env("bgmi", { "bgmi-test-001": openT({ status: "live" }) });
  assert.equal(await reasonOf(closed.call(payload({ status: "registration_open" }))), "TOURNAMENT_CLOSED");
  const full = env("bgmi", { "bgmi-test-001": openT({ maxTeams: 4, registeredTeams: 4 }) });
  assert.equal(await reasonOf(full.call(payload({ maxTeams: 999, registeredTeams: 0 }))), "TOURNAMENT_FULL");
});

test("player validation: missing/short fields, bad email/phone, optional player 5", async () => {
  const { db, call } = env("bgmi");
  const bad = [
    (p) => { p.player1.email = "nope"; },
    (p) => { p.player1.phone = "12345"; },
    (p) => { p.player1.name = ""; },
    (p) => { p.player3.ign = "x"; },
    (p) => { p.player4 = undefined; },
    (p) => { p.player2.uid = 5; },
    (p) => { p.teamName = "ab"; },
    (p) => { p.teamName = "x".repeat(31); },
    (p) => { p.requestId = "short"; },
    (p) => { p.player5 = { enabled: true, name: "", ign: "", uid: "" }; }
  ];
  for (const mutate of bad) {
    const p = payload();
    mutate(p);
    const teamNameBad = p.teamName === "ab" || p.teamName === "x".repeat(31);
    assert.equal(await reasonOf(call(p)), teamNameBad ? "INVALID_TEAM_NAME" : "INVALID_REQUEST");
  }
  assert.equal(db.all("registrations").length, 0);
  const ok = await call(payload({ teamName: "Five Squad", player5: { enabled: true, name: "Sub Five", ign: "FiveX", uid: "1005" } }));
  assert.equal(db._store.get(`registrations/${ok.registrationId}`).player5.enabled, true);
  // Player 5 disabled: its contents are ignored/blanked, not validated
  const off = await call(payload({ teamName: "Four Squad", player5: { enabled: false, name: "junk", ign: "", uid: "1001" } }));
  assert.deepEqual(db._store.get(`registrations/${off.registrationId}`).player5, { enabled: false, name: "", ign: "", uid: "" });
});

test("logs never contain email, phone or player names", async () => {
  const { call } = env("bgmi");
  logged.length = 0;
  await call(payload());
  await reasonOf(call(payload({ teamName: "Team Alpha" })));
  const text = JSON.stringify(logged);
  assert.ok(logged.length >= 2);
  assert.ok(!/asha@example|98765|Asha One|AshaX/i.test(text), text);
});

test("unexpected Firestore failures become a generic INTERNAL error and log no PII", async () => {
  const { db, call } = env("bgmi");
  db.runTransaction = async () => { throw Object.assign(new Error("boom asha@example.com"), { code: 14 }); };
  logged.length = 0;
  assert.equal(await reasonOf(call(payload())), "INTERNAL_ERROR");
  assert.ok(!/asha@example/i.test(JSON.stringify(logged)));
});
