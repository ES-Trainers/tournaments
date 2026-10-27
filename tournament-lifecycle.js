/**
 * ES TRAINERS — tournament lifecycle (tournament-lifecycle.js)
 * ------------------------------------------------------------
 * Pure functions, no DOM, no Firebase. Shared by index.js, bgmi.js,
 * tournament-card.js and register-bgmi.js so every BGMI page follows ONE rule set.
 *
 *   Registration deadline = tournament start - exactly 48 hours.
 *
 * The start time is read ONLY from the Firestore field `date`
 * (Firestore Timestamp, or a string / millis that carries an explicit
 * time). A date-only value ("2026-10-31") has no time of day, so it is
 * reported as "invalid" instead of being guessed. Nothing is hardcoded.
 *
 * The browser clock is used for DISPLAY and UI gating only. The Apps
 * Script backend re-checks the deadline with its own clock.
 */

export const TZ = "Asia/Kolkata";
export const REGISTRATION_CLOSES_BEFORE_MS = 48 * 60 * 60 * 1000;
export const REGISTRATION_OPEN_STATUS = "registration_open";

/* Phases:
 *  invalid  start date missing / malformed / date-only (never treated as expired)
 *  expired  start time has passed -> card is hidden, Coming Soon is shown
 *  closed   before start, but now >= deadline
 *  open     before the deadline, status registration_open, free slot
 *  full     before the deadline, status registration_open, no free slot
 *  waiting  before the deadline, status is not registration_open (e.g. "upcoming") */

/** Returns epoch millis, or null when the value is not a usable instant. */
export function parseStartMillis(value) {
  try {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "object" && typeof value.toMillis === "function") {
      const ms = value.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "object" && typeof value.seconds === "number") {
      return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 1e11 ? value : null; // ignore tiny numbers
    }
    if (typeof value === "string") {
      const s = value.trim();
      // Must contain a time of day. A bare date is ambiguous.
      if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
      const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
      const iso = s.replace(" ", "T") + (hasZone ? "" : "+05:30"); // zone-less text means IST
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? ms : null;
    }
  } catch (e) { /* fall through */ }
  return null;
}

export function deadlineMillis(startMs) {
  return startMs === null ? null : startMs - REGISTRATION_CLOSES_BEFORE_MS;
}

function numeric(v) { return typeof v === "number" && Number.isFinite(v); }

/** Everything the UI needs about one tournament at instant `nowMs`. */
export function evaluate(t, nowMs) {
  const startMs = parseStartMillis(t && t.date);
  const deadMs = deadlineMillis(startMs);
  const full = numeric(t && t.registeredTeams) && numeric(t && t.maxTeams) && t.maxTeams > 0 && t.registeredTeams >= t.maxTeams;
  let phase;
  if (startMs === null) phase = "invalid";
  else if (nowMs >= startMs) phase = "expired";
  else if (nowMs >= deadMs) phase = "closed";
  else if (!t || t.status !== REGISTRATION_OPEN_STATUS) phase = "waiting";
  else phase = full ? "full" : "open";
  return { phase, startMs, deadlineMs: deadMs, msToDeadline: deadMs === null ? null : deadMs - nowMs, msToStart: startMs === null ? null : startMs - nowMs };
}

/** Next instant at which any tournament changes phase (deadline or start), or null. */
export function nextBoundary(list, nowMs) {
  let best = null;
  list.forEach((t) => {
    const startMs = parseStartMillis(t && t.date);
    if (startMs === null) return;
    [startMs - REGISTRATION_CLOSES_BEFORE_MS, startMs].forEach((b) => {
      if (b > nowMs && (best === null || b < best)) best = b;
    });
  });
  return best;
}

/* ---------- Formatting (always Asia/Kolkata, 12-hour AM/PM) ---------- */

export function formatDateIST(ms) {
  if (ms === null || ms === undefined) return null;
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(ms));
}
export function formatTimeIST(ms) {
  if (ms === null || ms === undefined) return null;
  const t = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(ms));
  return t.replace(/\u202f/g, " ") + " IST";
}
export function formatDateTimeIST(ms) {
  if (ms === null || ms === undefined) return null;
  return formatDateIST(ms) + ", " + formatTimeIST(ms);
}

/** "2d 04h 12m 09s" — only used while the deadline is still ahead. */
export function formatCountdown(ms) {
  if (ms === null || ms <= 0) return "0s";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const p2 = (n) => String(n).padStart(2, "0");
  return (d > 0 ? d + "d " : "") + p2(h) + "h " + p2(m) + "m " + p2(s) + "s";
}
