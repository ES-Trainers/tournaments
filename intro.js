/* ES Trainers official website intro.
   Plays ONCE per browsing session: the first page a visitor opens shows a short (about 3 s) brand animation; refreshes and every
   other page of the site do not replay it. It is a plain script (not a module) that runs right after <body> opens so the white
   overlay is there before the first paint, then it loads intro.css and starts the CSS animation.
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
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
  function out() {
    if (finished || !overlay) return;
    overlay.classList.add("es-intro--out");
    later(finish, 520);
  }
  function onKey(e) { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") out(); }

  var PALETTE = ["#1652F0", "#1652F0", "#3d73ff", "#5a8dff", "#09267A", "#0d1d52", "#0B0F17", "#123dbf"];
  var RIBBONS = [ /* [path, strand colours, start delay (s)] ; directions differ: left>right, right>left, top>bottom, bottom>top */
    ["M-100 190 C250 40 520 330 1100 150", ["#0B0F17", "#09267A", "#123dbf"], 1.35],
    ["M1100 830 C760 990 330 700 -100 880", ["#061030", "#0a2a8f", "#0d1d52"], 1.45],
    ["M190 -100 C40 300 330 650 110 1100", ["#0d1d52", "#0B0F17", "#09267A"], 1.55],
    ["M890 1100 C1010 700 700 350 870 -100", ["#09267A", "#061030", "#123dbf"], 1.5],
    ["M1100 30 C800 140 420 -50 -100 120", ["#123dbf", "#0B0F17", "#0a2a8f"], 1.65]
  ];
  function el(tag, cls, ns) { var e = ns ? document.createElementNS(ns, tag) : document.createElement(tag); if (cls) e.setAttribute("class", cls); return e; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  try {
    prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
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
      s.setProperty("--d", rnd(1.2, 1.95).toFixed(2) + "s");
      s.setProperty("--t", rnd(.55, 1.2).toFixed(2) + "s");
      conf.appendChild(p);
    }
    overlay.appendChild(conf);

    var NS = "http://www.w3.org/2000/svg";
    var svg = el("svg", "es-intro__ribbons", NS);
    svg.setAttribute("viewBox", "0 0 1000 1000"); svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    RIBBONS.forEach(function (r, k) {
      r[1].forEach(function (col, j) {
        var path = el("path", "", NS);
        path.setAttribute("d", r[0]); path.setAttribute("pathLength", "1");
        path.setAttribute("stroke", col); path.setAttribute("stroke-width", String(34 - j * 7));
        path.setAttribute("transform", "translate(" + (j * 9) + "," + (j * 11) + ")");
        path.style.setProperty("--t", (r[2] + j * 0.06 + k * 0.01).toFixed(2) + "s");
        svg.appendChild(path);
      });
    });
    overlay.appendChild(svg);

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
      later(out, 2550); /* about 2.6 s of animation, then a 0.45 s fade into the site */
    };
    link.onerror = finish;
    document.head.appendChild(link);
    later(function () { if (!overlay.classList.contains("es-intro--go")) finish(); }, 1800); /* stylesheet never arrived */
    later(finish, 4500); /* absolute safety net */
  } catch (e) { finish(); }
})();
