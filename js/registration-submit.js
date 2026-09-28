/**
 * ES TRAINERS — Registration Page: Submit to Firebase (Phase 2.2)
 * ------------------------------------------------------------
 * The browser NEVER writes to Firestore directly for registrations.
 * Team-name uniqueness, tournament status/capacity checks and the
 * actual writes (registrations, privateRegistrations, teamNames) all
 * happen inside a trusted backend — a Firebase Cloud Function running
 * the Admin SDK in the correct game's Firebase project. See
 * functions/index.js for that logic and firestore.rules for
 * why direct client writes to those collections stay locked down.
 *
 * This file only opens a callable-functions client and invokes it.
 * Same pattern as registration-firebase.js: its own named Firebase app
 * instance per game ("bgmi-submit" / "ffmax-submit"), reusing the
 * same public Web config (not a secret).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import { FIREBASE_CONFIGS } from "/js/registration-firebase.js";

const REGION = window.ES_CONFIG?.registration?.functionsRegion || "us-central1";
const CALLABLE_NAME = window.ES_CONFIG?.registration?.submitCallableName || "submitRegistration";

const appCache = {};

function getSubmitApp(game) {
  if (appCache[game]) return appCache[game];
  const config = FIREBASE_CONFIGS[game];
  if (!config) throw new Error(`Unknown game: ${game}`);
  appCache[game] = initializeApp(config, `${game}-submit`);
  return appCache[game];
}

/**
 * Submit a registration for authoritative, atomic creation on the
 * backend. Never resolves with a "success" that didn't actually
 * happen, and never invents a payment/team-number outcome — Phase 2.2
 * only ever returns a pending registration.
 *
 * @param {"bgmi"|"ffmax"} game
 * @param {object} registration - shape built by collectRegistration()
 *   in registration.js (tournamentId, teamName, player1..5, termsAccepted)
 * @returns {Promise<{success:true, registrationId:string, status:"pending"}>}
 * @throws {import("firebase/functions").FunctionsError} with a `.code`
 *   such as "already-exists" (team name taken), "failed-precondition"
 *   (registration closed), "resource-exhausted" (tournament full),
 *   "not-found" (bad tournamentId), "invalid-argument" (validation
 *   failed on the backend), or "internal" (unexpected failure).
 */
export async function submitRegistration(game, registration) {
  const app = getSubmitApp(game);
  const functions = getFunctions(app, REGION);
  const callable = httpsCallable(functions, CALLABLE_NAME);
  try {
    const response = await callable(registration);
    return response.data;
  } catch (error) {
    throw toRegistrationError(game, app, error);
  }
}

/**
 * A backend failure normalised to a stable `reason` the UI can map to
 * a message. `reason` is either one the Cloud Function sent in
 * `details.reason` (DUPLICATE_TEAM_NAME, TOURNAMENT_CLOSED,
 * TOURNAMENT_FULL, TOURNAMENT_NOT_FOUND, INVALID_REQUEST, ...) or, when
 * the function never answered, SERVICE_UNREACHABLE.
 */
export class RegistrationError extends Error {
  constructor(reason, message, cause) {
    super(message);
    this.name = "RegistrationError";
    this.reason = reason;
    this.cause = cause;
  }
}

function toRegistrationError(game, app, error) {
  const reason = error?.details?.reason;
  if (typeof reason === "string" && reason) {
    return new RegistrationError(reason, error.message, error);
  }
  // No structured reason => the request never reached our function
  // logic. Typical cause: the callable is not deployed in this
  // project/region (browser sees a 404/CORS failure surfaced as
  // functions/internal, functions/not-found or functions/unavailable).
  // Log the specifics for whoever is debugging; never show them to
  // the player.
  console.error(
    `[ES Trainers] Callable "${CALLABLE_NAME}" did not respond as expected. ` +
      `game=${game} project=${app.options.projectId} region=${REGION} code=${error?.code} ` +
      `— check that the function is deployed to THIS project in THIS region ` +
      `(firebase functions:list) and see functions/README.md.`,
    error
  );
  return new RegistrationError("SERVICE_UNREACHABLE", error?.message || "Callable did not respond.", error);
}
