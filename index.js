/**
 * ES TRAINERS — Homepage script (index.js)
 * ------------------------------------------------------------
 * The ONLY script index.html loads (as an ES module). It replaces
 * the old homepage scripts: config.js, main.js, ui.js, animations.js,
 * card-tilt.js, firebase-bgmi.js, firebase-ffmax.js,
 * tournament-store.js, tournaments.js and instagram.js.
 *
 * Sections:
 *   1. CONFIG            constants (links, statuses, Firebase web config)
 *   2. FIREBASE + STORE  ONE onSnapshot listener per Firebase project,
 *                        shared by the tournament grid and Instagram
 *   3. HELPERS           tiny "write only if changed" DOM helpers
 *   4. TOURNAMENT GRID   builds each card once, then patches in place
 *   5. INSTAGRAM STATUS  status + CTA only (no feed, no API, no embed)
 *   6. PAGE BEHAVIOUR    navbar, mobile menu, scroll reveal, card tilt
 *   7. START
 *
 * Nothing here polls, nothing fabricates tournament data, and the
 * Firebase Web config below is public by design (not a secret).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ==========================================================
   1. CONFIG
   ========================================================== */

const CONFIG = {
  // Register pages (built in a later phase). Always used as
  // `${base}?id=<Firestore document id>`, never with a fixed ID.
  registerRoutes: {
    bgmi: "register-bgmi.html",
    ffmax: "register-ffmax.html"
  },

  // The single status meaning "registration is open".
  registrationOpenStatus: "registration_open",

  instagram: {
    handle: "@es_trainers",
    profileUrl: "https://www.instagram.com/es_trainers/"
  },

  tournaments: {
    collectionName: "tournaments",
    // Max cards rendered per game in the grid.
    maxPerGame: 3,
    // Statuses that count as "upcoming" for the Instagram ranking.
    upcomingStatusValues: ["upcoming", "registration_open"],
    registrationOpenStatusValues: ["registration_open"],
    liveStatusValue: "live",
    // What the listeners subscribe to. "completed" is excluded on
    // purpose so a finished tournament drops off the page by itself.
    listenStatusValues: ["upcoming", "registration_open", "live"],
    // Larger than maxPerGame so a live tournament is never missed
    // just because earlier-dated ones exist.
    listenLimit: 10
  }
};

// Two SEPARATE Firebase projects. They never share an app or data.
// Provided by the project owner — do not invent or modify.
const FIREBASE_PROJECTS = {
  bgmi: {
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
  },
  ffmax: {
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
  }
};

const GAME_LABEL = { bgmi: "BGMI", ffmax: "FF MAX" };

/* ==========================================================
   2. FIREBASE + SHARED TOURNAMENT STORE
   ONE realtime listener per Firebase project. Two consumers (the
   tournament grid and the Instagram section) subscribe to the
   store, so two consumers never mean two onSnapshot listeners.
   The store only holds what Firestore actually delivered, plus a
   per-project "ok" flag so the UI can show a quiet connection
   notice without discarding data already on screen.
   ========================================================== */

const store = {
  bgmi: { loaded: false, ok: true, tournaments: [] },
  ffmax: { loaded: false, ok: true, tournaments: [] }
};
const storeSubscribers = new Set();
let storeStarted = false;

function storeSnapshot() {
  return {
    bgmi: { ...store.bgmi, tournaments: store.bgmi.tournaments.slice() },
    ffmax: { ...store.ffmax, tournaments: store.ffmax.tournaments.slice() }
  };
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

/**
 * Opens the realtime listener for one game's Firebase project.
 * Uses onSnapshot() — not polling, not repeated getDocs(). Firestore
 * pushes a new snapshot whenever a listened-to document changes
 * (status, date, match, entryFee, prizePool, maxTeams,
 * registeredTeams, title), so no refresh is ever needed.
 * Errors flag the connection and keep the last good data; there is
 * no retry loop.
 */
function listenToGame(gameKey) {
  const { appName, config, label } = FIREBASE_PROJECTS[gameKey];
  const cfg = CONFIG.tournaments;

  try {
    const db = getFirestore(initializeApp(config, appName));
    const q = query(
      collection(db, cfg.collectionName),
      where("status", "in", cfg.listenStatusValues),
      orderBy("date", "asc"),
      limit(cfg.listenLimit)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const tournaments = [];
        snapshot.forEach((docSnap) => {
          tournaments.push({ id: docSnap.id, game: gameKey, ...docSnap.data() });
        });
        store[gameKey] = { loaded: true, ok: true, tournaments };
        emitStore();
      },
      (error) => {
        console.error(`[ES Trainers] ${label} realtime listener error:`, error);
        // Keep the last good tournaments — only flag the connection.
        store[gameKey] = { ...store[gameKey], loaded: true, ok: false };
        emitStore();
      }
    );
  } catch (error) {
    console.error(`[ES Trainers] ${label} realtime listener failed to start:`, error);
    store[gameKey] = { ...store[gameKey], loaded: true, ok: false };
    emitStore();
    return () => {};
  }
}

/** Starts both listeners. Safe to call more than once. */
function startTournamentStore() {
  if (storeStarted) return;
  storeStarted = true;
  listenToGame("bgmi");
  listenToGame("ffmax");
}

function isLive(tournament) {
  return String(tournament?.status || "").toLowerCase() === CONFIG.tournaments.liveStatusValue;
}

/* ==========================================================
   3. HELPERS — never touch a DOM node whose value didn't change
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

/* ==========================================================
   4. TOURNAMENT GRID ("Upcoming tournaments")
   NO-FLICKER CONTRACT: cards are built ONCE and then patched in
   place. A realtime update never rebuilds the grid, never re-shows
   the loading state, and never touches a node whose value did not
   change. registeredTeams 0 -> 1 rewrites exactly one text node.
   Numeric fields (maxTeams / registeredTeams) stay numbers end to
   end and are only joined into "0 / 25 teams" for display.
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

/**
 * Register link for a card. Built from the document ID Firestore
 * actually returned (never a hardcoded ID), and only when status is
 * exactly "registration_open". Otherwise null: no Register button.
 */
function buildRegisterUrl(t) {
  if (!t.id || t.status !== CONFIG.registrationOpenStatus) return null;
  const base = CONFIG.registerRoutes[t.game];
  if (!base) return null; // unknown game -> no link, never a guess
  return `${base}?id=${encodeURIComponent(t.id)}`;
}

/** Firestore document -> the strings a card displays. */
function toViewModel(t) {
  const slots =
    typeof t.registeredTeams === "number" && typeof t.maxTeams === "number"
      ? `${t.registeredTeams} / ${t.maxTeams} teams`
      : null;

  return {
    gameKey: t.game,
    game: GAME_LABEL[t.game] || t.game,
    status: t.status ? String(t.status).replace(/_/g, " ") : null,
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

/* Grid-wide state blocks: created at most once, then toggled. */

function getBlock(id, build) {
  if (gridBlocks.has(id)) return gridBlocks.get(id);
  const el = build();
  el.hidden = true;
  gridBlocks.set(id, el);
  grid.appendChild(el);
  return el;
}

function emptyBlock() {
  const div = document.createElement("div");
  div.className = "tempty";
  div.innerHTML = `
    <svg class="tempty__icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" stroke-width="2"/>
      <path d="M6 18h36" stroke="currentColor" stroke-width="2"/>
      <path d="M16 6v8M32 6v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <p>No tournament announced yet. Check back soon.</p>
  `;
  return div;
}

function errorBlock(gameLabel) {
  const div = document.createElement("div");
  div.className = "tempty tempty--error";
  div.innerHTML = `<p>Unable to load ${gameLabel} tournament information right now. Please try again later.</p>`;
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

function renderTournaments(state) {
  const max = CONFIG.tournaments.maxPerGame;
  const ordered = [
    ...state.bgmi.tournaments.slice(0, max),
    ...state.ffmax.tournaments.slice(0, max)
  ];

  const seen = new Set();
  const elements = [];
  let createdAny = false;

  ordered.forEach((t) => {
    const key = `${t.game}:${t.id}`;
    seen.add(key);
    const view = toViewModel(t);

    let el = cardElements.get(key);
    if (!el) {
      el = buildCard(view);
      cardElements.set(key, el);
      grid.appendChild(el);
      createdAny = true;
    }
    patchCard(el, view);
    elements.push(el);
  });

  // Drop cards whose tournament is gone (e.g. status -> completed).
  cardElements.forEach((el, key) => {
    if (seen.has(key)) return;
    el.remove();
    cardElements.delete(key);
  });

  // Reorder in place. Moving an existing node keeps it alive, so
  // nothing is destroyed and recreated.
  elements.forEach((el, index) => {
    if (grid.children[index] !== el) grid.insertBefore(el, grid.children[index] || null);
  });

  const bothLoaded = state.bgmi.loaded && state.ffmax.loaded;
  if (elements.length || bothLoaded) removeLoadingOnce();

  const bgmiDown = !state.bgmi.ok;
  const ffmaxDown = !state.ffmax.ok;

  setHidden(getBlock("error-bgmi", () => errorBlock("BGMI")),
    !(bgmiDown && state.bgmi.tournaments.length === 0));
  setHidden(getBlock("error-ffmax", () => errorBlock("FF MAX")),
    !(ffmaxDown && state.ffmax.tournaments.length === 0));

  // A project that dropped its connection but still has data on
  // screen gets a quiet line, never a giant error screen.
  setHidden(getBlock("notice", noticeBlock), !(
    (bgmiDown && state.bgmi.tournaments.length > 0) ||
    (ffmaxDown && state.ffmax.tournaments.length > 0)
  ));

  setHidden(getBlock("empty", emptyBlock), !(
    bothLoaded && !bgmiDown && !ffmaxDown && elements.length === 0
  ));

  // Only newly created cards need hooking into the reveal observer.
  if (createdAny) observeNewReveals(grid);
}

function initTournaments() {
  grid = document.getElementById("tournaments-grid");
  if (!grid) return;
  onTournamentState(renderTournaments);
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

/** Every tournament at the highest priority level that exists, so
 *  BGMI and FF MAX both show when both are live. */
function pickGroup(state) {
  const grouped = { live: [], registration: [], upcoming: [] };
  [...state.bgmi.tournaments, ...state.ffmax.tournaments].forEach((t) => {
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
  setText(field("game"), GAME_LABEL[tournament.game] || tournament.game);
  setText(field("title"), tournament.title || "ES Trainers Tournament");
  setText(field("note"), igNote(level));

  IG_LEVELS.forEach((name) => setClass(el, `ig-card--${name}`, name === level));
  setClass(el, "ig-card--bgmi", tournament.game === "bgmi");
  setClass(el, "ig-card--ffmax", tournament.game === "ffmax");
}

function renderInstagram(state) {
  const { level, tournaments } = pickGroup(state);
  const seen = new Set();
  const elements = [];

  tournaments.forEach((t) => {
    const key = `${t.game}:${t.id}`;
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
  const multi = elements.length > 1; // both games at the same level

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

/* ---- Card tilt: pointer-driven parallax for the BGMI / FF MAX
        game cards ([data-tilt]). Sets --mx/--my (-0.5..0.5); all
        transforms live in CSS. Skipped on touch and reduced motion. ---- */

function initCardTilt() {
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!canHover || reduceMotion.matches) return;

  document.querySelectorAll("[data-tilt]").forEach((card) => {
    let frame = null;

    const setTilt = (x, y) => {
      const rect = card.getBoundingClientRect();
      const mx = (x - rect.left) / rect.width - 0.5;
      const my = (y - rect.top) / rect.height - 0.5;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.setProperty("--mx", mx.toFixed(3));
        card.style.setProperty("--my", my.toFixed(3));
      });
    };

    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      card.style.setProperty("--mx", 0);
      card.style.setProperty("--my", 0);
    };

    card.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      setTilt(event.clientX, event.clientY);
    });
    card.addEventListener("pointerleave", reset);
    card.addEventListener("blur", reset);
  });
}

/* ==========================================================
   7. START
   Module scripts run after the document is parsed. Both consumers
   subscribe BEFORE the listeners start, so the very first Firebase
   snapshot already reaches them.
   ========================================================== */

initNavbar();
initMobileMenu();
observeNewReveals(document);
initCardTilt();
initTournaments();
initInstagramSection();
startTournamentStore();
