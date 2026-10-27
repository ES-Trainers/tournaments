/**
 * ES TRAINERS — shared BGMI tournament card (tournament-card.js)
 * ------------------------------------------------------------
 * ONE renderer for the three places a BGMI tournament is shown:
 *   "promo"   homepage       (tournament-card.css  .tc--promo)
 *   "detail"  bgmi.html      (.tc--detail)
 *   "compact" register page  (.tc--compact)
 * Same DOM, same data, same status logic; only the layout differs.
 *
 * NO-FLICKER CONTRACT (unchanged from the previous cards): a card is
 * built ONCE and then patched in place. Every write checks the current
 * value first, so a realtime Firestore update or the 1-second ticker only
 * touches the nodes whose text really changed.
 *
 * Nothing is invented. Every value comes from the Firestore document;
 * a field that is missing / empty / zero-like is simply left out.
 * Text always goes in via textContent, never as HTML.
 */
import {
  evaluate, formatDateIST, formatTimeIST, formatDateTimeIST, formatCountdown,
  REGISTRATION_OPEN_STATUS
} from "./tournament-lifecycle.js";

export const REGISTER_ROUTE = "register-bgmi.html";

/* ---------- Original BGMI key art (project-made SVG, not licensed game art) ---------- */

const ART_DEFS = `<linearGradient id="ekSky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#0f3329"/>
                <stop offset="45%" stop-color="#071c17"/>
                <stop offset="100%" stop-color="#030c0a"/>
              </linearGradient>
              <radialGradient id="ekHaze" cx="70%" cy="26%" r="56%">
                <stop offset="0%" stop-color="#4fe0b8" stop-opacity="0.26"/>
                <stop offset="100%" stop-color="#4fe0b8" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="ekKeyLight" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#4fe0b8" stop-opacity="0.34"/>
                <stop offset="100%" stop-color="#4fe0b8" stop-opacity="0"/>
              </radialGradient>
              <linearGradient id="ekDust" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#3fd6ae" stop-opacity="0.16"/>
                <stop offset="100%" stop-color="#3fd6ae" stop-opacity="0"/>
              </linearGradient>
              <pattern id="ekScan" width="4" height="4" patternUnits="userSpaceOnUse">
                <rect width="4" height="1" fill="rgba(143,245,218,0.06)"/>
              </pattern>
              <radialGradient id="ekVignette" cx="54%" cy="34%" r="76%">
                <stop offset="50%" stop-color="#000" stop-opacity="0"/>
                <stop offset="100%" stop-color="#000" stop-opacity="0.7"/>
              </radialGradient>
              <g id="ekTrooper">
                <rect x="-31" y="-166" width="21" height="48" rx="7"/>
                <path d="M-15 -186a15 14 0 0 1 30 0l4 6h-38z"/>
                <rect x="-7" y="-177" width="16" height="13" rx="3"/>
                <path d="M-1 -170 3 -118" fill="none" stroke-width="31" stroke-linecap="round"/>
                <path d="M0 -120-11 -68-15 -8" fill="none" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M5 -120 17 -70 25 -10" fill="none" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M-24 -6h16" fill="none" stroke-width="10" stroke-linecap="round"/>
                <path d="M18 -8h18" fill="none" stroke-width="10" stroke-linecap="round"/>
                <path d="M2 -158 22 -140" fill="none" stroke-width="11" stroke-linecap="round"/>
                <path d="M16 -152 64 -150" fill="none" stroke-width="8"/>
                <path d="M26 -150 18 -130" fill="none" stroke-width="8" stroke-linecap="round"/>
                <path d="M4 -154 18 -160" fill="none" stroke-width="10" stroke-linecap="round"/>
                <path d="M6 -158 38 -146" fill="none" stroke-width="11" stroke-linecap="round"/>
              </g>
              <g id="ekChute">
                <path d="M-20 0a20 17 0 0 1 40 0z"/>
                <path d="M-20 0-3 15M-7 0-1.5 15M7 0 1.5 15M20 0 3 15" fill="none" stroke-width="1.3"/>
                <rect x="-3.5" y="15" width="7" height="10" rx="3"/>
              </g>
              <g id="ekPlane">
                <path d="M0 0 46-3 53 0 46 3z"/>
                <path d="M17-1 26-15h6l-4 14z"/>
                <path d="M17 1 26 15h6l-4-14z"/>
                <path d="M1-2 9-10h5l-4 8z"/>
              </g>`;
const ART_BODY = `<rect width="480" height="480" fill="url(#ekSky)"/>
            <rect width="480" height="480" fill="url(#ekHaze)"/>
            <path class="ek-dropline" d="M56 74 264 142" stroke="#5fe9c8" stroke-width="1.2" stroke-dasharray="4 9" fill="none" opacity="0.4"/>
            <g transform="translate(34,64) rotate(14) scale(0.72)" fill="#bfe9dd" opacity="0.5">
              <use href="#ekPlane"/>
            </g>
            <g fill="#a9ecd9" stroke="#a9ecd9" opacity="0.55">
              <use class="ek-chute" href="#ekChute" transform="translate(104,126)"/>
              <use class="ek-chute" href="#ekChute" transform="translate(156,172) scale(0.7)"/>
              <use class="ek-chute" href="#ekChute" transform="translate(68,194) scale(0.52)"/>
            </g>
            <path d="M-20 206C22 188 46 160 78 170s44 28 74 8 52-30 88-24 60-30 92-18 56 34 88 22 54-16 80-6V480H-20z" fill="#0d3129" opacity="0.88"/>
            <path d="M-20 260C32 244 60 212 98 222s56 38 94 26 62-32 100-22 54 36 94 26 68-18 94-10V480H-20z" fill="#082019"/>
            <rect x="-20" y="252" width="520" height="150" fill="url(#ekDust)"/>
            <path d="M-20 324C42 308 86 282 140 296s76 32 122 18 68-28 114-18 76 22 124 14V480H-20z" fill="#04110e"/>
            <ellipse cx="352" cy="224" rx="120" ry="130" fill="url(#ekKeyLight)"/>
            <g transform="translate(352,314)">
              <use href="#ekTrooper" transform="translate(-4,-4)" fill="#5fe9c8" stroke="#5fe9c8" opacity="0.6"/>
              <use href="#ekTrooper" fill="#020a08" stroke="#020a08"/>
            </g>
            <g stroke="#8ff5da" fill="none" opacity="0.45">
              <path d="M32 34h416" stroke-width="1"/>
              <path d="M40 34v9M60 34v5M80 34v5M100 34v5M120 34v9M140 34v5M160 34v5M180 34v5M200 34v9M220 34v5M240 34v5M260 34v5M280 34v9M300 34v5M320 34v5M340 34v5M360 34v9M380 34v5M400 34v5M420 34v5M440 34v9" stroke-width="1.1"/>
              <path d="M240 22 246 30h-12z" fill="#8ff5da" stroke="none" opacity="0.85"/>
              <path d="M320 134h-14v14M392 134h14v14M320 212h-14v-14M392 212h14v-14" stroke-width="1.4"/>
              <path d="M414 150h30M414 158h18" stroke-width="1" opacity="0.6"/>
              <path d="M22 22h28M22 22v28M458 458h-28M458 458v-28" stroke-width="1.4" opacity="0.7"/>
            </g>
            <rect width="480" height="480" fill="url(#ekScan)"/>
            <rect width="480" height="480" fill="url(#ekVignette)"/>`;

/** Injects the shared art sprite once per page. Cards only <use> it. */
export function ensureArtSprite() {
  if (document.getElementById("es-tc-sprite")) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "es-tc-sprite");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML = `<defs>${ART_DEFS}<symbol id="es-bgmi-art" viewBox="0 0 480 480">${ART_BODY}</symbol></defs>`;
  document.body.insertBefore(svg, document.body.firstChild);
}

/* ---------- Write-only-if-changed DOM helpers ---------- */

export function setText(node, value) {
  if (!node) return;
  const next = value == null ? "" : String(value);
  if (node.textContent !== next) node.textContent = next;
}
export function setHidden(el, hidden) { if (el && el.hidden !== hidden) el.hidden = hidden; }
export function setAttr(el, name, value) { if (el && el.getAttribute(name) !== value) el.setAttribute(name, value); }
export function setClass(el, name, on) { if (el && el.classList.contains(name) !== on) el.classList.toggle(name, on); }

/* ---------- Value cleaning: never show an invented or misleading value ---------- */

/** "₹200 / team" stays as written; 0, "₹0", "", null and non-finite numbers are left out. */
export function cleanMoney(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? "₹" + v.toLocaleString("en-IN") : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const digits = s.replace(/,/g, "").match(/\d+(\.\d+)?/g);
  if (digits && digits.every((d) => Number(d) === 0)) return null; // "0", "₹0" => not a real value
  return s;
}
export function cleanText(v) {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* ---------- Tournament -> view model (pure; unit-tested without a DOM) ---------- */

const REG_LABEL = {
  open: "Registration open", closed: "Registration closed", full: "Registration full",
  waiting: "Registration not open yet", invalid: "Schedule unavailable", expired: "Registration closed"
};

export function buildView(t, nowMs) {
  const ev = evaluate(t, nowMs);
  const max = isNum(t && t.maxTeams) && t.maxTeams > 0 ? t.maxTeams : null;
  const reg = isNum(t && t.registeredTeams) && t.registeredTeams >= 0 ? t.registeredTeams : null;
  const status = String((t && t.status) || "").toLowerCase();
  const tStatus = status === "live" ? "live" : (status === "upcoming" || status === REGISTRATION_OPEN_STATUS ? "upcoming" : null);
  const showCountdown = ev.phase === "open" || ev.phase === "full" || ev.phase === "waiting";
  let countdown = "";
  if (showCountdown && ev.msToDeadline > 0) countdown = "Registration closes in " + formatCountdown(ev.msToDeadline);
  else if (ev.phase === "closed" && ev.msToStart > 0) countdown = "Tournament starts in " + formatCountdown(ev.msToStart);

  let slotsText = null, slotsLeftText = null, pct = null;
  if (max !== null && reg !== null) {
    slotsText = `${reg} / ${max} registered`;
    const left = Math.max(0, max - reg);
    slotsLeftText = left === 0 ? "No slots left" : `${left} of ${max} slots left`;
    pct = Math.min(100, Math.round((reg / max) * 100));
  } else if (max !== null) {
    slotsText = `Up to ${max} teams`; // capacity only; the registered count is not valid / not set
  }

  let note = "";
  if (ev.phase === "invalid") note = "The tournament schedule is being confirmed. Registration is paused until it is published.";
  else if (ev.phase === "expired") note = "This tournament has already started.";
  else if (ev.phase === "waiting") note = "Registration has not opened for this tournament yet.";
  else if (ev.phase === "open" || ev.phase === "full") note = "Registration closes 48 hours before the tournament.";

  const canRegister = ev.phase === "open" && !!t.id && status === REGISTRATION_OPEN_STATUS;
  return {
    phase: ev.phase,
    title: cleanText(t && t.title) || "BGMI Tournament",
    tStatus,
    tStatusLabel: tStatus === "live" ? "Live" : tStatus === "upcoming" ? "Upcoming" : null,
    regKey: ev.phase === "expired" ? "closed" : ev.phase,
    regLabel: REG_LABEL[ev.phase] || null,
    date: ev.startMs !== null ? formatDateIST(ev.startMs) : null,
    time: ev.startMs !== null ? formatTimeIST(ev.startMs) : null,
    deadline: ev.deadlineMs !== null ? formatDateTimeIST(ev.deadlineMs) : null,
    fee: cleanMoney(t && t.entryFee),
    prize: cleanMoney(t && t.prizePool),
    match: cleanText(t && t.match),
    slots: slotsText,
    slotsLeft: slotsLeftText,
    pct,
    countdown,
    note,
    closed: ev.phase === "closed" || ev.phase === "expired",
    registerUrl: canRegister ? `${REGISTER_ROUTE}?id=${encodeURIComponent(t.id)}` : null
  };
}

/* ---------- DOM ---------- */

const ROWS = [
  { key: "date", label: "Date" },
  { key: "time", label: "Start time" },
  { key: "fee", label: "Entry fee" },
  { key: "prize", label: "Prize pool" },
  { key: "match", label: "Match type" },
  { key: "slots", label: "Teams" }
];
const ARROW = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13m0 0-5-5m5 5-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * variant: "promo" | "detail" | "compact"   headingTag: "h2" | "h3"
 * Returns the <article>. Call patchCard(el, buildView(t, now)) to fill it.
 */
export function buildCard(variant, headingTag = "h3") {
  ensureArtSprite();
  const el = document.createElement("article");
  el.className = `tc tc--${variant}`;
  el.dataset.variant = variant;
  if (variant !== "compact") el.setAttribute("data-reveal", "");
  const rows = ROWS.map((r) => `<div class="tc__row" data-row="${r.key}" hidden><dt>${r.label}</dt><dd data-f="${r.key}"></dd></div>`).join("");
  el.innerHTML = `
    <div class="tc__frame"><div class="tc__inner">
      <div class="tc__art" aria-hidden="true"><svg viewBox="0 0 480 480" preserveAspectRatio="xMidYMid slice" focusable="false"><use href="#es-bgmi-art"/></svg></div>
      <div class="tc__scan" aria-hidden="true"></div>
      <div class="tc__body">
        <div class="tc__top">
          <span class="tc__game">BGMI</span>
          <span class="tc__chip tc__chip--t" data-f="tstatus" hidden></span>
          <span class="tc__chip tc__chip--reg" data-f="regstatus" hidden><i aria-hidden="true"></i><b data-f="regtext"></b></span>
        </div>
        <${headingTag} class="tc__title" data-f="title"></${headingTag}>
        <dl class="tc__stats">${rows}</dl>
        <div class="tc__meter" data-row="meter" hidden>
          <div class="tc__meter-track" aria-hidden="true"><span data-f="meterbar"></span></div>
          <p class="tc__meter-text" data-f="slotsleft"></p>
        </div>
        <div class="tc__deadline" data-row="deadline" hidden>
          <div class="tc__dl-main"><span class="tc__dl-label">Registration closes</span><strong class="tc__dl-value" data-f="deadline"></strong></div>
          <p class="tc__count" data-f="countdown" hidden></p>
        </div>
        <p class="tc__note" data-f="note" hidden></p>
        <div class="tc__closed" data-f="closedBanner" role="status" hidden>
          <strong>REGISTRATION CLOSED</strong>
          <span>Registration closed 48 hours before the tournament start.</span>
        </div>
        ${variant === "compact" ? "" : `<div class="tc__actions">
          <a class="tc__cta" data-f="cta" href="#" hidden><span>Register Now</span>${ARROW}</a>
          ${variant === "promo" ? `<a class="tc__more" href="bgmi.html#tournaments">Tournament details</a>` : ""}
        </div>`}
      </div>
    </div></div>`;
  return el;
}

/** Patches an existing card. Safe to call every second. */
export function patchCard(el, view) {
  const f = (n) => el.querySelector(`[data-f="${n}"]`);
  const row = (n) => el.querySelector(`[data-row="${n}"]`);

  setAttr(el, "data-phase", view.phase);
  setText(f("title"), view.title);

  const ts = f("tstatus");
  setText(ts, view.tStatusLabel);
  setHidden(ts, !view.tStatusLabel);
  setClass(ts, "tc__chip--live", view.tStatus === "live");

  const rs = f("regstatus");
  setText(f("regtext"), view.regLabel);
  setHidden(rs, !view.regLabel);
  ["open", "closed", "full", "waiting", "invalid"].forEach((k) => setClass(rs, "tc__chip--" + k, view.regKey === k));

  ROWS.forEach(({ key }) => {
    const v = view[key];
    setHidden(row(key), v == null || v === "");
    setText(f(key), v);
  });

  const hasMeter = view.pct !== null;
  setHidden(row("meter"), !hasMeter);
  if (hasMeter) {
    const w = view.pct + "%";
    const bar = f("meterbar");
    if (bar.style.width !== w) bar.style.width = w;
    setText(f("slotsleft"), view.slotsLeft);
  }

  setText(f("deadline"), view.deadline);
  setHidden(row("deadline"), !view.deadline);
  setText(f("countdown"), view.countdown);
  setHidden(f("countdown"), !view.countdown);

  setText(f("note"), view.note);
  setHidden(f("note"), !view.note || view.closed);
  setHidden(f("closedBanner"), !view.closed);
  setClass(el, "tc--closed", view.closed);
  setClass(el, "tc--live", view.tStatus === "live");

  const cta = f("cta");
  if (cta) {
    if (view.registerUrl) {
      setAttr(cta, "href", view.registerUrl);
      cta.removeAttribute("aria-disabled");
      setHidden(cta, false);
    } else {
      setAttr(cta, "href", "#");
      setAttr(cta, "aria-disabled", "true");
      setHidden(cta, true);
    }
  }
}
