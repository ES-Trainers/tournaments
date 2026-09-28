/**
 * ES TRAINERS — submitRegistration core logic (Phase 2.2)
 * Kept out of index.js so the deployed entry file exports ONLY the
 * callable, and so tests can drive handleSubmit() directly.
 * See index.js header for the full design notes.
 */

const crypto = require("crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {
  normalizeTeamName,
  cleanTeamNameDisplay,
  validatePlayer,
  findDuplicateUids,
  isValidTournamentId,
  isValidRequestId
} = require("./validate");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Stable reason codes sent in HttpsError.details.reason. The browser
// maps THESE (never the human message) to what the player sees.
const REASON = {
  INVALID_REQUEST: "INVALID_REQUEST",
  TOURNAMENT_NOT_FOUND: "TOURNAMENT_NOT_FOUND",
  TOURNAMENT_CLOSED: "TOURNAMENT_CLOSED",
  TOURNAMENT_FULL: "TOURNAMENT_FULL",
  INVALID_GAME: "INVALID_GAME",
  INVALID_TEAM_NAME: "INVALID_TEAM_NAME",
  DUPLICATE_TEAM_NAME: "DUPLICATE_TEAM_NAME",
  DUPLICATE_PLAYER_UID: "DUPLICATE_PLAYER_UID",
  TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED",
  SERVER_MISCONFIGURED: "SERVER_MISCONFIGURED",
  INTERNAL_ERROR: "INTERNAL_ERROR"
};

const REGISTRATION_OPEN_STATUS = "registration_open";

// How long an unpaid (pending) team-name reservation blocks the name.
// After this, the next submission for that name may take it over
// (see the transaction below). Payment phase will flip a reservation
// to "confirmed" (no expiry) on verified payment. Overridable with
// RESERVATION_TTL_MINUTES in .env.<project-id>.
function reservationTtlMs() {
  const minutes = Number(process.env.RESERVATION_TTL_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
}

// Read at call time so a missing value fails loudly per request.
function getExpectedGame() {
  return process.env.GAME || null;
}

function fail(code, reason, message) {
  return new HttpsError(code, message, { reason });
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Firestore document IDs cannot contain "/" and have other reserved
// forms, so the raw team name is NEVER used as an ID. The reservation
// ID is the tournament + a hash of the normalized name: same
// tournament + same normalized name => same document => uniqueness.
function reservationId(tournamentId, teamNameNormalized) {
  return `${tournamentId}_${sha256(teamNameNormalized)}`;
}

// Deterministic per (tournament, requestId) so a retried request
// resolves to the same registration document.
function registrationIdFor(tournamentId, requestId) {
  return `reg_${sha256(`${tournamentId}:${requestId}`).slice(0, 32)}`;
}

async function handleSubmit(request, { now = () => Date.now() } = {}) {
  const data = request.data || {};
  // Structured, PII-free: never log email, phone, names or UIDs.
  logger.info("submitRegistration: request received", {
    game: typeof data.game === "string" ? data.game.slice(0, 20) : null,
    tournamentId: isValidTournamentId(data.tournamentId) ? data.tournamentId : null
  });

  const expectedGame = getExpectedGame();
  if (!expectedGame) {
    logger.error("submitRegistration: GAME env var missing", { category: REASON.SERVER_MISCONFIGURED });
    throw fail("failed-precondition", REASON.SERVER_MISCONFIGURED, "Registration is temporarily unavailable. Please try again shortly.");
  }
  if (data.game !== expectedGame) {
    logger.warn("submitRegistration: game mismatch", { expectedGame, category: REASON.INVALID_GAME });
    throw fail("invalid-argument", REASON.INVALID_GAME, "This registration endpoint does not serve the requested game.");
  }

  if (!isValidTournamentId(data.tournamentId)) {
    throw fail("not-found", REASON.TOURNAMENT_NOT_FOUND, "This tournament could not be found.");
  }
  const tournamentId = data.tournamentId;

  if (!isValidRequestId(data.requestId)) {
    throw fail("invalid-argument", REASON.INVALID_REQUEST, "The registration request was malformed. Please refresh the page and try again.");
  }

  const teamNameDisplay = cleanTeamNameDisplay(data.teamName);
  if (teamNameDisplay.length < 3 || teamNameDisplay.length > 30) {
    throw fail("invalid-argument", REASON.INVALID_TEAM_NAME, "Team name must be 3-30 characters.");
  }
  const teamNameNormalized = normalizeTeamName(teamNameDisplay);

  const errors = [];
  errors.push(...validatePlayer(data.player1, "Player 1", { requireContact: true }));
  errors.push(...validatePlayer(data.player2, "Player 2"));
  errors.push(...validatePlayer(data.player3, "Player 3"));
  errors.push(...validatePlayer(data.player4, "Player 4"));

  const player5Input = data.player5 && typeof data.player5 === "object" ? data.player5 : {};
  const player5Enabled = player5Input.enabled === true;
  if (player5Enabled) errors.push(...validatePlayer(player5Input, "Emergency Player 5"));

  if (errors.length > 0) {
    logger.info("submitRegistration: rejected", { tournamentId, reason: REASON.INVALID_REQUEST });
    throw fail("invalid-argument", REASON.INVALID_REQUEST, errors[0]);
  }
  // Terms are enforced here regardless of what the browser checked.
  if (data.termsAccepted !== true) {
    logger.info("submitRegistration: rejected", { tournamentId, reason: REASON.TERMS_NOT_ACCEPTED });
    throw fail("failed-precondition", REASON.TERMS_NOT_ACCEPTED, "Please accept the tournament rules to continue.");
  }
  const dup = findDuplicateUids([
    data.player1, data.player2, data.player3, data.player4,
    player5Enabled ? player5Input : null
  ]);
  if (dup.size > 0) {
    logger.info("submitRegistration: rejected", { tournamentId, reason: REASON.DUPLICATE_PLAYER_UID });
    throw fail("invalid-argument", REASON.DUPLICATE_PLAYER_UID, "Each player must have a unique UID.");
  }

  const tournamentRef = db.collection("tournaments").doc(tournamentId);
  const reservationRef = db.collection("teamNames").doc(reservationId(tournamentId, teamNameNormalized));
  const registrationRef = db.collection("registrations").doc(registrationIdFor(tournamentId, data.requestId));
  const privateRef = db.collection("privateRegistrations").doc(registrationRef.id);

  let replayed = false;

  try {
    await db.runTransaction(async (tx) => {
      // ---- ALL reads first (Firestore requirement) ----
      const [tournamentSnap, reservationSnap, registrationSnap] = await Promise.all([
        tx.get(tournamentRef),
        tx.get(reservationRef),
        tx.get(registrationRef)
      ]);

      // Idempotent replay: same requestId already produced this
      // registration -> return it, write nothing.
      if (registrationSnap.exists) {
        replayed = true;
        return;
      }

      if (!tournamentSnap.exists) {
        throw fail("not-found", REASON.TOURNAMENT_NOT_FOUND, "This tournament could not be found.");
      }
      const tournament = tournamentSnap.data() || {};

      // Never trust game/status/maxTeams/registeredTeams/fee from the
      // browser — only this authoritative document read inside the
      // transaction.
      if (tournament.game !== undefined && tournament.game !== expectedGame) {
        throw fail("failed-precondition", REASON.INVALID_GAME, "This tournament does not belong to this game.");
      }
      if (tournament.status !== REGISTRATION_OPEN_STATUS) {
        throw fail("failed-precondition", REASON.TOURNAMENT_CLOSED, "Registration is not currently open for this tournament.");
      }
      const maxTeams = tournament.maxTeams;
      if (!Number.isInteger(maxTeams) || maxTeams <= 0) {
        // A tournament without a valid capacity is a data problem, not
        // an invitation to accept unlimited registrations.
        logger.error("submitRegistration: tournament has invalid maxTeams", { tournamentId, category: REASON.SERVER_MISCONFIGURED });
        throw fail("failed-precondition", REASON.TOURNAMENT_CLOSED, "Registration is not currently open for this tournament.");
      }
      const registeredTeams = typeof tournament.registeredTeams === "number" ? tournament.registeredTeams : 0;
      if (registeredTeams >= maxTeams) {
        throw fail("resource-exhausted", REASON.TOURNAMENT_FULL, "This tournament is already full.");
      }

      // Is the name held by someone else?
      let staleRegistrationRef = null;
      let staleRegistrationSnap = null;
      if (reservationSnap.exists) {
        const held = reservationSnap.data() || {};
        const expiresAtMs = held.expiresAt && typeof held.expiresAt.toMillis === "function" ? held.expiresAt.toMillis() : null;
        const expiredPending = held.status === "pending" && expiresAtMs !== null && expiresAtMs <= now();
        const released = held.status === "released";
        if (!(expiredPending || released)) {
          // "confirmed", or "pending" and still inside its window.
          throw fail("already-exists", REASON.DUPLICATE_TEAM_NAME, "That team name is already registered for this tournament. Please choose another team name.");
        }
        // Reclaimable: the previous holder never paid in time.
        if (held.registrationId) {
          staleRegistrationRef = db.collection("registrations").doc(held.registrationId);
          staleRegistrationSnap = await tx.get(staleRegistrationRef);
        }
      }

      logger.info("submitRegistration: tournament validated", { tournamentId, game: expectedGame });

      // ---- writes ----
      if (staleRegistrationSnap && staleRegistrationSnap.exists) {
        const stale = staleRegistrationSnap.data() || {};
        // Only ever release something that is still unpaid.
        if (stale.paymentStatus === "pending" && stale.status === "pending") {
          tx.update(staleRegistrationRef, { status: "expired" });
        }
      }

      logger.info("submitRegistration: reserving team name", { tournamentId, reclaimed: reservationSnap.exists });
      const serverNow = admin.firestore.FieldValue.serverTimestamp();
      tx.set(reservationRef, {
        tournamentId,
        game: expectedGame,
        teamName: teamNameDisplay,
        normalizedTeamName: teamNameNormalized,
        registrationId: registrationRef.id,
        status: "pending",
        reservedAt: serverNow,
        expiresAt: admin.firestore.Timestamp.fromMillis(now() + reservationTtlMs())
      });

      tx.set(registrationRef, {
        tournamentId,
        game: expectedGame,
        teamName: teamNameDisplay,
        teamNameNormalized,
        player1: { name: data.player1.name.trim(), ign: data.player1.ign.trim(), uid: data.player1.uid.trim() },
        player2: { name: data.player2.name.trim(), ign: data.player2.ign.trim(), uid: data.player2.uid.trim() },
        player3: { name: data.player3.name.trim(), ign: data.player3.ign.trim(), uid: data.player3.uid.trim() },
        player4: { name: data.player4.name.trim(), ign: data.player4.ign.trim(), uid: data.player4.uid.trim() },
        player5: player5Enabled
          ? { enabled: true, name: player5Input.name.trim(), ign: player5Input.ign.trim(), uid: player5Input.uid.trim() }
          : { enabled: false, name: "", ign: "", uid: "" },
        termsAccepted: true,
        teamNumber: null,
        status: "pending",
        paymentStatus: "pending",
        registeredAt: serverNow
      });

      // Private contact info — separate document, same ID.
      tx.set(privateRef, {
        registrationId: registrationRef.id,
        tournamentId,
        player1Email: String(data.player1.email).trim().toLowerCase(),
        player1Phone: String(data.player1.phone).trim()
      });
    });
  } catch (error) {
    if (error instanceof HttpsError) {
      logger.info("submitRegistration: rejected", { tournamentId, game: expectedGame, reason: error.details && error.details.reason });
      throw error;
    }
    logger.error("submitRegistration: unexpected failure", {
      tournamentId, game: expectedGame, category: REASON.INTERNAL_ERROR, errorName: error && error.name, errorCode: error && error.code
    });
    throw fail("internal", REASON.INTERNAL_ERROR, "Registration could not be completed. Please try again.");
  }

  logger.info("submitRegistration: registration created (pending)", { tournamentId, game: expectedGame, registrationId: registrationRef.id, replayed });
  return { success: true, registrationId: registrationRef.id, status: "pending", replayed };
}

module.exports = { handleSubmit, REASON };
