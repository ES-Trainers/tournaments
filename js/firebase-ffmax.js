/**
 * ES TRAINERS — FF MAX Firebase Project
 * ------------------------------------------------------------
 * Completely separate from the BGMI project (see firebase-bgmi.js).
 * Same shape, deliberately, so both games are easy to reason about
 * side by side — but the two never share an app instance or data.
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
const ffmaxFirebaseConfig = {
  apiKey: "AIzaSyC0S6rtGY7QRf6AaMKaeZKZZmDTtgfgUPI",
  authDomain: "ff-max-firebase.firebaseapp.com",
  projectId: "ff-max-firebase",
  storageBucket: "ff-max-firebase.firebasestorage.app",
  messagingSenderId: "700617250226",
  appId: "1:700617250226:web:565816627d31c5612700ab",
  measurementId: "G-MWQVHS5HZR"
};

let ffmaxApp = null;
let ffmaxDb = null;
let unsubscribe = null; // single realtime listener guard

function getFfmaxDb() {
  if (ffmaxDb) return ffmaxDb;
  ffmaxApp = initializeApp(ffmaxFirebaseConfig, "ffmax");
  ffmaxDb = getFirestore(ffmaxApp);
  return ffmaxDb;
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
export function subscribeFfmaxTournaments(onData, onError) {
  if (unsubscribe) return unsubscribe;

  try {
    const db = getFfmaxDb();
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
          tournaments.push({ id: doc.id, game: "ffmax", ...doc.data() });
        });
        onData(tournaments);
      },
      (error) => {
        console.error("[ES Trainers] FF MAX realtime listener error:", error);
        if (typeof onError === "function") onError(error);
      }
    );
  } catch (error) {
    console.error("[ES Trainers] FF MAX realtime listener failed to start:", error);
    if (typeof onError === "function") onError(error);
    unsubscribe = () => {};
  }

  return unsubscribe;
}
