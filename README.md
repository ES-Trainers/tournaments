# ES Trainers — Homepage

Static homepage for the ES Trainers esports tournament platform, built for
GitHub Pages at **estrainers.in**. This is the foundation only — BGMI/FF MAX
pages, registration, history and the admin panel are not built yet, but the
code is structured so none of it requires rewriting this homepage.

## File structure

```
index.html
css/
  style.css        design tokens + base + all component styles (mobile-first)
  responsive.css    breakpoint overrides (480 / 640 / 768 / 1024 / 1280px)
  animations.css    keyframes + scroll-reveal utility classes
js/
  config.js         site-wide constants (routes, WhatsApp link, feature flags)
  firebase-bgmi.js  BGMI Firebase project — init + realtime listener
  firebase-ffmax.js FF MAX Firebase project — init + realtime listener
  tournament-store.js shared state from both listeners, one per project
  tournaments.js    renders + patches tournament cards from the store
  instagram.js      Instagram section tournament status, from the same store
  ui.js             navbar scroll state, mobile menu, WhatsApp CTA wiring
  animations.js      IntersectionObserver scroll-reveal, reduced-motion aware
  main.js           entry point, wires everything together on DOMContentLoaded
assets/
  logo/   ffmax/   bgmi/   icons/   — see PLACE_*.txt in each folder
firestore.rules.example   starter security rules for the tournaments collection
```

## 1. Local preview

No build step. Any static server works, e.g.:

```
npx serve .
```

Opening `index.html` directly also works, but Firebase's module imports
prefer being served over http(s), so a local server is recommended.

## 2. Firebase

Two **separate** Firebase projects are already wired in, exactly as supplied:

- `bgmi-firebase` → `js/firebase-bgmi.js`
- `ff-max-firebase` → `js/firebase-ffmax.js`

Both only **read** from a `tournaments` collection right now. Nothing is
written from the frontend. Apply `firestore.rules.example` in both projects
(Firestore → Rules) so the homepage can read tournament data publicly while
everything else stays locked down.

Expected shape of a document in `tournaments`:

```js
{
  title: "ES Trainers BGMI Tournament #01",
  date: <Firestore Timestamp | ISO string | plain date string>,
  match: "Erangel",            // FF MAX example: "Classic"
  entryFee: "200 / team",
  prizePool: "5,000",
  maxTeams: 25,                // number, not a string
  registeredTeams: 0,          // number, not a string
  status: "registration_open"  // registration_open | live | completed
}
```

`maxTeams` and `registeredTeams` must stay Firestore **numbers**. The
site reads them as-is and only joins them into `0 / 25 teams` at
display time — no parsing, no casting. If either is stored as a string
the Slots row is hidden rather than rendered wrong.

`match` replaced the old `format` field. The site reads `data.match`
and labels the row **Match**; `format` is no longer read anywhere.

### Status values

| status              | tournament card | Instagram section        |
|---------------------|-----------------|--------------------------|
| `registration_open` | shown           | REGISTRATION OPEN + title |
| `upcoming` / `open` | shown           | UPCOMING TOURNAMENT + title (`open` counts as registration open) |
| `live`              | shown, LIVE pill| TOURNAMENT LIVE + title  |
| `completed`         | drops off       | falls back to the next relevant tournament, or the normal state |

The Instagram section shows every tournament sitting at the highest
priority currently present — live > registration open > upcoming — so
BGMI and FF MAX both appear when both are at that level, side by side.

Anything not in that list is ignored by the homepage listeners.

### Realtime

Both projects are read with Firestore `onSnapshot()` listeners — never
polling, never `setInterval`, never a repeated `getDocs()`. Exactly one
listener is attached per project per page load (guarded inside each
`firebase-*.js`), and both the tournament grid and the Instagram section
read from the same shared store, so adding a consumer never adds a
connection.

When a value changes, only the DOM node holding that value is rewritten.
Cards are never rebuilt, the loading state never returns after the first
snapshot, and an identical snapshot mutates nothing at all. If a listener
drops, the last received tournament data stays on screen under a quiet
"Reconnecting" line instead of being replaced by an error screen.

Add real documents to either project's `tournaments` collection and the
homepage renders them automatically — no code changes needed. With no
documents (or if a project is unreachable), the homepage shows the
"No tournament announced yet" empty state, and each game's Firebase
project fails independently: BGMI going down never breaks the FF MAX
cards or the rest of the page.

> Firestore may ask for a composite index the first time it runs the
> tournaments query (`status in [...]` + `orderBy date`). If the console
> logs an index link, open it once and click Create.

## 2b. Instagram

The site never embeds posts, never loads an Instagram iframe, never calls
the Instagram Graph API or OAuth, and never stores post data, captions or
thumbnails. It communicates two things: that ES Trainers publishes every
update on Instagram, and what the current tournament state is according
to Firebase. Posts, reels, schedules, results and announcements are
managed entirely from Instagram.

The account is set once, in `js/config.js`:

```js
instagram: {
  handle: "@es_trainers",
  profileUrl: "https://www.instagram.com/es_trainers/"
}
```

Every Instagram link, button and handle on the page reads from those two
values — the URL is not repeated anywhere in the HTML or JS.

## 2c. Admin panel contract

The admin panel is not built yet. When it is, its only job for this
feature is to write one field:

```js
status: "live"        // Start Live
status: "completed"   // End Tournament
status: "registration_open"
```

Instagram is not involved in that write and does not control anything:
it is only where ES Trainers publishes updates. No Instagram API, no
OAuth, no post management. The panel just tells the website "this
tournament is currently live", and the public site picks that up through
the realtime listener with no refresh.

Writes need authentication: `firestore.rules.example` keeps
`allow write: if false` and shows where the admin check goes. Until the
panel exists, flip `status` by hand in the Firebase Console — the live
site reacts within a second.

## 3. WhatsApp Community link

Not hard-coded anywhere. Set it once, in `js/config.js`:

```js
whatsappCommunityUrl: "https://chat.whatsapp.com/your-invite-code"
```

Every WhatsApp button on the page (`[data-whatsapp-cta]`) reads from this one
value. Until it's set, those buttons render disabled with a
"Community link coming soon" label.

## 4. Razorpay

Not used on this homepage (by design — see spec sections 21/36). A `future`
block already exists in `config.js` for the Key ID once the registration
flow is built. **Never** put the Razorpay Key Secret in any frontend file —
order creation and payment verification belong in a Cloud Function, per the
flow documented inline in `config.js`.

## 5. Adding the BGMI / FF MAX pages later

`config.js` already defines the routes (`/bgmi/`, `/ff-max/`, etc.) and every
link on the homepage points at them. To add a page:

1. Create `bgmi/index.html` (and `ff-max/index.html`) reusing
   `css/style.css` + `css/responsive.css` + `css/animations.css`.
2. Reuse `firebase-bgmi.js` / `firebase-ffmax.js` for that game's data —
   don't duplicate the Firebase init logic.
3. No changes needed on the homepage; its links already resolve once these
   pages exist.

Registration (`/bgmi/register/`, `/ff-max/register/`), history
(`/bgmi/history/`, `/ff-max/history/`) and `/admin/` follow the same pattern:
new folders, same shared CSS/JS foundation, `config.js` already has the
routes reserved.

## 6. GitHub Pages deployment

1. Push this folder to a GitHub repository (e.g. `estrainers-web`).
2. Repo → Settings → Pages → Source: deploy from the `main` branch, root
   folder.
3. Confirm `index.html` is at the repo root (as in this structure).

## 7. Custom domain (estrainers.in)

1. Repo → Settings → Pages → Custom domain → enter `estrainers.in`. GitHub
   creates a `CNAME` file at the repo root automatically — don't delete it.
2. At your DNS provider, add:
   - Four `A` records for the apex domain pointing to GitHub Pages' IPs
     (`185.199.108.153`, `.109.153`, `.110.153`, `.111.153`)
   - A `CNAME` record for `www` pointing to `<username>.github.io`
3. Wait for DNS propagation, then enable **Enforce HTTPS** in the Pages
   settings once GitHub issues the certificate.

## 8. Logo

The official logo is in place (`assets/logo/logo.png`, plus generated
favicon sizes) and used in the navbar, footer, favicon, and as the centered
glowing mark in the hero. If you get a vector version later, drop
`logo.svg` in the same folder and swap the `<img>` `src` attributes for a
sharper result at large sizes — the PNG currently in place is optimized for
web weight (512px, ~290KB).

## 9. Game artwork (still needed)

No licensed BGMI or FF MAX art has been supplied, and real game key art
is licensed IP that shouldn't be scraped — so both game cards use an
**original cinematic scene drawn in SVG**, composed to read as that
game's tournament rather than as generic abstract decoration:

- **BGMI** — night ridgelines, a transport plane on its drop run,
  parachutes descending, a rim-lit trooper silhouette holding the ridge,
  a tactical bearing strip and target bracket. Green is a rim-light and
  HUD accent, not the whole card.
- **FF MAX** — a burning skyline with lit windows, a glider dropping
  into the city, a rim-lit operator mid-push, drifting embers and an
  angular reticle HUD. Orange/red is the accent.

Both sit under a readability gradient so the white text keeps strong
contrast, and both scale cleanly from mobile to desktop.

To drop in licensed art later, set one CSS variable per card — no markup
changes needed. See `assets/bgmi/PLACE_ASSETS_HERE.txt` and
`assets/ffmax/PLACE_ASSETS_HERE.txt` for the exact snippet.

An `og:image` (social share preview) is also set to the logo for now —
swap it for a proper banner image once you have one.
