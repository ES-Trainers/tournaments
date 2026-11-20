/**
 * ES TRAINERS — Tournament History (history.js)
 * Shows ONLY tournaments whose status is "completed". Results are shown ONLY when the tournament record has
 *   resultsVerified === true  and  results = [{ place: <integer>, teamName: <text>, points?: <number>, prize?: <text> }]
 * Nothing is invented; with no completed tournaments the empty state in history.html stays.
 *
 * WINNERS PANEL: clicking a completed tournament opens a panel that reads tournamentWinners/<that tournament's id> from Firestore
 * (one document per tournament, document id === tournament id). Only a document with published === true is shown; rules allow the
 * public to read nothing else. Everything displayed comes from that document: no names, teams or prizes are generated here.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, query, limit, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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
  if (t.status === "completed") { /* the winners panel is only offered for completed tournaments */
    c.classList.add("lh--click");
    const btn = el("button", "btn btn--primary lh__view", "View winners");
    btn.type = "button"; btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-label", "View winners of " + (cleanText(t.title) || "this tournament"));
    btn.addEventListener("click", (e) => { e.stopPropagation(); openWinners(t, btn); });
    c.appendChild(btn);
    c.addEventListener("click", (e) => { /* the whole card is clickable too (the button is the keyboard route) */
      if (e.target.closest("a, button")) return;
      const sel = window.getSelection && window.getSelection().toString();
      if (sel) return; /* the visitor is selecting text */
      openWinners(t, btn);
    });
  }
  return c;
}

/* ==========================================================
   WINNERS PANEL
   ========================================================== */

const PLACES = [
  { key: "firstPlace", rank: 1, label: "1st place", cls: "gold" },
  { key: "secondPlace", rank: 2, label: "2nd place", cls: "silver" },
  { key: "thirdPlace", rank: 3, label: "3rd place", cls: "bronze" },
];
const winnersCache = new Map();
let panel = null, reqId = 0, lastTrigger = null, closing = false;

function money(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? "₹" + v.toLocaleString("en-IN") : null;
  return cleanMoney(v);
}
function idText(v) { return cleanText(v); }

/* Pure: Firestore document data -> what the panel shows. Returns {state:"unpublished"} unless published === true and at least
   one placement has a team name. Nothing is filled in for missing fields. */
export function normalizeWinners(data, tournamentId) {
  if (!data || data.published !== true) return { state: "unpublished" };
  if (data.tournamentId !== undefined && data.tournamentId !== tournamentId) return { state: "unpublished", mismatch: true };
  const places = PLACES.map((p) => {
    const r = data[p.key];
    const team = r && typeof r === "object" ? cleanText(r.teamName) : null;
    if (!team) return { ...p, missing: true };
    const players = (Array.isArray(r.players) ? r.players : []).slice(0, 10).map((x) => (x && typeof x === "object" ? { name: cleanText(x.name), id: idText(x.bgmiId) } : null)).filter((x) => x && x.name);
    return { ...p, team, leader: cleanText(r.leaderName), leaderId: idText(r.leaderBgmiId), prize: money(r.prizeAmount), players };
  });
  if (places.every((p) => p.missing)) return { state: "unpublished" };
  return { state: "ok", title: cleanText(data.tournamentTitle), places };
}

function ensurePanel() {
  if (panel) return panel;
  const d = el("dialog", "wd"); d.setAttribute("aria-labelledby", "wd-title");
  d.innerHTML = `
    <div class="wd__panel">
      <button type="button" class="wd__close" aria-label="Close winners panel"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg></button>
      <header class="wd__head">
        <img class="wd__logo" src="assets/logo/logo.png" alt="" width="46" height="46">
        <div class="wd__headtext"><p class="wd__eyebrow">Tournament results</p><h2 class="wd__title" id="wd-title"></h2><p class="wd__sub"></p></div>
      </header>
      <div class="wd__body" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(d);
  d.querySelector(".wd__close").addEventListener("click", closeWinners);
  d.addEventListener("cancel", (e) => { e.preventDefault(); closeWinners(); }); /* Escape: close with the animation */
  d.addEventListener("click", (e) => { if (e.target === d) closeWinners(); });  /* click on the dimmed backdrop */
  panel = d; return d;
}

function closeWinners() {
  if (!panel || !panel.open || closing) return;
  closing = true; reqId++; /* any response still in flight is ignored */
  panel.classList.remove("is-open");
  const done = () => { panel.close(); document.documentElement.classList.remove("wd-lock"); closing = false; if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus({ preventScroll: true }); };
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) done(); else setTimeout(done, 240);
}

function setBody(node) { const b = panel.querySelector(".wd__body"); b.replaceChildren(node); b.scrollTop = 0; b.removeAttribute("aria-busy"); }
function loadingView() {
  const w = el("div", "wd__loading"); w.setAttribute("role", "status");
  w.appendChild(el("p", "wd__loadtext", "Loading winners…"));
  for (let i = 0; i < 3; i++) w.appendChild(el("div", "wd__skel"));
  return w;
}
function messageView(kind, title, text, retry) {
  const w = el("div", "wd__msg wd__msg--" + kind);
  w.appendChild(el("h3", "", title)); w.appendChild(el("p", "", text));
  if (retry) { const b = el("button", "btn btn--primary", "Try again"); b.type = "button"; b.addEventListener("click", retry); w.appendChild(b); }
  return w;
}
function placeView(p, idx) {
  if (p.missing) {
    const a = el("article", "wp wp--" + p.cls + " is-missing"); a.style.setProperty("--i", idx);
    a.appendChild(el("p", "wp__rank", p.label)); a.appendChild(el("p", "wp__missing", "Not published yet")); return a;
  }
  const a = el("article", "wp wp--" + p.cls); a.style.setProperty("--i", idx);
  const top = el("div", "wp__top");
  const medal = el("span", "wp__medal", String(p.rank)); medal.setAttribute("aria-hidden", "true");
  const tt = el("div", "wp__tt"); tt.appendChild(el("p", "wp__rank", p.label)); tt.appendChild(el("h3", "wp__team", p.team));
  top.append(medal, tt); a.appendChild(top);
  if (p.prize) { const pz = el("p", "wp__prize"); pz.appendChild(el("span", "wp__prizel", "Prize")); pz.appendChild(el("strong", "", p.prize)); a.appendChild(pz); }
  if (p.leader) {
    const l = el("p", "wp__leader"); l.appendChild(el("span", "wp__k", "Team leader")); l.appendChild(el("strong", "", p.leader));
    if (p.leaderId) l.appendChild(el("span", "wp__id", "BGMI ID " + p.leaderId)); a.appendChild(l);
  }
  if (p.players.length) {
    const m = el("div", "wp__members"); m.appendChild(el("p", "wp__k", "Team members"));
    const ul = el("ul", "wp__list");
    p.players.forEach((x) => { const li = el("li"); li.appendChild(el("span", "wp__pn", x.name)); if (x.id) li.appendChild(el("span", "wp__id", "BGMI ID " + x.id)); ul.appendChild(li); });
    m.appendChild(ul); a.appendChild(m);
  }
  return a;
}
function resultsView(r) {
  const w = el("div", "wd__podium"); r.places.forEach((p, i) => w.appendChild(placeView(p, i))); return w;
}

async function fetchWinners(id) {
  if (winnersCache.has(id)) return winnersCache.get(id);
  let snap;
  try { snap = await getDoc(doc(db, "tournamentWinners", id)); }
  catch (err) {
    /* Rules allow reading only published documents, so "missing" and "not published" both arrive as permission-denied. */
    if (err && err.code === "permission-denied") return { state: "unpublished" };
    throw err;
  }
  if (!snap.exists()) return { state: "unpublished" };
  const r = normalizeWinners(snap.data(), id);
  if (r.mismatch) console.warn("tournamentWinners/" + id + ": tournamentId field does not match the document id; not shown.");
  if (r.state === "ok") winnersCache.set(id, r);
  return r;
}

function openWinners(t, trigger) {
  if (!t || t.status !== "completed" || !t.id) return; /* never for upcoming / active tournaments */
  const d = ensurePanel(); if (closing) return;
  lastTrigger = trigger || null;
  const title = cleanText(t.title) || "BGMI Tournament";
  d.querySelector(".wd__title").textContent = title;
  const ms = parseStartMillis(t.date);
  d.querySelector(".wd__sub").textContent = ["Completed", ms !== null ? formatDateIST(ms) : null].filter(Boolean).join(" · ");
  if (!d.open) { d.showModal(); document.documentElement.classList.add("wd-lock"); requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("is-open"))); }
  const my = ++reqId;
  const run = async () => {
    const body = d.querySelector(".wd__body"); body.setAttribute("aria-busy", "true"); setBody(loadingView()); body.setAttribute("aria-busy", "true");
    try {
      const r = await fetchWinners(t.id);
      if (my !== reqId) return; /* closed or another tournament opened meanwhile */
      if (r.state === "ok") setBody(resultsView(r));
      else setBody(messageView("none", "Winners not published yet", "The winners of this tournament have not been published yet. Please check back soon."));
    } catch (err) {
      console.error("Winners load failed", err);
      if (my !== reqId) return;
      setBody(messageView("error", "Could not load the winners", "Something went wrong while loading this tournament's winners. Check your connection and try again.", () => { reqId = my; run(); }));
    }
  };
  run();
}

onSnapshot(query(collection(db, "tournaments"), limit(200)), (snap) => {
  const done = [];
  snap.forEach((d) => { const t = { id: d.id, ...d.data() }; if (t.status === "completed") done.push(t); });
  done.sort((a, b) => (parseStartMillis(b.date) || 0) - (parseStartMillis(a.date) || 0));
  if (!done.length) { host.innerHTML = emptyHtml; return; }
  host.replaceChildren(...done.map(card));
}, (err) => { console.error("History listener failed", err); });
