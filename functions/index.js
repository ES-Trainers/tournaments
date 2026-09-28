/**
 * ES TRAINERS — Registration Submission (Phase 2.2)
 * ==============================================================
 * This is the ONLY place a registration is ever created. The public
 * website has no direct write access to `registrations`,
 * `privateRegistrations` or `teamNames` (see firestore.rules) —
 * every write goes through this callable Cloud Function, which runs
 * with the Admin SDK's privileged access inside ONE Firebase project
 * at a time.
 *
 * DEPLOYMENT — READ THIS FIRST
 * --------------------------------------------------------------
 * There are TWO separate Firebase projects (BGMI and FF MAX). This
 * exact same codebase is deployed to BOTH, once per project, using
 * project-specific `.env.<project-id>` files that set GAME to "bgmi"
 * or "ffmax". A deployment only ever accepts registrations for its
 * own GAME. See functions/README.md for the exact commands.
 *
 * WHAT THIS PHASE DOES
 * - Re-validates everything the frontend validated.
 * - Reads the authoritative tournament document; checks it exists,
 *   is registration_open and is not full.
 * - In ONE Firestore transaction: reserves the normalized team name
 *   for that tournament (with an expiry) and creates the registration
 *   + private contact document.
 * - Is idempotent per client `requestId`: a retry / double click of
 *   the same submission returns the same registration instead of
 *   creating another.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * No Razorpay, no payment, no confirmation email, no team number, no
 * registeredTeams increment, no admin actions.
 *
 * ERROR CONTRACT
 * Every expected failure is an HttpsError whose `details.reason` is
 * one of the stable strings in REASON below. The browser maps
 * `details.reason` (not the human message) to what the person sees.
 */

const { onCall } = require("firebase-functions/v2/https");
const { handleSubmit } = require("./lib/submit");

// App Check: NOT active unless the project owner has configured App
// Check for the web app AND sets ENFORCE_APP_CHECK=true in
// .env.<project-id>. Nothing here claims it is on by default.
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";

exports.submitRegistration = onCall(
  { region: "us-central1", enforceAppCheck },
  (request) => handleSubmit(request)
);
