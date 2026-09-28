/**
 * ES TRAINERS — Registration Form Validation
 * ------------------------------------------------------------
 * Pure functions only — no DOM access here. js/registration.js wires
 * these to fields and renders inline errors. This is client-side
 * convenience validation, not a security boundary; nothing here is
 * ever trusted for anything written to Firebase later.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Indian mobile numbers: 10 digits, starting 6-9. Accepts an optional
// leading +91 / 91 / 0 which is stripped before the check.
const MOBILE_RE = /^[6-9]\d{9}$/;

export function required(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function lengthBetween(value, min, max) {
  const len = (value || "").trim().length;
  return len >= min && len <= max;
}

export function isValidEmail(value) {
  return EMAIL_RE.test((value || "").trim());
}

export function normalizeIndianMobile(value) {
  return (value || "").replace(/[\s-]/g, "").replace(/^(\+?91|0)/, "");
}

export function isValidIndianMobile(value) {
  return MOBILE_RE.test(normalizeIndianMobile(value));
}

/**
 * Returns the list of UIDs (trimmed, case-insensitive) that appear
 * more than once among the given players. Empty/disabled UIDs are
 * ignored — this only flags real duplicates.
 */
export function findDuplicateUids(uids) {
  const seen = new Map();
  const duplicates = new Set();
  uids
    .map((u) => (u || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach((u) => {
      seen.set(u, (seen.get(u) || 0) + 1);
      if (seen.get(u) > 1) duplicates.add(u);
    });
  return duplicates;
}

export const RULES = {
  teamName: (v) => (!required(v) ? "Team name is required." :
    !lengthBetween(v, 3, 30) ? "Team name must be 3–30 characters." : null),
  fullName: (v) => (!required(v) ? "Full name is required." :
    !lengthBetween(v, 2, 40) ? "Enter a valid full name." : null),
  ign: (v) => (!required(v) ? "In-game name is required." :
    !lengthBetween(v, 2, 20) ? "In-game name must be 2–20 characters." : null),
  uid: (v) => (!required(v) ? "Player UID is required." :
    !lengthBetween(v, 3, 20) ? "Enter a valid game UID." : null),
  email: (v) => (!required(v) ? "Email address is required." :
    !isValidEmail(v) ? "Please enter a valid email address." : null),
  mobile: (v) => (!required(v) ? "Mobile number is required." :
    !isValidIndianMobile(v) ? "Enter a valid 10-digit Indian mobile number." : null)
};
