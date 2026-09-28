/**
 * ES TRAINERS — Instagram Section
 * ------------------------------------------------------------
 * Communicates two things: that ES Trainers publishes every
 * tournament update on Instagram, and what the current tournament
 * state is according to Firebase.
 *
 * It is NOT a feed. No iframe, no embed, no Instagram API, no
 * OAuth, no post fetching, no thumbnails, no fabricated cards.
 * Instagram owns every post, reel, schedule, result and
 * announcement. The only external action here is opening the
 * official profile in a new tab.
 *
 * It shares the SAME realtime listeners as the tournament grid
 * (see tournament-store.js) — subscribing here does not open a
 * second onSnapshot connection and costs no extra Firestore reads.
 *
 * NO-FLICKER CONTRACT
 * The panel, handle and CTA live in the markup and are never
 * rebuilt. A status card is created once per tournament and then
 * patched in place: a status flip (registration_open -> live)
 * rewrites a few text nodes and toggles two classes. Nothing is
 * destroyed and recreated, nothing reloads, nothing flashes, and
 * there is no loading state to re-show.
 */

import { onTournamentState, isLive } from "./tournament-store.js";

const GAME_LABEL = { bgmi: "BGMI", ffmax: "FF MAX" };

// Priority order, highest first (spec 17). The section shows every
// tournament sitting at the highest level that currently exists —
// so BGMI and FF MAX both appear when both are live, and neither
// game is ever arbitrarily preferred over the other.
const LEVELS = ["live", "registration", "upcoming"];

const LEVEL_BADGE = {
  live: "Tournament Live",
  registration: "Registration Open",
  upcoming: "Upcoming Tournament"
};

/** Copy per state. `handle` comes from the single config constant. */
function levelNote(level, handle) {
  if (level === "live") {
    return `The tournament is currently live. Follow ${handle} for live updates, results and important announcements.`;
  }
  if (level === "registration") {
    return "Registration is now open. Follow us on Instagram for tournament announcements, schedules and important updates.";
  }
  return "Tournament updates and announcements will be posted on our official Instagram.";
}

const cards = new Map();
let section = null;
let statusWrap = null;
let statusList = null;
let ctaLabel = null;
let handle = "@es_trainers";

/* ---- Minimal-write helpers: never touch an unchanged node ---- */

function setText(node, value) {
  if (!node) return;
  const next = value == null ? "" : String(value);
  if (node.textContent !== next) node.textContent = next;
}

function setHidden(el, hidden) {
  if (!el || el.hidden === hidden) return;
  el.hidden = hidden;
}

function setClass(el, name, on) {
  if (!el || el.classList.contains(name) === on) return;
  el.classList.toggle(name, on);
}

/** Firestore status string -> priority level, or null if irrelevant. */
function classify(tournament) {
  const cfg = window.ES_CONFIG?.tournaments || {};
  const status = String(tournament?.status || "").toLowerCase();

  if (isLive(tournament)) return "live";

  const registration = cfg.registrationOpenStatusValues || ["registration_open"];
  if (registration.includes(status)) return "registration";

  const upcoming = cfg.upcomingStatusValues || ["upcoming"];
  if (upcoming.includes(status)) return "upcoming";

  return null;
}

/**
 * Highest-priority group present in the current state.
 * Returns { level, tournaments } — tournaments is empty when the
 * section should sit in its normal (no status) Instagram state.
 */
function pickGroup(state) {
  const all = [...state.bgmi.tournaments, ...state.ffmax.tournaments];
  const grouped = { live: [], registration: [], upcoming: [] };

  all.forEach((t) => {
    const level = classify(t);
    if (level) grouped[level].push(t);
  });

  const level = LEVELS.find((name) => grouped[name].length > 0) || null;
  return { level, tournaments: level ? grouped[level] : [] };
}

function buildCard() {
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

/** Text goes in via textContent, so Firebase values are never
 *  interpreted as HTML. Titles come from Firebase — never hardcoded. */
function patchCard(el, tournament, level) {
  const field = (name) => el.querySelector(`[data-field="${name}"]`);

  setText(field("badge"), LEVEL_BADGE[level]);
  setText(field("game"), GAME_LABEL[tournament.game] || tournament.game);
  setText(field("title"), tournament.title || "ES Trainers Tournament");
  setText(field("note"), levelNote(level, handle));

  LEVELS.forEach((name) => setClass(el, `ig-card--${name}`, name === level));
  setClass(el, "ig-card--bgmi", tournament.game === "bgmi");
  setClass(el, "ig-card--ffmax", tournament.game === "ffmax");
}

function render(state) {
  const { level, tournaments } = pickGroup(state);
  const seen = new Set();
  const elements = [];

  tournaments.forEach((t) => {
    const key = `${t.game}:${t.id}`;
    seen.add(key);

    let el = cards.get(key);
    if (!el) {
      el = buildCard();
      cards.set(key, el);
      statusList.appendChild(el);
    }
    patchCard(el, t, level);
    elements.push(el);
  });

  // Drop cards whose tournament left the current group (completed,
  // or outranked by a higher-priority one).
  cards.forEach((el, key) => {
    if (seen.has(key)) return;
    el.remove();
    cards.delete(key);
  });

  // Reorder in place — moving a live node keeps it alive, so
  // nothing is destroyed and nothing flashes.
  elements.forEach((el, index) => {
    if (statusList.children[index] !== el) {
      statusList.insertBefore(el, statusList.children[index] || null);
    }
  });

  const hasStatus = elements.length > 0;

  // Both games at the same priority: side by side on wider screens
  // instead of one oversized block. Never assumes only BGMI.
  const multi = elements.length > 1;
  setClass(statusList, "ig__status-list--multi", multi);
  setClass(section, "ig--multi", multi);
  setHidden(statusWrap, !hasStatus);
  setClass(section, "ig--has-status", hasStatus);
  setClass(section, "ig--live", level === "live");

  // The CTA itself is never rebuilt — only its label changes.
  setText(ctaLabel, hasStatus ? `Follow ${handle}` : "Follow us on Instagram");
}

export function initInstagramSection() {
  section = document.getElementById("instagram");
  if (!section) return;

  statusWrap = section.querySelector("[data-ig-status]");
  statusList = section.querySelector("[data-ig-status-list]");
  ctaLabel = section.querySelector("[data-ig-cta]");
  if (!statusWrap || !statusList) return;

  // One config constant drives every Instagram link and handle here.
  const profileUrl = window.ES_CONFIG?.instagram?.profileUrl;
  handle = window.ES_CONFIG?.instagram?.handle || handle;

  section.querySelectorAll("[data-ig-profile]").forEach((link) => {
    if (profileUrl) link.setAttribute("href", profileUrl);
  });
  section.querySelectorAll("[data-ig-handle]").forEach((node) => {
    setText(node, handle);
  });

  onTournamentState(render);
}
