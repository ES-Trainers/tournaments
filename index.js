/**
 * ES TRAINERS — Homepage script (index.js)
 * ------------------------------------------------------------
 * The ONLY script index.html loads (as an ES module).
 *
 * Sections:
 *   1. CONFIG            constants (links, statuses, Firebase web config)
 *   2. FIREBASE + STORE  ONE onSnapshot listener on the BGMI Firebase
 *                        project, shared by the tournament card and the
 *                        Instagram status
 *   3. HELPERS           "write only if changed" DOM helpers (tournament-card.js)
 *   4. TOURNAMENT GRID   promo cards built once, then patched in place
 *   5. INSTAGRAM STATUS  status + CTA only (no feed, no API, no embed)
 *   6. PAGE BEHAVIOUR    navbar, mobile menu, scroll reveal
 *   7. START
 *
 * Nothing here polls, nothing fabricates tournament data, and the
 * Firebase Web config below is public by design (not a secret).
 * ES Trainers is a BGMI-only platform; there is no other game's code here.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { activeOnly, buildComingSoon, startTicker } from "./lifecycle-ui.js";
import { parseStartMillis } from "./tournament-lifecycle.js";
import { buildCard, patchCard, buildView, setText, setHidden, setClass } from "./tournament-card.js";

/* ==========================================================
   1. CONFIG
   ========================================================== */

const CONFIG = {
  instagram: {
    handle: "@es_trainers",
    profileUrl: "https://www.instagram.com/es_trainers/"
  },

  tournaments: {
    collectionName: "tournaments",
    // Max promo cards rendered in the grid.
    maxCards: 3,
    // Statuses that count as "upcoming" for the Instagram ranking.
    upcomingStatusValues: ["upcoming", "registration_open"],
    registrationOpenStatusValues: ["registration_open"],
    liveStatusValue: "live",
    // What the listener subscribes to. "completed" is excluded on
    // purpose so a finished tournament drops off the page by itself.
    // No orderBy("date"): a document with a missing / invalid date must still
    // arrive so the card can show a safe "schedule unavailable" state. Sorting
    // happens client-side.
    listenStatusValues: ["upcoming", "registration_open", "live"],
    listenLimit: 10
  }
};

// The BGMI Firebase project. Provided by the project owner — do not invent or modify.
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
   2. FIREBASE + SHARED TOURNAMENT STORE
   ONE realtime listener. Two consumers (the tournament grid and the
   Instagram section) subscribe to the store, so two consumers never
   mean two onSnapshot listeners. The store only holds what Firestore
   actually delivered, plus an "ok" flag so the UI can show a quiet
   connection notice without discarding data already on screen.
   ========================================================== */

const store = { loaded: false, ok: true, tournaments: [] };
const storeSubscribers = new Set();
let storeStarted = false;

function storeSnapshot() {
  return { ...store, tournaments: store.tournaments.slice() };
}

function emitStore() {
  const current = storeSnapshot();
  storeSubscribers.forEach((fn) => {
    try {
      fn(current);
    } catch (error) {
      // One broken consumer must never stop the others updating.
      console.error("[ES Trainers] tournament store subscriber failed:", error);
    }
  });
}

/** Registers a consumer; it is called at once with the current state. */
function onTournamentState(fn) {
  storeSubscribers.add(fn);
  fn(storeSnapshot());
  return () => storeSubscribers.delete(fn);
}

/** Sorts by start time; a document without a usable date goes last. */
function byStart(a, b) {
  const x = parseStartMillis(a.date), y = parseStartMillis(b.date);
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

/**
 * Opens the realtime listener for the BGMI Firebase project.
 * Uses onSnapshot() — not polling, not repeated getDocs(). Firestore
 * pushes a new snapshot whenever a listened-to document changes
 * (status, date, match, entryFee, prizePool, maxTeams,
 * registeredTeams, title), so no refresh is ever needed.
 * Errors flag the connection and keep the last good data; there is
 * no retry loop.
 */
function listenToBgmi() {
  const { appName, config, label } = BGMI_FIREBASE;
  const cfg = CONFIG.tournaments;

  try {
    const db = getFirestore(initializeApp(config, appName));
    const q = query(
      collection(db, cfg.collectionName),
      where("status", "in", cfg.listenStatusValues),
      limit(cfg.listenLimit)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const tournaments = [];
        snapshot.forEach((docSnap) => {
          tournaments.push({ ...docSnap.data(), id: docSnap.id, game: "bgmi" });
        });
        tournaments.sort(byStart);
        store.loaded = true; store.ok = true; store.tournaments = tournaments;
        emitStore();
      },
      (error) => {
        console.error(`[ES Trainers] ${label} realtime listener error:`, error);
        // Keep the last good tournaments — only flag the connection.
        store.loaded = true; store.ok = false;
        emitStore();
      }
    );
  } catch (error) {
    console.error(`[ES Trainers] ${label} realtime listener failed to start:`, error);
    store.loaded = true; store.ok = false;
    emitStore();
    return () => {};
  }
}

/** Starts the listener. Safe to call more than once. */
function startTournamentStore() {
  if (storeStarted) return;
  storeStarted = true;
  listenToBgmi();
}

function isLive(tournament) {
  return String(tournament?.status || "").toLowerCase() === CONFIG.tournaments.liveStatusValue;
}

/* ==========================================================
   3. HELPERS — setText / setHidden / setClass come from
   tournament-card.js and never touch a DOM node whose value
   did not change.
   ========================================================== */

/* ==========================================================
   4. TOURNAMENT GRID
   NO-FLICKER CONTRACT: cards are built ONCE and then patched in
   place. A realtime update never rebuilds the grid, never re-shows
   the loading state, and never touches a node whose value did not
   change. registeredTeams 0 -> 1 rewrites exactly one text node.
   An expired tournament (start time passed) is removed and the BGMI
   Coming Soon section takes its place.
   ========================================================== */

const cardElements = new Map(); // tournament id -> <article>
const gridBlocks = new Map();   // coming-soon / error / notice blocks
let grid = null;
let loadingRemoved = false;

function getBlock(id, build) {
  if (gridBlocks.has(id)) return gridBlocks.get(id);
  const el = build();
  el.hidden = true;
  gridBlocks.set(id, el);
  grid.appendChild(el);
  return el;
}

function errorBlock() {
  const div = document.createElement("div");
  div.className = "tempty tempty--error";
  div.innerHTML = "<p>Unable to load BGMI tournament information right now. Please try again later.</p>";
  return div;
}

function noticeBlock() {
  const div = document.createElement("div");
  div.className = "tnotice";
  div.setAttribute("role", "status");
  div.textContent = "Reconnecting — showing the last received tournament information.";
  return div;
}

function removeLoadingOnce() {
  if (loadingRemoved) return;
  const loader = grid.querySelector("[data-tournaments-loading]");
  if (loader) loader.remove();
  loadingRemoved = true;
}

let lastTournamentState = null;
let lastActive = [];

function renderTournaments(state) {
  lastTournamentState = state;
  const now = Date.now();
  const active = activeOnly(state.tournaments, now);
  lastActive = active;
  const shown = active.slice(0, CONFIG.tournaments.maxCards);

  const seen = new Set();
  const elements = [];
  let createdAny = false;

  shown.forEach((t) => {
    seen.add(t.id);
    let el = cardElements.get(t.id);
    if (!el) {
      el = buildCard("promo", "h3");
      cardElements.set(t.id, el);
      grid.appendChild(el);
      createdAny = true;
    }
    patchCard(el, buildView(t, now));
    elements.push(el);
  });

  // Drop cards whose tournament is gone (completed, or the start time passed).
  cardElements.forEach((el, id) => {
    if (seen.has(id)) return;
    el.remove();
    cardElements.delete(id);
  });

  // Reorder in place. Moving an existing node keeps it alive.
  elements.forEach((el, index) => {
    if (grid.children[index] !== el) grid.insertBefore(el, grid.children[index] || null);
  });

  if (elements.length || state.loaded) removeLoadingOnce();

  const down = !state.ok;
  setHidden(getBlock("csoon", buildComingSoon), !(state.loaded && !down && active.length === 0));
  setHidden(getBlock("error", errorBlock), !(down && state.tournaments.length === 0));
  // A dropped connection with data still on screen gets a quiet line, never a giant error.
  setHidden(getBlock("notice", noticeBlock), !(down && state.tournaments.length > 0));

  if (createdAny) observeNewReveals(grid);
}

function initTournaments() {
  grid = document.getElementById("tournaments-grid");
  if (!grid) return;
  onTournamentState(renderTournaments);
  startTicker(() => lastActive, () => { if (lastTournamentState) renderTournaments(lastTournamentState); });
}

/* ==========================================================
   5. INSTAGRAM STATUS
   Says that every update is posted on Instagram, and mirrors the
   current tournament state from the SAME shared store above.
   NOT a feed: no iframe, no embed, no Instagram API, no fetched
   posts, no thumbnails, no follower counts. The only external
   action is opening the official profile in a new tab.
   Priority shown: live > registration open > upcoming > default.
   ========================================================== */

const IG_LEVELS = ["live", "registration", "upcoming"];

const IG_BADGE = {
  live: "Tournament Live",
  registration: "Registration Open",
  upcoming: "Upcoming Tournament"
};

function igNote(level) {
  if (level === "live") {
    return `The tournament is currently live. Follow ${CONFIG.instagram.handle} for live updates, results and important announcements.`;
  }
  if (level === "registration") {
    return "Registration is now open. Follow us on Instagram for tournament announcements, schedules and important updates.";
  }
  return "Tournament updates and announcements will be posted on our official Instagram.";
}

const igCards = new Map();
let igSection = null;
let igStatusWrap = null;
let igStatusList = null;
let igCtaLabel = null;

/** Firestore status -> priority level, or null if irrelevant. */
function classify(tournament) {
  const cfg = CONFIG.tournaments;
  const status = String(tournament?.status || "").toLowerCase();

  if (isLive(tournament)) return "live";
  if (cfg.registrationOpenStatusValues.includes(status)) return "registration";
  if (cfg.upcomingStatusValues.includes(status)) return "upcoming";
  return null;
}

/** Every BGMI tournament at the highest priority level that exists. */
function pickGroup(state) {
  const grouped = { live: [], registration: [], upcoming: [] };
  const now = Date.now();
  activeOnly(state.tournaments, now).forEach((t) => {
    const level = classify(t);
    if (level) grouped[level].push(t);
  });
  const level = IG_LEVELS.find((name) => grouped[name].length > 0) || null;
  return { level, tournaments: level ? grouped[level] : [] };
}

function buildIgCard() {
  const article = document.createElement("article");
  article.className = "ig-card";
  article.innerHTML = `
    <span class="ig-card__badge">
      <span class="ig-card__dot" aria-hidden="true"></span>
      <span data-field="badge"></span>
    </span>
    <p class="ig-card__game" data-field="game"></p>
    <h3 class="ig-card__title" data-field="title"></h3>
    <p class="ig-card__note" data-field="note"></p>
  `;
  return article;
}

function patchIgCard(el, tournament, level) {
  const field = (name) => el.querySelector(`[data-field="${name}"]`);

  setText(field("badge"), IG_BADGE[level]);
  setText(field("game"), "BGMI");
  setText(field("title"), tournament.title || "ES Trainers Tournament");
  setText(field("note"), igNote(level));

  IG_LEVELS.forEach((name) => setClass(el, `ig-card--${name}`, name === level));
  setClass(el, "ig-card--bgmi", true);
}

function renderInstagram(state) {
  const { level, tournaments } = pickGroup(state);
  const seen = new Set();
  const elements = [];

  tournaments.forEach((t) => {
    const key = t.id;
    seen.add(key);

    let el = igCards.get(key);
    if (!el) {
      el = buildIgCard();
      igCards.set(key, el);
      igStatusList.appendChild(el);
    }
    patchIgCard(el, t, level);
    elements.push(el);
  });

  // Drop cards that left the current group (completed, or outranked).
  igCards.forEach((el, key) => {
    if (seen.has(key)) return;
    el.remove();
    igCards.delete(key);
  });

  elements.forEach((el, index) => {
    if (igStatusList.children[index] !== el) {
      igStatusList.insertBefore(el, igStatusList.children[index] || null);
    }
  });

  const hasStatus = elements.length > 0;
  const multi = elements.length > 1; // several tournaments at the same level

  setClass(igStatusList, "ig__status-list--multi", multi);
  setClass(igSection, "ig--multi", multi);
  setHidden(igStatusWrap, !hasStatus);
  setClass(igSection, "ig--has-status", hasStatus);
  setClass(igSection, "ig--live", level === "live");

  // The CTA itself is never rebuilt — only its label changes.
  setText(igCtaLabel, hasStatus ? `Follow ${CONFIG.instagram.handle}` : "Follow us on Instagram");
}

function initInstagramSection() {
  igSection = document.getElementById("instagram");
  if (!igSection) return;

  igStatusWrap = igSection.querySelector("[data-ig-status]");
  igStatusList = igSection.querySelector("[data-ig-status-list]");
  igCtaLabel = igSection.querySelector("[data-ig-cta]");
  if (!igStatusWrap || !igStatusList) return;

  // One config constant drives every Instagram link and handle here.
  igSection.querySelectorAll("[data-ig-profile]").forEach((link) => {
    link.setAttribute("href", CONFIG.instagram.profileUrl);
  });
  igSection.querySelectorAll("[data-ig-handle]").forEach((node) => {
    setText(node, CONFIG.instagram.handle);
  });

  onTournamentState(renderInstagram);
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
   Module scripts run after the document is parsed. Both consumers
   subscribe BEFORE the listener starts, so the very first Firebase
   snapshot already reaches them.
   ========================================================== */

initNavbar();
initMobileMenu();
observeNewReveals(document);
initTournaments();
initInstagramSection();
startTournamentStore();
