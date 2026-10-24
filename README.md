# TripLite

TripLite is a travel planning dashboard for organizing trips, tracking budgets, managing a packing checklist, and recording travel expenses.

## Features

- Dashboard with trip count, total trip budget, recorded expenses, and packing progress.
- Create, view, edit, and delete trips. Trip records are stored in MongoDB.
- Trip cards show each trip's budget, linked expenses, and remaining budget or over-budget amount.
- Packing checklist with add, check off, and delete actions. Checklist data is stored in browser localStorage.
- Expense tracking with optional trip assignment, all/trip/unassigned filters, expense totals, and delete actions. Expense data is stored in browser localStorage.
- Responsive navigation and layouts for desktop and mobile screens.

## Tech stack

- HTML, CSS, and vanilla JavaScript
- Node.js and Express
- MongoDB and Mongoose
- dotenv for environment variables

## Project structure

```text
TripLite/
├── client/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── server/
│   ├── server.js
│   └── models/trip.js
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
└── requirements.txt
```

Trip API routes and server startup are in `server/server.js`. The Mongoose trip schema is in `server/models/trip.js`. Frontend markup, styles, and browser behavior are in `client/`.

## Prerequisites

- Node.js and npm. The project does not declare a specific minimum Node.js version.
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
```

Both variables are optional in the current server code: `PORT` defaults to `3000`, and `MONGODB_URI` defaults to the local `triplite` database shown above. Use a private local `.env` value if your MongoDB instance requires authentication or uses another address. Do not place real credentials in `.env.example`.

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

## API routes

All trip request bodies use JSON. Trip IDs in path parameters are MongoDB document IDs.

| Method and path | Purpose | Request requirements |
| --- | --- | --- |
| `GET /api/health` | Report server and MongoDB connection state. | No body. |
| `GET /api/trips` | Return trips ordered by creation time, newest first, along with a count. | No body. |
| `POST /api/trips` | Create a trip; responds with status `201` and the created trip. | JSON object with `name`, `destination`, `startDate`, `endDate`, `travellers`, and `budget`. Names and destination must be non-empty strings. Dates must be real calendar dates formatted `YYYY-MM-DD`, with end date on or after start date. `travellers` must be a whole number from 1 through 50. `budget` must be a finite number greater than or equal to zero. |
| `PUT /api/trips/:id` | Update an existing trip and return the updated document. The route accepts partial updates. | JSON object containing fields from `name`, `destination`, `startDate`, `endDate`, `travellers`, or `budget`. Supplied values are validated using the create constraints. Date ordering is checked against both updated and existing dates. An empty object currently returns the unchanged trip. |
| `DELETE /api/trips/:id` | Delete an existing trip and return the deleted document. | No body. The browser client retains any linked expenses in localStorage and unassigns them from the deleted trip. |

Validation errors generally return `400`; invalid MongoDB IDs return `400`; missing trips return `404`; unexpected route failures return `500`. API responses use a `success` flag and a message, with trip data returned in `data` on successful trip requests.

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

- MongoDB stores trip documents only. Packing items and expenses remain in localStorage in the browser that created them; they are not synced between browsers or devices and are not included in MongoDB backups.
- The application has no authentication, user accounts, roles, or multi-user data separation. The API currently exposes trip operations without authentication and is intended for local development.
- Expenses are browser-local records, not a server API or database collection. Trip filters and budget summaries use the local expense records.
- The popular destination tiles are static dashboard content.
- There is no automated test script defined in `package.json`.
- The project does not include a deployment configuration or automated production build step.

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
