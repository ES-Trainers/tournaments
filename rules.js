/**
 * ES TRAINERS — Tournament Rules page (rules.js)
 * One Firestore listener (same BGMI project as the rest of the site). Renders ONLY what the tournament
 * document really contains. Optional fields that are missing are simply not shown; nothing is invented.
 *
 * Optional tournament fields read here (all plain text, or an array of text):
 *   title, match, teamSize, date, entryFee / entryFeeInr / registrationFee, prizePool, maxTeams, registeredTeams,
 *   rules (text or array), reportingTime, roomDetails, scoring, killPoints, placementPoints, disqualification,
 *   resultVerification, disputeProcess
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, query, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { evaluate, formatDateTimeIST } from "./tournament-lifecycle.js";
import { resolveEntryFee, cleanText, cleanMoney } from "./tournament-card.js";

const CURRENT = ["upcoming", "registration_open", "live"];
const host = document.getElementById("rules-live");

const app = initializeApp({
  apiKey: "AIzaSyBug5r0hXPRCK8x6O6TasSlFFtx378_6iw", authDomain: "bgmi-firebase.firebaseapp.com", projectId: "bgmi-firebase",
  storageBucket: "bgmi-firebase.firebasestorage.app", messagingSenderId: "144306362464", appId: "1:144306362464:web:3a91a4e8381f2eb7af4b05"
}, "rules");
const db = getFirestore(app);

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function lines(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  if (typeof v === "string" && v.trim()) return v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function renderOne(t) {
  const wrap = el("section", "lt");
  wrap.appendChild(el("h3", "lt__title", cleanText(t.title) || "BGMI Tournament"));
  const ev = evaluate(t, Date.now());
  const facts = [];
  const add = (label, value) => { if (value) facts.push([label, value]); };
  add("Tournament ID", t.id);
  add("Match type", cleanText(t.match));
  add("Team size", cleanText(t.teamSize) || null);
  add("Start", ev.startMs !== null ? formatDateTimeIST(ev.startMs) : null);
  add("Registration deadline", ev.deadlineMs !== null ? formatDateTimeIST(ev.deadlineMs) + " (48 hours before start)" : null);
  add("Registration fee", resolveEntryFee(t).label);
  add("Prize pool", cleanMoney(t.prizePool));
  if (typeof t.maxTeams === "number" && t.maxTeams > 0) add("Team slots", `${typeof t.registeredTeams === "number" ? t.registeredTeams : 0} of ${t.maxTeams} registered`);
  add("Reporting time", cleanText(t.reportingTime));
  add("Room ID / password", cleanText(t.roomDetails));
  const dl = el("dl", "lt__facts");
  facts.forEach(([k, v]) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "", v)); });
  if (facts.length) wrap.appendChild(dl);

  [["Scoring", t.scoring], ["Kill points", t.killPoints], ["Placement points", t.placementPoints], ["Disqualification", t.disqualification], ["Result verification", t.resultVerification], ["Dispute process", t.disputeProcess], ["Tournament rules", t.rules]].forEach(([label, v]) => {
    const items = lines(v); if (!items.length) return;
    wrap.appendChild(el("h4", "lt__h", label));
    const ul = el("ul", "lt__list"); items.forEach((x) => ul.appendChild(el("li", "", x))); wrap.appendChild(ul);
  });
  wrap.appendChild(el("p", "lmuted", "Anything not listed above has not been published for this tournament."));
  return wrap;
}

onSnapshot(query(collection(db, "tournaments"), limit(200)), (snap) => {
  const list = [];
  snap.forEach((d) => { const t = { id: d.id, ...d.data() }; if (CURRENT.includes(t.status)) list.push(t); });
  host.replaceChildren(...(list.length ? list.map(renderOne) : [el("p", "lmuted", "No BGMI tournament is published right now. Check back soon, or join the community for updates.")]));
}, (err) => {
  console.error("Rules listener failed", err);
  host.replaceChildren(el("p", "lmuted", "Tournament details could not be loaded. Please refresh the page."));
});
