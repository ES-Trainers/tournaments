/**
 * ES TRAINERS — lifecycle UI helpers (lifecycle-ui.js)
 * Shared by index.js and bgmi.js. No Firebase here; it only turns the
 * tournament-lifecycle.js rules into list filtering, the BGMI
 * "Coming Soon" block and the single 1-second ticker.
 */
import { evaluate, nextBoundary } from "./tournament-lifecycle.js";
import { ensureArtSprite } from "./tournament-card.js";

const WHATSAPP_URL = "https://chat.whatsapp.com/LsbpYeU4OJ5CWVYsqDN5Es";
const INSTAGRAM_URL = "https://www.instagram.com/es_trainers/";
const warned = new Set();

/** Tournaments whose start time has not passed. A tournament with a missing / invalid
 *  date is KEPT (it is never treated as expired) and shows a configuration state. */
export function activeOnly(list, nowMs) {
  return list.filter((t) => {
    const phase = evaluate(t, nowMs).phase;
    if (phase === "invalid" && t && t.id && !warned.has(t.id)) {
      warned.add(t.id);
      console.error(`[ES Trainers] Tournament "${t.id}" has a missing or invalid \`date\` (needs a Firestore Timestamp, or text with a time such as 2026-10-31T07:00:00+05:30). Registration is paused until it is fixed.`);
    }
    return phase !== "expired";
  });
}

/**
 * BGMI "Coming Soon" block. Built once, then only shown / hidden.
 * It never states a date and never claims another tournament is scheduled.
 */
export function buildComingSoon() {
  ensureArtSprite();
  const sec = document.createElement("section");
  sec.className = "csoon";
  sec.setAttribute("aria-label", "BGMI tournament coming soon");
  sec.dataset.comingSoon = "bgmi";
  sec.innerHTML = `
    <div class="csoon__art" aria-hidden="true"><svg viewBox="0 0 480 480" preserveAspectRatio="xMidYMid slice" focusable="false"><use href="#es-bgmi-art"/></svg></div>
    <div class="csoon__body">
      <span class="csoon__badge">BGMI</span>
      <h3 class="csoon__title">BGMI Tournament <em>Coming Soon</em></h3>
      <p class="csoon__text">There is no open BGMI tournament at the moment. The next one will appear here as soon as ES Trainers publishes it.</p>
      <p class="csoon__sub">Follow ES Trainers to hear first when a tournament is announced.</p>
      <div class="csoon__actions">
        <a class="csoon__btn csoon__btn--wa" href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer">WhatsApp Community</a>
        <a class="csoon__btn" href="${INSTAGRAM_URL}" target="_blank" rel="noopener noreferrer">Instagram</a>
      </div>
      <div class="csoon__bar" aria-hidden="true"><i></i></div>
    </div>`;
  return sec;
}

/**
 * ONE ticker per page. Calls `rerender()` once a second while the tab is
 * visible (render only patches nodes whose text changed, so nothing
 * blinks) and again immediately when the tab becomes visible, which also
 * catches a deadline / start time that passed while the tab slept.
 */
export function startTicker(getList, rerender) {
  let timer = null;
  let lastSig = null;
  const run = () => {
    const now = Date.now();
    const list = getList();
    // A phase change (open -> closed -> expired) must always trigger a render, including the tick on
    // which the LAST boundary passes: at that moment no future boundary is left, so the countdown /
    // nextBoundary checks alone would skip it and an expired card would linger until the next
    // Firestore update.
    const sig = list.map((t) => evaluate(t, now).phase).join(",");
    const changed = sig !== lastSig;
    lastSig = sig;
    const hasCountdown = list.some((t) => { const p = evaluate(t, now).phase; return p === "open" || p === "full" || p === "waiting" || p === "closed"; });
    if (changed || hasCountdown || nextBoundary(list, now) !== null) rerender();
  };
  const start = () => { if (!timer) timer = setInterval(run, 1000); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop(); else { run(); start(); }
  });
  start();
  return stop;
}
