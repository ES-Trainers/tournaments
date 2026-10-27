/**
 * ES TRAINERS — BGMI page script (bgmi.js)
 * ------------------------------------------------------------
 * The ONLY script bgmi.html loads (as an ES module).
 *
 *   1. CONFIG            constants + the public BGMI Firebase web config
 *   2. FIREBASE + STORE  ONE onSnapshot listener on bgmi-firebase
 *                        (collection "tournaments"), shared by the
 *                        tournament cards and the hero CTA
 *   3. HELPERS           "write only if changed" DOM helpers (tournament-card.js)
 *   4. CARDS             detailed cards built once, patched in place
 *   5. RENDER            current/upcoming cards, Coming Soon, hero CTA
 *   6. PAGE BEHAVIOUR    navbar, mobile menu, scroll reveal
 *   7. START
 *
 * Nothing here polls, nothing fabricates tournament data. The
 * Firebase Web config is public by design (not a secret).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, query, limit, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { activeOnly, buildComingSoon, startTicker } from "./lifecycle-ui.js";
import { parseStartMillis } from "./tournament-lifecycle.js";
import { buildCard, patchCard, buildView, setText, setHidden, setAttr } from "./tournament-card.js";

/* ==========================================================
   1. CONFIG
   ========================================================== */

const CONFIG = {
  collectionName: "tournaments",
  currentStatuses: ["upcoming", "registration_open", "live"],
  // One listener, whole collection (no `where` + `orderBy`, so no
  // composite index is needed). Filtering and sorting happen client-side.
  listenLimit: 200
};

const BGMI_FIREBASE = {
  appName: "bgmi",
  label: "BGMI",
  config: {
      apiKey: "AIzaSyBug5r0hXPRCK8x6O6TasSlFFtx378_6iw",
      authDomain: "bgmi-firebase.firebaseapp.com",
      projectId: "bgmi-firebase",
      storageBucket: "bgmi-firebase.firebasestorage.app",
      messagingSenderId: "144306362464",
      appId: "1:144306362464:web:3a91a4e8381f2eb7af4b05",
      measurementId: "G-37YDZGRFXR"
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
    const db = getFirestore(initializeApp(BGMI_FIREBASE.config, BGMI_FIREBASE.appName));
    onSnapshot(
      query(collection(db, CONFIG.collectionName), limit(CONFIG.listenLimit)),
      (snapshot) => {
        const list = [];
        snapshot.forEach((docSnap) => list.push({ ...docSnap.data(), id: docSnap.id, game: "bgmi" }));
        store.loaded = true; store.ok = true; store.tournaments = list;
        emit();
      },
      (error) => {
        console.error("[ES Trainers] BGMI realtime listener error:", error);
        store.loaded = true; store.ok = false;
        emit();
      }
    );
  } catch (error) {
    console.error("[ES Trainers] BGMI realtime listener failed to start:", error);
    store.loaded = true; store.ok = false;
    emit();
  }
}


/** Sorts by start time; documents without a usable date go last. */
function byDate(direction) {
  return (a, b) => {
    const x = parseStartMillis(a.date), y = parseStartMillis(b.date);
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
   3. HELPERS — setText / setHidden / setAttr come from tournament-card.js
   ========================================================== */

const blocks = new Map();

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
   then patched in place. Numeric fields stay numbers end to end.
   ========================================================== */

/** Creates missing cards, patches existing ones, removes gone ones and
 *  reorders in place. Existing nodes are never destroyed and recreated. */
function syncCards(container, map, items) {
  const seen = new Set();
  const elements = [];
  let created = false;
  const now = Date.now();

  items.forEach((t) => {
    seen.add(t.id);
    let el = map.get(t.id);
    if (!el) {
      el = buildCard("detail", "h3");
      map.set(t.id, el);
      container.appendChild(el);
      created = true;
    }
    patchCard(el, buildView(t, now));
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

let grid = null;
let heroCta = null;
let lastCurrent = [];
let lastState = null;
const currentCards = new Map();

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
 *  tournament with a free slot exists before the deadline; otherwise it just scrolls. */
function updateHeroCta(current) {
  if (!heroCta) return;
  const now = Date.now();
  const open = current.map((t) => buildView(t, now).registerUrl).find(Boolean);
  setAttr(heroCta, "href", open || "#tournaments");
  setText(heroCta, open ? "Register now" : "View tournaments");
}

function render(state) {
  lastState = state;
  const current = activeOnly(currentTournaments(state.tournaments), Date.now());
  lastCurrent = current;
  const down = !state.ok;

  syncCards(grid, currentCards, current);
  if (state.loaded) removeLoader(grid);
  setHidden(getBlock(grid, "error", errorBlock("Unable to load BGMI tournament information right now. Please try again later.")),
    !(down && current.length === 0));
  setHidden(getBlock(grid, "notice", noticeBlock), !(down && current.length > 0));
  // Expired (or no) tournament: a dedicated Coming Soon section. No date is invented.
  setHidden(getBlock(grid, "csoon", buildComingSoon), !(state.loaded && !down && current.length === 0));
  updateHeroCta(current);
}

function renderNow() { if (lastState) render(lastState); }

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
startTicker(() => lastCurrent, renderNow); // ONE 1s ticker; render only patches changed text
