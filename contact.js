/**
 * ES TRAINERS — Contact page script (contact.js)
 * ------------------------------------------------------------
 * Static page: no database, no network calls. It only does the shared
 * page behaviour: navbar state, mobile menu and scroll reveal.
 */

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

  menu.addEventListener("click", (event) => {
    if (event.target === menu) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("mobile-menu--open")) close();
  });
}

/* ---- Scroll reveal: IntersectionObserver only; reduced motion
        skips the observer and shows everything at once. ---- */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let revealObserver = null;

function getRevealObserver() {
  if (revealObserver) return revealObserver;
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  return revealObserver;
}

function observeNewReveals(root = document) {
  if (reduceMotion.matches) {
    root.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-revealed"));
    return;
  }
  const obs = getRevealObserver();
  root.querySelectorAll("[data-reveal]:not(.is-revealed)").forEach((el) => obs.observe(el));
}

initNavbar();
initMobileMenu();
observeNewReveals(document);
