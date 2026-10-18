/* ==========================================================
   ES Trainers — BGMI registration page (register-bgmi.js)

   What this file does:
   - Reads ?id=<tournamentId> and listens to ONE Firestore
     document: tournaments/<id> in the existing bgmi-firebase
     project (same config + SDK version as bgmi.js).
   - Shows the tournament, checks whether registration is open,
     validates the squad form, shows Rules & Terms, and lets the
     player review their entry.

   What this file deliberately does NOT do (see the report):
   - It does not write to Firestore. The Firestore rules in the
     project make registrations/teamNames server-only, so a
     browser write would be rejected.
   - It does not open Razorpay Checkout. Razorpay needs an order
     created and a payment signature verified on a trusted server,
     and this project has none. Never put the Key Secret here.
   - It does not check team-name / email availability, because
     the browser has no permission to read those reservations.
   ========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
   Kept here only so it is ready for the day a trusted server can
   create orders. It is intentionally NOT used: no checkout is opened. */
// eslint-disable-next-line no-unused-vars
const RAZORPAY_TEST_KEY_ID = "rzp_test_TowNZAlqCUBcK2";

const PAYMENT_BACKEND_URL = "https://script.google.com/macros/s/AKfycbw4DAaM-e6brrLv9J4BI3AVEdDiN5GRps9yXo2RHEX9NsB48UykzQyh-8XusIqQ_vxL/exec";


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

function normalizeTournament(data) {
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  let rules = data.rules;
  if (Array.isArray(rules)) rules = rules.filter((r) => typeof r === "string").join("\n");
  rules = typeof rules === "string" ? rules.trim() : "";
  return {
    title: text(data.title),
    date: formatDate(data.date),
    match: text(data.match),
    fee: money(data.entryFee),
    prize: money(data.prizePool),
    status: text(data.status),
    max: toCount(data.maxTeams),
    registered: toCount(data.registeredTeams),
    rules,
  };
}

/* Registration availability is decided from the real document only. */
function getEligibility(t) {
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
  sumTitle: byId("sum-title"),
  sumStatus: byId("sum-status"),
  sumCap: byId("sum-cap"),
  sumCapBar: byId("sum-cap-bar"),
  sumCapText: byId("sum-cap-text"),
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

function setRow(name, value) {
  const row = $(`[data-row="${name}"]`, el.summary);
  setHidden(row, !value);
  if (value) setText($("dd", row), value);
}

function renderStatusPill(status) {
  const labels = { registration_open: "Registration open", upcoming: "Upcoming", live: "Live" };
  const key = status || "";
  const label = labels[key] || (status ? status.replace(/_/g, " ") : "");
  setHidden(el.sumStatus, !label);
  if (!label) return;
  setText(el.sumStatus, label);
  const cls = key === "registration_open" ? "pill pill--open" : key === "upcoming" ? "pill pill--upcoming" : key === "live" ? "pill pill--live" : "pill";
  if (el.sumStatus.className !== cls) el.sumStatus.className = cls;
}

function renderCapacity(t) {
  const known = t.max !== null && t.registered !== null && t.max > 0;
  setHidden(el.sumCap, !known);
  if (!known) return;
  const pct = Math.min(100, Math.round((t.registered / t.max) * 100));
  const width = pct + "%";
  if (el.sumCapBar.style.width !== width) el.sumCapBar.style.width = width;
  const left = Math.max(0, t.max - t.registered);
  setText(el.sumCapText, left === 0 ? "No slots left" : `${left} of ${t.max} slots left`);
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
  const t = normalizeTournament(data);
  const eligibility = getEligibility(t);
  state.tournament = t;
  state.eligibility = eligibility;

  hideBlockingState();
  setHidden(el.formCol, false);

  const title = t.title || "BGMI Tournament";
  setText(el.sumTitle, title);
  setText(el.heroSub, title);
  const docTitle = `${title} Registration | ES Trainers`;
  if (document.title !== docTitle) document.title = docTitle;

  renderStatusPill(t.status);
  setRow("date", t.date);
  setRow("match", t.match);
  setRow("fee", t.fee);
  setRow("prize", t.prize);
  setRow("slots", t.max !== null && t.registered !== null ? `${t.registered} / ${t.max} registered` : null);
  renderCapacity(t);
  renderBanner(t, eligibility);

  const locked = !eligibility.open;
  if (el.fields.disabled !== locked) el.fields.disabled = locked;
  [el.reviewBtn, el.openRules].forEach((b) => { if (b.disabled !== locked) b.disabled = locked; });

  renderRules(t);
}

/* ---- 7. Rules & Terms ---- */

function renderRules(t) {
  if (state.rulesTextShown === t.rules) return;
  /* Rules changed (or first load): any earlier acceptance no longer applies. */
  state.rulesTextShown = t.rules;
  state.rulesAccepted = false;
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
    setText(node, "Accepted on this page. (Not recorded anywhere yet.)");
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
    ["Rules & Terms", "Accepted on this page only"],
    ["Team name / email check", "Checked by ES Trainers when submitted"],
    ["Payment", "Manual admin verification"],
    ["Registration", "Pending admin review"],
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
  el.submitRegistration.addEventListener("click", submitRegistration);
  el.acceptRules.addEventListener("click", () => {
    if (!state.tournament || !state.tournament.rules) return;
    state.rulesAccepted = true;
    updateRulesStatus();
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
}


function collectRegistration() {
  const players = [];
  PLAYERS.forEach((n) => {
    if (n === 5 && !playerFilled(5)) return;
    const p = `p${n}`;
    players.push({
      number: n,
      name: val(`${p}-name`),
      ign: val(`${p}-ign`),
      uid: val(`${p}-uid`),
      gender: val(`${p}-gender`),
    });
  });
  return {
    action: "submitRegistration",
    tournamentId: readTournamentId(),
    teamName: val("team-name"),
    leaderEmail: val("p1-email").toLowerCase(),
    leaderPhone: normalizePhone(val("p1-phone")),
    players,
    rulesAccepted: state.rulesAccepted,
    rulesText: state.tournament?.rules || "",
    submittedAt: new Date().toISOString(),
  };
}

function submitRegistration() {
  if (!state.eligibility?.open || !state.rulesAccepted || !state.tournament?.rules) return;
  if (!PAYMENT_BACKEND_URL || !/^https:\/\/script\.google\.com\/macros\/s\//.test(PAYMENT_BACKEND_URL)) {
    setText(el.submitNotice.querySelector("h3"), "Submission is not configured");
    setText(el.submitNotice.querySelector("p"), "Please contact ES Trainers on WhatsApp. No registration was sent.");
    return;
  }
  const payload = collectRegistration();
  const form = document.createElement("form");
  form.method = "POST";
  form.action = PAYMENT_BACKEND_URL;
  form.target = "_blank";
  form.acceptCharset = "UTF-8";
  form.hidden = true;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = JSON.stringify(payload);
  form.appendChild(input);
  document.body.appendChild(form);
  el.submitRegistration.disabled = true;
  setText(el.submitRegistration, "Opening secure submission…");
  form.submit();
  setText(el.submitNotice.querySelector("h3"), "Submission opened in a new tab");
  setText(el.submitNotice.querySelector("p"), "Check the new tab for the server response. Your team is not confirmed until an admin reviews the entry and verifies payment.");
  setTimeout(() => form.remove(), 1000);
  setTimeout(() => {
    el.submitRegistration.disabled = false;
    setText(el.submitRegistration, "Submit registration again");
  }, 2500);
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
