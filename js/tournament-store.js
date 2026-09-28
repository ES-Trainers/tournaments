/**
 * ES TRAINERS — Tournament Store
 * ------------------------------------------------------------
 * ONE realtime listener per Firebase project, shared by every part
 * of the page that needs tournament data (the tournament grid and
 * the Instagram section). This is deliberate: two consumers must
 * never mean two onSnapshot listeners on the same query.
 *
 * The store never fabricates data. It only holds the last snapshot
 * Firestore actually delivered, plus a per-project "ok" flag so the
 * UI can show a subtle connection notice without throwing away the
 * tournament information already on screen.
 */

import { subscribeBgmiTournaments } from "./firebase-bgmi.js";
import { subscribeFfmaxTournaments } from "./firebase-ffmax.js";

const state = {
  bgmi: { loaded: false, ok: true, tournaments: [] },
  ffmax: { loaded: false, ok: true, tournaments: [] }
};

const subscribers = new Set();
const unsubscribers = [];
let started = false;

function snapshot() {
  return {
    bgmi: { ...state.bgmi, tournaments: state.bgmi.tournaments.slice() },
    ffmax: { ...state.ffmax, tournaments: state.ffmax.tournaments.slice() }
  };
}

function emit() {
  const current = snapshot();
  subscribers.forEach((fn) => {
    try {
      fn(current);
    } catch (error) {
      // One broken consumer must never stop the others from updating.
      console.error("[ES Trainers] tournament store subscriber failed:", error);
    }
  });
}

/**
 * Registers a consumer. Called immediately with the current state so
 * a late subscriber doesn't have to wait for the next Firebase push.
 * Returns an unsubscribe function.
 */
export function onTournamentState(fn) {
  subscribers.add(fn);
  fn(snapshot());
  return () => subscribers.delete(fn);
}

/** Starts both realtime listeners. Safe to call more than once. */
export function startTournamentStore() {
  if (started) return;
  started = true;

  unsubscribers.push(
    subscribeBgmiTournaments(
      (tournaments) => {
        state.bgmi = { loaded: true, ok: true, tournaments };
        emit();
      },
      () => {
        // Keep the last good tournaments — only flag the connection.
        state.bgmi = { ...state.bgmi, loaded: true, ok: false };
        emit();
      }
    )
  );

  unsubscribers.push(
    subscribeFfmaxTournaments(
      (tournaments) => {
        state.ffmax = { loaded: true, ok: true, tournaments };
        emit();
      },
      () => {
        state.ffmax = { ...state.ffmax, loaded: true, ok: false };
        emit();
      }
    )
  );
}

/** Detaches both listeners. Not used on the homepage today; here so
 *  future pages that unmount this section can clean up properly. */
export function stopTournamentStore() {
  while (unsubscribers.length) {
    const off = unsubscribers.pop();
    if (typeof off === "function") off();
  }
  started = false;
}

export function isLive(tournament) {
  const liveValue = window.ES_CONFIG?.tournaments?.liveStatusValue || "live";
  return String(tournament?.status || "").toLowerCase() === liveValue;
}
