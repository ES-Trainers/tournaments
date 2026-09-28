/**
 * ES TRAINERS — Main Entry Point
 * ------------------------------------------------------------
 * Loaded as a module (see index.html: <script type="module">),
 * so this only runs after config.js has already set window.ES_CONFIG.
 */

import { initRoutes, initNavbar, initMobileMenu, initWhatsappCta } from "./ui.js";
import { initScrollReveal } from "./animations.js";
import { initTournaments } from "./tournaments.js";
import { initInstagramSection } from "./instagram.js";
import { startTournamentStore } from "./tournament-store.js";
import { initCardTilt } from "./card-tilt.js";

document.addEventListener("DOMContentLoaded", () => {
  initRoutes();
  initNavbar();
  initMobileMenu();
  initWhatsappCta();
  initScrollReveal();
  initCardTilt();

  // Both consumers register BEFORE the listeners start, so the very
  // first Firebase snapshot already reaches them. The tournament grid
  // and the Instagram section share one listener per Firebase project —
  // registering twice here never opens a second connection.
  initTournaments();
  initInstagramSection();
  startTournamentStore();
});
