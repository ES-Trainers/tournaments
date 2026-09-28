/**
 * ES TRAINERS — Global Configuration
 * ------------------------------------------------------------
 * This is the ONLY file that should contain site-wide constants:
 * routes, external links, and feature flags. Nothing here is a
 * secret — Firebase Web config and Razorpay Key ID are safe to
 * ship to the browser. Never add Admin SDK keys, service account
 * JSON, Razorpay Key Secret, or SMTP credentials to this file or
 * any frontend file.
 *
 * Everything under FUTURE is unused today. It exists so the
 * pages built later (registration, history, admin) don't require
 * touching this file's shape — only its values.
 */

window.ES_CONFIG = {

  brand: {
    name: "ES Trainers",
    tagline: "Play. Improve. Compete. Win.",
    domain: "https://estrainers.in",
    contactEmail: "esportstraning@gmail.com"
  },

  // Set this once the official WhatsApp Community link exists.
  // Until then, the CTA button renders in a disabled "coming soon" state.
  whatsappCommunityUrl: "https://chat.whatsapp.com/LsbpYeU4OJ5CWVYsqDN5Es",

  // Canonical status meaning "registration is open". Used by the
  // homepage, the registration page AND the Cloud Function. Legacy
  // "open" is NOT supported anywhere; migrate any such document.
  registrationOpenStatus: "registration_open",

  // ROUTES — the single source of truth for every internal link.
  //
  // Only pages/sections that ACTUALLY EXIST are listed. Static HTML
  // links carry data-route="<key>" and js/ui.js (initRoutes) sets their
  // href from this object on every page, so a route is changed here
  // once. The href written in the HTML is only a no-JS fallback and
  // must equal the value here (tests/routes_test.py enforces this).
  //
  // There are NO dedicated /bgmi/ or /ff-max/ landing pages, so every
  // "BGMI" / "FF MAX" / "Explore ..." link goes to the homepage
  // tournaments section, where the real Register Now buttons live.
  // Add bgmi/ffmax (or history/admin) keys ONLY when those pages exist.
  //
  // The two register routes are BASE paths: they are only valid with
  // ?id=<Firestore tournament document id> and are built solely by
  // buildRegisterUrl() in js/tournaments.js.
  routes: {
    home: "/",
    tournaments: "/#tournaments",
    about: "/#about",
    rules: "/rules.html",
    bgmiRegister: "/bgmi/register.html",
    ffmaxRegister: "/ff-max/register.html"
  },

  // Official ES Trainers Instagram account. Single source of truth —
  // every Instagram link, button and handle on the site reads from
  // here, so the URL exists exactly once in the codebase. The site
  // never embeds posts, never calls an Instagram API and never
  // fetches a feed; Instagram itself owns all posts, reels, stories
  // and announcements. The only external action is opening the
  // profile in a new tab.
  instagram: {
    handle: "@es_trainers",
    profileUrl: "https://www.instagram.com/es_trainers/"
  },

  tournaments: {
    // Max upcoming tournament cards to render per game on the homepage.
    maxPerGame: 3,
    collectionName: "tournaments",

    // Statuses that still belong in the "Upcoming tournaments" grid.
    upcomingStatusValues: ["upcoming", "registration_open"],

    // Subset of the above that counts as "registration is open".
    // Used by the Instagram section to rank a registration-open
    // tournament above a merely upcoming one.
    registrationOpenStatusValues: ["registration_open"],

    // Status that flips the Instagram section into its LIVE state.
    liveStatusValue: "live",

    // What the realtime listeners actually subscribe to: upcoming
    // statuses + live. "completed" is intentionally excluded so a
    // finished tournament drops off the homepage on its own.
    // Kept as a literal list (not derived) because Firestore's
    // "in" filter needs a plain array and this file is a plain object.
    listenStatusValues: ["upcoming", "registration_open", "live"],

    // Listener page size. Larger than maxPerGame so a live tournament
    // is never missed just because three earlier-dated ones exist —
    // the grid still renders only maxPerGame cards per game.
    listenLimit: 10
  },

  // Phase 2.2: routing for the trusted-backend registration write.
  // Neither value is a secret — it only names which deployed Cloud
  // Function region/name the browser calls; the function itself
  // decides (per its own project's GAME env var) which game it will
  // accept, and does all authoritative validation server-side.
  registration: {
    functionsRegion: "us-central1",
    submitCallableName: "submitRegistration"
  },

  // Reserved for the future payment flow, which will follow: frontend
  // -> Firebase Cloud Function -> create Razorpay order -> Checkout ->
  // server-side signature + webhook verification -> Firestore payment
  // record. The Key ID (not the Key Secret) is safe client-side.
  future: {
    razorpayKeyId: null // set when the payment flow is built
  }

};
