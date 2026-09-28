/**
 * ES TRAINERS — Scroll Animations
 * ------------------------------------------------------------
 * IntersectionObserver-driven reveals only — no scroll listeners
 * for animation (scroll listener in ui.js is for navbar state only,
 * and is passive). Respects prefers-reduced-motion by skipping the
 * observer entirely and showing everything immediately.
 */

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let observer = null;

function getObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  return observer;
}

function revealAllImmediately(root = document) {
  root.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-revealed"));
}

function observeNewReveals(root = document) {
  if (reduceMotionQuery.matches) {
    revealAllImmediately(root);
    return;
  }
  const obs = getObserver();
  root.querySelectorAll("[data-reveal]:not(.is-revealed)").forEach((el) => obs.observe(el));
}

export function initScrollReveal() {
  if (reduceMotionQuery.matches) {
    revealAllImmediately();
    return;
  }
  observeNewReveals(document);
}

// Exposed so tournaments.js can hook newly-injected Firebase cards
// into the same reveal system without a circular import.
window.ESAnimations = { observeNewReveals };
