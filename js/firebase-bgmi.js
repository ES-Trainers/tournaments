/**
 * ES TRAINERS — BGMI Firebase Project
 * ------------------------------------------------------------
 * Completely separate from the FF MAX project (see firebase-ffmax.js).
 * BGMI data never touches the FF MAX Firebase project and vice versa.
 *
 * This file only reads public tournament data. It never writes,
 * and it never imports Firebase Admin — that capability does not
 * exist client-side. Registrations, payments and admin actions will
 * be added in later files, behind Firebase Auth + Security Rules.
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

// Provided by project owner. Do not invent or modify.
const bgmiFirebaseConfig = {
  apiKey: "AIzaSyBug5r0hXPRCK8x6O6TasSlFFtx378_6iw",
  authDomain: "bgmi-firebase.firebaseapp.com",
  projectId: "bgmi-firebase",
  storageBucket: "bgmi-firebase.firebasestorage.app",
  messagingSenderId: "144306362464",
  appId: "1:144306362464:web:3a91a4e8381f2eb7af4b05",
  measurementId: "G-37YDZGRFXR"
};

let bgmiApp = null;
let bgmiDb = null;
let unsubscribe = null; // single realtime listener guard

function getBgmiDb() {
  if (bgmiDb) return bgmiDb;
  bgmiApp = initializeApp(bgmiFirebaseConfig, "bgmi");
  bgmiDb = getFirestore(bgmiApp);
  return bgmiDb;
}

/**
 * Realtime subscription to this project's tournaments.
 * ------------------------------------------------------------
 * Uses onSnapshot() — NOT polling, NOT repeated getDocs(). Firestore
 * pushes a fresh snapshot whenever any listened-to field changes
 * (status, match, date, entryFee, prizePool, maxTeams,
 * registeredTeams, title), so the page never needs a refresh.
 *
 * Attaches exactly once per page load: the module-level `unsubscribe`
 * guard means calling this twice can never create a duplicate
 * listener. The returned function detaches it.
 *
 * Listener errors are reported to onError and NOT retried in a loop —
 * the UI keeps the last good data instead of flashing (see spec 17).
 */
export function subscribeBgmiTournaments(onData, onError) {
  if (unsubscribe) return unsubscribe;

  try {
    const db = getBgmiDb();
    const cfg = window.ES_CONFIG.tournaments;

    const q = query(
      collection(db, cfg.collectionName),
      where("status", "in", cfg.listenStatusValues),
      orderBy("date", "asc"),
      limit(cfg.listenLimit)
    );

    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const tournaments = [];
        snapshot.forEach((doc) => {
          tournaments.push({ id: doc.id, game: "bgmi", ...doc.data() });
        });
        onData(tournaments);
      },
      (error) => {
        console.error("[ES Trainers] BGMI realtime listener error:", error);
        if (typeof onError === "function") onError(error);
      }
    );
  } catch (error) {
    console.error("[ES Trainers] BGMI realtime listener failed to start:", error);
    if (typeof onError === "function") onError(error);
    unsubscribe = () => {};
  }

  return unsubscribe;
}
