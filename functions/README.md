# ES Trainers — Registration Backend (Phase 2.2)

One Cloud Functions codebase, deployed **twice**: once into the BGMI
Firebase project (`bgmi-firebase`), once into the FF MAX project
(`ff-max-firebase`). Each deployment accepts only its own game (`GAME`
in `.env.<project-id>`), so a registration can never land in the wrong
project.

- Function: `submitRegistration` (callable, v2) — region `us-central1`
  (must match `registration.functionsRegion` in `js/config.js`).
- Runtime: Node 22 (`firebase.json` + `engines`). Node 20 is at/near end
  of support; if the CLI complains at deploy time, follow its message.
- **Blaze plan is required in BOTH projects** to deploy functions.

## Deploy (run from the repo root)

```bash
npm install -g firebase-tools && firebase login
(cd functions && npm install)

# BGMI project
firebase use bgmi
firebase deploy --only functions:submitRegistration,firestore:rules

# FF MAX project
firebase use ffmax
firebase deploy --only functions:submitRegistration,firestore:rules
```

`firebase use <alias>` also selects which `.env.<project-id>` file is
loaded (`GAME=bgmi` / `GAME=ffmax`).

## Verify deployment (do this — do not assume)

```bash
firebase use bgmi  && firebase functions:list      # expect submitRegistration  v2  callable  us-central1
firebase use ffmax && firebase functions:list      # same, in the OTHER project
firebase use bgmi  && firebase functions:log --only submitRegistration
```

Then open `/bgmi/register.html?id=<real id>` with DevTools open and
submit. A structured reason (e.g. `TEAM_NAME_ALREADY_EXISTS`) or success
proves the function answered. If the browser shows "couldn't reach the
registration service", the console line beginning
`Callable "submitRegistration" did not respond` prints the project,
region and Firebase error code — almost always "not deployed to that
project/region".

If the callable is deployed but the browser is refused, check that the
function allows public invocation in Cloud Run (callable functions are
deployed with public invoker access by default; an organisation policy
can block that).

## Data written (per project)

| Collection | Document ID | Notes |
|---|---|---|
| `registrations` | `reg_<hash of tournamentId + requestId>` | status/paymentStatus `pending`, `teamNumber: null`, server `registeredAt`; **no** email/phone |
| `privateRegistrations` | same ID | `player1Email`, `player1Phone` |
| `teamNames` | `<tournamentId>_<sha256(normalized name)>` | `status` (`pending` → later `confirmed`/`released`), `reservedAt`, `expiresAt`, `registrationId` |

Reservation lifecycle: a **pending** reservation blocks the name until
`expiresAt` (30 min; override with `RESERVATION_TTL_MINUTES`). After
that the next submission for that name takes it over inside its own
transaction and marks the old, still-unpaid registration `expired`. The
payment phase must set the reservation to `confirmed` (never expires)
on verified payment. Optional: add a Firestore TTL policy on
`teamNames.expiresAt` for housekeeping — correctness does not depend
on it, and it must NOT be used for `confirmed` entries once those exist
(give confirmed entries no `expiresAt`).

## App Check (prepared, NOT active)

Not configured. Once App Check is set up for the web apps in both
projects, set `ENFORCE_APP_CHECK=true` in `.env.<project-id>` and
redeploy; the client must then also initialise App Check.

## Tests

```bash
cd functions && npm install
npm test               # backend logic against an in-memory Firestore fake
npm run test:rules     # Security Rules against the Local Emulator (needs firebase-tools + Java)
```

From the repo root: `python3 tests/ui_test.py` (needs `playwright`).

## Never

Never commit service-account JSON or secrets. Never hand-edit
`registeredTeams` here — it changes only after verified payment in a
later phase.
