/**
 * ES TRAINERS — FF MAX page script (ffmax.js)
 * ------------------------------------------------------------
 * The ONLY script ffmax.html loads (as an ES module).
 *
 *   1. CONFIG            constants + the public FF MAX Firebase web config
 *   2. FIREBASE + STORE  ONE onSnapshot listener on ff-max-firebase
 *                        (collection "tournaments"), shared by the
 *                        current grid and the hero CTA
 *   3. HELPERS           "write only if changed" DOM helpers
 *   4. CARDS             build once, patch in place (same as homepage)
 *   5. RENDER            current/upcoming cards + hero CTA
 *   6. PAGE BEHAVIOUR    navbar, mobile menu, scroll reveal
 *   7. START
 *
 * Nothing here polls, nothing fabricates tournament data. The
 * Firebase Web config is public by design (not a secret).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, query, limit, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ==========================================================
   1. CONFIG
   ========================================================== */

const CONFIG = {
  collectionName: "tournaments",
  registerRoute: "register-ffmax.html",     // always used as `${route}?id=<Firestore doc id>`
  registrationOpenStatus: "registration_open",
  currentStatuses: ["upcoming", "registration_open", "live"],
  // One listener, whole collection (no `where` + `orderBy`, so no
  // composite index is needed). Filtering and sorting happen client-side.
  listenLimit: 200
};

const FFMAX_FIREBASE = {
  appName: "ffmax",
  label: "FF MAX",
  config: {
      apiKey: "AIzaSyC0S6rtGY7QRf6AaMKaeZKZZmDTtgfgUPI",
      authDomain: "ff-max-firebase.firebaseapp.com",
      projectId: "ff-max-firebase",
      storageBucket: "ff-max-firebase.firebasestorage.app",
      messagingSenderId: "700617250226",
      appId: "1:700617250226:web:565816627d31c5612700ab",
      measurementId: "G-MWQVHS5HZR"
    }
};

/* ==========================================================
   2. FIREBASE + STORE
   ========================================================== */

const store = { loaded: false, ok: true, tournaments: [] };
const subscribers = new Set();
let started = false;

function emit() { subscribers.forEach((fn) => fn(store)); }
function onStore(fn) { subscribers.add(fn); fn(store); }

/** ONE onSnapshot listener. Errors flag the connection and keep the
 *  last good data; there is no retry loop and no polling. */
function startListener() {
  if (started) return;
  started = true;
  try {
    const db = getFirestore(initializeApp(FFMAX_FIREBASE.config, FFMAX_FIREBASE.appName));
    onSnapshot(
      query(collection(db, CONFIG.collectionName), limit(CONFIG.listenLimit)),
      (snapshot) => {
        const list = [];
        snapshot.forEach((docSnap) => list.push({ ...docSnap.data(), id: docSnap.id, game: "ffmax" }));
        store.loaded = true; store.ok = true; store.tournaments = list;
        emit();
      },
      (error) => {
        console.error("[ES Trainers] FF MAX realtime listener error:", error);
        store.loaded = true; store.ok = false;
        emit();
      }
    );
  } catch (error) {
    console.error("[ES Trainers] FF MAX realtime listener failed to start:", error);
    store.loaded = true; store.ok = false;
    emit();
  }
}

function dateMillis(value) {
  try {
    const d = value?.toDate ? value.toDate() : new Date(value);
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  } catch { return null; }
}

/** Sorts by date; documents without a usable date go last. */
function byDate(direction) {
  return (a, b) => {
    const x = dateMillis(a.date), y = dateMillis(b.date);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * direction;
  };
}

function currentTournaments(list) {
  return list.filter((t) => CONFIG.currentStatuses.includes(t.status)).sort(byDate(1));
}

/* ==========================================================
   3. HELPERS
   ========================================================== */

function setText(node, value) {
  if (!node) return;
  const next = value == null ? "" : String(value);
  if (node.textContent !== next) node.textContent = next;
}

function setHidden(el, hidden) {
  if (!el || el.hidden === hidden) return;
  el.hidden = hidden;
}

function setAttr(el, name, value) {
  if (!el || el.getAttribute(name) === value) return;
  el.setAttribute(name, value);
}

function setClass(el, name, on) {
  if (!el || el.classList.contains(name) === on) return;
  el.classList.toggle(name, on);
}


function getBlock(container, id, build) {
  const key = `${container.id}:${id}`;
  if (blocks.has(key)) return blocks.get(key);
  const el = build();
  el.hidden = true;
  blocks.set(key, el);
  container.appendChild(el);
  return el;
}

/* ==========================================================
   4. CARDS — same NO-FLICKER contract as the homepage: built once,
   then patched in place. maxTeams / registeredTeams stay numbers
   and are only joined into "0 / 25 teams" for display.
   ========================================================== */

// Small stroke-based SVG icons for the metadata rows (16x16, currentColor).
const META_ICON = {
  date: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.8" width="13" height="11.5" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6.3h13" stroke="currentColor" stroke-width="1.4"/><path d="M5 1.4v2.4M11 1.4v2.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  match: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.6" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><path d="M8 0.9v2.3M8 12.8v2.3M0.9 8h2.3M12.8 8h2.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  entry: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 5.3 8 1.5l6.5 3.8v5.4L8 14.5l-6.5-3.8V5.3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 8 6Z" stroke="currentColor" stroke-width="1.2"/></svg>`,
  prize: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 2.3h7v2.6a3.5 3.5 0 0 1-7 0V2.3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.5 3H2.7a.7.7 0 0 0-.7.7v.7a2.8 2.8 0 0 0 2.8 2.8M11.5 3h1.8a.7.7 0 0 1 .7.7v.7a2.8 2.8 0 0 1-2.8 2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8 8.9v2.1m-1.8 2.7h3.6m-1.8-2.7v2.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  slots: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="5.6" cy="5.3" r="2.1" stroke="currentColor" stroke-width="1.4"/><path d="M1.6 13.2c.4-2.5 2-3.9 4-3.9s3.6 1.4 4 3.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.3 3.4a2.1 2.1 0 0 1 0 3.9M12 9.6c1.7.4 2.9 1.7 3.2 3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`
};

// Row order inside a card. Firestore field -> visible label.
const META_ROWS = [
  { key: "date", label: "Date", icon: META_ICON.date },
  { key: "match", label: "Match", icon: META_ICON.match },
  { key: "entry", label: "Entry", icon: META_ICON.entry },
  { key: "prize", label: "Prize Pool", icon: META_ICON.prize },
  { key: "slots", label: "Slots", icon: META_ICON.slots }
];

const cardElements = new Map(); // "game:id" -> <article>
const gridBlocks = new Map();   // empty / error / notice blocks
let grid = null;
let loadingRemoved = false;

function formatDate(value) {
  try {
    // Firestore Timestamp, ISO string, plain date string, or millis.
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) {
      // Not parseable — show exactly what the admin typed rather than
      // dropping the row. Never invent a date.
      return typeof value === "string" && value.trim() ? value : null;
    }
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}


const blocks = new Map();

function isFull(t) {
  return typeof t.registeredTeams === "number" && typeof t.maxTeams === "number" &&
    t.registeredTeams >= t.maxTeams;
}

/** Built from the real Firestore document id, only while registration
 *  is open AND there is a free slot. Otherwise null: no button. */
function buildRegisterUrl(t) {
  if (!t.id || t.status !== CONFIG.registrationOpenStatus || isFull(t)) return null;
  return `${CONFIG.registerRoute}?id=${encodeURIComponent(t.id)}`;
}

function toViewModel(t) {
  const slots =
    typeof t.registeredTeams === "number" && typeof t.maxTeams === "number"
      ? `${t.registeredTeams} / ${t.maxTeams} teams`
      : null;
  const full = t.status === CONFIG.registrationOpenStatus && isFull(t);
  return {
    gameKey: "ffmax",
    game: "FF MAX",
    status: full ? "registration full" : t.status ? String(t.status).replace(/_/g, " ") : null,
    statusKey: String(t.status || "").toLowerCase(),
    title: t.title || "Untitled Tournament",
    date: formatDate(t.date),
    match: t.match || null,
    entry: t.entryFee || null,
    prize: t.prizePool || null,
    slots,
    registerUrl: buildRegisterUrl(t)
  };
}

function buildCard(view) {
  const article = document.createElement("article");
  article.className = `tcard tcard--${view.gameKey}`;
  article.setAttribute("data-reveal", "");

  const rows = META_ROWS.map(
    (row) => `
      <div data-row="${row.key}">
        <dt>${row.icon}${row.label}</dt>
        <dd data-field="${row.key}"></dd>
      </div>`
  ).join("");

  article.innerHTML = `
    <div class="tcard__top">
      <span class="tcard__badge" data-field="game"></span>
      <span class="tcard__status" data-field="status"></span>
    </div>
    <h3 class="tcard__title" data-field="title"></h3>
    <dl class="tcard__meta">${rows}</dl>
    <a class="tcard__cta" data-field="cta" href="#" aria-disabled="true" hidden>Register Now</a>
  `;
  return article;
}

/** Text goes in via textContent, so Firebase values are never
 *  interpreted as HTML. */
function patchCard(el, view) {
  const field = (name) => el.querySelector(`[data-field="${name}"]`);

  setText(field("game"), view.game);
  setText(field("title"), view.title);
  setText(field("status"), view.status);

  const statusEl = field("status");
  setHidden(statusEl, !view.status);
  setClass(statusEl, "tcard__status--live", view.statusKey === "live");

  const cta = field("cta");
  if (cta) {
    if (view.registerUrl) {
      setAttr(cta, "href", view.registerUrl);
      if (cta.hasAttribute("aria-disabled")) cta.removeAttribute("aria-disabled");
      setHidden(cta, false);
    } else {
      setAttr(cta, "href", "#");
      setAttr(cta, "aria-disabled", "true");
      setHidden(cta, true);
    }
  }

  META_ROWS.forEach(({ key }) => {
    const value = view[key];
    setHidden(el.querySelector(`[data-row="${key}"]`), value == null || value === "");
    setText(field(key), value);
  });
}


/** Creates missing cards, patches existing ones, removes gone ones and
 *  reorders in place. Existing nodes are never destroyed and recreated. */
function syncCards(container, map, items) {
  const seen = new Set();
  const elements = [];
  let created = false;

  items.forEach((t) => {
    seen.add(t.id);
    let el = map.get(t.id);
    if (!el) {
      el = buildCard(toViewModel(t));
      map.set(t.id, el);
      container.appendChild(el);
      created = true;
    }
    patchCard(el, toViewModel(t));
    elements.push(el);
  });

  map.forEach((el, id) => {
    if (seen.has(id)) return;
    el.remove();
    map.delete(id);
  });

  elements.forEach((el, index) => {
    if (container.children[index] !== el) container.insertBefore(el, container.children[index] || null);
  });

  if (created) observeNewReveals(container);
  return elements;
}

/* ==========================================================
   5. RENDER
   ========================================================== */

let heroCta = null;
const currentCards = new Map();

function emptyBlock(text) {
  return () => {
    const div = document.createElement("div");
    div.className = "tempty";
    div.innerHTML = `<svg class="tempty__icon" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" stroke-width="2"/><path d="M6 18h36" stroke="currentColor" stroke-width="2"/><path d="M16 6v8M32 6v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><p></p>`;
    div.querySelector("p").textContent = text;
    return div;
  };
}
function errorBlock(text) {
  return () => {
    const div = document.createElement("div");
    div.className = "tempty tempty--error";
    div.innerHTML = "<p></p>";
    div.querySelector("p").textContent = text;
    return div;
  };
}
function noticeBlock() {
  const div = document.createElement("div");
  div.className = "tnotice";
  div.setAttribute("role", "status");
  div.textContent = "Reconnecting — showing the last received tournament information.";
  return div;
}
function removeLoader(container) {
  const loader = container.querySelector("[data-loading]");
  if (loader) loader.remove();
}

/** Hero CTA: Register Now only when a real registration_open
 *  tournament with a free slot exists; otherwise it just scrolls. */
function updateHeroCta(current) {
  if (!heroCta) return;
  const open = current.find((t) => buildRegisterUrl(t));
  setAttr(heroCta, "href", open ? buildRegisterUrl(open) : "#tournaments");
  setText(heroCta, open ? "Register now" : "View tournaments");
}

function render(state) {
  const current = currentTournaments(state.tournaments);
  const down = !state.ok;

  syncCards(grid, currentCards, current);
  if (state.loaded) removeLoader(grid);
  setHidden(getBlock(grid, "error", errorBlock("Unable to load FF MAX tournament information right now. Please try again later.")),
    !(down && current.length === 0));
  setHidden(getBlock(grid, "notice", noticeBlock), !(down && current.length > 0));
  setHidden(getBlock(grid, "empty", emptyBlock("No FF MAX tournament announced yet. Check back soon.")),
    !(state.loaded && !down && current.length === 0));
  updateHeroCta(current);
}

/* ==========================================================
   6. PAGE BEHAVIOUR
   ========================================================== */

function initNavbar() {
  const nav = document.querySelector(".nav");
  if (!nav) return;

  const setScrolled = () => nav.classList.toggle("nav--scrolled", window.scrollY > 12);
  setScrolled();
  window.addEventListener("scroll", setScrolled, { passive: true });
}

function initMobileMenu() {
  const toggle = document.querySelector(".nav__toggle");
  const menu = document.getElementById("mobile-menu");
  if (!toggle || !menu) return;

  const links = menu.querySelectorAll("a");

  const open = () => {
    menu.classList.add("mobile-menu--open");
    toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");
    if (links[0]) links[0].focus();
  };

  const close = ({ restoreFocus = true } = {}) => {
    menu.classList.remove("mobile-menu--open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("no-scroll");
    if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => {
    if (menu.classList.contains("mobile-menu--open")) close(); else open();
  });

  links.forEach((link) => link.addEventListener("click", () => close({ restoreFocus: false })));

  menu.addEventListener("click", (event) => {
    if (event.target === menu) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("mobile-menu--open")) close();
  });
}

/* ---- Scroll reveal: IntersectionObserver only; reduced motion
        skips the observer and shows everything at once. ---- */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let revealObserver = null;

function getRevealObserver() {
  if (revealObserver) return revealObserver;
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  return revealObserver;
}

function observeNewReveals(root = document) {
  if (reduceMotion.matches) {
    root.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-revealed"));
    return;
  }
  const obs = getRevealObserver();
  root.querySelectorAll("[data-reveal]:not(.is-revealed)").forEach((el) => obs.observe(el));
}


/* ==========================================================
   7. START
   Subscribe BEFORE the listener starts so the very first
   snapshot already reaches the page.
   ========================================================== */

grid = document.getElementById("tournaments-grid");
heroCta = document.getElementById("hero-cta");

initNavbar();
initMobileMenu();
observeNewReveals(document);
onStore(render);
startListener();
