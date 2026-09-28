/**
 * ES TRAINERS — Server-Side Registration Validation
 * ------------------------------------------------------------
 * Mirrors the rules in js/registration-validation.js so the two
 * never quietly diverge, but nothing here trusts the frontend: this
 * file is the actual security boundary. Pure functions only.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Indian mobile numbers: 10 digits, starting 6-9. Accepts an optional
// leading +91 / 91 / 0 which is stripped before the check.
const MOBILE_RE = /^[6-9]\d{9}$/;

function required(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function lengthBetween(value, min, max) {
  const len = (value || "").trim().length;
  return len >= min && len <= max;
}

function isValidEmail(value) {
  return EMAIL_RE.test((value || "").trim());
}

function normalizeIndianMobile(value) {
  return String(value || "").replace(/[\s-]/g, "").replace(/^(\+?91|0)/, "");
}

function isValidIndianMobile(value) {
  return MOBILE_RE.test(normalizeIndianMobile(value));
}

/**
 * Trim, lowercase, collapse internal whitespace to single spaces.
 * "  TEAM   Alpha  " -> "team alpha"
 */
function normalizeTeamName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Trim + collapse whitespace only (case preserved) — this is the
 * display value stored as `teamName`.
 */
function cleanTeamNameDisplay(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

/**
 * Validates one player's name/ign/uid (and email/phone when
 * `requireContact` is set, for Player 1). Returns an array of
 * human-readable error strings; empty array means valid.
 */
function validatePlayer(player, label, { requireContact = false } = {}) {
  const errors = [];
  if (!player || typeof player !== "object") {
    errors.push(`${label} details are missing.`);
    return errors;
  }
  if (!required(player.name) || !lengthBetween(player.name, 2, 40)) {
    errors.push(`${label} full name is required and must be 2-40 characters.`);
  }
  if (!required(player.ign) || !lengthBetween(player.ign, 2, 20)) {
    errors.push(`${label} in-game name is required and must be 2-20 characters.`);
  }
  if (!required(player.uid) || !lengthBetween(player.uid, 3, 20)) {
    errors.push(`${label} UID is required and must be 3-20 characters.`);
  }
  if (requireContact) {
    if (!required(player.email) || !isValidEmail(player.email)) {
      errors.push(`${label} email address is required and must be valid.`);
    }
    if (!required(player.phone) || !isValidIndianMobile(player.phone)) {
      errors.push(`${label} mobile number is required and must be a valid 10-digit Indian mobile number.`);
    }
  }
  return errors;
}

/**
 * Finds UIDs (trimmed, case-insensitive) that appear more than once
 * among the given players. Empty/missing UIDs are ignored.
 */
function findDuplicateUids(players) {
  const seen = new Map();
  const duplicates = new Set();
  players
    .filter(Boolean)
    .map((p) => String(p.uid || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach((uid) => {
      seen.set(uid, (seen.get(uid) || 0) + 1);
      if (seen.get(uid) > 1) duplicates.add(uid);
    });
  return duplicates;
}

// Tournament IDs become Firestore document IDs and are embedded in
// other document IDs, so only a strict safe alphabet is accepted.
// (A "/" would otherwise change the document path and crash the
// transaction with an opaque internal error.)
const TOURNAMENT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
function isValidTournamentId(value) {
  return typeof value === "string" && TOURNAMENT_ID_RE.test(value);
}

// Client-generated idempotency key (a random UUID from the browser).
// Not a secret and not an identity — it only lets the server
// recognise a retry / double-click of the SAME submission.
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
function isValidRequestId(value) {
  return typeof value === "string" && REQUEST_ID_RE.test(value);
}

module.exports = {
  isValidTournamentId,
  isValidRequestId,
  required,
  lengthBetween,
  isValidEmail,
  normalizeIndianMobile,
  isValidIndianMobile,
  normalizeTeamName,
  cleanTeamNameDisplay,
  validatePlayer,
  findDuplicateUids
};
