# TripLite

TripLite is a travel planning dashboard for organizing trips, tracking budgets, managing a packing checklist, and recording travel expenses.

## Features

- Dashboard with trip count, total trip budget, recorded expenses, and packing progress.
- Create, view, edit, and delete trips. Trip records are stored in MongoDB.
- Trip cards show each trip's budget, linked expenses, and remaining budget or over-budget amount.
- Per-trip packing checklists with standard essentials, add, check off, and delete actions. Checklist data is stored in account/trip-scoped browser localStorage.
- Expense tracking with optional trip assignment, all/trip/unassigned filters, expense totals, and delete actions. Expense data is stored in browser localStorage.
- Account registration and sign-in with MongoDB-backed server sessions and owner-scoped trips.
- Expenses are stored in account-scoped browser localStorage; packing checklists are scoped to both account and trip.
- Responsive navigation and layouts for desktop and mobile screens.

## Tech stack

- HTML, CSS, and vanilla JavaScript
- Node.js and Express
- MongoDB and Mongoose
- dotenv for environment variables
- express-session and connect-mongo for server-side sessions
- bcryptjs for password hashing and express-rate-limit for authentication throttling

## Project structure

```text
TripLite/
├── client/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── server/
│   ├── server.js
│   ├── models/trip.js
│   ├── models/user.js
│   └── tests/auth.test.js
├── scripts/claim-legacy-trips.js
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
└── requirements.txt
```

Trip API routes and server startup are in `server/server.js`. The Mongoose trip schema is in `server/models/trip.js`. Frontend markup, styles, and browser behavior are in `client/`.

## Prerequisites

- Node.js 20.8 or newer and npm.
- MongoDB running locally, or a MongoDB connection URI that the developer can access.
- Git to clone the repository.

## Set up a local checkout

Clone the team's GitHub repository (replace the placeholder with its clone URL):

```sh
git clone <repository-url>
cd TripLite
```

Install the dependencies declared in `package.json`:

```sh
npm install
```

Create a local `.env` file from the example:

```sh
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead. `.env` is ignored by Git; keep local credentials and connection strings there and do not commit them.

The example configuration is:

```dotenv
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/triplite
SESSION_SECRET=
TRUST_PROXY_HOPS=0
```

`PORT` defaults to `3000`, and `MONGODB_URI` defaults to the local `triplite` database shown above. `SESSION_SECRET` is required and must contain at least 32 bytes. Generate one locally and put it only in `.env`:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`TRUST_PROXY_HOPS` defaults to `0`. Set it to the number of trusted reverse-proxy hops only when deploying behind a proxy that sets forwarded protocol headers. `.env` is ignored by Git. Never use the example file for real secrets.

## Start MongoDB

Start the MongoDB server/service using the instructions for the operating system and MongoDB installation on the development machine. Installation paths, service names, and startup commands differ across Windows, macOS, Linux, and package or container setups. Make sure the configured `MONGODB_URI` points to the running instance before starting TripLite. Mongoose connects to the `triplite` database in the default local configuration.

## Run TripLite

Development mode runs the server through nodemon:

```sh
npm run dev
```

The production/start script runs Node directly:

```sh
npm start
```

These are the `dev` and `start` scripts defined in `package.json`. The server listens on the configured `PORT` after MongoDB connects successfully. Open the application at `http://localhost:3000/` when using the default port (replace `3000` if you changed `PORT`).

Check backend health at:

```text
http://localhost:3000/api/health
```

The JSON response reports whether the database connection is `connected` or `disconnected`. In the current implementation, Express starts listening only after the MongoDB connection succeeds, so a failed initial connection exits the server before the health endpoint is available.

## Authentication and sessions

Open the site and create an account with a name, email, and password of at least 12 characters (up to 72 UTF-8 bytes). Email addresses are trimmed and lowercased. Passwords are bcrypt-hashed; account/profile responses never include the hash.

The browser receives a signed session identifier in an `HttpOnly`, `SameSite=Lax` cookie. The identifier is stored server-side in MongoDB's `triplite_sessions` collection. Sessions expire after 30 minutes idle and 12 hours absolute. Login and registration regenerate the session ID. Logout destroys the stored session. Production cookies are `Secure`; production must use HTTPS. If HTTPS terminates at a reverse proxy, configure `TRUST_PROXY_HOPS` carefully.

State-changing requests require a session-bound CSRF token obtained from `GET /api/auth/csrf`; the frontend keeps the token in memory and sends it in `X-CSRF-Token`. The server also checks Origin/Referer hosts when browsers supply those headers. Authentication attempts are rate limited in the current process; deployments with multiple server instances should use a shared rate-limit store.

The authenticated dashboard displays only trips whose owner is the current session user. The server never accepts an owner ID from trip request bodies. Trips that predate accounts have no owner and are hidden from all account queries.

Expenses and packing items remain in localStorage. New expense keys are namespaced by account; packing keys are namespaced by account and trip. This prevents the app UI from loading another account's records after switching users in one browser. localStorage is not encrypted or server-enforced private data: someone with access to the same browser profile or developer tools can inspect it, and it does not sync across devices. Existing unscoped `triplite-expenses` and `triplite-packing` records are not loaded or changed automatically. After sign-in, visit Packing Checklist, choose a trip, and use **Review and import** to explicitly copy the old data into one account. A browser's legacy records can be claimed only once; the app will not offer them to a second account after claiming. Choose the intended account carefully. The original keys remain in place for manual recovery if needed. Old expense links to ownerless trips import as unassigned.

## API routes

All trip request bodies use JSON. Trip IDs in path parameters are MongoDB document IDs.

| Method and path | Purpose | Request requirements |
| --- | --- | --- |
| `GET /api/health` | Report server and MongoDB connection state. | No body. |
| `GET /api/auth/csrf` | Create or return the current session's CSRF token. | No body. |
| `POST /api/auth/register` | Register an account and sign it in. | JSON `name`, `email`, `password`, and `passwordConfirmation`. |
| `POST /api/auth/login` | Sign in and rotate the session ID. | JSON `email` and `password`. |
| `GET /api/auth/me` | Return the current safe account profile. | Authenticated session required. |
| `POST /api/auth/logout` | Destroy the current session. | Authenticated session and CSRF token required. |
| `GET /api/trips` | Return only the current user's trips, newest first, and count. | Authenticated session required. |
| `GET /api/trips/:id` | Return a trip only when it belongs to the current user. | Authenticated session required. |
| `POST /api/trips` | Create a trip owned by the current session user. | Authenticated session and CSRF token; JSON `name`, `destination`, `startDate`, `endDate`, `travellers`, and `budget`. |
| `PUT /api/trips/:id` | Update only a trip owned by the current user. | Authenticated session and CSRF token; partial trip fields. |
| `DELETE /api/trips/:id` | Delete only a trip owned by the current user. | Authenticated session and CSRF token. |

Validation errors generally return `400`; unauthenticated requests return `401`; a missing or another user's trip returns `404`; CSRF/origin failures return `403`; unexpected route failures return generic `500` messages. API responses use a `success` flag and a message, with trip data returned in `data` on successful trip requests.

Example create request body:

```json
{
  "name": "Coastal weekend",
  "destination": "Goa",
  "startDate": "2026-11-06",
  "endDate": "2026-11-08",
  "travellers": 2,
  "budget": 25000
}
```

## Data and current limitations

- MongoDB stores users, trips, and server sessions. localStorage expenses and packing items are not synced between browsers or devices and are not included in MongoDB backups.
- Expenses are browser-local records, not a server API or database collection. Trip filters and budget summaries use the local expense records.
- Browser localStorage namespacing is UI isolation, not encryption or server-enforced confidentiality. Do not use it for sensitive financial or medical records.
- The project does not include a deployment configuration or automated production build step.

## Legacy trip migration

Do not run a migration until you have reviewed and backed up the intended MongoDB database. Ownerless records remain untouched and invisible to normal accounts. To assign all ownerless trips to one existing account, first back up MongoDB, then run a dry run:

```sh
node scripts/claim-legacy-trips.js --email=account@example.com
```

Review the count and the chosen account. To apply that exact ownerless-only update, run:

```sh
node scripts/claim-legacy-trips.js --email=account@example.com --apply
```

The script refuses accounts that do not already exist, updates only records with no owner, and leaves owned records unchanged, so rerunning it does not transfer claimed trips. This is an owner-controlled action and should not be run as part of signup. Example backup command (run against the same URI configured in `.env`):

```sh
mongodump --uri="$MONGODB_URI" --archive=triplite-before-auth.archive.gz --gzip
```

On PowerShell, use `$env:MONGODB_URI` in place of the shell variable. No migration was run as part of this change.

## Tests

Run syntax checks and the test runner with:

```sh
node --check server/server.js
node --check client/js/app.js
npm test
```

The authentication integration tests require `MONGODB_TEST_URI`. Set it to a dedicated disposable MongoDB database whose name contains `test`; the runner creates a unique suffixed database and drops only that database afterward. Do not point it at the normal application database. Without that variable the integration suite is reported as skipped.

## Troubleshooting

### MongoDB connection fails

Confirm that the MongoDB service is running and that `MONGODB_URI` in the local `.env` file points to the correct host, port, and database. The default URI expects local MongoDB at `127.0.0.1:27017`. The server logs a connection error and exits if its initial connection fails.

### Environment values are not taking effect

Ensure `.env` is at the project root, beside `package.json`, and uses the variable names `PORT` and `MONGODB_URI`. The server loads it with dotenv. If a variable is omitted, the defaults above apply. Restart the server after changing `.env`.

### Dependency installation fails

Run `npm install` from the project root and confirm Node.js and npm are available with `node --version` and `npm --version`. If installation cannot reach the npm registry, check the network, proxy, and registry configuration used by the team.

### Port 3000 is already in use

Stop the other process using that port, or set another available port in `.env`, for example `PORT=3001`. Restart the app and open both the site and `/api/health` on that port.

### The browser opens but trip data does not load

Check the server terminal for startup or API errors and confirm MongoDB is available. The frontend is served by Express; opening `client/index.html` directly from disk does not start the API.
