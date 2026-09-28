/**
 * ES TRAINERS — Card Tilt
 * ------------------------------------------------------------
 * Subtle pointer-driven tilt/parallax for elements marked
 * [data-tilt] (the BGMI / FF MAX game cards). Sets --mx/--my
 * CSS custom properties in the range -0.5..0.5; all actual
 * transforms live in CSS so this stays cheap and declarative.
 *
 * Skipped entirely on touch/coarse pointers and when the user
 * prefers reduced motion — mobile keeps the plain tap/hover
 * fallback already defined in CSS.
 */

export function initCardTilt() {
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!canHover || reduceMotion) return;

  const cards = document.querySelectorAll("[data-tilt]");

  cards.forEach((card) => {
    let frame = null;

    const setTilt = (x, y) => {
      const rect = card.getBoundingClientRect();
      const mx = (x - rect.left) / rect.width - 0.5;
      const my = (y - rect.top) / rect.height - 0.5;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.setProperty("--mx", mx.toFixed(3));
        card.style.setProperty("--my", my.toFixed(3));
      });
    };

    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      card.style.setProperty("--mx", 0);
      card.style.setProperty("--my", 0);
    };

    card.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      setTilt(event.clientX, event.clientY);
    });
    card.addEventListener("pointerleave", reset);
    card.addEventListener("blur", reset);
  });
}
