/**
 * ES TRAINERS — Tournament Rendering
 * ------------------------------------------------------------
 * Renders the "Upcoming tournaments" grid from the shared realtime
 * store (both Firebase projects, one listener each). This file only
 * renders what Firebase actually returns — it never fabricates a
 * tournament, a date, a fee or a prize amount.
 *
 * NO-FLICKER CONTRACT
 * Cards are built ONCE and then patched in place. A realtime update
 * never rebuilds the grid, never re-shows the loading state, and
 * never touches a DOM node whose value didn't change. If
 * registeredTeams goes 0 -> 1, exactly one text node is rewritten.
 *
 * Numeric fields (maxTeams / registeredTeams) stay numbers end to
 * end: read as-is from Firestore, compared as-is, and only joined
 * into "0 / 25 teams" at display time. No parsing, no casting.
 */

import { onTournamentState } from "./tournament-store.js";

const GAME_LABEL = { bgmi: "BGMI", ffmax: "FF MAX" };

// Small stroke-based SVG icons for tournament metadata rows.
// Consistent 16x16 viewBox, currentColor — no emoji.
const META_ICON = {
  date: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.8" width="13" height="11.5" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6.3h13" stroke="currentColor" stroke-width="1.4"/><path d="M5 1.4v2.4M11 1.4v2.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  // "Match" — reticle/target, reads as "what is being played".
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

/** Writes an attribute only when it would actually change, so a
 *  repeated identical snapshot mutates nothing at all. */
function setHidden(el, hidden) {
  if (!el || el.hidden === hidden) return;
  el.hidden = hidden;
}

function setClass(el, name, on) {
  if (!el || el.classList.contains(name) === on) return;
  el.classList.toggle(name, on);
}

/** Live element registry, keyed by game + document id. */
const cards = new Map();
const blocks = new Map();
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
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  } catch {
    return null;
  }
}

/** Firestore document -> the strings a card displays. */
function toViewModel(t) {
  const slots =
    typeof t.registeredTeams === "number" && typeof t.maxTeams === "number"
      ? `${t.registeredTeams} / ${t.maxTeams} teams`
      : null;

  return {
    id: t.id,
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

/**
 * Register link for a tournament card. Built from the tournament
 * document ID Firestore actually returned (never a hardcoded ID) and
 * only when the status is the canonical registration-open value.
 * Returns null otherwise so the card shows no working Register button.
 */
function buildRegisterUrl(t) {
  const cfg = window.ES_CONFIG || {};
  if (!t.id || t.status !== cfg.registrationOpenStatus) return null;
  const base =
    t.game === "ffmax" ? cfg.routes?.ffmaxRegister :
    t.game === "bgmi" ? cfg.routes?.bgmiRegister :
    null; // unknown game -> no link, never a guess
  if (!base) return null;
  return `${base}?id=${encodeURIComponent(t.id)}`;
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

/** Writes only what actually changed. Text goes in via textContent,
 *  so Firebase values are never interpreted as HTML. */
function patchCard(el, view) {
  const setText = (field, value) => {
    const node = el.querySelector(`[data-field="${field}"]`);
    if (!node) return;
    const next = value == null ? "" : String(value);
    if (node.textContent !== next) node.textContent = next;
  };

  setText("game", view.game);
  setText("title", view.title);
  setText("status", view.status);

  const statusEl = el.querySelector('[data-field="status"]');
  setHidden(statusEl, !view.status);
  setClass(statusEl, "tcard__status--live", view.statusKey === "live");

  const cta = el.querySelector('[data-field="cta"]');
  if (cta) {
    if (view.registerUrl) {
      if (cta.getAttribute("href") !== view.registerUrl) cta.setAttribute("href", view.registerUrl);
      cta.removeAttribute("aria-disabled");
      setHidden(cta, false);
    } else {
      cta.setAttribute("href", "#");
      cta.setAttribute("aria-disabled", "true");
      setHidden(cta, true);
    }
  }

  META_ROWS.forEach(({ key }) => {
    const row = el.querySelector(`[data-row="${key}"]`);
    const value = view[key];
    setHidden(row, value == null || value === "");
    setText(key, value);
  });
}

/* ---- Grid-wide state blocks: created at most once, then toggled ---- */

function getBlock(id, build) {
  if (blocks.has(id)) return blocks.get(id);
  const el = build();
  el.hidden = true;
  blocks.set(id, el);
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

function render(state) {
  const max = window.ES_CONFIG?.tournaments?.maxPerGame || 3;
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

    let el = cards.get(key);
    if (!el) {
      el = buildCard(view);
      cards.set(key, el);
      grid.appendChild(el);
      createdAny = true;
    }
    patchCard(el, view);
    elements.push(el);
  });

  // Drop cards whose tournament is gone (e.g. status -> completed).
  cards.forEach((el, key) => {
    if (seen.has(key)) return;
    el.remove();
    cards.delete(key);
  });

  // Reorder in place. Moving an existing node keeps it alive —
  // no destroy/recreate, so nothing flashes.
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
  if (createdAny) window.ESAnimations?.observeNewReveals(grid);
}

export function initTournaments() {
  grid = document.getElementById("tournaments-grid");
  if (!grid) return;
  onTournamentState(render);
}
