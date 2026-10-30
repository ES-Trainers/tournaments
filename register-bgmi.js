/* ==========================================================
   ES Trainers — BGMI registration page (register-bgmi.js)

   What this file does:
   - Reads ?id=<tournamentId> and listens to ONE Firestore
     document: tournaments/<id> in the existing bgmi-firebase
     project (same config + SDK version as bgmi.js).
   - Shows the tournament, checks whether registration is open,
     validates the squad form, shows Rules & Terms, and lets the
     player review their entry.
   - Check Availability: reads tournaments/<id>/teamNames/<sha256 key>.
   - Verify Account: Firebase Google sign-in, then reads
     tournaments/<id>/leaderEmails/<sha256 key>.
   - Verify Team: re-runs every check fresh (see section 13).
   - Pay: asks the Apps Script backend for a Razorpay order, opens
     Razorpay Checkout, then sends the payment result back so the
     backend can verify the signature and save the registration
     as CONFIRMED (the backend also sends the confirmation email).
   - Celebration: only when the backend answers ok + status "confirmed"
     a full-screen ES Trainers overlay appears (animation, then a
     persistent success screen). Continue closes it and resets ONLY the
     frontend form; it never touches the saved registration or payment.

   What this file deliberately does NOT do:
   - It never writes registrations or payment status to Firestore.
     Only the Apps Script backend does, after verifying payment.
   - It never holds a Razorpay secret (only the public Key ID).
   ========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { evaluate, formatDateTimeIST } from "./tournament-lifecycle.js";
import { buildCard, patchCard, buildView } from "./tournament-card.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

/* ---- 1. Config (same values as bgmi.js) ---- */

const CONFIG = {
  collectionName: "tournaments",
  openStatus: "registration_open",
  listRoute: "bgmi.html#tournaments",
};

const BGMI_FIREBASE = {
  appName: "bgmi",
  config: {
    apiKey: "AIzaSyBug5r0hXPRCK8x6O6TasSlFFtx378_6iw",
    authDomain: "bgmi-firebase.firebaseapp.com",
    projectId: "bgmi-firebase",
    storageBucket: "bgmi-firebase.firebasestorage.app",
    messagingSenderId: "144306362464",
    appId: "1:144306362464:web:3a91a4e8381f2eb7af4b05",
    measurementId: "G-37YDZGRFXR",
  },
};

/* Razorpay TEST Key ID (public by design, never the secret).
   Used as a fallback only; the backend returns the key it created the order with. */
const RAZORPAY_TEST_KEY_ID = "rzp_test_TowNZAlqCUBcK2";

// Deploy 7
const PAYMENT_BACKEND_URL = "https://script.google.com/macros/s/AKfycbxMLt6hW4IJqpBHNfNgrIj8w_zTbpN-GoRQAlUUBQkH04YGiBihF23KyXEx54rNVjJc/exec";


/* ---- 2. Small helpers ---- */

const $ = (selector, root = document) => root.querySelector(selector);
const byId = (id) => document.getElementById(id);

/* Only touch the DOM when the value really changed (no flicker). */
function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}
function setHidden(node, hidden) {
  if (node && node.hidden !== hidden) node.hidden = hidden;
}

const collapse = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function toCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
  return null;
}

function money(value) {
  if (typeof value === "number" && Number.isFinite(value)) return "₹" + value.toLocaleString("en-IN");
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function formatDate(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return typeof value === "string" && value.trim() ? value.trim() : null;
    }
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}

/* A Firestore document id never contains "/" and is never "." or "..". */
function readTournamentId() {
  const raw = new URLSearchParams(window.location.search).get("id");
  const id = raw ? raw.trim() : "";
  if (!id || id.length > 150 || id.includes("/") || id === "." || id === "..") return "";
  return id;
}

/* Display only. The backend decides the real amount from the tournament document. */
function parseFeeInr(value) {
  const m = String(value ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  const n = m ? Number(m[0]) : 0;
  return n > 0 ? n : null;
}

function normalizeTournament(data) {
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  let rules = data.rules;
  if (Array.isArray(rules)) rules = rules.filter((r) => typeof r === "string").join("\n");
  rules = typeof rules === "string" ? rules.trim() : "";
  return {
    title: text(data.title),
    date: formatDateTimeIST(evaluate(data, Date.now()).startMs) || formatDate(data.date),
    lifecycle: evaluate(data, Date.now()),
    match: text(data.match),
    fee: money(data.entryFee),
    feeInr: parseFeeInr(data.entryFee),
    prize: money(data.prizePool),
    status: text(data.status),
    max: toCount(data.maxTeams),
    registered: toCount(data.registeredTeams),
    rules,
  };
}

/* Registration availability is decided from the real document only. */
function getEligibility(t) {
  const lc = t.lifecycle;
  if (lc && lc.phase === "invalid") {
    return { open: false, title: "Registration is unavailable", message: "The tournament schedule has not been published correctly yet, so registration is paused. Please check back soon." };
  }
  if (lc && lc.phase === "expired") {
    return { open: false, title: "Tournament has started", message: "This tournament has already started, so registration is closed." };
  }
  if (lc && lc.phase === "closed") {
    return { open: false, title: "REGISTRATION CLOSED", message: "Registration closed 48 hours before the scheduled tournament (" + formatDateTimeIST(lc.deadlineMs) + "). New registrations are no longer accepted." };
  }
  if (t.status !== CONFIG.openStatus) {
    const messages = {
      upcoming: "Registration has not opened for this tournament yet.",
      live: "This tournament is already live, so registration is closed.",
    };
    return {
      open: false,
      title: "Registration is closed",
      message: messages[t.status] || "This tournament is not accepting registrations right now.",
    };
  }
  if (t.max !== null && t.registered !== null && t.registered >= t.max) {
    return { open: false, title: "Tournament is full", message: "All team slots are taken, so registration is closed." };
  }
  return { open: true };
}

/* ---- 3. Firebase ---- */

const app = initializeApp(BGMI_FIREBASE.config, BGMI_FIREBASE.appName);
const db = getFirestore(app);
const auth = getAuth(app);

/* ---- 4. Elements and state ---- */

const el = {
  statePanel: byId("state-panel"),
  stateTitle: byId("state-title"),
  stateText: byId("state-text"),
  stateAction: byId("state-action"),
  grid: byId("reg-grid"),
  summary: byId("summary"),
  formCol: byId("form-col"),
  heroSub: byId("hero-sub"),
  banner: byId("status-banner"),
  bannerTitle: byId("banner-title"),
  bannerBody: byId("banner-body"),
  form: byId("reg-form"),
  fields: byId("form-fields"),
  reviewBtn: byId("review-btn"),
  errorSummary: byId("error-summary"),
  errorList: byId("error-list"),
  rulesStatus: byId("rules-status"),
  openRules: byId("open-rules"),
  rulesDialog: byId("rules-dialog"),
  rulesContent: byId("rules-content"),
  acceptRules: byId("accept-rules"),
  reviewDialog: byId("review-dialog"),
  reviewContent: byId("review-content"),
  submitRegistration: byId("submit-registration"),
  submitNotice: byId("submit-notice"),
  checkNameBtn: byId("check-name-btn"),
  nameMsg: byId("team-name-check-msg"),
  verifyAccountBtn: byId("verify-account-btn"),
  verifyAccountLabel: byId("verify-account-label"),
  accountMsg: byId("account-msg"),
  verifyTeamBtn: byId("verify-team-btn"),
  formActions: byId("form-actions"),
  verifyIssues: byId("verify-issues"),
  verifyIssuesList: byId("verify-issues-list"),
  payBox: byId("pay-box"),
  payBtn: byId("pay-btn"),
  payMsg: byId("pay-msg"),
  successBox: byId("success-box"),
  successId: byId("success-id"),
  successPayment: byId("success-payment"),
  successTitle: byId("success-title"),
  successStatus: byId("success-status"),
  successNote: byId("success-note"),
  vfy: byId("verify-overlay"),
  vfyCard: document.querySelector("#verify-overlay .vfy__card"),
  vfyTitle: byId("vfy-title"),
  vfyMsg: byId("vfy-msg"),
  vfyId: byId("vfy-id"),
  vfyPay: byId("vfy-pay"),
  vfyActions: byId("vfy-actions"),
  vfyRetry: byId("vfy-retry"),
  vfyClose: byId("vfy-close"),
  cele: byId("celebrate"),
  celeFx: byId("cele-fx"),
  celeIntro: byId("cele-intro"),
  celeFinal: byId("cele-final"),
  celeTeam: byId("cele-team"),
  celeSkip: byId("cele-skip"),
  celeTitle: byId("cele-title"),
  celeFTeam: byId("cele-f-team"),
  celeFReg: byId("cele-f-reg"),
  celeFPay: byId("cele-f-pay"),
  celeFPayRow: byId("cele-f-pay-row"),
  celeEmail: byId("cele-email"),
  celeContinue: byId("cele-continue"),
};

const state = {
  tournament: null,
  eligibility: null,
  rulesAccepted: false,
  rulesTextShown: null,
};

/* ---- 5. Blocking states (missing id, not found, load error) ---- */

function showBlockingState({ title, text, error = false, action }) {
  setText(el.stateTitle, title);
  setText(el.stateText, text);
  el.statePanel.classList.toggle("state--error", error);
  if (action) {
    setText(el.stateAction, action.label);
    el.stateAction.setAttribute("href", action.href);
  } else {
    el.stateAction.setAttribute("href", CONFIG.listRoute);
    setText(el.stateAction, "View tournaments");
  }
  setHidden(el.statePanel, false);
  setHidden(el.grid, true);
  setText(el.heroSub, "Tournament unavailable");
}

function hideBlockingState() {
  setHidden(el.statePanel, true);
  setHidden(el.grid, false);
}

/* ---- 6. Tournament rendering (patches only what changed) ---- */

/* Tournament summary = the shared compact card (tournament-card.js). Built once, then patched
   in place (also by the 1-second timer below, so the deadline countdown stays live). */
let summaryCard = null;
function renderSummaryCard() {
  if (!state.raw || !el.summary) return;
  if (!summaryCard) {
    summaryCard = buildCard("compact", "h2");
    el.summary.replaceChildren(summaryCard);
  }
  patchCard(summaryCard, buildView({ ...state.raw, id: readTournamentId() }, Date.now()));
}

function renderBanner(t, eligibility) {
  const warnings = [];
  if (eligibility.open) {
    if (t.max === null || t.registered === null) warnings.push("Slot availability is not set for this tournament, so we cannot confirm free slots.");
    if (!t.fee) warnings.push("Entry fee is not set for this tournament.");
  }
  const show = !eligibility.open || warnings.length > 0;
  setHidden(el.banner, !show);
  if (!show) return;

  el.banner.className = "notice notice--warn";
  if (!eligibility.open) {
    setText(el.bannerTitle, eligibility.title);
    el.bannerBody.replaceChildren(Object.assign(document.createElement("p"), { textContent: eligibility.message }));
  } else {
    setText(el.bannerTitle, "Heads up");
    const ul = document.createElement("ul");
    warnings.forEach((w) => ul.appendChild(Object.assign(document.createElement("li"), { textContent: w })));
    if (el.bannerBody.textContent !== warnings.join("")) el.bannerBody.replaceChildren(ul);
  }
}

function renderTournament(data) {
  state.raw = data;
  const t = normalizeTournament(data);
  const eligibility = getEligibility(t);
  state.tournament = t;
  state.eligibility = eligibility;

  hideBlockingState();
  setHidden(el.formCol, false);

  const title = t.title || "BGMI Tournament";
  setText(el.heroSub, title);
  const docTitle = `${title} Registration | ES Trainers`;
  if (document.title !== docTitle) document.title = docTitle;

  renderSummaryCard();
  renderBanner(t, eligibility);

  renderRules(t);
  applyLock();
  renderPayButton();
  if (!eligibility.open && !vs.pay.pending && !vs.pay.done) invalidateTeamVerification();
}

/* ---- 7. Rules & Terms ---- */

function renderRules(t) {
  if (state.rulesTextShown === t.rules) return;
  /* Rules changed (or first load): any earlier acceptance no longer applies. */
  state.rulesTextShown = t.rules;
  state.rulesAccepted = false;
  invalidateTeamVerification();
  updateRulesStatus();

  const box = el.rulesContent;
  box.replaceChildren();
  if (!t.rules) {
    const p = document.createElement("p");
    p.className = "rules__missing";
    p.textContent = "The rules for this tournament have not been added yet. Registration cannot be completed until ES Trainers publishes them.";
    box.appendChild(p);
  } else {
    t.rules.split(/\n+/).map((s) => s.trim()).filter(Boolean).forEach((line) => {
      const p = document.createElement("p");
      p.textContent = line; /* textContent only: rules are never parsed as HTML */
      box.appendChild(p);
    });
  }
  el.acceptRules.disabled = !t.rules;
}

function updateRulesStatus() {
  const missing = !state.tournament || !state.tournament.rules;
  const node = el.rulesStatus;
  node.className = "rules-box__status";
  if (state.rulesAccepted) {
    node.classList.add("rules-box__status--ok");
    setText(node, "Accepted. It is saved with your registration after payment.");
  } else if (missing) {
    node.classList.add("rules-box__status--bad");
    setText(node, "Rules are not published for this tournament yet.");
  } else {
    setText(node, "Not accepted yet.");
  }
}

/* ---- 8. Validation ---- */

const PLAYERS = [1, 2, 3, 4, 5];
const GENDERS = ["Male", "Female", "Other"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UID_RE = /^\d{8,12}$/;

function normalizePhone(value) {
  const digits = String(value || "").replace(/[\s\-()]/g, "");
  const m = digits.match(/^(?:\+91|91|0)?([6-9]\d{9})$/);
  return m ? m[1] : null;
}

function val(id) {
  const node = byId(id);
  return node ? collapse(node.value) : "";
}

function playerFilled(n) {
  return ["name", "ign", "uid", "gender"].some((k) => val(`p${n}-${k}`) !== "");
}

/* Returns { fieldId: message } for everything that is wrong right now. */
function validateAll() {
  const errors = {};
  const set = (id, msg) => { if (!errors[id]) errors[id] = msg; };

  const team = val("team-name");
  if (!team) set("team-name", "Enter your team name.");
  else if (team.length < 3) set("team-name", "Team name must be at least 3 characters.");
  else if (team.length > 30) set("team-name", "Team name can be at most 30 characters.");

  const uidSeen = new Map();
  PLAYERS.forEach((n) => {
    const p = `p${n}`;
    if (n === 5 && !playerFilled(5)) return; /* untouched substitute is fine */

    const name = val(`${p}-name`);
    if (!name) set(`${p}-name`, "Enter the player's name.");
    else if (name.length < 2) set(`${p}-name`, "Name must be at least 2 characters.");

    const ign = val(`${p}-ign`);
    if (!ign) set(`${p}-ign`, "Enter the BGMI profile name.");
    else if (ign.length < 2) set(`${p}-ign`, "Profile name must be at least 2 characters.");

    const uid = val(`${p}-uid`);
    if (!uid) set(`${p}-uid`, "Enter the BGMI UID.");
    else if (!UID_RE.test(uid)) set(`${p}-uid`, "UID must be 8 to 12 digits, numbers only.");
    else uidSeen.set(uid, [...(uidSeen.get(uid) || []), `${p}-uid`]);

    if (!GENDERS.includes(val(`${p}-gender`))) set(`${p}-gender`, "Select a gender.");
  });

  uidSeen.forEach((ids) => {
    if (ids.length > 1) ids.forEach((id) => set(id, "This UID is already used by another player in your team."));
  });

  const email = val("p1-email");
  if (!email) set("p1-email", "Enter the leader's email address.");
  else if (!EMAIL_RE.test(email) || email.length > 120) set("p1-email", "Enter a valid email address.");

  const phone = val("p1-phone");
  if (!phone) set("p1-phone", "Enter the leader's phone number.");
  else if (!normalizePhone(phone)) set("p1-phone", "Enter a valid 10-digit Indian mobile number.");

  return errors;
}

function showFieldError(id, message) {
  const input = byId(id);
  const out = byId(`${id}-error`);
  if (!input || !out) return;
  setText(out, message || "");
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function fieldLabel(id) {
  const input = byId(id);
  const label = $(`label[for="${id}"]`);
  const legend = input.closest("fieldset")?.querySelector("legend");
  const who = legend ? legend.textContent.replace(/\s*\(optional\)\s*/i, "").trim() : "";
  const what = label ? label.textContent.trim() : id;
  return who && who !== "Team details" ? `${who}: ${what}` : what;
}

function showSummary(errors) {
  const ids = Object.keys(errors);
  el.errorList.replaceChildren();
  ids.forEach((id) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${id}`;
    a.textContent = `${fieldLabel(id)} — ${errors[id]}`;
    a.addEventListener("click", (event) => {
      event.preventDefault();
      byId(id).focus();
    });
    li.appendChild(a);
    el.errorList.appendChild(li);
  });
  setHidden(el.errorSummary, ids.length === 0);
}

/* Order of the fields as they appear on the page (for focus + summary). */
function fieldOrder() {
  return [...el.form.querySelectorAll("input[id], select[id]")].map((n) => n.id);
}

function applyErrors(errors) {
  fieldOrder().forEach((id) => showFieldError(id, errors[id] || ""));
  const ordered = {};
  fieldOrder().forEach((id) => { if (errors[id]) ordered[id] = errors[id]; });
  return ordered;
}

let attempted = false;

/* ---- 9. Review panel ---- */

function addBlock(parent, heading, rows) {
  const block = document.createElement("section");
  block.className = "rev__block";
  const h = document.createElement("h3");
  h.textContent = heading;
  const dl = document.createElement("dl");
  rows.forEach(([k, v]) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  });
  block.append(h, dl);
  parent.appendChild(block);
}

function buildReview() {
  const t = state.tournament;
  const box = el.reviewContent;
  box.replaceChildren();

  addBlock(box, "Tournament", [
    ["Name", t.title || "BGMI Tournament"],
    ["Entry fee", t.fee || "Not set"],
  ]);
  addBlock(box, "Team", [["Team name", val("team-name")]]);
  PLAYERS.forEach((n) => {
    const p = `p${n}`;
    if (n === 5 && !playerFilled(5)) return;
    const rows = [
      ["Name", val(`${p}-name`)],
      ["Profile name", val(`${p}-ign`)],
      ["UID", val(`${p}-uid`)],
      ["Gender", val(`${p}-gender`)],
    ];
    if (n === 1) {
      rows.push(["Email", val("p1-email").toLowerCase()]);
      rows.push(["Phone", normalizePhone(val("p1-phone"))]);
    }
    addBlock(box, n === 1 ? "Player 1 — Team Leader" : n === 5 ? "Player 5 — Substitute" : `Player ${n}`, rows);
  });
  addBlock(box, "Status", [
    ["Rules & Terms", "Accepted"],
    ["Team name / email check", "Done when you click Verify Team"],
    ["Payment", "Online, after Verify Team"],
    ["Registration", "Confirmed automatically once the payment is verified"],
  ]);
}

/* ---- 10. Events ---- */

function onSubmit(event) {
  event.preventDefault();
  if (!state.eligibility || !state.eligibility.open) return;
  attempted = true;

  const ordered = applyErrors(validateAll());
  showSummary(ordered);
  const firstId = Object.keys(ordered)[0];
  if (firstId) {
    setHidden(el.errorSummary, false);
    el.errorSummary.focus({ preventScroll: false });
    return;
  }

  if (!state.tournament.rules) {
    updateRulesStatus();
    el.openRules.focus();
    return;
  }
  if (!state.rulesAccepted) {
    el.rulesStatus.className = "rules-box__status rules-box__status--bad";
    setText(el.rulesStatus, "Open the Rules & Terms and accept them to continue.");
    el.openRules.focus();
    return;
  }

  buildReview();
  el.reviewDialog.showModal();
}

function onFieldBlur(event) {
  const id = event.target.id;
  if (!id || !byId(`${id}-error`)) return;
  const errors = validateAll();
  /* A substitute that is still empty must not be nagged on blur. */
  showFieldError(id, errors[id] || "");
  if (attempted) showSummary(applyErrors(errors));
}

function onFieldInput(event) {
  const id = event.target.id;
  if (event.target.getAttribute("aria-invalid") !== "true") return;
  const errors = validateAll();
  showFieldError(id, errors[id] || "");
}

function initDialogs() {
  el.openRules.addEventListener("click", () => el.rulesDialog.showModal());
  el.submitRegistration.addEventListener("click", () => {
    el.reviewDialog.close();
    el.verifyTeamBtn.scrollIntoView({ block: "center", behavior: "smooth" });
    el.verifyTeamBtn.focus({ preventScroll: true });
  });
  el.acceptRules.addEventListener("click", () => {
    if (!state.tournament || !state.tournament.rules) return;
    state.rulesAccepted = true;
    updateRulesStatus();
    invalidateTeamVerification();
    el.rulesDialog.close();
  });
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => byId(btn.dataset.close).close());
  });
}

function initForm() {
  el.form.addEventListener("submit", onSubmit);
  el.form.addEventListener("focusout", onFieldBlur);
  el.form.addEventListener("input", onFieldInput);
  el.form.addEventListener("change", onFieldInput);
  el.form.addEventListener("input", onRegistrationChanged);
  el.form.addEventListener("change", onRegistrationChanged);
  el.checkNameBtn.addEventListener("click", onCheckName);
  el.verifyAccountBtn.addEventListener("click", onVerifyAccount);
  el.verifyTeamBtn.addEventListener("click", onVerifyTeam);
  el.payBtn.addEventListener("click", onPay);
  el.celeSkip.addEventListener("click", showCelebrationFinal);
  el.celeContinue.addEventListener("click", onCelebrationContinue);
  el.vfyRetry.addEventListener("click", () => { if (vs.pay.pending && !vs.pay.confirming) confirmPayment(vs.pay.pending); });
  el.vfyClose.addEventListener("click", hideVerify); /* the inline "Retry confirming payment" button stays available behind it */
  el.cele.addEventListener("keydown", trapCelebrationFocus);
}


/* ---- 11. Navbar + mobile menu (same behaviour as bgmi.js) ---- */

function initNavbar() {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  const setScrolled = () => nav.classList.toggle("nav--scrolled", window.scrollY > 12);
  setScrolled();
  window.addEventListener("scroll", setScrolled, { passive: true });
}

function initMobileMenu() {
  const toggle = document.querySelector(".nav__toggle");
  const menu = document.getElementById("mobile-menu");
  if (!toggle || !menu) return;
  const links = menu.querySelectorAll("a");

  const open = () => {
    menu.classList.add("mobile-menu--open");
    toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");
    if (links[0]) links[0].focus();
  };
  const close = ({ restoreFocus = true } = {}) => {
    menu.classList.remove("mobile-menu--open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("no-scroll");
    if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => {
    if (menu.classList.contains("mobile-menu--open")) close(); else open();
  });
  links.forEach((link) => link.addEventListener("click", () => close({ restoreFocus: false })));
  menu.addEventListener("click", (event) => { if (event.target === menu) close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("mobile-menu--open")) close();
  });
}

/* ---- 13. Team-name check, Google verification, Verify Team, payment ---- */

/* All new UI state lives here. Nothing in it is trusted by the server:
   the backend re-verifies identity, duplicates, fee and payment itself. */
const vs = {
  name: { checked: null, available: null },           // normalized name last checked / found available
  acct: { verifiedEmail: null, registered: null, busy: false },
  team: { fingerprint: null, verified: false, busy: false },
  pay: { busy: false, pending: null, snapshot: null, done: false, failure: "" },
};

class UserFacingError extends Error {}

const normTeam = (name) => collapse(name).toLowerCase();
const normEmail = (email) => String(email || "").toLowerCase().trim();

function setMsg(node, text, tone) {
  setText(node, text || "");
  const cls = "vmsg" + (tone ? ` vmsg--${tone}` : "");
  if (node.className !== cls) node.className = cls;
}

/* Same key the backend uses: SHA-256 hex of the normalized value. */
async function sha256Hex(text) {
  if (!window.crypto || !window.crypto.subtle) throw new Error("Secure context required");
  const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Single-document lookups only (no queries, no listing). */
async function reservationExists(collectionName, normalizedValue) {
  const key = await sha256Hex(normalizedValue);
  const snap = await getDoc(doc(db, CONFIG.collectionName, readTournamentId(), collectionName, key));
  return snap.exists();
}
const isTeamNameTaken = (name) => reservationExists("teamNames", normTeam(name));
const isEmailRegistered = (email) => reservationExists("leaderEmails", normEmail(email));

async function fetchFreshTournament() {
  const snap = await getDoc(doc(db, CONFIG.collectionName, readTournamentId()));
  if (!snap.exists()) {
    return { t: null, eligibility: { open: false, title: "Tournament not found", message: "This tournament could not be found." } };
  }
  const t = normalizeTournament(snap.data() || {});
  return { t, eligibility: getEligibility(t) };
}

/* ---- Snapshot of everything Verify Team vouches for ---- */

function registrationSnapshot() {
  const players = [];
  PLAYERS.forEach((n) => {
    if (n === 5 && !playerFilled(5)) return;
    const p = `p${n}`;
    players.push({ number: n, name: val(`${p}-name`), ign: val(`${p}-ign`), uid: val(`${p}-uid`), gender: val(`${p}-gender`) });
  });
  return {
    teamName: val("team-name"),
    leaderEmail: normEmail(val("p1-email")),
    leaderPhone: normalizePhone(val("p1-phone")),
    players,
    rulesAccepted: state.rulesAccepted,
  };
}
const fingerprint = () => JSON.stringify([registrationSnapshot(), vs.acct.verifiedEmail]);

/* ---- Feature 1: Check Availability ---- */

function resetNameCheck() {
  vs.name = { checked: null, available: null };
  el.checkNameBtn.classList.remove("is-ok");
  el.checkNameBtn.disabled = false;
  setText(el.checkNameBtn, "Check Availability");
  setMsg(el.nameMsg, "");
}

async function onCheckName() {
  if (!state.eligibility || !state.eligibility.open) return;
  const name = val("team-name");
  const problem = validateAll()["team-name"];
  if (problem) {
    showFieldError("team-name", problem);
    byId("team-name").focus();
    return;
  }
  showFieldError("team-name", "");
  const normalized = normTeam(name);
  vs.name = { checked: normalized, available: null };
  el.checkNameBtn.classList.remove("is-ok");
  el.checkNameBtn.disabled = true;
  setText(el.checkNameBtn, "Checking…");
  setMsg(el.nameMsg, "");
  try {
    const taken = await isTeamNameTaken(name);
    if (normTeam(val("team-name")) !== normalized) return; /* edited meanwhile: result is stale */
    el.checkNameBtn.disabled = false;
    if (taken) {
      setText(el.checkNameBtn, "Check Availability");
      setMsg(el.nameMsg, "This team name is already registered in this tournament. Please choose a different name.", "bad");
    } else {
      vs.name.available = normalized;
      el.checkNameBtn.classList.add("is-ok");
      setText(el.checkNameBtn, "Available");
      setMsg(el.nameMsg, "This team name is available.", "ok");
    }
  } catch (err) {
    console.error("Team name check failed", err);
    if (normTeam(val("team-name")) !== normalized) return;
    vs.name = { checked: null, available: null };
    el.checkNameBtn.disabled = false;
    setText(el.checkNameBtn, "Check Availability");
    setMsg(el.nameMsg, "Could not check the team name. Check your connection and try again.", "bad");
  }
}

/* ---- Feature 2: Verify Account (Firebase Google sign-in) ---- */

function renderAccount() {
  const a = vs.acct;
  const ok = !!a.verifiedEmail;
  el.verifyAccountBtn.classList.toggle("is-ok", ok);
  if (el.verifyAccountBtn.disabled !== a.busy) el.verifyAccountBtn.disabled = a.busy;
  setText(el.verifyAccountLabel, a.busy ? "Opening Google…" : ok ? (a.registered ? "Verified" : "Account Verified") : "Verify Account");
  if (ok) setMsg(el.accountMsg, a.registered ? "Email is already registered" : "Email is available to registration", a.registered ? "bad" : "ok");
}

function resetAccount() {
  vs.acct = { verifiedEmail: null, registered: null, busy: vs.acct.busy };
  setMsg(el.accountMsg, "");
  renderAccount();
}

function authErrorMessage(err) {
  switch (err && err.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google sign-in was cancelled. Click Verify Account to try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.";
    case "auth/network-request-failed":
      return "Network problem during Google sign-in. Check your connection and try again.";
    case "auth/unauthorized-domain":
      return "Google sign-in is not enabled for this website address yet. Please contact ES Trainers.";
    case "auth/operation-not-allowed":
      return "Google sign-in is not turned on yet. Please contact ES Trainers.";
    case "auth/user-disabled":
      return "This Google account has been disabled. Please contact ES Trainers.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a minute and try again.";
    default:
      return "Google sign-in failed. Please try again.";
  }
}

async function onVerifyAccount() {
  if (vs.acct.busy || !state.eligibility || !state.eligibility.open) return;
  const problem = validateAll()["p1-email"];
  if (problem) {
    showFieldError("p1-email", problem);
    byId("p1-email").focus();
    return;
  }
  showFieldError("p1-email", "");
  const email = normEmail(val("p1-email"));
  vs.acct = { verifiedEmail: null, registered: null, busy: true };
  setMsg(el.accountMsg, "");
  renderAccount();

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account", login_hint: email });
  try {
    const result = await signInWithPopup(auth, provider);
    const googleEmail = normEmail(result.user && result.user.email);
    if (normEmail(val("p1-email")) !== email) {
      vs.acct.busy = false;
      renderAccount();
      setMsg(el.accountMsg, "The email changed during sign-in. Click Verify Account again.", "bad");
      return;
    }
    if (googleEmail !== email) {
      await signOut(auth).catch(() => {});
      vs.acct.busy = false;
      renderAccount();
      setMsg(el.accountMsg, `You signed in as ${googleEmail || "another account"}, which does not match ${email}. Sign in with the Team Leader Email, or correct the email field.`, "bad");
      return;
    }
    let registered;
    try {
      registered = await isEmailRegistered(email);
    } catch (err) {
      console.error("Email registration check failed", err);
      vs.acct.busy = false;
      renderAccount();
      setMsg(el.accountMsg, "Signed in, but we could not check existing registrations. Please try again.", "bad");
      return;
    }
    if (normEmail(val("p1-email")) !== email) { vs.acct.busy = false; renderAccount(); return; }
    vs.acct = { verifiedEmail: email, registered, busy: false };
    renderAccount();
    invalidateTeamVerification();
  } catch (err) {
    console.error("Google sign-in failed", err);
    vs.acct.busy = false;
    renderAccount();
    setMsg(el.accountMsg, authErrorMessage(err), "bad");
  }
}

/* ---- Invalidation: any relevant change requires a fresh check ---- */

function onRegistrationChanged(event) {
  const id = event.target && event.target.id;
  if (id === "team-name" && vs.name.checked !== null && normTeam(val("team-name")) !== vs.name.checked) resetNameCheck();
  if (id === "p1-email" && normEmail(val("p1-email")) !== vs.acct.verifiedEmail) resetAccount();
  if (vs.team.verified && fingerprint() !== vs.team.fingerprint) invalidateTeamVerification();
}

function invalidateTeamVerification() {
  if (vs.pay.pending || vs.pay.done || vs.pay.busy || !vs.team.verified) return;
  vs.team.verified = false;
  vs.team.fingerprint = null;
  renderTeamButton();
  setHidden(el.payBox, true);
  setMsg(el.payMsg, "");
}

/* ---- Locks and button rendering ---- */

function applyLock() {
  const closed = !state.eligibility || !state.eligibility.open;
  const frozen = vs.pay.busy || !!vs.pay.pending || vs.pay.done;
  const lock = closed || frozen;
  if (el.fields.disabled !== lock) el.fields.disabled = lock;
  [el.reviewBtn, el.openRules].forEach((b) => { if (b.disabled !== lock) b.disabled = lock; });
  const vt = lock || vs.team.busy;
  if (el.verifyTeamBtn.disabled !== vt) el.verifyTeamBtn.disabled = vt;
  const pb = vs.pay.busy || vs.pay.done;
  if (el.payBtn.disabled !== pb) el.payBtn.disabled = pb;
}

function renderTeamButton() {
  el.verifyTeamBtn.classList.toggle("is-ok", vs.team.verified);
  setText(el.verifyTeamBtn, vs.team.busy ? "Verifying…" : vs.team.verified ? "Verified Everything" : "Verify Team");
  applyLock();
}

function renderPayButton() {
  const t = state.tournament;
  const label = vs.pay.pending
    ? "Retry confirming payment"
    : t && t.feeInr ? `Pay ₹${t.feeInr.toLocaleString("en-IN")}` : "Pay";
  setText(el.payBtn, label);
}

function showIssues(issues) {
  el.verifyIssuesList.replaceChildren();
  issues.forEach((issue) => {
    const li = document.createElement("li");
    if (issue.focus && byId(issue.focus)) {
      const a = document.createElement("a");
      a.href = `#${issue.focus}`;
      a.textContent = issue.text;
      a.addEventListener("click", (event) => { event.preventDefault(); byId(issue.focus).focus(); });
      li.appendChild(a);
    } else {
      li.textContent = issue.text;
    }
    el.verifyIssuesList.appendChild(li);
  });
  setHidden(el.verifyIssues, issues.length === 0);
  if (issues.length) el.verifyIssues.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* ---- Feature 3: Verify Team (everything is checked fresh) ---- */

async function onVerifyTeam() {
  if (vs.team.busy || !state.eligibility || !state.eligibility.open) return;
  vs.team.busy = true;
  vs.team.verified = false;
  vs.team.fingerprint = null;
  setHidden(el.payBox, true);
  showIssues([]);
  renderTeamButton();

  const before = fingerprint();
  const issues = [];
  try {
    /* Existing form validation: required fields, formats, duplicate UIDs. */
    const fieldErrors = applyErrors(validateAll());
    Object.keys(fieldErrors).forEach((id) => issues.push({ text: `${fieldLabel(id)}: ${fieldErrors[id]}`, focus: id }));

    /* Tournament still open + slot still free (fresh read, not the cached page state). */
    try {
      const fresh = await fetchFreshTournament();
      if (!fresh.eligibility.open) issues.push({ text: `${fresh.eligibility.title}. ${fresh.eligibility.message}` });
      else if (!fresh.t.rules) issues.push({ text: "The rules for this tournament have not been published yet." });
    } catch (err) {
      console.error("Tournament re-check failed", err);
      issues.push({ text: "Could not check the tournament right now. Check your connection and try again." });
    }

    if (!state.rulesAccepted) issues.push({ text: "Read and accept the Rules & Terms.", focus: "open-rules" });

    /* Team name, checked again against Firestore. */
    if (!fieldErrors["team-name"]) {
      try {
        if (await isTeamNameTaken(val("team-name"))) {
          issues.push({ text: "This team name is already registered in this tournament.", focus: "team-name" });
          vs.name = { checked: normTeam(val("team-name")), available: null };
          el.checkNameBtn.classList.remove("is-ok");
          setText(el.checkNameBtn, "Check Availability");
          setMsg(el.nameMsg, "This team name is already registered in this tournament. Please choose a different name.", "bad");
        }
      } catch (err) {
        console.error("Team name re-check failed", err);
        issues.push({ text: "Could not check the team name. Check your connection and try again." });
      }
    }

    /* Google account: signed in, same as the leader email, and not already registered. */
    if (!fieldErrors["p1-email"]) {
      const email = normEmail(val("p1-email"));
      const user = auth.currentUser;
      const viaGoogle = !!user && user.providerData.some((p) => p.providerId === "google.com");
      if (!vs.acct.verifiedEmail || vs.acct.verifiedEmail !== email) {
        issues.push({ text: "Verify your Google account with the Verify Account button. It must match the Team Leader Email.", focus: "verify-account-btn" });
      } else if (!user || !viaGoogle || normEmail(user.email) !== email) {
        resetAccount();
        issues.push({ text: "Your Google sign-in is no longer active. Click Verify Account again.", focus: "verify-account-btn" });
      } else {
        try {
          await user.getIdToken(true); /* fails if the session was revoked or the account disabled */
          const registered = await isEmailRegistered(email);
          if (vs.acct.verifiedEmail === email) { vs.acct.registered = registered; renderAccount(); }
          if (registered) issues.push({ text: "This email is already registered for this tournament.", focus: "p1-email" });
        } catch (err) {
          console.error("Account re-check failed", err);
          resetAccount();
          issues.push({ text: "Could not re-check your Google account. Click Verify Account again.", focus: "verify-account-btn" });
        }
      }
    }

    if (!issues.length && fingerprint() !== before) issues.push({ text: "The form changed while checking. Click Verify Team again." });

    if (!issues.length) {
      vs.team.verified = true;
      vs.team.fingerprint = before;
      setMsg(el.payMsg, "");
      renderPayButton();
      setHidden(el.payBox, false);
    }
  } catch (err) {
    console.error("Verify Team failed", err);
    issues.push({ text: "Something went wrong while verifying. Please try again." });
  } finally {
    vs.team.busy = false;
    renderTeamButton();
  }
  showIssues(issues);
}

/* ---- Feature 4: Payment (Razorpay Checkout + Apps Script backend) ---- */

/* The backend answers with JSON. text/plain keeps this a "simple" request (no CORS preflight). */
async function callBackend(body) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(PAYMENT_BACKEND_URL)) {
    throw new UserFacingError("Payment is not configured. Please contact ES Trainers on WhatsApp.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(PAYMENT_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error("Razorpay unavailable")));
    s.onerror = () => reject(new Error("Razorpay failed to load"));
    document.head.appendChild(s);
  });
}

function setPayBusy(busy) {
  vs.pay.busy = busy;
  el.payBtn.setAttribute("aria-busy", busy ? "true" : "false");
  applyLock();
}

async function onPay() {
  if (vs.pay.busy || vs.pay.done) return;
  if (vs.pay.pending) { await confirmPayment(vs.pay.pending); return; } /* never create a second order */
  if (state.raw) renderTournament(state.raw); /* re-evaluate the deadline right now (device clock; backend is authoritative) */
  if (!state.eligibility || !state.eligibility.open) {
    showIssues([{ text: state.eligibility ? state.eligibility.message : "Registration is not available." }]);
    return;
  }

  if (!vs.team.verified || fingerprint() !== vs.team.fingerprint) {
    invalidateTeamVerification();
    showIssues([{ text: "Please verify your team again before paying." }]);
    return;
  }
  vs.pay.failure = "";
  setPayBusy(true);
  setMsg(el.payMsg, "Preparing secure payment…", "");

  let order;
  try {
    const user = auth.currentUser;
    if (!user || normEmail(user.email) !== vs.acct.verifiedEmail) throw new UserFacingError("Your Google sign-in is no longer active. Click Verify Account again.");
    const idToken = await user.getIdToken(true);
    const registration = registrationSnapshot();
    order = await callBackend({ action: "createOrder", tournamentId: readTournamentId(), idToken, registration });
    if (!order || !order.ok) {
      setPayBusy(false);
      setMsg(el.payMsg, "");
      invalidateTeamVerification();
      showIssues([{ text: (order && order.error) || "Could not start the payment. Please verify your team again." }]);
      return;
    }
    vs.pay.snapshot = registration;
    await loadRazorpay();
  } catch (err) {
    console.error("Could not start payment", err);
    setPayBusy(false);
    setMsg(el.payMsg, err instanceof UserFacingError ? err.message : "Could not start the payment. Check your connection and try again. You have not been charged.", "bad");
    return;
  }
  openCheckout(order);
}

function openCheckout(order) {
  const t = state.tournament;
  let paid = false;
  const rzp = new window.Razorpay({
    key: order.keyId || RAZORPAY_TEST_KEY_ID,
    amount: order.amount,
    currency: order.currency || "INR",
    order_id: order.orderId,
    name: "ES Trainers",
    description: `${(t && t.title) || "BGMI Tournament"} entry fee`,
    prefill: { name: val("p1-name"), email: normEmail(val("p1-email")), contact: normalizePhone(val("p1-phone")) || "" },
    theme: { color: "#1f6e5c" },
    handler: (response) => { paid = true; confirmPayment(response); },
    modal: {
      ondismiss: () => {
        if (paid) return;
        setPayBusy(false);
        setMsg(el.payMsg, vs.pay.failure
          ? `Payment failed: ${vs.pay.failure} Click Pay to try again.`
          : "Payment was cancelled. Click Pay to try again.", "bad");
      },
    },
  });
  rzp.on("payment.failed", (r) => {
    vs.pay.failure = (r && r.error && r.error.description) || "The payment did not go through.";
    setMsg(el.payMsg, `Payment failed: ${vs.pay.failure} You can retry in the payment window.`, "bad");
  });
  rzp.open();
}

/* ---- Payment verification panel ----
   Opens SYNCHRONOUSLY when Razorpay hands back its result (before any await) and stays until the
   backend has answered. It is never a success screen: success is only shown after the server confirms
   the payment AND the registration has been saved. */
const vfy = { open: false, inerted: [], lastFocus: null };

function showVerify(mode, { message, paymentId } = {}) {
  const texts = {
    pending: ["Verifying your payment", "Your payment is being verified securely. Please do not refresh or close this page."],
    retry: ["We are still confirming your payment", message || "The server has not confirmed your payment yet."],
    final: ["Registration could not be completed", message || "The server could not complete this registration."]
  };
  el.vfyCard.setAttribute("data-mode", mode);
  setText(el.vfyTitle, texts[mode][0]);
  setText(el.vfyMsg, texts[mode][1]);
  setText(el.vfyPay, paymentId || "");
  setHidden(el.vfyId, !paymentId);
  setHidden(el.vfyActions, mode === "pending");
  if (mode === "retry") {
    setHidden(el.vfyRetry, false);
    setText(el.vfyClose, "Close this message");
  } else if (mode === "final") {
    setHidden(el.vfyRetry, true);
    setText(el.vfyClose, "Back to the form");
  }
  if (!vfy.open) {
    vfy.open = true;
    vfy.lastFocus = document.activeElement;
    vfy.inerted = [...document.body.children].filter((n) => n !== el.vfy && !n.hasAttribute("inert") && n.tagName !== "SCRIPT");
    vfy.inerted.forEach((n) => n.setAttribute("inert", ""));
    document.body.classList.add("no-scroll");
    setHidden(el.vfy, false);
  }
  el.vfyTitle.focus({ preventScroll: true });
}

function hideVerify() {
  if (!vfy.open) return;
  vfy.open = false;
  setHidden(el.vfy, true);
  vfy.inerted.forEach((n) => n.removeAttribute("inert"));
  vfy.inerted = [];
  document.body.classList.remove("no-scroll");
}

/* Razorpay says "paid" in the browser. That is NOT proof: the backend verifies the signature
   and asks Razorpay itself before it saves anything. */
async function confirmPayment(response) {
  if (vs.pay.confirming) return; /* one verification request at a time: a double tap can never send two */
  vs.pay.confirming = true;
  vs.pay.pending = {
    razorpay_order_id: response.razorpay_order_id,
    razorpay_payment_id: response.razorpay_payment_id,
    razorpay_signature: response.razorpay_signature,
  };
  const paymentId = vs.pay.pending.razorpay_payment_id;
  showVerify("pending", { paymentId }); /* immediately, before any network work */
  setPayBusy(true);
  renderPayButton();
  setHidden(el.payBox, false);
  setMsg(el.payMsg, "Payment received. Confirming it with the server. Do not close or refresh this page and do not pay again.", "");

  let res;
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("No signed-in user");
    const idToken = await user.getIdToken(true);
    res = await callBackend({ action: "confirmPayment", tournamentId: readTournamentId(), idToken, registration: vs.pay.snapshot, deferEmail: true, ...vs.pay.pending });
  } catch (err) {
    console.error("Payment confirmation request failed", err);
    vs.pay.confirming = false;
    setPayBusy(false);
    renderPayButton();
    const msg = `The server did not answer in time. Your payment is safe. Your payment ID is ${paymentId}. Do not pay again. Check your connection and tap "Retry confirming payment".`;
    setMsg(el.payMsg, msg, "bad");
    showVerify("retry", { message: msg, paymentId });
    return;
  }
  vs.pay.confirming = false;

  if (res && res.ok) {
    /* Server confirmed AND saved the registration: only now does the panel close and the celebration begin. */
    const confirmed = withSavedFallback(res);
    hideVerify();
    requestConfirmationEmail(confirmed); /* starts now, does not delay the success screen */
    showSuccess(confirmed);
    return;
  }

  setPayBusy(false);
  const reason = (res && res.error) || "The server could not confirm the payment.";
  if (res && res.final) {
    /* Definitive answer (e.g. refunded because the name was taken). Allow a fresh start. */
    vs.pay.pending = null;
    renderPayButton();
    invalidateTeamVerification();
    setHidden(el.payBox, true);
    showIssues([{ text: reason }]);
    showVerify("final", { message: reason, paymentId });
  } else {
    renderPayButton();
    const msg = `${reason} Your payment ID is ${paymentId}. Do not pay again. Tap "Retry confirming payment".`;
    setMsg(el.payMsg, msg, "bad");
    showVerify("retry", { message: msg, paymentId });
  }
}

/* The backend returns the SAVED teamName / leaderEmail. Only if an older deployed backend omits them do we fall back
   to the registration snapshot that the backend itself verified against the signed order (payloadHash). */
function withSavedFallback(res) {
  const snap = vs.pay.snapshot || {};
  return { ...res, teamName: res.teamName || snap.teamName || "", leaderEmail: res.leaderEmail || snap.leaderEmail || "" };
}

/* Second, separate request so the success screen never waits for MailApp. Idempotent on the server. */
async function requestConfirmationEmail(res, attempt = 1) {
  if (res.emailStatus === "sent" || !res.registrationId) return;
  try {
    const user = auth.currentUser;
    if (!user) return;
    const idToken = await user.getIdToken(); /* started before Continue can sign the user out */
    const r = await callBackend({ action: "sendConfirmationEmail", tournamentId: readTournamentId(), idToken, registrationId: res.registrationId });
    if (r && r.ok && r.emailStatus && cele.open && cele.regId === res.registrationId) setText(el.celeEmail, emailLine({ ...res, emailStatus: r.emailStatus }));
    if (!(r && r.ok && (r.emailStatus === "sent" || r.emailStatus === "failed")) && attempt < 2) setTimeout(() => requestConfirmationEmail(res, 2), 4000);
  } catch (err) {
    console.error("Confirmation email request failed", err);
    if (attempt < 2) setTimeout(() => requestConfirmationEmail(res, 2), 4000);
  }
}

function showSuccess(res) {
  vs.pay.done = true;
  vs.pay.pending = null;
  setPayBusy(false);
  setHidden(el.formActions, true);
  setHidden(el.errorSummary, true);
  applyLock();

  /* Only a backend-confirmed registration gets the celebration. */
  if (res.status === "confirmed" && res.registrationId) {
    openCelebration(res);
    return;
  }

  /* Anything else (e.g. an older record that is still awaiting review) is reported exactly as stored. */
  const status = String(res.status || "").replace(/_/g, " ") || "received";
  setText(el.successTitle, "Payment verified. Registration received");
  setText(el.successId, res.registrationId || "");
  setText(el.successStatus, status);
  setText(el.successPayment, res.paymentId || "");
  setText(el.successNote, "Please save your Registration ID. Its status is shown above exactly as stored.");
  setHidden(el.successBox, false);
  el.successBox.scrollIntoView({ block: "start", behavior: "smooth" });
  el.successBox.focus({ preventScroll: true });
}

/* ---- Celebration overlay ---- */

const cele = { open: false, timer: null, stopFx: null, inerted: [], lastFocus: null, regId: null };
const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

function emailLine(res) {
  const to = res.leaderEmail ? ` to ${res.leaderEmail}` : "";
  if (res.emailStatus === "sent") return `A confirmation email was sent${to}. If you do not see it soon, check your spam folder.`;
  if (res.emailStatus === "failed") return "Your registration is confirmed. The confirmation email could not be sent right now, so please keep your Registration ID safe.";
  return `Your confirmation email${to} is being prepared.`;
}

function openCelebration(res) {
  cele.open = true;
  cele.regId = res.registrationId || null;
  cele.lastFocus = document.activeElement;
  /* Every value below comes from the backend response (textContent only). */
  setText(el.celeTeam, res.teamName || "");
  setText(el.celeFTeam, res.teamName || "");
  setText(el.celeFReg, res.registrationId || "");
  setText(el.celeFPay, res.paymentId || "");
  /* Long values wrap on screen; the full value is also in the title so it is never lost. */
  [[el.celeFTeam, res.teamName], [el.celeFReg, res.registrationId], [el.celeFPay, res.paymentId]].forEach(([n, v]) => { if (v) n.setAttribute("title", v); else n.removeAttribute("title"); });
  setHidden(el.celeFPayRow, !res.paymentId);
  setText(el.celeEmail, emailLine(res));

  /* Everything behind the overlay is inert while it is open. */
  cele.inerted = [...document.body.children].filter((n) => n !== el.cele && !n.hasAttribute("inert") && n.tagName !== "SCRIPT");
  cele.inerted.forEach((n) => n.setAttribute("inert", ""));
  document.body.classList.add("no-scroll");

  setHidden(el.celeIntro, false);
  el.celeIntro.classList.remove("is-leaving");
  setHidden(el.celeFinal, true);
  setHidden(el.cele, false);

  if (prefersReducedMotion()) { showCelebrationFinal(); return; }
  el.celeSkip.focus({ preventScroll: true });
  cele.stopFx = startConfetti();
  cele.timer = setTimeout(showCelebrationFinal, 5200);
}

/* Stage 2: stable and readable. It stays until the person clicks Continue (no timeout). */
function showCelebrationFinal() {
  if (!cele.open || !el.celeFinal.hidden) return;
  clearTimeout(cele.timer);
  cele.timer = null;
  const reveal = () => {
    if (cele.stopFx) { cele.stopFx(); cele.stopFx = null; } /* the stable screen has no moving effects */
    setHidden(el.celeIntro, true);
    setHidden(el.celeFinal, false);
    el.celeTitle.focus({ preventScroll: true });
  };
  if (prefersReducedMotion()) { reveal(); return; }
  el.celeIntro.classList.add("is-leaving");
  setTimeout(reveal, 360);
}

function trapCelebrationFocus(event) {
  if (event.key !== "Tab") return;
  const items = [el.celeSkip, el.celeContinue].filter((b) => b.offsetParent !== null);
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === el.celeTitle)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/* Lightweight canvas confetti (no library). Stops by itself; returns a stop function. */
function startConfetti() {
  const canvas = el.celeFx;
  const ctx = canvas && canvas.getContext && canvas.getContext("2d");
  if (!ctx) return null;
  const colors = ["#1652f0", "#5a8dff", "#09267a", "#7fb2ff", "#ffffff", "#0b1a4a"];
  let w = 0, h = 0, raf = 0, stopped = false;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);
  const parts = [];
  const spawn = (n) => {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * w, y: -12 - Math.random() * h * 0.25,
        vx: (Math.random() - 0.5) * 2.4, vy: 2.2 + Math.random() * 3.4,
        s: 5 + Math.random() * 7, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.28,
        c: colors[(Math.random() * colors.length) | 0], diamond: Math.random() < 0.4,
      });
    }
  };
  const spawnUntil = performance.now() + 2200;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    ctx.clearRect(0, 0, w, h);
  };
  const tick = (now) => {
    if (stopped) return;
    if (now < spawnUntil && parts.length < 140) spawn(3);
    ctx.clearRect(0, 0, w, h);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx + Math.sin(p.y / 38) * 0.5; p.y += p.vy; p.r += p.vr;
      if (p.y > h + 24) { parts.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.diamond) { ctx.beginPath(); ctx.moveTo(0, -p.s); ctx.lineTo(p.s * 0.6, 0); ctx.lineTo(0, p.s); ctx.lineTo(-p.s * 0.6, 0); ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (now >= spawnUntil && parts.length === 0) { stop(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return stop;
}

function onCelebrationContinue() {
  if (!cele.open) return;
  cele.open = false; /* a double click cannot run this twice */
  clearTimeout(cele.timer);
  cele.timer = null;
  if (cele.stopFx) { cele.stopFx(); cele.stopFx = null; }

  setHidden(el.cele, true);
  cele.inerted.forEach((n) => n.removeAttribute("inert"));
  cele.inerted = [];
  document.body.classList.remove("no-scroll");
  /* The old registration ID / payment ID must never look like they belong to the next registration. */
  [el.celeTeam, el.celeFTeam, el.celeFReg, el.celeFPay, el.celeEmail].forEach((n) => setText(n, ""));
  cele.regId = null;

  resetRegistrationForm();

  window.scrollTo({ top: 0, behavior: "auto" });
  if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) byId("team-name").focus({ preventScroll: true });
}

/* Frontend ONLY. It does not call the backend, Firestore or Razorpay, so it cannot undo the saved
   registration, the verified payment or the email status, and it can never cause another charge.
   A new registration still has to pass every normal check (unique team name, Google-verified leader,
   open tournament, free slot, payment), all of which run again on the server. */
function resetRegistrationForm() {
  vs.name = { checked: null, available: null };
  vs.acct = { verifiedEmail: null, registered: null, busy: false };
  vs.team = { fingerprint: null, verified: false, busy: false };
  vs.pay = { busy: false, pending: null, snapshot: null, done: false, failure: "" };
  attempted = false;
  state.rulesAccepted = false;

  el.form.reset();
  if (el.rulesDialog.open) el.rulesDialog.close();
  if (el.reviewDialog.open) el.reviewDialog.close();
  el.reviewContent.replaceChildren();

  applyErrors({});
  showSummary({});
  showIssues([]);
  resetNameCheck();
  resetAccount();
  updateRulesStatus();

  setHidden(el.successBox, true);
  setText(el.successId, "");
  setText(el.successPayment, "");
  setText(el.successStatus, "");
  setText(el.successNote, "");
  setHidden(el.payBox, true);
  setMsg(el.payMsg, "");
  el.payBtn.setAttribute("aria-busy", "false");
  setHidden(el.formActions, false);

  renderTeamButton();
  renderPayButton();
  applyLock();

  /* The signed-in Google session belonged to the previous team's leader. */
  signOut(auth).catch(() => {});
}

/* Warn before leaving while a payment is open or waiting to be confirmed. */
window.addEventListener("beforeunload", (event) => {
  if (vs.pay.busy || vs.pay.pending) { event.preventDefault(); event.returnValue = ""; }
});

/* ---- 12. Start ---- */

function start() {
  initNavbar();
  initMobileMenu();
  initDialogs();
  initForm();

  const id = readTournamentId();
  if (!id) {
    showBlockingState({
      title: "No tournament selected",
      text: "This page needs a tournament link such as register-bgmi.html?id=<tournament id>. Please open registration from the BGMI tournaments page.",
    });
    return;
  }

  /* One realtime listener. */
  onSnapshot(
    doc(db, CONFIG.collectionName, id),
    (snap) => {
      if (!snap.exists()) {
        state.tournament = null;
        state.eligibility = null;
        showBlockingState({
          title: "Tournament not found",
          text: "We could not find this tournament. The link may be wrong or the tournament may have been removed.",
        });
        return;
      }
      renderTournament(snap.data() || {});
    },
    () => {
      showBlockingState({
        title: "Could not load the tournament",
        text: "Something went wrong while loading tournament details. Check your internet connection and try again.",
        error: true,
        action: { label: "Try again", href: window.location.href },
      });
    }
  );
}

start();

/* Re-evaluate at the deadline / start boundary without any Firestore change.
   Only re-renders when the open/closed answer flips and no payment is in flight. */
setInterval(() => {
  if (!state.raw) return;
  renderSummaryCard(); // countdown / closed state of the summary card (patches only changed text)
  if (vs.pay.busy || vs.pay.pending || vs.pay.done) return;
  const open = getEligibility(normalizeTournament(state.raw)).open;
  if (state.eligibility && state.eligibility.open !== open) renderTournament(state.raw);
}, 1000);
