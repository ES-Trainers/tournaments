/* ES Trainers official website intro.
   Plays ONCE per browsing session: the first page a visitor opens shows a short (about 3 s) brand animation; refreshes and every
   other page of the site do not replay it. It is a plain script (not a module) that runs right after <body> opens so the white
   overlay is there before the first paint, then it loads intro.css and starts the CSS animation. Final stage: the centre logo flies into the navbar logo and replaces it.
   Safe by design: no storage / reduced motion / any error = no intro, and the site is never blocked (the overlay is removed by a
   timer no matter what). It touches no site data, no Firebase and no other script. */
(function () {
  "use strict";
  var KEY = "es_intro_v1";
  var root = document.documentElement;
  var overlay = null, link = null, finished = false, prevOverflow = "", timers = [];

  /* 1. once per browsing session. The flag is written BEFORE playing so a refresh (or another page) during the intro never replays it.
        If sessionStorage is unavailable we cannot remember anything, so we play nothing rather than replay on every page. */
  try {
    if (window.sessionStorage.getItem(KEY)) return;
    window.sessionStorage.setItem(KEY, "1");
    if (window.sessionStorage.getItem(KEY) !== "1") return;
  } catch (e) { return; }
  /* 2. respect reduced motion */
  try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) { return; }
  if (!document.body) return;

  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function finish() {
    if (finished) return; finished = true;
    timers.forEach(clearTimeout);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pagehide", finish);
    root.style.overflow = prevOverflow;
    root.classList.remove("es-intro-on");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
  function out() {
    if (finished || !overlay) return;
    root.classList.remove("es-intro-on");
    overlay.classList.add("es-intro--out");
    later(finish, 520);
  }
  /* Final stage: the centre logo travels to the navbar logo, lands exactly on it, then the overlay is removed so it looks like the
     intro logo has become the navbar logo. Falls back to a plain fade-out if anything is missing. */
  function fly() {
    if (finished || !overlay) return;
    var logo = overlay.querySelector(".es-intro__logo");
    var target = document.querySelector(".nav .brand__mark");
    if (!logo || !target || !logo.animate) { out(); return; }
    var from = logo.getBoundingClientRect(), to = target.getBoundingClientRect();
    if (!from.width || !to.width) { out(); return; }
    var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    var dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    var sc = to.width / from.width;
    overlay.classList.add("es-intro--fly"); /* white fades away, glow fades away, site appears underneath */
    var anim = logo.animate([
      { transform: "translate(0px,0px) scale(1)", boxShadow: "0 14px 44px rgba(22,82,240,.3), 0 0 0 1px rgba(22,82,240,.08)" },
      { transform: "translate(" + dx.toFixed(2) + "px," + dy.toFixed(2) + "px) scale(" + sc.toFixed(4) + ")", boxShadow: "0 0 0 0 rgba(22,82,240,0), 0 0 0 0 rgba(22,82,240,0)" }
    ], { duration: 900, easing: "cubic-bezier(.65,0,.2,1)", fill: "forwards" });
    function land() {
      if (finished) return;
      root.classList.remove("es-intro-on"); /* real navbar logo shows, exactly under the flying one */
      requestAnimationFrame(finish);        /* then the overlay disappears: no visible jump */
    }
    anim.onfinish = land;
    later(land, 1100); /* safety if onfinish never fires */
  }
  function onKey(e) { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") out(); }

  var PALETTE = ["#1652F0", "#1652F0", "#3d73ff", "#5a8dff", "#09267A", "#0d1d52", "#0B0F17", "#123dbf"];
  function el(tag, cls, ns) { var e = ns ? document.createElementNS(ns, tag) : document.createElement(tag); if (cls) e.setAttribute("class", cls); return e; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  try {
    prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    root.classList.add("es-intro-on");
    overlay = el("div", "es-intro");
    /* inline minimum so the page is covered immediately, before intro.css has loaded */
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#fff;overflow:hidden";
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("role", "presentation");
    overlay.appendChild(el("div", "es-intro__glow"));

    var conf = el("div", "es-intro__confetti");
    var n = (window.innerWidth || 800) < 520 ? 30 : 46;
    for (var i = 0; i < n; i++) {
      var p = el("i", Math.random() < .18 ? "tri" : Math.random() < .12 ? "dot" : "");
      var x = rnd(2, 98), long = Math.random() < .22, w = long ? rnd(5, 7) : rnd(9, 14), h = long ? rnd(20, 30) : rnd(12, 19);
      var s = p.style;
      s.setProperty("--x", x.toFixed(1) + "vw");
      s.setProperty("--dx", ((50 - x) * rnd(.25, .5) + rnd(-6, 6)).toFixed(1) + "vw"); /* drift toward the centre */
      s.setProperty("--s", rnd(-4, 4).toFixed(1) + "vw");
      s.setProperty("--r", Math.round(rnd(300, 900) * (Math.random() < .5 ? -1 : 1)) + "deg");
      s.setProperty("--w", w.toFixed(1) + "px"); s.setProperty("--h", h.toFixed(1) + "px");
      s.setProperty("--c", PALETTE[(Math.random() * PALETTE.length) | 0]);
      s.setProperty("--d", rnd(1.1, 1.45).toFixed(2) + "s");
      s.setProperty("--t", rnd(.35, .8).toFixed(2) + "s");
      conf.appendChild(p);
    }
    overlay.appendChild(conf);

    var img = el("img", "es-intro__logo");
    img.src = "assets/logo/logo.png"; img.alt = ""; img.width = 210; img.height = 210; img.decoding = "async";
    overlay.appendChild(img);

    document.body.insertBefore(overlay, document.body.firstChild);
    overlay.addEventListener("click", out);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("pagehide", finish);

    /* load the stylesheet only now; start the animation when it is ready. If it cannot load, drop the overlay. */
    link = el("link"); link.rel = "stylesheet"; link.href = "intro.css";
    link.onload = function () {
      if (finished) return;
      overlay.removeAttribute("style"); /* intro.css takes over */
      overlay.classList.add("es-intro--go");
      later(fly, 2300); /* logo + confetti for about 2.3 s, then the logo flies to the navbar (0.9 s) */
    };
    link.onerror = finish;
    document.head.appendChild(link);
    later(function () { if (!overlay.classList.contains("es-intro--go")) finish(); }, 1800); /* stylesheet never arrived */
    later(finish, 5500); /* absolute safety net */
  } catch (e) { finish(); }
})();
