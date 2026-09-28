/**
 * ES TRAINERS — UI Behavior
 * ------------------------------------------------------------
 * Navbar scroll state + mobile menu open/close/focus handling.
 * No animation logic lives here — see animations.js.
 */

/**
 * Sets the href of every [data-route="<key>"] link from
 * ES_CONFIG.routes, so js/config.js is the single source of truth for
 * internal links. Unknown keys are logged and the link keeps its
 * (equivalent) static fallback href.
 */
export function initRoutes() {
  const routes = window.ES_CONFIG?.routes || {};
  document.querySelectorAll("[data-route]").forEach((link) => {
    const key = link.getAttribute("data-route");
    if (routes[key]) {
      link.setAttribute("href", routes[key]);
    } else {
      console.error(`[ES Trainers] Unknown route key "${key}" in data-route.`);
    }
  });
}

export function initNavbar() {
  const nav = document.querySelector(".nav");
  if (!nav) return;

  const setScrolled = () => {
    nav.classList.toggle("nav--scrolled", window.scrollY > 12);
  };
  setScrolled();
  window.addEventListener("scroll", setScrolled, { passive: true });
}

export function initMobileMenu() {
  const toggle = document.querySelector(".nav__toggle");
  const menu = document.getElementById("mobile-menu");
  if (!toggle || !menu) return;

  const links = menu.querySelectorAll("a");

  const open = () => {
    menu.classList.add("mobile-menu--open");
    toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");
    const firstLink = links[0];
    if (firstLink) firstLink.focus();
  };

  const close = ({ restoreFocus = true } = {}) => {
    menu.classList.remove("mobile-menu--open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("no-scroll");
    if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => {
    const isOpen = menu.classList.contains("mobile-menu--open");
    if (isOpen) close(); else open();
  });

  links.forEach((link) => link.addEventListener("click", () => close({ restoreFocus: false })));

  menu.addEventListener("click", (event) => {
    if (event.target === menu) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("mobile-menu--open")) {
      close();
    }
  });
}

export function initWhatsappCta() {
  const buttons = document.querySelectorAll("[data-whatsapp-cta]");
  const url = window.ES_CONFIG?.whatsappCommunityUrl;

  buttons.forEach((button) => {
    if (url) {
      button.href = url;
      button.removeAttribute("aria-disabled");
    } else {
      button.href = "#";
      button.setAttribute("aria-disabled", "true");
      button.addEventListener("click", (event) => event.preventDefault());
      const label = button.querySelector("[data-whatsapp-label]");
      if (label) label.textContent = "Community link coming soon";
    }
  });
}
