/**
 * ES TRAINERS — Registration Page Controller (Phase 2.2)
 * ------------------------------------------------------------
 * One reusable script for both /bgmi/register.html and
 * /ff-max/register.html. Reuses the site's existing nav/scroll-
 * reveal behavior (js/ui.js, js/animations.js) instead of
 * duplicating it.
 *
 * PHASE 2.2 SCOPE:
 * - Reads the tournament summary from Firebase (read-only,
 *   js/registration-firebase.js).
 * - Full client-side validation with inline errors (convenience only
 *   — see js/registration-validation.js; the backend re-validates
 *   everything and is the actual security boundary).
 * - On submit, calls the trusted backend (js/registration-submit.js
 *   -> Cloud Function) to create a "pending" registration. Does NOT
 *   call Razorpay, does NOT process payment, does NOT send email, and
 *   never claims payment succeeded — the result modal always reflects
 *   what the backend actually did (registration saved & pending, or a
 *   real error), never an invented outcome.
 */

import { initRoutes, initNavbar, initMobileMenu, initWhatsappCta } from "/js/ui.js";
import { initScrollReveal } from "/js/animations.js";
import { fetchTournament } from "/js/registration-firebase.js";
import { submitRegistration, RegistrationError } from "/js/registration-submit.js";
import { RULES, findDuplicateUids } from "/js/registration-validation.js";

const GAME_LABEL = { bgmi: "BGMI", ffmax: "FF MAX" };

/* ---------------------------------------------------------
   Game + tournament detection
   --------------------------------------------------------- */
function detectGame() {
  const fromBody = document.body.dataset.game;
  if (fromBody === "bgmi" || fromBody === "ffmax") return fromBody;
  // Fallback: infer from the URL path, per spec ("read from the
  // URL/path"), so this still works if the data attribute is ever
  // missing.
  return location.pathname.includes("/ff-max/") ? "ffmax" : "bgmi";
}

function getTournamentId() {
  return new URLSearchParams(location.search).get("id");
}

/* ---------------------------------------------------------
   Tournament summary card
   --------------------------------------------------------- */
function formatDate(value) {
  try {
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return typeof value === "string" && value.trim() ? value : null;
    }
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

function setText(field, value) {
  document.querySelectorAll(`[data-field="${field}"]`).forEach((node) => {
    node.textContent = value == null || value === "" ? "—" : String(value);
  });
}

function setRowHidden(key, hidden) {
  document.querySelectorAll(`[data-row="${key}"]`).forEach((row) => { row.hidden = hidden; });
}

/**
 * The fee shown to the player. Comes ONLY from the tournament
 * document's `entryFee` field (never `match`/`format`, never a
 * hardcoded amount). Strings are shown as stored ("₹200 / team");
 * a bare number is shown with the rupee sign. Anything else counts
 * as missing.
 */
function formatFee(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return `₹${value}`;
  return null;
}

/* ---------------------------------------------------------
   ONE source of truth. Every visible value (both summaries, the
   submit payload, the button state) is derived from this object.
   Nothing reads a value back out of the DOM except collectInputs().
   --------------------------------------------------------- */
const registrationState = {
  tournamentId: null,
  game: null,
  load: "loading",        // "loading" | "ready" | "error"
  loadError: null,        // { title, text, canRetry }
  tournament: null,
  fee: null,
  teamName: "",
  emergencyPlayerEnabled: false,
  playerCount: 4,
  termsAccepted: false,
  submitting: false,
  done: false
};

function isSubmittable() {
  const s = registrationState;
  return s.load === "ready" && Boolean(s.fee) && !s.submitting && !s.done;
}

/** Re-reads the form inputs into state (the only DOM -> state path). */
function syncStateFromInputs() {
  const s = registrationState;
  s.teamName = (document.getElementById("teamName")?.value || "").trim().replace(/\s+/g, " ");
  s.emergencyPlayerEnabled = Boolean(document.getElementById("p5Enabled")?.checked);
  s.playerCount = s.emergencyPlayerEnabled ? 5 : 4;
  s.termsAccepted = Boolean(document.getElementById("termsAccepted")?.checked);
}

/** state -> DOM. Updates EVERY summary instance (desktop + mobile). */
function render() {
  const s = registrationState;
  const label = GAME_LABEL[s.game] || "";

  document.querySelectorAll("[data-team-echo]").forEach((el) => { el.textContent = s.teamName || "—"; });
  document.querySelectorAll("[data-players-echo]").forEach((el) => {
    el.textContent = s.emergencyPlayerEnabled ? "4 + 1 Emergency" : "4";
  });
  document.querySelectorAll("[data-summary-game]").forEach((el) => { el.textContent = label; });
  document.querySelectorAll("[data-fee-echo]").forEach((el) => {
    el.textContent =
      s.load === "loading" ? "Loading…" :
      s.load === "error" ? "Not available — tournament not loaded" :
      s.fee || "Not available — fee missing";
  });

  // Error banner (replaces the "everything is fine" impression).
  const banner = document.querySelector("[data-load-error]");
  if (banner) {
    banner.hidden = s.load !== "error";
    if (s.load === "error" && s.loadError) {
      banner.querySelector("[data-load-error-title]").textContent = s.loadError.title;
      banner.querySelector("[data-load-error-text]").textContent = s.loadError.text;
      const retry = banner.querySelector("[data-load-retry]");
      if (retry) retry.hidden = !s.loadError.canRetry;
    }
  }

  renderButtons();
}

function renderButtons() {
  const s = registrationState;
  const form = document.getElementById("registration-form");
  const text = s.done ? "Registration Submitted" : s.submitting ? "Submitting…" : "Continue to Payment";
  form?.querySelectorAll(".reg-cta").forEach((btn) => {
    const disabled = !isSubmittable();
    btn.disabled = disabled;
    btn.setAttribute("aria-disabled", disabled ? "true" : "false");
    btn.textContent = text;
  });
}

function setLoadError(title, text, canRetry) {
  registrationState.load = "error";
  registrationState.loadError = { title, text, canRetry };
  registrationState.tournament = null;
  registrationState.fee = null;
  const titleNode = document.querySelector('[data-field="title"]');
  if (titleNode && /loading/i.test(titleNode.textContent)) setText("title", `${GAME_LABEL[registrationState.game]} Tournament`);
  render();
}

async function loadTournamentSummary() {
  const s = registrationState;
  const game = s.game;
  const id = s.tournamentId;
  const noteEl = document.querySelector("[data-summary-note]");
  const statusEls = document.querySelectorAll("[data-field='status']");
  const hideStatus = () => statusEls.forEach((el) => { el.hidden = true; });

  s.load = "loading";
  s.loadError = null;
  render();

  if (!id) {
    console.error("[ES Trainers] Registration page opened without ?id=<tournamentId>.");
    hideStatus();
    setLoadError("Tournament information is missing.", "This registration link does not include a tournament. Please open registration from a tournament on the tournaments page.", false);
    return null;
  }

  let t;
  try {
    t = await fetchTournament(game, id);
  } catch (error) {
    console.error("[ES Trainers] Failed to load tournament:", error?.code || error?.name, error?.message);
    hideStatus();
    setLoadError("Unable to load tournament information.", "We couldn't load this tournament right now. Check your connection and try again.", true);
    return null;
  }

  if (!t) {
    console.error(`[ES Trainers] No ${game} tournament document with id "${id}".`);
    hideStatus();
    setLoadError("This tournament could not be found.", "Double-check the registration link, or go back and pick a tournament.", false);
    return null;
  }

  setText("title", t.title || "Untitled Tournament");
  setText("date", formatDate(t.date));
  setText("match", t.match || null);
  const fee = formatFee(t.entryFee);
  setText("entry", fee);
  setText("prize", t.prizePool || null);
  setText("slots", typeof t.registeredTeams === "number" && typeof t.maxTeams === "number"
    ? `${t.registeredTeams} / ${t.maxTeams} teams registered` : null);
  ["date", "match", "entry", "prize", "slots"].forEach((key) => {
    const node = document.querySelector(`[data-field="${key}"]`);
    setRowHidden(key, !node || !node.textContent || node.textContent === "—");
  });

  const openStatus = window.ES_CONFIG?.registrationOpenStatus || "registration_open";
  const isOpen = t.status === openStatus;
  statusEls.forEach((el) => {
    if (!t.status) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = isOpen ? "Registration Open" : String(t.status).replace(/_/g, " ");
    el.classList.toggle("reg-summary__status--open", isOpen);
    el.classList.toggle("reg-summary__status--closed", !isOpen);
  });
  if (noteEl) noteEl.hidden = true;

  if (!isOpen) {
    setLoadError("Registration is currently closed.", "Registration for this tournament is not open right now.", false);
    return t;
  }
  if (!fee) {
    console.error(`[ES Trainers] Tournament "${id}" has no usable entryFee (got ${JSON.stringify(t.entryFee)}). Fix the tournament document.`);
    setLoadError("Unable to load tournament information.", "The registration fee for this tournament is not set yet, so registration can't continue.", true);
    return t;
  }

  s.tournament = t;
  s.fee = fee;
  s.load = "ready";
  render();
  return t;
}

/* ---------------------------------------------------------
   Field validation wiring
   --------------------------------------------------------- */
function fieldWrapper(input) {
  return input.closest(".reg-field");
}

function showFieldError(input, message) {
  const wrap = fieldWrapper(input);
  if (!wrap) return;
  wrap.classList.toggle("reg-field--invalid", Boolean(message));
  const errorEl = wrap.querySelector(".reg-field__error span");
  if (errorEl) errorEl.textContent = message || "";
  input.setAttribute("aria-invalid", message ? "true" : "false");
}

function validateField(input, rule) {
  if (!input) return true;
  const message = rule(input.value);
  showFieldError(input, message);
  return !message;
}

function bindField(id, ruleKey) {
  const input = document.getElementById(id);
  if (!input) return null;
  const rule = RULES[ruleKey];
  input.addEventListener("blur", () => validateField(input, rule));
  input.addEventListener("input", () => {
    if (fieldWrapper(input)?.classList.contains("reg-field--invalid")) validateField(input, rule);
    updateLiveSummary();
    checkDuplicateUids();
  });
  return { input, rule };
}

/* ---------------------------------------------------------
   Player 5 (optional) toggle
   --------------------------------------------------------- */
function initPlayer5Toggle() {
  const toggle = document.getElementById("p5Enabled");
  const fieldsWrap = document.getElementById("player5-fields");
  if (!toggle || !fieldsWrap) return;

  const inputs = fieldsWrap.querySelectorAll("input");

  const apply = () => {
    const on = toggle.checked;
    fieldsWrap.classList.toggle("is-open", on);
    inputs.forEach((input) => {
      input.disabled = !on;
      input.required = on;
      if (!on) showFieldError(input, null);
    });
    updateLiveSummary();
    checkDuplicateUids();
  };

  toggle.addEventListener("change", apply);
  apply();
}

/* ---------------------------------------------------------
   Duplicate UID detection (frontend convenience only)
   --------------------------------------------------------- */
function checkDuplicateUids() {
  const uidInputs = ["p1Uid", "p2Uid", "p3Uid", "p4Uid", "p5Uid"]
    .map((id) => document.getElementById(id))
    .filter((el) => el && !el.disabled);

  const duplicates = findDuplicateUids(uidInputs.map((el) => el.value));
  const warning = document.getElementById("duplicate-uid-warning");

  uidInputs.forEach((input) => {
    const isDup = duplicates.has((input.value || "").trim().toLowerCase());
    if (isDup) {
      showFieldError(input, "Each player must have a unique UID.");
    }
  });

  if (warning) warning.classList.toggle("is-visible", duplicates.size > 0);
  return duplicates.size === 0;
}

/* ---------------------------------------------------------
   Live Registration Summary (right-hand card)
   --------------------------------------------------------- */
function updateLiveSummary() {
  syncStateFromInputs();
  render();
}

/* ---------------------------------------------------------
   Progress indicator (Team Details → Players → Confirmation)
   --------------------------------------------------------- */
function initProgress() {
  const steps = {
    team: document.querySelector('[data-progress="team"]'),
    players: document.querySelector('[data-progress="players"]'),
    confirm: document.querySelector('[data-progress="confirm"]')
  };
  const sections = {
    team: document.getElementById("section-team"),
    players: document.getElementById("section-players"),
    confirm: document.getElementById("section-confirm")
  };
  if (!window.IntersectionObserver) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const key = Object.keys(sections).find((k) => sections[k] === entry.target);
        if (!key) return;
        Object.entries(steps).forEach(([k, el]) => {
          if (!el) return;
          el.classList.toggle("is-active", k === key);
        });
      });
    },
    { rootMargin: "-40% 0px -50% 0px" }
  );
  Object.values(sections).forEach((el) => el && observer.observe(el));
}

/* ---------------------------------------------------------
   Submit: validate everything, then show the dev-phase notice
   --------------------------------------------------------- */
/** Terms error is driven by ONE class (.is-visible) — no inline styles, no [hidden]. */
function setTermsError(visible) {
  const termsInput = document.getElementById("termsAccepted");
  document.getElementById("terms-error")?.classList.toggle("is-visible", visible);
  termsInput?.closest(".reg-checkbox-row")?.classList.toggle("reg-field--invalid", visible);
  termsInput?.setAttribute("aria-invalid", visible ? "true" : "false");
}

// One id per page load. Retries/double-clicks of the same submission
// carry the same id, so the backend can return the same registration
// instead of creating another. Not a secret, not an identity.
let requestId = null;
function getRequestId() {
  if (!requestId) {
    requestId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : Array.from(window.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return requestId;
}

function collectRegistration(game, tournamentId) {
  const val = (id) => document.getElementById(id)?.value.trim() || "";
  const p5On = document.getElementById("p5Enabled")?.checked || false;

  return {
    requestId: getRequestId(),
    tournamentId,
    game,
    teamName: val("teamName"),
    player1: { name: val("p1Name"), ign: val("p1Ign"), uid: val("p1Uid"), email: val("p1Email"), phone: val("p1Phone") },
    player2: { name: val("p2Name"), ign: val("p2Ign"), uid: val("p2Uid") },
    player3: { name: val("p3Name"), ign: val("p3Ign"), uid: val("p3Uid") },
    player4: { name: val("p4Name"), ign: val("p4Ign"), uid: val("p4Uid") },
    player5: { enabled: p5On, name: p5On ? val("p5Name") : "", ign: p5On ? val("p5Ign") : "", uid: p5On ? val("p5Uid") : "" },
    termsAccepted: document.getElementById("termsAccepted")?.checked || false
  };
}

/**
 * The result modal is reused for both outcomes: it renders whatever
 * the backend actually reported. It never opens with an invented
 * "success" before a Cloud Function call has resolved.
 */
function showResultModal({ kind, title, message }) {
  const overlay = document.getElementById("reg-modal-overlay");
  if (!overlay) return;
  const modal = overlay.querySelector(".reg-modal");
  modal?.classList.toggle("reg-modal--error", kind === "error");
  const successIcon = overlay.querySelector('[data-icon="success"]');
  const errorIcon = overlay.querySelector('[data-icon="error"]');
  if (successIcon) successIcon.hidden = kind !== "success";
  if (errorIcon) errorIcon.hidden = kind !== "error";
  const titleEl = document.getElementById("reg-modal-title");
  const messageEl = document.getElementById("reg-modal-message");
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;
  overlay.classList.add("is-open");
  modal?.focus();
}

function closeResultModal() {
  document.getElementById("reg-modal-overlay")?.classList.remove("is-open");
}

function initModal() {
  const overlay = document.getElementById("reg-modal-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeResultModal(); });
  document.getElementById("reg-modal-close")?.addEventListener("click", closeResultModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeResultModal(); });
}

/**
 * Backend failure -> user-safe sentence. The backend sends a stable
 * `reason` (see RegistrationError in registration-submit.js); nothing
 * here guesses from Firebase codes. SERVICE_UNREACHABLE is used ONLY
 * when the callable genuinely never answered.
 */
const ERROR_MESSAGES = {
  TOURNAMENT_NOT_FOUND: "This tournament could not be found.",
  TOURNAMENT_CLOSED: "Registration for this tournament is currently closed.",
  TOURNAMENT_FULL: "This tournament has reached its registration limit.",
  INVALID_GAME: "This registration link does not match this game. Please use the link from the official tournament page.",
  INVALID_TEAM_NAME: "Team name must be 3–30 characters.",
  DUPLICATE_TEAM_NAME: "That team name is already registered for this tournament. Please choose another team name.",
  DUPLICATE_PLAYER_UID: "Each player must have a unique UID.",
  TERMS_NOT_ACCEPTED: "Please accept the tournament rules to continue.",
  SERVER_MISCONFIGURED: "Registration is temporarily unavailable. Please try again shortly.",
  INTERNAL_ERROR: "Something went wrong on our side. Please try again in a moment.",
  SERVICE_UNREACHABLE: "We couldn't reach the registration service. Please check your connection and try again in a moment."
};

function handleSubmitError(error) {
  console.error("[ES Trainers] Registration submission failed:", error instanceof RegistrationError ? error.reason : error?.code || error?.name);
  registrationState.submitting = false;
  render();

  const reason = error instanceof RegistrationError ? error.reason : "";

  if (reason === "DUPLICATE_TEAM_NAME" || reason === "INVALID_TEAM_NAME") {
    const teamNameInput = document.getElementById("teamName");
    if (teamNameInput) {
      showFieldError(teamNameInput, ERROR_MESSAGES[reason]);
      teamNameInput.scrollIntoView({ behavior: "smooth", block: "center" });
      teamNameInput.focus();
      return;
    }
  }
  if (reason === "TERMS_NOT_ACCEPTED") setTermsError(true);

  // INVALID_REQUEST carries a specific, user-safe sentence from the server.
  const message =
    reason === "INVALID_REQUEST" && error.message
      ? error.message
      : ERROR_MESSAGES[reason] || "Registration could not be completed. Please try again.";

  showResultModal({ kind: "error", title: "Registration Could Not Be Completed", message });
}

function initForm() {
  const { game, tournamentId } = registrationState;
  const FIELD_RULES = [
    ["teamName", "teamName"],
    ["p1Name", "fullName"], ["p1Ign", "ign"], ["p1Uid", "uid"], ["p1Email", "email"], ["p1Phone", "mobile"],
    ["p2Name", "fullName"], ["p2Ign", "ign"], ["p2Uid", "uid"],
    ["p3Name", "fullName"], ["p3Ign", "ign"], ["p3Uid", "uid"],
    ["p4Name", "fullName"], ["p4Ign", "ign"], ["p4Uid", "uid"],
    ["p5Name", "fullName"], ["p5Ign", "ign"], ["p5Uid", "uid"]
  ];
  FIELD_RULES.forEach(([id, ruleKey]) => bindField(id, ruleKey));

  const form = document.getElementById("registration-form");
  const termsInput = document.getElementById("termsAccepted");
  // Ticking clears the error immediately. Un-ticking does NOT show it
  // again by itself — it reappears only when submit validation runs.
  termsInput?.addEventListener("change", () => {
    if (termsInput.checked) setTermsError(false);
    updateLiveSummary();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    // Double-click / Enter-key guard (backend is idempotent too), and
    // never submit without valid, open tournament data.
    if (registrationState.submitting || !isSubmittable()) return;

    const p5On = document.getElementById("p5Enabled")?.checked;
    const activeRules = FIELD_RULES.filter(([id]) => !id.startsWith("p5") || p5On);

    let firstInvalid = null;
    let allValid = true;
    activeRules.forEach(([id, ruleKey]) => {
      const input = document.getElementById(id);
      const ok = validateField(input, RULES[ruleKey]);
      if (!ok) {
        allValid = false;
        firstInvalid = firstInvalid || input;
      }
    });

    const uidsOk = checkDuplicateUids();
    if (!uidsOk) {
      allValid = false;
      firstInvalid = firstInvalid || document.getElementById("p1Uid");
    }

    if (termsInput && !termsInput.checked) {
      allValid = false;
      setTermsError(true);
      firstInvalid = firstInvalid || termsInput;
    } else {
      setTermsError(false);
    }

    if (!allValid) {
      firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalid?.focus();
      return;
    }

    syncStateFromInputs();
    const registration = collectRegistration(game, tournamentId);

    registrationState.submitting = true;
    render();
    try {
      // Authoritative validation, atomic team-name reservation and
      // the actual Firestore writes all happen on the backend (see
      // functions/index.js) — this call either returns a real
      // "pending" registration or throws a real error. No payment
      // happens here and no team number is assigned yet.
      await submitRegistration(game, registration);
      registrationState.submitting = false;
      registrationState.done = true;
      render();
      showResultModal({
        kind: "success",
        title: "Registration Details Saved",
        message: "Your registration has been received and is currently pending payment. Payment integration will be connected in the next phase."
      });
    } catch (error) {
      handleSubmitError(error);
    }
  });
}

/* ---------------------------------------------------------
   Init
   --------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const game = detectGame();
  registrationState.game = game;
  registrationState.tournamentId = getTournamentId();

  document.body.classList.add(`game-${game}`);
  document.querySelectorAll("[data-field='game']").forEach((el) => { el.textContent = GAME_LABEL[game]; });
  document.querySelectorAll("[data-game-label]").forEach((el) => { el.textContent = GAME_LABEL[game]; });

  initRoutes();
  initNavbar();
  initMobileMenu();
  initWhatsappCta();
  initScrollReveal();
  initPlayer5Toggle();
  initProgress();
  initModal();
  initForm();
  document.querySelector("[data-load-retry]")?.addEventListener("click", () => loadTournamentSummary());
  syncStateFromInputs();
  render();

  loadTournamentSummary();
});
