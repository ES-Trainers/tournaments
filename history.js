/**
 * ES TRAINERS — Tournament History (history.js)
 * Shows ONLY tournaments whose status is "completed". Results are shown ONLY when the tournament record has
 *   resultsVerified === true  and  results = [{ place: <integer>, teamName: <text>, points?: <number>, prize?: <text> }]
 * Nothing is invented; with no completed tournaments the empty state in history.html stays.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, query, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { parseStartMillis, formatDateIST } from "./tournament-lifecycle.js";
import { cleanText, cleanMoney } from "./tournament-card.js";

const host = document.getElementById("history-list");
const emptyHtml = host.innerHTML;
const app = initializeApp({
  apiKey: "AIzaSyBug5r0hXPRCK8x6O6TasSlFFtx378_6iw", authDomain: "bgmi-firebase.firebaseapp.com", projectId: "bgmi-firebase",
  storageBucket: "bgmi-firebase.firebasestorage.app", messagingSenderId: "144306362464", appId: "1:144306362464:web:3a91a4e8381f2eb7af4b05"
}, "history");
const db = getFirestore(app);

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }

export function verifiedResults(t) {
  if (t.resultsVerified !== true || !Array.isArray(t.results) || !t.results.length) return null;
  const seen = new Set(); const out = [];
  for (const r of t.results) {
    if (!r || !Number.isInteger(r.place) || r.place < 1 || seen.has(r.place) || !cleanText(r.teamName)) return null; // one bad row hides the table
    seen.add(r.place);
    out.push({ place: r.place, teamName: cleanText(r.teamName), points: Number.isFinite(r.points) ? r.points : null, prize: cleanText(r.prize) });
  }
  return out.sort((a, b) => a.place - b.place);
}

function card(t) {
  const c = el("article", "lh");
  c.appendChild(el("h3", "lh__title", cleanText(t.title) || "BGMI Tournament"));
  const ms = parseStartMillis(t.date);
  const meta = [ms !== null ? formatDateIST(ms) : null, cleanText(t.match), cleanMoney(t.prizePool) ? "Prize pool " + cleanMoney(t.prizePool) : null].filter(Boolean);
  if (meta.length) c.appendChild(el("p", "lh__meta", meta.join(" · ")));
  const res = verifiedResults(t);
  if (res) {
    const wrap = el("div", "ltable-wrap"); const tb = el("table", "ltable");
    const head = el("tr"); ["Place", "Team"].concat(res.some((r) => r.points !== null) ? ["Points"] : [], res.some((r) => r.prize) ? ["Prize"] : []).forEach((h) => { const th = el("th", "", h); th.scope = "col"; head.appendChild(th); });
    const thead = el("thead"); thead.appendChild(head); tb.appendChild(thead);
    const body = el("tbody");
    res.forEach((r) => { const tr = el("tr"); tr.appendChild(el("td", "", String(r.place))); tr.appendChild(el("td", "", r.teamName)); if (res.some((x) => x.points !== null)) tr.appendChild(el("td", "", r.points === null ? "" : String(r.points))); if (res.some((x) => x.prize)) tr.appendChild(el("td", "", r.prize || "")); body.appendChild(tr); });
    tb.appendChild(body); wrap.appendChild(tb); c.appendChild(wrap);
  } else c.appendChild(el("p", "lmuted", "Verified results for this tournament have not been published yet."));
  return c;
}

onSnapshot(query(collection(db, "tournaments"), limit(200)), (snap) => {
  const done = [];
  snap.forEach((d) => { const t = { id: d.id, ...d.data() }; if (t.status === "completed") done.push(t); });
  done.sort((a, b) => (parseStartMillis(b.date) || 0) - (parseStartMillis(a.date) || 0));
  if (!done.length) { host.innerHTML = emptyHtml; return; }
  host.replaceChildren(...done.map(card));
}, (err) => { console.error("History listener failed", err); });
