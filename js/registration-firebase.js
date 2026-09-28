/**
 * ES TRAINERS — Registration Page: Tournament Lookup
 * ------------------------------------------------------------
 * READ-ONLY. Fetches exactly one tournament document, once, so the
 * Tournament Summary card on the registration page never shows
 * hardcoded or invented data.
 *
 * This is intentionally a separate module from firebase-bgmi.js /
 * firebase-ffmax.js: those files own the homepage's realtime
 * listeners and are left completely untouched. This file opens its
 * own named Firebase app instances ("bgmi-lookup" / "ffmax-lookup"),
 * using the same public Web config values as the homepage (Firebase
 * client config is not a secret), and performs a single getDoc() —
 * no onSnapshot, no polling, no writes.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Same public Web config as js/firebase-bgmi.js / js/firebase-ffmax.js.
// Exported so js/registration-submit.js (Phase 2.2) can open its own
// named app instances for calling Cloud Functions, without a third
// copy of these values.
export const FIREBASE_CONFIGS = {
  bgmi: {
    apiKey: "AIzaSyBug5r0hXPRCK8x6O6TasSlFFtx378_6iw",
    authDomain: "bgmi-firebase.firebaseapp.com",
    projectId: "bgmi-firebase",
    storageBucket: "bgmi-firebase.firebasestorage.app",
    messagingSenderId: "144306362464",
    appId: "1:144306362464:web:3a91a4e8381f2eb7af4b05",
    measurementId: "G-37YDZGRFXR"
  },
  ffmax: {
    apiKey: "AIzaSyC0S6rtGY7QRf6AaMKaeZKZZmDTtgfgUPI",
    authDomain: "ff-max-firebase.firebaseapp.com",
    projectId: "ff-max-firebase",
    storageBucket: "ff-max-firebase.firebasestorage.app",
    messagingSenderId: "700617250226",
    appId: "1:700617250226:web:565816627d31c5612700ab",
    measurementId: "G-MWQVHS5HZR"
  }
};

const dbCache = {};

function getDb(game) {
  if (dbCache[game]) return dbCache[game];
  const app = initializeApp(FIREBASE_CONFIGS[game], `${game}-lookup`);
  dbCache[game] = getFirestore(app);
  return dbCache[game];
}

/**
 * Fetch one tournament document.
 * @param {"bgmi"|"ffmax"} game
 * @param {string} tournamentId
 * @returns {Promise<object|null>} the raw Firestore fields (+id, +game), or null if not found.
 */
export async function fetchTournament(game, tournamentId) {
  if (!FIREBASE_CONFIGS[game] || !tournamentId) return null;
  const collectionName = window.ES_CONFIG?.tournaments?.collectionName || "tournaments";
  const db = getDb(game);
  const snap = await getDoc(doc(db, collectionName, tournamentId));
  if (!snap.exists()) return null;
  return { id: snap.id, game, ...snap.data() };
}
